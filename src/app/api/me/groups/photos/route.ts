import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { Api } from "grammy";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { serverEnv } from "@/lib/env";
import { telegramChatIdOf } from "@/lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PhotosResponse = { photos: Record<number, string | null> };
type CacheEntry = { data: PhotosResponse; expires: number };
const cache = new Map<number, CacheEntry>(); // keyed by userId
const TTL = 4 * 60 * 60 * 1000;

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);

  const cached = cache.get(auth.user.id);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const rows = await db
    .select({ id: groups.id, platform: groups.platform, externalChatId: groups.externalChatId })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, auth.user.id));

  const { TELEGRAM_BOT_TOKEN: token } = serverEnv();
  const tgApi = new Api(token);

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      const { id } = row;
      const chatId = telegramChatIdOf(row);
      if (chatId == null) return { id, url: null };
      try {
        const chat = await tgApi.getChat(chatId);
        const photo = (chat as { photo?: { big_file_id: string } }).photo;
        if (!photo?.big_file_id) return { id, url: null };
        const file = await tgApi.getFile(photo.big_file_id);
        if (!file.file_path) return { id, url: null };
        return { id, url: `/api/tg-photo?path=${encodeURIComponent(file.file_path)}` };
      } catch {
        return { id, url: null };
      }
    }),
  );

  const photos: Record<number, string | null> = {};
  for (const r of results) {
    if (r.status === "fulfilled") photos[r.value.id] = r.value.url;
  }

  const data: PhotosResponse = { photos };
  cache.set(auth.user.id, { data, expires: Date.now() + TTL });
  return NextResponse.json(data);
});

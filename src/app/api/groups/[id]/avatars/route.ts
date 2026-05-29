import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { Api } from "grammy";

import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AvatarsResponse = {
  groupPhoto: string | null;
  userPhotos: Record<number, string | null>;
};

type CacheEntry = { data: AvatarsResponse; expires: number };
const cache = new Map<number, CacheEntry>();
const TTL = 4 * 60 * 60 * 1000;

type Params = { params: Promise<{ id: string }> };

async function getFileUrl(api: Api, fileId: string, token: string): Promise<string | null> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) return null;
    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  } catch {
    return null;
  }
}

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const cached = cache.get(groupId);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const { TELEGRAM_BOT_TOKEN: token } = serverEnv();

  const [memberRows, groupRows] = await Promise.all([
    db
      .select({ userId: users.id, telegramId: users.telegramId })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId)),
    db
      .select({ telegramChatId: groups.telegramChatId })
      .from(groups)
      .where(eq(groups.id, groupId)),
  ]);

  const tgApi = new Api(token);
  const userPhotos: Record<number, string | null> = {};

  const memberResults = await Promise.allSettled(
    memberRows.map(async ({ userId, telegramId }) => {
      if (!telegramId) return { userId, url: null };
      try {
        const photos = await tgApi.getUserProfilePhotos(telegramId, { limit: 1 });
        if (!photos.total_count || !photos.photos[0]?.[0]) return { userId, url: null };
        const url = await getFileUrl(tgApi, photos.photos[0][0].file_id, token);
        return { userId, url };
      } catch {
        return { userId, url: null };
      }
    }),
  );

  for (const r of memberResults) {
    if (r.status === "fulfilled") {
      userPhotos[r.value.userId] = r.value.url;
    }
  }

  let groupPhoto: string | null = null;
  if (groupRows[0]) {
    try {
      const chat = await tgApi.getChat(groupRows[0].telegramChatId);
      const photo = (chat as { photo?: { big_file_id: string } }).photo;
      if (photo?.big_file_id) {
        groupPhoto = await getFileUrl(tgApi, photo.big_file_id, token);
      }
    } catch {
      // group photo unavailable
    }
  }

  const data: AvatarsResponse = { groupPhoto, userPhotos };
  cache.set(groupId, { data, expires: Date.now() + TTL });
  return NextResponse.json(data);
});

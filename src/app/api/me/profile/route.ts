import { NextResponse } from "next/server";
import { Api } from "grammy";

import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserPhotoUrl(api: Api, telegramId: number): Promise<string | null> {
  try {
    const photos = await api.getUserProfilePhotos(telegramId, { limit: 1 });
    if (!photos.total_count || !photos.photos[0]?.[0]) return null;
    const file = await api.getFile(photos.photos[0][0].file_id);
    if (!file.file_path) return null;
    return `/api/tg-photo?path=${encodeURIComponent(file.file_path)}`;
  } catch {
    return null;
  }
}

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const { firstName, lastName, username, telegramId } = auth.user;
  const { TELEGRAM_BOT_TOKEN: token } = serverEnv();

  const photoUrl = telegramId ? await getUserPhotoUrl(new Api(token), telegramId) : null;

  return NextResponse.json({ firstName, lastName, username, photoUrl });
});

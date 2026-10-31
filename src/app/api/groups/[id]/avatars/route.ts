import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import type { AvatarsResponse } from "@/lib/api-types";
import { telegramChatId } from "@/lib/chat";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { AVATAR_COLUMNS, botApi, resolveAvatars, telegramFileUrl, TtlCache } from "@/lib/avatars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the group photo is cached here; members' pictures go through `resolveAvatars`, which
// caches the Telegram lookups but chooses fresh each time, so a changed avatar source shows at once.
const groupPhotoCache = new TtlCache<number, string | null>(4 * 60 * 60 * 1000);

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const [memberRows, groupRows] = await Promise.all([
    db
      .select(AVATAR_COLUMNS)
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId)),
    db
      .select({ chatType: groups.chatType, chatId: groups.chatId })
      .from(groups)
      .where(eq(groups.id, groupId)),
  ]);

  const [resolved, groupPhoto] = await Promise.all([
    resolveAvatars(memberRows),
    loadGroupPhoto(groupId, groupRows[0] ? telegramChatId(groupRows[0]) : null),
  ]);

  const userPhotos: Record<number, string | null> = {};
  for (const [userId, avatar] of resolved) userPhotos[userId] = avatar.photoUrl;

  const data: AvatarsResponse = { groupPhoto, userPhotos };
  return NextResponse.json(data);
});

async function loadGroupPhoto(groupId: number, chatId: number | null): Promise<string | null> {
  if (chatId === null) return null;
  const cached = groupPhotoCache.get(groupId);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  try {
    const chat = await botApi().getChat(chatId);
    const photo = (chat as { photo?: { big_file_id: string } }).photo;
    if (photo?.big_file_id) url = await telegramFileUrl(photo.big_file_id);
  } catch {
    return null; // group photo unavailable; retry next time
  }
  groupPhotoCache.set(groupId, url);
  return url;
}

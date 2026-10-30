import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import type { ProfileResponse } from "@/lib/api-types";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { resolveAvatars } from "@/lib/avatars";
import { isAvatarSource, normaliseDisplayName } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileUser = {
  id: number;
  displayName: string | null;
  firstName: string;
  lastName: string | null;
  username: string | null;
  telegramId: number | null;
  avatarUrl: string | null;
  avatarSource: string | null;
};

async function profileOf(user: ProfileUser): Promise<ProfileResponse> {
  const avatar = (await resolveAvatars([user])).get(user.id);
  return {
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    photoUrl: avatar?.photoUrl ?? null,
    avatarSource: user.avatarSource,
    avatarOptions: (avatar?.options ?? []).flatMap((o) =>
      o.url ? [{ source: o.source, url: o.url }] : [],
    ),
  };
}

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  return NextResponse.json(await profileOf(auth.user));
});

const patchSchema = z
  .object({
    displayName: z.string().max(200).nullable().optional(),
    avatarSource: z.string().nullable().optional(),
  })
  .strict();

/** Sets the name and avatar the person chose (issue #101). An omitted key is left as it is. */
export const PATCH = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  const set: Partial<Pick<ProfileUser, "displayName" | "avatarSource">> = {};

  if (body.data.displayName !== undefined) {
    const name = normaliseDisplayName(body.data.displayName);
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
    set.displayName = name.value;
  }

  if (body.data.avatarSource !== undefined) {
    const source = body.data.avatarSource;
    if (source !== null) {
      // Only a linked login that has a picture can be chosen; anything else would silently
      // fall back to automatic, which reads as "the setting didn't save".
      if (!isAvatarSource(source)) {
        return NextResponse.json({ error: "未知的頭像來源" }, { status: 400 });
      }
      const current = await profileOf(auth.user);
      if (!current.avatarOptions.some((o) => o.source === source)) {
        return NextResponse.json({ error: "這個登入方式沒有可用的頭像" }, { status: 400 });
      }
    }
    set.avatarSource = source;
  }

  if (Object.keys(set).length === 0) return NextResponse.json(await profileOf(auth.user));

  const [updated] = await db
    .update(users)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(users.id, auth.user.id))
    .returning();
  return NextResponse.json(await profileOf(updated));
});

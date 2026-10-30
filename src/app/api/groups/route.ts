import { NextResponse } from "next/server";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { rotateInvite } from "@/lib/invites";
import { groupCreateSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates a group with no chat (`chat_type` / `chat_id` stay NULL) and its first invite. */
export const POST = withAuth(async (req: Request) => {
  const auth = await getAuth(req);

  const parsed = groupCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const group = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groups)
      .values({ title: parsed.data.title, defaultCurrency: parsed.data.defaultCurrency })
      .returning();
    await tx.insert(groupMembers).values({ groupId: created.id, userId: auth.user.id });
    await rotateInvite(tx, created.id, auth.user.id);
    return created;
  });

  return NextResponse.json({ id: group.id }, { status: 201 });
});

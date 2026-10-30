import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groupMembers, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { lockGroupMemberNames } from "@/lib/member-name-lock";
import { isDuplicateName, placeholderNameSchema } from "@/lib/placeholder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ firstName: placeholderNameSchema });

/** Add a member who has a name but no account; they can be a payer or debtor like anyone else. */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: body.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const member = await db.transaction(async (tx) => {
    await lockGroupMemberNames(tx, groupId);
    const existing = await tx
      .select({
        id: users.id,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId));
    if (isDuplicateName(body.data.firstName, existing)) return null;

    const [user] = await tx
      .insert(users)
      .values({ firstName: body.data.firstName, placeholderGroupId: groupId })
      .returning();
    await tx.insert(groupMembers).values({ groupId, userId: user.id });
    return user;
  });
  if (!member) {
    return NextResponse.json({ error: "名字已被群組成員使用" }, { status: 409 });
  }

  return NextResponse.json(
    {
      member: {
        id: member.id,
        firstName: member.firstName,
        lastName: null,
        username: null,
        status: "active",
        isPlaceholder: true,
      },
    },
    { status: 201 },
  );
});

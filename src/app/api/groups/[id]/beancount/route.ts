import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { userBeancountConfigs } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { beancountConfigInputSchema, type BeancountConfigInput } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function resolve(req: Request, ctx: Params) {
  const auth = await getAuth(req);
  const groupId = Number((await ctx.params).id);
  if (!Number.isFinite(groupId)) return null;
  await assertGroupMember(auth.user.id, groupId);
  return { userId: auth.user.id, groupId };
}

/** Project a config row down to the wire shape (drops id/userId/groupId/timestamps). */
function toJson(row: BeancountConfigInput): BeancountConfigInput {
  return {
    expensesAccount: row.expensesAccount,
    cashAccount: row.cashAccount,
    receivablePrefix: row.receivablePrefix,
    personAccounts: row.personAccounts,
  };
}

/** The current user's beancount config for this group, or `null` when not enabled. */
export const GET = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  if (!ids) return NextResponse.json({ error: "invalid group id" }, { status: 400 });

  const [row] = await db
    .select()
    .from(userBeancountConfigs)
    .where(
      and(
        eq(userBeancountConfigs.userId, ids.userId),
        eq(userBeancountConfigs.groupId, ids.groupId),
      ),
    );

  return NextResponse.json({ config: row ? toJson(row) : null });
});

/** Enable / update the current user's beancount config for this group. */
export const PUT = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  if (!ids) return NextResponse.json({ error: "invalid group id" }, { status: 400 });

  const parsed = beancountConfigInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const [row] = await db
    .insert(userBeancountConfigs)
    .values({
      userId: ids.userId,
      groupId: ids.groupId,
      expensesAccount: input.expensesAccount,
      cashAccount: input.cashAccount,
      receivablePrefix: input.receivablePrefix,
      personAccounts: input.personAccounts,
    })
    .onConflictDoUpdate({
      target: [userBeancountConfigs.userId, userBeancountConfigs.groupId],
      set: {
        expensesAccount: input.expensesAccount,
        cashAccount: input.cashAccount,
        receivablePrefix: input.receivablePrefix,
        personAccounts: input.personAccounts,
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ config: toJson(row) });
});

/** Disable the feature for this group (removes the config row). */
export const DELETE = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  if (!ids) return NextResponse.json({ error: "invalid group id" }, { status: 400 });

  await db
    .delete(userBeancountConfigs)
    .where(
      and(
        eq(userBeancountConfigs.userId, ids.userId),
        eq(userBeancountConfigs.groupId, ids.groupId),
      ),
    );

  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";

import { db } from "@/db";
import { userBeancountConfigs } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import type { BeancountAccounts } from "@/lib/beancount";
import { loadBeancountSettings } from "@/lib/beancount-export";
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

function toJson(accounts: BeancountAccounts): { config: BeancountConfigInput } {
  return {
    config: {
      expensesAccount: accounts.expenses,
      cashAccount: accounts.cash,
      eventAccount: accounts.event,
    },
  };
}

/** The caller's beancount accounts for this group, with the defaults filled in. */
export const GET = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  if (!ids) return NextResponse.json({ error: "invalid group id" }, { status: 400 });

  const settings = await loadBeancountSettings(ids.userId, ids.groupId);
  if (!settings) return NextResponse.json({ error: "group not found" }, { status: 404 });
  return NextResponse.json(toJson(settings.accounts));
});

/** Save the caller's accounts for this group. The export watermark is left alone. */
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
  const columns = {
    expensesAccount: input.expensesAccount,
    cashAccount: input.cashAccount,
    eventAccount: input.eventAccount,
  };

  await db
    .insert(userBeancountConfigs)
    .values({ userId: ids.userId, groupId: ids.groupId, ...columns })
    .onConflictDoUpdate({
      target: [userBeancountConfigs.userId, userBeancountConfigs.groupId],
      set: { ...columns, updatedAt: new Date() },
    });

  return NextResponse.json(
    toJson({ expenses: input.expensesAccount, cash: input.cashAccount, event: input.eventAccount }),
  );
});

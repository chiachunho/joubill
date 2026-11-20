import { NextResponse } from "next/server";

import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { createRefund, loadRefundParent } from "@/lib/records";
import { refundInputSchema } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; expenseId: string }> };

async function resolveIds({ params }: Params) {
  const { id, expenseId } = await params;
  return { groupId: requireId(id, "group id"), expenseId: requireId(expenseId, "expense id") };
}

// The expense a new refund is recorded on, as the form shows it (its split is what a
// 'ratio' refund is shared back by).
export const GET = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const { groupId, expenseId } = await resolveIds(ctx);
  await assertGroupMember(auth.user.id, groupId);

  const parent = await loadRefundParent(groupId, expenseId);
  if (!parent) return NextResponse.json({ error: "expense not found" }, { status: 404 });
  return NextResponse.json({
    id: parent.id,
    description: parent.description,
    currency: parent.currency,
    spentAt: parent.spentAt,
    splits: parent.splits,
  });
});

// A refund (issue #178) is stored as a `type='refund'` expense pointing at this one.
// It appears in the main list at `GET …/expenses`, like a settlement.
export const POST = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const { groupId, expenseId } = await resolveIds(ctx);
  await assertGroupMember(auth.user.id, groupId);

  const parsed = refundInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { id } = await createRefund(groupId, expenseId, parsed.data, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ id }, { status: 201 });
});

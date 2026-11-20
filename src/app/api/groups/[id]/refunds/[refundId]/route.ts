import { NextResponse } from "next/server";

import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { loadCreatedVia } from "@/lib/record-via";
import { loadLastActivity } from "@/lib/record-history";
import { deleteRecord, loadRefundDetail, updateRefund } from "@/lib/records";
import { receiptPhotoUrl } from "@/lib/tg-photo-sign";
import { refundInputSchema } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; refundId: string }> };

async function resolveIds({ params }: Params) {
  const { id, refundId } = await params;
  return { groupId: requireId(id, "group id"), refundId: requireId(refundId, "refund id") };
}

export const GET = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const { groupId, refundId } = await resolveIds(ctx);
  await assertGroupMember(auth.user.id, groupId);

  const detail = await loadRefundDetail(groupId, refundId);
  if (!detail) return NextResponse.json({ error: "refund not found" }, { status: 404 });
  const { row, parent } = detail;

  const [lastActivity, createdVia] = await Promise.all([
    loadLastActivity(refundId),
    loadCreatedVia([refundId]),
  ]);

  return NextResponse.json({
    id: row.id,
    expenseId: parent.id,
    expense: {
      id: parent.id,
      description: parent.description,
      currency: parent.currency,
      spentAt: parent.spentAt,
      splits: parent.splits,
    },
    // Attribution, as on the expense and settlement endpoints: the form shows it.
    createdBy: row.createdBy,
    createdVia: createdVia.get(refundId) ?? null,
    createdAt: row.createdAt,
    lastActivity: lastActivity && {
      actorId: lastActivity.actor?.userId ?? null,
      at: lastActivity.at,
      via: lastActivity.via,
    },
    amount: n(row.amount),
    currency: row.currency,
    fxRate: row.fxRate != null ? n(row.fxRate) : null,
    fxQuote: row.fxQuote,
    refundedAt: row.spentAt,
    description: row.description,
    note: row.note,
    receivedBy: detail.receivedBy,
    split: row.refundSplit === "custom" ? "custom" : "ratio",
    shares: detail.shares,
    receiptFileIds: detail.receiptFileIds,
    receiptUrls: Object.fromEntries(detail.receiptFileIds.map((id) => [id, receiptPhotoUrl(id)])),
  });
});

export const PATCH = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const { groupId, refundId } = await resolveIds(ctx);
  await assertGroupMember(auth.user.id, groupId);

  const parsed = refundInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  await updateRefund(groupId, refundId, parsed.data, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const { groupId, refundId } = await resolveIds(ctx);
  await assertGroupMember(auth.user.id, groupId);

  await deleteRecord(groupId, refundId, "refund", auth.user, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ ok: true });
});

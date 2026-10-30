import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getBot } from "@/bot";

import { db } from "@/db";
import { expenses } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { mergeUserInto, previewMerge } from "@/lib/member-merge-db";
import { refreshClaimedNotices } from "@/lib/claim-notices";
import { logDeleted, logMemberClaimed } from "@/lib/record-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

const bodySchema = z.object({
  intoUserId: z.number().int().positive(),
  /** Settlements between the two people turn into "A → A": drop them, or keep (delete-only). */
  selfSettlements: z.enum(["delete", "keep"]).default("keep"),
});

/**
 * What merging this placeholder into `intoUserId` would take, for the confirm dialog.
 * Any member may ask: there is no per-record permission to protect (see CLAUDE.md,
 * "Who may edit or delete a record").
 */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id, userId } = await params;
  const groupId = Number(id);
  const fromId = Number(userId);
  const intoParam = new URL(req.url).searchParams.get("intoUserId");
  const toId = Number(intoParam);
  if (!intoParam || ![groupId, fromId, toId].every(Number.isFinite)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);
  await assertGroupMember(toId, groupId);

  const { check, summary } = await previewMerge(groupId, fromId, toId);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  return NextResponse.json(summary);
});

/** Fold a placeholder into a real member. Irreversible, and needs nobody else's consent. */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id, userId } = await params;
  const groupId = Number(id);
  const fromId = Number(userId);
  if (!Number.isFinite(groupId) || !Number.isFinite(fromId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const toId = body.data.intoUserId;
  await assertGroupMember(toId, groupId);

  const result = await db.transaction((tx) => mergeUserInto(tx, groupId, fromId, toId));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logMemberClaimed(
    groupId,
    { userId: auth.user.id, source: "app" },
    {
      placeholderId: fromId,
      placeholderName: result.placeholderName,
      claimerId: toId,
      claimerName: result.claimerName,
      recordIds: result.recordIds,
    },
  );

  // After the merge commits, so each deletion is audited and tombstoned like any other.
  const removedIds: number[] = [];
  if (body.data.selfSettlements === "delete") {
    for (const recordId of result.selfSettlementIds) {
      await logDeleted(
        getBot().api,
        recordId,
        { userId: auth.user.id, source: "app" },
        auth.user,
        async (tx) => {
          await tx.delete(expenses).where(eq(expenses.id, recordId));
        },
      );
      removedIds.push(recordId);
    }
  }
  // Their cards still name the placeholder; edit them once the response is on its way.
  after(() => refreshClaimedNotices(getBot().api, result.recordIds, removedIds));

  return NextResponse.json({
    ok: true,
    recordCount: result.recordIds.length,
    removed: removedIds.length,
  });
});

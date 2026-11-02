import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getBot } from "@/bot";

import { db } from "@/db";
import { expenses, users } from "@/db/schema";
import {
  MERGE_TICKET_COOKIE,
  MERGE_TICKET_NOT_FOUND,
  MERGE_TICKET_PATH,
} from "@/lib/account-merge";
import {
  consumeMergeTicket,
  discardMergeTicket,
  findMergeTicket,
  mergeAccounts,
  previewAccountMerge,
} from "@/lib/account-merge-db";
import { parseCookie, resolveSession } from "@/lib/auth";
import { refreshClaimedNotices } from "@/lib/claim-notices";
import { logAccountMerged, logDeleted } from "@/lib/record-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Merging two accounts (issue #99). Web sessions only: the proof is a ticket the Auth.js
 * `signIn` callback put in the httpOnly `merge_ticket` cookie, scoped to this path, after the
 * signed-in person completed another account's OAuth sign-in. A ticket that is missing,
 * expired, used, or someone else's all answer the same 404, so a response never says which
 * tickets exist.
 */

const bodySchema = z.object({
  keepUserId: z.number().int().positive(),
  /** Settlements between the two accounts turn into "A → A": drop them, or keep (delete-only). */
  selfSettlements: z.enum(["delete", "keep"]).default("keep"),
});

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function ticketId(req: Request): string | null {
  return parseCookie(req.headers.get("cookie") ?? "", MERGE_TICKET_COOKIE);
}

function clearTicket(res: NextResponse): NextResponse {
  res.cookies.set(MERGE_TICKET_COOKIE, "", { path: MERGE_TICKET_PATH, maxAge: 0 });
  return res;
}

const notFound = () =>
  clearTicket(NextResponse.json({ error: MERGE_TICKET_NOT_FOUND }, { status: 404 }));

export async function GET(req: Request) {
  const user = await resolveSession(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = ticketId(req);
  const ticket = id ? await findMergeTicket(id, user.id) : null;
  if (!ticket) return notFound();

  const preview = await previewAccountMerge(user.id, ticket.otherUserId);
  if (!preview) return notFound();
  return NextResponse.json(preview);
}

export async function POST(req: Request) {
  const user = await resolveSession(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = ticketId(req);
  if (!id) return notFound();

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  let result;
  try {
    result = await db.transaction(async (tx) => {
      // Claimed in the same transaction: a double tap finds it used, and a refused merge
      // rolls the claim back so the person can still cancel or retry.
      const ticket = await consumeMergeTicket(tx, id, user.id);
      if (!ticket) throw new Refused(404, MERGE_TICKET_NOT_FOUND);
      const pair = [ticket.userId, ticket.otherUserId];
      if (!pair.includes(body.data.keepUserId)) {
        throw new Refused(400, "keepUserId must be one of the two accounts");
      }
      const absorbId = pair.find((u) => u !== body.data.keepUserId)!;
      const result = await mergeAccounts(tx, body.data.keepUserId, absorbId);
      if (!result.ok) throw new Refused(result.status, result.error);
      return { ...result, absorbId };
    });
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    if (err.status === 404) return notFound();
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { absorbId } = result;

  const keepId = body.data.keepUserId;
  const actor = { userId: keepId, source: "app" as const };
  // Everything below runs after the merge committed, and the ticket is already consumed: a
  // throw here would answer 500 for a merge that happened, and a retry could only get a 404.
  // So each step logs its own failure and the response still reports the merge.
  // One independent insert per group; none depends on another.
  const audits = await Promise.allSettled(
    result.groups.map((g) =>
      logAccountMerged(g.groupId, actor, {
        absorbedId: absorbId,
        absorbedName: result.absorbName,
        keptId: keepId,
        keptName: result.keepName,
        recordIds: g.recordIds,
      }),
    ),
  );
  for (const r of audits) {
    if (r.status === "rejected") console.error("[account merge] audit log failed:", r.reason);
  }

  // After the merge commits, so each deletion is audited and tombstoned like any other.
  const removed = new Map<number, number[]>();
  if (body.data.selfSettlements === "delete") {
    try {
      const [keeper] = await db.select().from(users).where(eq(users.id, keepId));
      for (const g of result.groups) {
        for (const recordId of g.selfSettlementIds) {
          try {
            await logDeleted(getBot().api, recordId, actor, keeper, async (tx) => {
              await tx.delete(expenses).where(eq(expenses.id, recordId));
            });
            removed.set(g.groupId, [...(removed.get(g.groupId) ?? []), recordId]);
          } catch (err) {
            // The A → A settlement stays; it is delete-only in the form, so it can be removed there.
            console.error("[account merge] deleting self-settlement failed:", recordId, err);
          }
        }
      }
    } catch (err) {
      console.error("[account merge] loading the kept account failed:", err);
    }
  }
  // Each group's cards still name the absorbed account; edit them once the response is out.
  after(async () => {
    for (const g of result.groups) {
      try {
        await refreshClaimedNotices(getBot().api, g.recordIds, removed.get(g.groupId) ?? []);
      } catch (err) {
        console.error("[account merge] refreshing chat cards failed:", g.groupId, err);
      }
    }
  });

  return clearTicket(
    NextResponse.json({
      ok: true,
      keptUserId: keepId,
      groups: result.groups.length,
      records: result.groups.reduce((sum, g) => sum + g.recordIds.length, 0),
    }),
  );
}

/** Cancel: forget the ticket so the merge can't be resumed later. */
export async function DELETE(req: Request) {
  const user = await resolveSession(req);
  const id = ticketId(req);
  if (user && id) await discardMergeTicket(id, user.id);
  return clearTicket(new NextResponse(null, { status: 204 }));
}

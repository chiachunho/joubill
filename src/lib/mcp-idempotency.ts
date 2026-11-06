import { and, eq, isNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import { appIdempotency } from "@/db/schema";

/** A key is remembered this long; a resend after it creates a new record. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Same group, amount, currency and payer within this window is a likely double entry. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** A claim that never got a record this long ago was abandoned (the call died). */
export const CLAIM_STALE_MS = 2 * 60 * 1000;

export const idempotencyCutoff = (now: Date) => new Date(now.getTime() - IDEMPOTENCY_TTL_MS);
export const duplicateSince = (now: Date) => new Date(now.getTime() - DUPLICATE_WINDOW_MS);

export type Claim =
  { status: "claimed" } | { status: "duplicate"; recordId: number } | { status: "in_progress" };

/**
 * Takes `key` for this connection. The insert is the lock: of two calls with one key only
 * one inserts, the other reads what the first left. Expired rows are removed first, so an
 * old key is free again, and the same delete is the sweep. A claim with no record after
 * `CLAIM_STALE_MS` belonged to a call that died, so it is freed too (else the key would
 * answer `in_progress` for 24 h).
 */
export async function claimKey(
  connectionId: number,
  key: string,
  now = new Date(),
): Promise<Claim> {
  await db
    .delete(appIdempotency)
    .where(
      or(
        lt(appIdempotency.createdAt, idempotencyCutoff(now)),
        and(
          isNull(appIdempotency.recordId),
          lt(appIdempotency.createdAt, new Date(now.getTime() - CLAIM_STALE_MS)),
        ),
      ),
    );
  const inserted = await db
    .insert(appIdempotency)
    .values({ connectionId, key, createdAt: now })
    .onConflictDoNothing()
    .returning({ id: appIdempotency.id });
  if (inserted.length > 0) return { status: "claimed" };
  const [row] = await db
    .select({ recordId: appIdempotency.recordId })
    .from(appIdempotency)
    .where(and(eq(appIdempotency.connectionId, connectionId), eq(appIdempotency.key, key)));
  return row?.recordId != null
    ? { status: "duplicate", recordId: row.recordId }
    : { status: "in_progress" };
}

export async function bindKey(connectionId: number, key: string, recordId: number): Promise<void> {
  await db
    .update(appIdempotency)
    .set({ recordId })
    .where(and(eq(appIdempotency.connectionId, connectionId), eq(appIdempotency.key, key)));
}

/** Gives the key back (the call failed or was held for confirmation), so a retry can use it. */
export async function releaseKey(connectionId: number, key: string): Promise<void> {
  await db
    .delete(appIdempotency)
    .where(and(eq(appIdempotency.connectionId, connectionId), eq(appIdempotency.key, key)));
}

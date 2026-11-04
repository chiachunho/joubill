import crypto from "node:crypto";

import { after } from "next/server";
import { lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { rateLimitHits } from "@/db/schema";
import { TooManyRequestsError } from "@/lib/auth/errors";
import { serverEnv } from "@/lib/env";
import {
  clientIp,
  decide,
  RATE_LIMITED,
  RATE_RULES,
  rateKey,
  type RateDecision,
  type RateRule,
  sweepBefore,
  windowStart,
} from "@/lib/rate-limits";

/**
 * Counts one attempt against every rule in `entries` (one statement) and says whether it is
 * over. Fails open: the limit is defence in depth on top of a 50-bit code, and a limiter
 * that throws would take legitimate joins down with it.
 */
export async function consumeRateLimit(
  entries: { rule: RateRule; id: string | number }[],
  now = new Date(),
): Promise<RateDecision> {
  if (entries.length === 0) return { ok: true };
  const rows = entries.map(({ rule, id }) => ({
    key: rateKey(rule, id),
    windowStart: windowStart(now, rule.windowMs),
    count: 1,
  }));
  try {
    const counted = await db
      .insert(rateLimitHits)
      .values(rows)
      .onConflictDoUpdate({
        target: [rateLimitHits.key, rateLimitHits.windowStart],
        set: { count: sql`${rateLimitHits.count} + 1` },
      })
      .returning({ key: rateLimitHits.key, count: rateLimitHits.count });
    const byKey = new Map(counted.map((r) => [r.key, r.count]));
    return decide(
      entries.map(({ rule, id }) => ({ rule, count: byKey.get(rateKey(rule, id)) ?? 1 })),
    );
  } catch (err) {
    console.error("[rate-limit] counting failed, letting the request through", err);
    return { ok: true };
  }
}

/** Deletes counters whose window is long over, so the table can't grow without bound. */
export async function sweepRateLimits(now = new Date()): Promise<void> {
  try {
    await db.delete(rateLimitHits).where(lt(rateLimitHits.windowStart, sweepBefore(now)));
  } catch (err) {
    console.error("[rate-limit] sweep failed", err);
  }
}

let cachedIpKey: Buffer | undefined;

/**
 * An HMAC of the caller's IP, so `rate_limit_hits` never holds a raw address. Keyed off the
 * bot token with a purpose label, like `tg-photo-sign.ts`, so no new env var is needed.
 */
export function ipKey(headers: Headers): string | null {
  const ip = clientIp(headers);
  if (!ip) return null;
  cachedIpKey ??= crypto
    .createHmac("sha256", "rate-limit-ip")
    .update(serverEnv().TELEGRAM_BOT_TOKEN)
    .digest();
  return crypto.createHmac("sha256", cachedIpKey).update(ip).digest("base64url").slice(0, 22);
}

/**
 * The guard for the invite routes: counts the attempt per user and per IP, throws a 429
 * (`withAuth` adds `Retry-After`) when over, and sweeps old rows after the response.
 * Call it after `getAuth` and before anything looks the code up.
 */
export async function enforceInviteRateLimit(req: Request, userId: number): Promise<void> {
  const ip = ipKey(req.headers);
  const decision = await consumeRateLimit([
    { rule: RATE_RULES.inviteUser, id: userId },
    ...(ip ? [{ rule: RATE_RULES.inviteIp, id: ip }] : []),
  ]);
  after(() => sweepRateLimits());
  if (!decision.ok) throw new TooManyRequestsError(RATE_LIMITED.error, decision.retryAfter);
}

import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db";
import { authIdentities, users } from "@/db/schema";
import {
  MERGE_TICKET_COOKIE,
  MERGE_TICKET_PATH,
  MERGE_TICKET_TTL_SECONDS,
} from "@/lib/account-merge";
import { createMergeTicket } from "@/lib/account-merge-db";
import { resolveSessionByToken, SESSION_COOKIE } from "@/lib/auth";

/** The page that confirms a merge. The ticket itself travels only in the cookie. */
export const MERGE_PAGE = "/app/settings/merge";

/** The real account that already owns this login, if any. */
async function identityOwner(provider: string, providerAccountId: string): Promise<number | null> {
  const [row] = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(
        eq(authIdentities.provider, provider),
        eq(authIdentities.providerUid, providerAccountId),
        isNull(users.placeholderGroupId),
      ),
    );
  if (row) return row.userId;
  // A Telegram account can be known by `users.telegram_id` alone; linking it to someone else
  // would hit that unique index, so it counts as owned too.
  if (provider === "telegram" && /^\d+$/.test(providerAccountId)) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, Number(providerAccountId)));
    if (user) return user.id;
  }
  return null;
}

/**
 * Called from the Auth.js `signIn` callback. When someone already signed in as A completes an
 * OAuth sign-in that belongs to another account B, that is the proof they own both: record it,
 * hand the ticket over in an httpOnly cookie scoped to the merge API, and send them to the
 * confirm page instead of failing with OAuthAccountNotLinked. No session is created for B.
 *
 * Returns null to let the sign-in continue as usual (no session, the login is new, or it is
 * already this account's).
 */
export async function mergeRedirect(
  provider: string,
  providerAccountId: string,
): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const current = await resolveSessionByToken(token);
  if (!current) return null;

  const owner = await identityOwner(provider, providerAccountId);
  if (owner === null || owner === current.id) return null;

  const ticket = await createMergeTicket(current.id, owner, provider);
  jar.set(MERGE_TICKET_COOKIE, ticket, {
    httpOnly: true,
    sameSite: "lax",
    path: MERGE_TICKET_PATH,
    maxAge: MERGE_TICKET_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
  return MERGE_PAGE;
}

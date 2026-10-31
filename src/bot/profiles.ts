import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { labelUser } from "@/lib/label";

import { mention } from "./format";

/**
 * The user columns every bot query needs: enough to render a tappable mention
 * (`telegramId`), the name the person chose (`displayName`), and the provider's
 * name to fall back to.
 * Selected as a shared object so a query can't quietly forget `telegramId` and
 * silently degrade every mention in its output to plain text.
 */
export const USER_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  firstName: users.firstName,
  lastName: users.lastName,
  telegramId: users.telegramId,
} as const;

/**
 * Loads the given users and returns a `mentionOf(userId)` renderer.
 *
 * `/balance` and `/settle` both turn a list of `{userId, amount}` into lines of
 * mentions, and both need the same "one query, then look up by id" shape — the
 * alternative is a query per line.
 *
 * An id with no row renders as `user#<id>` rather than throwing: the balance is
 * still worth showing if one profile went missing.
 */
export async function loadMentionMap(userIds: number[]): Promise<(userId: number) => string> {
  if (userIds.length === 0) return (userId) => `user#${userId}`;

  const rows = await db.select(USER_COLUMNS).from(users).where(inArray(users.id, userIds));
  const profiles = new Map(rows.map((p) => [p.id, p]));

  return (userId: number) => {
    const p = profiles.get(userId);
    return p ? mention(labelUser(p), p.telegramId) : `user#${userId}`;
  };
}

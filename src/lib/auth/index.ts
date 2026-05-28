import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import type { Group, User } from "@/db/schema";
import { serverEnv } from "@/lib/env";

import { ForbiddenError, UnauthorizedError } from "./errors";
import { verifyInitData } from "./initData";

export type Auth = {
  user: User;
  /** Group resolved from initData start_param (e.g. "group_<telegram_chat_id>"). */
  groupFromParam?: Group;
};

/**
 * Unified auth entry. C5 supports Mini App initData via:
 *   Authorization: tma <raw initData string>
 * C7 will extend this to also accept a session cookie from the Telegram Login Widget.
 */
export async function getAuth(req: Request): Promise<Auth> {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const match = header.match(/^tma\s+(.+)$/i);
  if (!match) {
    throw new UnauthorizedError("missing tma authorization header");
  }
  const initDataRaw = match[1];

  let verified;
  try {
    verified = verifyInitData(initDataRaw, serverEnv().TELEGRAM_BOT_TOKEN);
  } catch (err) {
    throw new UnauthorizedError(err instanceof Error ? err.message : "initData invalid");
  }

  // Upsert user. We mirror registerUser (the bot middleware) so first-time
  // Mini App visitors who somehow never spoke to the bot still get a row.
  const tgUser = verified.user;
  const [user] = await db
    .insert(users)
    .values({
      telegramId: tgUser.id,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name ?? null,
      username: tgUser.username?.toLowerCase() ?? null,
      languageCode: tgUser.language_code ?? null,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        firstName: tgUser.first_name,
        lastName: tgUser.last_name ?? null,
        username: tgUser.username?.toLowerCase() ?? null,
        languageCode: tgUser.language_code ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Resolve start_param: bot puts "group_<telegram_chat_id>" when launching from a group.
  let groupFromParam: Group | undefined;
  if (verified.startParam?.startsWith("group_")) {
    const telegramChatId = Number(verified.startParam.slice("group_".length));
    if (Number.isFinite(telegramChatId)) {
      const [g] = await db
        .select()
        .from(groups)
        .where(eq(groups.telegramChatId, telegramChatId));
      if (g) groupFromParam = g;
    }
  }

  return { user, groupFromParam };
}

/** Throws ForbiddenError if the user is not a member of the given internal group id. */
export async function assertGroupMember(userId: number, groupId: number): Promise<void> {
  const [row] = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId)));
  if (!row) throw new ForbiddenError("not a member of this group");
}

/** Returns the subset of userIds that are NOT members of the given group. */
export async function findUsersNotInGroup(groupId: number, userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, userIds)));
  const present = new Set(rows.map((r) => r.userId));
  return userIds.filter((id) => !present.has(id));
}

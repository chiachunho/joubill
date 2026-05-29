import { and, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups, sessions, users } from "@/db/schema";
import type { Group, User } from "@/db/schema";
import { serverEnv } from "@/lib/env";

import { ForbiddenError, UnauthorizedError } from "./errors";
import { verifyInitData } from "./initData";
import { upsertTelegramUser } from "./upsertTelegramUser";

export type Auth = {
  user: User;
  /** Group resolved from initData start_param (e.g. "group_<telegram_chat_id>"). Only set for the tma path. */
  groupFromParam?: Group;
};

export const SESSION_COOKIE = "session";

export function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Resolves a raw session token (e.g. from `cookies()` in a Server Component)
 * to a user. Returns null if the session is missing or expired.
 */
export async function resolveSessionByToken(token: string): Promise<User | null> {
  const [row] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  return user ?? null;
}

/**
 * Resolves a session cookie to a user. Returns null if the cookie is missing,
 * the session doesn't exist, or the session has expired.
 */
export async function resolveSession(req: Request): Promise<User | null> {
  const token = parseCookie(req.headers.get("cookie") ?? "", SESSION_COOKIE);
  if (!token) return null;
  return resolveSessionByToken(token);
}

/**
 * Unified auth entry point. Tries two paths in order:
 *   1. Authorization: tma <initData>  — Telegram Mini App
 *   2. Cookie: session=<token>        — web login (Telegram Login Widget / OAuth)
 */
export async function getAuth(req: Request): Promise<Auth> {
  // Path 1: Telegram Mini App
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const match = header.match(/^tma\s+(.+)$/i);
  if (match) {
    let verified;
    try {
      verified = verifyInitData(match[1], serverEnv().TELEGRAM_BOT_TOKEN);
    } catch (err) {
      throw new UnauthorizedError(err instanceof Error ? err.message : "initData invalid");
    }

    const user = await upsertTelegramUser(verified.user);

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

  // Path 2: web session cookie
  const user = await resolveSession(req);
  if (user) return { user };

  throw new UnauthorizedError("missing tma authorization header or session cookie");
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

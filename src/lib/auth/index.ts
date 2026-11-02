import { and, eq, gt, inArray } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db";
import { groupMembers, groups, sessions, users } from "@/db/schema";
import type { Group, User } from "@/db/schema";
import { whereTelegramChat } from "@/lib/chat";
import { parseStartParam } from "@/lib/deep-link";
import { serverEnv } from "@/lib/env";

import { ForbiddenError, UnauthorizedError } from "./errors";
import { verifyInitData } from "./initData";
import { upsertTelegramUser } from "./upsertTelegramUser";

export type Auth = {
  user: User;
  /** Group resolved from initData start_param. Only set for the tma path. */
  groupFromParam?: Group;
  /** Internal expense ID from start_param "group_<chatId>_exp_<expenseId>". */
  expenseFromParam?: number;
  /** Internal settlement ID from start_param "group_<chatId>_stl_<settlementId>". */
  settlementFromParam?: number;
  /** Normalised invite code from a `join_<code>` start param. */
  inviteFromParam?: string;
};

export const SESSION_COOKIE = "session";

export function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return null;
  // A malformed escape (`session=%`) must read as "no cookie", not throw a 500.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
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
 * The signed-in user of the current request, read from `cookies()` (Server Components and
 * Auth.js callbacks, which have no `Request` in hand). Null without a live session.
 */
export async function resolveSessionFromCookies(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSessionByToken(token) : null;
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
    let expenseFromParam: number | undefined;
    let settlementFromParam: number | undefined;
    // The payload shape lives in src/lib/deep-link.ts, next to the builders the
    // bot uses — a parser that drifts from them fails silently.
    const startParam = parseStartParam(verified.startParam);
    let inviteFromParam: string | undefined;
    // A join link only carries the code onward. Joining happens when the person confirms the
    // preview, never here, so opening a link can't add anyone to a group.
    if (startParam?.kind === "join") inviteFromParam = startParam.code;
    if (startParam?.kind === "group") {
      const [g] = await db
        .select()
        .from(groups)
        .where(whereTelegramChat(startParam.telegramChatId));
      if (g) {
        groupFromParam = g;
        if (startParam.record?.kind === "expense") expenseFromParam = startParam.record.id;
        else if (startParam.record) settlementFromParam = startParam.record.id;
        // Auto-join when the user opens the Mini App via a group link.
        // We only call getChatMember (slow) when the row is genuinely absent —
        // subsequent requests hit onConflictDoNothing instantly.
        const [existing] = await db
          .select({ groupId: groupMembers.groupId })
          .from(groupMembers)
          .where(and(eq(groupMembers.userId, user.id), eq(groupMembers.groupId, g.id)));
        if (!existing) {
          const { TELEGRAM_BOT_TOKEN } = serverEnv();
          const cmRes = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${g.chatId}&user_id=${user.telegramId}`,
          ).catch(() => null);
          const cmJson = cmRes?.ok
            ? ((await cmRes.json()) as { ok: boolean; result?: { status: string } })
            : null;
          const status = cmJson?.ok ? cmJson.result?.status : undefined;
          if (status && status !== "left" && status !== "kicked") {
            await db
              .insert(groupMembers)
              .values({ groupId: g.id, userId: user.id })
              .onConflictDoNothing();
          }
        }
      }
    }
    return { user, groupFromParam, expenseFromParam, settlementFromParam, inviteFromParam };
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

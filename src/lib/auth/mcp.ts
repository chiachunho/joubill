import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { appConnections, users } from "@/db/schema";
import type { Grant } from "@/lib/mcp-grant";
import { hashToken, parseBearerToken } from "@/lib/mcp-token";

import type { Auth } from "./index";
import { UnauthorizedError } from "./errors";

export type AppAuth = Auth & { grant: Grant };

/** `last_used_at` is refreshed at most this often, so a read doesn't cost a write. */
const TOUCH_MS = 60_000;

/**
 * Auth for `/api/mcp`: `Authorization: Bearer sbk_…`. Revocation and expiry are checked on
 * every call. Group membership is checked per tool (`assertGroupMember`), also every call.
 * `getAuth` deliberately does not accept these tokens, so REST stays closed to agents.
 */
export async function getAppAuth(req: Request): Promise<AppAuth> {
  const token = parseBearerToken(req.headers.get("authorization"));
  if (!token) throw new UnauthorizedError("missing or malformed bearer token");

  const [row] = await db
    .select({ conn: appConnections, user: users })
    .from(appConnections)
    .innerJoin(users, eq(users.id, appConnections.userId))
    .where(eq(appConnections.tokenHash, hashToken(token)));
  const now = new Date();
  if (!row || row.conn.revokedAt || (row.conn.expiresAt && row.conn.expiresAt <= now)) {
    throw new UnauthorizedError("invalid, revoked or expired token");
  }

  const { conn } = row;
  if (!conn.lastUsedAt || now.getTime() - conn.lastUsedAt.getTime() > TOUCH_MS) {
    await db
      .update(appConnections)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(appConnections.id, conn.id),
          or(
            isNull(appConnections.lastUsedAt),
            lt(appConnections.lastUsedAt, sql`now() - interval '1 minute'`),
          ),
        ),
      )
      .catch(() => {});
  }

  return {
    user: row.user,
    grant: {
      connectionId: conn.id,
      access: conn.access === "write" ? "write" : "read",
      allGroups: conn.allGroups,
      groupIds: conn.groupIds,
    },
  };
}

import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { mcpConnections, oauthTokens, users } from "@/db/schema";
import type { Grant } from "@/lib/mcp-grant";
import { hashToken, parseBearerToken } from "@/lib/mcp-token";
import { parseAccessToken } from "@/lib/oauth";

import type { Auth } from "./index";
import { UnauthorizedError } from "./errors";

export type McpAuth = Auth & { grant: Grant };

/** `last_used_at` is refreshed at most this often, so a read doesn't cost a write. */
const TOUCH_MS = 60_000;

/**
 * Auth for `/api/mcp`: `Authorization: Bearer sbk_…`. Revocation and expiry are checked on
 * every call. Group membership is checked per tool (`assertGroupMember`), also every call.
 * `getAuth` deliberately does not accept these tokens, so REST stays closed to agents.
 */
export async function getMcpAuth(req: Request): Promise<McpAuth> {
  const header = req.headers.get("authorization");
  const personal = parseBearerToken(header);
  const oauth = personal ? null : parseAccessToken(header);
  if (!personal && !oauth) throw new UnauthorizedError("missing or malformed bearer token");

  const now = new Date();
  const [row] = personal
    ? await db
        .select({ conn: mcpConnections, user: users })
        .from(mcpConnections)
        .innerJoin(users, eq(users.id, mcpConnections.userId))
        .where(eq(mcpConnections.tokenHash, hashToken(personal)))
    : await db
        .select({ conn: mcpConnections, user: users })
        .from(oauthTokens)
        .innerJoin(mcpConnections, eq(mcpConnections.id, oauthTokens.connectionId))
        .innerJoin(users, eq(users.id, mcpConnections.userId))
        .where(
          and(
            eq(oauthTokens.tokenHash, hashToken(oauth as string)),
            eq(oauthTokens.kind, "access"),
            gt(oauthTokens.expiresAt, now),
          ),
        );
  if (!row || row.conn.revokedAt || (row.conn.expiresAt && row.conn.expiresAt <= now)) {
    throw new UnauthorizedError("invalid, revoked or expired token");
  }

  const { conn } = row;
  if (!conn.lastUsedAt || now.getTime() - conn.lastUsedAt.getTime() > TOUCH_MS) {
    await db
      .update(mcpConnections)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(mcpConnections.id, conn.id),
          or(
            isNull(mcpConnections.lastUsedAt),
            lt(mcpConnections.lastUsedAt, sql`now() - interval '1 minute'`),
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

import crypto from "node:crypto";

import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  mcpConnections,
  oauthClients,
  oauthCodes,
  oauthTokens,
  type OauthClient,
} from "@/db/schema";
import { MAX_APP_CONNECTIONS } from "@/lib/mcp-connection-input";
import { BadRequestError } from "@/lib/auth/errors";
import { hashToken } from "@/lib/mcp-token";
import {
  type Access,
  ACCESS_TTL_MS,
  capAccess,
  CODE_TTL_MS,
  isAcceptableRedirectUri,
  isValidChallenge,
  MAX_REDIRECT_URIS,
  newAccessToken,
  newClientId,
  newClientSecret,
  newCode,
  newRefreshToken,
  parseScope,
  REFRESH_TTL_MS,
  sanitizeClientName,
  scopeOf,
  verifyPkce,
} from "@/lib/oauth";
import { mcpUrl } from "@/lib/oauth-http";

/**
 * Registered clients are capped, and ones nobody ever used are swept on every registration.
 * A real client registers and then sends the person to authorize within minutes, so one with
 * no connection and no live code after a day is abandoned. Sweeping that quickly (instead of
 * waiting for the cap) is what keeps throwaway registrations from filling the table.
 */
const MAX_CLIENTS = 50_000;
const UNUSED_CLIENT_HOURS = 24;

export type RegisteredClient = {
  clientId: string;
  clientSecret: string | null;
  name: string;
  redirectUris: string[];
  authMethod: "none" | "client_secret_post" | "client_secret_basic";
};

/** Dynamic client registration (RFC 7591). Public clients get no secret. */
export async function registerClient(body: unknown): Promise<RegisteredClient> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new BadRequestError(`redirect_uris: give 1 to ${MAX_REDIRECT_URIS} URIs`);
  }
  const redirectUris = [...new Set(uris.map((u) => (typeof u === "string" ? u : "")))];
  if (!redirectUris.every(isAcceptableRedirectUri)) {
    throw new BadRequestError("redirect_uris: https, loopback http or an app scheme only");
  }
  const method = b.token_endpoint_auth_method ?? "none";
  if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
    throw new BadRequestError("unsupported token_endpoint_auth_method");
  }
  const grants = b.grant_types;
  if (
    Array.isArray(grants) &&
    !grants.every((g) => g === "authorization_code" || g === "refresh_token")
  ) {
    throw new BadRequestError("only authorization_code and refresh_token are supported");
  }

  await sweepUnusedClients().catch((err) => console.error("[oauth] client sweep failed", err));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(oauthClients);
  if (n >= MAX_CLIENTS) throw new BadRequestError("registration is full, try later");

  const secret = method === "none" ? null : newClientSecret();
  const client = {
    clientId: newClientId(),
    clientSecretHash: secret ? hashToken(secret) : null,
    name: sanitizeClientName(b.client_name),
    redirectUris,
  };
  await db.insert(oauthClients).values(client);
  return {
    clientId: client.clientId,
    clientSecret: secret,
    name: client.name,
    redirectUris,
    authMethod: method,
  };
}

/** Clients that never produced a connection and have no live code are dead weight. */
async function sweepUnusedClients(): Promise<void> {
  await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, sql`now() - make_interval(hours => ${UNUSED_CLIENT_HOURS})`),
        sql`not exists (select 1 from ${mcpConnections} where ${mcpConnections.oauthClientId} = ${oauthClients.id})`,
        sql`not exists (select 1 from ${oauthCodes} where ${oauthCodes.clientId} = ${oauthClients.id} and ${oauthCodes.expiresAt} > now())`,
      ),
    );
}

export async function findClient(clientId: string | null): Promise<OauthClient | null> {
  if (!clientId || clientId.length > 64) return null;
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
  return row ?? null;
}

/** The client at the token endpoint: a secret is required exactly when one was issued. */
export async function authenticateClient(
  clientId: string | null,
  secret: string | null,
): Promise<OauthClient | null> {
  const client = await findClient(clientId);
  if (!client) return null;
  if (!client.clientSecretHash) return client;
  if (!secret) return null;
  const a = Buffer.from(hashToken(secret));
  const b = Buffer.from(client.clientSecretHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? client : null;
}

export type AuthorizeRequest = {
  client: OauthClient;
  redirectUri: string;
  requested: Access;
  state: string | null;
  challenge: string;
};

export type AuthorizeResult =
  | { ok: true; request: AuthorizeRequest }
  /** The client or redirect URI can't be trusted: show the error, never redirect. */
  | { ok: false; redirect: false; error: string; description: string }
  /** Safe to send back to the (registered) redirect URI. */
  | {
      ok: false;
      redirect: true;
      redirectUri: string;
      state: string | null;
      error: string;
      description: string;
    };

/** Checks an authorization request. Used by `/authorize` and again by the consent endpoint. */
export async function parseAuthorizeRequest(
  get: (key: string) => string | null | undefined,
): Promise<AuthorizeResult> {
  const fatal = (description: string): AuthorizeResult => ({
    ok: false,
    redirect: false,
    error: "invalid_request",
    description,
  });
  const client = await findClient(get("client_id") ?? null);
  if (!client) return fatal("unknown client_id");
  const redirectUri = get("redirect_uri");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return fatal("redirect_uri is not registered for this client");
  }
  const state = get("state") ?? null;
  const back = (error: string, description: string): AuthorizeResult => ({
    ok: false,
    redirect: true,
    redirectUri,
    state,
    error,
    description,
  });

  if (get("response_type") !== "code") {
    return back("unsupported_response_type", "response_type must be code");
  }
  const challenge = get("code_challenge");
  if (!challenge || !isValidChallenge(challenge) || get("code_challenge_method") !== "S256") {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const requested = parseScope(get("scope"));
  if (!requested) return back("invalid_scope", "unknown scope");
  const resource = get("resource");
  if (resource && resource.replace(/\/$/, "") !== mcpUrl()) {
    return back("invalid_target", "unknown resource");
  }
  return { ok: true, request: { client, redirectUri, requested, state, challenge } };
}

/** The URL a person is sent back to: the code, or an error, plus `state` and `iss`. */
export function redirectWith(
  redirectUri: string,
  issuerUrl: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  url.searchParams.set("iss", issuerUrl);
  return url.toString();
}

export type Approval = {
  access: Access;
  allGroups: boolean;
  groupIds: number[];
};

/** Stores what a signed-in person approved and returns the code to hand to the client. */
export async function createCode(
  req: AuthorizeRequest,
  userId: number,
  approval: Approval,
): Promise<string> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.userId, userId),
        isNull(mcpConnections.revokedAt),
        sql`${mcpConnections.oauthClientId} is distinct from ${req.client.id}`,
      ),
    );
  if (n >= MAX_APP_CONNECTIONS) {
    throw new BadRequestError(`at most ${MAX_APP_CONNECTIONS} active connections`);
  }
  const code = newCode();
  await db.insert(oauthCodes).values({
    codeHash: hashToken(code),
    clientId: req.client.id,
    userId,
    redirectUri: req.redirectUri,
    pkceChallenge: req.challenge,
    access: capAccess(req.requested, approval.access),
    allGroups: approval.allGroups,
    groupIds: approval.allGroups ? [] : approval.groupIds,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  // Spent and abandoned codes are only kept for the replay check; drop the old ones.
  await db
    .delete(oauthCodes)
    .where(lt(oauthCodes.expiresAt, sql`now() - interval '1 day'`))
    .catch(() => {});
  return code;
}

export class OauthGrantError extends Error {
  constructor(
    public readonly error: "invalid_grant" | "invalid_request" | "invalid_client",
    message: string,
  ) {
    super(message);
  }
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

/** Anything that can insert: the database, or the transaction a grant is issued in. */
type TokenWriter = Pick<typeof db, "insert">;

async function issueTokens(
  exec: TokenWriter,
  connectionId: number,
  access: Access,
): Promise<TokenResponse> {
  const accessToken = newAccessToken();
  const refreshToken = newRefreshToken();
  const now = Date.now();
  await exec.insert(oauthTokens).values([
    {
      connectionId,
      kind: "access",
      tokenHash: hashToken(accessToken),
      expiresAt: new Date(now + ACCESS_TTL_MS),
    },
    {
      connectionId,
      kind: "refresh",
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(now + REFRESH_TTL_MS),
    },
  ]);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scopeOf(access),
  };
}

/**
 * Drops tokens nobody will read again: expired ones, and spent refresh tokens once a replay
 * window of 7 days is over. A spent token must outlive the refresh that spent it; deleting it
 * right away would turn a replay into "unknown token", and the connection would never be
 * revoked for it. Housekeeping only, so it runs after the grant is committed and may fail.
 */
async function sweepTokens(connectionId: number): Promise<void> {
  await db
    .delete(oauthTokens)
    .where(
      and(
        eq(oauthTokens.connectionId, connectionId),
        sql`(${oauthTokens.expiresAt} < now() or ${oauthTokens.usedAt} < now() - interval '7 days')`,
      ),
    )
    .catch(() => {});
}

async function revokeConnection(connectionId: number): Promise<void> {
  await db
    .update(mcpConnections)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpConnections.id, connectionId), isNull(mcpConnections.revokedAt)));
}

/** `grant_type=authorization_code`. The code is claimed first, so it can be used only once. */
export async function exchangeCode(
  client: OauthClient,
  args: { code: string | null; redirectUri: string | null; verifier: string | null },
): Promise<TokenResponse> {
  if (!args.code || !args.verifier)
    throw new OauthGrantError("invalid_request", "code and code_verifier are required");
  const [row] = await db
    .select()
    .from(oauthCodes)
    .where(and(eq(oauthCodes.codeHash, hashToken(args.code)), eq(oauthCodes.clientId, client.id)));
  if (!row) throw new OauthGrantError("invalid_grant", "unknown or expired code");
  if (row.usedAt) {
    // A replayed code means it leaked; what it produced stops working.
    if (row.connectionId) await revokeConnection(row.connectionId);
    throw new OauthGrantError("invalid_grant", "code already used");
  }
  const claimed = await db
    .update(oauthCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(oauthCodes.id, row.id),
        isNull(oauthCodes.usedAt),
        gt(oauthCodes.expiresAt, new Date()),
      ),
    )
    .returning({ id: oauthCodes.id });
  if (claimed.length === 0) throw new OauthGrantError("invalid_grant", "unknown or expired code");
  if (args.redirectUri !== row.redirectUri) {
    throw new OauthGrantError("invalid_grant", "redirect_uri does not match the request");
  }
  if (!verifyPkce(args.verifier, row.pkceChallenge)) {
    throw new OauthGrantError("invalid_grant", "code_verifier does not match");
  }

  // One transaction: revoking the earlier connection, creating the new one and its tokens
  // stand or fall together, so a failure can't leave the person with no working connection.
  const access: Access = row.access === "write" ? "write" : "read";
  const { connectionId, tokens } = await db.transaction(async (tx) => {
    // Authorizing the same client again replaces its earlier connection instead of piling up.
    await tx
      .update(mcpConnections)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(mcpConnections.userId, row.userId),
          eq(mcpConnections.oauthClientId, client.id),
          isNull(mcpConnections.revokedAt),
        ),
      );
    const [conn] = await tx
      .insert(mcpConnections)
      .values({
        userId: row.userId,
        kind: "oauth",
        name: client.name,
        tokenHash: null,
        tokenPrefix: "OAuth",
        oauthClientId: client.id,
        access,
        allGroups: row.allGroups,
        groupIds: row.groupIds,
      })
      .returning({ id: mcpConnections.id });
    await tx.update(oauthCodes).set({ connectionId: conn.id }).where(eq(oauthCodes.id, row.id));
    return { connectionId: conn.id, tokens: await issueTokens(tx, conn.id, access) };
  });
  await sweepTokens(connectionId);
  return tokens;
}

/** `grant_type=refresh_token`. Rotates: the old refresh token dies, a reused one revokes all. */
export async function refreshTokens(
  client: OauthClient,
  refreshToken: string | null,
): Promise<TokenResponse> {
  if (!refreshToken) throw new OauthGrantError("invalid_request", "refresh_token is required");
  const [row] = await db
    .select({ token: oauthTokens, conn: mcpConnections })
    .from(oauthTokens)
    .innerJoin(mcpConnections, eq(mcpConnections.id, oauthTokens.connectionId))
    .where(
      and(eq(oauthTokens.tokenHash, hashToken(refreshToken)), eq(oauthTokens.kind, "refresh")),
    );
  if (!row || row.conn.oauthClientId !== client.id || row.conn.revokedAt) {
    throw new OauthGrantError("invalid_grant", "unknown or revoked refresh token");
  }
  if (row.token.usedAt) {
    await revokeConnection(row.conn.id);
    throw new OauthGrantError("invalid_grant", "refresh token already used");
  }
  // Claiming the old token and issuing the new ones commit together: if issuing fails, the
  // client still holds a refresh token that works.
  const tokens = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(oauthTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(oauthTokens.id, row.token.id),
          isNull(oauthTokens.usedAt),
          gt(oauthTokens.expiresAt, new Date()),
        ),
      )
      .returning({ id: oauthTokens.id });
    if (claimed.length === 0) throw new OauthGrantError("invalid_grant", "refresh token expired");
    return issueTokens(tx, row.conn.id, row.conn.access === "write" ? "write" : "read");
  });
  await sweepTokens(row.conn.id);
  return tokens;
}

/** RFC 7009: revokes the connection a presented token belongs to. Unknown tokens are fine. */
export async function revokeByToken(client: OauthClient, token: string): Promise<void> {
  const [row] = await db
    .select({ connectionId: oauthTokens.connectionId, clientId: mcpConnections.oauthClientId })
    .from(oauthTokens)
    .innerJoin(mcpConnections, eq(mcpConnections.id, oauthTokens.connectionId))
    .where(eq(oauthTokens.tokenHash, hashToken(token)));
  if (row && row.clientId === client.id) await revokeConnection(row.connectionId);
}

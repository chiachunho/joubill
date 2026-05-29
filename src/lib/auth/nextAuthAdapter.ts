import { and, eq } from "drizzle-orm";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";

import { db } from "@/db";
import { authIdentities, sessions, users } from "@/db/schema";
import type { User } from "@/db/schema";

function toAdapterUser(user: User): AdapterUser {
  return {
    id: String(user.id),
    email: user.email ?? "",
    emailVerified: null,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    image: user.avatarUrl ?? null,
  };
}

function toAdapterSession(row: {
  id: string;
  userId: number;
  expiresAt: Date;
}): AdapterSession {
  return {
    sessionToken: row.id,
    userId: String(row.userId),
    expires: row.expiresAt,
  };
}

/**
 * Auth.js adapter that maps our integer-keyed schema to the string-keyed
 * AdapterUser / AdapterAccount / AdapterSession interfaces.
 *
 * id mapping: users.id (integer) ↔ AdapterUser.id (string) via String() / Number()
 * session mapping: sessions.id ↔ sessionToken; sessions.expiresAt ↔ expires
 * account mapping: auth_identities.providerUid ↔ providerAccountId
 */
export const splitbillAdapter: Adapter = {
  async createUser(data) {
    const parts = data.name?.split(" ") ?? [];
    const [user] = await db
      .insert(users)
      .values({
        firstName: parts[0] || data.email.split("@")[0],
        lastName: parts.slice(1).join(" ") || null,
        email: data.email,
        avatarUrl: data.image ?? null,
      })
      .returning();
    return toAdapterUser(user);
  },

  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, Number(id)));
    return user ? toAdapterUser(user) : null;
  },

  async getUserByEmail(email) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user ? toAdapterUser(user) : null;
  },

  async getUserByAccount({ provider, providerAccountId }) {
    const [row] = await db
      .select({ user: users })
      .from(authIdentities)
      .innerJoin(users, eq(users.id, authIdentities.userId))
      .where(
        and(
          eq(authIdentities.provider, provider),
          eq(authIdentities.providerUid, providerAccountId),
        ),
      );
    return row ? toAdapterUser(row.user) : null;
  },

  async updateUser({ id, ...data }) {
    const parts = data.name?.split(" ") ?? [];
    const [user] = await db
      .update(users)
      .set({
        ...(data.name != null && {
          firstName: parts[0] || undefined,
          lastName: parts.slice(1).join(" ") || null,
        }),
        ...(data.email != null && { email: data.email }),
        ...(data.image !== undefined && { avatarUrl: data.image }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, Number(id)))
      .returning();
    return toAdapterUser(user);
  },

  async linkAccount(account: AdapterAccount) {
    await db
      .insert(authIdentities)
      .values({
        userId: Number(account.userId),
        provider: account.provider,
        providerUid: account.providerAccountId,
        accessToken: account.access_token ?? null,
        refreshToken: account.refresh_token ?? null,
        expiresAt: account.expires_at ?? null,
        tokenType: account.token_type ?? null,
        scope: account.scope ?? null,
        idToken: account.id_token ?? null,
      })
      .onConflictDoNothing();
  },

  async createSession({ sessionToken, userId, expires }) {
    const [row] = await db
      .insert(sessions)
      .values({ id: sessionToken, userId: Number(userId), expiresAt: expires })
      .returning();
    return toAdapterSession(row);
  },

  async getSessionAndUser(sessionToken) {
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionToken));
    if (!row) return null;
    return { session: toAdapterSession(row.session), user: toAdapterUser(row.user) };
  },

  async updateSession({ sessionToken, expires }) {
    if (!expires) return null;
    const [row] = await db
      .update(sessions)
      .set({ expiresAt: expires })
      .where(eq(sessions.id, sessionToken))
      .returning();
    return row ? toAdapterSession(row) : null;
  },

  async deleteSession(sessionToken) {
    await db.delete(sessions).where(eq(sessions.id, sessionToken));
  },

  async deleteUser(id) {
    await db.delete(users).where(eq(users.id, Number(id)));
  },

  async unlinkAccount({ provider, providerAccountId }) {
    await db
      .delete(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, provider),
          eq(authIdentities.providerUid, providerAccountId),
        ),
      );
  },
};

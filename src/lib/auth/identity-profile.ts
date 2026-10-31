import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { authIdentities, users } from "@/db/schema";
import { identityProfile } from "@/lib/profile";

/**
 * Records the name and picture a login supplied, after every successful Auth.js sign-in or
 * link through it (`events.signIn` in `src/auth.ts`).
 *
 * Each login method keeps its own copy (`auth_identities.name` / `picture_url`), so the settings
 * page can offer any of them as the avatar and a provider's expiring picture URL is renewed each
 * time the person signs in with it. `users.avatar_url` is only filled when empty: an account that
 * had no picture gets one from the first login that has, and one that had a picture keeps it.
 *
 * Errors are swallowed: a failed refresh must never fail the sign-in itself.
 */
export async function syncIdentityProfile(
  userId: number,
  provider: string,
  providerUid: string,
  rawProfile: Record<string, unknown> | undefined | null,
): Promise<void> {
  const { name, pictureUrl } = identityProfile(provider, rawProfile);
  if (name === null && pictureUrl === null) return;
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(authIdentities)
        .set({
          ...(name !== null && { name }),
          ...(pictureUrl !== null && { pictureUrl }),
        })
        .where(
          and(
            eq(authIdentities.userId, userId),
            eq(authIdentities.provider, provider),
            eq(authIdentities.providerUid, providerUid),
          ),
        );
      if (pictureUrl !== null) {
        await tx
          .update(users)
          .set({ avatarUrl: pictureUrl, updatedAt: new Date() })
          .where(and(eq(users.id, userId), isNull(users.avatarUrl)));
      }
    });
  } catch (err) {
    console.error("syncIdentityProfile failed", { userId, provider, err });
  }
}

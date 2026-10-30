import { inArray } from "drizzle-orm";
import { Api } from "grammy";

import { db } from "@/db";
import { authIdentities, users } from "@/db/schema";
import { serverEnv } from "@/lib/env";
import { avatarOptions, pickAvatar, type AvatarCandidate } from "@/lib/profile";

/**
 * Server side of avatar selection (issue #101): loads what `pickAvatar` needs and calls it, so
 * `/api/me/profile` and `/api/groups/[id]/avatars` can't pick a person's picture differently.
 *
 * Only the Telegram lookup is cached (two bot API calls per person), keyed by Telegram id. The
 * choice itself is made fresh on every request, so changing `avatar_source` shows at once; a
 * cache of finished answers would keep the old picture for hours on whichever instance held it.
 */

type CacheEntry = { url: string | null; expires: number };
const telegramCache = new Map<number, CacheEntry>();
const TTL = 4 * 60 * 60 * 1000;

let api: Api | null = null;
export function botApi(): Api {
  api ??= new Api(serverEnv().TELEGRAM_BOT_TOKEN);
  return api;
}

export async function telegramFileUrl(fileId: string): Promise<string | null> {
  try {
    const file = await botApi().getFile(fileId);
    if (!file.file_path) return null;
    return `/api/tg-photo?path=${encodeURIComponent(file.file_path)}`;
  } catch {
    return null;
  }
}

/** The person's current Telegram profile photo through the bot, or null when they have none. */
export async function telegramPhotoUrl(telegramId: number): Promise<string | null> {
  const hit = telegramCache.get(telegramId);
  if (hit && hit.expires > Date.now()) return hit.url;
  let url: string | null = null;
  try {
    const photos = await botApi().getUserProfilePhotos(telegramId, { limit: 1 });
    const fileId = photos.total_count ? photos.photos[0]?.[0]?.file_id : undefined;
    url = fileId ? await telegramFileUrl(fileId) : null;
  } catch {
    // A transient failure is not "no photo": don't cache it, so the next request retries.
    return null;
  }
  telegramCache.set(telegramId, { url, expires: Date.now() + TTL });
  return url;
}

export type AvatarUser = {
  id: number;
  telegramId: number | null;
  avatarUrl: string | null;
  avatarSource: string | null;
};

export type ResolvedAvatar = { photoUrl: string | null; options: AvatarCandidate[] };

/** Every given user's picture and the pictures they could choose from, in one identities query. */
export async function resolveAvatars(people: AvatarUser[]): Promise<Map<number, ResolvedAvatar>> {
  const out = new Map<number, ResolvedAvatar>();
  if (people.length === 0) return out;

  const identityRows = await db
    .select({
      userId: authIdentities.userId,
      provider: authIdentities.provider,
      pictureUrl: authIdentities.pictureUrl,
    })
    .from(authIdentities)
    .where(
      inArray(
        authIdentities.userId,
        people.map((p) => p.id),
      ),
    );

  await Promise.all(
    people.map(async (p) => {
      const telegramPhoto = p.telegramId ? await telegramPhotoUrl(p.telegramId) : null;
      const identities = identityRows.filter((r) => r.userId === p.id && r.provider !== "telegram");
      out.set(p.id, {
        photoUrl: pickAvatar({
          source: p.avatarSource,
          telegramPhoto,
          identities,
          legacyAvatarUrl: p.avatarUrl,
        }),
        options: avatarOptions({ telegramPhoto, identities }),
      });
    }),
  );
  return out;
}

/** The columns `resolveAvatars` needs, for a select over `users`. */
export const AVATAR_COLUMNS = {
  id: users.id,
  telegramId: users.telegramId,
  avatarUrl: users.avatarUrl,
  avatarSource: users.avatarSource,
} as const;

import { inArray } from "drizzle-orm";
import { Api } from "grammy";

import { db } from "@/db";
import { authIdentities, users } from "@/db/schema";
import { serverEnv } from "@/lib/env";
import { pathPhotoUrl } from "@/lib/tg-photo-sign";
import { avatarOptions, pickAvatar, type AvatarCandidate, type AvatarInput } from "@/lib/profile";

/**
 * Server side of avatar selection (issue #101): loads what `pickAvatar` needs and calls it, so
 * `/api/me/profile` and `/api/groups/[id]/avatars` can't pick a person's picture differently.
 *
 * Only the Telegram lookup is cached (two bot API calls per person), keyed by Telegram id. The
 * choice itself is made fresh on every request, so changing `avatar_source` shows at once; a
 * cache of finished answers would keep the old picture for hours on whichever instance held it.
 */

const TTL = 4 * 60 * 60 * 1000;

/**
 * A per-instance cache that can't grow without bound: an expired entry is dropped when read,
 * and once `max` is reached the expired ones are swept and then the oldest go first (a Map
 * iterates in insertion order).
 */
export class TtlCache<K, V> {
  private entries = new Map<K, { value: V; expires: number }>();
  constructor(
    private ttl: number,
    private max = 5000,
  ) {}

  get(key: K): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires > Date.now()) return hit.value;
    this.entries.delete(key);
    return undefined;
  }

  set(key: K, value: V): void {
    const now = Date.now();
    this.entries.delete(key);
    if (this.entries.size >= this.max) {
      // Only when full, so a busy request doesn't pay a full scan per entry it caches.
      for (const [k, e] of this.entries) if (e.expires <= now) this.entries.delete(k);
      while (this.entries.size >= this.max) {
        this.entries.delete(this.entries.keys().next().value as K);
      }
    }
    this.entries.set(key, { value, expires: now + this.ttl });
  }

  get size(): number {
    return this.entries.size;
  }
}

const telegramCache = new TtlCache<number, string | null>(TTL);

let api: Api | null = null;
export function botApi(): Api {
  api ??= new Api(serverEnv().TELEGRAM_BOT_TOKEN);
  return api;
}

/** The proxy URL for a Telegram file. Throws when the bot API call fails. */
async function fileUrlOrThrow(fileId: string): Promise<string | null> {
  const file = await botApi().getFile(fileId);
  return file.file_path ? pathPhotoUrl(file.file_path) : null;
}

export async function telegramFileUrl(fileId: string): Promise<string | null> {
  try {
    return await fileUrlOrThrow(fileId);
  } catch {
    return null;
  }
}

/** The person's current Telegram profile photo through the bot, or null when they have none. */
export async function telegramPhotoUrl(telegramId: number): Promise<string | null> {
  const hit = telegramCache.get(telegramId);
  if (hit !== undefined) return hit;
  let url: string | null = null;
  try {
    const photos = await botApi().getUserProfilePhotos(telegramId, { limit: 1 });
    const fileId = photos.total_count ? photos.photos[0]?.[0]?.file_id : undefined;
    url = fileId ? await fileUrlOrThrow(fileId) : null;
  } catch {
    // A transient failure is not "no photo": don't cache it, so the next request retries.
    return null;
  }
  telegramCache.set(telegramId, url);
  return url;
}

export type AvatarUser = {
  id: number;
  telegramId: number | null;
  avatarUrl: string | null;
  avatarSource: string | null;
};

export type ResolvedAvatar = { photoUrl: string | null; options: AvatarCandidate[] };

/** What `pickAvatar` needs, apart from the chosen source. */
export type AvatarInputs = Omit<AvatarInput, "source">;

/**
 * Every given user's pictures, in one identities query. Telegram's is the live bot photo, else
 * the one Telegram last supplied (initData or a Telegram sign-in), which covers a person the bot
 * can't fetch: it has never seen them, or their privacy settings hide the photo from bots.
 */
export async function loadAvatarInputs(people: AvatarUser[]): Promise<Map<number, AvatarInputs>> {
  const out = new Map<number, AvatarInputs>();
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
      const own = identityRows.filter((r) => r.userId === p.id);
      const storedTelegram = own.find((r) => r.provider === "telegram")?.pictureUrl ?? null;
      const liveTelegram = p.telegramId ? await telegramPhotoUrl(p.telegramId) : null;
      out.set(p.id, {
        telegramPhoto: liveTelegram ?? storedTelegram,
        identities: own.filter((r) => r.provider !== "telegram"),
        legacyAvatarUrl: p.avatarUrl,
      });
    }),
  );
  return out;
}

export function resolveAvatar(inputs: AvatarInputs, source: string | null): ResolvedAvatar {
  return { photoUrl: pickAvatar({ ...inputs, source }), options: avatarOptions(inputs) };
}

/** Every given user's picture and the pictures they could choose from. */
export async function resolveAvatars(people: AvatarUser[]): Promise<Map<number, ResolvedAvatar>> {
  const inputs = await loadAvatarInputs(people);
  const out = new Map<number, ResolvedAvatar>();
  for (const p of people) {
    const i = inputs.get(p.id);
    if (i) out.set(p.id, resolveAvatar(i, p.avatarSource));
  }
  return out;
}

/** The columns `resolveAvatars` needs, for a select over `users`. */
export const AVATAR_COLUMNS = {
  id: users.id,
  telegramId: users.telegramId,
  avatarUrl: users.avatarUrl,
  avatarSource: users.avatarSource,
} as const;

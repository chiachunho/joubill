import { sql } from "drizzle-orm";

import { db } from "@/db";
import { authIdentities, users } from "@/db/schema";
import type { User } from "@/db/schema";

interface TelegramUserData {
  id: number;
  first_name: string;
  last_name?: string | null;
  username?: string | null;
  language_code?: string | null;
  photo_url?: string | null;
}

/**
 * Upsert a Telegram user into `users` (by telegramId) and ensure a matching
 * `auth_identities` row exists. All bot write points and Mini App auth use this
 * so the identity table stays in sync automatically.
 *
 * Runs on nearly every request, so it must only touch what Telegram owns: the
 * provider name in `first_name` / `last_name`, never `display_name` (the person's
 * own choice, issue #101). `avatar_url` is only replaced by a real photo: a bot
 * update carries none, and writing NULL there used to erase the picture a Google
 * or LINE sign-in had supplied.
 */
export async function upsertTelegramUser(tgUser: TelegramUserData): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      telegramId: tgUser.id,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name ?? null,
      username: tgUser.username?.toLowerCase() ?? null,
      languageCode: tgUser.language_code ?? null,
      avatarUrl: tgUser.photo_url ?? null,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        firstName: tgUser.first_name,
        lastName: tgUser.last_name ?? null,
        username: tgUser.username?.toLowerCase() ?? null,
        languageCode: tgUser.language_code ?? null,
        avatarUrl: sql`coalesce(${tgUser.photo_url ?? null}, ${users.avatarUrl})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || null;
  await db
    .insert(authIdentities)
    .values({
      userId: user.id,
      provider: "telegram",
      providerUid: String(tgUser.id),
      name,
      pictureUrl: tgUser.photo_url ?? null,
    })
    // Keyed on the identity, not the user: the row may belong to whoever owns this Telegram id.
    .onConflictDoUpdate({
      target: [authIdentities.provider, authIdentities.providerUid],
      set: {
        name,
        pictureUrl: sql`coalesce(${tgUser.photo_url ?? null}, ${authIdentities.pictureUrl})`,
      },
      // Every bot update lands here; skip the write when nothing changed.
      setWhere: sql`${authIdentities.name} is distinct from excluded.name
        or (excluded.picture_url is not null
          and ${authIdentities.pictureUrl} is distinct from excluded.picture_url)`,
    });

  return user;
}

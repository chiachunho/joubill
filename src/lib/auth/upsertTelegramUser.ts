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
        avatarUrl: tgUser.photo_url ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  await db
    .insert(authIdentities)
    .values({
      userId: user.id,
      provider: "telegram",
      providerUid: String(tgUser.id),
    })
    .onConflictDoNothing();

  return user;
}

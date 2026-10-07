import { Composer } from "grammy";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";

import type { BotContext } from "../context";

/**
 * On every update:
 *  1. Upsert the sender into users + auth_identities.
 *  2. If the chat is a group / supergroup, upsert groups and add the sender to group_members.
 *  3. Attach the resulting rows to ctx.dbUser / ctx.dbGroup for downstream handlers.
 *
 * Step 2 treats "the sender did something in this group" as proof of membership,
 * which holds for messages and callback queries but NOT for `chat_member`: there
 * `ctx.from` is whoever *caused* a status change, so a lurker who never spoke
 * would be seated the moment they leave, and an admin would be seated for
 * kicking a spammer. Neither is participation, and a spurious `group_members`
 * row silently enlarges every equal split. trackMembership's `chat_member`
 * handler registers the right person (the target, and only on a join).
 */
export const registerUser = new Composer<BotContext>();

registerUser.use(async (ctx, next) => {
  if (!ctx.from) {
    await next();
    return;
  }

  const user = await upsertTelegramUser(ctx.from);

  ctx.dbUser = user;

  if (ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
    const [group] = await db
      .insert(groups)
      .values({
        platform: "telegram",
        externalChatId: String(ctx.chat.id),
        title: ctx.chat.title,
      })
      .onConflictDoUpdate({
        target: [groups.platform, groups.externalChatId],
        set: { title: ctx.chat.title, updatedAt: new Date() },
      })
      .returning();

    ctx.dbGroup = group;

    // The groups row is still upserted above regardless — trackMembership's
    // chat_member handler needs ctx.dbGroup set to do its own work.
    if (ctx.update.chat_member === undefined) {
      await db
        .insert(groupMembers)
        .values({ groupId: group.id, userId: user.id })
        .onConflictDoNothing();
    }
  }

  await next();
});

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
        telegramChatId: ctx.chat.id,
        title: ctx.chat.title,
      })
      .onConflictDoUpdate({
        target: groups.telegramChatId,
        set: { title: ctx.chat.title, updatedAt: new Date() },
      })
      .returning();

    ctx.dbGroup = group;

    await db
      .insert(groupMembers)
      .values({ groupId: group.id, userId: user.id })
      .onConflictDoNothing();
  }

  await next();
});

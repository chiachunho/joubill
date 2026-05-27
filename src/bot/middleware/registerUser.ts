import { Composer } from "grammy";

import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";

import type { BotContext } from "../context";

/**
 * 每收到一個 update：
 *  1. upsert 觸發者到 users
 *  2. 若是 group / supergroup chat，upsert groups + 把人加進 group_members
 *  3. 把寫回的 row 塞到 ctx.dbUser / ctx.dbGroup 給下游 handler 用
 */
export const registerUser = new Composer<BotContext>();

registerUser.use(async (ctx, next) => {
  if (!ctx.from) {
    await next();
    return;
  }

  const [user] = await db
    .insert(users)
    .values({
      telegramId: ctx.from.id,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      username: ctx.from.username,
      languageCode: ctx.from.language_code,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
        languageCode: ctx.from.language_code,
        updatedAt: new Date(),
      },
    })
    .returning();

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

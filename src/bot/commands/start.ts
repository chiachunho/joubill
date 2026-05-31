import { Composer, InlineKeyboard } from "grammy";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { clientEnv, serverEnv } from "@/lib/env";
import { eq } from "drizzle-orm";

import type { BotContext } from "../context";

export const startCommand = new Composer<BotContext>();

startCommand.command("start", async (ctx) => {
  const param = ctx.match;

  // Deep-link group join: /start join_<telegramChatId>
  if (typeof param === "string" && param.startsWith("join_")) {
    const chatId = Number(param.slice("join_".length));
    if (!isNaN(chatId) && chatId !== 0) {
      await handleGroupJoin(ctx, chatId);
      return;
    }
  }

  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  if (isGroup) {
    // Telegram restriction: the web_app inline-button type is private-chat only.
    // In groups we instead use a url button pointing to the BotFather-registered
    // direct-link Mini App (t.me/<bot>/<app>); Telegram clients auto-launch it as
    // a Mini App. The startapp value is delivered as start_param inside initData,
    // which C5 reads on the Mini App side.
    const botUsername = ctx.me.username;
    const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
    const startParam = `group_${ctx.chat.id}`;
    const miniAppLink = `https://t.me/${botUsername}/${appName}?startapp=${startParam}`;

    const name = ctx.from?.first_name ?? "";
    const greeting =
      `嗨 ${name}！揪帳幫這個群組記帳分帳。\n` +
      `/add 記第一筆，/help 看指令，或開啟 App 看明細。`;
    const keyboard = new InlineKeyboard().url("開啟揪帳", miniAppLink);
    await ctx.reply(greeting, { reply_markup: keyboard });
    return;
  }

  // Private chat: the web_app button can launch the Mini App directly.
  const name = ctx.from?.first_name ?? "";
  const greeting =
    `嗨 ${name}！把我加進群組就能開始分帳。\n` +
    `點下面開啟 App，或輸入 /help 看怎麼用。`;
  const keyboard = new InlineKeyboard().webApp(
    "開啟揪帳",
    clientEnv.NEXT_PUBLIC_MINI_APP_URL,
  );
  await ctx.reply(greeting, { reply_markup: keyboard });
});

async function handleGroupJoin(ctx: BotContext, telegramChatId: number) {
  const from = ctx.from!;

  // Verify the user is actually a member of that Telegram group before
  // writing to DB — prevents anyone with the link from injecting fake members.
  let member;
  try {
    member = await ctx.api.getChatMember(telegramChatId, from.id);
  } catch {
    await ctx.reply("找不到這個群組，連結可能已過期或 Bot 尚未加入該群組。");
    return;
  }

  if (member.status === "left" || member.status === "kicked") {
    await ctx.reply("你不是這個群組的成員，無法加入揪帳。");
    return;
  }

  const group = await db.query.groups.findFirst({
    where: eq(groups.telegramChatId, telegramChatId),
  });

  if (!group) {
    await ctx.reply("找不到這個群組的帳目，請確認 Bot 已加入群組並發過訊息。");
    return;
  }

  const user = await upsertTelegramUser(from);
  await db.insert(groupMembers).values({ groupId: group.id, userId: user.id }).onConflictDoNothing();

  await ctx.reply(`✅ 已加入「${group.title}」的揪帳！`);
}

import { Composer } from "grammy";

import { TOAST } from "@/lib/buttons";

import { balanceView, myBalancesView, parseSettleCallback, settleView } from "../groupViews";
import { groupForButton, pickCallback, replyNoGroups } from "../groupPicker";
import { memberGroups } from "../myGroups";
import type { BotContext } from "../context";

export const balanceCommand = new Composer<BotContext>();

balanceCommand.command("balance", async (ctx) => {
  const inPrivate = ctx.chat.type === "private";
  const target = { botUsername: ctx.me.username, inPrivate };

  if (ctx.dbGroup) {
    const view = await balanceView(ctx.dbGroup, target);
    await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.reply_markup });
    return;
  }
  if (!inPrivate || !ctx.dbUser) return;

  // In a private chat there is no group to ask about, so it answers for all of them at
  // once — the one thing a group's own /balance can't show.
  const groups = await memberGroups(ctx.dbUser.id);
  if (groups.length === 0) {
    await replyNoGroups(ctx);
    return;
  }
  const view =
    groups.length === 1
      ? await balanceView(groups[0], target)
      : await myBalancesView(ctx.dbUser.id, groups, (id) => pickCallback("balance", id));
  await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.reply_markup });
});

/** 怎麼還 under a balance: answers with the group's /settle, keeping the balance on screen. */
balanceCommand.callbackQuery(/^settle:/, async (ctx) => {
  const groupId = parseSettleCallback(ctx.callbackQuery.data);
  const group = groupId === null ? null : await groupForButton(ctx, groupId);
  if (!group) {
    await ctx.answerCallbackQuery({ text: TOAST.staleButton, show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  const view = await settleView(group, {
    botUsername: ctx.me.username,
    inPrivate: ctx.chat?.type === "private",
  });
  await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.reply_markup });
});

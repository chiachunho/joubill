import { Composer, type InlineKeyboard } from "grammy";

import { TOAST } from "@/lib/buttons";
import { ADD_USAGE, parseAddMessage } from "@/lib/parseAdd";

import { balanceView, listView, settleView } from "../groupViews";
import { parsePickCallback, quotedTitle } from "../groupPicker";
import { pickedGroup } from "../myGroups";
import type { BotContext } from "../context";
import { sendExport } from "./export";
import { handleAddParsed } from "./add";

/**
 * The group picked for a command typed in a private chat (see `groupPicker.ts`). The picker
 * message is replaced by the answer, so the chat doesn't keep a stale set of buttons.
 */
export const privatePick = new Composer<BotContext>();

privatePick.callbackQuery(/^pick:/, async (ctx) => {
  const pick = parsePickCallback(ctx.callbackQuery.data);
  const group =
    pick && ctx.dbUser && ctx.chat?.type === "private"
      ? await pickedGroup(ctx.dbUser.id, pick.groupId)
      : null;
  if (!pick || !group) {
    await ctx.answerCallbackQuery({ text: TOAST.staleButton, show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  const target = { botUsername: ctx.me.username, inPrivate: true };
  const edit = (text: string, reply_markup?: InlineKeyboard) =>
    ctx.editMessageText(text, { parse_mode: "HTML", reply_markup }).catch(() => undefined);

  switch (pick.kind) {
    case "list":
    case "balance":
    case "settle": {
      const view = await { list: listView, balance: balanceView, settle: settleView }[pick.kind](
        group,
        target,
      );
      await edit(view.text, view.reply_markup);
      return;
    }
    case "export":
      await edit(`📄 匯出${quotedTitle(group)}`);
      await sendExport(ctx, group);
      return;
    case "add": {
      // The picker replied to the /add, so the command is read back from there rather
      // than stored anywhere.
      const original = ctx.callbackQuery.message?.reply_to_message;
      let parsed;
      try {
        parsed = parseAddMessage(original?.text ?? "", original?.entities ?? []);
      } catch {
        await edit(ADD_USAGE);
        return;
      }
      await ctx.deleteMessage().catch(() => undefined);
      await handleAddParsed(ctx as Parameters<typeof handleAddParsed>[0], parsed, [], { group });
      return;
    }
  }
});

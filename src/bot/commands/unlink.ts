import { Composer, InlineKeyboard } from "grammy";

import { BTN, TOAST } from "@/lib/buttons";
import { telegramChatId } from "@/lib/chat";
import { chatTitleOf, leaveUnlinkedChat, UNLINK_FAREWELL, unlinkChat } from "@/lib/group-chat";
import { logChatUnlinked } from "@/lib/record-mutation";

import { actorOf } from "../actor";
import type { BotContext } from "../context";
import { escapeHtml } from "../format";

export const unlinkCommand = new Composer<BotContext>();

/**
 * How long a prompt stays live. The bot leaves the chat, so a prompt nobody pressed must not
 * remain a loaded button for days: a later tap would detach a group (possibly one re-linked here
 * since) on a decision made long ago.
 */
export const UNLINK_PROMPT_TTL_SECONDS = 10 * 60;

/**
 * `/unlink` never acts on its own: a mistyped command in a chat must not detach a group and make
 * the bot leave. It only posts this prompt, and the buttons do the work.
 *
 * The group id rides in the callback data and is checked against `ctx.dbGroup`, the bot-side
 * counterpart of the REST layer's `assertGroupMember`. `registerUser` has already seated whoever
 * tapped as a member of the chat's group, so group membership is the gate, as for every setting.
 */
unlinkCommand.command("unlink", async (ctx) => {
  const group = ctx.dbGroup;
  if (!group || telegramChatId(group) === null) {
    await ctx.reply("這個指令只能在已綁定的群組裡使用。");
    return;
  }

  const title = await chatTitleOf(group.id);
  await ctx.reply(
    `確定要解除「${escapeHtml(title || "這個群組")}」與 App 的綁定嗎？\n` +
      "帳目、成員和邀請碼都會保留在 App 裡，但這個聊天室不會再出現新的卡片，bot 也會離開。\n" +
      "要重新綁定，得先把 bot 加回聊天室，再輸入 <code>/link 邀請碼</code>。\n" +
      "如果想在這個聊天室重新開始記帳，把 bot 加回來就會建立一個新的群組。",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text(BTN.confirmUnlink, `unlink:yes:${group.id}`)
        .text(BTN.cancelUnlink, "unlink:no"),
    },
  );
});

unlinkCommand.callbackQuery("unlink:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("已取消，沒有解除綁定。").catch(() => null);
});

unlinkCommand.callbackQuery(/^unlink:yes:(\d+)$/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  if (!ctx.dbUser || !ctx.dbGroup) {
    await ctx.answerCallbackQuery({ text: "無法識別使用者", show_alert: true });
    return;
  }
  // An old prompt, or one from another chat, names a group this chat no longer is.
  if (ctx.dbGroup.id !== groupId) {
    await ctx.answerCallbackQuery({ text: "這個群組已經不是綁定在這個聊天室了", show_alert: true });
    await ctx.editMessageText("這個確認已失效。").catch(() => null);
    return;
  }

  const promptDate = ctx.callbackQuery.message?.date ?? 0;
  if (Date.now() / 1000 - promptDate > UNLINK_PROMPT_TTL_SECONDS) {
    await ctx.answerCallbackQuery({ text: "這個確認已過期，請重新輸入 /unlink", show_alert: true });
    await ctx.editMessageText("這個確認已過期。").catch(() => null);
    return;
  }

  // Always answer the callback query, so a database error can't leave the button spinning.
  let outcome: Awaited<ReturnType<typeof unlinkChat>>;
  try {
    // Read first: once the chat is cleared the group no longer remembers what it was called.
    const title = await chatTitleOf(groupId);
    outcome = await unlinkChat(groupId);
    if (outcome.ok) await logChatUnlinked(groupId, actorOf(ctx), title);
  } catch (err) {
    console.error("[unlink] failed:", err);
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true }).catch(() => null);
    return;
  }

  if (!outcome.ok) {
    // Another member confirmed first.
    await ctx.answerCallbackQuery({ text: "已經解除綁定了" });
    await ctx.editMessageText("這個群組已經解除綁定了。").catch(() => null);
    return;
  }

  await ctx.answerCallbackQuery({ text: "已解除綁定" });
  await leaveUnlinkedChat(ctx.api, outcome.target, async () => {
    await ctx.editMessageText(UNLINK_FAREWELL);
    return true;
  });
});

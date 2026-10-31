import { Composer } from "grammy";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups, recordAuditLog } from "@/db/schema";
import { telegramChatColumns } from "@/lib/chat";
import { findActiveInvite, INVITE_NOT_FOUND } from "@/lib/invites";
import { planLink } from "@/lib/link-plan";
import { logChatLinked } from "@/lib/record-mutation";

import { actorOf } from "../actor";
import type { BotContext } from "../context";
import { escapeHtml } from "../format";
import { absorbGroup, hasRecords } from "../handlers/chatMigration";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Whether this chat's group is a web group an earlier `/link` bound here rather than the
 * empty row `registerUser` made. Folding it into another group would delete a real group
 * (members, placeholders, invite) even while it has no expenses yet.
 */
async function wasLinked(groupId: number, tx: Tx): Promise<boolean> {
  const [row] = await tx
    .select({ id: recordAuditLog.id })
    .from(recordAuditLog)
    .where(and(eq(recordAuditLog.groupId, groupId), eq(recordAuditLog.action, "chat_linked")))
    .limit(1);
  return row !== undefined;
}

export const linkCommand = new Composer<BotContext>();

const USAGE =
  "在網頁版建立的群組，可以用邀請碼綁到這個聊天室：<code>/link 邀請碼</code>\n" +
  "邀請碼在 App 的群組設定 → 成員 → 新增成員 → 用邀請碼邀請。";

linkCommand.command("link", async (ctx) => {
  const chatGroup = ctx.dbGroup;
  if (!chatGroup || !ctx.dbUser) {
    await ctx.reply("這個指令只能在群組裡使用。");
    return;
  }

  const raw = ctx.match.trim();
  if (!raw) {
    await ctx.reply(USAGE, { parse_mode: "HTML" });
    return;
  }

  // Same sentence for a wrong code and for a code the sender has no standing to use,
  // so a reply never says which codes exist (see INVITE_NOT_FOUND).
  const notFound = () => ctx.reply(INVITE_NOT_FOUND.error);

  const invite = await findActiveInvite(raw);
  if (!invite) {
    await notFound();
    return;
  }

  const sender = ctx.dbUser;
  const outcome = await db.transaction(async (tx) => {
    // Lock the web group so two chats can't claim it at once; the chat columns are
    // re-read under the lock rather than trusting what findActiveInvite saw.
    const [target] = await tx
      .select()
      .from(groups)
      .where(eq(groups.id, invite.groupId))
      .for("update");

    const [member] = target
      ? await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, target.id), eq(groupMembers.userId, sender.id)))
      : [];

    const isChatGroupItself = target?.id === chatGroup.id;
    const plan = planLink({
      codeValid: target !== undefined,
      senderIsMember: member !== undefined,
      targetHasChat: target?.chatId != null,
      chatGroup: isChatGroupItself
        ? null
        : {
            hasRecords: await hasRecords(chatGroup.id, tx),
            wasLinked: await wasLinked(chatGroup.id, tx),
          },
    });
    if (!plan.ok) return plan;

    // The duplicate row owns the (chat_type, chat_id) key, so it has to go first.
    if (plan.absorb) {
      await absorbGroup(chatGroup.id, target.id, { ex: tx, keepSurvivorCurrency: true });
    }
    await tx
      .update(groups)
      .set({ ...telegramChatColumns(ctx.chat.id), updatedAt: new Date() })
      .where(eq(groups.id, target.id));

    return { ...plan, title: target.title, groupId: target.id };
  });

  if (!outcome.ok) {
    if (outcome.reason === "not_found") {
      await notFound();
    } else if (outcome.reason === "chat_already_linked") {
      await ctx.reply("這個聊天室已經綁定了另一個群組，不能再綁定。");
    } else if (outcome.reason === "already_linked") {
      await ctx.reply("這個群組已經綁定了一個 Telegram 聊天室，不能再綁定。");
    } else {
      console.error(
        `[link] chat ${ctx.chat.id}: group #${chatGroup.id} already holds records; ` +
          `refusing to link group #${invite.groupId} (needs a manual merge).`,
      );
      await ctx.reply("這個聊天室已經記過帳，兩邊都有帳目，沒辦法自動合併，所以沒有綁定。");
    }
    return;
  }

  await logChatLinked(outcome.groupId, actorOf(ctx), ctx.chat.title ?? "");

  await ctx.reply(
    `✅ 已把「${escapeHtml(outcome.title)}」綁定到這個聊天室。\n` +
      "之後的記帳會在這裡出現卡片。用過 bot 的人會自動加入，其他人請回覆他的訊息再打 /join。",
    { parse_mode: "HTML" },
  );
});

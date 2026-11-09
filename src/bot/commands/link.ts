import { Composer, InlineKeyboard } from "grammy";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups, recordAuditLog } from "@/db/schema";
import { button, GROUP_ONLY } from "@/lib/buttons";
import { telegramChatColumns } from "@/lib/chat";
import { groupLink } from "@/lib/deep-link";
import { findActiveInvite, INVITE_NOT_FOUND } from "@/lib/invites";
import { planLink } from "@/lib/link-plan";
import { consumeRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITED, RATE_RULES } from "@/lib/rate-limits";
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
  "用法：<code>/link 邀請碼</code>\n" +
  "把網頁建立的群組綁到這裡。邀請碼在 App 群組設定 → 成員 → 新增成員。";

linkCommand.command("link", async (ctx) => {
  const chatGroup = ctx.dbGroup;
  if (!chatGroup || !ctx.dbUser) {
    await ctx.reply(GROUP_ONLY);
    return;
  }

  const raw = ctx.match.trim();
  if (!raw) {
    await ctx.reply(USAGE, { parse_mode: "HTML" });
    return;
  }

  // Counted before the code is looked up, per sender and per chat (issue #121). Only the
  // first refusal in a window gets a reply, so a script can't flood the chat through the bot,
  // and the reply never says how long to wait.
  const limit = await consumeRateLimit([
    { rule: RATE_RULES.linkSender, id: ctx.from?.id ?? `u${ctx.dbUser.id}` },
    { rule: RATE_RULES.linkChat, id: ctx.chat.id },
  ]);
  if (!limit.ok) {
    if (limit.firstRefusal) await ctx.reply(`${RATE_LIMITED.error}。`);
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
      .set({
        ...telegramChatColumns(ctx.chat.id),
        // A topic picked with /topic before /link belongs to this same chat, so it comes along
        // with the chat's row instead of being reset like a thread id from another chat.
        noticeThreadId: chatGroup.noticeThreadId,
        noticeThreadName: chatGroup.noticeThreadName,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, target.id));

    return { ...plan, title: target.title, groupId: target.id };
  });

  if (!outcome.ok) {
    if (outcome.reason === "not_found") {
      await notFound();
    } else if (outcome.reason === "chat_already_linked") {
      await ctx.reply("這裡已經綁定其他群組了。");
    } else if (outcome.reason === "already_linked") {
      await ctx.reply("那個群組已經綁在別的聊天室了。");
    } else {
      console.error(
        `[link] chat ${ctx.chat.id}: group #${chatGroup.id} already holds records; ` +
          `refusing to link group #${invite.groupId} (needs a manual merge).`,
      );
      await ctx.reply("兩邊都有帳目，無法合併，沒有綁定。");
    }
    return;
  }

  await logChatLinked(outcome.groupId, actorOf(ctx), ctx.chat.title ?? "");

  // Like the welcome: the button seats whoever taps it, which is simpler than teaching /join.
  await ctx.reply(`✅ 「${escapeHtml(outcome.title)}」已綁定到這裡\n還沒加入的人點一下 👇`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().url(
      button("openApp"),
      groupLink(ctx.me.username, ctx.chat.id),
    ),
  });
});

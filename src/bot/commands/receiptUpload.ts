import { Composer } from "grammy";
import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groupMembers, receiptAwaiting, users } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { labelUser } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { parseAddMessage } from "@/lib/parseAdd";
import { escapeHtml, mention } from "../format";
import { buildKeyboard, insertEqualSplitExpense } from "./add";
import type { BotContext } from "../context";

export const receiptUploadHandler = new Composer<BotContext>();

// Rows older than 24 h are no longer actionable — clean up opportunistically.
const STALE_MS = 24 * 60 * 60 * 1000;

receiptUploadHandler.on("message:photo", async (ctx) => {
  if (!ctx.dbGroup || !ctx.dbUser) return;

  const fileId = ctx.message.photo.at(-1)!.file_id;

  // ── Path A: reply to a ForceReply "upload receipt" prompt ─────────────────
  const replyToId = ctx.message.reply_to_message?.message_id;
  if (replyToId) {
    const [pending] = await db
      .select()
      .from(receiptAwaiting)
      .where(
        and(
          eq(receiptAwaiting.chatId, ctx.chat.id),
          eq(receiptAwaiting.messageId, replyToId),
        ),
      );

    if (pending) {
      if (ctx.message.media_group_id) {
        await ctx.reply("收據只支援單張照片，請單獨傳送一張照片。");
        return;
      }
      await Promise.all([
        db
          .update(expenses)
          .set({ receiptFileId: fileId, updatedAt: new Date() })
          .where(eq(expenses.id, pending.expenseId)),
        db.delete(receiptAwaiting).where(eq(receiptAwaiting.id, pending.id)),
        ctx.api.deleteMessage(ctx.chat.id, replyToId).catch(() => undefined),
      ]);
      await ctx.react("👍");
      return;
    }

    // Opportunistic stale cleanup — only fires on reply-photos, not every photo.
    await db
      .delete(receiptAwaiting)
      .where(lt(receiptAwaiting.createdAt, new Date(Date.now() - STALE_MS)));
  }

  // ── Path B: photo sent with /add caption (receipt already attached) ───────
  const caption = ctx.message.caption ?? "";
  const captionEntities = ctx.message.caption_entities ?? [];

  const firstCmd = captionEntities.find((e) => e.type === "bot_command");
  if (!firstCmd) return;

  const cmdText = caption.slice(firstCmd.offset, firstCmd.offset + firstCmd.length).toLowerCase();
  const botUsername = ctx.me.username?.toLowerCase();
  if (cmdText !== "/add" && cmdText !== `/add@${botUsername}`) return;

  if (ctx.message.media_group_id) {
    await ctx.reply("Caption 模式不支援一次傳送多張照片，請單獨傳送一張照片。");
    return;
  }

  const group = ctx.dbGroup;
  const payer = ctx.dbUser;

  let parsed;
  try {
    parsed = parseAddMessage(caption, captionEntities);
  } catch (err) {
    await ctx.reply(err instanceof Error ? err.message : "輸入格式錯誤");
    return;
  }

  if (parsed.shareLines.length > 0) {
    await ctx.reply("Caption 模式不支援多行分帳，請改用文字 /add 指令。");
    return;
  }

  const hasMentions =
    parsed.mentionUsernames.length > 0 || parsed.mentionTelegramIds.length > 0;
  if (hasMentions) {
    await ctx.reply("Caption 模式不支援 @mention 指定分帳對象，請改用文字 /add 指令。");
    return;
  }

  for (const entity of captionEntities) {
    if (entity.type !== "text_mention" || !entity.user || entity.user.is_bot) continue;
    const u = await upsertTelegramUser(entity.user);
    await db.insert(groupMembers).values({ groupId: group.id, userId: u.id }).onConflictDoNothing();
  }

  const currency = group.defaultCurrency;
  const amount = parsed.amount!;

  const allMembers = await db
    .select({
      id: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      telegramId: users.telegramId,
    })
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, group.id));

  if (allMembers.length === 0) {
    await ctx.reply("這個群組沒有可分帳的人。");
    return;
  }

  const { expense, shares } = await insertEqualSplitExpense({
    groupId: group.id,
    payerId: payer.id,
    createdBy: payer.id,
    amount,
    currency,
    description: parsed.description,
    participants: allMembers,
    receiptFileId: fileId,
  });

  const descPart = parsed.description ? `（${escapeHtml(parsed.description)}）` : "";
  const allSame = shares.every((s) => s === shares[0]);
  const splitLine = allSame
    ? `${allMembers.map((p) => mention(labelUser(p), p.telegramId)).join("、")} 各 ${fmtGrouped(shares[0])}`
    : allMembers.map((p, i) => `${mention(labelUser(p), p.telegramId)} ${fmtGrouped(shares[i])}`).join("、");

  // Receipt already attached — no upload button needed.
  await ctx.reply(
    `${mention(labelUser(payer), payer.telegramId)} 付了 <b>${fmtGrouped(amount)} ${currency}</b>${descPart}\n${splitLine}`,
    { parse_mode: "HTML", reply_markup: buildKeyboard(ctx, expense.id) },
  );
});

import { Composer } from "grammy";
import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import { expenses, receiptAwaiting } from "@/db/schema";
import { ADD_USAGE, parseAddMessage } from "@/lib/parseAdd";

import { staleAwaitingBefore } from "../awaiting";
import { handleAddParsed } from "./add";
import type { BotContext } from "../context";

export const receiptUploadHandler = new Composer<BotContext>();

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
      .where(lt(receiptAwaiting.createdAt, staleAwaitingBefore()));
  }

  // ── Path B: photo sent with an /add caption (receipt already attached) ────
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

  let parsed;
  try {
    parsed = parseAddMessage(caption, captionEntities);
  } catch (err) {
    // No ForceReply retry offered here — replying with text would lose the photo.
    await ctx.reply(err instanceof Error ? err.message : ADD_USAGE);
    return;
  }

  // Same path as a text /add — mentions and the ⚙️ 調整 panel work identically,
  // the only difference is that the receipt is already attached.
  await handleAddParsed(
    ctx as Parameters<typeof handleAddParsed>[0],
    parsed,
    captionEntities,
    { receiptFileId: fileId },
  );
});

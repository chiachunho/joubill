import { Composer } from "grammy";
import { eq } from "drizzle-orm";

import { TOAST } from "@/lib/buttons";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { deleterOf, loadNoticeRecord } from "@/lib/notify";
import { formatDeletedNotice } from "@/lib/record-notice";

import type { BotContext } from "../context";

export const deleteExpenseCallback = new Composer<BotContext>();

// The 🗑 刪除 button, on an expense card and on a settlement notice alike.
deleteExpenseCallback.callbackQuery(/^del_exp:(\d+)$/, async (ctx) => {
  const recordId = Number(ctx.match[1]);
  const user = ctx.dbUser;

  if (!user) {
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return;
  }

  // Loaded before the delete: the record is gone afterwards, and the message
  // left behind is rendered from this snapshot.
  const notice = await loadNoticeRecord(recordId);

  // Callback data is attacker-controlled, so the id alone proves nothing: without
  // this the button would delete an expense belonging to any other group. The
  // bot-side equivalent of the REST layer's assertGroupMember.
  if (!notice || !ctx.dbGroup || notice.groupId !== ctx.dbGroup.id) {
    await ctx.answerCallbackQuery({ text: TOAST.recordGone, show_alert: true });
    return;
  }

  // Anyone in the group may delete — see CLAUDE.md. What replaces the lock is
  // attribution: the message left behind says what went and who removed it, so
  // a wrong deletion is visible in the chat and retypeable, not silent.
  //
  // expensePayers / expenseSplits are cascade-deleted by the FK constraint
  await db.delete(expenses).where(eq(expenses.id, recordId));

  await ctx.answerCallbackQuery({ text: "已刪除" });

  // Editing "the" message hits the card this button sits on. Omitting
  // reply_markup clears the now-dangling buttons. Rendered through the same
  // shared formatter the API's DELETE uses, so a record deleted from the Mini
  // App leaves an identical message.
  await ctx
    .editMessageText(
      formatDeletedNotice({
        record: notice.record,
        creator: notice.creator,
        deleter: deleterOf(user),
      }),
      { parse_mode: "HTML" },
    )
    .catch(() => undefined);
});

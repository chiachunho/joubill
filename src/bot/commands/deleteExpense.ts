import { Composer } from "grammy";
import { eq } from "drizzle-orm";

import { TOAST } from "@/lib/buttons";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { deleterOf } from "@/lib/notify";
import { logDeleted } from "@/lib/record-mutation";
import { formatDeletedNotice } from "@/lib/record-notice";

import { actorOf } from "../actor";
import { groupForButton } from "../groupPicker";
import type { BotContext } from "../context";

export const deleteExpenseCallback = new Composer<BotContext>();

// The ⊗ 刪除 button, on an expense card and on a settlement notice alike, and on the
// confirmation a private-chat /add leaves.
deleteExpenseCallback.callbackQuery(/^del_exp:(\d+)$/, async (ctx) => {
  const recordId = Number(ctx.match[1]);
  const user = ctx.dbUser;

  if (!user) {
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return;
  }

  // Callback data is attacker-controlled, so the id alone proves nothing: without
  // this the button would delete an expense belonging to any other group. The
  // bot-side equivalent of the REST layer's assertGroupMember.
  const [target] = await db
    .select({ groupId: expenses.groupId })
    .from(expenses)
    .where(eq(expenses.id, recordId));
  // In a group's chat it must be that group's record; in a private chat the presser must
  // be a member of the record's group (groupForButton covers both).
  if (!target || !(await groupForButton(ctx, target.groupId))) {
    await ctx.answerCallbackQuery({ text: TOAST.recordGone, show_alert: true });
    return;
  }

  // Anyone in the group may delete — see CLAUDE.md. What replaces the lock is
  // attribution: the log records who removed it, and the message left behind
  // says so too, so a wrong deletion is visible in the chat and retypeable.
  //
  // In the group, `null` api: the message to rewrite is the card this button sits on,
  // edited below. From a private chat the group's card is elsewhere, so the notify
  // layer turns it into the tombstone, as for a delete made in the app. logDeleted
  // hands back the snapshot it took before the row (and its payers/splits,
  // cascade-deleted by FK) disappeared.
  const inGroup = ctx.dbGroup !== undefined;
  const notice = await logDeleted(
    inGroup ? null : ctx.api,
    recordId,
    actorOf(ctx),
    user,
    async (tx) => {
      await tx.delete(expenses).where(eq(expenses.id, recordId));
    },
  );

  await ctx.answerCallbackQuery({ text: "已刪除" });
  if (!notice) return;

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
        creatorVia: notice.createdVia,
      }),
      { parse_mode: "HTML" },
    )
    .catch(() => undefined);
});

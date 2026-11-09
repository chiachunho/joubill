import { InlineKeyboard } from "grammy";
import type { Group } from "@/db/schema";
import { button } from "@/lib/buttons";
import { addToGroupLink } from "@/lib/deep-link";

import type { BotContext } from "./context";
import { escapeHtml } from "./format";
import { memberGroups, pickedGroup } from "./myGroups";

/**
 * Group commands typed in a private chat with the bot. A private chat belongs to no group,
 * so the command first has to know which one: a person in one group gets that group, a
 * person in several picks one from buttons. The pick is a callback, `pick:<kind>:<group id>`,
 * built and parsed here and handled in `commands/privatePick.ts`.
 *
 * Whoever presses a pick button must be a member of the group it names: callback data is a
 * string the client sends, so the id alone proves nothing (the private-chat counterpart of
 * `assertGroupMember`).
 */

export const PICK_KINDS = ["add", "list", "balance", "settle", "export"] as const;
export type PickKind = (typeof PICK_KINDS)[number];

/**
 * The most recently used groups come first. The cap only guards Telegram's keyboard size
 * (100 buttons); set well above any real person's group count, so no group is unreachable.
 */
const MAX_PICKS = 50;

export function pickCallback(kind: PickKind, groupId: number): string {
  return `pick:${kind}:${groupId}`;
}

export function parsePickCallback(data: string): { kind: PickKind; groupId: number } | null {
  const m = /^pick:([a-z]+):(\d+)$/.exec(data);
  if (!m || !(PICK_KINDS as readonly string[]).includes(m[1])) return null;
  return { kind: m[1] as PickKind, groupId: Number(m[2]) };
}

/** Said to someone who is in no group yet, with the button that fixes it. */
export async function replyNoGroups(ctx: BotContext) {
  await ctx.reply("你還不在任何揪帳群組裡，把我加進群組就能開始分帳。", {
    reply_markup: new InlineKeyboard().url(button("addToGroup"), addToGroupLink(ctx.me.username)),
  });
}

/**
 * Settle which group a private-chat command is about. Returns the group when there is
 * only one; otherwise replies (a picker, or "you're in no group") and returns null, and
 * the pick arrives later as a callback.
 *
 * The picker replies to the command message, so the pick can read the command back off
 * `reply_to_message` (that is how a private `/add` keeps its text without storing it).
 */
export async function pickGroup(
  ctx: BotContext,
  kind: PickKind,
  question: string,
): Promise<Group | null> {
  const mine = await memberGroups(ctx.dbUser!.id);
  if (mine.length === 0) {
    await replyNoGroups(ctx);
    return null;
  }
  if (mine.length === 1) return mine[0];

  const kb = new InlineKeyboard();
  for (const g of mine.slice(0, MAX_PICKS)) kb.text(g.title, pickCallback(kind, g.id)).row();
  await ctx.reply(question, {
    parse_mode: "HTML",
    reply_markup: kb,
    reply_to_message_id: ctx.message?.message_id,
  });
  return null;
}

/** `「東京旅行」`, escaped for an HTML message. */
export function quotedTitle(group: Group): string {
  return `「${escapeHtml(group.title)}」`;
}

/**
 * The group a button names, checked against where it was pressed: in a group's chat it
 * must be that chat's group, in a private chat the presser must be a member. Null when
 * neither holds, which the caller answers with `TOAST.staleButton`.
 */
export async function groupForButton(ctx: BotContext, groupId: number): Promise<Group | null> {
  if (!ctx.dbUser) return null;
  if (ctx.dbGroup) return ctx.dbGroup.id === groupId ? ctx.dbGroup : null;
  return ctx.chat?.type === "private" ? pickedGroup(ctx.dbUser.id, groupId) : null;
}

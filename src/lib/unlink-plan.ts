/**
 * Whether a group may be detached from its Telegram chat.
 *
 * Pure so the refusals can be tested without a database, and shared by the App
 * (`DELETE /api/groups/[id]/chat`) and the bot's `/unlink`, which must agree.
 *
 * There is deliberately no check on how the group got its chat. A group made on the
 * web and bound with `/link`, and one that began in Telegram, both unlink: someone who
 * wants a fresh group in the same chat just unlinks and adds the bot back. Membership
 * is the only gate, as for every other group setting.
 */
export type UnlinkRefusal = "not_member" | "no_chat";

export type UnlinkPlan = { ok: true } | { ok: false; reason: UnlinkRefusal };

export function planUnlink(input: {
  /** The caller belongs to the group. */
  isMember: boolean;
  /** The group still points at a chat. Re-read under the row lock, so two unlinks can't both win. */
  hasChat: boolean;
}): UnlinkPlan {
  if (!input.isMember) return { ok: false, reason: "not_member" };
  if (!input.hasChat) return { ok: false, reason: "no_chat" };
  return { ok: true };
}

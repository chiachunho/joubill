/**
 * Whether a group may be detached from its Telegram chat.
 *
 * Pure so the refusal can be tested without a database, and shared by the App
 * (`DELETE /api/groups/[id]/chat`) and the bot's `/unlink`, which must agree.
 *
 * Membership is not an input: both entry points have already gated on it (`assertGroupMember`
 * in the API; in the bot, `registerUser` seats the sender and the callback is matched to the
 * chat's group). Nor is how the group got its chat: one made on the web and bound with `/link`,
 * and one that began in Telegram, both unlink, so someone who wants a fresh group in the same
 * chat just unlinks and adds the bot back.
 */
export type UnlinkPlan = { ok: true } | { ok: false; reason: "no_chat" };

export function planUnlink(input: {
  /** The group still points at a chat. Re-read under the row lock, so two unlinks can't both win. */
  hasChat: boolean;
}): UnlinkPlan {
  return input.hasChat ? { ok: true } : { ok: false, reason: "no_chat" };
}

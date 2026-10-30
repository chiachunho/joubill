/**
 * Whether `/link` may bind a web group to the Telegram chat it was typed in.
 *
 * Pure so the refusals can be tested without a database. The order is the point:
 * a stranger holding a valid code must get exactly the answer a wrong code gets,
 * so `not_found` is decided before anything that would reveal the group exists.
 */
export type LinkRefusal = "not_found" | "already_linked" | "both_have_records";

export type LinkPlan = { ok: true; absorb: boolean } | { ok: false; reason: LinkRefusal };

export function planLink(input: {
  /** The code resolved to a live invite and its group still exists. */
  codeValid: boolean;
  /** The sender is a member of that group. A code only finds it; it never admits anyone. */
  senderIsMember: boolean;
  /** The web group already points at a chat. */
  targetHasChat: boolean;
  /** The row `registerUser` made for this chat, or null when it is the web group itself. */
  chatGroup: { hasRecords: boolean } | null;
}): LinkPlan {
  if (!input.codeValid || !input.senderIsMember) return { ok: false, reason: "not_found" };
  if (input.targetHasChat) return { ok: false, reason: "already_linked" };
  if (input.chatGroup?.hasRecords) return { ok: false, reason: "both_have_records" };
  return { ok: true, absorb: input.chatGroup !== null };
}

/**
 * Shared lifetime for the ForceReply "waiting for a reply" rows
 * (`add_awaiting`, `receipt_awaiting`).
 *
 * A prompt older than this is not actionable: Telegram's reply UI is long gone
 * from the user's screen, and the expense the row points at has usually been
 * edited by other means since. Both tables are swept opportunistically — on the
 * next reply that arrives — rather than on a schedule, so the window only has to
 * be generous enough that a slow reply still lands.
 */
export const AWAITING_STALE_MS = 24 * 60 * 60 * 1000;

/** Cutoff for `lt(<table>.createdAt, …)` when sweeping stale prompt rows. */
export function staleAwaitingBefore(): Date {
  return new Date(Date.now() - AWAITING_STALE_MS);
}

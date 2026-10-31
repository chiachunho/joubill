import type { NoticeRecord } from "@/lib/record-notice";

/**
 * Who should get a push notification about a change to one record (issue #67). Pure, so the
 * rule is unit-tested; `src/lib/push.ts` then drops anyone who muted the group or has no
 * device subscribed.
 *
 * Push is a personal nudge, not a feed: the group's chat message (and the activity page) are
 * where everyone sees everything. So only people the change actually touches are notified:
 *
 * - **created**: everyone on the record, as a payer or in the split.
 * - **updated**: everyone on it before *or* after the edit (someone taken off the split
 *   needs to know as much as someone added), plus whoever recorded it.
 * - **deleted**: everyone who was on it, plus whoever recorded it.
 *
 * The person who made the change is never notified about it.
 */

export type PushAction = "created" | "updated" | "deleted";

export type PushPlanInput = {
  action: PushAction;
  before: NoticeRecord | null;
  after: NoticeRecord | null;
  /** `expenses.created_by`; null when that user is gone. */
  creatorId: number | null;
  actorId: number;
};

function involved(record: NoticeRecord | null): number[] {
  if (!record) return [];
  return [...record.payers, ...record.splits].map((leg) => leg.user.userId);
}

export function pushRecipients(input: PushPlanInput): number[] {
  const ids = new Set<number>([...involved(input.before), ...involved(input.after)]);
  if (input.action !== "created" && input.creatorId != null) ids.add(input.creatorId);
  ids.delete(input.actorId);
  return [...ids].sort((a, b) => a - b);
}

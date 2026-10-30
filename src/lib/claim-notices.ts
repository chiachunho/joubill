import type { Api } from "grammy";

import { updateRecordNotice } from "@/lib/notify";

/**
 * Telegram allows roughly 20 messages a minute into one group, and an edit counts. A merge can
 * rewrite hundreds of records, so only the newest are refreshed; older cards keep the name they
 * were posted with, which is what a chat history is.
 */
export const CLAIM_NOTICE_LIMIT = 20;

/** The record ids whose chat message gets edited after a merge: newest first, capped. */
export function noticesToRefresh(recordIds: number[], removedIds: number[] = []): number[] {
  const removed = new Set(removedIds);
  return recordIds
    .filter((id) => !removed.has(id))
    .sort((a, b) => b - a)
    .slice(0, CLAIM_NOTICE_LIMIT);
}

/**
 * Re-renders the group messages of records a merge rewrote, so a card stops naming the
 * placeholder. Edit-only (`repost: false`): a record without a message stays without one.
 * Sequential on purpose, to stay under the chat's rate limit. Errors are swallowed by
 * `updateRecordNotice`, as everywhere else.
 */
export async function refreshClaimedNotices(
  api: Api,
  recordIds: number[],
  removedIds: number[] = [],
): Promise<void> {
  for (const id of noticesToRefresh(recordIds, removedIds)) {
    await updateRecordNotice(api, id, { repost: false });
  }
}

/**
 * Which records an earlier beancount export got wrong, and what to write about them
 * (issue #124). Pure: the caller loads the exported snapshot and the current record.
 *
 * `exported` is the record as it stood when the last export ran (the `before` of the
 * first audit row after that export), `current` is it now, `null` once deleted.
 * An edit is written as a reversal of the exported version plus the current version,
 * so every transaction maps to a version the app showed.
 */

import {
  beancountDate,
  recordPostings,
  type BeancountAccounts,
  type BeancountRecord,
} from "@/lib/beancount";
import type { RecordSnapshot } from "@/lib/record-audit";

export type CorrectionPlan =
  /** Nothing the file would say differently: not your record, or no change you can see. */
  | { kind: "none" }
  /** The record became yours through an edit: written as an ordinary new transaction. */
  | { kind: "new"; current: BeancountRecord }
  /** Reverse what was exported, then (unless deleted or no longer yours) write the current version. */
  | {
      kind: "correction";
      correction: "edited" | "deleted";
      reverse: BeancountRecord;
      current: BeancountRecord | null;
    };

/** A stored snapshot, read back as the record the export renders. */
export function snapshotToBeancountRecord(id: number, snap: RecordSnapshot): BeancountRecord {
  return {
    id,
    type: snap.type,
    amount: snap.amount,
    currency: snap.currency,
    description: snap.description ?? null,
    spentAt: snap.spentAt,
    payers: snap.payers.map((l) => ({ userId: l.user.userId, amount: l.amount })),
    splits: snap.splits.map((l) => ({ userId: l.user.userId, amount: l.amount })),
  };
}

export function planCorrection(
  exported: BeancountRecord,
  current: BeancountRecord | null,
  userId: number,
  accounts: BeancountAccounts,
): CorrectionPlan {
  const before = recordPostings(exported, userId, accounts);
  const after = current ? recordPostings(current, userId, accounts) : null;

  if (!before) {
    return current && after ? { kind: "new", current } : { kind: "none" };
  }
  if (!current) return { kind: "correction", correction: "deleted", reverse: exported, current };

  // An edit that leaves this ledger's transaction as it was (a new description, a
  // receipt, a change between other people) needs no correction.
  if (
    after &&
    beancountDate(exported.spentAt) === beancountDate(current.spentAt) &&
    exported.currency === current.currency &&
    JSON.stringify(before) === JSON.stringify(after)
  ) {
    return { kind: "none" };
  }
  return {
    kind: "correction",
    correction: "edited",
    reverse: exported,
    current: after ? current : null,
  };
}

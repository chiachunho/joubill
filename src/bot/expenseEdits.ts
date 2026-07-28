import { type Api } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses } from "@/db/schema";
import { n, splitEqual } from "@/lib/money";
import { logUpdated, type Actor } from "@/lib/record-mutation";

import { loadSplitState, splitRowsFor, type SplitEntry } from "./expenseCard";

/**
 * Every write the bot makes to an existing expense.
 *
 * Separate from `expenseCard.ts` on purpose. `src/lib/notify.ts` imports that
 * module to render a card from an API route handler, so it has to stay a leaf
 * with no dependencies of its own (CLAUDE.md). These helpers need
 * `record-mutation.ts`, which imports `notify.ts` — putting them next to the
 * renderer would close that loop into an import cycle.
 *
 * All four take an `Actor` and route through `logUpdated`, so a panel button
 * cannot change a record without saying who pressed it. The three driven by
 * card buttons pass `null` for the api, because the caller is already
 * re-rendering the card the button sits on, in whichever panel mode the user is
 * in — this layer must not flatten that back to the summary view
 * mid-interaction. `setExpenseReceipt` is the exception and explains itself.
 */

/** Replace an expense's splits with ones derived from `entries`. */
export async function writeSplits(
  expenseId: number,
  total: number,
  entries: SplitEntry[],
  actor: Actor,
) {
  if (entries.length === 0) return;
  const rows = splitRowsFor(expenseId, total, entries);

  await logUpdated(null, expenseId, actor, async (tx) => {
    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
    await tx.insert(expenseSplits).values(rows);
    await tx.update(expenses).set({ updatedAt: new Date() }).where(eq(expenses.id, expenseId));
  });
}

/**
 * Change an expense's total. Payer contributions are always rescaled
 * proportionally. Splits are recomputed from the share weights when the panel
 * owns them; otherwise each person's amount is scaled by the same factor, which
 * keeps a Mini-App-entered exact or percent split intact.
 */
export async function setExpenseAmount(expenseId: number, total: number, actor: Actor) {
  const payers = await db
    .select({ id: expensePayers.id, amount: expensePayers.amount })
    .from(expensePayers)
    .where(eq(expensePayers.expenseId, expenseId));

  const payerAmounts = rescale(
    payers.map((p) => n(p.amount)),
    total,
  );
  const { entries, panelEditable } = await loadSplitState(expenseId);

  const splitRows = panelEditable
    ? splitRowsFor(expenseId, total, entries)
    : await (async () => {
        const rows = await db
          .select({
            debtorId: expenseSplits.debtorId,
            amount: expenseSplits.amount,
            shareType: expenseSplits.shareType,
            splitValue: expenseSplits.splitValue,
          })
          .from(expenseSplits)
          .where(eq(expenseSplits.expenseId, expenseId))
          .orderBy(expenseSplits.id);
        const scaled = rescale(
          rows.map((r) => n(r.amount)),
          total,
        );
        return rows.map((r, i) => ({
          expenseId,
          debtorId: r.debtorId,
          amount: scaled[i].toFixed(2),
          shareType: r.shareType,
          splitValue: r.splitValue,
        }));
      })();

  await logUpdated(null, expenseId, actor, async (tx) => {
    await tx
      .update(expenses)
      .set({ amount: total.toFixed(2), updatedAt: new Date() })
      .where(eq(expenses.id, expenseId));
    for (const [i, p] of payers.entries()) {
      await tx
        .update(expensePayers)
        .set({ amount: payerAmounts[i].toFixed(2) })
        .where(eq(expensePayers.id, p.id));
    }
    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
    if (splitRows.length > 0) await tx.insert(expenseSplits).values(splitRows);
  });
}

/**
 * Point an expense at another currency, dropping any pinned rate.
 *
 * The pin was quoted against the old currency, so keeping it would convert the
 * new amount at the old currency's rate — a wrong number with nothing to
 * announce it. This guard used to live in two places (the 💱 buttons and the
 * ForceReply that answers 其他幣別) as hand-copied duplicates; either copy
 * forgetting to clear the pin fails silently, which is exactly the kind of
 * duplication CLAUDE.md says to collapse.
 *
 * Re-selecting the current code is a no-op, so a pin survives being confirmed.
 */
export async function setExpenseCurrency(expenseId: number, code: string, actor: Actor) {
  const [current] = await db
    .select({ currency: expenses.currency })
    .from(expenses)
    .where(eq(expenses.id, expenseId));
  if (!current || current.currency === code) return;

  await logUpdated(null, expenseId, actor, (tx) =>
    tx
      .update(expenses)
      .set({ currency: code, fxRate: null, fxQuote: null, updatedAt: new Date() })
      .where(eq(expenses.id, expenseId)),
  );
}

/**
 * Attach a receipt photo uploaded through the bot's ForceReply prompt.
 *
 * The odd one out: it takes an `api` where the others pass `null`. The reply
 * that carries the photo is not a card button, so nobody is re-rendering the
 * card — without this the expense keeps offering 🧾 收據 for a receipt it
 * already has.
 */
export async function setExpenseReceipt(expenseId: number, fileId: string, actor: Actor, api: Api) {
  await logUpdated(api, expenseId, actor, (tx) =>
    tx
      .update(expenses)
      .set({ receiptFileId: fileId, updatedAt: new Date() })
      .where(eq(expenses.id, expenseId)),
  );
}

/** Scale `amounts` so they sum to exactly `total`, putting any rounding drift on the first. */
function rescale(amounts: number[], total: number): number[] {
  if (amounts.length === 0) return [];
  if (amounts.length === 1) return [total];
  const old = amounts.reduce((s, x) => s + x, 0);
  if (old <= 0) return splitEqual(total, amounts.length);
  const raw = amounts.map((a) => Math.round((a / old) * total * 100) / 100);
  const drift = Math.round((total - raw.reduce((s, x) => s + x, 0)) * 100) / 100;
  raw[0] = Math.round((raw[0] + drift) * 100) / 100;
  return raw;
}

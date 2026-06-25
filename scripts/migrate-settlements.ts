/**
 * One-time migration: fold the `settlements` table into `expenses`.
 *
 * A settlement "A → B, amount X" is a degenerate expense: A is the sole payer
 * and B is the sole debtor, so its balance impact (+X to A, −X to B) is
 * identical. This copies every settlement into:
 *   - expenses        (type='settlement', spent_at=settled_at, fx carried over)
 *   - expense_payers   (from_user_id, amount)
 *   - expense_splits   (to_user_id, amount, share_type='exact')
 *
 * Run BEFORE `pnpm db:push` when upgrading:
 *   pnpm tsx scripts/migrate-settlements.ts
 *   pnpm db:push        # drops the now-empty settlements table + the temp column
 *
 * The script adds expenses.type itself (db:push hasn't run yet), is idempotent
 * (NOT EXISTS guards let a re-run finish a partial migration without
 * duplicating), and aborts loudly if the source table is already gone.
 *
 * A temporary `expenses.legacy_settlement_id` column correlates each new expense
 * back to its source settlement so the payer/split inserts are set-based. It is
 * left in place for `pnpm db:push` to drop (dropping it here would break re-runs).
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.local and retry.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  // Guard: the settlements table must still exist. If db:push ran first it was
  // dropped and the settlement history is unrecoverable without a DB restore.
  const tableCheck = await sql`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements'
  `;
  if (tableCheck.length === 0) {
    console.error("ERROR: settlements table not found.");
    console.error("pnpm db:push has already dropped it — settlement data can no longer be");
    console.error("migrated automatically. Restore the DB from a backup and run this script");
    console.error("BEFORE pnpm db:push.");
    process.exit(1);
  }

  // Add the discriminator + temp correlation column up front (db:push hasn't run).
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'expense'`;
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS legacy_settlement_id INTEGER`;

  // All three inserts run in ONE transaction so a mid-run failure can't leave a
  // settlement-expense without its payer/split legs. The NOT EXISTS guards still
  // make a re-run safe (and the temp legacy_settlement_id column correlates the
  // payer/split inserts back to the expense created in the same transaction).
  const [expenseRows] = await sql.transaction([
    // 1. One expense per settlement (skip any already copied — re-run safe).
    sql`
      INSERT INTO expenses
        (group_id, type, amount, currency, description, spent_at, created_by,
         fx_rate, fx_quote, created_at, updated_at, legacy_settlement_id)
      SELECT s.group_id, 'settlement', s.amount, s.currency, NULL, s.settled_at,
             s.from_user_id, s.fx_rate, s.fx_quote, s.created_at, s.created_at, s.id
      FROM   settlements s
      WHERE  NOT EXISTS (
               SELECT 1 FROM expenses e WHERE e.legacy_settlement_id = s.id
             )
      RETURNING id
    `,
    // 2. Sole payer = the sender (from_user_id).
    sql`
      INSERT INTO expense_payers (expense_id, payer_id, amount)
      SELECT e.id, s.from_user_id, s.amount
      FROM   expenses e
      JOIN   settlements s ON s.id = e.legacy_settlement_id
      WHERE  e.type = 'settlement'
        AND  NOT EXISTS (
               SELECT 1 FROM expense_payers ep WHERE ep.expense_id = e.id
             )
    `,
    // 3. Sole debtor = the receiver (to_user_id), as an exact split.
    sql`
      INSERT INTO expense_splits (expense_id, debtor_id, amount, share_type, split_value)
      SELECT e.id, s.to_user_id, s.amount, 'exact', NULL
      FROM   expenses e
      JOIN   settlements s ON s.id = e.legacy_settlement_id
      WHERE  e.type = 'settlement'
        AND  NOT EXISTS (
               SELECT 1 FROM expense_splits es WHERE es.expense_id = e.id
             )
    `,
  ]);

  console.log(`Migrated ${expenseRows.length} settlements into expenses (type='settlement').`);
  console.log("Now run `pnpm db:push` to drop the settlements table and the temp column.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

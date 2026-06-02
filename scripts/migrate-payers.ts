/**
 * One-time migration: populate expense_payers from expenses.payer_id.
 *
 * Run BEFORE `pnpm db:push` when upgrading to the multi-payer schema:
 *   pnpm tsx scripts/migrate-payers.ts
 *   pnpm db:push
 *
 * The script is idempotent — running it twice is safe.
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
  // Guard: payer_id must still exist on expenses. If db:push ran first it was dropped
  // and historical data is unrecoverable without a DB restore.
  const colCheck = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'payer_id'
  `;
  if (colCheck.length === 0) {
    console.error("ERROR: expenses.payer_id column not found.");
    console.error("pnpm db:push has already dropped this column — historical payer data can");
    console.error("no longer be migrated automatically. Restore the DB from a backup and run");
    console.error("this script BEFORE pnpm db:push.");
    process.exit(1);
  }

  // Create the table if it doesn't exist yet (db:push hasn't run).
  await sql`
    CREATE TABLE IF NOT EXISTS expense_payers (
      id         SERIAL PRIMARY KEY,
      expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      payer_id   INTEGER NOT NULL REFERENCES users(id),
      amount     NUMERIC(14, 2) NOT NULL,
      UNIQUE (expense_id, payer_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS expense_payers_expense_idx ON expense_payers (expense_id)`;
  await sql`CREATE INDEX IF NOT EXISTS expense_payers_payer_idx  ON expense_payers (payer_id)`;

  // Copy existing payer data from expenses, skipping rows already migrated.
  const result = await sql`
    INSERT INTO expense_payers (expense_id, payer_id, amount)
    SELECT e.id, e.payer_id, e.amount
    FROM   expenses e
    WHERE  e.payer_id IS NOT NULL
      AND  NOT EXISTS (
             SELECT 1 FROM expense_payers ep WHERE ep.expense_id = e.id
           )
    RETURNING id
  `;

  console.log(`Migrated ${result.length} expense rows into expense_payers.`);
  console.log("Now run `pnpm db:push` to drop expenses.payer_id and sync the schema.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

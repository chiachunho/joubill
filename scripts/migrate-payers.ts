/**
 * One-time migration: populate expense_payers from expenses.payer_id.
 *
 * Run BEFORE `pnpm db:push` when upgrading to the multi-payer schema:
 *   pnpm tsx scripts/migrate-payers.ts
 *   pnpm db:push
 *
 * The script is idempotent — running it twice is safe.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Create the table if it doesn't exist yet (db:push hasn't run).
  await sql`
    CREATE TABLE IF NOT EXISTS expense_payers (
      id         SERIAL PRIMARY KEY,
      expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      payer_id   INTEGER NOT NULL REFERENCES users(id),
      amount     NUMERIC(14, 2) NOT NULL
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
  `;

  console.log(`Migrated ${result.length ?? "unknown"} expense rows into expense_payers.`);
  console.log("Now run `pnpm db:push` to drop expenses.payer_id and sync the schema.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Drop the per-person beancount columns that issue #117 deprecated, before db:push runs.
 *
 * db:push alone can't do it on every database. Where `user_beancount_configs` still lacks
 * the columns #119 added (`event_account`, `last_exported_at`), dropping two columns and
 * adding two in one table makes drizzle-kit ask whether each is a rename, and that prompt
 * needs a TTY the build doesn't have. Dropping them here leaves db:push only additions.
 * Idempotent, and a no-op on a fresh database.
 */
import type { MigrationSql } from "../scripts/migrate";

export default async function up(sql: MigrationSql) {
  await sql`
    ALTER TABLE IF EXISTS user_beancount_configs
      DROP COLUMN IF EXISTS receivable_prefix,
      DROP COLUMN IF EXISTS person_accounts
  `;
}

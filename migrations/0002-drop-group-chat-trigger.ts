/**
 * Remove the groups_sync_chat trigger that 0001 installed for the deploy window.
 *
 * Runs in the same build as the schema change that drops groups.telegram_chat_id
 * (db:push, right after db:migrate), so the trigger and its function must be gone
 * first — it reads that column. Idempotent.
 */
import type { MigrationSql } from "../scripts/migrate";

export default async function up(sql: MigrationSql) {
  // DROP TRIGGER ... ON groups fails if the table itself doesn't exist yet (fresh database).
  const [{ exists }] = await sql`SELECT to_regclass('public.groups') IS NOT NULL AS exists`;
  if (exists) await sql`DROP TRIGGER IF EXISTS groups_sync_chat ON groups`;
  await sql`DROP FUNCTION IF EXISTS groups_sync_chat()`;
}

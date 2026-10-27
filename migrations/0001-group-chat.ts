/**
 * Split groups.telegram_chat_id into (chat_type, chat_id).
 *
 * Runs in the build while the previous release is still live, so it only adds,
 * backfills and relaxes — telegram_chat_id stays (see schema.ts) until a later
 * release drops it. Idempotent.
 */
import type { MigrationSql } from "../scripts/migrate";

export default async function up(sql: MigrationSql) {
  // Guard: if telegram_chat_id is already gone the ids are unrecoverable without a restore.
  const col = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'groups' AND column_name = 'telegram_chat_id'
  `;
  if (col.length === 0) {
    throw new Error(
      "groups.telegram_chat_id not found — it was dropped before this migration ran; " +
        "restore the database from a backup.",
    );
  }

  await sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_type varchar(16)`;
  await sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_id text`;

  // The new code never writes telegram_chat_id, so it can no longer be NOT NULL.
  await sql`ALTER TABLE groups ALTER COLUMN telegram_chat_id DROP NOT NULL`;

  // The old code keeps inserting groups (and rewriting telegram_chat_id on a
  // supergroup upgrade) until the new release is promoted. This trigger carries
  // those into the new columns, so nothing falls through the deploy gap.
  await sql`
    CREATE OR REPLACE FUNCTION groups_sync_chat() RETURNS trigger AS $$
    BEGIN
      IF NEW.telegram_chat_id IS NOT NULL AND (
        (TG_OP = 'INSERT' AND NEW.chat_type IS NULL AND NEW.chat_id IS NULL) OR
        (TG_OP = 'UPDATE' AND NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id)
      ) THEN
        NEW.chat_type := 'telegram';
        NEW.chat_id := NEW.telegram_chat_id::text;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS groups_sync_chat ON groups`;
  await sql`
    CREATE TRIGGER groups_sync_chat BEFORE INSERT OR UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION groups_sync_chat()
  `;

  // After the trigger exists, so no row can slip between the two.
  const filled = await sql`
    UPDATE groups
    SET    chat_type = 'telegram', chat_id = telegram_chat_id::text
    WHERE  chat_type IS NULL AND chat_id IS NULL AND telegram_chat_id IS NOT NULL
    RETURNING id
  `;
  console.log(`[0001-group-chat] backfilled ${filled.length} group row(s).`);

  // The new upsert (ON CONFLICT (chat_type, chat_id)) needs this before db:push would add it.
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_chat') THEN
        ALTER TABLE groups ADD CONSTRAINT groups_chat UNIQUE (chat_type, chat_id);
      END IF;
    END $$
  `;
}

/**
 * One-time migration: make groups platform-neutral (Discord support, Phase 0 —
 * docs/discord-support-design.zh-TW.md).
 *
 *   groups.telegram_chat_id (bigint, unique)
 *     → groups.platform ('telegram') + groups.external_chat_id (text),
 *       UNIQUE(platform, external_chat_id)
 *   expenses.notice_message_id                 integer → text
 *   group_delete_requests.telegram_message_id  integer → notice_message_id text
 *
 * Text because a Discord snowflake exceeds 2^53 and would be corrupted by the
 * `bigint(..., { mode: "number" })` columns these replace.
 *
 * Run BEFORE `pnpm db:push`:
 *   pnpm tsx scripts/migrate-group-platform.ts           # apply
 *   pnpm tsx scripts/migrate-group-platform.ts --print   # just show the SQL
 *   pnpm db:push                                         # should report no changes
 *
 * Unlike the earlier migrations this one does the whole schema change itself,
 * including dropping telegram_chat_id. Left to db:push, the column rename would
 * stop at an interactive "rename or create?" prompt, and dropping the old column
 * first would lose every group's chat id. Everything runs in ONE transaction
 * (Postgres DDL is transactional), so a failure leaves the old schema intact
 * and the script can simply be re-run.
 *
 * Deploy the matching code at the same time: the old code reads
 * telegram_chat_id and the new code reads external_chat_id, so whichever side
 * runs against the other's schema fails until both are in place.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import { neon } from "@neondatabase/serverless";

const STATEMENTS = [
  // groups: platform + external chat id, backfilled from telegram_chat_id. The
  // DEFAULT exists only to backfill existing rows; it is dropped again so code
  // that inserts a group must always say which platform it is on.
  `ALTER TABLE groups ADD COLUMN platform varchar(16) NOT NULL DEFAULT 'telegram'`,
  `ALTER TABLE groups ALTER COLUMN platform DROP DEFAULT`,
  `ALTER TABLE groups ADD COLUMN external_chat_id text`,
  `UPDATE groups SET external_chat_id = telegram_chat_id::text`,
  `ALTER TABLE groups ALTER COLUMN external_chat_id SET NOT NULL`,
  `ALTER TABLE groups ADD CONSTRAINT groups_platform_external_chat_id UNIQUE (platform, external_chat_id)`,
  // Also drops its unique constraint.
  `ALTER TABLE groups DROP COLUMN telegram_chat_id`,

  `ALTER TABLE expenses ALTER COLUMN notice_message_id TYPE text USING notice_message_id::text`,

  `ALTER TABLE group_delete_requests RENAME COLUMN telegram_message_id TO notice_message_id`,
  `ALTER TABLE group_delete_requests ALTER COLUMN notice_message_id TYPE text USING notice_message_id::text`,
];

if (process.argv.includes("--print")) {
  console.log("BEGIN;");
  for (const s of STATEMENTS) console.log(`${s};`);
  console.log("COMMIT;");
  process.exit(0);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.local and retry.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `;
  return rows.length > 0;
}

async function main() {
  const [hasOld, hasNew] = await Promise.all([
    columnExists("groups", "telegram_chat_id"),
    columnExists("groups", "external_chat_id"),
  ]);

  if (!hasOld && hasNew) {
    console.log("groups.external_chat_id already exists and telegram_chat_id is gone —");
    console.log("this migration has already been applied. Nothing to do.");
    return;
  }
  if (!hasOld) {
    console.error("ERROR: groups.telegram_chat_id not found, and neither is external_chat_id.");
    console.error("The groups table is not in a shape this script recognises. If db:push");
    console.error("already ran against the new schema it will have dropped the chat ids —");
    console.error("restore the DB from a backup and run this script BEFORE pnpm db:push.");
    process.exit(1);
  }
  if (hasNew) {
    // Both present: someone ran db:push (or part of this by hand) first. The
    // ADD COLUMN below would fail; refuse rather than guess which data is right.
    console.error("ERROR: groups has both telegram_chat_id and external_chat_id.");
    console.error("Inspect the table by hand — this script only migrates from the old shape.");
    process.exit(1);
  }

  await sql.transaction(STATEMENTS.map((s) => sql(s)));

  const [{ count }] = await sql`SELECT count(*)::int AS count FROM groups`;
  console.log(`Migrated ${count} groups to platform='telegram' + external_chat_id.`);
  console.log("Now run `pnpm db:push` — it should report no changes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

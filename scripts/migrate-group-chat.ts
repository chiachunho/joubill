/**
 * One-time migration: split groups.telegram_chat_id into chat_type + chat_id.
 *
 * Run BEFORE `pnpm db:push` when upgrading to the (chat_type, chat_id) schema:
 *   pnpm tsx scripts/migrate-group-chat.ts
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
  // Guard: telegram_chat_id must still exist on groups. If db:push ran first it was
  // dropped and the chat ids are unrecoverable without a DB restore.
  const colCheck = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'groups' AND column_name = 'telegram_chat_id'
  `;
  if (colCheck.length === 0) {
    console.error("ERROR: groups.telegram_chat_id column not found.");
    console.error("pnpm db:push has already dropped this column — the chat ids can no");
    console.error("longer be migrated automatically. Restore the DB from a backup and run");
    console.error("this script BEFORE pnpm db:push.");
    process.exit(1);
  }

  await sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_type varchar(16)`;
  await sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_id text`;

  // Only rows not migrated yet, so a re-run never overwrites a later edit.
  const result = await sql`
    UPDATE groups
    SET    chat_type = 'telegram', chat_id = telegram_chat_id::text
    WHERE  chat_type IS NULL AND chat_id IS NULL AND telegram_chat_id IS NOT NULL
    RETURNING id
  `;

  console.log(`Migrated ${result.length} group rows into (chat_type, chat_id).`);
  console.log("Now run `pnpm db:push` to drop groups.telegram_chat_id and add the constraints.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

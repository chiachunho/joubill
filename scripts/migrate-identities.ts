/**
 * One-time data migration: copy every users.telegram_id into auth_identities.
 *
 * Run AFTER `pnpm db:push` has created the auth_identities table:
 *   pnpm db:migrate-identities
 *
 * Safe to re-run — uses ON CONFLICT DO NOTHING.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import { isNotNull } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../src/db/schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = neon(DATABASE_URL);
const db = drizzle(client, { schema });

const usersWithTelegram = await db
  .select({ id: schema.users.id, telegramId: schema.users.telegramId })
  .from(schema.users)
  .where(isNotNull(schema.users.telegramId));

console.log(`Found ${usersWithTelegram.length} users with telegramId.`);

let inserted = 0;
for (const user of usersWithTelegram) {
  const result = await db
    .insert(schema.authIdentities)
    .values({
      userId: user.id,
      provider: "telegram",
      providerUid: String(user.telegramId),
    })
    .onConflictDoNothing()
    .returning();
  if (result.length > 0) inserted++;
}

console.log(
  `Done. Inserted ${inserted} new identity rows (${usersWithTelegram.length - inserted} already existed).`,
);

/**
 * Apply pending data migrations from migrations/, recorded in schema_migrations.
 *
 *   pnpm db:migrate
 *
 * Runs in the Vercel build (scripts/vercel-build.sh) BEFORE `db:push`, while the
 * previous release is still serving traffic. So a migration must work against
 * both the old and the new code: add columns, backfill, relax constraints —
 * never drop what the running release still reads. Dropping comes in a later
 * release, once nothing reads it.
 *
 * Every migration must be idempotent. There is no lock: two builds racing on
 * the same database would both run it, which is harmless only if it can be
 * re-run. A migration that throws fails the build, so the release never ships.
 *
 * A migration file is `export default async function up(sql) { … }`, where
 * `sql` is the Neon tagged-template client.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { migrationId, pendingMigrations } from "../src/lib/migration-plan";

export type MigrationSql = NeonQueryFunction<false, false>;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.local and retry.");
  process.exit(1);
}

const sql: MigrationSql = neon(DATABASE_URL);
const dir = fileURLToPath(new URL("../migrations/", import.meta.url));

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = (await sql`SELECT id FROM schema_migrations`).map((r) => r.id as string);
  const pending = pendingMigrations(readdirSync(dir), applied);

  if (pending.length === 0) {
    console.log("[migrate] up to date.");
    return;
  }

  for (const file of pending) {
    console.log(`[migrate] applying ${file}...`);
    const mod = await import(pathToFileURL(dir + file).href);
    if (typeof mod.default !== "function") {
      throw new Error(`${file} must default-export an async function (sql) => …`);
    }
    await mod.default(sql);
    await sql`INSERT INTO schema_migrations (id) VALUES (${migrationId(file)}) ON CONFLICT DO NOTHING`;
  }

  console.log(`[migrate] applied ${pending.length} migration(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

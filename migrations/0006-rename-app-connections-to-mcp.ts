/**
 * Rename the connection tables and the audit column once more, to the names issue #147's
 * 用詞 table fixed for code: `app_connections` → `mcp_connections`, `app_idempotency` →
 * `mcp_idempotency`, `record_audit_log.app_connection_id` → `mcp_connection_id`
 * (`'app'` already means the Mini App / Web App, so the connection tables don't use it).
 * Linked-application wording in the interface is unchanged.
 *
 * Like 0005 it has to run here: a drop and an add in one table is a prompt `db:push` can't
 * answer, and constraint, index and sequence names are renamed too because drizzle-kit
 * compares them and would otherwise drop and re-add each one. Foreign keys on other tables
 * that point at these tables carry the old name inside theirs, so every constraint in the
 * schema is checked, not only the renamed tables'.
 *
 * Nothing under the old names has been in a production release, so there is no two-release
 * overlap to keep; only a *preview* running the previous build reads the old names until its
 * own build lands. Idempotent: each step checks for the old name first.
 */
import type { MigrationSql } from "../scripts/migrate";

export default async function up(sql: MigrationSql) {
  await sql`
    DO $$
    DECLARE r record;
    BEGIN
      IF to_regclass('public.app_connections') IS NOT NULL
         AND to_regclass('public.mcp_connections') IS NULL THEN
        ALTER TABLE app_connections RENAME TO mcp_connections;
      END IF;
      IF to_regclass('public.app_idempotency') IS NOT NULL
         AND to_regclass('public.mcp_idempotency') IS NULL THEN
        ALTER TABLE app_idempotency RENAME TO mcp_idempotency;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'record_audit_log'
          AND column_name = 'app_connection_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'record_audit_log'
          AND column_name = 'mcp_connection_id'
      ) THEN
        ALTER TABLE record_audit_log RENAME COLUMN app_connection_id TO mcp_connection_id;
      END IF;

      -- Constraints first (a primary key or unique constraint renames its index with it).
      FOR r IN
        SELECT c.conname, c.conrelid::regclass::text AS tbl
        FROM pg_constraint c
        WHERE c.connamespace = 'public'::regnamespace
          AND c.conname ~ 'app_(connection|idempotency)'
      LOOP
        EXECUTE format(
          'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
          r.tbl, r.conname,
          regexp_replace(r.conname, 'app_(connection|idempotency)', 'mcp_\1', 'g')
        );
      END LOOP;

      FOR r IN
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname ~ 'app_(connection|idempotency)'
      LOOP
        EXECUTE format(
          'ALTER INDEX %I RENAME TO %I',
          r.indexname,
          regexp_replace(r.indexname, 'app_(connection|idempotency)', 'mcp_\1', 'g')
        );
      END LOOP;

      FOR r IN
        SELECT relname FROM pg_class
        WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace
          AND relname ~ 'app_(connection|idempotency)'
      LOOP
        EXECUTE format(
          'ALTER SEQUENCE %I RENAME TO %I',
          r.relname,
          regexp_replace(r.relname, 'app_(connection|idempotency)', 'mcp_\1', 'g')
        );
      END LOOP;
    END $$
  `;
}

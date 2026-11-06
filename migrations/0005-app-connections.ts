/**
 * Rename the MCP connection tables and the audit column to the names issue #147 settled on
 * ("連結的應用程式"): `agent_connections` → `app_connections`, `agent_idempotency` →
 * `app_idempotency`, `record_audit_log.agent_connection_id` → `app_connection_id`, and the
 * audit `source` value `'agent'` → `'mcp'` (`'app'` already means the Mini App / Web App).
 *
 * It has to run here: with a drop and an add in one table, `db:push` asks whether each is a
 * rename, a prompt the build can't answer. Constraint, index and sequence names are renamed
 * too, because drizzle-kit compares them and would otherwise drop and re-add each one.
 *
 * Nothing here has been in a production release, so the rename needs no two-release
 * overlap; the previous *preview* release reads the old names until its own build lands.
 * Idempotent: every step checks for the old name first, and a fresh database is a no-op.
 */
import type { MigrationSql } from "../scripts/migrate";

export default async function up(sql: MigrationSql) {
  await sql`
    DO $$
    DECLARE r record;
    BEGIN
      IF to_regclass('public.agent_connections') IS NOT NULL
         AND to_regclass('public.app_connections') IS NULL THEN
        ALTER TABLE agent_connections RENAME TO app_connections;
      END IF;
      IF to_regclass('public.agent_idempotency') IS NOT NULL
         AND to_regclass('public.app_idempotency') IS NULL THEN
        ALTER TABLE agent_idempotency RENAME TO app_idempotency;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'record_audit_log'
          AND column_name = 'agent_connection_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'record_audit_log'
          AND column_name = 'app_connection_id'
      ) THEN
        ALTER TABLE record_audit_log RENAME COLUMN agent_connection_id TO app_connection_id;
      END IF;

      -- Constraints first (a primary key or unique constraint renames its index with it).
      FOR r IN
        SELECT c.conname, c.conrelid::regclass::text AS tbl
        FROM pg_constraint c
        WHERE c.connamespace = 'public'::regnamespace
          AND c.conname ~ 'agent_(connection|idempotency)'
      LOOP
        EXECUTE format(
          'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
          r.tbl, r.conname,
          regexp_replace(r.conname, 'agent_(connection|idempotency)', 'app_\\1', 'g')
        );
      END LOOP;

      FOR r IN
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname ~ 'agent_(connection|idempotency)'
      LOOP
        EXECUTE format(
          'ALTER INDEX %I RENAME TO %I',
          r.indexname,
          regexp_replace(r.indexname, 'agent_(connection|idempotency)', 'app_\\1', 'g')
        );
      END LOOP;

      FOR r IN
        SELECT relname FROM pg_class
        WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace
          AND relname ~ 'agent_(connection|idempotency)'
      LOOP
        EXECUTE format(
          'ALTER SEQUENCE %I RENAME TO %I',
          r.relname,
          regexp_replace(r.relname, 'agent_(connection|idempotency)', 'app_\\1', 'g')
        );
      END LOOP;

      UPDATE record_audit_log SET source = 'mcp' WHERE source = 'agent';
    END $$
  `;
}

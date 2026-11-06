/**
 * expenses.spent_at (timestamptz) → expenses.spent_date (date), issue #144.
 *
 * Runs in the build while the previous release is still live, so it only adds,
 * backfills and relaxes: `spent_at` stays (schema.ts marks it deprecated) until a later
 * release drops it. Idempotent.
 *
 * The previous release keeps inserting and editing rows by `spent_at` until the new one
 * is promoted, and the new release writes only `spent_date`. `expenses_sync_spent`
 * keeps the two equal in both directions, so nothing falls through the deploy gap and
 * the previous release's reads (which still order and compare by `spent_at`) stay right.
 * Remove the trigger together with the column.
 *
 * Backfill uses the group's own zone, so an old bot record (a real time, not UTC noon)
 * lands on the same day the rate lookup always used for it: `/balance` does not move.
 * Every group is still on the default zone here, because `timezone` is only added now.
 */
import type { MigrationSql } from "../scripts/migrate";

export default async function up(sql: MigrationSql) {
  // A brand-new database has no tables yet: db:push creates them in their final shape.
  const [{ exists }] = await sql`SELECT to_regclass('public.expenses') IS NOT NULL AS exists`;
  if (!exists) return;

  // The backfill and the trigger read it, and db:push (which would add it) runs afterwards.
  await sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Taipei'`;
  // Nullable until db:push tightens it: the previous release's inserts leave it NULL, and the
  // trigger fills it before the row is stored.
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS spent_date date`;

  await sql`
    CREATE OR REPLACE FUNCTION expenses_sync_spent() RETURNS trigger AS $$
    DECLARE
      tz text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.spent_date IS NULL THEN
          -- previous release: it wrote only spent_at
          SELECT timezone INTO tz FROM groups WHERE id = NEW.group_id;
          NEW.spent_date := (NEW.spent_at AT TIME ZONE COALESCE(tz, 'Asia/Taipei'))::date;
        ELSE
          NEW.spent_at := (NEW.spent_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC';
        END IF;
      ELSIF NEW.spent_date IS NOT DISTINCT FROM OLD.spent_date
            AND NEW.spent_at IS DISTINCT FROM OLD.spent_at THEN
        -- previous release edited only spent_at
        SELECT timezone INTO tz FROM groups WHERE id = NEW.group_id;
        NEW.spent_date := (NEW.spent_at AT TIME ZONE COALESCE(tz, 'Asia/Taipei'))::date;
      ELSIF OLD.spent_date IS NOT NULL AND NEW.spent_date IS DISTINCT FROM OLD.spent_date THEN
        -- a real change of day (not the backfill filling in a NULL, which must leave spent_at alone)
        NEW.spent_at := (NEW.spent_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS expenses_sync_spent ON expenses`;
  await sql`
    CREATE TRIGGER expenses_sync_spent BEFORE INSERT OR UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION expenses_sync_spent()
  `;

  // After the trigger exists, so no row can slip between the two.
  const filled = await sql`
    UPDATE expenses e
    SET    spent_date = (e.spent_at AT TIME ZONE g.timezone)::date
    FROM   groups g
    WHERE  g.id = e.group_id AND e.spent_date IS NULL
    RETURNING e.id
  `;
  console.log(`[0004-spent-date] backfilled ${filled.length} expense row(s).`);
}

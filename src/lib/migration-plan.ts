/**
 * Which migrations still have to run. Pure so it can be unit-tested; the DB
 * side lives in scripts/migrate.ts.
 *
 * A migration is a file `migrations/NNNN-name.ts`. The numeric prefix fixes the
 * order, and the full file name (without extension) is the id recorded in
 * `schema_migrations`.
 */
const MIGRATION_FILE = /^(\d{4})-[a-z0-9][a-z0-9-]*\.ts$/;

export function migrationId(file: string): string {
  return file.replace(/\.ts$/, "");
}

/** Files that are not valid migration names are an error, not skipped: a typo'd name would otherwise never run. */
export function pendingMigrations(files: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  const migrations = files.filter((f) => !f.startsWith("."));

  const bad = migrations.find((f) => !MIGRATION_FILE.test(f));
  if (bad) throw new Error(`invalid migration file name: ${bad} (expected NNNN-name.ts)`);

  const seen = new Map<string, string>();
  for (const f of migrations) {
    const prefix = f.slice(0, 4);
    const other = seen.get(prefix);
    if (other) throw new Error(`migrations ${other} and ${f} share the number ${prefix}`);
    seen.set(prefix, f);
  }

  return migrations.filter((f) => !done.has(migrationId(f))).sort();
}

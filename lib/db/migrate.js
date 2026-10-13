/**
 * Migration runner.
 *
 * Idempotent: safe to call before every query batch, because the applied set is
 * memoised in-process after the first successful run. Each migration is written with
 * `CREATE … IF NOT EXISTS`, so re-applying one after an interrupted run is harmless.
 *
 * The whole script of a migration is applied in ONE atomic request
 * (`execAtomic`): a batched write on hosted libSQL, a BEGIN IMMEDIATE transaction on
 * the local file.
 */
import { exec, execAtomic, getRow, run } from "./driver.js";
import { MIGRATIONS } from "./schema.js";

let migrationsChecked = false;

async function ensureMigrationTable() {
  await exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     );`
  );
}

export async function migrate({ force = false } = {}) {
  if (migrationsChecked && !force) return { applied: [] };

  await ensureMigrationTable();

  const applied = [];
  for (const migration of MIGRATIONS) {
    const existing = await getRow("SELECT version FROM schema_migrations WHERE version = ?", [
      migration.version,
    ]);
    if (existing) continue;

    await execAtomic(migration.sql);
    await run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
      migration.version,
      migration.name,
      Math.floor(Date.now() / 1000),
    ]);
    applied.push(migration);
  }

  migrationsChecked = true;
  return { applied };
}

/** Test/script helper: forget the in-process memo so the next run re-checks. */
export function resetMigrationMemo() {
  migrationsChecked = false;
}

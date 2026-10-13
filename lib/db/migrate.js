/**
 * Migration runner. Idempotent: safe to call before every query batch, because
 * the applied set is memoised in-process after the first successful run.
 */
import { exec, getRow, run } from "./driver.js";
import { MIGRATIONS } from "./schema.js";

let migrationsChecked = false;

function ensureMigrationTable() {
  exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     );`
  );
}

export function migrate({ force = false } = {}) {
  if (migrationsChecked && !force) return { applied: [] };

  ensureMigrationTable();

  const applied = [];
  for (const migration of MIGRATIONS) {
    const existing = getRow("SELECT version FROM schema_migrations WHERE version = ?", [
      migration.version,
    ]);
    if (existing) continue;

    // Each migration is its own transaction so a failure leaves earlier ones applied.
    exec("BEGIN IMMEDIATE");
    try {
      exec(migration.sql);
      run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, Math.floor(Date.now() / 1000)]
      );
      exec("COMMIT");
      applied.push(migration);
    } catch (error) {
      try {
        exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw error;
    }
  }

  migrationsChecked = true;
  return { applied };
}

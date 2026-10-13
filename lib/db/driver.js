/**
 * CrowdFund persistence driver.
 *
 * The app previously had no database at all (wallet links lived in an in-memory
 * Map inside pages/api/wallet-link.js, so every restart lost them). This driver
 * provides a real, persistent store using Node's built-in `node:sqlite` module —
 * zero new dependencies, no native build step, works on Node 22.5+.
 *
 * Configuration
 * -------------
 *   CF_DATABASE_PATH   optional absolute/relative path to the SQLite file.
 *                      Defaults to <project root>/data/crowdfund.db
 *
 * Everything in `lib/db/*` is server-only: it must never be imported from a
 * client component or a page that runs in the browser bundle.
 *
 * Notes for future hosting moves
 * ------------------------------
 * All SQL in this folder is written with `?` positional placeholders and
 * standard SQL, so a Postgres driver can be dropped in later by implementing the
 * same `query`/`get`/`run`/`transaction` surface (translate `?` to `$n`).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_RELATIVE_PATH = path.join("data", "crowdfund.db");

/** node:sqlite only accepts null | number | bigint | string | Uint8Array. */
export function toParam(value) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  return value;
}

function normalizeParams(params) {
  const list = params === undefined ? [] : Array.isArray(params) ? params : [params];
  return list.map(toParam);
}

export function resolveDatabasePath() {
  const configured = process.env.CF_DATABASE_PATH;
  if (configured && configured.trim()) {
    return path.isAbsolute(configured.trim())
      ? configured.trim()
      : path.resolve(process.cwd(), configured.trim());
  }
  return path.resolve(process.cwd(), DEFAULT_DB_RELATIVE_PATH);
}

function openDatabase() {
  const file = resolveDatabasePath();

  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const database = new DatabaseSync(file);

  // Durability + concurrency: WAL keeps readers from blocking the writer, and
  // busy_timeout makes concurrent writers wait for the lock instead of failing
  // immediately (important for the atomic CrowdFund User ID allocation).
  if (file !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL;");
  }
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA foreign_keys = ON;");

  return { database, file };
}

/**
 * Connections are cached on globalThis so a Next.js dev-server hot reload does
 * not open a new handle on every module re-evaluation.
 */
function cache() {
  if (!globalThis.__crowdfundDb) {
    globalThis.__crowdfundDb = { database: null, file: null };
  }
  return globalThis.__crowdfundDb;
}

export function getDatabase() {
  const store = cache();
  if (!store.database) {
    const { database, file } = openDatabase();
    store.database = database;
    store.file = file;
  }
  return store.database;
}

export function getDatabaseFile() {
  getDatabase();
  return cache().file;
}

export function query(sql, params) {
  return getDatabase().prepare(sql).all(...normalizeParams(params));
}

export function getRow(sql, params) {
  const row = getDatabase().prepare(sql).get(...normalizeParams(params));
  return row === undefined ? null : row;
}

export function run(sql, params) {
  const result = getDatabase().prepare(sql).run(...normalizeParams(params));
  return {
    changes: Number(result.changes ?? 0),
    lastInsertRowid:
      result.lastInsertRowid === undefined ? null : Number(result.lastInsertRowid),
  };
}

export function exec(sql) {
  getDatabase().exec(sql);
}

/**
 * Serializes a unit of work behind SQLite's write lock (`BEGIN IMMEDIATE`).
 * Used for the concurrency-sensitive CrowdFund User ID allocation and for the
 * idempotent upserts that must not create duplicate rows under parallel calls.
 */
export function transaction(work) {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // A failed rollback must not mask the original error.
    }
    throw error;
  }
}

export function closeDatabase() {
  const store = cache();
  if (store.database) {
    store.database.close();
    store.database = null;
  }
}

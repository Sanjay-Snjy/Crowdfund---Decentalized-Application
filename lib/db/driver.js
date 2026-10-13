/**
 * CrowdFund persistence driver — one interface, two back ends.
 *
 *   Hosted libSQL (Turso)   TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 *                           Reached over HTTP/WebSocket by @libsql/client, so it
 *                           works on hosts with a READ-ONLY, EPHEMERAL filesystem
 *                           (Vercel, Netlify, Cloudflare-style serverless) where a
 *                           SQLite file can neither be created nor survive a cold
 *                           start.
 *
 *   Local SQLite file       default, or CF_DATABASE_PATH
 *                           Node's built-in `node:sqlite`, zero dependencies and
 *                           nothing to configure for local development.
 *
 * Both back ends speak the same SQLite SQL (libSQL is SQLite), so `?` positional
 * placeholders, AUTOINCREMENT, ON CONFLICT and RETURNING all behave identically and
 * the schema in ./schema.js is used unchanged.
 *
 * Everything here is async because the hosted back end is a network call. The
 * synchronous `query`/`getRow`/`run`/`transaction` helpers that used to exist are
 * now promise-returning; `await` them.
 *
 * Everything in `lib/db/*` is server-only: it must never be imported from a client
 * component or a page that runs in the browser bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_DB_RELATIVE_PATH = path.join("data", "crowdfund.db");

/**
 * Raised when the database cannot be reached at all (missing hosted credentials on
 * a host without a writable disk, bad token, network failure). API routes turn this
 * into a 503 with an actionable hint instead of a blank 500.
 */
export class DatabaseUnavailableError extends Error {
  constructor(message, { cause = null, hint = null, backend = null } = {}) {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.code = "DATABASE_UNAVAILABLE";
    this.hint = hint;
    this.backend = backend;
    if (cause) this.cause = cause;
  }
}

/** node:sqlite and libSQL both only accept null | number | bigint | string | bytes. */
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

/**
 * Test-only seam. The hosted-libSQL branch can be exercised without real Turso
 * credentials by injecting a client that implements `execute`/`batch`/`transaction`
 * (see tests/libsql-driver.test.js). Never set outside of tests.
 */
let injectedClientFactory = null;

export function __setLibsqlClientFactory(factory) {
  injectedClientFactory = factory;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Hosted libSQL credentials, if this deployment has them. */
export function getRemoteConfig() {
  const url = firstNonEmpty(
    process.env.TURSO_DATABASE_URL,
    process.env.LIBSQL_DATABASE_URL,
    process.env.CF_LIBSQL_URL
  );
  if (!url) return null;

  const authToken = firstNonEmpty(
    process.env.TURSO_AUTH_TOKEN,
    process.env.LIBSQL_AUTH_TOKEN,
    process.env.CF_LIBSQL_TOKEN
  );

  // A remote URL without a token is almost always a misconfiguration; libSQL would
  // fail later with a much less obvious message.
  if (!authToken) {
    throw new DatabaseUnavailableError(
      "TURSO_DATABASE_URL is set but no auth token is configured",
      {
        hint: "Set TURSO_AUTH_TOKEN (Turso → your database → Create Token) next to TURSO_DATABASE_URL.",
        backend: "libsql",
      }
    );
  }

  return { url, authToken };
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

/** Human-readable description of the active store (never includes the token). */
export function describeBackend() {
  try {
    const remote = getRemoteConfig();
    if (remote) {
      const masked = remote.url.replace(/\/\/([^@/]+)@/, "//***@");
      return { kind: "libsql", location: masked, persistent: true };
    }
  } catch (error) {
    return { kind: "libsql", location: "(misconfigured)", persistent: true, error: error.message };
  }
  return { kind: "sqlite", location: resolveDatabasePath(), persistent: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapters — both expose: all(sql, params) | get(sql, params) | run(sql, params) | exec(sql)
// ─────────────────────────────────────────────────────────────────────────────

function resultSetToRows(resultSet) {
  const columns = resultSet.columns.map((column) => column.name);
  return resultSet.rows.map((row) => {
    const record = {};
    columns.forEach((name, index) => {
      record[name] = row[index];
    });
    return record;
  });
}

function resultSetToRun(resultSet) {
  const lastInsertRowid = resultSet.lastInsertRowid;
  return {
    changes: Number(resultSet.rowsAffected ?? 0),
    lastInsertRowid:
      lastInsertRowid === undefined || lastInsertRowid === null
        ? null
        : Number(lastInsertRowid),
  };
}

/**
 * libSQL can only execute one statement per call, so a migration script is split
 * here (quote- and comment-aware) and executed statement by statement.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];

    if (!inSingle && !inDouble && char === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      current += "\n";
      continue;
    }

    if (char === "'" && !inDouble) {
      // A doubled quote ('') is an escaped quote, not a terminator.
      if (inSingle && sql[index + 1] === "'") {
        current += "''";
        index += 1;
        continue;
      }
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      if (inDouble && sql[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }
      inDouble = !inDouble;
    }

    if (char === ";" && !inSingle && !inDouble) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

function libsqlAdapter(client) {
  return {
    kind: "libsql",
    raw: client,
    async all(sql, params) {
      const resultSet = await client.execute({ sql, args: normalizeParams(params) });
      return resultSetToRows(resultSet);
    },
    async get(sql, params) {
      const rows = await this.all(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    async run(sql, params) {
      const resultSet = await client.execute({ sql, args: normalizeParams(params) });
      return resultSetToRun(resultSet);
    },
    async exec(sql) {
      for (const statement of splitStatements(sql)) {
        await client.execute(statement);
      }
    },
    /** All statements in ONE atomic write request (libSQL batches are transactional). */
    async execAtomic(sql) {
      const statements = splitStatements(sql);
      if (statements.length === 0) return;
      await client.batch(statements, "write");
    },
    async begin() {
      await client.execute("BEGIN IMMEDIATE");
    },
    async commit() {
      await client.execute("COMMIT");
    },
    async rollback() {
      await client.execute("ROLLBACK");
    },
  };
}

function sqliteAdapter(database, file) {
  return {
    kind: "sqlite",
    raw: database,
    location: file,
    async all(sql, params) {
      return database.prepare(sql).all(...normalizeParams(params));
    },
    async get(sql, params) {
      const row = database.prepare(sql).get(...normalizeParams(params));
      return row === undefined ? null : row;
    },
    async run(sql, params) {
      const result = database.prepare(sql).run(...normalizeParams(params));
      return {
        changes: Number(result.changes ?? 0),
        lastInsertRowid:
          result.lastInsertRowid === undefined ? null : Number(result.lastInsertRowid),
      };
    },
    async exec(sql) {
      database.exec(sql);
    },
    async execAtomic(sql) {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(sql);
        database.exec("COMMIT");
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Ignore: the original error is what matters.
        }
        throw error;
      }
    },
    async begin() {
      database.exec("BEGIN IMMEDIATE");
    },
    async commit() {
      database.exec("COMMIT");
    },
    async rollback() {
      database.exec("ROLLBACK");
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection cache
// ─────────────────────────────────────────────────────────────────────────────

function state() {
  if (!globalThis.__crowdfundDb) {
    globalThis.__crowdfundDb = {
      adapter: null,
      sqliteFile: null,
      transactions: new AsyncLocalStorage(),
    };
  }
  if (!globalThis.__crowdfundDb.transactions) {
    globalThis.__crowdfundDb.transactions = new AsyncLocalStorage();
  }
  return globalThis.__crowdfundDb;
}

function openSqliteFile() {
  const file = resolveDatabasePath();

  if (file !== ":memory:") {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch (error) {
      throw new DatabaseUnavailableError(
        `Cannot create the database directory for ${file} (${error.code || error.message})`,
        {
          cause: error,
          backend: "sqlite",
          hint:
            "This host has no writable disk. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to use a hosted libSQL database instead, or point CF_DATABASE_PATH at a persistent volume.",
        }
      );
    }
  }

  return file;
}

/**
 * Lazily opens the configured back end. A hosted URL wins over the local file, so the
 * same code runs locally (file) and on a serverless host (Turso) without a branch in
 * any caller.
 */
export async function connect() {
  const store = state();
  if (store.adapter) return store.adapter;

  try {
    const remote = getRemoteConfig();

    if (remote) {
      const createClient =
        injectedClientFactory ||
        (await import("@libsql/client/web")).createClient;
      const client = await createClient({ url: remote.url, authToken: remote.authToken });
      store.adapter = libsqlAdapter(client);
      return store.adapter;
    }

    const file = openSqliteFile();
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(file);

    // Durability + concurrency. WAL and busy_timeout only make sense for a local file
    // (and are rejected by some remote libSQL endpoints), so they stay here.
    database.exec("PRAGMA busy_timeout = 5000;");
    if (file !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL;");
    }
    database.exec("PRAGMA foreign_keys = ON;");

    store.sqliteFile = file;
    store.adapter = sqliteAdapter(database, file);
    return store.adapter;
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(
      `Could not open the CrowdFund database: ${error.message}`,
      { cause: error, backend: getRemoteConfig() ? "libsql" : "sqlite" }
    );
  }
}

/** Resolves the connection that is currently in scope (transaction or default). */
async function active() {
  const store = state();
  const transactionAdapter = store.transactions.getStore();
  if (transactionAdapter) return transactionAdapter;
  return connect();
}

/** The open connection handle (used by scripts that need the raw client). */
export async function getDatabase() {
  const adapter = await connect();
  return adapter.raw;
}

export async function getDatabaseFile() {
  const backend = describeBackend();
  if (backend.kind === "libsql") return backend.location;
  await connect();
  return state().sqliteFile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query surface
// ─────────────────────────────────────────────────────────────────────────────

export async function query(sql, params) {
  return (await active()).all(sql, params);
}

export async function getRow(sql, params) {
  return (await active()).get(sql, params);
}

export async function run(sql, params) {
  return (await active()).run(sql, params);
}

export async function exec(sql) {
  return (await active()).exec(sql);
}

/**
 * Runs a multi-statement script atomically: one batched write request on libSQL, one
 * BEGIN IMMEDIATE transaction on the local file. Used for migrations.
 */
export async function execAtomic(sql) {
  const adapter = await active();
  if (typeof adapter.execAtomic === "function") return adapter.execAtomic(sql);
  return adapter.exec(sql);
}

/**
 * Runs `work` inside a write transaction.
 *
 *   - local SQLite: BEGIN IMMEDIATE … COMMIT on the single connection.
 *   - hosted libSQL: an interactive write transaction; the connection is published
 *     through AsyncLocalStorage so the `query`/`getRow`/`run` helpers called inside
 *     `work` use the same transaction instead of opening a second one.
 *
 * Prefer single-statement atomicity (ON CONFLICT, RETURNING) for the hot paths: a
 * transaction is only worth its round trips when several statements must land
 * together.
 */
export async function transaction(work) {
  const store = state();
  const adapter = await connect();

  if (adapter.kind === "sqlite") {
    await adapter.begin();
    try {
      const result = await work();
      await adapter.commit();
      return result;
    } catch (error) {
      try {
        await adapter.rollback();
      } catch {
        // A failed rollback must not mask the original error.
      }
      throw error;
    }
  }

  let handle;
  try {
    handle = await adapter.raw.transaction("write");
  } catch (error) {
    // The HTTP-only libSQL transport cannot hold a transaction open. Every caller is
    // written so that its invariants hold through UNIQUE constraints and idempotent
    // statements too, so degrade to a plain sequential run instead of failing the
    // request — but say so loudly, because atomicity is genuinely lost.
    console.warn(
      `[db] interactive transactions unavailable on this transport (${error.message}); running the write path without one`
    );
    return work();
  }

  const transactionAdapter = {
    ...libsqlAdapter(handle),
    kind: "libsql",
  };

  try {
    const result = await store.transactions.run(transactionAdapter, work);
    await handle.commit();
    return result;
  } catch (error) {
    try {
      await handle.rollback();
    } catch {
      // Ignore: the transaction may already be closed by the failure.
    }
    throw error;
  } finally {
    if (typeof handle.close === "function") {
      try {
        await handle.close();
      } catch {
        // Closing an already-finished transaction is not an error.
      }
    }
  }
}

export async function closeDatabase() {
  const store = state();
  if (!store.adapter) return;

  const { raw, kind } = store.adapter;
  store.adapter = null;
  store.sqliteFile = null;

  try {
    if (typeof raw?.close === "function") await raw.close();
  } catch {
    // Closing a connection that is already gone is not an error.
  }
  void kind;
}

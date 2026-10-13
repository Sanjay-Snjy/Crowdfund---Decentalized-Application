/**
 * Server-side database facade.
 *
 * Import from API routes / getServerSideProps / scripts only. Client bundles must
 * never touch this module — it pulls in `node:sqlite` or the libSQL client.
 *
 *   import { db } from "../../lib/db";
 *   await db.init();                                   // migrations (memoised)
 *   const users = await db.users.listRecentUsers({ limit: 20 });
 *
 * The store itself is either a hosted libSQL database (TURSO_DATABASE_URL) or a local
 * SQLite file — see ./driver.js.
 */
import { migrate } from "./migrate.js";
import {
  closeDatabase,
  connect,
  describeBackend,
  exec,
  execAtomic,
  getDatabaseFile,
  getRow,
  query,
  run,
  transaction,
} from "./driver.js";
import * as users from "./users.js";
import * as sessions from "./sessions.js";
import * as chainEvents from "./chainEvents.js";
import * as campaigns from "./campaigns.js";

let initPromise = null;

async function runInit() {
  await connect();
  await migrate();
  return getDatabaseFile();
}

/**
 * Opens the database and applies pending migrations once per process. Concurrent
 * callers share the same in-flight promise, so a burst of requests cannot run the
 * migrations twice. A failure clears the memo so the next request retries.
 */
export function initDb() {
  if (!initPromise) {
    initPromise = runInit().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

export const db = {
  init: initDb,
  path: getDatabaseFile,
  backend: describeBackend,
  close: closeDatabase,
  users,
  sessions,
  chainEvents,
  campaigns,
  driver: { exec, execAtomic, getRow, query, run, transaction },
};

/** Raw SQL surface, exported for scripts and tests that need one-off queries. */
export const driverApi = { exec, execAtomic, getRow, query, run, transaction };

export { users, sessions, chainEvents, campaigns, migrate, getDatabaseFile };
export default db;

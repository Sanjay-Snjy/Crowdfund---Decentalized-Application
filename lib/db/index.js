/**
 * Server-side database facade.
 *
 * Import from API routes / getServerSideProps only. Client bundles must never
 * touch this module — it pulls in `node:sqlite`.
 *
 *   import { db } from "../../lib/db";
 *   const users = db.users.listRecentUsers({ limit: 20 });
 */
import { migrate } from "./migrate.js";
import {
  getDatabaseFile,
  closeDatabase,
  exec,
  getRow,
  query,
  run,
  transaction,
} from "./driver.js";
import * as users from "./users.js";
import * as sessions from "./sessions.js";
import * as chainEvents from "./chainEvents.js";
import * as campaigns from "./campaigns.js";

let migrated = false;

/** Run pending migrations once per process. Safe to call on every request. */
export function initDb() {
  if (!migrated) {
    migrate();
    migrated = true;
  }
  return getDatabaseFile();
}

export const db = {
  init: initDb,
  path: getDatabaseFile,
  close: closeDatabase,
  users,
  sessions,
  chainEvents,
  campaigns,
  driver: { exec, getRow, query, run, transaction },
};

/** Raw SQL surface, exported for scripts and tests that need one-off queries. */
export const driverApi = { exec, getRow, query, run, transaction };

export { users, sessions, chainEvents, campaigns, migrate, getDatabaseFile };
export default db;

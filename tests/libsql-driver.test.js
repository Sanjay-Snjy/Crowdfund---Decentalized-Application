/**
 * Hosted-libSQL path tests.
 *
 * The deployment target is a serverless host with a READ-ONLY filesystem, so the
 * store is a hosted libSQL database reached over HTTP/WebSocket. Real Turso
 * credentials are not required to test that code path: a libSQL-compatible client is
 * injected in front of a local SQLite file, so the exact production code runs —
 * one statement per `execute`, batched migrations, libSQL ResultSet shapes
 * (`rows`/`rowsAffected`/`lastInsertRowid`), interactive transactions and the
 * AsyncLocalStorage transaction scope.
 *
 * What this proves: the remote branch of the driver is wired correctly and the SQL
 * the app uses (AUTOINCREMENT, ON CONFLICT DO NOTHING/DO UPDATE, UPDATE … RETURNING,
 * statement splitting) behaves as libSQL does. What it does not prove: the network
 * transport itself — that is checked against the real database by
 * `node scripts/verify-indexer.mjs` once TURSO_DATABASE_URL is configured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crowdfund-libsql-"));
const dbFile = path.join(tempDir, "libsql.db");

// ── A minimal libSQL client over the local driver ────────────────────────────
/**
 * Reproduces the REAL `@libsql/client` (0.18) ResultSet shape, which is what the
 * deployed host uses:
 *   - `columns` is an array of plain STRINGS (`Array<string>`), not `{ name }` objects;
 *   - every row is array-like AND object-like (`row.amount_wei` and `row[0]` both work),
 *     with a `length` property.
 *
 * Getting this wrong is invisible to the local SQLite path, so it is modelled
 * exactly here: an earlier stub returned `columns: [{ name }]` with value arrays,
 * which made the driver's mapping look correct while every hosted-database read
 * actually returned rows whose fields were all `undefined`.
 */
function makeLibsqlRow(record) {
  const names = Object.keys(record);
  const row = { length: names.length };
  names.forEach((name, index) => {
    row[index] = record[name];
    row[name] = record[name];
  });
  return row;
}

function createFakeLibsqlClient() {
  const database = new DatabaseSync(dbFile);
  database.exec("PRAGMA foreign_keys = ON;");

  const execute = (sql, args = []) => {
    const statement = database.prepare(sql);
    const params = (args || []).map((value) => (value === undefined ? null : value));
    const returnsRows = /^\s*(select|with|pragma|explain)/i.test(sql) || /\breturning\b/i.test(sql);

    if (!returnsRows) {
      const result = statement.run(...params);
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        rowsAffected: Number(result.changes ?? 0),
        lastInsertRowid:
          result.lastInsertRowid === undefined ? undefined : BigInt(result.lastInsertRowid),
      };
    }

    const records = statement.all(...params);
    const columns = records.length > 0 ? Object.keys(records[0]) : [];
    return {
      columns,
      columnTypes: columns.map(() => ""),
      rows: records.map(makeLibsqlRow),
      rowsAffected: 0,
      lastInsertRowid: undefined,
    };
  };

  const asHranaTx = (name) => ({
    execute: (statement) => {
      const { sql, args } = typeof statement === "string" ? { sql: statement } : statement;
      return execute(sql, args);
    },
    commit: () => {
      database.exec("COMMIT");
      void name;
      return Promise.resolve();
    },
    rollback: () => {
      database.exec("ROLLBACK");
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  });

  return {
    // libSQL accepts either a SQL string or an InStatement object.
    execute: (statement, args) =>
      Promise.resolve(
        typeof statement === "string"
          ? execute(statement, args)
          : execute(statement.sql, statement.args)
      ),
    batch: (statements) => {
      // libSQL runs a batch inside one transaction.
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) =>
          typeof statement === "string"
            ? execute(statement)
            : execute(statement.sql, statement.args)
        );
        database.exec("COMMIT");
        return Promise.resolve(results);
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error);
      }
    },
    transaction: (mode) => {
      database.exec(`BEGIN ${mode === "read" ? "DEFERRED" : "IMMEDIATE"}`);
      return Promise.resolve(asHranaTx(mode));
    },
    close: () => {
      database.close();
      return Promise.resolve();
    },
  };
}

// Force the hosted branch: a libSQL URL plus a token, with the client injected.
process.env.TURSO_DATABASE_URL = "libsql://crowdfund-test.example.turso.io";
process.env.TURSO_AUTH_TOKEN = "test-token";
delete process.env.CF_DATABASE_PATH;

const driver = await import("../lib/db/driver.js");
driver.__setLibsqlClientFactory(async () => createFakeLibsqlClient());

const { initDb, db } = await import("../lib/db/index.js");

await initDb();

test("the driver reports the hosted backend, not a local file", () => {
  const backend = db.backend();
  assert.equal(backend.kind, "libsql");
  assert.equal(backend.persistent, true);
  assert.equal(backend.location.includes("test-token"), false, "the token is never exposed");
});

test("migrations run through the batched write path", async () => {
  const row = await db.driver.getRow(
    "SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 1"
  );
  assert.equal(Number(row.total), 1);

  // Every table the app depends on exists after the batched migration.
  for (const table of ["users", "counters", "chain_transactions", "reward_events", "sync_state"]) {
    const exists = await db.driver.getRow(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table]
    );
    assert.ok(exists, `${table} exists`);
  }
});

test("UPDATE … RETURNING allocates CrowdFund User IDs sequentially", async () => {
  const first = await db.users.ensureUserFromClerk({
    clerkUserId: "user_libsql_1",
    displayName: "Hosted One",
  });
  const second = await db.users.ensureUserFromClerk({
    clerkUserId: "user_libsql_2",
    displayName: "Hosted Two",
  });

  assert.equal(first.cf_user_id, "CF-0001");
  assert.equal(second.cf_user_id, "CF-0002");
});

test("registration stays idempotent over the hosted path (ON CONFLICT DO NOTHING)", async () => {
  const first = await db.users.ensureUserFromClerk({
    clerkUserId: "user_libsql_1",
    displayName: "Hosted One",
  });
  const retry = await db.users.ensureUserFromClerk({
    clerkUserId: "user_libsql_1",
    displayName: "Hosted One (renamed)",
  });

  assert.equal(retry.id, first.id, "a retry returns the same profile");
  assert.equal(retry.cf_user_id, first.cf_user_id);
  assert.equal(retry.display_name, "Hosted One (renamed)");

  const total = await db.users.countUsers();
  assert.equal(total, 2, "no duplicate profile was created");
});

test("interactive transactions run inside the AsyncLocalStorage scope", async () => {
  const wallet = "0x7777777777777777777777777777777777777777";

  const linked = await db.users.linkWalletToUser({ userId: 1, address: wallet });
  assert.equal(linked.wallet_address, wallet);
  assert.equal(linked.cf_user_id, "CF-0001");

  // The wallet resolves to exactly one profile, and the wallet-only profile that
  // owned it (created inside the transaction) was retired, not deleted.
  const owner = await db.users.getUserByWallet(wallet);
  assert.equal(owner.id, 1);
});

test("donation reads and totals work over the hosted path", async () => {
  await db.chainEvents.upsertChainEvent({
    chainId: 11155111,
    contractAddress: "0x43cFa879c2dbC2C87353af41D0043b35fA24f484",
    txHash: "0x" + "ab".repeat(32),
    logIndex: 0,
    blockNumber: 100,
    blockTimestamp: 1790000000,
    eventType: "contribution",
    campaignId: 1,
    campaignName: "Hosted Campaign",
    donorWallet: "0x7777777777777777777777777777777777777777",
    amountWei: "400000000000000000",
    status: "confirmed",
    confirmations: 5,
  });

  // The indexer attaches profiles to indexed rows after inserting them.
  const linked = await db.chainEvents.linkEventOwners();
  assert.equal(linked, 1, "the donation is attached to the profile that owns the wallet");

  const donations = await db.chainEvents.listRecentDonations({ limit: 5 });
  assert.equal(donations.length, 1);
  assert.equal(donations[0].amountWei, "400000000000000000");
  assert.equal(donations[0].cfUserId, "CF-0001", "the linked wallet resolves to its CrowdFund ID");

  const totals = await db.chainEvents.transactionTotals({});
  assert.equal(totals.confirmedDonations, 1);
  assert.equal(totals.confirmedWei, "400000000000000000");
});

test("sync state round-trips through the ON CONFLICT upsert", async () => {
  await db.chainEvents.setSyncState("test-key", "12345");
  const state = await db.chainEvents.getSyncState("test-key");
  assert.equal(state.value, "12345");

  await db.chainEvents.setSyncState("test-key", "12346");
  assert.equal((await db.chainEvents.getSyncState("test-key")).value, "12346");
});

test("a remote URL without a token fails loudly instead of silently using a file", async () => {
  const { getRemoteConfig } = driver;
  const token = process.env.TURSO_AUTH_TOKEN;
  delete process.env.TURSO_AUTH_TOKEN;

  assert.throws(
    () => getRemoteConfig(),
    (error) => error.code === "DATABASE_UNAVAILABLE" && /auth token/i.test(error.message)
  );

  process.env.TURSO_AUTH_TOKEN = token;
});

test.after(async () => {
  await driver.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Shared helpers for the Node test suite.
 *
 * Each test file gets its own temporary SQLite file so suites can run in any
 * order (and in parallel) without stepping on each other's data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function useTempDatabase(prefix = "crowdfund-test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));

  // Tests always run against a throwaway local SQLite file: a hosted libSQL URL in
  // the developer's environment must never be used as a test target.
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.LIBSQL_DATABASE_URL;
  delete process.env.LIBSQL_AUTH_TOKEN;
  delete process.env.CF_LIBSQL_URL;
  delete process.env.CF_LIBSQL_TOKEN;

  process.env.CF_DATABASE_PATH = path.join(dir, "test.db");
  return dir;
}

export function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export const ADDRESSES = {
  alice: "0x1111111111111111111111111111111111111111",
  bob: "0x2222222222222222222222222222222222222222",
  carol: "0x3333333333333333333333333333333333333333",
  contract: "0x43cfa879c2dbc2c87353af41d0043b35fa24f484",
};

export const CHAIN_ID = 11155111;

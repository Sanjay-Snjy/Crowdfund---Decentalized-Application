/**
 * Guard for the committed environment template.
 *
 * `.env.example` is published together with the repository, and removing a value in a
 * later commit does not un-publish it (the value stays readable in the git history), so
 * the template must never carry a real credential. A Turso auth token once lived here;
 * this suite fails loudly if anything like it comes back.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(here, "..", ".env.example");
const source = fs.readFileSync(templatePath, "utf8");

/** Every `NAME=value` line of the template, with trailing comments removed. */
const entries = source
  .split(/\r?\n/)
  .filter((line) => /^[A-Z0-9_]+=/.test(line))
  .map((line) => {
    const index = line.indexOf("=");
    return {
      key: line.slice(0, index),
      value: line.slice(index + 1).split("#")[0].trim(),
    };
  });

/** A value is safe to publish when it is empty or an obvious `<placeholder>`. */
const isPlaceholder = (value) => /<[^>]+>/.test(value);

test("the template documents the variables the app reads", () => {
  const keys = new Set(entries.map((entry) => entry.key));
  const expected = [
    "NEXT_PUBLIC_RPC_URL",
    "SEPOLIA_RPC_URL",
    "CF_CONTRACT_ADDRESS",
    "CF_INDEX_START_BLOCK",
    "CF_INDEX_LOOKBACK_BLOCKS",
    "CF_CONFIRMATIONS_REQUIRED",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "CLERK_SECRET_KEY",
    "CLERK_WEBHOOK_SIGNING_SECRET",
    "CF_ADMIN_WALLET_ADDRESSES",
    "PINATA_JWT",
  ];

  for (const key of expected) {
    assert.ok(keys.has(key), `${key} must be documented in .env.example`);
  }
});

test("no secret-shaped variable carries a real value", () => {
  const secretish = /(SECRET|TOKEN|JWT|PASSWORD|PRIVATE|KEY)/i;
  const offenders = entries.filter(
    (entry) => secretish.test(entry.key) && entry.value && !isPlaceholder(entry.value)
  );

  assert.deepEqual(
    offenders.map((entry) => entry.key),
    [],
    "secrets belong in .env.local and the host's dashboard, never in the committed template"
  );
});

test("no real database URL, JWT, provider key or private key is committed", () => {
  // Hosts are only a leak when they are not part of a `<placeholder>` such as
  // libsql://<your-database>-<your-org>.aws-<region>.turso.io
  const hosts = [
    [/\.turso\.io/i, "a real Turso host"],
    [/\.neon\.tech|\.supabase\.co/i, "a real hosted-database host"],
  ];
  const credentials = [
    [/^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, "a JWT"],
    [/^sk_(test|live)_[A-Za-z0-9]{16,}$/, "a Clerk secret key"],
    [/^whsec_[A-Za-z0-9]{16,}$/, "a webhook signing secret"],
    [/^0x[0-9a-f]{64}$/i, "a private key"],
  ];

  for (const entry of entries) {
    if (entry.value && !isPlaceholder(entry.value)) {
      for (const [pattern, description] of hosts) {
        assert.equal(
          pattern.test(entry.value),
          false,
          `${entry.key} must not contain ${description}`
        );
      }
    }

    for (const [pattern, description] of credentials) {
      assert.equal(
        pattern.test(entry.value),
        false,
        `${entry.key} must not contain ${description}`
      );
    }
  }
});

#!/usr/bin/env node
/**
 * Chain-failure hardening.
 *
 * A rate-limited or unreachable Sepolia RPC used to surface as
 * `{"error":"Internal server error"}` (HTTP 500) on the routes that read the chain
 * directly — the deployed site showed exactly that toast. It must instead answer
 *   502 {"error":"Chain data unavailable", "hint":"…Set SEPOLIA_RPC_URL…"}
 * while contract rejections keep their 404 handling and database failures keep 503.
 *
 *   node tests/chain-errors.test.js
 *
 * Part 1 is pure classification. Part 2 runs the real route handlers against a
 * deliberately dead RPC endpoint (127.0.0.1:9, nothing listens there), so the fix is
 * verified through the same code path the browser hits.
 */
import assert from "node:assert/strict";

import { serverError } from "../lib/api/http.js";
import { ChainUnavailableError, clearProvider, isChainTransportFailure } from "../lib/chain/provider.js";

// Dead RPC: connection refused, immediately. Set before any provider is built.
process.env.SEPOLIA_RPC_URL = "http://127.0.0.1:9";
process.env.NETWORK_RPC_URL = "";
clearProvider();

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function asError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  return Object.assign(error, extra);
}

function withDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`test deadline exceeded: ${label}`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ── 1. Classification ────────────────────────────────────────────────────────
{
  const rateLimited = asError("SERVER_ERROR", 'failed (status=429) {"error":"rate limit exceeded"}');
  record("an ethers 429 counts as a transport failure", isChainTransportFailure(rateLimited));

  record("a refused connection counts as a transport failure", isChainTransportFailure(asError("NETWORK_ERROR", "connect ECONNREFUSED 127.0.0.1:9")));

  record("our own rpc timeout counts as a transport failure", isChainTransportFailure(asError("CHAIN_TIMEOUT", "Timed out after 15000ms: getCampaign")));

  const revert = asError("CALL_EXCEPTION", "execution reverted: Invalid campaign ID");
  record("a contract rejection never counts as an outage", !isChainTransportFailure(revert), revert.message);

  record("a database failure is not blamed on the chain", !isChainTransportFailure(asError("SQLITE_ERROR", "no such table: users")));
  record("an unavailable database keeps its own code", !isChainTransportFailure(asError("DATABASE_UNAVAILABLE", "fetch failed")));
}

// ── 2. serverError response shapes ───────────────────────────────────────────
{
  const chainRes = fakeRes();
  serverError(chainRes, new ChainUnavailableError("Timed out after 15000ms: getCampaign"), "test");
  record("chain failure answers 502, not 500", chainRes.statusCode === 502, `status ${chainRes.statusCode}`);
  record("chain failure carries an actionable hint", chainRes.body?.error === "Chain data unavailable" && /SEPOLIA_RPC_URL/.test(chainRes.body?.hint || ""), chainRes.body?.error);

  const timeoutRes = fakeRes();
  serverError(timeoutRes, asError("CHAIN_TIMEOUT", "Timed out after 10000ms: balance"), "test");
  record("an rpc timeout answers 502 with the hint", timeoutRes.statusCode === 502 && /SEPOLIA_RPC_URL/.test(timeoutRes.body?.hint || ""), `status ${timeoutRes.statusCode}`);

  const dbRes = fakeRes();
  serverError(dbRes, Object.assign(new Error("Could not open the CrowdFund database"), { code: "DATABASE_UNAVAILABLE", hint: "Set TURSO_DATABASE_URL" }), "test");
  record("a database failure still answers 503", dbRes.statusCode === 503, `status ${dbRes.statusCode}`);

  const genericRes = fakeRes();
  serverError(genericRes, new Error("unexpected"), "test");
  record("a genuinely unexpected error still answers 500", genericRes.statusCode === 500 && genericRes.body?.error === "Internal server error", `status ${genericRes.statusCode}`);

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const productionRes = fakeRes();
  serverError(productionRes, new Error("internal detail that must not ship"), "test");
  process.env.NODE_ENV = previousNodeEnv;
  record("production 500 still hides internal detail", productionRes.statusCode === 500 && productionRes.body?.detail === undefined);
}

// ── 3. The real routes, against a dead RPC ───────────────────────────────────
{
  const funding = await import("../pages/api/campaigns/[id]/funding.js");
  const fundingRes = fakeRes();
  await withDeadline(
    funding.default({ method: "GET", query: { id: "1" } }, fundingRes),
    60000,
    "funding route"
  );
  record(
    "/api/campaigns/:id/funding answers 502 when the RPC is dead",
    fundingRes.statusCode === 502,
    `status ${fundingRes.statusCode}`
  );
  record(
    "the 502 tells the operator which variable to set",
    fundingRes.body?.error === "Chain data unavailable" && /SEPOLIA_RPC_URL/.test(fundingRes.body?.hint || ""),
    String(fundingRes.body?.error)
  );

  const donations = await import("../pages/api/donations.js");
  const donationsRes = fakeRes();
  await withDeadline(
    donations.default({ method: "GET", query: { limit: "5" } }, donationsRes),
    90000,
    "donations route"
  );
  record(
    "/api/donations still answers from indexed data with a dead RPC",
    donationsRes.statusCode === 200 && Array.isArray(donationsRes.body?.donations),
    `status ${donationsRes.statusCode}, ${donationsRes.body?.donations?.length ?? "?"} row(s)`
  );

  const stats = await import("../pages/api/admin/stats.js");
  const statsRes = fakeRes();
  await withDeadline(
    stats.default({ method: "GET", query: {} }, statsRes),
    60000,
    "admin stats route"
  );
  record(
    "/api/admin/stats refuses anonymously instead of erroring (401)",
    statsRes.statusCode === 401,
    `status ${statsRes.statusCode}`
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length} passed, ${failed.length} failed\n`);
if (failed.length > 0) process.exitCode = 1;

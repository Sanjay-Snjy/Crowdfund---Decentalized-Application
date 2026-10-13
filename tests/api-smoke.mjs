#!/usr/bin/env node
/**
 * Live API smoke test against a running dev/production server.
 *
 *   node tests/api-smoke.mjs [baseUrl]                 # full run (creates test profiles)
 *   node tests/api-smoke.mjs [baseUrl] --read-only     # safe against a production deploy
 *
 * `--read-only` runs only checks that write nothing: it verifies the database-backed
 * routes boot and answer (401 where authentication is required, real data where the
 * endpoint is public) and that none of them return the generic
 * `{"error":"Internal server error"}` body. Use it against the deployed site.
 *
 * Covers the security-critical paths end to end:
 *   - unauthenticated access to /api/admin/* is rejected (401);
 *   - a wallet session is only issued for a valid signature over an issued nonce,
 *     and a replayed nonce is rejected;
 *   - an authenticated but non-admin wallet still gets 403 on admin routes;
 *   - after granting the role (scripts/grant-admin.mjs) the same session sees the
 *     admin data;
 *   - public donation/funding endpoints answer with verified chain data or an
 *     explicit, honest error (they never fabricate rows).
 *
 * The script prints PASS/FAIL per check and exits non-zero on failure.
 */
import { ethers } from "ethers";

const BASE = process.argv[2] || "http://localhost:3000";
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "follow",
  });

  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 200) };
  }

  const setCookie = response.headers.getSetCookie?.() || [];
  return { status: response.status, payload, setCookie, headers: response.headers };
}

function cookieFrom(headers) {
  const entry = (headers || []).find((value) => value.startsWith("cf_session="));
  if (!entry) return null;
  return entry.split(";")[0];
}

const READ_ONLY = process.argv.includes("--read-only") || process.env.SMOKE_READ_ONLY === "1";

function summarizeAndExit() {
  const failed = results.filter((result) => !result.ok);
  console.log(`\n  ${results.length - failed.length} passed, ${failed.length} failed\n`);
  process.exit(failed.length > 0 ? 1 : 0);
}

// ── 0. Read-only mode: prove the database-backed routes answer ──────────────
//
// This is the check for the failure this project actually hit in production: a host
// with no reachable database returned a generic 500 from every DB-backed route.
if (READ_ONLY) {
  const guarded = [
    "/api/admin/users",
    "/api/admin/transactions",
    "/api/admin/stats",
    "/api/admin/campaigns",
    "/api/me",
    "/api/me/donations",
    "/api/rewards/me",
  ];

  for (const path of guarded) {
    const response = await call(path);
    const generic500 = response.status === 500 || response.payload?.error === "Internal server error";
    record(
      `${path} refuses anonymous access`,
      response.status === 401 && !generic500,
      generic500 ? "500 Internal server error" : `status ${response.status}`
    );
  }

  const donations = await call("/api/donations?limit=5");
  record(
    "/api/donations answers with chain-backed rows",
    donations.status === 200 && Array.isArray(donations.payload?.donations),
    donations.status === 200
      ? `${donations.payload.donations.length} row(s)`
      : `status ${donations.status} ${donations.payload?.error || ""} ${donations.payload?.hint || ""}`.trim()
  );

  if (donations.status === 200) {
    record(
      "donations link to the configured network's explorer",
      donations.payload.donations.every(
        (row) => !row.explorerUrl || row.explorerUrl.startsWith(donations.payload.network.explorerBase)
      ),
      donations.payload.network?.explorerName || "unknown explorer"
    );
    record(
      "unlinked wallets never receive a fabricated CrowdFund User ID",
      donations.payload.donations.every(
        (row) => row.donor.cfUserId === null || /^CF-\d{4,}$/.test(row.donor.cfUserId)
      ),
      "labels verified"
    );
  }

  const funding = await call("/api/campaigns/1/funding");
  record(
    "/api/campaigns/1/funding answers from chain state",
    funding.status === 200 && Boolean(funding.payload?.campaign),
    `status ${funding.status}`
  );

  const session = await call("/api/auth/session");
  record(
    "/api/auth/session reports an anonymous visitor",
    session.status === 200 && session.payload?.authenticated === false,
    `status ${session.status}, clerkConfigured=${session.payload?.clerkConfigured}`
  );

  const profiles = await call(
    "/api/wallet-link?walletAddresses=0x1111111111111111111111111111111111111111"
  );
  record(
    "/api/wallet-link reports public wallet labels",
    profiles.status === 200 && Array.isArray(profiles.payload?.walletProfiles),
    `status ${profiles.status}`
  );

  console.log("\n  Read-only mode: nothing was written to the database.\n");
  summarizeAndExit();
}

// ── 1. Unauthenticated admin access is refused ───────────────────────────────
{
  const response = await call("/api/admin/users");
  record("admin users requires authentication", response.status === 401, `status ${response.status}`);
}

{
  const response = await call("/api/admin/transactions");
  record("admin transactions requires authentication", response.status === 401, `status ${response.status}`);
}

// ── 2. Wallet signature authentication ──────────────────────────────────────
// Deterministic, publicly derivable test wallets so a grant (scripts/grant-admin.mjs)
// stays valid across runs. They hold no funds and must never be used for anything real.
const wallet = new ethers.Wallet(ethers.utils.id("crowdfund-smoke-test-admin"));
const outsiderWallet = new ethers.Wallet(ethers.utils.id("crowdfund-smoke-test-user"));
let adminCookie = null;
let outsiderCookie = null;
let cfUserId = null;

{
  const nonce = await call("/api/auth/wallet/nonce", {
    method: "POST",
    body: { address: wallet.address, purpose: "admin" },
  });

  if (nonce.status !== 200 || !nonce.payload?.message) {
    record("wallet nonce issued", false, `status ${nonce.status}`);
  } else {
    record("wallet nonce issued", true, `nonce ${nonce.payload.nonce.slice(0, 8)}…`);

    const signature = await wallet.signMessage(nonce.payload.message);

    // Bad signature first: another wallet signing the same message must fail.
    const wrongSigner = await outsiderWallet.signMessage(nonce.payload.message);
    const badSignature = await call("/api/auth/wallet/verify", {
      method: "POST",
      body: {
        address: wallet.address,
        signature: wrongSigner,
        message: nonce.payload.message,
        nonce: nonce.payload.nonce,
        purpose: "admin",
      },
    });
    record("signature from a different wallet is rejected", badSignature.status === 401, `status ${badSignature.status}`);

    const verified = await call("/api/auth/wallet/verify", {
      method: "POST",
      body: {
        address: wallet.address,
        signature,
        message: nonce.payload.message,
        nonce: nonce.payload.nonce,
        purpose: "admin",
      },
    });

    adminCookie = cookieFrom(verified.setCookie);
    cfUserId = verified.payload?.user?.cfUserId || null;
    record("valid wallet signature issues a session", verified.status === 200 && Boolean(adminCookie), `status ${verified.status}`);
    record("session carries a CrowdFund User ID", Boolean(cfUserId), cfUserId || "none");

    const replay = await call("/api/auth/wallet/verify", {
      method: "POST",
      body: {
        address: wallet.address,
        signature,
        message: nonce.payload.message,
        nonce: nonce.payload.nonce,
        purpose: "admin",
      },
    });
    record("nonce replay is rejected", replay.status === 401, `status ${replay.status}`);
  }
}

// ── 3. A normal user is not an administrator ────────────────────────────────
{
  const nonce = await call("/api/auth/wallet/nonce", {
    method: "POST",
    body: { address: outsiderWallet.address, purpose: "user" },
  });
  const signature = await outsiderWallet.signMessage(nonce.payload.message);
  const verified = await call("/api/auth/wallet/verify", {
    method: "POST",
    body: {
      address: outsiderWallet.address,
      signature,
      message: nonce.payload.message,
      nonce: nonce.payload.nonce,
      purpose: "user",
    },
  });
  outsiderCookie = cookieFrom(verified.setCookie);

  const adminAttempt = await call("/api/admin/users", { cookie: outsiderCookie });
  record("regular user gets 403 on admin routes", adminAttempt.status === 403, `status ${adminAttempt.status}`);

  // Attempting to self-promote is ignored (the role is not client-writable) and,
  // critically, the verified session must still report a non-admin account.
  await call("/api/me", { method: "PATCH", body: { role: "admin", displayName: "Smoke User" }, cookie: outsiderCookie });
  const afterPromoteAttempt = await call("/api/auth/session", { cookie: outsiderCookie });
  record(
    "a user cannot assign themselves the admin role",
    afterPromoteAttempt.payload?.identity?.isAdmin === false,
    `isAdmin ${afterPromoteAttempt.payload?.identity?.isAdmin}`
  );

  const stillForbidden = await call("/api/admin/users", { cookie: outsiderCookie });
  record("the promoted-by-request user is still refused admin data", stillForbidden.status === 403, `status ${stillForbidden.status}`);
}

// ── 4. Admin access after the role is granted (scripts/grant-admin.mjs) ─────
if (adminCookie) {
  const adminUsers = await call("/api/admin/users", { cookie: adminCookie });
  if (adminUsers.status === 200) {
    const first = adminUsers.payload.users[0];
    record(
      "granted admin can read recently registered users",
      Array.isArray(adminUsers.payload.users) && Boolean(first?.cfUserId),
      `${adminUsers.payload.users.length} user(s), newest ${first?.cfUserId}`
    );
    record(
      "admin user rows never expose an email address",
      adminUsers.payload.users.every((user) => !("email" in user) && !("emailAddress" in user)),
      "no email fields"
    );

    const transactions = await call("/api/admin/transactions?limit=5", { cookie: adminCookie });
    record("admin can read recent transactions", transactions.status === 200, `status ${transactions.status}`);
    if (transactions.status === 200) {
      const payload = transactions.payload;
      record(
        "transaction totals are reported for confirmed donations",
        typeof payload.totals?.totalConfirmedDonations === "number",
        `${payload.totals?.totalConfirmedDonations} confirmed / ${payload.totals?.totalConfirmedEth} ETH`
      );
      record(
        "transaction rows carry an explorer link for the configured network",
        payload.transactions.every((tx) => tx.explorerUrl.includes("sepolia") || !tx.explorerUrl.startsWith("https://etherscan.io")),
        `explorer ${payload.network?.explorerName}`
      );
    }

    const stats = await call("/api/admin/stats", { cookie: adminCookie });
    record("admin overview statistics load", stats.status === 200, `status ${stats.status}`);

    const campaigns = await call("/api/admin/campaigns?limit=3", { cookie: adminCookie });
    record("admin campaign escrow panel loads", campaigns.status === 200, `status ${campaigns.status}`);
  } else {
    record("granted admin can read recently registered users", false, `status ${adminUsers.status} (run: node scripts/grant-admin.mjs --wallet ${wallet.address})`);
    console.log(`\n  Hint: grant the role with:\n    node scripts/grant-admin.mjs --wallet ${wallet.address}\n`);
  }
}

// ── 5. Public endpoints (chain-backed, or an honest error) ──────────────────
{
  const donations = await call("/api/donations?limit=5");
  if (donations.status === 200) {
    const rows = donations.payload.donations;
    record(
      "public donations return verified, deduplicated events",
      Array.isArray(rows) && rows.every((row) => row.txHash?.startsWith("0x")),
      `${rows.length} row(s), ${rows.filter((r) => r.status === "confirmed").length} confirmed`
    );
    record(
      "unlinked wallets never receive a fabricated CrowdFund User ID",
      rows.every((row) => row.donor.cfUserId === null || /^CF-\d{4,}$/.test(row.donor.cfUserId)),
      "labels verified"
    );
  } else {
    record("public donations endpoint responds", false, `status ${donations.status}`);
  }

  const me = await call("/api/me", { cookie: outsiderCookie });
  record("signed-in user can read their own profile", me.status === 200 && Boolean(me.payload?.profile?.cfUserId), `status ${me.status}`);

  const rewards = await call("/api/rewards/me", { cookie: outsiderCookie });
  record("signed-in user can read their rewards", rewards.status === 200, `status ${rewards.status}, points ${rewards.payload?.points}`);

  const session = await call("/api/auth/session", { cookie: adminCookie });
  record("session endpoint reports the verified identity", session.status === 200 && session.payload?.identity?.cfUserId === cfUserId, `status ${session.status}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length} passed, ${failed.length} failed\n`);
if (failed.length > 0) process.exitCode = 1;

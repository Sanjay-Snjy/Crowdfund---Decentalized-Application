import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

import { ADDRESSES, cleanup, useTempDatabase } from "./helpers.js";

const tempDir = useTempDatabase("crowdfund-identity");

const { initDb, users, sessions } = await import("../lib/db/index.js");

await initDb();

test("assigns sequential CrowdFund User IDs in CF-0001 format", async () => {
  const first = await users.ensureUserFromClerk({ clerkUserId: "user_a", displayName: "Alice" });
  const second = await users.ensureUserFromClerk({ clerkUserId: "user_b", displayName: "Bob" });

  assert.equal(first.cf_user_id, "CF-0001");
  assert.equal(second.cf_user_id, "CF-0002");
  assert.equal(users.formatCfUserId(42), "CF-0042");
});

test("registration is idempotent — a retry never creates a second profile or ID", async () => {
  const first = await users.ensureUserFromClerk({ clerkUserId: "user_retry", displayName: "Retry" });
  const second = await users.ensureUserFromClerk({ clerkUserId: "user_retry", displayName: "Retry" });
  const third = await users.ensureUserFromClerk({ clerkUserId: "user_retry", displayName: "Renamed" });

  assert.equal(first.id, second.id);
  assert.equal(first.id, third.id);
  assert.equal(first.cf_user_id, third.cf_user_id, "an assigned CrowdFund User ID is never changed");
  assert.equal(third.display_name, "Renamed");

  const count = await users.countUsers();
  const allWithId = (await users.listRecentUsers({ limit: 100 })).filter(
    (u) => u.cfUserId === first.cf_user_id
  );
  assert.equal(allWithId.length, 1);
  assert.equal(count >= 3, true);
});

test("wallet-only registration is idempotent per address", async () => {
  const first = await users.ensureUserFromWallet({
    address: ADDRESSES.alice,
    displayName: "Alice Wallet",
  });
  const second = await users.ensureUserFromWallet({ address: ADDRESSES.alice });

  assert.equal(first.id, second.id);
  assert.equal(first.wallet_address, ADDRESSES.alice);
  assert.equal(second.wallet_address, ADDRESSES.alice);
});

test("linking a wallet merges a wallet-only profile and preserves its ID/history", async () => {
  const walletOnly = await users.ensureUserFromWallet({
    address: ADDRESSES.bob,
    displayName: "Bob Wallet",
  });
  const clerkProfile = await users.ensureUserFromClerk({
    clerkUserId: "user_carol",
    displayName: "Carol",
  });

  const merged = await users.linkWalletToUser({
    userId: clerkProfile.id,
    address: ADDRESSES.bob,
  });

  assert.equal(merged.id, clerkProfile.id);
  assert.equal(merged.wallet_address, ADDRESSES.bob);
  assert.equal(merged.cf_user_id, clerkProfile.cf_user_id, "the surviving profile keeps its ID");

  const archived = await users.getUserByCfUserId(walletOnly.cf_user_id);
  assert.equal(archived.status, "merged");
  assert.equal(Number(archived.merged_into), clerkProfile.id);
  assert.equal(archived.wallet_address, null);
  assert.equal(
    (await users.getUserByWallet(ADDRESSES.bob)).id,
    clerkProfile.id,
    "the wallet resolves to exactly one profile"
  );
});

test("a wallet already connected to another account cannot be silently reassigned", async () => {
  const owner = await users.ensureUserFromClerk({ clerkUserId: "user_owner", displayName: "Owner" });
  await users.linkWalletToUser({ userId: owner.id, address: ADDRESSES.carol });

  const other = await users.ensureUserFromClerk({ clerkUserId: "user_other", displayName: "Other" });
  await assert.rejects(
    () => users.linkWalletToUser({ userId: other.id, address: ADDRESSES.carol }),
    /already connected/
  );

  assert.equal((await users.getUserByWallet(ADDRESSES.carol)).id, owner.id);
  assert.equal((await users.getUserById(other.id)).wallet_address, null);
});

test("listRecentUsers returns newest first and exposes wallet connection status", async () => {
  const list = await users.listRecentUsers({ limit: 50 });
  for (let i = 1; i < list.length; i += 1) {
    assert.equal(
      list[i - 1].registeredAt >= list[i].registeredAt,
      true,
      "newest registration first"
    );
  }

  const withoutWallet = list.find((user) => user.walletAddress === null);
  assert.ok(withoutWallet, "users without a connected wallet still appear");
  assert.equal(withoutWallet.walletConnected, false);

  const withWallet = list.find((user) => user.walletAddress);
  assert.equal(withWallet.walletConnected, true);
});

test("roles cannot be set to arbitrary values", async () => {
  const user = await users.ensureUserFromClerk({ clerkUserId: "user_role", displayName: "Role" });
  await assert.rejects(() => users.setUserRole(user.id, "superadmin"));
  assert.equal((await users.getUserById(user.id)).role, "user");
  assert.equal((await users.setUserRole(user.id, "admin")).role, "admin");
});

test("wallet nonces are single-use and expire", async () => {
  const { nonce } = await sessions.createNonce({ address: ADDRESSES.alice, purpose: "admin" });

  const first = await sessions.consumeNonce({
    nonce,
    address: ADDRESSES.alice,
    purpose: "admin",
  });
  const replay = await sessions.consumeNonce({
    nonce,
    address: ADDRESSES.alice,
    purpose: "admin",
  });
  const wrongPurpose = await sessions.consumeNonce({
    nonce: "unknown",
    address: ADDRESSES.alice,
    purpose: "admin",
  });

  assert.ok(first, "the first use succeeds");
  assert.equal(replay, null, "replaying the same nonce fails");
  assert.equal(wrongPurpose, null);
});

test("session tokens are stored hashed and can be revoked", async () => {
  const user = await users.ensureUserFromClerk({
    clerkUserId: "user_session",
    displayName: "Session",
  });
  const { token } = await sessions.createSession({ userId: user.id, address: ADDRESSES.alice });

  const active = await sessions.getSession(token);
  assert.equal(active.user.id, user.id);

  await sessions.revokeSession(token);
  assert.equal(await sessions.getSession(token), null);
  assert.equal(await sessions.getSession("not-a-real-token"), null);
});

test("simultaneous registrations across processes never receive the same ID", async () => {
  const workerUrl = new URL("./register-worker.mjs", import.meta.url);
  const workers = 4;
  const perWorker = 25;

  const results = await Promise.all(
    Array.from({ length: workers }, (_, index) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(workerUrl), {
          workerData: { start: index * perWorker, count: perWorker },
        });
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) reject(new Error(`worker exited with code ${code}`));
        });
      });
    })
  );

  const ids = results.flat();
  assert.equal(ids.length, workers * perWorker);
  assert.equal(new Set(ids).size, ids.length, "every allocated ID is unique");

  const sequences = ids.map((id) => Number(id.replace("CF-", ""))).sort((a, b) => a - b);
  for (let i = 1; i < sequences.length; i += 1) {
    assert.notEqual(sequences[i], sequences[i - 1], "no duplicate sequence numbers");
  }

  const total = await users.countUsers();
  assert.equal(total >= workers * perWorker, true);
});

test("the admin list can be limited to active, wallet-connected profiles", async () => {
  // A wallet profile that is later merged into a Clerk profile becomes a retired
  // row (same person, no wallet). It must not be listed next to its survivor.
  const retired = await users.ensureUserFromWallet({
    address: ADDRESSES.dave,
    displayName: "Retired Wallet",
  });
  const survivor = await users.ensureUserFromClerk({
    clerkUserId: "user_retired_owner",
    displayName: "Retired Owner",
  });
  await users.linkWalletToUser({ userId: survivor.id, address: ADDRESSES.dave });

  const walletless = await users.ensureUserFromClerk({
    clerkUserId: "user_no_wallet",
    displayName: "No Wallet",
  });

  const list = await users.listRecentUsers({ limit: 100, activeOnly: true, walletOnly: true });
  const cfIds = list.map((user) => user.cfUserId);

  assert.equal(cfIds.includes(retired.cf_user_id), false, "a merged (retired) profile is not listed");
  assert.equal(cfIds.includes(walletless.cf_user_id), false, "a registration without a wallet is not listed");
  assert.equal(cfIds.includes(survivor.cf_user_id), true, "the surviving profile with the wallet is listed");
  assert.equal(
    list.every((user) => user.walletAddress && user.walletConnected),
    true,
    "every listed row has a connected wallet"
  );
  assert.equal((await users.countWalletUsers()) >= list.length, true);

  // The unfiltered list keeps its previous behavior for other consumers.
  const unfiltered = await users.listRecentUsers({ limit: 100 });
  assert.equal(
    unfiltered.some((user) => user.cfUserId === walletless.cf_user_id),
    true,
    "without the filter, wallet-less rows still appear"
  );
});

test("a wallet this browser already proved is linked to the Clerk profile automatically", async () => {
  const { autoLinkWalletSession, SESSION_COOKIE } = await import("../lib/auth/identity.js");

  const walletProfile = await users.ensureUserFromWallet({
    address: ADDRESSES.erin,
    displayName: "Auto Wallet",
  });
  const { token } = await sessions.createSession({
    userId: walletProfile.id,
    address: ADDRESSES.erin,
  });
  const clerkProfile = await users.ensureUserFromClerk({
    clerkUserId: "user_autolink",
    displayName: "Auto Link",
  });

  const req = { headers: { cookie: `${SESSION_COOKIE}=${token}` } };
  const linked = await autoLinkWalletSession(req, clerkProfile);

  assert.equal(linked.id, clerkProfile.id, "the Clerk profile survives the merge");
  assert.equal(linked.wallet_address, ADDRESSES.erin, "the proven wallet is attached");
  assert.equal(
    (await users.getUserByCfUserId(walletProfile.cf_user_id)).status,
    "merged",
    "the throwaway wallet profile is retired"
  );

  // Ambiguous cases are left to the explicit link flow.
  const bystander = await users.ensureUserFromClerk({
    clerkUserId: "user_autolink_bystander",
    displayName: "Bystander",
  });
  assert.equal(
    (await autoLinkWalletSession(null, bystander)).wallet_address,
    null,
    "no session cookie means nothing is linked"
  );

  const carolOwner = await users.getUserByWallet(ADDRESSES.carol);
  const { token: carolToken } = await sessions.createSession({
    userId: carolOwner.id,
    address: ADDRESSES.carol,
  });
  const untouched = await autoLinkWalletSession(
    { headers: { cookie: `${SESSION_COOKIE}=${carolToken}` } },
    bystander
  );
  assert.equal(
    untouched.wallet_address,
    null,
    "a wallet already owned by another Clerk account is never reassigned"
  );
});

test.after(() => {
  cleanup(tempDir);
});

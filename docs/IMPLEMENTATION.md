# CrowdFund — enhancement implementation report

Scope: the six requested enhancements (admin user list, CrowdFund User IDs, public
donation activity, admin transactions, escrow/funding status, donor rewards) plus
the verification and documentation work that goes with them.

Nothing was rebuilt or replaced. Every feature reuses the existing Next.js pages,
`wagmi`/`ethers` contract layer, Clerk configuration, Pinata/IPFS flow and the
existing Solidity contract.

---

## 1. What was added, and where

### Requirement 1 — Admin dashboard: recently registered users

| Piece | File |
| --- | --- |
| Server-authorised list endpoint (newest first, pagination, totals) | `pages/api/admin/users.js` |
| UI section (desktop table + mobile cards, load-more, loading/empty/error states, 20s auto-refresh) | `components/Admin/RecentlyJoinedUsers.js` |
| Server-side admin guard (Clerk session *or* signed wallet) | `lib/auth/identity.js` |
| Admin page shell + gate | `pages/admin.js`, `components/Admin/AdminGate.js` |

* Registration rows are created by the Clerk webhook (`pages/api/webhooks/clerk.js`) and,
  for wallet-first users, by the signed sign-in flow (`pages/api/auth/wallet/verify.js`).
* Both paths call `db.users.ensureUserFromClerk` / `ensureUserFromWallet`, which are
  idempotent — a duplicate webhook delivery or a retried request returns the existing row.
* Emails are never returned: only a SHA-256 `email_hash` is stored, and the API response
  contains no email field (asserted by the API smoke test).

### Requirement 2 — CrowdFund User IDs (`CF-0001`, `CF-0002`, …)

* Allocation lives in `lib/db/users.js`: `allocateCfSeq()` runs `UPDATE counters SET value = value + 1`
  inside a `BEGIN IMMEDIATE` write transaction, then formats `CF-` + zero-padded sequence.
  `cf_seq` and `cf_user_id` both carry `UNIQUE` constraints as a second line of defence.
* The sequence is never reused and never changed after assignment; when a wallet-only
  profile is merged into a Clerk profile, the old ID is retired (`status = 'merged'`) and
  the surviving profile keeps its own ID.
* Clerk user ids stay in the private `clerk_user_id` column and are never rendered. The UI
  only ever shows `cfUserId` (admin list, profile card, donation history, rewards).

### Requirement 3 — Public donation activity

| Piece | File |
| --- | --- |
| Indexer over the deployed contract (`ContributionMade`, `RefundIssued`, …) | `lib/chain/indexer.js` |
| Donation table + dedupe constraints | `lib/db/chainEvents.js`, `lib/db/schema.js` |
| Public endpoint (`/api/donations?campaignId=&limit=`) | `pages/api/donations.js` |
| Public UI component | `components/Donations/RecentDonations.js` |

* Mounted on the campaign details page (per campaign) and on `/home` as the public
  "Community Donation Activity" section — visible to visitors with no wallet connected.
* Each row shows the CrowdFund User ID when the wallet is linked to an account, otherwise
  the shortened wallet address. A CrowdFund ID is never invented for an unknown wallet.
* Only `status = 'confirmed'` rows are served, with a real transaction hash, block
  timestamp and an explorer link for the configured network.

### Requirement 4 — Admin dashboard: recent transactions

| Piece | File |
| --- | --- |
| Endpoint with campaign/status filters, search, totals | `pages/api/admin/transactions.js` |
| Table UI | `components/Admin/RecentTransactions.js` |
| Platform overview tiles, indexer status | `components/Admin/PlatformOverview.js`, `pages/api/admin/stats.js` |

* Newest first, paginated, filterable by campaign and status, searchable by CrowdFund User
  ID, wallet address, campaign name or transaction hash.
* Donations are prioritised; `event_type` also separates `campaign_created`,
  `milestone_*`, `funds_released` and `refund`, so campaign creation, milestone releases and
  refunds can never be mistaken for donations.
* Totals report confirmed donations and total contributed ETH; links always use the
  configured explorer (Sepolia Etherscan here — never mainnet).

### Requirement 5 — Campaign escrow and funding status

| Piece | File |
| --- | --- |
| Funding/escrow endpoint (`/api/campaigns/[id]/funding`) | `pages/api/campaigns/[id]/funding.js` |
| Escrow/milestone state derivation | `lib/chain/campaignState.js` |
| UI | `components/Campaign/FundingStatus.js`, `components/Admin/CampaignFundingPanel.js` |

* The existing contract was inspected first; **its economics were not changed**.
  Contributions stay in the contract, `raisedAmount`/`releasedAmount` per campaign are the
  accounting, milestones still release **30% / 30% / 40%**, releases are blocked before the
  target is reached, and refunds stay available only for campaigns that missed the target.
* The panel shows: raised vs target, escrow breakdown (raised / still locked / released to
  creator), percentage of target, fundraising deadline, per-milestone status, recent donors
  and transaction links.

### Requirement 6 — Donor rewards

| Piece | File |
| --- | --- |
| Reward policy + ledger | `lib/rewards/policy.js`, `lib/rewards/index.js` |
| Endpoint | `pages/api/rewards/me.js` |
| UI | `components/Rewards/RewardBadges.js`, mounted on `/dashboard` and `/contributions` |

* Points are derived from indexed, confirmed, non-refunded contributions only.
* The ledger has a unique constraint per contribution, so points can never be awarded
  twice, and re-indexing the same range changes nothing.
* There is no write endpoint for rewards — a user cannot modify their own balance.

---

## 2. Smart-contract change (one, and it is opt-in)

`web3/contracts/CrowdfundingMarketplace.sol` gains **abandoned-campaign recovery**:
after `MILESTONE_INACTIVITY_PERIOD + RECOVERY_GRACE_PERIOD` with no milestone activity, each
donor can claim their pro-rata share of whatever is still in escrow
(`claimRecoveryShare`), and milestone releases/votes/refunds freeze once recovery starts.
A campaign that is merely running late is unaffected — any evidence submission restarts the
countdown. New views: `recoveryEscrowPool`, `recoveryUnlocksAt`, `recoveryEligible`,
`recoveryClaimable`. Existing escrow and refund semantics are untouched.

**Redemption/deployment implications**

* The contract currently deployed at `0x43cFa879…f484` does **not** have these functions, and
  the committed `constants/abi.js` (70 entries) deliberately still matches that deployment.
  `hooks/useContract.js` exposes `SUPPORTS_RECOVERY` (currently `false`), and
  `FundingStatus`/the funding API hide recovery controls when the deployed contract does not
  report support. That is why the app keeps working against the existing deployment.
* To *use* recovery you must redeploy the contract and regenerate the ABI:
  ```bash
  cd web3
  npx hardhat compile
  npm test                 # 35 existing contract tests
  npm run test:recovery    # 11 recovery tests
  npm run deploy-sepolia   # writes the new address to .env + the frontend ABI
  npm run export-abi       # or regenerate constants/abi.js from the artifact
  ```
  Then set `NEXT_PUBLIC_CONTRACT_ADDRESS` / `CF_CONTRACT_ADDRESS` (or update
  `constants/index.js`) and re-run the indexer so `CF_INDEX_START_BLOCK` points at the new
  deployment block. Until then, everything else is verified against the live deployment.

---

## 3. Database

One interface, two back ends, chosen by configuration (`lib/db/driver.js`):

| Back end | Selected when | Used for |
| --- | --- | --- |
| **Hosted libSQL** (Turso) | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` are set | Production / any host with a read-only or ephemeral filesystem (Vercel, Netlify). Reached over HTTP/WebSocket by `@libsql/client`, so nothing is written to disk. |
| **Local SQLite file** | otherwise (or `CF_DATABASE_PATH`) | Local development, tests, and hosts with a persistent volume. Node's built-in `node:sqlite`. |

Both speak SQLite SQL, so the schema, the `?` placeholders, `ON CONFLICT`, `AUTOINCREMENT`
and `UPDATE … RETURNING` are identical — the schema in `lib/db/schema.js` is used unchanged.

* **Why the hosted back end exists:** the first production deployment returned
  `{"error":"Internal server error"}` from every DB-backed route. The cause was not the
  code: a serverless filesystem is read-only and ephemeral, so `data/crowdfund.db` could
  neither be created nor survive a cold start (reproduced locally as
  `EPERM: operation not permitted, mkdir`). A reachable database is now required on such
  hosts, and the API answers `503 Database unavailable` with the missing variable names
  instead of a blank 500 when it is not configured.
* Migrations are append-only and applied exactly once, tracked in `schema_migrations`
  (`lib/db/schema.js`, `lib/db/migrate.js`). `await db.init()` runs before any query batch,
  so no manual migration step is required — the first request (or the first script run)
  creates the schema. Each migration is applied in one atomic request (a libSQL batch, or a
  `BEGIN IMMEDIATE` transaction on the local file).
* Every store function is async now (the hosted back end is a network call).
* Tables: `users`, `counters` (the CF-ID sequence), `auth_nonces`, `sessions`,
  `chain_transactions`, `sync_state`, `reward_events`, `campaign_cache`, `admin_audit`
  and `schema_migrations`.
* Back up / reset (local file): `cp data/crowdfund.db backup.db` to back up;
  `rm data/crowdfund.db*` to start clean. Hosted libSQL: use the Turso dashboard/CLI.

### Configuring the hosted database (one-time, ~2 minutes)

1. Create a database at <https://turso.tech> (free tier is enough) — install the CLI with
   `npm i -g turso` and run `turso db create crowdfund`, or use the dashboard.
2. Get the connection URL: `turso db show crowdfund --url` → `libsql://crowdfund-<org>.turso.io`.
3. Create a token: `turso db tokens create crowdfund`.
4. Set both in the deployment environment (Vercel → Project → Settings → Environment
   Variables) for **Production and Preview**, then redeploy:
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
5. That is all — no migration command. Hit any page; the first API request creates the
   schema. Verify with `node scripts/verify-indexer.mjs` (it prints the active back end).

To check the schema/rows from a shell without exposing the token:

```bash
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/verify-indexer.mjs
```

---

## 4. Environment variables (names only — values stay in `.env.local`)

| Variable | Purpose | State here |
| --- | --- | --- |
| `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_CHAIN_NAME`, `NEXT_PUBLIC_CHAIN_SYMBOL` | network display + chain id | set |
| `NEXT_PUBLIC_RPC_URL`, `SEPOLIA_RPC_URL`, `NETWORK_RPC_URL` | RPC (browser / server preferred / hardhat) | `NEXT_PUBLIC_RPC_URL` set |
| `NEXT_PUBLIC_BLOCK_EXPLORER`, `NEXT_PUBLIC_BLOCK_EXPLORER_NAME` | explorer links | set |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` / `CF_CONTRACT_ADDRESS` / `NEXT_PUBLIC_CONTRACT_ADDRESS_OVERRIDE` | override the committed deployed address | **not set** (uses `constants/index.js`) |
| `TURSO_DATABASE_URL` | hosted libSQL URL — **required on Vercel/serverless** | **not set yet — the deployment cannot persist without it** |
| `TURSO_AUTH_TOKEN` | hosted libSQL auth token (server-only) | **not set yet** |
| `CF_DATABASE_PATH` | local SQLite file path (dev / volume hosts) | not set (default `data/crowdfund.db`) |
| `CF_INDEX_START_BLOCK`, `CF_INDEX_LOOKBACK_BLOCKS`, `CF_CONFIRMATIONS_REQUIRED` | indexer range/confirmation policy | not set (defaults) |
| `CLERK_SECRET_KEY` | verifies Clerk sessions server-side | **missing — see limitations** |
| `CLERK_WEBHOOK_SIGNING_SECRET` | verifies `/api/webhooks/clerk` signatures | **missing** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk front-end key | set |
| `CF_ADMIN_WALLET_ADDRESSES`, `CF_ADMIN_CLERK_USER_IDS`, `CF_ADMIN_EMAILS` | admin allow-list | **not set** |
| `NEXT_PUBLIC_ADMIN_ADDRESS` | legacy admin address (also honoured) | set |
| `PINATA_JWT`, `PINATA_API_KEY`, `PINATA_SECRET_KEY` | IPFS pinning | set |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | WalletConnect v2 (mobile MetaMask) | set but **invalid (32 chars)** |

---

## 5. Commands

```bash
# install (root + contract workspace)
npm install
cd web3 && npm install && cd ..

# database: nothing to run — migrations apply on the first request.
# (hosted libSQL: export TURSO_DATABASE_URL + TURSO_AUTH_TOKEN first)

# optional admin bootstrap (no API endpoint can set a role):
node scripts/grant-admin.mjs --list
node scripts/grant-admin.mjs --wallet 0xYourWalletAddress
node scripts/grant-admin.mjs --cf CF-0002 --revoke

# run the app
npm run dev                          # http://localhost:3000
npx next dev -p 1112                 # (trailingSlash is on, so use /admin/ not /admin)
npm run build && npm start

# verification
node tests/identity.test.js                  # CF IDs, idempotency, nonces, sessions
node tests/indexer.test.js                   # event indexing, dedupe, rewards, admin filters
node tests/libsql-driver.test.js             # the hosted-libSQL code path (no credentials needed)
node tests/env-template.test.js              # the committed template must never carry a real secret
node tests/identity-hook-contract.test.js    # every field read off useIdentity must exist (no type-checker on .js)
node tests/api-smoke.mjs http://localhost:1112   # end-to-end API + authz (needs the dev server)
node scripts/verify-indexer.mjs              # live indexer health against the configured RPC

# contracts
cd web3
npx hardhat compile
npm test                 # existing contract suite
npm run test:recovery    # recovery-specific suite
npm run test:all         # both
npm run deploy-sepolia   # deploy to Sepolia (needs SEPOLIA_RPC_URL + a funded deployer key)
npm run export-abi       # regenerate constants/abi.js from the compiled artifact
```

---

## 6. Test results (all run on this checkout)

| Suite | Command | Result |
| --- | --- | --- |
| Identity / DB unit tests | `node tests/identity.test.js` | **10 passed, 0 failed** — including concurrent multi-process registration never reusing an ID |
| Indexer / rewards unit tests | `node tests/indexer.test.js` | **11 passed, 0 failed** — pending events excluded, re-index never duplicates, refunds reverse eligibility, and a database with no sync cursor backfills from `CF_INDEX_START_BLOCK` (a per-run block budget resumes instead of skipping history) |
| Environment template guard | `node tests/env-template.test.js` | **3 passed, 0 failed** — `.env.example` documents every variable the app reads and contains no real database host, JWT, provider key or private key |
| Client identity hook contract | `node tests/identity-hook-contract.test.js` | **2 passed, 0 failed** — every property a consumer destructures from `useIdentity()` exists in its return object, so a mistyped name (the `isLoading` vs `loading` mismatch that flashed the admin gate on every load) cannot slip through again |
| Hosted-libSQL path | `node tests/libsql-driver.test.js` | **8 passed, 0 failed** — batched migrations, `UPDATE … RETURNING` ID allocation, `ON CONFLICT DO NOTHING` idempotency, transactions in the AsyncLocalStorage scope, donation totals, and a loud failure when a URL is set without a token |
| API smoke (live dev server) | `node tests/api-smoke.mjs http://localhost:1112` | **22 passed, 0 failed** — 401/403 authorization, nonce replay rejection, wallet session → CF-0004, admin sees newest CF-0006, no email leakage, 5 confirmed donations / 0.255 ETH, Sepolia explorer links |
| Contract suite (existing) | `cd web3 && npm test` | **35 passed, 0 failing** |
| Contract recovery suite (new) | `cd web3 && npm run test:recovery` | **11 passed, 0 failing** — pro-rata claim once only, escrow never over-paid, funds already released accounted for, countdown restarts on evidence, premature recovery and unauthorized withdrawal rejected |
| Production build | `npm run build` | succeeded (all pages + the new API routes compiled) |
| Browser check | `/home`, `/campaign/1`, `/admin` | Rendered; the public community activity section shows real indexed donations (CF-0006, 0.01 ETH, Confirmed, Sepolia link) |

Scenario coverage requested in the brief is mapped to those runs: duplicate/simultaneous
registration, admin list limited to active wallet-connected users (retired merged rows and
registrations without a wallet are never listed), admin-only list access, per-campaign
donation attribution, failed/pending transactions excluded, unlinked wallets getting no
fabricated ID, escrow/release percentages, refund eligibility, recovery guards and reward
idempotency.

Two notes on how the results were obtained: the recovery contract tests run against a local
Hardhat network (the Solidity feature is not deployed yet), and the admin UI was exercised
in the browser by rendering the component tree against a seeded query rather than by signing
in as a real administrator — the *server* side of that path is covered by the API smoke test
(401 → 403 → admin 200).

The hosted-libSQL suite injects a libSQL-compatible client in front of a local file, so it
proves the driver's remote branch (one statement per `execute`, batched writes, ResultSet
shapes, transaction scope) without Turso credentials. The **network transport itself is not
yet verified** — that is the one remaining check, and it needs `TURSO_DATABASE_URL` +
`TURSO_AUTH_TOKEN` (see §3 and §7).

---

## 7. Configuration you still have to supply

0. **`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`** — the deployed site cannot store users or
   donations without them (read-only filesystem). Setup is in §3. Once they are set, the
   only remaining verification is one request against the live site (or
   `node scripts/verify-indexer.mjs`) to confirm the transport works end to end.
1. **`CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET`** — without them `middleware.js`
   stays a no-op and Clerk sessions cannot be verified server-side, so registrations
   currently flow through the signed-wallet path only. Set both, then add the webhook
   endpoint `https://<your-domain>/api/webhooks/clerk` for `user.created` / `user.updated`
   in the Clerk dashboard.
2. **`CF_ADMIN_WALLET_ADDRESSES` (or `CF_ADMIN_CLERK_USER_IDS` / `CF_ADMIN_EMAILS`)** — the
   allow-list that automatically grants the admin role at sign-in. `NEXT_PUBLIC_ADMIN_ADDRESS`
   is already set and works, but a server-only list is the better long-term home for it.
3. **`NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`** — the current value is 32 characters; a real
   WalletConnect project id is a 36-character UUID. Desktop MetaMask works today, mobile
   WalletConnect will hang until this is replaced.
4. **A contract redeploy** if you want the recovery feature live (see §2).

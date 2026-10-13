/**
 * CrowdFund database schema and migrations.
 *
 * Migrations are append-only: each entry runs exactly once (tracked in
 * `schema_migrations`) inside a write transaction. Never edit an applied
 * migration — add a new one instead.
 *
 * Security note: no private keys, seed phrases or wallet passwords are ever
 * stored. Only public identifiers (wallet addresses, Clerk user ids, display
 * names) and on-chain facts live here.
 */

/** Version 1 — user profiles, CrowdFund IDs, wallets, sessions, rewards, chain events. */
const MIGRATION_1_INITIAL = `
-- ── Users ────────────────────────────────────────────────────────────────────
-- cf_user_id / cf_seq are the ONLY identifiers the application shows to users.
-- clerk_user_id is private: it exists solely to bind an authenticated Clerk
-- session to the correct CrowdFund record.
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cf_seq          INTEGER NOT NULL UNIQUE,
  cf_user_id      TEXT    NOT NULL UNIQUE,
  clerk_user_id   TEXT    UNIQUE,
  auth_source     TEXT    NOT NULL DEFAULT 'clerk',   -- clerk | wallet
  display_name    TEXT,
  -- SHA-256 of the lowercased email. Lets an operator allow-list an admin by
  -- email without ever persisting the address itself.
  email_hash      TEXT,
  wallet_address  TEXT    UNIQUE,                     -- lowercase 0x…, verified by signature
  wallet_linked_at INTEGER,
  role            TEXT    NOT NULL DEFAULT 'user',    -- user | admin
  public_display  INTEGER NOT NULL DEFAULT 1,         -- 0 = show anonymous label publicly
  anonymous_donations INTEGER NOT NULL DEFAULT 0,     -- 1 = hide display name on public donation lists
  status          TEXT    NOT NULL DEFAULT 'active',  -- active | merged
  merged_into     INTEGER REFERENCES users(id),
  registered_at   INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_registered_at ON users (registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users (wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Atomic sequential counter backing CF-0001, CF-0002, … allocation.
CREATE TABLE IF NOT EXISTS counters (
  name       TEXT    PRIMARY KEY,
  value      INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('cf_user_id', 0);

-- ── Wallet-signature sessions ────────────────────────────────────────────────
-- A wallet identity is only ever accepted after the owner signs a server-issued
-- single-use nonce. Clerk sessions are verified by Clerk itself via getAuth().
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce       TEXT    PRIMARY KEY,
  address     TEXT    NOT NULL,
  purpose     TEXT    NOT NULL DEFAULT 'user',  -- user | admin
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nonces_address ON auth_nonces (address);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT    NOT NULL UNIQUE,
  user_id     INTEGER REFERENCES users(id),
  address     TEXT,
  purpose     TEXT    NOT NULL DEFAULT 'user',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- ── Campaign metadata cache ──────────────────────────────────────────────────
-- Campaign titles/targets live on-chain; this cache lets the UI and the admin
-- search attach a campaign name to an event without one RPC read per row.
CREATE TABLE IF NOT EXISTS campaign_cache (
  chain_id         INTEGER NOT NULL,
  contract_address TEXT    NOT NULL,
  campaign_id      INTEGER NOT NULL,
  title            TEXT,
  creator          TEXT,
  target_amount    TEXT,
  raised_amount    TEXT,
  deadline         INTEGER,
  completed        INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (chain_id, contract_address, campaign_id)
);

-- ── Indexed on-chain events ──────────────────────────────────────────────────
-- The donations VIEW (created below) exposes the contribution subset with
-- exactly the columns the data model calls for. Unique key (chain, contract,
-- tx, log index) makes re-indexing idempotent: one log can never create two rows.
CREATE TABLE IF NOT EXISTS chain_transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id          INTEGER NOT NULL,
  contract_address  TEXT    NOT NULL,
  tx_hash           TEXT    NOT NULL,
  log_index         INTEGER NOT NULL,
  block_number      INTEGER NOT NULL,
  transaction_index INTEGER NOT NULL DEFAULT 0,
  block_timestamp   INTEGER NOT NULL,
  event_type        TEXT    NOT NULL, -- contribution | campaign_created | milestone_evidence |
                                      -- milestone_vote | milestone_released | campaign_completed | refund
  campaign_id       INTEGER,
  campaign_name     TEXT,
  actor_address     TEXT,             -- contributor / creator / voter, lowercase
  donor_wallet      TEXT,             -- lowercase contributor address (contributions only)
  user_id           INTEGER REFERENCES users(id),
  amount_wei        TEXT    NOT NULL DEFAULT '0',
  status            TEXT    NOT NULL DEFAULT 'confirmed', -- pending | confirmed | failed
  confirmations     INTEGER NOT NULL DEFAULT 0,
  reward_eligible   INTEGER NOT NULL DEFAULT 1,
  refunded_at       INTEGER,
  extra             TEXT,             -- JSON blob for event-specific fields (milestone index, CID …)
  indexed_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chain_event
  ON chain_transactions (chain_id, contract_address, tx_hash, log_index);
CREATE INDEX IF NOT EXISTS idx_chain_events_block ON chain_transactions (block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS idx_chain_events_campaign ON chain_transactions (campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_chain_events_donor ON chain_transactions (donor_wallet);
CREATE INDEX IF NOT EXISTS idx_chain_events_user ON chain_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_chain_events_type ON chain_transactions (event_type);

CREATE VIEW IF NOT EXISTS donations AS
  SELECT * FROM chain_transactions WHERE event_type = 'contribution';

-- ── Rewards ledger ───────────────────────────────────────────────────────────
-- One row per awarded reward. The UNIQUE constraint is what guarantees a single
-- contribution can never award the same reward twice.
CREATE TABLE IF NOT EXISTS reward_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  reward_type           TEXT    NOT NULL, -- points | supporter | silver | gold | platinum
  points                INTEGER NOT NULL DEFAULT 0,
  source_transaction_id INTEGER REFERENCES chain_transactions(id),
  created_at            INTEGER NOT NULL,
  reversed_at           INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reward_per_source
  ON reward_events (user_id, reward_type, source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reward_events_user ON reward_events (user_id);

-- ── Indexer bookkeeping ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ── Audit log for administrative mutations ───────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT    NOT NULL,   -- "clerk:<id>" or "wallet:<address>"
  action     TEXT    NOT NULL,
  subject    TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
`;

export const MIGRATIONS = [
  {
    version: 1,
    name: "initial_user_identity_ledger",
    sql: MIGRATION_1_INITIAL,
  },
];

/**
 * Indexed on-chain events: donations (contributions), campaign creation,
 * milestone evidence/votes, fund releases and refunds.
 *
 * Every row is keyed by (chain_id, contract_address, tx_hash, log_index) with a
 * UNIQUE index, so re-indexing the same block range is always idempotent and a
 * single log can never be stored twice.
 *
 * Wei amounts are stored as TEXT and summed with BigInt in JS — never with SQL
 * floating point, which would silently lose precision above ~0.009 ETH.
 */
import { getRow, query, run } from "./driver.js";

export const EVENT_TYPES = {
  contribution: "contribution",
  campaignCreated: "campaign_created",
  milestoneEvidence: "milestone_evidence",
  milestoneVote: "milestone_vote",
  milestoneReleased: "milestone_released",
  campaignCompleted: "campaign_completed",
  refund: "refund",
};

export function sumWei(values) {
  let total = 0n;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    try {
      total += BigInt(String(value));
    } catch {
      // Ignore malformed rows rather than failing an entire totals query.
    }
  }
  return total.toString();
}

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

/** Idempotent insert. Returns the row (existing or newly created). */
export function upsertChainEvent(event) {
  const record = {
    chainId: Number(event.chainId),
    contractAddress: normalizeAddress(event.contractAddress) || "",
    txHash: String(event.txHash).toLowerCase(),
    logIndex: Number(event.logIndex ?? 0),
    blockNumber: Number(event.blockNumber ?? 0),
    transactionIndex: Number(event.transactionIndex ?? 0),
    blockTimestamp: Number(event.blockTimestamp ?? 0),
    eventType: event.eventType,
    campaignId: event.campaignId === undefined || event.campaignId === null ? null : Number(event.campaignId),
    campaignName: event.campaignName || null,
    actorAddress: normalizeAddress(event.actorAddress),
    donorWallet: normalizeAddress(event.donorWallet),
    userId: event.userId ?? null,
    amountWei: String(event.amountWei ?? "0"),
    status: event.status || "confirmed",
    confirmations: Number(event.confirmations ?? 0),
    rewardEligible: event.rewardEligible === false ? 0 : 1,
    refundedAt: event.refundedAt ?? null,
    extra: event.extra ? JSON.stringify(event.extra) : null,
  };

  run(
    `INSERT INTO chain_transactions
       (chain_id, contract_address, tx_hash, log_index, block_number, transaction_index,
        block_timestamp, event_type, campaign_id, campaign_name, actor_address, donor_wallet,
        user_id, amount_wei, status, confirmations, reward_eligible, refunded_at, extra, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (chain_id, contract_address, tx_hash, log_index) DO UPDATE SET
        block_number      = excluded.block_number,
        block_timestamp   = excluded.block_timestamp,
        campaign_name     = COALESCE(excluded.campaign_name, chain_transactions.campaign_name),
        user_id           = COALESCE(excluded.user_id, chain_transactions.user_id),
        status            = excluded.status,
        confirmations     = excluded.confirmations,
        reward_eligible   = excluded.reward_eligible,
        refunded_at       = COALESCE(excluded.refunded_at, chain_transactions.refunded_at),
        extra             = COALESCE(excluded.extra, chain_transactions.extra),
        indexed_at        = excluded.indexed_at`,
    [
      record.chainId,
      record.contractAddress,
      record.txHash,
      record.logIndex,
      record.blockNumber,
      record.transactionIndex,
      record.blockTimestamp,
      record.eventType,
      record.campaignId,
      record.campaignName,
      record.actorAddress,
      record.donorWallet,
      record.userId,
      record.amountWei,
      record.status,
      record.confirmations,
      record.rewardEligible,
      record.refundedAt,
      record.extra,
      Math.floor(Date.now() / 1000),
    ]
  );

  return getRow(
    `SELECT * FROM chain_transactions
      WHERE chain_id = ? AND contract_address = ? AND tx_hash = ? AND log_index = ?`,
    [record.chainId, record.contractAddress, record.txHash, record.logIndex]
  );
}

export function getEventByKey({ chainId, contractAddress, txHash, logIndex }) {
  return getRow(
    `SELECT * FROM chain_transactions
      WHERE chain_id = ? AND contract_address = ? AND tx_hash = ? AND log_index = ?`,
    [Number(chainId), String(contractAddress || "").toLowerCase(), String(txHash || "").toLowerCase(), Number(logIndex ?? 0)]
  );
}

export function markContributionsRefunded({ chainId, contractAddress, campaignId, donorWallet, at }) {
  const result = run(
    `UPDATE chain_transactions
        SET reward_eligible = 0, refunded_at = ?
      WHERE chain_id = ? AND contract_address = ? AND campaign_id = ?
        AND event_type = 'contribution' AND donor_wallet = ?`,
    [at, Number(chainId), normalizeAddress(contractAddress), Number(campaignId), normalizeAddress(donorWallet)]
  );
  return result.changes;
}

export function linkEventOwners() {
  return run(
    `UPDATE chain_transactions
        SET user_id = (SELECT id FROM users WHERE users.wallet_address = chain_transactions.donor_wallet)
      WHERE user_id IS NULL
        AND donor_wallet IS NOT NULL
        AND EXISTS (SELECT 1 FROM users WHERE users.wallet_address = chain_transactions.donor_wallet)`
  ).changes;
}

export function getSyncState(key) {
  const row = getRow("SELECT value, updated_at FROM sync_state WHERE key = ?", [key]);
  return row ? { value: row.value, updatedAt: Number(row.updated_at) } : null;
}

export function setSyncState(key, value) {
  run(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, String(value), Math.floor(Date.now() / 1000)]
  );
}

function buildFilters(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.chainId !== undefined) {
    clauses.push("t.chain_id = ?");
    params.push(Number(filters.chainId));
  }
  if (filters.contractAddress) {
    clauses.push("t.contract_address = ?");
    params.push(filters.contractAddress.toLowerCase());
  }
  if (filters.eventType) {
    clauses.push("t.event_type = ?");
    params.push(filters.eventType);
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    clauses.push(`t.event_type IN (${filters.eventTypes.map(() => "?").join(",")})`);
    params.push(...filters.eventTypes);
  }
  if (filters.campaignId !== undefined && filters.campaignId !== null && filters.campaignId !== "") {
    clauses.push("t.campaign_id = ?");
    params.push(Number(filters.campaignId));
  }
  if (filters.status) {
    clauses.push("t.status = ?");
    params.push(filters.status);
  }
  if (filters.cfUserId) {
    clauses.push("u.cf_user_id = ?");
    params.push(String(filters.cfUserId).toUpperCase());
  }
  if (filters.walletAddress) {
    clauses.push("(t.donor_wallet = ? OR t.actor_address = ?)");
    params.push(filters.walletAddress.toLowerCase(), filters.walletAddress.toLowerCase());
  }
  if (filters.userId) {
    clauses.push("t.user_id = ?");
    params.push(Number(filters.userId));
  }

  const search = typeof filters.search === "string" ? filters.search.trim() : "";
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    clauses.push(
      `(LOWER(t.tx_hash) LIKE ? OR LOWER(COALESCE(t.donor_wallet, '')) LIKE ?
        OR LOWER(COALESCE(t.campaign_name, '')) LIKE ?
        OR LOWER(COALESCE(u.cf_user_id, '')) LIKE ?
        OR LOWER(COALESCE(u.wallet_address, '')) LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const JOIN_USERS = "LEFT JOIN users u ON u.id = t.user_id";

export function listTransactions(filters = {}, { limit = 25, page = 1 } = {}) {
  const { where, params } = buildFilters(filters);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const rows = query(
    `SELECT t.*, u.cf_user_id AS donor_cf_user_id
       FROM chain_transactions t ${JOIN_USERS}
       ${where}
      ORDER BY t.block_number DESC, t.log_index DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset]
  );

  return rows.map(mapTransaction);
}

export function transactionTotals(filters = {}) {
  const { where, params } = buildFilters({ ...filters, eventType: undefined, eventTypes: undefined });
  const rows = query(
    `SELECT t.event_type, t.status, t.amount_wei, t.reward_eligible, t.campaign_id
       FROM chain_transactions t ${JOIN_USERS}
       ${where}`,
    params
  );

  const confirmed = rows.filter(
    (row) => row.event_type === "contribution" && row.status === "confirmed"
  );
  const pending = rows.filter(
    (row) => row.event_type === "contribution" && row.status === "pending"
  );
  const refunds = rows.filter((row) => row.event_type === "refund" && row.status === "confirmed");

  return {
    total: rows.length,
    confirmedDonations: confirmed.length,
    pendingDonations: pending.length,
    confirmedWei: sumWei(confirmed.map((row) => row.amount_wei)),
    pendingWei: sumWei(pending.map((row) => row.amount_wei)),
    refundedWei: sumWei(refunds.map((row) => row.amount_wei)),
    rewardEligibleWei: sumWei(
      confirmed.filter((row) => Number(row.reward_eligible) === 1).map((row) => row.amount_wei)
    ),
    eventsByType: rows.reduce((acc, row) => {
      acc[row.event_type] = (acc[row.event_type] || 0) + 1;
      return acc;
    }, {}),
  };
}

export function countTransactions(filters = {}) {
  const { where, params } = buildFilters(filters);
  const row = getRow(
    `SELECT COUNT(*) AS total FROM chain_transactions t ${JOIN_USERS} ${where}`,
    params
  );
  return Number(row?.total || 0);
}

export function listRecentDonations({ campaignId, limit = 10, onlyConfirmed = true } = {}) {
  const clauses = ["t.event_type = 'contribution'"];
  const params = [];
  if (campaignId !== undefined && campaignId !== null && campaignId !== "") {
    clauses.push("t.campaign_id = ?");
    params.push(Number(campaignId));
  }
  if (onlyConfirmed) clauses.push("t.status = 'confirmed'");

  const rows = query(
    `SELECT t.*, u.cf_user_id AS donor_cf_user_id
       FROM chain_transactions t ${JOIN_USERS}
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.block_number DESC, t.log_index DESC
      LIMIT ?`,
    [...params, Math.min(Math.max(Number(limit) || 10, 1), 50)]
  );

  return rows.map(mapTransaction);
}

export function listDonationsForIdentity({ userId, walletAddress, limit = 50 }) {
  const clauses = ["t.event_type = 'contribution'"];
  const params = [];
  if (userId) {
    clauses.push("t.user_id = ?");
    params.push(Number(userId));
  } else if (walletAddress) {
    clauses.push("t.donor_wallet = ?");
    params.push(walletAddress.toLowerCase());
  } else {
    return [];
  }

  const rows = query(
    `SELECT t.*, u.cf_user_id AS donor_cf_user_id
       FROM chain_transactions t ${JOIN_USERS}
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.block_number DESC, t.log_index DESC
      LIMIT ?`,
    [...params, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );

  return rows.map(mapTransaction);
}

export function listFundReleases({ campaignId, limit = 50 } = {}) {
  const clauses = ["t.event_type IN ('milestone_released', 'campaign_completed')"];
  const params = [];
  if (campaignId !== undefined && campaignId !== null && campaignId !== "") {
    clauses.push("t.campaign_id = ?");
    params.push(Number(campaignId));
  }

  const rows = query(
    `SELECT t.* FROM chain_transactions t
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.block_number DESC, t.log_index DESC
      LIMIT ?`,
    [...params, Math.min(Math.max(Number(limit) || 50, 1), 500)]
  );

  return rows.map((row) => ({
    ...mapTransaction(row),
    extra: parseExtra(row.extra),
  }));
}

export function listCampaignIdsWithEvents() {
  return query(
    `SELECT DISTINCT campaign_id FROM chain_transactions
      WHERE campaign_id IS NOT NULL AND event_type = 'contribution'
      ORDER BY campaign_id ASC`
  ).map((row) => Number(row.campaign_id));
}

function parseExtra(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function mapTransaction(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    chainId: Number(row.chain_id),
    contractAddress: row.contract_address,
    txHash: row.tx_hash,
    logIndex: Number(row.log_index),
    blockNumber: Number(row.block_number),
    transactionIndex: Number(row.transaction_index),
    timestamp: Number(row.block_timestamp),
    eventType: row.event_type,
    campaignId: row.campaign_id === null ? null : Number(row.campaign_id),
    campaignName: row.campaign_name || null,
    actorAddress: row.actor_address || null,
    donorWallet: row.donor_wallet || null,
    cfUserId: row.donor_cf_user_id || null,
    amountWei: String(row.amount_wei || "0"),
    status: row.status,
    confirmations: Number(row.confirmations || 0),
    rewardEligible: row.reward_eligible === undefined ? true : Number(row.reward_eligible) === 1,
    refundedAt: row.refunded_at ? Number(row.refunded_at) : null,
    extra: parseExtra(row.extra),
  };
}

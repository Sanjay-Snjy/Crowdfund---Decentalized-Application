/**
 * Administrator requests for milestone evidence.
 *
 * One row per "please submit the evidence for milestone N of campaign X". The
 * on-chain half of the milestone mechanism stays untouched — this only records the
 * ask, so the creator has a visible, timestamped request to act on and the request
 * closes itself when the evidence actually lands on-chain.
 *
 * Async: the store may be a remote libSQL database.
 */
import { getRow, query, run } from "./driver.js";

const MAX_NOTE = 500;
const DEFAULT_LIMIT = 20;

function clampLimit(limit) {
  return Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 100);
}

export function normalizeNote(note) {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_NOTE);
}

/** Operator label for the audit trail: never a name, only the trusted identity. */
export function actorLabel(identity) {
  if (!identity) return "unknown";
  if (identity.source === "clerk" && identity.clerkUserId) return `clerk:${identity.clerkUserId}`;
  if (identity.walletAddress) return `wallet:${String(identity.walletAddress).toLowerCase()}`;
  return "unknown";
}

/**
 * The pending request for one milestone, or null. Used to keep a re-request
 * idempotent instead of stacking duplicates for the same milestone.
 */
export async function getPendingRequest({ chainId, contractAddress, campaignId, milestoneIndex }) {
  const row = await getRow(
    `SELECT * FROM milestone_evidence_requests
      WHERE chain_id = ? AND contract_address = ? AND campaign_id = ?
        AND milestone_index = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [Number(chainId), String(contractAddress).toLowerCase(), Number(campaignId), Number(milestoneIndex)]
  );
  return row ? mapRequest(row) : null;
}

/**
 * Create a request — or refresh the note on the pending one already there, so a
 * milestone can never accumulate several open asks.
 */
export async function createRequest({
  chainId,
  contractAddress,
  campaignId,
  milestoneIndex,
  note = null,
  requestedBy,
}) {
  const scope = { chainId, contractAddress, campaignId, milestoneIndex };
  const now = Math.floor(Date.now() / 1000);
  const existing = await getPendingRequest(scope);

  if (existing) {
    await run(
      `UPDATE milestone_evidence_requests SET note = ?, requested_by = ?, created_at = ? WHERE id = ?`,
      [normalizeNote(note), requestedBy, now, existing.id]
    );
    return { ...existing, note: normalizeNote(note), requestedBy, createdAt: now, refreshed: true };
  }

  await run(
    `INSERT INTO milestone_evidence_requests
       (chain_id, contract_address, campaign_id, milestone_index, note, requested_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      Number(chainId),
      String(contractAddress).toLowerCase(),
      Number(campaignId),
      Number(milestoneIndex),
      normalizeNote(note),
      requestedBy,
      now,
    ]
  );

  const created = await getPendingRequest(scope);
  return created ? { ...created, refreshed: false } : null;
}

/** Requests for one campaign, newest first. */
export async function listRequests({ chainId, contractAddress, campaignId, limit = DEFAULT_LIMIT }) {
  const rows = await query(
    `SELECT * FROM milestone_evidence_requests
      WHERE chain_id = ? AND contract_address = ? AND campaign_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [
      Number(chainId),
      String(contractAddress).toLowerCase(),
      Number(campaignId),
      clampLimit(limit),
    ]
  );
  return rows.map(mapRequest);
}

/**
 * Close a request once the on-chain evidence exists. Only a pending row is
 * touched, so the completion time is written exactly once.
 */
export async function markFulfilled(id, { cid = null, at = null } = {}) {
  await run(
    `UPDATE milestone_evidence_requests
        SET status = 'fulfilled', fulfilled_at = ?, fulfilled_cid = ?
      WHERE id = ? AND status = 'pending'`,
    [Number(at) || Math.floor(Date.now() / 1000), cid || null, Number(id)]
  );
  const row = await getRow(`SELECT * FROM milestone_evidence_requests WHERE id = ?`, [Number(id)]);
  return row ? mapRequest(row) : null;
}

/** Pending requests for a whole campaign, keyed by milestone index. */
export function pendingByMilestone(requests) {
  const map = new Map();
  for (const request of requests) {
    if (request.status !== "pending") continue;
    if (!map.has(request.milestoneIndex)) map.set(request.milestoneIndex, request);
  }
  return map;
}

export function mapRequest(row) {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    milestoneIndex: Number(row.milestone_index),
    note: row.note || null,
    requestedBy: row.requested_by || null,
    status: row.status === "fulfilled" ? "fulfilled" : "pending",
    createdAt: Number(row.created_at || 0),
    fulfilledAt: row.fulfilled_at ? Number(row.fulfilled_at) : null,
    fulfilledCid: row.fulfilled_cid || null,
  };
}

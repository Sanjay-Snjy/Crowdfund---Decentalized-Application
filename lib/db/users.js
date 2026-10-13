/**
 * User profiles + CrowdFund User IDs.
 *
 * Identity rules enforced here:
 *  - The application only ever shows `cf_user_id` (CF-0001 …). Clerk user ids are
 *    stored privately to bind an authenticated session to a CrowdFund record.
 *  - Exactly one CrowdFund User ID per profile; an assigned ID is never changed.
 *  - IDs come from a database counter allocated inside a write transaction, so two
 *    simultaneous registrations can never receive the same ID (the UNIQUE
 *    constraint on cf_user_id/cf_seq is the final backstop).
 *  - Registration is idempotent: retries and duplicate webhook deliveries return
 *    the existing profile instead of creating a second one.
 */
import crypto from "node:crypto";
import { getRow, query, run, transaction } from "./driver.js";

export const CF_ID_PREFIX = "CF-";
export const CF_ID_PAD = 4;

/**
 * Thrown when a signature-verified wallet is already connected to a different
 * registered account (see linkWalletToUser).
 */
export class WalletLinkConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "WalletLinkConflictError";
    this.code = "WALLET_ALREADY_LINKED";
  }
}

export function formatCfUserId(seq) {
  const numeric = Number(seq);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid CrowdFund sequence: ${seq}`);
  }
  return `${CF_ID_PREFIX}${String(numeric).padStart(CF_ID_PAD, "0")}`;
}

export function parseCfUserId(cfUserId) {
  const match = /^CF-(\d{1,12})$/i.exec(String(cfUserId || "").trim());
  if (!match) return null;
  const seq = Number(match[1]);
  return Number.isFinite(seq) && seq > 0 ? seq : null;
}

export function normalizeWalletAddress(address) {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function hashEmail(email) {
  if (typeof email !== "string" || !email.trim()) return null;
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** Caller must already be inside a transaction. */
function allocateCfSeq() {
  run("UPDATE counters SET value = value + 1 WHERE name = 'cf_user_id'");
  const row = getRow("SELECT value FROM counters WHERE name = 'cf_user_id'");
  if (!row) throw new Error("CrowdFund ID counter is missing");
  return Number(row.value);
}

export const USER_COLUMNS = `
  id, cf_seq, cf_user_id, clerk_user_id, auth_source, display_name, email_hash,
  wallet_address, wallet_linked_at, role, public_display, anonymous_donations,
  status, merged_into, registered_at, updated_at
`;

export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    cfUserId: row.cf_user_id,
    displayName: row.display_name || null,
    walletAddress: row.wallet_address || null,
    walletConnected: Boolean(row.wallet_address),
    walletLinkedAt: row.wallet_linked_at ? Number(row.wallet_linked_at) : null,
    role: row.role,
    publicDisplay: Boolean(row.public_display),
    anonymousDonations: Boolean(row.anonymous_donations),
    status: row.status,
    registeredAt: Number(row.registered_at),
  };
}

export function getUserById(id) {
  return getRow(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
}

export function getUserByClerkId(clerkUserId) {
  if (!clerkUserId) return null;
  return getRow(`SELECT ${USER_COLUMNS} FROM users WHERE clerk_user_id = ?`, [clerkUserId]);
}

export function getUserByCfUserId(cfUserId) {
  const seq = parseCfUserId(cfUserId);
  if (!seq) return null;
  return getRow(`SELECT ${USER_COLUMNS} FROM users WHERE cf_seq = ?`, [seq]);
}

export function getUserByWallet(address) {
  const normalized = normalizeWalletAddress(address);
  if (!normalized) return null;
  return getRow(`SELECT ${USER_COLUMNS} FROM users WHERE wallet_address = ?`, [normalized]);
}

/** Map of lowercase wallet address → cf_user_id, for public donor labelling. */
export function cfUserIdsForWallets(addresses) {
  const normalized = [...new Set((addresses || []).map(normalizeWalletAddress).filter(Boolean))];
  if (normalized.length === 0) return new Map();

  const placeholders = normalized.map(() => "?").join(",");
  const rows = query(
    `SELECT wallet_address, cf_user_id FROM users
      WHERE status = 'active' AND wallet_address IN (${placeholders})`,
    normalized
  );

  return new Map(rows.map((row) => [row.wallet_address, row.cf_user_id]));
}

function displayNameFromParts({ displayName, firstName, lastName, username, email }) {
  const explicit = typeof displayName === "string" ? displayName.trim() : "";
  if (explicit) return explicit;

  const combined = [firstName, lastName]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();
  if (combined) return combined;
  if (username && String(username).trim()) return String(username).trim();
  if (email && email.includes("@")) return email.split("@")[0];
  return null;
}

/**
 * Register (or refresh) the profile that belongs to a Clerk account.
 * Idempotent: repeated calls — including duplicate `user.created` webhook
 * deliveries and retried requests — always resolve to the same row.
 */
export function ensureUserFromClerk({
  clerkUserId,
  displayName,
  firstName,
  lastName,
  username,
  email,
  registeredAt,
}) {
  if (!clerkUserId || typeof clerkUserId !== "string") {
    throw new Error("ensureUserFromClerk requires a clerkUserId");
  }

  const resolvedName = displayNameFromParts({
    displayName,
    firstName,
    lastName,
    username,
    email,
  });
  const emailHash = hashEmail(email);

  return transaction(() => {
    const existing = getRow(`SELECT ${USER_COLUMNS} FROM users WHERE clerk_user_id = ?`, [
      clerkUserId,
    ]);

    if (existing) {
      // Never touch cf_seq / cf_user_id: an assigned CrowdFund User ID is permanent.
      run(
        `UPDATE users
            SET display_name = COALESCE(?, display_name),
                email_hash   = COALESCE(?, email_hash),
                updated_at   = ?
          WHERE id = ?`,
        [resolvedName, emailHash, nowSeconds(), existing.id]
      );
      return getUserById(existing.id);
    }

    const registered = registeredAt ? Math.floor(Number(registeredAt) / 1000) || nowSeconds() : nowSeconds();
    const seq = allocateCfSeq();
    const timestamp = nowSeconds();
    const cfUserId = formatCfUserId(seq);

    run(
      `INSERT INTO users
         (cf_seq, cf_user_id, clerk_user_id, auth_source, display_name, email_hash,
          role, public_display, status, registered_at, updated_at)
       VALUES (?, ?, ?, 'clerk', ?, ?, 'user', 1, 'active', ?, ?)`,
      [seq, cfUserId, clerkUserId, resolvedName, emailHash, registered, timestamp]
    );

    return getUserByClerkId(clerkUserId);
  });
}

/**
 * Register (or refresh) a wallet-only profile, i.e. a user who proved control of
 * a wallet by signing a server-issued nonce but has no Clerk account attached
 * yet. Also idempotent per wallet address.
 */
export function ensureUserFromWallet({ address, displayName, registeredAt }) {
  const normalized = normalizeWalletAddress(address);
  if (!normalized) throw new Error("ensureUserFromWallet requires a valid wallet address");

  return transaction(() => {
    const existing = getRow(`SELECT ${USER_COLUMNS} FROM users WHERE wallet_address = ?`, [
      normalized,
    ]);

    const timestamp = nowSeconds();

    if (existing) {
      run(
        `UPDATE users
            SET display_name = COALESCE(?, display_name),
                status = CASE WHEN status = 'active' THEN 'active' ELSE status END,
                updated_at = ?
          WHERE id = ?`,
        [displayName ? String(displayName).trim() : null, timestamp, existing.id]
      );
      return getUserById(existing.id);
    }

    const registered = registeredAt
      ? Math.floor(Number(registeredAt) / 1000) || timestamp
      : timestamp;
    const seq = allocateCfSeq();
    const cfUserId = formatCfUserId(seq);

    run(
      `INSERT INTO users
         (cf_seq, cf_user_id, auth_source, display_name, wallet_address, wallet_linked_at,
          role, public_display, status, registered_at, updated_at)
       VALUES (?, ?, 'wallet', ?, ?, ?, 'user', 1, 'active', ?, ?)`,
      [seq, cfUserId, displayName ? String(displayName).trim() : null, normalized, timestamp, registered, timestamp]
    );

    return getUserByWallet(normalized);
  });
}

/** Re-attribute indexed transactions from one profile to another (used on merge). */
function moveTransactionOwnership(fromUserId, toUserId, walletAddress) {
  if (fromUserId === toUserId) return;
  run(
    `UPDATE chain_transactions
        SET user_id = ?
      WHERE user_id = ? OR (donor_wallet IS NOT NULL AND donor_wallet = ?)`,
    [toUserId, fromUserId, walletAddress]
  );
  run("UPDATE reward_events SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
}

/**
 * Attach a signature-verified wallet address to a profile.
 *
 * If the wallet already belongs to a wallet-only profile, that profile is merged
 * into the target profile: its CrowdFund User ID is retired (never reused) and its
 * donation/reward history is re-pointed at the surviving profile so no history is
 * lost and no duplicate rewards are produced.
 */
export function linkWalletToUser({ userId, address, displayName }) {
  const normalized = normalizeWalletAddress(address);
  if (!normalized) throw new Error("linkWalletToUser requires a valid wallet address");

  return transaction(() => {
    const target = getUserById(userId);
    if (!target) throw new Error("Target user profile not found");

    const owner = getRow(`SELECT ${USER_COLUMNS} FROM users WHERE wallet_address = ?`, [
      normalized,
    ]);

    let survivorId = target.id;

    if (owner && owner.id !== target.id) {
      const ownerIsClerkLinked = Boolean(owner.clerk_user_id);

      if (ownerIsClerkLinked && owner.status !== "merged") {
        // The wallet is already connected to another registered account. A fresh
        // signature proves control of the address, but silently moving it would
        // reassign another account's donation history, so this is refused: the
        // wallet has to be unlinked from the other profile first.
        throw new WalletLinkConflictError(
          `Wallet ${normalized} is already connected to ${owner.cf_user_id}`
        );
      }

      // Wallet-only profile: merge it into the target profile. Its CrowdFund User
      // ID is retired (never reused) and its history is re-pointed, so nothing is
      // lost and no reward is duplicated.
      run("UPDATE users SET wallet_address = NULL, updated_at = ? WHERE id = ?", [
        nowSeconds(),
        owner.id,
      ]);
      run(
        `UPDATE users
            SET status = 'merged', merged_into = ?, updated_at = ?
          WHERE id = ?`,
        [survivorId, nowSeconds(), owner.id]
      );
      moveTransactionOwnership(owner.id, survivorId, normalized);
    }

    // A wallet can be linked to exactly one profile.
    run(
      `UPDATE users
          SET wallet_address = ?, wallet_linked_at = ?, display_name = COALESCE(display_name, ?), updated_at = ?
        WHERE id = ?`,
      [normalized, nowSeconds(), displayName ? String(displayName).trim() : null, nowSeconds(), survivorId]
    );

    // A wallet can be linked to exactly one profile.
    const conflicting = getRow(
      `SELECT id, cf_user_id FROM users WHERE wallet_address = ? AND id <> ?`,
      [normalized, survivorId]
    );
    if (conflicting) {
      throw new WalletLinkConflictError(
        `Wallet ${normalized} is already connected to ${conflicting.cf_user_id}`
      );
    }

    // Attach any already-indexed donations from this wallet that are not yet tied
    // to a profile, so the donor immediately sees their history and rewards.
    attachUserToWalletHistory(survivorId, normalized);
    return getUserById(survivorId);
  });
}

export function attachUserToWalletHistory(userId, address) {
  const normalized = normalizeWalletAddress(address);
  if (!normalized) return 0;
  const result = run(
    `UPDATE chain_transactions
        SET user_id = ?
      WHERE user_id IS NULL AND donor_wallet = ?`,
    [userId, normalized]
  );
  return result.changes;
}

export function updateUserProfile({ userId, displayName, publicDisplay, anonymousDonations }) {
  const current = getUserById(userId);
  if (!current) return null;

  run(
    `UPDATE users
        SET display_name        = COALESCE(?, display_name),
            public_display      = COALESCE(?, public_display),
            anonymous_donations = COALESCE(?, anonymous_donations),
            updated_at          = ?
      WHERE id = ?`,
    [
      displayName === undefined || displayName === null ? null : String(displayName).trim(),
      publicDisplay === undefined ? null : publicDisplay ? 1 : 0,
      anonymousDonations === undefined ? null : anonymousDonations ? 1 : 0,
      nowSeconds(),
      userId,
    ]
  );

  return getUserById(userId);
}

export function setUserRole(userId, role) {
  if (!["user", "admin"].includes(role)) throw new Error(`Unsupported role: ${role}`);
  const result = run("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [
    role,
    nowSeconds(),
    userId,
  ]);
  return result.changes > 0 ? getUserById(userId) : null;
}

export function countUsers() {
  const row = getRow("SELECT COUNT(*) AS total FROM users WHERE status = 'active'");
  return Number(row?.total || 0);
}

export function countAdminUsers() {
  const row = getRow(
    "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'"
  );
  return Number(row?.total || 0);
}

/**
 * Newest registered users first. Cursor pagination (`beforeId`) is used instead of
 * OFFSET so a user registering while the admin is paging cannot shift rows.
 */
export function listRecentUsers({ limit = 20, offset = 0, beforeId = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const rows = beforeId
    ? query(
        `SELECT ${USER_COLUMNS} FROM users
          WHERE id < ?
          ORDER BY registered_at DESC, id DESC
          LIMIT ?`,
        [beforeId, safeLimit]
      )
    : query(
        `SELECT ${USER_COLUMNS} FROM users
          ORDER BY registered_at DESC, id DESC
          LIMIT ? OFFSET ?`,
        [safeLimit, safeOffset]
      );

  return rows.map((row) => ({
    id: Number(row.id),
    cfUserId: row.cf_user_id,
    displayName: row.display_name || null,
    walletAddress: row.wallet_address || null,
    walletConnected: Boolean(row.wallet_address),
    role: row.role,
    authSource: row.auth_source,
    registeredAt: Number(row.registered_at),
  }));
}

export function countUsersForSearch() {
  return countUsers();
}

/** Public-safe donor label lookup: display name is only exposed when allowed. */
export function publicDonorLabels(addresses) {
  const normalized = [...new Set((addresses || []).map(normalizeWalletAddress).filter(Boolean))];
  if (normalized.length === 0) return new Map();

  const placeholders = normalized.map(() => "?").join(",");
  const rows = query(
    `SELECT wallet_address, cf_user_id, display_name, public_display, anonymous_donations
       FROM users
      WHERE status = 'active' AND wallet_address IN (${placeholders})`,
    normalized
  );

  return new Map(
    rows.map((row) => [
      row.wallet_address,
      {
        cfUserId: row.cf_user_id,
        displayName:
          Number(row.public_display) === 1 && Number(row.anonymous_donations) !== 1
            ? row.display_name || null
            : null,
        anonymous: Number(row.anonymous_donations) === 1,
      },
    ])
  );
}

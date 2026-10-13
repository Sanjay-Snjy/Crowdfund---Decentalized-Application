/**
 * Wallet-signature sessions.
 *
 * The app must enforce administrator authorization on the server, and Clerk is
 * only one of the two identities it accepts:
 *
 *   1. Clerk — the signed-in session, verified by Clerk via `getAuth(req)`.
 *   2. Wallet — the owner signed a single-use server nonce with `personal_sign`.
 *      That proves control of the address without any shared secret, which keeps
 *      the admin surface usable in environments where Clerk secrets are not set.
 *
 * Session tokens are random 256-bit values; only their SHA-256 hash is stored, so
 * a database leak cannot be replayed as a login.
 */
import crypto from "node:crypto";
import { getRow, run } from "./driver.js";

export const NONCE_TTL_SECONDS = 5 * 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function createNonce({ address, purpose = "user" }) {
  const nonce = crypto.randomBytes(24).toString("hex");
  const created = nowSeconds();
  run(
    `INSERT INTO auth_nonces (nonce, address, purpose, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [nonce, String(address).toLowerCase(), purpose, created, created + NONCE_TTL_SECONDS]
  );
  return { nonce, expiresAt: created + NONCE_TTL_SECONDS };
}

/**
 * Atomically consumes a nonce. Returns the stored row when the nonce was valid,
 * unused and unexpired (single use, replay-proof), otherwise null.
 */
export function consumeNonce({ nonce, address, purpose }) {
  const normalized = String(address || "").toLowerCase();
  const result = run(
    `UPDATE auth_nonces
        SET used_at = ?
      WHERE nonce = ? AND address = ? AND purpose = ? AND used_at IS NULL AND expires_at >= ?`,
    [nowSeconds(), String(nonce), normalized, purpose, nowSeconds()]
  );

  if (result.changes === 0) return null;

  return getRow(
    "SELECT nonce, address, purpose, created_at, expires_at FROM auth_nonces WHERE nonce = ?",
    [String(nonce)]
  );
}

export function createSession({ userId, address = null, purpose = "user", ttlSeconds = SESSION_TTL_SECONDS }) {
  const token = crypto.randomBytes(32).toString("hex");
  const created = nowSeconds();
  run(
    `INSERT INTO sessions (token_hash, user_id, address, purpose, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [hashToken(token), userId ?? null, address ? String(address).toLowerCase() : null, purpose, created, created + ttlSeconds]
  );
  return { token, expiresAt: created + ttlSeconds };
}

export function getSession(token) {
  if (!token) return null;
  const row = getRow(
    `SELECT s.id, s.user_id, s.address, s.purpose, s.expires_at, s.revoked_at,
            u.id AS u_id, u.cf_seq, u.cf_user_id, u.clerk_user_id, u.display_name,
            u.wallet_address, u.role, u.status, u.public_display, u.anonymous_donations,
            u.registered_at, u.wallet_linked_at
       FROM sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [hashToken(token)]
  );

  if (!row) return null;
  if (row.revoked_at) return null;
  if (Number(row.expires_at) <= nowSeconds()) return null;

  return {
    sessionId: Number(row.id),
    purpose: row.purpose,
    address: row.address,
    expiresAt: Number(row.expires_at),
    user: row.u_id
      ? {
          id: Number(row.u_id),
          cfUserId: row.cf_user_id,
          displayName: row.display_name || null,
          walletAddress: row.wallet_address || null,
          role: row.role,
          status: row.status,
          publicDisplay: Boolean(row.public_display),
          anonymousDonations: Boolean(row.anonymous_donations),
          registeredAt: Number(row.registered_at),
          walletLinkedAt: row.wallet_linked_at ? Number(row.wallet_linked_at) : null,
        }
      : null,
  };
}

export function revokeSession(token) {
  if (!token) return 0;
  return run(
    "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    [nowSeconds(), hashToken(token)]
  ).changes;
}

export function revokeSessionsForUser(userId) {
  return run(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    [nowSeconds(), userId]
  ).changes;
}

export function pruneExpiredSessions() {
  const cutoff = nowSeconds();
  const sessions = run("DELETE FROM sessions WHERE expires_at < ?", [cutoff]).changes;
  const nonces = run("DELETE FROM auth_nonces WHERE expires_at < ?", [cutoff]).changes;
  return { sessions, nonces };
}

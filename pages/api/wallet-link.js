/**
 * Wallet lookups (kept for backwards compatibility with the existing UI) and the
 * wallet sign-in adapter.
 *
 * Replaces the previous in-memory Map — wallet links now live in the database and
 * are only ever created after the wallet owner signs a server-issued nonce.
 *
 *   GET  ?walletAddresses=0x..,0x..   → public profiles { walletAddress, name, cfUserId }
 *   GET  ?clerkUserId=user_xxx        → the caller's OWN linked wallet
 *   POST { action: "init",   walletAddress }                → nonce + message to sign
 *   POST { action: "verify", walletAddress, signature, message } → session cookie
 *
 * Privacy: wallet addresses are public, so their display names are returned only
 * when the owner allows public display. Email addresses are never returned, and a
 * caller can never read another account's wallet by passing its Clerk user id.
 */
import { db } from "../../lib/db/index.js";
import {
  resolveIdentityWithProfile,
  requestWalletNonce,
  verifyWalletSignature,
  setSessionCookie,
} from "../../lib/auth/identity.js";
import { badRequest, isAddressLike, methodNotAllowed, privateNoStore, readJson, serverError } from "../../lib/api/http.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function profileFromRow(row) {
  return {
    walletAddress: row.wallet_address,
    cfUserId: row.cf_user_id,
    name: Number(row.public_display) === 1 ? row.display_name || null : null,
    publicDisplay: Number(row.public_display) === 1,
    verifiedAt: row.wallet_linked_at ? Number(row.wallet_linked_at) * 1000 : null,
  };
}

async function handleGet(req, res) {
  db.init();
  privateNoStore(res);

  const { clerkUserId, walletAddresses } = req.query;

  if (clerkUserId) {
    const identity = await resolveIdentityWithProfile(req);
    if (!identity?.userId || identity.clerkUserId !== clerkUserId) {
      return res.status(403).json({ error: "You can only read your own wallet link" });
    }
    return res.status(200).json({ walletAddress: identity.user?.wallet_address || null });
  }

  if (walletAddresses) {
    const list = (Array.isArray(walletAddresses) ? walletAddresses.join(",") : walletAddresses)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .filter(isAddressLike)
      .slice(0, 100);

    if (list.length === 0) return res.status(200).json({ walletProfiles: [] });

    const placeholders = list.map(() => "?").join(",");
    const rows = db.driver.query(
      `SELECT wallet_address, cf_user_id, display_name, public_display, wallet_linked_at
         FROM users
        WHERE status = 'active' AND wallet_address IN (${placeholders})`,
      list.map((address) => address.toLowerCase())
    );

    return res.status(200).json({ walletProfiles: rows.map(profileFromRow) });
  }

  return badRequest(res, "Missing clerkUserId or walletAddresses");
}

async function handlePost(req, res) {
  db.init();
  privateNoStore(res);

  const body = await readJson(req, 32 * 1024);
  const { action, walletAddress } = body || {};

  if (!isAddressLike(walletAddress)) return badRequest(res, "A valid wallet address is required");

  if (action === "init") {
    const challenge = requestWalletNonce({ address: walletAddress, purpose: "user" });
    if (!challenge) return badRequest(res, "Invalid wallet address");
    // `nonce` keeps the old response shape; `message` is what the wallet signs.
    return res.status(200).json({ nonce: challenge.message, nonceValue: challenge.nonce, message: challenge.message });
  }

  if (action === "verify") {
    const result = verifyWalletSignature({
      address: walletAddress,
      signature: body?.signature,
      message: body?.message || body?.nonce,
      nonce: body?.nonceValue || null,
      purpose: "user",
    });

    if (!result.ok) return res.status(result.status).json({ error: result.error });

    setSessionCookie(res, result.token, SESSION_TTL_SECONDS);
    return res.status(200).json({
      success: true,
      walletAddress: walletAddress.toLowerCase(),
      cfUserId: result.user?.cfUserId || null,
      isAdmin: result.isAdmin,
    });
  }

  return badRequest(res, "Unsupported action");
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    return methodNotAllowed(res, ["GET", "POST"]);
  } catch (error) {
    return serverError(res, error, "wallet-link");
  }
}

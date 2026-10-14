/**
 * Server-side identity + authorization.
 *
 * Two identities are accepted, and both are verified server-side:
 *
 *   1. Clerk — the signed-in session token, verified by Clerk through `getAuth()`.
 *      Requires CLERK_SECRET_KEY plus the Clerk middleware (middleware.js).
 *   2. Wallet — the address owner signs a single-use server nonce, and the
 *      signature is recovered with ethers before a session cookie is issued.
 *
 * Authorization is always resolved from the database (`users.role`), never from
 * anything the browser sends. A browser can therefore never promote itself: the
 * only ways to gain the admin role are an operator allow-list entry or an
 * explicit server-side call (scripts/grant-admin.mjs).
 */
import crypto from "node:crypto";
import { ethers } from "ethers";
import { db } from "../db/index.js";
import { WalletLinkConflictError } from "../db/users.js";

export const SESSION_COOKIE = "cf_session";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookies
// ─────────────────────────────────────────────────────────────────────────────

export function parseCookies(req) {
  const header = req?.headers?.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const index = part.indexOf("=");
    if (index === -1) return acc;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

export function readSessionCookie(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

function cookieAttributes({ maxAge }) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function setSessionCookie(res, token, maxAgeSeconds) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes({ maxAge: maxAgeSeconds })}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttributes({ maxAge: 0 })}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin allow-list (bootstrap)
// ─────────────────────────────────────────────────────────────────────────────

function allowList(envName) {
  const raw = process.env[envName];
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Is this identity explicitly allow-listed by the operator?
 * `NEXT_PUBLIC_ADMIN_ADDRESS` keeps the existing admin panel behaviour working:
 * the contract owner configured there is still recognized.
 */
export function isAdminAllowlisted({ clerkUserId = null, emailHash = null, walletAddress = null }) {
  const clerkIds = allowList("CF_ADMIN_CLERK_USER_IDS");
  const emails = allowList("CF_ADMIN_EMAILS").map((email) => db.users.hashEmail(email));
  const wallets = [
    ...allowList("CF_ADMIN_WALLET_ADDRESSES"),
    ...allowList("NEXT_PUBLIC_ADMIN_ADDRESS"),
  ]
    .map((address) => address.toLowerCase())
    .filter((address) => /^0x[a-f0-9]{40}$/.test(address));

  if (clerkUserId && clerkIds.includes(clerkUserId)) return true;
  if (emailHash && emails.includes(emailHash)) return true;
  if (walletAddress && wallets.includes(String(walletAddress).toLowerCase())) return true;
  return false;
}

/** Promote a profile to admin if the allow-list says so. Returns the fresh row. */
export async function applyAdminBootstrap(user) {
  if (!user) return user;
  if (user.role === "admin") return user;

  const allowlisted = isAdminAllowlisted({
    clerkUserId: user.clerk_user_id,
    emailHash: user.email_hash,
    walletAddress: user.wallet_address,
  });

  if (!allowlisted) return user;
  const promoted = await db.users.setUserRole(user.id, "admin");
  return promoted || user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clerk
// ─────────────────────────────────────────────────────────────────────────────

export function clerkEnabled() {
  return Boolean(
    process.env.CLERK_SECRET_KEY &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      !String(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).includes("your_clerk_publishable_key_here")
  );
}

async function clerkAuth(req) {
  if (!clerkEnabled()) return null;
  try {
    const { getAuth } = await import("@clerk/nextjs/server");
    const auth = getAuth(req);
    return auth?.userId ? auth : null;
  } catch (error) {
    // Clerk middleware missing or token invalid — fall through to the wallet path.
    return null;
  }
}

/** Clerk user id from the request, or null when Clerk is not (yet) configured. */
export async function getClerkUserId(req) {
  const auth = await clerkAuth(req);
  return auth?.userId || null;
}

/**
 * Resolve the current identity without provisioning anything.
 * Returns { source, userId (db), user, clerkUserId, walletAddress } or null.
 */
export async function resolveIdentity(req) {
  const clerkUserId = await getClerkUserId(req);
  if (clerkUserId) {
    const user = await db.users.getUserByClerkId(clerkUserId);
    return {
      source: "clerk",
      clerkUserId,
      user,
      userId: user ? Number(user.id) : null,
      walletAddress: user?.wallet_address || null,
      isAdmin: user?.role === "admin",
    };
  }

  const token = readSessionCookie(req);
  const session = token ? await db.sessions.getSession(token) : null;
  if (!session) return null;

  const user = session.user ? await db.users.getUserById(session.user.id) : null;
  return {
    source: "wallet",
    clerkUserId: null,
    sessionId: session.sessionId,
    user,
    userId: user ? Number(user.id) : null,
    walletAddress: session.address || user?.wallet_address || null,
    isAdmin: user?.role === "admin",
  };
}

/**
 * Clerk profile parts for a user id (first/last name, username, primary email and
 * registration date). Falls back to `{ clerkUserId }` when Clerk cannot be reached:
 * the id we already trust is enough to register a profile.
 */
async function loadClerkProfile(clerkUserId) {
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(clerkUserId);

    return {
      clerkUserId,
      firstName: clerkUser?.firstName,
      lastName: clerkUser?.lastName,
      username: clerkUser?.username,
      email:
        clerkUser?.primaryEmailAddress?.emailAddress ||
        clerkUser?.emailAddresses?.[0]?.emailAddress ||
        null,
      registeredAt: clerkUser?.createdAt,
    };
  } catch (error) {
    console.warn("[auth] Clerk profile lookup failed:", error?.message);
    return { clerkUserId };
  }
}

/**
 * Resolve the identity and make sure a CrowdFund profile exists for it.
 *
 * This is the safety net for environments where the Clerk webhook has not been
 * configured yet: the first authenticated request registers the profile and its
 * CrowdFund User ID. It is idempotent, so a later `user.created` webhook delivery
 * simply finds the same row.
 */
export async function resolveIdentityWithProfile(req) {
  const identity = await resolveIdentity(req);
  if (!identity) return null;

  // Register the profile on first sight, and backfill a missing display name for
  // profiles that were registered before Clerk reported one (or by a webhook that
  // carried no name). The display name is derived from Clerk only — the app never
  // lets a user type it — so the header, the identity card and the public donor
  // lists always agree.
  const needsClerkProfile =
    identity.source === "clerk" && (!identity.user || !identity.user.display_name);

  if (needsClerkProfile) {
    const profile = await loadClerkProfile(identity.clerkUserId);
    const registered = await db.users.ensureUserFromClerk(profile);
    identity.user = await applyAdminBootstrap(registered || identity.user);

    if (identity.user?.wallet_address) {
      await db.users.attachUserToWalletHistory(identity.user.id, identity.user.wallet_address);
    }
  } else if (identity.user) {
    identity.user = await applyAdminBootstrap(identity.user);
  }

  if (identity.user) {
    identity.userId = Number(identity.user.id);
    identity.walletAddress = identity.user.wallet_address || identity.walletAddress;
    identity.isAdmin = identity.user.role === "admin";
  }

  return identity;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet sign-in
// ─────────────────────────────────────────────────────────────────────────────

export function buildSignInMessage({ address, nonce, purpose }) {
  const lines = [
    "CrowdFund wants you to sign in with your wallet.",
    "",
    `Address: ${address}`,
    `Purpose: ${purpose === "admin" ? "Administrator access" : "CrowdFund account"}`,
    `Nonce: ${nonce}`,
    "",
    "This signature proves you control this wallet. It is free and moves no funds.",
  ];
  return lines.join("\n");
}

export async function requestWalletNonce({ address, purpose = "user" }) {
  const normalized = db.users.normalizeWalletAddress(address);
  if (!normalized) return null;

  const { nonce } = await db.sessions.createNonce({ address: normalized, purpose });
  return {
    address: normalized,
    nonce,
    purpose,
    message: buildSignInMessage({ address: normalized, nonce, purpose }),
  };
}

/**
 * Verify a wallet signature and issue a session. Creates the wallet-only profile
 * on first sign-in (which is what gives a wallet user a CrowdFund User ID).
 */
export async function verifyWalletSignature({ address, signature, message = null, nonce = null, purpose = "user" }) {
  const normalized = db.users.normalizeWalletAddress(address);
  if (!normalized) return { ok: false, status: 400, error: "Invalid wallet address" };
  if (typeof signature !== "string" || !signature.trim()) {
    return { ok: false, status: 400, error: "Missing signature" };
  }

  // The client echoes back the exact message it signed. The nonce inside it is
  // bound to this address and purpose (enforced when it is consumed below), so a
  // signed message can never be replayed for another wallet.
  const signedMessage = typeof message === "string" && message.trim() ? message : null;
  const nonceFromMessage = signedMessage
    ? /Nonce:\s*([a-f0-9]+)/i.exec(signedMessage)?.[1] || null
    : null;
  const resolvedNonce = nonce || nonceFromMessage;

  if (!signedMessage || !resolvedNonce) {
    return { ok: false, status: 400, error: "Missing signed message or nonce" };
  }

  if (!signedMessage.includes(`Nonce: ${resolvedNonce}`)) {
    return { ok: false, status: 400, error: "Signed message does not match the issued nonce" };
  }

  let recovered;
  try {
    recovered = ethers.utils.verifyMessage(
      signedMessage,
      signature.startsWith("0x") ? signature : `0x${signature}`
    );
  } catch (error) {
    return { ok: false, status: 400, error: "Signature verification failed" };
  }

  if (recovered.toLowerCase() !== normalized) {
    return { ok: false, status: 401, error: "Signature does not match the wallet address" };
  }

  const consumed = await db.sessions.consumeNonce({
    nonce: resolvedNonce,
    address: normalized,
    purpose,
  });
  if (!consumed) {
    return { ok: false, status: 401, error: "Nonce is invalid, already used or expired" };
  }

  const existing = await db.users.getUserByWallet(normalized);
  let user = existing
    ? await applyAdminBootstrap(existing)
    : await applyAdminBootstrap(await db.users.ensureUserFromWallet({ address: normalized }));

  if (user) {
    await db.users.attachUserToWalletHistory(user.id, normalized);
  }

  const { token, expiresAt } = await db.sessions.createSession({
    userId: user ? Number(user.id) : null,
    address: normalized,
    purpose,
  });

  return {
    ok: true,
    token,
    expiresAt,
    user: user ? db.users.toPublicUser(user) : null,
    isAdmin: user?.role === "admin",
  };
}

export async function signOut(req, res) {
  const token = readSessionCookie(req);
  if (token) await db.sessions.revokeSession(token);
  clearSessionCookie(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

export async function requireUser(req) {
  const identity = await resolveIdentityWithProfile(req);
  if (!identity || !identity.user) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  return { ok: true, status: 200, identity };
}

/**
 * Administrator guard. Enforced here (server-side) for every admin route; the
 * frontend only hides UI — it is never the control.
 */
export async function requireAdmin(req) {
  const identity = await resolveIdentityWithProfile(req);

  if (!identity || !identity.user) {
    return {
      ok: false,
      status: 401,
      error: "Administrator authentication required",
      hint: "Sign in with Clerk, or connect and sign with an allow-listed wallet.",
    };
  }

  if (identity.user.role !== "admin") {
    return { ok: false, status: 403, error: "Administrator privileges are required" };
  }

  return { ok: true, status: 200, identity };
}

/** Random request id helper (used for error correlation in logs). */
export function requestId() {
  return crypto.randomBytes(8).toString("hex");
}

export { WalletLinkConflictError };
export { nowSeconds };

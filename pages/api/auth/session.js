/**
 * GET    /api/auth/session  → current identity (Clerk or wallet) + CrowdFund profile
 * DELETE /api/auth/session  → sign out (revokes the wallet session cookie)
 */
import { db } from "../../../lib/db/index.js";
import {
  clerkEnabled,
  resolveIdentityWithProfile,
  signOut,
} from "../../../lib/auth/identity.js";
import { methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";

function publicIdentity(identity) {
  if (!identity) return null;
  return {
    authenticated: true,
    source: identity.source,
    cfUserId: identity.user?.cf_user_id || null,
    displayName: identity.user?.display_name || null,
    walletAddress: identity.user?.wallet_address || identity.walletAddress || null,
    isAdmin: Boolean(identity.isAdmin),
    publicDisplay: identity.user ? Number(identity.user.public_display) === 1 : true,
    anonymousDonations: identity.user ? Number(identity.user.anonymous_donations) === 1 : false,
    registeredAt: identity.user ? Number(identity.user.registered_at) : null,
  };
}

export default async function handler(req, res) {
  if (!["GET", "DELETE"].includes(req.method)) return methodNotAllowed(res, ["GET", "DELETE"]);

  try {
    await db.init();
    privateNoStore(res);

    if (req.method === "DELETE") {
      await signOut(req, res);
      return res.status(200).json({ authenticated: false });
    }

    const identity = await resolveIdentityWithProfile(req);
    return res.status(200).json({
      authenticated: Boolean(identity?.user),
      clerkConfigured: clerkEnabled(),
      identity: publicIdentity(identity),
    });
  } catch (error) {
    return serverError(res, error, "auth-session");
  }
}

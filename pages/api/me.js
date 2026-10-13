/**
 * GET   /api/me  → the signed-in CrowdFund profile (CrowdFund User ID, display
 *                  name, linked wallet, role, reward summary)
 * PATCH /api/me  → display name / public display / anonymous donations preference
 *
 * Private, never cached. The Clerk user id is intentionally NOT part of the
 * response: the application only ever exposes the CrowdFund User ID.
 */
import { db } from "../../lib/db/index.js";
import { requireUser } from "../../lib/auth/identity.js";
import { computeRewards } from "../../lib/rewards/index.js";
import { badRequest, methodNotAllowed, privateNoStore, readJson, serverError } from "../../lib/api/http.js";

const MAX_NAME_LENGTH = 60;

function sanitizeName(value) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  return trimmed || null;
}

export default async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) return methodNotAllowed(res, ["GET", "PATCH"]);

  try {
    db.init();
    privateNoStore(res);

    const guard = await requireUser(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const { identity } = guard;

    if (req.method === "PATCH") {
      const body = await readJson(req, 8 * 1024);
      const displayName = sanitizeName(body?.displayName);
      const publicDisplay = typeof body?.publicDisplay === "boolean" ? body.publicDisplay : undefined;
      const anonymousDonations =
        typeof body?.anonymousDonations === "boolean" ? body.anonymousDonations : undefined;

      if (displayName === undefined && publicDisplay === undefined && anonymousDonations === undefined) {
        return badRequest(res, "Nothing to update");
      }

      const updated = db.users.updateUserProfile({
        userId: identity.userId,
        displayName,
        publicDisplay,
        anonymousDonations,
      });

      identity.user = updated;
    }

    const rewards = computeRewards({
      userId: identity.userId,
      walletAddress: identity.user?.wallet_address || null,
      cfUserId: identity.user?.cf_user_id || null,
    });

    return res.status(200).json({
      profile: {
        cfUserId: identity.user.cf_user_id,
        displayName: identity.user.display_name,
        walletAddress: identity.user.wallet_address,
        walletConnected: Boolean(identity.user.wallet_address),
        walletLinkedAt: identity.user.wallet_linked_at ? Number(identity.user.wallet_linked_at) : null,
        role: identity.user.role,
        isAdmin: identity.user.role === "admin",
        publicDisplay: Number(identity.user.public_display) === 1,
        anonymousDonations: Number(identity.user.anonymous_donations) === 1,
        registeredAt: Number(identity.user.registered_at),
        authSource: identity.source,
      },
      rewards: {
        points: rewards.points,
        eligibleWei: rewards.eligibleWei,
        eligibleContributionCount: rewards.eligibleContributionCount,
        campaignsSupported: rewards.campaignsSupported,
        badges: rewards.badges,
      },
    });
  } catch (error) {
    return serverError(res, error, "me");
  }
}

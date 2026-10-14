/**
 * GET   /api/me  → the signed-in CrowdFund profile (CrowdFund User ID, display
 *                  name, linked wallet, role, reward summary)
 * PATCH /api/me  → public display / anonymous donations preference
 *
 * Private, never cached. The Clerk user id is intentionally NOT part of the
 * response: the application only ever exposes the CrowdFund User ID. The display
 * name is READ-ONLY here — it is derived from the signed-in Clerk account by
 * ensureUserFromClerk(), so the header, the identity card and the public donor
 * lists can never disagree.
 */
import { db } from "../../lib/db/index.js";
import { requireUser } from "../../lib/auth/identity.js";
import { computeRewards } from "../../lib/rewards/index.js";
import { badRequest, methodNotAllowed, privateNoStore, readJson, serverError } from "../../lib/api/http.js";

export default async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) return methodNotAllowed(res, ["GET", "PATCH"]);

  try {
    await db.init();
    privateNoStore(res);

    const guard = await requireUser(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const { identity } = guard;

    if (req.method === "PATCH") {
      const body = await readJson(req, 8 * 1024);

      // A client-supplied display name is refused rather than silently ignored: the
      // name shown everywhere is the one on the signed-in Clerk account.
      if (body?.displayName !== undefined) {
        return badRequest(res, "The display name comes from your Clerk account and cannot be set here");
      }

      const publicDisplay = typeof body?.publicDisplay === "boolean" ? body.publicDisplay : undefined;
      const anonymousDonations =
        typeof body?.anonymousDonations === "boolean" ? body.anonymousDonations : undefined;

      if (publicDisplay === undefined && anonymousDonations === undefined) {
        return badRequest(res, "Nothing to update");
      }

      const updated = await db.users.updateUserProfile({
        userId: identity.userId,
        publicDisplay,
        anonymousDonations,
      });

      identity.user = updated;
    }

    const rewards = await computeRewards({
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

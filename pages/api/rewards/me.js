/**
 * GET /api/rewards/me
 *
 * Rewards and badges for the signed-in CrowdFund profile, recomputed from the
 * indexed, verified contribution records every time. The browser can never
 * influence the numbers — there is no write path for rewards from a client.
 */
import { db } from "../../../lib/db/index.js";
import { requireUser } from "../../../lib/auth/identity.js";
import { computeRewards, syncRewardLedger } from "../../../lib/rewards/index.js";
import { methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    await db.init();
    privateNoStore(res);

    const guard = await requireUser(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const { identity } = guard;
    const walletAddress = identity.user.wallet_address || null;

    // Keep the persistent ledger in step with the verified records before reading.
    const ledger = await syncRewardLedger({ userId: identity.userId, walletAddress });
    const rewards = await computeRewards({
      userId: identity.userId,
      walletAddress,
      cfUserId: identity.user.cf_user_id,
    });

    // Rewards are attributed through the *linked* wallet. When the profile has none,
    // the UI explains how to link one instead of silently showing zero forever.
    return res.status(200).json({
      ...rewards,
      walletAddress,
      walletLinked: Boolean(walletAddress),
      ledger,
    });
  } catch (error) {
    return serverError(res, error, "rewards-me");
  }
}

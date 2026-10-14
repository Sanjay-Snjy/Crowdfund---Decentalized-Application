/**
 * GET /api/rewards/me[?address=0x…]
 *
 * Rewards and badges for the signed-in CrowdFund profile, recomputed from the
 * indexed, verified contribution records every time. The browser can never
 * influence the numbers — there is no write path for rewards from a client.
 *
 * `address` is the wallet the browser has connected. It is only ever a *filter*
 * over already-public, already-indexed donation records: it is used when the
 * profile has no linked wallet yet, so a user who just connected a wallet sees
 * their real points instead of a permanent zero. As soon as a wallet is linked,
 * the linked wallet is authoritative and `address` is ignored. Nothing is written
 * for an unlinked address (no reward ledger, no ownership), so passing an address
 * can never mint points for a wallet the caller does not control.
 */
import { db } from "../../../lib/db/index.js";
import { requireUser } from "../../../lib/auth/identity.js";
import { computeRewards, syncRewardLedger } from "../../../lib/rewards/index.js";
import { isAddressLike, methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    await db.init();
    privateNoStore(res);

    const guard = await requireUser(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const { identity } = guard;
    const linkedWallet = identity.user.wallet_address || null;

    // Read-only fallback: the connected wallet, accepted only while this profile
    // has no linked wallet of its own.
    const requested = typeof req.query.address === "string" ? req.query.address.trim().toLowerCase() : null;
    const connectedWallet = !linkedWallet && isAddressLike(requested) ? requested : null;
    const watchedWallet = linkedWallet || connectedWallet;

    // The persistent ledger is only maintained for the profile's own donations.
    const ledger = linkedWallet
      ? await syncRewardLedger({ userId: identity.userId, walletAddress: linkedWallet })
      : { awarded: 0, reversed: 0 };

    const rewards = await computeRewards({
      // Attribute by profile only through its linked wallet; the connected wallet is
      // matched by address alone.
      userId: linkedWallet ? identity.userId : null,
      walletAddress: watchedWallet,
      cfUserId: identity.user.cf_user_id,
    });

    return res.status(200).json({
      ...rewards,
      walletAddress: watchedWallet,
      walletLinked: Boolean(linkedWallet),
      connectedWallet,
      ledger,
    });
  } catch (error) {
    return serverError(res, error, "rewards-me");
  }
}

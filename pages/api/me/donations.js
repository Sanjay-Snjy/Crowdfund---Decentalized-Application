/**
 * GET /api/me/donations[?address=0x…]
 *
 * The signed-in user's donation history, taken from verified indexed contribution
 * events (transaction hash, campaign, amount, block timestamp, status and reward
 * eligibility). Includes donations made with a wallet that was linked later.
 *
 * `address` is the wallet the browser has connected. It is only a *filter* over
 * already-public, already-indexed donations and is used solely while the profile
 * has no linked wallet — so a user who just connected a wallet sees their history
 * immediately. Once a wallet is linked it is authoritative and `address` is
 * ignored; nothing is ever written for an unlinked address.
 */
import { db } from "../../../lib/db/index.js";
import { requireUser } from "../../../lib/auth/identity.js";
import { getChainConfig } from "../../../lib/chain/config.js";
import { maybeAutoSync } from "../../../lib/chain/indexer.js";
import { isAddressLike, methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";
import { formatEther, formatEthDisplay } from "../../../lib/format.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    await db.init();
    privateNoStore(res);

    const guard = await requireUser(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    await maybeAutoSync({ intervalSeconds: 60 });

    const config = getChainConfig();
    const { identity } = guard;
    const linkedWallet = identity.user?.wallet_address || null;
    const requested =
      typeof req.query.address === "string" ? req.query.address.trim().toLowerCase() : null;
    const connectedWallet = !linkedWallet && isAddressLike(requested) ? requested : null;
    const watchedWallet = linkedWallet || connectedWallet;

    const rows = await db.chainEvents.listDonationsForIdentity({
      userId: linkedWallet ? identity.userId : null,
      walletAddress: watchedWallet,
      limit: 100,
    });

    const donations = rows.map((row) => ({
      txHash: row.txHash,
      explorerUrl: `${config.explorerBase}/tx/${row.txHash}`,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      amountWei: row.amountWei,
      amountEth: formatEthDisplay(row.amountWei, 6),
      timestamp: row.timestamp,
      blockNumber: row.blockNumber,
      status: row.status,
      confirmations: row.confirmations,
      rewardEligible: row.rewardEligible,
      refundedAt: row.refundedAt,
      donorWallet: row.donorWallet,
    }));

    const confirmed = rows.filter((row) => row.status === "confirmed");
    const totalWei = confirmed.reduce((sum, row) => sum + BigInt(row.amountWei || "0"), 0n).toString();

    return res.status(200).json({
      cfUserId: identity.user?.cf_user_id || null,
      walletAddress: watchedWallet,
      walletLinked: Boolean(linkedWallet),
      connectedWallet,
      donations,
      summary: {
        confirmedCount: confirmed.length,
        pendingCount: rows.filter((row) => row.status === "pending").length,
        totalWei,
        totalEth: formatEther(totalWei),
        campaigns: new Set(confirmed.map((row) => row.campaignId)).size,
        refundedCount: rows.filter((row) => row.rewardEligible === false).length,
      },
      network: { chainId: config.chainId, explorerName: config.explorerName, explorerBase: config.explorerBase },
    });
  } catch (error) {
    return serverError(res, error, "me-donations");
  }
}

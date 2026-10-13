/**
 * GET /api/me/donations
 *
 * The signed-in user's donation history, taken from verified indexed contribution
 * events (transaction hash, campaign, amount, block timestamp, status and reward
 * eligibility). Includes donations made with a wallet that was linked later.
 */
import { db } from "../../../lib/db/index.js";
import { requireUser } from "../../../lib/auth/identity.js";
import { getChainConfig } from "../../../lib/chain/config.js";
import { maybeAutoSync } from "../../../lib/chain/indexer.js";
import { methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";
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
    const rows = await db.chainEvents.listDonationsForIdentity({
      userId: identity.userId,
      walletAddress: identity.user?.wallet_address || null,
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

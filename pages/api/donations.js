/**
 * GET /api/donations?campaignId=1&limit=10
 *
 * Public donation activity. Every row comes from an indexed `ContributionMade`
 * event of the deployed contract, so nothing here is simulated and a pending or
 * failed transaction can never appear as a confirmed donation.
 *
 * Donor identity: when a wallet belongs to a CrowdFund profile the CrowdFund User
 * ID (and display name, if the user allows public display) is attached. Otherwise
 * the response carries the raw wallet address and the UI shows it shortened —
 * a CrowdFund User ID is never invented for an unknown wallet.
 */
import { db } from "../../lib/db/index.js";
import { maybeAutoSync } from "../../lib/chain/indexer.js";
import { getChainConfig } from "../../lib/chain/config.js";
import { clampInt, methodNotAllowed, publicCache, serverError } from "../../lib/api/http.js";
import { formatEther } from "../../lib/format.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    await db.init();
    const config = getChainConfig();

    // Refresh from chain (throttled) so newly confirmed donations appear.
    await maybeAutoSync({ intervalSeconds: 60 });

    const campaignId =
      req.query.campaignId === undefined || req.query.campaignId === ""
        ? null
        : Number.parseInt(req.query.campaignId, 10);
    const limit = clampInt(req.query.limit, { min: 1, max: 50, fallback: 10 });

    if (campaignId !== null && !Number.isFinite(campaignId)) {
      return res.status(400).json({ error: "campaignId must be a number" });
    }

    const rows = await db.chainEvents.listRecentDonations({ campaignId, limit });
    const labels = await db.users.publicDonorLabels(rows.map((row) => row.donorWallet));

    const donations = rows.map((row) => {
      const label = row.donorWallet ? labels.get(row.donorWallet) : null;
      const cfUserId = label?.cfUserId || row.cfUserId || null;
      // A linked profile's public name wins. When the wallet has no active profile
      // row the already-attributed owner (merged wallet) is used, and the profile's
      // own public-display / anonymous flags are still respected.
      const displayName = label ? label.displayName : row.donorDisplayName || null;
      const anonymous = Boolean(label?.anonymous) || !displayName;

      return {
        txHash: row.txHash,
        explorerUrl: `${config.explorerBase}/tx/${row.txHash}`,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        amountWei: row.amountWei,
        amountEth: formatEther(row.amountWei),
        timestamp: row.timestamp,
        status: row.status,
        blockNumber: row.blockNumber,
        donor: {
          cfUserId,
          displayName,
          walletAddress: row.donorWallet,
          anonymous,
          // The label the UI renders: name → CrowdFund User ID → short address.
          label: displayName || cfUserId || shorten(row.donorWallet),
          verified: Boolean(cfUserId),
        },
      };
    });

    publicCache(res, 15);

    return res.status(200).json({
      donations,
      campaignId,
      network: {
        chainId: config.chainId,
        explorerName: config.explorerName,
        explorerBase: config.explorerBase,
        isTestnet: config.isTestnet,
      },
      contractAddress: config.contractAddress,
    });
  } catch (error) {
    return serverError(res, error, "donations");
  }
}

function shorten(address) {
  if (!address) return "Anonymous";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

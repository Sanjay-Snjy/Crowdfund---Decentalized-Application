/**
 * GET /api/stats
 *
 * Public platform totals for the landing page: campaigns launched, donor funds
 * raised and distinct contributors.
 *
 * Nothing here is hardcoded and nothing comes from the browser. The money figures
 * are summed from indexed, confirmed contribution events, minus confirmed refunds.
 * A pending transaction can never move these numbers, so a failed contribution
 * cannot inflate them.
 *
 * Two campaign counts are reported on purpose:
 *   campaigns       every campaign the contract has ever created (campaignCounter),
 *                   deactivated ones included — the all-time figure
 *   activeCampaigns the ones a visitor can actually browse, read from the same
 *                   `getActiveCampaigns` view the Explore page uses, so a campaign
 *                   an administrator deactivated never inflates the public number
 *
 * Both fall back to the cached campaign table when the RPC cannot be reached.
 */
import { db } from "../../lib/db/index.js";
import { maybeAutoSync } from "../../lib/chain/indexer.js";
import { getChainConfig } from "../../lib/chain/config.js";
import { getReadContract, withTimeout } from "../../lib/chain/provider.js";
import { methodNotAllowed, publicCache, serverError } from "../../lib/api/http.js";
import { formatEther } from "../../lib/format.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    await db.init();
    const config = getChainConfig();

    // Throttled refresh from the chain, so a newly confirmed donation shows up
    // without every browser hitting the RPC endpoint.
    await maybeAutoSync({ intervalSeconds: 60 });

    const filters = {
      chainId: config.chainId,
      contractAddress: config.contractAddress,
    };

    const [totals, contributors, campaigns, activeCampaigns] = await Promise.all([
      db.chainEvents.transactionTotals(filters),
      db.chainEvents.countUniqueDonors(filters),
      campaignCount(),
      activeCampaignCount(),
    ]);

    // Refunded donations were returned to the donor, so they are not "raised".
    const netWei = subtractWei(totals.confirmedWei, totals.refundedWei);

    publicCache(res, 20);

    return res.status(200).json({
      campaigns,
      activeCampaigns,
      contributors,
      contributions: totals.confirmedDonations,
      fundsRaisedWei: netWei,
      fundsRaisedEth: formatEther(netWei),
      grossRaisedWei: totals.confirmedWei,
      refundedWei: totals.refundedWei,
      network: {
        chainId: config.chainId,
        explorerName: config.explorerName,
        explorerBase: config.explorerBase,
        isTestnet: config.isTestnet,
      },
      generatedAt: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    return serverError(res, error, "stats");
  }
}

/**
 * Campaigns launched, straight from the contract counter. The cached campaign
 * table is only a fallback: it holds whatever the indexer has seen, which can lag
 * behind a freshly created campaign.
 */
async function campaignCount() {
  const contract = getReadContract();

  if (contract) {
    try {
      const stats = await withTimeout(contract.getContractStats(), 10000, "getContractStats");
      return Number(stats[0].toString());
    } catch (error) {
      console.warn("[stats] on-chain campaign count failed:", error?.message);
    }
  }

  return (await db.campaigns.listCampaigns({ limit: 500 })).length;
}

/**
 * Campaigns a visitor can actually browse. `getContractStats()` counts every
 * campaign ever created — deactivated ones included — so the live count is read
 * from `getActiveCampaigns`, the same view the Explore page and the landing page's
 * campaign cards use. That keeps the headline number in step with what a visitor
 * can find, instead of promising campaigns that are no longer listed anywhere.
 */
async function activeCampaignCount() {
  const contract = getReadContract();

  if (contract) {
    try {
      const active = await withTimeout(
        contract.getActiveCampaigns(0, 100),
        10000,
        "getActiveCampaigns"
      );
      return Array.isArray(active) ? active.length : 0;
    } catch (error) {
      console.warn("[stats] active campaign count failed:", error?.message);
    }
  }

  const cached = await db.campaigns.listCampaigns({ limit: 500 });
  return cached.filter((campaign) => campaign.active).length;
}

/** BigInt-safe subtraction, clamped at zero so a stale refund can never go negative. */
function subtractWei(a, b) {
  try {
    const result = BigInt(String(a || "0")) - BigInt(String(b || "0"));
    return (result > 0n ? result : 0n).toString();
  } catch {
    return "0";
  }
}

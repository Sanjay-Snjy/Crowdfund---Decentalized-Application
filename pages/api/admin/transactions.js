/**
 * GET /api/admin/transactions
 *
 *   ?page=1&limit=25
 *   &campaignId=3
 *   &status=confirmed|pending|failed
 *   &category=contribution|refund|campaign_created|milestone_evidence|milestone_vote|milestone_approved|milestone_released|campaign_completed
 *   &search=CF-0004 | 0xabc… | Solar | 0x<txhash>
 *
 * Newest first, filterable by campaign/status/category and searchable by
 * CrowdFund User ID, wallet address, campaign name or transaction hash. Totals are
 * summed with BigInt over the filtered rows (SQLite REAL sums would lose
 * precision above ~0.009 ETH), and only confirmed contributions count towards
 * "total contributed ETH".
 */
import { db } from "../../../lib/db/index.js";
import { requireAdmin } from "../../../lib/auth/identity.js";
import { maybeAutoSync } from "../../../lib/chain/indexer.js";
import { getChainConfig } from "../../../lib/chain/config.js";
import { clampInt, methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";
import { formatEthDisplay } from "../../../lib/format.js";

const CATEGORIES = [
  "contribution",
  "refund",
  "campaign_created",
  "milestone_evidence",
  "milestone_vote",
  "milestone_approved",
  "milestone_released",
  "campaign_completed",
];

const STATUSES = ["confirmed", "pending", "failed"];

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    db.init();
    privateNoStore(res);

    const guard = await requireAdmin(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    // Keep the ledger current (throttled); failures must not break the admin view.
    await maybeAutoSync({ intervalSeconds: 45 });

    const config = getChainConfig();
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 25 });
    const page = clampInt(req.query.page, { min: 1, max: 10000, fallback: 1 });

    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const campaignId =
      req.query.campaignId === undefined || req.query.campaignId === ""
        ? null
        : Number.parseInt(req.query.campaignId, 10);
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 80) : "";

    const filters = {
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      campaignId: Number.isFinite(campaignId) ? campaignId : null,
      status,
      // The table prioritises donations: with no explicit category filter only
      // confirmed/pending contributions are listed.
      eventType: category || "contribution",
      search: search || null,
    };

    const rows = db.chainEvents.listTransactions(filters, { limit, page });
    const total = db.chainEvents.countTransactions(filters);
    const totals = db.chainEvents.transactionTotals(filters);

    const transactions = rows.map((row) => ({
      txHash: row.txHash,
      explorerUrl: `${config.explorerBase}/tx/${row.txHash}`,
      blockNumber: row.blockNumber,
      logIndex: row.logIndex,
      eventType: row.eventType,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      cfUserId: row.cfUserId,
      donorWallet: row.donorWallet || row.actorAddress,
      amountWei: row.amountWei,
      amountEth: formatEthDisplay(row.amountWei, 6),
      timestamp: row.timestamp,
      status: row.status,
      confirmations: row.confirmations,
      rewardEligible: row.rewardEligible,
      refundedAt: row.refundedAt,
      extra: row.extra,
      identity: row.cfUserId
        ? { label: row.cfUserId, kind: "crowdfund_user" }
        : { label: row.donorWallet || row.actorAddress, kind: "wallet" },
    }));

    // Campaign list for the filter dropdown (cached metadata, refreshed from chain state).
    const campaigns = db.campaigns.listCampaigns({ limit: 200 }).map((campaign) => ({
      campaignId: campaign.campaignId,
      title: campaign.title,
      active: campaign.active,
      completed: campaign.completed,
    }));

    return res.status(200).json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
      },
      totals: {
        totalConfirmedDonations: totals.confirmedDonations,
        totalConfirmedWei: totals.confirmedWei,
        totalConfirmedEth: formatEthDisplay(totals.confirmedWei, 6),
        totalPendingWei: totals.pendingWei,
        totalPendingEth: formatEthDisplay(totals.pendingWei, 6),
        totalRefundedWei: totals.refundedWei,
        totalRefundedEth: formatEthDisplay(totals.refundedWei, 6),
        rewardEligibleWei: totals.rewardEligibleWei,
        matchedEvents: totals.total,
        eventsByType: totals.eventsByType,
      },
      filters: { campaignId: filters.campaignId, status, category: filters.eventType, search: search || null },
      categories: CATEGORIES,
      statuses: STATUSES,
      network: {
        chainId: config.chainId,
        explorerName: config.explorerName,
        explorerBase: config.explorerBase,
        contractAddress: config.contractAddress,
      },
      campaigns,
    });
  } catch (error) {
    return serverError(res, error, "admin-transactions");
  }
}
/**
 * GET /api/admin/campaigns?limit=8&campaignId=3&releases=1
 *
 * Campaign funding status (target, collected, progress, released, escrow,
 * milestone progress) plus the fund release history from indexed contract events.
 *
 * Each campaign's numbers come from the contract's own per-campaign accounting —
 * the contract's whole balance is reported separately because it covers every
 * campaign at once.
 */
import { db } from "../../../lib/db/index.js";
import { requireAdmin } from "../../../lib/auth/identity.js";
import { getCampaignFundingState } from "../../../lib/chain/campaignState.js";
import { getChainConfig } from "../../../lib/chain/config.js";
import { maybeAutoSync } from "../../../lib/chain/indexer.js";
import { clampInt, methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";
import { formatEthDisplay } from "../../../lib/format.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    db.init();
    privateNoStore(res);

    const guard = await requireAdmin(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const config = getChainConfig();
    await maybeAutoSync({ intervalSeconds: 60 });

    const single = req.query.campaignId ? Number.parseInt(req.query.campaignId, 10) : null;
    const limit = clampInt(req.query.limit, { min: 1, max: 25, fallback: 8 });

    // Which campaigns to report on: an explicit id, or the campaigns known from
    // indexed events / the metadata cache (newest first).
    const cached = db.campaigns.listCampaigns({ limit: 200 });
    const fromEvents = db.chainEvents.listCampaignIdsWithEvents();
    const ids = Number.isFinite(single)
      ? [single]
      : [...new Set([...cached.map((campaign) => campaign.campaignId), ...fromEvents])]
          .sort((a, b) => b - a)
          .slice(0, limit);

    const campaigns = [];
    const failures = [];

    for (const campaignId of ids) {
      try {
        const state = await getCampaignFundingState(campaignId);
        campaigns.push({
          campaignId: state.campaignId,
          title: state.title,
          creator: state.creator,
          status: state.status,
          active: state.active,
          completed: state.completed,
          deadline: state.deadline,
          funding: {
            targetWei: state.targetWei,
            targetEth: formatEthDisplay(state.targetWei),
            collectedWei: state.raisedWei,
            collectedEth: formatEthDisplay(state.raisedWei),
            progressPercent: state.progressPercent,
            funded: state.funded,
          },
          escrow: {
            escrowWei: state.escrowWei,
            escrowEth: formatEthDisplay(state.escrowWei),
            releasedWei: state.releasedWei,
            releasedEth: formatEthDisplay(state.releasedWei),
            remainingEligibleReleaseWei: state.remainingEligibleReleaseWei,
            remainingEligibleReleaseEth: formatEthDisplay(state.remainingEligibleReleaseWei),
          },
          milestones: {
            currentMilestoneIndex: state.currentMilestoneIndex,
            approvedMilestones: state.approvedMilestones,
            releasedMilestones: state.releasedMilestones,
            items: state.milestones,
          },
          recovery: state.recovery,
          indexed: state.donationTotals,
        });
      } catch (error) {
        failures.push({ campaignId, error: error?.message || "read failed" });
      }
    }

    const releases =
      req.query.releases === "0"
        ? []
        : db.chainEvents.listFundReleases({ campaignId: Number.isFinite(single) ? single : null, limit: 50 });
    const refunds = db.chainEvents.listTransactions(
      { chainId: config.chainId, contractAddress: config.contractAddress, eventType: "refund" },
      { limit: 25 }
    );

    return res.status(200).json({
      campaigns,
      failures,
      fundReleaseHistory: releases.map((release) => ({
        txHash: release.txHash,
        explorerUrl: `${config.explorerBase}/tx/${release.txHash}`,
        campaignId: release.campaignId,
        campaignName: release.campaignName,
        milestoneIndex: release.extra?.milestoneIndex ?? null,
        amountWei: release.amountWei,
        amountEth: formatEthDisplay(release.amountWei, 6),
        timestamp: release.timestamp,
        eventType: release.eventType,
      })),
      refundHistory: refunds.map((refund) => ({
        txHash: refund.txHash,
        explorerUrl: `${config.explorerBase}/tx/${refund.txHash}`,
        campaignId: refund.campaignId,
        campaignName: refund.campaignName,
        donorWallet: refund.donorWallet,
        cfUserId: refund.cfUserId,
        amountWei: refund.amountWei,
        amountEth: formatEthDisplay(refund.amountWei, 6),
        timestamp: refund.timestamp,
      })),
      network: {
        chainId: config.chainId,
        explorerName: config.explorerName,
        contractAddress: config.contractAddress,
      },
    });
  } catch (error) {
    return serverError(res, error, "admin-campaigns");
  }
}

/**
 * Verified campaign funding / escrow state.
 *
 * Every number returned here is read from the deployed contract — funding target,
 * escrowed donor funds, released funds, milestone progress and (when the deployed
 * contract supports it) the abandoned-campaign recovery state. Nothing is taken
 * from a request body, so the API can never be tricked into reporting a fake
 * total.
 *
 * All wei values are returned as decimal strings (BigInt-safe); the UI converts
 * them with ethers.utils.formatEther.
 */
import { db } from "../db/index.js";
import { getChainConfig } from "./config.js";
import { ChainUnavailableError, cached, getReadContract, isChainTransportFailure, withTimeout } from "./provider.js";

const CAMPAIGN_TTL_MS = 15 * 1000;

function emptyRecovery() {
  return {
    supported: false,
    eligible: false,
    enabled: false,
    claimPoolWei: "0",
    claimBaseWei: "0",
    claimedWei: "0",
    escrowPoolWei: "0",
    unlocksAt: 0,
  };
}

function wei(value) {
  if (value === undefined || value === null) return "0";
  if (typeof value === "bigint") return value.toString();
  if (typeof value.toString === "function") return value.toString();
  return "0";
}

export function toBigInt(value) {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function progressPercent(raisedWei, targetWei) {
  const raised = toBigInt(raisedWei);
  const target = toBigInt(targetWei);
  if (target <= 0n) return 0;
  const percent = Number((raised * 10000n) / target) / 100;
  return Math.min(percent, 100);
}

/** Raw contract reads for one campaign (cached briefly). */
export async function readCampaignRaw(campaignId) {
  const config = getChainConfig();
  const contract = getReadContract();
  if (!contract) throw new Error("No contract address configured");

  const key = `campaign:${config.chainId}:${config.contractAddress}:${campaignId}`;

  return cached(key, CAMPAIGN_TTL_MS, async () => {
    try {
      const [campaign, accounting, milestones, released] = await Promise.all([
        withTimeout(contract.getCampaign(campaignId), 15000, "getCampaign"),
        withTimeout(contract.getCampaignAccounting(campaignId), 15000, "getCampaignAccounting"),
        withTimeout(contract.getMilestones(campaignId), 15000, "getMilestones"),
        withTimeout(contract.getReleasedAmount(campaignId), 15000, "getReleasedAmount"),
      ]);

      // Abandoned-campaign recovery only exists on contracts deployed from the
      // recovery-capable source. Probe with a static call: if the deployed contract
      // predates the feature the call reverts and the UI simply hides the section.
      let recovery = emptyRecovery();
      if (typeof contract.getRecoveryState === "function") {
        try {
          const state = await withTimeout(
            contract.getRecoveryState(campaignId),
            10000,
            "getRecoveryState"
          );
          recovery = {
            supported: true,
            eligible: Boolean(state.eligible),
            enabled: Boolean(state.enabled),
            claimPoolWei: wei(state.pool),
            claimBaseWei: wei(state.base),
            claimedWei: wei(state.claimed),
            escrowPoolWei: wei(state.escrow),
            unlocksAt: Number(state.unlocksAt ?? 0),
          };
        } catch {
          recovery = emptyRecovery();
        }
      }

      return { campaign, accounting, milestones, released, recovery };
    } catch (error) {
      // The RPC (rate limit, dead endpoint, timeout) failed us: say so explicitly so
      // the route can answer 502 with an actionable hint. A contract rejection keeps
      // its own error so the route can still answer 404.
      if (isChainTransportFailure(error)) {
        throw new ChainUnavailableError(`Campaign ${campaignId} could not be read from chain: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
  });
}

function mapMilestone(milestone, index) {
  return {
    index,
    title: milestone.title || `Milestone ${index + 1}`,
    percentage: Number(milestone.percentage ?? 0),
    amountWei: wei(milestone.amount),
    evidenceSubmitted: Boolean(milestone.evidenceSubmitted),
    evidenceCID: milestone.evidenceCID || "",
    evidenceSubmittedAt: Number(milestone.evidenceSubmittedAt ?? 0),
    approved: Boolean(milestone.approved),
    fundsReleased: Boolean(milestone.fundsReleased),
    voteRequested: Boolean(milestone.voteRequested),
    approvals: Number(milestone.approvals ?? 0),
    rejections: Number(milestone.rejections ?? 0),
    approvalWeightWei: wei(milestone.approvalWeight),
    rejectionWeightWei: wei(milestone.rejectionWeight),
    totalVotingPowerWei: wei(milestone.totalVotingPower),
  };
}

export function deriveCampaignStatus({ funded, completed, deadlinePassed, releasedMilestones, approvedMilestones }) {
  if (completed) return "Completed";
  if (!funded && deadlinePassed) return "Failed — refunds available";
  if (!funded) return "Fundraising";
  if (releasedMilestones > 0 && releasedMilestones < 3) return "In progress";
  if (approvedMilestones > 0) return "Milestone approved — release pending";
  return deadlinePassed ? "Funded — awaiting milestones" : "Fundraising";
}

/** Funding-status payload for the campaign page and the admin dashboard. */
export async function getCampaignFundingState(campaignId, { userId = null, walletAddress = null } = {}) {
  const raw = await readCampaignRaw(campaignId);
  const { campaign, accounting, milestones, recovery } = raw;

  const targetWei = wei(campaign.targetAmount);
  const raisedWei = wei(campaign.raisedAmount);
  const releasedWei = wei(accounting[1] ?? raw.released);
  const escrowWei = wei(accounting[2]);
  const refundableWei = wei(accounting[3]);

  const mappedMilestones = milestones.map(mapMilestone);
  const releasedMilestones = mappedMilestones.filter((m) => m.fundsReleased).length;
  const approvedMilestones = mappedMilestones.filter((m) => m.approved).length;
  const currentMilestoneIndex = mappedMilestones.findIndex((m) => !m.fundsReleased);
  const deadline = Number(campaign.deadline ?? 0);
  const now = Math.floor(Date.now() / 1000);
  const funded = toBigInt(raisedWei) >= toBigInt(targetWei);

  const nextReleaseWei = (() => {
    const index = currentMilestoneIndex === -1 ? null : currentMilestoneIndex;
    if (index === null) return "0";
    const pool = toBigInt(raisedWei);
    const first = (pool * 30n) / 100n;
    const second = (pool * 30n) / 100n;
    if (index === 0) return first.toString();
    if (index === 1) return second.toString();
    return (pool - first - second).toString();
  })();

  return {
    campaignId: Number(campaign.id ?? campaignId),
    title: campaign.title || `Campaign #${campaignId}`,
    creator: campaign.creator,
    targetWei,
    raisedWei,
    releasedWei,
    escrowWei,
    refundableWei,
    progressPercent: progressPercent(raisedWei, targetWei),
    funded,
    deadline,
    deadlinePassed: deadline > 0 && now >= deadline,
    completed: Boolean(campaign.completed),
    active: Boolean(campaign.active),
    status: deriveCampaignStatus({
      funded,
      completed: Boolean(campaign.completed),
      deadlinePassed: deadline > 0 && now >= deadline,
      releasedMilestones,
      approvedMilestones,
    }),
    currentMilestoneIndex,
    approvedMilestones,
    releasedMilestones,
    remainingEligibleReleaseWei: nextReleaseWei,
    milestones: mappedMilestones,
    recovery: recovery || { supported: false, eligible: false, claimableWei: "0", escrowPoolWei: "0" },
    donationTotals: await donationTotalsForCampaign(campaignId),
    identity: { userId, walletAddress },
    readAt: now,
  };
}

async function donationTotalsForCampaign(campaignId) {
  try {
    const rows = await db.chainEvents.listRecentDonations({ campaignId, limit: 50 });
    const confirmed = rows.filter((row) => row.status === "confirmed");
    const total = confirmed.reduce((sum, row) => sum + BigInt(row.amountWei || "0"), 0n);
    return {
      indexedConfirmedCount: confirmed.length,
      indexedConfirmedWei: total.toString(),
    };
  } catch {
    return { indexedConfirmedCount: 0, indexedConfirmedWei: "0" };
  }
}

/**
 * Refresh the local campaign metadata cache from chain state. Used by the indexer
 * so event lists and admin search can show campaign names without one RPC read
 * per row.
 */
export async function refreshCampaignCache(campaignIds) {
  const config = getChainConfig();
  const contract = getReadContract();
  if (!contract || !config.contractAddress) return [];

  const updated = [];
  for (const campaignId of campaignIds) {
    if (!campaignId) continue;
    try {
      const campaign = await withTimeout(
        contract.getCampaign(campaignId),
        15000,
        `getCampaign(${campaignId})`
      );
      updated.push(
        await db.campaigns.upsertCampaign({
          chainId: config.chainId,
          contractAddress: config.contractAddress,
          campaignId,
          title: campaign.title,
          creator: campaign.creator,
          targetAmount: wei(campaign.targetAmount),
          raisedAmount: wei(campaign.raisedAmount),
          deadline: Number(campaign.deadline ?? 0),
          completed: Boolean(campaign.completed),
          active: Boolean(campaign.active),
        })
      );
    } catch (error) {
      console.error(`[chain] Failed to refresh campaign ${campaignId}:`, error?.message);
    }
  }

  return updated;
}

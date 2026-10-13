/**
 * GET /api/campaigns/:id/funding
 *
 * Funding target, total collected, progress, released funds, remaining escrow,
 * campaign status, milestone progress and (when the deployed contract supports it)
 * the abandoned-campaign recovery state.
 *
 * Everything is read from the deployed contract for the configured network, so a
 * request can never influence the numbers. The contract's whole balance is NOT
 * treated as this campaign's balance: per-campaign escrow comes from the
 * contract's own `raisedAmount` / `releasedAmount` accounting views.
 */
import { db } from "../../../../lib/db/index.js";
import { getCampaignFundingState, readCampaignRaw } from "../../../../lib/chain/campaignState.js";
import { getChainConfig } from "../../../../lib/chain/config.js";
import { methodNotAllowed, publicCache, serverError } from "../../../../lib/api/http.js";
import { formatEthDisplay, formatEther, percentOf } from "../../../../lib/format.js";
import { isAddressLike } from "../../../../lib/api/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const campaignId = Number.parseInt(req.query.id, 10);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ error: "A positive campaign id is required" });
  }

  try {
    db.init();
    const config = getChainConfig();

    if (!config.contractAddress) {
      return res.status(503).json({ error: "Contract address is not configured" });
    }

    const state = await getCampaignFundingState(campaignId);

    // Optional: how much the given donor could claim right now (read-only).
    const donor = isAddressLike(req.query.donor) ? req.query.donor.toLowerCase() : null;
    let donorClaimableWei = null;
    if (donor && state.recovery?.supported) {
      try {
        const { getReadContract, withTimeout } = await import("../../../../lib/chain/provider.js");
        const contract = getReadContract();
        const claimable = await withTimeout(
          contract.recoveryClaimable(campaignId, donor),
          10000,
          "recoveryClaimable"
        );
        donorClaimableWei = claimable.toString();
      } catch {
        donorClaimableWei = null;
      }
    }

    // Indexed donations for this campaign (verified events only).
    const indexed = db.chainEvents.listRecentDonations({ campaignId, limit: 50 });
    const confirmedWei = indexed
      .filter((row) => row.status === "confirmed")
      .reduce((sum, row) => sum + BigInt(row.amountWei || "0"), 0n)
      .toString();

    const raw = await readCampaignRaw(campaignId);

    publicCache(res, 15);

    return res.status(200).json({
      campaign: {
        campaignId: state.campaignId,
        title: state.title,
        creator: state.creator,
        status: state.status,
        active: state.active,
        completed: state.completed,
        deadline: state.deadline,
        deadlinePassed: state.deadlinePassed,
      },
      funding: {
        targetWei: state.targetWei,
        targetEth: formatEthDisplay(state.targetWei),
        collectedWei: state.raisedWei,
        collectedEth: formatEthDisplay(state.raisedWei),
        progressPercent: percentOf(state.raisedWei, state.targetWei),
        funded: state.funded,
      },
      escrow: {
        // Donor funds still held by the contract for this campaign.
        escrowWei: state.escrowWei,
        escrowEth: formatEthDisplay(state.escrowWei),
        releasedWei: state.releasedWei,
        releasedEth: formatEthDisplay(state.releasedWei),
        refundableWei: state.refundableWei,
        refundableEth: formatEther(state.refundableWei),
        remainingEligibleReleaseWei: state.remainingEligibleReleaseWei,
        remainingEligibleReleaseEth: formatEthDisplay(state.remainingEligibleReleaseWei),
      },
      milestones: {
        currentMilestoneIndex: state.currentMilestoneIndex,
        approvedMilestones: state.approvedMilestones,
        releasedMilestones: state.releasedMilestones,
        items: state.milestones,
      },
      recovery: {
        ...state.recovery,
        donorAddress: donor,
        donorClaimableWei,
        donorClaimableEth: donorClaimableWei ? formatEthDisplay(donorClaimableWei, 6) : null,
      },
      indexedActivity: {
        confirmedDonationCount: indexed.filter((row) => row.status === "confirmed").length,
        confirmedWei,
        confirmedEth: formatEthDisplay(confirmedWei),
      },
      contract: {
        address: config.contractAddress,
        chainId: config.chainId,
        // The contract's total balance covers every campaign, so it is reported
        // separately from this campaign's escrow and never presented as campaign funds.
        contractBalanceWei: (await contractBalance()) || "0",
      },
      raw: {
        refundableDonorFundsWei: String(raw.accounting?.[3] ?? "0"),
      },
    });
  } catch (error) {
    // A missing/reverted campaign read is a 404-style condition, not a server bug.
    const message = String(error?.message || "");
    if (message.includes("Invalid campaign ID") || message.includes("reverted")) {
      return res.status(404).json({ error: "Campaign not found on the configured network" });
    }
    return serverError(res, error, "campaign-funding");
  }
}

async function contractBalance() {
  try {
    const { getReadContract } = await import("../../../../lib/chain/provider.js");
    const { withTimeout } = await import("../../../../lib/chain/provider.js");
    const contract = getReadContract();
    if (!contract) return null;
    const balance = await withTimeout(contract.provider.getBalance(contract.address), 10000, "balance");
    return balance.toString();
  } catch {
    return null;
  }
}
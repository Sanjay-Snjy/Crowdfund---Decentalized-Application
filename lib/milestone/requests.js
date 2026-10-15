/**
 * Milestone evidence requests — database rows reconciled against on-chain state.
 *
 * The contract only lets the campaign creator submit evidence
 * (`submitMilestoneEvidence` is `onlyCampaignCreator`), so an administrator's
 * lever is a recorded request rather than a transaction. This module is the one
 * place that reads those requests and folds in the on-chain truth:
 *
 *   - `loadEvidenceRequests` closes any request whose milestone now has evidence,
 *   - `evidenceRequestEligibility` mirrors the contract's own guards so a request
 *     is only ever created for a milestone the creator can actually act on.
 *
 * Server-only: it touches the database and the RPC.
 */
import { db } from "../db/index.js";
import { getChainConfig } from "../chain/config.js";
import { getCampaignFundingState } from "../chain/campaignState.js";

/**
 * Requests for one campaign, with pending ones closed the moment evidence lands
 * on-chain. A chain read that fails leaves the requests untouched (the request is
 * not lost, it simply stays pending until the next read succeeds) — a transient RPC
 * problem must never rewrite milestone status.
 */
export async function loadEvidenceRequests(campaignId, { limit = 20 } = {}) {
  const config = getChainConfig();

  let state = null;
  try {
    state = await getCampaignFundingState(campaignId);
  } catch (error) {
    console.warn("[milestone-requests] chain state unavailable:", error?.message);
  }

  const requests = await db.milestoneRequests.listRequests({
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    campaignId,
    limit,
  });

  for (const fulfillment of fulfillmentsFor(requests, state)) {
    const updated = await db.milestoneRequests.markFulfilled(fulfillment.id, fulfillment);
    if (!updated) continue;
    const index = requests.findIndex((request) => request.id === fulfillment.id);
    if (index !== -1) requests[index] = updated;
  }

  return { config, state, requests };
}

/**
 * The requests that must be closed, given the current on-chain milestone state:
 * a pending request whose milestone now carries evidence has been acted on.
 *
 * Pure on purpose — this is the rule that decides when a request stops being
 * outstanding, so it is worth testing without a chain or a database.
 */
export function fulfillmentsFor(requests, state) {
  if (!Array.isArray(requests) || !state) return [];

  return requests
    .filter((request) => request?.status === "pending")
    .map((request) => {
      const milestone = state.milestones?.[request.milestoneIndex];
      if (!milestone?.evidenceSubmitted) return null;
      return {
        id: request.id,
        cid: milestone.evidenceCID || null,
        at: Number(milestone.evidenceSubmittedAt) || null,
      };
    })
    .filter(Boolean);
}

/**
 * Can the platform still ask for evidence on this milestone?
 *
 * Every check mirrors a `require` in `submitMilestoneEvidence`, so a request can
 * never be created for a milestone whose evidence submission would revert.
 */
export function evidenceRequestEligibility(state, milestoneIndex) {
  if (!state) {
    return { ok: false, reason: "Campaign state could not be read from the contract" };
  }

  const items = state.milestones || [];
  if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0 || milestoneIndex >= items.length) {
    return { ok: false, reason: "Unknown milestone for this campaign" };
  }

  const milestone = items[milestoneIndex];
  const label = `Milestone ${milestoneIndex + 1}`;

  if (milestone.evidenceSubmitted) {
    return { ok: false, reason: `${label} already has evidence submitted` };
  }
  if (milestone.fundsReleased) {
    return { ok: false, reason: `${label} funds were already released` };
  }
  if (state.recovery?.enabled) {
    return {
      ok: false,
      reason: "The campaign is in donor recovery — the contract no longer releases milestone funds",
    };
  }
  if (!state.funded) {
    return { ok: false, reason: "The campaign has not reached its target, so no funds will be released" };
  }
  if (!state.deadlinePassed) {
    return { ok: false, reason: "The funding deadline has not passed yet" };
  }
  if (milestoneIndex !== state.currentMilestoneIndex) {
    return {
      ok: false,
      reason: `${label} unlocks only after milestone ${state.currentMilestoneIndex + 1} is released`,
    };
  }

  return { ok: true, milestone, label };
}

/**
 * Public shape: the milestone, the note written for the creator and the lifecycle
 * timestamps. The requesting operator's audit label stays server-side.
 */
export function toPublicRequest(request) {
  return {
    milestoneIndex: request.milestoneIndex,
    status: request.status,
    note: request.note || null,
    createdAt: request.createdAt,
    fulfilledAt: request.fulfilledAt,
    fulfilledCid: request.fulfilledCid || null,
  };
}

/** Admin shape: the public fields plus who asked. */
export function toAdminRequest(request) {
  return { ...toPublicRequest(request), id: request.id, requestedBy: request.requestedBy };
}

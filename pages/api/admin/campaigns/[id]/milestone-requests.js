/**
 * GET  /api/admin/campaigns/:id/milestone-requests  → requests + mechanism state
 * POST /api/admin/campaigns/:id/milestone-requests  → ask the creator for evidence
 *
 * Milestone funds only ever move through the contract: the creator submits evidence,
 * the donors vote, and any address may then release the approved share. An
 * administrator cannot submit evidence for a creator (`submitMilestoneEvidence` is
 * `onlyCampaignCreator`), so the administrative lever implemented here is the
 * recorded request — which the creator sees on the campaign page, and which closes
 * itself when the on-chain evidence appears.
 *
 * Authorization is server-side on every method: the campaign page only hides this
 * section from non-administrators, it never protects it.
 */
import { db } from "../../../../../lib/db/index.js";
import { requireAdmin } from "../../../../../lib/auth/identity.js";
import {
  evidenceRequestEligibility,
  loadEvidenceRequests,
  toAdminRequest,
} from "../../../../../lib/milestone/requests.js";
import { actorLabel } from "../../../../../lib/db/milestoneRequests.js";
import {
  badRequest,
  methodNotAllowed,
  privateNoStore,
  readJson,
  serverError,
  clampInt,
} from "../../../../../lib/api/http.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(res, ["GET", "POST"]);

  const campaignId = Number.parseInt(req.query.id, 10);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return badRequest(res, "A positive campaign id is required");
  }

  try {
    await db.init();
    privateNoStore(res);

    const guard = await requireAdmin(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 20 });
    const { config, state, requests } = await loadEvidenceRequests(campaignId, { limit });

    if (req.method === "GET") {
      return res.status(200).json({
        campaignId,
        known: Boolean(state),
        requests: requests.map(toAdminRequest),
        milestones: (state?.milestones || []).map((milestone) => ({
          index: milestone.index,
          title: milestone.title,
          percentage: milestone.percentage,
          eligibility: evidenceRequestEligibility(state, milestone.index),
        })),
        network: { chainId: config.chainId, contractAddress: config.contractAddress },
      });
    }

    // POST — create (or refresh) the request for one milestone.
    const body = await readJson(req, 8 * 1024);
    const milestoneIndex = Number.parseInt(body?.milestoneIndex, 10);
    if (!Number.isFinite(milestoneIndex) || milestoneIndex < 0) {
      return badRequest(res, "A milestone index is required");
    }

    const eligibility = evidenceRequestEligibility(state, milestoneIndex);
    if (!eligibility.ok) {
      if (!state) return res.status(502).json({ error: eligibility.reason });
      return res.status(409).json({ error: eligibility.reason });
    }

    const actor = actorLabel(guard.identity);
    const created = await db.milestoneRequests.createRequest({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      campaignId,
      milestoneIndex,
      note: body?.note,
      requestedBy: actor,
    });

    await db.driver.run(
      `INSERT INTO admin_audit (actor, action, subject, detail, created_at)
       VALUES (?, 'campaign.milestone-evidence-request', ?, ?, ?)`,
      [
        actor,
        String(campaignId),
        JSON.stringify({
          milestoneIndex,
          milestone: eligibility.label,
          refreshed: Boolean(created?.refreshed),
        }),
        Math.floor(Date.now() / 1000),
      ]
    );

    const refreshed = await db.milestoneRequests.listRequests({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      campaignId,
      limit,
    });

    return res.status(200).json({
      request: created ? toAdminRequest(created) : null,
      requests: refreshed.map(toAdminRequest),
      message: created?.refreshed
        ? `Evidence request for ${eligibility.label} was updated`
        : `Evidence requested from the creator for ${eligibility.label}`,
    });
  } catch (error) {
    return serverError(res, error, "admin-milestone-requests");
  }
}

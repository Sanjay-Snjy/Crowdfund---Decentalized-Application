/**
 * GET /api/campaigns/:id/milestone-requests
 *
 * The evidence requests an administrator has raised for this campaign, in the shape
 * the creator needs: which milestone, when it was asked for, and the note attached.
 * The requesting operator's audit label is deliberately not exposed.
 *
 * Not personalised and not cacheable: a request must appear immediately and the
 * status changes the moment the on-chain evidence lands, so it is served
 * `no-store` rather than from the short public cache the funding endpoint uses.
 */
import { db } from "../../../../lib/db/index.js";
import { methodNotAllowed, privateNoStore, serverError } from "../../../../lib/api/http.js";
import { loadEvidenceRequests, toPublicRequest } from "../../../../lib/milestone/requests.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const campaignId = Number.parseInt(req.query.id, 10);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ error: "A positive campaign id is required" });
  }

  try {
    await db.init();
    privateNoStore(res);

    const { requests } = await loadEvidenceRequests(campaignId, { limit: 50 });
    const shaped = requests.map(toPublicRequest);

    return res.status(200).json({
      campaignId,
      requests: shaped,
      pending: shaped.filter((request) => request.status === "pending"),
    });
  } catch (error) {
    return serverError(res, error, "campaign-milestone-requests");
  }
}

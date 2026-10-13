/**
 * GET  /api/admin/sync  → indexer status
 * POST /api/admin/sync  → run the indexer now ("recent" or "deep")
 *
 * Only administrators can trigger a run, and only one run per contract can be in
 * flight at a time (the indexer takes a database lock).
 */
import { db } from "../../../lib/db/index.js";
import { requireAdmin } from "../../../lib/auth/identity.js";
import { indexerStatus, syncChainEvents } from "../../../lib/chain/indexer.js";
import { methodNotAllowed, privateNoStore, readJson, serverError } from "../../../lib/api/http.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(res, ["GET", "POST"]);

  try {
    db.init();
    privateNoStore(res);

    const guard = await requireAdmin(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    if (req.method === "GET") {
      return res.status(200).json({ indexer: indexerStatus() });
    }

    const body = await readJson(req, 8 * 1024);
    const mode = body?.mode === "deep" ? "deep" : "recent";

    const result = await syncChainEvents({ mode });

    db.driver.run(
      `INSERT INTO admin_audit (actor, action, subject, detail, created_at)
       VALUES (?, 'indexer.sync', ?, ?, ?)`,
      [
        guard.identity.source === "clerk"
          ? `clerk:${guard.identity.clerkUserId}`
          : `wallet:${guard.identity.walletAddress}`,
        mode,
        JSON.stringify({ ok: result.ok, inserted: result.events?.inserted ?? 0, errors: result.errors?.length ?? 0 }),
        Math.floor(Date.now() / 1000),
      ]
    );

    return res.status(result.ok ? 200 : 502).json({ result, indexer: indexerStatus() });
  } catch (error) {
    return serverError(res, error, "admin-sync");
  }
}

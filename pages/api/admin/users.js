/**
 * GET /api/admin/users?limit=20&offset=0&beforeId=123
 *
 * Recently registered CrowdFund users, newest first, for the admin dashboard.
 *
 * Authorization is enforced HERE, on the server: a caller must resolve to a
 * CrowdFund profile whose role is `admin` (Clerk session or signed wallet
 * session). The frontend only hides the UI.
 *
 * Emails are never returned. The only identifiers exposed are the CrowdFund User
 * ID and the wallet address.
 */
import { db } from "../../../lib/db/index.js";
import { requireAdmin } from "../../../lib/auth/identity.js";
import { clampInt, methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    db.init();
    privateNoStore(res);

    const guard = await requireAdmin(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 20 });
    const offset = clampInt(req.query.offset, { min: 0, max: 100000, fallback: 0 });
    const beforeId = req.query.beforeId ? Number.parseInt(req.query.beforeId, 10) : null;

    const users = db.users.listRecentUsers({ limit, offset, beforeId: Number.isFinite(beforeId) ? beforeId : null });
    const total = db.users.countUsers();

    res.setHeader("X-Total-Count", String(total));

    return res.status(200).json({
      users,
      pagination: {
        limit,
        offset,
        total,
        returned: users.length,
        nextOffset: offset + users.length,
        hasMore: offset + users.length < total,
        nextBeforeId: users.length > 0 ? users[users.length - 1].id : null,
      },
      viewer: {
        cfUserId: guard.identity.user?.cf_user_id || null,
        source: guard.identity.source,
      },
    });
  } catch (error) {
    return serverError(res, error, "admin-users");
  }
}

/**
 * POST /api/auth/wallet/nonce
 *
 * Issues a single-use, 5-minute nonce that the wallet signs with personal_sign.
 * Purpose "admin" is used by the admin dashboard sign-in flow; both purposes use
 * the same verification path.
 */
import { db } from "../../../../lib/db/index.js";
import { requestWalletNonce } from "../../../../lib/auth/identity.js";
import { badRequest, isAddressLike, methodNotAllowed, readJson, serverError } from "../../../../lib/api/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    db.init();

    const body = await readJson(req, 8 * 1024);
    const address = body?.address;
    const purpose = ["user", "admin", "link"].includes(body?.purpose) ? body.purpose : "user";

    if (!isAddressLike(address)) return badRequest(res, "A valid wallet address is required");

    const challenge = requestWalletNonce({ address, purpose });
    if (!challenge) return badRequest(res, "Invalid wallet address");

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(challenge);
  } catch (error) {
    return serverError(res, error, "auth-nonce");
  }
}

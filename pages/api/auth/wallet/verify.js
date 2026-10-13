/**
 * POST /api/auth/wallet/verify
 *
 * Verifies the signature against the nonce that was issued for this address, then
 * issues an HTTP-only session cookie. This is the wallet half of the identity
 * layer: the address is only ever trusted after a valid signature.
 */
import { db } from "../../../../lib/db/index.js";
import { setSessionCookie, verifyWalletSignature } from "../../../../lib/auth/identity.js";
import { badRequest, isAddressLike, methodNotAllowed, readJson, serverError } from "../../../../lib/api/http.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    await db.init();

    const body = await readJson(req, 32 * 1024);
    const address = body?.address;
    const signature = body?.signature;
    const message = body?.message;
    const nonce = body?.nonce;
    const purpose = ["user", "admin", "link"].includes(body?.purpose) ? body.purpose : "user";

    if (!isAddressLike(address)) return badRequest(res, "A valid wallet address is required");
    if (typeof signature !== "string" || signature.length < 10) {
      return badRequest(res, "A wallet signature is required");
    }
    if (typeof message !== "string" || !message.trim()) {
      return badRequest(res, "The signed message is required");
    }

    const result = await verifyWalletSignature({ address, signature, message, nonce, purpose });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    setSessionCookie(res, result.token, SESSION_TTL_SECONDS);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      authenticated: true,
      walletAddress: address.toLowerCase(),
      expiresAt: result.expiresAt,
      user: result.user,
      isAdmin: result.isAdmin,
    });
  } catch (error) {
    return serverError(res, error, "auth-verify");
  }
}

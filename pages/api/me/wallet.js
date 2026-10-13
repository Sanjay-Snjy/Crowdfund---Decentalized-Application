/**
 * POST /api/me/wallet
 *
 * Connects a wallet to the signed-in CrowdFund profile. A signature over a
 * server-issued nonce (purpose "link") is required, so a request body alone can
 * never claim someone else's address. Previous donations from that wallet are
 * attached to the profile afterwards.
 */
import { db } from "../../../lib/db/index.js";
import { requireUser } from "../../../lib/auth/identity.js";
import { WalletLinkConflictError } from "../../../lib/db/users.js";
import { badRequest, isAddressLike, methodNotAllowed, privateNoStore, readJson, serverError } from "../../../lib/api/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    db.init();
    privateNoStore(res);

    const guard = await requireUser(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const body = await readJson(req, 32 * 1024);
    const address = body?.address;
    const signature = body?.signature;
    const message = body?.message;
    const nonce = body?.nonce;

    if (!isAddressLike(address)) return badRequest(res, "A valid wallet address is required");
    if (typeof signature !== "string" || !signature.trim()) return badRequest(res, "A wallet signature is required");

    const { verifyWalletSignature } = await import("../../../lib/auth/identity.js");

    // Reuse the same verification primitives, but do not mint a new session: the
    // caller is already authenticated, this only proves the wallet.
    const verification = verifyWalletSignature({
      address,
      signature,
      message,
      nonce,
      purpose: "link",
    });

    if (!verification.ok) {
      return res.status(verification.status).json({ error: verification.error });
    }

    const linked = db.users.linkWalletToUser({
      userId: guard.identity.userId,
      address,
    });

    const attached = db.users.attachUserToWalletHistory(linked.id, address);

    // Rebuild the reward ledger so donations made before linking now count.
    const { syncRewardLedger } = await import("../../../lib/rewards/index.js");
    const ledger = syncRewardLedger({ userId: linked.id, walletAddress: linked.wallet_address });

    return res.status(200).json({
      linked: true,
      walletAddress: linked.wallet_address,
      cfUserId: linked.cf_user_id,
      donationsAttached: attached,
      rewardLedger: ledger,
    });
  } catch (error) {
    if (error instanceof WalletLinkConflictError) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    return serverError(res, error, "me-wallet");
  }
}

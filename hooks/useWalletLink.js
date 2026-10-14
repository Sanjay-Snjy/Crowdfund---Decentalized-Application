/**
 * Link the connected wallet to the signed-in CrowdFund profile.
 *
 * Rewards, the personal transaction history and the public donor label are all
 * attributed through the wallet that is linked to a profile, so a connected wallet
 * that was never linked shows up as "0 points" and a raw address. Linking proves
 * control of the address with a single-use server nonce and a free signature
 * (purpose "link") — no funds move, and nothing is written until the wallet signs.
 *
 * Server-side guard: POST /api/me/wallet verifies the signature against the nonce
 * and only then attaches the address, so a request body alone can never claim
 * somebody else's wallet.
 */
import { useCallback, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "react-hot-toast";
import { apiPost, ApiError } from "../utils/apiClient";

export function useWalletLink() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [linking, setLinking] = useState(false);

  /** Returns the linked profile, `false` when the wallet is already linked, or null on failure. */
  const linkWallet = useCallback(
    async ({ notify = true } = {}) => {
      if (!isConnected || !address) {
        if (notify) toast.error("Connect your wallet first");
        return null;
      }

      setLinking(true);
      try {
        const challenge = await apiPost("/api/auth/wallet/nonce", { address, purpose: "link" });
        const signature = await signMessageAsync({ message: challenge.message });
        const result = await apiPost("/api/me/wallet", {
          address,
          signature,
          message: challenge.message,
          nonce: challenge.nonce,
        });

        if (notify) toast.success(`Wallet connected to ${result.cfUserId}`);
        return result;
      } catch (error) {
        if (notify) {
          const message =
            error instanceof ApiError
              ? error.message
              : error?.shortMessage || error?.message || "Could not link the wallet";
          toast.error(message);
        }
        return null;
      } finally {
        setLinking(false);
      }
    },
    [address, isConnected, signMessageAsync]
  );

  return {
    linkWallet,
    linking,
    isConnected,
    connectedAddress: address || null,
  };
}

export default useWalletLink;

/**
 * Client identity hook.
 *
 * Reads the server-verified identity from /api/auth/session (Clerk session or a
 * signed wallet session) so the UI can show the CrowdFund User ID and the admin
 * entry point. The server is always the authority: anything this hook exposes is
 * only used to decide what to RENDER, never what is allowed.
 */
import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "react-hot-toast";
import { apiDelete, apiGet, apiPost, ApiError } from "../utils/apiClient";

export function useIdentity() {
  const [state, setState] = useState({ loading: true, identity: null, error: null });
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet("/api/auth/session");
      setState({ loading: false, identity: data.identity || null, error: null, clerkConfigured: data.clerkConfigured });
      return data.identity || null;
    } catch (error) {
      setState({
        loading: false,
        identity: null,
        error: error instanceof ApiError ? error.message : "Could not read your session",
      });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Sign in (or refresh the session) with the connected wallet. */
  const signInWithWallet = useCallback(
    async ({ purpose = "user" } = {}) => {
      if (!isConnected || !address) {
        toast.error("Connect your wallet first");
        return null;
      }

      try {
        const challenge = await apiPost("/api/auth/wallet/nonce", { address, purpose });
        const signature = await signMessageAsync({ message: challenge.message });
        const result = await apiPost("/api/auth/wallet/verify", {
          address,
          signature,
          message: challenge.message,
          nonce: challenge.nonce,
          purpose,
        });

        await refresh();
        return result;
      } catch (error) {
        toast.error(error?.shortMessage || error?.message || "Wallet sign-in failed");
        return null;
      }
    },
    [address, isConnected, refresh, signMessageAsync]
  );

  /** Link the connected wallet to the signed-in CrowdFund profile. */
  const linkWallet = useCallback(async () => {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first");
      return null;
    }

    try {
      const challenge = await apiPost("/api/auth/wallet/nonce", { address, purpose: "link" });
      const signature = await signMessageAsync({ message: challenge.message });
      const result = await apiPost("/api/me/wallet", {
        address,
        signature,
        message: challenge.message,
        nonce: challenge.nonce,
      });
      toast.success(`Wallet connected to ${result.cfUserId}`);
      await refresh();
      return result;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : error?.message || "Could not link the wallet";
      toast.error(message);
      return null;
    }
  }, [address, isConnected, refresh, signMessageAsync]);

  const signOut = useCallback(async () => {
    try {
      await apiDelete("/api/auth/session");
    } finally {
      await refresh();
    }
  }, [refresh]);

  return {
    ...state,
    isSignedIn: Boolean(state.identity),
    cfUserId: state.identity?.cfUserId || null,
    isAdmin: Boolean(state.identity?.isAdmin),
    source: state.identity?.source || null,
    refresh,
    signInWithWallet,
    linkWallet,
    signOut,
    connectedAddress: address || null,
  };
}

export default useIdentity;

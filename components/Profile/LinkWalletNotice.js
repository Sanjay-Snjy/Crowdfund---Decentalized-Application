/**
 * "Link this wallet" call to action.
 *
 * Rewards, the personal transaction history and the public donor label are
 * attributed through the wallet that is linked to a CrowdFund profile, so a
 * connected wallet that was never linked renders as 0 points / a raw address. This
 * notice appears exactly in that case: it links the wallet with one free signature
 * (no funds move) and then invalidates the cached queries so every panel reloads
 * with the newly attributed donations.
 *
 * It renders nothing when the wallet is already linked, when no wallet is
 * connected, or when the caller passes a custom empty state.
 */
import { useQueryClient } from "@tanstack/react-query";
import { FiLink } from "react-icons/fi";
import { formatAddress } from "../../utils/helpers";
import { useWalletLink } from "../../hooks/useWalletLink";

export default function LinkWalletNotice({
  walletLinked = false,
  message = "Link this wallet to your CrowdFund account to see your own contributions, points and badges.",
  onLinked = null,
  className = "",
}) {
  const queryClient = useQueryClient();
  const { linkWallet, linking, isConnected, connectedAddress } = useWalletLink();

  if (walletLinked || !isConnected || !connectedAddress) return null;

  const link = async () => {
    const result = await linkWallet();
    if (!result) return;
    // Every panel that shows the user's own data may now have more of it.
    queryClient.invalidateQueries();
    onLinked?.(result);
  };

  return (
    <div
      className={`rounded-xl px-3 py-2.5 ${className}`}
      style={{ background: "var(--color-surface-raised)" }}
    >
      <p className="text-xs" style={{ color: "var(--color-text)" }}>
        {message}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        {formatAddress(connectedAddress)} · one free signature, no funds move
      </p>
      <button
        type="button"
        className="btn btn-secondary btn-sm mt-2"
        disabled={linking}
        onClick={link}
      >
        <FiLink className="h-3 w-3" />
        {linking ? "Waiting for your signature…" : "Link this wallet"}
      </button>
    </div>
  );
}

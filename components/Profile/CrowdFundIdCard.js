/**
 * CrowdFund User ID card.
 *
 * Shows the application-facing identity only: the CrowdFund User ID, the name, the
 * wallet state and the account source. Clerk ids are never shown.
 *
 * The name is NOT editable here. It is the signed-in Clerk account's name — full
 * name, then first + last name, then username, then the email local-part — exactly
 * what the layout header shows. The server keeps the profile's copy in step from
 * Clerk (see ensureUserFromClerk + resolveIdentityWithProfile), and the Clerk client
 * object is used as the immediate fallback so the name is on screen even while that
 * round trip is in flight.
 *
 * Linking the wallet is a plain, optional button: the numbers on this dashboard are
 * already shown for the connected wallet. Linking (one free signature) is what puts
 * the account's *name* on its public donations instead of a raw address.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FiCheck, FiCopy, FiLink, FiShield, FiUser } from "react-icons/fi";
import { toast } from "react-hot-toast";
import { useAccount } from "wagmi";
import { useUser } from "@clerk/nextjs";
import { copyToClipboard, formatAddress } from "../../utils/helpers";
import { useWalletLink } from "../../hooks/useWalletLink";

/** The Clerk account's display name — the same chain the header uses. */
function clerkDisplayName(user) {
  if (!user) return null;
  return (
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    user.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    null
  );
}

export default function CrowdFundIdCard({ identity, profile, onUpdated = null }) {
  const [copied, setCopied] = useState(false);
  const { address, isConnected } = useAccount();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { linkWallet, linking } = useWalletLink();

  const wallet = profile?.walletAddress || identity?.walletAddress || null;
  const connectedWallet = isConnected ? address : null;
  const displayName = profile?.displayName || clerkDisplayName(user);

  const link = async () => {
    const result = await linkWallet();
    if (!result) return;
    // Everything that shows this user's own data can now attribute more of it.
    queryClient.invalidateQueries();
    onUpdated?.(result);
  };

  if (!profile?.cfUserId) {
    return (
      <div className="card rounded-2xl p-5">
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          CrowdFund User ID
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Sign in with Clerk, or connect and sign with your wallet, to receive your CrowdFund User ID.
        </p>
      </div>
    );
  }

  return (
    <div className="card h-full rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}
          >
            <FiUser className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              CrowdFund User ID
            </p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-lg font-bold tracking-wide" style={{ color: "var(--color-text)" }}>
                {profile.cfUserId}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Copy CrowdFund User ID"
                onClick={async () => {
                  const ok = await copyToClipboard(profile.cfUserId);
                  setCopied(ok);
                  if (ok) toast.success("CrowdFund User ID copied");
                }}
              >
                {copied ? <FiCheck className="h-3 w-3" /> : <FiCopy className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {profile.isAdmin && (
            <span className="badge badge-success">
              <FiShield className="mr-1 h-3 w-3" /> Administrator
            </span>
          )}
          <span className={`badge ${wallet ? "badge-success" : "badge-neutral"}`}>
            <FiLink className="mr-1 h-3 w-3" />
            {wallet ? "Wallet linked" : "No wallet linked"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label">Display name</p>
          <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {displayName || "—"}
          </p>
        </div>

        <div>
          <p className="label">Linked wallet</p>
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            {wallet ? formatAddress(wallet) : connectedWallet ? `${formatAddress(connectedWallet)} (connected)` : "— no wallet connected —"}
          </p>
          {!wallet && connectedWallet && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-2"
              disabled={linking}
              onClick={link}
              title="Sign once to prove you own this wallet — free, no funds move"
            >
              <FiLink className="h-3 w-3" />
              {linking ? "Waiting for your signature…" : `Link ${formatAddress(connectedWallet)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

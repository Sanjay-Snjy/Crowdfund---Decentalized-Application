/**
 * CrowdFund User ID card.
 *
 * Shows the application-facing identity only: the CrowdFund User ID, the display
 * name, wallet connection state and the account source. Clerk ids are never shown.
 *
 * The display name is NOT editable here: it is derived from the signed-in Clerk
 * account (full name, then first + last name, then username, then the email
 * local-part) and kept in step by the server on every authenticated request — the
 * same name the header shows. Contributors link their wallet from here with a free
 * signature, which is what attributes their donations, points and badges.
 */
import { useMemo, useState } from "react";
import { FiCheck, FiCopy, FiLink, FiShield, FiUser } from "react-icons/fi";
import { toast } from "react-hot-toast";
import { useAccount } from "wagmi";
import { copyToClipboard, formatAddress, formatDate } from "../../utils/helpers";
import { useWalletLink } from "../../hooks/useWalletLink";

export default function CrowdFundIdCard({ identity, profile, onUpdated = null }) {
  const [copied, setCopied] = useState(false);
  const { address, isConnected } = useAccount();
  const { linkWallet, linking } = useWalletLink();

  const wallet = profile?.walletAddress || identity?.walletAddress || null;
  const connectedWallet = isConnected ? address : null;

  const registered = useMemo(() => {
    if (!profile?.registeredAt) return null;
    try {
      return formatDate(profile.registeredAt);
    } catch {
      return null;
    }
  }, [profile?.registeredAt]);

  const link = async () => {
    const result = await linkWallet();
    if (result) onUpdated?.(result);
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
    <div className="card rounded-2xl p-5">
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
            {profile.displayName || "—"}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            Taken from your Clerk account — the same name shown in the header. Change it in Clerk and it
            updates here automatically.
          </p>
        </div>

        <div>
          <p className="label">Linked wallet</p>
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            {wallet ? formatAddress(wallet) : "— no wallet linked —"}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            {wallet
              ? "Donations from this wallet are attributed to you."
              : "Donations from an unlinked wallet cannot be attributed to your account, so they earn no points."}
            {" · "}
            {registered ? `Registered ${registered}` : "Registration date unavailable"} ·{" "}
            {profile.authSource === "clerk" ? "Clerk account" : "Wallet account"}
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

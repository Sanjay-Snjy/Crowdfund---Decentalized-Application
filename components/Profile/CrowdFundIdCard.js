/**
 * CrowdFund User ID card.
 *
 * Shows the application-facing identity only: the CrowdFund User ID, the display
 * name, wallet connection state and the account source. Clerk ids are never shown.
 */
import { useMemo, useState } from "react";
import { FiCopy, FiCheck, FiLink, FiShield, FiUser } from "react-icons/fi";
import { toast } from "react-hot-toast";
import { apiPatch, ApiError } from "../../utils/apiClient";
import { copyToClipboard, formatAddress, formatDate } from "../../utils/helpers";

export default function CrowdFundIdCard({ identity, profile, onUpdated = null }) {
  const [name, setName] = useState(profile?.displayName || "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const wallet = profile?.walletAddress || identity?.walletAddress || null;

  const registered = useMemo(() => {
    if (!profile?.registeredAt) return null;
    try {
      return formatDate(profile.registeredAt);
    } catch {
      return null;
    }
  }, [profile?.registeredAt]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await apiPatch("/api/me", { displayName: name });
      toast.success("Display name updated");
      onUpdated?.(result.profile);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save your display name");
    } finally {
      setSaving(false);
    }
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
            {wallet ? "Wallet connected" : "No wallet connected"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cf-display-name">
            Display name
          </label>
          <div className="flex gap-2">
            <input
              id="cf-display-name"
              className="input"
              value={name}
              maxLength={60}
              placeholder="Shown on campaigns you create"
              onChange={(event) => setName(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              disabled={saving || name === (profile.displayName || "")}
              onClick={save}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div>
          <p className="label">Linked wallet</p>
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            {wallet ? formatAddress(wallet) : "— not connected —"}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            {registered ? `Registered ${registered}` : "Registration date unavailable"} ·{" "}
            {profile.authSource === "clerk" ? "Clerk account" : "Wallet account"}
          </p>
        </div>
      </div>
    </div>
  );
}

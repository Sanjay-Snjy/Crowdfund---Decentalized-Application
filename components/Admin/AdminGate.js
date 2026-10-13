/**
 * Admin gate.
 *
 * This is a UX convenience only: it hides administrative sections from visitors
 * who are not administrators. The authorization decision itself is made on the
 * server for every /api/admin/* request, so bypassing this component gains
 * nothing.
 *
 * Administrator identity can come from two verified sources:
 *   - a Clerk account whose CrowdFund profile has the admin role, or
 *   - a wallet signature over a server nonce for an allow-listed address.
 */
import { FiShield, FiLogIn } from "react-icons/fi";
import useIdentity from "../../hooks/useIdentity";
import { ErrorState, LoadingState } from "../Common/AsyncStates";

export default function AdminGate({ children }) {
  const { identity, isLoading, isAdmin, signInWithWallet, refresh, connectedAddress } = useIdentity();

  if (isLoading) {
    return (
      <div className="card rounded-2xl p-5">
        <LoadingState rows={3} height="h-16" label="Checking administrator access" />
      </div>
    );
  }

  if (isAdmin) return <>{children}</>;

  return (
    <div className="card rounded-2xl p-6">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-2xl"
          style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}
        >
          <FiShield className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Administrator access required
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            Administrative data is protected on the server. Sign in with an administrator account, or prove
            control of an allow-listed wallet — the signature is free and moves no funds.
          </p>

          {identity ? (
            <p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Signed in as {identity.cfUserId || "wallet"} ({identity.source}) — this account is not an
              administrator.
            </p>
          ) : (
            <p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {connectedAddress
                ? `Connected wallet: ${connectedAddress.slice(0, 6)}…${connectedAddress.slice(-4)}`
                : "Connect your wallet (or sign in with Clerk) to continue."}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => signInWithWallet({ purpose: "admin" })}
              disabled={!connectedAddress}
            >
              <FiLogIn className="h-3 w-3" /> Sign in as administrator
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={refresh}>
              Refresh access
            </button>
          </div>

          <div className="mt-3">
            <ErrorState
              error={{
                message: "Administrators are configured with CF_ADMIN_WALLET_ADDRESSES, CF_ADMIN_CLERK_USER_IDS or CF_ADMIN_EMAILS (or NEXT_PUBLIC_ADMIN_ADDRESS).",
              }}
              title="How administrators are authorized"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * My donation history (transaction history).
 *
 * Verified indexed contributions for the signed-in CrowdFund user, each with its
 * transaction hash, block timestamp, status and a link to the correct block
 * explorer. A refunded contribution is labelled as such instead of being hidden.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FiExternalLink, FiHeart } from "react-icons/fi";
import { apiGet } from "../../utils/apiClient";
import { formatAddress, formatDate } from "../../utils/helpers";
import { formatEthDisplay } from "../../lib/format";
import { EmptyState, ErrorState, LoadingState, SectionTitle, StatusPill } from "../Common/AsyncStates";
import LinkWalletNotice from "../Profile/LinkWalletNotice";

export default function MyDonations({ enabled = true, title = "Transaction History", limit = 8 }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me", "donations"],
    queryFn: () => apiGet("/api/me/donations"),
    enabled,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  if (!enabled) return null;

  return (
    <div className="card rounded-2xl p-5">
      <SectionTitle
        title={title}
        description={
          data?.summary
            ? `${data.summary.confirmedCount} confirmed · ${formatEthDisplay(data.summary.totalWei, 4)} ETH across ${
                data.summary.campaigns
              } campaign(s)`
            : "Your confirmed contributions, straight from the chain"
        }
        right={data?.cfUserId ? <span className="badge badge-neutral">{data.cfUserId}</span> : null}
      />

      {/* Donations are matched to this profile through its linked wallet. */}
      {!isLoading && !error && (
        <LinkWalletNotice
          walletLinked={Boolean(data?.walletLinked)}
          onLinked={refetch}
          message="Link the wallet you donated with to see those donations here."
          className="mb-3"
        />
      )}

      {isLoading ? (
        <LoadingState rows={3} height="h-12" />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={refetch}
          title={error?.status === 401 ? "Sign in to see your contributions" : "Could not load your contributions"}
        />
      ) : !data?.donations?.length ? (
        <EmptyState
          icon={<FiHeart className="h-8 w-8" style={{ color: "var(--color-text-muted)" }} />}
          title="No contributions indexed yet"
          description={
            data?.walletLinked
              ? "Donations appear here once the transaction is mined and confirmed. If you just contributed, it can take a few seconds."
              : "Donations from the wallet linked to this account appear here once they are mined and confirmed."
          }
          action={
            <Link href="/home" className="btn btn-secondary btn-sm">
              Browse campaigns
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {data.donations.slice(0, limit).map((donation) => (
            <div
              key={`${donation.txHash}-${donation.campaignId}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{ background: "var(--color-surface-raised)" }}
            >
              <div className="min-w-0">
                <Link
                  href={`/campaign/${donation.campaignId}`}
                  className="truncate text-xs font-semibold hover:underline"
                  style={{ color: "var(--color-text)" }}
                >
                  {donation.campaignName || `Campaign #${donation.campaignId}`}
                </Link>
                <p className="font-mono text-[11px]" style={{ color: "var(--color-text-secondary)" }} title={donation.donorWallet || ""}>
                  {donation.donorWallet ? formatAddress(donation.donorWallet) : "—"}
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {formatDate(donation.timestamp)}
                  {donation.refundedAt ? " · refunded" : ""}
                  {donation.status !== "confirmed" ? ` · ${donation.confirmations} confirmation(s)` : ""}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {formatEthDisplay(donation.amountWei, 4)} ETH
                </span>
                <StatusPill status={donation.status} />
                {donation.refundedAt && <span className="badge badge-warning">Refunded</span>}
                <a
                  href={donation.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                  title={donation.txHash}
                >
                  Tx <FiExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}

          {data.donations.length > limit && (
            <p className="pt-1 text-right text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Showing {limit} of {data.donations.length} indexed contributions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

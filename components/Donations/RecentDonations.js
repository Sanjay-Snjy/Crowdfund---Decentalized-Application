/**
 * Recent donation activity.
 *
 * Rows come from indexed `ContributionMade` events of the deployed contract, so
 * every entry has a real transaction hash, a confirmed status and a block
 * timestamp. Donors are labelled with their CrowdFund User ID when their wallet is
 * linked, otherwise with a shortened address — never with a fabricated ID.
 *
 * Used on the campaign details page (campaignId set) and on the user dashboard
 * (community-wide activity).
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FiExternalLink, FiHeart, FiUsers } from "react-icons/fi";
import { apiGet, buildQuery } from "../../utils/apiClient";
import { formatDate, formatAddress } from "../../utils/helpers";
import { formatEthDisplay } from "../../lib/format";
import { EmptyState, ErrorState, LoadingState, SectionTitle, StatusPill } from "../Common/AsyncStates";

export default function RecentDonations({
  campaignId = null,
  limit = 8,
  title = "Recent Donations",
  description = "Confirmed contributions recorded on-chain",
  enabled = true,
  showCampaign = true,
}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["donations", campaignId || "all", limit],
    queryFn: () => apiGet(`/api/donations${buildQuery({ campaignId, limit })}`),
    enabled,
    refetchInterval: 45 * 1000,
    retry: 1,
  });

  if (!enabled) return null;

  return (
    <div className="card rounded-2xl p-5">
      <SectionTitle
        title={title}
        description={description}
        right={
          data?.network?.explorerName ? (
            <span className="badge badge-neutral" title={`Data from ${data.network.explorerName}`}>
              {data.network.explorerName}
            </span>
          ) : null
        }
      />

      {isLoading ? (
        <LoadingState rows={4} height="h-14" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load donation activity" />
      ) : data.donations.length === 0 ? (
        <EmptyState
          icon={<FiHeart className="h-8 w-8" style={{ color: "var(--color-text-muted)" }} />}
          title="No donations yet"
          description={
            campaignId
              ? "Be the first supporter of this campaign. Confirmed donations appear here with their transaction link."
              : "Community donations will appear here as soon as a contribution is confirmed on-chain."
          }
        />
      ) : (
        <div className="space-y-2">
          {data.donations.map((donation) => (
            <div
              key={`${donation.txHash}-${donation.campaignId}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{ background: "var(--color-surface-raised)" }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}
                >
                  <FiUsers className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold" style={{ color: "var(--color-text)" }}>
                    {donation.donor.label}
                    {donation.donor.cfUserId && donation.donor.label !== donation.donor.cfUserId && (
                      <span
                        className="ml-2 font-mono text-[10px]"
                        style={{ color: "var(--color-text-muted)" }}
                        title="CrowdFund User ID"
                      >
                        {donation.donor.cfUserId}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {showCampaign && (
                      <>
                        {donation.campaignName || `Campaign #${donation.campaignId}`}
                        {" · "}
                      </>
                    )}
                    {donation.timestamp ? formatDate(donation.timestamp) : "timestamp unavailable"}
                    {!donation.donor.verified && donation.donor.walletAddress && (
                      <> · {formatAddress(donation.donor.walletAddress)}</>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <StatusPill status={donation.status} />
                <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {formatEthDisplay(donation.amountWei, 4)} ETH
                </span>
                <a
                  href={donation.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                  title={`View transaction ${donation.txHash}`}
                >
                  Tx <FiExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}

          {campaignId && (
            <div className="pt-1 text-right">
              <Link href={`/contributions`} className="text-[11px] hover:underline" style={{ color: "var(--color-accent)" }}>
                See your own contributions
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

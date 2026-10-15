/**
 * Admin → Campaign funding status + fund release history.
 *
 * Per campaign: target, collected, progress, released, remaining escrow, status,
 * current milestone, approved milestone count and the amount eligible for the next
 * release. The contract's whole balance is deliberately NOT reused here — each
 * campaign's numbers come from the contract's own per-campaign accounting.
 *
 * The release history is built from indexed `MilestoneFundsReleased` /
 * `CampaignCompleted` events, so released funds are traceable to a transaction.
 *
 * Deactivated campaigns stay out of the default list (they can no longer collect or
 * release anything) but are never hidden outright: an administrator can reveal them
 * with one click, and every card links to the campaign's own page, where the
 * milestone release controls live.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FiExternalLink, FiEyeOff, FiFlag, FiLayers, FiRefreshCw } from "react-icons/fi";
import { apiGet, buildQuery } from "../../utils/apiClient";
import { formatDate } from "../../utils/helpers";
import { EmptyState, ErrorState, LoadingState, SectionTitle } from "../Common/AsyncStates";

function progressTone(percent) {
  if (percent >= 100) return "var(--color-success)";
  if (percent >= 50) return "var(--color-accent)";
  return "var(--color-warning)";
}

export default function CampaignFundingPanel({ enabled = true, limit = 6 }) {
  const [expanded, setExpanded] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "campaigns", expanded ? limit * 2 : limit],
    queryFn: () => apiGet(`/api/admin/campaigns${buildQuery({ limit: expanded ? limit * 3 : limit })}`),
    enabled,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  if (!enabled) return null;

  const campaigns = data?.campaigns || [];
  const releases = data?.fundReleaseHistory || [];

  // `active === false` is an administrator's deactivation, not a campaign that ran
  // its course — those are filtered out of the default view and counted here.
  const deactivatedCount = campaigns.filter((campaign) => campaign.active === false).length;
  const visibleCampaigns = useMemo(
    () => (showDeactivated ? campaigns : campaigns.filter((campaign) => campaign.active !== false)),
    [campaigns, showDeactivated]
  );

  return (
    <div className="card rounded-2xl p-5">
      <SectionTitle
        title="Campaign Funding Status"
        description="Verified contract accounting per campaign — escrow is tracked separately from released funds"
        right={
          <div className="flex items-center gap-2">
            {deactivatedCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowDeactivated((value) => !value)}
              >
                <FiEyeOff className="h-3 w-3" />
                {showDeactivated ? "Hide deactivated" : `Show deactivated (${deactivatedCount})`}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => refetch()} disabled={isFetching}>
              <FiRefreshCw className="h-3 w-3" /> {isFetching ? "Reading…" : "Refresh"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show fewer" : "Show more"}
            </button>
          </div>
        }
      />

      {isLoading ? (
        <LoadingState rows={3} height="h-20" label="Reading campaign escrow state" />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={refetch}
          title={error?.status === 401 || error?.status === 403 ? "Not authorized" : "Could not load campaigns"}
        />
      ) : visibleCampaigns.length === 0 ? (
        <EmptyState
          icon={<FiLayers className="h-8 w-8" style={{ color: "var(--color-text-muted)" }} />}
          title={
            campaigns.length > 0
              ? "Every campaign in this view is deactivated"
              : "No campaigns with on-chain activity yet"
          }
          description={
            campaigns.length > 0
              ? "Use “Show deactivated” above to review those campaigns and their remaining escrow."
              : "Create a campaign or run a sync so the indexer can discover campaigns from contract events."
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleCampaigns.map((campaign) => {
            const percent = Math.max(0, Math.min(100, campaign.funding.progressPercent || 0));
            const deactivated = campaign.active === false;
            return (
              <div
                key={campaign.campaignId}
                className="rounded-xl border p-3"
                style={{
                  borderColor: deactivated ? "var(--color-error, #ef4444)" : "var(--color-border)",
                  opacity: deactivated ? 0.72 : 1,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/campaign/${campaign.campaignId}`}
                      className="block truncate text-xs font-semibold hover:underline"
                      style={{ color: "var(--color-text)" }}
                    >
                      #{campaign.campaignId} · {campaign.title || `Campaign #${campaign.campaignId}`}
                    </Link>
                    <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                      {deactivated ? "Deactivated by an administrator" : campaign.status} · deadline{" "}
                      {campaign.deadline ? formatDate(campaign.deadline) : "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {deactivated && <span className="badge badge-error">Deactivated</span>}
                    <span className={`badge ${campaign.completed ? "badge-success" : campaign.funding.funded ? "badge-warning" : "badge-neutral"}`}>
                      {campaign.funding.funded ? "Target reached" : "Fundraising"}
                    </span>
                  </div>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-surface-raised)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${percent}%`, background: progressTone(percent) }}
                  />
                </div>

                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
                  <span>
                    Target: <strong style={{ color: "var(--color-text)" }}>{campaign.funding.targetEth} ETH</strong>
                  </span>
                  <span>
                    Collected: <strong style={{ color: "var(--color-text)" }}>{campaign.funding.collectedEth} ETH</strong>
                  </span>
                  <span>
                    Progress: <strong style={{ color: "var(--color-text)" }}>{percent.toFixed(1)}%</strong>
                  </span>
                  <span>
                    Released: <strong style={{ color: "var(--color-text)" }}>{campaign.escrow.releasedEth} ETH</strong>
                  </span>
                  <span>
                    Escrow: <strong style={{ color: "var(--color-text)" }}>{campaign.escrow.escrowEth} ETH</strong>
                  </span>
                  <span>
                    Eligible next:{" "}
                    <strong style={{ color: "var(--color-text)" }}>
                      {campaign.escrow.remainingEligibleReleaseEth} ETH
                    </strong>
                  </span>
                  <span>
                    Current milestone:{" "}
                    <strong style={{ color: "var(--color-text)" }}>
                      {campaign.milestones.currentMilestoneIndex === -1
                        ? "all released"
                        : `M${campaign.milestones.currentMilestoneIndex + 1}`}
                    </strong>
                  </span>
                  <span>
                    Approved:{" "}
                    <strong style={{ color: "var(--color-text)" }}>
                      {campaign.milestones.approvedMilestones}/{campaign.milestones.items.length}
                    </strong>
                  </span>
                </div>

                {/* Every campaign card leads to the campaign page, where the
                    admin-only milestone release controls live. */}
                <div className="mt-2 flex items-center justify-end">
                  <Link href={`/campaign/${campaign.campaignId}`} className="btn btn-ghost btn-sm">
                    Open campaign <FiExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fund release history */}
      <div className="mt-5">
        <p className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--color-text)" }}>
          <FiFlag className="h-3.5 w-3.5" /> Fund release history
        </p>
        {releases.length === 0 ? (
          <p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            No milestone release has been indexed for this deployment yet.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {releases.map((release) => (
              <div
                key={`${release.txHash}-${release.logIndex}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2"
                style={{ background: "var(--color-surface-raised)" }}
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium" style={{ color: "var(--color-text)" }}>
                    {release.campaignName || `Campaign #${release.campaignId}`}
                    {release.milestoneIndex !== null ? ` · milestone ${release.milestoneIndex + 1}` : ""}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {formatDate(release.timestamp)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold" style={{ color: "var(--color-success)" }}>
                    {release.amountEth} ETH
                  </span>
                  <a
                    href={release.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    Tx <FiExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

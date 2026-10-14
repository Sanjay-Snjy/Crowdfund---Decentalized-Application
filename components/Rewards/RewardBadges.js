/**
 * Donor rewards: badges, points, eligible volume and per-contribution breakdown.
 *
 * All values come from /api/rewards/me, which recomputes them from verified,
 * indexed contribution records. Nothing here can be edited by the browser.
 *
 * The connected wallet is passed along so a user who has just connected (but not
 * yet linked) a wallet sees its real, verified contributions instead of a zero.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAccount } from "wagmi";
import { FiAward, FiLink, FiStar, FiTrendingUp } from "react-icons/fi";
import { apiGet, buildQuery } from "../../utils/apiClient";
import { formatAddress, formatDate } from "../../utils/helpers";
import { formatEther as formatWei } from "../../lib/format";
import { EmptyState, ErrorState, LoadingState, SectionTitle, StatTile } from "../Common/AsyncStates";
import { MATCHED_CARD, MATCHED_CARD_BODY, Pager, usePagedList } from "../Common/PagedList";

const BADGE_ICONS = {
  supporter: FiStar,
  silver: FiAward,
  gold: FiAward,
  platinum: FiAward,
};

function BadgeCard({ badge }) {
  const Icon = BADGE_ICONS[badge.id] || FiAward;
  const earned = badge.earned;

  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        borderColor: earned ? badge.accent : "var(--color-border)",
        background: earned ? `${badge.accent}14` : "var(--color-surface)",
        opacity: earned ? 1 : 0.65,
      }}
      title={badge.description}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: earned ? badge.accent : "var(--color-text-muted)" }} />
        <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
          {badge.label}
        </p>
        {earned && (
          <span className="ml-auto badge badge-success" style={{ fontSize: 10 }}>
            Earned
          </span>
        )}
      </div>

      {!earned && badge.thresholdEth > 0 && (
        <>
          <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-surface-raised)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${badge.progress}%`, background: badge.accent }}
            />
          </div>
          <p className="mt-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            {badge.progress}% of {badge.thresholdEth} ETH
          </p>
        </>
      )}
      {earned && (
        <p className="mt-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
          {badge.thresholdEth > 0 ? `${badge.thresholdEth} ETH threshold` : "First contribution"}
        </p>
      )}
    </div>
  );
}

export default function RewardBadges({ enabled = true }) {
  const { address } = useAccount();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["rewards", "me", address || "account"],
    queryFn: () => apiGet(`/api/rewards/me${buildQuery({ address })}`),
    enabled,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  // The per-contribution breakdown is paged so the card can keep the same fixed
  // height as the cards it sits beside.
  const breakdownPager = usePagedList(data?.breakdown, 3);

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className={MATCHED_CARD}>
        <SectionTitle title="My Rewards & Badges" description="Loading your recognition…" />
        <LoadingState rows={2} height="h-16" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={MATCHED_CARD}>
        <SectionTitle title="My Rewards & Badges" />
        <ErrorState
          error={error}
          onRetry={refetch}
          title={error?.status === 401 ? "Sign in to see your rewards" : "Could not load your rewards"}
        />
      </div>
    );
  }

  const badges = data?.badges || [];

  return (
    <div className={MATCHED_CARD}>
      <SectionTitle
        title="My Rewards & Badges"
        description={`${data.policy.pointsPerEth} points per 1 ETH of eligible, confirmed contribution`}
        right={
          <span className="flex flex-wrap items-center justify-end gap-2">
            <Pager pager={breakdownPager} label="contributions" />
            {data.walletAddress && !data.walletLinked && (
              <span
                className="badge badge-neutral"
                title="Connected wallet — these verified contributions are matched by address"
              >
                <FiLink className="mr-1 h-3 w-3" />
                {formatAddress(data.walletAddress)}
              </span>
            )}
            <span className="badge badge-neutral">
              <FiTrendingUp className="mr-1 h-3 w-3" />
              {data.points} points
            </span>
          </span>
        }
      />

      <div className={`${MATCHED_CARD_BODY} space-y-4`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Reward points" value={data.points} accent="var(--color-accent)" />
        <StatTile label="Eligible contributions" value={`${formatWei(data.eligibleWei)} ETH`} />
        <StatTile label="Campaigns supported" value={data.campaignsSupported} />
        <StatTile label="Contributions" value={data.contributionsCount} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {badges.map((badge) => (
          <BadgeCard key={badge.id} badge={badge} />
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
          How each reward was earned
        </p>
        {data.breakdown.length === 0 ? (
          <EmptyState
            title="No contributions indexed yet"
            description={
              data.walletAddress
                ? "Contribute to a campaign and your recognition appears here once the transaction is confirmed."
                : "Connect the wallet you donated with to see your points, badges and contribution breakdown."
            }
            action={
              <Link href="/home" className="btn btn-secondary btn-sm">
                Browse campaigns
              </Link>
            }
          />
        ) : (
          <div className="mt-2 space-y-1.5">
            {breakdownPager.slice.map((row) => (
              <div
                key={`${row.txHash}-${row.transactionId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2"
                style={{ background: "var(--color-surface-raised)" }}
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium" style={{ color: "var(--color-text)" }}>
                    {row.campaignName || `Campaign #${row.campaignId ?? "?"}`}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {row.timestamp ? formatDate(row.timestamp) : "timestamp unavailable"}
                    {row.refunded ? " · refunded" : row.status !== "confirmed" ? ` · ${row.status}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs" style={{ color: "var(--color-text)" }}>
                    {formatWei(row.amountWei)} ETH
                  </span>
                  <span
                    className="badge"
                    style={{
                      background: row.rewardEligible ? "var(--color-success-light)" : "var(--color-surface-raised)",
                      color: row.rewardEligible ? "var(--color-success)" : "var(--color-text-muted)",
                    }}
                    title={row.rewardEligible ? "Counts towards rewards" : "Does not count towards rewards"}
                  >
                    {row.rewardEligible ? `+${row.points} pts` : "no points"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        Refunded contributions do not earn points (
        {data.policy.refundedContributionsEarnRewards ? "policy: refunds still count" : "policy: refunds are excluded"}).
        Badges are recognition only — they have no monetary value and cannot be redeemed.
      </p>
      </div>
    </div>
  );
}

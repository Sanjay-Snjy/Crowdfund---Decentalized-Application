/**
 * Campaign funding & escrow status.
 *
 * Every number is read from the deployed contract through
 * /api/campaigns/:id/funding: funding target, total collected, progress, amount
 * already released, the escrow still held for THIS campaign, milestone progress
 * and — only when the deployed contract supports it — the abandoned-campaign
 * recovery state.
 */
import { useQuery } from "@tanstack/react-query";
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiClock,
  FiLock,
  FiTarget,
  FiUnlock,
} from "react-icons/fi";
import { useAccount } from "wagmi";
import { apiGet } from "../../utils/apiClient";
import { SUPPORTS_RECOVERY, useContract } from "../../hooks/useContract";
import { formatDate } from "../../utils/helpers";
import { formatEthDisplay } from "../../lib/format";
import { ErrorState, LoadingState, SectionTitle, StatTile } from "../Common/AsyncStates";

function statusTone(status) {
  if (status === "Completed") return { className: "badge-success" };
  if (String(status).startsWith("Failed")) return { className: "badge-error" };
  if (String(status).includes("awaiting") || String(status).includes("release pending")) {
    return { className: "badge-warning" };
  }
  if (status === "In progress") return { className: "badge-success" };
  return { className: "badge-neutral" };
}

function milestoneIcon(milestone) {
  if (milestone.fundsReleased) return { Icon: FiCheckCircle, color: "var(--color-success)", label: "Released" };
  if (milestone.approved) return { Icon: FiUnlock, color: "var(--color-accent)", label: "Approved — release pending" };
  if (milestone.evidenceSubmitted) return { Icon: FiClock, color: "var(--color-warning)", label: "Voting open" };
  return { Icon: FiLock, color: "var(--color-text-muted)", label: "Locked" };
}

export default function FundingStatus({ campaignId, enabled = true }) {
  const { address } = useAccount();
  const { useClaimRecoveryShare } = useContract();
  const { claimRecoveryShare, isLoading: claiming } = useClaimRecoveryShare();

  // Only a deployment that includes the recovery functions can be claimed from.
  const recoverySupported = SUPPORTS_RECOVERY && Boolean(data?.recovery?.supported);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["campaign-funding", campaignId, address || "anonymous"],
    queryFn: () =>
      apiGet(`/api/campaigns/${campaignId}/funding${address ? `?donor=${address}` : ""}`),
    enabled: Boolean(campaignId && enabled),
    refetchInterval: 30 * 1000,
    retry: 1,
  });

  if (!enabled || !campaignId) return null;

  if (isLoading) {
    return (
      <div className="card rounded-2xl p-5">
        <SectionTitle title="Funding & Escrow" description="Reading verified contract state…" />
        <LoadingState rows={3} height="h-14" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card rounded-2xl p-5">
        <SectionTitle title="Funding & Escrow" />
        <ErrorState error={error} onRetry={refetch} title="Could not read the campaign's escrow state" />
      </div>
    );
  }

  const { funding, escrow, milestones, recovery, campaign, indexedActivity, contract } = data;
  const progress = Math.max(0, Math.min(100, funding.progressPercent || 0));

  return (
    <div className="card rounded-2xl p-5">
      <SectionTitle
        title="Funding & Escrow"
        description={`Verified on-chain accounting · contract ${contract.address?.slice(0, 10)}…`}
        right={<span className={`badge ${statusTone(campaign.status).className}`}>{campaign.status}</span>}
      />

      <div>
        <div className="mb-1 flex items-center justify-between text-xs" style={{ color: "var(--color-text-muted)" }}>
          <span>Funding progress</span>
          <span style={{ color: "var(--color-text)" }}>{progress.toFixed(2)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--color-surface-raised)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: "var(--color-accent)" }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Funding target"
          value={`${funding.targetEth} ETH`}
          icon={<FiTarget className="h-4 w-4" />}
        />
        <StatTile label="Total collected" value={`${funding.collectedEth} ETH`} />
        <StatTile label="Amount released" value={`${escrow.releasedEth} ETH`} accent="var(--color-success)" />
        <StatTile
          label="Remaining escrow"
          value={`${escrow.escrowEth} ETH`}
          accent="var(--color-warning)"
          hint="Held by the contract for this campaign"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Current milestone"
          value={
            milestones.currentMilestoneIndex === -1
              ? "All released"
              : `Milestone ${milestones.currentMilestoneIndex + 1}`
          }
        />
        <StatTile label="Approved milestones" value={`${milestones.approvedMilestones} / ${milestones.items.length}`} />
        <StatTile
          label="Eligible for next release"
          value={`${escrow.remainingEligibleReleaseEth} ETH`}
          hint="Only after donors approve"
        />
      </div>

      <div className="mt-4 space-y-2">
        {milestones.items.map((milestone) => {
          const { Icon, color, label } = milestoneIcon(milestone);
          return (
            <div
              key={milestone.index}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2"
              style={{ background: "var(--color-surface-raised)" }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" style={{ color }} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium" style={{ color: "var(--color-text)" }}>
                    {milestone.title} · {milestone.percentage}%
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {label}
                    {milestone.fundsReleased && milestone.amountWei !== "0"
                      ? ` · ${formatEthDisplay(milestone.amountWei, 6)} ETH`
                      : ""}
                    {milestone.evidenceSubmitted && !milestone.fundsReleased
                      ? ` · approvals ${milestone.approvals}, rejections ${milestone.rejections}`
                      : ""}
                  </p>
                </div>
              </div>
              <span
                className="text-xs font-semibold"
                style={{ color: milestone.fundsReleased ? "var(--color-success)" : "var(--color-text-muted)" }}
              >
                {milestone.fundsReleased ? "Paid out" : "In escrow"}
              </span>
            </div>
          );
        })}
      </div>

      {recoverySupported && (
        <div
          className="mt-4 rounded-xl border p-3"
          style={{
            borderColor: recovery.eligible ? "var(--color-warning)" : "var(--color-border)",
            background: recovery.eligible ? "var(--color-warning-light)" : "var(--color-surface-raised)",
          }}
        >
          <p className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--color-text)" }}>
            <FiAlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--color-warning)" }} />
            Abandoned-campaign recovery
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
            {recovery.eligible
              ? `Recovery is available: donors can claim their share of the ${formatEthDisplay(
                  recovery.escrowPoolWei,
                  6
                )} ETH still in escrow. Once a claim is made the campaign's milestones can no longer be released.`
              : "Recovery is not available for this campaign yet. It unlocks only after a long milestone inactivity period plus a grace period, and never while a milestone release is still possible."}
          </p>

          {!recovery.eligible && recovery.unlocksAt > 0 && recovery.escrowPoolWei !== "0" && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Eligible from {formatDate(recovery.unlocksAt)} (if no milestone activity happens first).
            </p>
          )}

          {recovery.eligible && address && recovery.donorClaimableWei && recovery.donorClaimableWei !== "0" && SUPPORTS_RECOVERY && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={claiming}
                onClick={() => claimRecoveryShare?.({ args: [campaignId] })}
              >
                {claiming ? "Claiming…" : `Claim ${recovery.donorClaimableEth} ETH`}
              </button>
              <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                Pro-rata share of the remaining escrow, claimable once.
              </span>
            </div>
          )}

          {recovery.eligible && !address && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Connect the wallet you contributed with to claim your share.
            </p>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        {indexedActivity.confirmedDonationCount} confirmed donation
        {indexedActivity.confirmedDonationCount === 1 ? "" : "s"} indexed
        {indexedActivity.confirmedDonationCount > 0 ? ` totalling ${indexedActivity.confirmedEth} ETH` : ""}. The
        contract balance covers every campaign, so only this campaign's own escrow is shown above.
      </p>
    </div>
  );
}

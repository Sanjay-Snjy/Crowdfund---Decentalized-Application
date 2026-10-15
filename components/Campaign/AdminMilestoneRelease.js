/**
 * Administrator milestone release control.
 *
 * Milestone money only ever moves through the contract, so this panel does not
 * bypass the mechanism — it drives and audits it:
 *
 *   1. the creator submits evidence for the next milestone (`onlyCampaignCreator`
 *      on-chain, so an administrator cannot do it for them),
 *   2. donors vote with voting power equal to their contribution,
 *   3. an approved milestone can be released by ANY address — the administrator's
 *      connected wallet included,
 *   4. each release is traceable to a transaction in the release history.
 *
 * The administrative lever is therefore "Request to submit evidence": a recorded,
 * timestamped ask the creator sees on the campaign page, which closes itself as soon
 * as the on-chain evidence appears. Requests are created through an admin-only API
 * route — this component only decides what to render, never what is allowed.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiAlertTriangle, FiCheckCircle, FiClock, FiExternalLink, FiFlag, FiFileText,
  FiLock, FiRefreshCw, FiSend, FiUnlock,
} from "react-icons/fi";
import { toast } from "react-hot-toast";
import { apiGet, apiPost, buildQuery } from "../../utils/apiClient";
import { formatAddress, formatDate, formatEther } from "../../utils/helpers";
import { MILESTONE_SCHEDULE, VOTE_QUORUM_PERCENT } from "../../constants";
import { ErrorState, LoadingState, SectionTitle } from "../Common/AsyncStates";

const ethersBig = (value) => {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
};

/** Percentage of a quorum target that has been reached (0–100). */
function quorumPercent(castWeightWei, quorumTargetWei) {
  const cast = ethersBig(castWeightWei);
  const target = ethersBig(quorumTargetWei);
  if (target <= 0n) return cast > 0n ? 100 : 0;
  const raw = Number((cast * 10000n) / target) / 100;
  return Math.max(0, Math.min(100, raw));
}

function stateOf(milestone, approved) {
  if (milestone?.fundsReleased) return { label: "Released", tone: "success" };
  if (approved) return { label: "Approved — release pending", tone: "accent" };
  if (milestone?.evidenceSubmitted) return { label: "Voting open", tone: "warning" };
  return { label: "Awaiting evidence", tone: "neutral" };
}

const toneStyle = {
  success: { background: "var(--color-success-light, rgba(16,185,129,0.12))", color: "var(--color-success)" },
  accent: { background: "var(--color-accent-light)", color: "var(--color-accent)" },
  warning: { background: "var(--color-warning-light, rgba(245,158,11,0.14))", color: "var(--color-warning)" },
  neutral: { background: "var(--color-surface-raised)", color: "var(--color-text-secondary)" },
};

export default function AdminMilestoneRelease({
  campaignId,
  milestones,
  plannedShares,
  approvedStatuses,
  onRelease,
  releasing = false,
  onRefetch,
  raisedWei = "0",
}) {
  const queryClient = useQueryClient();
  const [noteFor, setNoteFor] = useState(null); // milestone index with an open note box
  const [note, setNote] = useState("");
  const [busyIndex, setBusyIndex] = useState(null);

  const requestsQuery = useQuery({
    queryKey: ["admin", "campaign", campaignId, "milestone-requests"],
    queryFn: () => apiGet(`/api/admin/campaigns/${campaignId}/milestone-requests`),
    enabled: Boolean(campaignId),
    refetchInterval: 30 * 1000,
    retry: 1,
  });

  const fundingQuery = useQuery({
    queryKey: ["admin", "campaign", campaignId, "funding"],
    queryFn: () => apiGet(`/api/admin/campaigns${buildQuery({ campaignId, releases: 1 })}`),
    enabled: Boolean(campaignId),
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  const requests = requestsQuery.data?.requests || [];
  const eligibilityByIndex = useMemo(() => {
    const map = new Map();
    (requestsQuery.data?.milestones || []).forEach((entry) => map.set(entry.index, entry));
    return map;
  }, [requestsQuery.data]);

  const funding = fundingQuery.data?.campaigns?.[0] || null;
  const releases = fundingQuery.data?.fundReleaseHistory || [];
  const releasesByMilestone = useMemo(() => {
    const map = new Map();
    releases.forEach((release) => {
      if (release.milestoneIndex !== null && !map.has(release.milestoneIndex)) {
        map.set(release.milestoneIndex, release);
      }
    });
    return map;
  }, [releases]);

  const latestByMilestone = useMemo(() => {
    const map = new Map();
    requests
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .forEach((request) => {
        if (!map.has(request.milestoneIndex)) map.set(request.milestoneIndex, request);
      });
    return map;
  }, [requests]);

  const list = milestones || [];

  const submitRequest = async (index) => {
    setBusyIndex(index);
    try {
      const result = await apiPost(`/api/admin/campaigns/${campaignId}/milestone-requests`, {
        milestoneIndex: index,
        note: note.trim(),
      });
      toast.success(result?.message || "Evidence requested from the creator");
      setNoteFor(null);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "campaign", campaignId, "milestone-requests"] });
    } catch (error) {
      toast.error(error?.message || "Could not record the request");
    } finally {
      setBusyIndex(null);
    }
  };

  const handleRelease = async (index) => {
    setBusyIndex(index);
    try {
      await onRelease?.(index);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "campaign", campaignId, "milestone-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "campaign", campaignId, "funding"] }),
      ]);
    } finally {
      setBusyIndex(null);
    }
  };

  const refreshing = requestsQuery.isFetching || fundingQuery.isFetching;
  const refreshAll = () => {
    requestsQuery.refetch();
    fundingQuery.refetch();
    onRefetch?.();
  };

  return (
    <div className="space-y-4">
      <div className="card rounded-2xl p-4">
        <SectionTitle
          title="Milestone release control"
          description="Administrator view — evidence, donor voting and escrow release for this campaign"
          right={
            <button type="button" className="btn btn-ghost btn-sm" onClick={refreshAll} disabled={refreshing}>
              <FiRefreshCw className="h-3 w-3" /> {refreshing ? "Reading…" : "Refresh"}
            </button>
          }
        />

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4" style={{ color: "var(--color-text-secondary)" }}>
          <span>
            Escrow left:{" "}
            <strong style={{ color: "var(--color-text)" }}>
              {funding ? `${funding.escrow.escrowEth} ETH` : "—"}
            </strong>
          </span>
          <span>
            Released:{" "}
            <strong style={{ color: "var(--color-text)" }}>
              {funding ? `${funding.escrow.releasedEth} ETH` : "—"}
            </strong>
          </span>
          <span>
            Eligible next:{" "}
            <strong style={{ color: "var(--color-text)" }}>
              {funding ? `${funding.escrow.remainingEligibleReleaseEth} ETH` : "—"}
            </strong>
          </span>
          <span>
            Creator:{" "}
            <strong className="font-mono" style={{ color: "var(--color-text)" }}>
              {funding?.creator ? formatAddress(funding.creator) : "—"}
            </strong>
          </span>
        </div>

        {/* The mechanism, spelled out: the same four steps the contract enforces. */}
        <ol className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4" style={{ color: "var(--color-text-secondary)" }}>
          {[
            "1 · Request — ask the creator for milestone evidence (recorded here).",
            "2 · Evidence — the creator submits it on-chain; only the creator can.",
            `3 · Vote — contributors vote with their donation as weight; ${VOTE_QUORUM_PERCENT}% quorum plus a majority of the participating weight.`,
            "4 · Release — any address can release the approved share to the creator.",
          ].map((step) => (
            <li key={step} className="rounded-xl px-3 py-2" style={{ background: "var(--color-surface-raised)" }}>
              {step}
            </li>
          ))}
        </ol>

        <p className="mt-3 flex items-start gap-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          <FiAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <span>
            Releasing a milestone pays the creator directly from escrow and cannot be undone. Only release a
            milestone the donors approved. Evidence submission itself is creator-only — the request below is
            how the platform asks for it.
          </span>
        </p>
      </div>

      {requestsQuery.isLoading ? (
        <LoadingState rows={2} height="h-20" label="Reading milestone state" />
      ) : requestsQuery.error ? (
        <ErrorState
          error={requestsQuery.error}
          onRetry={requestsQuery.refetch}
          title={
            requestsQuery.error?.status === 401 || requestsQuery.error?.status === 403
              ? "Not authorized"
              : "Could not load the milestone release state"
          }
        />
      ) : list.length === 0 ? (
        <div className="card rounded-2xl p-5 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Milestone data is unavailable for this campaign right now.
        </div>
      ) : (
        list.map((milestone, index) => {
          const scheduled = MILESTONE_SCHEDULE[index] || { percent: milestone.percentage || 0 };
          const planned = plannedShares?.[index];
          const approved = Boolean(approvedStatuses?.[index]);
          const released = Boolean(milestone.fundsReleased);
          const state = stateOf(milestone, approved);
          const castWeight = ethersBig(milestone.approvalWeight) + ethersBig(milestone.rejectionWeight);
          const quorumTarget = (ethersBig(milestone.totalVotingPower) * BigInt(VOTE_QUORUM_PERCENT)) / 100n;
          const quorumPct = quorumPercent(castWeight, quorumTarget);
          const eligibility = eligibilityByIndex.get(index);
          const canRequest = Boolean(eligibility?.eligibility?.ok);
          const latest = latestByMilestone.get(index);
          const releaseTx = releasesByMilestone.get(index);
          const amountEth = released ? formatEther(milestone.amount) : planned ? formatEther(planned) : "—";

          return (
            <div key={index} className="card rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                    M{index + 1} · {milestone.title || `Milestone ${index + 1}`}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {scheduled.percent}% of escrow · {amountEth} ETH
                    {released ? " released to the creator" : " on release"} · raised {formatEther(raisedWei)} ETH
                  </p>
                </div>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={toneStyle[state.tone]}
                >
                  {released ? <FiCheckCircle className="h-3 w-3" /> : approved ? <FiUnlock className="h-3 w-3" /> : <FiLock className="h-3 w-3" />}
                  {state.label}
                </span>
              </div>

              {/* Evidence */}
              <div className="mt-3 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
                {milestone.evidenceSubmitted ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <FiFileText className="h-3.5 w-3.5" style={{ color: "var(--color-success)" }} />
                    Evidence submitted
                    {milestone.evidenceSubmittedAt ? ` on ${formatDate(milestone.evidenceSubmittedAt)}` : ""}
                    {milestone.evidenceCID ? (
                      <a
                        href={`https://gateway.pinata.cloud/ipfs/${milestone.evidenceCID}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 hover:underline"
                        style={{ color: "var(--color-accent)" }}
                      >
                        <FiExternalLink className="h-3 w-3" /> View evidence
                      </a>
                    ) : null}
                  </span>
                ) : (
                  <span className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
                    <FiClock className="h-3.5 w-3.5" /> No evidence submitted yet
                  </span>
                )}
              </div>

              {/* Vote tallies + quorum progress */}
              {milestone.evidenceSubmitted && (
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
                    <span>
                      {milestone.approvals} approve ({formatEther(milestone.approvalWeight)} ETH)
                    </span>
                    <span>
                      {milestone.rejections} reject ({formatEther(milestone.rejectionWeight)} ETH)
                    </span>
                    <span>
                      Participation {formatEther(castWeight)} / {formatEther(quorumTarget)} ETH quorum
                    </span>
                    <span style={{ color: approved ? "var(--color-success)" : "var(--color-text-muted)" }}>
                      {approved ? "Approved by donors" : "Awaiting donor approval"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-surface-raised)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${quorumPct}%`,
                        background: quorumPct >= 100 ? "var(--color-success)" : "var(--color-accent)",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Request status */}
              <div className="mt-3 rounded-xl px-3 py-2 text-[11px]" style={{ background: "var(--color-surface-raised)" }}>
                {latest ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`badge ${latest.status === "fulfilled" ? "badge-success" : "badge-warning"}`}
                    >
                      {latest.status === "fulfilled" ? "Evidence request fulfilled" : "Evidence requested"}
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      {latest.status === "fulfilled"
                        ? `Closed ${latest.fulfilledAt ? formatDate(latest.fulfilledAt) : ""}`
                        : `Asked on ${formatDate(latest.createdAt)}`}
                    </span>
                    {latest.note ? (
                      <span style={{ color: "var(--color-text-muted)" }}>“{latest.note}”</span>
                    ) : null}
                  </div>
                ) : (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    No administrator request recorded for this milestone.
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {approved && !released && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleRelease(index)}
                    disabled={releasing || busyIndex === index}
                  >
                    <FiUnlock className="h-3.5 w-3.5" />
                    {busyIndex === index ? "Releasing…" : `Release ${scheduled.percent}% · ${amountEth} ETH`}
                  </button>
                )}

                {/* Always offered, never silently missing: a disabled button plus the
                    contract's own reason tells an administrator exactly what has to
                    happen before the creator can be asked. */}
                {noteFor !== index && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setNoteFor(index);
                      setNote("");
                    }}
                    disabled={!canRequest}
                    title={
                      canRequest
                        ? "Records a request the creator sees on this campaign page"
                        : eligibility?.eligibility?.reason || "Not requestable yet"
                    }
                  >
                    <FiSend className="h-3.5 w-3.5" />
                    {latest?.status === "pending" ? "Update evidence request" : "Request to submit evidence"}
                  </button>
                )}

                {!canRequest && (
                  <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {eligibility?.eligibility?.reason || "This milestone cannot receive an evidence request yet."}
                  </span>
                )}
              </div>

              {noteFor === index && (
                <div className="mt-2 space-y-2">
                  <textarea
                    rows={2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Note for the creator (optional, shown publicly on the campaign page)"
                    className="input resize-none text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => submitRequest(index)}
                      disabled={busyIndex === index}
                    >
                      <FiSend className="h-3.5 w-3.5" />
                      {busyIndex === index ? "Recording…" : "Send evidence request"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setNoteFor(null);
                        setNote("");
                      }}
                    >
                      Cancel
                    </button>
                    <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                      The creator sees this on the campaign page.
                    </span>
                  </div>
                </div>
              )}

              {releaseTx && (
                <p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  Released {releaseTx.amountEth} ETH on {formatDate(releaseTx.timestamp)} ·{" "}
                  <a
                    href={releaseTx.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono hover:underline"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {releaseTx.txHash.slice(0, 10)}… <FiExternalLink className="inline h-3 w-3" />
                  </a>
                </p>
              )}
            </div>
          );
        })
      )}

      {/* Fund release history — the on-chain trail of everything this panel can move. */}
      <div className="card rounded-2xl p-4">
        <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          <FiFlag className="h-3.5 w-3.5" /> Fund release history
        </p>
        {fundingQuery.isLoading ? (
          <LoadingState rows={2} height="h-12" label="Reading release history" />
        ) : releases.length === 0 ? (
          <p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            No milestone release has been indexed for this campaign yet.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {releases.map((release) => (
              <div
                key={`${release.txHash}-${release.milestoneIndex}`}
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
                    rel="noreferrer"
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

      <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        Need the platform-wide view? <Link href="/admin" className="hover:underline" style={{ color: "var(--color-accent)" }}>Open the admin dashboard</Link>.
      </p>
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { useAccount, useContractRead, useContractReads } from "wagmi";
import { useUser } from "@clerk/nextjs";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import {
  FiUser, FiClock, FiTarget, FiShare2, FiHeart, FiUsers, FiCalendar, FiBookmark,
  FiUpload, FiExternalLink, FiShield, FiLock, FiUnlock, FiCheckCircle, FiAlertTriangle,
} from "react-icons/fi";
import { useContract } from "../../hooks/useContract";
import { getFromIPFS, uploadToIPFS, uploadJSONToIPFS } from "../../utils/ipfs";
import { useBookmarks } from "../../hooks/useBookmarks";
import {
  formatEther, calculateTimeLeft, calculateProgress, formatDate,
  copyToClipboard, getCreatorDisplayName, formatAddress,
} from "../../utils/helpers";
import { CONTRACT_ADDRESS, MILESTONE_SCHEDULE, VOTE_QUORUM_PERCENT } from "../../constants";
import { CROWDFUNDING_ABI } from "../../constants/abi";

const TABS = ["Overview", "Milestones", "Contributors"];

const toBig = (value) => {
  if (value === undefined || value === null || value === "") return ethers.BigNumber.from(0);
  try {
    return ethers.BigNumber.from(value.toString());
  } catch {
    return ethers.BigNumber.from(0);
  }
};

export default function CampaignDetails({ campaignId }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { user } = useUser();
  const { toggle, isBookmarked } = useBookmarks();
  const {
    useCampaign, useCampaignStats, useContributeToCampaignSimple, useGetRefund,
    useSubmitMilestoneEvidence, useForfeitCreatorStake, useVoteOnMilestone,
    useReleaseMilestoneFunds, useCampaignMilestones, useContribution, useCampaignAccounting,
  } = useContract();

  const [metadata, setMetadata] = useState(null);
  const [creatorProfile, setCreatorProfile] = useState(null);
  const [contributionAmount, setContributionAmount] = useState("");
  const [activeTab, setActiveTab] = useState("Overview");
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [busyMilestone, setBusyMilestone] = useState(null);

  const { data: campaign, isLoading: campaignLoading } = useCampaign(campaignId);
  const { data: stats } = useCampaignStats(campaignId);
  const { data: userContribution } = useContribution(campaignId, address);
  const { data: accounting, refetch: refetchAccounting } = useCampaignAccounting(campaignId);
  const { contribute, isLoading: contributing } = useContributeToCampaignSimple();
  const { getRefund, isLoading: refunding } = useGetRefund();
  const { submitMilestoneEvidence, isLoading: submittingEvidence } = useSubmitMilestoneEvidence();
  const { forfeitCreatorStake, isLoading: forfeiting } = useForfeitCreatorStake();
  const { voteOnMilestone, isLoading: voting } = useVoteOnMilestone();
  const { releaseMilestoneFunds, isLoading: releasing } = useReleaseMilestoneFunds();
  const { data: milestones, count: milestonesCount, isLoading: loadingMilestones, refetch: refetchMilestones } = useCampaignMilestones(campaignId);

  const bookmarked = isBookmarked(campaignId);

  const milestoneCalls = useMemo(() => {
    if (!campaignId || milestonesCount === 0) return [];
    return Array.from({ length: milestonesCount }, (_, i) => ([
      {
        address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI,
        functionName: "hasVotedOnMilestone", args: [campaignId, i, address || ethers.constants.AddressZero],
      },
      {
        address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI,
        functionName: "milestoneApproved", args: [campaignId, i],
      },
    ])).flat();
  }, [campaignId, address, milestonesCount]);

  const { data: milestoneData, refetch: refetchMilestoneReads } = useContractReads({
    contracts: milestoneCalls,
    enabled: milestoneCalls.length > 0,
  });

  const { voteStatuses, approvedStatuses } = useMemo(() => {
    const votes = [];
    const approved = [];
    (milestoneData || []).forEach((result, i) => {
      const value = result?.status === "success" ? result.result : false;
      if (i % 2 === 0) votes[i / 2] = Boolean(value);
      else approved[(i - 1) / 2] = Boolean(value);
    });
    return { voteStatuses: votes, approvedStatuses: approved };
  }, [milestoneData]);

  const { data: contributions, isLoading: loadingContributions } = useContractRead({
    address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI,
    functionName: "getCampaignContributions", args: [campaignId],
    enabled: Boolean(campaignId && CONTRACT_ADDRESS),
  });

  // Fetch metadata
  useEffect(() => {
    if (!campaign?.metadataHash) return;
    let cancelled = false;
    getFromIPFS(campaign.metadataHash).then((res) => {
      if (!cancelled && res.success) setMetadata(res.data);
    });
    return () => { cancelled = true; };
  }, [campaign?.metadataHash]);

  // Fetch creator profile
  useEffect(() => {
    if (!campaign?.creator) { setCreatorProfile(null); return; }
    const addr = campaign.creator.toString?.()?.toLowerCase();
    if (!addr) return;
    const controller = new AbortController();
    fetch(`/api/wallet-link?walletAddresses=${encodeURIComponent(addr)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.walletProfiles) && data.walletProfiles.length > 0) setCreatorProfile(data.walletProfiles[0]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [campaign?.creator]);

  // Planned share of the escrowed donor funds per milestone. The last milestone
  // absorbs the rounding remainder so the shares always add up to 100%.
  const plannedShares = useMemo(() => {
    const raised = toBig(campaign?.raisedAmount);
    const first = raised.mul(MILESTONE_SCHEDULE[0].percent).div(100);
    const second = raised.mul(MILESTONE_SCHEDULE[1].percent).div(100);
    return [first, second, raised.sub(first).sub(second)];
  }, [campaign?.raisedAmount]);

  if (campaignLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 space-y-4">
        <div className="skeleton h-64 sm:h-80" />
        <div className="skeleton h-6 w-2/3" />
        <div className="skeleton h-4 w-1/2" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>Campaign Not Found</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          The campaign doesn&apos;t exist or has been removed.
        </p>
        <button onClick={() => router.push("/home")} className="btn btn-secondary mt-4">
          Browse Campaigns
        </button>
      </div>
    );
  }

  const progress = calculateProgress(campaign.raisedAmount, campaign.targetAmount);
  const timeLeft = calculateTimeLeft(campaign.deadline);
  const raised = parseFloat(formatEther(campaign.raisedAmount)).toFixed(2);
  const target = parseFloat(formatEther(campaign.targetAmount)).toFixed(2);
  const currentUserName = user?.fullName || user?.firstName || "";
  const creatorName = getCreatorDisplayName(campaign.creator, metadata?.creator, creatorProfile, address, currentUserName);
  const isCreator = address?.toLowerCase() === campaign.creator?.toLowerCase();
  const isSuccessful = parseFloat(raised) >= parseFloat(target);
  const fundingClosed = timeLeft.expired;
  const canRefund = !isCreator && fundingClosed && !isSuccessful && userContribution > 0;
  const canForfeitStake = fundingClosed && !isSuccessful && !campaign.stakeForfeited && !campaign.stakeReturned;
  const stakeHeld = toBig(accounting?.creatorStakeHeld ?? campaign.creatorStake);

  // Only the next milestone in order can receive evidence / votes / a release.
  const nextMilestoneIndex = useMemo(() => {
    if (!milestones?.length) return 0;
    const index = milestones.findIndex((m) => !m.fundsReleased);
    return index === -1 ? null : index;
  }, [milestones]);

  const handleContribute = async () => {
    if (!contributionAmount || parseFloat(contributionAmount) <= 0) { toast.error("Enter a valid amount"); return; }
    try {
      await contribute?.({ args: [campaignId], value: ethers.utils.parseEther(contributionAmount) });
      setContributionAmount("");
    } catch (err) { console.error(err); }
  };

  const handleSubmitEvidence = async (index) => {
    if (!evidenceFile && !evidenceNote.trim()) {
      toast.error("Attach a file or describe the completed work");
      return;
    }
    setBusyMilestone(index);
    try {
      let fileHash = null;
      if (evidenceFile) {
        toast.loading("Uploading evidence...", { id: "evidence" });
        const uploaded = await uploadToIPFS(evidenceFile);
        if (!uploaded.success) throw new Error(uploaded.error);
        fileHash = uploaded.hash;
      }

      toast.loading("Pinning evidence metadata...", { id: "evidence" });
      const bundle = await uploadJSONToIPFS({
        type: "milestone-evidence",
        campaignId: Number(campaignId),
        milestone: index + 1,
        milestoneTitle: milestones?.[index]?.title || `Milestone ${index + 1}`,
        note: evidenceNote.trim(),
        file: fileHash ? `https://gateway.pinata.cloud/ipfs/${fileHash}` : null,
        fileHash,
        submittedBy: address,
        submittedAt: new Date().toISOString(),
      });
      if (!bundle.success) throw new Error(bundle.error);
      toast.dismiss("evidence");

      await submitMilestoneEvidence?.({ args: [campaignId, index, bundle.hash] });
      setEvidenceFile(null);
      setEvidenceNote("");
      refetchMilestones?.();
      refetchMilestoneReads?.();
    } catch (err) {
      toast.dismiss("evidence");
      toast.error(err?.message?.includes("rejected") ? "Transaction rejected" : err?.message || "Failed to submit evidence");
    } finally {
      setBusyMilestone(null);
    }
  };

  const handleVote = async (index, approve) => {
    try {
      await voteOnMilestone?.({ args: [campaignId, index, approve] });
      refetchMilestones?.();
      refetchMilestoneReads?.();
    } catch (err) { console.error(err); }
  };

  const handleRelease = async (index) => {
    try {
      await releaseMilestoneFunds?.({ args: [campaignId, index] });
      refetchMilestones?.();
      refetchMilestoneReads?.();
      refetchAccounting?.();
    } catch (err) { console.error(err); }
  };

  const handleForfeitStake = async () => {
    try {
      await forfeitCreatorStake?.({ args: [campaignId] });
      refetchAccounting?.();
    } catch (err) { console.error(err); }
  };

  const handleShare = async () => {
    const ok = await copyToClipboard(window.location.href);
    toast.success(ok ? "Link copied!" : "Failed to copy");
  };

  const handleBookmark = () => {
    toggle(campaignId);
    toast.success(bookmarked ? "Removed from saved" : "Saved to bookmarks");
  };

  // Process contributions
  const processed = contributions && !loadingContributions
    ? contributions.map((c) => ({ contributor: c.contributor, amount: c.amount, timestamp: c.timestamp ? Number(c.timestamp.toString()) : null }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    : [];

  const contributorMap = {};
  processed.forEach((c) => {
    if (!contributorMap[c.contributor]) contributorMap[c.contributor] = { address: c.contributor, total: 0n, count: 0 };
    contributorMap[c.contributor].total += BigInt(c.amount.toString());
    contributorMap[c.contributor].count += 1;
  });
  const uniqueContributors = Object.values(contributorMap).sort((a, b) => Number(b.total - a.total));

  const QUICK_AMOUNTS = ["0.01", "0.05", "0.1", "0.5", "1"];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Hero image */}
      <div className="card overflow-hidden">
        <div className="relative h-56 sm:h-72">
          {metadata?.image ? (
            <img src={metadata.image} alt={campaign.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--color-surface-raised)" }}>
              <span className="text-5xl font-bold" style={{ color: "var(--color-text-muted)" }}>{campaign.title?.charAt(0) || "C"}</span>
            </div>
          )}
          <div className="absolute top-3 left-3 flex gap-2">
            <span className={`badge ${campaign.active ? "badge-success" : "badge-error"}`}>
              {campaign.active ? "Active" : campaign.completed ? "Completed" : "Ended"}
            </span>
            {isSuccessful && <span className="badge badge-warning">Funded</span>}
          </div>
          <div className="absolute top-3 right-3 flex gap-1.5">
            <button onClick={handleBookmark}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                bookmarked ? "bg-indigo-600 text-white" : "bg-black/40 text-white hover:bg-black/60"}`}>
              <FiBookmark className="w-4 h-4" fill={bookmarked ? "currentColor" : "none"} />
            </button>
            <button onClick={handleShare}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-black/40 text-white hover:bg-black/60 transition-colors">
              <FiShare2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: "var(--color-text)" }}>{campaign.title}</h1>

          <div className="mt-2 flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <span className="flex items-center gap-1"><FiUser className="w-3.5 h-3.5" /> {creatorName}</span>
            {isCreator && <span className="badge badge-neutral">(You)</span>}
            {stakeHeld.gt(0) && (
              <span className="flex items-center gap-1" title="Creator stake locked in the smart contract">
                <FiShield className="w-3.5 h-3.5" /> {formatEther(stakeHeld)} ETH stake locked
              </span>
            )}
          </div>

          <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{campaign.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="card">
            <div className="border-b flex gap-1 px-1 overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab
                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                      : "border-transparent hover:border-slate-300"
                  }`}
                  style={activeTab === tab ? undefined : { color: "var(--color-text-muted)" }}
                >
                  {tab}
                  {tab === "Contributors" && uniqueContributors.length > 0 && (
                    <span className="ml-1.5 text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
                      {uniqueContributors.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-5">
              {/* Overview tab */}
              {activeTab === "Overview" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <FiCalendar className="w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
                      <span style={{ color: "var(--color-text-muted)" }}>Created:</span>
                      <span style={{ color: "var(--color-text)" }}>{formatDate(campaign.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FiClock className="w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
                      <span style={{ color: "var(--color-text-muted)" }}>Deadline:</span>
                      <span style={{ color: "var(--color-text)" }}>{formatDate(campaign.deadline)}</span>
                    </div>
                    {metadata?.category && (
                      <div className="flex items-center gap-2">
                        <FiTarget className="w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
                        <span style={{ color: "var(--color-text-muted)" }}>Category:</span>
                        <span style={{ color: "var(--color-text)" }}>{metadata.category}</span>
                      </div>
                    )}
                  </div>
                  {metadata?.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {metadata.tags.map((tag, i) => (
                        <span key={i} className="badge badge-neutral">{tag}</span>
                      ))}
                    </div>
                  )}
                  {metadata?.additionalInfo && (
                    <div>
                      <h4 className="font-semibold text-sm mb-1" style={{ color: "var(--color-text)" }}>Additional Info</h4>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{metadata.additionalInfo}</p>
                    </div>
                  )}

                  {/* How the money moves */}
                  <div className="p-4 rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}>
                    <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>How the funds move</h4>
                    <ul className="text-xs space-y-1.5" style={{ color: "var(--color-text-secondary)" }}>
                      <li>1. The creator locked a stake of {formatEther(campaign.creatorStake || 0)} ETH — refunded only on completion.</li>
                      <li>2. Donations stay in the smart contract; nothing is released up front.</li>
                      <li>3. Each milestone unlocks 30% / 30% / 40% of the donated funds, in order, after donors approve the submitted evidence.</li>
                      <li>4. If the target is missed, donors refund their contribution and the creator stake is forfeited.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Milestones tab */}
              {activeTab === "Milestones" && (
                <div className="space-y-4">
                  <div className="flex items-start gap-2 text-xs p-3 rounded-lg" style={{ background: "var(--color-surface-raised)", color: "var(--color-text-muted)" }}>
                    <FiShield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      Funds are released strictly in order. The creator submits evidence for the next
                      milestone, donors vote with voting power equal to their contribution, and the share is
                      released only when a majority of the participating voting power approves with at least
                      {" "}{VOTE_QUORUM_PERCENT}% participation.
                    </span>
                  </div>

                  {loadingMilestones ? (
                    <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>
                  ) : milestones?.length > 0 ? (
                    milestones.map((m, i) => {
                      const scheduled = MILESTONE_SCHEDULE[i] || { percent: m.percentage };
                      const share = plannedShares[i] || ethers.BigNumber.from(0);
                      const released = m.fundsReleased;
                      const approved = approvedStatuses[i];
                      const isNext = nextMilestoneIndex === i;
                      const castWeight = toBig(m.approvalWeight).add(toBig(m.rejectionWeight));
                      const quorumTarget = toBig(m.totalVotingPower).mul(VOTE_QUORUM_PERCENT).div(100);
                      const canVote = !isCreator && isConnected && userContribution > 0 && m.evidenceSubmitted && !released && !voteStatuses[i];
                      const canSubmitEvidence = isCreator && fundingClosed && isSuccessful && isNext && !m.evidenceSubmitted;

                      return (
                        <div key={i} className="card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
                                {m.title}
                                {scheduled?.percent ? (
                                  <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
                                    {scheduled.percent}% · {formatEther(released ? m.amount : share)} ETH
                                  </span>
                                ) : null}
                              </h4>
                              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>{m.description}</p>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <span className={`badge ${released ? "badge-success" : m.evidenceSubmitted ? "badge-warning" : "badge-neutral"}`}>
                                {released ? "Released" : m.evidenceSubmitted ? (approved ? "Approved" : "Voting") : "Locked"}
                              </span>
                            </div>
                          </div>

                          {/* Evidence */}
                          {m.evidenceSubmitted ? (
                            <div className="mt-3 flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                              <div className="flex items-center gap-2">
                                <FiCheckCircle className="w-3.5 h-3.5" style={{ color: "var(--color-success)" }} />
                                <span>
                                  Evidence submitted
                                  {m.evidenceSubmittedAt ? ` on ${formatDate(m.evidenceSubmittedAt)}` : ""}
                                </span>
                                {m.evidenceCID ? (
                                  <a
                                    href={`https://gateway.pinata.cloud/ipfs/${m.evidenceCID}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1 text-indigo-500 hover:underline"
                                  >
                                    <FiExternalLink className="w-3 h-3" /> View evidence
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          ) : isNext ? (
                            <p className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                              {fundingClosed
                                ? isSuccessful
                                  ? "Waiting for the creator to submit evidence."
                                  : "Campaign did not reach its target — no funds will be released."
                                : "Evidence can be submitted after the funding deadline."}
                            </p>
                          ) : (
                            <p className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                              Unlocks after the previous milestone is released.
                            </p>
                          )}

                          {/* Vote tallies */}
                          {m.evidenceSubmitted && (
                            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
                              <span>{m.approvals} approve ({formatEther(toBig(m.approvalWeight))} ETH)</span>
                              <span>{m.rejections} reject ({formatEther(toBig(m.rejectionWeight))} ETH)</span>
                              <span>
                                Participation {formatEther(castWeight)} / {formatEther(quorumTarget)} ETH needed
                              </span>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {canSubmitEvidence && (
                              <div className="w-full space-y-2">
                                <div className="grid gap-2">
                                  <input
                                    type="file"
                                    onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                                    className="text-xs"
                                    style={{ color: "var(--color-text-secondary)" }}
                                  />
                                  <textarea
                                    rows={2}
                                    value={evidenceNote}
                                    onChange={(e) => setEvidenceNote(e.target.value)}
                                    placeholder="Describe the completed work (photos, invoices, links go to IPFS)"
                                    className="input resize-none text-xs"
                                  />
                                </div>
                                <button
                                  onClick={() => handleSubmitEvidence(i)}
                                  disabled={submittingEvidence && busyMilestone === i}
                                  className="btn btn-sm"
                                >
                                  <FiUpload className="w-3.5 h-3.5" />
                                  {submittingEvidence && busyMilestone === i ? "Submitting..." : "Submit evidence & open vote"}
                                </button>
                              </div>
                            )}

                            {canVote && (
                              <>
                                <button onClick={() => handleVote(i, true)} disabled={voting} className="btn btn-sm" style={{ background: "var(--color-success)", color: "#fff" }}>
                                  Approve
                                </button>
                                <button onClick={() => handleVote(i, false)} disabled={voting} className="btn btn-sm btn-danger">
                                  Reject
                                </button>
                                <span className="text-xs self-center" style={{ color: "var(--color-text-muted)" }}>
                                  Your voting power: {formatEther(userContribution)} ETH
                                </span>
                              </>
                            )}

                            {!isCreator && userContribution > 0 && voteStatuses[i] && !released && (
                              <span className="text-xs font-medium self-center" style={{ color: "var(--color-success)" }}>You voted</span>
                            )}

                            {!isCreator && isConnected && userContribution <= 0 && m.evidenceSubmitted && !released && (
                              <span className="text-xs self-center" style={{ color: "var(--color-text-muted)" }}>
                                Only contributors can vote on this milestone.
                              </span>
                            )}

                            {approved && !released && (
                              <button onClick={() => handleRelease(i)} disabled={releasing} className="btn btn-sm">
                                <FiUnlock className="w-3.5 h-3.5" />
                                {releasing ? "Releasing..." : `Release ${scheduled?.percent || m.percentage}%`}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>No milestones yet</p>
                  )}
                </div>
              )}

              {/* Contributors tab */}
              {activeTab === "Contributors" && (
                <div>
                  {loadingContributions ? (
                    <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>
                  ) : uniqueContributors.length > 0 ? (
                    <div className="space-y-2">
                      {uniqueContributors.map((c, i) => (
                        <div key={c.address} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "var(--color-accent)" }}>
                              #{i + 1}
                            </div>
                            <div>
                              <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                                {formatAddress(c.address)}
                                {c.address.toLowerCase() === address?.toLowerCase() && <span className="ml-1 text-xs" style={{ color: "var(--color-accent)" }}>(You)</span>}
                              </p>
                              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{c.count} contribution{c.count !== 1 ? "s" : ""}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{formatEther(c.total)} ETH</p>
                            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{((Number(formatEther(c.total)) / parseFloat(raised || 1)) * 100).toFixed(1)}% voting power</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <FiUsers className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--color-text-muted)" }} />
                      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No contributors yet. Be the first!</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          {/* Progress card */}
          <div className="card p-5">
            <div className="flex items-center justify-between text-sm mb-2">
              <span style={{ color: "var(--color-text-secondary)" }}>Progress</span>
              <span className="font-medium" style={{ color: "var(--color-accent)" }}>{progress.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-surface-raised)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%`, background: "var(--color-accent)" }} />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{raised}</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>ETH Raised</p>
              </div>
              <div>
                <p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{target}</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>ETH Target</p>
              </div>
              <div>
                <p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{uniqueContributors.length}</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Contributors</p>
              </div>
              <div>
                <p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{timeLeft.expired ? "—" : timeLeft.text}</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{timeLeft.expired ? "Expired" : "Left"}</p>
              </div>
            </div>

            {/* User's contribution */}
            {userContribution > 0 && (
              <div className="mt-4 p-3 rounded-lg text-sm" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}>
                Your contribution: <span className="font-semibold">{formatEther(userContribution)} ETH</span>
              </div>
            )}
          </div>

          {/* Escrow + stake card */}
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-text)" }}>
              <FiLock className="w-4 h-4" /> Escrow &amp; creator stake
            </h3>
            {[
              { label: "Donor funds raised", value: formatEther(toBig(accounting?.donorFundsRaised ?? campaign.raisedAmount)) },
              { label: "Still locked in escrow", value: formatEther(toBig(accounting?.lockedDonorFunds ?? campaign.raisedAmount)) },
              { label: "Released to creator", value: formatEther(toBig(accounting?.releasedAmountTotal)) },
              { label: "Creator stake held", value: formatEther(stakeHeld) },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--color-text-muted)" }}>{row.label}</span>
                <span className="font-semibold" style={{ color: "var(--color-text)" }}>{row.value} ETH</span>
              </div>
            ))}
            <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {campaign.stakeReturned
                ? "The campaign completed and the creator stake was returned."
                : campaign.stakeForfeited
                  ? "The campaign missed its target — the creator stake was forfeited."
                  : "The stake is returned only when the campaign completes all milestones."}
            </p>
          </div>

          {/* Action card */}
          <div className="card p-5 space-y-3">
            {!timeLeft.expired && campaign.active && !isCreator && isConnected && (
              <>
                <div className="flex gap-1.5 flex-wrap">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button key={amt} onClick={() => setContributionAmount(amt)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        contributionAmount === amt
                          ? "bg-indigo-600 text-white"
                          : "border hover:bg-slate-50 dark:hover:bg-slate-700/30"
                      }`}
                      style={contributionAmount === amt ? undefined : { borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                      {amt} ETH
                    </button>
                  ))}
                </div>
                <input
                  type="number" step="0.01" min="0.01" placeholder="Amount (ETH)"
                  value={contributionAmount}
                  onChange={(e) => setContributionAmount(e.target.value)}
                  className="input"
                />
                <button onClick={handleContribute} disabled={contributing || !contributionAmount} className="btn w-full">
                  {contributing ? "Contributing..." : "Contribute Now"}
                </button>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  Your donation stays in the smart contract until donors approve each milestone.
                </p>
              </>
            )}

            {campaign.completed && (
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-success)" }}>
                <FiCheckCircle className="w-3.5 h-3.5" />
                <span>Campaign completed — all milestones released and the creator stake returned.</span>
              </div>
            )}

            {canRefund && (
              <button onClick={async () => { await getRefund?.({ args: [campaignId] }); }} disabled={refunding} className="btn btn-danger w-full">
                {refunding ? "Processing..." : "Get Refund"}
              </button>
            )}

            {canForfeitStake && (
              <button onClick={handleForfeitStake} disabled={forfeiting} className="btn btn-secondary w-full">
                <FiAlertTriangle className="w-3.5 h-3.5" />
                {forfeiting ? "Processing..." : "Forfeit creator stake"}
              </button>
            )}

            {!isConnected && (
              <p className="text-sm text-center py-2" style={{ color: "var(--color-text-muted)" }}>Connect wallet to contribute</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

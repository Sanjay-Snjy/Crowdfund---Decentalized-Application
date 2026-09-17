import { useAccount, useContractReads } from "wagmi";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import Layout from "../components/Layout/Layout";
import DashboardStats from "../components/Dashboard/DashboardStats";
import FundingProgress from "../components/Dashboard/FundingProgress";

import NotificationCenter from "../components/Dashboard/NotificationCenter";
import DeadlineCountdown from "../components/Dashboard/DeadlineCountdown";

import MilestoneTracker from "../components/Dashboard/MilestoneTracker";

import CreatorStakeStatus from "../components/Dashboard/CreatorStakeStatus";
import BookmarkedCampaigns from "../components/Dashboard/BookmarkedCampaigns";
import { useContract } from "../hooks/useContract";
import { CONTRACT_ADDRESS } from "../constants";
import { CROWDFUNDING_ABI } from "../constants/abi";

import { formatDate, formatEther } from "../utils/helpers";
import Link from "next/link";
import {
  useDemoMode,
  DEMO_USERNAME,
  DEMO_ADDRESS,
  DEMO_CAMPAIGNS,
  DEMO_CONTRIBUTIONS,
  DEMO_CONTRIBUTION_MAP,
  DEMO_TRANSACTION_FEED,
  DEMO_MILESTONES,
} from "../lib/demoMode";

function Dashboard() {
  const { address, isConnected } = useAccount();
  const { user } = useUser();
  const router = useRouter();
  const demoMode = useDemoMode();
  const { useActiveCampaigns, useUserCampaignsWithDetails, useUserContributions } = useContract();

  const currentUserName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "";

  const { data: activeCampaigns, refetch: refetchActive } = useActiveCampaigns(0, 100);
  const { campaigns: userCampaigns, isLoading: loadingUserCampaigns, campaignIds: userCampaignIds } = useUserCampaignsWithDetails(address);
  const { data: userContributions } = useUserContributions(address);

  // Transaction feed
  const [transactionFeed, setTransactionFeed] = useState([]);
  const transactionCalls = useMemo(() => {
    if (!userContributions?.length || !address) return [];
    return userContributions.flatMap((id) => {
      const num = typeof id === "bigint" ? Number(id) : Number(id.toString());
      return [
        { address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "getCampaign", args: [num] },
        { address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "getCampaignContributions", args: [num] },
      ];
    });
  }, [userContributions, address]);

  const { data: txData, isLoading: loadingTx } = useContractReads({ contracts: transactionCalls, enabled: transactionCalls.length > 0 });

  useEffect(() => {
    if (!txData || !userContributions?.length || !address) { setTransactionFeed([]); return; }
    const norm = address.toLowerCase();
    const feed = [];
    for (let i = 0; i < txData.length; i += 2) {
      const camp = txData[i]; const contribs = txData[i + 1];
      if (camp?.status === "success" && contribs?.status === "success") {
        contribs.result?.forEach((e) => {
          if (e?.contributor?.toString?.()?.toLowerCase() === norm) {
            feed.push({ campaignId: Number(camp.result.id?.toString?.()), campaignTitle: camp.result.title, action: "Contribution", amount: e.amount, timestamp: Number(e.timestamp?.toString?.() || 0) });
          }
        });
      }
    }
    setTransactionFeed(feed.sort((a, b) => b.timestamp - a.timestamp).slice(0, 6));
  }, [txData, userContributions, address]);

  const liveActive = useMemo(() => (activeCampaigns || []).filter((c) => c?.active && Number(c.deadline?.toString?.() || 0) * 1000 > Date.now()), [activeCampaigns]);

  const refreshData = useCallback(() => {
    refetchActive?.();
  }, [refetchActive]);

  if (!isConnected && !demoMode) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <div className="card p-8 text-center max-w-sm">
            <h2 className="text-lg font-bold mb-2" style={{ color: "var(--color-text)" }}>Connect Your Wallet</h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Connect your wallet to access your dashboard.</p>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Demo mode: render with fake values ──────────────────────────────────────
  if (demoMode) {
    const demoAddr = DEMO_ADDRESS;
    return (
      <Layout>
        <div className="max-w-8xl mx-auto pl-4 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>Dashboard</h1>
              <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
                Welcome back, {DEMO_USERNAME}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/create-campaign" className="btn btn-sm rounded-3xl px-4">New Campaign</Link>
              <Link href="/home" className="btn btn-secondary btn-sm rounded-3xl px-4">Browse</Link>
            </div>
          </div>

          {/* Stats grid (demo) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Created", value: DEMO_CAMPAIGNS.length },
              { label: "Contributions", value: DEMO_CONTRIBUTIONS.length },
              { label: "Active Campaigns", value: DEMO_CAMPAIGNS.filter((c) => c.active).length },
            ].map((s) => (
              <div key={s.label} className="card p-4 rounded-2xl">
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{s.label}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: "var(--color-text)" }}>{s.value}</p>
              </div>
            ))}
            <div className="card p-4 rounded-2xl">
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Connected</p>
              <p className="text-sm font-medium mt-1" style={{ color: "var(--color-success)" }}>{demoAddr.slice(0, 6)}...{demoAddr.slice(-4)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent transactions (demo) */}
            <div className="lg:col-span-2 card p-5 rounded-2xl">
              <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>Recent Transactions</h3>
              <div className="space-y-2">
                {DEMO_TRANSACTION_FEED.map((tx, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--color-surface-raised, var(--color-surface))" }}>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{tx.action} → {tx.campaignTitle}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{formatDate(tx.timestamp)}</p>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{formatEther(tx.amount)} ETH</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Your campaigns (demo) */}
            <div className="card p-5 rounded-2xl">
              <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>Your Campaigns</h3>
              <div className="space-y-3">
                {DEMO_CAMPAIGNS.map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Link href={`/campaign/${c.id}`} className="text-xs font-medium truncate max-w-[70%] hover:underline" style={{ color: "var(--color-text)" }}>
                        {c.title || `Campaign #${c.id}`}
                      </Link>
                      {c.active && <DeadlineCountdown deadline={c.deadline} />}
                    </div>
                    <FundingProgress campaign={c} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Milestone Progress (demo) */}
          <div className="card p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>
              Milestone Progress
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {DEMO_CAMPAIGNS.map((c, idx) => (
                <div key={c.id} className="p-3 rounded-xl" style={{ background: "var(--color-surface)" }}>
                  <Link href={`/campaign/${c.id}`} className="text-xs font-medium block truncate mb-2 hover:underline" style={{ color: "var(--color-text)" }}>
                    {c.title || `Campaign #${c.id}`}
                  </Link>
                  {/* Render demo milestones inline */}
                  <div className="space-y-1.5">
                    {DEMO_MILESTONES[idx]?.map((m, mi) => (
                      <div key={mi} className="flex items-center justify-between text-xs">
                        <span style={{ color: "var(--color-text-muted)" }}>{m.title}</span>
                        <span className="font-medium" style={{ color: m.fundsReleased ? "var(--color-success)" : "var(--color-accent)" }}>
                          {m.fundsReleased ? "Released" : m.completed ? "Pending" : "Locked"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Platform Statistics (demo) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="card p-5 rounded-2xl">
                <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>Platform Statistics</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { title: "Total Campaigns", value: "12" },
                    { title: "Total Raised", value: "47.50 ETH" },
                    { title: "Active Campaigns", value: "5" },
                    { title: "Contributors", value: "144" },
                    { title: "Successful", value: "3" },
                    { title: "Platform Treasury", value: "0.9500 ETH" },
                  ].map((s, i) => (
                    <div key={i} className="p-4 rounded-xl" style={{ background: "var(--color-surface)" }}>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{s.title}</p>
                      <p className="text-lg font-bold mt-1" style={{ color: "var(--color-text)" }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="card p-5 rounded-2xl">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Saved Campaigns</span>
              </div>
              <div className="flex flex-col items-center justify-center py-6">
                <p className="text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                  No saved campaigns yet
                </p>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-8xl mx-auto pl-4  py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>Dashboard</h1>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              {currentUserName ? `Welcome back, ${currentUserName}` : "Your crowdfunding overview"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Feature #8: Notification Center */}
            <NotificationCenter
              userCampaigns={userCampaigns}
              userContributions={userContributions}
              transactionFeed={transactionFeed}
            />
            <Link href="/create-campaign" className="btn btn-sm rounded-3xl px-4">New Campaign</Link>
            <Link href="/home" className="btn btn-secondary btn-sm rounded-3xl px-4">Browse</Link>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Created", value: userCampaigns?.length || 0 },
            { label: "Contributions", value: userContributions?.length || 0 },
            { label: "Active Campaigns", value: liveActive.length },
          ].map((s) => (
            <div key={s.label} className="card p-4 rounded-2xl">
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{s.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: "var(--color-text)" }}>{s.value}</p>
            </div>
          ))}
          <div className="card p-4 rounded-2xl">
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Connected</p>
            <p className="text-sm font-medium mt-1" style={{ color: "var(--color-success)" }}>{address?.slice(0, 6)}...{address?.slice(-4)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent transactions */}
          <div className="lg:col-span-2 card p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>Recent Transactions</h3>
            {loadingTx ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>
            ) : transactionFeed.length > 0 ? (
              <div className="space-y-2">
                {transactionFeed.map((tx, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--color-surface-raised, var(--color-surface))" }}>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{tx.action} → {tx.campaignTitle}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{formatDate(tx.timestamp)}</p>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{formatEther(tx.amount)} ETH</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-center py-6" style={{ color: "var(--color-text-muted)" }}>No transactions yet</p>
            )}
          </div>

          {/* Created campaigns with progress bars and countdown */}
          <div className="card p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>Your Campaigns</h3>
            {loadingUserCampaigns ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>
            ) : userCampaigns?.length > 0 ? (
              <div className="space-y-3">
                {userCampaigns.slice(0, 4).map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Link href={`/campaign/${c.id}`} className="text-xs font-medium truncate max-w-[70%] hover:underline" style={{ color: "var(--color-text)" }}>
                        {c.title || `Campaign #${c.id}`}
                      </Link>
                      {/* Feature #10: Deadline Countdown */}
                      {c.active && <DeadlineCountdown deadline={c.deadline} />}
                    </div>
                    {/* Feature #1: Funding Progress Bars */}
                    <FundingProgress campaign={c} />
                    {/* Creator stake status (returned / forfeited / locked) */}
                    <CreatorStakeStatus campaign={c} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No campaigns yet</p>
                <Link href="/create-campaign" className="btn btn-sm mt-2">Create One</Link>
              </div>
            )}
          </div>
        </div>

        {/* Feature #14: Milestone Progress Tracker */}
        {userCampaigns?.length > 0 && (
          <div className="card p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>
              Milestone Progress
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {userCampaigns.slice(0, 6).map((c) => (
                <div key={c.id} className="p-3 rounded-xl" style={{ background: "var(--color-surface)" }}>
                  <Link href={`/campaign/${c.id}`} className="text-xs font-medium block truncate mb-2 hover:underline" style={{ color: "var(--color-text)" }}>
                    {c.title || `Campaign #${c.id}`}
                  </Link>
                  <MilestoneTracker campaignId={c.id} campaign={c} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feature #18: Bookmarked Campaigns + Platform Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="card p-5 rounded-2xl">
              <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>Platform Statistics</h3>
              <DashboardStats />
            </div>
          </div>
          <BookmarkedCampaigns />
        </div>
      </div>
    </Layout>
  );
}

export default Dashboard;

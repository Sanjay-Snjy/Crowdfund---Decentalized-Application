import { useAccount, useContractReads } from "wagmi";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { apiGet, buildQuery } from "../utils/apiClient";
import Layout from "../components/Layout/Layout";
import DashboardStats from "../components/Dashboard/DashboardStats";
import FundingProgress from "../components/Dashboard/FundingProgress";

import NotificationCenter from "../components/Dashboard/NotificationCenter";
import DeadlineCountdown from "../components/Dashboard/DeadlineCountdown";

import MilestoneTracker from "../components/Dashboard/MilestoneTracker";

import BookmarkedCampaigns from "../components/Dashboard/BookmarkedCampaigns";
import IdentityPanel from "../components/Profile/IdentityPanel";
import RecentDonations from "../components/Donations/RecentDonations";
import MyDonations from "../components/Donations/MyDonations";
import { useContract } from "../hooks/useContract";
import { CONTRACT_ADDRESS } from "../constants";
import { CROWDFUNDING_ABI } from "../constants/abi";

import { formatDate, formatEther } from "../utils/helpers";
import { MATCHED_CARD, MATCHED_CARD_BODY, MATCHED_WIDE_CARD, Pager, usePagedList } from "../components/Common/PagedList";
import { FiArrowUpRight, FiExternalLink } from "react-icons/fi";
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
  const { useUserCampaignsWithDetails, useUserContributions } = useContract();

  const currentUserName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "";

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

  const { data: txData } = useContractReads({ contracts: transactionCalls, enabled: transactionCalls.length > 0 });

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
    // Every contribution is kept: the card pages through them four at a time.
    setTransactionFeed(feed.sort((a, b) => b.timestamp - a.timestamp));
  }, [txData, userContributions, address]);

  // TEMP-DEBUG-LAYOUT start
  const debugLayout = router.query?.layout === "1";
  const debugCampaigns = debugLayout
    ? Array.from({ length: 7 }, (_, index) => ({
        id: index + 1,
        title: `Debug campaign ${index + 1}`,
        active: true,
        deadline: Math.floor(Date.now() / 1000) + 86400,
        raisedAmount: `${(index + 1) * 100000000000000000}`,
        targetAmount: "5000000000000000000",
      }))
    : userCampaigns;
  const debugTransactions = debugLayout
    ? Array.from({ length: 9 }, (_, index) => ({
        campaignId: index + 1,
        campaignTitle: `Debug campaign ${index + 1}`,
        action: "Contribution",
        amount: `${(index + 1) * 10000000000000000}`,
        timestamp: Math.floor(Date.now() / 1000) - index * 3600,
        status: "confirmed",
        txHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
        explorerUrl: `https://sepolia.etherscan.io/tx/0x${(index + 1).toString(16).padStart(64, "0")}`,
      }))
    : transactionFeed;
  // TEMP-DEBUG-LAYOUT end

  // Recent Transactions are sourced from the verified indexer feed instead of raw
  // contract reads: only the indexed rows carry the transaction hash, so only they
  // can link each row to its Etherscan entry. Contract reads never expose hashes.
  const {
    data: myDonationsData,
    isLoading: loadingRecent,
    error: recentError,
  } = useQuery({
    queryKey: ["me", "donations", address || "account"],
    queryFn: () => apiGet(`/api/me/donations${buildQuery({ address })}`),
    enabled: (isConnected || debugLayout) && !demoMode,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  const recentTransactions = useMemo(() => {
    if (debugLayout) return debugTransactions;
    return (myDonationsData?.donations || [])
      .map((donation) => ({
        campaignId: donation.campaignId,
        campaignTitle: donation.campaignName || `Campaign #${donation.campaignId}`,
        action: "Contribution",
        amount: donation.amountWei,
        timestamp: Number(donation.timestamp) || 0,
        status: donation.status,
        txHash: donation.txHash,
        explorerUrl: donation.explorerUrl,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [debugLayout, debugTransactions, myDonationsData]);

  // Matched, fixed-height cards: their lists are paged instead of growing (or
  // scrolling) past the shared card height. Milestone Progress scrolls horizontally.
  const transactionPager = usePagedList(recentTransactions, 4);
  const campaignPager = usePagedList(debugCampaigns, 4);

  if (!isConnected && !demoMode && !debugLayout) {
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

        {/* First row: the account itself (CrowdFund User ID, name, wallet state), then
            what this wallet created and backed. The old "Active Campaigns" and
            "Connected" tiles are gone — the connected wallet lives on the identity card. */}
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <IdentityPanel />
          </div>
          {[
            {
              label: "Created",
              value: userCampaigns?.length || 0,
              href: "/my-campaigns",
              hint: "Open My Campaigns",
            },
            {
              label: "Contributions",
              value: userContributions?.length || 0,
              href: "/contributions",
              hint: "Open My Contributions",
            },
          ].map((tile) => (
            <Link
              key={tile.label}
              href={tile.href}
              className="card flex flex-col justify-center rounded-2xl p-4 transition-colors hover:border-[var(--color-accent)]"
              title={tile.hint}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{tile.label}</p>
                <FiArrowUpRight className="h-4 w-4" style={{ color: "var(--color-accent)" }} />
              </div>
              <p className="text-2xl font-bold mt-1" style={{ color: "var(--color-text)" }}>{tile.value}</p>
              <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>{tile.hint}</p>
            </Link>
          ))}
        </div>

        {/* Working area — Recent Transactions beside Your Campaigns, with Milestone
            Progress scrolling horizontally underneath. Rewards and badges live on
            their own page (/rewards), reachable from the header profile menu. */}
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
          {/* Recent transactions */}
          <div className={MATCHED_CARD}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Recent Transactions</h3>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>Your confirmed contributions on-chain</p>
              </div>
              <Pager pager={transactionPager} label="transactions" />
            </div>
            <div className={`mt-4 ${MATCHED_CARD_BODY}`}>
              {loadingRecent ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>
              ) : transactionPager.total > 0 ? (
                <div className="space-y-2">
                  {transactionPager.slice.map((tx, i) => (
                    <div key={`${tx.campaignId}-${tx.timestamp}-${i}`} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--color-surface-raised, var(--color-surface))" }}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" style={{ color: "var(--color-text)" }}>{tx.action} → {tx.campaignTitle}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                          {formatDate(tx.timestamp)}
                          {tx.status && tx.status !== "confirmed" ? ` · ${tx.status}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{formatEther(tx.amount)} ETH</p>
                        {tx.explorerUrl && (
                          <a
                            href={tx.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                            title={`View transaction ${tx.txHash || ""} on Etherscan`}
                            aria-label="View transaction on Etherscan"
                          >
                            Tx <FiExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentError?.status === 401 || recentError?.status === 403 ? (
                <p className="text-sm text-center py-6" style={{ color: "var(--color-text-muted)" }}>
                  Sign in to see your transaction history.
                </p>
              ) : recentError ? (
                <p className="text-sm text-center py-6" style={{ color: "var(--color-text-muted)" }}>
                  Could not load transactions right now.
                </p>
              ) : (
                <p className="text-sm text-center py-6" style={{ color: "var(--color-text-muted)" }}>No transactions yet</p>
              )}
            </div>
          </div>

          {/* Created campaigns with progress bars and countdown */}
          <div className={MATCHED_CARD}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Your Campaigns</h3>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>Funding progress and deadlines</p>
              </div>
              <Pager pager={campaignPager} label="campaigns" />
            </div>
            <div className={`mt-4 ${MATCHED_CARD_BODY}`}>
            {loadingUserCampaigns ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>
            ) : debugCampaigns?.length > 0 ? (
              <div className="space-y-3">
                {campaignPager.slice.map((c) => (
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

          {/* Feature #14: Milestone Progress Tracker — full width, scrolled sideways
              so any number of campaigns fits the same card height. */}
          <div className={`${MATCHED_WIDE_CARD} lg:col-span-2`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Milestone Progress</h3>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  Evidence, votes and fund releases — scroll sideways to see every campaign
                </p>
              </div>
              <span className="badge badge-neutral shrink-0">{userCampaigns?.length || 0} campaign(s)</span>
            </div>
            {debugCampaigns?.length > 0 ? (
              <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2 pr-1">
                {debugCampaigns.map((c) => (
                  <div
                    key={c.id}
                    className="min-w-[18rem] shrink-0 rounded-xl p-3"
                    style={{ background: "var(--color-surface)" }}
                  >
                    <Link href={`/campaign/${c.id}`} className="text-xs font-medium block truncate mb-2 hover:underline" style={{ color: "var(--color-text)" }}>
                      {c.title || `Campaign #${c.id}`}
                    </Link>
                    <MilestoneTracker campaignId={c.id} campaign={c} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No campaigns created yet</p>
                <Link href="/create-campaign" className="btn btn-sm mt-2">Create One</Link>
              </div>
            )}
          </div>
        </div>

        {/* Community donation activity + my verified donation history */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RecentDonations limit={6} title="Recent Community Donations" />
          <MyDonations />
        </div>

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

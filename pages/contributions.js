import { useAccount, useContractReads } from "wagmi";
import { useRouter } from "next/router";
import { useEffect, useState, useMemo } from "react";
import Layout from "../components/Layout/Layout";
import { useContract } from "../hooks/useContract";
import { FiHeart, FiDollarSign, FiTrendingUp, FiArrowRight } from "react-icons/fi";
import { formatEther } from "../utils/helpers";
import { CONTRACT_ADDRESS } from "../constants";
import { CROWDFUNDING_ABI } from "../constants/abi";
import Link from "next/link";
import { useDemoMode, DEMO_USERNAME } from "../lib/demoMode";

export default function ContributionsPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const { useUserContributions } = useContract();
  const [contributions, setContributions] = useState([]);

  const { data: ids, isLoading: loadingIds } = useUserContributions(address);

  const calls = useMemo(() => {
    if (!ids?.length || !address) return [];
    return ids.flatMap((id) => {
      const num = typeof id === "bigint" ? Number(id) : Number(id.toString());
      return [
        { address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "getCampaign", args: [num] },
        { address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "getContribution", args: [num, address] },
      ];
    });
  }, [ids, address]);

  const { data: contractData, isLoading: loadingData } = useContractReads({ contracts: calls, enabled: calls.length > 0 });
  const loading = loadingIds || loadingData;

  useEffect(() => {
    if (!contractData || !ids || !address) return;
    const result = [];
    for (let i = 0; i < contractData.length; i += 2) {
      const camp = contractData[i]; const amt = contractData[i + 1];
      if (camp?.status === "success" && amt?.status === "success" && amt.result > 0) {
        const c = camp.result;
        const safe = (v) => { if (!v) return 0n; return typeof v === "bigint" ? v : BigInt(v.toString()); };
        const safeNum = (v) => { if (!v) return 0; return typeof v === "bigint" ? Number(v) : Number(v.toString()); };
        result.push({ campaignId: safeNum(c.id), campaignTitle: c.title, campaignDescription: c.description, amount: safe(amt.result), targetAmount: safe(c.targetAmount), raisedAmount: safe(c.raisedAmount), deadline: safeNum(c.deadline), active: c.active });
      }
    }
    setContributions(result);
  }, [contractData, ids, address]);

  const demoMode = useDemoMode();

  useEffect(() => { if (!isConnected && !demoMode) router.push("/"); }, [isConnected, router, demoMode]);

  if (!isConnected && !demoMode) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="card p-8 text-center max-w-sm">
            <h2 className="text-lg font-bold mb-2" style={{ color: "var(--color-text)" }}>Connect Your Wallet</h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Connect to view your contributions.</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Demo mode: show empty state
  if (demoMode) {
    return (
      <Layout>
        <div className="max-w-8xl mx-auto pl-4 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>My Contributions</h1>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Track your support history</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 rounded-3xl"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}><FiDollarSign className="w-5 h-5" /></div><div><p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>0.8500</p><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>ETH Contributed</p></div></div></div>
            <div className="card p-4 rounded-3xl"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}><FiHeart className="w-5 h-5" /></div><div><p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>3</p><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Projects Supported</p></div></div></div>
            <div className="card p-4 rounded-3xl"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}><FiTrendingUp className="w-5 h-5" /></div><div><p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>0.2833</p><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Avg Contribution</p></div></div></div>
          </div>
          <div className="card p-12 text-center rounded-3xl">
            <FiHeart className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} />
            <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>This is a demo account</h3>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Connect a real wallet to view and manage your contributions.
            </p>
            <Link href="/home" className="btn btn-secondary mt-4">Browse Campaigns</Link>
          </div>
        </div>
      </Layout>
    );
  }

  const total = contributions.reduce((s, c) => s + parseFloat(formatEther(c.amount || 0)), 0);

  return (
    <Layout>
      <div className="max-w-8xl mx-auto pl-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>My Contributions</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Track your support history</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4 rounded-3xl"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}><FiDollarSign className="w-5 h-5" /></div><div><p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{total.toFixed(4)}</p><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>ETH Contributed</p></div></div></div>
          <div className="card p-4 rounded-3xl"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}><FiHeart className="w-5 h-5" /></div><div><p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{contributions.length}</p><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Projects Supported</p></div></div></div>
          <div className="card p-4 rounded-3xl"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}><FiTrendingUp className="w-5 h-5" /></div><div><p className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{contributions.length > 0 ? (total / contributions.length).toFixed(4) : "0"}</p><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Avg Contribution</p></div></div></div>
        </div>
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>
        ) : contributions.length > 0 ? (
          <div className="space-y-2">
            {contributions.map((c, i) => {
              const progress = (parseFloat(formatEther(c.raisedAmount)) / parseFloat(formatEther(c.targetAmount))) * 100;
              const isActive = c.active && new Date(c.deadline * 1000) > new Date();
              return (
                <div key={i} className="card p-4 rounded-3xl flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-10 h-10 rounded-3xl flex items-center justify-center shrink-0" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}><FiHeart className="w-4 h-4" /></div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>{c.campaignTitle}</h3>
                      <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--color-text-muted)" }}>{c.campaignDescription}</p>
                      <div className="flex gap-2 mt-1.5">
                        <span className={`badge ${isActive ? "badge-success" : "badge-neutral"}`}>{isActive ? "Active" : "Ended"}</span>
                        <span className="badge badge-neutral">{progress.toFixed(1)}% funded</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{formatEther(c.amount)} ETH</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Target: {formatEther(c.targetAmount)} ETH</p>
                    </div>
                    <Link href={`/campaign/${c.campaignId}`} className="btn btn-secondary btn-sm shrink-0">View <FiArrowRight className="w-3 h-3" /></Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card p-12 text-center rounded-3xl">
            <FiHeart className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} />
            <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>No contributions yet</h3>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Start backing campaigns you care about.</p>
            <Link href="/home" className="btn btn-secondary mt-4">Browse Campaigns</Link>
          </div>
        )}
      </div>
    </Layout>
  );
}

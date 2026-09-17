import { useAccount, useContractReads } from "wagmi";
import { useRouter } from "next/router";
import { useEffect, useState, useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import Layout from "../components/Layout/Layout";
import CampaignCard from "../components/Campaign/CampaignCard";
import { useContract } from "../hooks/useContract";
import { FiPlus, FiTarget } from "react-icons/fi";
import { formatEther, calculateProgress } from "../utils/helpers";
import { CONTRACT_ADDRESS } from "../constants";
import { CROWDFUNDING_ABI } from "../constants/abi";
import Link from "next/link";

export default function MyCampaignsPage() {
  const { address, isConnected } = useAccount();
  const { user } = useUser();
  const router = useRouter();
  const { useUserCampaigns } = useContract();
  const [campaigns, setCampaigns] = useState([]);
  const currentUserName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "";

  const { data: campaignIds, isLoading: loadingIds } = useUserCampaigns(address);

  const campaignContracts = useMemo(() => {
    if (!campaignIds?.length) return [];
    return campaignIds.map((id) => {
      const num = typeof id === "bigint" ? Number(id) : Number(id.toString());
      return { address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "getCampaign", args: [num] };
    });
  }, [campaignIds]);

  const { data: campaignsData, isLoading: loadingData } = useContractReads({ contracts: campaignContracts, enabled: campaignContracts.length > 0 });
  const loading = loadingIds || loadingData;

  useEffect(() => {
    if (!campaignsData || !campaignIds) return;
    const formatted = campaignsData
      .map((r, i) => {
        if (r.status !== "success" || !r.result) return null;
        const c = r.result;
        const safe = (v) => { if (!v) return 0n; if (typeof v === "bigint") return v; return BigInt(v.toString()); };
        const safeNum = (v) => { if (!v) return 0; if (typeof v === "bigint") return Number(v); return Number(v.toString()); };
        return { id: safeNum(c.id || campaignIds[i]), creator: c.creator, title: c.title, description: c.description, metadataHash: c.metadataHash, targetAmount: safe(c.targetAmount), raisedAmount: safe(c.raisedAmount), deadline: safeNum(c.deadline), completed: c.completed, active: c.active, createdAt: safeNum(c.createdAt), contributorsCount: safeNum(c.contributorsCount), creatorStake: safe(c.creatorStake), stakeReturned: c.stakeReturned, stakeForfeited: c.stakeForfeited, completedAt: safeNum(c.completedAt) };
      })
      .filter(Boolean);
    setCampaigns(formatted);
  }, [campaignsData, campaignIds]);

  useEffect(() => { if (!isConnected) router.push("/"); }, [isConnected, router]);

  if (!isConnected) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="card p-8 text-center max-w-sm">
            <h2 className="text-lg font-bold mb-2" style={{ color: "var(--color-text)" }}>Connect Your Wallet</h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Connect to view your campaigns.</p>
          </div>
        </div>
      </Layout>
    );
  }

  const totalRaised = campaigns.reduce((s, c) => s + parseFloat(formatEther(c.raisedAmount || 0)), 0);
  const successful = campaigns.filter((c) => calculateProgress(c.raisedAmount, c.targetAmount) >= 100).length;
  const active = campaigns.filter((c) => c.active && new Date(c.deadline * 1000) > new Date()).length;

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>My Campaigns</h1>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Manage and track your campaigns</p>
          </div>
          <Link href="/create-campaign" className="btn"><FiPlus className="w-4 h-4" /> Create</Link>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total", value: campaigns.length },
            { label: "Active", value: active },
            { label: "Successful", value: successful },
          ].map((s) => (
            <div key={s.label} className="card p-3 text-center">
              <p className="text-xl font-bold" style={{ color: "var(--color-text)" }}>{s.value}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{s.label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="card p-4 space-y-3"><div className="skeleton h-36" /><div className="skeleton h-4 w-3/4" /><div className="skeleton h-1.5" /></div>)}
          </div>
        ) : campaigns.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} currentUserAddress={address} currentUserName={currentUserName} />
            ))}
          </div>
        ) : (
          <div className="card p-12 text-center">
            <FiTarget className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} />
            <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>No campaigns yet</h3>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Create your first campaign to get started.</p>
            <Link href="/create-campaign" className="btn mt-4"><FiPlus className="w-4 h-4" /> Create Campaign</Link>
          </div>
        )}
      </div>
    </Layout>
  );
}

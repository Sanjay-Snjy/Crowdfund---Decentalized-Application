import { useContract } from "../../hooks/useContract";
import { formatEther, formatNumber } from "../../utils/helpers";
import { StatsCard } from "./StatsCard";
import { FiDollarSign, FiTrendingUp, FiUsers, FiTarget, FiActivity, FiAward } from "react-icons/fi";

export default function DashboardStats() {
  const { useContractStats, useActiveCampaigns } = useContract();
  const { data: contractStats, isLoading: loadingStats } = useContractStats();
  const { data: campaigns, isLoading: loadingCampaigns } = useActiveCampaigns(0, 100);

  if (loadingStats || loadingCampaigns) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-20" />)}
      </div>
    );
  }

  const safeNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "bigint") return Number(v);
    return Number(v) || 0;
  };

  const totalRaised = campaigns?.reduce((s, c) => {
    try { return s + (parseFloat(formatEther(c?.raisedAmount || 0)) || 0); } catch { return s; }
  }, 0) || 0;

  const active = campaigns?.filter((c) => c?.active).length || 0;
  const successful = campaigns?.filter((c) => {
    try { return parseFloat(formatEther(c?.raisedAmount || 0)) >= parseFloat(formatEther(c?.targetAmount || 0)); } catch { return false; }
  }).length || 0;

  const contributors = campaigns?.reduce((s, c) => s + safeNum(c?.contributorsCount), 0) || 0;

  const stats = [
    { title: "Total Campaigns", value: safeNum(contractStats?.totalCampaigns).toString(), icon: FiTarget, trend: "up", trendValue: "+" },
    { title: "Total Raised", value: `${totalRaised.toFixed(2)} ETH`, icon: FiDollarSign, trend: "up", trendValue: "+" },
    { title: "Active Campaigns", value: active.toString(), icon: FiActivity, trend: "up", trendValue: "+" },
    { title: "Contributors", value: formatNumber(contributors), icon: FiUsers, trend: "up", trendValue: "+" },
    { title: "Successful", value: successful.toString(), icon: FiAward, trend: "up", trendValue: "+" },
    { title: "Platform Treasury", value: `${parseFloat(formatEther(contractStats?.totalFees || 0)).toFixed(4)} ETH`, icon: FiTrendingUp, trend: null, trendValue: null },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {stats.map((s, i) => <StatsCard key={i} {...s} />)}
    </div>
  );
}

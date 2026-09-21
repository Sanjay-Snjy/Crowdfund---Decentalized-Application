import { useAccount, useContractWrite, useContractRead } from "wagmi";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Layout from "../components/Layout/Layout";
import { useContract } from "../hooks/useContract";
import { toast } from "react-hot-toast";
import { FiPause, FiPlay, FiDollarSign, FiShield, FiActivity, FiAlertTriangle } from "react-icons/fi";
import { formatEther, parseEther } from "../utils/helpers";
import { CONTRACT_ADDRESS } from "../constants";
import { CROWDFUNDING_ABI } from "../constants/abi";

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const { useContractStats } = useContract();
  const [isAdmin, setIsAdmin] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [campaignToToggle, setCampaignToToggle] = useState("");

  const { data: contractStats } = useContractStats();
  const { data: isPaused } = useContractRead({ address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "paused", enabled: Boolean(CONTRACT_ADDRESS && isAdmin) });
  const { data: contractOwner } = useContractRead({ address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "owner", enabled: Boolean(CONTRACT_ADDRESS) });

  const { write: withdrawFees, isLoading: isWithdrawing } = useContractWrite({ address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "withdrawFees", onSuccess: () => { toast.success("Fees withdrawn!"); setWithdrawAmount(""); }, onError: (e) => toast.error(e?.reason || "Failed") });
  const { write: pauseContract, isLoading: isPausing } = useContractWrite({ address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "pause", onSuccess: () => toast.success("Paused!"), onError: (e) => toast.error(e?.reason || "Failed") });
  const { write: unpauseContract, isLoading: isUnpausing } = useContractWrite({ address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "unpause", onSuccess: () => toast.success("Unpaused!"), onError: (e) => toast.error(e?.reason || "Failed") });
  const { write: emergencyWithdraw, isLoading: isEmergency } = useContractWrite({ address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "emergencyWithdraw", onSuccess: () => toast.success("Emergency withdrawal done!"), onError: (e) => toast.error(e?.reason || "Failed") });
  const { write: deactivateCampaign, isLoading: isDeactivating } = useContractWrite({ address: CONTRACT_ADDRESS, abi: CROWDFUNDING_ABI, functionName: "deactivateCampaign", onSuccess: () => { toast.success("Campaign deactivated!"); setCampaignToToggle(""); }, onError: (e) => toast.error(e?.reason || "Failed") });

  useEffect(() => {
    if (!isConnected) { router.push("/"); return; }
    if (contractOwner && address) {
      const isOwner = address.toLowerCase() === contractOwner.toLowerCase();
      setIsAdmin(isOwner);
      if (!isOwner) { toast.error("Admin access required"); router.push("/dashboard"); }
    }
  }, [isConnected, address, router, contractOwner]);

  if (!isConnected || !isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="card p-8 text-center max-w-sm">
            <FiShield className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} />
            <h2 className="text-lg font-bold mb-2" style={{ color: "var(--color-text)" }}>Admin Only</h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>This area is restricted to administrators.</p>
          </div>
        </div>
      </Layout>
    );
  }

  const fees = contractStats?.totalFees ? formatEther(contractStats.totalFees) : "0";
  const balance = contractStats?.contractBalance ? formatEther(contractStats.contractBalance) : "0";
  const total = contractStats?.totalCampaigns?.toString() || "0";

  return (
    <Layout>
      <div className="max-w-8xl mx-auto pl-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>Admin Panel</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Manage platform settings and treasury</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Campaigns", value: total },
            { label: "Fees", value: `${fees} ETH` },
            { label: "Balance", value: `${balance} ETH` },
            { label: "Status", value: isPaused ? "Paused" : "Active" },
          ].map((s) => (
            <div key={s.label} className="card p-4 rounded-2xl">
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{s.label}</p>
              <p className="text-lg font-bold mt-1" style={{ color: "var(--color-text)" }}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Withdraw */}
          <div className="card p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
              <FiDollarSign className="w-4 h-4" /> Treasury
            </h3>
            <label className="label">Withdraw (ETH)</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="input" />
            <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>Available: {fees} ETH</p>
            <button onClick={() => { if (!withdrawAmount) return; try { withdrawFees?.({ args: [parseEther(withdrawAmount)] }); } catch { toast.error("Invalid"); } }} disabled={isWithdrawing || !withdrawAmount} className="btn w-full mt-3">
              {isWithdrawing ? "Withdrawing..." : "Withdraw Fees"}
            </button>
          </div>

          {/* Controls */}
          <div className="card p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
              <FiShield className="w-4 h-4" /> Platform Controls
            </h3>
            <button onClick={() => isPaused ? unpauseContract?.() : pauseContract?.()} disabled={isPausing || isUnpausing} className="btn btn-secondary w-full mb-3">
              {isPausing || isUnpausing ? "Processing..." : isPaused ? <><FiPlay className="w-4 h-4" /> Resume</> : <><FiPause className="w-4 h-4" /> Pause</>}
            </button>
            <button onClick={() => { if (window.confirm("Emergency withdraw? This cannot be undone.")) emergencyWithdraw?.(); }} disabled={isEmergency} className="btn btn-danger w-full">
              <FiAlertTriangle className="w-4 h-4" /> {isEmergency ? "Processing..." : "Emergency Withdraw"}
            </button>
          </div>

          {/* Deactivate */}
          <div className="card p-5 lg:col-span-2 rounded-2xl">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
              <FiActivity className="w-4 h-4" /> Deactivate Campaign
            </h3>
            <div className="flex gap-3">
              <input type="number" min="1" placeholder="Campaign ID" value={campaignToToggle} onChange={(e) => setCampaignToToggle(e.target.value)} className="input flex-1" />
              <button onClick={() => { if (!campaignToToggle) return; if (window.confirm(`Deactivate campaign #${campaignToToggle}?`)) deactivateCampaign?.({ args: [parseInt(campaignToToggle)] }); }} disabled={isDeactivating || !campaignToToggle} className="btn btn-danger shrink-0">
                {isDeactivating ? "Processing..." : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

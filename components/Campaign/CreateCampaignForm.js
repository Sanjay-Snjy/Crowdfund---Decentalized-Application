import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import { FiUpload, FiX, FiInfo, FiShield, FiLock, FiCheckCircle } from "react-icons/fi";
import { useAccount, useBalance, useNetwork } from "wagmi";
import { useUser } from "@clerk/nextjs";
import { useContract } from "../../hooks/useContract";
import { uploadCampaignMetadata } from "../../utils/ipfs";
import {
  CAMPAIGN_CREATION_FEE,
  CREATOR_STAKE_PERCENT,
  MILESTONE_SCHEDULE,
  VOTE_QUORUM_PERCENT,
} from "../../constants";
import { formatEther } from "../../utils/helpers";
import { useDemoMode } from "../../lib/demoMode";

const CATEGORIES = [
  "Student Projects", "Medical", "Startup", "Education", "Research and Innovation",
  "Social Causes", "Technology", "Agriculture", "Arts and Culture", "Environment",
];

export default function CreateCampaignForm() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const demoMode = useDemoMode();
  const { user } = useUser();
  const { chain } = useNetwork();
  const { data: balanceData } = useBalance({ address, enabled: Boolean(address) });
  const { useCreateCampaignSimple } = useContract();
  const { createCampaignAsync, isLoading } = useCreateCampaignSimple();

  const [formData, setFormData] = useState({ title: "", description: "", targetAmount: "", duration: "", category: "Student Projects", tags: "", additionalInfo: "" });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [rates, setRates] = useState(null);

  const configuredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 0);
  const configuredNetworkName = process.env.NEXT_PUBLIC_NETWORK || "the configured network";
  const creationFeeWei = ethers.utils.parseEther(CAMPAIGN_CREATION_FEE || "0");
  const walletBalanceWei = balanceData?.value ? ethers.BigNumber.from(balanceData.value.toString()) : ethers.BigNumber.from(0);

  // The creator stake is 30% of the target and is sent together with the
  // createCampaign transaction; the contract holds it until the campaign completes.
  const { stakeWei, targetWei } = useMemo(() => {
    const amount = parseFloat(formData.targetAmount);
    if (!formData.targetAmount || isNaN(amount) || amount <= 0) {
      return { stakeWei: ethers.BigNumber.from(0), targetWei: ethers.BigNumber.from(0) };
    }
    try {
      const parsedTarget = ethers.utils.parseEther(formData.targetAmount);
      return {
        targetWei: parsedTarget,
        stakeWei: parsedTarget.mul(CREATOR_STAKE_PERCENT).div(100),
      };
    } catch {
      return { stakeWei: ethers.BigNumber.from(0), targetWei: ethers.BigNumber.from(0) };
    }
  }, [formData.targetAmount]);

  const stakeDisplay = stakeWei.gt(0) ? formatEther(stakeWei) : "0";
  const hasEnoughForStake = walletBalanceWei.gte(stakeWei.add(creationFeeWei));
  const releasePlan = MILESTONE_SCHEDULE.map((m) => ({
    ...m,
    amountWei: targetWei.gt(0) ? targetWei.mul(m.percent).div(100) : ethers.BigNumber.from(0),
  }));

  useEffect(() => {
    let mounted = true;
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr,usd")
      .then((r) => r.json())
      .then((d) => { if (mounted && d?.ethereum) setRates(d.ethereum); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const tagList = formData.tags.split(",").map((t) => t.trim()).filter(Boolean);

  const handleInputChange = (e) => setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("Max 10MB"); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const validate = () => {
    if (!formData.title.trim()) { toast.error("Title required"); return false; }
    if (!formData.description.trim()) { toast.error("Description required"); return false; }
    if (!formData.targetAmount || parseFloat(formData.targetAmount) <= 0) { toast.error("Valid target amount required"); return false; }
    if (!formData.duration || parseInt(formData.duration) <= 0) { toast.error("Valid duration required"); return false; }
    if (stakeWei.lte(0)) { toast.error("Enter the target amount to calculate the creator stake"); return false; }
    if (!hasEnoughForStake) {
      toast.error(`You need at least ${stakeDisplay} ETH for the creator stake`);
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate() || !isConnected || !address) return;
    if (configuredChainId && chain?.id && chain.id !== configuredChainId) {
      toast.error(`Switch to ${configuredNetworkName}`); return;
    }
    if (!createCampaignAsync) { toast.error("Contract not available"); return; }

    setUploading(true);
    try {
      toast.loading("Uploading to IPFS...", { id: "upload" });
      const creatorName = user?.fullName || user?.firstName || "Anonymous";
      const uploadResult = await uploadCampaignMetadata({
        ...formData,
        tags: tagList,
        releasePlan: MILESTONE_SCHEDULE.map(({ label, percent }) => ({ label, percent })),
        creator: creatorName,
      }, imageFile);
      toast.dismiss("upload");
      if (!uploadResult.success) throw new Error(uploadResult.error);

      const durationSec = parseInt(formData.duration) * 86400;

      toast.loading("Creating campaign and locking stake...", { id: "create" });
      await createCampaignAsync({
        args: [formData.title, formData.description, uploadResult.metadataHash, targetWei, durationSec],
        // Stake (30% of target) + creation fee (0 ETH) — held by the contract.
        value: stakeWei.add(creationFeeWei),
      });
      toast.dismiss("create");
      toast.success("Campaign created!");
      router.push("/my-campaigns");
    } catch (err) {
      toast.dismiss();
      toast.error(err?.message?.includes("rejected") ? "Transaction rejected" : "Failed to create campaign");
    } finally { setUploading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
      {/* ─── Left: Campaign Form ─── */}
      <div className="space-y-5">
        <div className="card p-6 rounded-2xl">
          {/* Header */}
          <div className="mb-6">
            <h3 className="text-[14px] font-bold uppercase tracking-[0.2em] text-indigo-600">New Campaign</h3>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Complete the form below to launch campaign.
            </p>
          </div>

          {/* Creator stake notice */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-indigo-500/10 dark:bg-indigo-900/20 border border-indigo-800/20 dark:border-indigo-800/40 mb-6">
            <FiShield className="w-5 h-5 text-indigo-700 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">Creator stake required</p>
              <p className="text-xs text-indigo-500/80 dark:text-indigo-400/70 mt-0.5">
                You deposit a security stake of {CREATOR_STAKE_PERCENT}% of your target
                ({stakeDisplay} ETH). It stays locked in the smart contract and is returned only when
                all three milestones are released. There is no campaign creation fee
                ({formatEther(CAMPAIGN_CREATION_FEE)} ETH).
              </p>
            </div>
          </div>

          {/* Two-column form layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Left column */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Campaign Title</label>
                <input
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="Enter a compelling title"
                  className="w-full rounded-full border px-4 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Campaign Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  rows={4}
                  placeholder="Describe your campaign, goals, and how funds will be used"
                  className="w-full rounded-[20px] border px-4 py-2.5 text-sm outline-none resize-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Category</label>
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    className="w-full rounded-full border px-4 py-2.5 text-sm outline-none transition focus:border-indigo-500"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                  >
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Duration (Days)</label>
                  <input
                    type="number"
                    name="duration"
                    value={formData.duration}
                    onChange={handleInputChange}
                    min="1"
                    max="365"
                    placeholder="30"
                    className="w-full rounded-full border px-4 py-2.5 text-sm outline-none transition focus:border-indigo-500"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Target Amount (ETH)</label>
                <div className="flex gap-3">
                  <input
                    type="number"
                    name="targetAmount"
                    value={formData.targetAmount}
                    onChange={handleInputChange}
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    className="flex-1 rounded-full border px-4 py-2.5 w-[50px] text-sm outline-none transition focus:border-indigo-500"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                  />
                  {rates && formData.targetAmount > 0 && (
                    <>
                      <div className="flex flex-col items-center px-3 py-1 rounded-xl border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>USD</span>
                        <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>${(parseFloat(formData.targetAmount) * rates.usd).toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col items-center px-3 py-1 rounded-xl border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>INR</span>
                        <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>₹{(parseFloat(formData.targetAmount) * rates.inr).toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>
                {formData.targetAmount > 0 && (
                  <div
                    className="mt-2 flex items-center gap-2 text-xs"
                    style={{ color: hasEnoughForStake ? "var(--color-text-muted)" : "#f87171" }}
                  >
                    <FiLock className="w-3.5 h-3.5" />
                    <span>
                      Stake to lock: <span className="font-semibold">{stakeDisplay} ETH</span>
                      {!hasEnoughForStake && ` — your balance is ${formatEther(walletBalanceWei)} ETH`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Campaign Image</label>
                {imagePreview ? (
                  <div className="relative rounded-xl overflow-hidden border" style={{ borderColor: "var(--color-border)" }}>
                    <img src={imagePreview} alt="Preview" className="h-48 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => { setImageFile(null); setImagePreview(null); }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                    >
                      <FiX className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-48 rounded-2xl border-2 border-dashed cursor-pointer transition-colors hover:border-indigo-400" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                    <FiUpload className="w-10 h-10 mb-2" style={{ color: "var(--color-text-muted)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>Upload a campaign image</span>
                    <span className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>PNG, JPG, GIF up to 10MB.</span>
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                  </label>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Additional Information</label>
                <textarea
                  name="additionalInfo"
                  value={formData.additionalInfo}
                  onChange={handleInputChange}
                  rows={4}
                  placeholder="Share extra context, milestones, or team details"
                  className="w-full rounded-[20px]  border px-4 py-2.5 text-sm outline-none resize-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-center mt-4" style={{ color: "var(--color-text-muted)" }}>
            Ensure your campaign is clear and achievable.
          </p>

          {/* Create Button */}
          <button
            type="submit"
            disabled={isLoading || uploading || demoMode}
            title={demoMode ? "Demo account - connect a wallet to create campaigns" : ""}
            className="w-full mt-5 py-3 rounded-full bg-indigo-500 text-white font-semibold text-sm transition hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {demoMode ? "Demo Account — Create Disabled" : uploading ? "Uploading..." : isLoading ? "Creating..." : `Create Campaign & Lock ${stakeDisplay} ETH Stake`}
          </button>
        </div>
      </div>

      {/* ─── Right: Fund release plan ─── */}
      <div className="space-y-4">
        <div className="p-6 rounded-2xl bg-[#111827] text-white sticky top-20">
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white">Fund Release Plan</h3>
          <p className="text-xs text-slate-400 mt-1">
            Donor funds stay in the smart contract and are released milestone by milestone.
          </p>

          {/* Creator stake */}
          <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Creator stake ({CREATOR_STAKE_PERCENT}%)</span>
              <span className="text-sm font-bold text-indigo-400">{stakeDisplay} ETH</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Locked until the campaign completes successfully. Donors use it as a signal of commitment.
            </p>
          </div>

          {/* Milestone schedule (fixed) */}
          <div className="mt-4 space-y-3">
            {releasePlan.map((m) => (
              <div key={m.index} className="p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">{m.label}</span>
                  <span className="text-xs font-bold text-white">{m.percent}%</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    {formData.targetAmount > 0 ? `${formatEther(m.amountWei)} ETH at target` : "Released after donor approval"}
                  </span>
                  <FiLock className="w-3 h-3 text-slate-500" />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-2">
            <FiInfo className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-400">
              After the funding deadline you complete each milestone, upload evidence to IPFS and donors
              vote. A share is released only when a majority of the participating voting power approves
              and at least {VOTE_QUORUM_PERCENT}% of the campaign&apos;s voting power took part. Milestones
              are released strictly in order.
            </p>
          </div>

          <div className="mt-3 flex items-start gap-2">
            <FiCheckCircle className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-400">
              The platform improves accountability through a creator stake, milestone evidence, donor
              voting and transparent on-chain releases. Submitting evidence does not prove that the
              work or invoices are genuine — donors judge that themselves.
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}

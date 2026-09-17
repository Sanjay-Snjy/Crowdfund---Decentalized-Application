import Link from "next/link";
import { useState } from "react";
import { FiEdit2, FiEye, FiPause, FiPlay, FiAlertTriangle, FiMoreVertical } from "react-icons/fi";
import { formatEther } from "../../utils/helpers";
import { useContract } from "../../hooks/useContract";
import { toast } from "react-hot-toast";

export default function QuickActions({ campaign, onRefresh }) {
  const [showMenu, setShowMenu] = useState(false);
  const { useDeactivateCampaign, useReactivateCampaign, useForfeitCreatorStake } = useContract();
  const { deactivateCampaign, isLoading: deactivating } = useDeactivateCampaign();
  const { reactivateCampaign, isLoading: reactivating } = useReactivateCampaign();
  const { forfeitCreatorStake, isLoading: forfeiting } = useForfeitCreatorStake();

  const raised = parseFloat(formatEther(campaign.raisedAmount || 0));
  const target = parseFloat(formatEther(campaign.targetAmount || 0));
  const isFunded = raised >= target;
  // A failed campaign frees its creator stake to the platform treasury.
  const deadlinePassed = Number(campaign.deadline || 0) * 1000 <= Date.now();
  const canForfeitStake =
    deadlinePassed && !isFunded && !campaign.stakeForfeited && !campaign.stakeReturned;
  const isActive = campaign.active;

  const handleDeactivate = async () => {
    if (!deactivateCampaign) return;
    try {
      await deactivateCampaign({ args: [campaign.id] });
      onRefresh?.();
    } catch (e) {}
    setShowMenu(false);
  };

  const handleReactivate = async () => {
    if (!reactivateCampaign) return;
    try {
      await reactivateCampaign({ args: [campaign.id] });
      onRefresh?.();
    } catch (e) {}
    setShowMenu(false);
  };

  const handleForfeitStake = async () => {
    if (!forfeitCreatorStake) return;
    try {
      await forfeitCreatorStake({ args: [campaign.id] });
      onRefresh?.();
    } catch (e) {}
    setShowMenu(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href={`/campaign/${campaign.id}`}
        className="flex items-center justify-center w-7 h-7 rounded-lg transition"
        style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}
        title="View campaign"
      >
        <FiEye className="w-3.5 h-3.5" />
      </Link>
      <Link
        href={`/campaign/${campaign.id}?edit=true`}
        className="flex items-center justify-center w-7 h-7 rounded-lg transition"
        style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}
        title="Edit campaign"
      >
        <FiEdit2 className="w-3.5 h-3.5" />
      </Link>
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition"
          style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}
        >
          <FiMoreVertical className="w-3.5 h-3.5" />
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            <div
              className="absolute right-0 top-full mt-1 w-48 rounded-xl border shadow-xl z-50 py-1"
              style={{
                background: "var(--color-surface-raised, var(--color-card))",
                borderColor: "var(--color-border)",
              }}
            >
              {isActive ? (
                <button
                  onClick={handleDeactivate}
                  disabled={deactivating}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:opacity-80 transition"
                  style={{ color: "#f59e0b" }}
                >
                  <FiPause className="w-3.5 h-3.5" />
                  {deactivating ? "Pausing..." : "Pause Campaign"}
                </button>
              ) : (
                <button
                  onClick={handleReactivate}
                  disabled={reactivating}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:opacity-80 transition"
                  style={{ color: "var(--color-success)" }}
                >
                  <FiPlay className="w-3.5 h-3.5" />
                  {reactivating ? "Activating..." : "Reactivate"}
                </button>
              )}
              {canForfeitStake && (
                <button
                  onClick={handleForfeitStake}
                  disabled={forfeiting}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:opacity-80 transition"
                  style={{ color: "#f59e0b" }}
                >
                  <FiAlertTriangle className="w-3.5 h-3.5" />
                  {forfeiting ? "Processing..." : "Forfeit Creator Stake"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

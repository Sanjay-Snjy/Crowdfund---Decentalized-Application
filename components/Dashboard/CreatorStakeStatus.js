import { FiShield, FiCheck, FiAlertTriangle, FiLock } from "react-icons/fi";
import { formatEther } from "../../utils/helpers";

/**
 * Shows what happened to the creator stake of a campaign (or that it is still
 * locked in escrow). Replaces the old lump-sum "withdraw funds" button: in the
 * milestone escrow model, funds leave the contract per approved milestone and the
 * stake is returned automatically when the campaign completes.
 */
export default function CreatorStakeStatus({ campaign }) {
  const stake = campaign?.creatorStake;

  if (campaign?.stakeReturned) {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-success)" }}>
        <FiCheck className="w-3 h-3" />
        <span>Stake returned — campaign completed</span>
      </div>
    );
  }

  if (campaign?.stakeForfeited) {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "#f87171" }}>
        <FiAlertTriangle className="w-3 h-3" />
        <span>Stake forfeited — target missed</span>
      </div>
    );
  }

  if (stake === undefined || stake === null || formatEther(stake) === "0") return null;

  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
      <FiShield className="w-3 h-3" />
      <span>
        <FiLock className="w-2.5 h-2.5 inline -mt-0.5" /> Creator stake locked: {formatEther(stake)} ETH
      </span>
    </div>
  );
}

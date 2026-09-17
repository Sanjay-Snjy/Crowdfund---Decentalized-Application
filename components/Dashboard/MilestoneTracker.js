import { useMemo } from "react";
import { useContract } from "../../hooks/useContract";
import { formatEther } from "../../utils/helpers";
import { FiCheckCircle, FiClock, FiLock, FiFlag, FiUnlock } from "react-icons/fi";

export default function MilestoneTracker({ campaignId, campaign }) {
  const { useCampaignMilestones } = useContract();
  const { data: milestones, isLoading } = useCampaignMilestones(campaignId);

  const stats = useMemo(() => {
    if (!milestones?.length) return null;
    const total = milestones.length;
    const completed = milestones.filter((m) => m.fundsReleased).length;
    const pending = milestones.filter((m) => m.evidenceSubmitted && !m.fundsReleased).length;
    const locked = total - completed - pending;
    return { total, completed, pending, locked };
  }, [milestones]);

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-2 w-full" />
      </div>
    );
  }

  if (!milestones?.length) {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
        <FiFlag className="w-3 h-3" />
        <span>Milestone data unavailable</span>
      </div>
    );
  }

  const pct = stats ? (stats.completed / stats.total) * 100 : 0;

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: "var(--color-surface)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: "var(--color-success)",
            }}
          />
        </div>
        <span className="text-[10px] font-semibold tabular-nums" style={{ color: "var(--color-text-muted)" }}>
          {stats.completed}/{stats.total}
        </span>
      </div>

      {/* Milestone dots */}
      <div className="flex flex-wrap gap-1.5">
        {milestones.map((m, i) => {
          let Icon = FiLock;
          let color = "var(--color-text-muted)";
          let label = "Locked";

          if (m.fundsReleased) {
            Icon = FiCheckCircle;
            color = "var(--color-success)";
            label = `${m.percentage || 0}% released`;
          } else if (m.approved) {
            Icon = FiUnlock;
            color = "#06b6d4";
            label = "Approved — ready to release";
          } else if (m.evidenceSubmitted) {
            Icon = FiClock;
            color = "#fbbf24";
            label = "Voting open";
          } else if (m.completed) {
            Icon = FiCheckCircle;
            color = "#06b6d4";
            label = "Evidence submitted";
          }

          return (
            <div
              key={i}
              className="group relative flex items-center gap-1 rounded-md px-1.5 py-0.5"
              style={{ background: `${color}15` }}
            >
              <Icon className="w-3 h-3" style={{ color }} />
              <span className="text-[10px] font-medium" style={{ color }}>
                M{i + 1}
              </span>
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                style={{ background: "var(--color-text)", color: "var(--color-bg)" }}
              >
                {m.title} · {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

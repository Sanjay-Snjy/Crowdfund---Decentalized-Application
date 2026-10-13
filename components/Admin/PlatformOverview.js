/**
 * Admin → Platform overview.
 *
 * Registered users, indexed donation volume, escrow held by the contract and the
 * indexer's health, plus manual sync controls (recent / deep) for backfilling the
 * history of the deployed contract.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiDatabase, FiPlay, FiRefreshCw, FiUsers, FiZap } from "react-icons/fi";
import { toast } from "react-hot-toast";
import { apiGet, apiPost, ApiError } from "../../utils/apiClient";
import { formatDate } from "../../utils/helpers";
import { ErrorState, LoadingState, SectionTitle, StatTile } from "../Common/AsyncStates";

export default function PlatformOverview({ enabled = true, onSynced = null }) {
  const [syncing, setSyncing] = useState(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiGet("/api/admin/stats"),
    enabled,
    refetchInterval: 30 * 1000,
    retry: 1,
  });

  const runSync = async (mode) => {
    setSyncing(mode);
    try {
      const result = await apiPost("/api/admin/sync", { mode });
      const sync = result.result;
      if (sync.ok) {
        toast.success(
          `Sync complete — ${sync.events.inserted} new event(s) from block ${sync.scanned.from} to ${sync.scanned.to}`
        );
        if (sync.errors?.length) toast.error(`${sync.errors.length} RPC warning(s) — check the server log`);
      } else {
        toast.error(`Sync failed: ${sync.reason || "unknown error"}`);
      }
      await refetch();
      onSynced?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="card rounded-2xl p-5">
        <SectionTitle title="Platform Overview" />
        <LoadingState rows={2} height="h-16" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card rounded-2xl p-5">
        <SectionTitle title="Platform Overview" />
        <ErrorState
          error={error}
          onRetry={refetch}
          title={error?.status === 401 || error?.status === 403 ? "Not authorized" : "Could not load the overview"}
        />
      </div>
    );
  }

  const { users, donations, campaigns, chain, indexer, network } = data;

  return (
    <div className="card rounded-2xl p-5">
      <SectionTitle
        title="Platform Overview"
        description={`Contract ${network.contractAddress} · chain ${network.chainId}`}
        right={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => runSync("recent")}
              disabled={Boolean(syncing)}
            >
              <FiRefreshCw className="h-3 w-3" /> {syncing === "recent" ? "Syncing…" : "Sync recent"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => runSync("deep")}
              disabled={Boolean(syncing)}
              title="Scan the whole configured history (CF_INDEX_START_BLOCK)"
            >
              <FiPlay className="h-3 w-3" /> {syncing === "deep" ? "Backfilling…" : "Deep sync"}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Registered users"
          value={users.total}
          hint={`${users.withWallet} with a wallet`}
          icon={<FiUsers className="h-4 w-4" />}
        />
        <StatTile label="New in 7 days" value={users.last7Days} />
        <StatTile label="Administrators" value={users.admins} />
        <StatTile
          label="Confirmed donations"
          value={donations.confirmedCount}
          hint={`${donations.confirmedEth} ETH`}
          accent="var(--color-success)"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Contract balance"
          value={chain ? `${chain.contractBalanceEth} ETH` : "—"}
          hint="Every campaign combined"
          accent="var(--color-warning)"
        />
        <StatTile label="Campaigns on-chain" value={campaigns.onChainTotal ?? campaigns.cached} />
        <StatTile label="Refunded to donors" value={`${donations.refundedEth} ETH`} />
        <StatTile
          label="Treasury fees"
          value={chain ? `${Number(chain.treasuryFeesWei) / 1e18} ETH` : "—"}
          hint="Creation fee is zero"
        />
      </div>

      <div className="mt-4 rounded-xl p-3" style={{ background: "var(--color-surface-raised)" }}>
        <p className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--color-text)" }}>
          <FiDatabase className="h-3.5 w-3.5" /> Indexer
        </p>
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
          Last indexed block {indexer.lastIndexedBlock ?? "—"}
          {indexer.updatedAt ? ` · ${formatDate(indexer.updatedAt)}` : ""} · {indexer.confirmationsRequired}{" "}
          confirmation(s) required before a donation counts as confirmed.
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          <FiZap className="h-3 w-3" />
          Read-only chain access · contract {chain?.owner ? `owner ${chain.owner.slice(0, 10)}…` : "owner unknown"}
          {chain?.paused ? " · contract paused" : ""}
        </p>
        {isFetching && (
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            Refreshing statistics…
          </p>
        )}
      </div>
    </div>
  );
}

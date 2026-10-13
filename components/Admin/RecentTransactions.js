/**
 * Admin → Recent Transactions.
 *
 * Newest first, paginated, filterable by campaign, status and category, and
 * searchable by CrowdFund User ID, wallet address, campaign name or transaction
 * hash. Donations are the default category, so campaign creation, milestone and
 * refund transactions never pollute the donation view.
 *
 * Rows come from indexed contract events only — nothing is hardcoded — and every
 * row links to the configured block explorer (Sepolia Etherscan on Sepolia).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiExternalLink, FiRefreshCw, FiSearch } from "react-icons/fi";
import { apiGet, buildQuery } from "../../utils/apiClient";
import { formatAddress, formatDate } from "../../utils/helpers";
import { EmptyState, ErrorState, LoadingState, SectionTitle, StatTile, StatusPill } from "../Common/AsyncStates";

const PAGE_SIZE = 15;

const CATEGORY_LABELS = {
  contribution: "Donations",
  refund: "Refunds",
  campaign_created: "Campaign creation",
  milestone_evidence: "Milestone evidence",
  milestone_vote: "Milestone voting",
  milestone_approved: "Milestone approval",
  milestone_released: "Fund release",
  campaign_completed: "Campaign completion",
};

export default function RecentTransactions({ enabled = true }) {
  const [page, setPage] = useState(1);
  const [campaignId, setCampaignId] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("contribution");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const queryString = useMemo(
    () =>
      buildQuery({
        page,
        limit: PAGE_SIZE,
        campaignId,
        status,
        category,
        search,
      }),
    [page, campaignId, status, category, search]
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "transactions", queryString],
    queryFn: () => apiGet(`/api/admin/transactions${queryString}`),
    enabled,
    refetchInterval: 30 * 1000,
    retry: 1,
    keepPreviousData: true,
  });

  if (!enabled) return null;

  const transactions = data?.transactions || [];
  const totals = data?.totals;
  const pagination = data?.pagination;

  const applyFilters = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  return (
    <div className="card rounded-2xl p-5">
      <SectionTitle
        title="Recent Transactions"
        description={`Newest first · explorer: ${data?.network?.explorerName || "configured network"}`}
        right={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => refetch()} disabled={isFetching}>
            <FiRefreshCw className="h-3 w-3" /> {isFetching ? "Syncing…" : "Refresh"}
          </button>
        }
      />

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Confirmed donations"
          value={totals?.totalConfirmedDonations ?? "—"}
          hint="Matching the current filters"
        />
        <StatTile
          label="Total contributed"
          value={totals ? `${totals.totalConfirmedEth} ETH` : "—"}
          accent="var(--color-success)"
          hint="Confirmed contributions only"
        />
        <StatTile label="Pending" value={totals?.totalPendingWei ? `${totals.totalPendingEth ?? ""}` : "0 ETH"} hint="Awaiting confirmations" />
        <StatTile
          label="Refunded"
          value={totals ? `${totals.totalRefundedEth} ETH` : "—"}
          accent="var(--color-warning)"
          hint="Returned to donors"
        />
      </div>

      {/* Filters */}
      <div className="mt-4 grid gap-2 md:grid-cols-4">
        <select
          className="select"
          value={campaignId}
          onChange={(event) => {
            setCampaignId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All campaigns</option>
          {(data?.campaigns || []).map((campaign) => (
            <option key={campaign.campaignId} value={campaign.campaignId}>
              #{campaign.campaignId} · {campaign.title || "untitled"}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
        </select>

        <select
          className="select"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
        >
          <option value="contribution">Donations (default)</option>
          {Object.entries(CATEGORY_LABELS)
            .filter(([key]) => key !== "contribution")
            .map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
        </select>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <FiSearch
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--color-text-muted)" }}
            />
            <input
              className="input pl-9"
              placeholder="CF-0001, 0x…, campaign, tx hash"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyFilters();
              }}
            />
          </div>
          <button type="button" className="btn btn-sm shrink-0" onClick={applyFilters}>
            Search
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4">
          <LoadingState rows={5} height="h-10" label="Loading transactions" />
        </div>
      ) : error ? (
        <div className="mt-4">
          <ErrorState
            error={error}
            onRetry={refetch}
            title={error?.status === 401 || error?.status === 403 ? "Not authorized" : "Could not load transactions"}
          />
        </div>
      ) : transactions.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No matching transactions"
            description="No indexed event matches these filters. Try a different campaign, status or search term — or run a deeper sync from the overview panel."
          />
        </div>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={{ color: "var(--color-text-muted)" }}>
                  <th className="px-2 py-2 font-medium">Transaction</th>
                  <th className="px-2 py-2 font-medium">Donor</th>
                  <th className="px-2 py-2 font-medium">Campaign</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Date & time</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Explorer</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={`${tx.txHash}-${tx.logIndex}`}
                    className="border-t"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <td className="px-2 py-2 font-mono" style={{ color: "var(--color-text-secondary)" }}>
                      <a
                        href={tx.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        title={tx.txHash}
                      >
                        {tx.txHash.slice(0, 10)}…{tx.txHash.slice(-6)}
                      </a>
                    </td>
                    <td className="px-2 py-2">
                      {tx.cfUserId ? (
                        <span className="font-mono font-semibold" style={{ color: "var(--color-text)" }}>
                          {tx.cfUserId}
                        </span>
                      ) : (
                        <span className="font-mono" style={{ color: "var(--color-text-muted)" }} title={tx.donorWallet || ""}>
                          {tx.donorWallet ? formatAddress(tx.donorWallet) : "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2" style={{ color: "var(--color-text)" }}>
                      <span className="font-mono text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        #{tx.campaignId ?? "—"}
                      </span>{" "}
                      {tx.campaignName || "—"}
                    </td>
                    <td className="px-2 py-2 font-semibold" style={{ color: "var(--color-text)" }}>
                      {tx.eventType === "contribution" || tx.eventType === "refund" || tx.eventType === "milestone_released"
                        ? `${tx.amountEth} ETH`
                        : "—"}
                    </td>
                    <td className="px-2 py-2" style={{ color: "var(--color-text-secondary)" }}>
                      {formatDate(tx.timestamp)}
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill status={tx.status} />
                      {tx.eventType !== "contribution" && (
                        <span className="ml-1 badge badge-neutral">{CATEGORY_LABELS[tx.eventType] || tx.eventType}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <a
                        href={tx.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                      >
                        View <FiExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="mt-4 space-y-2 md:hidden">
            {transactions.map((tx) => (
              <div key={`${tx.txHash}-${tx.logIndex}`} className="rounded-xl p-3" style={{ background: "var(--color-surface-raised)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs" style={{ color: "var(--color-text)" }}>
                    {tx.cfUserId || (tx.donorWallet ? formatAddress(tx.donorWallet) : "—")}
                  </span>
                  <StatusPill status={tx.status} />
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--color-text)" }}>
                  {tx.campaignName || `Campaign #${tx.campaignId}`} · {tx.amountEth} ETH
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {formatDate(tx.timestamp)}
                </p>
                <a
                  href={tx.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm mt-2"
                >
                  View transaction <FiExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} matching events
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!pagination.hasMore}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

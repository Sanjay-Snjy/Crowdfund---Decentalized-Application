/**
 * Admin → Recently Joined Users.
 *
 * Newest registrations first, CrowdFund User ID only (Clerk ids are never shown),
 * registration date/time, wallet connection status with the address when present,
 * and an explicit placeholder when no wallet is connected.
 *
 * The list refreshes on an interval so a user who registers while the dashboard is
 * open appears without a reload.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiChevronDown, FiRefreshCw, FiUserPlus, FiCreditCard } from "react-icons/fi";
import { apiGet, buildQuery } from "../../utils/apiClient";
import { formatAddress, formatDate } from "../../utils/helpers";
import { EmptyState, ErrorState, LoadingState, SectionTitle } from "../Common/AsyncStates";

const PAGE_SIZE = 10;

export default function RecentlyJoinedUsers({ enabled = true }) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "users", limit],
    queryFn: () => apiGet(`/api/admin/users${buildQuery({ limit, offset: 0 })}`),
    enabled,
    refetchInterval: 20 * 1000,
    retry: 1,
  });

  if (!enabled) return null;

  const users = data?.users || [];
  const pagination = data?.pagination;

  return (
    <div className="card rounded-2xl p-5">
      <SectionTitle
        title="Recently Joined Users"
        description="Newest registrations first · refreshes automatically"
        right={
          <div className="flex items-center gap-2">
            <span className="badge badge-neutral">{pagination?.total ?? "—"} registered</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => refetch()} disabled={isFetching}>
              <FiRefreshCw className="h-3 w-3" /> {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
      />

      {isLoading ? (
        <LoadingState rows={4} height="h-12" label="Loading users" />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={refetch}
          title={error?.status === 401 || error?.status === 403 ? "Not authorized" : "Could not load users"}
        />
      ) : users.length === 0 ? (
        <EmptyState
          icon={<FiUserPlus className="h-8 w-8" style={{ color: "var(--color-text-muted)" }} />}
          title="No registered users yet"
          description="Profiles appear here as soon as someone registers — via the Clerk webhook or their first signed wallet sign-in."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={{ color: "var(--color-text-muted)" }}>
                  <th className="px-3 py-2 font-medium">CrowdFund User ID</th>
                  <th className="px-3 py-2 font-medium">Display name</th>
                  <th className="px-3 py-2 font-medium">Registered</th>
                  <th className="px-3 py-2 font-medium">Wallet</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="px-3 py-2 font-mono font-semibold" style={{ color: "var(--color-text)" }}>
                      {user.cfUserId}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--color-text)" }}>
                      {user.displayName || <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--color-text-secondary)" }}>
                      {formatDate(user.registeredAt)}
                    </td>
                    <td className="px-3 py-2">
                      {user.walletConnected ? (
                        <span className="inline-flex items-center gap-1.5">
                          <FiCreditCard className="h-3 w-3" style={{ color: "var(--color-success)" }} />
                          <span className="font-mono" style={{ color: "var(--color-text)" }} title={user.walletAddress}>
                            {formatAddress(user.walletAddress)}
                          </span>
                        </span>
                      ) : (
                        <span className="badge badge-neutral">No wallet connected</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`badge ${user.role === "admin" ? "badge-success" : "badge-neutral"}`}>
                        {user.role === "admin" ? "Admin" : "User"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {users.map((user) => (
              <div key={user.id} className="rounded-xl p-3" style={{ background: "var(--color-surface-raised)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold" style={{ color: "var(--color-text)" }}>
                    {user.cfUserId}
                  </span>
                  <span className={`badge ${user.role === "admin" ? "badge-success" : "badge-neutral"}`}>
                    {user.role === "admin" ? "Admin" : "User"}
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--color-text)" }}>
                  {user.displayName || "No display name"}
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {formatDate(user.registeredAt)}
                </p>
                <p className="mt-1 text-[11px]" style={{ color: user.walletConnected ? "var(--color-success)" : "var(--color-text-muted)" }}>
                  {user.walletConnected ? `Wallet ${formatAddress(user.walletAddress)}` : "No wallet connected"}
                </p>
              </div>
            ))}
          </div>

          {pagination?.hasMore && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-3 w-full"
              onClick={() => setLimit((current) => Math.min(current + PAGE_SIZE, 100))}
            >
              <FiChevronDown className="h-3 w-3" /> Load more
              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                ({users.length} of {pagination.total})
              </span>
            </button>
          )}

          <p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            Showing {users.length} of {pagination?.total ?? 0} registered users. Email addresses are never
            displayed.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Admin → Contract balance breakdown.
 *
 * Opened by clicking the "Contract balance" tile on the admin overview. The
 * contract holds every campaign's escrow in a single address, so the total on its
 * own never answers "whose money is this?". This page splits it back down:
 *
 *   - one section per campaign, each with its collected balance and deadline, and
 *   - every individual contribution behind that balance — who contributed, how
 *     much, when, and the block-explorer link to the transaction.
 *
 * All three datasets come from existing server-verified admin endpoints, so this
 * page adds no new privileged surface:
 *
 *   GET /api/admin/stats        → the contract's whole balance + treasury fees
 *   GET /api/admin/campaigns    → per-campaign funding state + deadline
 *   GET /api/admin/transactions → the contribution rows of a single campaign
 *
 * Authorization is enforced server-side by those routes (admin role from the
 * database); this component only presents what they return.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FiArrowLeft, FiExternalLink, FiLayers, FiRefreshCw } from "react-icons/fi";
import Layout from "../../components/Layout/Layout";
import AdminGate from "../../components/Admin/AdminGate";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionTitle,
  StatTile,
  StatusPill,
} from "../../components/Common/AsyncStates";
import { apiGet, buildQuery } from "../../utils/apiClient";
import { formatAddress, formatDate } from "../../utils/helpers";
import { formatEthDisplay, toBigInt } from "../../lib/format";

const MAX_CAMPAIGNS = 25;
const CONTRIBUTIONS_PER_CAMPAIGN = 100;

function progressTone(percent) {
  if (percent >= 100) return "var(--color-success)";
  if (percent >= 50) return "var(--color-accent)";
  return "var(--color-warning)";
}

function amountCell(value) {
  return <strong style={{ color: "var(--color-text)" }}>{value} ETH</strong>;
}

export default function ContractBalancePage() {
  // A campaign deactivated by an administrator is no longer live, so it is hidden
  // from this list by default — but its escrow is still part of the contract
  // balance, so it stays one click away.
  const [showDeactivated, setShowDeactivated] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["admin", "contract-balance", "stats"],
    queryFn: () => apiGet("/api/admin/stats"),
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  const campaignsQuery = useQuery({
    queryKey: ["admin", "contract-balance", "campaigns"],
    queryFn: () =>
      apiGet(`/api/admin/campaigns${buildQuery({ limit: MAX_CAMPAIGNS, releases: 0 })}`),
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  const campaigns = campaignsQuery.data?.campaigns || [];
  const deactivatedCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.active === false),
    [campaigns]
  );
  const visibleCampaigns = showDeactivated
    ? campaigns
    : campaigns.filter((campaign) => campaign.active !== false);
  const campaignIds = useMemo(
    () => campaigns.map((campaign) => campaign.campaignId),
    [campaigns]
  );

  // The transactions endpoint returns one campaign's donations per request, so
  // they are fetched together and grouped by campaign id. A single campaign
  // failing must not blank the rest of the page, hence the per-request catch.
  const contributionsQuery = useQuery({
    queryKey: ["admin", "contract-balance", "contributions", campaignIds.join(",")],
    enabled: campaignIds.length > 0,
    refetchInterval: 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const entries = await Promise.all(
        campaignIds.map(async (campaignId) => {
          try {
            const payload = await apiGet(
              `/api/admin/transactions${buildQuery({
                campaignId,
                category: "contribution",
                limit: CONTRIBUTIONS_PER_CAMPAIGN,
                page: 1,
              })}`
            );
            return [
              campaignId,
              {
                transactions: payload.transactions || [],
                total: payload.pagination?.total ?? 0,
                error: null,
              },
            ];
          } catch (error) {
            return [
              campaignId,
              {
                transactions: [],
                total: 0,
                error: error?.message || "Could not load contributions",
              },
            ];
          }
        })
      );
      return Object.fromEntries(entries);
    },
  });

  const contributionsByCampaign = contributionsQuery.data || {};
  const chain = statsQuery.data?.chain;
  const network = statsQuery.data?.network;

  const collectedWei = campaigns.reduce(
    (sum, campaign) => sum + toBigInt(campaign.funding?.collectedWei),
    0n
  );
  const escrowWei = campaigns.reduce(
    (sum, campaign) => sum + toBigInt(campaign.escrow?.escrowWei),
    0n
  );

  const refreshing =
    statsQuery.isFetching || campaignsQuery.isFetching || contributionsQuery.isFetching;

  const refreshAll = () => {
    statsQuery.refetch();
    campaignsQuery.refetch();
    contributionsQuery.refetch();
  };

  return (
    <Layout>
      <div className="max-w-8xl mx-auto pl-4 py-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/admin" className="btn btn-ghost btn-sm mb-2">
              <FiArrowLeft className="h-3 w-3" /> Back to admin dashboard
            </Link>
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>
              Contract Balance
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              What the contract is holding, split per campaign — with every contribution behind each
              balance.
              {network?.contractAddress ? (
                <span className="font-mono"> · {network.contractAddress}</span>
              ) : null}
              {network?.explorerName ? ` · ${network.explorerName}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={refreshAll}
            disabled={refreshing}
          >
            <FiRefreshCw className="h-3 w-3" /> {refreshing ? "Reading…" : "Refresh"}
          </button>
        </div>

        <AdminGate>
          {/* ─── Contract-level totals ─── */}
          <div className="card rounded-2xl p-5">
            <SectionTitle
              title="Contract balance"
              description="The contract address holds every campaign's escrow, so this is the platform-wide total"
            />
            {statsQuery.error ? (
              <ErrorState
                error={statsQuery.error}
                onRetry={statsQuery.refetch}
                title={
                  statsQuery.error?.status === 401 || statsQuery.error?.status === 403
                    ? "Not authorized"
                    : "Could not read the contract balance"
                }
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile
                    label="Contract balance"
                    value={chain ? `${chain.contractBalanceEth} ETH` : "—"}
                    hint="Held at the contract address"
                    accent="var(--color-warning)"
                  />
                  <StatTile
                    label="Collected by campaigns"
                    value={`${formatEthDisplay(collectedWei, 6)} ETH`}
                    hint="Lifetime contributions, all campaigns"
                    accent="var(--color-success)"
                  />
                  <StatTile
                    label="Escrow still locked"
                    value={`${formatEthDisplay(escrowWei, 6)} ETH`}
                    hint="Not yet released to creators"
                  />
                  <StatTile
                    label="Treasury fees"
                    value={chain ? `${formatEthDisplay(chain.treasuryFeesWei, 6)} ETH` : "—"}
                    hint="Campaign creation is free"
                  />
                </div>
                <p className="mt-3 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  A campaign&apos;s collected total counts every contribution it ever received. The
                  contract balance is the ETH physically still held there — collected funds that have
                  already been released for milestones, refunded to donors or withdrawn as fees are no
                  longer part of it. A deactivated campaign is still holding its escrow until its donors
                  refund it, so it keeps counting towards these totals.
                </p>
              </>
            )}
          </div>

          {/* ─── Per-campaign sections ─── */}
          <div className="card rounded-2xl p-5 mt-6">
            <SectionTitle
              title="Campaigns"
              description="Collected balance, deadline and the contributors behind each campaign"
              right={
                campaigns.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                      Showing {visibleCampaigns.length} of {campaigns.length}
                    </span>
                    {deactivatedCampaigns.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowDeactivated((value) => !value)}
                      >
                        {showDeactivated
                          ? `Hide deactivated (${deactivatedCampaigns.length})`
                          : `Show deactivated (${deactivatedCampaigns.length})`}
                      </button>
                    )}
                  </div>
                ) : null
              }
            />

            {campaignsQuery.isLoading ? (
              <LoadingState rows={3} height="h-24" label="Reading campaign balances" />
            ) : campaignsQuery.error ? (
              <ErrorState
                error={campaignsQuery.error}
                onRetry={campaignsQuery.refetch}
                title={
                  campaignsQuery.error?.status === 401 || campaignsQuery.error?.status === 403
                    ? "Not authorized"
                    : "Could not load campaigns"
                }
              />
            ) : campaigns.length === 0 ? (
              <EmptyState
                icon={<FiLayers className="h-8 w-8" style={{ color: "var(--color-text-muted)" }} />}
                title="No campaigns found"
                description="Nothing has been indexed for this deployment yet. Run a sync from the admin overview so the indexer can discover campaigns from contract events."
              />
            ) : (
              <div className="space-y-4">
                {visibleCampaigns.length === 0 && (
                  <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    Every campaign for this deployment is deactivated — use “Show deactivated” to list
                    them and their escrow.
                  </p>
                )}
                {visibleCampaigns.map((campaign) => {
                  const funding = campaign.funding || {};
                  const escrow = campaign.escrow || {};
                  const milestones = campaign.milestones || {};
                  const percent = Math.max(0, Math.min(100, Number(funding.progressPercent) || 0));
                  const entry = contributionsByCampaign[campaign.campaignId];
                  const rows = entry?.transactions || [];
                  const listedWei = rows.reduce((sum, row) => sum + toBigInt(row.amountWei), 0n);
                  const totalRecords = entry?.total ?? rows.length;

                  return (
                    <section
                      key={campaign.campaignId}
                      className="rounded-2xl border p-4"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {/* Campaign header */}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                            <span
                              className="font-mono text-xs"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              #{campaign.campaignId}
                            </span>{" "}
                            {campaign.title || `Campaign #${campaign.campaignId}`}
                          </p>
                          <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                            Deadline:{" "}
                            <strong style={{ color: "var(--color-text-secondary)" }}>
                              {campaign.deadline ? formatDate(campaign.deadline) : "—"}
                            </strong>{" "}
                            ·{" "}
                            {campaign.active === false
                              ? "deactivated by an administrator"
                              : campaign.status || "—"}
                            {campaign.creator ? (
                              <span className="font-mono"> · creator {formatAddress(campaign.creator)}</span>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`badge ${
                              campaign.active === false
                                ? "badge-error"
                                : campaign.completed
                                ? "badge-success"
                                : funding.funded
                                ? "badge-warning"
                                : "badge-neutral"
                            }`}
                          >
                            {campaign.active === false
                              ? "Deactivated"
                              : campaign.completed
                              ? "Completed"
                              : funding.funded
                              ? "Target reached"
                              : "Fundraising"}
                          </span>
                          <span className="badge badge-neutral">
                            {milestones.releasedMilestones ?? 0}/
                            {milestones.items?.length ?? 3} milestones released
                          </span>
                          <Link
                            href={`/campaign/${campaign.campaignId}`}
                            className="btn btn-ghost btn-sm"
                          >
                            Open campaign <FiExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>

                      {/* Balance summary */}
                      <div
                        className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        <span>
                          Collected: {amountCell(funding.collectedEth ?? "0")}
                          {funding.targetEth ? (
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {" "}
                              of {funding.targetEth}
                            </span>
                          ) : null}
                        </span>
                        <span>
                          Progress:{" "}
                          <strong style={{ color: "var(--color-text)" }}>{percent.toFixed(1)}%</strong>
                        </span>
                        <span>
                          Released: {amountCell(escrow.releasedEth ?? "0")}
                        </span>
                        <span>
                          Escrow left: {amountCell(escrow.escrowEth ?? "0")}
                        </span>
                      </div>

                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded-full"
                        style={{ background: "var(--color-surface-raised)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${percent}%`, background: progressTone(percent) }}
                        />
                      </div>

                      {/* Contributors */}
                      <p
                        className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold"
                        style={{ color: "var(--color-text)" }}
                      >
                        Contributors
                        <span className="badge badge-neutral">{totalRecords}</span>
                        {rows.length > 0 && (
                          <span
                            className="text-[11px] font-normal"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            listed {formatEthDisplay(listedWei, 6)} ETH
                            {totalRecords > rows.length
                              ? ` · showing the latest ${rows.length} of ${totalRecords}`
                              : ""}
                          </span>
                        )}
                      </p>

                      {entry?.error ? (
                        <p className="mt-2 text-[11px]" style={{ color: "var(--color-error)" }}>
                          {entry.error}
                        </p>
                      ) : contributionsQuery.isLoading ? (
                        <div className="mt-2">
                          <LoadingState rows={2} height="h-8" label="Loading contributions" />
                        </div>
                      ) : rows.length === 0 ? (
                        <p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                          No indexed contribution for this campaign yet.
                        </p>
                      ) : (
                        <>
                          {/* Desktop table */}
                          <div className="mt-2 hidden overflow-x-auto md:block">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr style={{ color: "var(--color-text-muted)" }}>
                                  <th className="px-2 py-2 font-medium">Contributor</th>
                                  <th className="px-2 py-2 font-medium">Amount</th>
                                  <th className="px-2 py-2 font-medium">Date &amp; time</th>
                                  <th className="px-2 py-2 font-medium">Status</th>
                                  <th className="px-2 py-2 font-medium">Explorer</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row) => (
                                  <tr
                                    key={`${row.txHash}-${row.logIndex}`}
                                    className="border-t"
                                    style={{ borderColor: "var(--color-border)" }}
                                  >
                                    <td className="px-2 py-2">
                                      {row.donorName && (
                                        <p
                                          className="font-semibold"
                                          style={{ color: "var(--color-text)" }}
                                        >
                                          {row.donorName}
                                          {row.cfUserId && (
                                            <span
                                              className="ml-2 font-mono text-[10px]"
                                              style={{ color: "var(--color-text-muted)" }}
                                            >
                                              {row.cfUserId}
                                            </span>
                                          )}
                                        </p>
                                      )}
                                      <p
                                        className={`font-mono ${
                                          row.donorName ? "text-[11px]" : "font-semibold"
                                        }`}
                                        style={{
                                          color: row.donorName
                                            ? "var(--color-text-secondary)"
                                            : "var(--color-text)",
                                        }}
                                        title={row.donorWallet || ""}
                                      >
                                        {row.donorWallet ? formatAddress(row.donorWallet) : "—"}
                                      </p>
                                    </td>
                                    <td className="px-2 py-2 font-semibold" style={{ color: "var(--color-text)" }}>
                                      {row.amountEth} ETH
                                    </td>
                                    <td className="px-2 py-2" style={{ color: "var(--color-text-secondary)" }}>
                                      {formatDate(row.timestamp)}
                                    </td>
                                    <td className="px-2 py-2">
                                      <StatusPill status={row.status} />
                                    </td>
                                    <td className="px-2 py-2">
                                      <a
                                        href={row.explorerUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-ghost btn-sm"
                                        title={row.txHash}
                                      >
                                        {row.txHash.slice(0, 10)}… <FiExternalLink className="h-3 w-3" />
                                      </a>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Mobile */}
                          <div className="mt-2 space-y-2 md:hidden">
                            {rows.map((row) => (
                              <div
                                key={`${row.txHash}-${row.logIndex}`}
                                className="rounded-xl p-3"
                                style={{ background: "var(--color-surface-raised)" }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="min-w-0">
                                    {row.donorName && (
                                      <span
                                        className="block truncate text-xs font-semibold"
                                        style={{ color: "var(--color-text)" }}
                                      >
                                        {row.donorName}
                                      </span>
                                    )}
                                    <span
                                      className="block truncate font-mono text-xs"
                                      style={{ color: "var(--color-text-secondary)" }}
                                    >
                                      {row.donorWallet ? formatAddress(row.donorWallet) : row.cfUserId || "—"}
                                    </span>
                                  </span>
                                  <StatusPill status={row.status} />
                                </div>
                                <p className="mt-1 text-xs" style={{ color: "var(--color-text)" }}>
                                  {row.amountEth} ETH · {formatDate(row.timestamp)}
                                </p>
                                <a
                                  href={row.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-secondary btn-sm mt-2"
                                >
                                  View transaction <FiExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </AdminGate>
      </div>
    </Layout>
  );
}

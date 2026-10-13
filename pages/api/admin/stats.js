/**
 * GET /api/admin/stats
 *
 * Overview for the admin dashboard: registered users (total / new in 7 days /
 * with a connected wallet), indexed donation volume, escrow held by the contract
 * and indexer health.
 *
 * The contract balance covers every campaign at once, so it is reported as
 * "contract balance", never as one campaign's escrow. Per-campaign escrow lives in
 * /api/admin/campaigns.
 */
import { db } from "../../../lib/db/index.js";
import { requireAdmin } from "../../../lib/auth/identity.js";
import { getChainConfig } from "../../../lib/chain/config.js";
import { indexerStatus } from "../../../lib/chain/indexer.js";
import { getReadContract, withTimeout } from "../../../lib/chain/provider.js";
import { methodNotAllowed, privateNoStore, serverError } from "../../../lib/api/http.js";
import { formatEthDisplay } from "../../../lib/format.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    db.init();
    privateNoStore(res);

    const guard = await requireAdmin(req);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error, hint: guard.hint });

    const config = getChainConfig();
    const now = Math.floor(Date.now() / 1000);

    const totals = db.chainEvents.transactionTotals({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
    });

    const users = {
      total: db.users.countUsers(),
      admins: db.users.countAdminUsers(),
      last7Days: countUsersSince(now - 7 * 24 * 60 * 60),
      last24Hours: countUsersSince(now - 24 * 60 * 60),
      withWallet: countUsersWithWallet(),
    };

    const chain = await contractSummary();

    return res.status(200).json({
      users,
      donations: {
        confirmedCount: totals.confirmedDonations,
        confirmedWei: totals.confirmedWei,
        confirmedEth: formatEthDisplay(totals.confirmedWei, 6),
        pendingCount: totals.pendingDonations,
        refundedWei: totals.refundedWei,
        refundedEth: formatEthDisplay(totals.refundedWei, 6),
        rewardEligibleWei: totals.rewardEligibleWei,
        eventsByType: totals.eventsByType,
      },
      campaigns: {
        cached: db.campaigns.listCampaigns({ limit: 500 }).length,
        onChainTotal: chain?.totalCampaigns ?? null,
      },
      chain,
      indexer: indexerStatus(),
      network: {
        chainId: config.chainId,
        explorerName: config.explorerName,
        contractAddress: config.contractAddress,
      },
      generatedAt: now,
    });
  } catch (error) {
    return serverError(res, error, "admin-stats");
  }
}

function countUsersSince(since) {
  const row = db.driver.getRow(
    "SELECT COUNT(*) AS total FROM users WHERE status = 'active' AND registered_at >= ?",
    [since]
  );
  return Number(row?.total || 0);
}

function countUsersWithWallet() {
  const row = db.driver.getRow(
    "SELECT COUNT(*) AS total FROM users WHERE status = 'active' AND wallet_address IS NOT NULL"
  );
  return Number(row?.total || 0);
}

async function contractSummary() {
  try {
    const contract = getReadContract();
    if (!contract) return null;

    const [stats, balance] = await Promise.all([
      withTimeout(contract.getContractStats(), 10000, "getContractStats"),
      withTimeout(contract.provider.getBalance(contract.address), 10000, "getBalance"),
    ]);

    return {
      totalCampaigns: Number(stats[0].toString()),
      treasuryFeesWei: stats[1].toString(),
      contractBalanceWei: balance.toString(),
      contractBalanceEth: formatEthDisplay(balance.toString(), 6),
      paused: typeof contract.paused === "function" ? await safeCall(() => contract.paused()) : null,
      owner: typeof contract.owner === "function" ? await safeCall(() => contract.owner()) : null,
    };
  } catch (error) {
    console.warn("[admin-stats] chain read failed:", error?.message);
    return null;
  }
}

async function safeCall(fn) {
  try {
    return await withTimeout(fn(), 8000, "chain call");
  } catch {
    return null;
  }
}

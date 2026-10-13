/**
 * On-chain event indexer.
 *
 * The deployed contract already emits everything the donation activity and admin
 * transaction views need, so no contract change was required for that part:
 *
 *   ContributionMade(campaignId, contributor, amount)   → donations
 *   RefundIssued(campaignId, contributor, amount)       → refunds (reverses rewards)
 *   CampaignCreated / MilestoneEvidenceSubmitted / MilestoneVoted /
 *   MilestoneApproved / MilestoneFundsReleased / CampaignCompleted
 *                                                       → additional categories
 *
 * Rules that keep the data honest:
 *  - A log only exists if the transaction succeeded, and every row additionally
 *    stores its confirmation count; a row below CF_CONFIRMATIONS_REQUIRED is
 *    stored as `pending` and never shown or rewarded as a confirmed donation.
 *  - Rows are keyed by (chain, contract, tx hash, log index) with a UNIQUE index,
 *    so re-indexing the same range can never duplicate a donation.
 *  - Amounts and timestamps come from the event and its block, never from the UI.
 */
import { db } from "../db/index.js";
import { syncRewardLedger } from "../rewards/index.js";
import { getChainConfig } from "./config.js";
import { getReadContract, invalidateCache, withTimeout } from "./provider.js";
import { refreshCampaignCache } from "./campaignState.js";

const DEFAULT_CHUNK_SIZE = 2000;
const MIN_CHUNK_SIZE = 25;
const SYNC_LOCK_MS = 60 * 1000;

function syncKey(config) {
  return `index:${config.chainId}:${config.contractAddress}`;
}

function lockKey(config) {
  return `lock:${config.chainId}:${config.contractAddress}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** Only one indexer run per contract at a time (the admin button may be clicked twice). */
function acquireLock(config) {
  const state = db.chainEvents.getSyncState(lockKey(config));
  if (state && Number(state.value) > nowSeconds() - Math.ceil(SYNC_LOCK_MS / 1000)) {
    return false;
  }
  db.chainEvents.setSyncState(lockKey(config), String(nowSeconds()));
  return true;
}

function releaseLock(config) {
  db.chainEvents.setSyncState(lockKey(config), "0");
}

function toBigInt(value) {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function isRangeError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("more than") ||
    message.includes("limit") ||
    message.includes("range") ||
    message.includes("too many") ||
    message.includes("result set") ||
    message.includes("exceed")
  );
}

async function fetchLogs(contract, filter, fromBlock, toBlock, state) {
  let chunkSize = state.chunkSize;
  const logs = [];
  let cursor = fromBlock;

  while (cursor <= toBlock) {
    const end = Math.min(cursor + chunkSize - 1, toBlock);
    try {
      const batch = await withTimeout(
        contract.queryFilter(filter, cursor, end),
        30000,
        `queryFilter(${cursor}-${end})`
      );
      logs.push(...batch);
      cursor = end + 1;
      state.chunkSize = Math.min(DEFAULT_CHUNK_SIZE, Math.max(chunkSize, state.chunkSize));
    } catch (error) {
      if (isRangeError(error) && chunkSize > MIN_CHUNK_SIZE) {
        chunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(chunkSize / 2));
        state.chunkSize = chunkSize;
        continue;
      }
      // Skip the block that keeps failing but keep the rest of the range usable.
      state.errors.push(`block ${cursor}-${end}: ${error?.message || error}`);
      cursor = end + 1;
    }
  }

  return logs;
}

async function blockTimestamp(provider, blockNumber, cache) {
  if (cache.has(blockNumber)) return cache.get(blockNumber);
  try {
    const block = await withTimeout(provider.getBlock(blockNumber), 15000, "getBlock");
    const timestamp = Number(block?.timestamp || 0);
    cache.set(blockNumber, timestamp);
    if (cache.size > 2000) cache.clear();
    return timestamp;
  } catch {
    return 0;
  }
}

const EVENT_DEFINITIONS = [
  { name: "CampaignCreated", type: "campaign_created" },
  { name: "ContributionMade", type: "contribution" },
  { name: "RefundIssued", type: "refund" },
  { name: "MilestoneEvidenceSubmitted", type: "milestone_evidence" },
  { name: "MilestoneVoted", type: "milestone_vote" },
  { name: "MilestoneApproved", type: "milestone_approved" },
  { name: "MilestoneFundsReleased", type: "milestone_released" },
  { name: "CampaignCompleted", type: "campaign_completed" },
];

function extractCampaignId(args) {
  const raw = args?.campaignId ?? args?.[0];
  if (raw === undefined || raw === null) return null;
  try {
    return Number(raw.toString());
  } catch {
    return null;
  }
}

function buildEventRecord({ definition, parsed, log, config, timestamp, confirmations, campaignName, userId }) {
  const args = parsed.args;
  const campaignId = extractCampaignId(args);

  const base = {
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    transactionIndex: log.transactionIndex ?? 0,
    blockTimestamp: timestamp,
    eventType: definition.type,
    campaignId,
    campaignName: campaignName || null,
    status: confirmations >= config.confirmationsRequired ? "confirmed" : "pending",
    confirmations,
    userId,
  };

  switch (definition.type) {
    case "contribution":
      return {
        ...base,
        actorAddress: args.contributor,
        donorWallet: args.contributor,
        amountWei: toBigInt(args.amount).toString(),
        rewardEligible: true,
      };
    case "refund":
      return {
        ...base,
        actorAddress: args.contributor,
        donorWallet: args.contributor,
        amountWei: toBigInt(args.amount).toString(),
        rewardEligible: false,
      };
    case "campaign_created":
      return {
        ...base,
        actorAddress: args.creator,
        amountWei: toBigInt(args.targetAmount).toString(),
        extra: {
          targetAmountWei: toBigInt(args.targetAmount).toString(),
          deadline: Number(args.deadline ?? 0),
          metadataHash: args.metadataHash || null,
        },
      };
    case "milestone_evidence":
      return {
        ...base,
        extra: {
          milestoneIndex: Number(args.milestoneIndex ?? 0),
          evidenceCID: args.evidenceCID || null,
          votingPowerWei: toBigInt(args.votingPower).toString(),
        },
      };
    case "milestone_vote":
      return {
        ...base,
        actorAddress: args.contributor,
        extra: {
          milestoneIndex: Number(args.milestoneIndex ?? 0),
          approved: Boolean(args.approved),
        },
      };
    case "milestone_approved":
      return {
        ...base,
        extra: {
          milestoneIndex: Number(args.milestoneIndex ?? 0),
          approvalWeightWei: toBigInt(args.approvalWeight).toString(),
          rejectionWeightWei: toBigInt(args.rejectionWeight).toString(),
        },
      };
    case "milestone_released":
      return {
        ...base,
        amountWei: toBigInt(args.amount).toString(),
        extra: { milestoneIndex: Number(args.milestoneIndex ?? 0) },
      };
    case "campaign_completed":
      return {
        ...base,
        actorAddress: args.creator,
        amountWei: toBigInt(args.totalReleased).toString(),
        extra: { totalReleasedWei: toBigInt(args.totalReleased).toString() },
      };
    default:
      return base;
  }
}

/**
 * Index events for the configured contract.
 *
 * mode "recent" (default): continue from the last indexed block, or scan the
 * configured lookback window on the first run. mode "deep": scan from
 * CF_INDEX_START_BLOCK (or 5× the lookback) to backfill the whole history.
 */
export async function syncChainEvents({ mode = "recent", maxBlocks = null } = {}) {
  db.init();
  const config = getChainConfig();

  if (!config.contractAddress) {
    return { ok: false, reason: "no-contract-address", inserted: 0, scanned: null };
  }

  if (!acquireLock(config)) {
    return { ok: false, reason: "sync-already-running", inserted: 0, scanned: null };
  }

  const contract = getReadContract();
  if (!contract) {
    releaseLock(config);
    return { ok: false, reason: "no-contract-instance", inserted: 0, scanned: null };
  }

  const provider = contract.provider;
  const state = { chunkSize: DEFAULT_CHUNK_SIZE, errors: [] };

  try {
    const latest = await withTimeout(provider.getBlockNumber(), 15000, "getBlockNumber");
    const previous = db.chainEvents.getSyncState(syncKey(config));
    const previousBlock = previous ? Number(previous.value) : null;

    let fromBlock;
    if (mode === "deep") {
      fromBlock =
        config.indexStartBlock > 0
          ? config.indexStartBlock
          : Math.max(0, latest - config.lookbackBlocks * 5);
    } else if (previousBlock !== null && previousBlock < latest) {
      fromBlock = previousBlock + 1;
    } else if (previousBlock !== null) {
      fromBlock = latest; // already up to date; still re-check the tip
    } else {
      fromBlock = Math.max(0, latest - config.lookbackBlocks);
    }

    if (maxBlocks && latest - fromBlock > maxBlocks) {
      fromBlock = latest - maxBlocks;
    }

    const toBlock = latest;
    const timestampCache = new Map();
    const campaignIds = new Set();
    const affectedUsers = new Set();
    const rawEvents = [];

    for (const definition of EVENT_DEFINITIONS) {
      const filterFactory = contract.filters?.[definition.name];
      if (!filterFactory) continue;

      const logs = await fetchLogs(contract, filterFactory(), fromBlock, toBlock, state);
      for (const log of logs) {
        let parsed;
        try {
          parsed = contract.interface.parseLog(log);
        } catch (error) {
          state.errors.push(`decode ${log.transactionHash}#${log.logIndex}: ${error?.message}`);
          continue;
        }
        if (!parsed) continue;

        const campaignId = extractCampaignId(parsed.args);
        if (campaignId) campaignIds.add(campaignId);

        rawEvents.push({ definition, parsed, log, campaignId });
      }
    }

    // Deterministic ordering: refunds must be applied after the contributions they
    // belong to, and reward accounting must see contributions first.
    rawEvents.sort((a, b) => {
      if (a.log.blockNumber !== b.log.blockNumber) return a.log.blockNumber - b.log.blockNumber;
      return (a.log.logIndex ?? 0) - (b.log.logIndex ?? 0);
    });

    // Refresh campaign labels before writing events so every row carries a name.
    if (campaignIds.size > 0) {
      try {
        await refreshCampaignCache([...campaignIds]);
      } catch (error) {
        state.errors.push(`campaign cache: ${error?.message}`);
      }
    }

    let inserted = 0;
    let updated = 0;
    let refundsApplied = 0;

    for (const item of rawEvents) {
      const { definition, parsed, log, campaignId } = item;

      const existing = db.chainEvents.getEventByKey({
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
      });

      const timestamp = await blockTimestamp(provider, log.blockNumber, timestampCache);
      const confirmations = Math.max(0, latest - log.blockNumber + 1);
      const cachedCampaign = campaignId
        ? db.campaigns.getCampaign(config.chainId, config.contractAddress, campaignId)
        : null;

      const actor = parsed.args.contributor || parsed.args.creator || null;
      const linkedUser = actor ? db.users.getUserByWallet(actor) : null;

      const record = buildEventRecord({
        definition,
        parsed,
        log,
        config,
        timestamp,
        confirmations,
        campaignName: cachedCampaign?.title || existing?.campaign_name || null,
        userId: linkedUser ? Number(linkedUser.id) : existing?.user_id ?? null,
      });

      db.chainEvents.upsertChainEvent(record);
      if (existing) updated += 1;
      else inserted += 1;

      if (record.userId) affectedUsers.add(Number(record.userId));

      // A refund only reverses rewards once it is confirmed — an unconfirmed refund
      // must not change reward eligibility.
      if (definition.type === "refund" && campaignId && record.status === "confirmed") {
        const donorUser = db.users.getUserByWallet(parsed.args.contributor);
        refundsApplied += db.chainEvents.markContributionsRefunded({
          chainId: config.chainId,
          contractAddress: config.contractAddress,
          campaignId,
          donorWallet: parsed.args.contributor,
          at: timestamp || nowSeconds(),
        });
        if (donorUser) affectedUsers.add(Number(donorUser.id));
      }
    }

    // Attach profiles to donations that arrived before the wallet was linked, and
    // rebuild the reward ledger for everyone who was touched by this batch.
    db.chainEvents.linkEventOwners();

    let rewarded = { awarded: 0, reversed: 0 };
    if (affectedUsers.size > 0) {
      for (const userId of affectedUsers) {
        const user = db.users.getUserById(userId);
        const result = syncRewardLedger({ userId, walletAddress: user?.wallet_address || null });
        rewarded = {
          awarded: rewarded.awarded + result.awarded,
          reversed: rewarded.reversed + result.reversed,
        };
      }
    }

    // The HTTP cache in front of the RPC holds pre-sync reads; drop it after a sync
    // so the next request re-reads chain state.
    invalidateCache();
    db.chainEvents.setSyncState(syncKey(config), String(toBlock));

    return {
      ok: true,
      mode,
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      scanned: { from: fromBlock, to: toBlock, blocks: toBlock - fromBlock + 1 },
      events: { total: rawEvents.length, inserted, updated },
      campaigns: campaignIds.size,
      refundsApplied,
      rewards: rewarded,
      errors: state.errors.slice(0, 10),
      syncedAt: nowSeconds(),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || "sync-failed",
      inserted: 0,
      scanned: null,
      errors: [...state.errors, String(error?.message || error)].slice(0, 10),
    };
  } finally {
    releaseLock(config);
  }
}

/**
 * Throttled background refresh used by the read-only public endpoints so donation
 * activity stays current without hammering the RPC on every request. Failures are
 * swallowed: a stale list is better than a broken page.
 */
export async function maybeAutoSync({ intervalSeconds = 60 } = {}) {
  db.init();
  const config = getChainConfig();
  const key = `autosync:${config.chainId}:${config.contractAddress}`;
  const state = db.chainEvents.getSyncState(key);
  const now = nowSeconds();

  if (state && Number(state.value) > now - intervalSeconds) {
    return { ok: true, skipped: true, lastRunAt: Number(state.value) };
  }

  db.chainEvents.setSyncState(key, String(now));
  try {
    const result = await syncChainEvents({ mode: "recent", maxBlocks: config.lookbackBlocks });
    return result;
  } catch (error) {
    console.warn("[indexer] auto sync failed:", error?.message);
    return { ok: false, reason: error?.message || "auto-sync-failed" };
  }
}

/** Indexer status for the admin dashboard. */
export function indexerStatus() {
  const config = getChainConfig();
  const state = db.chainEvents.getSyncState(syncKey(config));
  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    lastIndexedBlock: state ? Number(state.value) : null,
    updatedAt: state?.updatedAt || null,
    confirmationsRequired: config.confirmationsRequired,
  };
}

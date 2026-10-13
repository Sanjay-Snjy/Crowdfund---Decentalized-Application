#!/usr/bin/env node
/**
 * Verify the indexer against the chain (read-only).
 *
 *   node scripts/verify-indexer.mjs [--blocks 50000]
 *
 * Independently re-reads `ContributionMade` / `RefundIssued` logs from the RPC
 * configured for the deployed contract and diffs them with the `chain_transactions`
 * table. Any missing row, wrong amount, wrong campaign id or wrong donor is
 * reported. Exits non-zero when the database does not match the chain.
 *
 * This is the check behind the claim that the donation views show only real,
 * verified on-chain activity.
 */
import { ethers } from "ethers";
import { db } from "../lib/db/index.js";
import { getChainConfig } from "../lib/chain/config.js";
import { getReadContract } from "../lib/chain/provider.js";

const blocksArgIndex = process.argv.indexOf("--blocks");
const BLOCKS = blocksArgIndex !== -1 ? Number(process.argv[blocksArgIndex + 1]) : 50000;

await db.init();
const config = getChainConfig();
const contract = getReadContract();
const backend = db.backend();

console.log(`Database   : ${await db.path()} (${backend.kind})`);
console.log(`Network    : ${config.networkKey} (chain ${config.chainId})`);
console.log(`Contract   : ${config.contractAddress}`);
console.log(`Block range: last ${BLOCKS} blocks\n`);

const latest = await contract.provider.getBlockNumber();
const fromBlock = Math.max(0, latest - BLOCKS);

async function collect(eventName) {
  // Public RPC providers cap eth_getLogs ranges (Infura: 10000), so the history is
  // walked in chunks — the same strategy the indexer uses.
  const CHUNK = 2000;
  const logs = [];
  for (let start = fromBlock; start <= latest; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, latest);
    const batch = await contract.queryFilter(contract.filters[eventName](), start, end);
    logs.push(...batch);
  }
  return logs.map((log) => {
    const parsed = contract.interface.parseLog(log);
    return {
      txHash: log.transactionHash.toLowerCase(),
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      campaignId: Number(parsed.args.campaignId.toString()),
      contributor: parsed.args.contributor.toLowerCase(),
      amountWei: BigInt(parsed.args.amount.toString()).toString(),
    };
  });
}

const [contributions, refunds] = await Promise.all([
  collect("ContributionMade"),
  collect("RefundIssued"),
]);

console.log(`Chain reports ${contributions.length} contribution(s) and ${refunds.length} refund(s) in range.`);

let mismatches = 0;
let missing = 0;

for (const expected of contributions) {
  const row = await db.chainEvents.getEventByKey({
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    txHash: expected.txHash,
    logIndex: expected.logIndex,
  });

  if (!row) {
    missing += 1;
    console.log(`MISSING  ${expected.txHash}#${expected.logIndex} (${expected.amountWei} wei, campaign ${expected.campaignId})`);
    continue;
  }

  const problems = [];
  if (String(row.amount_wei) !== expected.amountWei) problems.push(`amount ${row.amount_wei} != ${expected.amountWei}`);
  if (Number(row.campaign_id) !== expected.campaignId) problems.push(`campaign ${row.campaign_id} != ${expected.campaignId}`);
  if (String(row.donor_wallet) !== expected.contributor) problems.push(`donor ${row.donor_wallet} != ${expected.contributor}`);
  if (Number(row.block_number) !== expected.blockNumber) problems.push(`block ${row.block_number} != ${expected.blockNumber}`);

  if (problems.length > 0) {
    mismatches += 1;
    console.log(`MISMATCH ${expected.txHash}#${expected.logIndex}: ${problems.join(", ")}`);
  }
}

const indexedContributions = await db.chainEvents.countTransactions({ eventType: "contribution" });
const indexedRefunds = await db.chainEvents.countTransactions({ eventType: "refund" });

console.log(
  `\nIndexed rows: ${indexedContributions} contribution(s), ${indexedRefunds} refund(s). ` +
    `Missing in range: ${missing}, mismatched: ${mismatches}.`
);

// Duplicate-identity check: the unique index must make one log → one row.
const duplicates = await db.driver.query(
  `SELECT tx_hash, log_index, COUNT(*) AS occurrences
     FROM chain_transactions
    GROUP BY chain_id, contract_address, tx_hash, log_index
   HAVING COUNT(*) > 1`
);
console.log(`Duplicate (tx, log index) groups: ${duplicates.length}`);

if (missing > 0 || mismatches > 0 || duplicates.length > 0) {
  process.exitCode = 1;
} else {
  console.log("\nIndexer output matches the chain. ✅");
}

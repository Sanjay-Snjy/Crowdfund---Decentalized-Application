import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

import { cleanup, useTempDatabase, ADDRESSES } from "./helpers.js";
import { createRpcStub } from "./rpc-stub.js";
import { CROWDFUNDING_ABI } from "../constants/abi.js";

const tempDir = useTempDatabase("crowdfund-indexer");
const iface = new ethers.utils.Interface(CROWDFUNDING_ABI);

const CONTRACT = "0x43cFa879c2dbC2C87353af41D0043b35fA24f484";
const CHAIN_ID = 11155111;
const DONOR_A = "0x4444444444444444444444444444444444444444";
const DONOR_B = "0x5555555555555555555555555555555555555555";
const CREATOR = "0x6666666666666666666666666666666666666666";
const DEADLINE = 1790000000;

function makeLog({ event, values, blockNumber, logIndex = 0, txHash, address = CONTRACT }) {
  const encoded = iface.encodeEventLog(iface.getEvent(event), values);
  return {
    address,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber,
    blockHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex,
    removed: false,
  };
}

const eth = (value) => ethers.utils.parseEther(String(value));

const scenarioLogs = [
  makeLog({
    event: "CampaignCreated",
    values: [1, CREATOR, eth("1"), DEADLINE, "QmCampaignOne"],
    blockNumber: 990,
    txHash: "0x" + "11".repeat(32),
  }),
  makeLog({
    event: "ContributionMade",
    values: [1, DONOR_A, eth("0.4")],
    blockNumber: 995,
    txHash: "0x" + "aa".repeat(32),
  }),
  makeLog({
    event: "ContributionMade",
    values: [1, DONOR_B, eth("0.2")],
    blockNumber: 996,
    logIndex: 3,
    txHash: "0x" + "bb".repeat(32),
  }),
  makeLog({
    event: "ContributionMade",
    values: [2, DONOR_A, eth("0.1")],
    blockNumber: 997,
    txHash: "0x" + "cc".repeat(32),
  }),
  makeLog({
    event: "MilestoneFundsReleased",
    values: [1, 0, eth("0.18")],
    blockNumber: 998,
    txHash: "0x" + "dd".repeat(32),
  }),
  makeLog({
    event: "RefundIssued",
    values: [2, DONOR_A, eth("0.1")],
    blockNumber: 999,
    txHash: "0x" + "ee".repeat(32),
  }),
];

let stub;
let repo;
let mainRpcUrl;

test.before(async () => {
  stub = createRpcStub({ chainId: CHAIN_ID, latestBlock: 1000, logs: scenarioLogs });
  const url = await stub.listen();
  mainRpcUrl = url;

  process.env.NEXT_PUBLIC_NETWORK = "sepolia";
  process.env.NEXT_PUBLIC_CHAIN_ID = String(CHAIN_ID);
  process.env.NEXT_PUBLIC_RPC_URL = url;
  process.env.CF_CONTRACT_ADDRESS = CONTRACT;
  process.env.CF_INDEX_START_BLOCK = "0";
  process.env.CF_INDEX_LOOKBACK_BLOCKS = "5000";
  process.env.CF_CONFIRMATIONS_REQUIRED = "1";

  const dbModule = await import("../lib/db/index.js");
  repo = {
    module: dbModule,
    db: dbModule.db,
    indexer: await import("../lib/chain/indexer.js"),
    rewards: await import("../lib/rewards/index.js"),
  };

  repo.db.init();
});

test.after(async () => {
  if (stub) await stub.close();
  cleanup(tempDir);
});

test("indexes real contract events into verified donation records", async () => {
  // Donor A has a CrowdFund profile with a linked wallet; donor B does not.
  const donorA = repo.db.users.ensureUserFromWallet({ address: DONOR_A, displayName: "Donor A" });
  repo.db.users.linkWalletToUser({ userId: donorA.id, address: DONOR_A });

  repo.db.campaigns.upsertCampaign({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    campaignId: 1,
    title: "Solar-Powered Smart Irrigation",
    creator: CREATOR,
    targetAmount: eth("1").toString(),
    raisedAmount: eth("0.6").toString(),
    deadline: DEADLINE,
    completed: false,
    active: true,
  });

  const result = await repo.indexer.syncChainEvents({ mode: "deep" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.events.total, scenarioLogs.length);
  assert.equal(result.events.inserted, scenarioLogs.length);

  const donations = repo.db.chainEvents.listRecentDonations({ limit: 10 });
  assert.equal(donations.length, 3, "only contributions become donation records");

  const newest = donations[0];
  assert.equal(newest.campaignId, 2);
  assert.equal(newest.amountWei, eth("0.1").toString());
  assert.equal(newest.donorWallet, DONOR_A.toLowerCase());
  assert.equal(newest.status, "confirmed");
  assert.equal(newest.confirmations, 4);
  assert.ok(newest.txHash.startsWith("0x"), "the transaction hash is preserved");

  const campaignOne = repo.db.chainEvents.listRecentDonations({ campaignId: 1 });
  assert.equal(campaignOne.length, 2, "each donation is tied to its own campaign");
  assert.deepEqual(
    campaignOne.map((row) => row.amountWei).sort(),
    [eth("0.2").toString(), eth("0.4").toString()].sort()
  );
  assert.equal(campaignOne[0].campaignName, "Solar-Powered Smart Irrigation");

  const blockTimestamps = donations.map((row) => row.timestamp);
  assert.equal(
    blockTimestamps.every((value) => value > 0),
    true,
    "block timestamps are read from the chain"
  );
});

test("donations from wallets without a profile keep the raw wallet and get no CrowdFund ID", () => {
  const donations = repo.db.chainEvents.listRecentDonations({ limit: 10 });
  const fromB = donations.find((row) => row.donorWallet === DONOR_B.toLowerCase());

  assert.ok(fromB);
  assert.equal(fromB.cfUserId, null, "an unlinked wallet must not receive a fabricated CrowdFund ID");

  const fromA = donations.find((row) => row.donorWallet === DONOR_A.toLowerCase());
  assert.equal(fromA.cfUserId, "CF-0001", "a linked wallet resolves to its CrowdFund User ID");
});

test("re-indexing the same range never duplicates a donation", async () => {
  const before = repo.db.chainEvents.countTransactions({ eventType: "contribution" });
  const result = await repo.indexer.syncChainEvents({ mode: "deep" });
  const after = repo.db.chainEvents.countTransactions({ eventType: "contribution" });

  assert.equal(result.events.inserted, 0, "nothing is inserted twice");
  assert.equal(after, before, "the donation count is unchanged");
});

test("refunds reverse reward eligibility for the refunded contribution", () => {
  const donations = repo.db.chainEvents.listRecentDonations({ limit: 10 });
  const refunded = donations.find((row) => row.campaignId === 2);
  const stillEligible = donations.find((row) => row.campaignId === 1 && row.donorWallet === DONOR_A.toLowerCase());

  assert.equal(refunded.rewardEligible, false, "a refunded contribution stops earning rewards");
  assert.ok(refunded.refundedAt > 0, "the refund timestamp is recorded");
  assert.equal(stillEligible.rewardEligible, true);
});

test("rewards are computed only from confirmed, non-refunded contributions", () => {
  const donorA = repo.db.users.getUserByWallet(DONOR_A);
  const rewards = repo.rewards.computeRewards({ userId: donorA.id, walletAddress: DONOR_A });

  assert.equal(rewards.points, 400, "0.4 ETH eligible volume at 1000 points/ETH");
  assert.equal(rewards.eligibleWei, eth("0.4").toString());
  assert.equal(rewards.campaignsSupported, 1, "the refunded campaign no longer counts");

  const badges = Object.fromEntries(rewards.badges.map((badge) => [badge.id, badge.earned]));
  assert.equal(badges.supporter, true);
  assert.equal(badges.silver, false, "0.4 ETH is below the 0.5 ETH silver threshold");
  assert.equal(badges.gold, false);
  assert.equal(badges.platinum, false);

  const refundedRow = rewards.breakdown.find((row) => row.refunded);
  assert.ok(refundedRow, "the refunded contribution is visible in the breakdown");
  assert.equal(refundedRow.points, 0);
});

test("the reward ledger is idempotent and holds one row per eligible contribution", () => {
  const donorA = repo.db.users.getUserByWallet(DONOR_A);

  const first = repo.rewards.syncRewardLedger({ userId: donorA.id, walletAddress: DONOR_A });
  const second = repo.rewards.syncRewardLedger({ userId: donorA.id, walletAddress: DONOR_A });

  assert.equal(first.awarded, 0, "the indexer already awarded the eligible contribution");
  assert.equal(second.awarded, 0, "a second sync awards nothing new");

  const ledger = repo.db.driver.query(
    "SELECT reward_type, points, source_transaction_id, reversed_at FROM reward_events WHERE user_id = ?",
    [donorA.id]
  );

  assert.equal(ledger.length, 1, "only the eligible contribution is in the ledger");
  assert.equal(ledger[0].reward_type, "points");
  assert.equal(Number(ledger[0].points), 400);
  assert.equal(ledger[0].reversed_at, null, "an eligible contribution is not reversed");
  assert.equal(repo.rewards.rewardLedgerPoints(donorA.id), 400);
});

test("a contribution can never be awarded points twice (database constraint)", () => {
  const donorA = repo.db.users.getUserByWallet(DONOR_A);
  const ledger = repo.db.driver.query(
    "SELECT source_transaction_id FROM reward_events WHERE user_id = ?",
    [donorA.id]
  );
  assert.ok(ledger.length > 0);

  const sourceTransactionId = Number(ledger[0].source_transaction_id);

  // The UNIQUE (user_id, reward_type, source_transaction_id) index is what makes the
  // ledger idempotent; prove it by attempting a duplicate write.
  assert.throws(() =>
    repo.db.driver.run(
      `INSERT INTO reward_events (user_id, reward_type, points, source_transaction_id, created_at)
       VALUES (?, 'points', 1, ?, 0)`,
      [donorA.id, sourceTransactionId]
    )
  );
});

test("pending events are never counted as confirmed donations", async () => {
  const tipLogs = [
    ...scenarioLogs,
    makeLog({
      event: "ContributionMade",
      values: [1, DONOR_B, eth("0.05")],
      blockNumber: 1000,
      txHash: "0x" + "ff".repeat(32),
    }),
  ];

  const tipStub = createRpcStub({ chainId: CHAIN_ID, latestBlock: 1000, logs: tipLogs });
  const url = await tipStub.listen();
  process.env.NEXT_PUBLIC_RPC_URL = url;
  process.env.CF_CONFIRMATIONS_REQUIRED = "3";

  const { clearProvider } = await import("../lib/chain/provider.js");
  clearProvider();

  const result = await repo.indexer.syncChainEvents({ mode: "deep" });
  assert.equal(result.ok, true, JSON.stringify(result));

  const pending = repo.db.chainEvents.listTransactions(
    { status: "pending", eventType: "contribution" },
    { limit: 10 }
  );
  assert.equal(pending.length, 1, "the tip block is indexed as pending");
  assert.equal(pending[0].amountWei, eth("0.05").toString());

  const confirmedList = repo.db.chainEvents.listRecentDonations({ campaignId: 1, limit: 10 });
  assert.equal(
    confirmedList.some((row) => row.amountWei === eth("0.05").toString()),
    false,
    "a pending donation is not shown as a confirmed donation"
  );

  const donorB = repo.db.users.ensureUserFromWallet({ address: DONOR_B, displayName: "Donor B" });
  const rewards = repo.rewards.computeRewards({ userId: donorB.id, walletAddress: DONOR_B });
  assert.equal(rewards.points, 0, "pending contributions earn no points");
  assert.equal(rewards.eligibleWei, "0");

  await tipStub.close();
});

test("admin filters, search and totals work across campaigns", async () => {
  // Back to one confirmation (and the original stub), then re-sync so the tip row
  // graduates to confirmed.
  process.env.CF_CONFIRMATIONS_REQUIRED = "1";
  process.env.NEXT_PUBLIC_RPC_URL = mainRpcUrl;
  const { clearProvider } = await import("../lib/chain/provider.js");
  clearProvider();
  const resync = await repo.indexer.syncChainEvents({ mode: "deep" });
  assert.equal(resync.ok, true, JSON.stringify(resync));

  const all = repo.db.chainEvents.listTransactions({}, { limit: 50 });
  assert.ok(all.length >= 6, "every indexed category is stored");

  const byType = new Set(all.map((row) => row.eventType));
  assert.equal(byType.has("contribution"), true);
  assert.equal(byType.has("refund"), true);
  assert.equal(byType.has("milestone_released"), true);
  assert.equal(byType.has("campaign_created"), true);

  const onlyCampaignTwo = repo.db.chainEvents.listTransactions({ campaignId: 2 }, { limit: 50 });
  assert.equal(onlyCampaignTwo.every((row) => row.campaignId === 2), true);

  const byCfId = repo.db.chainEvents.listTransactions({ cfUserId: "CF-0001" }, { limit: 50 });
  assert.equal(byCfId.length > 0, true);
  assert.equal(byCfId.every((row) => row.cfUserId === "CF-0001"), true);

  const byHash = repo.db.chainEvents.listTransactions({ search: "aaaa" }, { limit: 50 });
  assert.equal(byHash.length, 1);
  assert.equal(byHash[0].txHash, "0x" + "aa".repeat(32));

  const byCampaignName = repo.db.chainEvents.listTransactions({ search: "solar" }, { limit: 50 });
  assert.equal(byCampaignName.length > 0, true);

  // The main stub serves three contributions (the tip-only log lived on the other stub).
  const totals = repo.db.chainEvents.transactionTotals({});
  assert.equal(totals.confirmedDonations, 3);
  assert.equal(totals.confirmedWei, eth("0.7").toString());
  assert.equal(totals.rewardEligibleWei, eth("0.6").toString(), "the refunded 0.1 ETH is excluded");
  // The 0.05 ETH row indexed from the other chain state stays `pending` (it no
  // longer exists in this stub's chain) and can never be shown as a donation.
  assert.equal(totals.pendingDonations, 1);

  const campaignTotals = repo.db.chainEvents.transactionTotals({ campaignId: 1 });
  assert.equal(campaignTotals.confirmedWei, eth("0.6").toString());

  const releases = repo.db.chainEvents.listFundReleases({ campaignId: 1 });
  assert.equal(releases.length, 1);
  assert.equal(releases[0].extra.milestoneIndex, 0);
  assert.equal(releases[0].amountWei, eth("0.18").toString());
});

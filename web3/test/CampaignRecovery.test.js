import assert from "node:assert/strict";
import { network } from "hardhat";

/**
 * Contract tests for the abandoned-campaign recovery mechanism.
 *
 * Run with:
 *     npm run test:recovery            (from the web3/ directory)
 *     npx hardhat run test/CampaignRecovery.test.js
 *
 * Same tiny mocha-compatible harness as CrowdfundingMarketplace.test.js — this
 * Hardhat 3 project only has the Solidity test runner installed.
 *
 * Covered behaviour:
 *  - recovery is never available before the target is reached or before the
 *    inactivity period plus grace period has elapsed;
 *  - recent milestone activity restarts the countdown (a slow creator is not
 *    punished while a release is still realistic);
 *  - donors can claim their pro-rata share of whatever escrow is left, exactly
 *    once, and the total can never exceed the escrow pool;
 *  - already released funds are accounted for;
 *  - once recovery starts, milestone releases, votes and refunds are closed;
 *  - a campaign that missed its target uses refunds (recovery stays unavailable);
 *  - existing access control is preserved (no unauthorized withdrawals).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Minimal mocha-compatible harness (identical approach to the existing suite)
// ─────────────────────────────────────────────────────────────────────────────
const ROOT_SUITE = { name: "", tests: [], suites: [], beforeEach: [] };
let currentSuite = ROOT_SUITE;

function describe(name, fn) {
  const suite = { name, tests: [], suites: [], beforeEach: [] };
  currentSuite.suites.push(suite);
  const parent = currentSuite;
  currentSuite = suite;
  try {
    fn();
  } finally {
    currentSuite = parent;
  }
}

function it(name, fn) {
  currentSuite.tests.push({ name, fn });
}

function beforeEach(fn) {
  currentSuite.beforeEach.push(fn);
}

const grepArgIndex = process.argv.indexOf("--grep");
const GREP = grepArgIndex !== -1 ? process.argv[grepArgIndex + 1] : null;

async function runSuite(suite, prefix, inheritedHooks, results) {
  const hooks = [...inheritedHooks, ...suite.beforeEach];
  const suiteName = prefix ? `${prefix} › ${suite.name}` : suite.name;

  for (const test of suite.tests) {
    const fullName = `${suiteName} › ${test.name}`;
    if (GREP && !fullName.toLowerCase().includes(GREP.toLowerCase())) continue;

    try {
      for (const hook of hooks) await hook();
      await test.fn();
      results.passed++;
      console.log(`    ✓ ${test.name}`);
    } catch (error) {
      results.failed++;
      results.failures.push({ name: fullName, error });
      console.log(`    ✗ ${test.name}`);
      console.log(`        ${String(error?.message || error).split("\n")[0]}`);
    }
  }

  for (const child of suite.suites) {
    console.log(`\n  ${suiteName ? `${suiteName} › ` : ""}${child.name}`);
    await runSuite(child, suiteName, hooks, results);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const { ethers } = await network.create();

const DURATION = 30 * 24 * 60 * 60; // 30 days funding window
const INACTIVITY = 90 * 24 * 60 * 60; // MILESTONE_INACTIVITY_PERIOD
const GRACE = 30 * 24 * 60 * 60; // RECOVERY_GRACE_PERIOD
const TEN_ETH = ethers.parseEther("10");

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [Math.floor(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

async function expectRevert(txPromise, expectedReason) {
  try {
    const tx = await txPromise;
    if (tx && typeof tx.wait === "function") await tx.wait();
  } catch (error) {
    const message = [error?.shortMessage, error?.reason, error?.message].filter(Boolean).join(" | ");
    if (expectedReason && !message.includes(expectedReason)) {
      throw new Error(`Expected revert "${expectedReason}" but the transaction failed with: ${message}`);
    }
    return;
  }
  throw new Error(
    `Expected the transaction to revert${expectedReason ? ` with "${expectedReason}"` : ""}, but it succeeded`
  );
}

function findEvent(receipt, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed.args;
    } catch {
      // not our event
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────
let contract;
let contractAddress;
let owner, creator, contributor1, contributor2, contributor3, outsider;

describe("CrowdfundingMarketplace — abandoned-campaign recovery", function () {
  beforeEach(async function () {
    [owner, creator, contributor1, contributor2, contributor3, outsider] =
      await ethers.getSigners();
    contract = await ethers.deployContract("CrowdfundingMarketplace");
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  });

  /** Target 10 ETH, funded with 4 + 3 + 3 ETH, then the deadline passes. */
  async function createFundedCampaign() {
    await contract
      .connect(creator)
      .createCampaign("Abandoned Solar Farm", "Description", "QmMetaHash", TEN_ETH, DURATION);
    await contract.connect(contributor1).contributeToCampaign(1, { value: ethers.parseEther("4") });
    await contract.connect(contributor2).contributeToCampaign(1, { value: ethers.parseEther("3") });
    await contract.connect(contributor3).contributeToCampaign(1, { value: ethers.parseEther("3") });
    await increaseTime(DURATION + 1);
  }

  async function approveMilestone(index, signers = [contributor1, contributor2]) {
    for (const signer of signers) {
      await contract.connect(signer).voteOnMilestone(1, index, true);
    }
  }

  it("does not allow recovery while the campaign is still fundraising", async function () {
    await contract
      .connect(creator)
      .createCampaign("Too Early", "Description", "QmMetaHash", TEN_ETH, DURATION);
    await contract.connect(contributor1).contributeToCampaign(1, { value: TEN_ETH });

    assert.equal(await contract.recoveryEligible(1), false);
    await expectRevert(contract.connect(contributor1).claimRecoveryShare(1), "Recovery not available");
  });

  it("keeps funds locked during the inactivity period and unlocks only after the grace period", async function () {
    await createFundedCampaign();

    const campaign = await contract.getCampaign(1);
    const unlocksAt = await contract.recoveryUnlocksAt(1);
    assert.equal(unlocksAt, campaign.deadline + BigInt(INACTIVITY + GRACE));

    assert.equal(await contract.recoveryEligible(1), false, "not eligible right after the deadline");
    await expectRevert(contract.connect(contributor1).claimRecoveryShare(1), "Recovery not available");

    await increaseTime(INACTIVITY - 1);
    assert.equal(await contract.recoveryEligible(1), false, "still inside the inactivity period");

    await increaseTime(GRACE + 2);
    assert.equal(await contract.recoveryEligible(1), true, "eligible after inactivity + grace");
  });

  it("lets a donor claim their pro-rata share exactly once", async function () {
    await createFundedCampaign();
    await increaseTime(INACTIVITY + GRACE + 1);

    const contractBalanceBefore = await ethers.provider.getBalance(contractAddress);
    assert.equal(contractBalanceBefore, TEN_ETH);

    const receipt = await (await contract.connect(contributor1).claimRecoveryShare(1)).wait();
    const event = findEvent(receipt, "RecoveryClaimed");

    // contributor1 provided 4 of 10 ETH, so the share is 4 ETH of the 10 ETH escrow.
    assert.equal(event.amount, ethers.parseEther("4"));
    assert.equal(event.contributor, contributor1.address);

    const campaign = await contract.getCampaign(1);
    assert.equal(campaign.recoveryMode, true);
    assert.equal(campaign.recoveryClaimed, ethers.parseEther("4"));
    assert.equal(await ethers.provider.getBalance(contractAddress), ethers.parseEther("6"));
    assert.equal(await contract.recoveryEscrowPool(1), ethers.parseEther("6"));
    assert.equal(await contract.getContribution(1, contributor1.address), 0n, "contribution is zeroed");
    assert.equal(await contract.recoveryClaimable(1, contributor1.address), 0n);

    // A second claim from the same donor must be impossible.
    await expectRevert(
      contract.connect(contributor1).claimRecoveryShare(1),
      "Recovery already claimed"
    );
  });

  it("never pays out more than the escrow pool and consumes it exactly", async function () {
    await createFundedCampaign();
    await increaseTime(INACTIVITY + GRACE + 1);

    await contract.connect(contributor1).claimRecoveryShare(1);
    await contract.connect(contributor2).claimRecoveryShare(1);
    await contract.connect(contributor3).claimRecoveryShare(1);

    const campaign = await contract.getCampaign(1);
    assert.equal(campaign.recoveryClaimed, TEN_ETH, "the whole pool is distributed");
    assert.equal(await contract.recoveryEscrowPool(1), 0n);
    assert.equal(await ethers.provider.getBalance(contractAddress), 0n);
    assert.equal(await contract.recoveryEligible(1), false, "nothing left to recover");

    // An address that never contributed can never claim.
    await expectRevert(
      contract.connect(outsider).claimRecoveryShare(1),
      "Recovery not available"
    );
  });

  it("accounts for funds already released before the campaign was abandoned", async function () {
    await createFundedCampaign();

    // One milestone completes normally: 30% of 10 ETH = 3 ETH released.
    await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidence0");
    await approveMilestone(0);
    await contract.connect(contributor1).releaseMilestoneFunds(1, 0);

    assert.equal(await contract.recoveryEscrowPool(1), ethers.parseEther("7"));
    assert.equal(await contract.recoveryEligible(1), false, "activity just happened");

    await increaseTime(INACTIVITY + GRACE + 1);
    assert.equal(await contract.recoveryEligible(1), true);
    assert.equal(await contract.recoveryClaimable(1, contributor1.address), ethers.parseEther("2.8"));

    const receipt = await (await contract.connect(contributor1).claimRecoveryShare(1)).wait();
    assert.equal(findEvent(receipt, "RecoveryClaimed").amount, ethers.parseEther("2.8"));

    await contract.connect(contributor2).claimRecoveryShare(1);
    await contract.connect(contributor3).claimRecoveryShare(1);

    const campaign = await contract.getCampaign(1);
    assert.equal(
      campaign.recoveryClaimed,
      ethers.parseEther("7"),
      "only the remaining escrow is refunded, never the 3 ETH already released"
    );
    assert.equal(await ethers.provider.getBalance(contractAddress), 0n);
  });

  it("freezes milestone releases, votes and refunds once recovery has started", async function () {
    await createFundedCampaign();

    // A milestone vote is open, but the campaign has been abandoned long enough.
    await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidence0");
    await increaseTime(INACTIVITY + GRACE + 1);

    await contract.connect(contributor1).claimRecoveryShare(1);

    await expectRevert(
      contract.connect(creator).submitMilestoneEvidence(1, 1, "QmEvidence1"),
      "Campaign is in donor recovery"
    );
    await expectRevert(
      contract.connect(contributor2).voteOnMilestone(1, 0, true),
      "Campaign is in donor recovery"
    );
    await expectRevert(
      contract.connect(contributor2).releaseMilestoneFunds(1, 0),
      "Campaign is in donor recovery"
    );
    await expectRevert(contract.connect(contributor2).getRefund(1), "Campaign is in donor recovery");
  });

  it("restarts the countdown while the creator is still submitting evidence", async function () {
    await createFundedCampaign();

    // 100 days of silence, then the creator submits milestone evidence.
    await increaseTime(100 * 24 * 60 * 60);
    await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidence0");

    const unlocksAt = await contract.recoveryUnlocksAt(1);
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    assert.equal(unlocksAt, now + BigInt(INACTIVITY + GRACE), "countdown restarts at the submission");

    assert.equal(await contract.recoveryEligible(1), false, "an active campaign cannot be recovered");

    // Donors keep their normal path: vote and release instead of recovering.
    await approveMilestone(0);
    await contract.connect(contributor1).releaseMilestoneFunds(1, 0);
    assert.equal(await contract.recoveryEscrowPool(1), ethers.parseEther("7"));
  });

  it("leaves a campaign that missed its target on the refund path", async function () {
    await contract
      .connect(creator)
      .createCampaign("Missed Target", "Description", "QmMetaHash", TEN_ETH, DURATION);
    await contract.connect(contributor1).contributeToCampaign(1, { value: ethers.parseEther("1") });

    await increaseTime(DURATION + 1 + INACTIVITY + GRACE + 1);

    assert.equal(await contract.recoveryEligible(1), false, "recovery is only for funded campaigns");
    await expectRevert(contract.connect(contributor1).claimRecoveryShare(1), "Recovery not available");

    // The existing refund path must keep working unchanged.
    await contract.connect(contributor1).getRefund(1);
    assert.equal(await contract.getContribution(1, contributor1.address), 0n);
  });

  it("never makes a completed campaign recoverable", async function () {
    await createFundedCampaign();

    for (const index of [0, 1, 2]) {
      await contract.connect(creator).submitMilestoneEvidence(1, index, `QmEvidence${index}`);
      await approveMilestone(index);
      await contract.connect(contributor1).releaseMilestoneFunds(1, index);
    }

    const campaign = await contract.getCampaign(1);
    assert.equal(campaign.completed, true);
    assert.equal(await contract.recoveryEscrowPool(1), 0n);

    await increaseTime(INACTIVITY + GRACE + 1);
    assert.equal(await contract.recoveryEligible(1), false);
    await expectRevert(contract.connect(contributor1).claimRecoveryShare(1), "Recovery not available");
  });

  it("preserves access control on existing admin functions", async function () {
    await createFundedCampaign();
    await increaseTime(INACTIVITY + GRACE + 1);

    await expectRevert(contract.connect(contributor1).withdrawFees(0), "Ownable");
    await expectRevert(contract.connect(contributor1).emergencyWithdraw(), "Ownable");
    await expectRevert(contract.connect(contributor1).pause(), "Ownable");
    await expectRevert(contract.connect(creator).deactivateCampaign(1), "Ownable");

    // Recovery is deliberately not blocked by the pause switch: an administrator's
    // emergency pause must never lock donors out of their own recovery claim.
    await contract.connect(owner).pause();
    await contract.connect(contributor1).claimRecoveryShare(1);
    assert.equal(await contract.getCampaign(1).then((c) => c.recoveryClaimed), ethers.parseEther("4"));
  });

  it("exposes a consistent aggregated recovery state", async function () {
    await createFundedCampaign();

    let state = await contract.getRecoveryState(1);
    assert.equal(state.eligible, false);
    assert.equal(state.enabled, false);
    assert.equal(state.pool, TEN_ETH);
    assert.equal(state.base, TEN_ETH);
    assert.equal(state.claimed, 0n);
    assert.equal(state.escrow, TEN_ETH);

    await increaseTime(INACTIVITY + GRACE + 1);
    state = await contract.getRecoveryState(1);
    assert.equal(state.eligible, true);

    await contract.connect(contributor2).claimRecoveryShare(1);
    state = await contract.getRecoveryState(1);
    assert.equal(state.enabled, true);
    assert.equal(state.pool, TEN_ETH, "the pool is frozen at enable time");
    assert.equal(state.base, TEN_ETH);
    assert.equal(state.claimed, ethers.parseEther("3"));
    assert.equal(state.escrow, ethers.parseEther("7"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
const results = { passed: 0, failed: 0, failures: [] };

await runSuite(ROOT_SUITE, "", [], results);

console.log(
  `\n  ${results.passed} passing, ${results.failed} failing${GREP ? ` (grep: ${GREP})` : ""}\n`
);

if (results.failed > 0) {
  console.log("  Failures:");
  for (const failure of results.failures) {
    console.log(`\n   ✗ ${failure.name}`);
    console.log(`     ${String(failure.error?.stack || failure.error).split("\n").slice(0, 6).join("\n     ")}`);
  }
  console.log("");
  process.exitCode = 1;
}

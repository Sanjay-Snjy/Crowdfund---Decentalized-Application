import assert from "node:assert/strict";
import { network } from "hardhat";

/**
 * Contract tests for the creator-accountability / milestone-escrow model.
 *
 * The suite is written with the Mocha API (`describe` / `it` / `beforeEach`) but
 * ships with a tiny built-in runner, because this Hardhat 3 project only has the
 * Solidity test runner installed. Run it with:
 *
 *     npm test              (from the web3/ directory)
 *     npx hardhat run test/CrowdfundingMarketplace.test.js
 *
 * Installing `@nomicfoundation/hardhat-mocha` would let the exact same file run
 * through `npx hardhat test mocha` instead.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Minimal mocha-compatible harness
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
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────
const { ethers } = await network.create();

const DURATION = 30 * 24 * 60 * 60; // 30 days
const STAKE_PERCENT = 30n;
const MILESTONE_PERCENTAGES = [30n, 30n, 40n];

const ONE_ETH = ethers.parseEther("1");
const TEN_ETH = ethers.parseEther("10");

const stakeFor = (target) => (target * STAKE_PERCENT) / 100n;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Asserts that a transaction reverts, optionally with a specific revert reason.
 */
async function expectRevert(txPromise, expectedReason) {
  try {
    const tx = await txPromise;
    if (tx && typeof tx.wait === "function") await tx.wait();
  } catch (error) {
    const message = [error?.shortMessage, error?.reason, error?.message]
      .filter(Boolean)
      .join(" | ");
    if (expectedReason && !message.includes(expectedReason)) {
      throw new Error(
        `Expected revert "${expectedReason}" but the transaction failed with: ${message}`
      );
    }
    return;
  }
  throw new Error(
    `Expected the transaction to revert${
      expectedReason ? ` with "${expectedReason}"` : ""
    }, but it succeeded`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
let contract;
let contractAddress;
let owner, creator, contributor1, contributor2, contributor3, outsider;

describe("CrowdfundingMarketplace — creator stake & milestone escrow", function () {
  beforeEach(async function () {
    [owner, creator, contributor1, contributor2, contributor3, outsider] =
      await ethers.getSigners();
    contract = await ethers.deployContract("CrowdfundingMarketplace");
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  });

  /** Creates a funded campaign: target 10 ETH, 3 ETH stake, 4 + 3 + 3 ETH donated. */
  async function createFundedCampaign({ target = TEN_ETH, duration = DURATION } = {}) {
    await contract
      .connect(creator)
      .createCampaign("Test Campaign", "Description", "QmMetaHash", target, duration, {
        value: stakeFor(target),
      });
    await contract.connect(contributor1).contributeToCampaign(1, { value: ethers.parseEther("4") });
    await contract.connect(contributor2).contributeToCampaign(1, { value: ethers.parseEther("3") });
    await contract.connect(contributor3).contributeToCampaign(1, { value: ethers.parseEther("3") });
    await increaseTime(duration + 1);
  }

  async function approveMilestone(index, signers = [contributor1, contributor2]) {
    for (const signer of signers) {
      await contract.connect(signer).voteOnMilestone(1, index, true);
    }
  }

  // ── Campaign creation & creator stake ──────────────────────────────────────
  describe("Campaign creation and creator stake", function () {
    it("requires a creator stake of 30% of the target", async function () {
      await expectRevert(
        contract
          .connect(creator)
          .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
            value: stakeFor(TEN_ETH) - 1n,
          }),
        "Creator stake required"
      );

      await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });

      const campaign = await contract.getCampaign(1);
      assert.equal(campaign.id, 1n);
      assert.equal(campaign.creator, creator.address);
      assert.equal(campaign.targetAmount, TEN_ETH);
      assert.equal(campaign.creatorStake, ethers.parseEther("3"), "stake must be 30% of target");
      assert.equal(campaign.raisedAmount, 0n, "stake is not donor money");
      assert.equal(campaign.stakeReturned, false);
      assert.equal(campaign.stakeForfeited, false);
      assert.equal(campaign.completed, false);
    });

    it("holds the stake in the contract and accounts for it separately", async function () {
      await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });

      assert.equal(await contract.totalStakesHeld(), ethers.parseEther("3"));
      assert.equal(await ethers.provider.getBalance(contractAddress), ethers.parseEther("3"));

      const accounting = await contract.getCampaignAccounting(1);
      assert.equal(accounting.donorFundsRaised, 0n);
      assert.equal(accounting.creatorStakeHeld, ethers.parseEther("3"));
      assert.equal(accounting.lockedDonorFunds, 0n);
      assert.equal(accounting.stakeLocked, true);
    });

    it("refunds ETH sent above the required stake", async function () {
      const before = await ethers.provider.getBalance(creator.address);
      const tx = await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: ethers.parseEther("5"),
        });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(creator.address);

      // Only the 3 ETH stake may be kept — the extra 2 ETH is refunded.
      assert.equal(before - after - gasCost, ethers.parseEther("3"));
      assert.equal(await contract.totalStakesHeld(), ethers.parseEther("3"));
    });

    it("creates the three fixed milestones (30/30/40)", async function () {
      await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });

      assert.equal(await contract.getMilestoneCount(1), 3n);

      const milestones = await contract.getMilestones(1);
      assert.equal(milestones.length, 3);
      milestones.forEach((milestone, index) => {
        assert.equal(milestone.percentage, MILESTONE_PERCENTAGES[index]);
        assert.equal(milestone.fundsReleased, false);
        assert.equal(milestone.evidenceSubmitted, false);
      });
    });

    it("rejects invalid campaign inputs", async function () {
      const send = (title, target, duration) =>
        contract.connect(creator).createCampaign(title, "Desc", "QmHash", target, duration, {
          value: ethers.parseEther("3"),
        });

      await expectRevert(send("", TEN_ETH, DURATION), "Title cannot be empty");
      await expectRevert(send("Title", 0n, DURATION), "Target amount must be greater than 0");
      await expectRevert(send("Title", TEN_ETH, 0), "Duration must be greater than 0");
      await expectRevert(
        contract
          .connect(creator)
          .createCampaign("Title", "Desc", "", TEN_ETH, DURATION, { value: ethers.parseEther("3") }),
        "Metadata hash cannot be empty"
      );
    });
  });

  // ── Contributions ─────────────────────────────────────────────────────────
  describe("Contributions", function () {
    beforeEach(async function () {
      await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });
    });

    it("tracks donor funds separately from the stake", async function () {
      await contract.connect(contributor1).contributeToCampaign(1, { value: ethers.parseEther("4") });

      const campaign = await contract.getCampaign(1);
      assert.equal(campaign.raisedAmount, ethers.parseEther("4"));
      assert.equal(campaign.contributorsCount, 1n);
      assert.equal(
        await ethers.provider.getBalance(contractAddress),
        ethers.parseEther("7"),
        "contract holds stake + donor funds"
      );
      assert.equal(await contract.getContribution(1, contributor1.address), ethers.parseEther("4"));
    });

    it("counts each contributor once and keeps the full history", async function () {
      await contract.connect(contributor1).contributeToCampaign(1, { value: ethers.parseEther("1") });
      await contract.connect(contributor1).contributeToCampaign(1, { value: ethers.parseEther("1") });
      await contract.connect(contributor2).contributeToCampaign(1, { value: ethers.parseEther("1") });

      const campaign = await contract.getCampaign(1);
      assert.equal(campaign.contributorsCount, 2n);
      assert.equal(campaign.raisedAmount, ethers.parseEther("3"));

      const history = await contract.getCampaignContributions(1);
      assert.equal(history.length, 3);
      assert.equal(await contract.getContribution(1, contributor1.address), ethers.parseEther("2"));
    });

    it("rejects contributions from the creator, of zero value, and after the deadline", async function () {
      await expectRevert(
        contract.connect(creator).contributeToCampaign(1, { value: ONE_ETH }),
        "Cannot contribute to own campaign"
      );
      await expectRevert(
        contract.connect(contributor1).contributeToCampaign(1, { value: 0n }),
        "Contribution must be greater than 0"
      );

      await increaseTime(DURATION + 1);
      await expectRevert(
        contract.connect(contributor1).contributeToCampaign(1, { value: ONE_ETH }),
        "Campaign has ended"
      );
    });
  });

  // ── Evidence submission ───────────────────────────────────────────────────
  describe("Milestone evidence", function () {
    it("only accepts evidence after the deadline when the target was reached", async function () {
      await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });

      await expectRevert(
        contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidence"),
        "Campaign still fundraising"
      );

      await increaseTime(DURATION + 1);
      await expectRevert(
        contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidence"),
        "Campaign target not reached"
      );
    });

    it("records the evidence CID, timestamp and voting power snapshot", async function () {
      await createFundedCampaign();

      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");

      const [milestone] = await contract.getMilestones(1);
      assert.equal(milestone.evidenceSubmitted, true);
      assert.equal(milestone.evidenceCID, "QmEvidenceOne");
      assert.equal(milestone.voteRequested, true);
      assert.equal(milestone.completed, true);
      assert.ok(milestone.evidenceSubmittedAt > 0n);
      assert.equal(milestone.totalVotingPower, TEN_ETH, "voting power = escrowed donor funds");

      const [approvals, rejections] = await Promise.all([
        contract.getMilestone(1, 0).then((m) => m[6]),
        contract.getMilestone(1, 0).then((m) => m[7]),
      ]);
      assert.equal(approvals, 0n);
      assert.equal(rejections, 0n);
    });

    it("is restricted to the campaign creator", async function () {
      await createFundedCampaign();

      await expectRevert(
        contract.connect(outsider).submitMilestoneEvidence(1, 0, "QmEvidence"),
        "Not campaign creator"
      );
    });

    it("rejects empty or duplicate evidence and invalid indexes", async function () {
      await createFundedCampaign();

      await expectRevert(
        contract.connect(creator).submitMilestoneEvidence(1, 0, ""),
        "Evidence CID cannot be empty"
      );
      await expectRevert(
        contract.connect(creator).submitMilestoneEvidence(1, 3, "QmEvidence"),
        "Invalid milestone index"
      );

      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      await expectRevert(
        contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceAgain"),
        "Evidence already submitted"
      );
    });

    it("enforces milestone ordering", async function () {
      await createFundedCampaign();

      await expectRevert(
        contract.connect(creator).submitMilestoneEvidence(1, 1, "QmEvidenceTwo"),
        "Previous milestone not released"
      );
    });
  });

  // ── Donor voting ──────────────────────────────────────────────────────────
  describe("Donor voting", function () {
    beforeEach(async function () {
      await createFundedCampaign();
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
    });

    it("weights votes by the donor's contribution", async function () {
      await contract.connect(contributor1).voteOnMilestone(1, 0, true);
      await contract.connect(contributor2).voteOnMilestone(1, 0, false);

      const [milestone] = await contract.getMilestones(1);
      assert.equal(milestone.approvals, 1n);
      assert.equal(milestone.rejections, 1n);
      assert.equal(milestone.approvalWeight, ethers.parseEther("4"));
      assert.equal(milestone.rejectionWeight, ethers.parseEther("3"));
      assert.equal(await contract.hasVotedOnMilestone(1, 0, contributor1.address), true);
    });

    it("rejects votes from non-contributors, the creator and double voters", async function () {
      await expectRevert(
        contract.connect(outsider).voteOnMilestone(1, 0, true),
        "Only contributors can vote"
      );
      await expectRevert(
        contract.connect(creator).voteOnMilestone(1, 0, true),
        "Campaign creator cannot vote"
      );

      await contract.connect(contributor1).voteOnMilestone(1, 0, true);
      await expectRevert(
        contract.connect(contributor1).voteOnMilestone(1, 0, true),
        "Contributor already voted"
      );
    });

    it("requires evidence before voting and blocks voting after release", async function () {
      await expectRevert(
        contract.connect(contributor1).voteOnMilestone(1, 1, true),
        "Milestone evidence not submitted"
      );

      await approveMilestone(0);
      await contract.connect(contributor1).releaseMilestoneFunds(1, 0);

      await expectRevert(
        contract.connect(contributor3).voteOnMilestone(1, 0, true),
        "Funds already released for this milestone"
      );
    });

    it("drops the voting power of a donor who refunded a failed campaign", async function () {
      // Refunds of a failed campaign reset the contribution, and with it the vote.
      await contract
        .connect(creator)
        .createCampaign("Failed", "Desc", "QmHashFailed", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });
      await contract.connect(contributor1).contributeToCampaign(2, { value: ethers.parseEther("5") });
      await increaseTime(DURATION + 1);

      await contract.connect(contributor1).getRefund(2);

      assert.equal(await contract.getContribution(2, contributor1.address), 0n);
      await expectRevert(
        contract.connect(contributor1).voteOnMilestone(2, 0, true),
        "Only contributors can vote"
      );
    });
  });

  // ── Release rules ─────────────────────────────────────────────────────────
  describe("Milestone release", function () {
    beforeEach(async function () {
      await createFundedCampaign();
    });

    it("refuses to release without donor approval", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");

      await expectRevert(
        contract.connect(creator).releaseMilestoneFunds(1, 0),
        "Milestone not approved by donors"
      );
    });

    it("refuses to release without quorum even when every vote approves", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      // contributor3 holds 3 of 10 ETH voting power = 30% < 50% quorum.
      await contract.connect(contributor3).voteOnMilestone(1, 0, true);

      assert.equal(await contract.milestoneApproved(1, 0), false);
      await expectRevert(
        contract.connect(contributor3).releaseMilestoneFunds(1, 0),
        "Milestone not approved by donors"
      );
    });

    it("refuses to release when rejecting voting power is the majority", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      await contract.connect(contributor1).voteOnMilestone(1, 0, true);
      await contract.connect(contributor2).voteOnMilestone(1, 0, false);
      await contract.connect(contributor3).voteOnMilestone(1, 0, false);

      assert.equal(await contract.milestoneApproved(1, 0), false);
      await expectRevert(
        contract.connect(creator).releaseMilestoneFunds(1, 0),
        "Milestone not approved by donors"
      );

      const campaign = await contract.getCampaign(1);
      assert.equal(campaign.raisedAmount, TEN_ETH, "no funds moved on a rejected milestone");
      assert.equal(await contract.getReleasedAmount(1), 0n);
    });

    it("releases exactly 30% of the escrowed donor funds for milestone 1", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      await approveMilestone(0);

      const before = await ethers.provider.getBalance(creator.address);
      const tx = await contract.connect(contributor1).releaseMilestoneFunds(1, 0);
      await tx.wait();
      const after = await ethers.provider.getBalance(creator.address);

      assert.equal(after - before, ethers.parseEther("3"), "milestone 1 releases 30% only");
      assert.equal(await contract.getReleasedAmount(1), ethers.parseEther("3"));

      const accounting = await contract.getCampaignAccounting(1);
      assert.equal(accounting.lockedDonorFunds, ethers.parseEther("7"));
      assert.equal(
        accounting.creatorStakeHeld,
        ethers.parseEther("3"),
        "the creator stake must stay locked after a release"
      );
    });

    it("never skips a milestone", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      await approveMilestone(0);
      await contract.connect(creator).releaseMilestoneFunds(1, 0);

      // Milestone 2 has no evidence yet, and milestone 3 is still locked behind it.
      await expectRevert(
        contract.connect(creator).releaseMilestoneFunds(1, 2),
        "Previous milestone not released"
      );
      await expectRevert(
        contract.connect(creator).submitMilestoneEvidence(1, 2, "QmEvidenceThree"),
        "Previous milestone not released"
      );
    });

    it("cannot be released twice", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      await approveMilestone(0);
      await contract.connect(creator).releaseMilestoneFunds(1, 0);

      await expectRevert(
        contract.connect(creator).releaseMilestoneFunds(1, 0),
        "Funds already released"
      );
    });

    it("releases 3 / 3 / 4 ETH across the full lifecycle and returns the stake", async function () {
      const startBalance = await ethers.provider.getBalance(creator.address);
      // The creator pays gas for the evidence transactions, so track it to keep
      // the balance delta limited to the stake and the milestone payments.
      let creatorGas = 0n;
      const submitEvidence = async (index, cid) => {
        const receipt = await (
          await contract.connect(creator).submitMilestoneEvidence(1, index, cid)
        ).wait();
        creatorGas += receipt.gasUsed * receipt.gasPrice;
      };

      await submitEvidence(0, "QmEvidenceOne");
      await approveMilestone(0);
      await contract.connect(contributor1).releaseMilestoneFunds(1, 0);
      assert.equal(await contract.getReleasedAmount(1), ethers.parseEther("3"));

      await submitEvidence(1, "QmEvidenceTwo");
      await approveMilestone(1);
      await contract.connect(contributor1).releaseMilestoneFunds(1, 1);
      assert.equal(await contract.getReleasedAmount(1), ethers.parseEther("6"));

      await submitEvidence(2, "QmEvidenceThree");
      await approveMilestone(2);
      await contract.connect(contributor1).releaseMilestoneFunds(1, 2);

      const campaign = await contract.getCampaign(1);
      assert.equal(await contract.getReleasedAmount(1), TEN_ETH, "all donor funds released");
      assert.equal(campaign.completed, true);
      assert.equal(campaign.stakeReturned, true);
      assert.equal(campaign.stakeForfeited, false);
      assert.equal(campaign.active, false);
      assert.ok(campaign.completedAt > 0n);

      // The last release pays the final 40% (4 ETH) plus the returned 3 ETH stake.
      const endBalance = await ethers.provider.getBalance(creator.address);
      // 3 + 3 + 4 ETH of donor funds plus the 3 ETH stake come back to the creator.
      assert.equal(
        endBalance - startBalance + creatorGas,
        TEN_ETH + ethers.parseEther("3"),
        "all donor funds released plus the returned stake"
      );
      assert.equal(
        await ethers.provider.getBalance(contractAddress),
        0n,
        "contract ends empty: no donor funds or stake stranded"
      );
      assert.equal(await contract.totalStakesHeld(), 0n);
    });

    it("returns the stake once and never releases it with a milestone", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      await approveMilestone(0);

      // Sent by a donor, so the creator pays no gas and the delta is exact.
      const before = await ethers.provider.getBalance(creator.address);
      await (
        await contract.connect(contributor1).releaseMilestoneFunds(1, 0)
      ).wait();
      const after = await ethers.provider.getBalance(creator.address);

      // Only the 3 ETH milestone share — the stake stays in escrow.
      assert.equal(after - before, ethers.parseEther("3"));
      assert.equal(
        await ethers.provider.getBalance(contractAddress),
        ethers.parseEther("3") + ethers.parseEther("7")
      );
    });

    it("keeps rounding dust out of the contract", async function () {
      // A campaign that over-funds with an awkward amount must still release 100%.
      const oddTarget = ethers.parseEther("7");
      await contract
        .connect(creator)
        .createCampaign("Odd", "Desc", "QmHashOdd", oddTarget, DURATION, {
          value: stakeFor(oddTarget),
        });

      const oddDonation = ethers.parseEther("7.123456789012345678");
      await contract.connect(contributor1).contributeToCampaign(2, { value: oddDonation });
      await increaseTime(DURATION + 1);

      const shares = await Promise.all([
        contract.milestoneReleaseAmount(2, 0),
        contract.milestoneReleaseAmount(2, 1),
        contract.milestoneReleaseAmount(2, 2),
      ]);
      assert.equal(shares[0], (oddDonation * 30n) / 100n);
      assert.equal(shares[1], (oddDonation * 30n) / 100n);
      assert.equal(
        shares[0] + shares[1] + shares[2],
        oddDonation,
        "the three shares add up to exactly the escrowed donor funds"
      );

      for (const index of [0, 1, 2]) {
        await contract.connect(creator).submitMilestoneEvidence(2, index, `QmOdd${index}`);
        await contract.connect(contributor1).voteOnMilestone(2, index, true);
        await contract.connect(contributor1).releaseMilestoneFunds(2, index);
      }

      assert.equal(await contract.getReleasedAmount(2), oddDonation);
      const oddAccounting = await contract.getCampaignAccounting(2);
      assert.equal(oddAccounting.lockedDonorFunds, 0n, "no wei is permanently locked");
      assert.equal(oddAccounting.creatorStakeHeld, 0n, "stake was returned");
      // Campaign 2 leaves nothing behind: only campaign 1's escrow remains.
      assert.equal(
        await ethers.provider.getBalance(contractAddress),
        ethers.parseEther("13"),
        "campaign 2 (stake + donor funds) is fully settled"
      );
    });

    it("can be triggered by any account once the milestone is approved", async function () {
      await contract.connect(creator).submitMilestoneEvidence(1, 0, "QmEvidenceOne");
      await approveMilestone(0);

      await contract.connect(outsider).releaseMilestoneFunds(1, 0);
      assert.equal(await contract.getReleasedAmount(1), ethers.parseEther("3"));
    });
  });

  // ── Failed campaigns ──────────────────────────────────────────────────────
  describe("Failed campaigns", function () {
    beforeEach(async function () {
      await contract
        .connect(creator)
        .createCampaign("Failing", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });
      await contract.connect(contributor1).contributeToCampaign(1, { value: ethers.parseEther("5") });
      await increaseTime(DURATION + 1);
    });

    it("lets donors refund their contribution", async function () {
      const before = await ethers.provider.getBalance(contributor1.address);
      const tx = await contract.connect(contributor1).getRefund(1);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(contributor1.address);

      assert.equal(after - before + gasCost, ethers.parseEther("5"));
      const campaign = await contract.getCampaign(1);
      assert.equal(campaign.raisedAmount, 0n, "raised accounting is updated on refund");
      await expectRevert(contract.connect(contributor1).getRefund(1), "No contribution found");
    });

    it("forfeits the creator stake to the platform treasury", async function () {
      await contract.connect(outsider).forfeitCreatorStake(1);

      const campaign = await contract.getCampaign(1);
      assert.equal(campaign.stakeForfeited, true);
      assert.equal(campaign.creatorStake, 0n);
      assert.equal(campaign.stakeReturned, false);
      assert.equal(await contract.totalStakesHeld(), 0n);
      assert.equal(await contract.totalFeesCollected(), ethers.parseEther("3"));

      await expectRevert(
        contract.connect(outsider).forfeitCreatorStake(1),
        "Stake already forfeited"
      );

      // Donors can still refund, and the treasury stays solvent.
      await contract.connect(contributor1).getRefund(1);
      await contract.connect(owner).withdrawFees(ethers.parseEther("3"));
      assert.equal(await ethers.provider.getBalance(contractAddress), 0n);
    });

    it("blocks refunds and stake forfeiture on successful campaigns", async function () {
      await contract
        .connect(creator)
        .createCampaign("Successful", "Desc", "QmHashOk", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });
      await contract.connect(contributor1).contributeToCampaign(2, { value: TEN_ETH });
      await increaseTime(DURATION + 1);

      assert.equal(await contract.hasReachedTarget(2), true);
      await expectRevert(contract.connect(contributor1).getRefund(2), "Campaign was successful");
      await expectRevert(
        contract.connect(outsider).forfeitCreatorStake(2),
        "Campaign reached its target"
      );
    });

    it("blocks refunds and forfeiture while the campaign is still fundraising", async function () {
      const freshContract = await ethers.deployContract("CrowdfundingMarketplace");
      await freshContract.waitForDeployment();

      await freshContract
        .connect(creator)
        .createCampaign("Fresh", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });
      await freshContract.connect(contributor1).contributeToCampaign(1, { value: ONE_ETH });

      await expectRevert(freshContract.connect(contributor1).getRefund(1), "Campaign still active");
      await expectRevert(
        freshContract.connect(outsider).forfeitCreatorStake(1),
        "Campaign still fundraising"
      );
    });
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  describe("Admin controls", function () {
    it("keeps owner-only functions owner-only", async function () {
      await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });

      await expectRevert(
        contract.connect(creator).pause(),
        "Ownable: caller is not the owner"
      );
      await expectRevert(
        contract.connect(creator).deactivateCampaign(1),
        "Ownable: caller is not the owner"
      );
      await expectRevert(
        contract.connect(creator).withdrawFees(1n),
        "Ownable: caller is not the owner"
      );
      await expectRevert(
        contract.connect(creator).emergencyRefund(1, contributor1.address),
        "Ownable: caller is not the owner"
      );
    });

    it("pauses campaign activity for everyone", async function () {
      await contract
        .connect(creator)
        .createCampaign("Title", "Desc", "QmHash", TEN_ETH, DURATION, {
          value: stakeFor(TEN_ETH),
        });
      await contract.connect(owner).pause();

      await expectRevert(
        contract.connect(contributor1).contributeToCampaign(1, { value: ONE_ETH }),
        "Pausable: paused"
      );

      await contract.connect(owner).unpause();
      await contract.connect(contributor1).contributeToCampaign(1, { value: ONE_ETH });
      assert.equal((await contract.getCampaign(1)).raisedAmount, ONE_ETH);
    });

    it("exposes treasury and escrow statistics", async function () {
      await createFundedCampaign();

      const stats = await contract.getContractStats();
      assert.equal(stats[0], 1n, "one campaign");
      assert.equal(stats[1], 0n, "no fees collected at campaign creation");
      assert.equal(stats[2], ethers.parseEther("13"), "3 ETH stake + 10 ETH donor funds");

      const campaignStats = await contract.getCampaignStats(1);
      assert.equal(campaignStats[0], TEN_ETH);
      assert.equal(campaignStats[1], TEN_ETH);
      assert.equal(campaignStats[2], 3n);
      assert.equal(campaignStats[3], 0n, "time left is zero after the deadline");
      assert.equal(campaignStats[5], true, "campaign is successful");
    });

    it("hides completed campaigns from the active list", async function () {
      await createFundedCampaign();

      assert.equal((await contract.getActiveCampaigns(0, 10)).length, 1);

      for (const index of [0, 1, 2]) {
        await contract.connect(creator).submitMilestoneEvidence(1, index, `QmEvidence${index}`);
        await approveMilestone(index);
        await contract.connect(contributor1).releaseMilestoneFunds(1, index);
      }

      assert.equal((await contract.getActiveCampaigns(0, 10)).length, 0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
const results = { passed: 0, failed: 0, failures: [] };

await runSuite(ROOT_SUITE, "", [], results);

console.log(
  `\n  ${results.passed} passing, ${results.failed} failing${
    GREP ? ` (grep: ${GREP})` : ""
  }\n`
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

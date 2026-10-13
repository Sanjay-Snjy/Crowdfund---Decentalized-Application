/**
 * Donor rewards: points + badges.
 *
 * Rewards are always derived from verified contribution records that live in the
 * database (indexed from real contract events), never from anything a browser
 * claims. Two guarantees are enforced here:
 *
 *   1. A contribution can award points at most once — the ledger has
 *      UNIQUE (user_id, reward_type, source_transaction_id) and the writer below
 *      upserts on that key.
 *   2. Only confirmed, non-refunded contributions count. Pending/failed rows and
 *      rows with `reward_eligible = 0` never contribute points or badge progress,
 *      and a refund reverses the points awarded for the refunded contribution.
 */
import { query, run, transaction } from "../db/driver.js";
import { listDonationsForIdentity, sumWei } from "../db/chainEvents.js";
import { REWARD_POLICY, evaluateBadges, pointsForWei } from "./policy.js";

export { REWARD_POLICY, evaluateBadges, pointsForWei } from "./policy.js";

function isEligible(donation) {
  if (REWARD_POLICY.requireConfirmedTransactions && donation.status !== "confirmed") return false;
  if (!REWARD_POLICY.refundedContributionsEarnRewards && donation.rewardEligible === false) {
    return false;
  }
  return true;
}

/** Reward state for one identity (CrowdFund profile and/or linked wallet). */
export async function computeRewards({ userId = null, walletAddress = null, cfUserId = null } = {}) {
  const donations = await listDonationsForIdentity({ userId, walletAddress, limit: 200 });

  const eligible = donations.filter(isEligible);
  const eligibleWei = sumWei(eligible.map((donation) => donation.amountWei));
  const totalWei = sumWei(
    donations.filter((donation) => donation.status === "confirmed").map((d) => d.amountWei)
  );

  const campaignIds = new Set(
    eligible.map((donation) => donation.campaignId).filter((id) => id !== null)
  );

  const badges = evaluateBadges({
    eligibleWei,
    eligibleContributionCount: eligible.length,
  });

  const points = pointsForWei(eligibleWei);

  const breakdown = donations.map((donation) => {
    const rewardEligible = isEligible(donation);
    return {
      transactionId: donation.id,
      txHash: donation.txHash,
      blockNumber: donation.blockNumber,
      campaignId: donation.campaignId,
      campaignName: donation.campaignName,
      amountWei: donation.amountWei,
      timestamp: donation.timestamp,
      status: donation.status,
      rewardEligible,
      refunded: donation.refundedAt !== null || donation.rewardEligible === false,
      points: rewardEligible ? pointsForWei(donation.amountWei) : 0,
    };
  });

  return {
    cfUserId,
    points,
    eligibleWei,
    totalWei,
    eligibleContributionCount: eligible.length,
    contributionsCount: donations.length,
    campaignsSupported: campaignIds.size,
    badges,
    breakdown,
    policy: {
      pointsPerEth: REWARD_POLICY.pointsPerEth,
      refundedContributionsEarnRewards: REWARD_POLICY.refundedContributionsEarnRewards,
      requireConfirmedTransactions: REWARD_POLICY.requireConfirmedTransactions,
      tiers: REWARD_POLICY.tiers.map((tier) => ({
        id: tier.id,
        label: tier.label,
        thresholdEth: tier.thresholdEth,
        description: tier.description,
      })),
    },
  };
}

/**
 * Persist the per-contribution reward ledger for an identity.
 *
 * Idempotent by construction: the unique index on
 * (user_id, reward_type, source_transaction_id) turns a replayed sync into an
 * update instead of a duplicate award, and refunded contributions are reversed
 * (not deleted) so the audit trail stays intact.
 */
export async function syncRewardLedger({ userId, walletAddress = null }) {
  if (!userId) return { awarded: 0, reversed: 0 };

  const donations = await listDonationsForIdentity({ userId, walletAddress, limit: 200 });
  const now = Math.floor(Date.now() / 1000);

  return transaction(async () => {
    let awarded = 0;
    let reversed = 0;

    for (const donation of donations) {
      if (donation.status !== "confirmed") continue;

      const eligible = isEligible(donation);
      const points = eligible ? pointsForWei(donation.amountWei) : 0;

      const existing = (
        await query(
          `SELECT id, reversed_at FROM reward_events
            WHERE user_id = ? AND reward_type = 'points' AND source_transaction_id = ?`,
          [userId, donation.id]
        )
      )[0];

      if (!eligible) {
        if (existing && !existing.reversed_at) {
          await run("UPDATE reward_events SET reversed_at = ? WHERE id = ?", [now, existing.id]);
          reversed += 1;
        }
        continue;
      }

      if (existing) {
        await run(
          "UPDATE reward_events SET points = ?, reversed_at = NULL WHERE id = ?",
          [points, existing.id]
        );
      } else {
        await run(
          `INSERT INTO reward_events (user_id, reward_type, points, source_transaction_id, created_at)
           VALUES (?, 'points', ?, ?, ?)
           ON CONFLICT (user_id, reward_type, source_transaction_id)
           DO UPDATE SET points = excluded.points, reversed_at = NULL`,
          [userId, points, donation.id, now]
        );
        awarded += 1;
      }
    }

    return { awarded, reversed };
  });
}

export async function rewardLedgerPoints(userId) {
  const rows = await query(
    `SELECT points FROM reward_events
      WHERE user_id = ? AND reward_type = 'points' AND reversed_at IS NULL`,
    [userId]
  );
  return rows.reduce((sum, row) => sum + Number(row.points || 0), 0);
}

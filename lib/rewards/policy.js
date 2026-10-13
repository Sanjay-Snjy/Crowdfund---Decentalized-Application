/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DONOR REWARD POLICY — single configuration location
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything about how donor recognition is earned lives in this file so the
 * thresholds and the points conversion rate are never scattered through the UI.
 *
 * Points
 * ------
 *   points = floor(eligibleWei × pointsPerEth / 1e18)
 *
 *   Default: 1000 points per 1 ETH → 1 point per 0.001 ETH.
 *   Calculated with BigInt, so very small contributions round *down* and can
 *   award 0 points — that is intentional (no fractional/rounded-up points, so a
 *   contribution can never award points it does not cover).
 *
 * Badges (thresholds in ETH of *eligible* contribution volume)
 * -----------------------------------------------------------
 *   supporter  at least one successful, non-refunded contribution (threshold 0)
 *   silver     ≥ 0.5 ETH
 *   gold       ≥ 2 ETH
 *   platinum   ≥ 10 ETH
 *
 * Refunds
 * -------
 *   `refundedContributionsEarnRewards = false` — a contribution that was refunded
 *   (a failed campaign's `getRefund`) is excluded from points and badge progress,
 *   and its previously awarded points are reversed. This is the documented policy.
 *
 * Every value can be overridden per environment without a code change:
 *   CF_REWARD_POINTS_PER_ETH, CF_REWARD_THRESHOLD_SUPPORTER_ETH,
 *   CF_REWARD_THRESHOLD_SILVER_ETH, CF_REWARD_THRESHOLD_GOLD_ETH,
 *   CF_REWARD_THRESHOLD_PLATINUM_ETH
 *
 * No monetary redemption, no token appreciation and no financial return is
 * promised anywhere: these are recognition numbers only.
 */

const WEI_PER_ETH = 10n ** 18n;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** ETH threshold → wei string, without floating point drift for typical values. */
export function ethToWei(eth) {
  const text = String(eth);
  if (!/^\d+(\.\d+)?$/.test(text)) return "0";
  const [whole, fraction = ""] = text.split(".");
  const paddedFraction = (fraction + "0".repeat(18)).slice(0, 18);
  return (BigInt(whole) * WEI_PER_ETH + BigInt(paddedFraction || "0")).toString();
}

export const REWARD_POLICY = {
  /** Points awarded per whole ETH of eligible contribution volume. */
  pointsPerEth: envNumber("CF_REWARD_POINTS_PER_ETH", 1000),
  /** Exclude refunded contributions from points and badge progress. */
  refundedContributionsEarnRewards: false,
  /** Only confirmed on-chain contributions ever count. */
  requireConfirmedTransactions: true,
  tiers: [
    {
      id: "supporter",
      label: "Supporter",
      description: "Contributed to at least one campaign",
      thresholdEth: envNumber("CF_REWARD_THRESHOLD_SUPPORTER_ETH", 0),
      accent: "#22d3ee",
    },
    {
      id: "silver",
      label: "Silver Supporter",
      description: "Reached the Silver contribution threshold",
      thresholdEth: envNumber("CF_REWARD_THRESHOLD_SILVER_ETH", 0.5),
      accent: "#a5b4fc",
    },
    {
      id: "gold",
      label: "Gold Supporter",
      description: "Reached the Gold contribution threshold",
      thresholdEth: envNumber("CF_REWARD_THRESHOLD_GOLD_ETH", 2),
      accent: "#fbbf24",
    },
    {
      id: "platinum",
      label: "Platinum Supporter",
      description: "Reached the Platinum contribution threshold",
      thresholdEth: envNumber("CF_REWARD_THRESHOLD_PLATINUM_ETH", 10),
      accent: "#e879f9",
    },
  ],
};

/** Points for a wei amount, rounded down, using integer maths only. */
export function pointsForWei(wei, policy = REWARD_POLICY) {
  let amount;
  try {
    amount = BigInt(String(wei || "0"));
  } catch {
    return 0;
  }
  if (amount <= 0n) return 0;
  const rate = BigInt(Math.round(policy.pointsPerEth));
  return Number((amount * rate) / WEI_PER_ETH);
}

export function tierThresholdWei(tier) {
  return BigInt(ethToWei(tier.thresholdEth));
}

/** Badge state for an eligible volume; `supporter` additionally needs one contribution. */
export function evaluateBadges({ eligibleWei, eligibleContributionCount, policy = REWARD_POLICY }) {
  const volume = BigInt(String(eligibleWei || "0"));
  return policy.tiers.map((tier) => {
    const threshold = tierThresholdWei(tier);
    const isSupporter = tier.id === "supporter";
    const earned = isSupporter
      ? Number(eligibleContributionCount) > 0
      : volume >= threshold;
    const progress =
      threshold > 0n
        ? Math.min(100, Number((volume * 100n) / threshold))
        : earned
          ? 100
          : 0;

    return {
      id: tier.id,
      label: tier.label,
      description: tier.description,
      accent: tier.accent,
      thresholdEth: tier.thresholdEth,
      earned,
      progress,
    };
  });
}

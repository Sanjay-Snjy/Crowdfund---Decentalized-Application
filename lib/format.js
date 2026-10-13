/**
 * Wei/ETH formatting helpers (server-side, dependency-free, BigInt-safe).
 *
 * These match `ethers.utils.formatEther` exactly (full precision, trailing zeros
 * trimmed) so server-rendered payloads agree with the values the frontend derives
 * from the chain itself.
 */

const WEI_PER_ETH = 10n ** 18n;

function toBigInt(value) {
  if (value === null || value === undefined || value === "") return 0n;
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

/** Exact ETH representation of a wei amount, e.g. 1500000000000000000n → "1.5". */
export function formatEther(wei) {
  const value = toBigInt(wei);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / WEI_PER_ETH;
  const fraction = (absolute % WEI_PER_ETH).toString().padStart(18, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Rounded ETH string for dense tables: 0.123456 ETH → "0.1235".
 * Rounding happens on the wei value (half-up) so it never drifts like float maths.
 */
export function formatEthDisplay(wei, decimals = 4) {
  const value = toBigInt(wei);
  if (value === 0n) return "0";
  if (decimals <= 0) return formatEther(value);

  const scale = 10n ** BigInt(decimals);
  const scaled = (value * scale + WEI_PER_ETH / 2n) / WEI_PER_ETH;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function shortenAddress(address, start = 6, end = 4) {
  if (typeof address !== "string" || address.length < start + end + 2) return address || "";
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}

/** Percentage of a target, as a number with two decimals (0 → 100 clamp optional). */
export function percentOf(partWei, totalWei, { clamp = false } = {}) {
  const part = toBigInt(partWei);
  const total = toBigInt(totalWei);
  if (total <= 0n) return 0;
  const raw = Number((part * 10000n) / total) / 100;
  return clamp ? Math.min(raw, 100) : raw;
}

export { toBigInt };

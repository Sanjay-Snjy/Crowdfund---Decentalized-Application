/**
 * Server-side chain access: one shared read-only provider, the compiled contract
 * ABI and a small in-memory TTL cache so polling UI requests do not hammer the
 * RPC endpoint.
 *
 * Everything here is read-only and server-only. No signer, no private key.
 */
import { ethers } from "ethers";
import { CROWDFUNDING_ABI } from "../../constants/abi.js";
import { getChainConfig } from "./config.js";

// ethers v5 logs noisy "network mismatch" warnings when a provider is reused
// across reconnects; keep the server log readable.
try {
  ethers.utils.Logger.setLogLevel(ethers.utils.Logger.levels.ERROR);
} catch {
  // ignore
}

const CACHE_PREFIX = "__crowdfundChain";

/**
 * Raised when the RPC endpoint itself could not answer (rate-limited, unreachable,
 * timed out) — as opposed to the contract rejecting the call. API routes turn this
 * into a 502 with the setting to fix instead of a blank 500 that tells the operator
 * nothing.
 */
export const CHAIN_HINT =
  "The Sepolia RPC endpoint did not respond (rate-limited or unreachable from this host). Set SEPOLIA_RPC_URL (or NEXT_PUBLIC_RPC_URL) to a dedicated endpoint in this environment's variables and redeploy.";

export class ChainUnavailableError extends Error {
  constructor(message, { cause = null, hint = null } = {}) {
    super(message);
    this.name = "ChainUnavailableError";
    this.code = "CHAIN_UNAVAILABLE";
    this.hint = hint || CHAIN_HINT;
    if (cause) this.cause = cause;
  }
}

// ethers transport failures carry one of these codes; our own timeout uses
// CHAIN_TIMEOUT (set by withTimeout below).
const TRANSPORT_CODES = new Set(["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT", "BAD_DATA", "CHAIN_TIMEOUT"]);
const TRANSPORT_MESSAGE =
  /(timed out after|timeout|rate limit|too many requests|\b429\b|detect network|network error|econnrefused|enotfound|etimedout|epipe|fetch failed|missing response|bad response|socket hang up|unable to connect|getaddrinfo|dns)/i;
const CONTRACT_REJECTION = /(execution reverted|reverted with|revert|invalid campaign id|invalid opcode)/i;

/**
 * True when an error means "the chain could not be reached", false for a rejection
 * coming back from the contract itself (which is a 404-style answer, not an outage)
 * and for database failures (which are classified separately).
 */
export function isChainTransportFailure(error) {
  if (!error) return false;
  if (error.code === "DATABASE_UNAVAILABLE") return false;

  const candidates = [error.message, error.cause?.message, error.error?.message]
    .filter((value) => typeof value === "string")
    .join(" | ");

  // A revert is the contract answering — never an outage, whatever the code says.
  if (candidates && CONTRACT_REJECTION.test(candidates)) return false;

  if (TRANSPORT_CODES.has(String(error.code))) return true;
  return Boolean(candidates && TRANSPORT_MESSAGE.test(candidates));
}

function store() {
  if (!globalThis[CACHE_PREFIX]) {
    globalThis[CACHE_PREFIX] = { provider: null, providerKey: null, cache: new Map() };
  }
  return globalThis[CACHE_PREFIX];
}

export function getProvider() {
  const config = getChainConfig();
  const key = `${config.chainId}|${config.rpcUrl}`;
  const state = store();

  if (!state.provider || state.providerKey !== key) {
    state.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl, {
      chainId: config.chainId,
      name: config.networkKey,
    });
    state.providerKey = key;
  }

  return state.provider;
}

export function getReadContract() {
  const config = getChainConfig();
  if (!config.contractAddress) return null;
  return new ethers.Contract(config.contractAddress, CROWDFUNDING_ABI, getProvider());
}

/** Small TTL cache keyed by string. Values may be async loaders. */
export async function cached(key, ttlMs, loader) {
  const state = store();
  const now = Date.now();
  const hit = state.cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await loader();
  state.cache.set(key, { value, expiresAt: now + ttlMs });

  // Opportunistic bound so a long-running dev server cannot grow forever.
  if (state.cache.size > 500) {
    for (const [entryKey, entry] of state.cache) {
      if (entry.expiresAt <= now) state.cache.delete(entryKey);
    }
  }

  return value;
}

export function invalidateCache(prefix = null) {
  const state = store();
  if (!prefix) {
    state.cache.clear();
    return;
  }
  for (const key of [...state.cache.keys()]) {
    if (key.startsWith(prefix)) state.cache.delete(key);
  }
}

export function clearProvider() {
  const state = store();
  state.provider = null;
  state.providerKey = null;
  state.cache.clear();
}

/** Wrap a promise with a bounded timeout so an API route can never hang forever. */
export async function withTimeout(promise, ms, label = "rpc call") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Timed out after ${ms}ms: ${label}`);
          error.code = "CHAIN_TIMEOUT";
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

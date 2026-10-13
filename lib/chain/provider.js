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
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Server-side chain configuration.
 *
 * The deployed contract address is taken from `constants/index.js` (committed on
 * purpose) unless an explicit override is set, so the API routes, the indexer and
 * the frontend always talk to the same deployment.
 *
 * Server-only RPC overrides (kept out of the client bundle):
 *   SEPOLIA_RPC_URL          preferred RPC for the server indexer
 *   NETWORK_RPC_URL          shared with the Hardhat project
 *   CF_INDEX_START_BLOCK     first block to index (contract deploy block)
 *   CF_INDEX_LOOKBACK_BLOCKS how far back a default sync scans (default 20000)
 *   CF_CONFIRMATIONS_REQUIRED confirmations before a donation counts (default 1)
 */
import { CONTRACT_ADDRESS, NETWORK_CONFIGS } from "../../constants/index.js";

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function getChainConfig() {
  const networkKey = firstNonEmpty(process.env.NEXT_PUBLIC_NETWORK, "sepolia");
  const known = NETWORK_CONFIGS[networkKey] || NETWORK_CONFIGS.sepolia;

  const chainId = Number(
    firstNonEmpty(process.env.NEXT_PUBLIC_CHAIN_ID, String(known.chainId))
  );
  const rpcUrl = firstNonEmpty(
    process.env.SEPOLIA_RPC_URL,
    process.env.NETWORK_RPC_URL,
    process.env.NEXT_PUBLIC_RPC_URL,
    known.rpcUrl
  );
  const contractAddress = firstNonEmpty(
    process.env.CF_CONTRACT_ADDRESS,
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_OVERRIDE,
    CONTRACT_ADDRESS
  );
  const explorerBase = firstNonEmpty(
    process.env.NEXT_PUBLIC_BLOCK_EXPLORER,
    known.blockExplorer
  );

  return {
    networkKey,
    chainId,
    rpcUrl,
    contractAddress: contractAddress ? contractAddress.toLowerCase() : null,
    explorerBase: explorerBase ? explorerBase.replace(/\/+$/, "") : null,
    explorerName: firstNonEmpty(
      process.env.NEXT_PUBLIC_BLOCK_EXPLORER_NAME,
      chainId === 11155111 ? "Sepolia Etherscan" : "Block Explorer"
    ),
    confirmationsRequired: Number(firstNonEmpty(process.env.CF_CONFIRMATIONS_REQUIRED, "1")),
    indexStartBlock: Number(firstNonEmpty(process.env.CF_INDEX_START_BLOCK, "0")),
    lookbackBlocks: Number(firstNonEmpty(process.env.CF_INDEX_LOOKBACK_BLOCKS, "20000")),
    isTestnet: chainId !== 1,
  };
}

/**
 * Etherscan link for a transaction. Sepolia transactions must never be linked to
 * Ethereum mainnet (and vice versa) — the base URL always comes from the
 * configured network.
 */
export function explorerTxUrl(txHash, config = getChainConfig()) {
  if (!txHash) return null;
  const base = config.explorerBase || "https://sepolia.etherscan.io";
  return `${base}/tx/${txHash}`;
}

export function explorerAddressUrl(address, config = getChainConfig()) {
  if (!address) return null;
  const base = config.explorerBase || "https://sepolia.etherscan.io";
  return `${base}/address/${address}`;
}

// ── Deployed contract address ────────────────────────────────────────────────
// Committed here on purpose so every environment (local dev, preview and the
// deployed build) talks to the same contract without depending on a
// NEXT_PUBLIC_CONTRACT_ADDRESS env var being set or updated anywhere.
//
// After redeploying, run `cd web3 && npm run deploy-sepolia` and paste the new
// address below.
export const COMMITTED_CONTRACT_ADDRESS =
  "0x4bbB7cF60C5D11978Edab37e77d8b939988844cA";

// Optional escape hatch for testing against a different deployment.
// Deliberately a *different* variable name: a stale NEXT_PUBLIC_CONTRACT_ADDRESS
// must never silently override the committed address.
const CONTRACT_ADDRESS_OVERRIDE =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_OVERRIDE;

export const CONTRACT_ADDRESS =
  CONTRACT_ADDRESS_OVERRIDE || COMMITTED_CONTRACT_ADDRESS;

export const CAMPAIGN_CREATION_FEE = "0"; // no upfront creation fee

// ── Creator accountability / milestone escrow model ──────────────────────────
// Must stay in sync with the Solidity constants of the same name.
export const CREATOR_STAKE_PERCENT = 30; // creator stake, as % of the campaign target
export const VOTE_QUORUM_PERCENT = 50; // % of donor voting power that must vote

// Fixed fund release schedule of every campaign (30% / 30% / 40%).
export const MILESTONE_SCHEDULE = [
  { index: 0, label: "Milestone 1", percent: 30 },
  { index: 1, label: "Milestone 2", percent: 30 },
  { index: 2, label: "Milestone 3", percent: 40 },
];

// Validate the configured contract address.
if (typeof window !== "undefined") {
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS || "")) {
    console.error(
      `[config] Invalid contract address "${CONTRACT_ADDRESS}" — set COMMITTED_CONTRACT_ADDRESS in constants/index.js.`
    );
  } else if (
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS &&
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS.toLowerCase() !==
      CONTRACT_ADDRESS.toLowerCase()
  ) {
    // Surfaced loudly so a stale deployment env var can't silently point the app
    // at an old contract again (which made campaigns undecodable and invisible).
    console.warn(
      `[config] Ignoring NEXT_PUBLIC_CONTRACT_ADDRESS=${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS} — using committed address ${CONTRACT_ADDRESS}. Set NEXT_PUBLIC_CONTRACT_ADDRESS_OVERRIDE to override deliberately.`
    );
  }
}

export const NETWORK_CONFIGS = {
  localhost: {
    name: "Localhost",
    chainId: 31337,
    rpcUrl: "http://localhost:8545",
    blockExplorer: "http://localhost:8545",
  },
  sepolia: {
    name: "Sepolia Testnet",
    chainId:  11155111,
    rpcUrl: "https://sepolia.infura.io/v3/1da513d7c5e94e52a8ba91f899602dde",
    blockExplorer: "https://sepolia.etherscan.io",
  },
};


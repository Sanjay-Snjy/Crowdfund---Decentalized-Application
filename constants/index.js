export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

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

// Validate required environment variables
if (typeof window !== "undefined") {
  if (!CONTRACT_ADDRESS) {
    console.error(
      "NEXT_PUBLIC_CONTRACT_ADDRESS is not set in environment variables"
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


# CrowdFund - DApp

<p align="center">
  <img src="https://raw.githubusercontent.com/Sanjay-Snjy/Crowdfund---DApp/main/assets/demo0.gif" alt="CrowdFund Demo" width="800">
</p>

CrowdFund is a decentralized crowdfunding platform built with Next.js, Solidity, Hardhat, Wagmi, and RainbowKit. The project allows users to connect a wallet, browse crowdfunding campaigns, create new campaigns, contribute funds, and track campaign activity on-chain.

## Overview

This application combines a modern React frontend with smart contracts deployed on a blockchain network. It is designed to bring transparency, immutability, and trust to crowdfunding by using blockchain technology to record campaign data and transactions.

## Key Features

- Connect wallet using RainbowKit and Wagmi
- Create and manage crowdfunding campaigns
- Contribute funds to campaigns directly from the dApp
- Creator accountability: a creator stake of 30% of the target is locked in escrow
- Milestone escrow: donated funds are released 30% / 30% / 40%, in order, on donor approval
- Creator submits IPFS evidence per milestone; donors vote weighted by their contribution
- Refunds for donors when a campaign misses its target (and then the creator stake is forfeited)
- View campaign details, contribution status, and funding progress
- Display transparent blockchain-backed statistics
- Use a responsive UI built with Next.js and Tailwind CSS
- Explore the whole UI in demo mode without connecting a wallet

## Fund release model (creator accountability)

```text
CREATE CAMPAIGN  ->  creator locks a stake of 30% of the target
        |
DONATIONS        ->  donor funds stay in the smart contract (never released up front)
        |
MILESTONE 1      ->  creator uploads evidence (IPFS CID) -> donors vote -> 30% released
MILESTONE 2      ->  creator uploads evidence (IPFS CID) -> donors vote -> 30% released
MILESTONE 3      ->  creator uploads evidence (IPFS CID) -> donors vote -> 40% released
        |
CAMPAIGN COMPLETED  ->  creator stake is returned
```

Rules enforced by `web3/contracts/CrowdfundingMarketplace.sol`:

- `creatorStake = targetAmount * 30 / 100`, required as `msg.value` on creation (any excess is refunded).
  The contract keeps donor funds and the stake in separate accounting (`raisedAmount` never includes it).
- The stake is **never** released together with a milestone; it is returned only when the campaign
  completes all three milestones.
- Every campaign has exactly three fixed milestones (30% / 30% / 40%). The last milestone receives the
  rounding remainder, so the three releases always account for exactly 100% of the escrowed donor funds
  and no wei is permanently stuck.
- Evidence submission and releases require the funding deadline to have passed **and** the target to be
  reached (all-or-nothing model). Milestones are handled strictly in order and cannot be skipped.
- Voting power equals a donor's contribution to that campaign. A milestone is approved when a strict
  majority of the participating voting power approves **and** at least 50% of the campaign's voting power
  took part (quorum). Refunding a contribution removes that voting power.
- Failed campaign: donors refund their contribution via `getRefund`, and `forfeitCreatorStake` moves the
  creator stake to the platform treasury instead of returning it.

**What the blockchain proves, and what it does not.** The contract records that evidence was submitted,
who submitted it, when, how donors voted, what passed, how much was released and by which transaction.
It cannot prove that a photo, invoice or video is genuine, or that funds were spent as described — donors
judge that themselves when they vote. The platform only improves accountability through the creator
stake, milestone evidence, donor voting and transparent on-chain releases.

## Tech Stack

- Frontend: Next.js, React, Tailwind CSS
- Web3: Wagmi, RainbowKit, Ethers.js, Viem
- Smart Contracts: Solidity, Hardhat, OpenZeppelin

## Project Structure

- pages: Next.js route pages for the app UI
- components: Reusable UI components such as headers, cards, forms, and dashboards
- web3: Hardhat project containing Solidity smart contracts, deployment scripts and tests
- constants: Contract ABI (generated from the compiled artifact) and environment-specific values
- hooks: `useContract.js` exposes every contract interaction as a wagmi hook
- utils: Helper functions (stake/escrow math formatting) and IPFS-related utilities

### Smart contract entry points

| Function | Who | Purpose |
|---|---|---|
| `createCampaign(title, description, metadataHash, target, duration)` | creator | Creates the campaign, locks the 30% stake and the three fixed milestones |
| `contributeToCampaign(id)` | anyone but the creator | Adds donor funds to the escrow |
| `submitMilestoneEvidence(id, index, evidenceCID)` | creator | Attaches the IPFS evidence CID of the next milestone and opens voting |
| `voteOnMilestone(id, index, approve)` | donors | Weighted vote (voting power = contribution) |
| `releaseMilestoneFunds(id, index)` | anyone | Releases the approved share; completes the campaign and returns the stake on the last milestone |
| `forfeitCreatorStake(id)` | anyone | Moves the stake of a failed campaign to the treasury |
| `getRefund(id)` | donors | Refunds a contribution when the target was missed |
| `getMilestones(id)`, `milestoneReleaseAmount(id, i)`, `milestoneApproved(id, i)`, `getCampaignAccounting(id)` | anyone | Read the escrow state |

## Getting Started

### 1. Install dependencies

Install the frontend dependencies:

```bash
cd CF
npm install
```

Install the Hardhat dependencies:

```bash
cd CF/web3
npm install
```

Run the smart contract tests and refresh the frontend ABI whenever the contract changes:

```bash
cd CF/web3
npm test            # contract test suite (creator stake, escrow, voting, refunds)
npm run export-abi  # regenerates ../constants/abi.js from the compiled artifact
```

### 2. Run the local blockchain

```bash
cd CF/web3
npx hardhat node
```

### 3. Deploy the smart contract

In a new terminal:

```bash
cd CF/web3
npx hardhat run scripts/deploy.js --network localhost
```

### 4. Start the frontend

```bash
cd CF
npm run dev
```

Then open http://localhost:3000 in your browser.

## Environment Variables

Create a local environment file and provide your configuration values. All `NEXT_PUBLIC_*`
values are safe to expose to the browser (they are embedded in the client bundle);
they must be set **both** in `.env.local` for local development **and** in the
hosting provider (e.g. Vercel) environment variables for the deployed site.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | ✅ | **36-character UUID** from https://cloud.walletconnect.com (create a free project). RainbowKit's MetaMask wallet uses WalletConnect v2 as the **mobile** deep-link transport, so mobile connection hangs on "Connecting to MetaMask..." until this is a real project ID. Desktop extension connect works without it. |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | ✅ | Deployed Crowdfunding contract address (0x...) |
| `NEXT_PUBLIC_RPC_URL` | ✅ | RPC endpoint for the configured chain |
| `NEXT_PUBLIC_CHAIN_ID` | ✅ | Chain ID (e.g. `11155111` for Sepolia) |
| `NEXT_PUBLIC_CHAIN_NAME` | ✅ | Chain name (e.g. `Sepolia`) |
| `NEXT_PUBLIC_CHAIN_SYMBOL` | ✅ | Native currency symbol (e.g. `ETH`) |
| `NEXT_PUBLIC_NETWORK` | ✅ | Network key (`sepolia`, `localhost`, ...) |
| `NEXT_PUBLIC_BLOCK_EXPLORER` | Optional | Block explorer base URL |
| `NEXT_PUBLIC_BLOCK_EXPLORER_NAME` | Optional | Block explorer display name |
| `NEXT_PUBLIC_PLATFORM_NAME` | ✅ | App name shown to wallets |
| `NEXT_PUBLIC_ADMIN_ADDRESS` | ✅ | Admin wallet address for the admin panel |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Optional | Clerk publishable key (if Clerk auth is enabled) |
| `PINATA_API_KEY`, `PINATA_SECRET_API_KEY`, `PINATA_JWT` | ✅ (server-side) | Pinata credentials used by API routes only — **do not** give these a `NEXT_PUBLIC_` prefix |

## Notes

- Make sure your contract address and network settings match your deployed environment.
- Avoid committing sensitive files such as environment files or private keys.
- The Hardhat folder contains deployment artifacts and local cache files that should be kept out of version control.
- Deploying a new contract version invalidates campaigns created by an older version: this release replaces
  the previous "withdraw all funds at once" flow, so an old deployment should not be reused.
- Known limitation: if a funded campaign is abandoned before its milestones are approved, the remaining
  escrow has no time-based escape hatch — donors decide, so unapproved funds stay locked. The
  `forfeitCreatorStake` path only applies to campaigns that missed their target.
- Collaborator test commit by prajwal-a-m-5555

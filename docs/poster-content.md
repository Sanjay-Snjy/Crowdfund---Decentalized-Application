# ANVESHANAM 2026 — Poster Content (Group No. 52)

**Title:** Trusted Crowdfunding Platform for Smart Contract using Blockchain
**Dept. of Computer Science and Engineering — Global Academy of Technology**

---

## 1. ABSTRACT

Traditional crowdfunding platforms act as trusted intermediaries: they collect donor money,
release it to creators on their own judgement and charge a fee, leaving donors with no proof of
how funds were actually used. This project removes that trust requirement by moving campaign
custody and fund release onto a blockchain. Donations are held by a Solidity smart contract and
are never handed to the creator up front; the contract releases three fixed milestones of 30%,
30% and 40% only after the creator submits IPFS-stored evidence and donors approve it by a
contribution-weighted vote with a 50% quorum. Campaigns that miss their funding target refund
donors in full, and an inactivity period lets donors reclaim escrow from abandoned campaigns.
A Next.js dApp with wallet login, an on-chain event indexer, CrowdFund user IDs and an admin
dashboard makes every donation, vote and release publicly verifiable on the Sepolia network.

**Short version (~85 words), if the box is small:**

Crowdfunding today relies on a central platform that holds donor money and decides when creators
are paid. This project replaces that trust with a smart contract: donations stay in escrow and are
released in three milestones (30% / 30% / 40%) only after the creator submits IPFS evidence and
donors approve it by contribution-weighted vote with a 50% quorum. Missed targets are refunded in
full and abandoned campaigns let donors reclaim their share. Every donation, vote and release is
publicly verifiable on-chain through a Next.js dApp.

---

## 2. PROBLEM STATEMENT

Centralised crowdfunding platforms concentrate both the money and the authority. Donors transfer
funds to a company, not to a campaign, and that company alone decides when and how much reaches
the creator. Campaigns that stall or fail leave donors dependent on the platform's refund process,
creators pay platform fees and face opaque approval, and no one can independently verify how much
was collected, when it was released, or whether the promised work was actually delivered. There is
no public, tamper-proof record of these transactions, so donors must simply trust the operator.

---

## 3. OBJECTIVES

1. **Decentralise campaign custody** — hold donor funds in a smart contract instead of a company,
   so no single party can move the money unilaterally.
2. **Enforce milestone-based escrow** — release 30% / 30% / 40% in strict order, only after the
   funding deadline has passed and the target has been reached.
3. **Give donors real control** — contribution-weighted voting with a 50% quorum lets donors
   approve or block each milestone release.
4. **Make evidence tamper-evident** — store campaign and milestone evidence on IPFS and record its
   hash on-chain, so it cannot be altered after submission.
5. **Guarantee donor protection** — automatic full refunds when a target is missed, and pro-rata
   escrow recovery when a funded campaign is abandoned.
6. **Provide verifiable transparency** — an on-chain event indexer, public donation activity,
   CrowdFund user IDs, donor reward points and an admin dashboard for auditable reporting.

---

## 4. SDG MAPPING (orange box on the poster)

Primary: **SDG 9 — Industry, Innovation and Infrastructure** (financial technology that makes
funding infrastructure transparent and accessible).
Secondary: **SDG 16 — Peace, Justice and Strong Institutions** (accountability, reduced
corruption through immutable public records).
Alternative/add-on if a third badge fits: **SDG 8 — Decent Work and Economic Growth**
(8.3 access to financial services for small ventures).

Suggested one-line impact statement under the badge:
> Blockchain escrow with donor-approved milestones makes every rupee traceable — funding
> infrastructure that communities can audit, not just trust.

---

## 5. Key facts to quote anywhere on the poster or slides

- Funds are **never released up front** — the contract holds 100% of donations in escrow.
- Release split **30% / 30% / 40%**, milestones handled strictly in order, no skipping.
- Voting power **= the donor's contribution**; approval needs a **strict majority of participating
  power** plus **50% quorum**. Refunding removes that voting power.
- **Failed campaign = full refund** per donor (`getRefund`); donations never claimed stay
  recoverable by their donors.
- Evidence is pinned to **IPFS**; only the CID goes on-chain.
- What the chain proves: who donated, when, who submitted evidence, how donors voted, what passed
  and how much was released — not that a photo or invoice is genuine. Donors judge that by voting.
- Verified testing on this checkout: **35 contract tests + 11 recovery tests + 22 live API
  smoke tests + 34 unit/DB tests** (identity 10, indexer 11, env-template 3, client hook 2,
  hosted-libSQL 8) — all passing.

> **If a judge probes deployment status:** abandon-recovery is implemented and covered by 11
> passing contract tests, but the contract address currently deployed on Sepolia predates it, so
> recovery goes live only after a redeploy. Milestone escrow, donor voting, refunds, IPFS evidence
> and the indexer are all live today.

**Keywords:** Blockchain, Ethereum, Smart Contract, Solidity, Milestone Escrow, IPFS, DeFi,
Transparency, Next.js, Wagmi.

**One-line pitch (title slide / verbal intro):**
A crowdfunding platform where the money is held by code, released only when donors approve real
milestone evidence, and refunded automatically when a campaign fails.

---

## 6. MODULES SLIDE (four quadrants, two points each)

Final module titles. Each quadrant carries exactly two points, in the bold-label-plus-one-sentence
format used below.

### MODULE 1: User Authentication

1. **Wallet-first sign-in, verified on the server** — the user signs a single-use server nonce and the
   signature is recovered with ethers before a session is issued as an HTTP-only cookie; Clerk
   provides a parallel email sign-in path, also verified server-side.
2. **One account, one permanent public ID** — both routes create or reuse the account idempotently,
   assign a permanent CrowdFund User ID (`CF-0001`, …), store emails only as a SHA-256 hash, and
   resolve roles from the database, so a browser can never promote itself to admin and a wallet can
   be linked to only one account.

### MODULE 2: Campaign Management

1. **Free, self-serve campaign creation** — a creator supplies a title, description, metadata hash,
   funding target and duration with no deposit and no platform creation fee, and the contract
   automatically creates the campaign's three fixed milestones.
2. **Discovery and a creator workspace in one place** — donors browse and search campaigns with live
   funding progress and a deadline countdown and bookmark the ones they back, while creators track
   their own campaigns; the whole interface can be explored in demo mode without a wallet.

### MODULE 3: Fund Management

1. **Escrow-only custody of donor money** — every contribution goes into the smart contract and
   nothing reaches the creator up front, with raised, still-locked and released amounts tracked per
   campaign so the escrow state is always derivable from the chain.
2. **Refunds and recovery as first-class rules** — contributions carry voting power that a refund
   removes, creators cannot donate to their own campaign, a missed target lets each donor refund in
   full, and an abandoned campaign lets donors claim their pro-rata share of the remaining escrow.

### MODULE 4: Milestone and Voting

1. **Evidence-gated, strictly ordered milestones** — the creator pins evidence to IPFS and submits
   only its CID, which opens voting on exactly one milestone at a time; the funding deadline must
   have passed and the target must be reached, so a milestone can never be skipped or released early.
2. **Contribution-weighted approval with a 50% quorum** — a milestone passes on a strict majority of
   the participating voting power with at least half of the campaign's voting power taking part, and
   the approved share is then released 30% / 30% / 40% in order, the last milestone absorbing the
   rounding remainder so exactly 100% of the escrow is paid out.

**Speaker line for this slide (~15 seconds):**
> Four modules, one guarantee: authentication is server-verified, money is escrowed by the contract,
> donors decide each release through evidence-backed voting, and everything else is indexed on-chain
> so anyone can audit it.

**If a fifth box is ever added — "What the chain proves" (optional honesty note):**
The blockchain proves who donated, when evidence was submitted, how donors voted and how much was
released. It cannot prove a photo or invoice is genuine — donors judge that when they vote. The
platform buys accountability through milestone evidence and voting, not blind trust.

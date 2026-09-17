import { useState, useEffect } from "react";

const STORAGE_KEY = "crowdfund_demo";

// ── Static demo values ──────────────────────────────────────────────────────
export const DEMO_USERNAME = "Demo";
export const DEMO_ETH = "1.5 ETH";
export const DEMO_ETH_BALANCE = "0";
export const DEMO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEMO_CHAIN_NAME = "Demo Network";
export const DEMO_CHAIN_ID = 0;

// ── Read / write helpers ─────────────────────────────────────────────────────
export function isDemoMode() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function enterDemoMode() {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, "true");
}

export function exitDemoMode() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Toggle helper that fires a DOM event so every useDemoMode() consumer
 * re-renders immediately.
 */
export function setDemoMode(value) {
  if (value) {
    enterDemoMode();
  } else {
    exitDemoMode();
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("demoModeChanged"));
  }
}

/**
 * React hook that reflects the current demoMode flag.
 */
export function useDemoMode() {
  const [demo, setDemo] = useState(() => isDemoMode());

  useEffect(() => {
    const handler = () => setDemo(isDemoMode());
    window.addEventListener("storage", handler);
    window.addEventListener("demoModeChanged", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("demoModeChanged", handler);
    };
  }, []);

  return demo;
}

// ── Fake dashboard data ──────────────────────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;

// Every demo campaign carries the creator stake (30% of the target) that the real
// contract locks on creation, so the demo UI shows the same accountability data.
export const DEMO_CAMPAIGNS = [
  {
    id: 1,
    title: "Clean Water for Rural Schools",
    description: "Providing sustainable water filtration systems to schools in underserved communities.",
    creator: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    targetAmount: BigInt("2000000000000000000"),
    raisedAmount: BigInt("1400000000000000000"),
    contributorsCount: 34,
    deadline: now + 15 * DAY,
    active: true,
    metadataHash: "",
    category: "Education",
    creatorStake: BigInt("600000000000000000"),
    stakeReturned: false,
    stakeForfeited: false,
    completed: false,
    completedAt: 0,
  },
  {
    id: 2,
    title: "Open-Source Dev Toolkit",
    description: "A developer toolkit for building decentralized applications faster.",
    creator: "0x1234567890AbCdEf1234567890AbCdEf12345678",
    targetAmount: BigInt("5000000000000000000"),
    raisedAmount: BigInt("3250000000000000000"),
    contributorsCount: 58,
    deadline: now + 30 * DAY,
    active: true,
    metadataHash: "",
    category: "Technology",
    creatorStake: BigInt("1500000000000000000"),
    stakeReturned: false,
    stakeForfeited: false,
    completed: false,
    completedAt: 0,
  },
  {
    id: 3,
    title: "Student Startup Accelerator",
    description: "Funding the next generation of student-led startups with micro-grants and mentorship.",
    creator: "0x9876543210FeDcBa9876543210FeDcBa98765432",
    targetAmount: BigInt("3000000000000000000"),
    raisedAmount: BigInt("1200000000000000000"),
    contributorsCount: 22,
    deadline: now + 45 * DAY,
    active: true,
    metadataHash: "",
    category: "Startup",
    creatorStake: BigInt("900000000000000000"),
    stakeReturned: false,
    stakeForfeited: false,
    completed: false,
    completedAt: 0,
  },
];

export const DEMO_CONTRIBUTIONS = [1, 2, 3];

export const DEMO_CONTRIBUTION_MAP = {
  1: { amount: BigInt("500000000000000000") },
  2: { amount: BigInt("250000000000000000") },
  3: { amount: BigInt("100000000000000000") },
};

export const DEMO_ACTIVE_CAMPAIGNS = DEMO_CAMPAIGNS;

export const DEMO_TRANSACTION_FEED = [
  { campaignId: 1, campaignTitle: "Clean Water for Rural Schools", action: "Contribution", amount: BigInt("500000000000000000"), timestamp: now - 2 * DAY },
  { campaignId: 2, campaignTitle: "Open-Source Dev Toolkit", action: "Contribution", amount: BigInt("250000000000000000"), timestamp: now - 5 * DAY },
  { campaignId: 3, campaignTitle: "Student Startup Accelerator", action: "Contribution", amount: BigInt("100000000000000000"), timestamp: now - 8 * DAY },
];

export const DEMO_CONTRACT_STATS = {
  totalCampaigns: BigInt(12),
  totalContributors: BigInt(144),
  totalRaised: BigInt("47500000000000000000"),
  totalFees: BigInt("950000000000000000"),
  contractBalance: BigInt("46550000000000000000"),
};

export const DEMO_PLATFORM_STATS = {
  totalCampaigns: 12,
  totalRaised: 47.5,
  totalContributors: 144,
  activeCampaigns: 5,
  successfulCampaigns: 3,
  platformFees: 0.95,
};

// The demo milestones mirror the fixed on-chain schedule: three milestones per
// campaign, 30% / 30% / 40% of the escrowed donor funds, released in order.
const demoMilestone = (title, percentage, overrides = {}) => ({
  title,
  description: "",
  percentage,
  amount: BigInt(0),
  completed: false,
  voteRequested: false,
  fundsReleased: false,
  approvals: 0,
  rejections: 0,
  createdAt: now - 10 * DAY,
  evidenceCID: "",
  evidenceSubmitted: false,
  evidenceSubmittedAt: 0,
  approved: false,
  totalVotingPower: BigInt(0),
  approvalWeight: BigInt(0),
  rejectionWeight: BigInt(0),
  ...overrides,
});

export const DEMO_MILESTONES = [
  [
    demoMilestone("Milestone 1", 30, {
      completed: true,
      voteRequested: true,
      evidenceSubmitted: true,
      evidenceSubmittedAt: now - 6 * DAY,
      evidenceCID: "QmDemoEvidenceCidOne",
      approved: true,
      fundsReleased: true,
      amount: BigInt("420000000000000000"),
      approvals: 12,
      rejections: 2,
      totalVotingPower: BigInt("1400000000000000000"),
      approvalWeight: BigInt("980000000000000000"),
      rejectionWeight: BigInt("120000000000000000"),
    }),
    demoMilestone("Milestone 2", 30, {
      completed: true,
      voteRequested: true,
      evidenceSubmitted: true,
      evidenceSubmittedAt: now - 2 * DAY,
      evidenceCID: "QmDemoEvidenceCidTwo",
      totalVotingPower: BigInt("1400000000000000000"),
      approvals: 4,
      rejections: 1,
      approvalWeight: BigInt("600000000000000000"),
      rejectionWeight: BigInt("100000000000000000"),
    }),
    demoMilestone("Milestone 3", 40),
  ],
  [
    demoMilestone("Milestone 1", 30, {
      completed: true,
      voteRequested: true,
      evidenceSubmitted: true,
      evidenceSubmittedAt: now - 9 * DAY,
      evidenceCID: "QmDemoToolkitEvidence",
      approved: true,
      fundsReleased: true,
      amount: BigInt("975000000000000000"),
      approvals: 20,
      rejections: 3,
      totalVotingPower: BigInt("3250000000000000000"),
      approvalWeight: BigInt("2100000000000000000"),
      rejectionWeight: BigInt("150000000000000000"),
    }),
    demoMilestone("Milestone 2", 30),
    demoMilestone("Milestone 3", 40),
  ],
  [
    demoMilestone("Milestone 1", 30),
    demoMilestone("Milestone 2", 30),
    demoMilestone("Milestone 3", 40),
  ],
];

export const DEMO_NOTIFICATIONS = [
  { id: "demo-1", type: "contribution", title: "New contribution to Clean Water for Rural Schools", detail: "0.5000 ETH", time: now - 2 * DAY, unread: true },
  { id: "demo-2", type: "contribution", title: "New contribution to Open-Source Dev Toolkit", detail: "0.2500 ETH", time: now - 5 * DAY, unread: true },
  { id: "demo-3", type: "deadline", title: "Clean Water for Rural Schools ends soon", detail: "15 days left", time: now, unread: false },
];

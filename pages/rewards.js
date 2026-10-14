/**
 * My Rewards — its own page.
 *
 * Rewards used to sit on the dashboard, where they competed for space with the
 * working cards. They now live here, one click away in the header profile menu, and
 * the dashboard keeps only what a creator needs at a glance.
 *
 * Every number is recomputed server-side by /api/rewards/me from indexed, confirmed
 * contribution events — the page only renders it. The wallet the browser has
 * connected is passed along so a freshly connected wallet shows its real points
 * straight away.
 */
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useAccount } from "wagmi";
import { FiAward, FiArrowLeft } from "react-icons/fi";
import Layout from "../components/Layout/Layout";
import RewardBadges from "../components/Rewards/RewardBadges";
import MyDonations from "../components/Donations/MyDonations";
import Link from "next/link";
import { useDemoMode } from "../lib/demoMode";

export default function RewardsPage() {
  const { isConnected } = useAccount();
  const demoMode = useDemoMode();
  const router = useRouter();

  useEffect(() => {
    if (!isConnected && !demoMode) router.push("/");
  }, [isConnected, router, demoMode]);

  if (!isConnected && !demoMode) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <div className="card max-w-sm p-8 text-center">
            <h2 className="mb-2 text-lg font-bold" style={{ color: "var(--color-text)" }}>
              Connect Your Wallet
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Connect the wallet you contributed with to see your rewards.
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-8xl mx-auto space-y-6 py-8 pl-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}
            >
              <FiAward className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>
                My Rewards
              </h1>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                Points and badges computed from your confirmed, on-chain contributions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/contributions" className="btn btn-secondary btn-sm rounded-3xl px-4">
              <FiArrowLeft className="h-3 w-3" /> My Contributions
            </Link>
            <Link href="/dashboard" className="btn btn-sm rounded-3xl px-4">
              Dashboard
            </Link>
          </div>
        </div>

        <RewardBadges />

        {/* The same confirmed contributions the points are derived from, so a donor
            can check the arithmetic against the chain. */}
        <MyDonations title="Contributions counted towards rewards" limit={10} />
      </div>
    </Layout>
  );
}

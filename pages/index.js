import { useRouter } from "next/router";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { useAccount, useContractRead } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState, useEffect, useMemo } from "react";
import {
  FiArrowRight,
  FiTarget,
  FiUsers,
  FiShield,
  FiGlobe,
  FiDatabase,
  FiFlag,
  FiThumbsUp,
  FiTrendingUp,
  FiBookOpen,
  FiBriefcase,
  FiBook,
  FiHeart,
  FiZap,
  FiSun,
  FiPenTool,
} from "react-icons/fi";
import { CONTRACT_ADDRESS } from "../constants";
import { CROWDFUNDING_ABI } from "../constants/abi";
import { setDemoMode } from "../lib/demoMode";
import { useContract } from "../hooks/useContract";
import CampaignCard from "../components/Campaign/CampaignCard";
import { getFromIPFS } from "../utils/ipfs";

export default function Home() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { user, isLoaded } = useUser();
  const [stats, setStats] = useState({
    campaignsLaunched: 0,
    fundsRaised: 0,
    contributors: 0,
  });
  const [loading, setLoading] = useState(true);
  const [shouldBlinkDashboard, setShouldBlinkDashboard] = useState(false);

  const hasValidClerkKey =
    typeof process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === "string" &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.trim().length > 0 &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.includes("your_clerk_publishable_key_here");

  // If the user signed in through real Clerk auth, auto-clear demo mode.
  useEffect(() => {
    if (hasValidClerkKey && isLoaded && user) {
      setDemoMode(false);
    }
  }, [hasValidClerkKey, isLoaded, user]);

  // Force dark mode on landing page for correct CSS variable resolution.
  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => {
      let savedTheme;
      try {
        savedTheme = localStorage.getItem("theme");
      } catch {
        savedTheme = null;
      }
      if (savedTheme === "light") {
        document.documentElement.classList.remove("dark");
      }
      document.documentElement.style.colorScheme =
        document.documentElement.classList.contains("dark") ? "dark" : "light";
    };
  }, []);

  // Fetch campaign counter
  const { data: campaignCount } = useContractRead({
    address: CONTRACT_ADDRESS,
    abi: CROWDFUNDING_ABI,
    functionName: "campaignCounter",
    staleTime: 30_000,
  });

  // Blink the explore button right after the wallet connects
  useEffect(() => {
    const wasWalletConnected = localStorage.getItem("walletWasConnected") === "true";
    const isNewConnection = isConnected && !wasWalletConnected;

    if (isNewConnection) {
      const blinkTimer = setTimeout(() => {
        setShouldBlinkDashboard(true);
        setTimeout(() => setShouldBlinkDashboard(false), 1200);
      }, 1000);
      return () => clearTimeout(blinkTimer);
    }

    localStorage.setItem("walletWasConnected", isConnected.toString());
  }, [isConnected]);

  // Fetch and aggregate campaign statistics from the chain
  useEffect(() => {
    const fetchStats = async () => {
      if (!campaignCount) return;

      try {
        setLoading(true);
        const publicClient = await import("wagmi").then((m) => m.publicClient);
        let totalFunds = 0n;
        let totalContributors = 0;

        const campaignId = campaignCount.toNumber ? campaignCount.toNumber() : Number(campaignCount);

        for (let i = 1; i <= campaignId; i++) {
          try {
            const result = await publicClient().readContract({
              address: CONTRACT_ADDRESS,
              abi: CROWDFUNDING_ABI,
              functionName: "getCampaignStats",
              args: [i],
            });

            if (result) {
              totalFunds += BigInt(result[0]);
              totalContributors += Number(result[2]);
            }
          } catch (err) {
            console.warn(`Error fetching stats for campaign ${i}:`, err);
          }
        }

        setStats({
          campaignsLaunched: campaignId,
          fundsRaised: totalFunds,
          contributors: totalContributors,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [campaignCount]);

  const features = [
    {
      icon: FiTarget,
      title: "Launch Your Ideas",
      description:
        "Create a campaign in minutes. Describe your goal, set your target, and go live.",
    },
    {
      icon: FiShield,
      title: "Secure & Transparent",
      description:
        "Funds are handled by smart contracts. No one can move them without the rules you set.",
    },
    {
      icon: FiGlobe,
      title: "Decentralized",
      description:
        "No middlemen. You and your backers deal directly with each other, from wallet to wallet.",
    },
    {
      icon: FiDatabase,
      title: "Immutable Records",
      description:
        "Every contribution is stored on the blockchain and can be checked at any time.",
    },
    {
      icon: FiFlag,
      title: "Milestone Based Funding",
      description:
        "Money is released step by step, only as the work gets done.",
    },
    {
      icon: FiThumbsUp,
      title: "Voting Based Donation",
      description:
        "The community votes on how donations are used, so every decision stays fair.",
    },
  ];

  const howItWorks = [
    {
      title: "Start your campaign",
      description:
        "Describe what you are building, set your goal and deadline, and publish your campaign.",
    },
    {
      title: "Collect funds on-chain",
      description:
        "People contribute straight from their wallets. Every contribution is open for anyone to see.",
    },
    {
      title: "Grow with your backers",
      description:
        "Share updates as you progress. Backers follow your work and funds stay protected by the contract.",
    },
  ];

  const categoryDefinitions = [
    { icon: FiBookOpen, title: "Student Projects", description: "Support student ideas and research." },
    { icon: FiBriefcase, title: "Startups", description: "Help new businesses get off the ground." },
    { icon: FiBook, title: "Education", description: "Fund learning programs and scholarships." },
    { icon: FiHeart, title: "Medical", description: "Support treatment and medical needs." },
    { icon: FiGlobe, title: "Social Causes", description: "Back community and charity projects." },
    { icon: FiZap, title: "Research & Innovation", description: "Support new research and discovery." },
    { icon: FiZap, title: "Technology", description: "Fund useful tools and products." },
    { icon: FiSun, title: "Agriculture", description: "Help farms and food systems grow." },
    { icon: FiPenTool, title: "Arts and Culture", description: "Support creative and cultural work." },
    { icon: FiGlobe, title: "Environment", description: "Fund projects that protect nature." },
  ];

  const { useActiveCampaigns } = useContract();
  const { data: campaignsForLanding, isLoading: recentCampaignsLoading } = useActiveCampaigns(0, 100);
  const visibleRecentCampaigns = Array.isArray(campaignsForLanding)
    ? campaignsForLanding.slice(0, 4)
    : [];

  const [recentCreatorProfiles, setRecentCreatorProfiles] = useState({});
  const [campaignMetadataMap, setCampaignMetadataMap] = useState({});
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!Array.isArray(campaignsForLanding) || !campaignsForLanding.length) {
      setCampaignMetadataMap({});
      return;
    }

    const fetchMetadataForCampaigns = async () => {
      const entries = await Promise.all(
        campaignsForLanding.map(async (campaign) => {
          const id = campaign.id?.toString?.();
          if (!id || campaignMetadataMap[id] || !campaign.metadataHash) {
            return null;
          }

          const result = await getFromIPFS(campaign.metadataHash);
          return result.success ? [id, result.data] : null;
        })
      );

      const nextMap = entries.reduce((acc, entry) => {
        if (entry) {
          const [id, data] = entry;
          acc[id] = data;
        }
        return acc;
      }, {});

      if (Object.keys(nextMap).length) {
        setCampaignMetadataMap((prev) => ({ ...prev, ...nextMap }));
      }
    };

    fetchMetadataForCampaigns();
  }, [campaignsForLanding, campaignMetadataMap]);

  const liveCampaignData = useMemo(() => {
    const campaigns = Array.isArray(campaignsForLanding)
      ? campaignsForLanding.filter((campaign) => campaign?.active !== false)
      : [];

    const categoryTotals = campaigns.reduce((acc, campaign) => {
      const id = campaign.id?.toString?.();
      const metadata = id ? campaignMetadataMap[id] : null;
      const rawCategory = campaign.category?.toString?.() || metadata?.category?.toString?.() || "General";
      const normalizedCategory = rawCategory.toLowerCase();

      let categoryTitle = "General";
      if (normalizedCategory.includes("student")) {
        categoryTitle = "Student Projects";
      } else if (normalizedCategory.includes("startup")) {
        categoryTitle = "Startups";
      } else if (normalizedCategory.includes("education")) {
        categoryTitle = "Education";
      } else if (normalizedCategory.includes("medical")) {
        categoryTitle = "Medical";
      } else if (normalizedCategory.includes("social")) {
        categoryTitle = "Social Causes";
      } else if (normalizedCategory.includes("research") || normalizedCategory.includes("innovation")) {
        categoryTitle = "Research & Innovation";
      } else if (normalizedCategory.includes("technology")) {
        categoryTitle = "Technology";
      } else if (normalizedCategory.includes("agriculture")) {
        categoryTitle = "Agriculture";
      } else if (normalizedCategory.includes("arts") || normalizedCategory.includes("culture")) {
        categoryTitle = "Arts and Culture";
      } else if (normalizedCategory.includes("environment")) {
        categoryTitle = "Environment";
      }

      if (!acc[categoryTitle]) {
        acc[categoryTitle] = {
          title: categoryTitle,
          campaigns: 0,
          ethRaised: 0,
        };
      }

      acc[categoryTitle].campaigns += 1;
      acc[categoryTitle].ethRaised += Number(campaign.raisedAmount?.toString?.() || "0") / 1e18;

      return acc;
    }, {});

    const categoryCards = categoryDefinitions.map((definition) => ({
      ...definition,
      campaigns: categoryTotals[definition.title]?.campaigns || 0,
      ethRaised: categoryTotals[definition.title]?.ethRaised || 0,
    }));

    return {
      activeCampaigns: campaigns.length,
      totalContributors: campaigns.reduce(
        (sum, campaign) => sum + Number(campaign.contributorsCount || 0),
        0
      ),
      totalRaisedEth: campaigns.reduce(
        (sum, campaign) => sum + Number(campaign.raisedAmount?.toString?.() || "0") / 1e18,
        0
      ),
      categoryCards,
    };
  }, [campaignsForLanding, campaignMetadataMap]);

  const categoryOverviewStats = useMemo(() => {
    const liveCategoryCount = liveCampaignData.categoryCards.filter((category) => category.campaigns > 0).length;

    return [
      { icon: FiTarget, label: `${liveCategoryCount} Categories` },
      { icon: FiTrendingUp, label: `${liveCampaignData.activeCampaigns} Active Campaigns` },
      { icon: FiUsers, label: `${liveCampaignData.totalContributors} Contributors` },
    ];
  }, [liveCampaignData]);

  const campaignCategories = liveCampaignData.categoryCards;

  useEffect(() => {
    const campaignAddresses = Array.from(
      new Set(
        visibleRecentCampaigns
          .map((campaign) => campaign.creator?.toString?.()?.toLowerCase())
          .filter(Boolean)
      )
    );

    if (!campaignAddresses.length) {
      setRecentCreatorProfiles({});
      return;
    }

    const controller = new AbortController();
    const query = campaignAddresses.map(encodeURIComponent).join(",");

    const loadCreatorProfiles = async () => {
      try {
        const response = await fetch(
          `/api/wallet-link?walletAddresses=${query}`,
          { signal: controller.signal }
        );
        const data = await response.json();

        if (Array.isArray(data.walletProfiles)) {
          const nextProfiles = {};
          data.walletProfiles.forEach((profile) => {
            if (profile?.walletAddress) {
              nextProfiles[profile.walletAddress.toLowerCase()] = profile;
            }
          });
          setRecentCreatorProfiles(nextProfiles);
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Failed to load campaign creator profiles:", error);
        }
      }
    };

    loadCreatorProfiles();
    return () => controller.abort();
  }, [visibleRecentCampaigns]);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const handleGoToCampaigns = () => {
    router.push("/all-campaigns");
  };
  const handleGoToDashboard = () => {
    router.push("/dashboard");
  };

  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const currentUserName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "";

  const authEnabled = hasValidClerkKey;
  const signedIn = authEnabled && isLoaded && Boolean(user);
  // Progressive hero CTA: 1) sign in/up, 2) connect wallet, 3) explore + dashboard.
  // Render nothing until Clerk resolves so signed-in users don't see a sign-in flash.
  const heroStep = authEnabled && !isLoaded ? 0 : authEnabled && !signedIn ? 1 : !isConnected ? 2 : 3;

  const heroPrimaryButtonClass =
    "inline-flex w-full items-center justify-center rounded-full bg-indigo-500 backdrop-blur-sm px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-indigo-400 sm:w-auto";
  const heroSecondaryButtonClass =
    "inline-flex w-full items-center justify-center rounded-full border border-white/15 backdrop-blur-sm px-8 py-3.5 text-sm font-medium text-white transition-colors hover:border-white/40 sm:w-auto";

  const heroStats = [
    { value: loading ? "—" : String(stats.campaignsLaunched), label: "Campaigns" },
    {
      value: loading ? "—" : `Ξ ${(Number(stats.fundsRaised) / 1e18).toFixed(2)}`,
      label: "Funds Raised",
    },
    { value: loading ? "—" : String(stats.contributors), label: "Contributors" },
  ];

  return (
    <div
      onMouseMove={(e) => {
        setMousePosition({ x: e.clientX, y: e.clientY });
      }}
      className="relative min-h-screen overflow-x-hidden bg-black text-white"
    >
      {/* ===== Background layers (static, stays fixed while content scrolls) ===== */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {/* Black base with a soft blue/indigo gradient */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#0b1030_0%,#05060f_40%,#000000_70%,#070c22_100%)]" />
        {/* Soft indigo glow at the top */}
        <div className="absolute -top-32 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[140px]" />
        {/* Soft blue glow near the bottom */}
        <div className="absolute bottom-[-10%] right-[-10%] h-[380px] w-[560px] rounded-full bg-blue-600/15 blur-[140px]" />
        {/* Base dot grid */}
        <div
          className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1.2px)] [background-size:10px_10px]"
        />
        {/* Interactive dots that follow the cursor (desktop only) */}
        <div
          className="hidden md:block absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.6)_0.8px,transparent_1px)] [background-size:10px_10px]"
          style={{
            maskImage: `radial-gradient(circle 160px at ${mousePosition.x}px ${mousePosition.y}px, white 0%, transparent 80%)`,
            WebkitMaskImage: `radial-gradient(circle 160px at ${mousePosition.x}px ${mousePosition.y}px, white 0%, transparent 80%)`,
          }}
        />
      </div>

      {/* ===== Header ===== */}
      <header
        className={`fixed z-50 transition-all duration-300 backdrop-blur-lg ${
          scrolled
            ? "top-0 left-0 right-0 border-b border-white/15 bg-white/08"
            : "top-2 left-2 right-2 rounded-4xl border border-white/15 bg-white/05"
        }`}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
          {/* Logo + Name */}
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex min-w-0 items-center gap-2"
          >
            <div className="flex h-10 w-10 items-center justify-center">
              <img src="/logo.png" alt="CrowdFund Logo" className="h-full w-full object-contain" />
            </div>
            <span className="truncate text-lg font-bold text-white">CrowdFund</span>
          </button>

          {/* Actions */}
          <div className="flex flex-shrink-0 items-center gap-2">
            {hasValidClerkKey ? (
              <>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="rounded-full px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white">
                      Login
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-white/40">
                      Sign Up
                    </button>
                  </SignUpButton>
                </SignedOut>

                <SignedIn>
                  <UserButton afterSignOutUrl="/" />
                  <ConnectButton.Custom>
                    {({ openConnectModal, mounted, account }) => {
                      if (!mounted) return null;
                      return (
                        <button
                          onClick={openConnectModal}
                          className="rounded-full px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white"
                        >
                          {account ? "Wallet Connected" : "Connect Wallet"}
                        </button>
                      );
                    }}
                  </ConnectButton.Custom>
                </SignedIn>
              </>
            ) : (
              <ConnectButton.Custom>
                {({ openConnectModal, mounted, account }) => {
                  if (!mounted) return null;
                  return (
                    <button
                      onClick={openConnectModal}
                      className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-white/40"
                    >
                      {account ? "Wallet Connected" : "Connect Wallet"}
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            )}          </div>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section
        className="relative z-10 mx-auto w-full max-w-7xl overflow-hidden bg-cover bg-center px-4 pt-32 pb-20 text-center sm:px-6 lg:px-8"
        style={{
          backgroundImage: "url('/bg.png')",
        }}
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 backdrop-blur-sm rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs font-medium text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            Decentralized crowdfunding on Ethereum
          </div>

          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
            Fund ideas that matter.
            <span className="mt-3 block bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent">
              Keep full control.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            CrowdFund lets you launch campaigns, raise funds, and back projects with complete
            transparency. Every contribution is recorded on-chain, so you always know where the
            money goes.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {heroStep === 1 && (
              <>
                <SignInButton mode="modal">
                  <button className={heroSecondaryButtonClass}>Sign In</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className={heroPrimaryButtonClass}>
                    Sign Up
                    <FiArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </SignUpButton>
                <button
                  onClick={() => {
                    setDemoMode(true);
                    router.push("/all-campaigns");
                  }}
                  className="inline-flex w-full items-center justify-center rounded-full border border-white/15 backdrop-blur-sm px-8 py-3.5 text-sm font-medium text-white/70 transition-colors hover:border-white/40 hover:text-white sm:w-auto"
                >
                  Demo Login
                </button>
              </>
            )}

            {heroStep === 2 && (
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => {
                  if (!mounted) return null;
                  return (
                    <button onClick={openConnectModal} className={heroPrimaryButtonClass}>
                      Connect Wallet
                      <FiArrowRight className="ml-2 h-4 w-4" />
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            )}

            {heroStep === 3 && (
              <>
                <button
                  onClick={handleGoToCampaigns}
                  className={`inline-flex w-full items-center justify-center rounded-full border border-indigo-500 backdrop-blur-sm px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-indigo-500 sm:w-auto ${
                    shouldBlinkDashboard ? "blink-twice" : ""
                  }`}
                >
                  Explore Campaigns
                </button>
                <button
                  onClick={handleGoToDashboard}
                  className="inline-flex w-full items-center justify-center rounded-full backdrop-blur-sm px-6 py-3.5 border border-white/60 text-sm font-medium text-white/60 transition-colors hover:text-white sm:w-auto"
                >
                  Go to Dashboard
                </button>
              </>
            )}
          </div>

          {/* Live stats */}
          <div className="mx-auto mt-16 grid max-w-xl grid-cols-3 divide-x divide-white/10 rounded-3xl backdrop-blur-sm border border-white/10 bg-white/[0.03] py-6">
            {heroStats.map((stat, i) => (
              <div key={i} className="px-2">
                <p className="text-xl font-bold tabular-nums text-white sm:text-2xl">{stat.value}</p>
                <p className="mt-1 text-xs text-white/50 sm:text-sm">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Recent Campaigns ===== */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
              Live on the platform
            </p>
            <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
              Latest Campaigns
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/50">
              See what the community is funding right now. Real campaigns, real backers, on-chain
              data.
            </p>
          </div>
          <button
            onClick={() => router.push("/all-campaigns")}
            className="inline-flex flex-shrink-0 items-center gap-2 self-start rounded-full border border-white/35 backdrop-blur-sm px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/40 md:self-auto"
          >
            View All
            <FiArrowRight className="h-4 w-4" />
          </button>
        </div>

        {recentCampaignsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="h-36 rounded-xl bg-white/[0.04]" />
                <div className="h-4 w-3/4 rounded bg-white/[0.04]" />
                <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
                <div className="h-1.5 rounded-full bg-white/[0.04]" />
              </div>
            ))}
          </div>
        ) : visibleRecentCampaigns.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visibleRecentCampaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                creatorProfile={recentCreatorProfiles[campaign.creator?.toString?.()?.toLowerCase()]}
                currentUserAddress={address}
                currentUserName={currentUserName}
                isLandingCard
                className="border-white/[0.08] bg-white/[0.03] backdrop-blur-sm"
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
            <p className="text-sm text-white/50">
              No campaigns yet. Be the first to launch one.
            </p>
          </div>
        )}
      </section>

      {/* ===== How It Works ===== */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-12 lg:flex-row lg:items-end lg:justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
            How It Works
          </p>
          <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
            Three steps to get funded
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {howItWorks.map((step, index) => (
            <div
              key={index}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-6 transition-colors hover:border-indigo-400/40"
            >
              <span className="text-sm font-semibold tabular-nums text-indigo-400">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Categories ===== */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
              Categories
            </p>
            <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
              Find what you care about
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/50">
              Browse campaigns by category. Counts update live as people fund projects.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryOverviewStats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-full border border-white/10 backdrop-blur-sm bg-white/[0.03] px-4 py-2"
                >
                  <Icon className="h-4 w-4 text-indigo-400" />
                  <span className="text-sm text-white/70">{stat.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaignCategories.map((category, index) => {
            const Icon = category.icon;
            return (
              <div
                key={index}
                className={`group rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-5 transition-colors hover:border-indigo-400/40 ${
                  index === campaignCategories.length - 1 ? "lg:col-start-2" : ""
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-indigo-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-white">{category.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-white/50 line-clamp-2">
                      {category.description}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white">{category.campaigns}</span>
                    <span className="text-xs text-white/40">
                      campaign{category.campaigns !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-indigo-300">
                      {category.ethRaised.toFixed(1)}
                    </span>
                    <span className="text-xs text-white/40">ETH raised</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== Features ===== */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
            Why CrowdFund
          </p>
          <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
            Built for safe, open fundraising
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/50">
            Everything founders and backers need, running on-chain.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <div
              key={index}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-6 transition-colors hover:border-indigo-400/40"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-indigo-300">
                  <feature.icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium tabular-nums text-white/25">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Call to Action ===== */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-indigo-400/20 bg-indigo-500/[0.06] backdrop-blur-sm px-6 py-14 text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Ready to start?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/60 sm:text-base">
            Launch your campaign today and raise funds with full transparency, from the first
            contribution to the last milestone.
          </p>
          <button
            onClick={() => router.push("/create-campaign")}
            className="mt-8 inline-flex items-center rounded-full bg-indigo-500 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
          >
            Start a Campaign
            <FiArrowRight className="ml-2 h-4 w-4" />
          </button>
        </div>
      </section>

      {/* ===== Go to Top ===== */}
      <div className="relative z-10 flex justify-center pb-10">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] backdrop-blur-sm px-5 py-2.5 text-sm font-medium text-white/70 transition-colors hover:border-white/40 hover:text-white"
          aria-label="Go to top"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
          Back to top
        </button>
      </div>

      {/* ===== Footer ===== */}
      <footer className="relative z-10 border-t border-white/[0.08] backdrop-blur-sm bg-black/60">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6 lg:px-8">
          <div className="flex flex-col items-center gap-8 md:flex-row md:justify-center md:gap-16">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="CrowdFund Logo" className="h-10 w-10 object-contain" />
              <div>
                <p className="text-lg font-semibold text-white">CrowdFund</p>
                <p className="mt-0.5 text-sm text-white/40">
                  Decentralized crowdfunding on Ethereum.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                Product
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-white/60">
                <li>
                  <a href="/all-campaigns" className="transition hover:text-white">
                    Browse campaigns
                  </a>
                </li>
                <li>
                  <a href="/create-campaign" className="transition hover:text-white">
                    Start a campaign
                  </a>
                </li>
                <li>
                  <a href="/dashboard" className="transition hover:text-white">
                    Your dashboard
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 border-t border-white/[0.08] pt-6 text-xs text-white/30">
            © {new Date().getFullYear()} CrowdFund. Built for open, on-chain funding.
          </div>
        </div>
      </footer>
    </div>
  );
}

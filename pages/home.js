import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Layout from "../components/Layout/Layout";
import { useContract } from "../hooks/useContract";
import { useUser } from "@clerk/nextjs";
import { useAccount } from "wagmi";
import {
  FiSearch,
  FiGrid,
  FiList,
  FiFilter,
  FiChevronLeft,
  FiChevronRight,
  FiZap,
  FiActivity,
  FiClock,
  FiUsers,
  FiTrendingUp,
  FiAward,
  FiTarget,
  FiUploadCloud,
  FiArrowRight,
  FiCheckCircle,
  FiShield,
} from "react-icons/fi";
import { getCreatorDisplayName, calculateProgress } from "../utils/helpers";
import { getFromIPFS } from "../utils/ipfs";
import CampaignCard from "../components/Campaign/CampaignCard";
import { useDemoMode, DEMO_ACTIVE_CAMPAIGNS, DEMO_TRANSACTION_FEED } from "../lib/demoMode";

const CATEGORIES = [
  "All", "Student Projects", "Medical", "Startup", "Education",
  "Research and Innovation", "Social Causes", "Technology", "Agriculture",
  "Arts and Culture", "Environment",
];

const HERO_SLIDES = [
  {
    image: "/Hero_banners/1.png",
    title: "Empower Student Projects",
    subtitle1: "Big ideas begin with bold student innovation.",
    subtitle2: "Support young creators and help their ideas take shape.",
  },
  {
    image: "/Hero_banners/2.png",
    title: "Support Better Healthcare",
    subtitle1: "Heal lives and bring hope through meaningful support.",
    subtitle2: "Fund medical treatments, equipment, and healthcare initiatives.",
  },
  {
    image: "/Hero_banners/3.png",
    title: "Fuel the Next Startup",
    subtitle1: "Turn ambitious ideas into the next big opportunity.",
    subtitle2: "Back startups and early-stage ventures shaping the future.",
  },
  {
    image: "/Hero_banners/4.png",
    title: "Empower Through Education",
    subtitle1: "Education creates opportunities and empowers every dream.",
    subtitle2: "Support learning, scholarships, and educational programs.",
  },
  {
    image: "/Hero_banners/5.png",
    title: "Research and Innovation",
    subtitle1: "Innovate today and create a lasting impact tomorrow.",
    subtitle2: "Fund research and breakthrough ideas that drive progress.",
  },
  {
    image: "/Hero_banners/10.png",
    title: "Create Meaningful Social Impact",
    subtitle1: "Together, we can create meaningful and lasting change.",
    subtitle2: "Support initiatives that uplift communities and transform lives.",
  },
  {
    image: "/Hero_banners/6.png",
    title: "Build Future with Technology",
    subtitle1: "Power bold ideas and build technology for the future.",
    subtitle2: "Support innovative solutions that transform the world.",
  },
  {
    image: "/Hero_banners/9.png",
    title: "Grow Sustainable Agriculture",
    subtitle1: "Grow smarter today and help feed a sustainable future.",
    subtitle2: "Support modern farming and sustainable agriculture projects.",
  },
  {
    image: "/Hero_banners/7.png",
    title: "Celebrate Arts and Culture",
    subtitle1: "Celebrate creativity while preserving culture and heritage.",
    subtitle2: "Support artists, performances, and inspiring cultural initiatives.",
  },
  {
    image: "/Hero_banners/8.png",
    title: "Protect Our Environment",
    subtitle1: "Protect our planet today for a sustainable tomorrow.",
    subtitle2: "Support projects that preserve nature and restore ecosystems.",
  },
];

const CATEGORY_META = {
  "Student Projects": FiUsers,
  Medical: FiShield,
  Startup: FiUploadCloud,
  Education: FiAward,
  "Research and Innovation": FiZap,
  "Social Causes": FiUsers,
  Technology: FiZap,
  Agriculture: FiTarget,
  "Arts and Culture": FiAward,
  Environment: FiTarget,
};

const formatEth = (wei) => {
  try {
    const n = Number(wei?.toString?.() ?? 0) / 1e18;
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(n < 10 ? 2 : 1);
  } catch {
    return "0";
  }
};

export default function AllCampaignsPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { user } = useUser();
  const { useActiveCampaigns } = useContract();
  const isDemo = useDemoMode();

  const currentUserName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "";

  const { data: onChainCampaigns, isLoading } = useActiveCampaigns(0, 100);
  // In demo mode, show the bundled sample campaigns instead of on-chain data.
  const campaigns = isDemo ? DEMO_ACTIVE_CAMPAIGNS : onChainCampaigns;

  // URL-synced state
  const [searchTerm, setSearchTerm] = useState(router.query.search || "");
  const [activeCategory, setActiveCategory] = useState(router.query.category || "All");
  const [filterStatus, setFilterStatus] = useState(router.query.status || "all");
  const [sortBy, setSortBy] = useState(router.query.sort || "newest");
  const [viewMode, setViewMode] = useState("grid");
  const [currentSlide, setCurrentSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [timeNow, setTimeNow] = useState(() => Math.floor(Date.now() / 1000));

  const trendingRef = useRef(null);
  const scrollTrending = (dir) => {
    trendingRef.current?.scrollBy({ left: dir * 340, behavior: "smooth" });
  };

  // Auto-advance hero slideshow (pauses on hover)
  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [paused]);

  // Ticker clock for countdowns
  useEffect(() => {
    const t = setInterval(() => setTimeNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Campaign metadata
  const [metadataMap, setMetadataMap] = useState({});
  const [creatorProfiles, setCreatorProfiles] = useState({});
  const fetchedIds = useRef(new Set());

  // Fetch metadata
  useEffect(() => {
    if (!campaigns?.length) return;
    const fetchAll = async () => {
      const entries = await Promise.all(
        campaigns.map(async (c) => {
          const id = c.id?.toString?.();
          if (!id || fetchedIds.current.has(id) || !c.metadataHash) return null;
          fetchedIds.current.add(id);
          const res = await getFromIPFS(c.metadataHash);
          return res.success ? [id, res.data] : null;
        })
      );
      const map = {};
      entries.forEach((e) => { if (e) map[e[0]] = e[1]; });
      if (Object.keys(map).length) setMetadataMap((prev) => ({ ...prev, ...map }));
    };
    fetchAll();
  }, [campaigns]);

  // Fetch creator profiles
  useEffect(() => {
    if (!campaigns?.length) return;
    const addresses = [...new Set(campaigns.map((c) => c.creator?.toString?.()?.toLowerCase()).filter(Boolean))];
    if (!addresses.length) return;
    const controller = new AbortController();
    fetch(`/api/wallet-link?walletAddresses=${addresses.map(encodeURIComponent).join(",")}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.walletProfiles)) {
          const map = {};
          data.walletProfiles.forEach((p) => { if (p?.walletAddress) map[p.walletAddress.toLowerCase()] = p; });
          setCreatorProfiles(map);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [campaigns]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (campaigns || [])
      .filter((c) => {
        if (!c) return false;
        const meta = metadataMap[c.id?.toString?.()];
        const category = c.category?.toString?.() || meta?.category?.toString?.() || "";
        const title = c.title?.toString?.() || "";
        const desc = c.description?.toString?.() || "";
        const raised = Number(c.raisedAmount?.toString?.() || 0);
        const target = Number(c.targetAmount?.toString?.() || 0);

        if (q && !title.toLowerCase().includes(q) && !desc.toLowerCase().includes(q)) return false;
        if (activeCategory !== "All" && category.toLowerCase() !== activeCategory.toLowerCase()) return false;
        if (filterStatus === "active") return c.active;
        if (filterStatus === "funded") return raised >= target;
        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "ending": return Number(a.deadline || 0) - Number(b.deadline || 0);
          case "funded": return Number(b.raisedAmount?.toString?.() || 0) - Number(a.raisedAmount?.toString?.() || 0);
          case "popular": return (b.contributorsCount || 0) - (a.contributorsCount || 0);
          default: return Number(b.id?.toString?.() || 0) - Number(a.id?.toString?.() || 0);
        }
      });
  }, [campaigns, searchTerm, activeCategory, filterStatus, sortBy, metadataMap]);

  const totalCampaigns = campaigns?.length || 0;
  const activeCount = campaigns?.filter((c) => c.active).length || 0;
  const fundedCount = campaigns?.filter((c) => Number(c.raisedAmount?.toString?.() || 0) >= Number(c.targetAmount?.toString?.() || 0)).length || 0;
  const totalRaised = (campaigns || []).reduce((acc, c) => acc + Number(c.raisedAmount?.toString?.() || 0) / 1e18, 0);
  const totalBackers = (campaigns || []).reduce((acc, c) => acc + (Number(c.contributorsCount) || 0), 0);

  // Trending: top 6 by raised amount, excluding fully funded ones
  const trending = useMemo(
    () =>
      (campaigns || [])
        .filter((c) => c.active && Number(c.raisedAmount?.toString?.() || 0) < Number(c.targetAmount?.toString?.() || 0))
        .sort((a, b) => Number(b.raisedAmount?.toString?.() || 0) - Number(a.raisedAmount?.toString?.() || 0))
        .slice(0, 6),
    [campaigns]
  );

  // Live activity feed from transaction data (demo or on-chain derived)
  const activityFeed = useMemo(() => {
    if (isDemo) {
      return DEMO_TRANSACTION_FEED.map((t, i) => ({
        id: `demo-${i}`,
        campaignId: t.campaignId,
        campaignTitle: t.campaignTitle,
        action: t.action,
        amount: t.amount,
        timestamp: t.timestamp,
      }));
    }
    return (campaigns || [])
      .slice(0, 6)
      .map((c) => ({
        id: `chain-${c.id?.toString?.()}`,
        campaignId: c.id?.toString?.(),
        campaignTitle: c.title?.toString?.() || "Untitled campaign",
        action: "Campaign live",
        amount: c.raisedAmount,
        timestamp: Number(c.deadline || 0) - 30 * 86400,
      }));
  }, [isDemo, campaigns]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    (campaigns || []).forEach((c) => {
      const meta = metadataMap[c.id?.toString?.()];
      const category = (c.category?.toString?.() || meta?.category?.toString?.() || "").trim();
      if (!category) return;
      counts[category] = (counts[category] || 0) + 1;
    });
    return counts;
  }, [campaigns, metadataMap]);

  const timeLeft = (deadline) => {
    const diff = Number(deadline || 0) - timeNow;
    if (diff <= 0) return "Ended";
    const days = Math.floor(diff / 86400);
    if (days >= 1) return `${days}d left`;
    const hours = Math.floor(diff / 3600);
    if (hours >= 1) return `${hours}h left`;
    return `${Math.max(1, Math.floor(diff / 60))}m left`;
  };

  const timeAgo = (ts) => {
    const diff = Math.max(0, timeNow - Number(ts || 0));
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  // The category tiles sit above the results, so scrolling to the #all-campaigns
  // section top carries the view *away* from the campaigns (upwards) and leaves
  // the cards off-screen. Scroll to the results instead, offset by the pinned
  // toolbar so the first row of campaign cards is never hidden behind it.
  const scrollToResults = () => {
    const target = document.getElementById("campaign-results");
    if (!target) return;
    const toolbar = document.getElementById("campaign-toolbar");
    const stickyTop = 84; // keep in sync with the toolbar's top-[84px]
    const offset = stickyTop + (toolbar?.offsetHeight || 0) + 16;
    const top = window.scrollY + target.getBoundingClientRect().top - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  const sectionHeading = { color: "var(--color-text)" };
  const sectionMuted = { color: "var(--color-text-muted)" };

  return (
    <Layout>
      <div className="max-w-8xl mx-auto pl-0 sm:pl-4 py-8 space-y-14">

        
        {/* ================= Live Activity Ticker ================= */}
        {activityFeed.length > 0 && (
          <section className="-mt-6">
            <div className="card overflow-hidden py-0">
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span className="hidden sm:inline shrink-0 text-xs font-semibold uppercase tracking-wider" style={sectionMuted}>
                  Live
                </span>
                <div className="relative flex-1 overflow-hidden">
                  <div className="flex w-max animate-[ticker_36s_linear_infinite] items-center gap-10 whitespace-nowrap">
                    {[...activityFeed, ...activityFeed].map((tx, i) => (
                      <Link
                        key={`${tx.id}-${i}`}
                        href={`/campaign/${tx.campaignId}`}
                        className="flex items-center gap-2 text-xs transition-colors hover:text-indigo-500"
                        style={sectionMuted}
                      >
                        <FiActivity className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="font-medium" style={sectionHeading}>
                          {tx.campaignTitle.length > 34 ? `${tx.campaignTitle.slice(0, 34)}…` : tx.campaignTitle}
                        </span>
                        <span>
                          {tx.action} · Ξ {formatEth(tx.amount)} · {timeAgo(tx.timestamp)}
                        </span>
                      </Link>
                    ))}
                  </div>
                  {/* Edge fades */}
                  <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[var(--color-surface)] to-transparent" />
                  <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[var(--color-surface)] to-transparent" />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================= Trending Now (Carousel) ================= */}
        {trending.length > 0 && (
          <section>
            <div className="mb-5 flex items-end justify-between px-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                    <FiTrendingUp className="h-3.5 w-3.5" />
                  </span>
                  <h2 className="text-xl font-bold tracking-tight" style={sectionHeading}>Trending Now</h2>
                </div>
                <p className="mt-1 text-sm" style={sectionMuted}>Most-backed active campaigns gathering momentum</p>
              </div>
              <div className="hidden gap-2 sm:flex">
                <button
                  type="button"
                  onClick={() => scrollTrending(-1)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-sm transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                  aria-label="Scroll trending left"
                >
                  <FiChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollTrending(1)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-sm transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                  aria-label="Scroll trending right"
                >
                  <FiChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div
              ref={trendingRef}
              className="flex gap-4 overflow-x-auto px-4 pt-3 pb-4 [scrollbar-width:thin] snap-x snap-mandatory"
            >
              {trending.map((c, idx) => {
                const raised = Number(c.raisedAmount?.toString?.() || 0) / 1e18;
                const target = Number(c.targetAmount?.toString?.() || 0) / 1e18;
                const pct = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
                return (
                  <Link
                    key={c.id?.toString?.() || idx}
                    href={`/campaign/${c.id}`}
                    className="card card-hover group relative flex w-[280px] shrink-0 snap-start flex-col p-4 sm:w-[320px]"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${
                          idx === 0
                            ? "bg-gradient-to-br from-amber-400 to-orange-500"
                            : idx === 1
                            ? "bg-gradient-to-br from-slate-400 to-slate-500"
                            : idx === 2
                            ? "bg-gradient-to-br from-orange-400 to-amber-600"
                            : "bg-slate-300 dark:bg-white/10"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="badge badge-neutral gap-1">
                        <FiClock className="h-3 w-3" /> {timeLeft(c.deadline)}
                      </span>
                    </div>
                    <h3 className="line-clamp-2 min-h-[2.5rem] font-semibold leading-snug" style={sectionHeading}>
                      {c.title?.toString?.() || "Untitled campaign"}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs" style={sectionMuted}>
                      {c.description?.toString?.() || "No description provided."}
                    </p>
                    <div className="mt-auto pt-4">
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="font-semibold" style={sectionHeading}>Ξ {raised.toFixed(2)}</span>
                        <span style={sectionMuted}>{pct}% of Ξ {formatEth(c.targetAmount)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-surface-raised)" }}>
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-2.5 flex items-center gap-1 text-xs" style={sectionMuted}>
                        <FiUsers className="h-3 w-3" /> {c.contributorsCount || 0} backers
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

     

        {/* ================= All Campaigns (header + stats) ================= */}
        <section id="all-campaigns" className="scroll-mt-24">
          <div className="mb-8 flex flex-col gap-3 px-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                  <FiGrid className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-xl font-bold tracking-tight" style={sectionHeading}>Explore by Category</h2>
              </div>
              <p className="mt-1 text-sm" style={sectionMuted}>Find causes that matter to you — click a tile to filter</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Total", value: totalCampaigns },
                { label: "Active", value: activeCount },
                { label: "Funded", value: fundedCount },
                { label: "Raised", value: `Ξ ${totalRaised.toFixed(1)}` },
              ].map((s) => (
                <div key={s.label} className="card px-3.5 py-2 text-center">
                  <p className="text-sm font-bold leading-none" style={sectionHeading}>{s.value}</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-wider" style={sectionMuted}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>

         
     {/* ================= Explore by Category (Tiles) ================= */}
        <section>
          {/* ================= Hero Banner Slideshow ================= */}
        <section
          className="group relative overflow-hidden h-[200px] rounded-3xl border border-slate-200/70 dark:border-[rgba(255,255,255,0.1)] bg-slate-900 text-white card-hover mb-6 mx-4"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="absolute inset-0">
            {HERO_SLIDES.map((slide, index) => (
              <div
                key={slide.title}
                className={`absolute inset-0 transition-opacity duration-700 ${
                  index === currentSlide ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <img
                  src={slide.image}
                  alt={slide.title}
                  className="h-full w-full object-cover sm:ml-[350px] sm:w-[110%] sm:object-contain"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-slate-100/10" />
              </div>
            ))}
          </div>

          {/* Desktop: title + subtitles */}
          <div className="relative z-10 hidden gap-6 p-10 lg:flex lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mt-0 ml-auto">
                <h1 className="-mt-4 text-xl font-bold tracking-tight">
                  {HERO_SLIDES[currentSlide].title}
                </h1>
                <p className="mt-6 max-w-xl text-sm text-slate-200">
                  {HERO_SLIDES[currentSlide].subtitle1}
                </p>
                <p className="mt-2 max-w-xl text-sm text-slate-200">
                  {HERO_SLIDES[currentSlide].subtitle2}
                </p>
              </div>
            </div>
          </div>

          {/* Mobile/tablet: title at top, subtitles pinned above the slide dots */}
          <div className="relative z-10 flex h-full flex-col p-5 sm:p-8 lg:hidden">
            <h1 className="text-base font-bold tracking-tight sm:text-xl">
              {HERO_SLIDES[currentSlide].title}
            </h1>
            <div className="mb-11 mt-auto">
              <p className="mt-4 max-w-xl text-xs text-slate-200 sm:mt-6 sm:text-sm">
                {HERO_SLIDES[currentSlide].subtitle1}
              </p>
              <p className="mt-2 max-w-xl text-xs text-slate-200 sm:text-sm">
                {HERO_SLIDES[currentSlide].subtitle2}
              </p>
            </div>
          </div>

          {/* Slide dots */}
          <div className="absolute bottom-8 left-8 z-20 flex items-center gap-2">
            {HERO_SLIDES.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                onClick={() => setCurrentSlide(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentSlide ? "w-6 bg-white" : "w-2.5 bg-white/50 hover:bg-white/70"
                }`}
                aria-label={`Show slide ${index + 1}`}
              />
            ))}
          </div>
        </section>

          <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {CATEGORIES.filter((c) => c !== "All").map((cat) => {
              const Icon = CATEGORY_META[cat] || FiGrid;
              const count = categoryCounts[cat] || 0;
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setActiveCategory(isActive ? "All" : cat);
                    scrollToResults();
                  }}
                  className={`card group relative overflow-hidden p-3 text-left transition-all duration-200 ${
                    isActive ? "ring-2 ring-indigo-500" : "card-hover"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold leading-tight" style={sectionHeading}>{cat}</p>
                      <p className="text-[11px]" style={sectionMuted}>
                        {count} {count === 1 ? "campaign" : "campaigns"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
           {/* Search + Filters toolbar */}
          <div className="px-4 mt-6">
            <div id="campaign-toolbar" className="card sticky top-[84px] z-30 p-3 backdrop-blur-xl">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
                  <input
                    type="text"
                    placeholder="Search campaigns..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input pl-9 rounded-2xl"
                  />
                </div>
                <div className="flex gap-2">
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="select w-auto rounded-2xl">
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="funded">Funded</option>
                  </select>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select w-auto rounded-2xl">
                    <option value="newest">Newest</option>
                    <option value="ending">Ending Soon</option>
                    <option value="funded">Most Funded</option>
                    <option value="popular">Most Popular</option>
                  </select>
                  <div className="flex rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
                    <button
                      onClick={() => setViewMode("grid")}
                      className={`p-2 ${viewMode === "grid" ? "bg-indigo-50 dark:bg-indigo-500/10" : ""}`}
                      style={{ color: viewMode === "grid" ? "var(--color-accent)" : "var(--color-text-muted)" }}
                      aria-label="Grid view"
                    >
                      <FiGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode("list")}
                      className={`p-2 ${viewMode === "list" ? "bg-indigo-50 dark:bg-indigo-500/10" : ""}`}
                      style={{ color: viewMode === "list" ? "var(--color-accent)" : "var(--color-text-muted)" }}
                      aria-label="List view"
                    >
                      <FiList className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

             
            </div>
          </div>
        </section>


          {/* Results count */}
          <div id="campaign-results" className="mt-5 flex items-center justify-between px-4 scroll-mt-[220px]">
            <p className="text-sm" style={sectionMuted}>
              Showing <span className="font-medium" style={sectionHeading}>{filtered.length}</span> {filtered.length === 1 ? "campaign" : "campaigns"}
            </p>
          </div>

          {/* Campaigns grid */}
          <div className="mt-3 px-4">
            {isLoading ? (
              <div className={`grid gap-4 ${viewMode === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1 max-w-3xl mx-auto"}`}>
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="card p-4 space-y-3">
                    <div className="skeleton h-36" />
                    <div className="skeleton h-4 w-3/4" />
                    <div className="skeleton h-3 w-1/2" />
                    <div className="skeleton h-1.5" />
                  </div>
                ))}
              </div>
            ) : filtered.length > 0 ? (
              <div className={`grid gap-4 ${viewMode === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1 max-w-3xl mx-auto"}`}>
                {filtered.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    metadata={metadataMap[c.id?.toString?.()]}
                    creatorProfile={creatorProfiles[c.creator?.toString?.()?.toLowerCase()]}
                    currentUserAddress={address}
                    currentUserName={currentUserName}
                    viewMode={viewMode}
                  />
                ))}
              </div>
            ) : (
              <div className="card p-12 text-center">
                <FiFilter className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} />
                <h3 className="font-semibold" style={sectionHeading}>No campaigns found</h3>
                <p className="text-sm mt-1" style={sectionMuted}>
                  Try adjusting your search or filters.
                </p>
                <button onClick={() => { setSearchTerm(""); setActiveCategory("All"); setFilterStatus("all"); }} className="btn btn-secondary btn-sm mt-4">
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ================= Creator CTA Band ================= */}
        <section className="px-4">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-400 to-indigo-700 p-8 text-white sm:p-12">
            {/* Decorative glows */}
            <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-indigo-300/20 blur-3xl" />
            <div className="relative z-10 flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-sm">
                  <FiUploadCloud className="h-3.5 w-3.5" /> For Creators
                </span>
                <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                  Have an idea worth funding?
                </h2>
                <p className="mt-2 max-w-xl text-sm text-indigo-100 sm:text-base">
                  Launch your campaign in minutes. Lock your 30% creator stake, hit milestones,
                  and let backers vote on every release — fully on-chain, fully transparent.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-indigo-100">
                  <span className="flex items-center gap-1.5"><FiCheckCircle className="h-3.5 w-3.5" /> Milestone-based escrow</span>
                  <span className="flex items-center gap-1.5"><FiCheckCircle className="h-3.5 w-3.5" /> Backer-approved releases</span>
                  <span className="flex items-center gap-1.5"><FiCheckCircle className="h-3.5 w-3.5" /> Stake returned on success</span>
                </div>
              </div>
              <button
                onClick={() => router.push("/create-campaign")}
                className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-bold text-indigo-700 shadow-lg transition-all hover:shadow-xl hover:bg-indigo-50 btn-hover-lift"
              >
                Launch Your Campaign
                <FiArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </section>

      </div>
    </Layout>
  );
}

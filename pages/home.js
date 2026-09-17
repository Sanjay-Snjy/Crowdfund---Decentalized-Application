import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout/Layout";
import { useContract } from "../hooks/useContract";
import { useUser } from "@clerk/nextjs";
import { useAccount } from "wagmi";
import { FiSearch, FiGrid, FiList, FiFilter } from "react-icons/fi";
import { getCreatorDisplayName, calculateProgress } from "../utils/helpers";
import { getFromIPFS } from "../utils/ipfs";
import CampaignCard from "../components/Campaign/CampaignCard";

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

export default function AllCampaignsPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { user } = useUser();
  const { useActiveCampaigns } = useContract();

  const currentUserName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "";

  const { data: campaigns, isLoading } = useActiveCampaigns(0, 100);

  // URL-synced state
  const [searchTerm, setSearchTerm] = useState(router.query.search || "");
  const [activeCategory, setActiveCategory] = useState(router.query.category || "All");
  const [filterStatus, setFilterStatus] = useState(router.query.status || "all");
  const [sortBy, setSortBy] = useState(router.query.sort || "newest");
  const [viewMode, setViewMode] = useState("grid");
  const [currentSlide, setCurrentSlide] = useState(0);

  // Auto-advance hero slideshow
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 4000);
    return () => clearInterval(timer);
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

  return (
    <Layout>
      <div className="max-w-8xl mx-auto pl-0 sm:pl-4 py-8 space-y-6">
        
        
         {/* Hero Banner Slideshow */}
        <section className="relative overflow-hidden h-[208px] rounded-3xl border border-slate-200/70 dark:border-[rgba(255,255,255,0.1)] bg-slate-900 p-0 text-white">
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
                  className="h-full w-full object-cover sm:ml-[330px] sm:w-[110%] sm:object-contain"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-slate-100/10" />
              </div>
            ))}
          </div>

          {/* Desktop: original layout (title + subtitles flow from top-right) */}
          <div className="relative z-10 hidden gap-6 p-8 lg:flex lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mt-0 ml-auto">
                <h1 className="mt-0 text-[20px] font-semibold tracking-tight">
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
            <h1 className="text-base font-semibold tracking-tight sm:text-[20px]">
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

          <div className="absolute bottom-8 left-8 z-20 flex items-center gap-2">
            {HERO_SLIDES.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                onClick={() => setCurrentSlide(index)}
                className={`h-2 rounded-full transition-all ${
                  index === currentSlide ? "w-6 bg-white" : "w-2.5 bg-white/50"
                }`}
                aria-label={`Show slide ${index + 1}`}
              />
            ))}
          </div>
        </section>
        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center px-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>All Campaigns</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Browse and discover crowdfunding campaigns
            </p>
          </div>
          <div className="flex sm:ml-auto">
            <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-black/15 bg-[var(--bg-secondary)] px-3 py-2 text-center text-[12px] text-black backdrop-blur-sm sm:w-auto sm:px-4 dark:border-white/20 dark:bg-white/10 dark:text-white">
              <span className="font-semibold uppercase tracking-wide">Campaigns</span>
              <span className="flex items-center gap-1 uppercase tracking-wider">
                Total: <span className="font-bold">{totalCampaigns}</span>
              </span>
              <span className="flex items-center gap-1 uppercase tracking-wider">
                Active: <span className="font-bold">{activeCount}</span>
              </span>
              <span className="flex items-center gap-1 uppercase tracking-wider">
                Funded: <span className="font-bold">{fundedCount}</span>
              </span>
            </div>
          </div>
        </div>
        {/* Search + Filters */}
        <div className=" p-4">
          <div className="flex flex-col sm:flex-row gap-3 ">
            <div className="relative flex-1 ">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
              <input
                type="text"
                placeholder="Search campaigns..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input pl-9 rounded-full backdrop-blur-sm"
              />
            </div>
            <div className="flex gap-2">
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="select w-auto rounded-full">
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="funded">Funded</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select w-auto rounded-full">
                <option value="newest">Newest</option>
                <option value="ending">Ending Soon</option>
                <option value="funded">Most Funded</option>
                <option value="popular">Most Popular</option>
              </select>
              <div className="flex rounded-full border overflow-hidden " style={{ borderColor: "var(--color-border)" }}>
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

          {/* Category pills */}
          <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1 -mb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-indigo-500 text-white"
                    : "hover:bg-slate-100 dark:hover:bg-[rgba(255,255,255,0.06)]"
                }`}
                style={activeCategory === cat ? undefined : { color: "var(--color-text-secondary)" }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Showing <span className="font-medium" style={{ color: "var(--color-text)" }}>{filtered.length}</span> campaigns
          </p>
        </div>

        {/* Campaigns grid */}
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
            <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>No campaigns found</h3>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Try adjusting your search or filters.
            </p>
            <button onClick={() => { setSearchTerm(""); setActiveCategory("All"); setFilterStatus("all"); }} className="btn btn-secondary btn-sm mt-4">
              Clear Filters
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}

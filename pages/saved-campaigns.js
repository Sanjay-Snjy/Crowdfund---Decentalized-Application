import { useAccount } from "wagmi";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout/Layout";
import { useContract } from "../hooks/useContract";
import { useBookmarks } from "../hooks/useBookmarks";
import { FiBookmark, FiTrash2 } from "react-icons/fi";
import CampaignCard from "../components/Campaign/CampaignCard";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";

export default function SavedCampaignsPage() {
  const { address, isConnected } = useAccount();
  const { user } = useUser();
  const router = useRouter();
  const { useActiveCampaigns } = useContract();
  const { bookmarks, toggle, isBookmarked } = useBookmarks();
  const { data: campaigns, isLoading } = useActiveCampaigns(0, 100);

  const currentUserName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "";

  const saved = useMemo(() => {
    if (!campaigns || !bookmarks.length) return [];
    return campaigns.filter((c) => bookmarks.includes(String(c.id?.toString?.())));
  }, [campaigns, bookmarks]);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>Saved Campaigns</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>{saved.length} bookmarked campaign{saved.length !== 1 ? "s" : ""}</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="card p-4 space-y-3"><div className="skeleton h-36" /><div className="skeleton h-4 w-3/4" /><div className="skeleton h-1.5" /></div>)}
          </div>
        ) : saved.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {saved.map((c) => <CampaignCard key={c.id} campaign={c} currentUserAddress={address} currentUserName={currentUserName} />)}
          </div>
        ) : (
          <div className="card p-12 text-center">
            <FiBookmark className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} />
            <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>No saved campaigns</h3>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Bookmark campaigns to see them here.</p>
            <Link href="/home" className="btn btn-secondary mt-4">Browse Campaigns</Link>
          </div>
        )}
      </div>
    </Layout>
  );
}

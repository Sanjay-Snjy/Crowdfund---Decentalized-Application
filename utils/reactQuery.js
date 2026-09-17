import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { CONTRACT_ADDRESS } from "../constants";
import { CROWDFUNDING_ABI } from "../constants/abi";
import { getFromIPFS } from "./ipfs";

export const queryKeys = {
  campaignList: (offset = 0, limit = 10) => ["campaigns", "list", offset, limit],
  campaignDetail: (campaignId) => ["campaigns", "detail", campaignId],
  campaignStats: (campaignId) => ["campaigns", "stats", campaignId],
  campaignContributions: (campaignId) => ["campaigns", "contributions", campaignId],
  campaignMilestones: (campaignId) => ["campaigns", "milestones", campaignId],
  campaignUserContribution: (campaignId, address) => ["campaigns", "userContribution", campaignId, address],
  ipfsMetadata: (hash) => ["ipfs", hash],
  walletProfile: (address) => ["walletProfiles", address],
};

export const useCachedCampaignList = (offset = 0, limit = 10, options = {}) => {
  return useQuery({
    queryKey: queryKeys.campaignList(offset, limit),
    queryFn: async () => {
      if (typeof window === "undefined") return [];
      const { publicClient } = await import("wagmi");
      const client = publicClient();
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CROWDFUNDING_ABI,
        functionName: "getActiveCampaigns",
        args: [offset, limit],
      });
      return Array.isArray(result) ? result : [];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    ...options,
  });
};

export const useCachedCampaignDetail = (campaignId, options = {}) => {
  return useQuery({
    queryKey: queryKeys.campaignDetail(campaignId),
    queryFn: async () => {
      if (!campaignId) return null;
      const { publicClient } = await import("wagmi");
      const client = publicClient();
      return client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CROWDFUNDING_ABI,
        functionName: "getCampaign",
        args: [campaignId],
      });
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    enabled: Boolean(campaignId),
    ...options,
  });
};

export const useCachedCampaignStats = (campaignId, options = {}) => {
  return useQuery({
    queryKey: queryKeys.campaignStats(campaignId),
    queryFn: async () => {
      if (!campaignId) return null;
      const { publicClient } = await import("wagmi");
      const client = publicClient();
      return client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CROWDFUNDING_ABI,
        functionName: "getCampaignStats",
        args: [campaignId],
      });
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    enabled: Boolean(campaignId),
    ...options,
  });
};

export const useCachedCampaignContributions = (campaignId, options = {}) => {
  return useQuery({
    queryKey: queryKeys.campaignContributions(campaignId),
    queryFn: async () => {
      if (!campaignId) return [];
      const { publicClient } = await import("wagmi");
      const client = publicClient();
      return client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CROWDFUNDING_ABI,
        functionName: "getCampaignContributions",
        args: [campaignId],
      });
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    enabled: Boolean(campaignId),
    ...options,
  });
};

export const useCachedCampaignMilestones = (campaignId, options = {}) => {
  return useQuery({
    queryKey: queryKeys.campaignMilestones(campaignId),
    queryFn: async () => {
      if (!campaignId) return [];
      const { publicClient } = await import("wagmi");
      const client = publicClient();
      return client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CROWDFUNDING_ABI,
        functionName: "getMilestones",
        args: [campaignId],
      });
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    enabled: Boolean(campaignId),
    ...options,
  });
};

export const useCachedUserContribution = (campaignId, address, options = {}) => {
  return useQuery({
    queryKey: queryKeys.campaignUserContribution(campaignId, address),
    queryFn: async () => {
      if (!campaignId || !address) return null;
      const { publicClient } = await import("wagmi");
      const client = publicClient();
      return client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CROWDFUNDING_ABI,
        functionName: "getContribution",
        args: [campaignId, address],
      });
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    enabled: Boolean(campaignId && address),
    ...options,
  });
};

export const useCachedIPFSMetadata = (hash, options = {}) => {
  return useQuery({
    queryKey: queryKeys.ipfsMetadata(hash),
    queryFn: async () => {
      if (!hash) return null;
      const result = await getFromIPFS(hash);
      return result.success ? result.data : null;
    },
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    enabled: Boolean(hash),
    ...options,
  });
};

export const useCachedWalletProfile = (address, options = {}) => {
  return useQuery({
    queryKey: queryKeys.walletProfile(address),
    queryFn: async () => {
      if (!address) return null;
      const response = await fetch(`/api/wallet-link?walletAddresses=${encodeURIComponent(address)}`);
      const data = await response.json();
      if (Array.isArray(data.walletProfiles) && data.walletProfiles.length > 0) {
        return data.walletProfiles[0];
      }
      return null;
    },
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    enabled: Boolean(address),
    ...options,
  });
};

export const prefetchCampaignData = async (queryClient, campaignId) => {
  if (!campaignId) return;
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.campaignDetail(campaignId),
      queryFn: async () => {
        const { publicClient } = await import("wagmi");
        const client = publicClient();
        return client.readContract({
          address: CONTRACT_ADDRESS,
          abi: CROWDFUNDING_ABI,
          functionName: "getCampaign",
          args: [campaignId],
        });
      },
      staleTime: 1000 * 60 * 5,
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.campaignStats(campaignId),
      queryFn: async () => {
        const { publicClient } = await import("wagmi");
        const client = publicClient();
        return client.readContract({
          address: CONTRACT_ADDRESS,
          abi: CROWDFUNDING_ABI,
          functionName: "getCampaignStats",
          args: [campaignId],
        });
      },
      staleTime: 1000 * 60 * 5,
    }),
  ]);
};

export const usePrefetchCampaigns = (queryClient) => {
  return useMemo(
    () => ({
      prefetchCampaigns: async (campaignIds = []) => {
        await Promise.all(campaignIds.map((id) => prefetchCampaignData(queryClient, id)));
      },
    }),
    [queryClient]
  );
};

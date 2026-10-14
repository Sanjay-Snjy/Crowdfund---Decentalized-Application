/**
 * Resolve wallet addresses to their public CrowdFund profile (name + CrowdFund
 * User ID).
 *
 * Contributors listed on a campaign page are read straight from the contract, which
 * only knows addresses. This hook maps them to the name of the Clerk account their
 * wallet is linked to — the same name the header and the donation lists show —
 * through /api/wallet-link (which never returns an email address and hides the name
 * of a profile that turned public display off).
 *
 * Unknown addresses simply stay unlabelled: a name is never invented.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, buildQuery } from "../utils/apiClient";

export function useWalletProfiles(addresses = []) {
  const list = useMemo(() => {
    const unique = new Set();
    for (const value of addresses || []) {
      const address = typeof value === "string" ? value.toLowerCase() : null;
      if (address) unique.add(address);
    }
    return [...unique].sort();
  }, [addresses]);

  const key = list.join(",");

  const { data } = useQuery({
    queryKey: ["wallet-profiles", key],
    queryFn: () => apiGet(`/api/wallet-link${buildQuery({ walletAddresses: key })}`),
    enabled: list.length > 0,
    staleTime: 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    const profiles = new Map();
    for (const profile of data?.walletProfiles || []) {
      if (!profile?.walletAddress) continue;
      profiles.set(String(profile.walletAddress).toLowerCase(), {
        name: profile.name || null,
        cfUserId: profile.cfUserId || null,
      });
    }
    return profiles;
  }, [data]);
}

export default useWalletProfiles;

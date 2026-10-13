/**
 * Self-contained CrowdFund identity panel: reads /api/me and renders the
 * CrowdFund User ID card. Used by the user dashboard and the contributions page so
 * the identifier is visible everywhere the user manages their account.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../utils/apiClient";
import useIdentity from "../../hooks/useIdentity";
import CrowdFundIdCard from "./CrowdFundIdCard";
import { ErrorState, LoadingState } from "../Common/AsyncStates";

export default function IdentityPanel({ enabled = true }) {
  const identity = useIdentity();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet("/api/me"),
    enabled,
    retry: 1,
    refetchInterval: 60 * 1000,
  });

  if (!enabled) return null;

  if (!identity.loading && !identity.isSignedIn) {
    return <CrowdFundIdCard identity={null} profile={null} />;
  }

  if (isLoading) {
    return (
      <div className="card rounded-2xl p-5">
        <LoadingState rows={2} height="h-14" label="Loading your CrowdFund profile" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card rounded-2xl p-5">
        <ErrorState error={error} onRetry={refetch} title="Could not load your CrowdFund profile" />
      </div>
    );
  }

  return (
    <CrowdFundIdCard
      identity={identity.identity}
      profile={data?.profile}
      onUpdated={() => {
        refetch();
        identity.refresh();
      }}
    />
  );
}

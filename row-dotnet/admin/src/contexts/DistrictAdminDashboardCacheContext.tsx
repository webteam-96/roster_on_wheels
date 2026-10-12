"use client";

/**
 * DistrictAdminDashboardCacheContext
 * --------------------------------------------------------------------------
 * Prefetches all 5 District Admin dashboard tabs in parallel on first mount
 * of the /district-admin-dashboard layout, then serves the cached data to
 * each tab so navigation between tabs is instant.
 *
 * Endpoints prefetched (all already exist in services/api.ts):
 *   overview      -> getDistrictAdminOverview(yearId, districtId)
 *   membership    -> getDistrictAdminMembership(yearId, districtId)
 *   foundation    -> getDistrictAdminFoundation(yearId, districtId)
 *   communication -> getDistrictAdminCommunication(yearId, districtId)
 *   eGovernance   -> getDistrictAdminEGovernance(yearId, districtId)
 *
 * Global year filter (URL ?yearId=):
 *   Source of truth is the URL search param — the topbar year selector writes
 *   to it via router.replace, and this context reads it back and refires the
 *   5 endpoints so every tab shows the picked year's data. When the URL has
 *   no yearId (fresh mount / bookmark before rollover), the backend falls
 *   back to its IsCurrent year.
 *
 * Status semantics:
 *   loading  -> initial parallel fetch in flight
 *   ready    -> every fetch succeeded
 *   partial  -> at least one fetch succeeded AND at least one failed
 *   error    -> every fetch failed (or no token / not authenticated)
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";

import {
  getDistrictAdminOverview,
  getDistrictAdminMembership,
  getDistrictAdminFoundation,
  getDistrictAdminCommunication,
  getDistrictAdminEGovernance,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

import type {
  DistrictAdminOverviewResponse,
  DistrictAdminMembershipResponse,
  DistrictAdminFoundationResponse,
  DistrictAdminCommunicationResponse,
  DistrictAdminEGovernanceResponse,
} from "@/types/districtAdminDashboard";

export type DistrictAdminCacheStatus = "loading" | "ready" | "partial" | "error";

interface DistrictAdminCacheState {
  overview: DistrictAdminOverviewResponse | null;
  membership: DistrictAdminMembershipResponse | null;
  foundation: DistrictAdminFoundationResponse | null;
  communication: DistrictAdminCommunicationResponse | null;
  eGovernance: DistrictAdminEGovernanceResponse | null;
  status: DistrictAdminCacheStatus;
  /** Currently-active yearId driving the cached responses. Pages can read this
   *  to label charts/headings — null = backend default (current year). */
  yearId: number | null;
  refresh: () => Promise<void>;
}

const EMPTY_STATE: Omit<DistrictAdminCacheState, "refresh"> = {
  overview: null,
  membership: null,
  foundation: null,
  communication: null,
  eGovernance: null,
  status: "loading",
  yearId: null,
};

const DistrictAdminDashboardCacheContext = createContext<DistrictAdminCacheState>({
  ...EMPTY_STATE,
  refresh: async () => {},
});

export function DistrictAdminDashboardCacheProvider({ children }: { children: ReactNode }) {
  const { selectedDistrictId } = useAuth();
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const yearId = yearIdParam ? parseInt(yearIdParam, 10) || null : null;
  const [state, setState] =
    useState<Omit<DistrictAdminCacheState, "refresh">>(EMPTY_STATE);
  // Guard against state updates after unmount.
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async (effectiveYearId: number | null) => {
    if (!mountedRef.current) return;
    setState((s) => ({ ...s, status: "loading" }));

    const calls = [
      getDistrictAdminOverview(effectiveYearId, selectedDistrictId),
      getDistrictAdminMembership(effectiveYearId, selectedDistrictId),
      getDistrictAdminFoundation(effectiveYearId, selectedDistrictId),
      getDistrictAdminCommunication(effectiveYearId, selectedDistrictId),
      getDistrictAdminEGovernance(effectiveYearId, selectedDistrictId),
    ] as const;

    const results = await Promise.allSettled(calls);

    if (!mountedRef.current) return;

    const [
      rOverview,
      rMembership,
      rFoundation,
      rCommunication,
      rEGovernance,
    ] = results;

    const pick = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === "fulfilled" ? r.value : null;

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - successCount;
    let status: DistrictAdminCacheStatus;
    if (successCount === results.length) status = "ready";
    else if (successCount === 0) status = "error";
    else status = "partial";

    if (failCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[DistrictAdminDashboardCache] ${failCount}/${results.length} prefetches failed`,
        results
          .map((r, i) => (r.status === "rejected" ? { i, reason: r.reason } : null))
          .filter(Boolean),
      );
    }

    setState({
      overview: pick(rOverview) as DistrictAdminOverviewResponse | null,
      membership: pick(rMembership) as DistrictAdminMembershipResponse | null,
      foundation: pick(rFoundation) as DistrictAdminFoundationResponse | null,
      communication: pick(rCommunication) as DistrictAdminCommunicationResponse | null,
      eGovernance: pick(rEGovernance) as DistrictAdminEGovernanceResponse | null,
      status,
      yearId: effectiveYearId,
    });
  }, [selectedDistrictId]);

  // Refire when selectedDistrictId OR yearId changes.
  // Deliberately narrow deps: pathname changes from tab navigation must NOT
  // refetch (matches the perf fix applied to Club Admin cache context).
  useEffect(() => {
    mountedRef.current = true;
    setState(EMPTY_STATE);
    fetchAll(yearId);
    return () => {
      mountedRef.current = false;
    };
  }, [yearId, fetchAll]);

  const refresh = useCallback(async () => {
    await fetchAll(yearId);
  }, [fetchAll, yearId]);

  return (
    <DistrictAdminDashboardCacheContext.Provider value={{ ...state, refresh }}>
      {children}
    </DistrictAdminDashboardCacheContext.Provider>
  );
}

export function useDistrictAdminCache(): DistrictAdminCacheState {
  return useContext(DistrictAdminDashboardCacheContext);
}

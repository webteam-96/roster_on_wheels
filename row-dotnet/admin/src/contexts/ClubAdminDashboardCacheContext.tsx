"use client";

/**
 * ClubAdminDashboardCacheContext
 * --------------------------------------------------------------------------
 * Prefetches all 8 Club Admin dashboard tabs in parallel on first mount of
 * the /club-admin-dashboard layout, then serves the cached data to each tab
 * so navigation between tabs is instant.
 *
 * Endpoints prefetched (all already exist in services/api.ts):
 *   overview                -> getClubAdminOverview()
 *   foundation              -> getClubAdminFoundation()
 *   foundationGoals         -> getFoundationGoalsList(null)
 *   membership              -> getClubAdminMembership()
 *   serviceProjectsOverview -> getServiceProjectsOverview(null)
 *   eGovernance             -> getClubAdminEGovernance()
 *   communication           -> getClubAdminCommunication()
 *   website                 -> getClubAdminWebsite()
 *   membershipDues          -> getClubAdminPayments()
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
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import {
  getClubAdminOverview,
  getClubAdminFoundation,
  getFoundationGoalsList,
  getClubAdminMembership,
  getServiceProjectsOverview,
  getClubAdminEGovernance,
  getClubAdminCommunication,
  getClubAdminWebsite,
  getClubAdminPayments,
  getClubAdminAvailableYears,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

import type {
  ClubAdminOverviewResponse,
  ClubAdminFoundationResponse,
  FoundationGoalListResponse,
  ClubAdminMembershipResponse,
  ServiceProjectsOverviewResponse,
  ClubAdminEGovernanceResponse,
  ClubAdminCommunicationResponse,
  ClubAdminWebsiteResponse,
  ClubAdminPaymentsResponse,
} from "@/types/clubAdminDashboard";

export type ClubAdminCacheStatus = "loading" | "ready" | "partial" | "error";

interface ClubAdminCacheState {
  overview: ClubAdminOverviewResponse | null;
  foundation: ClubAdminFoundationResponse | null;
  foundationGoals: FoundationGoalListResponse | null;
  membership: ClubAdminMembershipResponse | null;
  serviceProjectsOverview: ServiceProjectsOverviewResponse | null;
  eGovernance: ClubAdminEGovernanceResponse | null;
  communication: ClubAdminCommunicationResponse | null;
  website: ClubAdminWebsiteResponse | null;
  membershipDues: ClubAdminPaymentsResponse | null;
  status: ClubAdminCacheStatus;
  /** Currently-active yearId driving the cached responses. Pages can read this
   *  to label charts/headings — single source of truth for "what year is the
   *  dashboard currently showing". null = backend default (current year). */
  yearId: number | null;
  refresh: () => Promise<void>;
}

const EMPTY_STATE: Omit<ClubAdminCacheState, "refresh"> = {
  overview: null,
  foundation: null,
  foundationGoals: null,
  membership: null,
  serviceProjectsOverview: null,
  eGovernance: null,
  communication: null,
  website: null,
  membershipDues: null,
  status: "loading",
  yearId: null,
};

const ClubAdminDashboardCacheContext = createContext<ClubAdminCacheState>({
  ...EMPTY_STATE,
  refresh: async () => {},
});

export function ClubAdminDashboardCacheProvider({ children }: { children: ReactNode }) {
  const { selectedClubId } = useAuth();
  // Read the global yearId from the URL search param. Year selector writes to
  // ?yearId=N via router.replace, which triggers a re-render here and a refetch
  // via fetchAll's dependency.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const yearId = yearIdParam ? parseInt(yearIdParam, 10) || null : null;
  const [state, setState] =
    useState<Omit<ClubAdminCacheState, "refresh">>(EMPTY_STATE);
  // Guard against state updates after unmount.
  const mountedRef = useRef(true);
  // Once we've resolved the effective yearId for THIS session (URL vs server's
  // current year), don't run the resolve step again — subsequent URL changes
  // (user picks a year) go straight to fetchAll. This is what makes stale-URL
  // detection cost 0 extra heavy fetches instead of 2 rounds of 9 endpoints.
  const yearResolvedRef = useRef(false);
  // Router / pathname / searchParams need to be usable inside the fetch effect
  // for the one-shot stale-URL replace, but MUST NOT trigger the effect on
  // navigation. If they were in the effect deps, every tab click between
  // /club-admin-dashboard/* pages would refetch all 9 endpoints and reset the
  // UI to a loading spinner — which is what "everywhere slow" felt like.
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  const searchParamsRef = useRef(searchParams);
  routerRef.current = router;
  pathnameRef.current = pathname;
  searchParamsRef.current = searchParams;

  const fetchAll = useCallback(async (effectiveYearId: number | null) => {
    if (!mountedRef.current) return;
    setState((s) => ({ ...s, status: "loading" }));

    const calls = [
      getClubAdminOverview(effectiveYearId, selectedClubId),
      getClubAdminFoundation(effectiveYearId, selectedClubId),
      getFoundationGoalsList(effectiveYearId, selectedClubId),
      getClubAdminMembership(effectiveYearId, selectedClubId),
      getServiceProjectsOverview(effectiveYearId, selectedClubId),
      getClubAdminEGovernance(effectiveYearId, selectedClubId),
      getClubAdminCommunication(effectiveYearId, selectedClubId),
      getClubAdminWebsite(effectiveYearId, selectedClubId),
      getClubAdminPayments(effectiveYearId, selectedClubId),
    ] as const;

    const results = await Promise.allSettled(calls);

    if (!mountedRef.current) return;

    const [
      rOverview,
      rFoundation,
      rFoundationGoals,
      rMembership,
      rServiceProjects,
      rEGovernance,
      rCommunication,
      rWebsite,
      rPayments,
    ] = results;

    const pick = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === "fulfilled" ? r.value : null;

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - successCount;
    let status: ClubAdminCacheStatus;
    if (successCount === results.length) status = "ready";
    else if (successCount === 0) status = "error";
    else status = "partial";

    // Surface failures to the browser console — useful in production where the
    // tab will fall back to its own fetch but we still want a trace.
    if (failCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ClubAdminDashboardCache] ${failCount}/${results.length} prefetches failed`,
        results
          .map((r, i) => (r.status === "rejected" ? { i, reason: r.reason } : null))
          .filter(Boolean),
      );
    }

    setState({
      overview: pick(rOverview) as ClubAdminOverviewResponse | null,
      foundation: pick(rFoundation) as ClubAdminFoundationResponse | null,
      foundationGoals: pick(rFoundationGoals) as FoundationGoalListResponse | null,
      membership: pick(rMembership) as ClubAdminMembershipResponse | null,
      serviceProjectsOverview: pick(
        rServiceProjects,
      ) as ServiceProjectsOverviewResponse | null,
      eGovernance: pick(rEGovernance) as ClubAdminEGovernanceResponse | null,
      communication: pick(rCommunication) as ClubAdminCommunicationResponse | null,
      website: pick(rWebsite) as ClubAdminWebsiteResponse | null,
      membershipDues: pick(rPayments) as ClubAdminPaymentsResponse | null,
      status,
      yearId: effectiveYearId,
    });
  }, [selectedClubId]);

  // Initial prefetch on mount + refire when selectedClubId changes (Wave 9C).
  // Reset to EMPTY_STATE so the UI shows loading instead of the previous
  // club's stale data while the new fetch is in flight.
  //
  // Stale-URL / new-year handling:
  //   The very first time we mount for this session/club, we peek at the
  //   available-years endpoint to learn the server's IsCurrent yearId. If the
  //   URL is carrying a stale yearId (e.g. bookmarked before 1 July rolled the
  //   year over) AND the user hasn't explicitly picked one via the topbar in
  //   this session, we swap the URL to the current year BEFORE the 9 heavy
  //   endpoints fire. That way stale URLs cost 1 quick years fetch + 1 round
  //   of 9 fetches, instead of firing 9 endpoints twice.
  useEffect(() => {
    mountedRef.current = true;
    if (selectedClubId == null) {
      setState((s) => ({ ...s, status: "loading" }));
      return () => {
        mountedRef.current = false;
      };
    }

    let cancelled = false;

    async function run() {
      if (selectedClubId == null) return;
      if (!yearResolvedRef.current) {
        // First mount for this session/club. Resolve stale-URL detection
        // BEFORE firing the 9 endpoints so we don't fetch twice.
        setState((s) => ({ ...s, status: "loading" }));
        try {
          const years = await getClubAdminAvailableYears(selectedClubId);
          if (cancelled) return;
          const currentYearId = years?.currentYearId ?? null;
          const userPicked =
            typeof window !== "undefined" &&
            window.sessionStorage.getItem("dashboardYearPicked") === "1";
          const yearInAvailable =
            yearId != null && (years?.years ?? []).some((y) => y.id === yearId);

          let effective: number | null = yearId;
          if (
            currentYearId &&
            yearId !== currentYearId &&
            (!yearId || !yearInAvailable || !userPicked)
          ) {
            effective = currentYearId;
          }

          yearResolvedRef.current = true;

          if (effective && effective !== yearId) {
            // URL doesn't match effective — replace once. This triggers a
            // re-render + this effect re-runs with resolved=true, which then
            // goes straight to fetchAll(effective). Only 1 round of 9 fires.
            const next = new URLSearchParams(searchParamsRef.current.toString());
            next.set("yearId", String(effective));
            routerRef.current.replace(`${pathnameRef.current}?${next.toString()}`, { scroll: false });
            return;
          }

          await fetchAll(effective);
        } catch {
          // Couldn't reach the years endpoint — fall back to URL yearId and
          // fetch what we have. Don't mark resolved so we can retry on the
          // next mount if the user comes back.
          if (!cancelled) await fetchAll(yearId);
        }
      } else {
        // Year already resolved once; subsequent runs come from user picks.
        await fetchAll(yearId);
      }
    }

    setState(EMPTY_STATE);
    run();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
    // Deliberately narrow deps — router/pathname/searchParams are stashed in
    // refs above so navigation between dashboard tabs (which changes pathname)
    // does NOT refetch the 9 heavy endpoints and does NOT reset the cache.
    // Only real state changes (club or year) refire the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClubId, yearId, fetchAll]);

  const refresh = useCallback(async () => {
    await fetchAll(yearId);
  }, [fetchAll, yearId]);

  return (
    <ClubAdminDashboardCacheContext.Provider value={{ ...state, refresh }}>
      {children}
    </ClubAdminDashboardCacheContext.Provider>
  );
}

export function useClubAdminCache(): ClubAdminCacheState {
  return useContext(ClubAdminDashboardCacheContext);
}

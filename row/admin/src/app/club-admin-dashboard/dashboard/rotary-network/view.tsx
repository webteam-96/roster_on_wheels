"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  UserMinus, UserPlus, Search, Plus, Edit3, Trash2, Construction,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { getClubAdminDashboardRotaryNetwork, deletePotentialMember, getRotaryOrgTerminatedMembers } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import type {
  ClubAdminDashboardRotaryNetworkResponse,
  ClubAdminDashboardRotaryNetworkRow,
} from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";

// Re-enabled per user request. Kept as a plain (unexported) function rather
// than deleted, in case the "Coming Soon" placeholder needs to come back.
function DashboardRotaryNetworkComingSoonStub() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="rounded-full bg-amber-100 p-5 mb-5">
        <Construction className="h-10 w-10 text-amber-600" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Rotary Network: Coming Soon</h2>
      <p className="text-slate-500 max-w-md text-sm">
        Terminated members (live from Rotary.org) and potential members will
        appear here once the integration is finalised.
      </p>
    </div>
  );
}

function reasonChip(reason: string | null | undefined): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("particip")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (r.includes("business") || r.includes("relocat")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (r.includes("personal") || r.includes("health")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (r.includes("transfer")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

// Session-scoped cache of the live Rotary.org terminated list, keyed by club id. Terminated
// members are year-independent, so when the year changes (which remounts this embedded view)
// we reuse the cached list instead of re-hitting Rotary.org — the count + listing stay put.
const liveTerminatedCache = new Map<number, ClubAdminDashboardRotaryNetworkRow[]>();

type ToggleView = "terminated" | "potential";

function isToggleView(v: string | null): v is ToggleView {
  return v === "terminated" || v === "potential";
}

// Named export so it can be embedded inside the E-Governance tab strip
// (`embedded`) as well as rendered by its own route via the thin page.tsx
// wrapper. When embedded we DON'T sync ?view= to the URL — that would clobber
// the parent page's ?tab= param.
export function DashboardRotaryNetworkView({ embedded = false }: { embedded?: boolean } = {}) {
  const { selectedClubId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial view is read from ?view= — falls back to "terminated" (the page default).
  const initialView: ToggleView = (() => {
    const v = searchParams?.get("view");
    return isToggleView(v) ? v : "terminated";
  })();

  const [data, setData] = useState<ClubAdminDashboardRotaryNetworkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ToggleView>(initialView);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Reload tick — bump to refetch the dashboard after a successful delete.
  const [reloadTick, setReloadTick] = useState(0);

  // Live Rotary.org terminated members — fetched on demand when the Terminated
  // view is opened. Display-only; never stored. Item #2 of the 2026-06-12 cleanup.
  // Seed from the session cache (by club) so a year-change remount shows the terminated
  // count/listing immediately — no loader, no refetch.
  const [liveTerminated, setLiveTerminated] = useState<ClubAdminDashboardRotaryNetworkRow[] | null>(
    () => (selectedClubId ? liveTerminatedCache.get(selectedClubId) ?? null : null),
  );
  const [liveTerminatedLoading, setLiveTerminatedLoading] = useState(false);
  const [liveTerminatedWarning, setLiveTerminatedWarning] = useState<string | null>(null);

  // Keep ?view= in sync with the toggle. Uses router.replace so toggling does
  // not pollute browser history. Omits ?view= for "terminated" (default).
  const handleViewChange = (next: ToggleView) => {
    setView(next);
    if (embedded) return; // don't touch the URL — parent owns ?tab=
    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
    if (next === "terminated") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getClubAdminDashboardRotaryNetwork(null, selectedClubId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load network."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadTick, selectedClubId]);

  // Fetch live Rotary.org terminated members the first time the Terminated
  // view is opened. Cached for the page lifetime; no refresh button (live
  // fetch is the source of truth — open the page again to refresh).
  useEffect(() => {
    // Fetch the live Rotary.org terminated list once, on mount — regardless of the
    // current view — so the "Total Terminated" KPI is always the live count (not the
    // smaller DB fallback) even while the Potential Members view is showing.
    if (liveTerminated !== null || liveTerminatedLoading) return;
    if (!data?.club?.clubId) return;
    const cid = data.club.clubId;
    // Cache hit (e.g. after a year-change remount) — reuse it, don't re-fetch.
    const cached = liveTerminatedCache.get(cid);
    if (cached) { setLiveTerminated(cached); return; }
    let cancelled = false;
    setLiveTerminatedLoading(true);
    setLiveTerminatedWarning(null);
    getRotaryOrgTerminatedMembers(cid)
      .then((res) => {
        if (cancelled) return;
        if (res.warning) setLiveTerminatedWarning(res.warning);
        // Map the upstream shape onto our row shape so the existing table render
        // doesn't need to know we swapped sources.
        const rows: ClubAdminDashboardRotaryNetworkRow[] = (res.members || []).map((m) => ({
          id: m.id,
          memberId: m.memberId,
          memberType: m.memberType,
          firstName: m.firstName,
          middleName: m.middleName,
          lastName: m.lastName,
          admissionDate: m.admissionDate,
          terminationDate: m.terminationDate,
          terminationReason: m.terminationReason,
          mobile: m.mobile,
          email: m.email,
        } as ClubAdminDashboardRotaryNetworkRow));
        liveTerminatedCache.set(cid, rows);
        setLiveTerminated(rows);
      })
      .catch(() => { if (!cancelled) setLiveTerminatedWarning("Failed to fetch live data from Rotary.org. Showing locally stored records."); })
      .finally(() => { if (!cancelled) setLiveTerminatedLoading(false); });
    return () => { cancelled = true; };
    // liveTerminatedLoading is deliberately excluded — it's set to true synchronously
    // above, and including it here made the effect immediately re-run and cancel its
    // own in-flight fetch (the cleanup set `cancelled` before the request resolved),
    // leaving the loading spinner stuck forever and the live data never applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, data, liveTerminated]);

  const handleDeletePotential = async (row: ClubAdminDashboardRotaryNetworkRow) => {
    if (!data) return;
    const name = `${row.firstName || ""} ${row.lastName || ""}`.trim() || "this potential member";
    if (!window.confirm(`Delete ${name}? This action cannot be undone.`)) return;
    try {
      setDeletingId(row.id);
      await deletePotentialMember(data.club.clubId, row.id);
      setReloadTick((t) => t + 1);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to delete potential member.");
    } finally {
      setDeletingId(null);
    }
  };

  const rows = useMemo<ClubAdminDashboardRotaryNetworkRow[]>(() => {
    if (!data) return [];
    // Terminated view: prefer live Rotary.org data once it has loaded. While the
    // live fetch is still in flight, show an empty list (the "Fetching live…" banner
    // is shown above) rather than briefly flashing the smaller DB-stored list — that
    // caused the confusing "2 records, then 265" jump. Fall back to the DB list only
    // if the live fetch actually finished without data (i.e. it failed).
    const source = view === "terminated"
      ? (liveTerminated ?? (liveTerminatedLoading ? [] : data.terminatedMembers))
      : data.potentialMembers;
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((r) =>
      `${r.firstName} ${r.middleName} ${r.lastName}`.toLowerCase().includes(q) ||
      (r.memberId ?? "").toLowerCase().includes(q) ||
      (r.terminationReason ?? "").toLowerCase().includes(q)
    );
  }, [data, view, search, liveTerminated, liveTerminatedLoading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading Rotary Network…" />
      </div>
    );
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  // The live terminated count is still resolving when we have no live data yet AND the
  // fetch hasn't failed (no warning). Used for the KPI count on ANY view. terminatedPending
  // is the same thing but scoped to the terminated LIST (only shown on that view).
  const terminatedCountLoading = liveTerminated === null && liveTerminatedWarning === null;
  const terminatedPending = view === "terminated" && terminatedCountLoading;

  const clubId = data.club.clubId;
  // Encode the current view in returnTo so V2 form Save/Back lands on the same view.
  const returnTo = encodeURIComponent(
    `/club-admin-dashboard/dashboard/rotary-network?view=${view}`,
  );
  // Per-view Add destination — v2 sub-modules under rotary-network now have their own Add pages.
  const addUrl = view === "potential"
    ? `/clubs/${clubId}/rotary-network/potential-members/v2/add?returnTo=${returnTo}`
    : `/clubs/${clubId}/rotary-network/terminated-members/v2/add?returnTo=${returnTo}`;

  return (
    <div className="space-y-5">
      {/* Cards "This Rotary Year", "Now Member", "Lack of Participation" removed
          per user request (2026-06-12). Only Total Terminated retained — shows
          live Rotary.org count once that fetch lands. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <KpiCard
          title="Total Terminated"
          value={terminatedCountLoading ? <RotaryLoader size="sm" /> : fmtInt(liveTerminated ? liveTerminated.length : data.totalTerminated)}
          subtitle={terminatedCountLoading ? "Loading…" : (liveTerminated ? "Live from Rotary.org" : "All records")}
          icon={UserMinus}
          color="red"
        />
        <KpiCard
          title="Total Prospective"
          value={fmtInt(data.potentialMembers.length)}
          subtitle="All records"
          icon={UserPlus}
          color="blue"
        />
      </div>

      {view === "terminated" && liveTerminatedLoading && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 flex items-center">
          <RotaryLoader size="sm" label="Fetching live terminated members from Rotary.org…" />
        </div>
      )}
      {view === "terminated" && liveTerminatedWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {liveTerminatedWarning}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Rotary Network</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage terminated and prospective members
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex items-center gap-1 rounded-full p-1 text-sm bg-muted"
            >
              <button
                onClick={() => handleViewChange("terminated")}
                className={`inline-flex h-9 items-center px-4 font-semibold rounded-full transition-colors ${
                  view === "terminated" ? "bg-card text-foreground ring-1 ring-[color:var(--row-line)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Terminated Members
              </button>
              <button
                onClick={() => handleViewChange("potential")}
                className={`inline-flex h-9 items-center px-4 font-semibold rounded-full transition-colors ${
                  view === "potential" ? "bg-card text-foreground ring-1 ring-[color:var(--row-line)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Potential Members
              </button>
            </div>
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            {/* Add is hidden for Terminated Members — terminated rows come from
                the upstream API and are not user-creatable from this screen. */}
            {view === "potential" && (
              <Link
                href={addUrl}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
              >
                <Plus size={13} /> Add
              </Link>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] md:min-w-full text-sm">
            <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
              <tr>
                <th className="px-3 py-2.5 text-left w-12">Sr No</th>
                <th className="px-3 py-2.5 text-left">Member ID</th>
                <th className="px-3 py-2.5 text-left">Member Type</th>
                <th className="px-3 py-2.5 text-left">First Name</th>
                <th className="px-3 py-2.5 text-left">Middle Name</th>
                <th className="px-3 py-2.5 text-left">Last Name</th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">Mobile</th>
                <th className="px-3 py-2.5 text-left">Email</th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">Admission Date</th>
                {view === "terminated" && (
                  <>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Termination Date</th>
                    <th className="px-3 py-2.5 text-left">Termination Reason</th>
                  </>
                )}
                {view === "potential" && (
                  <th className="px-3 py-2.5 text-left">Notes</th>
                )}
                {/* Actions column (Edit/Delete) is only rendered for Potential
                    members. Terminated members are read-only — sourced from the
                    upstream membership API. */}
                {view === "potential" && (
                  <th className="px-3 py-2.5 text-right whitespace-nowrap w-24">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, index) => {
                const editUrl = view === "terminated"
                  ? `/clubs/${clubId}/rotary-network/terminated-members/v2/${r.id}/edit?returnTo=${returnTo}`
                  : `/clubs/${clubId}/rotary-network/potential-members/v2/${r.id}/edit?returnTo=${returnTo}`;
                return (
                  <tr key={`${view}-${r.id}`} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-xs text-slate-600">{index + 1}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.memberId || "–"}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                        {r.memberType || "–"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-800 font-medium">{r.firstName || "–"}</td>
                    <td className="px-3 py-2 text-slate-600">{r.middleName || "–"}</td>
                    <td className="px-3 py-2 text-slate-800 font-medium">{r.lastName || "–"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{r.mobile || "–"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.email || "–"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{fmtDate(r.admissionDate)}</td>
                    {view === "terminated" && (
                      <>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{fmtDate(r.terminationDate)}</td>
                        <td className="px-3 py-2">
                          {r.terminationReason ? (
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${reasonChip(r.terminationReason)}`}>
                              {r.terminationReason}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">, </span>
                          )}
                        </td>
                      </>
                    )}
                    {view === "potential" && (
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs truncate" title={r.notes || undefined}>{r.notes || "–"}</td>
                    )}
                    {/* Actions cell (Edit + Delete) is rendered only for Potential
                        members — Terminated members are read-only on this screen. */}
                    {view === "potential" && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Link
                            href={editUrl}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            aria-label="Edit potential member"
                            title="Edit potential member"
                          >
                            <Edit3 size={13} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDeletePotential(r)}
                            disabled={deletingId === r.id}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-50"
                            aria-label="Delete potential member"
                            title="Delete potential member"
                          >
                            {deletingId === r.id
                              ? <RotaryLoader size="sm" />
                              : <Trash2 size={13} />}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {terminatedPending && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center">
                    <RotaryLoader size="md" label="Loading terminated members…" />
                  </td>
                </tr>
              )}
              {!terminatedPending && rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    No {view === "terminated" ? "terminated" : "potential"} members{search ? " match your search" : ""}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          {terminatedPending
            ? "Loading…"
            : `${rows.length} ${view === "terminated" ? "terminated" : "potential"} member${rows.length === 1 ? "" : "s"}`}
        </div>
      </div>
    </div>
  );
}

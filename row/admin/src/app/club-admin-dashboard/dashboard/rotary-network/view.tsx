"use client";

import { IconButton } from "@/components/ui/icon-button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/row/AppKit";
import PillTabs from "@/components/row/PillTabs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { UserMinus, UserPlus, Search, Plus, Edit3, Trash2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { getClubAdminDashboardRotaryNetwork, deletePotentialMember, getRotaryOrgTerminatedMembers } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import type {
  ClubAdminDashboardRotaryNetworkResponse,
  ClubAdminDashboardRotaryNetworkRow,
} from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import { clubYearRights, canEditYearless } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { useCurrentRotaryYear } from "@/hooks/useCurrentRotaryYear";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";

// Re-enabled per user request. Kept as a plain (unexported) function rather
// than deleted, in case the "Coming Soon" placeholder needs to come back.
function DashboardRotaryNetworkComingSoonStub() {
  return (
    <PageHeader title="Rotary Network: Coming Soon" description="Terminated members (live from Rotary.org) and potential members will appear here once the integration is finalised." />
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
  const { selectedClubId, user, isSuperAdmin } = useAuth();

  // Potential members carry NO Rotary year — they are the club's current pipeline.
  // Year-less data follows the same rule the server applies: changing it needs
  // CURRENT-year rights, so a past-year admin can read but not alter it.
  const currentYearId = useCurrentRotaryYear();
  const { years: ywarYears } = useRotaryYears();
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
  const yearRights = clubYearRights(user?.scopedRoles, clubId);
  const canManage = canEditYearless(yearRights, currentYearId, isSuperAdmin);
  // YWAR-BADGE-YEARLESS — name the CURRENT year, not the years held.
  // This data is not filed by Rotary year, so "you can make changes in
  // 2025-26" is untrue: those years cannot help here. See ViewOnlyBadge.
  const ywarCurrentYearLabel =
    ywarYears.find((y) => y.id === currentYearId)?.yearLabel ?? "";

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
      {!canManage && view === "potential" && (
        <ViewOnlyBadge currentYearOnly={ywarCurrentYearLabel} className="mb-4" />
      )}

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

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="row-h3">Rotary Network</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage terminated and prospective members
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PillTabs
              items={[{ key: "terminated", label: "Terminated Members" }, { key: "potential", label: "Potential Members" }]}
              active={view}
              onChange={handleViewChange}
            />
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 sm:w-48"
              />
            </div>
            {/* Add is hidden for Terminated Members — terminated rows come from
                the upstream API and are not user-creatable from this screen. */}
            {view === "potential" && canManage && (
              <Link
                href={addUrl}
                className="row-btn row-btn-primary"
              >
                <Plus size={13} /> Add
              </Link>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="w-full min-w-[640px] md:min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3 text-left w-12">Sr No</TableHead>
                <TableHead className="px-3 text-left">Member ID</TableHead>
                <TableHead className="px-3 text-left">Member Type</TableHead>
                <TableHead className="px-3 text-left">First Name</TableHead>
                <TableHead className="px-3 text-left">Middle Name</TableHead>
                <TableHead className="px-3 text-left">Last Name</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">Mobile</TableHead>
                <TableHead className="px-3 text-left">Email</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">Admission Date</TableHead>
                {view === "terminated" && (
                  <>
                    <TableHead className="px-3 text-left whitespace-nowrap">Termination Date</TableHead>
                    <TableHead className="px-3 text-left">Termination Reason</TableHead>
                  </>
                )}
                {view === "potential" && (
                  <TableHead className="px-3 text-left">Notes</TableHead>
                )}
                {/* Actions column (Edit/Delete) is only rendered for Potential
                    members. Terminated members are read-only — sourced from the
                    upstream membership API. */}
                {view === "potential" && (
                  <TableHead className="px-3 text-right whitespace-nowrap w-24">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {rows.map((r, index) => {
                const editUrl = view === "terminated"
                  ? `/clubs/${clubId}/rotary-network/terminated-members/v2/${r.id}/edit?returnTo=${returnTo}`
                  : `/clubs/${clubId}/rotary-network/potential-members/v2/${r.id}/edit?returnTo=${returnTo}`;
                return (
                  <TableRow key={`${view}-${r.id}`} className="hover:bg-blue-50/40">
                    <TableCell className="px-3 py-2 text-xs text-slate-600">{index + 1}</TableCell>
                    <TableCell className="px-3 py-2 text-xs text-slate-600">{r.memberId || "–"}</TableCell>
                    <TableCell className="px-3 py-2">
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border bg-slate-50 text-slate-700 border-slate-200">
                        {r.memberType || "–"}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2 text-slate-800 font-medium">{r.firstName || "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-slate-600">{r.middleName || "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-slate-800 font-medium">{r.lastName || "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{r.mobile || "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-xs text-slate-600">{r.email || "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{fmtDate(r.admissionDate)}</TableCell>
                    {view === "terminated" && (
                      <>
                        <TableCell className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{fmtDate(r.terminationDate)}</TableCell>
                        <TableCell className="px-3 py-2">
                          {r.terminationReason ? (
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${reasonChip(r.terminationReason)}`}>
                              {r.terminationReason}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">–</span>
                          )}
                        </TableCell>
                      </>
                    )}
                    {view === "potential" && (
                      <TableCell className="px-3 py-2 text-xs text-slate-600 max-w-xs truncate" title={r.notes || undefined}>{r.notes || "–"}</TableCell>
                    )}
                    {/* Actions cell (Edit + Delete) is rendered only for Potential
                        members — Terminated members are read-only on this screen. */}
                    {view === "potential" && (
                      <TableCell className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {canManage && (
                            <Link
                              href={editUrl}
                              className="row-icon-btn"
                              aria-label="Edit potential member"
                              title="Edit potential member"
                            >
                              <Edit3 size={13} />
                            </Link>
                          )}
                          {canManage && (
                            <IconButton
                              type="button"
                              onClick={() => handleDeletePotential(r)}
                              disabled={deletingId === r.id}
                              aria-label="Delete potential member"
                              title="Delete potential member"
                            >
                              {deletingId === r.id
                                ? <RotaryLoader size="sm" />
                                : <Trash2 size={13} />}
                            </IconButton>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {terminatedPending && (
                <TableRow>
                  <TableCell colSpan={11} className="px-4 py-10 text-center">
                    <RotaryLoader size="md" label="Loading terminated members…" />
                  </TableCell>
                </TableRow>
              )}
              {!terminatedPending && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    No {view === "terminated" ? "terminated" : "potential"} members{search ? " match your search" : ""}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          {terminatedPending
            ? "Loading…"
            : `${rows.length} ${view === "terminated" ? "terminated" : "potential"} member${rows.length === 1 ? "" : "s"}`}
        </div>
      </Card>
    </div>
  );
}

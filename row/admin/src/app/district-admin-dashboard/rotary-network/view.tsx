"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { UserMinus, UserPlus, Search, X, RefreshCw, Eye, Download } from "@/components/icons";
import * as XLSX from "xlsx-js-style";
import RotaryLoader from "@/components/RotaryLoader";
import {
  getDistrictAdminRotaryNetwork,
  getDistrictAdminRotaryNetworkLiveTerminated,
  startDistrictRotaryNetworkTerminatedCacheRefresh,
  getDistrictRotaryNetworkTerminatedCacheRefreshStatus,
  type DistrictRotaryRefreshJobStatus,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import type {
  DistrictAdminRotaryNetworkResponse,
  DistrictAdminRotaryNetworkClubOption,
  DistrictAdminRotaryNetworkRow,
} from "@/types/districtAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";

function reasonChip(reason: string | null | undefined): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("particip")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (r.includes("business") || r.includes("relocat")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (r.includes("personal") || r.includes("health")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (r.includes("transfer")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

type ToggleView = "terminated" | "potential";

function isToggleView(v: string | null): v is ToggleView {
  return v === "terminated" || v === "potential";
}

// District-wide, read-only view of Rotary Network — aggregates Terminated and
// Potential members across every club in the district, with a club filter
// since (unlike the club-admin version) rows span many clubs at once.
//
// Named export so it can be embedded inside the E-Governance tab strip
// (`embedded`) as well as rendered by its own route via the thin page.tsx
// wrapper. When embedded we DON'T sync ?view= to the URL — that would clobber
// the parent page's ?tab= param and kick the user off the Rotary Network tab.
export function DistrictRotaryNetworkView({ embedded = false }: { embedded?: boolean } = {}) {
  const { selectedDistrictId } = useAuth();
  const { yearId } = useDistrictAdminCache();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialView: ToggleView = (() => {
    const v = searchParams?.get("view");
    return isToggleView(v) ? v : "terminated";
  })();

  const [data, setData] = useState<DistrictAdminRotaryNetworkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ToggleView>(initialView);
  const [search, setSearch] = useState("");

  // Smart club search — type to filter the club list, pick one to narrow both tabs.
  const [clubQuery, setClubQuery] = useState("");
  const [clubId, setClubId] = useState<number | null>(null);
  const [clubDropdownOpen, setClubDropdownOpen] = useState(false);
  const clubBoxRef = useRef<HTMLDivElement>(null);

  // Live Rotary.org terminated members for the ONE selected club — fast path, only used
  // when the club filter is active. Browsing "all clubs" reads from data.terminatedMembers
  // (server-side merged from the cache + local records) instead of fetching live.
  const [liveTerminated, setLiveTerminated] = useState<DistrictAdminRotaryNetworkRow[] | null>(null);
  const [liveTerminatedLoading, setLiveTerminatedLoading] = useState(false);
  const [liveTerminatedWarning, setLiveTerminatedWarning] = useState<string | null>(null);

  // Server-side background refresh job for the whole district — a real background job, not a
  // client-driven loop, so it keeps running (and any tab/session can see its progress) even if
  // this admin navigates away or closes the tab entirely.
  const [jobStatus, setJobStatus] = useState<DistrictRotaryRefreshJobStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshing = jobStatus?.status === "Running";

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
    getDistrictAdminRotaryNetwork(yearId, selectedDistrictId, undefined, clubId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load network."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [yearId, selectedDistrictId, clubId, refreshTick]);

  // Live-fetch is now a per-club fast path ONLY — fetching every club in the district live
  // at once was too slow/heavy and is what broke this page. Browsing "all clubs" instead
  // reads data.terminatedMembers, which the backend already merges from the cache + any
  // clubs' local records (see "Refresh from Rotary.org" below for warming that cache).
  useEffect(() => {
    if (view !== "terminated" || !clubId) { setLiveTerminated(null); return; }
    let cancelled = false;
    setLiveTerminated(null);
    setLiveTerminatedLoading(true);
    setLiveTerminatedWarning(null);
    getDistrictAdminRotaryNetworkLiveTerminated(selectedDistrictId, clubId)
      .then((res) => {
        if (cancelled) return;
        if (res.warning) setLiveTerminatedWarning(res.warning);
        setLiveTerminated(res.members);
      })
      .catch(() => { if (!cancelled) setLiveTerminatedWarning("Failed to fetch live data from Rotary.org. Showing locally stored records."); })
      .finally(() => { if (!cancelled) setLiveTerminatedLoading(false); });
    return () => { cancelled = true; };
  }, [view, selectedDistrictId, clubId]);

  // On mount (or district change), check whether a refresh is ALREADY running — e.g. started
  // from another tab, another session, or before this page was last opened — and resume
  // showing its progress. This is what makes the refresh survive navigating away and back.
  useEffect(() => {
    let cancelled = false;
    getDistrictRotaryNetworkTerminatedCacheRefreshStatus(selectedDistrictId)
      .then((s) => {
        if (cancelled) return;
        setJobStatus(s);
        if (s.status === "Running") setPolling(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedDistrictId]);

  // Poll while a job is running. The job itself runs server-side regardless of polling —
  // this just keeps the UI in sync with it, from whichever tab/session happens to be open.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const s = await getDistrictRotaryNetworkTerminatedCacheRefreshStatus(selectedDistrictId);
        if (cancelled) return;
        setJobStatus(s);
        if (s.status !== "Running") {
          setPolling(false);
          setRefreshTick((t) => t + 1); // reload data now that the cache has been warmed
        }
      } catch {
        // Transient poll failure — try again on the next tick rather than giving up.
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [polling, selectedDistrictId]);

  // Starts the server-side refresh (or just picks up the already-running one, if someone else
  // started it first) and begins polling its progress.
  const handleRefreshFromRotaryOrg = async () => {
    try {
      const s = await startDistrictRotaryNetworkTerminatedCacheRefresh(selectedDistrictId);
      setJobStatus(s);
      if (s.status === "Running") setPolling(true);
    } catch {
      setJobStatus({
        jobId: 0, districtId: selectedDistrictId ?? 0, status: "Failed",
        totalLinkedClubs: 0, clubsDone: 0, warning: "Could not start the refresh. Try again.",
      });
    }
  };

  // Close the club-search dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (clubBoxRef.current && !clubBoxRef.current.contains(e.target as Node)) setClubDropdownOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const clubOptions = useMemo<DistrictAdminRotaryNetworkClubOption[]>(() => {
    if (!data) return [];
    const q = clubQuery.trim().toLowerCase();
    if (!q) return data.clubs;
    return data.clubs.filter((c) => c.clubName.toLowerCase().includes(q));
  }, [data, clubQuery]);

  const selectedClubName = useMemo(
    () => data?.clubs.find((c) => c.clubId === clubId)?.clubName ?? "",
    [data, clubId],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const source = view === "terminated" ? (liveTerminated ?? data.terminatedMembers) : data.potentialMembers;
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((r) =>
      `${r.firstName} ${r.middleName} ${r.lastName}`.toLowerCase().includes(q) ||
      r.clubName.toLowerCase().includes(q) ||
      (r.memberId ?? "").toLowerCase().includes(q) ||
      (r.terminationReason ?? "").toLowerCase().includes(q)
    );
  }, [data, view, search, liveTerminated]);

  // Terminated tab lands on a per-club summary (club + count) rather than one giant flat
  // table — pick a club ("View") to drill into its member list. Every club in the district
  // is included, even at zero, so it's obvious which ones haven't been refreshed yet.
  const showClubSummary = view === "terminated" && !clubId;
  const clubSummary = useMemo(() => {
    if (!data) return [];
    const counts = new Map<number, number>();
    for (const r of data.terminatedMembers) counts.set(r.clubId, (counts.get(r.clubId) ?? 0) + 1);
    const q = search.trim().toLowerCase();
    return data.clubs
      .map((c) => ({ clubId: c.clubId, clubName: c.clubName, count: counts.get(c.clubId) ?? 0 }))
      .filter((c) => !q || c.clubName.toLowerCase().includes(q))
      .sort((a, b) => b.count - a.count || a.clubName.localeCompare(b.clubName));
  }, [data, search]);

  function exportTerminatedExcel(members: DistrictAdminRotaryNetworkRow[], filename: string) {
    const sheetRows = members.map((m, i) => ({
      "S.No.": i + 1,
      "Club": m.clubName,
      "Member ID": m.memberId || "-",
      "Member Type": m.memberType || "-",
      "First Name": m.firstName || "-",
      "Middle Name": m.middleName || "-",
      "Last Name": m.lastName || "-",
      "Mobile": m.mobile || "-",
      "Email": m.email || "-",
      "Admission Date": fmtDate(m.admissionDate),
      "Termination Date": fmtDate(m.terminationDate),
      "Termination Reason": m.terminationReason || "-",
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Terminated Members");
    XLSX.writeFile(wb, filename);
  }

  const handleDownloadClubExcel = (targetClubId: number, targetClubName: string) => {
    if (!data) return;
    const members = data.terminatedMembers.filter((m) => m.clubId === targetClubId);
    exportTerminatedExcel(members, `${targetClubName || "Club"}_Terminated_Members.xlsx`);
  };

  const handleDownloadAllExcel = () => {
    if (!data) return;
    exportTerminatedExcel(data.terminatedMembers, `${data.district.districtNumber || "District"}_Terminated_Members.xlsx`);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading Rotary Network…" />
      </div>
    );
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <KpiCard
          title="Total Terminated"
          value={fmtInt(view === "terminated" && liveTerminated ? liveTerminated.length : data.totalTerminated)}
          subtitle={view === "terminated" && liveTerminated ? "Live from Rotary.org" : "All clubs"}
          icon={UserMinus}
          color="red"
        />
        <KpiCard title="Total Prospective" value={fmtInt(data.totalPotential)} subtitle="All clubs" icon={UserPlus} color="blue" />
      </div>

      {view === "terminated" && liveTerminatedLoading && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 flex items-center">
          <RotaryLoader size="sm" label={`Fetching ${selectedClubName || "this club"}'s terminated members live from Rotary.org…`} />
        </div>
      )}
      {view === "terminated" && liveTerminatedWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {liveTerminatedWarning}
        </div>
      )}
      {refreshing && (() => {
        const total = jobStatus?.totalLinkedClubs ?? 0;
        const done = Math.min(jobStatus?.clubsDone ?? 0, total);
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 8;
        return (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">
                {total > 0
                  ? `Refreshing from Rotary.org: ${done} of ${total} clubs (runs in the background: safe to leave this page)`
                  : "Starting refresh from Rotary.org…"}
              </span>
              {total > 0 && <span className="font-semibold">{pct}%</span>}
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2 relative overflow-hidden">
              <div className="bg-blue-600 rounded-full h-2 transition-all relative z-10" style={{ width: `${pct}%` }} />
              {/* Shimmer sweeps left-to-right over just the unfilled remainder, signalling
                  which direction the bar is filling in. */}
              <div className="absolute top-0 h-2 animate-progress-shimmer" style={{ left: `${pct}%`, right: 0 }} />
            </div>
          </div>
        );
      })()}
      {!refreshing && jobStatus?.warning && (jobStatus.status === "Done" || jobStatus.status === "Failed") && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {jobStatus.warning}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Rotary Network</h3>
            <p className="text-xs text-slate-500 mt-0.5">Terminated and prospective members across every club in the district</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {view === "terminated" && (
              <button
                type="button"
                onClick={handleRefreshFromRotaryOrg}
                disabled={refreshing}
                title="Warms the cache for every linked club in the district, a few at a time: safe to leave running in the background."
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} />
                {refreshing ? "Refreshing…" : "Refresh from Rotary.org"}
              </button>
            )}
            {showClubSummary && (
              <button
                type="button"
                onClick={handleDownloadAllExcel}
                disabled={data.terminatedMembers.length === 0}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                <Download size={13} /> Download All as Excel
              </button>
            )}
            {view === "terminated" && clubId && (
              <button
                type="button"
                onClick={() => handleDownloadClubExcel(clubId, selectedClubName)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              >
                <Download size={13} /> Download as Excel
              </button>
            )}
            <div className="inline-flex items-center gap-1 rounded-full p-1 text-sm bg-muted">
              <button
                onClick={() => handleViewChange("terminated")}
                className={`inline-flex h-9 items-center px-4 font-semibold rounded-full transition-colors ${view === "terminated" ? "bg-card text-foreground ring-1 ring-[color:var(--row-line)]" : "text-muted-foreground hover:text-foreground"}`}
              >
                Terminated Members
              </button>
              <button
                onClick={() => handleViewChange("potential")}
                className={`inline-flex h-9 items-center px-4 font-semibold rounded-full transition-colors ${view === "potential" ? "bg-card text-foreground ring-1 ring-[color:var(--row-line)]" : "text-muted-foreground hover:text-foreground"}`}
              >
                Potential Members
              </button>
            </div>

            {/* Smart club search — type to filter, pick one to narrow both tabs to that club. */}
            <div className="relative" ref={clubBoxRef}>
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filter by club…"
                value={clubId ? selectedClubName : clubQuery}
                onFocus={() => setClubDropdownOpen(true)}
                onChange={(e) => { setClubId(null); setClubQuery(e.target.value); setClubDropdownOpen(true); }}
                className="pl-7 pr-7 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-52 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              {clubId && (
                <button
                  type="button"
                  aria-label="Clear club filter"
                  onClick={() => { setClubId(null); setClubQuery(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
              {clubDropdownOpen && !clubId && clubOptions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full sm:w-64 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {clubOptions.slice(0, 50).map((c) => (
                    <button
                      key={c.clubId}
                      type="button"
                      onClick={() => { setClubId(c.clubId); setClubQuery(""); setClubDropdownOpen(false); }}
                      className="block w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50"
                    >
                      {c.clubName}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={showClubSummary ? "Search club…" : "Search…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
          </div>
        </div>

        {showClubSummary ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] md:min-w-full text-sm">
                <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-12">Sr No</th>
                    <th className="px-3 py-2.5 text-left">Club</th>
                    <th className="px-3 py-2.5 text-left">Terminated Count</th>
                    <th className="px-3 py-2.5 text-right w-40">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clubSummary.map((c, index) => (
                    <tr key={c.clubId} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 text-xs text-slate-600">{index + 1}</td>
                      <td className="px-3 py-2 text-slate-800 font-medium">{c.clubName}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${c.count > 0 ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                          {fmtInt(c.count)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setClubId(c.clubId)}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded text-blue-700 hover:bg-blue-50"
                            title="View this club's terminated members"
                          >
                            <Eye size={13} /> View
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadClubExcel(c.clubId, c.clubName)}
                            disabled={c.count === 0}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded text-emerald-700 hover:bg-emerald-50 disabled:opacity-30"
                            title="Download this club's terminated members as Excel"
                          >
                            <Download size={13} /> Excel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {clubSummary.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                        No clubs match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
              {clubSummary.length} club{clubSummary.length === 1 ? "" : "s"}
            </div>
          </>
        ) : (
        <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] md:min-w-full text-sm">
            <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
              <tr>
                <th className="px-3 py-2.5 text-left w-12">Sr No</th>
                <th className="px-3 py-2.5 text-left">Club</th>
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
                {view === "potential" && <th className="px-3 py-2.5 text-left">Notes</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, index) => (
                <tr key={`${view}-${r.id}`} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 text-xs text-slate-600">{index + 1}</td>
                  <td className="px-3 py-2 text-slate-800 font-medium whitespace-nowrap">{r.clubName || "–"}</td>
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
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                    No {view === "terminated" ? "terminated" : "potential"} members{search || clubId ? " match your filters" : ""}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          {rows.length} {view === "terminated" ? "terminated" : "potential"} member{rows.length === 1 ? "" : "s"}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

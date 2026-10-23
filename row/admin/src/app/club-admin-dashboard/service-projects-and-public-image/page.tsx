"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Briefcase, Users, IndianRupee, Coins, DollarSign, Clock4, CalendarDays, Search,
  Plus, Edit3, Trash2, Eye, Puzzle,
  CheckCircle2, ChevronDown, ChevronRight, AlertTriangle, RotateCcw } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProjectDetailModal from "@/components/ProjectDetailModal";
import AlertModal from "@/components/AlertModal";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";
import AgreeAddButton from "@/components/AgreeAddButton";
import { AGREE_MESSAGES } from "@/lib/agreeMessages";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, AVENUE_LABELS, buildOrgExportFromDetail, triggerAddToOrg } from "@/lib/addToOrg";
import {
  getServiceProjectsAvenue,
  deleteProject,
  getProject,
  resetRotaryOrgSync,
} from "@/services/api";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { useAuth } from "@/contexts/AuthContext";
import { shortMoney, moneyIconName } from "@/lib/currency";
import type {
  ServiceProjectsOverviewResponse,
  ServiceProjectsAvenueDetailResponse,
  ServiceProjectsProjectRow,
  ServiceProjectsMeetingRow,
} from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtInr, fmtDate } from "@/components/dashboard/formatters";

import { defaultCurrency } from "@/lib/appFormat";
// Base URL the RI Flow-Bot export uses to build absolute photo URLs for the extension.
const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Tab order matches the on-screen pill bar in the screenshots
type AvenueTab = "all" | "club_service" | "community_service" | "vocational_service"
               | "international_service" | "new_generation_service"
               | "public_image_initiative";

const AVENUE_TABS: { key: AvenueTab; label: string }[] = [
  { key: "all",                     label: "All" },
  { key: "club_service",            label: "Club Service" },
  { key: "community_service",       label: "Community Service" },
  { key: "vocational_service",      label: "Vocational Service" },
  { key: "international_service",   label: "International Service" },
  { key: "new_generation_service",  label: "New Generation" },
  { key: "public_image_initiative", label: "Public Image" },
];

// Slug map used to build links into existing module pages
const SLUG_MAP: Record<string, string> = {
  club_service:            "club-service/v2",
  community_service:       "community-service/v2",
  vocational_service:      "vocational-service/v2",
  international_service:   "international-service/v2",
  new_generation_service:  "new-generation-service/v2",
  public_image_initiative: "public-image-initiative/v2",
};

function avenueBadgeStyle(key: string): string {
  switch (key) {
    case "club_service":            return "bg-blue-50 text-blue-700 border-blue-200";
    case "community_service":       return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "vocational_service":      return "bg-amber-50 text-amber-700 border-amber-200";
    case "international_service":   return "bg-violet-50 text-violet-700 border-violet-200";
    case "new_generation_service":  return "bg-pink-50 text-pink-700 border-pink-200";
    case "public_image_initiative": return "bg-orange-50 text-orange-700 border-orange-200";
    default:                        return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function projectTypeChipStyle(t: string) {
  const lo = t.toLowerCase();
  if (lo.includes("one"))     return "bg-blue-50 text-blue-700 border-blue-200";
  if (lo.includes("recur"))   return "bg-purple-50 text-purple-700 border-purple-200";
  if (lo.includes("annual"))  return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

// Dollar currencies get the dollar glyph, every other currency a neutral coin.
function moneyIcon(code?: string | null) {
  const which = moneyIconName(code);
  return which === "dollar" ? DollarSign : Coins;
}

function attendancePercentChip(pct: number) {
  if (pct >= 75) return "bg-emerald-100 text-emerald-700";
  if (pct >= 50) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

// Compact money — INR by default; currency-aware totals/rows pass the district or project currency.
const shortInr = (value: number): string => shortMoney(value, defaultCurrency());

// Whitelist guard — keeps URL params safe when reading ?tab=
function isAvenueTab(v: string | null): v is AvenueTab {
  return !!v && AVENUE_TABS.some((t) => t.key === v);
}

export default function ServiceProjectsAndPublicImagePage() {
  const { serviceProjectsOverview, status } = useClubAdminCache();
  const { selectedClubId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial tab is read from ?tab= — falls back to "all" when absent or unknown.
  const initialTab: AvenueTab = (() => {
    const t = searchParams?.get("tab");
    return isAvenueTab(t) ? t : "all";
  })();

  const [activeTab, setActiveTab] = useState<AvenueTab>(initialTab);
  // Year now comes from the global topbar selector via URL ?yearId= — local
  // dropdown removed per user request (2026-06-12, items #11 & #12).
  const urlYearStr = searchParams?.get("yearId");
  const yearId = urlYearStr ? parseInt(urlYearStr, 10) || null : null;
  const [avenueData, setAvenueData] = useState<ServiceProjectsAvenueDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep ?tab= in sync with the active tab. Uses router.replace so each tab
  // click does not push a new history entry. Omits ?tab= for "all" (default)
  // so the URL stays clean on first paint.
  const handleTabChange = (next: AvenueTab) => {
    setActiveTab(next);
    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
    if (next === "all") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Overview is served from the context cache (prefetched at layout mount).
  const overview = serviceProjectsOverview;

  // Per-avenue cache keyed on `${tab}|${yearId}` so re-clicking a tab + year
  // combo doesn't re-hit the API, AND switching year naturally misses the
  // cache (the previous design used a separate invalidation useEffect which
  // raced the fetch effect — stale data leaked through when topbar year
  // changed while a non-All tab was active).
  const [avenueCache, setAvenueCache] = useState<Map<string, ServiceProjectsAvenueDetailResponse>>(
    () => new Map(),
  );
  // Club is part of the cache key so a multi-club admin swapping clubs never sees
  // another club's cached avenue data.
  const cacheKey = `${activeTab}|${yearId ?? 0}|${selectedClubId ?? 0}`;

  // Avenue detail loads when a non-All tab is selected. Cached results render
  // instantly; only a cache miss triggers a fresh fetch.
  useEffect(() => {
    if (activeTab === "all") { setAvenueData(null); setLoading(false); return; }
    const cached = avenueCache.get(cacheKey);
    if (cached) { setAvenueData(cached); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setAvenueData(null);
    getServiceProjectsAvenue(activeTab, yearId, selectedClubId)
      .then((d) => {
        if (cancelled) return;
        setAvenueData(d);
        setAvenueCache((prev) => {
          const next = new Map(prev);
          next.set(cacheKey, d);
          return next;
        });
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load avenue."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // avenueCache intentionally excluded — cache writes from a successful fetch
    // would otherwise re-run this effect and re-render twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, yearId, cacheKey]);

  // Called by AvenueSection after a successful delete — drops the cached copy
  // for the current tab+year combo and re-fetches so KPIs and rows are fresh.
  const refreshCurrentAvenue = useCallback(async () => {
    if (activeTab === "all") return;
    setAvenueCache((prev) => {
      const next = new Map(prev);
      next.delete(cacheKey);
      return next;
    });
    setLoading(true);
    try {
      const d = await getServiceProjectsAvenue(activeTab, yearId, selectedClubId);
      setAvenueData(d);
      setAvenueCache((prev) => {
        const next = new Map(prev);
        next.set(cacheKey, d);
        return next;
      });
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to refresh avenue.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, yearId, cacheKey]);

  if (status === "loading" && !overview) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading Service Projects…" />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (status === "error" && !overview) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load.</div>;
  }
  if (!overview) return null;

  return (
    <div className="space-y-5">
      <PageHeader club={overview.club} />
      <AvenueTabBar active={activeTab} onChange={handleTabChange} />

      {activeTab === "all" ? (
        <OverviewSection overview={overview} />
      ) : (
        <AvenueSection
          tab={activeTab}
          data={avenueData}
          loading={loading}
          yearId={yearId}
          clubId={overview.club.clubId}
          onRefresh={refreshCurrentAvenue}
        />
      )}
    </div>
  );
}

// ── Top header ─────────────────────────────────────────────────────────

function PageHeader({ club }: { club: ServiceProjectsOverviewResponse["club"] }) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Service Projects &amp; Public Image</h1>
      <p className="text-xs text-slate-500 mt-0.5">
        {club.clubName} · RY {club.yearLabel}
      </p>
    </div>
  );
}

// ── Horizontal tab bar ─────────────────────────────────────────────────

function AvenueTabBar({ active, onChange }: { active: AvenueTab; onChange: (k: AvenueTab) => void }) {
  // Tab bar bg = #17458f (navy blue — same tone the sidebar uses as ACTIVE_TEXT).
  // Inactive tabs = white, active tab = Rotary gold (#F7A81B) with navy text.
  // Container wraps to its own content width (not the whole page); tab font is
  // sized so the labels are easily readable.
  return (
    <div className="overflow-x-auto">
      <div
        className="inline-flex items-center gap-1 rounded-xl p-1.5"
        style={{ backgroundColor: "#17458f" }}
      >
        {AVENUE_TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition ${
                isActive
                  ? "shadow-sm"
                  : "text-white hover:bg-white/10"
              }`}
              style={
                isActive
                  ? { backgroundColor: "#F7A81B", color: "#17458f" }
                  : undefined
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── "All" — overview KPIs + per-avenue summary table ────────────────────

function OverviewSection({ overview }: { overview: ServiceProjectsOverviewResponse }) {
  const k = overview.kpis;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard title="Total Projects"       value={fmtInt(k.totalProjects)}       subtitle="Across all avenues"  icon={Briefcase}    color="blue" />
        <KpiCard title="Total Beneficiaries"  value={fmtInt(k.totalBeneficiaries)}  subtitle="Lives impacted"      icon={Users}        color="green" />
        <KpiCard title="Total Project Cost"   value={shortMoney(Number(k.totalCost), overview.targetCurrency)} subtitle="Amount invested"     icon={moneyIcon(overview.targetCurrency)}  color="gold" />
        <KpiCard title="Man Hours"            value={fmtInt(k.totalManHours)}       subtitle="Volunteer time"      icon={Clock4}       color="purple" />
        <KpiCard title="Meetings Held"        value={fmtInt(k.meetingsHeld)}        subtitle="Club service"        icon={CalendarDays} color="blue" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">All Avenues</h3>
          <p className="text-xs text-slate-500 mt-0.5">Summary by avenue · {overview.selectedYearLabel}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Avenue</th>
                <th className="px-4 py-2.5 text-right">Projects</th>
                <th className="px-4 py-2.5 text-right">Beneficiaries</th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-4 py-2.5 text-right">Man-Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.avenues.map((a) => (
                <tr key={a.avenueKey} className="hover:bg-blue-50/40">
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${avenueBadgeStyle(a.avenueKey)}`}>
                      {a.avenueName}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-slate-800">{fmtInt(a.projects)}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{a.beneficiaries > 0 ? fmtInt(a.beneficiaries) : "–"}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{a.cost > 0 ? shortMoney(Number(a.cost), overview.targetCurrency) : "–"}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{a.manHours > 0 ? fmtInt(a.manHours) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Per-avenue section ─────────────────────────────────────────────────

function AvenueSection({
  tab, data, loading, yearId, clubId, onRefresh,
}: {
  tab: AvenueTab;
  data: ServiceProjectsAvenueDetailResponse | null;
  loading: boolean;
  yearId: number | null;
  clubId: number;
  onRefresh: () => Promise<void> | void;
}) {
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label={`Loading ${AVENUE_TABS.find((t) => t.key === tab)?.label}…`} />
      </div>
    );
  }
  if (!data) return null;

  if (tab === "club_service") {
    return <ClubServiceSection data={data} yearId={yearId} clubId={clubId} onRefresh={onRefresh} />;
  }
  return <NonClubAvenueSection data={data} yearId={yearId} clubId={clubId} onRefresh={onRefresh} />;
}

// ── Club Service: meetings ─────────────────────────────────────────────

function ClubServiceSection({
  data, yearId, clubId, onRefresh,
}: {
  data: ServiceProjectsAvenueDetailResponse;
  yearId: number | null;
  clubId: number;
  onRefresh: () => Promise<void> | void;
}) {
  const k = data.kpis;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [deleteTarget, setDeleteTarget] = useState<ServiceProjectsMeetingRow | null>(null);
  // Read-only popup: the whole meeting, its documents and its photos (user 2026-10-05).
  const [viewTarget, setViewTarget] = useState<ServiceProjectsMeetingRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Shown as a page-level overlay between "user confirms Delete" and "list refresh done"
  // so the user sees a spinner rather than a silent gap while the API call + refetch run.
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const effectiveYearId = data.selectedYearId ?? yearId ?? 0;
    if (!effectiveYearId) {
      setDeleteError("Could not resolve the Rotary year for this record.");
      return;
    }
    setIsDeleting(true);
    try {
      await deleteProject(clubId, effectiveYearId, deleteTarget.id);
      setDeleteTarget(null);
      await onRefresh();
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setDeleteError(err?.response?.data?.message || "Failed to delete meeting.");
    } finally {
      setIsDeleting(false);
    }
  };

  const filtered = useMemo<ServiceProjectsMeetingRow[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.meetings;
    return data.meetings.filter((m) =>
      m.title.toLowerCase().includes(q) ||
      m.meetingType.toLowerCase().includes(q) ||
      m.date.toLowerCase().includes(q)
    );
  }, [data.meetings, search]);

  // Reset to page 1 when filter inputs change
  useEffect(() => { setPage(1); }, [search, data.selectedYearId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  // Encode the active tab in returnTo so V2 form Save/Back returns to this tab.
  const returnTo = encodeURIComponent(
    "/club-admin-dashboard/service-projects-and-public-image?tab=club_service",
  );
  const addUrl = `/clubs/${clubId}/club-service/v2/add?returnTo=${returnTo}`;

  return (
    <div className="space-y-5">
      {/* Club Service KPIs — "Avg Attendance Stayed" and "Members on Roll"
          removed per user request 2026-06-12 (item #10). */}
      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
        <KpiCard title="Meetings Held"   value={fmtInt(k.meetingsHeld ?? 0)}                           subtitle={`RY ${data.selectedYearLabel || "–"}`} icon={CalendarDays} color="blue" />
        <KpiCard title="Avg Attendance"  value={`${Math.round(Number(k.avgAttendancePercent ?? 0))}%`} subtitle="Across meetings"                       icon={Users}        color="green" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Club Service</h3>
            <p className="text-xs text-slate-500 mt-0.5">Meeting record · {data.selectedYearLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Local YearSelect removed — use global topbar year selector. */}
            <SearchBox value={search} onChange={setSearch} />
            <AgreeAddButton message={AGREE_MESSAGES.club_service} href={addUrl} label="Add Club Service" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left w-10">Sr</th>
                <th className="px-3 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-left">Meeting Type</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left">Attendance</th>
                <th className="px-3 py-2.5 text-left">Att %</th>
                <th className="px-3 py-2.5 text-right w-16">View</th>
                <th className="px-3 py-2.5 text-right w-16">Edit</th>
                <th className="px-3 py-2.5 text-right w-16">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((m, i) => (
                <tr key={m.id} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 text-slate-500">{m.sr ?? (safePage - 1) * PAGE_SIZE + i + 1}</td>
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(m.date)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {m.meetingType || "–"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{m.title || "–"}</td>
                  <td className="px-3 py-2 text-slate-600" title={`${m.attendance} of ${m.membersOnRoll || 0} ${m.attendanceBase || "Total Members"}`}>
                    {m.attendance}/{m.membersOnRoll || "–"}
                    {m.attendanceBase === "BOD Members" && (
                      <span className="ml-1 text-[10px] text-slate-400">BOD</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${attendancePercentChip(Number(m.attendancePercent))}`}>
                      {Number(m.attendancePercent).toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setViewTarget(m)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                      aria-label="View meeting"
                      title="View details"
                    >
                      <Eye size={13} />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/clubs/${clubId}/club-service/v2/${m.id}/edit?returnTo=${returnTo}&yearId=${data.selectedYearId ?? yearId ?? ""}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                    >
                      <Edit3 size={13} />
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(m)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                      aria-label="Delete meeting"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No meetings recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-3 py-1 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >Prev</button>
              <span className="text-slate-500">Page {safePage} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-3 py-1 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Read-only detail popup. The attendance figures are handed over so the popup prints exactly
          what the row shows - BOD meetings against the board, everything else against the roll. */}
      <ProjectDetailModal
        clubId={clubId}
        yearId={Number(data.selectedYearId ?? yearId ?? 0)}
        projectId={viewTarget?.id ?? null}
        onClose={() => setViewTarget(null)}
        attendance={viewTarget ? {
          attended: viewTarget.attendance,
          base: viewTarget.membersOnRoll,
          baseLabel: viewTarget.attendanceBase || "Total Members",
          percent: Number(viewTarget.attendancePercent),
        } : null}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Meeting"
        description={<>
          Are you sure you want to delete this meeting
          {deleteTarget?.title ? <>: <span className="font-semibold text-foreground">{deleteTarget.title}</span></> : null}?
          This action cannot be undone.
        </>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleConfirmDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />

      {deleteError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 shadow-lg">
          {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-2 font-semibold underline">Dismiss</button>
        </div>
      )}

      {isDeleting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-4 shadow-xl">
            <RotaryLoader size="sm" />
            <span className="text-sm font-semibold text-slate-700">Deleting…</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Non-Club avenues: one-time / ongoing projects ──────────────────────

function NonClubAvenueSection({
  data, yearId, clubId, onRefresh,
}: {
  data: ServiceProjectsAvenueDetailResponse;
  yearId: number | null;
  clubId: number;
  onRefresh: () => Promise<void> | void;
}) {
  const k = data.kpis;
  const [subTab, setSubTab] = useState<"one_time" | "ongoing">("one_time");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());
  const PAGE_SIZE = 20;
  const [deleteTarget, setDeleteTarget] = useState<ServiceProjectsProjectRow | null>(null);
  // Read-only popup with every field and every photo of the project (user 2026-10-05).
  const [viewTarget, setViewTarget] = useState<ServiceProjectsProjectRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Shown as a page-level overlay between "user confirms Delete" and "list refresh done"
  // so the user sees a spinner rather than a silent gap while the API call + refetch run.
  const [isDeleting, setIsDeleting] = useState(false);

  // ── RI Flow-Bot: per-project "Add to Rotary.org" sync (Thane City View only) ──
  // Mirrors the /clubs/[id]/…/v2 listing's sync button so club admins can push a
  // project to Rotary.org straight from this dashboard listing.
  const installed = useExtensionStatus();
  const { isSuperAdmin } = useAuth();
  const avenueLabel = AVENUE_LABELS[data.avenueKey];
  // Column renders only when the extension is installed,
  // on avenues the extension understands.
  // Sync button: extension installed + an avenue the extension understands.
  // Reset: SuperAdmin only, and it must work WITHOUT the extension - support clears the flag from
  // their own machine after a club reports a project that reads "Synced" but never reached
  // Rotary.org (user 2026-10-05). So the column also opens for a SuperAdmin.
  const canSync = isFlowBotEnabled(clubId) && installed === true && !!avenueLabel;
  const syncColumnVisible = canSync || (isSuperAdmin && !!avenueLabel);
  const [syncTarget, setSyncTarget] = useState<ServiceProjectsProjectRow | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<ServiceProjectsProjectRow | null>(null);
  const [resetting, setResetting] = useState(false);

  const handleSyncConfirm = async () => {
    const target = syncTarget;
    setSyncTarget(null); // close dialog first — see AddToOrgConfirmDialog pointer-events note
    const effectiveYearId = data.selectedYearId ?? yearId ?? 0;
    if (!target || !effectiveYearId || !avenueLabel) return;
    try {
      const detail = await getProject(clubId, effectiveYearId, target.id);
      const payload = buildOrgExportFromDetail(detail, avenueLabel, SYNC_API_URL);
      setTimeout(() => triggerAddToOrg(target.id, payload, clubId), 0);
    } catch {
      setSyncError("Failed to load project details for Rotary.org sync.");
    }
  };

  // SuperAdmin clears the flag; the row goes back to "Sync" and the club can send it again. The
  // confirm box warns about the duplicate, because Rotary.org has no update - a second sync of a
  // project that WAS published creates a second initiative there.
  const handleResetConfirm = async () => {
    const target = resetTarget;
    if (!target) return;
    setResetting(true);
    try {
      await resetRotaryOrgSync(target.id, clubId);
      setResetTarget(null);
      await onRefresh();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setSyncError(e?.response?.data?.message || "Could not reset the sync status.");
    } finally { setResetting(false); }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const effectiveYearId = data.selectedYearId ?? yearId ?? 0;
    if (!effectiveYearId) {
      setDeleteError("Could not resolve the Rotary year for this record.");
      return;
    }
    setIsDeleting(true);
    try {
      await deleteProject(clubId, effectiveYearId, deleteTarget.id);
      setDeleteTarget(null);
      await onRefresh();
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setDeleteError(err?.response?.data?.message || "Failed to delete project.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Per user spec (2026-06-10): only Community Service + Public Image have a
  // meaningful one-time-vs-ongoing distinction. Vocational, International,
  // New Generation are meeting-style avenues — hide the filter chip + the
  // "Type" column for them. DB values stay intact (cleanup deferred).
  const showTypeFilter =
    data.avenueKey === "community_service" ||
    data.avenueKey === "public_image_initiative";

  // Ongoing list now contains parents + children (from backend). Split them
  // here so the table renders parents with an expand-toggle and groups
  // children underneath their parent. Matches V1 /clubs/[id]/projects layout.
  const ongoingParents = data.ongoingProjects.filter(
    (r) => !(r.parentProjectId != null && r.parentProjectId > 0),
  );
  const ongoingChildMap = new Map<number, ServiceProjectsProjectRow[]>();
  for (const r of data.ongoingProjects) {
    if (r.parentProjectId != null && r.parentProjectId > 0) {
      const arr = ongoingChildMap.get(r.parentProjectId) ?? [];
      arr.push(r);
      ongoingChildMap.set(r.parentProjectId, arr);
    }
  }

  // Source rows for the current sub-tab (PARENTS only — children expand inline).
  const rows = showTypeFilter
    ? (subTab === "one_time" ? data.oneTimeProjects : ongoingParents)
    : [...data.oneTimeProjects, ...ongoingParents];
  const filtered = useMemo<ServiceProjectsProjectRow[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Reset to page 1 when filter inputs or sub-tab change
  useEffect(() => { setPage(1); }, [search, subTab, data.selectedYearId, data.avenueKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const toggleExpand = (parentId: number) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  // Encode the avenue tab key in returnTo so V2 form Save/Back returns here.
  const returnTo = encodeURIComponent(
    `/club-admin-dashboard/service-projects-and-public-image?tab=${data.avenueKey}`,
  );
  const slug = SLUG_MAP[data.avenueKey] ?? "projects";
  const addUrl = `/clubs/${clubId}/${slug}/add?returnTo=${returnTo}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Projects"      value={fmtInt(k.projects ?? 0)}                  subtitle={data.avenueName}     icon={Briefcase}   color="blue" />
        <KpiCard title="Beneficiaries" value={fmtInt(k.beneficiaries ?? 0)}             subtitle="Lives impacted"      icon={Users}       color="green" />
        <KpiCard title="Amount Spent"  value={shortMoney(Number(k.amountSpent ?? 0), data.targetCurrency)}     subtitle="Project investment"  icon={moneyIcon(data.targetCurrency)} color="gold" />
        <KpiCard title="Man Hours"     value={fmtInt(k.manHours ?? 0)}                  subtitle="Volunteer time"      icon={Clock4}      color="purple" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{data.avenueName}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Project records · {data.selectedYearLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showTypeFilter && (
              <div
                className="inline-flex rounded-lg overflow-hidden text-xs p-1 gap-1"
                style={{ backgroundColor: "#17458f" }}
              >
                <button
                  onClick={() => setSubTab("one_time")}
                  className={`px-3 py-1 rounded-md font-semibold transition ${
                    subTab === "one_time" ? "shadow-sm" : "text-white hover:bg-white/10"
                  }`}
                  style={
                    subTab === "one_time"
                      ? { backgroundColor: "#F7A81B", color: "#17458f" }
                      : undefined
                  }
                >
                  One time Project
                </button>
                <button
                  onClick={() => setSubTab("ongoing")}
                  className={`px-3 py-1 rounded-md font-semibold transition ${
                    subTab === "ongoing" ? "shadow-sm" : "text-white hover:bg-white/10"
                  }`}
                  style={
                    subTab === "ongoing"
                      ? { backgroundColor: "#F7A81B", color: "#17458f" }
                      : undefined
                  }
                >
                  Ongoing/Repeat Projects
                </button>
              </div>
            )}
            {/* Local YearSelect removed — use global topbar year selector. */}
            <SearchBox value={search} onChange={setSearch} />
            <AgreeAddButton message={AGREE_MESSAGES[data.avenueKey] ?? ""} href={addUrl} label="Add Project" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left w-10">Sr</th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">Date</th>
                <th className="px-3 py-2.5 text-left">Title</th>
                {showTypeFilter && <th className="px-3 py-2.5 text-left">Type</th>}
                <th className="px-3 py-2.5 text-right">Cost</th>
                <th className="px-3 py-2.5 text-right">Direct Benf</th>
                <th className="px-3 py-2.5 text-right">Man Hours</th>
                <th className="px-3 py-2.5 text-right w-16">View</th>
                <th className="px-3 py-2.5 text-right w-16">Edit</th>
                <th className="px-3 py-2.5 text-right w-16">Delete</th>
                {syncColumnVisible && <th className="px-3 py-2.5 text-right w-16">Rotary.org</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.flatMap((r, i) => {
                const children = ongoingChildMap.get(r.id) ?? [];
                const isOngoingParent =
                  showTypeFilter &&
                  subTab === "ongoing" &&
                  (r.parentProjectId == null || r.parentProjectId === 0);
                const childCount = isOngoingParent ? children.length : 0;
                const isExpanded = expandedParents.has(r.id);

                const parentRow = (
                  <tr key={r.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-slate-500">{r.sr ?? (safePage - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {r.title || "–"}
                    </td>
                    {showTypeFilter && (
                      <td className="px-3 py-2">
                        {isOngoingParent ? (
                          <button
                            type="button"
                            onClick={() => childCount > 0 && toggleExpand(r.id)}
                            disabled={childCount === 0}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:hover:bg-emerald-100 disabled:opacity-80 disabled:cursor-default transition-colors"
                          >
                            Ongoing
                            {childCount > 0 && (
                              <>
                                <span className="bg-emerald-600 text-white rounded-full px-1.5 py-0 text-[10px] ml-0.5">{childCount}</span>
                                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </>
                            )}
                          </button>
                        ) : (
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${projectTypeChipStyle(r.type)}`}>
                            {r.type}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{r.cost > 0 ? shortMoney(Number(r.cost), r.currency) : "–"}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.directBeneficiaries > 0 ? fmtInt(r.directBeneficiaries) : "–"}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.manHours > 0 ? fmtInt(r.manHours) : "–"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setViewTarget(r)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                        aria-label="View project"
                        title="View details"
                      >
                        <Eye size={13} />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/clubs/${clubId}/${slug}/${r.id}/edit?returnTo=${returnTo}&yearId=${data.selectedYearId ?? yearId ?? ""}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                        >
                          <Edit3 size={13} />
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(r)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                        aria-label="Delete project"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                    {syncColumnVisible && (
                      <td className="px-3 py-2 text-right">
                        {r.syncedToOrg ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700"
                              title="Marked as added to Rotary International's Service Project Center"
                            >
                              <CheckCircle2 size={12} /> Synced
                            </span>
                            {/* SuperAdmin only: clear the flag so the club can sync again. A club
                                admin who finds a project marked Synced that never reached
                                Rotary.org calls support, and support resets it here. */}
                            {isSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => setResetTarget(r)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-amber-700 hover:bg-amber-50"
                                aria-label="Reset sync status"
                                title="Reset sync status (SuperAdmin)"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                          </span>
                        ) : canSync ? (
                          <button
                            type="button"
                            onClick={() => setSyncTarget(r)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-blue-700 hover:bg-blue-50"
                            aria-label="Sync to Rotary Org"
                            title="Sync to Rotary Org"
                          >
                            <Puzzle size={12} /> Sync
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">, </span>
                        )}
                      </td>
                    )}
                  </tr>
                );

                if (!isOngoingParent || !isExpanded || childCount === 0) return [parentRow];

                const childRows = children.map((c) => (
                  <tr key={`child-${c.id}`} className="bg-slate-50/60 hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-slate-400"></td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(c.date)}</td>
                    <td className="px-3 py-2 text-slate-700">
                      <span className="text-slate-400 mr-1">↳</span>{c.title || "–"}
                    </td>
                    {showTypeFilter && (
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                          Child
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{c.cost > 0 ? shortMoney(Number(c.cost), c.currency) : "–"}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{c.directBeneficiaries > 0 ? fmtInt(c.directBeneficiaries) : "–"}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{c.manHours > 0 ? fmtInt(c.manHours) : "–"}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/clubs/${clubId}/${slug}/${c.id}/edit?returnTo=${returnTo}&yearId=${data.selectedYearId ?? yearId ?? ""}`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                      >
                        <Edit3 size={13} />
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(c)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                        aria-label="Delete project"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                    {syncColumnVisible && (
                      <td className="px-3 py-2 text-right">
                        {c.syncedToOrg ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700"
                              title="Marked as added to Rotary International's Service Project Center"
                            >
                              <CheckCircle2 size={12} /> Synced
                            </span>
                            {/* SuperAdmin only: clear the flag so the club can sync again. A club
                                admin who finds a project marked Synced that never reached
                                Rotary.org calls support, and support resets it here. */}
                            {isSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => setResetTarget(c)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-amber-700 hover:bg-amber-50"
                                aria-label="Reset sync status"
                                title="Reset sync status (SuperAdmin)"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                          </span>
                        ) : canSync ? (
                          <button
                            type="button"
                            onClick={() => setSyncTarget(c)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-blue-700 hover:bg-blue-50"
                            aria-label="Sync to Rotary Org"
                            title="Sync to Rotary Org"
                          >
                            <Puzzle size={12} /> Sync
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">, </span>
                        )}
                      </td>
                    )}
                  </tr>
                ));
                return [parentRow, ...childRows];
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={syncColumnVisible ? 11 : 10} className="px-4 py-8 text-center text-slate-400">No projects in this section.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-3 py-1 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >Prev</button>
              <span className="text-slate-500">Page {safePage} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-3 py-1 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >Next</button>
            </div>
          </div>
        )}
      </div>

      <ProjectDetailModal
        clubId={clubId}
        yearId={Number(data.selectedYearId ?? yearId ?? 0)}
        projectId={viewTarget?.id ?? null}
        onClose={() => setViewTarget(null)}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Project"
        description={<>
          Are you sure you want to delete this project
          {deleteTarget?.title ? <>: <span className="font-semibold text-foreground">{deleteTarget.title}</span></> : null}?
          This action cannot be undone.
        </>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleConfirmDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />

      {deleteError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 shadow-lg">
          {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-2 font-semibold underline">Dismiss</button>
        </div>
      )}

      {isDeleting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-4 shadow-xl">
            <RotaryLoader size="sm" />
            <span className="text-sm font-semibold text-slate-700">Deleting…</span>
          </div>
        </div>
      )}

      {/* RI Flow-Bot: confirm before handing the project to the extension. */}
      {/* SuperAdmin reset confirm. Spelled out because a reset + re-sync puts a SECOND
          initiative on Rotary.org when the first one really was published - support has to
          check there before confirming. */}
      {resetTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-800">Reset the Rotary.org sync status?</h3>
                <p className="mt-1 text-sm text-slate-600 break-words">
                  <span className="font-medium">{resetTarget.title || "This project"}</span> is marked{" "}
                  <span className="font-medium text-emerald-700">Synced</span>. Resetting puts the{" "}
                  <span className="font-medium">Sync</span> button back so the club can send it to
                  Rotary.org again.
                </p>
                <p className="mt-2 text-sm font-medium text-rose-700">
                  Check on Rotary.org first. If the project is already published there, syncing again
                  creates a duplicate that the club has to delete on Rotary.org.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={resetting}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetConfirm}
                disabled={resetting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60"
              >
                {resetting ? "Resetting…" : "OK, reset"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddToOrgConfirmDialog
        open={!!syncTarget}
        onCancel={() => setSyncTarget(null)}
        onConfirm={handleSyncConfirm}
      />

      {syncError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 shadow-lg">
          {syncError}
          <button onClick={() => setSyncError(null)} className="ml-2 font-semibold underline">Dismiss</button>
        </div>
      )}
    </div>
  );
}

// ── Small shared bits ──────────────────────────────────────────────────

function YearSelect({
  data, yearId, onYearChange,
}: {
  data: ServiceProjectsAvenueDetailResponse;
  yearId: number | null;
  onYearChange: (id: number | null) => void;
}) {
  return (
    <select
      value={yearId ?? data.selectedYearId ?? ""}
      onChange={(e) => onYearChange(e.target.value ? Number(e.target.value) : null)}
      className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {data.availableYears.length === 0 && <option value="">No years</option>}
      {data.availableYears.map((y) => (
        <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " · current" : ""}</option>
      ))}
    </select>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div className="relative">
      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

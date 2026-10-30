"use client";

/**
 * District Admin Dashboard ▸ E-Governance & Reporting (Wave 13D rebuild)
 *
 * Design:
 *   - 2 top KPI tiles  : Monthly Reports (submitted on time count) /
 *                        Avg Citation Score (xx/1000)
 *   - sub-tabs       : CMR · District Citation · Reports
 *
 *   CMR sub-tab:
 *     • 4 KPI sub-tiles: Total Clubs · Submitted · On-Time % · Pending
 *     • District Summary by Month — 12 collapsible rows (July … June). Each row
 *       shows submitted/total + an on-time / late / pending coloured progress
 *       bar with chevron disclosure.
 *     • Per-Club Breakdown — search box + legend + per-club row of 12 status
 *       dots (Green=submitted, Red=late, Amber=pending, Grey=notStarted),
 *       summary text (X on-time / Y late / Z pending) and a total % bar.
 *       Click any club row → V2 drill page:
 *         /districts/[id]/egovernance/v2/[clubId]?returnTo=…
 *
 *   District Citation tab   — per-club citation total + category breakdown.
 *   Reports sub-tab         — downloadable district reports list.
 *
 * Backend contract (Wave 13A1, additive on top of the legacy
 * DistrictAdminEGovernanceResponse) is treated as optional here so this page
 * works against the current API today and lights up automatically once Wave
 * 13A1 ships. Missing data is rendered as "Pending" chips per the standard
 * District Admin convention.
 *
 * Constraints honoured:
 *   • Only this file is modified.
 *   • Multi-scope district via useDistrictAdminCache (which already passes
 *     selectedDistrictId from AuthContext to the backend).
 *   • 20 per page on the per-club grid.
 *   • Year-filter dropdowns are NOT introduced on this page — the cache uses
 *     the active RY by default.
 */

import {
  ChevronRight,
  ChevronDown,
  ClipboardList,
  Loader2,
  Search,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  Download,
  FileText,
  ChevronLeft,
} from "@/components/icons";
import { useMemo, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { fmtInt } from "@/components/dashboard/formatters";
import DistrictAwardsModule from "@/components/dashboard/DistrictAwardsModule";
import DistrictReportContent from "@/components/dashboard/DistrictReportContent";
import { DistrictRotaryNetworkView } from "@/app/district-admin-dashboard/rotary-network/view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeatureOn } from "@/components/FeatureGate";
import { getDistrictCmrEmailSettings, saveDistrictCmrEmailSettings } from "@/services/api";
import { Mail, Settings } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SkeletonRows } from "@/components/row/AppKit";

/* ------------------------------------------------------------------ types */
/* Wave 13A1 additive contract — treated as optional so the page degrades
   gracefully against the older legacy shape still on the server.            */

type CmrStatus = "submitted" | "late" | "pending" | "notStarted";

interface ApiKpiBlock {
  monthlyReports?: number;
  avgCitationScore?: number;
}

interface ApiCmrMonthlyRow {
  month: string;
  submitted: number;
  total: number;
  onTime: number;
  late: number;
  pending: number;
  notStarted: number;
}

interface ApiCmrPerClubRow {
  clubId: number;
  clubName: string;
  monthlyStatuses: CmrStatus[]; // length 12 (Jul … Jun)
}

interface ApiCmrTab {
  totalClubs?: number;
  submitted?: number;
  onTimePercent?: number;
  pending?: number;
  monthlyBreakdown?: ApiCmrMonthlyRow[];
  perClubGrid?: ApiCmrPerClubRow[];
}

interface ApiCitationCategoryBreakdown {
  category: string;
  points: number;
}

interface ApiCitationRow {
  clubId: number;
  clubName: string;
  totalPoints: number;
  categories?: ApiCitationCategoryBreakdown[];
}

interface ApiReportRow {
  id: string | number;
  title: string;
  description?: string;
  downloadUrl?: string;
  generatedAt?: string;
}

/* The cached object from the API may or may not carry these new fields. */
type EGovernancePayload = {
  district: {
    districtId: number;
    districtNumber: string;
    yearLabel: string;
    totalClubs: number;
  };
  // legacy fields (always present today)
  totalCmrSubmitted?: number;
  totalCmrPending?: number;
  avgAttendance?: number;
  totalMeetings?: number;
  clubsWithFullCmrCompliance?: number;
  clubsWithMissingCmr?: number;
  clubCompliance?: Array<{
    clubId: number;
    clubName: string;
    cmrsSubmitted: number;
    cmrsPending: number;
    avgAttendance: number;
    meetingsHeld: number;
  }>;
  // wave 13A1 additive (optional)
  kpis?: ApiKpiBlock;
  cmrTab?: ApiCmrTab;
  // Top-level per-month CMR breakdown from the API (label = full month name).
  cmrMonthBreakdown?: Array<{
    month: number;
    calendarMonth: number;
    label: string;
    submitted: number;
    onTime: number;
    late: number;
    pending: number;
    notStarted: number;
  }>;
  cmrTotalClubs?: number;
  // Top-level per-club grid from the API — months ordered Jul…Jun, status one of
  // submitted | pending | not_started | late.
  cmrPerClubGrid?: Array<{
    clubId: number;
    clubName: string;
    months: Array<{ month: number; status: string; submittedDate?: string | null }>;
  }>;
  districtCitation?: ApiCitationRow[];
  reports?: ApiReportRow[];
};

/* ----------------------------------------------------------------- helpers */
const STATUS_DOT_COLOR: Record<CmrStatus, string> = {
  submitted: "bg-emerald-500",
  late: "bg-red-500",
  pending: "bg-amber-400",
  notStarted: "bg-slate-300",
};

const STATUS_LABEL: Record<CmrStatus, string> = {
  submitted: "Submitted",
  late: "Late",
  pending: "Pending",
  notStarted: "Not Started",
};

const MONTH_ORDER = [
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
];

/** Tiny inline pending chip for empty data spots. */
function PendingChip({ label = "Pending" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
      <Clock size={10} /> {label}
    </span>
  );
}

/* ------------------------------------------------------------- main page */
export default function DistrictAdminEGovernancePage() {
  const { eGovernance, status, yearId } = useDistrictAdminCache();
  const searchParams = useSearchParams();
  // Tab can be deep-linked via ?tab=citation (also accepts club_points which
  // maps onto the citation sub-tab — used by the V2 club page's Back URL).
  const tabParam = searchParams.get("tab");
  // ROW module switches (components/FeatureGate): skipped or switched-off modules lose their tab
  const on = {
    cmr: useFeatureOn("club_monthly_report"),
  };
  const initialTab: "cmr" | "citation" | "network" | "reports" =
    tabParam === "citation" || tabParam === "club_points" ? "citation"
    : tabParam === "network" ? "network"
    : tabParam === "reports" ? "reports"
    : on.cmr ? "cmr" : "citation";
  const [activeTab, setActiveTab] = useState<
    "cmr" | "citation" | "network" | "reports"
  >(initialTab);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  if (status === "loading" && !eGovernance) {
    return (
      <SkeletonRows />
    );
  }
  if (status === "error" && !eGovernance) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load e-governance.
      </div>
    );
  }
  if (!eGovernance) return null;

  const data = eGovernance as unknown as EGovernancePayload;
  const districtId = data.district.districtId;

  return (
    <div className="space-y-6">
      {/* ─── Sub-tabs ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200">
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as typeof activeTab);
          }}
        >
          <div className="px-5 pt-3">
            <TabsList
              className="h-auto w-full justify-start sm:w-auto p-1.5 gap-1"
              style={{ backgroundColor: "#17458f" }}
            >
              {on.cmr && <TabsTrigger value="cmr" className="text-sm font-semibold px-3.5 py-1.5 rounded-full">Club Monthly Report</TabsTrigger>}
              <TabsTrigger value="citation" className="text-sm font-semibold px-3.5 py-1.5 rounded-full">District Awards</TabsTrigger>
              <TabsTrigger value="network" className="text-sm font-semibold px-3.5 py-1.5 rounded-full">Rotary Network</TabsTrigger>
              <TabsTrigger value="reports" className="text-sm font-semibold px-3.5 py-1.5 rounded-full">Reports</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="cmr" className="p-5 pt-4">
            <CmrTab data={data} districtId={districtId} />
          </TabsContent>
          <TabsContent value="citation" className="p-5 pt-4">
            <DistrictAwardsModule districtId={districtId} />
          </TabsContent>
          <TabsContent value="network" className="p-5 pt-4">
            <DistrictRotaryNetworkView embedded />
          </TabsContent>
          <TabsContent value="reports" className="p-5 pt-4">
            <ReportsTab rows={data.reports} districtId={districtId} yearId={yearId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ================================================================== CMR */
function CmrTab({
  data,
  districtId,
}: {
  data: EGovernancePayload;
  districtId: number;
}) {
  /* Derive 4 KPI sub-tile values — prefer wave-13A1 fields, fall back to
     the legacy clubCompliance summary when missing. */
  const totalClubs =
    data.cmrTab?.totalClubs ??
    data.district.totalClubs ??
    data.clubCompliance?.length ??
    0;
  const submitted = data.cmrTab?.submitted ?? data.totalCmrSubmitted ?? 0;
  const pending = data.cmrTab?.pending ?? data.totalCmrPending ?? 0;
  const onTimePercent =
    data.cmrTab?.onTimePercent ??
    (submitted + pending > 0
      ? Math.round((submitted / (submitted + pending)) * 100)
      : 0);

  /* Try to derive a 12-month breakdown from the new API. Otherwise we hide
     the section behind a Pending chip. */
  const monthlyBreakdown: ApiCmrMonthlyRow[] = useMemo(() => {
    const grid = data.cmrTab?.perClubGrid ?? [];
    const apiMonths = data.cmrMonthBreakdown ?? [];
    let full: ApiCmrMonthlyRow[];
    if (apiMonths.length) {
      // Preferred source — the API's per-month breakdown (label = full month name).
      const byLabel = new Map(apiMonths.map((m) => [m.label, m] as const));
      full = MONTH_ORDER.map((name) => {
        const m = byLabel.get(name);
        return m
          ? { month: name, submitted: m.submitted, total: data.cmrTotalClubs ?? totalClubs, onTime: m.onTime, late: m.late, pending: m.pending, notStarted: m.notStarted }
          : { month: name, submitted: 0, total: totalClubs, onTime: 0, late: 0, pending: totalClubs, notStarted: 0 };
      });
    } else if (data.cmrTab?.monthlyBreakdown?.length) {
      // Re-order to Jul…Jun for consistency.
      const byMonth = new Map(
        data.cmrTab.monthlyBreakdown.map((m) => [m.month, m] as const),
      );
      full = MONTH_ORDER.map(
        (m) =>
          byMonth.get(m) ?? {
            month: m,
            submitted: 0,
            total: totalClubs,
            onTime: 0,
            late: 0,
            pending: totalClubs,
            notStarted: 0,
          },
      );
    } else if (grid.length) {
      // Derive the by-month summary from the per-club monthly statuses (the same
      // source the Per-Club Breakdown uses) when the backend omits monthlyBreakdown.
      full = MONTH_ORDER.map((name, i) => {
        let onTime = 0, late = 0, pending = 0, notStarted = 0;
        for (const club of grid) {
          const s = club.monthlyStatuses?.[i];
          if (s === "submitted") onTime++;
          else if (s === "late") late++;
          else if (s === "pending") pending++;
          else notStarted++;
        }
        return { month: name, submitted: onTime + late, total: grid.length, onTime, late, pending, notStarted };
      });
    } else {
      return [];
    }
    // Month visibility by rotary year (July=index 0 … June=index 11):
    //   • Past (completed) year  → all 12 months
    //   • Current (ongoing) year → up to the current month only
    //   • Future (not started)   → no months (the year hasn't begun yet)
    const ym = /(\d{4})/.exec(data.district?.yearLabel || "");
    const startYear = ym ? Number(ym[1]) : null;
    let cap = 12;
    if (startYear != null) {
      const endYear = startYear + 1;
      const now = new Date();
      const y = now.getFullYear();
      const mo = now.getMonth() + 1; // 1-12
      // Rotary year runs 1 Jul (startYear) … 30 Jun (endYear).
      const notStartedYet = y < startYear || (y === startYear && mo < 7);
      const withinYear =
        (y > startYear || (y === startYear && mo >= 7)) &&
        (y < endYear || (y === endYear && mo <= 6));
      if (notStartedYet) cap = 0;                              // future year → show nothing
      else if (withinYear) cap = (mo >= 7 ? mo - 7 : mo + 5) + 1; // current year → up to current month
      // else: completed past year → all 12
    }
    return full.slice(0, cap);
  }, [data.cmrMonthBreakdown, data.cmrTotalClubs, data.cmrTab?.monthlyBreakdown, data.cmrTab?.perClubGrid, totalClubs, data.district?.yearLabel]);

  return (
    <div className="space-y-6">
      {/* ── District Summary by Month (its header carries the CMR submission-email settings gear) ── */}
      <MonthlySummary rows={monthlyBreakdown} totalClubs={totalClubs} districtId={districtId} />
    </div>
  );
}

/* ----------------------------------- CMR submission-email settings (district) */
// A small gear icon (rendered in the "District Summary — By Month" header) opens
// this popup where the district admin controls, per district + year, what happens
// when ANY club in the district uploads its Club Monthly Report to the district:
//   • Yes/No — email the District Governor (default Yes).
//   • Extra CC emails (comma-separated) — always copied on the submission email.
function CmrEmailSettingsButton({ districtId }: { districtId: number }) {
  const searchParams = useSearchParams();
  const yearId = Number(searchParams.get("yearId") || 0);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [sendToDG, setSendToDG] = useState(true);
  const [ccEmails, setCcEmails] = useState("");

  // Load current settings each time the popup is opened.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSavedMsg(null);
    if (!districtId || !yearId) { setLoading(false); return; }
    setLoading(true);
    getDistrictCmrEmailSettings(districtId, yearId)
      .then((s) => {
        if (!alive) return;
        setSendToDG(s.sendToDistrictGovernor);
        setCcEmails(s.ccEmails || "");
      })
      .catch(() => { /* defaults (Yes / empty) stand */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, districtId, yearId]);

  const save = async () => {
    if (!districtId || !yearId) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await saveDistrictCmrEmailSettings(districtId, yearId, {
        sendToDistrictGovernor: sendToDG,
        ccEmails: ccEmails.trim(),
      });
      setSavedMsg("Saved");
      setTimeout(() => { setSavedMsg(null); setOpen(false); }, 1000);
    } catch {
      setSavedMsg("Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Club Monthly Report: Submission Email settings"
          aria-label="Submission email settings"
          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <Settings className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-slate-500" />
            Club Monthly Report: Submission Email
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Applies to every club in this district for the selected year, when a club uploads its CMR to the district.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Send email to District Governor?
                </label>
                <div className="flex items-center gap-5">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="cmr-dg-email"
                      checked={sendToDG}
                      onChange={() => setSendToDG(true)}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="cmr-dg-email"
                      checked={!sendToDG}
                      onChange={() => setSendToDG(false)}
                      className="h-4 w-4 accent-rose-600"
                    />
                    No
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {sendToDG
                    ? "The District Governor is included on the submission email."
                    : "The District Governor is NOT emailed. Club President, Secretary and Assistant Governor still receive it."}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Extra CC emails (comma-separated)
                </label>
                <input
                  type="text"
                  value={ccEmails}
                  onChange={(e) => setCcEmails(e.target.value)}
                  placeholder="e.g. secretary@example.org, chair@example.org"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  These addresses are always copied on the submission email (whether or not the District Governor is emailed).
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full bg-[#17458F] text-white hover:bg-[#17458F] disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
                {savedMsg && (
                  <span className={`text-xs ${savedMsg === "Saved" ? "text-emerald-600" : "text-rose-600"}`}>
                    {savedMsg}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------- monthly summary list */
function MonthlySummary({
  rows,
  totalClubs,
  districtId,
}: {
  rows: ApiCmrMonthlyRow[];
  totalClubs: number;
  districtId: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const cmrEmailOn = useFeatureOn("cmr_email_settings");
  // Month name → calendar month number (Jul=7 … Jun=6).
  const MONTH_TO_NUM: Record<string, number> = {
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  };
  const openMonth = (monthName: string) => {
    const num = MONTH_TO_NUM[monthName];
    if (!yearId || !num) return;
    const ret = encodeURIComponent(`/district-admin-dashboard/egovernance?tab=cmr&yearId=${yearId}`);
    router.push(`/districts/${districtId}/club-monthly-report/${yearId}/${num}?returnTo=${ret}`);
  };

  return (
    <div className="bg-white rounded-[20px] border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            {cmrEmailOn && <CmrEmailSettingsButton districtId={districtId} />}
            <h4 className="text-sm font-semibold text-slate-800">
              District Summary: By Month
            </h4>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            How many clubs submitted each month · click a month for club-wise detail
          </p>
        </div>
        {rows.length === 0 && <PendingChip label="Awaiting Wave 13A1 data" />}
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-6 text-xs text-slate-500">
          Monthly breakdown not yet available for this district.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((m) => {
            const totalForMonth = m.total || totalClubs || 0;
            const submittedPct =
              totalForMonth > 0 ? (m.submitted / totalForMonth) * 100 : 0;
            // Single-colour submission bar, coloured by how many clubs submitted:
            // full = green, partial = amber, low = rose (matches the design).
            const tone =
              submittedPct >= 100 ? "emerald" : submittedPct >= 40 ? "amber" : "rose";
            const barColor =
              tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
            const textColor =
              tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-rose-600";
            return (
              <li key={m.month}>
                <button
                  type="button"
                  onClick={() => openMonth(m.month)}
                  title={`View ${m.month} club-wise detail`}
                  className="group w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer hover:bg-blue-50/70 border-l-2 border-transparent hover:border-blue-500 transition"
                >
                  <FileText size={16} className="text-blue-500 shrink-0" />
                  <span className="text-sm font-semibold text-blue-700 flex-1 min-w-0 truncate group-hover:underline">
                    {m.month}
                  </span>

                  <span className={`text-xs font-medium tabular-nums whitespace-nowrap ${textColor}`}>
                    {fmtInt(m.submitted)}/{fmtInt(totalForMonth)} submitted
                  </span>

                  {/* submission-ratio bar (single colour) */}
                  <span className="w-40 h-2 rounded-full bg-slate-100 overflow-hidden shrink-0">
                    <span
                      className={`block h-full ${barColor}`}
                      style={{ width: `${submittedPct}%` }}
                    />
                  </span>

                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 px-2 py-1 rounded-full border border-blue-200 bg-blue-50 group-hover:bg-blue-100 shrink-0">
                    View <ChevronRight size={14} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "emerald" | "red" | "amber" | "slate";
}) {
  const map: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    red: "bg-red-50 text-red-700 ring-red-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
  };
  return (
    <div
      className={`rounded-lg ${map[color]} ring-1 px-3 py-2 flex items-center justify-between`}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm font-bold tabular-nums">{fmtInt(value)}</span>
    </div>
  );
}

/* ------------------------------------------------------- per-club CMR grid */
function PerClubGrid({
  rows,
  legacyFallback,
  districtId,
}: {
  rows: ApiCmrPerClubRow[];
  legacyFallback: Array<{
    clubId: number;
    clubName: string;
    cmrsSubmitted: number;
    cmrsPending: number;
  }>;
  districtId: number;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  /* If Wave 13A1 perClubGrid is present we use it as the source of truth.
     Otherwise we synthesise rows from the legacy `clubCompliance` payload
     (no per-month statuses available, so dots are dimmed). */
  const isLegacyMode = rows.length === 0 && legacyFallback.length > 0;
  const effectiveRows: ApiCmrPerClubRow[] = useMemo(() => {
    if (rows.length > 0) return rows;
    return legacyFallback.map((c) => ({
      clubId: c.clubId,
      clubName: c.clubName,
      monthlyStatuses: Array(12).fill("notStarted") as CmrStatus[],
    }));
  }, [rows, legacyFallback]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return effectiveRows;
    return effectiveRows.filter((c) => c.clubName.toLowerCase().includes(q));
  }, [effectiveRows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (pageSafe - 1) * PAGE_SIZE,
    pageSafe * PAGE_SIZE,
  );

  return (
    <div className="bg-white rounded-[20px] border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">
              Per-Club Breakdown
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Month-by-month submission status per club
            </p>
          </div>
          {isLegacyMode && <PendingChip label="Per-month statuses pending" />}
        </div>

        {/* search + legend */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search club…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              className="w-full h-9 pl-9 pr-3 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400"
            />
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-600">
            {(["submitted", "late", "pending", "notStarted"] as CmrStatus[]).map(
              (s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT_COLOR[s]}`}
                  />
                  {STATUS_LABEL[s]}
                </span>
              ),
            )}
          </div>
        </div>
      </div>

      {pageRows.length === 0 ? (
        <div className="px-5 py-8 text-xs text-slate-500 text-center">
          {effectiveRows.length === 0
            ? "No clubs available."
            : "No clubs match your search."}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {pageRows.map((c) => {
            const onTime = c.monthlyStatuses.filter(
              (s) => s === "submitted",
            ).length;
            const late = c.monthlyStatuses.filter((s) => s === "late").length;
            const pending = c.monthlyStatuses.filter(
              (s) => s === "pending",
            ).length;
            const notStarted = c.monthlyStatuses.filter(
              (s) => s === "notStarted",
            ).length;
            const completedPct = Math.round(((onTime + late) / 12) * 100);
            const barTone =
              completedPct >= 85 ? "bg-emerald-500" : completedPct >= 50 ? "bg-amber-500" : "bg-rose-500";

            const RowInner = (
              <div className="flex items-center gap-3 px-5 py-3">
                <span className="text-sm font-medium text-slate-800 flex-1 min-w-0 truncate">
                  {c.clubName}
                </span>
                {/* 12-month status dot array */}
                <span className="flex items-center gap-1 shrink-0">
                  {c.monthlyStatuses.slice(0, 12).map((s, i) => (
                    <span
                      key={i}
                      title={`${MONTH_ORDER[i]}: ${STATUS_LABEL[s]}`}
                      className={`h-3 w-3 rounded-sm ${STATUS_DOT_COLOR[s]}`}
                    />
                  ))}
                </span>
                {/* on-time / late / pending — only non-zero categories shown */}
                <span className="flex items-center gap-3 text-[11px] tabular-nums whitespace-nowrap shrink-0">
                  <span className="text-emerald-600 font-medium">{onTime} on-time</span>
                  {late > 0 && <span className="text-rose-600 font-medium">{late} late</span>}
                  {pending + notStarted > 0 && (
                    <span className="text-amber-600 font-medium">{pending + notStarted} pending</span>
                  )}
                </span>
                <span className="w-28 h-2 rounded-full bg-slate-100 overflow-hidden shrink-0">
                  <span
                    className={`block h-full ${barTone}`}
                    style={{ width: `${completedPct}%` }}
                  />
                </span>
                <span className="text-xs font-semibold tabular-nums text-slate-700 w-10 text-right shrink-0">
                  {completedPct}%
                </span>
              </div>
            );

            return (
              <li key={c.clubId}>{RowInner}</li>
            );
          })}
        </ul>
      )}

      {/* pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>
            Page {pageSafe} of {totalPages} · {fmtInt(filtered.length)} clubs
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageSafe <= 1}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft size={12} /> Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageSafe >= totalPages}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              Next <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================== Reports */
function ReportsTab({ rows, districtId, yearId }: { rows: ApiReportRow[] | undefined; districtId: number; yearId?: number | null }) {
  return (
    <div className="bg-white rounded-[20px] border border-slate-200 overflow-hidden">
      <ul className="divide-y divide-slate-100">
        {(rows ?? []).map((r) => (
          <li
            key={r.id}
            className="px-5 py-3 flex items-center gap-3 hover:bg-blue-50/40"
          >
            <FileText size={16} className="text-blue-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 truncate">
                {r.title}
              </p>
              {(r.description || r.generatedAt) && (
                <p className="text-[11px] text-slate-500 truncate">
                  {r.description}
                  {r.description && r.generatedAt ? " · " : ""}
                  {r.generatedAt && (
                    <>
                      <Calendar size={10} className="inline mr-0.5" />
                      {r.generatedAt}
                    </>
                  )}
                </p>
              )}
            </div>
            {r.downloadUrl ? (
              <a
                href={r.downloadUrl}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                <Download size={12} /> Download
              </a>
            ) : (
              <PendingChip label="Unavailable" />
            )}
          </li>
        ))}
      </ul>

      {/* Full Reports tab — Members / Clubs / District subsections with
          dropdowns + everything else
          per the District Admin reports spec. servicesOnly was the legacy
          mode that only showed the 5 service avenue rows; removing it
          lights up the entire new subsection structure. */}
      <div className="px-5 py-4">
        <DistrictReportContent districtId={districtId} showCommunicationLogs />
      </div>
    </div>
  );
}

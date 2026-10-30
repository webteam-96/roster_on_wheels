"use client";

/**
 * District Admin ▸ E-Governance ▸ Per-Club Drill (V2 — Wave 13D)
 *
 * Route:  /districts/[id]/egovernance/v2/[clubId]?returnTo=...
 *
 * Read-only drill page that the District Admin lands on when they click a club
 * row from the per-club CMR grid on /district-admin-dashboard/egovernance.
 *
 * What it shows for THIS CLUB in the active RY:
 *   1. Header — club name, RY label, back arrow (uses ?returnTo when present)
 *   2. 4 KPI tiles — Total Submitted (months) · On Time · Late · Pending/Not Started
 *   3. Per-Month detail — 12 collapsible rows (July … June). Each row:
 *        • month name, status chip (Submitted/Late/Pending/Not Started)
 *        • expandable detail: submitted date, who, member count, TRF entries
 *          count, etc. (everything getMonthlyReport returns)
 *        • "View CMR" link → existing club CMR detail in /v2 so DA can deep-
 *          dive month-by-month. Existing page is form-shaped (edit-capable);
 *          we hand it `?returnTo=` so the DA can come back here.
 *   4. Citation Status panel — this club's citation total + per-category split.
 *
 * Data sources (no new endpoints required):
 *   • getClub(clubId)                         — club name
 *   • getMonthlyReportYears(clubId)           — RY list (data-only)
 *   • getMonthlyReportMonths(clubId, yearId)  — 12 months w/ isCreated, isUploadedToDistrict, modifiedDate
 *   • getMonthlyReport(clubId, yearId, month) — lazy-loaded on row expand
 *   • getClubCitation(clubId, districtId)     — citation summary
 *
 * Status classification (status of a single month):
 *   • Submitted  — isUploadedToDistrict = true AND uploaded on/before month-end + 30 days
 *   • Late       — isUploadedToDistrict = true AND uploaded after that window
 *   • Pending    — isCreated = true but not yet uploaded
 *   • Not Started— neither created nor uploaded
 *
 * No Wave 13A1 backend aggregated endpoint is assumed; if one ships later
 * (e.g. getDistrictAdminClubEGovDetail), it can replace the local
 * classification logic here without changing the layout.
 *
 * Constraints honoured:
 *   • READ-ONLY — no save/submit buttons. The single outbound action is the
 *     existing club CMR detail link (which is edit-capable for users whose
 *     role permits it; the DA's role enforcement is API-side, not here).
 *   • DistrictAdminShell wrapper with activeNavHref pinned to the e-governance
 *     sidebar item, so the DA's sidebar highlight stays correct.
 *   • Year-data-only filter — uses the year that came from the DA dashboard
 *     (passed via ?yearId=) OR falls back to the current/most-recent year
 *     that getMonthlyReportYears returns (NEVER pads with rotary_year_master).
 *   • selectedDistrictId synced from URL params.id via local effect (mirrors
 *     useSyncClubIdFromUrl pattern; no shared hook exists for districts yet).
 *   • V1 untouched.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Award,
  Users,
  FileText,
  IndianRupee,
  Loader2,
  ExternalLink,
} from "@/components/icons";
import {
  getClub,
  getMonthlyReportYears,
  getMonthlyReportMonths,
  getMonthlyReport,
  getClubCitation,
} from "@/services/api";
import type {
  MonthlyReportListItem,
  MonthlyReportDetail,
  ReportYear,
} from "@/types/clubMonthlyReport";
import { useAuth } from "@/contexts/AuthContext";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate, fmtInr } from "@/components/dashboard/formatters";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import LoadingLink from "@/components/v2/LoadingLink";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ListPageSkeleton } from "@/components/row/AppKit";

/* ------------------------------------------------------------------ types */

type CmrStatus = "submitted" | "late" | "pending" | "notStarted";

const STATUS_LABEL: Record<CmrStatus, string> = {
  submitted: "Submitted",
  late: "Late",
  pending: "Pending",
  notStarted: "Not Started",
};

const STATUS_CHIP: Record<CmrStatus, string> = {
  submitted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  late: "bg-red-50 text-red-700 border-red-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  notStarted: "bg-slate-50 text-slate-600 border-slate-200",
};

const STATUS_DOT: Record<CmrStatus, string> = {
  submitted: "bg-emerald-500",
  late: "bg-red-500",
  pending: "bg-amber-400",
  notStarted: "bg-slate-300",
};

function StatusIcon({ s }: { s: CmrStatus }) {
  if (s === "submitted") return <CheckCircle2 size={12} />;
  if (s === "late") return <AlertCircle size={12} />;
  if (s === "pending") return <Clock size={12} />;
  return <AlertCircle size={12} />;
}

/**
 * Indian RY runs July → June. Map a month number (1–12) to the calendar year
 * portion of the RY so we can compute the "month-end" date for late detection.
 *   yearLabel like "2025-26" → July…December belong to 2025, January…June to 2026.
 */
function monthEndDate(monthNum: number, yearLabel: string): Date | null {
  const m = Number(monthNum);
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  const parts = yearLabel.split(/[\-/]/).map((p) => Number(p.trim()));
  if (parts.length < 2 || !Number.isFinite(parts[0])) return null;
  const startYear = parts[0];
  // Two-digit second part ("25-26"): roll forward into next century-aware year.
  const endYear = parts[1] < 100 ? 2000 + parts[1] : parts[1];
  const cy = m >= 7 ? startYear : endYear;
  // last day of the month
  return new Date(cy, m, 0);
}

/** Classify a month row's submission state. */
function classify(
  item: MonthlyReportListItem,
  yearLabel: string,
  graceDays = 30,
): CmrStatus {
  if (item.isUploadedToDistrict) {
    const me = monthEndDate(item.month, yearLabel);
    const uploaded = item.modifiedDate
      ? new Date(item.modifiedDate)
      : item.createdDate
        ? new Date(item.createdDate)
        : null;
    if (me && uploaded) {
      const deadline = new Date(me.getTime());
      deadline.setDate(deadline.getDate() + graceDays);
      return uploaded > deadline ? "late" : "submitted";
    }
    // If we can't compute, optimistically count as submitted.
    return "submitted";
  }
  if (item.isCreated) return "pending";
  return "notStarted";
}

/* ============================================================== component */

function DistrictAdminEGovClubDetailInner() {
  const params = useParams();
  const search = useSearchParams();
  const { selectedDistrictId, selectScope } = useAuth();

  const districtId = Number(params?.id);
  const clubId = Number(params?.clubId);
  const incomingReturnTo = search.get("returnTo") || "";
  const yearIdQS = search.get("yearId");

  // Default back href when no returnTo was sent.
  const backHref =
    incomingReturnTo || "/district-admin-dashboard/egovernance";

  // Sync URL districtId → AuthContext.selectedDistrictId (mirror of
  // useSyncClubIdFromUrl). No shared hook exists for districts yet; this
  // local effect serves the same purpose for this V2 page.
  useEffect(() => {
    if (
      Number.isFinite(districtId) &&
      districtId > 0 &&
      districtId !== selectedDistrictId
    ) {
      selectScope({ districtId });
    }
  }, [districtId, selectedDistrictId, selectScope]);

  /* -------------------------------------------------------- local state */
  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [months, setMonths] = useState<MonthlyReportListItem[]>([]);
  const [citation, setCitation] = useState<CitationLike | null>(null);
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [loadingCitation, setLoadingCitation] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Per-row expand/lazy-load state
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [detailCache, setDetailCache] = useState<
    Record<number, MonthlyReportDetail | "loading" | "error" | "empty">
  >({});

  /* ----------------------------------------------------- top-level load */
  useEffect(() => {
    if (!Number.isFinite(clubId) || clubId <= 0) return;
    let cancelled = false;
    (async () => {
      setLoadingTop(true);
      setErrorMsg(null);
      try {
        const [club, yrs] = await Promise.all([
          getClub(clubId),
          getMonthlyReportYears(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setYears(yrs);
        // Year choice priority: ?yearId qs → current → most recent in list.
        const qsId = yearIdQS ? Number(yearIdQS) : NaN;
        const fromQs = Number.isFinite(qsId)
          ? yrs.find((y) => y.id === qsId)
          : undefined;
        const fallback = yrs.find((y) => y.isCurrent) ?? yrs[0] ?? null;
        const picked = fromQs ?? fallback;
        setSelectedYearId(picked ? picked.id : null);
      } catch (err: unknown) {
        if (cancelled) return;
        setErrorMsg(extractMessage(err, "Failed to load club details."));
      } finally {
        if (!cancelled) setLoadingTop(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, yearIdQS]);

  /* -------------------------------------- months load (on year change) */
  useEffect(() => {
    if (!Number.isFinite(clubId) || clubId <= 0) return;
    if (selectedYearId == null) return;
    let cancelled = false;
    (async () => {
      setLoadingMonths(true);
      setExpanded({});
      setDetailCache({});
      try {
        const data = await getMonthlyReportMonths(clubId, selectedYearId);
        if (!cancelled) setMonths(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setMonths([]);
          setErrorMsg(extractMessage(err, "Failed to load monthly reports."));
        }
      } finally {
        if (!cancelled) setLoadingMonths(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, selectedYearId]);

  /* ------------------------------------------------------ citation load */
  useEffect(() => {
    if (!Number.isFinite(clubId) || clubId <= 0) return;
    if (!Number.isFinite(districtId) || districtId <= 0) return;
    let cancelled = false;
    (async () => {
      setLoadingCitation(true);
      try {
        const data = await getClubCitation(clubId, districtId);
        if (!cancelled) setCitation(coerceCitation(data));
      } catch {
        // Citation is optional / best-effort — do NOT surface as a hard error.
        if (!cancelled) setCitation(null);
      } finally {
        if (!cancelled) setLoadingCitation(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, districtId]);

  /* -------------------------------------------- KPI tile + status calc */
  const selectedYear = years.find((y) => y.id === selectedYearId);
  const yearLabel = selectedYear?.yearLabel ?? "";

  const statuses = useMemo<CmrStatus[]>(() => {
    if (!yearLabel) return [];
    return months.map((m) => classify(m, yearLabel));
  }, [months, yearLabel]);

  const kpiCounts = useMemo(() => {
    const c = { submitted: 0, late: 0, pending: 0, notStarted: 0 };
    statuses.forEach((s) => {
      c[s] += 1;
    });
    const totalSubmitted = c.submitted + c.late; // months they actually sent in
    return {
      totalSubmitted,
      onTime: c.submitted,
      late: c.late,
      pending: c.pending + c.notStarted,
      pendingOnly: c.pending,
      notStarted: c.notStarted,
    };
  }, [statuses]);

  /* ---------------------------------------------- row expand + lazy GET */
  const handleToggle = async (item: MonthlyReportListItem) => {
    if (!selectedYearId) return;
    const isOpen = !!expanded[item.month];
    setExpanded((s) => ({ ...s, [item.month]: !isOpen }));

    // Only lazy-load if it's a real (created) month and not yet cached.
    if (isOpen) return;
    if (!item.isCreated) {
      setDetailCache((s) => ({ ...s, [item.month]: "empty" }));
      return;
    }
    if (detailCache[item.month] && detailCache[item.month] !== "error") return;

    setDetailCache((s) => ({ ...s, [item.month]: "loading" }));
    try {
      const detail = await getMonthlyReport(
        clubId,
        selectedYearId,
        item.month,
      );
      setDetailCache((s) => ({
        ...s,
        [item.month]: detail ?? "empty",
      }));
    } catch {
      setDetailCache((s) => ({ ...s, [item.month]: "error" }));
    }
  };

  /* --------------------------------------------------- outbound deep link */
  const cmrDetailHref = (month: number) => {
    if (!selectedYearId) return "#";
    const self = `/districts/${districtId}/egovernance/v2/${clubId}${incomingReturnTo ? `?returnTo=${encodeURIComponent(incomingReturnTo)}` : ""}`;
    return `/clubs/${clubId}/club-monthly-report/v2/${selectedYearId}/${month}?returnTo=${encodeURIComponent(self)}`;
  };

  /* ---------------------------------------------------------- shell wrap */
  const pageTitle = clubName
    ? `${clubName}: E-Governance Detail`
    : "E-Governance Detail";
  const pageSubtitle = selectedYear
    ? `RY ${selectedYear.yearLabel}`
    : undefined;

  /* ------------------------------------------------------------- render */
  return (
    <DistrictAdminShell
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      activeNavHref="/district-admin-dashboard/egovernance"
    >
      <div className="space-y-5">
        {/* Header strip */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2">
            <LoadingLink
              href={backHref}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </LoadingLink>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">
                {clubName || "Club"}: E-Governance Detail
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Per-month CMR submission and citation overview
                {selectedYear ? ` · RY ${selectedYear.yearLabel}` : ""}
              </p>
            </div>
          </div>

          {/* Year picker — data only */}
          {!loadingTop && years.length > 0 && (
            <select
              value={selectedYearId ?? ""}
              onChange={(e) =>
                setSelectedYearId(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              className="px-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.yearLabel}
                  {y.isCurrent ? " · current" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Loading / error guards */}
        {loadingTop ? (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        ) : (
          <>
            {/* 4 KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Total Submitted"
                value={fmtInt(kpiCounts.totalSubmitted)}
                subtitle={`of ${months.length || 12} months`}
                icon={ClipboardList}
                color="blue"
              />
              <KpiCard
                title="On Time"
                value={fmtInt(kpiCounts.onTime)}
                subtitle="Within deadline"
                icon={CheckCircle2}
                color="green"
              />
              <KpiCard
                title="Late"
                value={fmtInt(kpiCounts.late)}
                subtitle="Submitted late"
                icon={Clock}
                color="gold"
              />
              <KpiCard
                title="Pending / Not Started"
                value={fmtInt(kpiCounts.pending)}
                subtitle={`${kpiCounts.pendingOnly} pending · ${kpiCounts.notStarted} not started`}
                icon={AlertCircle}
                color="red"
              />
            </div>

            {/* Per-Month detail */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Per-Month Detail
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Tap any month to expand its submission detail · 12 months
                    (Jul–Jun)
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  {(
                    [
                      "submitted",
                      "late",
                      "pending",
                      "notStarted",
                    ] as CmrStatus[]
                  ).map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`}
                      />
                      {STATUS_LABEL[s]}
                    </span>
                  ))}
                </div>
              </div>

              {loadingMonths ? (
                <div className="flex items-center justify-center py-12">
                  <ListPageSkeleton />
                </div>
              ) : months.length === 0 ? (
                <div className="px-5 py-12 text-center text-slate-500">
                  <Calendar
                    size={28}
                    className="mx-auto mb-3 text-slate-300"
                  />
                  <p className="text-sm font-medium text-slate-700">
                    No months available
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {years.length === 0
                      ? "No rotary years have been configured yet."
                      : "No report months found for the selected year."}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {months.map((m, i) => {
                    const status = statuses[i] ?? "notStarted";
                    const open = !!expanded[m.month];
                    const cached = detailCache[m.month];
                    return (
                      <li key={m.month}>
                        <button
                          type="button"
                          onClick={() => handleToggle(m)}
                          className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-blue-50/40 transition"
                        >
                          {open ? (
                            <ChevronDown
                              size={14}
                              className="text-slate-400 shrink-0"
                            />
                          ) : (
                            <ChevronRight
                              size={14}
                              className="text-slate-400 shrink-0"
                            />
                          )}
                          <span className="text-sm font-medium text-slate-800 w-32 shrink-0 flex items-center gap-2">
                            <Calendar
                              size={13}
                              className="text-slate-400"
                            />
                            {m.monthName}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_CHIP[status]}`}
                          >
                            <StatusIcon s={status} /> {STATUS_LABEL[status]}
                          </span>
                          <span className="flex-1 text-[11px] text-slate-500 tabular-nums truncate">
                            {m.modifiedDate || m.createdDate
                              ? `Last activity: ${fmtDate(m.modifiedDate ?? m.createdDate)}`
                              : "No activity recorded"}
                          </span>
                          <span
                            className="text-[11px] text-blue-700 font-semibold hover:underline shrink-0 inline-flex items-center gap-1"
                            onClick={(e) => {
                              // Prevent the row-toggle when the user clicks
                              // the View CMR pseudo-link; we let the actual
                              // <a> below handle navigation.
                              e.stopPropagation();
                            }}
                          >
                            {/* visual cue — actual link lives in expanded panel */}
                          </span>
                        </button>

                        {open && (
                          <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                            <ExpandedDetail
                              item={m}
                              cached={cached}
                              cmrHref={cmrDetailHref(m.month)}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Citation Status panel */}
            <CitationPanel
              loading={loadingCitation}
              citation={citation}
              yearLabel={yearLabel}
            />
          </>
        )}

        <ErrorAlert
          open={!!errorMsg}
          title="Error"
          description={errorMsg || ""}
          onOk={() => setErrorMsg(null)}
        />
      </div>
    </DistrictAdminShell>
  );
}

/* --------------------------------------------- expanded month-row body */
function ExpandedDetail({
  item,
  cached,
  cmrHref,
}: {
  item: MonthlyReportListItem;
  cached: MonthlyReportDetail | "loading" | "error" | "empty" | undefined;
  cmrHref: string;
}) {
  // Loading
  if (cached === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
        <Loader2 size={14} className="animate-spin" /> Loading detail…
      </div>
    );
  }
  // Error
  if (cached === "error") {
    return (
      <div className="text-xs text-red-700 py-3">
        Failed to load detail for this month.
      </div>
    );
  }
  // Empty (not created OR detail returned null)
  if (cached === "empty" || cached === undefined) {
    return (
      <div className="flex items-center justify-between gap-3 flex-wrap py-2">
        <p className="text-xs text-slate-500">
          {item.isCreated
            ? "No detail returned by the server for this month."
            : "Club has not started this month's report yet."}
        </p>
        {item.isCreated && (
          <LoadingLink
            href={cmrHref}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-slate-200 text-blue-700 bg-white hover:bg-blue-50"
          >
            <ExternalLink size={12} /> View CMR
          </LoadingLink>
        )}
      </div>
    );
  }

  // Detail body
  const d = cached;
  const submittedDate = d.modifiedDate ?? d.createdDate ?? null;
  const trfCount = Array.isArray(d.trfEntries) ? d.trfEntries.length : 0;
  const trfTotal = Array.isArray(d.trfEntries)
    ? d.trfEntries.reduce((s, e) => s + (e.amountUSD || 0), 0)
    : 0;

  return (
    <div className="space-y-3 py-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <Field
          label="Submitted Date"
          value={submittedDate ? fmtDate(submittedDate) : "–"}
          icon={Calendar}
        />
        <Field
          label="Assistant Governor"
          value={d.assistantGovernor || "–"}
          icon={Users}
        />
        <Field
          label="Member Count"
          value={`${fmtInt(d.currentMemberCount)} (Δ +${fmtInt(d.membersAdded)} / −${fmtInt(d.membersDeleted)})`}
          icon={Users}
        />
        <Field
          label="TRF Entries"
          value={`${fmtInt(trfCount)} · ${fmtInr(trfTotal)}`}
          icon={IndianRupee}
        />
      </div>

      {d.additionalRemarks && (
        <div className="text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-1">
            <FileText size={11} /> Remarks
          </p>
          <p className="text-slate-700 whitespace-pre-wrap break-words bg-white rounded-md border border-slate-200 px-3 py-2">
            {d.additionalRemarks}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end">
        <LoadingLink
          href={cmrHref}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-slate-200 text-blue-700 bg-white hover:bg-blue-50"
        >
          <ExternalLink size={12} /> View CMR
        </LoadingLink>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Calendar;
}) {
  return (
    <div className="bg-white rounded-md border border-slate-200 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
        <Icon size={11} /> {label}
      </p>
      <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}

/* ===================================================== Citation panel */

/**
 * `getClubCitation` returns the same shape used on the club Citation page.
 * The exact field names vary slightly between code paths so we coerce them
 * into a forgiving local shape here.
 */
type CitationCategory = {
  category: string;
  points: number;
};

type CitationLike = {
  totalPoints: number;
  autoPoints?: number;
  manualPoints?: number;
  categories: CitationCategory[];
  status?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerceCitation(raw: any): CitationLike | null {
  if (!raw || typeof raw !== "object") return null;
  // Prefer common field names; fall back to anything plausible.
  const total =
    raw.totalPoints ??
    raw.total ??
    raw.totalScore ??
    raw.points ??
    raw.grandTotal ??
    0;
  const auto = raw.autoPoints ?? raw.automaticPoints ?? raw.autoTotal ?? undefined;
  const manual =
    raw.manualPoints ?? raw.manualTotal ?? raw.userPoints ?? undefined;
  const status = raw.status ?? raw.citationStatus ?? undefined;

  // Categories may be in `categories` / `breakdown` / `categoryBreakdown`
  // or a per-section object map. Reduce to {category, points}.
  let categories: CitationCategory[] = [];
  const src =
    raw.categories ?? raw.categoryBreakdown ?? raw.breakdown ?? raw.sections;
  if (Array.isArray(src)) {
    categories = src
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => ({
        category:
          c.category ??
          c.name ??
          c.sectionName ??
          c.title ??
          c.label ??
          "Section",
        points: Number(c.points ?? c.total ?? c.score ?? c.value ?? 0) || 0,
      }))
      .filter((c) => c.category);
  } else if (src && typeof src === "object") {
    categories = Object.entries(src).map(([k, v]) => ({
      category: k,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      points: Number((v as any)?.points ?? v ?? 0) || 0,
    }));
  }

  return {
    totalPoints: Number(total) || 0,
    autoPoints:
      auto != null && Number.isFinite(Number(auto)) ? Number(auto) : undefined,
    manualPoints:
      manual != null && Number.isFinite(Number(manual))
        ? Number(manual)
        : undefined,
    categories,
    status: typeof status === "string" ? status : undefined,
  };
}

function CitationPanel({
  loading,
  citation,
  yearLabel,
}: {
  loading: boolean;
  citation: CitationLike | null;
  yearLabel: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Award size={14} className="text-amber-500" />
            Awards Status
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Club's awards score breakdown
            {yearLabel ? ` · RY ${yearLabel}` : ""}
          </p>
        </div>
        {citation?.status && (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
            {citation.status}
          </span>
        )}
      </div>

      {loading ? (
        <div className="px-5 py-8 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-slate-400" />
        </div>
      ) : !citation || citation.totalPoints === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-slate-500">
          No citation data available for this club yet.
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {/* Top score row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-amber-50 ring-1 ring-amber-100 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                Total Points
              </p>
              <p className="text-2xl font-bold text-amber-700 tabular-nums">
                {fmtInt(citation.totalPoints)}
              </p>
            </div>
            {citation.autoPoints != null && (
              <div className="rounded-xl bg-blue-50 ring-1 ring-blue-100 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                  Auto-calculated
                </p>
                <p className="text-2xl font-bold text-blue-700 tabular-nums">
                  {fmtInt(citation.autoPoints)}
                </p>
              </div>
            )}
            {citation.manualPoints != null && (
              <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-100 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Manual Entry
                </p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">
                  {fmtInt(citation.manualPoints)}
                </p>
              </div>
            )}
          </div>

          {/* Per-category breakdown */}
          {citation.categories.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Category Breakdown
              </p>
              <div className="flex flex-wrap gap-1.5">
                {citation.categories.map((c, i) => (
                  <span
                    key={`${c.category}-${i}`}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                  >
                    {c.category}
                    <span className="tabular-nums text-slate-900">
                      {fmtInt(c.points)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- utils */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMessage(err: any, fallback: string): string {
  const respData = err?.response?.data;
  return (
    respData?.message ||
    respData?.detail ||
    respData?.title ||
    (err instanceof Error ? err.message : fallback)
  );
}

/* ============================================================ exported */
export default function DistrictAdminEGovClubDetailPage() {
  return (
    <ProtectedRoute>
      <DistrictAdminEGovClubDetailInner />
    </ProtectedRoute>
  );
}

"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MenuItemButton, TileButton } from "@/components/ui/text-buttons";
import { IconButton } from "@/components/ui/icon-button";

/**
 * NEW CMR (v3) - SUPER ADMIN ONLY until go-live (user 2026-11-10). Copy of the v2 wizard; v2 is not
 * changed. Same report data (meetings, projects, members info are the same tables). Differences:
 *   - "TRF" is now "Foundation": the club's Goal Setting month-wise Foundation figures, VIEW ONLY
 *     (no add / edit / delete); a month not synced from Rotary.org shows the CMR TRF entries summed
 *     by fund type.
 *   - "Members Info" is now "Membership": ONE view-only table - the CMR's month counts (start / added /
 *     terminated / now, always auto-filled from the member records and still saved into the report for the
 *     CMR reports) side by side with Club Goals' month-wise figures and targets. Only "Additional
 *     achievement" is typed.
 *   - SAVES like the old CMR (user 2026-11-13: Club Admin + Super Admin can do everything; only Foundation and
 *     Membership stay read only - they come from the import / Rotary.org): leaving Membership and "Save &
 *     Preview" save the month's member counts (from the member records) + "Additional achievement"; the
 *     preview has "Upload to District" (same server upload + emails as the old CMR).
 *     Meetings / projects added from here still go to their own modules as before.
 *   - New design (user 2026-11-10): navy header with the month, AG and club "Sync from Rotary.org"
 *     (current year), summary tiles, tabs with counts. The year selector is hidden (a CMR month has one year).
 *
 * Club Monthly Report v2: 4-step wizard (Meetings → TRF → Projects → Members).
 *
 * Visual chrome rebuilt on the v2 design language (dot-accented section cards,
 * slate-toned chips, sticky bottom action bar). Underlying data flow is
 * identical to v1: every API call, every validation, every deep-link target.
 *
 * Deep-links to module add/edit pages prefer v2 paths where they exist (TRF,
 * club-service, community-service, vocational-service, international-service,
 * new-generation-service, public-image-initiative). frozenMonth / frozenYearId
 * are propagated so the launched form locks its date input to the wizard
 * month. The TRF v2 listing uses ?from=cmr&yearId=&month= instead: also v2.
 *
 * v2 reads ONLY `?returnTo=`: the value propagates back to the e-Gov tab on
 * success / cancel via V2FormShell's useV2ReturnTo() helper. Step index is
 * still read from `?step=meetings|trf|projects|members` so sub-pages can
 * return the user to the tab they came from.
 */

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, Pencil, Trash2, Calendar, DollarSign, FolderOpen, Users, FileText, Loader2, ChevronDown, UserCircle2, CheckCircle2 } from "@/components/icons";
import {
  initMonthlyReport,
  getMonthlyReport,
  getMonthlyReportMeetings,
  getMonthlyReportProjects,
  getMonthlyReportMemberStats,
  getMonthlyReportPreview,
  saveMonthlyReportMemberInfo,
  deleteProject,
  getClub,
  getTrfContributionsByMonth,
} from "@/services/api";
import {
  MonthlyReportDetail,
  ReportMeeting,
  ReportProject,
} from "@/types/clubMonthlyReport";
import { TrfContribution } from "@/types/trfContribution";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import LoadingButton from "@/components/v2/LoadingButton";
import LoadingLink from "@/components/v2/LoadingLink";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import {
  CmrFoundationPanel, CmrMembershipPanel, useClubMonthlyGoals, foundationThisMonth, usd, MEMBERSHIP, FOUNDATION,
} from "@/components/cmr/CmrGoalPanels";
import RotaryOrgSync from "@/components/goal-rotary/RotaryOrgSync";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { cmrCalendarYear, groupCmrMeetings, cmrUploadDate } from "@/components/cmr/cmrLabels";
import { useAuth } from "@/contexts/AuthContext";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { appLocale } from "@/lib/appFormat";

// ── Constants (parity with v1) ─────────────────────────────────────────────

const STEPS = [
  { key: "meetings", label: "Meetings",     icon: Calendar    },
  { key: "trf",      label: "Foundation",   icon: DollarSign  },
  { key: "projects", label: "Projects",     icon: FolderOpen  },
  { key: "members",  label: "Membership",   icon: Users       },
] as const;

const MEETING_TYPE_COLORS: Record<string, string> = {
  regular:    "bg-blue-50    text-blue-700    border-blue-200",
  fellowship: "bg-violet-50  text-violet-700  border-violet-200",
  bod:        "bg-amber-50   text-amber-700   border-amber-200",
  assembly:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  trust:      "bg-rose-50    text-rose-700    border-rose-200",
};

const PROJECT_LABELS: Record<string, string> = {
  community_service:        "Community Service",
  vocational_service:       "Vocational Service",
  international_service:    "International Service",
  new_generation_service:   "New Generation Service",
  public_image_initiative:  "Public Image Initiative",
};

// v2 add/edit paths for project modules: wizard prefers v2 routes.
const PROJECT_ROUTES_V2: Record<string, string> = {
  community_service:        "community-service/v2",
  vocational_service:       "vocational-service/v2",
  international_service:    "international-service/v2",
  new_generation_service:   "new-generation-service/v2",
  public_image_initiative:  "public-image-initiative/v2",
};

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Tiny helpers ────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// Visual scaffold matching V2FormShell's idiom (rounded section card with
// dot-accented header, slate-tone chrome): used for each step's content.
function SectionCard({
  icon: Icon, title, subtitle, action, children,
}: { icon: React.ElementType; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="row-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-navy-950/[0.07] text-navy-950"><Icon size={18} /></span>
          <div>
            <h3 className="row-h2">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// Summary box = the tab (user 2026-11-12: one row instead of boxes + a separate tab bar). Click opens that
// step; the open one is navy.
function Tile({ icon: Icon, label, value, hint, active, onClick }: {
  step?: number; icon: React.ElementType; label: string; value: React.ReactNode; hint?: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <TileButton onClick={onClick} aria-pressed={active}
      className={`group px-4 py-3.5 ${active ? "border-navy-950 bg-navy-950 text-white hover:border-navy-950" : "text-slate-900"}`}>
      {/* Step number removed, icon + heading bigger (user 2026-11-13). `step` stays optional for the call sites. */}
      <div className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${active ? "text-navy-200" : "text-slate-500"}`}>
        <Icon size={20} className={active ? "text-marigold" : "text-navy-950"} /> {label}
      </div>
      <div className="mt-1.5 text-2xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className={`mt-0.5 truncate text-xs ${active ? "text-navy-200" : "text-slate-500"}`}>{hint}</div>}
    </TileButton>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

function ClubMonthlyReportV2WizardInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const yearId = Number(params.yearId);
  const month  = Number(params.month);

  // returnTo plumbing: back/cancel/save→generate routes here.
  const incomingReturnTo = searchParams.get("returnTo") || "";
  const returnToQuery = incomingReturnTo
    ? `&returnTo=${encodeURIComponent(incomingReturnTo)}`
    : "";
  // Back target: honor the caller's returnTo DIRECTLY: the e-Gov dashboard tab when
  // opened from there (embedded flow), or the standalone CMR listing when opened
  // standalone. Falls back to the standalone listing when opened with no returnTo.
  const cmrLandingHref = incomingReturnTo || `/clubs/${clubId}/club-monthly-report/v2`;

  // Step from URL (set by sub-pages on redirect-back).
  const initialStep = (() => {
    const s = searchParams.get("step");
    const idx = STEPS.findIndex((st) => st.key === s);
    return idx >= 0 ? idx : 0;
  })();

  const [clubName, setClubName] = useState("");
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reportDetail, setReportDetail] = useState<MonthlyReportDetail | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);   // "Uploaded to District" date (read only)

  // Step 1: Meetings
  const [meetings, setMeetings] = useState<ReportMeeting[]>([]);
  const [meetingsLoaded, setMeetingsLoaded] = useState(false);

  // Step 2: TRF
  const [trfContributions, setTrfContributions] = useState<TrfContribution[]>([]);
  const [trfLoaded, setTrfLoaded] = useState(false);

  // Step 3: Projects (grouped by service type)
  const [projects, setProjects] = useState<Record<string, ReportProject[]>>({});
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [addProjectType, setAddProjectType] = useState<string>("");

  // Step 4: Members Info
  const [memberCountLastMonth, setMemberCountLastMonth] = useState<number>(0);
  const [membersDeleted, setMembersDeleted] = useState<number>(0);
  const [membersAdded, setMembersAdded] = useState<number>(0);
  const [additionalRemarks, setAdditionalRemarks] = useState<string>("");

  // Club Goals month-wise (view only) + club "Sync from Rotary.org" (current year only).
  const { currentYearId, years } = useRotaryYears();
  const isCurrentYear = currentYearId != null && yearId === currentYearId;
  const yearLabel = years.find((y) => y.id === yearId)?.yearLabel;
  const [syncTick, setSyncTick] = useState(0);
  const onSynced = useCallback(() => setSyncTick((t) => t + 1), []);
  const membershipForm = useClubMonthlyGoals(MEMBERSHIP, clubId, yearId, syncTick);
  const foundationForm = useClubMonthlyGoals(FOUNDATION, clubId, yearId, syncTick);

  // Step-aware return URL: each sub-page redirects back to the right tab.
  const wizardBase = `/clubs/${clubId}/club-monthly-report/v3/${yearId}/${month}`;
  const returnUrlForStep = (stepKey: string) =>
    `${wizardBase}?step=${stepKey}${returnToQuery}`;

  // Initialize report on mount.
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        setError(null);
        const club = await getClub(clubId);
        setClubName(club.clubName);
        await initMonthlyReport(clubId, yearId, month);   // same as the old CMR: creates the month's row if missing

        const detail = await getMonthlyReport(clubId, yearId, month);
        if (detail) {
          setReportDetail(detail);
          setAdditionalRemarks(detail.additionalRemarks || "");
          // The upload date is only on the preview (read only); fetched only for an uploaded report.
          if (detail.isUploadedToDistrict)
            getMonthlyReportPreview(clubId, yearId, month).then((p) => setUploadedAt(p.uploadedToDistrictDate)).catch(() => {});
        }
        // Membership is VIEW ONLY in the new CMR: always the member records (same source as Club Goals);
        // saved into the report on "Save & Generate". If the records can't be read, the saved values show.
        try {
          const stats = await getMonthlyReportMemberStats(clubId, yearId, month);
          setMemberCountLastMonth(stats.memberCountLastMonth);
          setMembersDeleted(stats.membersDeleted);
          setMembersAdded(stats.membersAdded);
        } catch {
          if (detail) {
            setMemberCountLastMonth(detail.memberCountLastMonth);
            setMembersDeleted(detail.membersDeleted);
            setMembersAdded(detail.membersAdded);
          }
        }

        // Every tab up front - the summary tiles show all four.
        await Promise.all([loadMeetings(), loadTrf(), loadProjects()]);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setError(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to initialize report"));
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, yearId, month]);

  const loadMeetings = useCallback(async () => {
    try {
      const data = await getMonthlyReportMeetings(clubId, yearId, month);
      setMeetings(data);
      setMeetingsLoaded(true);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load meetings"));
    }
  }, [clubId, yearId, month]);

  const loadTrf = useCallback(async () => {
    try {
      const data = await getTrfContributionsByMonth(clubId, yearId, month);
      setTrfContributions(data);
      setTrfLoaded(true);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || (err instanceof Error ? err.message : "Failed to load TRF entries"));
    }
  }, [clubId, yearId, month]);

  const loadProjects = useCallback(async () => {
    try {
      const data = await getMonthlyReportProjects(clubId, yearId, month);
      setProjects(data);
      setProjectsLoaded(true);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load projects"));
    }
  }, [clubId, yearId, month]);

  const loadStepData = useCallback(
    async (step: number) => {
      setError(null);
      switch (step) {
        case 0: if (!meetingsLoaded) await loadMeetings(); break;
        case 1: if (!trfLoaded)      await loadTrf();      break;
        case 2: if (!projectsLoaded) await loadProjects(); break;
        case 3: /* members info already in report detail */ break;
      }
    },
    [meetingsLoaded, trfLoaded, projectsLoaded, loadMeetings, loadTrf, loadProjects],
  );

  // When CMR is reached via ?step=... (returned from sub-page), force refresh
  // that step's listing: bypassing the *Loaded cache so a freshly-added entry
  // appears even if Next.js preserved state with *Loaded=true.
  useEffect(() => {
    const step = searchParams.get("step");
    if (!step) return;
    if (step === "meetings")      loadMeetings();
    else if (step === "trf")      loadTrf();
    else if (step === "projects") loadProjects();
  }, [searchParams, loadMeetings, loadTrf, loadProjects]);

  // Save the month's report row (user 2026-11-13) - same call as the old CMR: member counts (read only, from the
  // member records) + "Additional achievement". Meetings / projects save in their own modules.
  const saveReport = useCallback(async () => {
    const reportId = reportDetail?.reportId;
    if (!reportId) return;
    try {
      await saveMonthlyReportMemberInfo(clubId, reportId, {
        memberCountLastMonth, membersDeleted, membersAdded,
        additionalRemarks: additionalRemarks || null,
      });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to save the report"));
      throw err;
    }
  }, [clubId, reportDetail?.reportId, memberCountLastMonth, membersDeleted, membersAdded, additionalRemarks]);

  // Leaving Membership (where "Additional achievement" is typed) saves, like the old CMR's Members step.
  const handleNext = async () => {
    setError(null);
    try { if (currentStep === 3) await saveReport(); } catch { return; }
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    await loadStepData(nextStep);
  };

  const handlePrevious = async () => {
    setError(null);
    try { if (currentStep === 3) await saveReport(); } catch { return; }
    const prevStep = currentStep - 1;
    setCurrentStep(prevStep);
    await loadStepData(prevStep);
  };

  // Save & Preview: saves the report, then the v3 preview (Design B PDF + Upload to District).
  const handlePreview = async () => {
    try { await saveReport(); } catch { return; }
    router.push(`${wizardBase}/preview${incomingReturnTo ? `?returnTo=${encodeURIComponent(incomingReturnTo)}` : ""}`);
  };

  const handleDeleteMeeting = async (projectId: number) => {
    if (!confirm("Are you sure you want to delete this meeting?")) return;
    try {
      setDeletingId(projectId);
      await deleteProject(clubId, yearId, projectId);
      setMeetings((prev) => prev.filter((m) => m.projectId !== projectId));
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to delete meeting"));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteProject = async (projectId: number, serviceType: string) => {
    if (!confirm("Are you sure you want to delete this project?")) return;
    try {
      setDeletingId(projectId);
      await deleteProject(clubId, yearId, projectId);
      setProjects((prev) => ({
        ...prev,
        [serviceType]: prev[serviceType]?.filter((p) => p.projectId !== projectId) || [],
      }));
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to delete project"));
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSection = (key: string) =>
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Deep-link URL builders: v2 routes preferred. frozenMonth/frozenYearId
  // keep the project / meeting date locked to the wizard month.
  const getAddProjectUrl = (serviceType: string) => {
    const route = PROJECT_ROUTES_V2[serviceType];
    const base = `/clubs/${clubId}/${route}/add`;
    const moduleParam = serviceType === "community_service" ? `&module=community_service` : "";
    return `${base}?returnTo=${encodeURIComponent(returnUrlForStep("projects"))}&frozenMonth=${month}&frozenYearId=${yearId}${moduleParam}`;
  };

  const getEditProjectUrl = (serviceType: string, projectId: number) => {
    const route = PROJECT_ROUTES_V2[serviceType];
    const base = `/clubs/${clubId}/${route}/${projectId}/edit`;
    const moduleParam = serviceType === "community_service" ? `&module=community_service` : "";
    return `${base}?returnTo=${encodeURIComponent(returnUrlForStep("projects"))}&frozenMonth=${month}&frozenYearId=${yearId}${moduleParam}`;
  };

  const addMeetingHref =
    `/clubs/${clubId}/club-service/v2/add?returnTo=${encodeURIComponent(returnUrlForStep("meetings"))}&frozenMonth=${month}&frozenYearId=${yearId}`;
  const editMeetingHref = (projectId: number) =>
    `/clubs/${clubId}/club-service/v2/${projectId}/edit?returnTo=${encodeURIComponent(returnUrlForStep("meetings"))}&frozenMonth=${month}&frozenYearId=${yearId}`;
  // Leaving Membership in ANY way (card click, Previous, Back, Save & Preview) saves "Additional achievement"
  // first (user 2026-11-13) - a failed save keeps the user on Membership with the error shown.
  // The tab switches at once; leaving Membership saves in the background, and a failed save brings the user
  // back to Membership with the error (user 2026-11-13: Back must be as quick as Next).
  const goTo = (index: number) => {
    const leavingMembership = currentStep === 3 && index !== 3;
    setCurrentStep(index); loadStepData(index);
    if (leavingMembership) saveReport().catch(() => setCurrentStep(3));
  };
  // Bottom "Back" = one tab back (user 2026-11-13): Membership -> Projects -> Foundation -> Meetings -> the CMR list.
  const stepBack = () => goTo(currentStep - 1);
  const leave = async () => {
    // Only the last tab can hold unsaved work.
    if (currentStep === 3) { try { await saveReport(); } catch { return; } }
    router.push(cmrLandingHref);
  };
  const projectCount = Object.values(projects).reduce((s, list) => s + (list?.length ?? 0), 0);
  const projectTypes = Object.values(projects).filter((list) => (list?.length ?? 0) > 0).length;
  const attendancePcts = meetings.map((m) => m.attendancePercentage).filter((p): p is number => p != null);
  const avgAttendance = attendancePcts.length > 0 ? Math.round(attendancePcts.reduce((s, p) => s + Number(p), 0) / attendancePcts.length) : null;
  const foundation = foundationThisMonth(foundationForm, month, trfContributions);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RotaryLoader />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>{MONTH_NAMES[month] || `Month ${month}`} {cmrCalendarYear(yearLabel, month)} Report</>}
        back={leave}
        backLabel="Back to Monthly Reports"
        description={
          <>
            {clubName || "–"}{yearLabel ? ` · RY ${yearLabel}` : ""} · Assistant Governor: {reportDetail?.assistantGovernor || "N/A"} ·{" "}
            {reportDetail?.isUploadedToDistrict ? `Uploaded to District${uploadedAt ? `: ${cmrUploadDate(uploadedAt)}` : ""}` : "Not uploaded to District yet"}
          </>
        }
      />
      {isCurrentYear && <RotaryOrgSync clubId={clubId} tone="light" onSynced={onSynced} />}

      {/* The 4 boxes are the tabs (sticky while scrolling). */}
      <div className="sticky top-0 z-10 -mx-1 bg-background px-1 py-2">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile step={1} icon={Calendar} label="Meetings" active={currentStep === 0} onClick={() => goTo(0)}
            value={meetings.length}
            hint={meetings.length > 0 && avgAttendance != null ? `Avg attendance ${avgAttendance}%` : "No meetings yet"} />
          <Tile step={2} icon={DollarSign} label="Foundation" active={currentStep === 1} onClick={() => goTo(1)}
            value={usd(foundation.total)}
            hint={foundationForm === undefined ? "Loading…" : foundation.synced ? "From Rotary.org · this month" : "CMR entries · not synced yet"} />
          <Tile step={3} icon={FolderOpen} label="Projects" active={currentStep === 2} onClick={() => goTo(2)}
            value={projectCount}
            hint={projectCount > 0 ? `${projectTypes} service type${projectTypes === 1 ? "" : "s"}` : "No projects yet"} />
          <Tile step={4} icon={Users} label="Membership" active={currentStep === 3} onClick={() => goTo(3)}
            value={memberCountLastMonth - membersDeleted + membersAdded}
            hint={`+${membersAdded} added · −${membersDeleted} left this month`} />
        </div>
      </div>

      <ErrorAlert
        open={!!error}
        title="Error"
        description={error || ""}
        onOk={() => setError(null)}
      />

      {/* Step content */}
      {currentStep === 0 && (
        <SectionCard
          icon={Calendar}
          title="Meetings"
          subtitle="Club meetings held this month"
          action={
            <LoadingLink
              href={addMeetingHref}
              className="row-btn row-btn-primary"
            >
              <Plus size={14} /> Add Meeting
            </LoadingLink>
          }
        >
          {meetings.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No meetings for this month</p>
              <p className="text-xs text-slate-500 mt-1">Click &quot;Add Meeting&quot; to create one</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* One table per meeting type (user 2026-11-10). */}
              {groupCmrMeetings(meetings).map((g) => (
                <div key={g.type} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded border px-2.5 py-0.5 text-xs font-semibold ${MEETING_TYPE_COLORS[g.type] || "bg-slate-50 text-slate-700 border-slate-200"}`}>{g.label}</span>
                      <span className="text-xs text-slate-500">{g.items.length} meeting{g.items.length === 1 ? "" : "s"}</span>
                    </div>
                    {g.avgAttendance != null && <span className="text-xs text-slate-500">Avg attendance <b className="text-slate-800">{g.avgAttendance}%</b></span>}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-left w-12">#</TableHead>
                          <TableHead className="text-left">Date</TableHead>
                          <TableHead className="text-left">Title</TableHead>
                          <TableHead className="text-right">Attendance</TableHead>
                          <TableHead className="text-right">Attendance %</TableHead>
                          <TableHead className="text-right w-24">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.items.map((meeting, idx) => (
                          <TableRow key={meeting.projectId}>
                            <TableCell className="text-slate-500 tabular-nums">{idx + 1}</TableCell>
                            <TableCell className="text-slate-700 whitespace-nowrap">{formatDate(meeting.projectDate)}</TableCell>
                            <TableCell className="font-medium text-slate-800">{meeting.title}</TableCell>
                            <TableCell className="text-right tabular-nums">{meeting.attendance ?? "-"}</TableCell>
                            <TableCell className="text-right tabular-nums">{meeting.attendancePercentage != null ? `${meeting.attendancePercentage}%` : "-"}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <LoadingLink
                                  href={editMeetingHref(meeting.projectId)}
                                  className="row-icon-btn"
                                  aria-label="Edit"
                                >
                                  <Pencil size={12} />
                                </LoadingLink>
                                <IconButton
                                  type="button"
                                  onClick={() => handleDeleteMeeting(meeting.projectId)}
                                  disabled={deletingId === meeting.projectId}
                                  className="text-rose-600"
                                  aria-label="Delete"
                                >
                                  {deletingId === meeting.projectId ? <Loader2 className="animate-spin" size={12} /> : <Trash2 size={12} />}
                                </IconButton>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {currentStep === 1 && (
        <SectionCard icon={DollarSign} title="Foundation" subtitle="Rotary Foundation giving - view only, from Club Goals">
          <CmrFoundationPanel form={foundationForm} month={month} trf={trfContributions} clubId={clubId} yearId={yearId} tick={syncTick} />
        </SectionCard>
      )}

      {currentStep === 2 && (
        <SectionCard
          icon={FolderOpen}
          title="Projects"
          subtitle="Service projects done this month"
          action={
            <div className="flex items-center gap-2">
              <NativeSelect
                value={addProjectType}
                onChange={(e) => setAddProjectType(e.target.value)}
                className="w-auto"
              >
                <option value="">Select service type…</option>
                {Object.entries(PROJECT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </NativeSelect>
              <LoadingLink
                href={addProjectType ? getAddProjectUrl(addProjectType) : "#"}
                onClick={(e) => {
                  if (!addProjectType) {
                    e.preventDefault();
                    setError("Please select a service type first");
                  }
                }}
                className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-xl ${
                  addProjectType
                    ? "bg-navy-950 text-white hover:bg-navy-900"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
              >
                <Plus size={14} /> Add Project
              </LoadingLink>
            </div>
          }
        >
          {Object.keys(PROJECT_LABELS).every((key) => !projects[key] || projects[key].length === 0) ? (
            <div className="text-center py-12">
              <FolderOpen size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No projects for this month</p>
              <p className="text-xs text-slate-500 mt-1">Select a service type and click &quot;Add Project&quot; to create one</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(PROJECT_LABELS).map(([serviceType, label]) => {
                const items = projects[serviceType] || [];
                if (items.length === 0) return null;
                const isCollapsed = collapsedSections[serviceType];
                const isCommunity = serviceType === "community_service";
                return (
                  <div key={serviceType} className="border border-slate-200 rounded-xl overflow-hidden">
                    <MenuItemButton
                      type="button"
                      className="justify-between rounded-none px-4 py-2.5"
                      onClick={() => toggleSection(serviceType)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{label}</span>
                        <span className="inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          {items.length}
                        </span>
                      </div>
                      <ChevronDown
                        size={14}
                        className={`text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                      />
                    </MenuItemButton>
                    {!isCollapsed && (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-left w-12">#</TableHead>
                              <TableHead className="text-left">Date</TableHead>
                              <TableHead className="text-left">Title</TableHead>
                              {isCommunity ? (
                                <>
                                  <TableHead className="text-left">Area of Focus</TableHead>
                                </>
                              ) : (
                                <>
                                </>
                              )}
                              <TableHead className="text-right w-24">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((project, idx) => (
                              <TableRow key={project.projectId}>
                                <TableCell className="text-slate-500 tabular-nums">{idx + 1}</TableCell>
                                <TableCell className="text-slate-700 whitespace-nowrap">{formatDate(project.projectDate)}</TableCell>
                                <TableCell className="font-medium text-slate-800">
                                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                                    {project.title}
                                    {(serviceType === "community_service" || serviceType === "public_image_initiative") && (
                                      <>
                                        {project.projectType && (
                                          <span
                                            className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                                              project.projectType === "one_time"
                                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                                : "bg-violet-50 text-violet-700 border-violet-200"
                                            }`}
                                          >
                                            {project.projectType === "one_time" ? "One Time" : "Ongoing"}
                                          </span>
                                        )}
                                        {project.parentProjectId && (
                                          <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
                                            Child Project
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </span>
                                </TableCell>
                                {isCommunity ? (
                                  <>
                                    <TableCell className="text-slate-700">{project.areaOfFocusName || "-"}</TableCell>
                                  </>
                                ) : (
                                  <>
                                    <TableCell className="text-slate-700">{project.areaOfFocusName || "-"}</TableCell>
                                  </>
                                )}
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    <LoadingLink
                                      href={getEditProjectUrl(serviceType, project.projectId)}
                                      className="row-icon-btn"
                                      aria-label="Edit"
                                    >
                                      <Pencil size={12} />
                                    </LoadingLink>
                                    <IconButton
                                      type="button"
                                      onClick={() => handleDeleteProject(project.projectId, serviceType)}
                                      disabled={deletingId === project.projectId}
                                      className="text-rose-600"
                                      aria-label="Delete"
                                    >
                                      {deletingId === project.projectId
                                        ? <Loader2 className="animate-spin" size={12} />
                                        : <Trash2 size={12} />}
                                    </IconButton>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {currentStep === 3 && (
        <SectionCard icon={Users} title="Membership" subtitle="This month and the year so far - view only">
          <CmrMembershipPanel
            form={membershipForm}
            month={month}
            monthLabel={(MONTH_NAMES[month] || "").slice(0, 3)}
            counts={{ start: memberCountLastMonth, added: membersAdded, terminated: membersDeleted }}
            clubId={clubId} yearId={yearId} tick={syncTick}
          />
          <div className="mt-6 max-w-3xl">
            <label className="mb-1.5 block text-sm font-semibold text-slate-800" htmlFor="cmr-remarks">
              Additional achievement / participation / hosting of events / projects above club level
            </label>
            <Textarea
              id="cmr-remarks"
              maxLength={1000}
              rows={4}
              value={additionalRemarks}
              onChange={(e) => setAdditionalRemarks(e.target.value)}
              placeholder="Participation / hosting of events or projects above club level, with date, a short description and the Rotarians who took part."
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-slate-500">{additionalRemarks.length}/1000</p>
          </div>
        </SectionCard>
      )}

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-0 z-10 -mx-2 sm:-mx-0 rounded-t-2xl bg-white/95 backdrop-blur ring-1 ring-slate-200  px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        {currentStep > 0 ? (
          <LoadingButton
            type="button"
            onAction={handlePrevious}
            spinnerSize={14}
            className="row-btn row-btn-secondary row-btn-sm"
          >
            <ArrowLeft size={14} /> Previous
          </LoadingButton>
        ) : <span />}

        <div className="flex items-center gap-2">
          {/* A plain button on Projects / Foundation / Membership (instant, like Next); only on Meetings is it
              the link to the CMR list. */}
          {currentStep > 0 ? (
            <Button type="button" onClick={stepBack}
              variant="outline" size="sm">
              <ArrowLeft size={14} /> Back
            </Button>
          ) : (
            <Link
              href={cmrLandingHref}
              prefetch={false}
              className="row-btn row-btn-secondary row-btn-sm"
            >
              <ArrowLeft size={14} /> Back
            </Link>
          )}
          {currentStep < 3 ? (
            <LoadingButton
              type="button"
              onAction={handleNext}
              spinnerSize={14}
              className="row-btn row-btn-primary"
            >
              Next: {STEPS[currentStep + 1]?.label} <ArrowRight size={14} />
            </LoadingButton>
          ) : (
            <LoadingButton
              type="button"
              onAction={handlePreview}
              spinnerSize={14}
              className="row-btn row-btn-secondary"
            >
              <FileText size={14} /> Save &amp; Preview
            </LoadingButton>
          )}
        </div>
      </div>
    </div>
  );
}

// Was Super Admin only; opened to everyone who can open the club's CMR (user 2026-11-13). The gate is kept -
// set NEW_CMR_FOR_ALL false to close it again.
const NEW_CMR_FOR_ALL = true;
function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin } = useAuth();
  if (!NEW_CMR_FOR_ALL && !isSuperAdmin) return <p className="text-sm text-slate-500 py-10 text-center">This new Club Monthly Report is not available yet.</p>;
  return <>{children}</>;
}

export default function ClubMonthlyReportV3WizardPage() {
  useSyncClubIdFromUrl();
  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Monthly Report (New - Preview)"
        pageSubtitle="Meetings, Foundation, projects and membership"
        activeNavHref="/club-admin-dashboard/e-governance"
        hideYearSelector
      >
        <SuperAdminOnly><ClubMonthlyReportV2WizardInner /></SuperAdminOnly>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

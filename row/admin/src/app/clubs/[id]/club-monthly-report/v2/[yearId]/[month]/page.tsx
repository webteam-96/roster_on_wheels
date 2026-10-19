"use client";

/**
 * Club Monthly Report v2 — 4-step wizard (Meetings → TRF → Projects → Members).
 *
 * Visual chrome rebuilt on the v2 design language (dot-accented section cards,
 * slate-toned chips, sticky bottom action bar). Underlying data flow is
 * identical to v1: every API call, every validation, every deep-link target.
 *
 * Deep-links to module add/edit pages prefer v2 paths where they exist (TRF,
 * club-service, community-service, vocational-service, international-service,
 * new-generation-service, public-image-initiative). frozenMonth / frozenYearId
 * are propagated so the launched form locks its date input to the wizard
 * month. The TRF v2 listing uses ?from=cmr&yearId=&month= instead — also v2.
 *
 * v2 reads ONLY `?returnTo=` — the value propagates back to the e-Gov tab on
 * success / cancel via V2FormShell's useV2ReturnTo() helper. Step index is
 * still read from `?step=meetings|trf|projects|members` so sub-pages can
 * return the user to the tab they came from.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Plus, Pencil, Trash2, Calendar, DollarSign,
  FolderOpen, Users, FileText, CheckCircle2, Loader2, ChevronDown, RefreshCw,
} from "@/components/icons";
import {
  initMonthlyReport,
  getMonthlyReport,
  getMonthlyReportMeetings,
  getMonthlyReportProjects,
  getMonthlyReportMemberStats,
  saveMonthlyReportMemberInfo,
  deleteProject,
  getClub,
  getTrfContributionsByMonth,
  deleteTrfContribution,
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
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale } from "@/lib/appFormat";
// ── Constants (parity with v1) ─────────────────────────────────────────────

const STEPS = [
  { key: "meetings", label: "Meetings",     icon: Calendar    },
  { key: "trf",      label: "TRF",          icon: DollarSign  },
  { key: "projects", label: "Projects",     icon: FolderOpen  },
  { key: "members",  label: "Members Info", icon: Users       },
] as const;

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

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

// v2 add/edit paths for project modules — wizard prefers v2 routes.
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
// dot-accented header, slate-tone chrome) — used for each step's content.
function SectionCard({
  icon: Icon, title, action, children,
}: { icon: React.ElementType; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
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

  // returnTo plumbing — back/cancel/save→generate routes here.
  const incomingReturnTo = searchParams.get("returnTo") || "";
  const returnToQuery = incomingReturnTo
    ? `&returnTo=${encodeURIComponent(incomingReturnTo)}`
    : "";
  // Back target: honor the caller's returnTo DIRECTLY — the e-Gov dashboard tab when
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
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reportId, setReportId] = useState<number | null>(null);
  const [reportDetail, setReportDetail] = useState<MonthlyReportDetail | null>(null);

  // Step 1: Meetings
  const [meetings, setMeetings] = useState<ReportMeeting[]>([]);
  const [meetingsLoaded, setMeetingsLoaded] = useState(false);

  // Step 2: TRF
  const [trfContributions, setTrfContributions] = useState<TrfContribution[]>([]);
  const [trfLoaded, setTrfLoaded] = useState(false);
  const [deletingTrfId, setDeletingTrfId] = useState<number | null>(null);

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
  const [recalculating, setRecalculating] = useState(false);

  // Step-aware return URL — each sub-page redirects back to the right tab.
  const wizardBase = `/clubs/${clubId}/club-monthly-report/v2/${yearId}/${month}`;
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
        const result = await initMonthlyReport(clubId, yearId, month);
        setReportId(result.reportId);

        const detail = await getMonthlyReport(clubId, yearId, month);
        if (detail) {
          setReportDetail(detail);
          setAdditionalRemarks(detail.additionalRemarks || "");
        }
        // Members Info: auto-fill from live club_members data ONLY the first time
        // (report never saved). Once the admin has saved, always show their edited
        // values — never re-fetch/overwrite. modified_date is NULL until the first
        // member-info save (creation sets only created_date; the other wizard steps
        // write to their own tables), so it's the reliable "has been saved" marker.
        const savedMemberInfo = !!detail && !!detail.modifiedDate;
        if (savedMemberInfo) {
          setMemberCountLastMonth(detail!.memberCountLastMonth);
          setMembersDeleted(detail!.membersDeleted);
          setMembersAdded(detail!.membersAdded);
        } else {
          try {
            const stats = await getMonthlyReportMemberStats(clubId, yearId, month);
            setMemberCountLastMonth(stats.memberCountLastMonth);
            setMembersDeleted(stats.membersDeleted);
            setMembersAdded(stats.membersAdded);
          } catch {
            // Non-fatal — leave the fields at 0 for manual entry if the compute fails.
          }
        }

        await loadMeetings();
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
  // that step's listing — bypassing the *Loaded cache so a freshly-added entry
  // appears even if Next.js preserved state with *Loaded=true.
  useEffect(() => {
    const step = searchParams.get("step");
    if (!step) return;
    if (step === "meetings")      loadMeetings();
    else if (step === "trf")      loadTrf();
    else if (step === "projects") loadProjects();
  }, [searchParams, loadMeetings, loadTrf, loadProjects]);

  const saveMemberInfoToServer = useCallback(async () => {
    if (!reportId) return;
    setSaving(true);
    try {
      await saveMonthlyReportMemberInfo(clubId, reportId, {
        memberCountLastMonth,
        membersDeleted,
        membersAdded,
        additionalRemarks: additionalRemarks || null,
      });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axiosErr = err as any;
      const respData = axiosErr?.response?.data;
      const msg = respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to save member info");
      console.error("SaveMemberInfo error:", respData || err);
      setError(msg);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [clubId, reportId, memberCountLastMonth, membersDeleted, membersAdded, additionalRemarks]);

  // Re-derive the three member counts from live club_members data (on demand).
  const recalcMemberStats = useCallback(async () => {
    setRecalculating(true);
    setError(null);
    try {
      const stats = await getMonthlyReportMemberStats(clubId, yearId, month);
      setMemberCountLastMonth(stats.memberCountLastMonth);
      setMembersDeleted(stats.membersDeleted);
      setMembersAdded(stats.membersAdded);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || (err instanceof Error ? err.message : "Failed to recalculate member counts"));
    } finally {
      setRecalculating(false);
    }
  }, [clubId, yearId, month]);

  const saveCurrentStep = useCallback(async () => {
    if (currentStep === 3) await saveMemberInfoToServer();
    // Steps 0/1/2 don't need saving from the wizard (their data lives in
    // their own module tables).
  }, [currentStep, saveMemberInfoToServer]);

  const handleNext = async () => {
    try {
      setError(null);
      await saveCurrentStep();
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      await loadStepData(nextStep);
    } catch { /* error already surfaced */ }
  };

  const handlePrevious = async () => {
    try {
      setError(null);
      await saveCurrentStep();
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      await loadStepData(prevStep);
    } catch { /* error already surfaced */ }
  };

  const handleSaveAndGenerate = async () => {
    if (memberCountLastMonth === null || memberCountLastMonth === undefined) {
      setError("Member count as on last month is required");
      return;
    }
    if (membersDeleted === null || membersDeleted === undefined) {
      setError("Members Deleted/Terminated is required");
      return;
    }
    if (membersAdded === null || membersAdded === undefined) {
      setError("Members Added is required");
      return;
    }
    try {
      setError(null);
      await saveMemberInfoToServer();
      const previewHref = `/clubs/${clubId}/club-monthly-report/v2/${yearId}/${month}/preview${
        incomingReturnTo ? `?returnTo=${encodeURIComponent(incomingReturnTo)}` : ""
      }`;
      router.push(previewHref);
    } catch { /* error already surfaced */ }
  };

  const handleDeleteTrf = async (trfId: number) => {
    if (!confirm("Are you sure you want to delete this TRF contribution?")) return;
    try {
      setDeletingTrfId(trfId);
      await deleteTrfContribution(clubId, trfId);
      setTrfContributions((prev) => prev.filter((t) => t.id !== trfId));
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setError(respData?.message || (err instanceof Error ? err.message : "Failed to delete TRF entry"));
    } finally {
      setDeletingTrfId(null);
    }
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

  // Deep-link URL builders — v2 routes preferred. frozenMonth/frozenYearId
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
  // TRF v2 listing uses ?from=cmr&yearId=&month= rather than frozen* (its own
  // convention) — keeps the date input locked and routes Back to this wizard.
  const manageTrfHref =
    `/clubs/${clubId}/trf/v2?from=cmr&yearId=${yearId}&month=${month}&returnTo=${encodeURIComponent(returnUrlForStep("trf"))}`;
  // Add / Edit TRF — both skip the TRF listing and land the user directly back
  // on this CMR wizard page (same yearId/month), on the TRF tab (`step=trf`) so
  // the user returns to where they launched the form — not the default Meetings
  // step. The inner returnTo wraps the CMR LISTING (cmrLandingHref) — NOT the
  // bare incoming chain — so the back-arrow chain stays consistent with the rest
  // of the wizard's navigation (detail → listing → … → e-Gov) instead of
  // collapsing the listing step out of the chain.
  const cmrWizardReturnTo = `${wizardBase}?step=trf&returnTo=${encodeURIComponent(cmrLandingHref)}`;
  const addTrfHref =
    `/clubs/${clubId}/trf/v2/add?from=cmr&yearId=${yearId}&month=${month}&returnTo=${encodeURIComponent(cmrWizardReturnTo)}`;
  const editTrfHref = (trfId: number) =>
    `/clubs/${clubId}/trf/v2/${trfId}/edit?from=cmr&yearId=${yearId}&month=${month}&returnTo=${encodeURIComponent(cmrWizardReturnTo)}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RotaryLoader />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2">
          <LoadingLink
            href={cmrLandingHref}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Back to Monthly Reports"
          >
            <ArrowLeft size={15} />
          </LoadingLink>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Monthly Report</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {clubName || "–"} · {MONTH_NAMES[month] || `Month ${month}`}
            </p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-2">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive    = index === currentStep;
            const isCompleted = index <  currentStep;
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => { setCurrentStep(index); loadStepData(index); }}
                  className="flex flex-col items-center flex-1 group focus:outline-none"
                >
                  <div
                    className={`
                      flex items-center justify-center w-10 h-10 rounded-full border-2 mb-2 transition-colors
                      ${isActive    ? "border-blue-600 bg-blue-600 text-white" : ""}
                      ${isCompleted ? "border-emerald-500 bg-emerald-500 text-white" : ""}
                      ${!isActive && !isCompleted ? "border-slate-300 text-slate-400 group-hover:border-slate-400" : ""}
                    `}
                  >
                    {isCompleted ? <CheckCircle2 size={18} /> : <StepIcon size={18} />}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      isActive    ? "text-blue-700"
                      : isCompleted ? "text-emerald-600"
                      : "text-slate-500"
                    }`}
                  >
                    {step.label}
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 mt-[-1.5rem] ${
                      index < currentStep ? "bg-emerald-500" : "bg-slate-200"
                    }`}
                  />
                )}
              </div>
            );
          })}
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
          action={
            <LoadingLink
              href={addMeetingHref}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Plus size={12} /> Add Meeting
            </LoadingLink>
          }
        >
          <div className="mb-3 text-xs text-slate-600">
            <span className="font-medium">Assistant Governor: </span>
            <span className="font-semibold text-slate-800">{reportDetail?.assistantGovernor || "N/A"}</span>
          </div>

          {meetings.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No meetings for this month</p>
              <p className="text-xs text-slate-500 mt-1">Click &quot;Add Meeting&quot; to create one</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-12">#</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Title</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-right">Attendance</th>
                    <th className="px-3 py-2.5 text-right">Attendance %</th>
                    <th className="px-3 py-2.5 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {meetings.map((meeting, idx) => (
                    <tr key={meeting.projectId} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 text-slate-500 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{formatDate(meeting.projectDate)}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{meeting.title}</td>
                      <td className="px-3 py-2">
                        {meeting.meetingType ? (
                          <span
                            className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
                              MEETING_TYPE_COLORS[meeting.meetingType] || "bg-slate-50 text-slate-700 border-slate-200"
                            }`}
                          >
                            {MEETING_TYPE_LABELS[meeting.meetingType] || meeting.meetingType}
                          </span>
                        ) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{meeting.attendance ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {meeting.attendancePercentage != null ? `${meeting.attendancePercentage}%` : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <LoadingLink
                            href={editMeetingHref(meeting.projectId)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                            aria-label="Edit"
                          >
                            <Pencil size={12} />
                          </LoadingLink>
                          <button
                            type="button"
                            onClick={() => handleDeleteMeeting(meeting.projectId)}
                            disabled={deletingId === meeting.projectId}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            aria-label="Delete"
                          >
                            {deletingId === meeting.projectId
                              ? <Loader2 className="animate-spin" size={12} />
                              : <Trash2 size={12} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {currentStep === 1 && (
        <SectionCard
          icon={DollarSign}
          title="TRF Contributions"
          action={
            <LoadingLink
              href={addTrfHref}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Plus size={12} /> Add TRF
            </LoadingLink>
          }
        >
          {trfContributions.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No TRF contributions for this month</p>
              <p className="text-xs text-slate-500 mt-1">Click &quot;Add TRF&quot; to manage</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-12">#</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Name</th>
                    <th className="px-3 py-2.5 text-right">Amount (USD)</th>
                    <th className="px-3 py-2.5 text-left">Fund Type</th>
                    <th className="px-3 py-2.5 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trfContributions.map((entry, idx) => (
                    <tr key={entry.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 text-slate-500 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{formatDate(entry.trfDate)}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{entry.donorName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${entry.amountUSD.toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {entry.fundType === "Others" ? entry.otherFundName || "Others" : entry.fundType}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <LoadingLink
                            href={editTrfHref(entry.id)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                            aria-label="Edit"
                          >
                            <Pencil size={12} />
                          </LoadingLink>
                          <button
                            type="button"
                            onClick={() => handleDeleteTrf(entry.id)}
                            disabled={deletingTrfId === entry.id}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            aria-label="Delete"
                          >
                            {deletingTrfId === entry.id
                              ? <Loader2 className="animate-spin" size={12} />
                              : <Trash2 size={12} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan={3} className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">Total</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-blue-700">
                      ${trfContributions.reduce((sum, e) => sum + e.amountUSD, 0).toLocaleString()} USD
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {currentStep === 2 && (
        <SectionCard
          icon={FolderOpen}
          title="Projects"
          action={
            <div className="flex items-center gap-2">
              <select
                value={addProjectType}
                onChange={(e) => setAddProjectType(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select service type…</option>
                {Object.entries(PROJECT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <LoadingLink
                href={addProjectType ? getAddProjectUrl(addProjectType) : "#"}
                onClick={(e) => {
                  if (!addProjectType) {
                    e.preventDefault();
                    setError("Please select a service type first");
                  }
                }}
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg ${
                  addProjectType
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
              >
                <Plus size={12} /> Add Project
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
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
                      onClick={() => toggleSection(serviceType)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{label}</span>
                        <span className="inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {items.length}
                        </span>
                      </div>
                      <ChevronDown
                        size={14}
                        className={`text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                      />
                    </button>
                    {!isCollapsed && (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-white text-xs uppercase text-slate-500 border-b border-slate-100">
                            <tr>
                              <th className="px-3 py-2.5 text-left w-12">#</th>
                              <th className="px-3 py-2.5 text-left">Date</th>
                              <th className="px-3 py-2.5 text-left">Title</th>
                              {isCommunity ? (
                                <>
                                  <th className="px-3 py-2.5 text-left">Area of Focus</th>
                                  <th className="px-3 py-2.5 text-left">Category</th>
                                  <th className="px-3 py-2.5 text-left">Sub Category</th>
                                </>
                              ) : (
                                <>
                                  <th className="px-3 py-2.5 text-left">Category</th>
                                  <th className="px-3 py-2.5 text-left">Sub Category</th>
                                </>
                              )}
                              <th className="px-3 py-2.5 text-right w-24">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {items.map((project, idx) => (
                              <tr key={project.projectId} className="hover:bg-blue-50/40">
                                <td className="px-3 py-2 text-slate-500 tabular-nums">{idx + 1}</td>
                                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{formatDate(project.projectDate)}</td>
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                                    {project.title}
                                    {(serviceType === "community_service" || serviceType === "public_image_initiative") && (
                                      <>
                                        {project.projectType && (
                                          <span
                                            className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                                              project.projectType === "one_time"
                                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                                : "bg-violet-50 text-violet-700 border-violet-200"
                                            }`}
                                          >
                                            {project.projectType === "one_time" ? "One Time" : "Ongoing"}
                                          </span>
                                        )}
                                        {project.parentProjectId && (
                                          <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                                            Child Project
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </span>
                                </td>
                                {isCommunity ? (
                                  <>
                                    <td className="px-3 py-2 text-slate-700">{project.areaOfFocusName || "-"}</td>
                                    <td className="px-3 py-2 text-slate-700">{project.categoryName || "-"}</td>
                                    <td className="px-3 py-2 text-slate-700">{project.subCategoryName || "-"}</td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-3 py-2 text-slate-700">{project.areaOfFocusName || "-"}</td>
                                    <td className="px-3 py-2 text-slate-700">{project.categoryName || "-"}</td>
                                  </>
                                )}
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-end gap-1">
                                    <LoadingLink
                                      href={getEditProjectUrl(serviceType, project.projectId)}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                                      aria-label="Edit"
                                    >
                                      <Pencil size={12} />
                                    </LoadingLink>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteProject(project.projectId, serviceType)}
                                      disabled={deletingId === project.projectId}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                      aria-label="Delete"
                                    >
                                      {deletingId === project.projectId
                                        ? <Loader2 className="animate-spin" size={12} />
                                        : <Trash2 size={12} />}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
        <SectionCard
          icon={Users}
          title="Members Info"
          action={
            <button
              type="button"
              onClick={recalcMemberStats}
              disabled={recalculating}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
            >
              {recalculating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Recalculate from members
            </button>
          }
        >
          <p className="text-xs text-slate-500 mb-5">
            Auto-filled from the club&apos;s member records: last-month count (as at the 1st),
            plus joins and terminations dated within this month. Adjust if needed; the current
            count auto-calculates below.
          </p>
          <div className="grid gap-4 max-w-xl">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Member count as on last month <span className="text-rose-600">*</span>
              </label>
              <input
                type="number"
                min={0}
                value={memberCountLastMonth}
                onChange={(e) => setMemberCountLastMonth(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Members Deleted/Terminated <span className="text-rose-600">*</span>
              </label>
              <input
                type="number"
                min={0}
                value={membersDeleted}
                onChange={(e) => setMembersDeleted(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Members Added <span className="text-rose-600">*</span>
              </label>
              <input
                type="number"
                min={0}
                value={membersAdded}
                onChange={(e) => setMembersAdded(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Current No. Of Members</span>
              <span className="text-2xl font-bold text-blue-700 tabular-nums">
                {memberCountLastMonth - membersDeleted + membersAdded}
              </span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Additional achievement / participation / hosting of events / projects above club if any
              </label>
              <textarea
                maxLength={1000}
                rows={4}
                value={additionalRemarks}
                onChange={(e) => setAdditionalRemarks(e.target.value)}
                placeholder="Please input details of participation /hosting of events or projects above club level with Date, short description, Participated Rotarians etc."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[10px] text-slate-500 mt-1 text-right tabular-nums">
                {additionalRemarks.length}/1000 characters
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-0 -mx-2 sm:-mx-0 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        {currentStep > 0 ? (
          <LoadingButton
            type="button"
            onAction={handlePrevious}
            forcePending={saving}
            spinnerSize={14}
            className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <ArrowLeft size={14} /> Previous
          </LoadingButton>
        ) : <span />}

        <div className="flex items-center gap-2">
          <Link
            href={cmrLandingHref}
            className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          {currentStep < 3 ? (
            <LoadingButton
              type="button"
              onAction={handleNext}
              forcePending={saving}
              loadingLabel="Saving…"
              spinnerSize={14}
              className="inline-flex items-center gap-1 text-sm font-semibold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save and Next <ArrowRight size={14} />
            </LoadingButton>
          ) : (
            <LoadingButton
              type="button"
              onAction={handleSaveAndGenerate}
              forcePending={saving}
              loadingLabel="Saving…"
              spinnerSize={14}
              className="inline-flex items-center gap-1 text-sm font-semibold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <FileText size={14} /> Save &amp; Generate Report
            </LoadingButton>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClubMonthlyReportV2WizardPage() {
  useSyncClubIdFromUrl();
  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Monthly Report Wizard"
        pageSubtitle="Meetings, TRF, projects and members"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        <ClubMonthlyReportV2WizardInner />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

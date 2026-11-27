import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { initMonthlyReport, getMonthlyReport, getMonthlyReportMeetings, getMonthlyReportProjects, getMonthlyReportMemberStats, saveMonthlyReportMemberInfo, deleteProject, getClub, getTrfContributionsByMonth, deleteTrfContribution } from "@/services/api";
import { MonthlyReportDetail, ReportMeeting, ReportProject } from "@/types/clubMonthlyReport";
import { TrfContribution } from "@/types/trfContribution";
import { STEPS, PROJECT_ROUTES_V2 } from "./monthlyReportWizardShared";

export function useMonthlyReportWizard() {
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
  return { month, cmrLandingHref, clubName, currentStep, setCurrentStep, loading, saving, deletingId, error, setError, reportDetail, meetings, trfContributions, deletingTrfId, projects, collapsedSections, addProjectType, setAddProjectType, memberCountLastMonth, setMemberCountLastMonth, membersDeleted, setMembersDeleted, membersAdded, setMembersAdded, additionalRemarks, setAdditionalRemarks, recalculating, loadStepData, recalcMemberStats, handleNext, handlePrevious, handleSaveAndGenerate, handleDeleteTrf, handleDeleteMeeting, handleDeleteProject, toggleSection, getAddProjectUrl, getEditProjectUrl, addMeetingHref, editMeetingHref, addTrfHref, editTrfHref };
}

export type MonthlyReportWizardCtx = ReturnType<typeof useMonthlyReportWizard>;

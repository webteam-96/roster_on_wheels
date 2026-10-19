"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Pencil,
  Trash2,
  Save,
  Calendar,
  DollarSign,
  FolderOpen,
  Users,
  FileText,
  CheckCircle2,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
const STEPS = [
  { key: "meetings", label: "Meetings", icon: Calendar },
  { key: "trf", label: "TRF", icon: DollarSign },
  { key: "projects", label: "Projects", icon: FolderOpen },
  { key: "members", label: "Members Info", icon: Users },
];

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

const MEETING_TYPE_COLORS: Record<string, string> = {
  regular: "bg-blue-100 text-blue-800",
  fellowship: "bg-purple-100 text-purple-800",
  bod: "bg-orange-100 text-orange-800",
  assembly: "bg-green-100 text-green-800",
  trust: "bg-red-100 text-red-800",
};

const PROJECT_LABELS: Record<string, string> = {
  community_service: "Community Service",
  vocational_service: "Vocational Service",
  international_service: "International Service",
  new_generation_service: "New Generation Service",
  public_image_initiative: "Public Image Initiative",
};

const PROJECT_ROUTES: Record<string, string> = {
  community_service: "projects",
  vocational_service: "vocational-service",
  international_service: "international-service",
  new_generation_service: "new-generation-service",
  public_image_initiative: "public-image-initiative",
};

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function ClubMonthlyReportWizardPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const yearId = Number(params.yearId);
  const month = Number(params.month);

  // Step indicator from URL — set by sub-pages (TRF/Club Service/Project add+edit) when
  // they redirect back, so the wizard opens on whichever tab the user came from.
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
  const [success, setSuccess] = useState<string | null>(null);

  // Report state
  const [reportId, setReportId] = useState<number | null>(null);
  const [reportDetail, setReportDetail] = useState<MonthlyReportDetail | null>(null);

  // Step 1: Meetings
  const [meetings, setMeetings] = useState<ReportMeeting[]>([]);
  const [meetingsLoaded, setMeetingsLoaded] = useState(false);

  // Step 2: TRF
  const [trfContributions, setTrfContributions] = useState<TrfContribution[]>([]);
  const [trfLoaded, setTrfLoaded] = useState(false);
  const [deletingTrfId, setDeletingTrfId] = useState<number | null>(null);

  // Step 3: Projects
  const [projects, setProjects] = useState<Record<string, ReportProject[]>>({});
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [addProjectType, setAddProjectType] = useState<string>("");

  // Step 4: Members Info
  const [memberCountLastMonth, setMemberCountLastMonth] = useState<number>(0);
  const [membersDeleted, setMembersDeleted] = useState<number>(0);
  const [membersAdded, setMembersAdded] = useState<number>(0);
  const [additionalRemarks, setAdditionalRemarks] = useState<string>("");

  // Step-aware return URL — each sub-page redirects back here with the right tab open.
  const wizardBase = `/clubs/${clubId}/club-monthly-report/${yearId}/${month}`;
  const returnUrlForStep = (stepKey: string) => `${wizardBase}?step=${stepKey}`;
  // Legacy single returnUrl kept for non-step contexts (none right now after the refactor).
  const returnUrl = wizardBase;

  // Initialize report on mount
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
        // (report never saved). Once saved, always show the admin's edited values —
        // never re-fetch. modified_date is NULL until the first member-info save, so
        // it's the reliable "has been saved" marker.
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
            // Non-fatal — leave fields at 0 for manual entry if compute fails.
          }
        }

        // Load meetings for step 1
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
        case 0:
          if (!meetingsLoaded) await loadMeetings();
          break;
        case 1:
          if (!trfLoaded) await loadTrf();
          break;
        case 2:
          if (!projectsLoaded) await loadProjects();
          break;
        case 3:
          // Members info is already loaded from report detail
          break;
      }
    },
    [meetingsLoaded, trfLoaded, projectsLoaded, loadMeetings, loadTrf, loadProjects]
  );

  // When CMR is reached via ?step=... (the user returned from a TRF / Club Service /
  // Project add-edit page), force-refresh that step's listing — bypassing the *Loaded
  // cache. Without this, a freshly-added entry doesn't appear because either:
  //   (a) the component re-mounted with initialStep=trf but only meetings load on init,
  //   (b) Next.js preserved state with trfLoaded=true so loadStepData skipped the fetch.
  useEffect(() => {
    const step = searchParams.get("step");
    if (!step) return;
    if (step === "meetings") loadMeetings();
    else if (step === "trf") loadTrf();
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

  const saveCurrentStep = useCallback(async () => {
    switch (currentStep) {
      case 3:
        await saveMemberInfoToServer();
        break;
      // Steps 0, 1, and 2 don't need saving from CMR
    }
  }, [currentStep, saveMemberInfoToServer]);

  const handleNext = async () => {
    try {
      setError(null);
      await saveCurrentStep();
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      await loadStepData(nextStep);
    } catch {
      // Error already set in save function
    }
  };

  const handlePrevious = async () => {
    try {
      setError(null);
      await saveCurrentStep();
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      await loadStepData(prevStep);
    } catch {
      // Error already set in save function
    }
  };

  const handleSave = async () => {
    try {
      setError(null);
      await saveCurrentStep();
    } catch {
      // Error already set in save function
    }
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
      router.push(`/clubs/${clubId}/club-monthly-report/${yearId}/${month}/preview`);
    } catch {
      // Error already set in save function
    }
  };

  // TRF delete handler
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

  // Delete meeting/project
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

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getAddProjectUrl = (serviceType: string) => {
    const route = PROJECT_ROUTES[serviceType];
    const base = `/clubs/${clubId}/${route}/add`;
    const moduleParam = serviceType === "community_service" ? `&module=community_service` : "";
    return `${base}?returnUrl=${encodeURIComponent(returnUrlForStep("projects"))}&frozenMonth=${month}&frozenYearId=${yearId}${moduleParam}`;
  };

  const getEditProjectUrl = (serviceType: string, projectId: number) => {
    const route = PROJECT_ROUTES[serviceType];
    const base = `/clubs/${clubId}/${route}/${projectId}/edit`;
    const moduleParam = serviceType === "community_service" ? `&module=community_service` : "";
    return `${base}?returnUrl=${encodeURIComponent(returnUrlForStep("projects"))}&frozenMonth=${month}&frozenYearId=${yearId}${moduleParam}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(appLocale(), {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center min-h-[400px]">
          <RotaryLoader />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href={`/clubs/${clubId}/club-monthly-report`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Monthly Report` : "Monthly Report"}
              </h1>
              <p className="text-muted-foreground text-base">
                {MONTH_NAMES[month] || `Month ${month}`}
              </p>
            </div>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const StepIcon = step.icon;
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              return (
                <div key={step.key} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`
                        flex items-center justify-center w-10 h-10 rounded-full border-2 mb-2 transition-colors
                        ${isActive ? "border-primary bg-primary text-primary-foreground" : ""}
                        ${isCompleted ? "border-green-500 bg-green-500 text-white" : ""}
                        ${!isActive && !isCompleted ? "border-muted-foreground/30 text-muted-foreground" : ""}
                      `}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <StepIcon className="h-5 w-5" />
                      )}
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        isActive
                          ? "text-primary"
                          : isCompleted
                          ? "text-green-600"
                          : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div
                      className={`h-0.5 flex-1 mx-2 mt-[-1.5rem] ${
                        index < currentStep ? "bg-green-500" : "bg-muted-foreground/20"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Alerts */}
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />

        {/* Step Content */}
        <Card>
          <CardContent className="p-6">
            {/* Step 1: Meetings */}
            {currentStep === 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Meetings
                  </CardTitle>
                  <Link
                    href={`/clubs/${clubId}/club-service/add?returnUrl=${encodeURIComponent(returnUrlForStep("meetings"))}&frozenMonth=${month}&frozenYearId=${yearId}`}
                  >
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Meeting
                    </Button>
                  </Link>
                </div>

                <div className="mb-4 text-sm">
                  <span className="font-medium text-muted-foreground">Assistant Governor: </span>
                  <span className="font-semibold">{reportDetail?.assistantGovernor || "N/A"}</span>
                </div>

                {meetings.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p className="text-lg font-medium">No meetings for this month</p>
                    <p className="text-sm mt-1">Click &quot;Add Meeting&quot; to create one</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Sr.No</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Meeting Type</TableHead>
                          <TableHead className="text-right">Attendance</TableHead>
                          <TableHead className="text-right">Attendance %</TableHead>
                          <TableHead className="w-24 text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {meetings.map((meeting, index) => (
                          <TableRow key={meeting.projectId}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell>{formatDate(meeting.projectDate)}</TableCell>
                            <TableCell className="font-medium">{meeting.title}</TableCell>
                            <TableCell>
                              {meeting.meetingType ? (
                                <Badge
                                  className={
                                    MEETING_TYPE_COLORS[meeting.meetingType] ||
                                    "bg-gray-100 text-gray-800"
                                  }
                                  variant="secondary"
                                >
                                  {MEETING_TYPE_LABELS[meeting.meetingType] ||
                                    meeting.meetingType}
                                </Badge>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {meeting.attendance ?? "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {meeting.attendancePercentage != null
                                ? `${meeting.attendancePercentage}%`
                                : "-"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Link
                                  href={`/clubs/${clubId}/club-service/${meeting.projectId}/edit?returnUrl=${encodeURIComponent(returnUrlForStep("meetings"))}&frozenMonth=${month}&frozenYearId=${yearId}`}
                                >
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </Link>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => handleDeleteMeeting(meeting.projectId)}
                                  disabled={deletingId === meeting.projectId}
                                >
                                  {deletingId === meeting.projectId ? <RotaryLoader size="sm" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: TRF */}
            {currentStep === 1 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    TRF Contributions
                  </CardTitle>
                  <Link href={`/clubs/${clubId}/trf?from=cmr&yearId=${yearId}&month=${month}`}>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Add / Edit TRF Contributions
                    </Button>
                  </Link>
                </div>

                {trfContributions.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p className="text-lg font-medium">No TRF contributions for this month</p>
                    <p className="text-sm mt-1">Click &quot;Add / Edit TRF Contributions&quot; to manage</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Sr.No</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="text-right">Amount (USD)</TableHead>
                          <TableHead>Fund Type</TableHead>
                          <TableHead className="w-20 text-center">Delete</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {trfContributions.map((entry, index) => (
                          <TableRow key={entry.id}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell>{formatDate(entry.trfDate)}</TableCell>
                            <TableCell className="font-medium">{entry.donorName}</TableCell>
                            <TableCell className="text-right">
                              ${entry.amountUSD.toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {entry.fundType === "Others"
                                ? entry.otherFundName || "Others"
                                : entry.fundType}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => handleDeleteTrf(entry.id)}
                                  disabled={deletingTrfId === entry.id}
                                >
                                  {deletingTrfId === entry.id ? <RotaryLoader size="sm" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="mt-3 text-right font-semibold text-sm">
                      Total: ${trfContributions.reduce((sum, e) => sum + e.amountUSD, 0).toLocaleString()} USD
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Projects */}
            {currentStep === 2 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="h-5 w-5" />
                    Projects
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Select value={addProjectType} onValueChange={setAddProjectType}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select service type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROJECT_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Link
                      href={addProjectType ? getAddProjectUrl(addProjectType) : "#"}
                      onClick={(e) => {
                        if (!addProjectType) {
                          e.preventDefault();
                          setError("Please select a service type first");
                        }
                      }}
                    >
                      <Button size="sm" disabled={!addProjectType}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Project
                      </Button>
                    </Link>
                  </div>
                </div>

                {Object.keys(PROJECT_LABELS).every(
                  (key) => !projects[key] || projects[key].length === 0
                ) ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p className="text-lg font-medium">No projects for this month</p>
                    <p className="text-sm mt-1">Select a service type and click &quot;Add Project&quot; to create one</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(PROJECT_LABELS).map(([serviceType, label]) => {
                      const items = projects[serviceType] || [];
                      if (items.length === 0) return null;
                      const isCollapsed = collapsedSections[serviceType];
                      return (
                        <div key={serviceType} className="border rounded-lg">
                          <button
                            className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                            onClick={() => toggleSection(serviceType)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{label}</span>
                              <Badge variant="secondary">{items.length}</Badge>
                            </div>
                            <ArrowRight
                              className={`h-4 w-4 transition-transform ${
                                isCollapsed ? "" : "rotate-90"
                              }`}
                            />
                          </button>
                          {!isCollapsed && (
                            <div className="px-4 pb-4 overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-16">Sr.No</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Title</TableHead>
                                    {serviceType === "community_service" ? (
                                      <>
                                        <TableHead>Area of Focus</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead>Sub Category</TableHead>
                                      </>
                                    ) : (
                                      <>
                                        <TableHead>Category</TableHead>
                                        <TableHead>Sub Category</TableHead>
                                      </>
                                    )}
                                    <TableHead className="w-24 text-center">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {items.map((project, index) => (
                                    <TableRow key={project.projectId}>
                                      <TableCell>{index + 1}</TableCell>
                                      <TableCell>{formatDate(project.projectDate)}</TableCell>
                                      <TableCell className="font-medium">
                                        <span className="flex items-center gap-2">
                                          {project.title}
                                          {(serviceType === "community_service" || serviceType === "public_image_initiative") && (
                                            <>
                                              {project.projectType && (
                                                <Badge className={project.projectType === "one_time"
                                                  ? "bg-blue-100 text-blue-800 border-blue-300 text-xs"
                                                  : "bg-purple-100 text-purple-800 border-purple-300 text-xs"}>
                                                  {project.projectType === "one_time" ? "One Time" : "Ongoing"}
                                                </Badge>
                                              )}
                                              {project.parentProjectId && (
                                                <Badge className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                                                  Child Project
                                                </Badge>
                                              )}
                                            </>
                                          )}
                                        </span>
                                      </TableCell>
                                      {serviceType === "community_service" ? (
                                        <>
                                          <TableCell>{project.areaOfFocusName || "-"}</TableCell>
                                          <TableCell>{project.categoryName || "-"}</TableCell>
                                          <TableCell>{project.subCategoryName || "-"}</TableCell>
                                        </>
                                      ) : (
                                        <>
                                          <TableCell>{project.areaOfFocusName || "-"}</TableCell>
                                          <TableCell>{project.categoryName || "-"}</TableCell>
                                        </>
                                      )}
                                      <TableCell>
                                        <div className="flex items-center justify-center gap-1">
                                          <Link
                                            href={getEditProjectUrl(
                                              serviceType,
                                              project.projectId
                                            )}
                                          >
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-8 w-8"
                                            >
                                              <Pencil className="h-4 w-4" />
                                            </Button>
                                          </Link>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-destructive"
                                            onClick={() =>
                                              handleDeleteProject(
                                                project.projectId,
                                                serviceType
                                              )
                                            }
                                            disabled={deletingId === project.projectId}
                                          >
                                            {deletingId === project.projectId ? <RotaryLoader size="sm" /> : <Trash2 className="h-4 w-4" />}
                                          </Button>
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
              </div>
            )}

            {/* Step 4: Members Info */}
            {currentStep === 3 && (
              <div>
                <CardTitle className="flex items-center gap-2 mb-4">
                  <Users className="h-5 w-5" />
                  Members Info
                </CardTitle>
                <p className="text-muted-foreground mb-6">
                  Please enter the membership change in current month.
                </p>
                <div className="grid gap-6 max-w-lg">
                  <div>
                    <Label htmlFor="memberCountLastMonth">
                      Member count as on last month <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="memberCountLastMonth"
                      type="number"
                      min={0}
                      value={memberCountLastMonth}
                      onChange={(e) =>
                        setMemberCountLastMonth(parseInt(e.target.value) || 0)
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="membersDeleted">
                      Members Deleted/Terminated <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="membersDeleted"
                      type="number"
                      min={0}
                      value={membersDeleted}
                      onChange={(e) =>
                        setMembersDeleted(parseInt(e.target.value) || 0)
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="membersAdded">
                      Members Added <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="membersAdded"
                      type="number"
                      min={0}
                      value={membersAdded}
                      onChange={(e) =>
                        setMembersAdded(parseInt(e.target.value) || 0)
                      }
                    />
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Current No. Of Members</span>
                      <span className="text-2xl font-bold text-primary">
                        {memberCountLastMonth - membersDeleted + membersAdded}
                      </span>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="additionalRemarks">Additional achievement/participation/hosting of events/projects above club if any</Label>
                    <Textarea
                      id="additionalRemarks"
                      maxLength={1000}
                      rows={4}
                      value={additionalRemarks}
                      onChange={(e) => setAdditionalRemarks(e.target.value)}
                      placeholder="Please input details of participation /hosting of events or projects above club level with Date, short description, Participated Rotarians etc."
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {additionalRemarks.length}/1000 characters
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between mt-6">
          <div>
            {currentStep > 0 && (
              <Button variant="outline" onClick={handlePrevious} disabled={saving}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentStep < 3 && (
              <Button onClick={handleNext} disabled={saving}>
                {saving ? <RotaryLoader size="sm" /> : <Save className="h-4 w-4 mr-1" />}
                {saving ? "Saving..." : "Save and Next"}
                {!saving && <ArrowRight className="h-4 w-4 ml-1" />}
              </Button>
            )}
            {currentStep === 3 && (
              <Button onClick={handleSaveAndGenerate} disabled={saving}>
                {saving ? <RotaryLoader size="sm" /> : <FileText className="h-4 w-4 mr-1" />}
                {saving ? "Saving..." : "Save & Generate Report"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getMonthlyReportPreview, uploadMonthlyReportToDistrict, sendMonthlyReportEmail } from "@/services/api";
import { generatePDFBase64 } from "@/utils/reportDownload";
import { MonthlyReportPreview, ReportMeeting, ReportProject } from "@/types/clubMonthlyReport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Upload, Calendar, DollarSign, Users,
  FolderOpen, FileText, BarChart3, CheckCircle2,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

const PROJECT_LABELS: Record<string, string> = {
  community_service: "Community Service",
  vocational_service: "Vocational Service",
  international_service: "International Service",
  new_generation_service: "New Generation Service",
  public_image_initiative: "Public Image Initiative",
};

function formatReportDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day}, ${dd} ${mon} ${year} ${hh}:${mm}:${ss} ${ampm}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function MonthlyReportPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const yearId = Number(params.yearId);
  const month = Number(params.month);

  const [report, setReport] = useState<MonthlyReportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    async function fetchPreview() {
      try {
        setLoading(true);
        setError("");
        const data = await getMonthlyReportPreview(clubId, yearId, month);
        setReport(data);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axiosErr = err as any;
        const respData = axiosErr?.response?.data;
        const msg = respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load report preview");
        console.error("Preview error:", respData || err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    if (clubId && yearId && month) {
      fetchPreview();
    }
  }, [clubId, yearId, month]);

  const handleUpload = async () => {
    if (!report) return;
    try {
      setUploading(true);
      setError("");
      setSuccess("");

      // 1. Upload to district
      await uploadMonthlyReportToDistrict(clubId, report.reportId);

      // 2. Re-fetch preview to get updated uploadedToDistrictDate
      const updatedReport = await getMonthlyReportPreview(clubId, yearId, month);
      setReport(updatedReport);

      // 3. Generate PDF as base64
      const pdfBase64 = generatePDFBase64(updatedReport);

      // 4. Send email with PDF attachment
      let emailMessage = "";
      try {
        const emailResult = await sendMonthlyReportEmail(clubId, {
          pdfBase64,
          yearId,
          month,
          monthName: updatedReport.monthName,
          clubName: updatedReport.clubName,
          yearLabel: updatedReport.yearLabel,
        });

        const parts: string[] = [];
        if (emailResult.sentTo.length > 0) {
          parts.push(`Email sent to: ${emailResult.sentTo.join(", ")}`);
        }
        if (emailResult.warnings.length > 0) {
          parts.push(`Warning: ${emailResult.warnings.join("; ")}`);
        }
        emailMessage = parts.join(". ");
      } catch {
        emailMessage = "Warning: Report uploaded but failed to send email.";
      }

      // 5. Show success with email info, then redirect
      const fullMessage = `Report uploaded to district successfully. ${emailMessage}`;
      setSuccess(fullMessage);
      setTimeout(() => {
        router.push(`/clubs/${clubId}/club-monthly-report`);
      }, 4000);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      const msg = respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to upload report to district");
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handlePrevious = () => {
    router.push(`/clubs/${clubId}/club-monthly-report/${yearId}/${month}`);
  };

  if (loading) return <RotaryLoader />;

  if (error && !report) {
    return (
      <div className="container mx-auto p-6 max-w-5xl">
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError("")} />
        <Button variant="outline" onClick={handlePrevious} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Edit
        </Button>
      </div>
    );
  }

  if (!report) return null;

  // Group meetings by type
  const meetingsByType: Record<string, ReportMeeting[]> = {};
  for (const meeting of report.meetings) {
    const type = meeting.meetingType || "other";
    if (!meetingsByType[type]) meetingsByType[type] = [];
    meetingsByType[type].push(meeting);
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl print:p-2 print:max-w-full">
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError("")} />
      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess("")} />

      {/* Report Header */}
      <Card className="mb-6 print:shadow-none print:border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Club Monthly Report For {report.monthName} {report.yearLabel}
            </CardTitle>
            {report.isUploadedToDistrict && (
              <Badge className="bg-green-100 text-green-800 border-green-300">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Uploaded to District
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {formatReportDate(report.reportDate)}
          </p>
          {report.isUploadedToDistrict && report.uploadedToDistrictDate && (
            <p className="text-base font-semibold text-green-700 mt-2">
              Uploaded to District: {formatReportDate(report.uploadedToDistrictDate)}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex">
              <span className="font-medium w-48 shrink-0">Club Name</span>
              <span>: {report.clubName}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">Prepared By</span>
              <span>: {report.preparedBy || "-"}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">Rotary Club ID</span>
              <span>: {report.clubCode || "-"}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">Designation</span>
              <span>: {report.designation || "-"}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">Assistant Governor</span>
              <span>: {report.assistantGovernor || "N/A"}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">No. Of Members</span>
              <span>: {report.currentMemberCount}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">No. Of Meetings</span>
              <span>: {report.totalMeetings}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">Average % of Attendance</span>
              <span>: {report.averageAttendance}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TRF Contribution Section */}
      <Card className="mb-6 print:shadow-none print:border">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            TRF Contribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm mb-4">
            <div className="flex">
              <span className="font-medium w-48 shrink-0">Current Month</span>
              <span>: ${report.trfCurrentMonth.toFixed(2)}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-48 shrink-0">This Year</span>
              <span>: ${report.trfThisYear.toFixed(2)}</span>
            </div>
          </div>
          {report.trfEntries.length > 0 && (
            <div className="overflow-x-auto">
              <Table className="border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 border">Sr.No</TableHead>
                    <TableHead className="border">Date</TableHead>
                    <TableHead className="border">Name</TableHead>
                    <TableHead className="text-right border">Amount (USD)</TableHead>
                    <TableHead className="border">Fund Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.trfEntries.map((entry, idx) => (
                    <TableRow key={entry.trfId}>
                      <TableCell className="border">{idx + 1}</TableCell>
                      <TableCell className="border">{formatDate(entry.trfDate)}</TableCell>
                      <TableCell className="border">{entry.donorName}</TableCell>
                      <TableCell className="text-right border">${entry.amountUSD.toFixed(2)}</TableCell>
                      <TableCell className="border">
                        {entry.fundType === "Other" && entry.otherFundName
                          ? entry.otherFundName
                          : entry.fundType}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {report.trfEntries.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No TRF entries for this month.</p>
          )}
        </CardContent>
      </Card>

      {/* Meetings Section */}
      <Card className="mb-6 print:shadow-none print:border">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Meetings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(meetingsByType).length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No meetings recorded for this month.</p>
          ) : (
            Object.entries(meetingsByType).map(([type, meetings]) => (
              <div key={type} className="mb-4 last:mb-0">
                <h4 className="font-medium text-sm mb-2 text-primary">
                  {MEETING_TYPE_LABELS[type] || type} ({meetings.length})
                </h4>
                <div className="overflow-x-auto">
                  <Table className="border">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 border">Sr.No</TableHead>
                        <TableHead className="border">Date</TableHead>
                        <TableHead className="border">Title</TableHead>
                        <TableHead className="text-right border">Attendance</TableHead>
                        <TableHead className="text-right border">Attendance %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {meetings.map((meeting, idx) => (
                        <TableRow key={meeting.projectId}>
                          <TableCell className="border">{idx + 1}</TableCell>
                          <TableCell className="border">{formatDate(meeting.projectDate)}</TableCell>
                          <TableCell className="border">{meeting.title}</TableCell>
                          <TableCell className="text-right border">{meeting.attendance ?? "-"}</TableCell>
                          <TableCell className="text-right border">
                            {meeting.attendancePercentage != null
                              ? `${meeting.attendancePercentage}%`
                              : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Projects Sections */}
      {Object.entries(PROJECT_LABELS).map(([key, label]) => {
        const projects = report.projects[key];
        if (!projects || projects.length === 0) return null;
        const isCommunityService = key === "community_service";
        return (
          <Card key={key} className="mb-6 print:shadow-none print:border">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <FolderOpen className="w-5 h-5" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="border">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 border">Sr.No</TableHead>
                      <TableHead className="border">Date</TableHead>
                      <TableHead className="border">Title</TableHead>
                      {isCommunityService ? (
                        <>
                          <TableHead className="border">Area of Focus</TableHead>
                          <TableHead className="border">Category</TableHead>
                          <TableHead className="border">Sub Category</TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead className="border">Category</TableHead>
                          <TableHead className="border">Sub Category</TableHead>
                        </>
                      )}
                      <TableHead className="text-right border">Cost</TableHead>
                      <TableHead className="text-right border">Direct Beneficiaries</TableHead>
                      <TableHead className="text-right border">Man Hours</TableHead>
                      <TableHead className="text-right border">Rotarians Involved</TableHead>
                      <TableHead className="text-right border">Rotaractors Involved</TableHead>
                      <TableHead className="text-right border">RCC Involved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((project, idx) => (
                      <TableRow key={project.projectId}>
                        <TableCell className="border">{idx + 1}</TableCell>
                        <TableCell className="whitespace-nowrap border">{formatDate(project.projectDate)}</TableCell>
                        <TableCell className="border">
                          <span className="flex items-center gap-2">
                            {project.title}
                            {(key === "community_service" || key === "public_image_initiative") && (
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
                        {isCommunityService ? (
                          <>
                            <TableCell className="border">{project.areaOfFocusName || "-"}</TableCell>
                            <TableCell className="border">{project.categoryName || "-"}</TableCell>
                            <TableCell className="border">{project.subCategoryName || "-"}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="border">{project.areaOfFocusName || "-"}</TableCell>
                            <TableCell className="border">{project.categoryName || "-"}</TableCell>
                          </>
                        )}
                        <TableCell className="text-right border">
                          {project.projectCost != null ? project.projectCost.toLocaleString() : "-"}
                        </TableCell>
                        <TableCell className="text-right border">{project.directBeneficiaries ?? "-"}</TableCell>
                        <TableCell className="text-right border">{project.manHours ?? "-"}</TableCell>
                        <TableCell className="text-right border">{project.rotariansInvolved ?? "-"}</TableCell>
                        <TableCell className="text-right border">{project.rotaractorsInvolved ?? "-"}</TableCell>
                        <TableCell className="text-right border">{project.rccInvolved ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Members Section */}
      <Card className="mb-6 print:shadow-none print:border">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm mb-4">
            <div className="flex">
              <span className="font-medium w-56 shrink-0">Member count as on last month</span>
              <span>: {report.memberCountLastMonth}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-56 shrink-0">Members Deleted/Terminated</span>
              <span>: {report.membersDeleted}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-56 shrink-0">Members Added</span>
              <span>: {report.membersAdded}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-56 shrink-0">Current No. Of Members</span>
              <span>: {report.currentMemberCount}</span>
            </div>
          </div>
          {report.additionalRemarks && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-1">
                Additional achievement/participation/hosting of events/projects above club if any:
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {report.additionalRemarks}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Note */}
      <Card className="mb-6 bg-amber-50 border-amber-200 print:shadow-none print:border">
        <CardContent className="pt-4">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> Agenda, MOM added in meeting &amp; Photographs added in Club
            Meetings will not be shared to the District, only the content displayed here will be
            shared to the District.
          </p>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="outline" onClick={handlePrevious}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Previous (Edit)
        </Button>
        <div className="flex items-center gap-3">
          {report.isUploadedToDistrict && (
            <Badge className="bg-green-100 text-green-800 border-green-300">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Uploaded to District
            </Badge>
          )}
          <Button
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <><RotaryLoader size="sm" /> Uploading...</>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" /> Upload to District
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MonthlyReportPreviewPageWrapper() {
  return (
    <ProtectedRoute>
      <MonthlyReportPreviewPage />
    </ProtectedRoute>
  );
}

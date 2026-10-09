"use client";

import { useState, useEffect } from "react";
import { useFeature } from "@/contexts/BrandContext";
import { useParams, useSearchParams } from "next/navigation";
import { getClubReport, getClubReportAvailableYears } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { ArrowLeft, Calendar, Download, FileSpreadsheet, BarChart3, Users, Megaphone, CalendarClock, Newspaper, FileText, CheckSquare, Award, UserCircle, IndianRupee } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: any; color: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color}`}><Icon className="h-5 w-5 text-white" /></div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportSection({ title, icon: Icon, count, onExport }: { title: string; icon: React.ElementType; count: number; onExport: () => void }) {
  const hasData = count > 0;
  return (
    <Card className={hasData ? "" : "opacity-60"}>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{count} {count === 1 ? "record" : "records"}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onExport} disabled={!hasData}>
          <Download className="mr-2 h-3 w-3" />Download
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ClubReportPage() {
  const params = useParams();
  const showBloodGroup = useFeature("member.bloodGroup");
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const urlYearId = searchParams.get("yearId");

  const [years, setYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const yrs = await getClubReportAvailableYears(clubId);
        setYears(yrs || []);
        if (urlYearId) setSelectedYearId(urlYearId);
        else if (yrs.length > 0) {
          const cur = yrs.find((y: any) => y.isCurrent);
          setSelectedYearId(String(cur?.id || yrs[0].id));
        }
      } catch { setErrorMessage("Failed to load years."); }
      finally { setLoading(false); }
    })();
  }, [clubId, urlYearId]);

  useEffect(() => {
    if (!selectedYearId) return;
    (async () => {
      setReportLoading(true);
      try {
        const data = await getClubReport(clubId, Number(selectedYearId));
        setReport(data);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load report.");
      } finally { setReportLoading(false); }
    })();
  }, [clubId, selectedYearId]);

  const yearLabel = years.find((y: any) => String(y.id) === selectedYearId)?.yearLabel || "";
  const clubName = report?.club?.clubName || "";

  const exportSection = (data: any[], sectionName: string, columns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string }[]) => {
    if (!data || data.length === 0) return;
    exportToCSV(data, `${clubName}_${sectionName.replace(/\s+/g, "_")}`, columns, {
      title: `${sectionName} — ${clubName}`,
      subtitle: `Rotary Year: ${yearLabel}`,
    });
    setSuccessMessage(`${sectionName} exported.`);
  };

  if (loading) return <ProtectedRoute><div className="flex justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Club Report</h2>
              <p className="text-muted-foreground text-base">{clubName} — Comprehensive club activity report</p>
            </div>
          </div>
          {years.length > 0 && (
            <div className="w-full sm:w-56">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger><Calendar className="mr-2 h-4 w-4 text-muted-foreground" /><SelectValue placeholder="Select Year" /></SelectTrigger>
                <SelectContent>
                  {years.map((y: any) => (
                    <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {reportLoading ? (
          <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : !report ? (
          <div className="text-center py-20 text-muted-foreground">No report data available.</div>
        ) : (
          <>
            {/* Summary Stats */}
            <div>
              <h3 className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Summary — {yearLabel}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard icon={Award} label="Projects" value={report.summary.totalProjects} color="bg-blue-500" />
                <StatCard icon={Megaphone} label="Announcements" value={report.summary.totalAnnouncements} color="bg-purple-500" />
                <StatCard icon={CalendarClock} label="Events" value={report.summary.totalEvents} color="bg-indigo-500" />
                <StatCard icon={Newspaper} label="Newsletters" value={report.summary.totalNewsletters} color="bg-pink-500" />
                <StatCard icon={FileText} label="Documents" value={report.summary.totalDocuments} color="bg-amber-500" />
                <StatCard icon={CheckSquare} label="Meetings" value={`${report.summary.totalMeetings} (${report.summary.avgAttendancePercent}%)`} color="bg-green-500" />
                <StatCard icon={Users} label="Members" value={report.summary.activeMembers} color="bg-cyan-500" />
                <StatCard icon={UserCircle} label="BOD" value={report.summary.bodCount} color="bg-emerald-500" />
                <StatCard icon={IndianRupee} label="TRF Amount (USD)" value={`$${Number(report.summary.totalTrfAmount).toLocaleString("en-US")}`} color="bg-rose-500" />
                <StatCard icon={IndianRupee} label="TRF Entries" value={report.summary.totalTrfContributions} color="bg-orange-500" />
              </div>
            </div>

            {/* Projects grouped by module — Club Service has no AOF/Category/Sub Category, omit those columns. */}
            {Object.entries(report.projectsByModule || {}).map(([moduleKey, projects]: any) => {
              const moduleName = projects[0]?.moduleName || moduleKey;
              const isClubService = moduleKey === "club_service";
              const projectCols = isClubService
                ? [
                    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
                    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
                    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
                    { key: "funding", label: "Funding", width: 15 }, { key: "approvalStatus", label: "Status", width: 14 },
                    { key: "publicPhotoUrl", label: "Photos", width: 12, hyperlink: true, linkText: "Photos" },
                  ]
                : [
                    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
                    { key: "areaOfFocus", label: "Area of Focus", width: 20 }, { key: "category", label: "Category", width: 18 },
                    { key: "subCategory", label: "Sub Category", width: 18 },
                    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
                    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
                    { key: "funding", label: "Funding", width: 15 }, { key: "approvalStatus", label: "Status", width: 14 },
                    { key: "publicPhotoUrl", label: "Photos", width: 12, hyperlink: true, linkText: "Photos" },
                  ];
              return (
                <ReportSection
                  key={moduleKey}
                  title={moduleName}
                  icon={Award}
                  count={projects.length}
                  onExport={() => exportSection(projects, moduleName, projectCols)}
                />
              );
            })}

            <ReportSection title="Announcements" icon={Megaphone} count={report.announcements?.length || 0}
              onExport={() => exportSection(report.announcements, "Announcements", [
                { key: "title", label: "Title", width: 25 }, { key: "description", label: "Description", width: 30 },
                { key: "imagePath", label: "Image", width: 14, hyperlink: true, linkText: "Image" },
                { key: "publishDate", label: "Publish Date", width: 18 }, { key: "expiryDate", label: "Expiry Date", width: 18 },
                { key: "status", label: "Status", width: 14 },
              ])} />

            <ReportSection title="Upcoming Events" icon={CalendarClock} count={report.events?.length || 0}
              onExport={() => exportSection(report.events, "Upcoming_Events", [
                { key: "title", label: "Title", width: 25 }, { key: "description", label: "Description", width: 30 },
                { key: "eventDate", label: "Event Date", width: 18 }, { key: "eventVenue", label: "Venue", width: 20 },
                { key: "imagePath", label: "Image", width: 14, hyperlink: true, linkText: "Image" },
                { key: "registrationLink", label: "Registration", width: 14, hyperlink: true, linkText: "Link" },
                { key: "publishDate", label: "Publish Date", width: 18 }, { key: "status", label: "Status", width: 14 },
              ])} />

            <ReportSection title="Newsletters" icon={Newspaper} count={report.newsletters?.length || 0}
              onExport={() => exportSection(report.newsletters, "Newsletters", [
                { key: "title", label: "Title", width: 25 }, { key: "publishDate", label: "Publish Date", width: 18 },
                { key: "expiryDate", label: "Expiry", width: 18 }, { key: "attachmentType", label: "Type", width: 12 },
                { key: "status", label: "Status", width: 14 },
              ])} />

            <ReportSection title="Documents" icon={FileText} count={report.documents?.length || 0}
              onExport={() => exportSection(report.documents, "Documents", [
                { key: "title", label: "Title", width: 25 }, { key: "accessType", label: "Access", width: 14 },
                { key: "publishDate", label: "Publish", width: 18 }, { key: "expiryDate", label: "Expiry", width: 18 },
              ])} />

            <ReportSection title="Attendance" icon={CheckSquare} count={report.attendance?.length || 0}
              onExport={() => exportSection(report.attendance, "Attendance", [
                { key: "eventName", label: "Event", width: 25 }, { key: "eventDateTime", label: "Date", width: 18 },
                { key: "membersPresent", label: "Members Present", width: 16 }, { key: "visitors", label: "Visitors", width: 10 },
                { key: "rotarians", label: "Rotarians", width: 10 }, { key: "totalMembers", label: "Total Active", width: 12 },
                { key: "attendancePercent", label: "Attendance %", width: 14 },
              ])} />

            <ReportSection title="Board of Directors" icon={UserCircle} count={report.bod?.length || 0}
              onExport={() => exportSection(report.bod, "Board_of_Directors", [
                { key: "designation", label: "Designation", width: 25 }, { key: "memberName", label: "Name", width: 25 },
                { key: "mobile", label: "Mobile", width: 15 }, { key: "email", label: "Email", width: 25 },
              ])} />

            <ReportSection title="Active Members" icon={Users} count={report.members?.length || 0}
              onExport={() => exportSection(report.members, "Members", [
                { key: "memberName", label: "Name", width: 25 }, { key: "mobile", label: "Mobile", width: 15 },
                { key: "email", label: "Email", width: 25 }, { key: "rotaryId", label: "Rotary ID", width: 15 },
                { key: "joinedDate", label: "Joined", width: 15 }, ...(showBloodGroup ? [{ key: "bloodGroup", label: "Blood Group", width: 12 }] : []),
              ])} />

            <ReportSection title="TRF Contributions" icon={IndianRupee} count={report.trf?.length || 0}
              onExport={() => exportSection(report.trf, "TRF_Contributions", [
                { key: "donorName", label: "Donor", width: 25 }, { key: "fundName", label: "Fund", width: 20 },
                { key: "fundType", label: "Type", width: 15 }, { key: "amountUsd", label: "Amount (USD)", width: 15 },
                { key: "trfDate", label: "Date", width: 18 },
              ])} />
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}

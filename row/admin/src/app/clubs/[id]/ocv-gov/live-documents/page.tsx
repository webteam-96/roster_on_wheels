"use client";

import { useState, useEffect } from "react";
import { useFeature } from "@/contexts/BrandContext";
import { useParams, useSearchParams } from "next/navigation";
import { getClub, getMonthlyReportYears, getLiveDocumentsExport } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import { formatBirthAnniversary } from "@/lib/dateUtils";

// Strip year from birthday + anniversary columns before exporting — matches the
// project-wide rule (year stays in the DB and only shows in edit forms).
const BIRTH_ANNIV_FIELDS = ["birthDate", "anniversaryDate", "familyBirthDate", "familyAnniversaryDate"];
function stripYear<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const k of BIRTH_ANNIV_FIELDS) {
      if (out[k] != null) out[k] = formatBirthAnniversary(out[k] as string);
    }
    return out as T;
  });
}
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { ArrowLeft, Download, FileSpreadsheet, FolderOpen, Users, Calendar } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface ModuleItem {
  key: string;
  label: string;
  group: "ocv" | "club";
  columns: { key: string; label: string; width?: number }[];
}

const modules: ModuleItem[] = [
  // OCV/GOV Documents
  { key: "static_documents", label: "Static Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "paidOn", label: "Paid On", width: 15 },
    { key: "customType", label: "Custom Type", width: 20 }, { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "financial_documents", label: "Financial Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "paidOn", label: "Paid On", width: 15 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "trust_documents", label: "Trust Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "grants", label: "Grants", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "additional_documents", label: "Additional Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "dues", label: "Dues", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "paidOn", label: "Paid On", width: 15 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  // Club Modules
  { key: "community_service", label: "Community Service Projects", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 }, { key: "category", label: "Category", width: 18 },
    { key: "subCategory", label: "Sub Category", width: 18 }, { key: "location", label: "Location", width: 20 },
    { key: "projectCost", label: "Cost", width: 12 }, { key: "directBeneficiaries", label: "Beneficiaries", width: 14 },
    { key: "manHours", label: "Man Hours", width: 12 }, { key: "funding", label: "Funding", width: 15 },
    { key: "approvalStatus", label: "Status", width: 12 },
  ]},
  { key: "vocational_service", label: "Vocational Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 }, { key: "category", label: "Category", width: 18 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "international_service", label: "International Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 }, { key: "category", label: "Category", width: 18 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "new_generation_service", label: "New Generation Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 }, { key: "category", label: "Category", width: 18 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "public_image_initiative", label: "Public Image Initiative", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 }, { key: "category", label: "Category", width: 18 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "club_service", label: "Club Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 }, { key: "category", label: "Category", width: 18 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "announcements", label: "Announcements", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "description", label: "Description", width: 30 },
    { key: "publishDate", label: "Publish Date", width: 18 }, { key: "expiryDate", label: "Expiry Date", width: 18 },
  ]},
  { key: "upcoming_events", label: "Upcoming Events", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "eventDate", label: "Event Date", width: 18 },
    { key: "eventVenue", label: "Venue", width: 20 }, { key: "publishDate", label: "Publish Date", width: 18 },
    { key: "status", label: "Status", width: 12 }, { key: "registrationLink", label: "Link", width: 25 },
  ]},
  { key: "newsletters", label: "Newsletters", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "publishDate", label: "Publish Date", width: 18 },
    { key: "expiryDate", label: "Expiry Date", width: 18 }, { key: "attachmentType", label: "Type", width: 10 },
    { key: "status", label: "Status", width: 12 },
  ]},
  { key: "documents", label: "Documents", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "accessType", label: "Access Type", width: 15 },
    { key: "publishDate", label: "Publish Date", width: 18 }, { key: "expiryDate", label: "Expiry Date", width: 18 },
  ]},
  { key: "attendance", label: "Attendance", group: "club", columns: [
    { key: "eventName", label: "Event", width: 25 }, { key: "eventDateTime", label: "Date", width: 18 },
    { key: "membersPresent", label: "Members Present", width: 16 }, { key: "visitors", label: "Visitors", width: 10 },
    { key: "rotarians", label: "Rotarians", width: 10 }, { key: "totalMembers", label: "Total Active", width: 12 },
    { key: "attendancePercent", label: "Attendance %", width: 14 },
  ]},
  { key: "board_of_directors", label: "Board of Directors", group: "club", columns: [
    { key: "designation", label: "Designation", width: 25 }, { key: "memberName", label: "Name", width: 25 },
    { key: "mobile", label: "Mobile", width: 15 }, { key: "email", label: "Email", width: 25 },
  ]},
  { key: "members", label: "Members", group: "club", columns: [
    { key: "memberName", label: "Name", width: 25 }, { key: "mobile", label: "Mobile", width: 15 },
    { key: "email", label: "Email", width: 25 }, { key: "rotaryId", label: "Rotary ID", width: 15 },
    { key: "gender", label: "Gender", width: 10 }, { key: "birthDate", label: "Birth Date", width: 15 },
    { key: "anniversaryDate", label: "Anniversary", width: 15 }, { key: "bloodGroup", label: "Blood Group", width: 12 },
    { key: "joinedDate", label: "Joined", width: 15 }, { key: "isActive", label: "Active", width: 8 },
  ]},
  { key: "trf_contributions", label: "TRF Contributions", group: "club", columns: [
    { key: "donorName", label: "Donor", width: 25 }, { key: "fundName", label: "Fund Name", width: 20 },
    { key: "fundType", label: "Type", width: 15 }, { key: "amountUsd", label: "Amount (USD)", width: 15 },
    { key: "trfDate", label: "Date", width: 18 },
  ]},
];

export default function LiveDocumentsPage() {
  const params = useParams();
  const showBloodGroup = useFeature("member.bloodGroup");
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const urlYearId = searchParams.get("yearId");

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [club, yrs] = await Promise.all([getClub(clubId), getMonthlyReportYears(clubId)]);
        setClubName(club.clubName);
        setYears(yrs);
        if (urlYearId) setSelectedYearId(urlYearId);
        else {
          const cur = yrs.find((y: any) => y.isCurrent);
          setSelectedYearId(cur ? String(cur.id) : yrs.length > 0 ? String(yrs[0].id) : "");
        }
      } catch { setErrorMessage("Failed to load."); }
      finally { setLoading(false); }
    })();
  }, [clubId, urlYearId]);

  const handleDownload = async (mod: ModuleItem) => {
    if (!selectedYearId) { setErrorMessage("Please select a Rotary Year."); return; }
    setDownloading(mod.key);
    try {
      const data = await getLiveDocumentsExport(clubId, Number(selectedYearId), mod.key);
      const arr = Array.isArray(data) ? stripYear(data) : [];
      if (arr.length === 0) {
        setErrorMessage(`No data found for ${mod.label}.`);
        setDownloading(null);
        return;
      }
      const yearLabel = years.find((y: any) => String(y.id) === selectedYearId)?.yearLabel || "";
      exportToCSV(arr, `${clubName}_${mod.label.replace(/\s+/g, "_")}`, showBloodGroup ? mod.columns : mod.columns.filter((c) => c.key !== "bloodGroup"), {
        title: `${mod.label} | ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}`,
      });
      setSuccessMessage(`${mod.label} downloaded.`);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || `Failed to download ${mod.label}.`);
    } finally {
      setDownloading(null);
    }
  };

  const ocvModules = modules.filter(m => m.group === "ocv");
  const clubModules = modules.filter(m => m.group === "club");
  const yearLabel = years.find((y: any) => String(y.id) === selectedYearId)?.yearLabel || "";

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/ocv-gov?yearId=${selectedYearId}`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Live Documents</h2>
              <p className="text-muted-foreground text-base">{clubName}: Download Excel reports module-wise</p>
            </div>
          </div>
          {!loading && years.length > 0 && (
            <div className="w-full sm:w-52">
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

        {loading ? (
          <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : (
          <>
            {/* OCV/GOV Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-primary" />
                  OCV/GOV Documents
                  {yearLabel && <Badge variant="outline">{yearLabel}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {ocvModules.map(mod => (
                    <div key={mod.key} className="flex items-center justify-between px-6 py-3 hover:bg-muted/30">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-medium">{mod.label}</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => handleDownload(mod)} disabled={downloading === mod.key || !selectedYearId}>
                        {downloading === mod.key ? <RotaryLoader size="sm" /> : <><Download className="mr-2 h-4 w-4" />Download</>}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Club Modules Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Club Modules
                  {yearLabel && <Badge variant="outline">{yearLabel}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {clubModules.map(mod => (
                    <div key={mod.key} className="flex items-center justify-between px-6 py-3 hover:bg-muted/30">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                        <span className="text-sm font-medium">{mod.label}</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => handleDownload(mod)} disabled={downloading === mod.key || !selectedYearId}>
                        {downloading === mod.key ? <RotaryLoader size="sm" /> : <><Download className="mr-2 h-4 w-4" />Download</>}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}

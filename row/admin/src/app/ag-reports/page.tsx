"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useFeature } from "@/contexts/BrandContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Download, Loader2, Building, Users } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { RotaryYear } from "@/types/rotaryYear";
import { getAgMyYears, fetchAgReport, getAgMyClubs } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import { formatBirthAnniversary } from "@/lib/dateUtils";

// Project rule: birthdays + anniversaries DISPLAY day-month only — year stays in
// the DB and is only shown in edit forms. Strip the year from these column keys
// before writing the Excel/CSV export. Same set used by /settings/reports.
const BIRTH_ANNIV_FIELDS = [
  "birthDate", "anniversaryDate",
  "familyBirthDate", "familyAnniversaryDate",
];
function stripYearFromBirthAnnivRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const key of BIRTH_ANNIV_FIELDS) {
      if (out[key] != null) out[key] = formatBirthAnniversary(out[key] as string);
    }
    return out as T;
  });
}

interface ReportColumn { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string }
interface ReportItem {
  id: string;
  title: string;
  endpoint: string;
  fileName: string;
  columns: ReportColumn[];
  yearScoped?: boolean;
}
interface ReportSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ReportItem[];
}

const sections: ReportSection[] = [
  {
    id: "clubs", title: "My Clubs", icon: Building,
    items: [
      { id: "clubs", title: "All My Clubs", endpoint: "clubs", fileName: "MyClubs",
        columns: [
          { key: "clubName", label: "Club Name", width: 35 },
          { key: "clubRotaryId", label: "Club Rotary ID", width: 16 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "city", label: "City", width: 18 },
          { key: "state", label: "State", width: 18 },
          { key: "meetingDay", label: "Meeting Day", width: 14 },
          { key: "meetingFromTime", label: "From", width: 10 },
          { key: "meetingToTime", label: "To", width: 10 },
          { key: "meetingAddress", label: "Meeting Address", width: 40 },
          { key: "totalMembers", label: "Members", width: 10 },
          { key: "isActive", label: "Active", width: 10 },
          { key: "charterDate", label: "Charter Date", width: 16 },
        ] },
      { id: "club-websites", title: "Club Websites", endpoint: "club-websites", fileName: "MyClubs_Websites",
        columns: [
          { key: "clubName", label: "Club", width: 35 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubWebsite", label: "Website", width: 50 },
        ] },
      { id: "club-leadership", title: "Club Leadership (President & Secretary)", endpoint: "club-leadership", fileName: "MyClubs_Leadership", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 35 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "designation", label: "Designation", width: 20 },
          { key: "memberName", label: "Name", width: 28 },
          { key: "mobile", label: "Mobile", width: 15 },
          { key: "email", label: "Email", width: 28 },
        ] },
      { id: "board-of-directors", title: "Board of Directors", endpoint: "board-of-directors", fileName: "MyClubs_BOD", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 35 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "designation", label: "Designation", width: 25 },
          { key: "memberName", label: "Name", width: 28 },
          { key: "mobile", label: "Mobile", width: 15 },
          { key: "email", label: "Email", width: 28 },
        ] },
    ],
  },
  {
    id: "members", title: "Members", icon: Users,
    items: [
      { id: "club-members", title: "Members (basic)", endpoint: "club-members", fileName: "MyClubs_Members",
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "memberName", label: "Member Name", width: 28 },
          { key: "rotaryId", label: "Rotary ID", width: 14 },
          { key: "mobile", label: "Mobile", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "gender", label: "Gender", width: 10 },
          { key: "birthDate", label: "DOB", width: 14 },
          { key: "anniversaryDate", label: "Anniversary", width: 14 },
          { key: "bloodGroup", label: "Blood", width: 10 },
          { key: "joinedDate", label: "Joined", width: 14 },
        ] },
      { id: "members-full-details", title: "Members | Full Details", endpoint: "members-full-details", fileName: "MyClubs_Members_Full",
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "memberName", label: "Name", width: 28 },
          { key: "rotaryId", label: "Rotary ID", width: 14 },
          { key: "mobile", label: "Mobile", width: 15 },
          { key: "secondaryMobile", label: "Sec. Mobile", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "gender", label: "Gender", width: 10 },
          { key: "birthDate", label: "DOB", width: 14 },
          { key: "anniversaryDate", label: "Anniv.", width: 14 },
          { key: "bloodGroup", label: "Blood", width: 8 },
          { key: "primaryLanguage", label: "Lang.", width: 12 },
          { key: "donorRecognition", label: "Donor Recog.", width: 18 },
          { key: "facebook", label: "Facebook", width: 24 },
          { key: "instagram", label: "Instagram", width: 24 },
          { key: "linkedIn", label: "LinkedIn", width: 24 },
          { key: "twitter", label: "Twitter", width: 24 },
          { key: "youtube", label: "Youtube", width: 24 },
          { key: "website", label: "Website", width: 24 },
        ] },
      { id: "members-contact-summary", title: "Members | Contact Summary", endpoint: "members-contact-summary", fileName: "MyClubs_Contact_Summary",
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "memberName", label: "Name", width: 28 },
          { key: "primaryMobile", label: "Primary Mobile", width: 16 },
          { key: "secondaryMobile", label: "Secondary Mobile", width: 16 },
          { key: "email", label: "Email", width: 30 },
        ] },
      { id: "members-addresses", title: "Members | Addresses", endpoint: "members-addresses", fileName: "MyClubs_Addresses",
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "memberName", label: "Name", width: 28 },
          { key: "addressType", label: "Type", width: 14 },
          { key: "address", label: "Address", width: 40 },
          { key: "city", label: "City", width: 16 },
          { key: "state", label: "State", width: 16 },
          { key: "pinCode", label: "Postal code", width: 10 },
          { key: "phoneNumber", label: "Phone", width: 14 },
          { key: "businessName", label: "Business Name", width: 24 },
          { key: "designation", label: "Designation", width: 20 },
          { key: "classification", label: "Classification", width: 24 },
          { key: "keywords", label: "Keywords", width: 24 },
        ] },
      { id: "mobile-app-users", title: "Mobile App Users", endpoint: "mobile-app-users", fileName: "MyClubs_Mobile_App_Users",
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "memberName", label: "Name", width: 28 },
          { key: "mobile", label: "Mobile", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "lastDeviceName", label: "Device", width: 12 },
          { key: "loginCount", label: "Logins", width: 10 },
          { key: "firstVisit", label: "First Visit", width: 20 },
          { key: "lastLogin", label: "Last Login", width: 20 },
          { key: "lastLogout", label: "Last Logout", width: 20 },
        ] },
      { id: "family-details", title: "Family Details", endpoint: "family-details", fileName: "MyClubs_Family_Details",
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "rotarianName", label: "Rotarian", width: 28 },
          { key: "familyMemberName", label: "Family Member", width: 28 },
          { key: "relation", label: "Relation", width: 14 },
          { key: "mobile", label: "Mobile", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "bloodGroup", label: "Blood", width: 10 },
          { key: "birthDate", label: "DOB", width: 14 },
          { key: "anniversaryDate", label: "Anniversary", width: 14 },
        ] },
      { id: "potential-members", title: "Potential Members", endpoint: "potential-members", fileName: "MyClubs_Potential_Members",
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "memberName", label: "Name", width: 28 },
          { key: "mobile", label: "Mobile", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "classification", label: "Classification", width: 24 },
          { key: "referredBy", label: "Referred By", width: 24 },
          { key: "status", label: "Status", width: 14 },
          { key: "addedOn", label: "Added On", width: 18 },
        ] },
    ],
  },
  {
    id: "activity", title: "Activity", icon: Building,
    items: [
      { id: "club-announcements", title: "Announcements", endpoint: "club-announcements", fileName: "MyClubs_Announcements", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "title", label: "Title", width: 36 },
          { key: "description", label: "Description", width: 50 },
          { key: "imagePath", label: "Image", width: 14, hyperlink: true, linkText: "Image" },
          { key: "publishedDate", label: "Published", width: 16 },
          { key: "expiryDate", label: "Expiry", width: 16 },
        ] },
      { id: "club-upcoming-events", title: "Upcoming Events", endpoint: "club-upcoming-events", fileName: "MyClubs_Upcoming_Events", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "title", label: "Title", width: 36 },
          { key: "description", label: "Description", width: 50 },
          { key: "eventDate", label: "Date", width: 14 },
          { key: "eventTime", label: "Time", width: 12 },
          { key: "location", label: "Location", width: 30 },
        ] },
      { id: "club-attendance", title: "Attendance", endpoint: "club-attendance", fileName: "MyClubs_Attendance", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "meetingDate", label: "Meeting Date", width: 16 },
          { key: "meetingTopic", label: "Topic", width: 36 },
          { key: "totalMembers", label: "Total", width: 10 },
          { key: "presentMembers", label: "Present", width: 10 },
        ] },
      { id: "club-documents", title: "Documents", endpoint: "club-documents", fileName: "MyClubs_Documents", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "title", label: "Title", width: 36 },
          { key: "accessType", label: "Read/Download Only", width: 20 },
          { key: "documentDate", label: "Date", width: 16 },
          { key: "documentUrl", label: "Document", width: 16, hyperlink: true, linkText: "Document" },
        ] },
      { id: "newsletters", title: "Newsletters", endpoint: "newsletters", fileName: "MyClubs_Newsletters", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "title", label: "Title", width: 40 },
          { key: "publishedDate", label: "Published", width: 16 },
        ] },
      { id: "club-monthly-reports", title: "Monthly Reports", endpoint: "club-monthly-reports", fileName: "MyClubs_Monthly_Reports", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "reportMonth", label: "Month", width: 14 },
          { key: "isSubmitted", label: "Submitted?", width: 12 },
          { key: "submittedDate", label: "Submitted On", width: 18 },
        ] },
      { id: "rotary-projects", title: "Rotary Projects", endpoint: "rotary-projects", fileName: "MyClubs_Projects", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "moduleName", label: "Module", width: 18 },
          { key: "title", label: "Title", width: 36 },
          { key: "description", label: "Description", width: 50 },
          { key: "location", label: "Location", width: 24 },
          { key: "projectType", label: "Type", width: 16 },
          { key: "startDate", label: "Start", width: 14 },
          { key: "endDate", label: "End", width: 14 },
          { key: "totalBeneficiaries", label: "Beneficiaries", width: 14 },
          { key: "totalVolunteers", label: "Volunteers", width: 12 },
          { key: "totalCost", label: "Cost", width: 14 },
        ] },
      { id: "trf-contributions", title: "TRF Contributions", endpoint: "trf-contributions", fileName: "MyClubs_TRF", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "memberName", label: "Member", width: 28 },
          { key: "fundName", label: "Fund", width: 24 },
          { key: "amount", label: "Amount", width: 12 },
          { key: "recognition", label: "Recognition", width: 18 },
          { key: "contributionDate", label: "Date", width: 14 },
          { key: "remarks", label: "Remarks", width: 30 },
        ] },
      { id: "pph-camps", title: "PPH Camps", endpoint: "pph-camps", fileName: "MyClubs_PPH_Camps", yearScoped: true,
        columns: [
          { key: "clubName", label: "Club", width: 28 },
          { key: "yearLabel", label: "Year", width: 12 },
          { key: "campName", label: "Camp Name", width: 30 },
          { key: "campDate", label: "Date", width: 14 },
          { key: "location", label: "Location", width: 24 },
          { key: "beneficiaryCount", label: "Beneficiaries", width: 14 },
        ] },
    ],
  },
];

interface ClubOpt { clubId: number; clubName: string; clubRotaryId: string; districtNumber: string }

// Instance member-field flags: drop the blood-group columns and the family report when off.
function visibleSections(showBloodGroup: boolean, showFamily: boolean): ReportSection[] {
  if (showBloodGroup && showFamily) return sections;
  return sections.map((sec) => ({
    ...sec,
    items: sec.items
      .filter((it) => showFamily || it.id !== "family-details")
      .map((it) => (showBloodGroup ? it : { ...it, columns: it.columns.filter((c) => c.key !== "bloodGroup") })),
  }));
}

export default function AgReportsPage() {
  const { isAG, isAuthenticated } = useAuth();
  const showBloodGroup = useFeature("member.bloodGroup");
  const showFamily = useFeature("member.familyDetails");

  const [years, setYears] = useState<RotaryYear[]>([]);
  const [clubs, setClubs] = useState<ClubOpt[]>([]);
  const [yearId, setYearId] = useState<string>("all");
  const [clubId, setClubId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      try {
        const [ys, cs] = await Promise.all([getAgMyYears(), getAgMyClubs()]);
        setYears(ys);
        setClubs(cs);
      } catch (e: any) {
        setError(e?.response?.data?.message ?? "Failed to load filters");
      } finally { setLoading(false); }
    })();
  }, [isAuthenticated]);

  if (!isAuthenticated) return <ProtectedRoute><div /></ProtectedRoute>;
  if (!isAG) return (
    <ProtectedRoute>
      <div className="flex flex-col items-center justify-center py-20">
        <h3 className="text-lg font-semibold">Access Denied</h3>
        <p className="text-muted-foreground mt-2">Only AG (Assistant Governor) can access this page.</p>
      </div>
    </ProtectedRoute>
  );
  if (loading) return <ProtectedRoute><RotaryLoader /></ProtectedRoute>;

  const download = async (item: ReportItem) => {
    try {
      setBusyId(item.id);
      const params: Record<string, any> = {};
      if (item.yearScoped && yearId !== "all") params.yearId = Number(yearId);
      if (clubId !== "all") params.clubId = Number(clubId);

      const rawRows = await fetchAgReport(item.endpoint, params);
      const rows = Array.isArray(rawRows) ? stripYearFromBirthAnnivRows(rawRows) : rawRows;
      if (!rows || rows.length === 0) {
        setError(`${item.title}: no records found.`);
        return;
      }
      const yearSuffix = item.yearScoped && yearId !== "all"
        ? `_${(years.find(y => String(y.id) === yearId)?.yearLabel ?? "")}`.replace("/", "-")
        : "";
      const clubSuffix = clubId !== "all"
        ? `_${(clubs.find(c => String(c.clubId) === clubId)?.clubName ?? "").replace(/\s+/g, "_")}`
        : "";
      exportToCSV(rows, `${item.fileName}${yearSuffix}${clubSuffix}`, item.columns);
      setSuccess(`${item.title} downloaded (${rows.length} rows).`);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? `Failed to download ${item.title}`);
    } finally { setBusyId(null); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">My Reports</h2>
            <p className="text-muted-foreground text-base">Download reports for clubs you manage as Assistant Governor</p>
          </div>
        </div>

        <SuccessAlert open={!!success} title="Success" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error ?? ""} onOk={() => setError(null)} />

        {clubs.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            You have not been assigned any clubs yet. Please contact your district governor.
          </CardContent></Card>
        ) : (
          <>
            <Card>
              <CardHeader><CardTitle className="text-lg">Filters</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="mb-1 block">Rotary Year (for year-based reports)</Label>
                  <Select value={yearId} onValueChange={setYearId}>
                    <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Years</SelectItem>
                      {years.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1 block">Club (optional: narrow to one club)</Label>
                  <Select value={clubId} onValueChange={setClubId}>
                    <SelectTrigger><SelectValue placeholder="All My Clubs" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All My Clubs ({clubs.length})</SelectItem>
                      {clubs.map(c => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName} (D{c.districtNumber})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {visibleSections(showBloodGroup, showFamily).map(sec => (
              <Card key={sec.id}>
                <CardHeader className="flex flex-row items-center gap-3">
                  <sec.icon className="h-6 w-6 text-primary" />
                  <CardTitle className="text-lg">{sec.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sec.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => download(item)}
                        disabled={busyId === item.id}
                        className="flex items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted/40 hover:border-primary/50 disabled:opacity-60 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{item.title}</div>
                          {item.yearScoped && <div className="text-xs text-muted-foreground mt-0.5">↳ year-scoped</div>}
                        </div>
                        {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Download className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}

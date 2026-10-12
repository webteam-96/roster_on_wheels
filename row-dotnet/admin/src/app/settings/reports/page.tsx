"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Download, Loader2, Map, Building, Users, Settings as SettingsIcon, UserCheck, BarChart3 } from "lucide-react";
import { saveAs } from "file-saver";
import { useAuth } from "@/contexts/AuthContext";
import { RotaryYear } from "@/types/rotaryYear";
import { getRotaryYears, fetchReport, downloadClubAnalyticsDistrict } from "@/services/api";
import { formatBirthAnniversary, fileTimestamp } from "@/lib/dateUtils";

// Project rule: birthdays + anniversaries DISPLAY day-month only (year is stored
// in the DB and visible only inside edit forms). This list is the set of column
// keys that report endpoints surface for those fields — any column in this list
// is post-processed to "DD-MM" before being written to the Excel/CSV export.
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
import { exportToCSV } from "@/utils/csvExport";

interface ReportColumn { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string }
interface ReportItem {
  id: string;              // unique key
  title: string;           // user-visible title
  endpoint: string;        // backend endpoint under /api/admin/reports/
  fileName: string;        // xlsx file name (without extension)
  columns: ReportColumn[]; // columns for export
  yearScoped?: boolean;    // true → include yearId param + append year to filename
  districtScoped?: boolean;// true → include districtId param when a single district is selected
}

interface ReportSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ReportItem[];
}

const sections: ReportSection[] = [
  {
    id: "zones", title: "Zones", icon: Map,
    items: [
      { id: "zones", title: "All Zones", endpoint: "zones", fileName: "Zones",
        columns: [
          { key: "zoneName", label: "Zone", width: 30 },
          { key: "districtCount", label: "Districts", width: 12 },
          { key: "isActive", label: "Active", width: 10 },
          { key: "createdDate", label: "Created", width: 20 },
        ] },
      { id: "zone-coordinators", title: "Zonal Coordinators", endpoint: "zone-coordinators", fileName: "Zonal_Coordinators",
        columns: [
          { key: "zoneName", label: "Zone", width: 25 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "assignedDate", label: "Assigned", width: 18 },
        ] },
    ],
  },
  {
    id: "districts", title: "Districts", icon: Building,
    items: [
      { id: "districts", title: "All Districts", endpoint: "districts", fileName: "Districts", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 15 },
          { key: "zoneName", label: "Zone", width: 25 },
          { key: "clubCount", label: "Clubs", width: 10 },
          { key: "createdDate", label: "Created", width: 20 },
        ] },
      { id: "district-governors", title: "District Governors", endpoint: "district-governors", fileName: "District_Governors", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 15 },
          { key: "year", label: "Year", width: 12 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "email", label: "Email", width: 30 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "description", label: "Description", width: 40 },
        ] },
      { id: "district-committee", title: "District Committee", endpoint: "district-committee", fileName: "District_Committee", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "year", label: "Year", width: 10 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "email", label: "Email", width: 28 },
          { key: "designation", label: "Designation", width: 30 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "remark", label: "Remark", width: 40 },
          { key: "sortOrder", label: "Sort", width: 8 },
          { key: "isActive", label: "Active", width: 10 },
        ] },
      { id: "assistant-governors", title: "Assistant Governors (current)", endpoint: "assistant-governors", fileName: "AGs", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "clubRotaryId", label: "Assigned Club ID", width: 15 },
          { key: "assignedClub", label: "Assigned Club", width: 30 },
          { key: "isActive", label: "Active", width: 10 },
          { key: "assignedDate", label: "Assigned", width: 18 },
        ] },
      { id: "moderators", title: "Club Moderators (current)", endpoint: "moderators", fileName: "Moderators", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "clubRotaryId", label: "Assigned Club ID", width: 15 },
          { key: "assignedClub", label: "Assigned Club", width: 30 },
          { key: "isActive", label: "Active", width: 10 },
          { key: "assignedDate", label: "Assigned", width: 18 },
        ] },
      { id: "district-upcoming-events", title: "District Upcoming Events", endpoint: "district-upcoming-events", fileName: "District_Upcoming_Events", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "year", label: "Year", width: 10 },
          { key: "title", label: "Title", width: 30 },
          { key: "description", label: "Description", width: 50 },
          { key: "eventDate", label: "Event Date", width: 18 },
          { key: "venue", label: "Venue", width: 30 },
          { key: "registrationLink", label: "Registration", width: 40 },
          { key: "status", label: "Status", width: 12 },
        ] },
      { id: "zonal-awards", title: "Zonal Awards (by District)", endpoint: "zonal-awards", fileName: "Zonal_Awards", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 15 },
          { key: "year", label: "Year", width: 12 },
          { key: "entryCount", label: "Entries", width: 12 },
          { key: "totalCounts", label: "Total Counts", width: 15 },
          { key: "totalPoints", label: "Total Points", width: 15 },
        ] },
      { id: "district-citation", title: "District Awards (by Club)", endpoint: "district-citation", fileName: "District_Awards", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 12 },
          { key: "entryCount", label: "Entries", width: 10 },
          { key: "pointsEarned", label: "Points", width: 12 },
          { key: "bonusEarned", label: "Bonus", width: 12 },
          { key: "totalPoints", label: "Total", width: 12 },
        ] },
      { id: "members-full-details", title: "Members — Full Details + Family", endpoint: "members-full-details", fileName: "Members_Full_Details", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "memberName", label: "Member Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "secondaryMobile", label: "Secondary Mobile", width: 18 },
          { key: "gender", label: "Gender", width: 10 },
          { key: "birthDate", label: "Birthday", width: 15 },
          { key: "anniversaryDate", label: "Anniversary", width: 15 },
          { key: "bloodGroup", label: "Blood Group", width: 12 },
          { key: "language", label: "Language", width: 12 },
          { key: "isHonorary", label: "Honorary", width: 10 },
          { key: "isYouth", label: "Youth", width: 10 },
          { key: "joinedDate", label: "Joined Date", width: 15 },
          { key: "familyName", label: "Family Name", width: 25 },
          { key: "familyRelation", label: "Relation", width: 15 },
          { key: "familyPhone", label: "Family Phone", width: 18 },
          { key: "familyEmail", label: "Family Email", width: 25 },
          { key: "familyBirthDate", label: "Family Birthday", width: 15 },
          { key: "familyAnniversaryDate", label: "Family Anniversary", width: 15 },
          { key: "familyBloodGroup", label: "Family Blood Grp", width: 14 },
        ] },
      { id: "members-contact-summary", title: "Members — Contact Summary", endpoint: "members-contact-summary", fileName: "Members_Contact", districtScoped: true,
        columns: [
          { key: "zoneName", label: "Zone", width: 20 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "email", label: "Email", width: 30 },
        ] },
      { id: "mobile-app-users", title: "Members — Mobile App Users", endpoint: "mobile-app-users", fileName: "Mobile_App_Users", districtScoped: true,
        columns: [
          { key: "zoneName", label: "Zone", width: 20 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "loginCount", label: "Login Count", width: 12 },
          { key: "lastImei", label: "Last IMEI", width: 30 },
          { key: "lastDeviceName", label: "Device", width: 15 },
          { key: "firstVisit", label: "First Visit", width: 18 },
          { key: "lastVisit", label: "Last Visit", width: 18 },
          { key: "lastLogout", label: "Last Logout", width: 18 },
        ] },
      { id: "members-addresses", title: "Members — Addresses (Res + Business)", endpoint: "members-addresses", fileName: "Members_Addresses", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "memberName", label: "Member Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "addressType", label: "Type", width: 15 },
          { key: "address", label: "Address", width: 50 },
          { key: "city", label: "City", width: 20 },
          { key: "state", label: "State", width: 20 },
          { key: "pincode", label: "Pincode", width: 12 },
          { key: "country", label: "Country", width: 15 },
          { key: "phone", label: "Phone", width: 18 },
          { key: "businessName", label: "Business Name", width: 30 },
          { key: "businessEmail", label: "Business Email", width: 28 },
          { key: "designation", label: "Designation", width: 25 },
          { key: "profession", label: "Classification", width: 25 },
          { key: "keywords", label: "Keywords", width: 30 },
        ] },
    ],
  },
  // ── Members by Role ──
  // Per user request 2026-06-10: pivot members by role with Zone / District /
  // Club / Member name / Mobile / Email / RoleType columns. One report per
  // role, plus an "All Roles" combo. Same backend endpoint serves all of them —
  // the role passed as a query param filters server-side.
  {
    id: "members-by-role", title: "Members by Role", icon: UserCheck,
    items: ((): ReportItem[] => {
      // Per user spec 2026-06-10: report columns match their hand-written SQL —
      // DistrictNumber, ClubName, MemberName, Mobile, Email. No Zone, no Role
      // Type column (the role is implicit in which report you ran).
      const cols: ReportColumn[] = [
        { key: "districtNumber",  label: "District",   width: 14 },
        { key: "clubName",        label: "Club",       width: 32 },
        { key: "memberName",      label: "Member",     width: 30 },
        { key: "mobile",          label: "Mobile",     width: 16 },
        { key: "email",           label: "Email",      width: 30 },
      ];
      const make = (roleKey: string, title: string, file: string): ReportItem => ({
        id: `members-by-role-${roleKey}`,
        title,
        endpoint: `members-by-role${roleKey === "all" ? "" : `?role=${roleKey}`}`,
        fileName: file,
        columns: cols,
      });
      // Per user spec 2026-06-10: exclude plain "Regular Member" from the
      // pivot — only admin/officer roles surface here. Admin role is split
      // into District Admin + Club Admin (via fk scope on member_roles) +
      // a combined "All Admins" entry.
      return [
        make("all",            "All (Admin Roles)",   "Members_AllAdminRoles"),
        make("SuperAdmin",     "SuperAdmin",          "Members_SuperAdmin"),
        make("RIDirector",     "RI Directors",        "Members_RIDirectors"),
        make("AG",             "Assistant Governors", "Members_AGs"),
        make("ClubModerator",  "Club Moderators",     "Members_ClubModerators"),
        make("DistrictAdmin",  "District Admins",     "Members_DistrictAdmins"),
        make("ClubAdmin",      "Club Admins",         "Members_ClubAdmins"),
        make("AllAdmin",       "All Admins (DA + CA)","Members_AllAdmins"),
      ];
    })(),
  },
  {
    id: "clubs", title: "Clubs", icon: Users,
    items: [
      { id: "clubs", title: "All Clubs", endpoint: "clubs", fileName: "Clubs", districtScoped: true,
        columns: [
          { key: "clubRotaryId", label: "Rotary ID", width: 15 },
          { key: "clubName", label: "Club", width: 35 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "zoneName", label: "Zone", width: 20 },
          { key: "meetingDay", label: "Meeting Day", width: 15 },
          { key: "meetingAddress", label: "Meeting Address", width: 40 },
          { key: "city", label: "City", width: 20 },
          { key: "state", label: "State", width: 20 },
          { key: "country", label: "Country", width: 15 },
          { key: "pincode", label: "Pincode", width: 12 },
          { key: "latitude", label: "Latitude", width: 15 },
          { key: "longitude", label: "Longitude", width: 15 },
          { key: "clubWebsite", label: "Website", width: 35 },
          { key: "totalMembers", label: "Members", width: 12 },
          { key: "isActive", label: "Active", width: 10 },
          { key: "charterDate", label: "Charter Date", width: 18 },
        ] },
      { id: "club-members", title: "All Club Members", endpoint: "club-members", fileName: "Club_Members", districtScoped: true,
        columns: [
          { key: "memberName", label: "Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "email", label: "Email", width: 30 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "gender", label: "Gender", width: 10 },
          { key: "birthDate", label: "Birthday", width: 15 },
          { key: "anniversaryDate", label: "Anniversary", width: 15 },
          { key: "bloodGroup", label: "Blood Group", width: 12 },
          { key: "clubName", label: "Club", width: 35 },
          { key: "clubRotaryId", label: "Club Rotary ID", width: 15 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "zoneName", label: "Zone", width: 20 },
          { key: "joinedDate", label: "Joined Date", width: 15 },
        ] },
      { id: "club-leadership", title: "Club Leadership (Pres/Sec)", endpoint: "club-leadership", fileName: "Club_Leadership", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubRotaryId", label: "Club Rotary ID", width: 15 },
          { key: "clubName", label: "Club", width: 35 },
          { key: "year", label: "Year", width: 12 },
          { key: "designation", label: "Designation", width: 20 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "email", label: "Email", width: 30 },
          { key: "mobile", label: "Mobile", width: 18 },
        ] },
      { id: "club-websites", title: "Club Websites", endpoint: "club-websites", fileName: "Club_Websites", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "clubRotaryId", label: "Club Rotary ID", width: 15 },
          { key: "subdomain", label: "Subdomain", width: 35 },
          { key: "thirdPartyDomain", label: "Third party Domain", width: 30 },
          { key: "theme", label: "Template", width: 20 },
          { key: "startDate", label: "Start Date", width: 15 },
          { key: "endDate", label: "End Date", width: 15 },
          { key: "daysLeft", label: "Days Left", width: 10 },
          { key: "status", label: "Status", width: 15 },
          { key: "amountPaid", label: "Amount", width: 12 },
          { key: "transactionId", label: "Transaction ID", width: 20 },
          { key: "paymentDate", label: "Payment Date", width: 15 },
        ] },
      { id: "district-websites", title: "District Websites", endpoint: "district-websites", fileName: "District_Websites", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 15 },
          { key: "subdomain", label: "Subdomain", width: 35 },
          { key: "thirdPartyDomain", label: "Third party Domain", width: 30 },
          { key: "status", label: "Status", width: 15 },
          { key: "notes", label: "Notes", width: 40 },
          { key: "createdDate", label: "Created", width: 18 },
        ] },
      { id: "board-of-directors", title: "Board of Directors", endpoint: "board-of-directors", fileName: "Board_Of_Directors", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubRotaryId", label: "Club Rotary ID", width: 15 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "designation", label: "Designation", width: 25 },
          { key: "memberName", label: "Name", width: 30 },
          { key: "rotaryId", label: "Rotary ID", width: 15 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "syncSource", label: "Source", width: 12 },
        ] },
      { id: "club-announcements", title: "Club Announcements", endpoint: "club-announcements", fileName: "Club_Announcements", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "title", label: "Title", width: 30 },
          { key: "description", label: "Description", width: 50 },
          { key: "publishDate", label: "Publish", width: 18 },
          { key: "expiryDate", label: "Expiry", width: 18 },
          { key: "status", label: "Status", width: 12 },
          { key: "displayBanner", label: "On Banner", width: 10 },
          { key: "sendWhatsApp", label: "WhatsApp", width: 10 },
        ] },
      { id: "club-upcoming-events", title: "Club Upcoming Events", endpoint: "club-upcoming-events", fileName: "Club_Upcoming_Events", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "title", label: "Title", width: 30 },
          { key: "description", label: "Description", width: 50 },
          { key: "eventDate", label: "Event Date", width: 18 },
          { key: "venue", label: "Venue", width: 30 },
          { key: "registrationLink", label: "Registration", width: 40 },
          { key: "status", label: "Status", width: 12 },
        ] },
      { id: "club-attendance", title: "Club Attendance", endpoint: "club-attendance", fileName: "Club_Attendance", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "eventName", label: "Event", width: 30 },
          { key: "eventDate", label: "Event Date", width: 18 },
          { key: "description", label: "Description", width: 40 },
          { key: "membersPresent", label: "Members", width: 10 },
          { key: "visitors", label: "Visitors", width: 10 },
          { key: "visitingRotarians", label: "Visiting Rotarians", width: 15 },
        ] },
      { id: "club-documents", title: "Club Documents", endpoint: "club-documents", fileName: "Club_Documents", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "title", label: "Title", width: 30 },
          { key: "accessType", label: "Access", width: 15 },
          { key: "fileName", label: "File Name", width: 30 },
          { key: "filePath", label: "Document", width: 16, hyperlink: true, linkText: "Document" },
          { key: "publishDate", label: "Publish", width: 18 },
          { key: "expiryDate", label: "Expiry", width: 18 },
          { key: "status", label: "Status", width: 12 },
        ] },
      { id: "club-monthly-reports", title: "Club Monthly Reports", endpoint: "club-monthly-reports", fileName: "Club_Monthly_Reports", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "month", label: "Month", width: 10 },
          { key: "lastMonthCount", label: "Last Count", width: 12 },
          { key: "added", label: "Added", width: 10 },
          { key: "deleted", label: "Deleted", width: 10 },
          { key: "currentCount", label: "Current", width: 10 },
          { key: "uploadedToDistrict", label: "Uploaded", width: 12 },
          { key: "remarks", label: "Remarks", width: 40 },
          { key: "createdDate", label: "Created", width: 18 },
        ] },
      { id: "rotary-projects", title: "Rotary Projects (all service types)", endpoint: "rotary-projects", fileName: "Rotary_Projects", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "serviceType", label: "Service Type", width: 25 },
          { key: "title", label: "Title", width: 30 },
          { key: "description", label: "Description", width: 50 },
          { key: "location", label: "Location", width: 30 },
          { key: "projectDate", label: "Date", width: 15 },
          { key: "cost", label: "Cost", width: 12 },
          { key: "beneficiaries", label: "Beneficiaries", width: 15 },
          { key: "manHours", label: "Man Hours", width: 12 },
          { key: "rotarians", label: "Rotarians", width: 12 },
          { key: "rotaractors", label: "Rotaractors", width: 12 },
          { key: "rcc", label: "RCC", width: 10 },
          { key: "projectType", label: "Project Type", width: 15 },
          { key: "jointProject", label: "Joint", width: 10 },
          { key: "coHost", label: "Co-Host", width: 25 },
          { key: "areaOfFocus", label: "Area of Focus", width: 25 },
          { key: "category", label: "Category", width: 25 },
          { key: "subCategory", label: "Sub-Category", width: 25 },
          { key: "funding", label: "Funding", width: 20 },
          { key: "globalGrantNumber", label: "Global Grant Number", width: 18 },
          { key: "amountSanctioned", label: "Amount Sanctioned", width: 18 },
          { key: "amountReceived", label: "Amount Received", width: 18 },
          { key: "amountSpent", label: "Amount Spent", width: 18 },
          { key: "hostClubsDistricts", label: "Host Clubs/Districts", width: 30 },
          { key: "globalPartnerClubsDistricts", label: "Global Partner Clubs/Districts", width: 30 },
          { key: "csrCompanyName", label: "CSR Company", width: 25 },
        ] },
      { id: "trf-contributions", title: "TRF Contributions", endpoint: "trf-contributions", fileName: "TRF_Contributions", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "trfDate", label: "Date", width: 18 },
          { key: "donorName", label: "Donor Name", width: 30 },
          { key: "amountUSD", label: "Amount USD", width: 15 },
          { key: "fundType", label: "Fund Type", width: 20 },
          { key: "fundName", label: "Fund Name", width: 30 },
          { key: "otherFundName", label: "Other Fund", width: 25 },
        ] },
      { id: "pph-camps", title: "PPH Camps", endpoint: "pph-camps", fileName: "PPH_Camps", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "title", label: "Title", width: 30 },
          { key: "description", label: "Description", width: 40 },
          { key: "address", label: "Address", width: 40 },
          { key: "campDate", label: "Date", width: 15 },
          { key: "attendanceCount", label: "Attendance", width: 12 },
          { key: "isActive", label: "Active", width: 10 },
        ] },
      { id: "pph-attendees", title: "PPH Camp Attendees", endpoint: "pph-attendees", fileName: "PPH_Camp_Attendees",
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "campTitle", label: "Camp", width: 28 },
          { key: "campDate", label: "Camp Date", width: 15 },
          { key: "yearLabel", label: "Rotary Year", width: 12 },
          { key: "attendeeName", label: "Attendee Name", width: 24 },
          { key: "mobileNo", label: "Mobile", width: 16 },
          { key: "sex", label: "Sex", width: 8 },
          { key: "address", label: "Address", width: 34 },
          { key: "readingCount", label: "Readings", width: 10 },
          { key: "latestReadingDate", label: "Latest Reading", width: 16 },
        ] },
      { id: "newsletters", title: "Newsletters", endpoint: "newsletters", fileName: "Newsletters", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "title", label: "Title", width: 30 },
          { key: "publishDate", label: "Publish", width: 18 },
          { key: "expiryDate", label: "Expiry", width: 18 },
          { key: "attachmentType", label: "Type", width: 12 },
          { key: "linkUrl", label: "Link", width: 40 },
          { key: "filePath", label: "Document", width: 16, hyperlink: true, linkText: "Document" },
          { key: "status", label: "Status", width: 12 },
        ] },
      { id: "club-weblinks", title: "Club Weblinks", endpoint: "club-weblinks", fileName: "Club_Weblinks", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "level", label: "Level", width: 10 },
          { key: "title", label: "Title", width: 30 },
          { key: "linkType", label: "Type", width: 12 },
          { key: "linkUrl", label: "URL", width: 45 },
          { key: "pdfPath", label: "PDF", width: 40 },
          { key: "youtubeUrl", label: "YouTube", width: 40 },
          { key: "buttonText", label: "Button Text", width: 20 },
          { key: "sortOrder", label: "Sort", width: 8 },
          { key: "isActive", label: "Active", width: 10 },
        ] },
      { id: "potential-members", title: "Potential Members (Prospects)", endpoint: "potential-members", fileName: "Potential_Members", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "name", label: "Name", width: 30 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 18 },
          { key: "referenceDetails", label: "Reference", width: 40 },
          { key: "createdDate", label: "Created", width: 18 },
        ] },
      { id: "club-mass-emails", title: "Club Mass Emails (Campaigns)", endpoint: "club-mass-emails", fileName: "Club_Mass_Emails", districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "fromName", label: "From Name", width: 25 },
          { key: "replyName", label: "Reply Name", width: 20 },
          { key: "replyEmail", label: "Reply Email", width: 28 },
          { key: "subject", label: "Subject", width: 40 },
          { key: "status", label: "Status", width: 12 },
          { key: "totalRecipients", label: "Total", width: 10 },
          { key: "sentCount", label: "Sent", width: 10 },
          { key: "failedCount", label: "Failed", width: 10 },
          { key: "sentDate", label: "Sent Date", width: 18 },
          { key: "createdDate", label: "Created", width: 18 },
        ] },
      { id: "club-social-links", title: "Club Social Links", endpoint: "club-social-links", fileName: "Club_Social_Links", yearScoped: false, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "platform", label: "Platform", width: 20 },
          { key: "linkUrl", label: "URL", width: 45 },
          { key: "sortOrder", label: "Sort", width: 8 },
          { key: "isActive", label: "Active", width: 10 },
        ] },
      { id: "ocv-documents", title: "OCV Documents", endpoint: "ocv-documents", fileName: "OCV_Documents", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "year", label: "Year", width: 10 },
          { key: "category", label: "Category", width: 25 },
          { key: "type", label: "Type", width: 25 },
          { key: "customType", label: "Custom Type", width: 25 },
          { key: "fileName", label: "File Name", width: 30 },
          { key: "filePath", label: "Document", width: 16, hyperlink: true, linkText: "Document" },
          { key: "fileSize", label: "File Size", width: 12 },
          { key: "amount", label: "Amount", width: 12 },
          { key: "paidOn", label: "Paid On", width: 15 },
          { key: "createdDate", label: "Uploaded", width: 18 },
        ] },
    ],
  },
  {
    id: "settings", title: "Settings Masters", icon: SettingsIcon,
    items: [
      { id: "rotary-years", title: "Rotary Years", endpoint: "rotary-years", fileName: "Rotary_Years",
        columns: [
          { key: "yearLabel", label: "Year", width: 15 },
          { key: "startDate", label: "Start Date", width: 15 },
          { key: "endDate", label: "End Date", width: 15 },
          { key: "isCurrent", label: "Current", width: 10 },
        ] },
      { id: "designations", title: "Designations", endpoint: "designations", fileName: "Designations",
        columns: [
          { key: "designationName", label: "Designation", width: 35 },
          { key: "sortOrder", label: "Sort Order", width: 12 },
        ] },
      { id: "themes", title: "Themes", endpoint: "themes", fileName: "Themes",
        columns: [
          { key: "themeName", label: "Theme", width: 30 },
          { key: "imagePath", label: "Image Path", width: 40 },
          { key: "createdDate", label: "Created", width: 20 },
        ] },
      { id: "module-master", title: "Module Master", endpoint: "module-master", fileName: "Module_Master",
        columns: [
          { key: "moduleKey", label: "Key", width: 20 },
          { key: "moduleName", label: "Name", width: 30 },
          { key: "level", label: "Level", width: 12 },
          { key: "description", label: "Description", width: 40 },
          { key: "routeUrl", label: "Route", width: 30 },
          { key: "defaultForDistrict", label: "District Default", width: 15 },
          { key: "defaultForClub", label: "Club Default", width: 15 },
          { key: "sortOrder", label: "Sort Order", width: 12 },
        ] },
      { id: "areas-of-focus", title: "Areas of Focus", endpoint: "areas-of-focus", fileName: "Areas_Of_Focus",
        columns: [
          { key: "areaName", label: "Area of Focus", width: 35 },
          { key: "moduleName", label: "Module", width: 25 },
          { key: "sortOrder", label: "Sort Order", width: 12 },
          { key: "isActive", label: "Active", width: 10 },
        ] },
      { id: "categories", title: "Categories + Sub-Categories", endpoint: "categories", fileName: "Categories_Hierarchy",
        columns: [
          { key: "areaOfFocus", label: "Area of Focus", width: 25 },
          { key: "categoryName", label: "Category", width: 30 },
          { key: "subCategoryName", label: "Sub-Category", width: 30 },
          { key: "categorySortOrder", label: "Cat Order", width: 12 },
          { key: "subSortOrder", label: "Sub Order", width: 12 },
          { key: "categoryActive", label: "Cat Active", width: 12 },
          { key: "subCategoryActive", label: "Sub Active", width: 12 },
        ] },
      { id: "funding", title: "Funding Sources", endpoint: "funding", fileName: "Funding",
        columns: [
          { key: "fundingName", label: "Funding", width: 30 },
          { key: "sortOrder", label: "Sort Order", width: 12 },
          { key: "isActive", label: "Active", width: 10 },
        ] },
      { id: "international-president", title: "International President", endpoint: "international-president", fileName: "International_President", yearScoped: true,
        columns: [
          { key: "year", label: "Year", width: 15 },
          { key: "name", label: "Name", width: 35 },
          { key: "designation", label: "Designation", width: 30 },
          { key: "profilePhoto", label: "Profile Photo", width: 50 },
        ] },
      { id: "membership-dues", title: "Club Dues", endpoint: "membership-dues", fileName: "Club_Dues", yearScoped: true, districtScoped: true,
        columns: [
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "rotaryYear", label: "Year", width: 12 },
          { key: "purpose", label: "Purpose", width: 40 },
          { key: "categoryType", label: "Category", width: 20 },
          { key: "annualAmount", label: "Annual", width: 12 },
          { key: "semi1Amount", label: "Semi 1", width: 12 },
          { key: "semi2Amount", label: "Semi 2", width: 12 },
          { key: "modeOfPayment", label: "Mode", width: 12 },
          { key: "isActive", label: "Active", width: 10 },
          { key: "createdDate", label: "Created", width: 18 },
        ] },
      { id: "event-payment-links", title: "Event Payment Links", endpoint: "event-payment-links", fileName: "Event_Payment_Links", districtScoped: true,
        columns: [
          { key: "linkId", label: "Link ID", width: 10 },
          { key: "title", label: "Title", width: 30 },
          { key: "description", label: "Description", width: 40 },
          { key: "formType", label: "Form Type", width: 12 },
          { key: "amountType", label: "Amount Type", width: 12 },
          { key: "districtNumber", label: "District", width: 12 },
          { key: "clubName", label: "Club", width: 30 },
          { key: "forAllDistricts", label: "All Districts", width: 12 },
          { key: "weblinkUrl", label: "Weblink URL", width: 40 },
          { key: "registrations", label: "Registrations", width: 12 },
          { key: "isActive", label: "Active", width: 10 },
          { key: "createdDate", label: "Created", width: 18 },
        ] },
      { id: "ri-director-credits", title: "RI Director Credits", endpoint: "ri-director-credits", fileName: "RI_Director_Credits",
        columns: [
          { key: "creditType", label: "Type", width: 15 },
          { key: "purchasedCount", label: "Purchased", width: 12 },
          { key: "usedCount", label: "Used", width: 10 },
          { key: "balance", label: "Balance", width: 10 },
          { key: "previousCount", label: "Previous", width: 12 },
          { key: "fromDate", label: "From", width: 15 },
          { key: "toDate", label: "To", width: 15 },
          { key: "transactionId", label: "Transaction ID", width: 20 },
          { key: "paymentDate", label: "Payment Date", width: 15 },
          { key: "proofDocumentPath", label: "Proof", width: 40 },
        ] },
    ],
  },
];

interface DistrictOption { id: number; districtNumber: string }

export default function ReportsPage() {
  const { isSuperAdmin } = useAuth();
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("all");
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [yrs, dists] = await Promise.all([
          getRotaryYears(),
          fetchReport("districts-list"),
        ]);
        setYears(yrs);
        setDistricts([...(dists as DistrictOption[])].sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
        const current = yrs.find((y: RotaryYear) => y.isCurrent);
        if (current) setSelectedYearId(String(current.id));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load filters.");
      } finally { setLoading(false); }
    })();
  }, []);

  const selectedYearLabel = years.find(y => String(y.id) === selectedYearId)?.yearLabel || "AllYears";
  const selectedDistrictLabel = districts.find(d => String(d.id) === selectedDistrictId)?.districtNumber || "AllDistricts";

  const downloadReport = async (section: ReportSection, item: ReportItem) => {
    setBusyId(item.id);
    try {
      const params: Record<string, any> = {};
      if (item.yearScoped && selectedYearId !== "all") params.yearId = Number(selectedYearId);
      if (item.districtScoped && selectedDistrictId !== "all") params.districtId = Number(selectedDistrictId);
      const rawRows = await fetchReport(item.endpoint, params);
      const rows = Array.isArray(rawRows) ? stripYearFromBirthAnnivRows(rawRows) : rawRows;
      if (!Array.isArray(rows) || rows.length === 0) {
        const filterInfo: string[] = [];
        if (item.yearScoped && selectedYearId !== "all") filterInfo.push(`year ${selectedYearLabel}`);
        if (item.districtScoped && selectedDistrictId !== "all") filterInfo.push(`district ${selectedDistrictLabel}`);
        setErrorMessage(`No data found for "${item.title}"${filterInfo.length ? ` (${filterInfo.join(", ")})` : ""}.`);
        return;
      }
      const suffixParts: string[] = [];
      if (item.yearScoped && selectedYearId !== "all") suffixParts.push(selectedYearLabel.replace(/\W+/g, ""));
      if (item.districtScoped && selectedDistrictId !== "all") suffixParts.push(`D${selectedDistrictLabel}`);
      const suffix = suffixParts.length ? `_${suffixParts.join("_")}` : "";

      const subtitleParts: string[] = [`Exported ${new Date().toLocaleString("en-IN")}`];
      if (item.yearScoped && selectedYearId !== "all") subtitleParts.push(`Year ${selectedYearLabel}`);
      if (item.districtScoped && selectedDistrictId !== "all") subtitleParts.push(`District ${selectedDistrictLabel}`);
      exportToCSV(rows, `${item.fileName}${suffix}`, item.columns,
        { title: item.title, subtitle: subtitleParts.join(" · ") });
      setSuccessMessage(`${item.title} exported (${rows.length} rows).`);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || `Failed to export "${item.title}".`);
    } finally { setBusyId(null); }
  };

  // Club Analytics — a server-built .xlsx (one row per club with counts). Uses the same District +
  // Year pickers above: "All Districts" → every club in the system; a district → its clubs.
  const downloadClubAnalytics = async () => {
    setBusyId("club-analytics");
    try {
      const yr = selectedYearId !== "all" ? Number(selectedYearId) : undefined;
      const dist = selectedDistrictId !== "all" ? Number(selectedDistrictId) : undefined;
      const blob = await downloadClubAnalyticsDistrict(yr, dist);
      saveAs(blob, `Club_Analytics_${dist ? `D${selectedDistrictLabel}` : "AllClubs"}_${fileTimestamp()}.xlsx`);
      setSuccessMessage("Club Analytics exported.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to export Club Analytics.");
    } finally { setBusyId(null); }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can view reports.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Reports</h2>
              <p className="text-muted-foreground text-base">Export Excel reports for every module and settings master</p>
            </div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <Label className="text-xs text-muted-foreground">Rotary Year</Label>
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">District</Label>
              <Select value={selectedDistrictId} onValueChange={setSelectedDistrictId}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Districts</SelectItem>
                  {districts.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
        ) : (
          <div className="space-y-5">
            {/* Club Analytics — per-club counts .xlsx (uses the District + Year pickers above). */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="h-5 w-5" />Club Analytics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg p-3 flex items-center justify-between gap-2 bg-muted/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">Club Analytics (per-club counts)</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {selectedDistrictId === "all" ? "All clubs (all districts)" : `District ${selectedDistrictLabel}`}
                      {selectedYearId !== "all" ? ` · ${selectedYearLabel}` : " · Current year"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={downloadClubAnalytics} disabled={busyId === "club-analytics"}>
                    {busyId === "club-analytics" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <Card key={section.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2"><Icon className="h-5 w-5" />{section.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {section.items.map((item) => {
                        const busy = busyId === item.id;
                        const yearInfo = item.yearScoped
                          ? (selectedYearId === "all" ? " · All years" : ` · ${selectedYearLabel}`)
                          : "";
                        const districtInfo = item.districtScoped
                          ? (selectedDistrictId === "all" ? " · All districts" : ` · D${selectedDistrictLabel}`)
                          : "";
                        const tags: string[] = [];
                        if (item.yearScoped) tags.push("Year");
                        if (item.districtScoped) tags.push("District");
                        const scopeLabel = tags.length > 0 ? tags.join(" + ") + "-scoped" : "All records";
                        return (
                          <div key={item.id} className="border rounded-lg p-3 flex items-center justify-between gap-2 bg-muted/30">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{item.title}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {scopeLabel}{yearInfo}{districtInfo}
                              </p>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => downloadReport(section, item)} disabled={busy}>
                              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}

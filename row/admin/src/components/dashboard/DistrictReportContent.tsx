"use client";

/**
 * Embeddable district-report body. Reuses the V1 page's section list and
 * exportSection() flow verbatim — same per-section Excel downloads, same
 * Photos hyperlink column on the six service-module project tables.
 *
 * Mounted by:
 *   - app/districts/[id]/district-report/page.tsx (V1 standalone wrapper)
 *   - app/district-admin-dashboard/egovernance/page.tsx (egovernance Reports
 *     sub-tab) — so admins don't have to leave the new dashboard.
 *
 * Year picker lives INSIDE this component, so each host page only passes
 * districtId (+ optional initial yearId from a URL param). Auth wrapper
 * stays on the page side; this component assumes it's already inside an
 * authenticated route.
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useFeature } from "@/contexts/BrandContext";
import XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";
import DistrictGoalReports from "@/components/dashboard/DistrictGoalReports";
import {
  getDistrictReport, getDistrictReportAvailableYears, getCitationMatrix,
  getDistrictAvenueOfServiceAllClubs, getDistrictAvenueOfServiceClubCount,
  getDistrictDcAllMembers, getDistrictDcBod, getDistrictDcDc, getDistrictClubOfficersRi,
  getRotaryYears, downloadOcvReportExcel, downloadOcvReportWord, downloadClubAnalyticsDistrict,
  getDistrictAdminRotaryNetwork, getPotentialMembers,
} from "@/services/api";
import { exportToCSV, exportMonthlyPivot } from "@/utils/csvExport";
import { exportCitationMatrix } from "@/utils/citationMatrixExport";
import { downloadAgOcvZip } from "@/utils/ocvAgZip";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import {
  Calendar, Download, BarChart3, Users, Megaphone, CalendarClock, Newspaper, FileText,
  CheckSquare, Award, UserCircle, IndianRupee, Building2, Crown, UserCog, Shield, Trophy,
  ClipboardList, Star, Tent, Mail, Link2, MessageCircle, FileSpreadsheet, Loader2,
} from "lucide-react";
import Link from "next/link";
import RotaryLoader from "@/components/RotaryLoader";

import { appLocale } from "@/lib/appFormat";
// RI Director "All Districts" mode. Fetches one report per district in the zone
// and concatenates every section array into a single payload so the existing
// per-section Download buttons emit ONE combined file (all districts, all clubs).
// Each row is stamped with its source districtNumber so the origin isn't lost.
// Only used when the caller passes districtIds; single-district reports never hit this.
const MERGE_ARRAY_KEYS = [
  "bod", "members", "appUsers", "attendance", "clubMonthlyProjectDetails",
  "monthlyReportSubmissions", "trf", "pphCampAttendees", "pphCamps",
  "nonRiSyncedClubs", "riSyncedClubs", "events", "newsletters", "announcements",
  "documents", "districtProjects", "agAllocation", "committeeMain",
  "committeeGroup", "committeeSubGroup", "clubList",
];

// Stamp a row with the zone + district it came from (never overwriting a value the
// row already carries, e.g. the Sync/Non-sync club rows that ship their own districtNumber).
function stampGeo(row: any, dn: string, zn: string): any {
  if (!row || typeof row !== "object") return row;
  return { ...row, districtNumber: row.districtNumber ?? dn, zoneName: row.zoneName ?? zn };
}

function mergeDistrictReports(reports: any[]): any | null {
  const list = (reports || []).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const merged: any = { district: { districtNumber: "All Districts", zoneName: "" }, projectsByModule: {}, dataCollection: null };
  for (const k of MERGE_ARRAY_KEYS) merged[k] = [];
  for (const r of list) {
    const dn = r?.district?.districtNumber ?? "";
    const zn = r?.district?.zoneName ?? "";
    if (!merged.district.zoneName && zn) merged.district.zoneName = zn;
    for (const k of MERGE_ARRAY_KEYS) {
      const rows = Array.isArray(r?.[k]) ? r[k] : [];
      for (const row of rows) merged[k].push(stampGeo(row, dn, zn));
    }
    const pbm = r?.projectsByModule || {};
    for (const mk of Object.keys(pbm)) {
      if (!merged.projectsByModule[mk]) merged.projectsByModule[mk] = [];
      const rows = Array.isArray(pbm[mk]) ? pbm[mk] : [];
      for (const row of rows) merged.projectsByModule[mk].push(stampGeo(row, dn, zn));
    }
    if (!merged.dataCollection && r?.dataCollection) merged.dataCollection = r.dataCollection;
  }
  return merged;
}

// Single-district RI Director view: stamp every section row with the one district's
// zone + district so the injected Zone / District columns are populated.
function stampGeoSingle(report: any): any {
  if (!report) return report;
  const dn = report?.district?.districtNumber ?? "";
  const zn = report?.district?.zoneName ?? "";
  for (const k of MERGE_ARRAY_KEYS) {
    if (Array.isArray(report[k])) report[k] = report[k].map((row: any) => stampGeo(row, dn, zn));
  }
  const pbm = report?.projectsByModule || {};
  for (const mk of Object.keys(pbm)) {
    if (Array.isArray(pbm[mk])) pbm[mk] = pbm[mk].map((row: any) => stampGeo(row, dn, zn));
  }
  return report;
}

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

function ReportSection({ title, icon: Icon, count, onExport }: { title: string; icon: React.ElementType; count: number; onExport: () => void | Promise<void> }) {
  const hasData = count > 0;
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try { await onExport(); }
    finally { setBusy(false); }
  };
  return (
    <Card>
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
        <Button variant="outline" size="sm" onClick={handleClick} disabled={!hasData || busy}>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <RotaryLoader size="sm" />
              Loading…
            </span>
          ) : (
            <><Download className="mr-2 h-3 w-3" />Download</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// Data Collection row with an inline Club dropdown + lazy-load fetch.
// Used only on the DISTRICT report (not the club-level v2) for All Members + BOD.
// Filters rows client-side after first fetch (cached) so switching clubs and
// re-downloading doesn't hit the API again.
function DataCollectionFilterRow({
  title, icon, clubs, defaultFile, fetchFn, columns, onExport,
}: {
  title: string;
  icon: React.ElementType;
  clubs: { clubId: number; clubName: string }[];
  defaultFile: string;
  /** Receives clubId when a specific club is selected, undefined for "All Clubs". */
  fetchFn: (clubId?: number) => Promise<any[]>;
  columns: { key: string; label: string; width?: number; greenWhen100Percent?: boolean }[];
  onExport: (rows: any[], baseFile: string, label: string, columns: any[]) => void;
}) {
  const [clubId, setClubId] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const Icon = icon;
  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Pass clubId straight to backend so the query is narrowed at the SQL
      // level — avoids fetching the full district when only one club is wanted.
      const scopedClubId = clubId === "all" ? undefined : Number(clubId);
      const rows = await fetchFn(scopedClubId);
      const targetClubName = clubs.find((c) => String(c.clubId) === clubId)?.clubName;
      const base = targetClubName && clubId !== "all"
        ? `${targetClubName.replace(/\s+/g, "_")}_${defaultFile}`
        : defaultFile;
      onExport(rows || [], base, title, columns);
    } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{clubId === "all" ? "All clubs" : clubs.find((c) => String(c.clubId) === clubId)?.clubName || ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clubs</SelectItem>
              {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleClick} disabled={busy}>
            {busy ? (
              <span className="inline-flex items-center gap-2"><RotaryLoader size="sm" />Loading…</span>
            ) : (
              <><Download className="mr-2 h-3 w-3" />Download</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Rotary Network download row (Terminated / Potential members) — inline club dropdown
// ("All" + each club) that FETCHES the rows on demand, then exports. Mirrors
// DataCollectionFilterRow but with the exact "All" label the spec asks for.
function NetworkDownloadRow({
  title, icon, clubs, defaultFile, fetchFn, columns, onExport,
}: {
  title: string;
  icon: React.ElementType;
  clubs: { clubId: number; clubName: string }[];
  defaultFile: string;
  fetchFn: (clubId?: number) => Promise<any[]>;
  columns: any[];
  onExport: (rows: any[], baseFile: string, label: string, columns: any[]) => void;
}) {
  const [clubId, setClubId] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [noRecords, setNoRecords] = useState(false);
  const Icon = icon;
  const handleClick = async () => {
    if (busy) return;
    setBusy(true); setNoRecords(false);
    try {
      const scopedClubId = clubId === "all" ? undefined : Number(clubId);
      const rows = await fetchFn(scopedClubId);
      if (!rows || rows.length === 0) { setNoRecords(true); return; }
      const targetClubName = clubs.find((c) => String(c.clubId) === clubId)?.clubName;
      const base = targetClubName && clubId !== "all"
        ? `${targetClubName.replace(/\s+/g, "_")}_${defaultFile}`
        : defaultFile;
      onExport(rows, base, title, columns);
    } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">
              {noRecords ? <span className="text-amber-600">No records found</span>
                         : (clubId === "all" ? "All" : clubs.find((c) => String(c.clubId) === clubId)?.clubName || "")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clubId} onValueChange={(v) => { setClubId(v); setNoRecords(false); }}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleClick} disabled={busy}>
            {busy ? (
              <span className="inline-flex items-center gap-2"><RotaryLoader size="sm" />Loading…</span>
            ) : (
              <><Download className="mr-2 h-3 w-3" />Download</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Compact section divider that groups download rows under Members / Clubs / District
function SubsectionHeader({ title }: { title: string }) {
  return (
    <div className="mt-2 pt-3 pb-1 px-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="mt-1 h-px bg-slate-200" />
    </div>
  );
}

// Row with an inline Club dropdown ("All Clubs" + each club). On export, the
// row passes only that club's slice to onExport(). Filename automatically
// switches between District_{number}_… and {clubName}_… via baseFilenamePicker.
// App-users tally: Not-Downloaded / Android / iOS counts for the active-users report.
function appUserTally(list: any[]): { notDownloaded: number; android: number; ios: number } {
  let android = 0, ios = 0, notDownloaded = 0;
  for (const u of list) {
    if (String(u.downloaded) !== "Yes") { notDownloaded++; continue; }
    const p = String(u.platform || "").toLowerCase();
    if (p.includes("android")) android++;
    else if (p.includes("ios") || p.includes("iphone") || p.includes("apple")) ios++;
  }
  return { notDownloaded, android, ios };
}

function ClubFilterRow({
  title, icon, rows, clubs, defaultFile, baseColumns, onDownload, renderNote, summaryText, hideClub = false,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  clubs: { clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string }[];
  onDownload: (rows: any[], filenameBase: string, label: string, columns: typeof baseColumns, summary?: string) => void;
  renderNote?: (filtered: any[]) => React.ReactNode;
  /** Optional summary line written into the Excel header (e.g. Not Downloaded / Android / iOS totals). */
  summaryText?: (filtered: any[]) => string;
  /** RI Director "All Districts" view: drop the per-club dropdown; always download every club. */
  hideClub?: boolean;
}) {
  const [clubId, setClubId] = useState<string>("all");
  const filtered = clubId === "all" ? rows : (rows || []).filter((r) => Number(r.clubId) === Number(clubId));
  const hasData = filtered.length > 0;
  const onClick = () => {
    if (!hasData) return;
    const clubName = clubs.find((c) => String(c.clubId) === clubId)?.clubName;
    const base = clubName ? `${clubName.replace(/\s+/g, "_")}_${defaultFile}` : defaultFile;
    onDownload(filtered, base, title, baseColumns, summaryText?.(filtered));
  };
  const Icon = icon;
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "record" : "records"}{clubId !== "all" && " · filtered"}</p>
            {renderNote && <div className="mt-0.5">{renderNote(filtered)}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!hideClub && (
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clubs</SelectItem>
              {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          )}
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasData}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// OCV "Dues" report (district admin) — flat list, one row per (club × dues document type),
// with a Club filter AND a Dues-type filter (both "All" by default). The Excel export appends a
// per-club subtotal (horizontal total), a per-dues-type total block (vertical total), and a grand
// total. Data comes from report.duesReport (backend already scopes it to the district + year + AG clubs).
function DuesReportRow({
  rows, clubs, onDownload,
}: {
  rows: any[];
  clubs: { clubId: number; clubName: string }[];
  onDownload: (rows: any[], filenameBase: string, label: string, columns: any[], summary?: string) => void;
}) {
  const [clubId, setClubId] = useState<string>("all");

  // Distinct dues document types → the horizontal columns, ordered by the seeded SortOrder.
  const typeMap = new Map<number, { id: number; name: string; sort: number }>();
  for (const r of rows || []) {
    const id = Number(r.typeId);
    if (!typeMap.has(id)) typeMap.set(id, { id, name: String(r.documentType || ""), sort: Number(r.typeSort ?? 0) });
  }
  const duesTypes = Array.from(typeMap.values()).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  const filtered = (rows || []).filter((r) => clubId === "all" || Number(r.clubId) === Number(clubId));
  const hasData = filtered.length > 0;

  const ddmmyyyy = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  };

  const onClick = () => {
    if (!hasData) return;
    // Pivot: one row per club. Each dues type → a Yes/No (uploaded?) column + a Date column (latest
    // paid-on). Multiple uploads of a type (e.g. "Others") collapse to Yes + the latest date.
    const byClub: { id: number; name: string; districtNumber: string; cells: Map<number, { uploaded: boolean; date: any }> }[] = [];
    const idx = new Map<number, number>();
    for (const r of filtered) {
      const cid = Number(r.clubId);
      if (!idx.has(cid)) { idx.set(cid, byClub.length); byClub.push({ id: cid, name: String(r.clubName || ""), districtNumber: String(r.districtNumber || ""), cells: new Map() }); }
      const club = byClub[idx.get(cid)!];
      const prev = club.cells.get(Number(r.typeId)) || { uploaded: false, date: null as any };
      const uploaded = prev.uploaded || Number(r.isUploaded) === 1;
      let date = prev.date;
      if (r.paidOn && (!date || new Date(r.paidOn) > new Date(date))) date = r.paidOn;
      club.cells.set(Number(r.typeId), { uploaded, date });
    }
    const out: any[] = [];
    let sr = 1;
    for (const club of byClub) {
      const row: any = { srNo: sr++, districtNumber: club.districtNumber, clubName: club.name };
      for (const t of duesTypes) {
        const cell = club.cells.get(t.id) || { uploaded: false, date: null };
        row[`type_${t.id}`] = cell.uploaded ? "Yes" : "No";
        row[`date_${t.id}`] = cell.date ? ddmmyyyy(cell.date) : "";
      }
      out.push(row);
    }
    const cols: any[] = [
      { key: "srNo", label: "Sr.No.", width: 8 },
      // District admin download → keep Club Name, drop District Number.
      { key: "clubName", label: "Club Name", width: 28 },
    ];
    for (const t of duesTypes) {
      cols.push({ key: `type_${t.id}`, label: t.name, width: 16 });
      cols.push({ key: `date_${t.id}`, label: "Date", width: 14 });
    }
    const clubName = clubs.find((c) => String(c.clubId) === clubId)?.clubName;
    const parts: string[] = [];
    if (clubName) parts.push(clubName.replace(/\s+/g, "_"));
    parts.push("Club_Dues");
    onDownload(out, parts.join("_"), "Club Dues", cols);
  };

  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <IndianRupee className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">Club Dues{duesTypes.length ? ` (${duesTypes.map((t) => t.name).join(", ")})` : ""}</p>
            <p className="text-xs text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "record" : "records"}{clubId !== "all" && " · filtered"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clubs</SelectItem>
              {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasData}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Club Monthly Report (Project Details) — MONTH-HORIZONTAL pivot (matches the
// legacy District CMR): one row per club, months across as group headers, each
// month spanning 8 metric columns (Club Service / TRF / Projects / Cost /
// Beneficiaries / Man Hours / Rotarians Involved / Rotaractors). Club dropdown =
// All Clubs or a particular club. As each month's CMR is submitted its column set
// fills in; unsubmitted months show zeros.
function ClubMonthlyProjectDetailsRow({
  mode = "club", rows, clubs, ags, yearLabel, districtNumber, isCurrentYear, hideClub = false, showGeo = false,
}: {
  mode?: "club" | "ag";
  rows: any[];
  clubs: { clubId: number; clubName: string; districtNumber?: string; zoneName?: string }[];
  ags: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  yearLabel: string;
  districtNumber: string;
  isCurrentYear: boolean;
  /** RI Director "All Districts" view: drop the per-club dropdown; always all clubs. */
  hideClub?: boolean;
  /** RI Director view: prepend Zone + District Number lead columns. */
  showGeo?: boolean;
}) {
  const isAgMode = mode === "ag";
  const [clubId, setClubId] = useState<string>("all");
  const [agId, setAgId] = useState<string>("");
  const uniqueAgs = Array.from(new Map((ags || []).map((a) => [a.agMemberId, { id: a.agMemberId, name: a.agName }])).values());

  // Target clubs: AG mode → clubs assigned to the selected AG (mandatory);
  // Club mode → all clubs or the one selected.
  const targetClubs = isAgMode
    ? (agId ? clubs.filter((c) => (ags || []).some((a) => String(a.agMemberId) === agId && Number(a.clubId) === Number(c.clubId))) : [])
    : (clubId === "all" ? clubs : clubs.filter((c) => String(c.clubId) === clubId));
  const needAg = isAgMode && !agId;
  const hasData = targetClubs.length > 0 && !needAg;

  const title = isAgMode ? "Club Monthly Report AG wise (Project Details)" : "Club Monthly Report (Project Details)";

  const METRICS = [
    { key: "clubService", label: "Club Service", width: 10 },
    { key: "trf", label: "TRF", width: 10 },
    { key: "projects", label: "Projects", width: 10 },
    { key: "cost", label: "Cost", width: 12 },
    { key: "beneficiaries", label: "Beneficiaries", width: 12 },
    { key: "manHours", label: "Man Hours", width: 10 },
    { key: "rotariansInvolved", label: "Rotarians Involved", width: 14 },
    { key: "rotaractors", label: "Rotaractors", width: 12 },
    { key: "rcc", label: "RCC", width: 10 },
  ];
  const ALL_MONTHNUMS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
  const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const onClick = () => {
    if (!hasData) return;
    // Rotary year "2025-26" → Jul-Dec = 2025, Jan-Jun = 2026.
    const ym = /(\d{4})\s*-\s*(\d{2,4})/.exec(yearLabel || "");
    const startYear = ym ? Number(ym[1]) : new Date().getFullYear();
    const endYear = ym ? (ym[2].length === 2 ? Number(String(startYear).slice(0, 2) + ym[2]) : Number(ym[2])) : startYear + 1;

    // Show months only up TO the current month for the current rotary year; past
    // years show all 12. (July=index 0 … June=index 11.)
    let monthCount = 12;
    if (isCurrentYear) {
      const cm = new Date().getMonth() + 1;
      monthCount = (cm >= 7 ? cm - 7 : cm + 5) + 1;
    }
    const MONTHNUMS = ALL_MONTHNUMS.slice(0, monthCount);

    // AG name per club + values per (clubId, monthNum).
    const agByClub = new Map<number, string>();
    for (const a of ags || []) if (!agByClub.has(Number(a.clubId))) agByClub.set(Number(a.clubId), a.agName);
    const dataByClubMonth = new Map<string, any>();
    for (const r of rows || []) dataByClubMonth.set(`${Number(r.clubId)}_${Number(r.monthNum)}`, r);

    const groups = MONTHNUMS.map((m) => ({
      label: `${MONTH_NAMES[m]} ${m >= 7 ? startYear : endYear}`,
      cols: METRICS.map((mt) => ({ key: `m${m}_${mt.key}`, label: mt.label, width: mt.width })),
    }));
    // Final "Total" group — sum of every shown month per metric, per club.
    groups.push({
      label: "Total (All Months)",
      cols: METRICS.map((mt) => ({ key: `total_${mt.key}`, label: mt.label, width: mt.width })),
    });

    const pivotRows = targetClubs.map((club) => {
      const row: any = { zoneName: club.zoneName || "", districtNumber: club.districtNumber || districtNumber, clubName: club.clubName, agName: agByClub.get(club.clubId) || "" };
      const totals: Record<string, number> = Object.fromEntries(METRICS.map((mt) => [mt.key, 0]));
      for (const m of MONTHNUMS) {
        const rec = dataByClubMonth.get(`${club.clubId}_${m}`);
        for (const mt of METRICS) {
          const v = rec ? Number(rec[mt.key]) || 0 : 0;
          row[`m${m}_${mt.key}`] = v;
          totals[mt.key] += v;
        }
      }
      for (const mt of METRICS) row[`total_${mt.key}`] = totals[mt.key];
      return row;
    });

    const agName = isAgMode ? uniqueAgs.find((a) => String(a.id) === agId)?.name : undefined;
    const clubName = !isAgMode ? clubs.find((c) => String(c.clubId) === clubId)?.clubName : undefined;
    const scope = agName ? `AG_${agName.replace(/\s+/g, "_")}` : (clubName ? clubName.replace(/\s+/g, "_") : "All_Clubs");
    exportMonthlyPivot({
      filename: `District_${districtNumber}_CMR_${scope}`,
      title: `${title} — District ${districtNumber}`,
      subtitle: `Rotary Year: ${yearLabel}${agName ? ` · AG: ${agName}` : ""}`,
      leadCols: [
        ...(showGeo ? [
          { key: "zoneName", label: "Zone", width: 16 },
          { key: "districtNumber", label: "District Number", width: 16 },
        ] : []),
        { key: "clubName", label: "Club Name", width: 30 },
        { key: "agName", label: "AG Name", width: 24 },
      ],
      groups,
      rows: pivotRows,
    });
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            {needAg
              ? <p className="text-xs text-amber-600">Please select an AG to download</p>
              : <p className="text-xs text-muted-foreground">{targetClubs.length} {targetClubs.length === 1 ? "club" : "clubs"} · months across</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAgMode ? (
            <Select value={agId} onValueChange={setAgId}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select AG" /></SelectTrigger>
              <SelectContent>
                {uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (!hideClub && (
            <Select value={clubId} onValueChange={setClubId}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clubs</SelectItem>
                {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
              </SelectContent>
            </Select>
          ))}
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasData}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Row with an inline AG dropdown ("All AGs" + each AG). Selecting an AG narrows
// the input rows to clubs assigned to that AG (using agAllocation map).
function AgFilterRow({
  title, icon, rows, ags, defaultFile, baseColumns, onDownload,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  ags: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string }[];
  onDownload: (rows: any[], filenameBase: string, label: string, columns: typeof baseColumns) => void;
}) {
  // AG-wise reports REQUIRE an AG selection — there is no "All" (it would just be
  // the plain "All Clubs" report). No AG chosen → nothing to download.
  const [agId, setAgId] = useState<string>("");
  const uniqueAgs = Array.from(new Map(ags.map((a) => [a.agMemberId, { id: a.agMemberId, name: a.agName }])).values());
  const allowedClubIds = agId ? new Set(ags.filter((a) => String(a.agMemberId) === agId).map((a) => Number(a.clubId))) : null;
  const filtered = !allowedClubIds ? [] : (rows || []).filter((r) => allowedClubIds.has(Number(r.clubId)));
  const hasSelection = !!agId;
  const hasData = hasSelection && filtered.length > 0;
  const onClick = () => {
    if (!hasData) return;
    const agName = uniqueAgs.find((a) => String(a.id) === agId)?.name;
    const base = agName ? `AG_${agName.replace(/\s+/g, "_")}_${defaultFile}` : defaultFile;
    onDownload(filtered, base, title, baseColumns);
  };
  const Icon = icon;
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-amber-600">
              {!hasSelection
                ? "Please select an AG to download"
                : `${uniqueAgs.find((a) => String(a.id) === agId)?.name} · ${filtered.length} ${filtered.length === 1 ? "record" : "records"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={agId} onValueChange={setAgId}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select AG" /></SelectTrigger>
            <SelectContent>
              {uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasData}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Avenue-of-Service project row — Avenue dropdown (All + each avenue) + optional AG
// dropdown. When agMandatory, an AG must be selected before download is enabled.
function AvenueFilterRow({
  title, icon, rows, ags, agMandatory, clubs, defaultFile, baseColumns, onDownload,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  ags?: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  agMandatory?: boolean;
  clubs?: { clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string }[];
  onDownload: (rows: any[], filenameBase: string, label: string, columns: typeof baseColumns) => void;
}) {
  // For agMandatory rows the AG starts unselected ("") so the trigger shows the
  // "Select AG" placeholder and the AG list renders cleanly (same pattern as the
  // other AG rows). Non-mandatory rows default to "all".
  const [agId, setAgId] = useState<string>(agMandatory ? "" : "all");
  const [clubId, setClubId] = useState<string>("all");
  const [avenue, setAvenue] = useState<string>("all");
  const uniqueAgs = Array.from(new Map((ags || []).map((a) => [a.agMemberId, { id: a.agMemberId, name: a.agName }])).values());
  const avenues = Array.from(new Set((rows || []).map((r) => String(r.typeOfProject || "")).filter(Boolean))).sort();
  const agSelected = agId !== "" && agId !== "all";
  const allowedClubIds = agSelected ? new Set((ags || []).filter((a) => String(a.agMemberId) === agId).map((a) => Number(a.clubId))) : null;
  const filtered = (rows || []).filter((r) => {
    if (avenue !== "all" && String(r.typeOfProject || "") !== avenue) return false;
    if (clubId !== "all" && Number(r.clubId) !== Number(clubId)) return false;
    if (allowedClubIds && !allowedClubIds.has(Number(r.clubId))) return false;
    return true;
  });
  const needAg = !!agMandatory && !agSelected;
  const hasData = filtered.length > 0 && !needAg;
  const onClick = () => {
    if (!hasData) return;
    const agName = uniqueAgs.find((a) => String(a.id) === agId)?.name;
    const clubName = clubs?.find((c) => String(c.clubId) === clubId)?.clubName;
    const parts = [
      agName ? `AG_${agName.replace(/\s+/g, "_")}` : "",
      clubName ? clubName.replace(/\s+/g, "_") : "",
      avenue !== "all" ? avenue.replace(/\s+/g, "_") : "",
    ].filter(Boolean);
    const base = parts.length ? `${parts.join("_")}_${defaultFile}` : defaultFile;
    onDownload(filtered, base, title, baseColumns);
  };
  const Icon = icon;
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            {needAg
              ? <p className="text-xs text-amber-600">Please select an AG to download</p>
              : <p className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "record" : "records"}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ags && (
            <Select value={agId} onValueChange={setAgId}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder={agMandatory ? "Select AG" : "All AGs"} /></SelectTrigger>
              <SelectContent>
                {!agMandatory && <SelectItem value="all">All AGs</SelectItem>}
                {uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {clubs && (
            <Select value={clubId} onValueChange={setClubId}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clubs</SelectItem>
                {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={avenue} onValueChange={setAvenue}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Avenues" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Avenues</SelectItem>
              {avenues.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasData}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Avenue-of-Service club-wise COUNT row — HORIZONTAL/pivot: one row per CLUB, a column per
// avenue (Club Service, Community Service, …) holding that club's project count, plus a Total.
// No District Number, no Avenue column. Club dropdown filters to one club.
function AvenueCountRow({
  title, icon, rows, clubs, districtNumber, defaultFile, onDownload,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  clubs?: { clubId: number; clubName: string }[];
  districtNumber: string;
  defaultFile: string;
  onDownload: (rows: any[], filenameBase: string, label: string, columns: any[]) => void;
}) {
  const [clubId, setClubId] = useState<string>("all");
  void districtNumber; // no longer shown (kept in the signature for call-site compatibility)
  // Distinct avenues present → these become the pivot columns (sorted, blank ones dropped).
  const avenues = Array.from(new Set((rows || []).map((r) => String(r.typeOfProject || "")).filter(Boolean))).sort();
  // Aggregate per club: { avenue -> count } + running total.
  const byClub = new Map<string, { clubName: string; counts: Record<string, number>; total: number }>();
  for (const r of rows || []) {
    const av = String(r.typeOfProject || "");
    if (!av) continue;
    if (clubId !== "all" && Number(r.clubId) !== Number(clubId)) continue;
    const cur = byClub.get(r.clubName) || { clubName: r.clubName, counts: {} as Record<string, number>, total: 0 };
    cur.counts[av] = (cur.counts[av] || 0) + 1;
    cur.total++;
    byClub.set(r.clubName, cur);
  }
  const list = Array.from(byClub.values())
    .sort((a, b) => a.clubName.localeCompare(b.clubName))
    .map((x) => {
      const row: any = { clubName: x.clubName, total: x.total };
      for (const av of avenues) row[av] = x.counts[av] || 0; // 0 when the club has none in that avenue
      return row;
    });
  const hasData = list.length > 0;
  const cols = [
    { key: "srNo", label: "Sr. No.", width: 8, index: true },
    { key: "clubName", label: "Club Name", width: 28 },
    ...avenues.map((av) => ({ key: av, label: av, width: 18 })),
    { key: "total", label: "Total", width: 12 },
  ];
  const Icon = icon;
  const onClick = () => {
    if (!hasData) return;
    const clubName = clubs?.find((c) => String(c.clubId) === clubId)?.clubName;
    const base = clubName ? `${clubName.replace(/\s+/g, "_")}_${defaultFile}` : defaultFile;
    onDownload(list, base, title, cols);
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{list.length} {list.length === 1 ? "club" : "clubs"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {clubs && (
            <Select value={clubId} onValueChange={setClubId}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clubs</SelectItem>
                {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasData}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Governor's Official Visit (OCV/GOV) report — Club Wise (mandatory club) or
// AG Wise (mandatory AG). Lists every OCV sub-module + document type with the
// uploaded file as a hyperlink, or "N/A" when nothing was uploaded.
function OcvReportRow({
  mode, clubs, ags, districtId, districtNumber, yearId, yearLabel, onEmpty,
}: {
  mode: "club" | "ag";
  clubs?: { clubId: number; clubName: string }[];
  ags?: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  districtId: number;
  districtNumber: string;
  yearId: string;
  yearLabel: string;
  onEmpty?: (msg: string) => void;
}) {
  const isAg = mode === "ag";
  const uniqueAgs = Array.from(new Map((ags || []).map((a) => [a.agMemberId, { id: a.agMemberId, name: a.agName }])).values());
  const [sel, setSel] = useState<string>("");
  const [busyFmt, setBusyFmt] = useState<null | "excel" | "word">(null);
  const hasSel = !!sel;
  const title = isAg
    ? "Governor's Official Visit (OCV/GOV) (AG Wise)"
    : "Governor's Official Visit (OCV/GOV) (Club Wise)";

  const selName = isAg
    ? uniqueAgs.find((a) => String(a.id) === sel)?.name
    : clubs?.find((c) => String(c.clubId) === sel)?.clubName;

  // Excel/Word icons. Club-wise → that club's rich OCV report; AG-wise → a ZIP of every
  // club under the AG (one report per club) in the chosen format.
  const handleFormat = async (fmt: "excel" | "word") => {
    if (!hasSel || busyFmt) return;
    setBusyFmt(fmt);
    try {
      if (isAg) {
        const res = await downloadAgOcvZip({
          districtId, agMemberId: Number(sel), yearId: Number(yearId), format: fmt,
          agName: selName || "AG", districtNumber,
        });
        if (res.total === 0) onEmpty?.("No clubs found under this AG for the selected year.");
        else if (res.added === 0) onEmpty?.("Could not generate any club report for this AG.");
      } else {
        const base = `District_${districtNumber}_${(selName || `Club_${sel}`).replace(/\s+/g, "_")}_OCV`;
        if (fmt === "excel") await downloadOcvReportExcel(Number(sel), Number(yearId), base);
        else await downloadOcvReportWord(Number(sel), Number(yearId), base);
      }
    } catch {
      onEmpty?.("Failed to generate the OCV/GOV report.");
    } finally {
      setBusyFmt(null);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Crown className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-amber-600">
              {hasSel
                ? (isAg ? "Ready — downloads every club under this AG (zipped)" : "Ready — all sub-modules included")
                : `Please select a ${isAg ? "AG" : "club"} to download`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder={isAg ? "Select AG" : "Select Club"} /></SelectTrigger>
            <SelectContent>
              {isAg
                ? uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)
                : (clubs || []).map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Excel + Word icons in place of a single Download button. */}
          <Button
            variant="outline" size="sm" title="Download Excel"
            className="text-emerald-700 border-emerald-200 hover:bg-emerald-50"
            onClick={() => handleFormat("excel")} disabled={!hasSel || busyFmt !== null}
          >
            {busyFmt === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline" size="sm" title="Download Word"
            className="text-blue-700 border-blue-200 hover:bg-blue-50"
            onClick={() => handleFormat("word")} disabled={!hasSel || busyFmt !== null}
          >
            {busyFmt === "word" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Row with TWO inline dropdowns — Designation + Club. Used by the District-wide
// BOD report so admins can pull "Treasurers of Thane Hills" or "All Treasurers"
// etc. with a single click.
function BodMultiFilterRow({
  title, icon, rows, clubs, defaultFile, baseColumns, onDownload, hideClub = false,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  clubs: { clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string }[];
  onDownload: (rows: any[], filenameBase: string, label: string, columns: typeof baseColumns) => void;
  /** RI Director "All Districts" view: drop the per-club dropdown (keep the designation filter). */
  hideClub?: boolean;
}) {
  const [clubId, setClubId] = useState<string>("all");
  const [designation, setDesignation] = useState<string>("all");
  const designations = Array.from(new Set((rows || []).map((r) => r.designation).filter(Boolean))).sort() as string[];
  let filtered = rows || [];
  if (clubId !== "all") filtered = filtered.filter((r) => Number(r.clubId) === Number(clubId));
  if (designation !== "all") filtered = filtered.filter((r) => (r.designation || "").trim() === designation);
  const hasData = filtered.length > 0;
  const onClick = () => {
    if (!hasData) return;
    const clubName = clubs.find((c) => String(c.clubId) === clubId)?.clubName;
    const prefix = clubName ? `${clubName.replace(/\s+/g, "_")}_${defaultFile}` : defaultFile;
    const base = designation === "all" ? prefix : `${prefix}_${designation.replace(/\s+/g, "_")}`;
    onDownload(filtered, base, title, baseColumns);
  };
  const Icon = icon;
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "record" : "records"}{(clubId !== "all" || designation !== "all") && " · filtered"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={designation} onValueChange={setDesignation}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All Designations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Designations</SelectItem>
              {designations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          {!hideClub && (
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clubs</SelectItem>
              {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          )}
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasData}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// District Awards row with an inline Club dropdown ("All Clubs" + each club).
// Fetches the citation matrix on Excel click, filters its row list down to the
// selected club (or keeps all), then hands off to exportCitationMatrix.
function AwardsClubFilterRow({
  title, icon, clubs, districtId, districtNumber, selectedYearId, compact = false, onEmpty, hideClub = false,
}: {
  title: string;
  icon: React.ElementType;
  clubs: { clubId: number; clubName: string }[];
  districtId: number;
  districtNumber: string;
  selectedYearId: string;
  compact?: boolean;
  onEmpty?: (msg: string) => void;
  /** RI Director single-district view: drop the per-club dropdown; always all clubs. */
  hideClub?: boolean;
}) {
  const [clubId, setClubId] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const Icon = icon;
  const onClick = async () => {
    try {
      setBusy(true);
      const matrix = await getCitationMatrix(districtId, Number(selectedYearId) || undefined);
      if (clubId !== "all") {
        const cid = Number(clubId);
        matrix.rows = (matrix.rows || []).filter((r: any) => Number(r.clubId) === cid);
      }
      if (!matrix || !matrix.columns || matrix.columns.length === 0 || !matrix.rows || matrix.rows.length === 0) {
        onEmpty?.(`No District Awards records found for ${title}${clubId !== "all" ? " (selected club)" : ""}.`);
        return;
      }
      const clubName = clubs.find((c) => String(c.clubId) === clubId)?.clubName;
      const slug = clubName ? clubName.replace(/\s+/g, "_") : `District_${districtNumber}`;
      // Swapped meaning (user request): "District Awards" = Total Points only (compact),
      // "District Awards Extended" = Base + Achieved + Total (non-compact).
      const suffix = compact ? "District_Awards" : "District_Awards_Extended";
      exportCitationMatrix(matrix, { filenamePrefix: `${slug}_${suffix}`, compact });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{clubId === "all" ? "All clubs" : clubs.find((c) => String(c.clubId) === clubId)?.clubName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!hideClub && (
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Clubs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clubs</SelectItem>
              {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          )}
          <Button variant="outline" size="sm" onClick={onClick} disabled={busy}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// District Awards row scoped to a specific AG. Per spec the AG selection is
// MANDATORY — there's no "All AGs" option and Download stays disabled until
// the user picks one. Filename gets an AG_{name}_ prefix.
function AwardsAgFilterRow({
  title, icon, ags, districtId, districtNumber, selectedYearId, compact = false, onEmpty,
}: {
  title: string;
  icon: React.ElementType;
  ags: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  districtId: number;
  districtNumber: string;
  selectedYearId: string;
  compact?: boolean;
  onEmpty?: (msg: string) => void;
}) {
  const [agId, setAgId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const Icon = icon;
  const uniqueAgs = Array.from(new Map(ags.map((a) => [a.agMemberId, { id: a.agMemberId, name: a.agName }])).values());
  const allowedClubIds = agId ? new Set(ags.filter((a) => String(a.agMemberId) === agId).map((a) => a.clubId)) : new Set<number>();
  const onClick = async () => {
    if (!agId) return;
    try {
      setBusy(true);
      const matrix = await getCitationMatrix(districtId, Number(selectedYearId) || undefined);
      matrix.rows = (matrix.rows || []).filter((r: any) => allowedClubIds.has(Number(r.clubId)));
      if (!matrix.columns || matrix.columns.length === 0 || !matrix.rows || matrix.rows.length === 0) {
        onEmpty?.(`No District Awards records found for the selected AG.`);
        return;
      }
      const agName = uniqueAgs.find((a) => String(a.id) === agId)?.name;
      const slug = agName ? `AG_${agName.replace(/\s+/g, "_")}` : `District_${districtNumber}`;
      // Swapped meaning (user request): "District Awards" = Total Points only (compact),
      // "District Awards Extended" = Base + Achieved + Total (non-compact).
      const suffix = compact ? "District_Awards" : "District_Awards_Extended";
      exportCitationMatrix(matrix, { filenamePrefix: `${slug}_${suffix}`, compact });
    } finally {
      setBusy(false);
    }
  };
  const hasSelection = !!agId;
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-amber-600">{hasSelection ? `${uniqueAgs.find((a) => String(a.id) === agId)?.name}` : "Please select an AG to download"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={agId} onValueChange={setAgId}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select AG" /></SelectTrigger>
            <SelectContent>
              {uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onClick} disabled={!hasSelection || busy}>
            <Download className="mr-2 h-3 w-3" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Placeholder row used for reports that aren't built yet ("Coming Soon").
function ComingSoonRow({ title, icon }: { title: string; icon: React.ElementType }) {
  const Icon = icon;
  return (
    <Card className="opacity-60">
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-slate-500" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-amber-600">Coming Soon</p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled>
          <Download className="mr-2 h-3 w-3" />Download
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * agMemberId — AG Reports only. When set, every request carries it and the backend
 * scopes the whole report (and the club dropdown) to that AG's clubs for the year.
 * Left undefined by the District Admin and Club Admin pages, so their behaviour is
 * byte-for-byte unchanged.
 */
export default function DistrictReportContent({ districtId, initialYearId, servicesOnly = false, agMemberId, agName, hideMembers = false, districtIds, hideClubFilter = false, hideAgReports = false, showGeoColumns = false, showCommunicationLogs = false }: { districtId?: number; initialYearId?: number; servicesOnly?: boolean; agMemberId?: number; agName?: string; hideMembers?: boolean; districtIds?: number[]; hideClubFilter?: boolean; hideAgReports?: boolean; showGeoColumns?: boolean; showCommunicationLogs?: boolean }) {
  // AG Reports: every "(AG Wise)" row is redundant — the whole report is already this
  // AG, so its AG dropdown would list only them. Hidden rather than left as a no-op.
  const isAgReport = !!agMemberId && agMemberId > 0;
  const showBloodGroup = useFeature("member.bloodGroup");
  // RI Director "All Districts" mode — fetch + merge every district in the zone.
  const isMulti = Array.isArray(districtIds) && districtIds.length > 0;
  const effectiveDistrictId = districtId ?? 0;
  // "(AG Wise)" report rows: hidden on an AG report (redundant) and when the caller
  // asks to hide AG-wise reports (RI Director). District-level rows keep using !isAgReport.
  const showAgRows = !isAgReport && !hideAgReports;
  const searchParams = useSearchParams();
  const [years, setYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [report, setReport] = useState<any>(null);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Global topbar Rotary year (?yearId). All reports download using THIS year —
  // there is no per-module year dropdown anymore.
  const globalYearId = searchParams?.get("yearId") || "";

  useEffect(() => {
    (async () => {
      try {
        if (isMulti) {
          // No single district → use the global rotary-year list (all districts share years).
          const yrs = await getRotaryYears();
          setYears((yrs || []).map((y: any) => ({
            id: y.id ?? y.pkYearId,
            yearLabel: y.yearLabel ?? y.YearLabel,
            isCurrent: y.isCurrent ?? y.IsCurrent ?? false,
          })));
        } else {
          const yrs = await getDistrictReportAvailableYears(effectiveDistrictId);
          setYears(yrs || []);
        }
      } catch { setErrorMessage("Failed to load years."); }
      finally { setYearsLoading(false); }
    })();
  }, [effectiveDistrictId, isMulti]);

  // Selected year is driven by the global topbar year, falling back to the
  // initialYearId prop and then the current year once the list has loaded.
  useEffect(() => {
    if (globalYearId) { setSelectedYearId(globalYearId); return; }
    if (initialYearId && initialYearId > 0) { setSelectedYearId(String(initialYearId)); return; }
    if (years.length > 0) {
      const cur = years.find((y: any) => y.isCurrent);
      setSelectedYearId(String(cur?.id || years[0].id));
    }
  }, [globalYearId, initialYearId, years]);

  useEffect(() => {
    if (!selectedYearId) return;
    (async () => {
      setReportLoading(true);
      try {
        if (isMulti) {
          // Fetch every district in the zone in parallel, then concatenate the
          // section arrays into ONE payload so each Download button emits a single
          // combined file (all districts, all clubs).
          const reports = await Promise.all(
            districtIds!.map((id) => getDistrictReport(id, Number(selectedYearId)).catch(() => null)),
          );
          setReport(mergeDistrictReports(reports));
        } else {
          const data = await getDistrictReport(effectiveDistrictId, Number(selectedYearId), agMemberId);
          setReport(showGeoColumns ? stampGeoSingle(data) : data);
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load report.");
      } finally { setReportLoading(false); }
    })();
    // districtIds is stable per zone selection; joining avoids an identity-based re-fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDistrictId, selectedYearId, isMulti, (districtIds || []).join(",")]);

  const yearLabel = years.find((y: any) => String(y.id) === selectedYearId)?.yearLabel || "";
  const districtNumber = report?.district?.districtNumber || "";
  // Download filename prefix. On the AG report the file holds that AG's clubs, not the
  // whole district, so "District_5656_..." would misdescribe it — use the AG's name.
  const filePrefix = isMulti
    ? "All_Districts"
    : isAgReport && agName?.trim()
    ? `AG_${agName.trim().replace(/\s+/g, "_")}`
    : `District_${districtNumber}`;

  // RI Director view: every report should identify each row's Zone + District (rows
  // are pre-stamped with zoneName/districtNumber). Inject the two columns right after
  // the Sr.No column (or at the front), skipping any the report already carries so
  // Sync/Non-sync/Avenue-count rows keep their own District Number column.
  const injectGeo = (columns: any[]): any[] => {
    if (!showGeoColumns) return columns;
    const has = (k: string) => columns.some((c) => c?.key === k);
    const extra: any[] = [];
    if (!has("zoneName")) extra.push({ key: "zoneName", label: "Zone", width: 16 });
    if (!has("districtNumber")) extra.push({ key: "districtNumber", label: "District Number", width: 16 });
    if (extra.length === 0) return columns;
    const firstIsIndex = columns[0] && (columns[0].index || columns[0].key === "srNo");
    return firstIsIndex ? [columns[0], ...extra, ...columns.slice(1)] : [...extra, ...columns];
  };
  // Report title/subtitle scope label — "District 3142" for one district, "All Districts" for the merge.
  const scopeLabel = isMulti ? "All Districts" : `District ${districtNumber}`;

  const exportSection = (data: any[], sectionName: string, columns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string }[]) => {
    if (!data || data.length === 0) return;
    exportToCSV(data, `${filePrefix}_${sectionName.replace(/\s+/g, "_")}`, injectGeo(columns), {
      title: `${sectionName} — ${scopeLabel}`,
      subtitle: `Rotary Year: ${yearLabel}`,
    });
    // No success toast — browser's file save UI is the confirmation.
  };

  // Variant of exportSection used by filter rows. Filename base is supplied
  // by the row (already includes Club/AG/Designation prefix when applicable);
  // for "All" selections, baseFile starts with the plain report name and the
  // District_{districtNumber}_ prefix is prepended so the convention is:
  //   All clubs    → District_3142_Members_15-06-2026_22-30-15.xlsx
  //   one club     → Thane_Hills_Members_15-06-2026_22-30-15.xlsx
  //   AG           → AG_R_Sharma_Members_15-06-2026_22-30-15.xlsx
  const exportWithFilename = (data: any[], baseFile: string, label: string, columns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string }[], summary?: string) => {
    if (!data || data.length === 0) return;
    const isClubOrAgScoped = baseFile.includes("_") && !baseFile.startsWith(label.replace(/\s+/g, "_"));
    const finalBase = isClubOrAgScoped
      ? baseFile
      : `${filePrefix}_${baseFile.replace(/\s+/g, "_")}`;
    exportToCSV(data, finalBase, injectGeo(columns), {
      title: `${label} — ${scopeLabel}`,
      subtitle: `Rotary Year: ${yearLabel}`,
      summary,
    });
  };

  // Day + month only (no year) — for DOB / DOA columns per the district-report spec.
  const dayMonth = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString(appLocale(), { day: "2-digit", month: "short" });
  };

  // DD/MM/YYYY — for the Joining Date column.
  const ddmmyyyy = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  // Full Members column set (shared by "Members" and "Members (AG wise)").
  const membersCols: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string }[] = [
    { key: "srNo", label: "Sr. No.", width: 8, index: true },
    { key: "clubName", label: "Club Name", width: 25 },
    { key: "memberName", label: "Member Name", width: 25 },
    { key: "profilePhoto", label: "Profile Photo", width: 12, hyperlink: true, linkText: "Photo" },
    { key: "classification", label: "Classification", width: 20 },
    { key: "clubDesignation", label: "Club Designation", width: 18 },
    { key: "country", label: "Country", width: 14 },
    { key: "mobile", label: "Mobile", width: 16 },
    { key: "email", label: "Email ID", width: 28 },
    { key: "gender", label: "Gender", width: 10 },
    { key: "primaryLanguage", label: "Primary Language", width: 16 },
    { key: "youthFlag", label: "Youth Flag", width: 10 },
    { key: "dob", label: "DOB", width: 12, format: dayMonth },
    { key: "doa", label: "DOA", width: 12, format: dayMonth },
    ...(showBloodGroup ? [{ key: "bloodGroup", label: "Blood Group", width: 12 }] : []),
    { key: "deviceName", label: "Device Name", width: 14 },
    { key: "downloaded", label: "Downloaded", width: 12 },
    { key: "address", label: "Residence Address", width: 45 },
    { key: "rotaryId", label: "Rotary ID", width: 14 },
    // COG (club 31598) rows have no meaningful joining date, so when the report
    // contains COG rows that column is swapped for the DG district + Rotary year
    // the API now returns. A district with no COG rows is completely unchanged.
    ...(((report?.members || []) as any[]).some((r) => r?.cogDistrictNumber || r?.cogYear)
      ? [
          { key: "cogDistrictNumber", label: "District", width: 12 },
          { key: "cogYear", label: "Rotary Year", width: 14 },
        ]
      : [{ key: "riAdmissionDate", label: "Joining Date", width: 14, format: ddmmyyyy }]),
  ];

  // Attendance columns (shared by All Clubs + AG wise).
  const attendanceCols = [
    { key: "srNo", label: "Sr. No.", width: 8, index: true },
    { key: "clubName", label: "Club Name", width: 25 },
    { key: "eventName", label: "Event Name", width: 25 },
    { key: "description", label: "Description", width: 30 },
    { key: "eventDateTime", label: "Event Date & Time", width: 20 },
    { key: "membersCount", label: "Members Count", width: 14 },
    { key: "annsCount", label: "Anns Count", width: 12 },
    { key: "annetsCount", label: "Annets Count", width: 12 },
    { key: "visitorsCount", label: "Visitors Count", width: 14 },
    { key: "rotariansOtherClubsCount", label: "Rotarians (Other Clubs) Count", width: 22 },
    { key: "districtDelegatesCount", label: "District Delegates Count", width: 20 },
  ];

  // Full Avenue-of-Service project columns (shared by AG-wise + All-Clubs).
  const avenueProjectCols = [
    { key: "srNo", label: "Sr. No.", width: 8, index: true },
    { key: "clubName", label: "Club Name", width: 25 },
    { key: "typeOfProject", label: "Type of Project", width: 18 },
    { key: "clubRole", label: "Club Role", width: 16 },
    { key: "coHostName", label: "Co-host", width: 18 },
    // Area of Focus was missing - only Category / Sub Category showed (user 2026-10-07).
    { key: "areaOfFocus", label: "Area of Focus", width: 22 },
    { key: "category", label: "Category", width: 20 },
    { key: "subCategory", label: "Sub Category", width: 18 },
    { key: "projectDate", label: "Date", width: 14, format: ddmmyyyy },
    { key: "title", label: "Title", width: 28 },
    { key: "description", label: "Description", width: 36 },
    { key: "location", label: "Project Location", width: 20 },
    { key: "projectCost", label: "Project Cost", width: 14 },
    { key: "funding", label: "Funding", width: 16 },
    { key: "globalGrantNumber", label: "Global Grant No", width: 18 },
    { key: "csrCompanyName", label: "CSR Company", width: 22 },
    { key: "amountSanctioned", label: "Amount Sanctioned", width: 16 },
    { key: "amountReceived", label: "Amount Received", width: 16 },
    { key: "amountSpent", label: "Amount Spent", width: 16 },
    { key: "hostClubsDistricts", label: "Host Clubs", width: 22 },
    { key: "globalPartners", label: "Global Partner", width: 22 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 },
    { key: "manHours", label: "Man Hours", width: 12 },
    { key: "oneTimeOngoing", label: "OneTime/Ongoing", width: 16 },
    { key: "newExisting", label: "New/Existing", width: 14 },
    { key: "rotariansInvolved", label: "Rotarians Involved", width: 18 },
    { key: "publicPhotoUrl", label: "Images", width: 12, hyperlink: true, linkText: "Images" },
  ];
  // Avenue-of-Service reports (All Clubs / AG Wise / Club Wise Count) are CLUB
  // Avenue-of-Service projects only. The project payload also carries district-level
  // entries (fk_district_id match → clubName "District Level"); exclude those.
  const allProjects: any[] = (Object.values(report?.projectsByModule || {}).flat() as any[])
    .filter((p) => Number(p?.clubId) > 0 && String(p?.clubName || "") !== "District Level");

  // Resolve list of clubs for the dropdown rows. Falls back to deriving from
  // the bod payload if `clubList` isn't present (older API responses).
  const clubsDropdown: { clubId: number; clubName: string; districtNumber?: string; zoneName?: string }[] = report?.clubList
    ? report.clubList.map((c: any) => ({ clubId: c.clubId, clubName: c.clubName, districtNumber: c.districtNumber, zoneName: c.zoneName }))
    : Array.from(new Map((report?.bod || []).map((r: any) => [r.clubId, { clubId: r.clubId, clubName: r.clubName, districtNumber: r.districtNumber, zoneName: r.zoneName }])).values()) as any;
  const agsDropdown: { agMemberId: number; agName: string; clubId: number; clubName: string }[] = report?.agAllocation || [];

  if (yearsLoading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;

  return (
    <div className="space-y-6">
      {!servicesOnly && <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />}
      {!servicesOnly && <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />}

      {reportLoading ? (
        <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
      ) : !report ? (
        <div className="text-center py-20 text-muted-foreground">No report data available.</div>
      ) : (
        <>
          {/* Communication logs (WhatsApp / Email delivery) — opened from the district Reports tab. */}
          {showCommunicationLogs && (
            <Card className="mb-4">
              <CardContent className="p-0">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">Communication Logs</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Delivery status of WhatsApp &amp; Email sent to your district&apos;s members</p>
                </div>
                <div className="p-4 flex flex-wrap gap-3">
                  <Link href="/district-admin-dashboard/whatsapp-log" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200">
                    <MessageCircle size={14} /> WhatsApp Log
                  </Link>
                  <Link href="/district-admin-dashboard/email-log" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200">
                    <Mail size={14} /> Email Log
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary stat-card grid removed — too slow to compute server-side
              and not needed for the report-export workflow. Backend still
              returns report.summary but the UI no longer renders the cards. */}

          {/* Per-avenue project rows (Community / Club / New Generation /
              Vocational / International / Public Image) intentionally
              removed — those reports already live under the Avenue of Service
              dropdown rows in the CLUBS subsection (All Clubs, Club-Wise
              Count, AG-Wise variants). */}

          {!servicesOnly && <>
            {/* ── MEMBERS subsection ── hidden when hideMembers (Zonal Coordinator report) ── */}
            {!hideMembers && (<>
            <SubsectionHeader title="Members" />

            {/* Rotary Network — Terminated Members (club dropdown: All + each club). */}
            <NetworkDownloadRow
              title="Terminated Members"
              icon={Users}
              clubs={clubsDropdown}
              defaultFile="Terminated_Members"
              fetchFn={async (clubId) => {
                try {
                  const data = await getDistrictAdminRotaryNetwork(undefined, effectiveDistrictId, undefined, clubId);
                  return (data.terminatedMembers || []).map((m: any) => ({
                    districtNumber,
                    clubName: m.clubName,
                    memberId: m.memberId,
                    name: [m.firstName, m.middleName, m.lastName].filter(Boolean).join(" ").trim(),
                    memberType: m.memberType,
                    admissionDate: m.admissionDate ? new Date(m.admissionDate).toLocaleDateString("en-GB") : "",
                    terminationDate: m.terminationDate ? new Date(m.terminationDate).toLocaleDateString("en-GB") : "",
                    terminationReason: m.terminationReason || "",
                    mobile: m.mobile || "",
                    email: m.email || "",
                  }));
                } catch { setErrorMessage("Failed to load Terminated Members."); return []; }
              }}
              columns={[
                { key: "srNo", label: "Sr. No.", width: 8, index: true },
                { key: "districtNumber", label: "District Number", width: 14 },
                { key: "clubName", label: "Club Name", width: 30 },
                { key: "memberId", label: "Member ID", width: 14 },
                { key: "name", label: "Name", width: 28 },
                { key: "memberType", label: "Member Type", width: 16 },
                { key: "admissionDate", label: "Admission Date", width: 16 },
                { key: "terminationDate", label: "Termination Date", width: 16 },
                { key: "terminationReason", label: "Termination Reason", width: 30 },
                { key: "mobile", label: "Mobile", width: 16 },
                { key: "email", label: "Email", width: 28 },
              ]}
              onExport={exportWithFilename}
            />

            {/* Rotary Network — Prospective Members / All Clubs (club dropdown: All + each
                club). These are the per-club "potential/prospective" new-member entries; the
                old "Prospective Members (All Clubs)" coming-soon placeholder was the same data
                and has been removed in favour of this working report. */}
            <NetworkDownloadRow
              title="Prospective Members"
              icon={Users}
              clubs={clubsDropdown}
              defaultFile="Prospective_Members"
              fetchFn={async (clubId) => {
                try {
                  // Potential members live per-club in the DB — the district-network endpoint doesn't
                  // populate them. Fetch per club (one club, or every club of the district for "All").
                  const targets = clubId ? clubsDropdown.filter((c) => c.clubId === clubId) : clubsDropdown;
                  const perClub = await Promise.all(targets.map(async (c) => {
                    const res = await getPotentialMembers(c.clubId, 1, 5000);
                    return (res.items || []).map((m) => ({
                      districtNumber,
                      clubName: c.clubName,
                      name: m.name,
                      email: m.email || "",
                      mobile: m.mobileNumber || "",
                      referenceDetails: m.referenceDetails || "",
                    }));
                  }));
                  return perClub.flat();
                } catch { setErrorMessage("Failed to load Potential Members."); return []; }
              }}
              columns={[
                { key: "srNo", label: "Sr. No.", width: 8, index: true },
                { key: "districtNumber", label: "District Number", width: 14 },
                { key: "clubName", label: "Club Name", width: 30 },
                { key: "name", label: "Name", width: 28 },
                { key: "email", label: "Email", width: 28 },
                { key: "mobile", label: "Mobile", width: 16 },
                { key: "referenceDetails", label: "Reference Details", width: 40 },
              ]}
              onExport={exportWithFilename}
            />

            {/* 1. Board of Directors — designation + club dropdowns */}
            <BodMultiFilterRow
              title="Board of Directors (BOD)"
              icon={UserCircle}
              rows={report.bod || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="Board_of_Directors"
              baseColumns={[
                { key: "srNo", label: "Sr. No.", width: 8, index: true },
                { key: "clubName", label: "Club", width: 25 },
                { key: "designation", label: "Designation", width: 25 },
                { key: "memberName", label: "Member Name", width: 25 },
                { key: "email", label: "Email ID", width: 30 },
                { key: "mobile", label: "Mobile Number", width: 16 },
                { key: "autoManual", label: "Auto/Manual", width: 12 },
              ]}
              onDownload={exportWithFilename}
            />

            {/* 2. Members — club dropdown */}
            <ClubFilterRow
              title="Members"
              icon={Users}
              rows={report.members || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="Members"
              baseColumns={membersCols}
              onDownload={exportWithFilename}
            />

            {/* 2b. Blood Group — emergency call-list: every member AND their family
                members as rows, each with their own blood group + contact. Member row
                first, then their family beneath. Filter by Blood Group in Excel to find
                donors fast. District report shows Club Name (no district number). */}
            {showBloodGroup && (
            <ClubFilterRow
              title="Blood Group"
              icon={Users}
              rows={report.bloodGroups || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="Blood_Group"
              baseColumns={[
                { key: "srNo", label: "Sr. No.", width: 8, index: true },
                { key: "clubName", label: "Club Name", width: 25 },
                { key: "personName", label: "Member Name", width: 25 },
                { key: "relation", label: "Relation", width: 16 },
                { key: "mobile", label: "Mobile Number", width: 16 },
                { key: "email", label: "Email Id", width: 30 },
                { key: "bloodGroup", label: "Blood Group", width: 12 },
              ]}
              onDownload={exportWithFilename}
            />
            )}

            {/* 3. Members (AG wise) — hidden on the AG report (redundant) and when
                AG-wise reports are suppressed (RI Director). */}
            {showAgRows && (
            <AgFilterRow
              title="Members (AG wise)"
              icon={Users}
              rows={report.members || []}
              ags={agsDropdown}
              defaultFile="Members_AG_wise"
              baseColumns={membersCols}
              onDownload={exportWithFilename}
            />
            )}

            {/* 4. Members (Active users in Rotary Zones App) — club dropdown */}
            <ClubFilterRow
              title="Members (Active users in ROW App)"
              icon={Users}
              rows={report.appUsers || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="App_Active_Users"
              baseColumns={[
                { key: "srNo", label: "Sr. No.", width: 8, index: true },
                { key: "clubName", label: "Club Name", width: 25 },
                { key: "memberName", label: "Member Name", width: 25 },
                { key: "mobile", label: "Mobile Number", width: 16 },
                { key: "email", label: "Email Id", width: 30 },
                { key: "downloaded", label: "Downloaded", width: 12 },
                { key: "platform", label: "Device Name", width: 14 },
              ]}
              summaryText={(list) => {
                const { notDownloaded, android, ios } = appUserTally(list);
                return `Not Downloaded: ${notDownloaded}  |  Android: ${android}  |  iOS: ${ios}`;
              }}
              onDownload={exportWithFilename}
            />


            {/* 6–8. Data Collection reports — only when the district has an
                active district_directory_config for the selected year. */}
            {report.dataCollection && (
              <>
                <DataCollectionFilterRow
                  title="Data Collection (All Members)"
                  icon={Users}
                  clubs={clubsDropdown}
                  defaultFile="Data_Collection_All_Members"
                  fetchFn={async (clubId) => {
                    try { return await getDistrictDcAllMembers(effectiveDistrictId, Number(selectedYearId), clubId, agMemberId); }
                    catch (err: any) { setErrorMessage(err?.response?.data?.message || err?.message || "Failed to load Data Collection (All Members)."); return []; }
                  }}
                  columns={report.dataCollection.columns.allMembers.map((c: any) => ({
                    key: c.key, label: c.label, width: 18, master: c.master === true,
                    greenWhen100Percent: c.key === "donePercent",
                  }))}
                  onExport={exportWithFilename}
                />
                <DataCollectionFilterRow
                  title="Data Collection (BOD (Club President & Secretary))"
                  icon={UserCircle}
                  clubs={clubsDropdown}
                  defaultFile="Data_Collection_President_and_Secretary"
                  fetchFn={async (clubId) => {
                    try { return await getDistrictDcBod(effectiveDistrictId, Number(selectedYearId), clubId, agMemberId); }
                    catch (err: any) { setErrorMessage(err?.response?.data?.message || err?.message || "Failed to load Data Collection (BOD)."); return []; }
                  }}
                  columns={report.dataCollection.columns.bod.map((c: any) => ({
                    key: c.key, label: c.label, width: 18, master: c.master === true,
                    greenWhen100Percent: c.key === "donePercent",
                  }))}
                  onExport={exportWithFilename}
                />
                {/* No club dropdown here on purpose — the district committee is a single
                    district-wide list, so this always downloads all of it. Covers all three
                    levels (District Committee / Group / Sub-Group). */}
                <ReportSection
                  title="Data Collection (District Committee (DC))"
                  icon={UserCircle}
                  count={1}
                  onExport={async () => {
                    try {
                      const rows = await getDistrictDcDc(effectiveDistrictId, Number(selectedYearId), agMemberId);
                      exportSection(
                        rows,
                        "Data_Collection_District_Committee",
                        report.dataCollection.columns.dc.map((c: any) => ({ key: c.key, label: c.label, width: 18, master: c.master === true })),
                      );
                    } catch (err: any) { setErrorMessage(err?.response?.data?.message || err?.message || "Failed to load Data Collection (DC)."); }
                  }}
                />
              </>
            )}
            </>)}

            {/* ── CLUBS subsection ──────────────────────────────────────── */}
            <SubsectionHeader title="Clubs" />

            {/* 1. Attendance (All Clubs) */}
            <ClubFilterRow
              title="Attendance (All Clubs)"
              icon={CheckSquare}
              rows={report.attendance || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="Attendance"
              baseColumns={attendanceCols}
              onDownload={exportWithFilename}
            />

            {/* 2. Attendance (AG wise) — hidden on the AG report + when AG-wise suppressed. */}
            {showAgRows && (
            <AgFilterRow
              title="Attendance (AG wise)"
              icon={CheckSquare}
              rows={report.attendance || []}
              ags={agsDropdown}
              defaultFile="Attendance_AG_wise"
              baseColumns={attendanceCols}
              onDownload={exportWithFilename}
            />
            )}

            {/* Avenue reports are grouped together here, right after Attendance:
                All Clubs → AG Wise → Club Wise Count. */}

            {/* Avenue of Service (All Clubs) — club + avenue dropdowns, full columns */}
            <AvenueFilterRow
              title="Avenue Of Service (All Clubs)"
              icon={Award}
              rows={allProjects}
              clubs={hideClubFilter ? undefined : clubsDropdown}
              defaultFile="Avenue_Of_Service_All_Clubs"
              baseColumns={avenueProjectCols}
              onDownload={exportWithFilename}
            />

            {/* Avenue of Service (AG wise) — hidden on the AG report + when AG-wise suppressed. */}
            {showAgRows && (
            <AvenueFilterRow
              title="Avenue Of Service (AG Wise)"
              icon={Award}
              rows={allProjects}
              ags={agsDropdown}
              agMandatory
              defaultFile="Avenue_of_Service_AG_wise"
              baseColumns={avenueProjectCols}
              onDownload={exportWithFilename}
            />
            )}

            {/* Avenue of Service (Club Wise Count) — club + avenue dropdowns */}
            <AvenueCountRow
              title="Avenue Of Service (Club Wise Count)"
              icon={Building2}
              rows={allProjects}
              clubs={hideClubFilter ? undefined : clubsDropdown}
              districtNumber={districtNumber}
              defaultFile="Avenue_Of_Service_Club_Wise_Count"
              onDownload={exportWithFilename}
            />

            {/* 6. Club Analytics — per-club counts .xlsx (one row per club of this district). */}
            <ReportSection
              title="Club Analytics"
              icon={BarChart3}
              count={clubsDropdown.length}
              onExport={async () => {
                const blob = await downloadClubAnalyticsDistrict(Number(selectedYearId) || undefined, effectiveDistrictId);
                saveAs(blob, `Club_Analytics_D${districtNumber || ""}_${fileTimestamp()}.xlsx`);
              }}
            />

            {/* Club Goal Setting — pick a club (or District all), download its month-wise/till-date goals. */}
            <DistrictGoalReports mode="club" districtId={effectiveDistrictId} yearId={Number(selectedYearId) || undefined} />

            {/* 8. Club Monthly Report (Project Details) — per (club, month) aggregate,
                same columns as the club-admin club report; All Clubs or one club. */}
            <ClubMonthlyProjectDetailsRow
              rows={report.clubMonthlyProjectDetails || []}
              clubs={clubsDropdown}
              ags={agsDropdown}
              hideClub={hideClubFilter}
              showGeo={showGeoColumns}
              yearLabel={yearLabel}
              districtNumber={districtNumber}
              isCurrentYear={!!years.find((y: any) => String(y.id) === selectedYearId)?.isCurrent}
            />

            {/* 8b. Club Monthly Report AG wise (Project Details) — hidden on the AG report
                + when AG-wise reports are suppressed (RI Director). */}
            {showAgRows && (
            <ClubMonthlyProjectDetailsRow
              mode="ag"
              rows={report.clubMonthlyProjectDetails || []}
              clubs={clubsDropdown}
              ags={agsDropdown}
              yearLabel={yearLabel}
              districtNumber={districtNumber}
              isCurrentYear={!!years.find((y: any) => String(y.id) === selectedYearId)?.isCurrent}
            />
            )}

            {/* 9. Club Monthly Report (Submission Details) — per-club per-month pivot */}
            <ReportSection
              title="Club Monthly Report (Submission Details)"
              icon={ClipboardList}
              count={clubsDropdown.length}
              onExport={() => {
                const subsByClub = new Map<number, Map<number, string>>();
                for (const r of report.monthlyReportSubmissions || []) {
                  const m = subsByClub.get(Number(r.clubId)) || new Map<number, string>();
                  m.set(Number(r.reportMonth), r.submittedDate ? new Date(r.submittedDate).toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
                  subsByClub.set(Number(r.clubId), m);
                }
                // AG assigned to each CLUB for the report's rotary year. agAllocation is
                // already year-scoped server-side (district_ag.fk_year_id = yearId) and
                // arrives with the report payload, so this is a plain in-memory lookup —
                // no extra query and no per-row work. district_ag is unique on
                // (fk_club_id, fk_year_id), so a club has at most one AG per year.
                const agByClub = new Map<number, string>();
                for (const a of agsDropdown) if (!agByClub.has(Number(a.clubId))) agByClub.set(Number(a.clubId), a.agName);
                const ALL_MONTHS = ["July","August","September","October","November","December","January","February","March","April","May","June"];
                const ALL_MONTHNUMS = [7,8,9,10,11,12,1,2,3,4,5,6];
                // For the CURRENT rotary year, only show months up to the current month
                // (don't pad future months). Past/completed years show all 12.
                const selYear = years.find((y: any) => String(y.id) === selectedYearId);
                let monthCount = 12;
                if (selYear?.isCurrent) {
                  const cm = new Date().getMonth() + 1;           // 1-12
                  monthCount = (cm >= 7 ? cm - 7 : cm + 5) + 1;   // July=1 … June=12
                }
                const MONTHS = ALL_MONTHS.slice(0, monthCount);
                const MONTHNUMS = ALL_MONTHNUMS.slice(0, monthCount);
                const rows = clubsDropdown.map((club, i) => {
                  const subs = subsByClub.get(club.clubId) || new Map();
                  const agName = agByClub.get(Number(club.clubId)) || "";
                  const row: any = showGeoColumns
                    ? { srNo: i + 1, zoneName: club.zoneName || "", districtNumber: club.districtNumber || districtNumber, clubName: club.clubName, agName }
                    : { srNo: i + 1, district: `District ${districtNumber}`, clubName: club.clubName, agName };
                  MONTHNUMS.forEach((m, idx) => {
                    const date = subs.get(m);
                    row[`m${idx}_status`] = date ? "Submitted" : "Not Submitted";
                    row[`m${idx}_date`]   = date || "";
                  });
                  return row;
                });
                const cols: any[] = showGeoColumns
                  ? [
                      { key: "srNo", label: "Sr.No.", width: 8 },
                      { key: "zoneName", label: "Zone", width: 16 },
                      { key: "districtNumber", label: "District Number", width: 16 },
                      { key: "clubName", label: "Club Name", width: 25 },
                      { key: "agName", label: "AG Name", width: 24 },
                    ]
                  : [
                      { key: "srNo", label: "Sr.No.", width: 8 },
                      { key: "district", label: "District", width: 14 },
                      { key: "clubName", label: "Club Name", width: 25 },
                      { key: "agName", label: "AG Name", width: 24 },
                    ];
                MONTHS.forEach((m, idx) => {
                  cols.push({ key: `m${idx}_status`, label: `${m} Submitted/Not Submitted`, width: 22 });
                  cols.push({ key: `m${idx}_date`,   label: `${m} Date`, width: 22 });
                });
                exportWithFilename(rows, "Club_Monthly_Report_Submission_Details", "Club Monthly Report (Submission Details)", cols);
              }}
            />

            {/* Dues (OCV) — flat list per (club × dues type) with Club + Dues-type filters,
                per-club subtotal, per-type total and grand total in the Excel export. */}
            <DuesReportRow
              rows={report?.duesReport || []}
              clubs={clubsDropdown}
              onDownload={exportWithFilename}
            />

            {/* 12. TRF Contributions */}
            <ClubFilterRow
              title="TRF Contributions"
              icon={IndianRupee}
              rows={report.trf || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="TRF_Contributions"
              baseColumns={[
                { key: "clubName", label: "Club", width: 25 },
                { key: "trfDate", label: "Date", width: 14 },
                { key: "donorName", label: "Member Name", width: 25 },
                { key: "fundName", label: "Fund", width: 20 },
                { key: "amountUsd", label: "Amount (USD)", width: 15 },
              ]}
              onDownload={exportWithFilename}
            />

            {/* 13. PPH Camp — shown BEFORE its attendees (see the camp first, then the
                attendance list for that camp). */}
            <ClubFilterRow
              title="PPH Camp (All Clubs)"
              icon={Tent}
              rows={report.pphCamps || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="PPH_Camp"
              baseColumns={[
                { key: "clubName", label: "Club", width: 25 },
                { key: "campDate", label: "Camp Date", width: 14 },
                { key: "title", label: "Camp Name", width: 30 },
                { key: "address", label: "Camp Address", width: 40 },
                { key: "attendanceCount", label: "Total Attendees", width: 14 },
              ]}
              onDownload={exportWithFilename}
            />

            {/* 14. PPH Camp Attendees */}
            <ClubFilterRow
              title="PPH Camp Attendees (All Clubs)"
              icon={Users}
              rows={report.pphCampAttendees || []}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="PPH_Camp_Attendees"
              baseColumns={[
                { key: "clubName", label: "Club", width: 25 },
                { key: "campDate", label: "Camp Date", width: 14, format: (v) => ddmmyyyy(v) },
                { key: "campName", label: "Camp Name", width: 30 },
                // One row per medical reading (camps in the selected Rotary year).
                { key: "readingDate", label: "Reading Date", width: 14, format: (v) => ddmmyyyy(v) },
                { key: "serialNumber", label: "Serial Number", width: 14 },
                { key: "name", label: "Name", width: 25 },
                { key: "mobileNumber", label: "Mobile Number", width: 16 },
                { key: "address", label: "Address", width: 35 },
                { key: "gender", label: "Gender", width: 10 },
                { key: "approvalForSms", label: "Approval for SMS", width: 14 },
                { key: "age", label: "Age", width: 8 },
                { key: "bpSystolic", label: "BP (Systolic)", width: 12 },
                { key: "bpDiastolic", label: "BP (Diastolic)", width: 12 },
                { key: "fbs", label: "FBS mg/dl", width: 12 },
                { key: "rbs", label: "RBS mg/dl", width: 12 },
                { key: "height", label: "Height (Cms)", width: 12 },
                { key: "weight", label: "Weight (kg)", width: 12 },
                { key: "bmi", label: "BMI", width: 10 },
                { key: "diabetes", label: "Diabetes", width: 22 },
                { key: "highBloodPressure", label: "High Blood Pressure", width: 22 },
                { key: "obese", label: "Obese", width: 10 },
                { key: "overweight", label: "Overweight", width: 12 },
                { key: "remarks", label: "Remarks", width: 30 },
              ]}
              onDownload={exportWithFilename}
            />

            {/* 11. Non Synchronized Clubs (renamed from Non RI Synchronized Clubs) */}
            <ReportSection
              title="Non Synchronized Clubs"
              icon={Building2}
              count={report.nonRiSyncedClubs?.length || 0}
              onExport={() =>
                exportSection(report.nonRiSyncedClubs, "Non_Synchronized_Clubs", [
                  { key: "srNo", label: "Sr. No.", width: 8, index: true },
                  { key: "clubId", label: "Club ID", width: 14 },
                  { key: "clubName", label: "Club Name", width: 30 },
                  { key: "charterDate", label: "Charter Date", width: 16, format: ddmmyyyy },
                  { key: "address", label: "Address", width: 45 },
                ])
              }
            />

            {/* 12. Synchronized Clubs (renamed) — same header as Non Synchronized */}
            <ReportSection
              title="Synchronized Clubs"
              icon={Building2}
              count={report.riSyncedClubs?.length || 0}
              onExport={() =>
                exportSection(report.riSyncedClubs, "Synchronized_Clubs", [
                  { key: "srNo", label: "Sr. No.", width: 8, index: true },
                  { key: "clubName", label: "Club Name", width: 30 },
                  { key: "districtNumber", label: "District Number", width: 14 },
                  { key: "president", label: "President", width: 25 },
                  { key: "presidentMobile", label: "President Mobile", width: 16 },
                  { key: "presidentEmail", label: "President Email", width: 30 },
                  { key: "secretary", label: "Secretary", width: 25 },
                  { key: "secretaryMobile", label: "Secretary Mobile", width: 16 },
                  { key: "secretaryEmail", label: "Secretary Email", width: 30 },
                ])
              }
            />

            {/* 14. Club Officers (From RI) — live from Rotary.org for the selected year. */}
            <ReportSection
              title="Club Officers (From RI)"
              icon={UserCog}
              count={clubsDropdown.length}
              onExport={async () => {
                try {
                  const rows = isMulti
                    ? (await Promise.all(districtIds!.map((id) => getDistrictClubOfficersRi(id, Number(selectedYearId)).catch(() => [] as any[])))).flat()
                    : await getDistrictClubOfficersRi(effectiveDistrictId, Number(selectedYearId), undefined, agMemberId);
                  if (!rows || rows.length === 0) { setErrorMessage("No club officers found from Rotary.org for the selected year."); return; }
                  // On-demand rows aren't part of the stamped payload — attach Zone + District
                  // by matching each officer row to its club (RI Director view only).
                  let officerRows = rows;
                  if (showGeoColumns) {
                    const geoById = new Map(clubsDropdown.map((c) => [Number(c.clubId), { districtNumber: c.districtNumber, zoneName: c.zoneName }]));
                    const geoByName = new Map(clubsDropdown.map((c) => [String(c.clubName || "").trim().toLowerCase(), { districtNumber: c.districtNumber, zoneName: c.zoneName }]));
                    officerRows = rows.map((r: any) => {
                      const g = geoById.get(Number(r.clubId)) || geoByName.get(String(r.clubName || "").trim().toLowerCase());
                      return { ...r, districtNumber: r.districtNumber ?? g?.districtNumber ?? districtNumber, zoneName: r.zoneName ?? g?.zoneName ?? (report?.district?.zoneName ?? "") };
                    });
                  }
                  exportSection(officerRows, "Club_Officers_RI", [
                    { key: "srNo", label: "Sr.No.", width: 8, index: true },
                    { key: "clubName", label: "Club Name", width: 26 },
                    { key: "presidentName", label: "President Name", width: 24 },
                    { key: "presidentEmail", label: "President EmailID", width: 28 },
                    { key: "presidentMobile", label: "President MobileNumber", width: 18 },
                    { key: "secretaryName", label: "Secretary Name", width: 24 },
                    { key: "secretaryEmail", label: "Secretary Email ID", width: 28 },
                    { key: "secretaryMobile", label: "Secretary Mobile Number", width: 18 },
                    { key: "execSecretaryName", label: "Club Executive Secretary Name", width: 26 },
                    { key: "execSecretaryMobile", label: "Club Executive Secretary Number", width: 18 },
                    { key: "execSecretaryEmail", label: "Club Executive Secretary Email", width: 28 },
                    { key: "treasurerName", label: "Club Treasurer", width: 24 },
                    { key: "treasurerEmail", label: "Club Treasurer EmailID", width: 28 },
                    { key: "treasurerMobile", label: "Club Treasurer MobileNumber", width: 18 },
                    { key: "foundationChairName", label: "Club Foundation Chair", width: 24 },
                    { key: "foundationChairEmail", label: "Club Foundation Chair EmailID", width: 28 },
                    { key: "foundationChairMobile", label: "Club Foundation Chair MobileNumber", width: 18 },
                    { key: "membershipChairName", label: "Club Membership Chair", width: 24 },
                    { key: "membershipChairEmail", label: "Club Membership Chair EmailID", width: 28 },
                    { key: "membershipChairMobile", label: "Club Membership Chair MobileNumber", width: 18 },
                    { key: "publicImageChairName", label: "Club Public Image Chair", width: 24 },
                    { key: "publicImageChairEmail", label: "Club Public Image Chair EmailID", width: 28 },
                    { key: "publicImageChairMobile", label: "Club Public Image Chair MobileNumber", width: 18 },
                    { key: "serviceProjectsChairName", label: "Club Service Projects Chair", width: 24 },
                    { key: "serviceProjectsChairEmail", label: "Club Service Projects Chair EmailID", width: 28 },
                    { key: "serviceProjectsChairMobile", label: "Club Service Projects Chair MobileNumber", width: 18 },
                  ]);
                } catch { setErrorMessage("Failed to fetch club officers from Rotary.org."); }
              }}
            />

            {/* Upcoming Events / Newsletters — CLUB scope (All Clubs or one club).
                District-level entries live in the District subsection below. GML is a
                DISTRICT-only term, so club-scope stays "Newsletters".
                (Announcements + Documents are district-only — removed from club scope.) */}
            <ClubFilterRow
              title="Upcoming Events"
              icon={CalendarClock}
              rows={(report.events || []).filter((r: any) => r.clubName !== "District Level")}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="Upcoming_Events"
              baseColumns={[
                { key: "clubName", label: "Club", width: 25 },
                { key: "title", label: "Title", width: 25 },
                { key: "description", label: "Description", width: 30 },
                { key: "eventDate", label: "Event Date", width: 14, format: ddmmyyyy },
                { key: "eventVenue", label: "Venue", width: 20 },
                { key: "imagePath", label: "Image", width: 14, hyperlink: true, linkText: "Image" },
                { key: "registrationLink", label: "Registration", width: 14, hyperlink: true, linkText: "Link" },
                { key: "publishDate", label: "Publish Date", width: 18 },
                { key: "status", label: "Status", width: 14 },
              ]}
              onDownload={exportWithFilename}
            />

            <ClubFilterRow
              title="Newsletters"
              icon={Newspaper}
              rows={(report.newsletters || []).filter((r: any) => r.clubName !== "District Level")}
              clubs={clubsDropdown}
              hideClub={hideClubFilter}
              defaultFile="Newsletters"
              baseColumns={[
                { key: "clubName", label: "Club", width: 25 },
                { key: "title", label: "Title", width: 25 },
                { key: "publishDate", label: "Publish Date", width: 18 },
                { key: "expiryDate", label: "Expiry", width: 18 },
                { key: "attachmentType", label: "Type", width: 12 },
                { key: "status", label: "Status", width: 14 },
              ]}
              onDownload={exportWithFilename}
            />

            {/* ── DISTRICT subsection ───────────────────────────────────── */}
            <SubsectionHeader title="District" />

            {/* District Goal Setting — the district's month-wise / till-date goals (all categories, 2 sheets). */}
            <DistrictGoalReports mode="district" districtId={effectiveDistrictId} yearId={Number(selectedYearId) || undefined} />

            {/* District Projects — hidden on the AG report: district-level, not their clubs. */}
            {!isAgReport && (
            <ReportSection
              title="District Projects"
              icon={Award}
              count={report.districtProjects?.length || 0}
              onExport={() =>
                exportSection(report.districtProjects, "District_Projects", [
                  { key: "srNo", label: "Sr. No.", width: 8, index: true },
                  { key: "areaOfFocus", label: "Area of Focus", width: 22 },
                  { key: "category", label: "Category", width: 18 },
                  { key: "subCategory", label: "Sub Category", width: 18 },
                  { key: "projectDate", label: "Date", width: 14, format: ddmmyyyy },
                  { key: "title", label: "Title", width: 28 },
                  { key: "description", label: "Description", width: 40 },
                  { key: "location", label: "Project Location", width: 22 },
                  { key: "projectCost", label: "Project Cost", width: 14 },
                  { key: "funding", label: "Funding", width: 16 },
                  { key: "globalGrantNumber", label: "Global Grant Number", width: 18 },
                  { key: "csrCompanyName", label: "Name of the CSR Company", width: 22 },
                  { key: "amountSanctioned", label: "Amount Sanctioned", width: 16 },
                  { key: "amountReceived", label: "Amount Received", width: 16 },
                  { key: "amountSpent", label: "Amount spent till date", width: 18 },
                  { key: "hostClubsDistricts", label: "Host Clubs/Districts", width: 22 },
                  { key: "globalPartners", label: "Global Partner Clubs/Districts", width: 22 },
                  { key: "directBeneficiaries", label: "Beneficiaries", width: 14 },
                  { key: "manHours", label: "Man Hours", width: 12 },
                  { key: "rotariansInvolved", label: "Rotarians Involved", width: 18 },
                  { key: "publicPhotoUrl", label: "Image", width: 12, hyperlink: true, linkText: "Image" },
                ])
              }
            />
            )}

            {/* District Events — from district admin → Foundation → District Events
                (year-wise projects table, DistrictProjectType='Event'). Hidden on the AG
                report: district-level, not their clubs. */}
            {!isAgReport && (
            <ReportSection
              title="District Events"
              icon={CalendarClock}
              count={report.districtEvents?.length || 0}
              onExport={() =>
                exportSection(
                  report.districtEvents || [],
                  "District_Events",
                  [
                    { key: "srNo", label: "Sr. No.", width: 8, index: true },
                    { key: "title", label: "Title", width: 28 },
                    { key: "description", label: "Description", width: 40 },
                    { key: "eventDate", label: "Event Date", width: 14, format: ddmmyyyy },
                    { key: "imagePath", label: "Image", width: 12, hyperlink: true, linkText: "Image" },
                  ],
                )
              }
            />
            )}

            {/* District Upcoming Events — from district admin → Communication → Upcoming
                Events (the upcoming_events feed, district-level entries). Separate from the
                Foundation "District Events" above. Hidden on the AG report. */}
            {!isAgReport && (
            <ReportSection
              title="District Upcoming Events"
              icon={CalendarClock}
              count={(report.events || []).filter((e: any) => e.clubName === "District Level").length}
              onExport={() =>
                exportSection(
                  (report.events || []).filter((e: any) => e.clubName === "District Level"),
                  "District_Upcoming_Events",
                  [
                    { key: "srNo", label: "Sr. No.", width: 8, index: true },
                    { key: "title", label: "Title", width: 28 },
                    { key: "description", label: "Description", width: 40 },
                    { key: "eventDate", label: "Event Date", width: 14, format: ddmmyyyy },
                    { key: "eventVenue", label: "Venue", width: 24 },
                    { key: "registrationLink", label: "Registration Link", width: 26 },
                    { key: "status", label: "Status", width: 14 },
                    { key: "imagePath", label: "Image", width: 12, hyperlink: true, linkText: "Image" },
                  ],
                )
              }
            />
            )}

            {/* District-level Announcements / Newsletters / Documents (district scope
                only; club-scoped copies live in the Clubs subsection above).
                Hidden on the AG report — the club-scoped copies above already cover
                their clubs; these are district-wide and not theirs. */}
            {!isAgReport && (<>
            <ReportSection
              title="Announcements"
              icon={Megaphone}
              count={(report.announcements || []).filter((r: any) => r.clubName === "District Level").length}
              onExport={() => exportSection(
                (report.announcements || []).filter((r: any) => r.clubName === "District Level"),
                "District_Announcements", [
                  { key: "srNo", label: "Sr. No.", width: 8, index: true },
                  { key: "title", label: "Title", width: 25 },
                  { key: "description", label: "Description", width: 30 },
                  { key: "imagePath", label: "Image", width: 14, hyperlink: true, linkText: "Image" },
                  { key: "publishDate", label: "Publish Date", width: 18 },
                  { key: "expiryDate", label: "Expiry Date", width: 18 },
                  { key: "status", label: "Status", width: 14 },
                ])} />

            <ReportSection
              title="GML"
              icon={Newspaper}
              count={(report.newsletters || []).filter((r: any) => r.clubName === "District Level").length}
              onExport={() => exportSection(
                // Open URL = the external link (link-type GML) or the uploaded file path.
                (report.newsletters || [])
                  .filter((r: any) => r.clubName === "District Level")
                  .map((r: any) => ({ ...r, openUrl: r.linkUrl || r.filePath || "" })),
                "District_GML", [
                  { key: "srNo", label: "Sr. No.", width: 8, index: true },
                  { key: "title", label: "Title", width: 25 },
                  { key: "publishDate", label: "Publish Date", width: 18 },
                  { key: "attachmentType", label: "Type", width: 12 },
                  { key: "openUrl", label: "Link", width: 26, hyperlink: true, linkText: "Open" },
                ])} />

            <ReportSection
              title="Documents"
              icon={FileText}
              count={(report.documents || []).filter((r: any) => r.clubName === "District Level").length}
              onExport={() => exportSection(
                (report.documents || []).filter((r: any) => r.clubName === "District Level"),
                "District_Documents", [
                  { key: "srNo", label: "Sr. No.", width: 8, index: true },
                  { key: "title", label: "Title", width: 25 },
                  { key: "accessType", label: "Access", width: 14 },
                  { key: "publishDate", label: "Publish", width: 18 },
                  { key: "expiryDate", label: "Expiry", width: 18 },
                ])} />
            </>)}

            {/* AG Allocation */}
            <ReportSection
              title="AG Allocation"
              icon={UserCog}
              count={report.agAllocation?.length || 0}
              onExport={() => {
                // AG details shown ONCE per AG, then blank on that AG's remaining allocated-
                // club rows (only the club columns repeat). Grouped by AG so each block is
                // contiguous; keyed by agMemberId (falling back to agName).
                const agKeys = ["agName", "agClubName", "agMobile", "agEmail"];
                const sorted = [...(report.agAllocation || [])].sort((a: any, b: any) =>
                  String(a.agMemberId ?? a.agName ?? "").localeCompare(String(b.agMemberId ?? b.agName ?? "")));
                const seen = new Set<string>();
                const data = sorted.map((r: any) => {
                  const key = String(r.agMemberId ?? r.agName ?? "");
                  const first = !seen.has(key);
                  seen.add(key);
                  const out: any = { ...r };
                  if (!first) for (const k of agKeys) out[k] = "";
                  return out;
                });
                return exportSection(data, "AG_Allocation", [
                  { key: "srNo", label: "Sr. No.", width: 8, index: true },
                  { key: "agName", label: "AG Name", width: 25 },
                  { key: "agClubName", label: "AG Club Name", width: 25 },
                  { key: "agMobile", label: "AG Mobile", width: 16 },
                  { key: "agEmail", label: "AG Email ID", width: 30 },
                  { key: "clubName", label: "Allocated Club Name", width: 30 },
                  { key: "clubRotaryId", label: "Club Rotary Id", width: 16 },
                ]);
              }}
            />

          {/* Attendance / BOD / Members / TRF moved up into Members + Clubs
              subsections (with dropdowns). District-level rows continue below.
              Announcements / Events / Newsletters / Documents also moved up
              into the CLUBS subsection per spec. */}

          {/* 1. District Committee — multi-sheet workbook with three sheets:
              District Committee (top-level direct members), Group Committee
              (group-level members), Sub Group Committee (sub-group members). */}
          {/* Hidden on the AG report — district-level roster, not their clubs. */}
          {!isAgReport && (
          <ReportSection
            title="District Committee"
            icon={UserCircle}
            count={(report.committeeMain?.length || 0) + (report.committeeGroup?.length || 0) + (report.committeeSubGroup?.length || 0)}
            onExport={() => {
              const wb = XLSX.utils.book_new();
              // RI Director view: lead every sheet with Zone + District Number (rows pre-stamped).
              const geoCols = showGeoColumns
                ? [{ key: "zoneName", label: "Zone", width: 16 }, { key: "districtNumber", label: "District Number", width: 16 }]
                : [];
              const mkSheet = (rows: any[], cols: { key: string; label: string; width?: number }[]) => {
                if (!rows || rows.length === 0) rows = [];
                const headerRow = cols.map((c) => c.label);
                const dataRows = rows.map((r) => cols.map((c) => r[c.key] ?? ""));
                const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
                ws["!cols"] = cols.map((c) => ({ wch: c.width || 18 }));
                // Header style
                cols.forEach((_, idx) => {
                  const cell = ws[XLSX.utils.encode_cell({ r: 0, c: idx })];
                  if (cell) cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1F4E79" } }, alignment: { horizontal: "center" as const } };
                });
                return ws;
              };
              XLSX.utils.book_append_sheet(wb, mkSheet(report.committeeMain || [], [
                ...geoCols,
                { key: "memberName", label: "Member Name", width: 30 },
                { key: "designation", label: "Designation", width: 28 },
                { key: "mobile", label: "Mobile", width: 16 },
                { key: "email", label: "Email", width: 30 },
              ]), "District Committee");
              XLSX.utils.book_append_sheet(wb, mkSheet(report.committeeGroup || [], [
                ...geoCols,
                { key: "groupName", label: "Group", width: 28 },
                { key: "memberName", label: "Member Name", width: 28 },
                { key: "designation", label: "Designation", width: 26 },
                { key: "mobile", label: "Mobile", width: 16 },
                { key: "email", label: "Email", width: 30 },
              ]), "Group Committee");
              XLSX.utils.book_append_sheet(wb, mkSheet(report.committeeSubGroup || [], [
                ...geoCols,
                { key: "groupName", label: "Group", width: 24 },
                { key: "subGroupName", label: "Sub Group", width: 28 },
                { key: "memberName", label: "Member Name", width: 28 },
                { key: "designation", label: "Designation", width: 26 },
                { key: "mobile", label: "Mobile", width: 16 },
                { key: "email", label: "Email", width: 30 },
              ]), "Sub Group Committee");
              XLSX.writeFile(wb, `${filePrefix}_Committee_${fileTimestamp()}.xlsx`);
            }}
          />
          )}

          {/* 2 + 3. District Awards (All clubs + per-club via dropdown).
              Hidden in "All Districts" mode — each district defines its own award
              columns, so they can't merge into one sheet; available per-district. */}
          {!isMulti && (
          <AwardsClubFilterRow
            title="District Awards (Club Wise)"
            icon={Star}
            clubs={clubsDropdown}
            hideClub={hideClubFilter}
            districtId={effectiveDistrictId}
            districtNumber={districtNumber}
            selectedYearId={selectedYearId}
            onEmpty={setErrorMessage}
            compact
          />
          )}

          {/* 4. District Awards (AG Wise) — hidden on the AG report + when AG-wise suppressed. */}
          {showAgRows && !isMulti && (
          <AwardsAgFilterRow
            title="District Awards (AG Wise)"
            icon={Star}
            ags={agsDropdown}
            districtId={effectiveDistrictId}
            districtNumber={districtNumber}
            selectedYearId={selectedYearId}
            onEmpty={setErrorMessage}
            compact
          />
          )}

          {/* 5 + 6. District Awards Extended (All clubs + per-club via dropdown) */}
          {!isMulti && (
          <AwardsClubFilterRow
            title="District Awards Extended (Club Wise)"
            icon={Star}
            clubs={clubsDropdown}
            hideClub={hideClubFilter}
            districtId={effectiveDistrictId}
            districtNumber={districtNumber}
            selectedYearId={selectedYearId}
            onEmpty={setErrorMessage}
          />
          )}

          {/* 7. District Awards Extended (AG Wise) — hidden on the AG report + when AG-wise suppressed. */}
          {showAgRows && !isMulti && (
          <AwardsAgFilterRow
            title="District Awards Extended (AG Wise)"
            icon={Star}
            ags={agsDropdown}
            districtId={effectiveDistrictId}
            districtNumber={districtNumber}
            selectedYearId={selectedYearId}
            onEmpty={setErrorMessage}
          />
          )}

          {/* 8. Governor's Official Visit (OCV/GOV) — Club Wise + AG Wise, all sub-modules.
              Club Wise needs a single club, so it's dropped when the per-club dropdown is
              hidden (RI Director) or in "All Districts" mode. */}
          {!hideClubFilter && !isMulti && (
          <OcvReportRow
            mode="club"
            clubs={clubsDropdown}
            districtId={effectiveDistrictId}
            districtNumber={districtNumber}
            yearId={selectedYearId}
            yearLabel={yearLabel}
            onEmpty={setErrorMessage}
          />
          )}
          {/* AG Wise — hidden on the AG report + when AG-wise reports are suppressed. */}
          {showAgRows && !isMulti && (
          <OcvReportRow
            mode="ag"
            ags={agsDropdown}
            districtId={effectiveDistrictId}
            districtNumber={districtNumber}
            yearId={selectedYearId}
            yearLabel={yearLabel}
            onEmpty={setErrorMessage}
          />
          )}

          {/* Data Collection (All Members / BOD / DC) reports removed from the
              District subsection per spec — they remain in the Members subsection. */}
          </>}
        </>
      )}
    </div>
  );
}

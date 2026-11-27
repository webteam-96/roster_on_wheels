import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import ClubGoalComingSoon from "@/components/ClubGoalComingSoon";
import { Award, Crown, Download, FileSpreadsheet, FileText, UserCircle, type LucideIcon } from "@/components/icons";
import { downloadOcvReportExcel, downloadOcvReportWord } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import LoadingButton from "@/components/v2/LoadingButton";
import { useDownloadProgress } from "@/lib/downloadProgress";

// Disabled placeholder row used for reports still being built ("Coming Soon").
// Keeps the title visible but disables the Excel button so users know it's on
// the roadmap. Used for District Dues + the two Word .docx reports per spec.
// A real Word .docx download row (parallels SectionRow but for server-generated Word).
export function WordReportRow({
  title,
  subtitle,
  icon: Icon,
  onDownload,
  dl,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  onDownload: () => Promise<void> | void;
  dl: ReturnType<typeof useDownloadProgress>;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-blue-50/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-azure/10 text-azure ring-1 ring-blue-100 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
      </div>
      <Button
        type="button"
        onClick={() => dl.run("annual-report-word", async () => { await onDownload(); }, true)}
        disabled={dl.busy}
        variant="outline" size="sm"
      >
        {dl.is("annual-report-word") ? dl.bar("annual-report-word") : <><Download size={13} /> Word</>}
      </Button>
    </li>
  );
}

// Governor's Official Visit (OCV/GOV) row — Excel + Word icons for THIS club. Uses the same
// rich per-club report the district module downloads (documents/{...}/report/{excel|word}).
export function OcvClubReportRow({ clubId, yearId, clubName, yearLabel, dl }: {
  clubId: number; yearId: number; clubName: string; yearLabel: string;
  dl: ReturnType<typeof useDownloadProgress>;
}) {
  const base = `${(clubName || `Club_${clubId}`).replace(/\s+/g, "_")}_OCV_${yearLabel}`;
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-blue-50/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-azure/10 text-azure ring-1 ring-blue-100 shrink-0">
          <Crown size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">Governor&apos;s Official Visit (OCV/GOV)</p>
          <p className="text-xs text-slate-500 truncate">All sub-modules + uploaded documents · RY {yearLabel}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => dl.run("ocv-excel", async () => { await downloadOcvReportExcel(clubId, yearId, base); })}
          disabled={dl.busy}
          variant="outline" size="sm"
        >
          {dl.is("ocv-excel") ? dl.bar("ocv-excel", "bg-emerald-600") : <><FileSpreadsheet size={13} /> Excel</>}
        </Button>
        <Button
          type="button"
          onClick={() => dl.run("ocv-word", async () => { await downloadOcvReportWord(clubId, yearId, base); }, true)}
          disabled={dl.busy}
          variant="outline" size="sm"
        >
          {dl.is("ocv-word") ? dl.bar("ocv-word") : <><FileText size={13} /> Word</>}
        </Button>
      </div>
    </li>
  );
}

export function ComingSoonRow({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 opacity-60">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 ring-1 ring-slate-200 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700 truncate">{title}</p>
          <p className="text-xs text-amber-600">Coming Soon</p>
        </div>
      </div>
      <Button
        type="button"
        disabled
        variant="outline" size="sm" className="cursor-not-allowed"
      >
        <Download size={13} /> Excel
      </Button>
    </li>
  );
}

// ── Avenue of Service row with inline avenue dropdown ───────────────────
// Single download button + dropdown. Columns and dataset switch based on
// selection so the generated Excel matches the legacy per-avenue layout:
//   Club Service        → meeting-style 10 cols (date, title, attendance ...)
//   Community/Int'l/Voc/Public Image → project-style 19 cols
//   All                 → unified 23-col layout (meetings + every project)
export function AvenueOfServiceRow({
  attendance,
  projectsByModule,
  clubName,
  yearLabel,
}: {
  attendance: any[];
  projectsByModule: Record<string, any[]>;
  clubName: string;
  yearLabel: string;
}) {
  type Avenue = "all" | "club_service" | "community_service" | "international_service" | "vocational_service" | "public_image_initiative";
  const [avenue, setAvenue] = useState<Avenue>("all");

  const AVENUE_LABELS: Record<Avenue, string> = {
    all:                     "All",
    club_service:            "Club Service",
    community_service:       "Community Service",
    international_service:   "International Service",
    vocational_service:      "Vocational Service",
    public_image_initiative: "Public Image Initiative",
  };

  // Row count for display — what the download will contain.
  const count = useMemo(() => {
    if (avenue === "all") {
      const projCount = Object.values(projectsByModule).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      return attendance.length + projCount;
    }
    if (avenue === "club_service") return attendance.length;
    return (projectsByModule[avenue] || []).length;
  }, [avenue, attendance, projectsByModule]);

  const hasData = count > 0;

  const fmtDate = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };

  // 10-col Club Service columns (meeting-style).
  const clubServiceCols: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; numeric?: boolean }[] = [
    { key: "date",             label: "Date",            width: 14 },
    { key: "title",            label: "Title",           width: 30 },
    { key: "description",      label: "Description",     width: 40 },
    { key: "meeting",          label: "Meeting",         width: 14 },
    { key: "membersPresent",   label: "Attendance",      width: 14, numeric: true },
    { key: "attendancePercent",label: "Attendance(%)",   width: 14, numeric: true },
    { key: "url",              label: "URL",             width: 16 },
    { key: "linkAgenda",       label: "Link Agenda",     width: 16 },
    { key: "linkMom",          label: "Link MOM",        width: 16 },
  ];

  // 24-col project columns (used for All + Community Service) — +Image hyperlink.
  const projectColsWide: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; numeric?: boolean }[] = [
    { key: "typeOfProject",        label: "Type of Project",          width: 18 },
    { key: "clubRole",             label: "Your Club Role",           width: 16 },
    { key: "coHostName",           label: "Co-host Name",             width: 18 },
    { key: "areaOfFocus",          label: "Area of Focus",            width: 22 },
    { key: "projectDate",          label: "Date",                     width: 14 },
    { key: "title",                label: "Title",                    width: 28 },
    { key: "description",          label: "Description",              width: 40 },
    { key: "location",             label: "Project Location",         width: 20 },
    { key: "projectCost",          label: "Project Cost",             width: 14, numeric: true },
    { key: "funding",              label: "Funding",                  width: 16 },
    { key: "globalGrantNumber",    label: "Global Grant Number",      width: 18 },
    { key: "csrCompanyName",       label: "Name of the CSR Company",  width: 22 },
    { key: "amountSanctioned",     label: "Amount Sanctioned",        width: 16, numeric: true },
    { key: "amountReceived",       label: "Amount Received",          width: 16, numeric: true },
    { key: "amountSpent",          label: "Amount spent till date",   width: 18, numeric: true },
    { key: "hostClubsDistricts",   label: "Host Clubs/Districts",     width: 22 },
    { key: "globalPartners",       label: "Global Partner Clubs/Districts", width: 22 },
    { key: "beneficiaries",        label: "Beneficiaries",            width: 14, numeric: true },
    { key: "manHours",             label: "Man Hours",                width: 12, numeric: true },
    { key: "rotariansInvolved",    label: "Rotarians Involved",       width: 18, numeric: true },
    { key: "publicPhotoUrl",       label: "Image",                    width: 14, hyperlink: true, linkText: "Image" },
  ];

  // 20-col project columns (Int'l / Vocational / Public Image legacy layout) — +Image hyperlink.
  const projectColsNarrow: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; numeric?: boolean }[] = [
    { key: "projectDate",          label: "Date",                     width: 14 },
    { key: "title",                label: "Title",                    width: 28 },
    { key: "description",          label: "Description",              width: 40 },
    { key: "location",             label: "Project Location",         width: 20 },
    { key: "projectCost",          label: "Project Cost",             width: 14, numeric: true },
    { key: "funding",              label: "Funding",                  width: 16 },
    { key: "globalGrantNumber",    label: "Global Grant Number",      width: 18 },
    { key: "csrCompanyName",       label: "Name of the CSR Company",  width: 22 },
    { key: "amountSanctioned",     label: "Amount Sanctioned",        width: 16, numeric: true },
    { key: "amountReceived",       label: "Amount Received",          width: 16, numeric: true },
    { key: "amountSpent",          label: "Amount spent till date",   width: 18, numeric: true },
    { key: "hostClubsDistricts",   label: "Host Clubs/Districts",     width: 22 },
    { key: "globalPartners",       label: "Global Partner Clubs/Districts", width: 22 },
    { key: "beneficiaries",        label: "Beneficiaries",            width: 14, numeric: true },
    { key: "manHours",             label: "Man Hours",                width: 12, numeric: true },
    { key: "rotariansInvolved",    label: "Rotarians Involved",       width: 18, numeric: true },
    { key: "publicPhotoUrl",       label: "Image",                    width: 14, hyperlink: true, linkText: "Image" },
  ];

  // Map the project's moduleKey to its human-readable avenue label. Used as the
  // "Type of Project" column value in the wide layout — admins want to see which
  // avenue each row belongs to (Club Service / Community Service / Vocational
  // Service / International Service / Public Image Initiative), not the raw
  // project_type enum.
  const AVENUE_LABEL_MAP: Record<string, string> = {
    club_service:            "Club Service",
    community_service:       "Community Service",
    vocational_service:      "Vocational Service",
    international_service:   "International Service",
    public_image_initiative: "Public Image Initiative",
  };

  // Project rows from the year-wise payload → normalised to the wide column shape.
  // publicPhotoUrl is already provided by the backend (CONCAT('{frontendUrl}/public/project/', id, '?year=', yearId))
  // so the Image column renders as a clickable hyperlink in the exported workbook.
  const projectToWide = (p: any): Record<string, any> => ({
    typeOfProject:     AVENUE_LABEL_MAP[p.moduleKey] || p.moduleName || "Project",
    clubRole:          p.clubRole || "",
    coHostName:        p.coHostName || "",
    areaOfFocus:       p.areaOfFocus || "",
    projectDate:       fmtDate(p.projectDate),
    title:             p.title || "",
    description:       p.description || "",
    location:          p.location || "",
    projectCost:       p.projectCost ?? "",
    funding:           p.funding || "",
    globalGrantNumber: p.globalGrantNumber || "",
    csrCompanyName:    p.csrCompanyName || "",
    amountSanctioned:  p.amountSanctioned ?? "",
    amountReceived:    p.amountReceived ?? "",
    amountSpent:       p.amountSpent ?? "",
    hostClubsDistricts:p.hostClubsDistricts || "",
    globalPartners:    p.globalPartnerClubs || p.globalPartners || "",
    beneficiaries:     p.directBeneficiaries ?? "",
    manHours:          p.manHours ?? "",
    rotariansInvolved: p.rotariansInvolved ?? "",
    publicPhotoUrl:    p.publicPhotoUrl || "",
  });

  const meetingToWide = (m: any): Record<string, any> => ({
    typeOfProject:     "Club Service",
    projectDate:       fmtDate(m.date),
    title:             m.title,
    description:       m.description || "",
    membersPresent:    m.membersPresent ?? 0,
    attendancePercent: m.attendancePercent ?? 0,
  });

  const meetingToClubService = (m: any): Record<string, any> => ({
    date:              fmtDate(m.date),
    title:             m.title,
    description:       m.description || "",
    meeting:           "Regular",
    membersPresent:    m.membersPresent ?? 0,
    attendancePercent: m.attendancePercent ?? 0,
    url:               "",
    linkAgenda:        "",
    linkMom:           "",
  });

  const onExport = async () => {
    if (!hasData) return;
    const clubSafe  = (clubName || "Club").replace(/\s+/g, "_");
    const labelSafe = AVENUE_LABELS[avenue].replace(/\s+/g, "_");

    if (avenue === "club_service") {
      const rows = attendance.map(meetingToClubService);
      exportToCSV(rows, `${clubSafe}_Club_Service`, clubServiceCols, {
        title: `Club Service | ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}`,
      });
      return;
    }

    if (avenue === "all") {
      const meetingRows = attendance.map(meetingToWide);
      const projectRows = Object.values(projectsByModule)
        .flat()
        .map(projectToWide);
      exportToCSV([...meetingRows, ...projectRows], `${clubSafe}_All_Avenue_of_service_Projects`, projectColsWide, {
        title: `All Avenues of Service | ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}`,
      });
      return;
    }

    const projects = (projectsByModule[avenue] || []).map(projectToWide);
    const cols = avenue === "community_service" ? projectColsWide : projectColsNarrow;
    exportToCSV(projects, `${clubSafe}_${labelSafe}`, cols, {
      title: `${AVENUE_LABELS[avenue]} | ${clubName}`,
      subtitle: `Rotary Year: ${yearLabel}`,
    });
  };

  return (
    <li className={`flex items-center justify-between gap-3 px-5 py-3 ${hasData ? "hover:bg-blue-50/40" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-azure/10 text-azure ring-1 ring-blue-100 shrink-0">
          <Award size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">Avenue of Service</p>
          <p className="text-xs text-slate-500">
            {count} {count === 1 ? "record" : "records"}
            <span className="text-slate-400"> · {AVENUE_LABELS[avenue]}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={avenue}
          onChange={(e) => setAvenue(e.target.value as Avenue)}
          className="row-field-sm max-w-[200px] w-auto"
        >
          <option value="all">All</option>
          <option value="club_service">Club Service</option>
          <option value="community_service">Community Service</option>
          <option value="international_service">International Service</option>
          <option value="vocational_service">Vocational Service</option>
          <option value="public_image_initiative">Public Image Initiative</option>
        </NativeSelect>
        <LoadingButton
          onAction={async () => { await onExport(); }}
          disabled={!hasData}
          className="row-btn row-btn-secondary row-btn-sm"
        >
          <Download size={13} /> Excel
        </LoadingButton>
      </div>
    </li>
  );
}

// ── BOD row with inline designation dropdown ────────────────────────────
// Designation picker is built from the DISTINCT designations actually
// present in this club's BOD for the selected year — keeps the dropdown
// short and meaningful. "All" downloads every BOD row.
export function BodSectionRow({
  bod,
  yearLabel,
  clubName,
}: {
  bod: any[];
  yearLabel: string;
  clubName: string;
}) {
  const [designation, setDesignation] = useState<string>("__all__");
  const designations = useMemo(() => {
    const set = new Set<string>();
    for (const r of bod) {
      const d = (r?.designation || "").toString().trim();
      if (d) set.add(d);
    }
    return Array.from(set).sort();
  }, [bod]);
  const filtered = designation === "__all__"
    ? bod
    : bod.filter((r) => (r?.designation || "").toString().trim() === designation);
  const hasData = filtered.length > 0;

  const onExport = async () => {
    if (!hasData) return;
    const safe = (clubName || "Club").replace(/\s+/g, "_");
    const suffix = designation === "__all__" ? "All" : designation.replace(/\s+/g, "_");
    exportToCSV(
      filtered,
      `${safe}_Board_of_Directors_${suffix}`,
      [
        { key: "clubName",   label: "Club Name",     width: 25 },
        { key: "designation",label: "Designation",   width: 22 },
        { key: "memberName", label: "Member Name",   width: 25 },
        { key: "email",      label: "Email ID",      width: 30 },
        { key: "mobile",     label: "Mobile Number", width: 16 },
        { key: "autoManual", label: "Auto_Manual",   width: 14 },
      ],
      {
        title: `Board of Directors | ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}${designation === "__all__" ? "" : ` · ${designation}`}`,
      },
    );
  };

  return (
    <li className={`flex items-center justify-between gap-3 px-5 py-3 ${hasData ? "hover:bg-blue-50/40" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-azure/10 text-azure ring-1 ring-blue-100 shrink-0">
          <UserCircle size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">Board of Directors (BOD)</p>
          <p className="text-xs text-slate-500">
            {filtered.length} {filtered.length === 1 ? "record" : "records"}
            {designation !== "__all__" && <span className="text-slate-400"> · filtered</span>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          className="row-field-sm max-w-[180px] w-auto"
        >
          <option value="__all__">All Designations</option>
          {designations.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </NativeSelect>
        <LoadingButton
          onAction={async () => { await onExport(); }}
          disabled={!hasData}
          className="row-btn row-btn-secondary row-btn-sm"
        >
          <Download size={13} /> Excel
        </LoadingButton>
      </div>
    </li>
  );
}

// ── Subsection divider used to group export rows ────────────────────────
// Renders as a small sticky-looking header inside the export list.
// Body is empty for now; the user assigns existing SectionRows beneath
// each header iteratively.
export function SubsectionHeader({ title }: { title: string }) {
  return (
    <li className="bg-slate-50/80 px-5 py-2 border-b border-slate-200">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </p>
    </li>
  );
}

// ── Single export row: icon + title + count + LoadingButton download ────
export function SectionRow({
  title,
  icon: Icon,
  count,
  onExport,
  loading = false,
  comingSoon = false,
  dl,
  dlKey,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  onExport: () => Promise<void> | void;
  loading?: boolean;
  comingSoon?: boolean;
  /** Server file download: progress bar inside the button, one report at a time on the page. */
  dl?: ReturnType<typeof useDownloadProgress>;
  dlKey?: string;
}) {
  const hasData = !loading && count > 0 && !comingSoon;
  return (
    <li
      className={`flex items-center justify-between gap-3 px-5 py-3 ${
        hasData ? "hover:bg-blue-50/40" : ""
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-azure/10 text-azure ring-1 ring-blue-100 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{title}</p>
          <p className="text-xs text-slate-500">
            {comingSoon ? "Coming soon" : loading ? "Loading…" : `${count} ${count === 1 ? "record" : "records"}`}
          </p>
        </div>
      </div>
      {comingSoon ? (
        <ClubGoalComingSoon compact />
      ) : dl && dlKey ? (
      <Button
        type="button"
        onClick={() => dl.run(dlKey, async () => { await onExport(); })}
        disabled={!hasData || dl.busy}
        variant="outline" size="sm"
      >
        {dl.is(dlKey) ? dl.bar(dlKey) : <><Download size={13} /> Excel</>}
      </Button>
      ) : (
      <LoadingButton
        onAction={async () => {
          await onExport();
        }}
        disabled={!hasData}
        className="row-btn row-btn-secondary row-btn-sm"
      >
        <Download size={13} /> Excel
      </LoadingButton>
      )}
    </li>
  );
}

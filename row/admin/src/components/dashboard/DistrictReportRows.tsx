import { useState } from "react";
import { exportMonthlyPivot } from "@/utils/csvExport";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, IndianRupee, ClipboardList } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";

export function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: any; color: string }) {
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

export function ReportSection({ title, icon: Icon, count, onExport, dl, dlKey }: { title: string; icon: React.ElementType; count: number; onExport: () => void | Promise<void>; dl?: ReturnType<typeof useDownloadProgress>; dlKey?: string }) {
  const hasData = count > 0;
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    // Server file download: progress bar inside the button, one report at a time on the page.
    if (dl && dlKey) { await dl.run(dlKey, async () => { await onExport(); }); return; }
    if (busy) return;
    setBusy(true);
    try { await onExport(); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{count} {count === 1 ? "record" : "records"}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleClick} disabled={!hasData || busy || !!dl?.busy}>
          {dl && dlKey && dl.is(dlKey) ? dl.bar(dlKey) : busy ? (
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

// Rotary Network download row (Terminated / Potential members) — inline club dropdown
// ("All" + each club) that FETCHES the rows on demand, then exports. Mirrors
// the club rows above, with the exact "All" label the spec asks for.
export function NetworkDownloadRow({
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-wrap items-center gap-2">
          <Select value={clubId} onValueChange={(v) => { setClubId(v); setNoRecords(false); }}>
            <SelectTrigger className="row-field-sm w-40"><SelectValue placeholder="All" /></SelectTrigger>
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
export function SubsectionHeader({ title }: { title: string }) {
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
export function appUserTally(list: any[]): { notDownloaded: number; android: number; ios: number } {
  let android = 0, ios = 0, notDownloaded = 0;
  for (const u of list) {
    if (String(u.downloaded) !== "Yes") { notDownloaded++; continue; }
    const p = String(u.platform || "").toLowerCase();
    if (p.includes("android")) android++;
    else if (p.includes("ios") || p.includes("iphone") || p.includes("apple")) ios++;
  }
  return { notDownloaded, android, ios };
}

export function ClubFilterRow({
  title, icon, rows, clubs, defaultFile, baseColumns, onDownload, renderNote, summaryText, hideClub = false,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  clubs: { clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string; numeric?: boolean }[];
  onDownload: (rows: any[], filenameBase: string, label: string, columns: typeof baseColumns, summary?: string) => void;
  renderNote?: (filtered: any[]) => React.ReactNode;
  /** Optional summary line written into the Excel header (e.g. Not Downloaded / Android / iOS totals). */
  summaryText?: (filtered: any[]) => string;
  /** Multi-district ("All Districts") mode: drop the per-club dropdown; always download every club. */
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-wrap items-center gap-2">
          {!hideClub && (
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="row-field-sm w-40"><SelectValue placeholder="All Clubs" /></SelectTrigger>
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
export function DuesReportRow({
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-wrap items-center gap-2">
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="row-field-sm w-40"><SelectValue placeholder="All Clubs" /></SelectTrigger>
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
export function ClubMonthlyProjectDetailsRow({
  mode = "club", rows, clubs, ags, yearLabel, districtNumber, isCurrentYear, hideClub = false, showGeo = false,
}: {
  mode?: "club" | "ag";
  rows: any[];
  clubs: { clubId: number; clubName: string; districtNumber?: string; zoneName?: string }[];
  ags: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  yearLabel: string;
  districtNumber: string;
  isCurrentYear: boolean;
  /** Multi-district ("All Districts") mode: drop the per-club dropdown; always all clubs. */
  hideClub?: boolean;
  /** Geo-columns view: prepend Zone + District Number lead columns. */
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
      cols: METRICS.map((mt) => ({ key: `m${m}_${mt.key}`, label: mt.label, width: mt.width, numeric: true })),
    }));
    // Final "Total" group — sum of every shown month per metric, per club.
    groups.push({
      label: "Total (All Months)",
      cols: METRICS.map((mt) => ({ key: `total_${mt.key}`, label: mt.label, width: mt.width, numeric: true })),
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
      title: `${title} | District ${districtNumber}`,
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-wrap items-center gap-2">
          {isAgMode ? (
            <Select value={agId} onValueChange={setAgId}>
              <SelectTrigger className="row-field-sm w-44"><SelectValue placeholder="Select AG" /></SelectTrigger>
              <SelectContent>
                {uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (!hideClub && (
            <Select value={clubId} onValueChange={setClubId}>
              <SelectTrigger className="row-field-sm w-44"><SelectValue placeholder="All Clubs" /></SelectTrigger>
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

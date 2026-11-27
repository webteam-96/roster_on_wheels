import { useState } from "react";
import { getCitationMatrix, downloadOcvReportExcel, downloadOcvReportWord } from "@/services/api";
import { exportCitationMatrix } from "@/utils/citationMatrixExport";
import { downloadAgOcvZip } from "@/utils/ocvAgZip";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Crown, FileSpreadsheet } from "@/components/icons";

// Row with an inline AG dropdown ("All AGs" + each AG). Selecting an AG narrows
// the input rows to clubs assigned to that AG (using agAllocation map).
export function AgFilterRow({
  title, icon, rows, ags, defaultFile, baseColumns, onDownload,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  ags: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string; numeric?: boolean }[];
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-wrap items-center gap-2">
          <Select value={agId} onValueChange={setAgId}>
            <SelectTrigger className="row-field-sm w-44"><SelectValue placeholder="Select AG" /></SelectTrigger>
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
export function AvenueFilterRow({
  title, icon, rows, ags, agMandatory, clubs, defaultFile, baseColumns, onDownload,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  ags?: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  agMandatory?: boolean;
  clubs?: { clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string; numeric?: boolean }[];
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-wrap items-center gap-2">
          {ags && (
            <Select value={agId} onValueChange={setAgId}>
              <SelectTrigger className="row-field-sm w-44"><SelectValue placeholder={agMandatory ? "Select AG" : "All AGs"} /></SelectTrigger>
              <SelectContent>
                {!agMandatory && <SelectItem value="all">All AGs</SelectItem>}
                {uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {clubs && (
            <Select value={clubId} onValueChange={setClubId}>
              <SelectTrigger className="row-field-sm w-40"><SelectValue placeholder="All Clubs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clubs</SelectItem>
                {clubs.map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={avenue} onValueChange={setAvenue}>
            <SelectTrigger className="row-field-sm w-40"><SelectValue placeholder="All Avenues" /></SelectTrigger>
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
export function AvenueCountRow({
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
    ...avenues.map((av) => ({ key: av, label: av, width: 18, numeric: true })),
    { key: "total", label: "Total", width: 12, numeric: true },
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{list.length} {list.length === 1 ? "club" : "clubs"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {clubs && (
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

// Governor's Official Visit (OCV/GOV) report — Club Wise (mandatory club) or
// AG Wise (mandatory AG). Lists every OCV sub-module + document type with the
// uploaded file as a hyperlink, or "N/A" when nothing was uploaded.
export function OcvReportRow({
  mode, clubs, ags, districtId, districtNumber, yearId, yearLabel, onEmpty, dl,
}: {
  mode: "club" | "ag";
  clubs?: { clubId: number; clubName: string }[];
  ags?: { agMemberId: number; agName: string; clubId: number; clubName: string }[];
  districtId: number;
  districtNumber: string;
  yearId: string;
  yearLabel: string;
  onEmpty?: (msg: string) => void;
  /** Shared page-level download progress (one report at a time). */
  dl: ReturnType<typeof useDownloadProgress>;
}) {
  const isAg = mode === "ag";
  const uniqueAgs = Array.from(new Map((ags || []).map((a) => [a.agMemberId, { id: a.agMemberId, name: a.agName }])).values());
  const [sel, setSel] = useState<string>("");
  const hasSel = !!sel;
  const title = isAg
    ? "Governor's Official Visit (OCV/GOV) (AG Wise)"
    : "Governor's Official Visit (OCV/GOV) (Club Wise)";

  const selName = isAg
    ? uniqueAgs.find((a) => String(a.id) === sel)?.name
    : clubs?.find((c) => String(c.clubId) === sel)?.clubName;

  // Excel/Word icons. Club-wise → that club's rich OCV report; AG-wise → a ZIP of every
  // club under the AG (one report per club) in the chosen format.
  const key = (fmt: "excel" | "word") => `ocv-${mode}-${fmt}`;
  const handleFormat = (fmt: "excel" | "word") => dl.run(key(fmt), async () => {
    if (!hasSel) return;
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
    }
  }, fmt === "word");

  return (
    <Card>
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Crown className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-amber-600">
              {hasSel
                ? (isAg ? "Ready: downloads every club under this AG (zipped)" : "Ready: all sub-modules included")
                : `Please select a ${isAg ? "AG" : "club"} to download`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger className="row-field-sm w-52"><SelectValue placeholder={isAg ? "Select AG" : "Select Club"} /></SelectTrigger>
            <SelectContent>
              {isAg
                ? uniqueAgs.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)
                : (clubs || []).map((c) => <SelectItem key={c.clubId} value={String(c.clubId)}>{c.clubName}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Excel + Word icons in place of a single Download button. */}
          <Button
            variant="outline" size="sm" title="Download Excel"
            className="text-emerald-700"
            onClick={() => handleFormat("excel")} disabled={!hasSel || dl.busy}
          >
            {dl.is(key("excel")) ? dl.bar(key("excel"), "bg-emerald-600") : <FileSpreadsheet className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline" size="sm" title="Download Word"
           
            onClick={() => handleFormat("word")} disabled={!hasSel || dl.busy}
          >
            {dl.is(key("word")) ? dl.bar(key("word")) : <FileText className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Row with TWO inline dropdowns — Designation + Club. Used by the District-wide
// BOD report so admins can pull "Treasurers of Thane Hills" or "All Treasurers"
// etc. with a single click.
export function BodMultiFilterRow({
  title, icon, rows, clubs, defaultFile, baseColumns, onDownload, hideClub = false,
}: {
  title: string;
  icon: React.ElementType;
  rows: any[];
  clubs: { clubId: number; clubName: string }[];
  defaultFile: string;
  baseColumns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string; numeric?: boolean }[];
  onDownload: (rows: any[], filenameBase: string, label: string, columns: typeof baseColumns) => void;
  /** Multi-district ("All Districts") mode: drop the per-club dropdown (keep the designation filter). */
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "record" : "records"}{(clubId !== "all" || designation !== "all") && " · filtered"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={designation} onValueChange={setDesignation}>
            <SelectTrigger className="row-field-sm w-36"><SelectValue placeholder="All Designations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Designations</SelectItem>
              {designations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          {!hideClub && (
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger className="row-field-sm w-36"><SelectValue placeholder="All Clubs" /></SelectTrigger>
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
export function AwardsClubFilterRow({
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
  /** Geo-columns view: drop the per-club dropdown; always all clubs. */
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{clubId === "all" ? "All clubs" : clubs.find((c) => String(c.clubId) === clubId)?.clubName}</p>
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
export function AwardsAgFilterRow({
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
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            <p className="text-xs text-amber-600">{hasSelection ? `${uniqueAgs.find((a) => String(a.id) === agId)?.name}` : "Please select an AG to download"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={agId} onValueChange={setAgId}>
            <SelectTrigger className="row-field-sm w-44"><SelectValue placeholder="Select AG" /></SelectTrigger>
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
export function ComingSoonRow({ title, icon }: { title: string; icon: React.ElementType }) {
  const Icon = icon;
  return (
    <Card className="opacity-60">
      <CardContent className="p-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
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

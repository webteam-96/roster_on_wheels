import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { formatDate, formatNumber, msUntilNextHour, nowIn } from "../../common/dotnet-format";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { YearTableResolver } from "../../services/year-table.resolver";
import { ProjectCountFilter, ProjectCountRules } from "../../services/project-count-rules";
import { ExcelJS, style, styleRange, toBuffer } from "../../services/xlsx";

export interface AvenueBreakdownRow { avenue: string; oneTime: number; ongoing: number; total: number; notRepeat: number; notModerator: number; notBeneficiary: number; isProject: boolean }
export interface DailyStatsResult {
  excel: Buffer;
  html: string;
  subject: string;
  fileName: string;
  metrics: [string, number][];
  breakdowns: { title: string; rows: AvenueBreakdownRow[] }[];
}

type SyncSummaryRow = { ZoneName: string | null; DistrictNumber: string | null; SyncClubs: number; NonSyncClubs: number; MemberCount: number };
type SyncClubRow = { ZoneName: string | null; DistrictNumber: string | null; ClubName: string | null; ClubRotaryId: string | null; City: string | null; State: string | null; MemberCount: number };
type AvenueRow = { label: string; oneTime: number; ongoing: number; notRepeat: number; notModerator: number; notBeneficiary: number };

const AVENUES: [string, string][] = [
  ["club_service", "Club Service"],
  ["community_service", "Community Service"],
  ["vocational_service", "Vocational Service"],
  ["international_service", "International Service"],
  ["new_generation_service", "New Generation Service"],
  ["public_image_initiative", "Public Image Initiative"],
];
const CLUB_SERVICE = "Club Service";
const total = (r: AvenueRow) => r.oneTime + r.ongoing;
const isProjectAvenue = (r: AvenueRow) => r.label !== CLUB_SERVICE;
const projectAvenues = (rows: AvenueRow[]) => rows.filter(isProjectAvenue);
const sum = (rows: AvenueRow[], f: (r: AvenueRow) => number) => rows.reduce((s, r) => s + f(r), 0);
const enc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;

/**
 * Port of DailyStatsReportService.cs + DailyStatsReportBackgroundService.cs: a daily email with
 * the headline counts and a multi-sheet Excel (Summary, District Summary, Sync / Non-Sync clubs).
 * ROW: the organisation's zones and exempt districts come from Brand Scope:Zones / Scope:ExemptDistricts
 * (empty = every zone / none) instead of RIZones' Zones 4-8 list; recipients only from
 * DailyStatsReport:Recipients (no built-in addresses); the run hour is in the brand's time zone, not IST.
 */
@Injectable()
export class DailyStatsReportService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("DailyStatsReportService");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly yearTables: YearTableResolver,
    private readonly countRules: ProjectCountRules,
  ) {}

  private get zones() { return Brand.Current.scope.zones; }
  private get exempt() { return Brand.Current.scope.exemptDistricts; }
  private get tz() { return Brand.Current.locale.defaultTimeZone; }
  /** "z.ZoneName IN @Zones" when the organisation is limited to some zones, else no zone limit. */
  private get zoneClause() { return this.zones.length ? "z.ZoneName IN @Zones" : "1 = 1"; }
  private get scopeLabel() { return this.zones.length ? ` (${this.zones.join(", ")})` : ""; }
  private get params() { return { Exempt: this.exempt, Zones: this.zones }; }

  // ── Background schedule (DailyStatsReportBackgroundService) ──────────────
  onApplicationBootstrap() {
    if (!this.config.getBool("DailyStatsReport:Enabled")) {
      this.log.log("Daily statistics report is disabled (DailyStatsReport:Enabled=false).");
      return;
    }
    const h = Number(this.config.get("DailyStatsReport:Hour") ?? 6);
    const hour = Number.isInteger(h) && h >= 0 && h <= 23 ? h : 6;
    const schedule = () => {
      this.timer = setTimeout(() => {
        this.sendDailyReport()
          .catch((e) => this.log.error(`Daily statistics report run failed: ${(e as Error).message}`))
          .finally(schedule);
      }, msUntilNextHour(this.tz, hour));
    };
    schedule();
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
  }

  private isRemoteDb() {
    const m = /(?:^|;)\s*(?:server|host|data source)\s*=\s*([^;]+)/i.exec(this.config.connectionString() ?? "");
    const server = (m?.[1] ?? "").trim().toLowerCase();
    return server.length > 0 && !["localhost", "127.0.0.1", "::1"].includes(server);
  }

  async sendDailyReport(force = false) {
    const r = await this.buildReport();
    const recipients = this.config.getArray("DailyStatsReport:Recipients");
    if (!recipients.length) {
      this.log.warn("Daily report: no recipients configured.");
      return;
    }
    const [to, ...cc] = recipients;
    if (this.isRemoteDb() && !force) {
      this.log.warn(`Daily statistics report SUPPRESSED — local dev (API on a remote DB). Would send to ${to} (cc ${cc.join(", ")}). Metrics: ${r.metrics.map(([k, v]) => `${k}=${v}`).join(" | ")}`);
      return;
    }
    if (this.isRemoteDb() && force) this.log.warn(`Daily statistics report FORCE-SEND on a dev/remote-DB machine (manual trigger) — emailing real recipients ${to} (cc ${cc.join(", ")}).`);
    await this.email.sendEmailWithAttachment(to, r.subject, r.html, r.excel, r.fileName, cc);
    this.log.log(`Daily statistics report sent to ${to} (cc ${cc.join(", ")}).`);
  }

  async buildReport(): Promise<DailyStatsResult> {
    return this.db.session(async (conn) => {
      const p = this.params;
      const year = await conn.queryFirstOrDefault("SELECT pk_year_id AS Id, YearLabel AS Label FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
      const curYearId = year ? Number(year.Id) : 0;
      const curYearLabel = year ? String(year.Label) : "";
      const curProjects = curYearLabel ? this.yearTables.getProjectsTableName(curYearLabel) : "";
      const curPhotos = curYearLabel ? this.yearTables.getPhotosTableName(curYearLabel) : "";

      const idToLabel = new Map<number, string>();
      const keyToId = new Map<string, number>();
      for (const m of await conn.query("SELECT pk_module_id AS Id, ModuleKey AS K FROM module_master WHERE ModuleKey IN @Keys AND isdeleted = 0", { Keys: AVENUES.map((a) => a[0]) }))
        keyToId.set(String(m.K), Number(m.Id));
      for (const [k, label] of AVENUES) if (keyToId.has(k)) idToLabel.set(keyToId.get(k)!, label);

      const syncClubs = await this.countClubs(conn, true);
      const nonSyncClubs = await this.countClubs(conn, false);
      const totalMembers = Number(
        (await conn.executeScalar(
          `SELECT COUNT(DISTINCT cm.fk_club_id, cm.fk_member_master_profile_id)
           FROM club_members cm
           JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1
           JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1
           LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND ${this.zoneClause}`,
          p,
        )) ?? 0,
      );

      const newslettersCurYear = curYearId <= 0 ? 0 : Number((await conn.executeScalar("SELECT COUNT(*) FROM newsletters WHERE fk_year_id = @Y AND COALESCE(isdeleted,0) = 0", { Y: curYearId })) ?? 0);

      let photosCurYear = 0;
      if (curPhotos && curProjects) photosCurYear = await this.countPhotos(conn, curPhotos, curProjects);
      const allTables = await this.yearTables.getAllExistingYearTables(conn);
      let photosAllYears = 0;
      for (const t of allTables) photosAllYears += await this.countPhotos(conn, t.photosTable, t.projectsTable);

      const filter = await this.countRules.getFilter(conn);
      const yesterdayAcc = new Map<number, AvenueRow>();
      for (const t of allTables) await this.accumulateAvenueSplit(conn, filter, t.projectsTable, "AND DATE(p.created_date) = (CURDATE() - INTERVAL 1 DAY)", yesterdayAcc);
      const yesterdayRows = toAvenueRows(yesterdayAcc, idToLabel);
      const curAcc = new Map<number, AvenueRow>();
      if (curProjects) await this.accumulateAvenueSplit(conn, filter, curProjects, null, curAcc);
      const curRows = toAvenueRows(curAcc, idToLabel);

      const yesterdayOneTime = sum(projectAvenues(yesterdayRows), (r) => r.oneTime);
      const yesterdayOngoing = sum(projectAvenues(yesterdayRows), (r) => r.ongoing);
      const curProjectRows = projectAvenues(curRows);
      const curOneTime = sum(curProjectRows, (r) => r.oneTime);
      const curOngoing = sum(curProjectRows, (r) => r.ongoing);
      const clubServiceRow = curRows.find((r) => r.label === CLUB_SERVICE);

      const clubsInProjects = !curProjects
        ? 0
        : Number(
            (await conn.executeScalar(
              `SELECT COUNT(DISTINCT p.fk_club_id)
               FROM \`${curProjects}\` p
               JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                    AND mm.ModuleKey IN (${ProjectCountFilter.ProjectModuleKeys})
               ${filter.geo("p.fk_club_id")}
               WHERE ${filter.countsAsProject(curProjects)}`,
            )) ?? 0,
          );

      const zoneFilter = this.zones.length ? " AND z.ZoneName IN @Zones" : "";
      const summary = (await conn.query(
        `SELECT z.ZoneName AS ZoneName, d.DistrictNumber AS DistrictNumber,
                CAST(SUM(c.IsSyncedFromRotaryOrg = 1) AS SIGNED) AS SyncClubs,
                CAST(SUM(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL) AS SIGNED) AS NonSyncClubs,
                (SELECT COUNT(DISTINCT cm.fk_club_id, cm.fk_member_master_profile_id)
                 FROM club_members cm
                 JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0 AND c2.IsSyncedFromRotaryOrg = 1
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                 WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS MemberCount
         FROM district_master d
         JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         LEFT JOIN club_master c ON c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
         WHERE d.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1${zoneFilter}
         GROUP BY d.pk_district_id, z.ZoneName, d.DistrictNumber
         HAVING (SyncClubs + NonSyncClubs) > 0
         ORDER BY z.ZoneName, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
        p,
      )) as SyncSummaryRow[];

      const clubListSql = (cond: string) => `
        SELECT z.ZoneName AS ZoneName, d.DistrictNumber AS DistrictNumber, c.ClubName AS ClubName,
               c.ClubRotaryId AS ClubRotaryId, c.City AS City, c.State AS State,
               (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS MemberCount
        FROM club_master c
        JOIN district_master d ON d.pk_district_id = c.fk_district_id
        JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
        WHERE c.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1${zoneFilter} AND ${cond}
        ORDER BY z.ZoneName, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName`;
      const syncList = (await conn.query(clubListSql("c.IsSyncedFromRotaryOrg = 1"), p)) as SyncClubRow[];
      const nonSyncList = (await conn.query(clubListSql("(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL)"), p)) as SyncClubRow[];

      const scope = this.scopeLabel;
      const nonSyncScope = [this.zones.join(", "), this.exempt.length ? `excl. ${this.exempt.join(" / ")}` : ""].filter(Boolean).join(", ");
      const metrics: [string, number][] = [
        [`Total Sync Clubs${scope}`, syncClubs],
        [`Total Members${scope}`, totalMembers],
        [`Total Non-Sync Clubs${nonSyncScope ? ` (${nonSyncScope})` : ""}`, nonSyncClubs],
        [`Total Newsletters (${curYearLabel})`, newslettersCurYear],
        [`Total Project Photos — ${curYearLabel}`, photosCurYear],
        ["Total Project Photos — All Years", photosAllYears],
        ["Projects Added Yesterday — One-Time", yesterdayOneTime],
        ["Projects Added Yesterday — Ongoing", yesterdayOngoing],
        ["Projects Added Yesterday — Total", yesterdayOneTime + yesterdayOngoing],
        [`Total Club Service (${curYearLabel})`, clubServiceRow ? total(clubServiceRow) : 0],
        [`Total Projects (${curYearLabel}) — One-Time`, curOneTime],
        [`Total Projects (${curYearLabel}) — Ongoing`, curOngoing],
        [`Total Projects (${curYearLabel}) — Total (= website)`, curOneTime + curOngoing],
        ["Not counted — repeat entries of ongoing projects", sum(curProjectRows, (r) => r.notRepeat)],
        ["Not counted — moderator approval pending", sum(curProjectRows, (r) => r.notModerator)],
        ["Not counted — beneficiary approval pending", sum(curProjectRows, (r) => r.notBeneficiary)],
        [`Clubs Involved in Projects (${curYearLabel})`, clubsInProjects],
      ];

      const now = nowIn(this.tz);
      const product = Brand.Current.productName;
      const excel = await this.buildWorkbook(metrics, summary, syncList, nonSyncList, yesterdayRows, curRows, curYearLabel, totalMembers, now);
      const html = this.buildEmailBody(metrics, summary.length, yesterdayRows, curRows, curYearLabel, now);
      const toBreakdown = (title: string, src: AvenueRow[]) => ({
        title,
        rows: src.map((a) => ({ avenue: a.label, oneTime: a.oneTime, ongoing: a.ongoing, total: total(a), notRepeat: a.notRepeat, notModerator: a.notModerator, notBeneficiary: a.notBeneficiary, isProject: isProjectAvenue(a) })),
      });
      return {
        excel,
        html,
        subject: `${product} Daily Statistics — ${formatDate(now, "dd MMM yyyy")}`,
        fileName: `${Brand.Current.shortName}_Daily_Stats_${formatDate(now, "ddMMyyyy")}.xlsx`,
        metrics,
        breakdowns: [toBreakdown("Projects Added Yesterday", yesterdayRows), toBreakdown(`Total Projects (${curYearLabel})`, curRows)],
      };
    });
  }

  private async countClubs(conn: DbCommands, synced: boolean) {
    const syncCond = synced ? "c.IsSyncedFromRotaryOrg = 1" : "(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL)";
    return Number(
      (await conn.executeScalar(
        `SELECT COUNT(*) FROM club_master c
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE ${syncCond} AND c.isdeleted = 0
           AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1 AND ${this.zoneClause}`,
        this.params,
      )) ?? 0,
    );
  }

  private async countPhotos(conn: DbCommands, photoTable: string, projTable: string) {
    try {
      return Number(
        (await conn.executeScalar(
          `SELECT COUNT(*)
           FROM \`${photoTable}\` pp
           JOIN \`${projTable}\` p ON p.pk_project_id = pp.fk_project_id
           JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1
           JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1
           JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id${this.zones.length ? " AND z.ZoneName IN @Zones" : ""}
           WHERE COALESCE(p.isdeleted, 0) = 0`,
          this.params,
        )) ?? 0,
      );
    } catch (e) {
      this.log.warn(`Daily report: photo count failed for ${photoTable}: ${(e as Error).message}`);
      return 0;
    }
  }

  private async accumulateAvenueSplit(conn: DbCommands, f: ProjectCountFilter, table: string, dateClause: string | null, acc: Map<number, AvenueRow>) {
    try {
      const rows = await conn.query(
        `SELECT p.fk_module_id AS ModuleId, ${f.bucketExpr(table)} AS Bucket, COUNT(*) AS Cnt
         FROM \`${table}\` p
         JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
              AND mm.ModuleKey IN (${ProjectCountFilter.AvenueModuleKeys})
         ${f.geo("p.fk_club_id")}
         WHERE ${ProjectCountFilter.live()} ${dateClause ?? ""}
         GROUP BY p.fk_module_id, Bucket`,
      );
      for (const r of rows) {
        const mid = Number(r.ModuleId);
        const c = Number(r.Cnt);
        let row = acc.get(mid);
        if (!row) acc.set(mid, (row = { label: "", oneTime: 0, ongoing: 0, notRepeat: 0, notModerator: 0, notBeneficiary: 0 }));
        switch (String(r.Bucket)) {
          case "one_time": row.oneTime += c; break;
          case "ongoing": row.ongoing += c; break;
          case "repeat": row.notRepeat += c; break;
          case "moderator": row.notModerator += c; break;
          case "beneficiary": row.notBeneficiary += c; break;
        }
      }
    } catch (e) {
      this.log.warn(`Daily report: avenue split failed for ${table}: ${(e as Error).message}`);
    }
  }

  // ── Excel ────────────────────────────────────────────────────────────────
  private async buildWorkbook(metrics: [string, number][], summary: SyncSummaryRow[], syncList: SyncClubRow[], nonSyncList: SyncClubRow[], yesterdayRows: AvenueRow[], curRows: AvenueRow[], curYearLabel: string, totalMembers: number, now: string) {
    const wb = new ExcelJS.Workbook();
    this.buildSummarySheet(wb, metrics, yesterdayRows, curRows, curYearLabel, now);

    const tableStyle = (ws: ExcelJS.Worksheet, cols: number, lastDataRow: number, numberCols: number[], totalRow: number | null) => {
      const lastRow = totalRow ?? lastDataRow;
      styleRange(ws, 1, 1, 1, cols, { fill: argb("#1F4E79"), color: argb("#FFFFFF"), bold: true, align: "center" });
      ws.getRow(1).height = 22;
      const outer = { style: "thin" as const, color: { argb: argb("#8EAADB") } };
      const inner = { style: "thin" as const, color: { argb: argb("#D9E1F2") } };
      for (let r = 1; r <= lastRow; r++)
        for (let c = 1; c <= cols; c++)
          ws.getCell(r, c).border = { top: r === 1 ? outer : inner, bottom: r === lastRow ? outer : inner, left: c === 1 ? outer : inner, right: c === cols ? outer : inner };
      for (let r = 2; r <= lastDataRow; r++) if (r % 2 === 0) styleRange(ws, r, 1, r, cols, { fill: argb("#EAF1FB") });
      for (const nc of numberCols) for (let r = 2; r <= lastDataRow; r++) style(ws.getCell(r, nc), { align: "right" });
      if (totalRow !== null) {
        styleRange(ws, totalRow, 1, totalRow, cols, { bold: true, fill: argb("#CFE0F4") });
        for (let c = 1; c <= cols; c++) ws.getCell(totalRow, c).border = { ...ws.getCell(totalRow, c).border, top: { style: "medium" } };
      }
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, lastDataRow), column: cols } };
      ws.columns.forEach((col) => {
        let w = 8;
        col.eachCell?.({ includeEmpty: false }, (cell) => (w = Math.max(w, String(cell.value ?? "").length + 2)));
        col.width = w;
      });
    };

    const ws1 = wb.addWorksheet("District Summary");
    ws1.addRow(["Zone Name", "District Number", "Sync Club Count", "Non-Sync Club Count", "Total Members"]);
    for (const s of summary) ws1.addRow([s.ZoneName ?? "", s.DistrictNumber ?? "", Number(s.SyncClubs), Number(s.NonSyncClubs), Number(s.MemberCount)]);
    const totalRow1 = summary.length + 2;
    ws1.getRow(totalRow1).values = ["TOTAL", null, summary.reduce((a, x) => a + Number(x.SyncClubs), 0), summary.reduce((a, x) => a + Number(x.NonSyncClubs), 0), totalMembers];
    tableStyle(ws1, 5, totalRow1 - 1, [3, 4, 5], totalRow1);

    const clubSheet = (name: string, rows: SyncClubRow[], showMembers: boolean) => {
      const ws = wb.addWorksheet(name);
      ws.addRow(showMembers ? ["Sr.No.", "Zone Name", "District Number", "Club Name", "Club Id (Rotary)", "City", "State", "Members"] : ["Sr.No.", "Zone Name", "District Number", "Club Name", "Club Id (Rotary)", "City", "State"]);
      rows.forEach((c, i) => {
        const v: (string | number)[] = [i + 1, c.ZoneName ?? "", c.DistrictNumber ?? "", c.ClubName ?? "", c.ClubRotaryId ?? "", c.City ?? "", c.State ?? ""];
        if (showMembers) v.push(Number(c.MemberCount));
        ws.addRow(v);
      });
      tableStyle(ws, showMembers ? 8 : 7, rows.length + 1, showMembers ? [1, 8] : [1], null);
    };
    clubSheet("Sync Clubs", syncList, true);
    clubSheet("Non-Sync Clubs", nonSyncList, false);
    return toBuffer(wb);
  }

  private buildSummarySheet(wb: ExcelJS.Workbook, metrics: [string, number][], yesterdayRows: AvenueRow[], curRows: AvenueRow[], curYearLabel: string, now: string) {
    const navy = argb("#1a365d"), blue = argb("#2d7fc7"), labelBg = argb("#f1f5f9"), border = argb("#cbd5e1"), white = argb("#FFFFFF");
    const ws = wb.addWorksheet("Summary");
    [54, 18, 14, 14, 15, 17, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    let r = 1;
    const band = (text: string, s: Parameters<typeof style>[1], height?: number) => {
      ws.mergeCells(r, 1, r, 7);
      const c = ws.getCell(r, 1);
      c.value = text;
      style(c, s);
      if (height) ws.getRow(r).height = height;
      r++;
    };
    band(`${Brand.Current.productName} — Daily Statistics`, { bold: true, size: 18, color: white, fill: navy, align: "center", vAlign: "middle" }, 34);
    band(`${this.zones.length ? `${this.zones.join(", ")}   ·   ` : ""}Rotary Year ${curYearLabel}`, { size: 10, color: argb("#475569"), fill: argb("#eef2f7"), align: "center" }, 20);
    band(`Generated ${formatDate(now, "dd MMM yyyy, hh:mm tt")}`, { size: 8, italic: true, color: argb("#94a3b8"), align: "center" });
    r++;

    const section = (label: string) => band(label, { bold: true, color: white, fill: blue, vAlign: "middle" }, 22);
    const box = (r1: number, r2: number, c2: number, inner: string) => {
      const o = { style: "thin" as const, color: { argb: border } };
      const i = { style: "thin" as const, color: { argb: inner } };
      for (let rr = r1; rr <= r2; rr++) for (let c = 1; c <= c2; c++) ws.getCell(rr, c).border = { top: rr === r1 ? o : i, bottom: rr === r2 ? o : i, left: c === 1 ? o : i, right: c === c2 ? o : i };
    };
    const COLS = 7;
    const dataRow = (a: AvenueRow, label = a.label) => {
      ws.getRow(r).values = [label, a.oneTime, a.ongoing, total(a), a.notRepeat, a.notModerator, a.notBeneficiary];
      for (let i = 2; i <= COLS; i++) ws.getCell(r, i).numFmt = "#,##0";
      r++;
    };
    const avenueBlock = (title: string, rows: AvenueRow[]) => {
      section(title);
      ws.getRow(r).values = ["Avenue", "One-Time", "Ongoing", "Counted", "Repeat entries", "Moderator pending", "Beneficiary pending"];
      styleRange(ws, r, 1, r, COLS, { fill: navy, color: white, bold: true, wrap: true });
      for (let i = 2; i <= COLS; i++) style(ws.getCell(r, i), { align: "right" });
      r++;
      const first = r;
      const projects = projectAvenues(rows);
      for (const a of projects) dataRow(a);
      dataRow({ label: "TOTAL PROJECTS", oneTime: sum(projects, (x) => x.oneTime), ongoing: sum(projects, (x) => x.ongoing), notRepeat: sum(projects, (x) => x.notRepeat), notModerator: sum(projects, (x) => x.notModerator), notBeneficiary: sum(projects, (x) => x.notBeneficiary) });
      styleRange(ws, r - 1, 1, r - 1, COLS, { bold: true, fill: argb("#cfe0f4") });
      for (const a of rows.filter((x) => !isProjectAvenue(x))) {
        dataRow(a, "Club Service (meetings — not a project)");
        styleRange(ws, r - 1, 1, r - 1, COLS, { italic: true });
      }
      box(first - 1, r - 1, COLS, argb("#e2e8f0"));
      styleRange(ws, first, 2, r - 1, COLS, { align: "right" });
      r++;
    };
    const kv = (key: string, val: number) => {
      const k = ws.getCell(r, 1);
      k.value = key;
      style(k, { bold: true, color: argb("#334155"), fill: labelBg, vAlign: "middle" });
      const v = ws.getCell(r, 2);
      v.value = val;
      v.numFmt = "#,##0";
      style(v, { align: "right", vAlign: "middle" });
      const o = { style: "thin" as const, color: { argb: border } };
      k.border = { top: o, bottom: o, left: o };
      v.border = { top: o, bottom: o, right: o };
      r++;
    };

    section("Clubs & Members");
    metrics.slice(0, 3).forEach(([k, v]) => kv(k, v));
    r++;
    section("Communications & Photos");
    metrics.slice(3, 6).forEach(([k, v]) => kv(k, v));
    r++;
    section("Projects Added Yesterday");
    metrics.slice(6, 9).forEach(([k, v]) => kv(k, v));
    r++;
    section(`Projects — ${curYearLabel}`);
    metrics.slice(9).forEach(([k, v]) => kv(k, v));
    r++;
    avenueBlock("Projects Added Yesterday — by Avenue", yesterdayRows);
    r++;
    avenueBlock(`Total Projects (${curYearLabel}) — by Avenue`, curRows);
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ── Email ────────────────────────────────────────────────────────────────
  private buildEmailBody(metrics: [string, number][], districtCount: number, yesterdayRows: AvenueRow[], curRows: AvenueRow[], curYearLabel: string, now: string) {
    const product = enc(Brand.Current.productName);
    const rows = metrics
      .map(
        ([label, value], i) => `
            <tr style='background:${i % 2 === 0 ? "#ffffff" : "#f4f7fb"}'>
                <td style='padding:8px 12px;border:1px solid #d9e1f2;font-size:14px;color:#333'>${enc(label)}</td>
                <td style='padding:8px 12px;border:1px solid #d9e1f2;font-size:14px;color:#1F4E79;font-weight:bold;text-align:right'>${formatNumber(value, "N0")}</td>
            </tr>`,
      )
      .join("");
    const exempt = this.exempt.length ? ` and the exempt districts (${enc(this.exempt.join(" · "))})` : "";
    const site = Brand.Current.domains.adminOrigin;
    return `
            ${emailHeader()}
                <p style='font-size:15px;margin:0 0 14px 0'><strong>${product} — Daily Statistics</strong><br/>
                <span style='font-size:12px;color:#666'>${formatDate(now, "dddd, dd MMMM yyyy")}</span></p>
                <table style='border-collapse:collapse;width:100%;max-width:620px'>
                    <thead>
                        <tr style='background:#1F4E79;color:#fff'>
                            <th style='padding:9px 12px;border:1px solid #1F4E79;text-align:left;font-size:13px'>Particulars</th>
                            <th style='padding:9px 12px;border:1px solid #1F4E79;text-align:right;font-size:13px'>Count</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                ${breakdownTable("Projects Added Yesterday — by Avenue", yesterdayRows)}
                ${breakdownTable(`Total Projects (${curYearLabel}) — by Avenue`, curRows)}
                <p style='font-size:12px;color:#555;line-height:1.7;margin-top:14px;max-width:760px'>
                    <strong>How a project is counted.</strong> One-time projects count once. An ongoing project
                    counts once — its parent entry, or, when the parent belongs to an earlier year, its first
                    entry of this year; its repeat entries are in <em>Repeat entries</em>. A project the club
                    moderator has not approved is in <em>Moderator pending</em>, and one whose beneficiary count
                    went over the limit without approval is in <em>Beneficiary pending</em>. Zones outside the
                    organisation${exempt} count nowhere. Club Service is the club's
                    meetings, so it sits outside the project total. <strong>TOTAL PROJECTS is the same figure
                    the website publishes</strong>${site ? ` at ${enc(site)}/projects` : ""}.
                </p>
                <p style='font-size:13px;color:#444;line-height:1.7;margin-top:16px'>
                    The attached Excel opens with a <strong>Summary</strong> sheet (all counts + the project breakdown by avenue),
                    followed by the detailed listings: <strong>District-wise summary</strong> (${districtCount} districts),
                    <strong>Sync Clubs</strong>, and <strong>Non-Sync Clubs</strong>.
                </p>
                <p style='font-size:12px;color:#888;font-style:italic'>Automated daily report from ${product}.</p>
            ${emailFooter()}`;
  }
}

function toAvenueRows(acc: Map<number, AvenueRow>, idToLabel: Map<number, string>): AvenueRow[] {
  const rows: AvenueRow[] = AVENUES.map(([, label]) => ({ label, oneTime: 0, ongoing: 0, notRepeat: 0, notModerator: 0, notBeneficiary: 0 }));
  for (const [id, v] of acc) {
    const lbl = idToLabel.get(id);
    if (!lbl) continue;
    const t = rows.find((r) => r.label === lbl)!;
    t.oneTime += v.oneTime;
    t.ongoing += v.ongoing;
    t.notRepeat += v.notRepeat;
    t.notModerator += v.notModerator;
    t.notBeneficiary += v.notBeneficiary;
  }
  return rows;
}

function breakdownTable(title: string, rows: AvenueRow[]): string {
  const cell = (v: number, strong = false) =>
    `<td style='padding:7px 10px;border:1px solid #d9e1f2;font-size:13px;text-align:right;color:${strong ? "#1F4E79" : "#333"}${strong ? ";font-weight:bold" : ""}'>${formatNumber(v, "N0")}</td>`;
  const row = (a: AvenueRow, bg: string, label: string, italic = false) => `
            <tr style='background:${bg}${italic ? ";font-style:italic" : ""}'>
                <td style='padding:7px 10px;border:1px solid #d9e1f2;font-size:13px;color:#333'>${enc(label)}</td>
                ${cell(a.oneTime)}${cell(a.ongoing)}${cell(total(a), true)}
                ${cell(a.notRepeat)}${cell(a.notModerator)}${cell(a.notBeneficiary)}
            </tr>`;
  const projects = projectAvenues(rows);
  const body = projects.map((a, i) => row(a, i % 2 === 0 ? "#ffffff" : "#f4f7fb", a.label)).join("");
  const below = rows.filter((x) => !isProjectAvenue(x)).map((a) => row(a, "#fbfbfb", "Club Service (meetings — not a project)", true)).join("");
  const t: AvenueRow = { label: "", oneTime: sum(projects, (x) => x.oneTime), ongoing: sum(projects, (x) => x.ongoing), notRepeat: sum(projects, (x) => x.notRepeat), notModerator: sum(projects, (x) => x.notModerator), notBeneficiary: sum(projects, (x) => x.notBeneficiary) };
  const th = (s: string, right = true) => `<th style='padding:8px 10px;border:1px solid #1F4E79;text-align:${right ? "right" : "left"};font-size:12px'>${s}</th>`;
  return `
            <p style='font-size:13px;font-weight:bold;color:#1F4E79;margin:18px 0 6px 0'>${enc(title)}</p>
            <table style='border-collapse:collapse;width:100%;max-width:760px'>
                <thead>
                    <tr style='background:#1F4E79;color:#fff'>
                        ${th("Avenue", false)}${th("One-Time")}${th("Ongoing")}${th("Counted")}
                        ${th("Repeat entries")}${th("Moderator pending")}${th("Beneficiary pending")}
                    </tr>
                </thead>
                <tbody>${body}${row(t, "#cfe0f4", "TOTAL PROJECTS")}${below}</tbody>
            </table>`;
}

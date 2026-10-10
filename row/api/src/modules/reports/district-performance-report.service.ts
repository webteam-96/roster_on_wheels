import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Brand } from "../../brand/brand";
import { AppConfig } from "../../config/app-config";
import { dotnetRound, formatDate, msUntilNextHour, nowIn } from "../../common/dotnet-format";
import { InvalidOperationException } from "../../common/exceptions";
import { Db, type DbCommands } from "../../database/db.service";
import { cogClubId } from "../../services/cog-designation.helper";
import { notRotaract } from "../../services/club-scope.helper";
import { convertCurrency, resolveDefaultCurrency } from "../../services/currency.helper";
import { CurrencyRateService } from "../../services/currency-rate.service";
import { DG_EMAIL, DG_JOIN_MEMBER, DG_MOBILE, DG_NAME } from "../../services/district-governor-sql";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { normalizeClientDomain } from "../../services/website-domain.helper";
import { YearTableResolver } from "../../services/year-table.resolver";
import { mapLimit } from "../goal-setting/goal-reports";
import type { DistrictPerformanceGoalMetric } from "../goal-setting/goal-reports";
import { GoalSettingService } from "../goal-setting/goal-setting.service";
import { addMonths, isoDate, ymd } from "../goal-setting/goal-core";
import {
  allClubs, buildDistrictWorkbook, buildEmailBody, buildZoneWorkbook, CLUB_GOALS_COMING_SOON, CLUB_SERVICE_KEY, type ClubRow, type ClubStats, type CmrGridRow,
  Dec, type DistrictPerformanceKpi, type DistrictPerformanceReportResult, type LeaderRow, type MemberAgg, membershipBand, Money, monthName, N, newResult,
  ordinal, OTHER_AVENUE, Pct, PCT_HEADER, Pct2, type PerformanceReportItem, type PerformanceReportSection, PROJECT_AVENUES, RAG_AMBER, RAG_BELOW, RAG_GREEN,
  RAG_RED, ROTARY_MONTHS, safeFile, section, tile, type WebsiteRow, ZONE_FUNDS, ZONE_TOTAL_LABEL,
} from "./district-performance-report.render";

export const EMAIL_TYPE = "District Performance";
const HEADLINE_GOAL_CATEGORIES = new Set(["membership", "foundation"]);
/** Age 18–40 from date of birth (BirthDate year 1900 = day/month-only placeholder → unknown). */
const YOUTH_EXPR = "(m.BirthDate IS NOT NULL AND YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 18 AND 40)";

export interface PerformanceReportDistrictOption { districtId: number; districtNumber: string; zoneName: string | null }

const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const ci = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();
const dmy = (iso: string) => formatDate(iso, "dd MMM yyyy");

/**
 * Port of DistrictPerformanceReportService.cs + DistrictPerformanceReportBackgroundService.cs.
 * ONE district, current Rotary year, 1 July → today; the RI Director report is every district, zone-wise.
 * ROW: RIZones hard-coded its zones, exempt districts, excluded clubs, recipients, test districts and a
 * rehearsal date; here they come from Brand scope and DistrictPerformanceReport:* settings.
 */
@Injectable()
export class DistrictPerformanceReportService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("DistrictPerformanceReportService");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly goals: GoalSettingService,
    private readonly yearTables: YearTableResolver,
    private readonly fx: CurrencyRateService,
  ) {}

  // ── Settings (RIZones: constants in the class) ───────────────────────────────────────────────
  private get enabled() { return this.config.getBool("DistrictPerformanceReport:Enabled"); }
  private get mode() { return ci(this.config.get("DistrictPerformanceReport:Mode"), "Live") ? "Live" : "Test"; }
  private get hour() { return Brand.Current.scope.districtReportSendHour; }
  private get liveDays() { return Brand.Current.scope.districtReportDaysOfMonth; }
  private get testDistricts() {
    const list = this.config.getArray("DistrictPerformanceReport:TestDistricts");
    const one = Brand.Current.scope.testDistrictNumber;
    return list.length ? list : one ? [one] : [];
  }
  private get testRecipients() { return this.config.getArray("DistrictPerformanceReport:TestRecipients").map((x) => x.trim()).filter(Boolean); }
  private get liveCc() { return this.config.getArray("DistrictPerformanceReport:LiveCc").map((x) => x.trim()).filter(Boolean); }
  /** One-off rehearsal date (yyyy-MM-dd): sample districts + RI Director report to the test recipients only. */
  private get previewDate() { return (this.config.get("DistrictPerformanceReport:PreviewDate") ?? "").trim().slice(0, 10) || null; }
  private get tz() { return Brand.Current.locale.defaultTimeZone; }
  private get todayIso() { return nowIn(this.tz).slice(0, 10); }
  /** RIZones suppressed scheduled sends whenever the DB is remote; ROW only in Development (see CMR mailer). */
  private get suppressLocalDev() {
    const m = /(?:^|;)\s*(?:server|host|data source)\s*=\s*([^;]+)/i.exec(this.config.connectionString() ?? "");
    const server = (m?.[1] ?? "").trim().toLowerCase();
    return server.length > 0 && !["localhost", "127.0.0.1", "::1"].includes(server) && this.config.environment === "Development";
  }
  private get parentDomain() { return (this.config.get("PleskSettings:ParentDomain") ?? "").trim().replace(/^\.+|\.+$/g, "").toLowerCase(); }
  /** Clubs never counted: the COG roster club, name patterns from DistrictPerformanceReport:ExcludedClubNames, and Rotaract. */
  private excludedClubsSql(alias = "c") {
    const a = alias ? `${alias}.` : "";
    const names = this.config.getArray("DistrictPerformanceReport:ExcludedClubNames").map((x) => x.trim()).filter(Boolean);
    const nameSql = names.map((n) => ` AND ${a}ClubName NOT LIKE '%${n.replace(/['\\%_]/g, "")}%'`).join("");
    return `${a}pk_club_id <> ${cogClubId()}${nameSql} AND ${notRotaract(alias)}`;
  }

  // ── Schedule (DistrictPerformanceReportBackgroundService) ────────────────────────────────────
  onApplicationBootstrap() {
    if (!this.enabled) {
      this.log.log("District performance report schedule is disabled (DistrictPerformanceReport:Enabled=false).");
      return;
    }
    // Let the host finish starting, then catch up if today's hour has already passed.
    this.timer = setTimeout(() => {
      const H = Number(nowIn(this.tz).slice(11, 13));
      const first = H >= this.hour ? this.runScheduled(true).catch((e) => this.log.error(`District performance report catch-up run failed: ${(e as Error).message}`)) : Promise.resolve();
      void first.finally(() => this.scheduleNext());
    }, 2 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext() {
    this.timer = setTimeout(() => {
      this.runScheduled(false)
        .catch((e) => this.log.error(`District performance report run failed: ${(e as Error).message}`))
        .finally(() => this.scheduleNext());
    }, msUntilNextHour(this.tz, this.hour));
  }

  // ── Screen helpers ───────────────────────────────────────────────────────────────────────────
  getDistricts() {
    return this.loadReportDistricts(this.db);
  }

  private async loadReportDistricts(conn: DbCommands): Promise<PerformanceReportDistrictOption[]> {
    const zones = Brand.Current.scope.zones;
    const rows = await conn.query(
      `SELECT d.pk_district_id AS DistrictId, d.DistrictNumber AS DistrictNumber, z.ZoneName AS ZoneName
       FROM district_master d
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE d.isdeleted = 0 AND d.IsActive = 1
         AND d.DistrictNumber NOT IN @Exempt
         AND d.DistrictNumber NOT LIKE 'TEST%'
         AND ${zones.length ? "z.ZoneName IN @Zones" : "1 = 1"}
       ORDER BY COALESCE(z.sort_order, 999), z.ZoneName, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
      // NOT IN over an empty list matches nothing; a never-used value keeps "no exemptions" meaning all.
      { Exempt: Brand.Current.scope.exemptDistricts.length ? Brand.Current.scope.exemptDistricts : [""], Zones: zones },
    );
    return rows.map((r) => ({ districtId: num(r.DistrictId), districtNumber: String(r.DistrictNumber ?? ""), zoneName: str(r.ZoneName) }));
  }

  async getSettings() {
    const dto = {
      scheduleEnabled: this.enabled, mode: this.mode, hour: this.hour, testDistricts: this.testDistricts, testRecipients: this.testRecipients,
      liveCc: this.liveCc, liveDays: this.liveDays, recentRuns: [] as unknown[],
    };
    try {
      dto.recentRuns = (await this.db.query(
        `SELECT l.pk_id AS Id, d.DistrictNumber AS DistrictNumber, l.RunType AS RunType, l.ToEmail AS ToEmail,
                l.CcEmails AS CcEmails, l.Status AS Status, l.Message AS Message, l.created_date AS CreatedDate
         FROM district_performance_report_log l
         LEFT JOIN district_master d ON d.pk_district_id = l.fk_district_id
         ORDER BY l.pk_id DESC LIMIT 500`,
      )).map((r) => ({
        id: num(r.Id), districtNumber: str(r.DistrictNumber), runType: String(r.RunType ?? ""), toEmail: str(r.ToEmail), ccEmails: str(r.CcEmails),
        status: String(r.Status ?? ""), message: str(r.Message), createdDate: r.CreatedDate,
      }));
    } catch (e) {
      this.log.warn(`District performance report: could not read the run log. ${(e as Error).message}`);
    }
    return dto;
  }

  // ── Build ────────────────────────────────────────────────────────────────────────────────────
  async buildReport(districtId: number, includeAttachment: boolean): Promise<DistrictPerformanceReportResult> {
    const conn = this.db;
    const district = await conn.queryFirstOrDefault(
      `SELECT d.pk_district_id AS Id, d.DistrictNumber AS DistrictNumber, z.ZoneName AS ZoneName, d.DefaultCurrency AS DefaultCurrency
       FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE d.pk_district_id = @D AND d.isdeleted = 0`,
      { D: districtId },
    );
    if (!district) throw new KeyNotFoundException("District not found.");
    const districtNumber = String(district.DistrictNumber ?? "");
    const zoneName = str(district.ZoneName);

    const year = await conn.queryFirstOrDefault("SELECT pk_year_id AS Id, YearLabel AS Label, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
    if (!year || num(year.Id) === 0) throw new InvalidOperationException("No current Rotary year is set.");
    const yearId = num(year.Id);
    const yearLabel = String(year.Label ?? "");
    const startP = ymd(year.StartDate)!;
    const start = isoDate(startP);
    const today = this.todayIso;
    const yearEnd = isoDate(ymd(year.EndDate)!);
    const end = today < yearEnd ? today : yearEnd;
    const e1 = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const currency = resolveDefaultCurrency(str(district.DefaultCurrency));

    const p = { D: districtId, Y: yearId, YL: yearLabel, S: start, E: end, E1: e1 };
    const excluded = this.excludedClubsSql("c");
    // Club scope: the district's active clubs that are synced with Rotary.org, minus the excluded clubs.
    const activeClub = `c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1 AND c.IsSyncedFromRotaryOrg = 1 AND ${excluded}`;
    // Synced AND non-synced — only where a figure covers every club (Club Monthly Report).
    const anyActiveClub = `c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1 AND ${excluded}`;

    // District Governor (current year); LEFT JOIN so a DG without a profile still shows.
    const dg = await conn.queryFirstOrDefault(
      `SELECT ${DG_NAME} AS Name, ${DG_EMAIL} AS Email, ${DG_MOBILE} AS Mobile
       FROM district_governors g
       ${DG_JOIN_MEMBER}
       WHERE g.fk_district_id = @D AND g.fk_year_id = @Y AND COALESCE(g.isdeleted, 0) = 0
       LIMIT 1`,
      p,
    );
    const dgName = str(dg?.Name), dgEmail = str(dg?.Email), dgMobile = str(dg?.Mobile);

    // ── Clubs ──
    const toClub = (r: Record<string, unknown>): ClubRow => ({
      id: num(r.Id), clubName: String(r.ClubName ?? ""), clubRotaryId: str(r.ClubRotaryId), city: str(r.City), state: str(r.State),
      clubCharterDate: str(r.ClubCharterDate), memberCount: num(r.MemberCount),
    });
    const clubs = (await conn.query(
      `SELECT c.pk_club_id AS Id, c.ClubName AS ClubName, c.ClubRotaryId AS ClubRotaryId, c.City AS City, c.State AS State, c.ClubCharterDate AS ClubCharterDate
       FROM club_master c WHERE ${activeClub} ORDER BY c.ClubName`,
      p,
    )).map(toClub);
    const emptyAgg = (): MemberAgg => ({ members: 0, membersJul1: 0, women: 0, womenJul1: 0, youth: 0, added: 0, leftCount: 0, deletedAllTime: 0, youthJul1: 0, youthAdded: 0, youthLeft: 0, womenAdded: 0, womenLeft: 0, leftJul1: 0, womenLeftJul1: 0, youthLeftJul1: 0 });
    const stats = new Map<number, ClubStats>(clubs.map((c) => [c.id, {
      club: c, m: emptyAgg(), projects: new Map(), totalProjects: 0, clubService: 0, beneficiaries: 0, manHours: 0, cost: 0, cmrSubmitted: 0, website: null,
      districtDuesPaid: false, goalCategoriesSet: new Set(), awardPoints: 0, president: null, secretary: null, cmrByMonth: new Map(), cmrPending: 0, cmrNotStarted: 0, trfUsd: 0, mod: new Map(),
    }]));

    // Clubs NOT synced with Rotary.org — out of every per-club figure, but counted in the club counts.
    const nonSynced = (await conn.query(
      `SELECT c.pk_club_id AS Id, c.ClubName AS ClubName, c.ClubRotaryId AS ClubRotaryId, c.City AS City, c.State AS State, c.ClubCharterDate AS ClubCharterDate,
              (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND cm.IsHonoraryMember = 0 AND m.isdeleted = 0) AS MemberCount
       FROM club_master c
       WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 0
         AND ${excluded}
       ORDER BY c.ClubName`,
      p,
    )).map(toClub);
    const clubsToday = clubs.length + nonSynced.length;

    // "As on 1 July" = chartered before 1 July (no charter date = existing).
    let clubsJul1 = [...clubs, ...nonSynced].filter((c) => !c.clubCharterDate || c.clubCharterDate.slice(0, 10) < start).length;
    const removed = await conn.queryFirstOrDefault(
      `SELECT COUNT(*) AS Total,
              COALESCE(SUM(CASE WHEN ClubCharterDate IS NULL OR ClubCharterDate < @S THEN 1 ELSE 0 END), 0) AS BeforeJul1
       FROM club_master
       WHERE fk_district_id = @D AND isdeleted = 1 AND ${this.excludedClubsSql("")}
         AND IsSyncedFromRotaryOrg = 1
         AND COALESCE(deleted_date, modified_date) >= @S AND COALESCE(deleted_date, modified_date) < @E1`,
      p,
    );
    // Only clubs that WERE counted can be reported as deleted; deleted_date falls back to modified_date.
    const removedTotal = num(removed?.Total), removedBefore = num(removed?.BeforeJul1);
    const clubsRemoved = removedTotal;
    // 1 July + added - deleted = today.
    clubsJul1 += removedBefore;
    const clubsAdded = clubsToday - (clubsJul1 - removedBefore) + (removedTotal - removedBefore);

    // ── Members: per club + district total (each person once); honorary excluded ──
    const act = "cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0";
    const beforeJul1 = "(cm.JoinedDate IS NULL OR cm.JoinedDate < @S)";
    const left = "cm.isdeleted = 1 AND cm.TerminationDate >= @S AND cm.TerminationDate <= @E AND COALESCE(cm.TerminationReason, '') <> ''";
    const cnt = (cond: string, as: string) => `COUNT(DISTINCT CASE WHEN ${cond} THEN m.pk_member_master_profile_id END) AS ${as}`;
    const joined = "cm.JoinedDate >= @S AND cm.JoinedDate <= @E";
    const memberAggSelect = [
      cnt(act, "Members"), cnt(`${act} AND ${beforeJul1}`, "MembersJul1"), cnt(`${act} AND m.Gender = 'Female'`, "Women"),
      cnt(`${act} AND m.Gender = 'Female' AND ${beforeJul1}`, "WomenJul1"), cnt(`${act} AND ${YOUTH_EXPR}`, "Youth"), cnt(`${act} AND ${joined}`, "Added"),
      cnt(left, "LeftCount"), cnt("cm.isdeleted = 1 AND COALESCE(cm.TerminationReason, '') <> ''", "DeletedAllTime"),
      cnt(`${act} AND ${beforeJul1} AND ${YOUTH_EXPR}`, "YouthJul1"), cnt(`${act} AND ${joined} AND ${YOUTH_EXPR}`, "YouthAdded"),
      cnt(`${act} AND m.Gender = 'Female' AND ${joined}`, "WomenAdded"), cnt(`${left} AND m.Gender = 'Female'`, "WomenLeft"), cnt(`${left} AND ${YOUTH_EXPR}`, "YouthLeft"),
      cnt(`${left} AND ${beforeJul1}`, "LeftJul1"), cnt(`${left} AND m.Gender = 'Female' AND ${beforeJul1}`, "WomenLeftJul1"), cnt(`${left} AND ${YOUTH_EXPR} AND ${beforeJul1}`, "YouthLeftJul1"),
    ].join(",\n              ");
    const memberFrom = `
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE ${activeClub}`;
    const toAgg = (r: Record<string, unknown> | null): MemberAgg => ({
      members: num(r?.Members), membersJul1: num(r?.MembersJul1), women: num(r?.Women), womenJul1: num(r?.WomenJul1), youth: num(r?.Youth), added: num(r?.Added),
      leftCount: num(r?.LeftCount), deletedAllTime: num(r?.DeletedAllTime), youthJul1: num(r?.YouthJul1), youthAdded: num(r?.YouthAdded), youthLeft: num(r?.YouthLeft),
      womenAdded: num(r?.WomenAdded), womenLeft: num(r?.WomenLeft), leftJul1: num(r?.LeftJul1), womenLeftJul1: num(r?.WomenLeftJul1), youthLeftJul1: num(r?.YouthLeftJul1),
    });
    for (const a of await conn.query(`SELECT cm.fk_club_id AS ClubId, ${memberAggSelect} ${memberFrom} AND cm.IsHonoraryMember = 0 GROUP BY cm.fk_club_id`, p)) {
      const st = stats.get(num(a.ClubId));
      if (st) st.m = toAgg(a);
    }
    const dm = toAgg(await conn.queryFirstOrDefault(`SELECT ${memberAggSelect} ${memberFrom} AND cm.IsHonoraryMember = 0`, p));

    // ── Projects (current year table) ──
    let projects: Record<string, unknown>[] = [];
    const projTable = this.yearTables.getProjectsTableName(yearLabel);
    try {
      projects = await conn.query(
        `SELECT CASE WHEN COALESCE(pr.fk_club_id, 0) > 0 THEN pr.fk_club_id END AS ClubId,
                mm.ModuleKey AS ModuleKey, pr.project_cost AS Cost, pr.Currency AS Currency,
                CAST(pr.direct_beneficiaries AS SIGNED) AS Beneficiaries, CAST(pr.man_hours AS SIGNED) AS ManHours,
                pr.DistrictProjectType AS DistrictProjectType
         FROM \`${projTable}\` pr
         JOIN module_master mm ON mm.pk_module_id = pr.fk_module_id
         LEFT JOIN club_master c ON c.pk_club_id = pr.fk_club_id
         WHERE COALESCE(pr.isdeleted, 0) = 0
           AND LOWER(COALESCE(pr.approval_status, '')) <> 'rejected'
           AND (pr.project_date IS NULL OR pr.project_date < @E1)
           AND ( (COALESCE(pr.fk_club_id, 0) > 0 AND ${activeClub})
              OR (COALESCE(pr.fk_club_id, 0) = 0 AND pr.fk_district_id = @D) )`,
        p,
      );
    } catch (e) {
      this.log.warn(`Performance report: project query failed for ${projTable}: ${(e as Error).message}`);
    }
    const rates = await this.fx.getRates();
    // Club projects only in the avenue totals; the district's own projects/events feed the At a glance totals.
    const avenueTotals = new Map<string, number>();
    let clubServiceEntries = 0, totalBeneficiaries = 0, totalHours = 0, districtProjects = 0, districtEvents = 0, districtBeneficiaries = 0, districtHours = 0, totalCost = 0, districtCost = 0;
    for (const pr of projects) {
      const cost = convertCurrency(num(pr.Cost), str(pr.Currency), currency, rates);
      const ben = num(pr.Beneficiaries), hrs = num(pr.ManHours);
      if (pr.ClubId === null || pr.ClubId === undefined) {
        if (ci(str(pr.DistrictProjectType), "Event")) districtEvents++;
        else districtProjects++;
        districtBeneficiaries += ben;
        districtHours += hrs;
        districtCost += cost;
        continue;
      }
      const st = stats.get(num(pr.ClubId));
      if (ci(str(pr.ModuleKey), CLUB_SERVICE_KEY)) {
        clubServiceEntries++;
        if (st) st.clubService++;
        continue;
      }
      const label = PROJECT_AVENUES.find((a) => ci(str(pr.ModuleKey), a[0]))?.[1] ?? OTHER_AVENUE;
      avenueTotals.set(label, (avenueTotals.get(label) ?? 0) + 1);
      totalBeneficiaries += ben;
      totalHours += hrs;
      totalCost += cost;
      if (!st) continue;
      st.projects.set(label, (st.projects.get(label) ?? 0) + 1);
      st.totalProjects++;
      st.beneficiaries += ben;
      st.manHours += hrs;
      st.cost += cost;
    }
    const hasOtherAvenue = avenueTotals.has(OTHER_AVENUE);
    const avenueSum = [...avenueTotals.values()].reduce((a, b) => a + b, 0);

    // ── Club Monthly Report ──
    const cmr = await conn.query(
      `SELECT r.fk_club_id AS ClubId, CAST(r.ReportMonth AS SIGNED) AS ReportMonth, CAST(COALESCE(r.IsUploadedToDistrict, 0) AS SIGNED) AS Uploaded
       FROM club_monthly_reports r JOIN club_master c ON c.pk_club_id = r.fk_club_id
       WHERE ${anyActiveClub} AND r.fk_year_id = @Y AND COALESCE(r.isdeleted, 0) = 0`,
      p,
    );
    const t = ymd(today)!;
    const firstOfThisMonth = t.y * 12 + t.m;
    const monthStates = ROTARY_MONTHS.map((mo, i) => {
      const first = addMonths({ y: startP.y, m: 7, d: 1 }, i);
      const key = first.y * 12 + first.m;
      return { month: mo, due: key < firstOfThisMonth, future: key > firstOfThisMonth };
    });
    let cmrSubmitted = 0, cmrPending = 0, cmrNotStarted = 0;
    const cmrLookup = new Map<number, Map<number, boolean>>();
    for (const r of cmr) {
      const byMonth = cmrLookup.get(num(r.ClubId)) ?? new Map<number, boolean>();
      cmrLookup.set(num(r.ClubId), byMonth);
      byMonth.set(num(r.ReportMonth), (byMonth.get(num(r.ReportMonth)) ?? false) || num(r.Uploaded) === 1);
    }
    for (const st of stats.values()) {
      const byMonth = cmrLookup.get(st.club.id) ?? new Map<number, boolean>();
      for (const ms of monthStates) {
        const has = byMonth.has(ms.month), uploaded = byMonth.get(ms.month) === true;
        if (has && uploaded) st.cmrSubmitted++;
        st.cmrByMonth.set(ms.month, ms.future ? "" : has ? (uploaded ? "Submitted" : "Pending") : ms.due ? "Not started" : "");
        if (!ms.due) continue;
        if (has && uploaded) cmrSubmitted++;
        else if (has) { cmrPending++; st.cmrPending++; }
        else { cmrNotStarted++; st.cmrNotStarted++; }
      }
    }
    // Club Monthly Report for EVERY active club, synced or not.
    const cmrAllClubs: CmrGridRow[] = [...clubs, ...nonSynced].sort((a, b) => ordinal(a.clubName, b.clubName)).map((c) => {
      const byMonth = cmrLookup.get(c.id) ?? new Map<number, boolean>();
      const cells = new Map<number, string>();
      let submitted = 0;
      for (const ms of monthStates) {
        const has = byMonth.has(ms.month), uploaded = byMonth.get(ms.month) === true;
        if (has && uploaded) submitted++;
        cells.set(ms.month, ms.future ? "" : has && uploaded ? "Submitted" : ms.due || has ? "Not submitted" : "");
      }
      return { club: c, byMonth: cells, submitted };
    });

    // ── PPH camps (the communication counts are computed but not reported, as in RIZones) ──
    const countComms = async (table: string, dateCol: string) => {
      const rows = await conn.query(
        `SELECT CASE WHEN COALESCE(n.fk_club_id, 0) > 0 THEN n.fk_club_id END AS ClubId, COUNT(*) AS N
         FROM \`${table}\` n LEFT JOIN club_master c ON c.pk_club_id = n.fk_club_id
         WHERE COALESCE(n.isdeleted, 0) = 0
           AND n.${dateCol} >= @S AND n.${dateCol} < @E1
           AND ( (COALESCE(n.fk_club_id, 0) > 0 AND ${activeClub})
              OR (COALESCE(n.fk_club_id, 0) = 0 AND n.fk_district_id = @D) )
         GROUP BY CASE WHEN COALESCE(n.fk_club_id, 0) > 0 THEN n.fk_club_id END`,
        p,
      );
      return new Map(rows.filter((r) => r.ClubId !== null && r.ClubId !== undefined).map((r) => [num(r.ClubId), num(r.N)]));
    };
    for (const [table, col] of [["newsletters", "PublishDateTime"], ["announcements", "PublishDateTime"], ["upcoming_events", "PublishDate"], ["club_documents", "PublishDateTime"]]) await countComms(table, col);
    const pph = await countComms("pph_camps", "CampDate");
    for (const st of stats.values()) st.mod.set("PPH Camps", pph.get(st.club.id) ?? 0);

    // ── Club websites — ACTIVE only (as on today) ──
    const siteRows = await conn.query(
      `SELECT w.fk_club_id AS ClubId, c.ClubName AS ClubName, w.Subdomain, w.ClientDomain, w.Status, w.EndDate
       FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
       WHERE ${activeClub} AND COALESCE(w.isdeleted, 0) = 0
         AND (w.IsPurchased = 1 OR COALESCE(w.AmountPaid, 0) > 0 OR COALESCE(w.TransactionId, '') <> '')
       ORDER BY c.ClubName, w.pk_id DESC`,
      p,
    );
    const firstPerClub = new Map<number, Record<string, unknown>>();
    for (const w of siteRows) if (!firstPerClub.has(num(w.ClubId))) firstPerClub.set(num(w.ClubId), w);
    const activeSites: WebsiteRow[] = [...firstPerClub.values()]
      .filter((w) => !(w.EndDate && String(w.EndDate).slice(0, 10) < today) && (!str(w.Status)?.trim() || ci(str(w.Status), "Active")))
      .map((w) => ({ clubId: num(w.ClubId), clubName: str(w.ClubName), subdomain: str(w.Subdomain), clientDomain: str(w.ClientDomain), status: str(w.Status), endDate: str(w.EndDate), host: null, url: null }));
    for (const w of activeSites) {
      w.host = siteHost(w.clientDomain, w.subdomain, this.parentDomain);
      w.url = w.host === null ? null : "https://" + w.host;
      const st = stats.get(w.clubId);
      if (st) st.website = w;
    }

    // ── District Dues (paid flags only; the section left the report in RIZones) ──
    const duesPaidClubs = new Set((await conn.query(
      `SELECT DISTINCT dp.fk_club_id AS ClubId FROM club_dues_payments dp
       JOIN club_dues d ON d.pk_club_dues_id = dp.fk_club_dues_id
       WHERE d.fk_district_id = @D AND d.RotaryYear = @YL AND COALESCE(d.isdeleted, 0) = 0
         AND COALESCE(dp.isdeleted, 0) = 0 AND dp.IsPaid = 1`,
      p,
    )).map((r) => num(r.ClubId)));
    for (const st of stats.values()) st.districtDuesPaid = duesPaidClubs.has(st.club.id);

    // ── District Awards (only when enabled AND the year has questions) ──
    const scalar = async (label: string, sql: string) => {
      try { return num(await conn.executeScalar(sql, p)); } catch (e) { this.log.warn(`Performance report: ${label} failed: ${(e as Error).message}`); return 0; }
    };
    const dAwardsEnabled = await scalar("District Awards config read", "SELECT COUNT(*) FROM district_awards_config WHERE fk_district_id = @D AND fk_year_id = @Y AND is_enabled = 1");
    const dAwardQuestions = await scalar("District Awards question count", `
      SELECT (SELECT COUNT(*) FROM district_citation_auto_question WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0)
           + (SELECT COUNT(*) FROM district_citation_manual_criteria WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0)`);
    const awardsEnabled = dAwardsEnabled > 0 && dAwardQuestions > 0;
    const points = (await conn.query(
      `SELECT fk_club_id AS ClubId,
              CAST(COALESCE(SUM(COALESCE(points_earned, 0) + COALESCE(bonus_earned, 0)), 0) AS DECIMAL(14,2)) AS Points,
              CAST(COALESCE(SUM(CASE WHEN entry_type = 'auto' THEN COALESCE(points_earned, 0) + COALESCE(bonus_earned, 0) END), 0) AS DECIMAL(14,2)) AS AutoPoints,
              CAST(COALESCE(SUM(CASE WHEN entry_type = 'manual' THEN COALESCE(points_earned, 0) + COALESCE(bonus_earned, 0) END), 0) AS DECIMAL(14,2)) AS ManualPoints
       FROM district_citation_club_entry
       WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0
       GROUP BY fk_club_id`,
      p,
    )).filter((x) => stats.has(num(x.ClubId)));
    for (const pt of points) stats.get(num(pt.ClubId))!.awardPoints = num(pt.Points);
    const districtAwardPoints = points.reduce((a, x) => a + num(x.Points), 0);
    const awardClubs = points.filter((x) => num(x.Points) > 0).length;

    // ── President / Secretary (current year BOD) ──
    for (const l of await conn.query(
      `SELECT b.fk_club_id AS ClubId, dm.designation_name AS Designation,
              COALESCE(m.MemberName, b.non_member_name) AS Name,
              COALESCE(m.PrimaryMobileNumber, b.non_member_mobile) AS Mobile,
              COALESCE(m.EmailId, b.non_member_email) AS Email
       FROM board_of_directors b
       JOIN club_master c ON c.pk_club_id = b.fk_club_id
       JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
       WHERE ${activeClub} AND b.fk_year_id = @Y AND COALESCE(b.isdeleted, 0) = 0
         AND dm.designation_name IN ('Club President', 'Club Secretary')
       ORDER BY b.sort_order, b.pk_board_director_id`,
      p,
    )) {
      const st = stats.get(num(l.ClubId));
      if (!st) continue;
      const row: LeaderRow = { clubId: num(l.ClubId), designation: str(l.Designation), name: str(l.Name), mobile: str(l.Mobile), email: str(l.Email) };
      if (row.designation === "Club President") st.president ??= row;
      else st.secretary ??= row;
    }

    // ── Goal Setting ──
    const categories = (await conn.query("SELECT pk_category_id AS Id, IF(Name = 'TRF', 'Foundation', Name) AS Name FROM goal_categories WHERE isdeleted = 0 ORDER BY SortOrder, pk_category_id"))
      .map((c) => ({ id: num(c.Id), name: String(c.Name ?? "") }));
    for (const gs of await conn.query(
      `SELECT DISTINCT ge.fk_club_id AS ClubId, gf.fk_category_id AS CatId
       FROM goal_entries ge
       JOIN goal_fields gf ON gf.pk_field_id = ge.fk_field_id
       JOIN club_master c ON c.pk_club_id = ge.fk_club_id
       WHERE ge.EntityType = 'Club' AND ge.fk_year_id = @Y AND COALESCE(ge.isdeleted, 0) = 0
         AND gf.FieldRole = 'Target' AND ${activeClub}
         AND (ge.NumericValue IS NOT NULL OR COALESCE(ge.TextValue, '') <> '' OR ge.BoolValue IS NOT NULL)`,
      p,
    )) stats.get(num(gs.ClubId))?.goalCategoriesSet.add(num(gs.CatId));
    const goalData = await this.goals.getDistrictPerformanceGoalData(districtId, yearId, includeAttachment);

    // ── Other module counts (each isolated: a failing module reads 0) ──
    const clubCount = async (key: string, sql: string) => {
      let byClub = new Map<number, number>();
      try {
        byClub = new Map((await conn.query(sql, p)).filter((r) => r.ClubId !== null && r.ClubId !== undefined).map((r) => [num(r.ClubId), num(r.N)]));
      } catch (e) {
        this.log.warn(`Performance report: ${key} per-club count failed: ${(e as Error).message}`);
      }
      for (const st of stats.values()) st.mod.set(key, byClub.get(st.club.id) ?? 0);
    };
    const xClub = `JOIN club_master c ON c.pk_club_id = x.fk_club_id WHERE ${activeClub}`;
    await clubCount("Potential Members", `SELECT x.fk_club_id AS ClubId, COUNT(*) AS N FROM potential_members x ${xClub} AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id`);
    await clubCount("OCV/GOV Documents", `SELECT x.fk_club_id AS ClubId, COUNT(*) AS N FROM ocv_documents x ${xClub} AND x.fk_year_id = @Y AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id`);
    await clubCount("TRF Contributions", `SELECT x.fk_club_id AS ClubId, COUNT(*) AS N FROM trf_contributions x ${xClub} AND x.fk_year_id = @Y AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id`);
    try {
      for (const r of await conn.query(`SELECT x.fk_club_id AS ClubId, COALESCE(SUM(x.AmountUSD), 0) AS Usd FROM trf_contributions x ${xClub} AND x.fk_year_id = @Y AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id`, p)) {
        const st = stats.get(num(r.ClubId));
        if (st) st.trfUsd = num(r.Usd);
      }
    } catch (e) {
      this.log.warn(`Performance report: TRF amount failed: ${(e as Error).message}`);
    }
    await clubCount("Beneficiary Approvals", `SELECT x.fk_club_id AS ClubId, COUNT(*) AS N FROM beneficiary_approval_requests x ${xClub} AND x.created_date >= @S AND x.created_date < @E1 GROUP BY x.fk_club_id`);
    const clubsTotal = (key: string) => [...stats.values()].reduce((a, s) => a + (s.mod.get(key) ?? 0), 0);

    // ══ Sections (email body = screen = Summary sheet) ══
    const sections: PerformanceReportSection[] = [];
    const allStats = [...stats.values()].sort((a, b) => ordinal(a.club.clubName, b.club.clubName));
    // Email / screen / Summary show the two headline goal areas only — Membership and Foundation.
    const headlineGoals = goalData.districtMetrics.filter((g) => !g.singleValue && HEADLINE_GOAL_CATEGORIES.has(g.category.toLowerCase()));
    const goalRows = (category: string) => headlineGoals.filter((g) => ci(g.category, category));
    const trfRow = (g: DistrictPerformanceGoalMetric) => [g.metric, (g.baseline ?? 0) === 0 ? "—" : Dec(g.baseline), Dec(g.target), Dec(g.achieved), Pct2(g.pct)];

    // Part 1 — the district's own work.
    const districtPart = `District ${districtNumber}`;
    const addDistrict = (s: PerformanceReportSection) => sections.push({ ...s, part: districtPart, partSubtitle: "The district's own work" });
    const trfGoals = goalRows("Foundation");
    const trfAsOn = goalData.achievedAsOn.get("foundation") ?? null;
    addDistrict(section({
      title: "Goal Setting — District Foundation",
      tableHeaders: ["Particulars", "Highest", "Target", trfAsOn !== null ? `Achieved (as on ${trfAsOn})` : "Achieved", PCT_HEADER],
      intro: `Targets for the year can be set and updated in the Goal Setting module on the ${Brand.Current.productName} portal. Youth Service and Public Image goals are provided in the attached Excel (Goals - District sheet).`,
      tableRows: trfGoals.map(trfRow),
      note: trfGoals.length === 0 ? "The district has not entered Foundation goals yet." : null,
    }));
    const bandCount = (b: string) => N(allStats.filter((s) => membershipBand(s.m.members) === b).length);
    addDistrict(section({
      title: "RAG Analysis — Healthy Clubs",
      tableHeaders: ["Band (active members per club)", "Clubs"],
      tableRows: [[`${RAG_RED} (10 – 25)`, bandCount(RAG_RED)], [`${RAG_AMBER} (26 – 40)`, bandCount(RAG_AMBER)], [`${RAG_GREEN} (41 and above)`, bandCount(RAG_GREEN)], [RAG_BELOW, bandCount(RAG_BELOW)]],
      note: "Bands are based on active members only. Honorary members are not counted.",
    }));
    if (awardsEnabled)
      addDistrict(section({
        title: "District Awards",
        items: [
          { label: "District Awards points (all clubs)", value: Dec(districtAwardPoints) },
          { label: "Clubs involved", value: N(awardClubs) },
          { label: "Clubs not involved", value: N(clubs.length - awardClubs) },
          { label: "Auto points total", value: Dec(points.reduce((a, x) => a + num(x.AutoPoints), 0)) },
          { label: "Manual points total", value: Dec(points.reduce((a, x) => a + num(x.ManualPoints), 0)) },
        ],
      }));

    // Part 2 — the district's clubs.
    const clubsPart = `Clubs of District ${districtNumber}`;
    const clubsPartSub = `${N(clubs.length + nonSynced.length)} active clubs · ${N(clubs.length)} synced with Rotary.org · ${N(nonSynced.length)} not synced`;
    const addClubs = (s: PerformanceReportSection) => sections.push({ ...s, part: clubsPart, partSubtitle: clubsPartSub });
    const membershipGoals = goalRows("Membership");
    const goal = (metric: string) => membershipGoals.find((g) => ci(g.metric, metric)) ?? null;
    const countRow = (label: string, jul1: number, added: number, deleted: number, now: number, g: DistrictPerformanceGoalMetric | null) => [
      label, N(jul1), N(added), N(deleted), N(now), (g?.target ?? 0) > 0 ? Dec(g!.target) : "—", (g?.target ?? 0) > 0 ? Pct(g!.pct) : "—",
    ];
    addClubs(section({
      title: "Clubs & Members",
      intro: "This data is fetched from synchronised clubs. The data may not be accurate if there are non-sync clubs in your district.",
      tableHeaders: ["Count", "As on 1 July", "Added", "Deleted", "As on today", "Target", "Achieved"],
      tableRows: [
        countRow("Active clubs", clubsJul1, clubsAdded, clubsRemoved, clubsToday, goal("New Clubs")),
        countRow("Members", dm.membersJul1 + dm.leftJul1, dm.added + (dm.leftCount - dm.leftJul1), dm.leftCount, dm.members, goal("Total Members")),
        countRow("Women members", dm.womenJul1 + dm.womenLeftJul1, dm.womenAdded + (dm.womenLeft - dm.womenLeftJul1), dm.womenLeft, dm.women, goal("Women Membership")),
        countRow("Youth members (18–40)", dm.youthJul1 + dm.youthLeftJul1, dm.youthAdded + (dm.youthLeft - dm.youthLeftJul1), dm.youthLeft, dm.youth, null),
      ],
    }));
    const projectItems: PerformanceReportItem[] = PROJECT_AVENUES.map((a) => ({ label: a[1], value: N(avenueTotals.get(a[1]) ?? 0) }));
    if (hasOtherAvenue) projectItems.push({ label: OTHER_AVENUE, value: N(avenueTotals.get(OTHER_AVENUE)!) });
    projectItems.push(
      { label: "Total projects", value: N(avenueSum) },
      { label: "Club Service", value: N(clubServiceEntries) },
      { label: "Clubs with at least one project", value: N(allStats.filter((s) => s.totalProjects > 0).length) },
      { label: "Beneficiaries", value: N(totalBeneficiaries) },
      { label: "Volunteer hours", value: N(totalHours) },
      { label: "Project cost", value: Money(totalCost, currency) },
    );
    addClubs(section({ title: "Service Projects & Club Service", items: projectItems }));
    addClubs(section({
      title: "Club Monthly Report - Month wise",
      tableHeaders: ["Month", "Submitted", "Not submitted"],
      tableRows: monthStates.filter((x) => x.due).map((ms) => [
        monthName(ms.month),
        N(cmrAllClubs.filter((x) => x.byMonth.get(ms.month) === "Submitted").length),
        N(cmrAllClubs.filter((x) => x.byMonth.get(ms.month) === "Not submitted").length),
      ]),
    }));
    addClubs(section({
      title: "E-Governance",
      items: [
        { label: "OCV / GOV documents uploaded", value: N(clubsTotal("OCV/GOV Documents")) },
        { label: "PPH camps held", value: N([...pph].filter(([k]) => stats.has(k)).reduce((a, [, v]) => a + v, 0)) },
      ],
    }));
    if (awardsEnabled)
      addClubs(section({
        title: "District Awards — Top Clubs",
        tableHeaders: ["#", "Club", "Points"],
        tableRows: allStats.filter((s) => s.awardPoints > 0).sort((a, b) => b.awardPoints - a.awardPoints).slice(0, 5).map((s, i) => [String(i + 1), s.club.clubName, Dec(s.awardPoints)]),
        note: awardClubs === 0 ? "No club has District Awards points yet." : null,
      }));
    addClubs(section({
      title: "Top 5 Clubs by Projects",
      tableHeaders: ["#", "Club", "Projects"],
      tableRows: allStats.filter((s) => s.totalProjects > 0).sort((a, b) => b.totalProjects - a.totalProjects || ordinal(a.club.clubName, b.club.clubName)).slice(0, 5)
        .map((s, i) => [String(i + 1), s.club.clubName, N(s.totalProjects)]),
    }));

    // ── At a glance ──
    const totalMembersGoal = headlineGoals.find((g) => ci(g.category, "Membership") && ci(g.metric, "Total Members")) ?? null;
    const totalGivingGoal = headlineGoals.find((g) => ci(g.category, "Foundation") && ci(g.metric, "Total Giving")) ?? null;
    const projectTotal = avenueSum + districtProjects + districtEvents;
    const highlights = [
      tile({ label: "Clubs", value: N(clubs.length + nonSynced.length), sub: `${N(clubs.length)} synced · ${N(nonSynced.length)} not synced` }),
      totalGivingGoal === null || (totalGivingGoal.target ?? 0) <= 0
        ? tile({ label: "Foundation Total Giving", value: "—", sub: "Goal not set yet" })
        : tile({ label: "Foundation Total Giving", value: Dec(totalGivingGoal.achieved), sub: `${Pct2(totalGivingGoal.pct)} target of ${Dec(totalGivingGoal.target)}`, percent: totalGivingGoal.pct ?? 0 }),
      tile({ newRow: true, label: "Service Projects", value: N(projectTotal), sub: `by ${N(allStats.filter((s) => s.totalProjects > 0).length)} clubs${districtProjects + districtEvents > 0 ? " + district" : ""}` }),
      tile({ label: "Total Cost", value: Money(totalCost + districtCost, currency), sub: "clubs and district projects" }),
      tile({ label: "Beneficiaries", value: N(totalBeneficiaries + districtBeneficiaries), sub: "people reached this year" }),
      tile({ label: "Man Hours", value: N(totalHours + districtHours), sub: "volunteer hours this year" }),
    ];

    const period = `${dmy(start)} – ${dmy(end)}`;
    const foundation = new Map<string, number>();
    for (const g of goalRows("Foundation")) if (g.achieved !== null && !foundation.has(g.metric)) foundation.set(g.metric, g.achieved);
    const kpi: DistrictPerformanceKpi = {
      zoneName: zoneName ?? "", districtNumber, governorName: dgName, clubs: clubs.length, nonSyncedClubs: nonSynced.length, members: dm.members, women: dm.women, youth: dm.youth,
      joined: dm.added, left: dm.leftCount, clubProjects: avenueSum, districtProjects: districtProjects + districtEvents, beneficiaries: totalBeneficiaries + districtBeneficiaries,
      volunteerHours: totalHours + districtHours, cmrSubmitted, cmrDue: cmrSubmitted + cmrPending + cmrNotStarted, awardPoints: districtAwardPoints, clubService: clubServiceEntries,
      avenues: new Map([...PROJECT_AVENUES.map((a) => a[1]), ...(hasOtherAvenue ? [OTHER_AVENUE] : [])].map((l) => [l, avenueTotals.get(l) ?? 0])),
      foundation, trfAsOn, membershipTarget: totalMembersGoal?.target ?? null, membershipAchieved: totalMembersGoal?.achieved ?? null, membershipPct: totalMembersGoal?.pct ?? null,
      trfTarget: totalGivingGoal?.target ?? null, trfAchieved: totalGivingGoal?.achieved ?? null, trfPct: totalGivingGoal?.pct ?? null,
    };
    const result = newResult({
      highlights, tilesPerRow: 4,
      scopeNote: "Club counts and Club Monthly Report figures include every active club, whether or not it has enabled sync with Rotary.org. All other figures cover only clubs that have enabled sync, so they may differ from the district's own records until all clubs enable sync. Clubs that have not yet enabled sync are listed in the attached Excel (Non-Synced Clubs sheet).",
      districtId, districtNumber, zoneName: zoneName ?? "", yearId, yearLabel, periodLabel: period,
      governorName: dgName, governorEmail: dgEmail && dgEmail.trim() ? dgEmail.trim() : null, governorMobile: dgMobile,
      subject: `District Performance Report — District ${districtNumber} — ${dmy(today)}`,
      fileName: `District_${safeFile(districtNumber)}_Performance_Report_${formatDate(nowIn(this.tz), "ddMMyyyy_HHmm")}.xlsx`,
      sections, reportKicker: "District Performance Report", reportTitle: `District ${districtNumber}`,
      reportSubtitle: `${zoneName ?? ""} · Rotary Year ${yearLabel} · ${period}`,
      salutation: !dgName || !dgName.trim() ? "Dear District Governor," : `Dear DG ${dgName},`,
      introLine: `Here is how District ${districtNumber} is progressing this Rotary year — the work of every club, brought together in one place.`,
      closingLine: `Thank you for leading District ${districtNumber} this year. These figures are the combined effort of your clubs and Rotarians, and we hope this report helps you see that effort clearly and act on it.`,
      attachmentNote: "The attached Excel holds the complete data behind this report. Sheets included: Summary (this email), District (all district figures), All Clubs (one row per club with every module count), Synced and Non-Synced Clubs, "
        + (CLUB_GOALS_COMING_SOON ? "Goals - District (Club Goal Setting is coming soon), " : "Goals - District, Goals - Clubs (one sheet each for Membership, Youth Service, Foundation and Public Image), ")
        + "Projects Ranking, Club Monthly Report Grid and Club Websites (active).",
      kpi,
    });

    if (includeAttachment) {
      // Zonal Awards — points by goal (Excel "District" sheet only).
      let zonalByGoal: { goal: string; points: number; maxPoints: number | null }[] = [];
      try {
        zonalByGoal = (await conn.query(
          `SELECT g.title AS Goal, CAST(COALESCE(SUM(e.received_points), 0) AS DECIMAL(14,2)) AS Points, CAST(MAX(g.max_points) AS DECIMAL(14,2)) AS MaxPoints
           FROM zonal_awards_goal g
           JOIN zonal_awards_question q ON q.fk_goal_id = g.pk_id AND COALESCE(q.isdeleted, 0) = 0
           JOIN zonal_awards_question_option o ON o.fk_question_id = q.pk_id AND COALESCE(o.isdeleted, 0) = 0
           LEFT JOIN zonal_awards_district_entry e ON e.fk_option_id = o.pk_id AND e.fk_district_id = @D AND e.fk_year_id = @Y AND COALESCE(e.isdeleted, 0) = 0
           WHERE g.fk_year_id = @Y AND COALESCE(g.isdeleted, 0) = 0
           GROUP BY g.pk_id, g.title, g.sort_order
           ORDER BY g.sort_order, g.pk_id`,
          p,
        )).map((z) => ({ goal: String(z.Goal ?? ""), points: num(z.Points), maxPoints: z.MaxPoints === null || z.MaxPoints === undefined ? null : num(z.MaxPoints) }));
      } catch (e) {
        this.log.warn(`Performance report: zonal awards by goal failed: ${(e as Error).message}`);
      }
      result.excel = await buildDistrictWorkbook({
        r: result, clubs: allStats, categories, hasOtherAvenue, websites: activeSites, months: monthStates.map((x) => x.month), goals: goalData, currency, nonSynced,
        cmrRows: cmrAllClubs, awardsEnabled, zonalByGoal,
      });
      result.html = buildEmailBody(result, null);
    }
    return result;
  }

  /** RI Director report — every district, zone-wise, built from each district's own report. */
  async buildZoneReport(includeAttachment: boolean): Promise<DistrictPerformanceReportResult> {
    const districts = await this.loadReportDistricts(this.db);
    const built = await mapLimit(districts, 3, async (d) => {
      try {
        return await this.buildReport(d.districtId, false);
      } catch (e) {
        this.log.warn(`RI Director report: District ${d.districtNumber} could not be built. ${(e as Error).message}`);
        return null;
      }
    });
    const reports = built.filter((r): r is DistrictPerformanceReportResult => !!r?.kpi);
    const first = reports[0] ?? null;
    const k = reports.map((r) => r.kpi!);
    const sum = (rows: DistrictPerformanceKpi[], f: (x: DistrictPerformanceKpi) => number) => rows.reduce((a, x) => a + f(x), 0);
    const clubs = sum(k, (x) => x.clubs), nonSynced = sum(k, (x) => x.nonSyncedClubs);
    const projects = sum(k, (x) => x.clubProjects + x.districtProjects), beneficiaries = sum(k, (x) => x.beneficiaries), hours = sum(k, (x) => x.volunteerHours);
    const trfTarget = sum(k, (x) => x.trfTarget ?? 0), trfAchieved = sum(k, (x) => ((x.trfTarget ?? 0) > 0 ? (x.trfAchieved ?? 0) : 0));
    const zones = [...new Set(reports.map((r) => r.zoneName))];
    const avenues = [...PROJECT_AVENUES.map((a) => a[1]), ...[...new Set(k.flatMap((x) => [...x.avenues.keys()]))].filter((a) => a === OTHER_AVENUE)];
    const fund = (rows: DistrictPerformanceKpi[], f: string) => sum(rows, (x) => x.foundation.get(f) ?? 0);
    const avenue = (rows: DistrictPerformanceKpi[], a: string) => sum(rows, (x) => x.avenues.get(a) ?? 0);
    // "Foundation as on <date>" — the latest date any district has TRF figures for.
    const asOn = k.map((x) => x.trfAsOn).filter((x): x is string => !!x && !!x.trim()).map((x) => Date.parse(`${x} UTC`)).filter((x) => !Number.isNaN(x));
    const foundationGroup = asOn.length > 0 ? `Foundation (as on ${dmy(new Date(Math.max(...asOn)).toISOString().slice(0, 10))})` : "Foundation";
    const membershipGroup = "Districts & Clubs", serviceGroup = "Service Projects & Club Service";

    const highlights = [
      tile({ group: membershipGroup, label: "Districts", value: N(reports.length), sub: `in ${N(zones.length)} zones` }),
      tile({ group: membershipGroup, label: "Clubs", value: N(clubs + nonSynced), sub: `${N(clubs)} synced · ${N(nonSynced)} not synced` }),
      ...ZONE_FUNDS.map((f) => tile({
        group: foundationGroup, label: f, value: Dec(fund(k, f)),
        sub: f === "Total Giving" && trfTarget > 0 ? `${Pct2(dotnetRound((trfAchieved / trfTarget) * 100, 2))} target of ${Dec(trfTarget)}` : "achieved this year",
      })),
      ...avenues.map((a) => tile({ group: serviceGroup, label: a, value: N(avenue(k, a)), sub: "projects" })),
      tile({ group: serviceGroup, label: "Total Projects", value: N(projects), sub: `${N(beneficiaries)} beneficiaries · ${N(hours)} man hours` }),
      tile({ group: serviceGroup, label: "Club Service", value: N(sum(k, (x) => x.clubService)), sub: "club service entries" }),
    ];

    // Email body: one row per ZONE only; the district detail lives in the Excel.
    const zonePart = "Zone-wise Progress";
    const zonePartSub = `${N(reports.length)} districts · ${N(zones.length)} zones · district-wise detail in the attached Excel`;
    const zone = (z: string) => reports.filter((r) => r.zoneName === z).map((r) => r.kpi!);
    const sections: PerformanceReportSection[] = [];
    sections.push(section({
      part: zonePart, partSubtitle: zonePartSub, title: "Clubs", tableHeaders: ["Zone", "Clubs"],
      tableRows: [...zones.map((z) => [z, N(sum(zone(z), allClubs))]), [ZONE_TOTAL_LABEL, N(sum(k, allClubs))]],
    }));
    sections.push(section({
      part: zonePart, partSubtitle: zonePartSub, title: foundationGroup, tableHeaders: ["Zone", ...ZONE_FUNDS],
      tableRows: [...zones.map((z) => [z, ...ZONE_FUNDS.map((f) => Dec(fund(zone(z), f)))]), [ZONE_TOTAL_LABEL, ...ZONE_FUNDS.map((f) => Dec(fund(k, f)))]],
    }));
    const serviceLines: [string, (zr: DistrictPerformanceKpi[]) => string][] = [
      ...avenues.map((a): [string, (zr: DistrictPerformanceKpi[]) => string] => [a, (zr) => N(avenue(zr, a))]),
      ["Total Projects", (zr) => N(sum(zr, (x) => x.clubProjects + x.districtProjects))],
      ["Club Service", (zr) => N(sum(zr, (x) => x.clubService))],
    ];
    sections.push(section({
      part: zonePart, partSubtitle: zonePartSub, title: "Service Projects & Club Service", tableHeaders: ["Service", ...zones, "Total"],
      tableRows: serviceLines.map(([label, value]) => [label, ...zones.map((z) => value(zone(z))), value(k)]),
    }));

    const today = this.todayIso;
    const result = newResult({
      districtNumber: "All Zones", zoneName: `${N(zones.length)} zones`, yearId: first?.yearId ?? 0, yearLabel: first?.yearLabel ?? "", periodLabel: first?.periodLabel ?? "",
      subject: `RI Director Report — All Zones — ${dmy(today)}`,
      fileName: `RI_Director_Report_All_Zones_${formatDate(nowIn(this.tz), "ddMMyyyy_HHmm")}.xlsx`,
      reportKicker: "RI Director Report", reportTitle: "All Zones",
      reportSubtitle: `${N(zones.length)} zones · ${N(reports.length)} districts · Rotary Year ${first?.yearLabel ?? ""} · ${first?.periodLabel ?? ""}`,
      salutation: "Dear RI Director,",
      introLine: "Here is how every district across the zones is progressing this Rotary year — zone by zone.",
      closingLine: "Thank you for your guidance and leadership across the zones.",
      attachmentNote: "The attached Excel holds the complete data behind this report. Sheets included: Summary (this email), All Districts (one row per district with every district and club figure, with zone totals), Clubs, Foundation and Service Projects.",
      highlights,
      scopeNote: "Club counts include every active club, whether or not it has enabled sync with Rotary.org. All other figures are drawn only from clubs that have enabled sync, so they may differ from the district's own records until all clubs enable sync.",
      sections, districtReports: reports,
    });
    if (includeAttachment) {
      result.excel = await buildZoneWorkbook(result);
      result.html = buildEmailBody(result, null);
    }
    return result;
  }

  /** The email body of a built report — the screen's "Print" opens exactly this. */
  buildPrintHtml(r: DistrictPerformanceReportResult) {
    return buildEmailBody(r, null);
  }

  // ── Send ─────────────────────────────────────────────────────────────────────────────────────
  private requireTestRecipients() {
    const list = this.testRecipients;
    if (list.length === 0) throw new InvalidOperationException("No test recipients are configured (DistrictPerformanceReport:TestRecipients).");
    return list;
  }

  async sendZoneTest(requestedByMemberId: number): Promise<string> {
    const list = this.requireTestRecipients();
    const r = await this.buildZoneReport(true);
    const [to, ...cc] = list;
    const html = buildEmailBody(r, "TEST COPY — when this goes live it will be sent to the RI Directors listed in Settings → RI Director.");
    try {
      await this.email.sendScopedEmailWithAttachment(to, r.subject, html, r.excel!, r.fileName, cc, null, null, EMAIL_TYPE);
      await this.logRun(0, r.yearId, "ZoneManual", to, cc, "Sent", null, requestedByMemberId);
    } catch (e) {
      await this.logRun(0, r.yearId, "ZoneManual", to, cc, "Failed", (e as Error).message, requestedByMemberId);
      throw e;
    }
    return `RI Director report (all zones) sent to ${list.join(", ")}.`;
  }

  async sendTest(districtId: number, requestedByMemberId: number): Promise<string> {
    const list = this.requireTestRecipients();
    const r = await this.buildReport(districtId, true);
    const [to, ...cc] = list;
    const dgLine = r.governorEmail !== null
      ? `When this goes live it will be sent to District Governor ${r.governorName} (${r.governorEmail}).`
      : "When this goes live it will be SKIPPED for this district — no District Governor email is on record.";
    const html = buildEmailBody(r, "TEST COPY — " + dgLine);
    try {
      await this.email.sendScopedEmailWithAttachment(to, r.subject, html, r.excel!, r.fileName, cc, null, districtId, EMAIL_TYPE);
      await this.logRun(districtId, r.yearId, "Manual", to, cc, "Sent", null, requestedByMemberId);
    } catch (e) {
      await this.logRun(districtId, r.yearId, "Manual", to, cc, "Failed", (e as Error).message, requestedByMemberId);
      throw e;
    }
    return `Test email for District ${r.districtNumber} sent to ${list.join(", ")}.`;
  }

  /** catchUp = started after today's hour: only districts with a VERIFIED "not sent today" log are sent. */
  async runScheduled(catchUp: boolean): Promise<void> {
    if (!this.enabled) return;
    const today = this.todayIso;
    const preview = this.previewDate === today;
    const live = this.mode === "Live" && !preview;
    if (live && !this.liveDays.includes(Number(today.slice(8, 10)))) return;
    if (!live && !preview && this.mode === "Live") return;
    const runType = live ? "ScheduledLive" : "ScheduledTest";

    const all = await this.loadReportDistricts(this.db);
    const tests = this.testDistricts.map((x) => x.toLowerCase());
    const targets = live ? all : all.filter((d) => tests.includes(d.districtNumber.toLowerCase()));
    const skippedNoDg: string[] = [];
    for (const d of targets) {
      const already = await this.alreadyRanToday(d.districtId, runType);
      if (already === true) continue;
      if (catchUp && already === null) continue;
      let to: string | null = null;
      let cc: string[] = [];
      let yearId = 0;
      try {
        const r = await this.buildReport(d.districtId, true);
        yearId = r.yearId;
        if (live) {
          if (r.governorEmail === null) {
            skippedNoDg.push(d.districtNumber);
            await this.logRun(d.districtId, yearId, runType, null, null, "Skipped", "No District Governor email on record.", null);
            continue;
          }
          to = r.governorEmail;
          cc = this.liveCc;
        } else {
          [to = null, ...cc] = this.testRecipients;
          if (to === null) throw new InvalidOperationException("No test recipients are configured (DistrictPerformanceReport:TestRecipients).");
        }
        if (this.suppressLocalDev) {
          this.log.warn(`District performance report SUPPRESSED on a dev machine — District ${d.districtNumber} would go to ${to} (cc ${cc.join(", ")}).`);
          await this.logRun(d.districtId, yearId, runType, to, cc, "Suppressed", "Dev machine — scheduled send suppressed.", null);
          continue;
        }
        await this.email.sendScopedEmailWithAttachment(to, r.subject, r.html!, r.excel!, r.fileName, cc, null, d.districtId, EMAIL_TYPE);
        await this.logRun(d.districtId, yearId, runType, to, cc, "Sent", null, null);
        this.log.log(`District performance report sent — District ${d.districtNumber} to ${to}.`);
      } catch (e) {
        this.log.error(`District performance report failed for District ${d.districtNumber}: ${(e as Error).message}`);
        await this.logRun(d.districtId, yearId, runType, to, cc, "Failed", (e as Error).message, null);
      }
    }

    // Live: tell the CC people which districts were skipped for want of a DG email.
    const liveCc = this.liveCc;
    if (live && skippedNoDg.length > 0 && !this.suppressLocalDev && liveCc.length > 0) {
      try {
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        const body = `${emailHeader()}
                    <p style='font-size:14px;color:#333'>The District Performance Report was <strong>not sent</strong> to these districts
                    because no District Governor email is on record for the current Rotary year:</p>
                    <p style='font-size:15px;font-weight:bold;color:#1F4E79'>${esc(skippedNoDg.join(", "))}</p>
                    <p style='font-size:13px;color:#555'>Add the District Governor (with an email address) and the next run will include them.</p>
                    ${emailFooter()}`;
        await this.email.sendGenericEmailWithCc(liveCc[0], liveCc.length > 1 ? liveCc.slice(1).join(",") : null,
          `District Performance Report — ${skippedNoDg.length} district(s) skipped (no DG email) — ${dmy(today)}`, body);
      } catch (e) {
        this.log.error(`District performance report: could not send the skipped-districts notice. ${(e as Error).message}`);
      }
    }
    await this.runZoneScheduled(live, catchUp);
  }

  private async runZoneScheduled(live: boolean, catchUp: boolean) {
    const runType = live ? "ZoneLive" : "ZoneTest";
    const already = await this.alreadyRanToday(0, runType);
    if (already === true || (catchUp && already === null)) return;
    const recipients = live
      ? (await this.db.query(
          `SELECT DISTINCT TRIM(m.EmailId) AS Email FROM member_roles mr
           JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
           WHERE mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
             AND COALESCE(TRIM(m.EmailId), '') <> ''`,
        )).map((r) => String(r.Email))
      : this.testRecipients;
    if (recipients.length === 0) {
      this.log.warn("RI Director report: no recipients.");
      return;
    }
    // Live: one email PER RI Director (CC LiveCc); Test: one mail, first = To, rest = CC.
    const sendList: [string, string[]][] = live ? recipients.map((x) => [x, this.liveCc]) : [[recipients[0], recipients.slice(1)]];
    let report: DistrictPerformanceReportResult;
    try {
      report = await this.buildZoneReport(true);
    } catch (e) {
      this.log.error(`RI Director report failed to build. ${(e as Error).message}`);
      await this.logRun(0, 0, runType, null, null, "Failed", (e as Error).message, null);
      return;
    }
    for (const [to, cc] of sendList) {
      try {
        if (this.suppressLocalDev) {
          this.log.warn(`RI Director report SUPPRESSED on a dev machine — would go to ${to} (cc ${cc.join(", ")}).`);
          await this.logRun(0, report.yearId, runType, to, cc, "Suppressed", "Dev machine — scheduled send suppressed.", null);
          continue;
        }
        await this.email.sendScopedEmailWithAttachment(to, report.subject, report.html!, report.excel!, report.fileName, cc, null, null, EMAIL_TYPE);
        await this.logRun(0, report.yearId, runType, to, cc, "Sent", null, null);
        this.log.log(`RI Director report sent to ${to}.`);
      } catch (e) {
        this.log.error(`RI Director report failed for ${to}. ${(e as Error).message}`);
        await this.logRun(0, report.yearId, runType, to, cc, "Failed", (e as Error).message, null);
      }
    }
  }

  /** true = a Sent/Skipped row exists today; false = verified none; null = the log could not be read. */
  private async alreadyRanToday(districtId: number, runType: string): Promise<boolean | null> {
    try {
      return num(await this.db.executeScalar(
        `SELECT COUNT(*) FROM district_performance_report_log
         WHERE fk_district_id = @D AND RunType = @T AND RunDate = @Today AND Status IN ('Sent', 'Skipped')`,
        { D: districtId, T: runType, Today: this.todayIso },
      )) > 0;
    } catch (e) {
      this.log.warn(`District performance report: run log unavailable. ${(e as Error).message}`);
      return null;
    }
  }

  private async logRun(districtId: number, yearId: number, runType: string, to: string | null, cc: string[] | null, status: string, message: string | null, memberId: number | null) {
    try {
      await this.db.execute(
        `INSERT INTO district_performance_report_log
            (fk_district_id, fk_year_id, RunType, ToEmail, CcEmails, Status, Message, RunDate, created_by, created_date)
         VALUES (@D, @Y, @T, @To, @Cc, @S, @M, @Today, @By, NOW())`,
        {
          D: districtId, Y: yearId, T: runType, To: to, Cc: !cc || cc.length === 0 ? null : cc.join(","), S: status,
          M: message === null ? null : message.length > 1000 ? message.slice(0, 1000) : message, By: memberId, Today: this.todayIso,
        },
      );
    } catch (e) {
      this.log.warn(`District performance report: could not write the run log. ${(e as Error).message}`);
    }
  }
}

/** KeyNotFoundException → 404 in the controller. */
export class KeyNotFoundException extends Error {}

/** A client domain wins; else the subdomain as a host, a bare label getting the parent domain appended. */
export function siteHost(clientDomain: string | null, subdomain: string | null, parentDomain: string): string | null {
  const host = normalizeClientDomain(clientDomain);
  if (host !== null) return host;
  const sub = normalizeClientDomain(subdomain);
  if (sub === null) return null;
  return sub.includes(".") || !parentDomain ? sub : `${sub}.${parentDomain}`;
}

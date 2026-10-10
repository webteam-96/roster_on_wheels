import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { AllowAnonymous } from "../../auth/decorators";
import { queryInt, queryString, routeInt } from "../../common/binding";
import { ok } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { convertCurrency } from "../../services/currency.helper";
import { CurrencyRateService } from "../../services/currency-rate.service";
import { ProjectCountFilter, ProjectCountRules } from "../../services/project-count-rules";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";

const MAX_SEARCH_WORDS = 5;
const escapeLike = (s: string) => s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
const cache = (res: Response, seconds: number) => res.setHeader("Cache-Control", `public,max-age=${seconds}`);
const currencies = () => Brand.Current.locale.currencies.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c));
/** One SUM per brand currency plus "other" (unknown / blank = the brand default), so totals convert in one query. */
const costBuckets = () => {
  const cs = currencies();
  return [...cs.map((c) => `COALESCE(SUM(CASE WHEN u.Currency='${c}' THEN u.ProjectCost ELSE 0 END),0) AS \`cost_${c}\``),
    `COALESCE(SUM(CASE WHEN ${cs.length ? `u.Currency NOT IN (${cs.map((c) => `'${c}'`).join(",")})` : "1=1"} THEN u.ProjectCost ELSE 0 END),0) AS cost__other`].join(",\n");
};
const toDefaultCost = (row: Row, rates: Readonly<Record<string, number>>) => {
  const def = Brand.Current.locale.defaultCurrency;
  return currencies().reduce((s, c) => s + convertCurrency(Number(row[`cost_${c}`] ?? 0), c, def, rates), Number(row.cost__other ?? 0));
};

/** A Rotary year label the public pickers may offer: "YYYY-YY" starting no later than the current year. */
export function isOfferableYearLabel(label: string | null | undefined, currentStartYear: number): boolean {
  const m = /^(\d{4})-\d{2}$/.exec(label ?? "");
  if (!m) return false;
  const start = Number(m[1]);
  return start >= 1900 && start <= currentStartYear;
}

/**
 * Port of PublicProjectStatsController.cs: anonymous project statistics and search for the public site, over the
 * shared counting rules (ProjectCountRules) and the active club → district → zone chain. Money totals are in the
 * brand's default currency (RIZones: INR; the `valueInr` field name is kept for the client).
 */
@Controller("api/public/project-stats")
@AllowAnonymous()
export class PublicProjectStatsController {
  constructor(private readonly db: Db, private readonly years: YearTableResolver, private readonly fx: CurrencyRateService, private readonly rules: ProjectCountRules) {}

  private leg(f: ProjectCountFilter, t: YearTableInfo, withPhoto: boolean, search = "") {
    const suffix = t.yearLabel.replace(/-/g, "_");
    const photo = withPhoto ? `,
           CONVERT((SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', ph.image_path)
                    FROM \`${t.photosTable}\` ph WHERE ph.fk_project_id = p.pk_project_id ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id LIMIT 1) USING utf8mb4) AS PrimaryPhoto` : "";
    return `
        SELECT p.pk_project_id AS Id, p.fk_year_id AS YearId, '${t.yearLabel}' AS YearLabel, CONVERT(p.title USING utf8mb4) AS Title, p.project_date AS ProjectDate,
               COALESCE(p.project_cost, 0) AS ProjectCost, CONVERT(COALESCE(p.Currency, '') USING utf8mb4) AS Currency, COALESCE(p.direct_beneficiaries, 0) AS DirectBeneficiaries,
               COALESCE(p.man_hours, 0) AS ManHours, COALESCE(p.rotarians_involved, 0) AS Rotarians, COALESCE(p.fk_area_of_focus_id, 0) AS AreaId,
               CONVERT(COALESCE(NULLIF(aof.name,''), NULLIF(p.other_area_of_focus,''), 'Uncategorised') USING utf8mb4) AS AreaName, p.fk_club_id AS ClubId${photo}
        FROM \`${t.projectsTable}\` p
        JOIN module_master mm ON mm.pk_module_id = p.fk_module_id AND mm.ModuleKey IN (${ProjectCountFilter.ProjectModuleKeys})
        LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
        WHERE ${f.countsAsProject(t.projectsTable)}${search}`;
  }
  private union = (f: ProjectCountFilter, tables: YearTableInfo[], withPhoto: boolean, search = "") =>
    `(${tables.map((t) => this.leg(f, t, withPhoto, search)).join("\nUNION ALL\n")}) u ${f.geo("u.ClubId")}`;

  private async yearTables(conn: DbCommands, yearId: number | null) {
    const all = await this.years.getAllExistingYearTables(conn);
    return yearId !== null && yearId > 0 ? all.filter((t) => t.yearId === yearId) : all;
  }

  private async currentStartYear(conn: DbCommands) {
    const label = await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
    const m = /^(\d{4})/.exec(label ?? "");
    return m ? Number(m[1]) : new Date().getUTCFullYear();
  }

  /**
   * Each search word (max 5) must match the title as a whole word, or (3+ letters) the area / category / sub-category
   * (master or "other" text), or the club's name / state / district number. A trailing plural "s" is ignored.
   */
  private async searchSql(conn: DbCommands, q: string | null, p: Record<string, unknown>) {
    if (!q || !q.trim()) return "";
    const words = q.toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).slice(0, MAX_SEARCH_WORDS);
    if (!words.length) return " AND 1 = 0";
    let sql = "";
    for (const [i, raw] of words.entries()) {
      const w = raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
      const regex = `(?i)(^|[^\\p{L}\\p{N}])${w}s?([^\\p{L}\\p{N}]|$)`;
      p[`Q${i}`] = `%${escapeLike(w)}%`;
      p[`R${i}`] = regex;
      const title = `(p.title LIKE @Q${i} AND p.title REGEXP @R${i})`;
      if (raw.length < 3) { sql += `\n  AND ${title}`; continue; }
      const ids = async (s: string) => (await conn.query(s, { R: regex, W: raw })).map((r) => Number(Object.values(r)[0])).join(",") || "NULL";
      const areas = await ids("SELECT pk_area_of_focus_id FROM area_of_focus_master WHERE name REGEXP @R");
      const cats = await ids("SELECT pk_category_id FROM category_master WHERE name REGEXP @R");
      const subs = await ids("SELECT pk_sub_category_id FROM sub_category_master WHERE name REGEXP @R");
      const clubs = await ids(`SELECT sc.pk_club_id FROM club_master sc JOIN district_master sd ON sd.pk_district_id = sc.fk_district_id
                               WHERE sc.isdeleted = 0 AND sc.IsActive = 1 AND (sc.ClubName REGEXP @R OR sc.State REGEXP @R OR sd.DistrictNumber = @W)`);
      sql += `
  AND (${title} OR p.fk_area_of_focus_id IN (${areas}) OR p.fk_category_id IN (${cats}) OR p.fk_sub_category_id IN (${subs})
       OR (p.other_area_of_focus LIKE @Q${i} AND p.other_area_of_focus REGEXP @R${i}) OR (p.other_category LIKE @Q${i} AND p.other_category REGEXP @R${i})
       OR (p.other_sub_category LIKE @Q${i} AND p.other_sub_category REGEXP @R${i}) OR p.fk_club_id IN (${clubs}))`;
    }
    return sql;
  }

  private filterSql(state: string | null, districtId: number | null, clubId: number | null, areaId: number | null, p: Record<string, unknown>) {
    let s = "";
    if (state && state.trim()) { s += " AND c.State = @State"; p.State = state.trim(); }
    if (districtId !== null && districtId > 0) { s += " AND c.fk_district_id = @DistrictId"; p.DistrictId = districtId; }
    if (clubId !== null && clubId > 0) { s += " AND u.ClubId = @ClubId"; p.ClubId = clubId; }
    if (areaId !== null) { s += " AND u.AreaId = @AreaId"; p.AreaId = areaId; }
    return s;
  }

  /** Lifetime totals, the years offered, and the current year's figures. */
  @Get("overview")
  overview(@Res({ passthrough: true }) res: Response) {
    cache(res, 300);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const all = await this.years.getAllExistingYearTables(conn);
      if (!all.length) return ok({ totalProjects: 0, totalCost: 0, totalBeneficiaries: 0, totalManHours: 0, totalRotarians: 0, years: [], currentYear: null });
      const perYear = await conn.query(
        `SELECT u.YearLabel AS yearLabel, COUNT(*) AS totalProjects, ${costBuckets()}, COALESCE(SUM(u.DirectBeneficiaries),0) AS totalBeneficiaries,
                COALESCE(SUM(u.ManHours),0) AS totalManHours, COALESCE(SUM(u.Rotarians),0) AS totalRotarians
         FROM ${this.union(f, all, false)} GROUP BY u.YearLabel`);
      const rates = await this.fx.getRates();
      const t = { projects: 0, cost: 0, ben: 0, mh: 0, rot: 0 };
      const byLabel = new Map<string, { projects: number; cost: number; ben: number }>();
      for (const r of perYear) {
        const n = Number(r.totalProjects);
        if (n <= 0) continue;
        const cost = toDefaultCost(r, rates), ben = Number(r.totalBeneficiaries);
        t.projects += n; t.cost += cost; t.ben += ben; t.mh += Number(r.totalManHours); t.rot += Number(r.totalRotarians);
        byLabel.set(String(r.yearLabel).toLowerCase(), { projects: n, cost, ben });
      }
      const curStart = await this.currentStartYear(conn);
      const years = all.filter((y) => byLabel.has(y.yearLabel.toLowerCase()) && isOfferableYearLabel(y.yearLabel, curStart)).map((y) => ({ yearId: y.yearId, yearLabel: y.yearLabel })).reverse();
      const curId = await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
      const curTable = curId === null || curId === undefined ? undefined : all.find((y) => y.yearId === Number(curId));
      const cy = curTable ? byLabel.get(curTable.yearLabel.toLowerCase()) : undefined;
      return ok({
        totalProjects: t.projects, totalCost: t.cost, totalBeneficiaries: t.ben, totalManHours: t.mh, totalRotarians: t.rot, years,
        currentYear: curTable && cy ? { yearId: curTable.yearId, yearLabel: curTable.yearLabel, totalProjects: cy.projects, totalCost: cy.cost, totalBeneficiaries: cy.ben } : null,
      });
    });
  }

  /** Years with at least one counted project, newest first. */
  @Get("years")
  yearsList(@Res({ passthrough: true }) res: Response) {
    cache(res, 300);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const all = await this.years.getAllExistingYearTables(conn);
      if (!all.length) return ok([]);
      const curStart = await this.currentStartYear(conn);
      const live = new Set((await conn.query(`SELECT u.YearLabel AS yearLabel, COUNT(*) AS n FROM ${this.union(f, all, false)} GROUP BY u.YearLabel`))
        .filter((r) => Number(r.n) > 0).map((r) => String(r.yearLabel).toLowerCase()));
      return ok(all.filter((t) => live.has(t.yearLabel.toLowerCase()) && isOfferableYearLabel(t.yearLabel, curStart)).map((t) => ({ yearId: t.yearId, yearLabel: t.yearLabel })).reverse());
    });
  }

  @Get("states")
  states(@Res({ passthrough: true }) res: Response, @Query("yearId") y?: string) {
    cache(res, 300);
    const yearId = queryInt(y);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok([]);
      return ok(await conn.query(
        `SELECT CONVERT(c.State USING utf8mb4) AS state, COUNT(*) AS projects, COUNT(DISTINCT u.ClubId) AS clubs
         FROM ${this.union(f, tables, false)} WHERE c.State IS NOT NULL AND c.State <> '' GROUP BY c.State ORDER BY c.State`));
    });
  }

  @Get("states/:state/districts")
  stateDistricts(@Res({ passthrough: true }) res: Response, @Param("state") state: string, @Query("yearId") y?: string) {
    cache(res, 300);
    const yearId = queryInt(y);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok([]);
      return ok(await conn.query(
        `SELECT c.fk_district_id AS districtId, CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber, COUNT(*) AS projects, COUNT(DISTINCT u.ClubId) AS clubs
         FROM ${this.union(f, tables, false)} WHERE c.State = @State GROUP BY c.fk_district_id, d.DistrictNumber ORDER BY d.DistrictNumber`, { State: state }));
    });
  }

  @Get("districts")
  districts(@Res({ passthrough: true }) res: Response, @Query("state") s?: string, @Query("yearId") y?: string) {
    cache(res, 300);
    const yearId = queryInt(y), state = queryString(s);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok([]);
      return ok(await conn.query(
        `SELECT c.fk_district_id AS districtId, CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber, COUNT(*) AS projects, COUNT(DISTINCT u.ClubId) AS clubs
         FROM ${this.union(f, tables, false)} WHERE 1=1 ${state && state.trim() ? " AND c.State = @State" : ""}
         GROUP BY c.fk_district_id, d.DistrictNumber ORDER BY d.DistrictNumber`, { State: state?.trim() }));
    });
  }

  @Get("districts/:districtId/clubs")
  districtClubs(@Res({ passthrough: true }) res: Response, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = routeInt(d);
    cache(res, 300);
    const yearId = queryInt(y);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok([]);
      return ok(await conn.query(
        `SELECT u.ClubId AS clubId, CONVERT(c.ClubName USING utf8mb4) AS clubName, CONVERT(c.City USING utf8mb4) AS city, COUNT(*) AS projects
         FROM ${this.union(f, tables, false)} WHERE c.fk_district_id = @DistrictId GROUP BY u.ClubId, c.ClubName, c.City ORDER BY c.ClubName`, { DistrictId: districtId }));
    });
  }

  @Get("clubs/:clubId/areas")
  clubAreas(@Res({ passthrough: true }) res: Response, @Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    cache(res, 300);
    const yearId = queryInt(y);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok([]);
      return ok(await conn.query(
        `SELECT u.AreaId AS areaOfFocusId, u.AreaName AS name, COUNT(*) AS projects
         FROM ${this.union(f, tables, false)} WHERE u.ClubId = @ClubId GROUP BY u.AreaId, u.AreaName ORDER BY projects DESC, name`, { ClubId: clubId }));
    });
  }

  @Get("areas")
  areas(@Res({ passthrough: true }) res: Response, @Query("state") s?: string, @Query("districtId") d?: string, @Query("yearId") y?: string) {
    cache(res, 300);
    const yearId = queryInt(y), districtId = queryInt(d), state = queryString(s);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok([]);
      const p: Record<string, unknown> = {};
      const filter = this.filterSql(state, districtId, null, null, p);
      return ok(await conn.query(
        `SELECT u.AreaId AS areaOfFocusId, u.AreaName AS name, COUNT(*) AS projects
         FROM ${this.union(f, tables, false)} WHERE 1=1 ${filter} GROUP BY u.AreaId, u.AreaName ORDER BY projects DESC, name`, p));
    });
  }

  @Get("summary")
  summary(@Res({ passthrough: true }) res: Response, @Query("yearId") y?: string, @Query("state") s?: string, @Query("districtId") d?: string, @Query("clubId") c?: string,
          @Query("areaOfFocusId") a?: string, @Query("q") q?: string) {
    cache(res, 120);
    const yearId = queryInt(y), districtId = queryInt(d), clubId = queryInt(c), areaId = queryInt(a), state = queryString(s), query = queryString(q);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok({ totalProjects: 0, clubsInvolved: 0, valueInr: 0, beneficiaries: 0, manHours: 0 });
      const p: Record<string, unknown> = {};
      const filter = this.filterSql(state, districtId, clubId, areaId, p);
      const search = await this.searchSql(conn, query, p);
      const row = (await conn.queryFirstOrDefault(
        `SELECT COUNT(*) AS totalProjects, COUNT(DISTINCT u.ClubId) AS clubsInvolved, ${costBuckets()},
                COALESCE(SUM(u.DirectBeneficiaries),0) AS beneficiaries, COALESCE(SUM(u.ManHours),0) AS manHours
         FROM ${this.union(f, tables, false, search)} WHERE 1=1 ${filter}`, p))!;
      return ok({ totalProjects: Number(row.totalProjects), clubsInvolved: Number(row.clubsInvolved), valueInr: toDefaultCost(row, await this.fx.getRates()),
        beneficiaries: Number(row.beneficiaries), manHours: Number(row.manHours) });
    });
  }

  /** Paged (≤ 48) project cards; with a search, an exact title match ranks first, then a phrase match. */
  @Get("projects")
  projects(@Res({ passthrough: true }) res: Response, @Query("yearId") y?: string, @Query("state") s?: string, @Query("districtId") d?: string, @Query("clubId") c?: string,
           @Query("areaOfFocusId") a?: string, @Query("q") q?: string, @Query("page") pq?: string, @Query("pageSize") sq?: string) {
    cache(res, 120);
    const yearId = queryInt(y), districtId = queryInt(d), clubId = queryInt(c), areaId = queryInt(a), state = queryString(s), query = queryString(q);
    let page = queryInt(pq, 1), pageSize = queryInt(sq, 24);
    page = page < 1 ? 1 : page;
    pageSize = pageSize < 1 ? 24 : Math.min(pageSize, 48);
    return this.db.session(async (conn) => {
      const f = await this.rules.getFilter(conn);
      const tables = await this.yearTables(conn, yearId);
      if (!tables.length) return ok({ items: [], totalCount: 0, page, pageSize, totalPages: 0 });
      const p: Record<string, unknown> = {};
      const filter = this.filterSql(state, districtId, clubId, areaId, p);
      const search = await this.searchSql(conn, query, p);
      const total = Number(await conn.executeScalar(`SELECT COUNT(*) FROM ${this.union(f, tables, false, search)} WHERE 1=1 ${filter}`, p));
      let rank = "";
      if (query && query.trim()) {
        const phrase = query.trim().toLowerCase();
        p.QExact = phrase;
        p.QPhrase = `%${escapeLike(phrase)}%`;
        rank = "CASE WHEN LOWER(TRIM(u.Title)) = @QExact THEN 0 WHEN LOWER(u.Title) LIKE @QPhrase THEN 1 ELSE 2 END, ";
      }
      const items = await conn.query(
        `SELECT u.Id AS id, u.YearId AS yearId, u.Title AS title, u.ProjectDate AS projectDate, u.ProjectCost AS projectCost, u.Currency AS currency,
                u.DirectBeneficiaries AS directBeneficiaries, u.AreaName AS areaOfFocus, u.ClubId AS clubId, CONVERT(c.ClubName USING utf8mb4) AS clubName,
                CONVERT(c.City USING utf8mb4) AS city, CONVERT(c.State USING utf8mb4) AS state, CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber,
                CONVERT(z.ZoneName USING utf8mb4) AS zoneName, u.PrimaryPhoto AS primaryPhoto
         FROM ${this.union(f, tables, true, search)} WHERE 1=1 ${filter}
         ORDER BY ${rank}u.ProjectDate DESC, u.Id DESC LIMIT @Offset, @PageSize`, { ...p, Offset: (page - 1) * pageSize, PageSize: pageSize });
      // A blank stored currency reads as the brand default (RIZones defaulted to INR).
      for (const it of items) if (!it.currency) it.currency = Brand.Current.locale.defaultCurrency;
      return ok({ items, totalCount: total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    });
  }
}

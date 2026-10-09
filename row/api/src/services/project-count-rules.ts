import { Injectable, Logger } from "@nestjs/common";
import type { DbCommands } from "../database/db.service";
import { AppConfig } from "../config/app-config";
import { dbDateTime } from "../common/binding";
import { YearTableResolver } from "./year-table.resolver";

/**
 * Port of ProjectCountRules.cs: ONE definition of "a project that counts",
 * shared by everything that publishes a project count.
 *   1. one-time projects count;
 *   2. an ongoing project counts once: its parent, or (when the parent is in an
 *      earlier year table) its first entry of this year;
 *   3. a project over the beneficiary limit and not approved does not count;
 *   4. a project the club moderator has not approved does not count;
 *   5. only the organisation's zones count, minus exempt districts.
 * Rule 5 is configuration in ROW (ProjectCount:ZoneNames / ProjectCount:ExemptDistrictNumbers,
 * both arrays; empty = every active zone / no exemptions). RIZones hard-coded its own zones.
 */
@Injectable()
export class ProjectCountRules {
  private readonly log = new Logger("ProjectCountRules");
  private cached: ProjectCountFilter | null = null;
  private cachedAt = 0;
  private building: Promise<ProjectCountFilter> | null = null;

  constructor(
    private readonly years: YearTableResolver,
    private readonly config: AppConfig,
  ) {}

  /** The beneficiary-blocked project ids per year table (cached ~60 s). */
  async getFilter(conn: DbCommands): Promise<ProjectCountFilter> {
    if (this.cached && Date.now() - this.cachedAt < 60_000) return this.cached;
    this.building ??= this.build(conn).finally(() => (this.building = null));
    const built = await this.building;
    this.cached = built;
    this.cachedAt = Date.now();
    return built;
  }

  private async build(conn: DbCommands): Promise<ProjectCountFilter> {
    const map = new Map<string, Set<number>>();
    const geo = { zones: this.config.getArray("ProjectCount:ZoneNames"), exempt: this.config.getArray("ProjectCount:ExemptDistrictNumbers") };
    try {
      const requests = await conn.query("SELECT fk_project_id AS ProjectId, fk_club_id AS ClubId, created_date AS Created FROM beneficiary_approval_requests WHERE status IN ('pending','rejected')");
      if (!requests.length) return new ProjectCountFilter(map, geo);
      const ids = [...new Set(requests.map((r) => Number(r.ProjectId)))];
      // pk_project_id is unique only within a year table: resolve each request to ONE table.
      const candidates = new Map<string, { table: string; created: string | null }[]>();
      for (const t of await this.years.getAllExistingYearTables(conn)) {
        let rows;
        try {
          rows = await conn.query(`SELECT pk_project_id AS ProjectId, fk_club_id AS ClubId, created_date AS Created FROM \`${t.projectsTable}\` WHERE pk_project_id IN @Ids AND COALESCE(isdeleted,0) = 0`, { Ids: ids });
        } catch (e) {
          this.log.warn(`Project count rules: could not read ${t.projectsTable}: ${(e as Error).message}`);
          continue;
        }
        for (const r of rows) {
          const key = `${r.ProjectId}:${r.ClubId}`;
          const list = candidates.get(key) ?? [];
          list.push({ table: t.projectsTable, created: dbDateTime(r.Created) });
          candidates.set(key, list);
        }
      }
      for (const req of requests) {
        const list = candidates.get(`${req.ProjectId}:${req.ClubId}`);
        if (!list || !list.length) continue;
        const reqCreated = dbDateTime(req.Created);
        const before = (c: string | null) => reqCreated === null || (c ?? "") <= reqCreated;
        const pick = [...list].sort((a, b) => Number(before(b.created)) - Number(before(a.created)) || (b.created ?? "").localeCompare(a.created ?? ""))[0].table;
        const set = map.get(pick) ?? new Set<number>();
        set.add(Number(req.ProjectId));
        map.set(pick, set);
      }
    } catch (e) {
      // fails OPEN (nothing blocked) rather than hiding the whole feed
      this.log.warn(`Project count rules: beneficiary block list unavailable — counting without it: ${(e as Error).message}`);
    }
    return new ProjectCountFilter(map, geo);
  }
}

const sqlList = (v: string[]) => v.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");

/** The SQL half of the rules; every fragment names the year table it belongs to. */
export class ProjectCountFilter {
  /** The 5 project avenues. Club Service is a meeting, not a project. */
  static readonly ProjectModuleKeys = "'community_service','vocational_service','international_service','new_generation_service','public_image_initiative'";
  static readonly ClubServiceModuleKey = "club_service";
  static readonly AvenueModuleKeys = `${ProjectCountFilter.ProjectModuleKeys},'club_service'`;

  constructor(
    private readonly blocked: Map<string, Set<number>>,
    private readonly geoRule: { zones: string[]; exempt: string[] },
  ) {}

  /** club -> district -> zone with rule 5 applied. */
  geo(clubIdExpr: string, club = "c", district = "d", zone = "z"): string {
    const exempt = this.geoRule.exempt.length ? ` AND ${district}.DistrictNumber NOT IN (${sqlList(this.geoRule.exempt)})` : "";
    const zones = this.geoRule.zones.length ? ` AND ${zone}.ZoneName IN (${sqlList(this.geoRule.zones)})` : "";
    return `
        JOIN club_master ${club} ON ${club}.pk_club_id = ${clubIdExpr} AND ${club}.isdeleted = 0 AND ${club}.IsActive = 1
        JOIN district_master ${district} ON ${district}.pk_district_id = ${club}.fk_district_id
             AND ${district}.isdeleted = 0 AND ${district}.IsActive = 1${exempt}
        JOIN zone_master ${zone} ON ${zone}.pk_zone_id = ${district}.fk_zone_id
             AND ${zone}.isdeleted = 0 AND ${zone}.IsActive = 1${zones}`;
  }

  static live = (a = "p") => `${a}.isdeleted = 0 AND ${a}.is_active = 1`;
  static moderatorOk = (a = "p") => `LOWER(COALESCE(${a}.approval_status,'')) IN ('','approved')`;

  beneficiaryOk(table: string, a = "p"): string {
    const set = this.blocked.get(table);
    if (!set || !set.size) return "1 = 1";
    return `${a}.pk_project_id NOT IN (${[...set].sort((x, y) => x - y).join(",")})`;
  }

  representsProject(table: string, a = "p"): string {
    return `(
        COALESCE(${a}.parent_project_id,0) = 0
        OR (
            NOT EXISTS (SELECT 1 FROM \`${table}\` par
                        WHERE par.pk_project_id = ${a}.parent_project_id AND COALESCE(par.isdeleted,0) = 0)
            AND NOT EXISTS (SELECT 1 FROM \`${table}\` sib
                        WHERE sib.parent_project_id = ${a}.parent_project_id
                          AND sib.pk_project_id < ${a}.pk_project_id
                          AND ${ProjectCountFilter.live("sib")} AND ${ProjectCountFilter.moderatorOk("sib")} AND ${this.beneficiaryOk(table, "sib")})
        ))`;
  }

  countsAsProject(table: string, a = "p"): string {
    return `${ProjectCountFilter.live(a)} AND ${ProjectCountFilter.moderatorOk(a)} AND ${this.beneficiaryOk(table, a)} AND ${this.representsProject(table, a)}`;
  }

  bucketExpr(table: string, a = "p"): string {
    return `
        CASE WHEN NOT ${this.representsProject(table, a)}                       THEN 'repeat'
             WHEN NOT (${ProjectCountFilter.moderatorOk(a)})                    THEN 'moderator'
             WHEN NOT (${this.beneficiaryOk(table, a)})                         THEN 'beneficiary'
             WHEN LOWER(COALESCE(${a}.project_type,'one_time')) = 'one_time' THEN 'one_time'
             ELSE 'ongoing' END`;
  }
}

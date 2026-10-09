import { Injectable } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { CurrencyRateService } from "../../services/currency-rate.service";
import { convertCurrency, normalizeCurrency, resolveDefaultCurrency } from "../../services/currency.helper";
import { ClubAdminDashboardService, addMonths, int, ymd } from "./club-admin-dashboard.service";

const MONTH_LABELS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
/** ProjectCountFilter.ProjectModuleKeys: the five project avenues (Club Service is a meeting, not a project). */
const PROJECT_AVENUE_ONLY = `
    JOIN module_master pm ON pm.pk_module_id = p.fk_module_id
         AND pm.ModuleKey IN ('community_service','vocational_service','international_service','new_generation_service','public_image_initiative')`;

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || Number(v) === 1;
const round = (v: number, places = 0) => Math.round(v * 10 ** places) / 10 ** places;
const byName = <T extends { clubName: string }>(a: T, b: T) => a.clubName.localeCompare(b.clubName);

interface Trf {
  annualInr: number;
  polioInr: number;
  endowment: number;
  others: number;
  totalInr: number;
  totalUsd: number;
}
const emptyTrf = (): Trf => ({ annualInr: 0, polioInr: 0, endowment: 0, others: 0, totalInr: 0, totalUsd: 0 });

/**
 * Port of AgDashboardService.cs: the Assistant Governor dashboard over the
 * clubs in the member's AG group (district_ag) for the year. Amounts named
 * "...Inr" are USD totals (the C# INR rate is 1).
 */
@Injectable()
export class AgDashboardService {
  constructor(
    private readonly db: Db,
    private readonly yearTables: YearTableResolver,
    private readonly fx: CurrencyRateService,
  ) {}

  private static async agClubIds(conn: DbCommands, memberId: number, yearId: number | null, districtId: number | null = null): Promise<number[]> {
    if (memberId <= 0) return [];
    const rows = districtId && districtId > 0
      ? await conn.query(
          `SELECT DISTINCT da.fk_club_id AS id FROM district_ag da
           JOIN club_master c ON c.pk_club_id = da.fk_club_id AND c.isdeleted = 0
           WHERE da.fk_member_id = @MemberId AND da.isdeleted = 0 AND da.is_active = 1
             AND (@YearId IS NULL OR da.fk_year_id = @YearId) AND c.fk_district_id = @DistrictId`,
          { MemberId: memberId, YearId: yearId, DistrictId: districtId },
        )
      : await conn.query(
          `SELECT DISTINCT fk_club_id AS id FROM district_ag
           WHERE fk_member_id = @MemberId AND isdeleted = 0 AND is_active = 1 AND (@YearId IS NULL OR fk_year_id = @YearId)`,
          { MemberId: memberId, YearId: yearId },
        );
    return rows.map((r) => int(r.id));
  }

  /** All the AG's clubs, or just the requested one (which must be in the group). */
  private static async resolveClubIds(conn: DbCommands, memberId: number, yearId: number, clubId: number | null, districtId: number | null) {
    const all = await AgDashboardService.agClubIds(conn, memberId, yearId, districtId);
    if (!clubId || clubId <= 0) return all;
    if (!all.includes(clubId)) throw new UnauthorizedAccessException("You are not an active AG for this club in this year.");
    return [clubId];
  }

  private async tables(conn: DbCommands, yearId: number): Promise<YearTableInfo[]> {
    if (yearId > 0) {
      const t = await this.yearTables.resolveByYearId(conn, yearId);
      return t ? [t] : [];
    }
    return this.yearTables.getAllExistingYearTables(conn);
  }

  private static async identity(conn: DbCommands, memberId: number, yearId: number) {
    const r = await conn.queryFirstOrDefault(
      `SELECT m.MemberName AS name, COALESCE(d.DistrictNumber,'') AS districtNumber
       FROM member_master_profile m
       LEFT JOIN district_ag ag ON ag.fk_member_id = m.pk_member_master_profile_id
         AND ag.isdeleted = 0 AND ag.is_active = 1 AND (@YearId = 0 OR ag.fk_year_id = @YearId)
       LEFT JOIN club_master c ON c.pk_club_id = ag.fk_club_id
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE m.pk_member_master_profile_id = @MemberId AND m.isdeleted = 0
       LIMIT 1`,
      { MemberId: memberId, YearId: yearId },
    );
    return {
      memberId,
      name: str(r?.name) ?? "",
      districtNumber: str(r?.districtNumber) ?? "",
      yearLabel: (await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1", { YearId: yearId })) ?? "",
    };
  }

  private static async countBy(conn: DbCommands, sql: string, params: Record<string, unknown>) {
    return new Map((await conn.query(sql, params)).map((r) => [int(r.clubId), int(r.cnt)]));
  }

  private static memberCounts(conn: DbCommands, clubIds: number[]) {
    if (!clubIds.length) return Promise.resolve(new Map<number, number>());
    return AgDashboardService.countBy(
      conn,
      `SELECT fk_club_id AS clubId, COUNT(*) AS cnt FROM club_members
       WHERE fk_club_id IN @ClubIds AND IsActive = 1 AND isdeleted = 0 AND IsHonoraryMember = 0 GROUP BY fk_club_id`,
      { ClubIds: clubIds },
    );
  }

  private static meetingCounts(conn: DbCommands, clubIds: number[], yearId: number) {
    if (!clubIds.length) return Promise.resolve(new Map<number, number>());
    return AgDashboardService.countBy(
      conn,
      `SELECT fk_club_id AS clubId, COUNT(*) AS cnt FROM club_attendance
       WHERE fk_club_id IN @ClubIds AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId) GROUP BY fk_club_id`,
      { ClubIds: clubIds, YearId: yearId },
    );
  }

  /** President and Secretary of each club for the year. */
  private static async officers(conn: DbCommands, clubIds: number[], yearId: number) {
    const out = new Map<number, { president: string; secretary: string }>();
    if (!clubIds.length || yearId <= 0) return out;
    const rows = await conn.query(
      `SELECT bod.fk_club_id AS clubId, dm.designation_name AS designation, m.MemberName AS name
       FROM board_of_directors bod
       JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id AND COALESCE(dm.isdeleted,0) = 0
       JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id AND m.isdeleted = 0
       WHERE bod.fk_club_id IN @ClubIds AND bod.isdeleted = 0 AND bod.fk_year_id = @YearId
         AND ((dm.designation_name LIKE '%President%' AND dm.designation_name NOT LIKE '%Past%' AND dm.designation_name NOT LIKE '%Vice%')
           OR (dm.designation_name LIKE '%Secretary%' AND dm.designation_name NOT LIKE '%Joint%'))`,
      { ClubIds: clubIds, YearId: yearId },
    );
    for (const id of new Set(rows.map((r) => int(r.clubId)))) {
      const mine = rows.filter((r) => int(r.clubId) === id);
      const find = (word: string) => str(mine.find((r) => String(r.designation ?? "").toLowerCase().includes(word))?.name) ?? "";
      out.set(id, { president: find("president"), secretary: find("secretary") });
    }
    return out;
  }

  /** Sums a per-club count over the year's project tables. */
  private async projectSum(conn: DbCommands, clubIds: number[], yearId: number, select: string, join: string, extraWhere = "") {
    const result = new Map(clubIds.map((id) => [id, 0]));
    if (!clubIds.length) return result;
    for (const t of await this.tables(conn, yearId)) {
      for (const r of await conn.query(
        `SELECT p.fk_club_id AS clubId, ${select} AS cnt FROM \`${t.projectsTable}\` p ${join}
         WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0 ${extraWhere}
         GROUP BY p.fk_club_id`,
        { ClubIds: clubIds },
      )) result.set(int(r.clubId), (result.get(int(r.clubId)) ?? 0) + int(r.cnt));
    }
    return result;
  }

  private projectCounts = (conn: DbCommands, ids: number[], y: number) => this.projectSum(conn, ids, y, "COUNT(*)", PROJECT_AVENUE_ONLY);
  private clubServiceCounts = (conn: DbCommands, ids: number[], y: number) =>
    this.projectSum(conn, ids, y, "COUNT(*)", "JOIN module_master m ON m.pk_module_id = p.fk_module_id", "AND m.ModuleKey = 'club_service'");
  private beneficiaryTotals = (conn: DbCommands, ids: number[], y: number) => this.projectSum(conn, ids, y, "COALESCE(SUM(p.direct_beneficiaries),0)", PROJECT_AVENUE_ONLY);

  private static async trfBreakdown(conn: DbCommands, clubIds: number[], yearId: number) {
    const result = new Map(clubIds.map((id) => [id, emptyTrf()]));
    if (!clubIds.length) return result;
    for (const r of await conn.query(
      `SELECT t.fk_club_id AS clubId, COALESCE(f.FundName, t.OtherFundName, '') AS fundName, COALESCE(t.AmountUSD, 0) AS amount
       FROM trf_contributions t
       LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
       WHERE t.fk_club_id IN @ClubIds AND t.isdeleted = 0 AND (@YearId = 0 OR t.fk_year_id = @YearId)`,
      { ClubIds: clubIds, YearId: yearId },
    )) {
      const b = result.get(int(r.clubId));
      if (!b) continue;
      const v = num(r.amount);
      const fund = String(r.fundName ?? "").toLowerCase();
      if (fund.includes("annual")) b.annualInr += v;
      else if (fund.includes("polio")) b.polioInr += v;
      else if (fund.includes("endowment")) b.endowment += v;
      else b.others += v;
      b.totalInr += v;
      b.totalUsd += v;
    }
    return result;
  }

  private static async ocvCounts(conn: DbCommands, clubIds: number[]) {
    const result = new Map(clubIds.map((id) => [id, 0]));
    if (!clubIds.length) return result;
    for (const r of await conn.query(
      `SELECT fk_club_id AS clubId, COUNT(*) AS cnt FROM club_documents
       WHERE fk_club_id IN @ClubIds AND isdeleted = 0
         AND (AccessType IN ('readonly','downloadonly','read','download') OR AccessType IS NULL)
       GROUP BY fk_club_id`,
      { ClubIds: clubIds },
    )) result.set(int(r.clubId), int(r.cnt));
    return result;
  }

  /** A club's rank among all clubs of its district by project count. */
  private async projectRanks(conn: DbCommands, clubIds: number[], yearId: number) {
    const result = new Map(clubIds.map((id) => [id, 0]));
    if (!clubIds.length) return result;
    const districtId = int(await conn.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0 LIMIT 1", { ClubId: clubIds[0] }));
    if (districtId <= 0) return result;
    const districtClubs = (await conn.query("SELECT pk_club_id AS id FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0", { DistrictId: districtId })).map((r) => int(r.id));
    if (!districtClubs.length) return result;
    const counts = await this.projectCounts(conn, districtClubs, yearId);
    // Stable sort, as LINQ OrderByDescending keeps the original order for ties.
    [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([id], i) => {
      if (result.has(id)) result.set(id, i + 1);
    });
    return result;
  }

  private static async awardStatus(conn: DbCommands, clubIds: number[], yearId: number, names: Map<number, string>) {
    const map = new Map(
      clubIds.map((id) => [id, { clubId: id, clubName: names.get(id) ?? "", onTrack: false, achieved: false, presidentialCitation: "pending", districtCitation: "pending", membershipExcellence: "pending", isPending: true }]),
    );
    if (!clubIds.length) return { map, tableMissing: false };
    try {
      for (const r of await conn.query(
        `SELECT fk_club_id AS clubId, on_track, achieved,
                COALESCE(presidential_citation_status, 'pending') AS pres,
                COALESCE(district_citation_status, 'pending') AS dist,
                COALESCE(membership_excellence_status, 'pending') AS mem
         FROM club_award_status
         WHERE fk_club_id IN @ClubIds AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)`,
        { ClubIds: clubIds, YearId: yearId },
      )) {
        map.set(int(r.clubId), {
          clubId: int(r.clubId), clubName: names.get(int(r.clubId)) ?? "", onTrack: bool(r.on_track), achieved: bool(r.achieved),
          presidentialCitation: str(r.pres) ?? "pending", districtCitation: str(r.dist) ?? "pending", membershipExcellence: str(r.mem) ?? "pending", isPending: false,
        });
      }
      return { map, tableMissing: false };
    } catch {
      return { map, tableMissing: true };
    }
  }

  private static async clubNames(conn: DbCommands, clubIds: number[]) {
    return new Map((await conn.query("SELECT pk_club_id AS id, ClubName AS name FROM club_master WHERE pk_club_id IN @ClubIds AND isdeleted = 0", { ClubIds: clubIds })).map((r) => [int(r.id), str(r.name) ?? ""]));
  }

  // ---- endpoints ----

  async getAvailableYears(memberId: number, districtId: number | null) {
    const rows = await this.db.query(
      districtId && districtId > 0
        ? `SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel AS Label, y.IsCurrent AS IsCurrent, y.StartDate
           FROM district_ag da
           JOIN club_master c ON c.pk_club_id = da.fk_club_id AND c.isdeleted = 0
           JOIN rotary_year_master y ON y.pk_year_id = da.fk_year_id AND y.isdeleted = 0
           WHERE da.fk_member_id = @MemberId AND da.isdeleted = 0 AND da.is_active = 1 AND c.fk_district_id = @DistrictId
           ORDER BY y.StartDate DESC`
        : `SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel AS Label, y.IsCurrent AS IsCurrent, y.StartDate
           FROM district_ag da
           JOIN rotary_year_master y ON y.pk_year_id = da.fk_year_id AND y.isdeleted = 0
           WHERE da.fk_member_id = @MemberId AND da.isdeleted = 0 AND da.is_active = 1
           ORDER BY y.StartDate DESC`,
      { MemberId: memberId, DistrictId: districtId },
    );
    if (!rows.length) return { currentYearId: null, currentYearLabel: "", years: [] };
    const years = rows.map((y) => ({ id: int(y.Id), yearLabel: str(y.Label) ?? "", isCurrent: bool(y.IsCurrent) }));
    const pick = years.find((y) => y.isCurrent) ?? years[0];
    return { currentYearId: pick.id, currentYearLabel: pick.yearLabel, years };
  }

  async getProjectDetail(memberId: number, projectId: number, yearId: number | null, districtId: number | null) {
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      if (y <= 0 || projectId <= 0) return null;
      const clubIds = await AgDashboardService.agClubIds(conn, memberId, y, districtId);
      if (!clubIds.length) return null;
      const info = await this.yearTables.resolveByYearId(conn, y);
      if (!info) return null;
      let r;
      try {
        r = await conn.queryFirstOrDefault(
          `SELECT p.pk_project_id AS projectId, p.fk_club_id AS clubId, c.ClubName AS clubName, y.YearLabel AS yearLabel,
                  p.title, p.description, p.location,
                  COALESCE(md.ModuleName,'') AS avenue, COALESCE(aof.name,'') AS areaOfFocus, COALESCE(cat.name,'') AS category,
                  COALESCE(scat.name,'') AS subCategory, p.project_date AS projectDate, COALESCE(p.project_cost,0) AS cost,
                  COALESCE(f.name,'') AS funding, COALESCE(p.direct_beneficiaries,0) AS beneficiaries,
                  COALESCE(p.rotarians_involved,0) AS rotariansInvolved, COALESCE(p.rotaractors_involved,0) AS rotaractorsInvolved,
                  COALESCE(p.rcc_involved,0) AS rccInvolved, p.project_type AS projectType, COALESCE(p.is_joint_project,0) AS isJointProject,
                  p.co_host_name AS coHostName, p.club_role AS clubRole, p.approval_status AS approvalStatus
           FROM \`${info.projectsTable}\` p
           LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
           LEFT JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
           LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
           LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
           LEFT JOIN sub_category_master scat ON scat.pk_sub_category_id = p.fk_sub_category_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           WHERE p.pk_project_id = @ProjectId AND p.fk_club_id IN @ClubIds AND p.isdeleted = 0
           LIMIT 1`,
          { ProjectId: projectId, ClubIds: clubIds },
        );
      } catch {
        return null;
      }
      if (!r) return null;
      let manHours = 0;
      let manHoursPending = true;
      try {
        manHours = int(await conn.executeScalar(`SELECT COALESCE(man_hours,0) FROM \`${info.projectsTable}\` WHERE pk_project_id = @Id`, { Id: projectId }));
        manHoursPending = false;
      } catch {
        // column missing: leave pending
      }
      const suffix = info.yearLabel.replace(/-/g, "_");
      let photos: { url: string; description: string | null; isPrimary: boolean }[] = [];
      try {
        photos = (
          await conn.query(
            `SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                           CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                           '/', pp.image_path) AS photoUrl,
                    pp.description AS photoDesc, COALESCE(pp.is_primary,0) AS isPrimary
             FROM \`${info.photosTable}\` pp
             JOIN \`${info.projectsTable}\` p ON p.pk_project_id = pp.fk_project_id
             WHERE pp.fk_project_id = @Id
             ORDER BY pp.is_primary DESC, pp.sort_order, pp.pk_photo_id`,
            { Id: projectId },
          )
        ).map((p) => ({ url: str(p.photoUrl) ?? "", description: str(p.photoDesc), isPrimary: int(p.isPrimary) === 1 }));
      } catch {
        photos = [];
      }
      return {
        projectId, clubId: int(r.clubId), clubName: str(r.clubName) ?? "", yearId: y, yearLabel: str(r.yearLabel) ?? "", title: str(r.title) ?? "",
        description: str(r.description), location: str(r.location), avenue: str(r.avenue), areaOfFocus: str(r.areaOfFocus), category: str(r.category),
        subCategory: str(r.subCategory), date: ymd(r.projectDate), cost: num(r.cost), funding: str(r.funding) ?? "", beneficiaries: int(r.beneficiaries),
        manHours, manHoursIsPending: manHoursPending, rotariansInvolved: int(r.rotariansInvolved), rotaractorsInvolved: int(r.rotaractorsInvolved),
        rccInvolved: int(r.rccInvolved), projectType: str(r.projectType), isJointProject: int(r.isJointProject) === 1, coHostName: str(r.coHostName),
        clubRole: str(r.clubRole), approvalStatus: str(r.approvalStatus), photos,
      };
    });
  }

  private async clubSummaries(conn: DbCommands, clubIds: number[], yearId: number) {
    const meta = await conn.query(
      `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, COALESCE(d.DistrictNumber,'') AS districtNumber,
              COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSynced,
              (SELECT cw.Subdomain FROM club_websites cw WHERE cw.fk_club_id = c.pk_club_id AND COALESCE(cw.isdeleted, 0) = 0 ORDER BY cw.pk_id DESC LIMIT 1) AS websiteSubdomain,
              (SELECT CASE
                        WHEN cw.Status = 'Active' AND (cw.EndDate IS NULL OR cw.EndDate >= CURDATE()) THEN 'active'
                        WHEN cw.Status = 'Active' AND cw.EndDate < CURDATE() THEN 'expired'
                        WHEN cw.Status IS NOT NULL THEN 'expired'
                        ELSE 'none'
                      END
                 FROM club_websites cw WHERE cw.fk_club_id = c.pk_club_id AND COALESCE(cw.isdeleted, 0) = 0 ORDER BY cw.pk_id DESC LIMIT 1) AS websiteStatus
       FROM club_master c
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE c.pk_club_id IN @ClubIds AND c.isdeleted = 0`,
      { ClubIds: clubIds },
    );
    const members = await AgDashboardService.memberCounts(conn, clubIds);
    const clubService = await this.clubServiceCounts(conn, clubIds, yearId);
    const officers = await AgDashboardService.officers(conn, clubIds, yearId);
    const projects = await this.projectCounts(conn, clubIds, yearId);
    const ranks = await this.projectRanks(conn, clubIds, yearId);
    const trf = await AgDashboardService.trfBreakdown(conn, clubIds, yearId);
    const ocv = await AgDashboardService.ocvCounts(conn, clubIds);
    return {
      trf,
      clubs: meta
        .map((c) => {
          const id = int(c.clubId);
          return {
            clubId: id, clubName: str(c.clubName) ?? "", districtNumber: str(c.districtNumber) ?? "", presidentName: officers.get(id)?.president ?? "",
            secretaryName: officers.get(id)?.secretary ?? "", isSyncedFromRotaryOrg: bool(c.isSynced), clubWebsiteStatus: str(c.websiteStatus) || "none",
            clubWebsiteSubdomain: str(c.websiteSubdomain), members: members.get(id) ?? 0, clubService: clubService.get(id) ?? 0, totalProjects: projects.get(id) ?? 0,
            projectRank: ranks.get(id) ?? 0, trfTotalInr: trf.get(id)?.totalInr ?? 0, trfTotalUsd: trf.get(id)?.totalUsd ?? 0, ocv: ocv.get(id) ?? 0,
            nationalRank: null, nationalRankIsPending: true,
          };
        })
        .sort(byName),
    };
  }

  async getClubs(memberId: number, yearId: number | null, clubId: number | null, districtId: number | null) {
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const clubIds = await AgDashboardService.resolveClubIds(conn, memberId, y, clubId, districtId);
      const ag = await AgDashboardService.identity(conn, memberId, y);
      if (!clubIds.length) return { ag, clubs: [], totalMembers: 0, totalClubService: 0, totalProjects: 0, totalTrfInr: 0, totalClubsInDistrict: 0 };
      const { clubs } = await this.clubSummaries(conn, clubIds, y);
      const district = int(await conn.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId LIMIT 1", { ClubId: clubIds[0] }));
      const totalClubsInDistrict = district ? int(await conn.executeScalar("SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0", { DistrictId: district })) : 0;
      const sum = (k: "members" | "clubService" | "totalProjects" | "trfTotalInr") => clubs.reduce((s, c) => s + c[k], 0);
      return { ag, clubs, totalMembers: sum("members"), totalClubService: sum("clubService"), totalProjects: sum("totalProjects"), totalTrfInr: sum("trfTotalInr"), totalClubsInDistrict };
    });
  }

  async getClubDetail(memberId: number, clubId: number, yearId: number | null) {
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      if (!(await AgDashboardService.agClubIds(conn, memberId, y)).includes(clubId)) return null;
      const meta = await conn.queryFirstOrDefault(
        `SELECT c.ClubName AS clubName, COALESCE(d.DistrictNumber,'') AS districtNumber
         FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0 LIMIT 1`,
        { ClubId: clubId },
      );
      const only = [clubId];
      const officers = await AgDashboardService.officers(conn, only, y);
      const trf = await AgDashboardService.trfBreakdown(conn, only, y);
      const summary = {
        clubId, clubName: str(meta?.clubName) ?? "", districtNumber: str(meta?.districtNumber) ?? "", presidentName: officers.get(clubId)?.president ?? "",
        secretaryName: officers.get(clubId)?.secretary ?? "", isSyncedFromRotaryOrg: false, clubWebsiteStatus: "none", clubWebsiteSubdomain: null,
        members: (await AgDashboardService.memberCounts(conn, only)).get(clubId) ?? 0, clubService: (await this.clubServiceCounts(conn, only, y)).get(clubId) ?? 0,
        totalProjects: (await this.projectCounts(conn, only, y)).get(clubId) ?? 0, projectRank: (await this.projectRanks(conn, only, y)).get(clubId) ?? 0,
        trfTotalInr: trf.get(clubId)!.totalInr, trfTotalUsd: trf.get(clubId)!.totalUsd, ocv: (await AgDashboardService.ocvCounts(conn, only)).get(clubId) ?? 0,
        nationalRank: null, nationalRankIsPending: true,
      };
      const monthly = [];
      const { start } = await ClubAdminDashboardService.yearRange(conn, y);
      if (start) {
        const tables = await this.tables(conn, y);
        for (let i = 0; i < 9; i++) {
          const ms = addMonths(start, i);
          const p = { ClubId: clubId, Start: ms, End: addMonths(ms, 1) };
          let clubServiceCount = 0;
          let projects = 0;
          for (const t of tables) {
            clubServiceCount += int(
              await conn.executeScalar(
                `SELECT COUNT(*) FROM \`${t.projectsTable}\` p JOIN module_master m ON m.pk_module_id = p.fk_module_id
                 WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND m.ModuleKey = 'club_service' AND p.project_date >= @Start AND p.project_date < @End`,
                p,
              ),
            );
            projects += int(
              await conn.executeScalar(
                `SELECT COUNT(*) FROM \`${t.projectsTable}\` p ${PROJECT_AVENUE_ONLY}
                 WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.project_date >= @Start AND p.project_date < @End`,
                p,
              ),
            );
          }
          const trfMonth = num(await conn.executeScalar("SELECT COALESCE(SUM(AmountUSD),0) FROM trf_contributions WHERE fk_club_id = @ClubId AND isdeleted = 0 AND TrfDate >= @Start AND TrfDate < @End", p));
          monthly.push({ month: `${MONTH_LABELS[i]} ${ms.slice(0, 4)}`, clubService: clubServiceCount, projects, trfInr: trfMonth });
        }
      }
      const recent = [];
      for (const t of await this.tables(conn, y)) {
        for (const r of await conn.query(
          `SELECT p.title, p.project_date AS projectDate, COALESCE(md.ModuleName,'') AS avenue, COALESCE(aof.name,'') AS areaOfFocus,
                  COALESCE(cat.name,'') AS category, COALESCE(p.project_cost, 0) AS cost, COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                  (COALESCE(p.rotarians_involved,0) + COALESCE(p.rotaractors_involved,0)) AS rotarians, COALESCE(f.name,'') AS funding,
                  p.approval_status AS approvalStatus
           FROM \`${t.projectsTable}\` p
           LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
           LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           ${PROJECT_AVENUE_ONLY}
           WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
           ORDER BY p.project_date DESC LIMIT 10`,
          { ClubId: clubId },
        )) {
          recent.push({
            projectId: 0, yearId: 0, clubId, clubName: summary.clubName, title: str(r.title) ?? "", avenue: str(r.avenue), category: str(r.category),
            areaOfFocus: str(r.areaOfFocus), date: ymd(r.projectDate), cost: num(r.cost), currency: resolveDefaultCurrency(null), beneficiaries: int(r.beneficiaries), manHours: 0,
            funding: str(r.funding) ?? "", rotarians: int(r.rotarians), manHoursIsPending: false, approvalStatus: str(r.approvalStatus),
          });
        }
      }
      return { summary, monthly, trf: trf.get(clubId)!, recentProjects: recent.slice(0, 10) };
    });
  }

  async getMembership(memberId: number, yearId: number | null, clubId: number | null, districtId: number | null) {
    const clubs = await this.getClubs(memberId, yearId, clubId, districtId);
    return this.db.session(async (conn) => {
      const ids = clubs.clubs.map((c) => c.clubId);
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const benef = await this.beneficiaryTotals(conn, ids, y);
      const goals = new Map(ids.map((id) => [id, 0]));
      try {
        if (ids.length) {
          for (const r of await conn.query(
            `SELECT fk_club_id AS clubId, COUNT(*) AS cnt FROM district_citation_club_entry
             WHERE fk_club_id IN @ClubIds AND isdeleted = 0 AND COALESCE(points_earned, 0) > 0 AND (@YearId = 0 OR fk_year_id = @YearId)
             GROUP BY fk_club_id`,
            { ClubIds: ids, YearId: y },
          )) goals.set(int(r.clubId), int(r.cnt));
        }
      } catch {
        // citation tables may differ: counts stay 0
      }
      const rows = clubs.clubs.map((c) => ({
        clubId: c.clubId, clubName: c.clubName, members: c.members, clubService: c.clubService, totalProjects: c.totalProjects, projectRank: c.projectRank,
        trf: c.trfTotalInr, ocv: c.ocv, beneficiaries: benef.get(c.clubId) ?? 0, goalsCitations: goals.get(c.clubId) ?? 0,
      }));
      return {
        ag: clubs.ag, clubs: rows, totalMembers: clubs.totalMembers, totalClubService: clubs.totalClubService, totalProjects: clubs.totalProjects,
        totalTrfInr: clubs.totalTrfInr, totalOcv: rows.reduce((s, r) => s + r.ocv, 0), totalClubsInDistrict: clubs.totalClubsInDistrict,
        totalBeneficiaries: rows.reduce((s, r) => s + r.beneficiaries, 0),
      };
    });
  }

  async getTrf(memberId: number, yearId: number | null, clubId: number | null, districtId: number | null) {
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const ids = await AgDashboardService.resolveClubIds(conn, memberId, y, clubId, districtId);
      const ag = await AgDashboardService.identity(conn, memberId, y);
      if (!ids.length) return { ag, clubs: [], totals: emptyTrf() };
      const names = await AgDashboardService.clubNames(conn, ids);
      const members = await AgDashboardService.memberCounts(conn, ids);
      const totals = emptyTrf();
      const list = [...(await AgDashboardService.trfBreakdown(conn, ids, y)).entries()].map(([id, b]) => {
        for (const k of Object.keys(totals) as (keyof Trf)[]) totals[k] += b[k];
        return { clubId: id, clubName: names.get(id) ?? "", members: members.get(id) ?? 0, trf: b, percentOfAgTotal: 0 };
      });
      if (totals.totalInr > 0) for (const row of list) row.percentOfAgTotal = round((row.trf.totalInr / totals.totalInr) * 100, 1);
      return { ag, clubs: list.sort((a, b) => b.trf.totalInr - a.trf.totalInr), totals };
    });
  }

  private static async meetingAttendance(conn: DbCommands, clubId: number, yearId: number) {
    const rows = (
      await conn.query(
        `SELECT
             (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
               WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total,
             (SELECT COUNT(*) FROM club_attendance_members am WHERE am.fk_attendance_id = a.pk_attendance_id) AS present
         FROM club_attendance a
         WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0 AND (@YearId = 0 OR a.fk_year_id = @YearId)`,
        { ClubId: clubId, YearId: yearId },
      )
    ).filter((r) => int(r.total) > 0);
    return rows.length ? round(rows.reduce((s, r) => s + (int(r.present) / int(r.total)) * 100, 0) / rows.length, 1) : 0;
  }

  async getExcellence(memberId: number, yearId: number | null, clubId: number | null, districtId: number | null) {
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const ids = await AgDashboardService.resolveClubIds(conn, memberId, y, clubId, districtId);
      const ag = await AgDashboardService.identity(conn, memberId, y);
      if (!ids.length) {
        return { ag, citation: [], goals: [], monthlyProjects: [], monthlyMeetings: [], monthlyTrf: [], averageCitationScore: 0, topScoringClub: null, awardStatus: [], awardStatusIsPending: false };
      }
      const names = await AgDashboardService.clubNames(conn, ids);
      const members = await AgDashboardService.memberCounts(conn, ids);
      const projects = await this.projectCounts(conn, ids, y);
      const trf = await AgDashboardService.trfBreakdown(conn, ids, y);
      const totals = new Map(
        (
          await conn.query(
            `SELECT fk_club_id AS clubId, COALESCE(SUM(points_earned),0) + COALESCE(SUM(bonus_earned),0) AS pts
             FROM district_citation_club_entry
             WHERE fk_club_id IN @ClubIds AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)
             GROUP BY fk_club_id`,
            { ClubIds: ids, YearId: y },
          )
        ).map((r) => [int(r.clubId), num(r.pts)]),
      );
      const byCategory = new Map<number, Map<string, number>>();
      try {
        // As in RIZones this joins c.pk_category_id, which the category table lacks; the error is swallowed there too.
        for (const r of await conn.query(
          `SELECT e.fk_club_id AS clubId, COALESCE(c.category_name,'Other') AS cat,
                  COALESCE(SUM(e.points_earned),0) + COALESCE(SUM(e.bonus_earned),0) AS pts
           FROM district_citation_club_entry e
           LEFT JOIN district_citation_question q ON q.pk_question_id = e.fk_question_id
           LEFT JOIN district_citation_category c ON c.pk_category_id = q.fk_category_id
           WHERE e.fk_club_id IN @ClubIds AND e.isdeleted = 0 AND (@YearId = 0 OR e.fk_year_id = @YearId)
           GROUP BY e.fk_club_id, COALESCE(c.category_name,'Other')`,
          { ClubIds: ids, YearId: y },
        )) {
          if (!byCategory.has(int(r.clubId))) byCategory.set(int(r.clubId), new Map());
          byCategory.get(int(r.clubId))!.set(String(r.cat), num(r.pts));
        }
      } catch {
        // see above
      }
      const citation = ids
        .map((id) => {
          const cats = byCategory.get(id) ?? new Map<string, number>();
          const find = (key: string) => [...cats.entries()].find(([k]) => k.toLowerCase().includes(key))?.[1] ?? 0;
          return {
            clubId: id, clubName: names.get(id) ?? "", members: members.get(id) ?? 0, total: totals.get(id) ?? 0, membership: find("member"),
            trf: find("trf"), service: find("service"), publicImage: find("public"), youth: find("youth"), foundation: find("foundation"),
          };
        })
        .sort((a, b) => b.total - a.total);
      const myRotary = new Map<number, number>();
      try {
        for (const r of await conn.query(
          `SELECT fk_club_id AS clubId, COALESCE(registration_percentage, 0) AS pct FROM club_myrotary_tracking
           WHERE fk_club_id IN @ClubIds AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)`,
          { ClubIds: ids, YearId: y },
        )) myRotary.set(int(r.clubId), num(r.pct));
      } catch {
        // table missing: all pending
      }
      const goals = [];
      for (const id of ids) {
        const m = members.get(id) ?? 0;
        const newMembers = int(
          await conn.executeScalar(
            `SELECT COUNT(*) FROM club_members WHERE fk_club_id = @ClubId AND isdeleted = 0
               AND JoinedDate >= (SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @YearId)
               AND JoinedDate <= (SELECT EndDate FROM rotary_year_master WHERE pk_year_id = @YearId)`,
            { ClubId: id, YearId: y },
          ),
        );
        goals.push({
          clubId: id, clubName: names.get(id) ?? "", members: m, membershipGrowth: m > 0 && newMembers > 0 ? round((newMembers / m) * 100, 1) : 0,
          trfPerCapita: m > 0 ? Math.round((trf.get(id)?.totalInr ?? 0) / m) : 0, serviceProjects: projects.get(id) ?? 0,
          meetingAttendance: await AgDashboardService.meetingAttendance(conn, id, y), myRotary: myRotary.get(id) ?? 0, newMembers,
          myRotaryIsPending: !myRotary.has(id),
        });
      }
      const { map: awards, tableMissing } = await AgDashboardService.awardStatus(conn, ids, y, names);
      const monthlyProjects = [];
      const monthlyMeetings = [];
      const monthlyTrf = [];
      const { start } = await ClubAdminDashboardService.yearRange(conn, y);
      if (start) {
        const tables = await this.tables(conn, y);
        for (let i = 0; i < 9; i++) {
          const ms = addMonths(start, i);
          const label = `${MONTH_LABELS[i]} ${ms.slice(0, 4)}`;
          const pj: Record<string, number> = {};
          const mt: Record<string, number> = {};
          const tr: Record<string, number> = {};
          for (const id of ids) {
            const name = names.get(id) ?? `Club ${id}`;
            const p = { ClubId: id, Start: ms, End: addMonths(ms, 1) };
            let count = 0;
            for (const t of tables) {
              count += int(await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` p ${PROJECT_AVENUE_ONLY} WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.project_date >= @Start AND p.project_date < @End`, p));
            }
            pj[name] = count;
            mt[name] = int(await conn.executeScalar("SELECT COUNT(*) FROM club_attendance WHERE fk_club_id = @ClubId AND isdeleted = 0 AND EventDateTime >= @Start AND EventDateTime < @End", p));
            tr[name] = num(await conn.executeScalar("SELECT COALESCE(SUM(AmountUSD),0) FROM trf_contributions WHERE fk_club_id = @ClubId AND isdeleted = 0 AND TrfDate >= @Start AND TrfDate < @End", p));
          }
          monthlyProjects.push({ month: label, byClub: pj });
          monthlyMeetings.push({ month: label, byClub: mt });
          monthlyTrf.push({ month: label, byClub: tr });
        }
      }
      return {
        ag, citation, goals, monthlyProjects, monthlyMeetings, monthlyTrf,
        averageCitationScore: citation.length ? Math.round(citation.reduce((s, c) => s + c.total, 0) / citation.length) : 0,
        topScoringClub: citation[0] ?? null, awardStatus: ids.map((id) => awards.get(id)), awardStatusIsPending: tableMissing,
      };
    });
  }

  async getYouth(memberId: number, yearId: number | null, clubId: number | null, districtId: number | null) {
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const ids = await AgDashboardService.resolveClubIds(conn, memberId, y, clubId, districtId);
      const ag = await AgDashboardService.identity(conn, memberId, y);
      if (!ids.length) return { ag, clubs: [], totalNewGeneration: 0, totalVocational: 0, totalInternational: 0, totalProjects: 0 };
      const names = await AgDashboardService.clubNames(conn, ids);
      const members = await AgDashboardService.memberCounts(conn, ids);
      const meetings = await AgDashboardService.meetingCounts(conn, ids, y);
      const add = (m: Map<number, number>, id: number, n: number) => m.set(id, (m.get(id) ?? 0) + n);
      const [newGen, voc, intl, totals] = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
      for (const t of await this.tables(conn, y)) {
        for (const r of await conn.query(
          `SELECT p.fk_club_id AS clubId, COALESCE(md.ModuleName,'') AS modName, COUNT(*) AS cnt
           FROM \`${t.projectsTable}\` p
           LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
           ${PROJECT_AVENUE_ONLY}
           WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
           GROUP BY p.fk_club_id, COALESCE(md.ModuleName,'')`,
          { ClubIds: ids },
        )) {
          const id = int(r.clubId);
          const n = int(r.cnt);
          add(totals, id, n);
          const lower = String(r.modName ?? "").toLowerCase();
          if (lower.includes("new generation") || lower.includes("youth")) add(newGen, id, n);
          else if (lower.includes("vocational")) add(voc, id, n);
          else if (lower.includes("international")) add(intl, id, n);
        }
      }
      const clubs = ids
        .map((id) => ({
          clubId: id, clubName: names.get(id) ?? "", newGenerationService: newGen.get(id) ?? 0, vocationalService: voc.get(id) ?? 0,
          internationalService: intl.get(id) ?? 0, totalProjects: totals.get(id) ?? 0, members: members.get(id) ?? 0, meetings: meetings.get(id) ?? 0,
        }))
        .sort(byName);
      const sum = (k: "newGenerationService" | "vocationalService" | "internationalService" | "totalProjects") => clubs.reduce((s, c) => s + c[k], 0);
      return { ag, clubs, totalNewGeneration: sum("newGenerationService"), totalVocational: sum("vocationalService"), totalInternational: sum("internationalService"), totalProjects: sum("totalProjects") };
    });
  }

  async getProjects(memberId: number, yearId: number | null, clubId: number | null, districtId: number | null) {
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const ids = await AgDashboardService.resolveClubIds(conn, memberId, y, clubId, districtId);
      const ag = await AgDashboardService.identity(conn, memberId, y);
      const base = { ag, projects: [] as ReturnType<typeof row>[], clubProjectCounts: {}, monthlyProjectCounts: {}, categoryCounts: {}, totalProjects: 0, totalBeneficiaries: 0, totalManHours: 0, totalCost: 0, targetCurrency: "" };
      if (!ids.length) return { ...base, targetCurrency: resolveDefaultCurrency(null) };
      const names = await AgDashboardService.clubNames(conn, ids);
      const projects: ReturnType<typeof row>[] = [];
      let anyManHours = false;
      function row(r: Record<string, unknown>, hasManHours: boolean) {
        const cid = int(r.clubId);
        return {
          projectId: int(r.projectId), yearId: int(r.yearId), clubId: cid, clubName: names.get(cid) ?? "", title: str(r.title) ?? "", avenue: str(r.avenue),
          category: str(r.category), areaOfFocus: str(r.areaOfFocus), date: ymd(r.projectDate), cost: num(r.cost), currency: normalizeCurrency(str(r.currency)),
          beneficiaries: int(r.beneficiaries), manHours: int(r.manHours), funding: str(r.funding) ?? "Self Funded", rotarians: int(r.rotarians),
          manHoursIsPending: !hasManHours, approvalStatus: str(r.approvalStatus),
        };
      }
      const query = (table: string, manHours: string) =>
        conn.query(
          `SELECT p.pk_project_id AS projectId, p.fk_year_id AS yearId, p.fk_club_id AS clubId, p.title, p.project_date AS projectDate,
                  COALESCE(md.ModuleName,'') AS avenue, COALESCE(aof.name,'') AS areaOfFocus, COALESCE(cat.name,'') AS category,
                  COALESCE(p.project_cost, 0) AS cost, p.Currency AS currency, COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                  (COALESCE(p.rotarians_involved,0) + COALESCE(p.rotaractors_involved,0)) AS rotarians, ${manHours} AS manHours,
                  COALESCE(f.name,'Self Funded') AS funding, p.approval_status AS approvalStatus
           FROM \`${table}\` p
           LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
           LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           ${PROJECT_AVENUE_ONLY}
           WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
           ORDER BY p.project_date DESC`,
          { ClubIds: ids },
        );
      for (const t of await this.tables(conn, y)) {
        try {
          for (const r of await query(t.projectsTable, "COALESCE(p.man_hours, 0)")) projects.push(row(r, true));
          anyManHours = true;
        } catch {
          // an older year table without man_hours
          for (const r of await query(t.projectsTable, "0")) projects.push(row(r, false));
        }
      }
      const firstClubCurrency = await conn.queryFirstOrDefault(
        "SELECT d.DefaultCurrency FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @ClubId LIMIT 1",
        { ClubId: ids[0] },
      );
      const targetCurrency = resolveDefaultCurrency((firstClubCurrency?.DefaultCurrency as string | null) ?? null);
      const rates = await this.fx.getRates();
      const countBy = (key: (p: (typeof projects)[number]) => string | null) => {
        const out: Record<string, number> = {};
        for (const p of projects) {
          const k = key(p);
          if (k !== null) out[k] = (out[k] ?? 0) + 1;
        }
        return out;
      };
      return {
        ag,
        projects,
        clubProjectCounts: countBy((p) => p.clubName),
        monthlyProjectCounts: countBy((p) => (p.date ? `${p.date.slice(5, 7)}-${p.date.slice(0, 4)}` : null)),
        categoryCounts: countBy((p) => (p.category && p.category.trim() ? p.category : "Uncategorised")),
        totalProjects: projects.length,
        totalBeneficiaries: projects.reduce((s, p) => s + p.beneficiaries, 0),
        totalManHours: anyManHours ? projects.reduce((s, p) => s + p.manHours, 0) : 0,
        totalCost: projects.reduce((s, p) => s + convertCurrency(p.cost, p.currency, targetCurrency, rates), 0),
        targetCurrency,
      };
    });
  }

  async getDistrict(memberId: number, yearId: number | null, clubId: number | null, districtId: number | null) {
    const membership = await this.getMembership(memberId, yearId, clubId, districtId);
    const youth = await this.getYouth(memberId, yearId, clubId, districtId);
    const youthByClub = new Map(youth.clubs.map((c) => [c.clubId, c]));
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const ids = membership.clubs.map((c) => c.clubId);
      const meetings = await AgDashboardService.meetingCounts(conn, ids, y);
      const rows = membership.clubs.map((c) => ({
        clubId: c.clubId, clubName: c.clubName, members: c.members, meetings: meetings.get(c.clubId) ?? 0, clubService: c.clubService,
        totalProjects: c.totalProjects, trfTotalInr: c.trf, ocv: c.ocv, projectRank: c.projectRank,
        vocationalService: youthByClub.get(c.clubId)?.vocationalService ?? 0, internationalService: youthByClub.get(c.clubId)?.internationalService ?? 0,
        newGenerationService: youthByClub.get(c.clubId)?.newGenerationService ?? 0,
      }));
      const citation = new Map<number, number>();
      if (ids.length) {
        try {
          for (const r of await conn.query(
            `SELECT fk_club_id AS clubId, COALESCE(SUM(points_earned),0) + COALESCE(SUM(bonus_earned),0) AS pts FROM district_citation_club_entry
             WHERE fk_club_id IN @ClubIds AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId) GROUP BY fk_club_id`,
            { ClubIds: ids, YearId: y },
          )) citation.set(int(r.clubId), num(r.pts));
        } catch {
          // citation tables may differ
        }
      }
      const { map: awards } = await AgDashboardService.awardStatus(conn, ids, y, new Map(rows.map((r) => [r.clubId, r.clubName])));
      const perClub = <T>(f: (r: (typeof rows)[number]) => T) => Object.fromEntries(rows.map((r) => [r.clubName, f(r)]));
      return {
        ag: membership.ag,
        clubs: rows,
        totalMembers: membership.totalMembers,
        totalMeetings: rows.reduce((s, r) => s + r.meetings, 0),
        totalClubService: rows.reduce((s, r) => s + r.clubService, 0),
        totalProjects: membership.totalProjects,
        totalTrfInr: membership.totalTrfInr,
        headToHeadTable: rows.map((r) => ({
          clubId: r.clubId, clubName: r.clubName, members: r.members, meetings: r.meetings, clubService: r.clubService, totalProjects: r.totalProjects,
          trfInr: r.trfTotalInr, dck: citation.get(r.clubId) ?? 0, nationalRank: null, nationalRankIsPending: true, vocationalService: r.vocationalService,
          internationalService: r.internationalService, newGenerationService: r.newGenerationService,
        })),
        metricBars: {
          membersPerClub: perClub((r) => r.members), projectsPerClub: perClub((r) => r.totalProjects), trfPerClub: perClub((r) => r.trfTotalInr),
          meetingsPerClub: perClub((r) => r.meetings), clubServicePerClub: perClub((r) => r.clubService),
        },
        radar: rows.map((r) => {
          let goalsScore = citation.get(r.clubId) ?? 0;
          const aw = awards.get(r.clubId);
          if (goalsScore === 0 && aw && !aw.isPending) {
            goalsScore = [aw.achieved, aw.presidentialCitation.toLowerCase() === "achieved", aw.districtCitation.toLowerCase() === "achieved", aw.membershipExcellence.toLowerCase() === "achieved"].filter(Boolean).length;
          }
          return { clubId: r.clubId, clubName: r.clubName, members: r.members, projects: r.totalProjects, trfInr: r.trfTotalInr, goalsScore };
        }),
      };
    });
  }
}

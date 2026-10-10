import { Injectable } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { ArgumentException, UnauthorizedAccessException } from "../../common/exceptions";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { RotaryOrgApiClient } from "../../services/rotary-org/rotary-org-api.client";
import { upsertTerminatedCache } from "../../services/rotary-org/rotary-org-sync.services";
import { ClubAdminDashboardService, addMonths, int, ymd } from "./club-admin-dashboard.service";

const MONTH_LABELS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const ROTARY_MONTHS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
const FULL_MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AVENUE_KEYS: [string, string][] = [
  ["community_service", "Community Service"],
  ["vocational_service", "Vocational Service"],
  ["international_service", "International Service"],
  ["public_image_initiative", "Public Image Initiative"],
  ["new_generation_service", "New Generation Service"],
];

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || Number(v) === 1;
const round = (v: number, places = 0) => Math.round(v * 10 ** places) / 10 ** places;
const pct = (part: number, whole: number, places = 1) => (whole === 0 ? 0 : round((part / whole) * 100, places));
/** Swallow errors from optional tables, as the C# try/catch blocks do. */
async function optional<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

interface Identity {
  memberId: number;
  name: string;
  districtId: number;
  districtNumber: string;
  yearLabel: string;
  totalClubs: number;
}
interface Ctx {
  conn: DbCommands;
  districtId: number;
  yearId: number;
  identity: Identity;
}
interface ClubStat {
  clubId: number;
  clubName: string;
  members: number;
  meetings: number;
  projects: number;
  trfInr: number;
}

/**
 * Port of DistrictAdminDashboardService.cs: the District Admin dashboard and
 * the district goal / target editors. Amounts named "...Inr" are USD totals
 * (the C# multiplies by an INR rate of 1); the names are kept for the web app.
 */
@Injectable()
export class DistrictAdminDashboardService {
  constructor(
    private readonly db: Db,
    private readonly yearTables: YearTableResolver,
    private readonly rotaryOrg: RotaryOrgApiClient,
  ) {}

  // ---- shared resolution ----

  private static async resolveDistrictId(conn: DbCommands, memberId: number, requested: number | null): Promise<number> {
    if (memberId <= 0) return 0;
    if (requested && requested > 0) {
      let isAdmin = int(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM member_roles
           WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId
             AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0`,
          { MemberId: memberId, DistrictId: requested },
        ),
      );
      if (isAdmin === 0 && (await ClubAdminDashboardService.canOverrideClubAdmin(conn, memberId, 0))) isAdmin = 1;
      if (isAdmin === 0) throw new UnauthorizedAccessException("You are not an active admin for this district.");
      return requested;
    }
    return int(
      await conn.executeScalar(
        `SELECT fk_district_id FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
           AND fk_district_id IS NOT NULL AND fk_district_id > 0
           AND (fk_club_id IS NULL OR fk_club_id = 0)
           AND IsActive = 1 AND isdeleted = 0
         ORDER BY pk_member_role_id ASC
         LIMIT 1`,
        { MemberId: memberId },
      ),
    );
  }

  async resolveDistrictIdForMember(memberId: number, requested: number | null): Promise<number> {
    return this.db.session((conn) => DistrictAdminDashboardService.resolveDistrictId(conn, memberId, requested));
  }

  private static async identity(conn: DbCommands, memberId: number, districtId: number, yearId: number): Promise<Identity | null> {
    if (districtId === 0) return null;
    const info = await conn.queryFirstOrDefault(
      `SELECT d.DistrictNumber AS districtNumber, m.MemberName AS memberName
       FROM district_master d
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = @MemberId
       WHERE d.pk_district_id = @DistrictId AND d.isdeleted = 0 LIMIT 1`,
      { DistrictId: districtId, MemberId: memberId },
    );
    if (!info) return null;
    return {
      memberId,
      name: str(info.memberName) ?? "",
      districtId,
      districtNumber: str(info.districtNumber) ?? "",
      yearLabel: (await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1", { YearId: yearId })) ?? "",
      totalClubs: int(await conn.executeScalar("SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club'", { DistrictId: districtId })),
    };
  }

  private async context<T>(memberId: number, yearId: number | null, districtId: number | null, work: (ctx: Ctx) => Promise<T>): Promise<T | null> {
    return this.db.session(async (conn) => {
      const d = await DistrictAdminDashboardService.resolveDistrictId(conn, memberId, districtId);
      if (d === 0) return null;
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const identity = await DistrictAdminDashboardService.identity(conn, memberId, d, y);
      if (!identity) return null;
      return work({ conn, districtId: d, yearId: y, identity });
    });
  }

  private async targetTables(conn: DbCommands, yearId: number): Promise<YearTableInfo[]> {
    if (yearId > 0) {
      const t = await this.yearTables.resolveByYearId(conn, yearId);
      return t ? [t] : [];
    }
    return this.yearTables.getAllExistingYearTables(conn);
  }

  private static async avgAttendance(conn: DbCommands, districtId: number, yearId: number, clubId: number | null = null): Promise<number> {
    const rows = await conn.query(
      `SELECT
           (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
             WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total,
           (SELECT COUNT(*) FROM club_attendance_members am WHERE am.fk_attendance_id = a.pk_attendance_id) AS present
       FROM club_attendance a
       JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
       WHERE ${clubId !== null ? "a.fk_club_id = @ClubId" : "c.fk_district_id = @DistrictId"} AND a.isdeleted = 0
         AND (@YearId = 0 OR a.fk_year_id = @YearId)`,
      { DistrictId: districtId, ClubId: clubId, YearId: yearId },
    );
    const list = rows.filter((r) => int(r.total) > 0);
    return list.length ? round(list.reduce((s, r) => s + (int(r.present) / int(r.total)) * 100, 0) / list.length, 1) : 0;
  }

  private static async joinedAndTerminated(conn: DbCommands, districtId: number, start: string | null, end: string | null) {
    if (!start) return { newMembers: 0, terminated: 0 };
    const p = { DistrictId: districtId, Start: start, End: end };
    const base = "FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 WHERE c.fk_district_id = @DistrictId";
    return {
      newMembers: int(await conn.executeScalar(`SELECT COUNT(*) ${base} AND cm.isdeleted = 0 AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End`, p)),
      terminated: int(await conn.executeScalar(`SELECT COUNT(*) ${base} AND cm.isdeleted = 1 AND cm.deleted_date >= @Start AND cm.deleted_date <= @End`, p)),
    };
  }

  private static async donorCounts(conn: DbCommands, districtId: number, yearId: number) {
    const q = (cond: string) =>
      conn.executeScalar(
        `SELECT COUNT(DISTINCT t.DonorName) FROM trf_contributions t
         JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
         WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
           AND (@YearId = 0 OR t.fk_year_id = @YearId) AND ${cond}`,
        { DistrictId: districtId, YearId: yearId },
      );
    return { majorDonors: int(await q("t.AmountUSD >= 1000")), phf: int(await q("t.AmountUSD > 0")) };
  }

  /** Splits totals by fund name: annual / polio / endowment / other. */
  private static async perFundTotals(conn: DbCommands, districtId: number, yearId: number) {
    const rows = await conn.query(
      `SELECT COALESCE(f.FundName, t.OtherFundName, 'Other') AS fundName, COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
       FROM trf_contributions t
       JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
       LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
       WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0 AND (@YearId = 0 OR t.fk_year_id = @YearId)
       GROUP BY COALESCE(f.FundName, t.OtherFundName, 'Other')`,
      { DistrictId: districtId, YearId: yearId },
    );
    const totals = { annual: 0, polio: 0, endow: 0, others: 0 };
    for (const r of rows) {
      const lower = String(r.fundName ?? "").toLowerCase();
      const v = num(r.totalUsd);
      if (lower.includes("annual")) totals.annual += v;
      else if (lower.includes("polio")) totals.polio += v;
      else if (lower.includes("endowment")) totals.endow += v;
      else totals.others += v;
    }
    return totals;
  }

  // ---- panels ----

  private static async membershipGoalPanel(conn: DbCommands, districtId: number, yearId: number, current: number, clubs: ClubStat[]) {
    const target = await optional(
      async () => {
        const v = await conn.executeScalar(
          "SELECT target_total FROM district_membership_goal WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0 LIMIT 1",
          { DistrictId: districtId, YearId: yearId },
        );
        return v === null || v === undefined ? null : int(v);
      },
      null as number | null,
    );
    return {
      current,
      target,
      delta: target !== null ? current - target : 0,
      isPending: target === null,
      topClubs: [...clubs].sort((a, b) => b.members - a.members).slice(0, 10),
    };
  }

  private static async foundationGoalPanel(conn: DbCommands, districtId: number, yearId: number) {
    const row = await optional(
      () =>
        conn.queryFirstOrDefault(
          `SELECT target_annual_fund_usd AS a, target_polio_fund_usd AS p, target_endowment_fund_usd AS e, target_other_fund_usd AS o
           FROM district_foundation_goal
           WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0 LIMIT 1`,
          { DistrictId: districtId, YearId: yearId },
        ),
      null,
    );
    if (!row) return { totalTargetInr: null, annualTargetInr: null, polioTargetInr: null, endowmentTargetInr: null, othersTargetInr: null, isPending: true };
    const v = (x: unknown) => (x === null || x === undefined ? null : Number(x));
    const [a, p, e, o] = [v(row.a), v(row.p), v(row.e), v(row.o)];
    const total = (a ?? 0) + (p ?? 0) + (e ?? 0) + (o ?? 0);
    return { totalTargetInr: total === 0 ? null : total, annualTargetInr: a, polioTargetInr: p, endowmentTargetInr: e, othersTargetInr: o, isPending: false };
  }

  private async serviceProjectsPanel(conn: DbCommands, districtId: number, yearId: number, totalProjects: number) {
    const counts = new Map<string, number>();
    for (const t of await this.targetTables(conn, yearId)) {
      for (const r of await conn.query(
        `SELECT md.ModuleKey AS k, COUNT(*) AS cnt
         FROM \`${t.projectsTable}\` p
         JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
         LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
         WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
         GROUP BY md.ModuleKey`,
        { DistrictId: districtId },
      )) counts.set(str(r.k) ?? "", (counts.get(str(r.k) ?? "") ?? 0) + int(r.cnt));
    }
    const targets = await DistrictAdminDashboardService.projectTargetMap(conn, districtId, yearId);
    return {
      totalProjects,
      clubServicesCount: counts.get("club_service") ?? 0,
      totalTarget: targets.size ? [...targets.values()].reduce((s, v) => s + v.target, 0) : null,
      isPending: targets.size === 0,
      avenues: AVENUE_KEYS.map(([key, label]) => {
        const completed = counts.get(key) ?? 0;
        const target = targets.get(key)?.target ?? null;
        return { avenueKey: key, avenueName: label, completed, target, percentAchieved: target ? pct(completed, target) : 0, isPending: target === null };
      }),
    };
  }

  private static async projectTargetMap(conn: DbCommands, districtId: number, yearId: number) {
    const map = new Map<string, { target: number; name: string | null }>();
    await optional(async () => {
      for (const r of await conn.query(
        `SELECT md.ModuleKey AS k, md.ModuleName AS n, t.target_count AS target
         FROM district_project_target t
         JOIN module_master md ON md.pk_module_id = t.fk_module_id
         WHERE t.fk_district_id = @DistrictId AND t.fk_year_id = @YearId AND t.isdeleted = 0`,
        { DistrictId: districtId, YearId: yearId },
      )) if (r.k) map.set(String(r.k), { target: int(r.target), name: str(r.n) });
    }, undefined);
    return map;
  }

  /** Citation points per category (auto questions plus manual criteria) with complete / partial / incomplete club buckets. */
  private static async citationPanel(conn: DbCommands, districtId: number, yearId: number, totalClubs: number) {
    let totalPoints = 0;
    let qualifiedClubs = 0;
    const categories: {
      categoryId: number; categoryName: string; pointsEarned: number; qualifiedClubs: number; maxPoints: number;
      completeClubs: number; partialClubs: number; incompleteClubs: number; status: string;
    }[] = [];
    const p = { DistrictId: districtId, YearId: yearId };
    await optional(async () => {
      for (const r of await conn.query(
        `SELECT c.pk_id AS catId, c.category_name AS catName, COALESCE(qmax.max_points, 0) AS maxPoints, COALESCE(ep.points_earned, 0) AS points
         FROM district_citation_category c
         LEFT JOIN (
             SELECT q.fk_category_id AS catId, SUM(COALESCE(q.points, 0) + COALESCE(q.bonus_points, 0)) AS max_points
             FROM district_citation_auto_question q
             WHERE q.fk_district_id = @DistrictId AND q.isdeleted = 0 AND (@YearId = 0 OR q.fk_year_id = @YearId)
             GROUP BY q.fk_category_id
         ) qmax ON qmax.catId = c.pk_id
         LEFT JOIN (
             SELECT catId, SUM(points_earned) AS points_earned FROM (
                 SELECT q.fk_category_id AS catId, (e.points_earned + e.bonus_earned) AS points_earned
                 FROM district_citation_club_entry e
                 INNER JOIN district_citation_auto_question q
                     ON q.pk_id = e.fk_question_id AND q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0
                 WHERE e.fk_district_id = @DistrictId AND e.fk_year_id = @YearId AND e.entry_type = 'auto' AND e.isdeleted = 0
                 UNION ALL
                 SELECT mc.fk_category_id AS catId, (e.points_earned + e.bonus_earned) AS points_earned
                 FROM district_citation_club_entry e
                 INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
                 INNER JOIN district_citation_manual_criteria mc
                     ON mc.pk_id = sc.fk_criteria_id AND mc.fk_district_id = @DistrictId AND mc.fk_year_id = @YearId AND mc.isdeleted = 0
                 WHERE e.fk_district_id = @DistrictId AND e.fk_year_id = @YearId AND e.entry_type = 'manual' AND e.isdeleted = 0
             ) t
             GROUP BY catId
         ) ep ON ep.catId = c.pk_id
         WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND (@YearId = 0 OR c.fk_year_id = @YearId)
         ORDER BY c.sort_order, c.category_name`,
        p,
      )) {
        totalPoints += num(r.points);
        categories.push({
          categoryId: int(r.catId), categoryName: str(r.catName) ?? "", pointsEarned: Math.round(num(r.points)), qualifiedClubs: 0,
          maxPoints: Math.round(num(r.maxPoints)), completeClubs: 0, partialClubs: 0, incompleteClubs: 0, status: "",
        });
      }
      await optional(async () => {
        const perClub = new Map<number, Map<number, number>>();
        for (const r of await conn.query(
          `SELECT COALESCE(q.fk_category_id, 0) AS catId, e.fk_club_id AS clubId,
                  COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0) AS earned
           FROM district_citation_club_entry e
           JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
           JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
           WHERE e.fk_district_id = @DistrictId AND e.isdeleted = 0 AND c.fk_district_id = @DistrictId
             AND (@YearId = 0 OR e.fk_year_id = @YearId)
           GROUP BY q.fk_category_id, e.fk_club_id`,
          p,
        )) {
          if (!perClub.has(int(r.catId))) perClub.set(int(r.catId), new Map());
          perClub.get(int(r.catId))!.set(int(r.clubId), num(r.earned));
        }
        for (const cat of categories) {
          if (cat.categoryId <= 0) continue;
          let complete = 0;
          let partial = 0;
          const clubs = perClub.get(cat.categoryId);
          if (clubs && cat.maxPoints > 0) {
            for (const earned of clubs.values()) {
              const share = (earned / cat.maxPoints) * 100;
              if (share >= 90) complete++;
              else if (share > 0) partial++;
            }
          }
          const incomplete = Math.max(0, totalClubs - complete - partial);
          Object.assign(cat, {
            completeClubs: complete, partialClubs: partial, incompleteClubs: incomplete,
            status: complete > partial + incomplete ? "complete" : partial + complete > incomplete ? "partial" : "incomplete",
          });
        }
      }, undefined);
      qualifiedClubs = int(
        await conn.executeScalar(
          `SELECT COUNT(DISTINCT e.fk_club_id) FROM district_citation_club_entry e
           JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
           WHERE e.fk_district_id = @DistrictId AND c.fk_district_id = @DistrictId AND e.isdeleted = 0
             AND (@YearId = 0 OR e.fk_year_id = @YearId) AND (e.points_earned > 0 OR e.bonus_earned > 0)`,
          p,
        ),
      );
    }, undefined);
    return { totalPoints: Math.round(totalPoints), qualifiedClubs, categories };
  }

  private static async clubLeaderboard(conn: DbCommands, districtId: number, yearId: number, stats: ClubStat[]) {
    const citation = new Map<number, number>();
    await optional(async () => {
      for (const r of await conn.query(
        `SELECT clubId, SUM(score) AS score FROM (
             SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
             FROM district_citation_club_entry e
             INNER JOIN district_citation_auto_question q
                 ON q.pk_id = e.fk_question_id AND q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0
             WHERE e.fk_district_id = @DistrictId AND e.fk_year_id = @YearId AND e.entry_type = 'auto' AND e.isdeleted = 0
             UNION ALL
             SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
             FROM district_citation_club_entry e
             INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
             INNER JOIN district_citation_manual_criteria mc
                 ON mc.pk_id = sc.fk_criteria_id AND mc.fk_district_id = @DistrictId AND mc.fk_year_id = @YearId AND mc.isdeleted = 0
             WHERE e.fk_district_id = @DistrictId AND e.fk_year_id = @YearId AND e.entry_type = 'manual' AND e.isdeleted = 0
         ) t
         GROUP BY clubId`,
        { DistrictId: districtId, YearId: yearId },
      )) citation.set(int(r.clubId), num(r.score));
    }, undefined);
    const list = stats
      .map((c) => {
        const score = Math.round(citation.get(c.clubId) ?? 0);
        return { rank: 0, clubId: c.clubId, clubName: c.clubName, members: c.members, trfInr: c.trfInr, projects: c.projects, citationScore: score, score, percentile: 0 };
      })
      .sort((a, b) => b.score - a.score || a.clubName.localeCompare(b.clubName));
    const max = list.reduce((m, r) => Math.max(m, r.score), 0);
    list.forEach((r, i) => {
      r.rank = i + 1;
      r.percentile = max > 0 ? Math.round((r.score / max) * 100) : 0;
    });
    return list;
  }

  private static async membershipTabCounts(conn: DbCommands, districtId: number, yearId: number) {
    const p = { DistrictId: districtId, YearId: yearId };
    const scalar = (sql: string) => conn.executeScalar(sql, p).then(int);
    const totalClubs = await scalar("SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club'");
    const bodTotal = await scalar(
      `SELECT COUNT(*) FROM board_of_directors b JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
       WHERE c.fk_district_id = @DistrictId AND b.isdeleted = 0 AND (@YearId = 0 OR b.fk_year_id = @YearId)`,
    );
    const bodClubs = await scalar(
      `SELECT COUNT(DISTINCT b.fk_club_id) FROM board_of_directors b JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
       WHERE c.fk_district_id = @DistrictId AND b.isdeleted = 0 AND (@YearId = 0 OR b.fk_year_id = @YearId)`,
    );
    const [dcTotal, dcActive] = await optional(
      async () => [
        await scalar("SELECT COUNT(*) FROM district_committee_member WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)"),
        await scalar("SELECT COUNT(*) FROM district_committee_member WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND is_active = 1 AND (@YearId = 0 OR fk_year_id = @YearId)"),
      ],
      [0, 0],
    );
    const [agTotal, agClubs] = await optional(
      async () => [
        await scalar("SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)"),
        await scalar("SELECT COUNT(DISTINCT fk_club_id) FROM district_ag WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND is_active = 1 AND (@YearId = 0 OR fk_year_id = @YearId)"),
      ],
      [0, 0],
    );
    const [modTotal, modActive] = await optional(
      async () => [
        await scalar("SELECT COUNT(*) FROM district_club_moderator WHERE fk_district_id = @DistrictId AND isdeleted = 0"),
        await scalar("SELECT COUNT(*) FROM district_club_moderator WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND is_active = 1"),
      ],
      [0, 0],
    );
    const activeClubs = await scalar("SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club'");
    const tab = (tabKey: string, tabLabel: string, total: number, active: number, base: number) => ({ tabKey, tabLabel, total, active, participationPercent: pct(active, base) });
    return [
      tab("directors", "Directors", bodTotal, bodClubs, totalClubs),
      tab("district_committee", "District Committee", dcTotal, dcActive, dcTotal),
      tab("ag", "Assistant Governors", agTotal, agClubs, totalClubs),
      tab("club_moderator", "Club Moderators", modTotal, modActive, totalClubs),
      tab("clubs", "Clubs", totalClubs, activeClubs, totalClubs),
    ];
  }

  private async districtProjectTargets(conn: DbCommands, districtId: number, yearId: number) {
    const completed = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const t of await this.targetTables(conn, yearId)) {
      for (const r of await conn.query(
        `SELECT md.ModuleKey AS k, md.ModuleName AS n, COUNT(*) AS cnt
         FROM \`${t.projectsTable}\` p
         JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
         LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
         WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
         GROUP BY md.ModuleKey, md.ModuleName`,
        { DistrictId: districtId },
      )) {
        if (!r.k) continue;
        completed.set(String(r.k), (completed.get(String(r.k)) ?? 0) + int(r.cnt));
        if (!labels.has(String(r.k))) labels.set(String(r.k), str(r.n) ?? String(r.k));
      }
    }
    const targets = await DistrictAdminDashboardService.projectTargetMap(conn, districtId, yearId);
    for (const [k, v] of targets) if (!labels.has(k)) labels.set(k, v.name ?? k);
    return AVENUE_KEYS.map(([key, label]) => {
      const done = completed.get(key) ?? 0;
      const target = targets.get(key)?.target ?? null;
      return { typeKey: key, typeLabel: labels.get(key) ?? label, target, completed: done, percentAchieved: target ? pct(done, target) : 0, isPending: target === null };
    });
  }

  private static async districtEvents(conn: DbCommands, districtId: number, limit: number) {
    return (
      await conn.query(
        `SELECT e.pk_upcoming_event_id AS id, e.Title AS title, e.Description AS description, e.EventDate AS eventDate,
                e.EventVenue AS venue, c.ClubName AS clubName,
                CASE WHEN e.EventDate >= CURDATE() THEN 'Upcoming' ELSE 'Past' END AS status
         FROM upcoming_events e
         JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
         WHERE c.fk_district_id = @DistrictId AND e.isdeleted = 0
         ORDER BY e.EventDate DESC
         LIMIT @Limit`,
        { DistrictId: districtId, Limit: limit },
      )
    ).map((r) => ({
      id: int(r.id), title: str(r.title) ?? "", description: str(r.description), eventDate: ymd(r.eventDate), venue: str(r.venue), status: str(r.status) ?? "",
      clubName: str(r.clubName),
    }));
  }

  private async projectFrequency(conn: DbCommands, districtId: number, yearId: number) {
    const result: { clubId: number; clubName: string; category: string; completed: number }[] = [];
    for (const t of await this.targetTables(conn, yearId)) {
      for (const r of await conn.query(
        `SELECT p.fk_club_id AS clubId, c.ClubName AS clubName, COALESCE(md.ModuleName, 'Other') AS moduleName, COUNT(*) AS cnt
         FROM \`${t.projectsTable}\` p
         JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
         LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
         WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
         GROUP BY p.fk_club_id, c.ClubName, COALESCE(md.ModuleName, 'Other')`,
        { DistrictId: districtId },
      )) result.push({ clubId: int(r.clubId), clubName: str(r.clubName) ?? "", category: str(r.moduleName) ?? "Other", completed: int(r.cnt) });
    }
    return result.sort((a, b) => a.clubName.localeCompare(b.clubName) || a.category.localeCompare(b.category));
  }

  private async allProjects(conn: DbCommands, districtId: number, yearId: number, limit: number) {
    const result: { projectId: number; clubId: number; clubName: string; title: string; projectDate: string | null; beneficiaries: number; funds: number; manHours: number; avenueName: string | null; areaOfFocus: string | null; status: string }[] = [];
    for (const t of await this.targetTables(conn, yearId)) {
      for (const r of await conn.query(
        `SELECT p.pk_project_id AS projectId, p.fk_club_id AS clubId, c.ClubName AS clubName, p.title AS title, p.project_date AS pdate,
                COALESCE(p.direct_beneficiaries, 0) AS bens, COALESCE(p.project_cost, 0) AS funds, COALESCE(p.man_hours, 0) AS mh,
                md.ModuleName AS avenue, af.name AS aof, COALESCE(p.approval_status, '') AS status
         FROM \`${t.projectsTable}\` p
         JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
         LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
         LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
         WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
         ORDER BY p.project_date DESC
         LIMIT @Limit`,
        { DistrictId: districtId, Limit: limit },
      )) {
        result.push({
          projectId: int(r.projectId), clubId: int(r.clubId), clubName: str(r.clubName) ?? "", title: str(r.title) ?? "", projectDate: ymd(r.pdate),
          beneficiaries: int(r.bens), funds: num(r.funds), manHours: int(r.mh), avenueName: str(r.avenue), areaOfFocus: str(r.aof), status: str(r.status) ?? "",
        });
      }
    }
    return result.sort((a, b) => (b.projectDate ?? "").localeCompare(a.projectDate ?? "")).slice(0, limit);
  }

  /** Birthdays and anniversaries in the next two weeks, bucketed today / this week / next week. */
  private static async greetings(conn: DbCommands, districtId: number) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = 86_400_000;
    const weekEnd = today.getTime() + 7 * day;
    const nextWeekEnd = today.getTime() + 14 * day;
    const rows = await conn.query(
      `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name, m.ProfilePhotoPath AS photo,
              DATE_FORMAT(m.BirthDate, '%m-%d') AS birth, DATE_FORMAT(m.AnniversaryDate, '%m-%d') AS anniv, c.ClubName AS clubName
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       WHERE c.fk_district_id = @DistrictId AND m.isdeleted = 0
         AND (m.BirthDate IS NOT NULL OR m.AnniversaryDate IS NOT NULL)`,
      { DistrictId: districtId },
    );
    const next = (md: unknown): Date | null => {
      if (!md) return null;
      const [m, d] = String(md).split("-").map(Number);
      const year = today.getUTCFullYear();
      const clamp = (y: number) => Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());
      let occ = new Date(Date.UTC(year, m - 1, clamp(year)));
      if (occ < today) occ = new Date(Date.UTC(year + 1, m - 1, clamp(year + 1)));
      return occ;
    };
    const bucket = (t: number) => (t === today.getTime() ? "today" : t < weekEnd ? "this_week" : t < nextWeekEnd ? "next_week" : "");
    const items: { memberId: number; name: string; photoPath: string | null; clubName: string | null; kind: string; date: string; bucket: string }[] = [];
    for (const r of rows) {
      for (const [kind, md] of [["birthday", r.birth], ["anniversary", r.anniv]] as const) {
        const occ = next(md);
        if (!occ || occ.getTime() >= nextWeekEnd) continue;
        const b = bucket(occ.getTime());
        if (b) items.push({ memberId: int(r.memberId), name: str(r.name) ?? "", photoPath: str(r.photo), clubName: str(r.clubName), kind, date: occ.toISOString().slice(0, 10), bucket: b });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  private static async cmrPerClubGrid(conn: DbCommands, districtId: number, yearId: number) {
    const clubs = await conn.query("SELECT pk_club_id AS clubId, ClubName AS clubName FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club' ORDER BY ClubName", { DistrictId: districtId });
    const reports = await conn.query(
      `SELECT r.fk_club_id AS clubId, r.ReportMonth AS month, COALESCE(r.IsUploadedToDistrict, 0) AS uploaded, r.uploaded_to_district_date AS uploadedDate
       FROM club_monthly_reports r
       JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0
       WHERE c.fk_district_id = @DistrictId AND r.isdeleted = 0 AND (@YearId = 0 OR r.fk_year_id = @YearId)`,
      { DistrictId: districtId, YearId: yearId },
    );
    return clubs.map((c) => {
      let submitted = 0;
      let pending = 0;
      const months = ROTARY_MONTHS.map((cm, i) => {
        const rep = reports.find((r) => int(r.clubId) === int(c.clubId) && int(r.month) === cm);
        if (!rep) return { month: i + 1, status: "not_started", submittedDate: null };
        if (int(rep.uploaded) === 1) {
          submitted++;
          return { month: i + 1, status: "submitted", submittedDate: ymd(rep.uploadedDate) };
        }
        pending++;
        return { month: i + 1, status: "pending", submittedDate: null };
      });
      return { clubId: int(c.clubId), clubName: str(c.clubName) ?? "", submitted, pending, months };
    });
  }

  private static async citationPerClub(conn: DbCommands, districtId: number, yearId: number) {
    return optional(
      async () =>
        (
          await conn.query(
            `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                    CAST(ROUND(COALESCE(SUM(e.points_earned), 0)) AS SIGNED) AS pointsEarned,
                    CAST(ROUND(COALESCE(SUM(e.bonus_earned), 0)) AS SIGNED) AS bonusEarned,
                    CAST(ROUND(COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0)) AS SIGNED) AS totalScore,
                    CASE WHEN COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0) > 0 THEN 1 ELSE 0 END AS qualified
             FROM club_master c
             LEFT JOIN district_citation_club_entry e ON e.fk_club_id = c.pk_club_id AND e.isdeleted = 0 AND (@YearId = 0 OR e.fk_year_id = @YearId)
             WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
             GROUP BY c.pk_club_id, c.ClubName
             ORDER BY totalScore DESC, c.ClubName`,
            { DistrictId: districtId, YearId: yearId },
          )
        ).map((r) => ({
          clubId: int(r.clubId), clubName: str(r.clubName) ?? "", pointsEarned: int(r.pointsEarned), bonusEarned: int(r.bonusEarned),
          // totalPoints: the alias the e-governance screen reads (same value as totalScore).
          totalScore: int(r.totalScore), totalPoints: int(r.totalScore), qualified: bool(r.qualified),
        })),
      [] as { clubId: number; clubName: string; pointsEarned: number; bonusEarned: number; totalScore: number; totalPoints: number; qualified: boolean }[],
    );
  }

  // ---- tabs ----

  async getOverview(memberId: number, yearId: number | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, yearId, identity }) => {
      const base = {
        district: identity, totalClubs: 0, activeClubs: 0, totalMembers: 0, newMembersThisYear: 0, terminatedThisYear: 0, totalProjects: 0, totalMeetings: 0,
        avgAttendance: 0, trfTotalInr: 0, districtCitationScore: 0, announcements: 0, newsletters: 0, upcomingEvents: 0,
        topClubsByMembers: [] as ClubStat[], topClubsByTrf: [] as ClubStat[], topClubsByProjects: [] as ClubStat[], qualifiedCitationClubs: 0,
        membershipGoal: { current: 0, target: null as number | null, delta: 0, isPending: false, topClubs: [] as ClubStat[] },
        trfGoal: {
          totalTargetInr: null as number | null, raisedInr: 0, remainingInr: 0, percentAchieved: 0, isPending: false, annualFundInr: 0, polioFundInr: 0,
          endowmentInr: 0, othersInr: 0, annualTargetInr: null as number | null, polioTargetInr: null as number | null, endowmentTargetInr: null as number | null,
          othersTargetInr: null as number | null,
        },
        serviceProjects: { totalProjects: 0, clubServicesCount: 0, totalTarget: null as number | null, isPending: false, avenues: [] as unknown[] },
        citation: { totalPoints: 0, qualifiedClubs: 0, categories: [] as unknown[] },
        top20ClubsByMembers: [] as ClubStat[], clubLeaderboard: [] as unknown[], maleMembers: 0, femaleMembers: 0, honoraryMembers: 0, inactiveMembers: 0,
        phfMembers: 0, majorDonors: 0, fundTypeBreakdown: [] as unknown[],
      };
      const clubIds = (await conn.query("SELECT pk_club_id FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club'", { DistrictId: districtId })).map((r) => int(r.pk_club_id));
      if (!clubIds.length) return base;
      const p = { DistrictId: districtId, YearId: yearId };
      const scalar = (sql: string) => conn.executeScalar(sql, p).then(num);
      const activeClubs = await scalar("SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club'");
      const totalMembers = await scalar(
        `SELECT COUNT(*) FROM club_members cm
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND cm.IsHonoraryMember = 0`,
      );
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const { newMembers, terminated } = await DistrictAdminDashboardService.joinedAndTerminated(conn, districtId, start, end);
      const totalMeetings = await scalar(
        `SELECT COUNT(*) FROM club_attendance a JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
         WHERE c.fk_district_id = @DistrictId AND a.isdeleted = 0 AND (@YearId = 0 OR a.fk_year_id = @YearId)`,
      );
      let totalProjects = 0;
      const perClubProjects = new Map<number, number>();
      for (const t of await this.targetTables(conn, yearId)) {
        for (const r of await conn.query(
          `SELECT p.fk_club_id AS clubId, COUNT(*) AS cnt
           FROM \`${t.projectsTable}\` p
           JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
           LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
           WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0 AND IFNULL(md.ModuleKey, '') <> 'club_service'
           GROUP BY p.fk_club_id`,
          p,
        )) {
          totalProjects += int(r.cnt);
          perClubProjects.set(int(r.clubId), (perClubProjects.get(int(r.clubId)) ?? 0) + int(r.cnt));
        }
      }
      const trfTotal = await scalar(
        `SELECT COALESCE(SUM(t.AmountUSD), 0) FROM trf_contributions t JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
         WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0 AND (@YearId = 0 OR t.fk_year_id = @YearId)`,
      );
      const citation = await scalar(
        `SELECT COALESCE(SUM(points_earned), 0) + COALESCE(SUM(bonus_earned), 0) FROM district_citation_club_entry
         WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)`,
      );
      const announcements = await scalar(
        "SELECT COUNT(*) FROM announcements a JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0 WHERE c.fk_district_id = @DistrictId AND a.isdeleted = 0",
      );
      const newsletters = await scalar(
        `SELECT COUNT(*) FROM newsletters n JOIN club_master c ON c.pk_club_id = n.fk_club_id AND COALESCE(c.isdeleted, 0) = 0
         WHERE c.fk_district_id = @DistrictId AND COALESCE(n.isdeleted, 0) = 0`,
      );
      const upcomingEvents = await scalar(
        `SELECT COUNT(*) FROM upcoming_events e JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
         WHERE c.fk_district_id = @DistrictId AND e.isdeleted = 0 AND e.EventDate >= CURDATE()`,
      );
      const perClubTrf = new Map(
        (
          await conn.query(
            `SELECT t.fk_club_id AS clubId, COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
             FROM trf_contributions t JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
             WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0 AND (@YearId = 0 OR t.fk_year_id = @YearId)
             GROUP BY t.fk_club_id`,
            p,
          )
        ).map((r) => [int(r.clubId), num(r.totalUsd)]),
      );
      const stats: ClubStat[] = (
        await conn.query(
          `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                  (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND cm.IsHonoraryMember = 0) AS members,
                  (SELECT COUNT(*) FROM club_attendance a WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0 AND (@YearId = 0 OR a.fk_year_id = @YearId)) AS meetings
           FROM club_master c
           WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'`,
          p,
        )
      ).map((c) => ({
        clubId: int(c.clubId), clubName: str(c.clubName) ?? "", members: int(c.members), meetings: int(c.meetings),
        projects: perClubProjects.get(int(c.clubId)) ?? 0, trfInr: perClubTrf.get(int(c.clubId)) ?? 0,
      }));
      const funds = await DistrictAdminDashboardService.perFundTotals(conn, districtId, yearId);
      const goal = await DistrictAdminDashboardService.foundationGoalPanel(conn, districtId, yearId);
      const citationPanel = await DistrictAdminDashboardService.citationPanel(conn, districtId, yearId, clubIds.length);
      const breakdown = await conn.queryFirstOrDefault(
        `SELECT SUM(CASE WHEN cm.IsActive = 1 AND m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                SUM(CASE WHEN cm.IsActive = 1 AND m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                SUM(CASE WHEN cm.IsActive = 1 AND cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary,
                SUM(CASE WHEN cm.IsActive = 0 THEN 1 ELSE 0 END) AS inactive
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
         WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 0`,
        p,
      );
      const donors = await DistrictAdminDashboardService.donorCounts(conn, districtId, yearId);
      const fundBreakdown = (
        await conn.query(
          `SELECT f.FundName AS fundName, COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
           FROM trf_fund_master f
           LEFT JOIN trf_contributions t
                  ON t.fk_fund_id = f.pk_fund_id AND t.isdeleted = 0 AND (@YearId = 0 OR t.fk_year_id = @YearId)
                 AND EXISTS (SELECT 1 FROM club_master c WHERE c.pk_club_id = t.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0)
           WHERE f.IsActive = 1 AND f.isdeleted = 0
           GROUP BY f.pk_fund_id, f.FundName, f.SortOrder
           ORDER BY CASE f.FundName
                        WHEN 'Annual (Unrestricted)' THEN 1 WHEN 'Polio' THEN 2 WHEN 'Endowment' THEN 3
                        WHEN 'Global Grant (Restricted)' THEN 4 WHEN 'Others' THEN 5 ELSE 100 END,
                    f.SortOrder, f.FundName`,
          p,
        )
      ).map((r) => ({ fundName: r.fundName && String(r.fundName).trim() ? String(r.fundName) : "Others", amountInr: Math.round(num(r.totalUsd)) }));
      const by = (key: keyof ClubStat) => [...stats].sort((a, b) => (b[key] as number) - (a[key] as number));
      return {
        ...base,
        totalClubs: clubIds.length,
        activeClubs,
        totalMembers,
        newMembersThisYear: newMembers,
        terminatedThisYear: terminated,
        totalProjects,
        totalMeetings,
        avgAttendance: await DistrictAdminDashboardService.avgAttendance(conn, districtId, yearId),
        trfTotalInr: trfTotal,
        districtCitationScore: citation,
        announcements,
        newsletters,
        upcomingEvents,
        topClubsByMembers: by("members").slice(0, 5),
        topClubsByTrf: by("trfInr").slice(0, 5),
        topClubsByProjects: by("projects").slice(0, 5),
        qualifiedCitationClubs: citationPanel.qualifiedClubs,
        membershipGoal: await DistrictAdminDashboardService.membershipGoalPanel(conn, districtId, yearId, totalMembers, stats),
        trfGoal: {
          totalTargetInr: goal.totalTargetInr,
          raisedInr: trfTotal,
          remainingInr: Math.max(0, (goal.totalTargetInr ?? 0) - trfTotal),
          percentAchieved: goal.totalTargetInr ? pct(trfTotal, goal.totalTargetInr) : 0,
          isPending: goal.isPending,
          annualFundInr: funds.annual,
          polioFundInr: funds.polio,
          endowmentInr: funds.endow,
          othersInr: funds.others,
          annualTargetInr: goal.annualTargetInr,
          polioTargetInr: goal.polioTargetInr,
          endowmentTargetInr: goal.endowmentTargetInr,
          othersTargetInr: goal.othersTargetInr,
        },
        serviceProjects: await this.serviceProjectsPanel(conn, districtId, yearId, totalProjects),
        citation: citationPanel,
        top20ClubsByMembers: by("members").slice(0, 20),
        clubLeaderboard: await DistrictAdminDashboardService.clubLeaderboard(conn, districtId, yearId, stats),
        maleMembers: int(breakdown?.male),
        femaleMembers: int(breakdown?.female),
        honoraryMembers: int(breakdown?.honorary),
        inactiveMembers: int(breakdown?.inactive),
        phfMembers: donors.phf,
        majorDonors: donors.majorDonors,
        fundTypeBreakdown: fundBreakdown,
      };
    });
  }

  async getMembership(memberId: number, yearId: number | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, yearId, identity }) => {
      const p = { DistrictId: districtId };
      const memberJoin = `FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0`;
      const stats = await conn.queryFirstOrDefault(
        `SELECT SUM(CASE WHEN cm.IsHonoraryMember = 0 THEN 1 ELSE 0 END) AS total,
                SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
         ${memberJoin}
         WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0`,
        p,
      );
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const { newMembers, terminated } = await DistrictAdminDashboardService.joinedAndTerminated(conn, districtId, start, end);
      const clubBreakdown: ClubStat[] = (
        await conn.query(
          `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                  (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND cm.IsHonoraryMember = 0) AS members
           FROM club_master c
           WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
           ORDER BY members DESC`,
          p,
        )
      ).map((r) => ({ clubId: int(r.clubId), clubName: str(r.clubName) ?? "", members: int(r.members), meetings: 0, projects: 0, trfInr: 0 }));
      const age = await conn.queryFirstOrDefault(
        `SELECT
             SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 18 AND 30 THEN 1 ELSE 0 END) AS g18_30,
             SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 31 AND 45 THEN 1 ELSE 0 END) AS g31_45,
             SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 46 AND 60 THEN 1 ELSE 0 END) AS g46_60,
             SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) > 60 THEN 1 ELSE 0 END) AS g60_plus
         ${memberJoin}
         WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0`,
        p,
      );
      const ageGroups = age
        ? [
            { label: "18-30", count: int(age.g18_30) },
            { label: "31-45", count: int(age.g31_45) },
            { label: "46-60", count: int(age.g46_60) },
            { label: "60+", count: int(age.g60_plus) },
          ]
        : [];
      const trend = [];
      if (start) {
        for (let i = 0; i < 9; i++) {
          const ms = addMonths(start, i);
          const g = await conn.queryFirstOrDefault(
            `SELECT SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                    SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                    SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
             ${memberJoin}
             WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 0 AND cm.JoinedDate >= @Start AND cm.JoinedDate < @End`,
            { DistrictId: districtId, Start: ms, End: addMonths(ms, 1) },
          );
          trend.push({ month: `${MONTH_LABELS[i]} ${ms.slice(0, 4)}`, male: int(g?.male), female: int(g?.female), honorary: int(g?.honorary) });
        }
      }
      const total = int(stats?.total);
      return {
        district: identity,
        totalMembers: total,
        maleMembers: int(stats?.male),
        femaleMembers: int(stats?.female),
        honoraryMembers: int(stats?.honorary),
        newMembersThisYear: newMembers,
        terminatedThisYear: terminated,
        clubBreakdown,
        ageGroups,
        monthlyTrend: trend,
        activeMembers: total,
        membershipGoal: await DistrictAdminDashboardService.membershipGoalPanel(conn, districtId, yearId, total, clubBreakdown),
        tabCounts: await DistrictAdminDashboardService.membershipTabCounts(conn, districtId, yearId),
      };
    });
  }

  async getFoundation(memberId: number, yearId: number | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, yearId, identity }) => {
      const rows = await conn.query(
        `SELECT t.fk_club_id AS clubId, c.ClubName AS clubName, COALESCE(f.FundName, t.OtherFundName, 'Other') AS fundName,
                COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
         FROM trf_contributions t
         JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
         LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
         WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0 AND (@YearId = 0 OR t.fk_year_id = @YearId)
         GROUP BY t.fk_club_id, c.ClubName, COALESCE(f.FundName, t.OtherFundName, 'Other')`,
        { DistrictId: districtId, YearId: yearId },
      );
      const clubs = new Map<number, { clubId: number; clubName: string; annualFund: number; polioFund: number; endowment: number; others: number; total: number }>();
      const totals = { annual: 0, polio: 0, endow: 0, others: 0, all: 0 };
      for (const r of rows) {
        const id = int(r.clubId);
        if (!clubs.has(id)) clubs.set(id, { clubId: id, clubName: str(r.clubName) ?? "", annualFund: 0, polioFund: 0, endowment: 0, others: 0, total: 0 });
        const row = clubs.get(id)!;
        const v = num(r.totalUsd);
        const lower = String(r.fundName ?? "").toLowerCase();
        if (lower.includes("annual")) (row.annualFund += v), (totals.annual += v);
        else if (lower.includes("polio")) (row.polioFund += v), (totals.polio += v);
        else if (lower.includes("endowment")) (row.endowment += v), (totals.endow += v);
        else (row.others += v), (totals.others += v);
        row.total += v;
        totals.all += v;
      }
      const donors = await DistrictAdminDashboardService.donorCounts(conn, districtId, yearId);
      return {
        district: identity,
        totalInr: totals.all,
        annualFundInr: totals.annual,
        polioFundInr: totals.polio,
        endowmentInr: totals.endow,
        othersInr: totals.others,
        majorDonors: donors.majorDonors,
        phfContributors: donors.phf,
        clubBreakdown: [...clubs.values()].sort((a, b) => b.total - a.total),
        foundationGoal: await DistrictAdminDashboardService.foundationGoalPanel(conn, districtId, yearId),
        districtProjectTargets: await this.districtProjectTargets(conn, districtId, yearId),
        districtEvents: await DistrictAdminDashboardService.districtEvents(conn, districtId, 50),
        projectFrequency: await this.projectFrequency(conn, districtId, yearId),
        allProjects: await this.allProjects(conn, districtId, yearId, 500),
      };
    });
  }

  async getCommunication(memberId: number, yearId: number | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, yearId, identity }) => {
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const p = { DistrictId: districtId, YStart: start, YEnd: end };
      const announcements = await conn.query(
        `SELECT a.Title AS title, a.PublishDateTime AS publishDate,
                CASE WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                     WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                     ELSE CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath) END AS imagePath
         FROM announcements a
         WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0 AND (@YStart IS NULL OR a.PublishDateTime BETWEEN @YStart AND @YEnd)
         ORDER BY a.PublishDateTime DESC LIMIT 20`,
        p,
      );
      const newsletters = await conn.query(
        `SELECT n.Title AS title, n.PublishDateTime AS publishDate FROM newsletters n
         WHERE n.fk_district_id = @DistrictId AND COALESCE(n.isdeleted, 0) = 0 AND (@YStart IS NULL OR n.PublishDateTime BETWEEN @YStart AND @YEnd)
         ORDER BY n.PublishDateTime DESC LIMIT 20`,
        p,
      );
      const events = await conn.query(
        `SELECT e.Title AS title, e.EventDate AS publishDate FROM upcoming_events e
         WHERE e.fk_district_id = @DistrictId AND e.isdeleted = 0
           AND ((@YStart IS NULL AND e.EventDate >= CURDATE()) OR (@YStart IS NOT NULL AND e.EventDate BETWEEN @YStart AND @YEnd))
         ORDER BY e.EventDate ASC LIMIT 20`,
        p,
      );
      const item = (r: Row, kind: string) => ({ kind, title: str(r.title) ?? "", clubName: "", publishDate: ymd(r.publishDate), imagePath: kind === "announcement" ? str(r.imagePath) : null });
      const greetings = await DistrictAdminDashboardService.greetings(conn, districtId);
      const documents = (
        await conn.query(
          `SELECT d.pk_document_id AS id, d.Title AS title, d.PublishDateTime AS pub, d.FilePath AS filePath, d.OriginalFileName AS origName, d.AccessType AS accessType
           FROM club_documents d
           WHERE d.fk_district_id = @DistrictId AND d.isdeleted = 0
           ORDER BY d.PublishDateTime DESC
           LIMIT 50`,
          p,
        )
      ).map((r) => ({
        id: int(r.id), title: str(r.title) ?? "", clubName: "", publishDate: ymd(r.pub), filePath: str(r.filePath), originalFileName: str(r.origName),
        accessType: str(r.accessType) ?? "",
      }));
      const count = (sql: string) => conn.executeScalar(sql, p).then(int);
      const inYear = (col: string) => `(@YStart IS NULL OR ${col} BETWEEN @YStart AND @YEnd)`;
      return {
        district: identity,
        announcementCount: await count(
          `SELECT COUNT(*) FROM announcements a WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0
           AND NOW() >= a.PublishDateTime AND (a.ExpiryDateTime IS NULL OR NOW() <= a.ExpiryDateTime) AND ${inYear("a.PublishDateTime")}`,
        ),
        newsletterCount: await count(
          `SELECT COUNT(*) FROM newsletters n WHERE n.fk_district_id = @DistrictId AND COALESCE(n.isdeleted, 0) = 0
           AND NOW() >= n.PublishDateTime AND ${inYear("n.PublishDateTime")}`,
        ),
        upcomingEventCount: await count(
          `SELECT COUNT(*) FROM upcoming_events e WHERE e.fk_district_id = @DistrictId AND e.isdeleted = 0
           AND NOW() >= e.PublishDate AND (e.ExpiryDate IS NULL OR NOW() <= e.ExpiryDate) AND ${inYear("e.EventDate")}`,
        ),
        announcements: announcements.map((r) => item(r, "announcement")),
        newsletters: newsletters.map((r) => item(r, "newsletter")),
        upcomingEvents: events.map((r) => item(r, "event")),
        documentCount: await optional(
          () =>
            count(
              `SELECT COUNT(*) FROM club_documents d WHERE d.fk_district_id = @DistrictId AND d.isdeleted = 0
               AND NOW() >= d.PublishDateTime AND (d.ExpiryDateTime IS NULL OR NOW() <= d.ExpiryDateTime) AND ${inYear("d.PublishDateTime")}`,
            ),
          0,
        ),
        greetingsTodayCount: greetings.filter((g) => g.bucket === "today").length,
        districtEvents: await DistrictAdminDashboardService.districtEvents(conn, districtId, 50),
        greetings,
        documents,
      };
    });
  }

  async getEGovernance(memberId: number, yearId: number | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, yearId, identity }) => {
      const p = { DistrictId: districtId, YearId: yearId };
      const clubRows = (
        await conn.query(
          `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                  COALESCE((SELECT COUNT(*) FROM club_monthly_reports r WHERE r.fk_club_id = c.pk_club_id AND r.isdeleted = 0
                            AND (@YearId = 0 OR r.fk_year_id = @YearId) AND r.IsUploadedToDistrict = 1), 0) AS cmrsSubmitted,
                  COALESCE((SELECT COUNT(*) FROM club_monthly_reports r WHERE r.fk_club_id = c.pk_club_id AND r.isdeleted = 0
                            AND (@YearId = 0 OR r.fk_year_id = @YearId) AND r.IsUploadedToDistrict = 0), 0) AS cmrsPending,
                  COALESCE((SELECT COUNT(*) FROM club_attendance a WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0
                            AND (@YearId = 0 OR a.fk_year_id = @YearId)), 0) AS meetingsHeld
           FROM club_master c
           WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
           ORDER BY c.ClubName`,
          p,
        )
      ).map((r) => ({ clubId: int(r.clubId), clubName: str(r.clubName) ?? "", cmrsSubmitted: int(r.cmrsSubmitted), cmrsPending: int(r.cmrsPending), avgAttendance: 0, meetingsHeld: int(r.meetingsHeld) }));
      for (const row of clubRows) row.avgAttendance = await DistrictAdminDashboardService.avgAttendance(conn, districtId, yearId, row.clubId);
      const totalSubmitted = clubRows.reduce((s, r) => s + r.cmrsSubmitted, 0);
      const monthMap = new Map(
        (
          await conn.query(
            `SELECT r.ReportMonth AS reportMonth, SUM(CASE WHEN r.IsUploadedToDistrict = 1 THEN 1 ELSE 0 END) AS submitted
             FROM club_monthly_reports r
             JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0 AND c.fk_district_id = @DistrictId
             WHERE r.isdeleted = 0 AND (@YearId = 0 OR r.fk_year_id = @YearId)
             GROUP BY r.ReportMonth`,
            p,
          )
        ).map((r) => [int(r.reportMonth), int(r.submitted)]),
      );
      const cmrMonthBreakdown = ROTARY_MONTHS.map((cm, i) => {
        const submitted = monthMap.get(cm) ?? 0;
        return { month: i + 1, calendarMonth: cm, label: FULL_MONTHS[cm], submitted, onTime: submitted, late: 0, pending: Math.max(0, clubRows.length - submitted), notStarted: 0 };
      });
      const citationPerClub = await DistrictAdminDashboardService.citationPerClub(conn, districtId, yearId);
      const scored = citationPerClub.filter((c) => c.totalScore > 0);
      const avgCitation = scored.length ? Math.round(scored.reduce((s, c) => s + c.totalScore, 0) / scored.length) : 0;
      return {
        district: identity,
        totalCmrSubmitted: totalSubmitted,
        totalCmrPending: clubRows.reduce((s, r) => s + r.cmrsPending, 0),
        avgAttendance: await DistrictAdminDashboardService.avgAttendance(conn, districtId, yearId),
        totalMeetings: clubRows.reduce((s, r) => s + r.meetingsHeld, 0),
        clubsWithFullCmrCompliance: clubRows.filter((r) => r.cmrsPending === 0 && r.cmrsSubmitted > 0).length,
        clubsWithMissingCmr: clubRows.filter((r) => r.cmrsPending > 0).length,
        clubCompliance: clubRows,
        monthlyReportsCount: totalSubmitted,
        ppsCampsCount: 0,
        avgCitationScore: avgCitation,
        kpis: { monthlyReports: totalSubmitted, ppsCamps: 0, avgCitationScore: avgCitation },
        cmrTotalClubs: clubRows.length,
        cmrOnTimePercent: 0,
        cmrMonthBreakdown,
        cmrPerClubGrid: await DistrictAdminDashboardService.cmrPerClubGrid(conn, districtId, yearId),
        ppsCampPerClub: [],
        districtCitation: citationPerClub,
        reports: [],
      };
    });
  }

  async getMembershipDirectory(memberId: number, yearId: number | null, pageIn: number, pageSizeIn: number, search: string | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, identity }) => {
      const page = pageIn < 1 ? 1 : pageIn;
      const pageSize = pageSizeIn < 1 || pageSizeIn > 200 ? 20 : pageSizeIn;
      const like = search && search.trim() ? `%${search.trim()}%` : null;
      const filter = `FROM member_master_profile m
         JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
         WHERE c.fk_district_id = @DistrictId AND m.isdeleted = 0
           AND (@Like IS NULL OR m.MemberName LIKE @Like OR m.EmailId LIKE @Like
                OR m.PrimaryMobileNumber LIKE @Like OR m.RotaryId LIKE @Like OR c.ClubName LIKE @Like)`;
      const totalCount = int(await conn.executeScalar(`SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${filter}`, { DistrictId: districtId, Like: like }));
      const rows = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name, m.ProfilePhotoPath AS photoPath,
                m.PrimaryMobileNumber AS mobile, m.EmailId AS email, m.RotaryId AS rotaryId, m.Gender AS gender,
                ANY_VALUE(c.pk_club_id) AS clubId, ANY_VALUE(c.ClubName) AS clubName, ANY_VALUE(cm.JoinedDate) AS joinedDate,
                COALESCE((
                    SELECT GROUP_CONCAT(DISTINCT
                        CASE
                            WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                            WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin'
                            ELSE r.RoleName
                        END ORDER BY r.RoleName SEPARATOR ',')
                    FROM member_roles mr
                    JOIN roles r ON r.pk_role_id = mr.fk_role_id
                    WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id AND mr.IsActive = 1 AND mr.isdeleted = 0
                ), 'Member') AS roles,
                (SELECT COUNT(*) FROM member_roles mr2
                  WHERE mr2.fk_member_master_profile_id = m.pk_member_master_profile_id AND mr2.fk_role_id = 2
                    AND mr2.fk_district_id = @DistrictId AND (mr2.fk_club_id IS NULL OR mr2.fk_club_id = 0)
                    AND mr2.IsActive = 1 AND mr2.isdeleted = 0) AS isDistrictAdminFlag,
                (SELECT COUNT(*) FROM member_roles mr3
                  WHERE mr3.fk_member_master_profile_id = m.pk_member_master_profile_id AND mr3.fk_role_id = 2
                    AND mr3.fk_club_id > 0 AND mr3.IsActive = 1 AND mr3.isdeleted = 0) AS isClubAdminFlag
         ${filter}
         GROUP BY m.pk_member_master_profile_id
         ORDER BY m.MemberName
         LIMIT @PageSize OFFSET @Offset`,
        { DistrictId: districtId, Like: like, PageSize: pageSize, Offset: (page - 1) * pageSize },
      );
      // The C# reads an isHonorary column the query does not select, so every row reports Active / not honorary.
      const items = rows.map((r) => ({
        memberId: int(r.memberId), name: str(r.name) ?? "", photoPath: str(r.photoPath), mobile: str(r.mobile), email: str(r.email), rotaryId: str(r.rotaryId),
        gender: str(r.gender), clubName: str(r.clubName), clubId: r.clubId === null ? null : int(r.clubId),
        role: String(r.roles ?? "Member").split(",")[0] || "Member", status: "Active", isHonorary: false,
        isDistrictAdmin: int(r.isDistrictAdminFlag) > 0, isClubAdmin: int(r.isClubAdminFlag) > 0, joinedDate: ymd(r.joinedDate),
      }));
      return { district: identity, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize), items };
    });
  }

  private static networkRow(fullName: string, memberType: string, rotaryId: string | null, admissionDate: string | null, terminationDate: string | null,
    terminationReason: string, id: number, status: string, clubId: number, clubName: string, mobile: string | null, email: string | null, notes: string | null = null) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    return {
      id, clubId, clubName, memberId: rotaryId ?? "", memberType, firstName: parts[0] ?? "", middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
      lastName: parts.length > 1 ? parts[parts.length - 1] : "", admissionDate, terminationDate, terminationReason, status, mobile, email, notes,
    };
  }

  /** Terminated members (our records, or the Rotary.org cache where a club has one) and potential members across the district. */
  async getRotaryNetwork(memberId: number, yearId: number | null, search: string | null, clubId: number | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, identity }) => {
      const like = search && search.trim() ? `%${search.trim()}%` : null;
      const p = { DistrictId: districtId, ClubId: clubId, Like: like };
      const local = (
        await conn.query(
          `SELECT cm.pk_club_member_id AS id, c.pk_club_id AS clubId, c.ClubName AS clubName, m.RotaryId AS rotaryId,
                  CASE WHEN COALESCE(cm.IsHonoraryMember, 0) = 1 THEN 'Honorary' ELSE '' END AS memberType,
                  m.MemberName AS fullName,
                  DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS admissionDate,
                  DATE_FORMAT(cm.TerminationDate, '%Y-%m-%d') AS terminationDate,
                  COALESCE(cm.TerminationReason, '') AS terminationReason,
                  m.PrimaryMobileNumber AS mobile, m.EmailId AS email
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
           WHERE (cm.IsActive = 0 OR cm.isdeleted = 1)
             AND cm.TerminationDate IS NOT NULL
             AND cm.TerminationReason IS NOT NULL AND cm.TerminationReason <> ''
             AND (@ClubId IS NULL OR c.pk_club_id = @ClubId)
             AND (@Like IS NULL OR m.MemberName LIKE @Like OR m.EmailId LIKE @Like
                  OR m.PrimaryMobileNumber LIKE @Like OR cm.TerminationReason LIKE @Like OR c.ClubName LIKE @Like)
             AND NOT EXISTS (
                   SELECT 1 FROM rotary_org_terminated_cache t
                   WHERE c.ClubRotaryId REGEXP '^[0-9]+$' AND t.fk_rotary_club_id = CAST(c.ClubRotaryId AS UNSIGNED))
           ORDER BY cm.TerminationDate DESC, m.MemberName`,
          p,
        )
      ).map((r) =>
        DistrictAdminDashboardService.networkRow(str(r.fullName) ?? "", str(r.memberType) ?? "Active", str(r.rotaryId), str(r.admissionDate), str(r.terminationDate),
          str(r.terminationReason) ?? "", int(r.id), "Terminated", int(r.clubId), str(r.clubName) ?? "", str(r.mobile), str(r.email)),
      );
      const cached = await conn.query(
        `SELECT t.pk_id AS id, c.pk_club_id AS clubId, c.ClubName AS clubName, CAST(t.RotaryMemberId AS CHAR) AS rotaryId,
                COALESCE(t.MemberType, '') AS memberType,
                COALESCE(NULLIF(t.LocalizedName, ''), TRIM(CONCAT_WS(' ', NULLIF(t.FirstName,''), NULLIF(t.MiddleName,''), NULLIF(t.LastName,'')))) AS fullName,
                DATE_FORMAT(t.AdmissionDate, '%Y-%m-%d') AS admissionDate,
                DATE_FORMAT(t.TerminationDate, '%Y-%m-%d') AS terminationDate,
                COALESCE(t.TerminationReason, '') AS terminationReason
         FROM rotary_org_terminated_cache t
         JOIN club_master c ON c.ClubRotaryId = CAST(t.fk_rotary_club_id AS CHAR) AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
         WHERE (@ClubId IS NULL OR c.pk_club_id = @ClubId)
           AND (@Like IS NULL OR t.FirstName LIKE @Like OR t.LastName LIKE @Like OR t.LocalizedName LIKE @Like
                OR t.TerminationReason LIKE @Like OR c.ClubName LIKE @Like)
         ORDER BY t.TerminationDate DESC`,
        p,
      );
      const ids = [...new Set(cached.map((r) => String(r.rotaryId)))];
      const contacts = new Map(
        ids.length
          ? (
              await conn.query("SELECT RotaryId, PrimaryMobileNumber AS Mobile, EmailId AS Email FROM member_master_profile WHERE isdeleted = 0 AND RotaryId IN @Ids", { Ids: ids })
            ).map((r) => [String(r.RotaryId), r])
          : [],
      );
      const terminated = [
        ...local,
        ...cached.map((r) => {
          const c = contacts.get(String(r.rotaryId));
          return DistrictAdminDashboardService.networkRow(str(r.fullName) ?? "", str(r.memberType) ?? "", String(r.rotaryId), str(r.admissionDate), str(r.terminationDate),
            str(r.terminationReason) ?? "", int(r.id), "Terminated", int(r.clubId), str(r.clubName) ?? "", str(c?.Mobile), str(c?.Email));
        }),
      ].sort((a, b) => (b.terminationDate ?? "").localeCompare(a.terminationDate ?? "") || a.clubName.localeCompare(b.clubName));
      const potential = await optional(
        async () =>
          (
            await conn.query(
              `SELECT pm.pk_potential_member_id AS id, c.pk_club_id AS clubId, c.ClubName AS clubName, pm.name AS fullName, pm.email AS email,
                      pm.mobile_number AS mobile, pm.reference_details AS referenceDetails, DATE_FORMAT(pm.created_date, '%Y-%m-%d') AS admissionDate
               FROM potential_members pm
               JOIN club_master c ON c.pk_club_id = pm.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
               WHERE COALESCE(pm.isdeleted, 0) = 0
                 AND (@ClubId IS NULL OR c.pk_club_id = @ClubId)
                 AND (@Like IS NULL OR pm.name LIKE @Like OR pm.email LIKE @Like
                      OR pm.mobile_number LIKE @Like OR pm.reference_details LIKE @Like OR c.ClubName LIKE @Like)
               ORDER BY pm.pk_potential_member_id DESC`,
              p,
            )
          ).map((r) =>
            DistrictAdminDashboardService.networkRow(str(r.fullName) ?? "", "Potential", null, str(r.admissionDate), null, "", int(r.id), "Potential",
              int(r.clubId), str(r.clubName) ?? "", str(r.mobile), str(r.email), str(r.referenceDetails)),
          ),
        [] as ReturnType<typeof DistrictAdminDashboardService.networkRow>[],
      );
      const clubs = (
        await conn.query("SELECT pk_club_id AS ClubId, ClubName FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club' ORDER BY ClubName", p)
      ).map((r) => ({ clubId: int(r.ClubId), clubName: str(r.ClubName) ?? "" }));
      return { district: identity, totalTerminated: terminated.length, totalPotential: potential.length, terminatedMembers: terminated, potentialMembers: potential, clubs };
    });
  }

  /** Live Rotary.org terminated members for one club (written through to the cache), newest termination first, contacts from our profiles. */
  async getLiveTerminated(memberId: number, districtIdIn: number | null, clubId: number | null) {
    const empty = { members: [] as unknown[], clubsQueried: 0, clubsSkippedNoRotaryId: 0, warning: null as string | null };
    return this.db.session(async (conn) => {
      const districtId = await DistrictAdminDashboardService.resolveDistrictId(conn, memberId, districtIdIn);
      if (districtId === 0) return { ...empty, warning: "No district admin assignment found." };
      if (clubId === null) return { ...empty, warning: "Pick a specific club to fetch live — browsing all clubs reads from the last-refreshed cache instead." };
      const club = await conn.queryFirstOrDefault(
        `SELECT pk_club_id AS ClubId, ClubName, ClubRotaryId, ClubType FROM club_master
         WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND pk_club_id = @ClubId AND COALESCE(ClubType,'') <> 'Rotaract Club'`,
        { DistrictId: districtId, ClubId: clubId },
      );
      if (!club) return { ...empty, warning: "Club not found in this district." };
      const rotaryId = Number(String(club.ClubRotaryId ?? "").trim());
      if (!Number.isInteger(rotaryId) || rotaryId <= 0) return { ...empty, clubsSkippedNoRotaryId: 1, warning: `${club.ClubName} is not linked to Rotary.org (missing ClubRotaryId).` };
      const clubType = club.ClubType && String(club.ClubType).trim() ? String(club.ClubType) : "Rotary Club";
      let list;
      try {
        list = await this.rotaryOrg.getClubTerminatedMembers(clubType, rotaryId);
      } catch (e) {
        return { ...empty, warning: `Failed to fetch ${club.ClubName} from Rotary.org: ${(e as Error).message}` };
      }
      await upsertTerminatedCache(conn, rotaryId, list).catch(() => undefined);
      const rows = list.map((m) => DistrictAdminDashboardService.networkRow([m.firstName, m.middleName, m.lastName].filter((x) => x && x.trim()).join(" "), m.memberType ?? "",
        String(m.memberId), m.admissionDate?.slice(0, 10) ?? null, m.terminationDate?.slice(0, 10) ?? null, m.terminationReason ?? "", m.memberId % 2147483647, "Terminated",
        int(club.ClubId), String(club.ClubName ?? ""), null, null));
      const ids = [...new Set(rows.map((r) => r.memberId).filter(Boolean))];
      if (ids.length) {
        const contacts = new Map((await conn.query("SELECT RotaryId, PrimaryMobileNumber AS Mobile, EmailId AS Email FROM member_master_profile WHERE isdeleted = 0 AND RotaryId IN @Ids", { Ids: ids }))
          .map((r) => [String(r.RotaryId), r]));
        for (const r of rows) {
          const c = contacts.get(r.memberId);
          if (c) { r.mobile = c.Mobile ?? null; r.email = c.Email ?? null; }
        }
      }
      return { ...empty, members: rows.sort((x, y) => String(y.terminationDate ?? "").localeCompare(String(x.terminationDate ?? ""))), clubsQueried: 1 };
    });
  }

  /** Latest Rotary.org terminated-cache refresh job for the district. */
  async getRefreshJobStatus(districtId: number) {
    const r = await this.db.queryFirstOrDefault("SELECT * FROM district_rotary_refresh_jobs WHERE fk_district_id = @D ORDER BY pk_id DESC LIMIT 1", { D: districtId });
    if (!r) return null;
    return {
      jobId: int(r.pk_id), districtId: int(r.fk_district_id), status: str(r.Status) ?? "", totalLinkedClubs: int(r.TotalLinkedClubs), clubsDone: int(r.ClubsDone),
      startedUtc: r.StartedUtc, updatedUtc: r.UpdatedUtc, finishedUtc: r.FinishedUtc ?? null, warning: str(r.Warning),
    };
  }

  async getEGovernancePerClubGrid(memberId: number, yearId: number | null, districtId: number | null) {
    return this.context(memberId, yearId, districtId, async ({ conn, districtId, yearId, identity }) => ({
      district: identity,
      rows: await DistrictAdminDashboardService.cmrPerClubGrid(conn, districtId, yearId),
    }));
  }

  // ---- goals and targets ----

  private static async ensureDistrictAdmin(conn: DbCommands, memberId: number, districtId: number) {
    if (memberId <= 0 || districtId <= 0) throw new UnauthorizedAccessException("Invalid request.");
    const n = int(
      await conn.executeScalar(
        "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
        { MemberId: memberId, DistrictId: districtId },
      ),
    );
    if (n === 0) throw new UnauthorizedAccessException("You are not an active admin for this district.");
  }

  private static readonly MEMBERSHIP_GOAL = `SELECT pk_id AS PkId, fk_district_id AS FkDistrictId, fk_year_id AS FkYearId, target_total AS TargetTotal,
         target_new_members AS TargetNewMembers, target_retention_percent AS TargetRetentionPercent, modified_date AS ModifiedDate
       FROM district_membership_goal WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0 LIMIT 1`;
  private static readonly FOUNDATION_GOAL = `SELECT pk_id AS PkId, fk_district_id AS FkDistrictId, fk_year_id AS FkYearId,
         target_annual_fund_usd AS TargetAnnualFundUsd, target_polio_fund_usd AS TargetPolioFundUsd,
         target_endowment_fund_usd AS TargetEndowmentFundUsd, target_other_fund_usd AS TargetOtherFundUsd, modified_date AS ModifiedDate
       FROM district_foundation_goal WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0 LIMIT 1`;

  private static membershipGoal(r: Row | null) {
    return r && {
      pkId: int(r.PkId), fkDistrictId: int(r.FkDistrictId), fkYearId: int(r.FkYearId), targetTotal: int(r.TargetTotal), targetNewMembers: int(r.TargetNewMembers),
      targetRetentionPercent: num(r.TargetRetentionPercent), modifiedDate: r.ModifiedDate ?? null,
    };
  }

  private static foundationGoal(r: Row | null) {
    return r && {
      pkId: int(r.PkId), fkDistrictId: int(r.FkDistrictId), fkYearId: int(r.FkYearId), targetAnnualFundUsd: num(r.TargetAnnualFundUsd),
      targetPolioFundUsd: num(r.TargetPolioFundUsd), targetEndowmentFundUsd: num(r.TargetEndowmentFundUsd), targetOtherFundUsd: num(r.TargetOtherFundUsd),
      modifiedDate: r.ModifiedDate ?? null,
    };
  }

  private async districtAndYear<T>(memberId: number, yearId: number | null, districtId: number | null, work: (conn: DbCommands, d: number, y: number) => Promise<T>, none: T) {
    return this.db.session(async (conn) => {
      const d = await DistrictAdminDashboardService.resolveDistrictId(conn, memberId, districtId);
      if (d === 0) return none;
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      return y === 0 ? none : work(conn, d, y);
    });
  }

  getMembershipGoal(memberId: number, yearId: number | null, districtId: number | null) {
    return this.districtAndYear(memberId, yearId, districtId, async (conn, d, y) =>
      DistrictAdminDashboardService.membershipGoal(await conn.queryFirstOrDefault(DistrictAdminDashboardService.MEMBERSHIP_GOAL, { DistrictId: d, YearId: y })), null);
  }

  async upsertMembershipGoal(memberId: number, dto: { fkDistrictId: number; fkYearId: number; targetTotal: number; targetNewMembers: number; targetRetentionPercent: number }) {
    return this.db.session(async (conn) => {
      await DistrictAdminDashboardService.ensureDistrictAdmin(conn, memberId, dto.fkDistrictId);
      if (dto.fkYearId <= 0) throw new ArgumentException("YearId is required. (Parameter 'dto')");
      await conn.execute(
        `INSERT INTO district_membership_goal
             (fk_district_id, fk_year_id, target_total, target_new_members, target_retention_percent, created_by, modified_by, modified_date, isdeleted, IsActive)
         VALUES (@DistrictId, @YearId, @Total, @New, @Retention, @MemberId, @MemberId, NOW(), 0, 1)
         ON DUPLICATE KEY UPDATE
             target_total = VALUES(target_total), target_new_members = VALUES(target_new_members),
             target_retention_percent = VALUES(target_retention_percent), modified_by = VALUES(modified_by),
             modified_date = NOW(), isdeleted = 0, IsActive = 1`,
        { DistrictId: dto.fkDistrictId, YearId: dto.fkYearId, Total: dto.targetTotal, New: dto.targetNewMembers, Retention: dto.targetRetentionPercent, MemberId: memberId },
      );
      return DistrictAdminDashboardService.membershipGoal(await conn.queryFirstOrDefault(DistrictAdminDashboardService.MEMBERSHIP_GOAL, { DistrictId: dto.fkDistrictId, YearId: dto.fkYearId }));
    });
  }

  getFoundationGoal(memberId: number, yearId: number | null, districtId: number | null) {
    return this.districtAndYear(memberId, yearId, districtId, async (conn, d, y) =>
      DistrictAdminDashboardService.foundationGoal(await conn.queryFirstOrDefault(DistrictAdminDashboardService.FOUNDATION_GOAL, { DistrictId: d, YearId: y })), null);
  }

  async upsertFoundationGoal(memberId: number, dto: { fkDistrictId: number; fkYearId: number; targetAnnualFundUsd: number; targetPolioFundUsd: number; targetEndowmentFundUsd: number; targetOtherFundUsd: number }) {
    return this.db.session(async (conn) => {
      await DistrictAdminDashboardService.ensureDistrictAdmin(conn, memberId, dto.fkDistrictId);
      if (dto.fkYearId <= 0) throw new ArgumentException("YearId is required. (Parameter 'dto')");
      await conn.execute(
        `INSERT INTO district_foundation_goal
             (fk_district_id, fk_year_id, target_annual_fund_usd, target_polio_fund_usd, target_endowment_fund_usd, target_other_fund_usd,
              created_by, modified_by, modified_date, isdeleted, IsActive)
         VALUES (@DistrictId, @YearId, @Annual, @Polio, @Endowment, @Other, @MemberId, @MemberId, NOW(), 0, 1)
         ON DUPLICATE KEY UPDATE
             target_annual_fund_usd = VALUES(target_annual_fund_usd), target_polio_fund_usd = VALUES(target_polio_fund_usd),
             target_endowment_fund_usd = VALUES(target_endowment_fund_usd), target_other_fund_usd = VALUES(target_other_fund_usd),
             modified_by = VALUES(modified_by), modified_date = NOW(), isdeleted = 0, IsActive = 1`,
        {
          DistrictId: dto.fkDistrictId, YearId: dto.fkYearId, Annual: dto.targetAnnualFundUsd, Polio: dto.targetPolioFundUsd,
          Endowment: dto.targetEndowmentFundUsd, Other: dto.targetOtherFundUsd, MemberId: memberId,
        },
      );
      return DistrictAdminDashboardService.foundationGoal(await conn.queryFirstOrDefault(DistrictAdminDashboardService.FOUNDATION_GOAL, { DistrictId: dto.fkDistrictId, YearId: dto.fkYearId }));
    });
  }

  getProjectTargets(memberId: number, yearId: number | null, districtId: number | null) {
    return this.districtAndYear(
      memberId, yearId, districtId,
      async (conn, d, y) =>
        (
          await conn.query(
            `SELECT t.pk_id AS PkId, t.fk_district_id AS FkDistrictId, t.fk_year_id AS FkYearId, t.fk_module_id AS FkModuleId,
                    m.ModuleName, t.target_count AS TargetCount, t.modified_date AS ModifiedDate
             FROM district_project_target t
             LEFT JOIN module_master m ON m.pk_module_id = t.fk_module_id
             WHERE t.fk_district_id = @DistrictId AND t.fk_year_id = @YearId AND t.isdeleted = 0
             ORDER BY m.SortOrder, m.ModuleName`,
            { DistrictId: d, YearId: y },
          )
        ).map((r) => ({
          pkId: int(r.PkId), fkDistrictId: int(r.FkDistrictId), fkYearId: int(r.FkYearId), fkModuleId: int(r.FkModuleId), moduleName: str(r.ModuleName),
          targetCount: int(r.TargetCount), modifiedDate: r.ModifiedDate ?? null,
        })),
      [] as unknown[],
    );
  }

  async upsertProjectTargets(memberId: number, districtId: number, yearId: number, targets: { fkModuleId: number; targetCount: number }[]) {
    await this.db.session(async (conn) => {
      await DistrictAdminDashboardService.ensureDistrictAdmin(conn, memberId, districtId);
      if (yearId <= 0) throw new ArgumentException("YearId is required. (Parameter 'req')");
      for (const item of targets) {
        if (item.fkModuleId <= 0) continue;
        await conn.execute(
          `INSERT INTO district_project_target
               (fk_district_id, fk_year_id, fk_module_id, target_count, created_by, modified_by, modified_date, isdeleted, IsActive)
           VALUES (@DistrictId, @YearId, @ModuleId, @Count, @MemberId, @MemberId, NOW(), 0, 1)
           ON DUPLICATE KEY UPDATE target_count = VALUES(target_count), modified_by = VALUES(modified_by), modified_date = NOW(), isdeleted = 0, IsActive = 1`,
          { DistrictId: districtId, YearId: yearId, ModuleId: item.fkModuleId, Count: item.targetCount, MemberId: memberId },
        );
      }
    });
    return this.getProjectTargets(memberId, yearId, districtId);
  }

  // ---- per-club award status and MyRotary tracking ----

  private static async clubDistrict(conn: DbCommands, clubId: number) {
    if (clubId <= 0) return 0;
    return int(await conn.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0 LIMIT 1", { ClubId: clubId }));
  }

  async getClubAwardStatus(clubId: number, yearId: number | null) {
    if (clubId <= 0) return null;
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      if (y === 0) return null;
      const r = await conn.queryFirstOrDefault(
        `SELECT pk_id AS PkId, fk_club_id AS FkClubId, fk_year_id AS FkYearId, on_track AS OnTrack, achieved AS Achieved,
                COALESCE(presidential_citation_status, 'pending') AS PresidentialCitationStatus,
                COALESCE(district_citation_status, 'pending') AS DistrictCitationStatus,
                COALESCE(membership_excellence_status, 'pending') AS MembershipExcellenceStatus,
                notes AS Notes, modified_date AS ModifiedDate
         FROM club_award_status WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 LIMIT 1`,
        { ClubId: clubId, YearId: y },
      );
      return r && {
        pkId: int(r.PkId), fkClubId: int(r.FkClubId), fkYearId: int(r.FkYearId), onTrack: bool(r.OnTrack), achieved: bool(r.Achieved),
        presidentialCitationStatus: str(r.PresidentialCitationStatus), districtCitationStatus: str(r.DistrictCitationStatus),
        membershipExcellenceStatus: str(r.MembershipExcellenceStatus), notes: str(r.Notes), modifiedDate: r.ModifiedDate ?? null,
      };
    });
  }

  async upsertClubAwardStatus(memberId: number, dto: Record<string, unknown>) {
    const clubId = int(dto.fkClubId);
    const yearId = int(dto.fkYearId);
    await this.db.session(async (conn) => {
      const district = await DistrictAdminDashboardService.clubDistrict(conn, clubId);
      if (district === 0) throw new ArgumentException("Club not found. (Parameter 'dto')");
      await DistrictAdminDashboardService.ensureDistrictAdmin(conn, memberId, district);
      if (yearId <= 0) throw new ArgumentException("YearId is required. (Parameter 'dto')");
      await conn.execute(
        `INSERT INTO club_award_status
             (fk_club_id, fk_year_id, on_track, achieved, presidential_citation_status, district_citation_status, membership_excellence_status,
              notes, created_by, modified_by, modified_date, isdeleted, IsActive)
         VALUES (@ClubId, @YearId, @OnTrack, @Achieved, @Pres, @Dist, @Mem, @Notes, @MemberId, @MemberId, NOW(), 0, 1)
         ON DUPLICATE KEY UPDATE
             on_track = VALUES(on_track), achieved = VALUES(achieved),
             presidential_citation_status = VALUES(presidential_citation_status),
             district_citation_status = VALUES(district_citation_status),
             membership_excellence_status = VALUES(membership_excellence_status),
             notes = VALUES(notes), modified_by = VALUES(modified_by), modified_date = NOW(), isdeleted = 0, IsActive = 1`,
        {
          ClubId: clubId, YearId: yearId, OnTrack: bool(dto.onTrack) ? 1 : 0, Achieved: bool(dto.achieved) ? 1 : 0,
          Pres: str(dto.presidentialCitationStatus) ?? "pending", Dist: str(dto.districtCitationStatus) ?? "pending",
          Mem: str(dto.membershipExcellenceStatus) ?? "pending", Notes: str(dto.notes), MemberId: memberId,
        },
      );
    });
    return this.getClubAwardStatus(clubId, yearId);
  }

  async getClubMyRotary(clubId: number, yearId: number | null) {
    if (clubId <= 0) return null;
    return this.db.session(async (conn) => {
      const y = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      if (y === 0) return null;
      const r = await conn.queryFirstOrDefault(
        `SELECT pk_id AS PkId, fk_club_id AS FkClubId, fk_year_id AS FkYearId, registered_members AS RegisteredMembers,
                total_members AS TotalMembers, registration_percentage AS RegistrationPercentage, last_synced AS LastSynced, modified_date AS ModifiedDate
         FROM club_myrotary_tracking WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 LIMIT 1`,
        { ClubId: clubId, YearId: y },
      );
      return r && {
        pkId: int(r.PkId), fkClubId: int(r.FkClubId), fkYearId: int(r.FkYearId), registeredMembers: int(r.RegisteredMembers), totalMembers: int(r.TotalMembers),
        registrationPercentage: num(r.RegistrationPercentage), lastSynced: r.LastSynced ?? null, modifiedDate: r.ModifiedDate ?? null,
      };
    });
  }

  async upsertClubMyRotary(memberId: number, dto: Record<string, unknown>) {
    const clubId = int(dto.fkClubId);
    const yearId = int(dto.fkYearId);
    await this.db.session(async (conn) => {
      const district = await DistrictAdminDashboardService.clubDistrict(conn, clubId);
      if (district === 0) throw new ArgumentException("Club not found. (Parameter 'dto')");
      await DistrictAdminDashboardService.ensureDistrictAdmin(conn, memberId, district);
      if (yearId <= 0) throw new ArgumentException("YearId is required. (Parameter 'dto')");
      const registered = int(dto.registeredMembers);
      const total = int(dto.totalMembers);
      let percentage = num(dto.registrationPercentage);
      if (percentage === 0 && total > 0) percentage = round((registered / total) * 100, 2);
      await conn.execute(
        `INSERT INTO club_myrotary_tracking
             (fk_club_id, fk_year_id, registered_members, total_members, registration_percentage, last_synced,
              created_by, modified_by, modified_date, isdeleted, IsActive)
         VALUES (@ClubId, @YearId, @Registered, @Total, @Pct, NOW(), @MemberId, @MemberId, NOW(), 0, 1)
         ON DUPLICATE KEY UPDATE
             registered_members = VALUES(registered_members), total_members = VALUES(total_members),
             registration_percentage = VALUES(registration_percentage), last_synced = NOW(),
             modified_by = VALUES(modified_by), modified_date = NOW(), isdeleted = 0, IsActive = 1`,
        { ClubId: clubId, YearId: yearId, Registered: registered, Total: total, Pct: percentage, MemberId: memberId },
      );
    });
    return this.getClubMyRotary(clubId, yearId);
  }
}

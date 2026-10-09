import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { dbDateTime } from "../../common/binding";
import { YearTableResolver } from "../../services/year-table.resolver";

/** The zonal-award questions computed from the data (by their sort order in the year's question set). */
const AUTO_QUESTION_SORT_ORDERS = [1, 4, 5, 7, 8, 15, 17, 19, 20, 21, 22, 24, 26, 27, 28, 29, 35, 36, 37];

type ProjectFilter = { aof?: number; cat?: number; subcat?: number; perCount?: boolean };
/**
 * Which projects count for each range question. The ids are RIZones master
 * (area of focus / category / sub-category) ids; ROW's own taxonomy has other
 * ids, so these need remapping before the zonal awards are used (ROW-CHANGES.md).
 */
const PROJECT_QUESTIONS: Record<number, ProjectFilter> = {
  15: { aof: 59 }, 17: { aof: 2, cat: 13, subcat: 44 }, 20: { aof: 41 }, 21: { aof: 50 }, 22: { aof: 51 }, 24: { aof: 31 }, 26: { aof: 39 },
  27: { cat: 129 }, 28: { cat: 130 }, 29: { cat: 131 }, 35: { aof: 54, perCount: true }, 36: { aof: 55, perCount: true }, 37: { aof: 56 },
};
const MEDICAL_MISSION_SUBCATS = [285, 286];

/** Port of ZonalAwardsAutoCalculationService.cs: recomputes a district's auto-scored zonal award entries for a year. */
@Injectable()
export class ZonalAwardsAutoCalculationService {
  private readonly log = new Logger("ZonalAwardsAutoCalculationService");

  constructor(
    private readonly db: Db,
    private readonly yearTables: YearTableResolver,
  ) {}

  async calculateForDistrict(districtId: number, yearId: number) {
    await this.db.session(async (conn) => {
      const year = await conn.queryFirstOrDefault("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", { Y: yearId });
      if (!year) return;
      const start = dbDateTime(year.StartDate)!;
      const end = dbDateTime(year.EndDate)!;
      const questions = await conn.query(
        `SELECT q.pk_id AS id, q.sort_order AS sortOrder
         FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
         WHERE g.fk_year_id = @Y AND q.isdeleted = 0 AND g.isdeleted = 0 AND q.sort_order IN @Sorts`,
        { Y: yearId, Sorts: AUTO_QUESTION_SORT_ORDERS },
      );
      if (!questions.length) return;
      const options = await conn.query(
        `SELECT pk_id AS id, fk_question_id AS questionId, mini, maxi, points, atleast, subtype, sort_order AS sortOrder
         FROM zonal_awards_question_option WHERE fk_question_id IN @Ids AND isdeleted = 0 ORDER BY fk_question_id, sort_order`,
        { Ids: questions.map((q) => Number(q.id)) },
      );
      if (options.length) {
        await conn.execute("UPDATE zonal_awards_district_entry SET entered_counts = 0, received_points = 0 WHERE fk_district_id = @D AND fk_year_id = @Y AND fk_option_id IN @OptIds", {
          D: districtId, Y: yearId, OptIds: options.map((o) => Number(o.id)),
        });
      }
      for (const q of questions) {
        const sort = Number(q.sortOrder);
        const opts = options.filter((o) => Number(o.questionId) === Number(q.id));
        try {
          if (sort === 1) await this.newClubs(conn, districtId, yearId, start, end, opts);
          else if (sort === 4) await this.avgMembers(conn, districtId, yearId, end, opts);
          else if (sort === 5) await this.healthyClubs(conn, districtId, yearId, end, opts);
          else if (sort === 7) await this.womenInRotary(conn, districtId, yearId, end, opts);
          else if (sort === 8) await this.percentWomen(conn, districtId, yearId, end, opts);
          else if (sort === 19) await this.medicalMission(conn, districtId, yearId, start, end, opts);
          else if (PROJECT_QUESTIONS[sort]) await this.rangeProject(conn, districtId, yearId, start, end, opts, PROJECT_QUESTIONS[sort]);
        } catch (e) {
          this.log.error(`Error calculating zonal awards auto Q${sort} for district ${districtId} year ${yearId}: ${(e as Error).message}`);
        }
      }
    });
  }

  private static monthCounts(rows: Row[]) {
    return new Map(rows.map((r) => [Number(r.m), Number(r.c)]));
  }

  private async newClubs(conn: DbCommands, d: number, y: number, s: string, e: string, opts: Row[]) {
    const months = ZonalAwardsAutoCalculationService.monthCounts(
      await conn.query(
        `SELECT MONTH(ClubCharterDate) AS m, COUNT(*) AS c FROM club_master
         WHERE fk_district_id = @D AND isdeleted = 0 AND ClubCharterDate >= @S AND ClubCharterDate <= @E
         GROUP BY MONTH(ClubCharterDate)`,
        { D: d, S: s, E: e },
      ),
    );
    await ZonalAwardsAutoCalculationService.saveRange(conn, d, y, 0, opts, [...months.values()].reduce((a, b) => a + b, 0), true);
    for (const [m, c] of months) await ZonalAwardsAutoCalculationService.saveRange(conn, d, y, m, opts, c, true);
  }

  private static activeMembers(conn: DbCommands, d: number, e: string, extra = "") {
    return conn
      .executeScalar(
        `SELECT COUNT(*) FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
         INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1 AND m.isdeleted = 0 ${extra} AND cm.JoinedDate <= @E`,
        { D: d, E: e },
      )
      .then(Number);
  }
  private static activeClubs(conn: DbCommands, d: number) {
    return conn.executeScalar("SELECT COUNT(*) FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1", { D: d }).then(Number);
  }

  private async avgMembers(conn: DbCommands, d: number, y: number, e: string, opts: Row[]) {
    const clubs = await ZonalAwardsAutoCalculationService.activeClubs(conn, d);
    if (!clubs) return;
    await ZonalAwardsAutoCalculationService.saveRange(conn, d, y, 0, opts, Math.trunc((await ZonalAwardsAutoCalculationService.activeMembers(conn, d, e)) / clubs));
  }

  /** Flags every club Red (10-25 members) / Amber (26-40) / Green (41+), then scores the district's mix. */
  private async healthyClubs(conn: DbCommands, d: number, y: number, e: string, opts: Row[]) {
    const counts = await conn.query(
      `SELECT c.pk_club_id AS clubId, COUNT(m.pk_member_master_profile_id) AS memberCount
       FROM club_master c
       LEFT JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0 AND cm.JoinedDate <= @E
       WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
       GROUP BY c.pk_club_id`,
      { D: d, E: e },
    );
    if (!counts.length) return;
    let red = 0;
    let amber = 0;
    let green = 0;
    for (const row of counts) {
      const n = Number(row.memberCount);
      const flag = n >= 10 && n <= 25 ? "Red" : n >= 26 && n <= 40 ? "Amber" : n >= 41 ? "Green" : "None";
      if (flag === "Red") red++;
      else if (flag === "Amber") amber++;
      else if (flag === "Green") green++;
      await conn.execute("UPDATE club_master SET Is_healthy_club = @F WHERE pk_club_id = @Id", { F: flag, Id: row.clubId });
    }
    const pct = (x: number) => (x * 100) / counts.length;
    for (const o of opts) {
      const sort = Number(o.sortOrder);
      const [match, value] = sort === 1 ? [pct(red) < 30, pct(red)] : sort === 2 ? [pct(amber) >= 40, pct(amber)] : sort === 3 ? [pct(green) > 30, pct(green)] : [false, 0];
      await ZonalAwardsAutoCalculationService.insert(conn, Number(o.id), d, y, 0, Math.trunc(value), match ? Number(o.points) : 0);
    }
  }

  private async womenInRotary(conn: DbCommands, d: number, y: number, e: string, opts: Row[]) {
    const clubs = await ZonalAwardsAutoCalculationService.activeClubs(conn, d);
    if (!clubs) return;
    const withWomen = Number(
      await conn.executeScalar(
        `SELECT COUNT(*) FROM (
             SELECT c.pk_club_id FROM club_master c
             INNER JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
             INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0 AND m.Gender = 'Female' AND cm.JoinedDate <= @E
             WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
             GROUP BY c.pk_club_id HAVING COUNT(m.pk_member_master_profile_id) >= 4
         ) t`,
        { D: d, E: e },
      ),
    );
    await ZonalAwardsAutoCalculationService.saveRange(conn, d, y, 0, opts, Math.trunc((withWomen * 100) / clubs));
  }

  private async percentWomen(conn: DbCommands, d: number, y: number, e: string, opts: Row[]) {
    const total = await ZonalAwardsAutoCalculationService.activeMembers(conn, d, e);
    if (!total) return;
    const women = await ZonalAwardsAutoCalculationService.activeMembers(conn, d, e, "AND m.Gender = 'Female'");
    await ZonalAwardsAutoCalculationService.saveRange(conn, d, y, 0, opts, Math.trunc((women * 100) / total));
  }

  private async medicalMission(conn: DbCommands, d: number, y: number, s: string, e: string, opts: Row[]) {
    const info = await this.yearTables.resolveByYearId(conn, y);
    if (!info) return;
    for (const o of opts) {
      const subcat = Number(o.sortOrder) === 1 ? MEDICAL_MISSION_SUBCATS[0] : MEDICAL_MISSION_SUBCATS[1];
      const months = ZonalAwardsAutoCalculationService.monthCounts(
        await conn.query(
          `SELECT MONTH(p.project_date) AS m, COUNT(*) AS c FROM \`${info.projectsTable}\` p
           INNER JOIN club_master c ON c.pk_club_id = p.fk_club_id
           WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND p.isdeleted = 0 AND p.fk_sub_category_id = @Sub AND p.project_date >= @S AND p.project_date <= @E
           GROUP BY MONTH(p.project_date)`,
          { D: d, Sub: subcat, S: s, E: e },
        ),
      );
      const total = [...months.values()].reduce((a, b) => a + b, 0);
      const pts = Number(o.points);
      await ZonalAwardsAutoCalculationService.insert(conn, Number(o.id), d, y, 0, total, total > 0 ? pts * total : 0);
      for (const [m, c] of months) await ZonalAwardsAutoCalculationService.insert(conn, Number(o.id), d, y, m, c, pts * c);
    }
  }

  private async rangeProject(conn: DbCommands, d: number, y: number, s: string, e: string, opts: Row[], f: ProjectFilter) {
    const info = await this.yearTables.resolveByYearId(conn, y);
    if (!info) return;
    const where = ["c.fk_district_id = @D", "c.isdeleted = 0", "p.isdeleted = 0", "p.project_date >= @S", "p.project_date <= @E"];
    if (f.aof !== undefined) where.push("p.fk_area_of_focus_id = @Aof");
    if (f.cat !== undefined) where.push("p.fk_category_id = @Cat");
    if (f.subcat !== undefined) where.push("p.fk_sub_category_id = @Sub");
    const months = ZonalAwardsAutoCalculationService.monthCounts(
      await conn.query(
        `SELECT MONTH(p.project_date) AS m, COUNT(*) AS c FROM \`${info.projectsTable}\` p
         INNER JOIN club_master c ON c.pk_club_id = p.fk_club_id
         WHERE ${where.join(" AND ")}
         GROUP BY MONTH(p.project_date)`,
        { D: d, S: s, E: e, Aof: f.aof ?? null, Cat: f.cat ?? null, Sub: f.subcat ?? null },
      ),
    );
    await ZonalAwardsAutoCalculationService.saveRange(conn, d, y, 0, opts, [...months.values()].reduce((a, b) => a + b, 0), !!f.perCount);
    for (const [m, c] of months) await ZonalAwardsAutoCalculationService.saveRange(conn, d, y, m, opts, c, !!f.perCount);
  }

  /** SaveRangeMatch: the range option the count falls in (the highest minimum wins); nothing for a zero count. */
  private static async saveRange(conn: DbCommands, d: number, y: number, month: number, opts: Row[], count: number, perCount = false) {
    let winner: Row | null = null;
    for (const o of opts) {
      const [mini, maxi] = [Number(o.mini), Number(o.maxi)];
      if (mini === 0 && maxi === 0) continue;
      if (count >= mini && count <= maxi && (!winner || mini > Number(winner.mini))) winner = o;
    }
    if (winner && count > 0) {
      const pts = Number(winner.points);
      await ZonalAwardsAutoCalculationService.insert(conn, Number(winner.id), d, y, month, count, perCount ? pts * count : pts);
    }
  }

  private static insert(conn: DbCommands, optionId: number, d: number, y: number, month: number, counts: number, points: number) {
    return conn.execute(
      `INSERT INTO zonal_awards_district_entry (fk_option_id, fk_district_id, fk_year_id, month, entered_counts, received_points, created_by)
       VALUES (@Opt, @D, @Y, @M, @C, @P, 0)
       ON DUPLICATE KEY UPDATE entered_counts = @C, received_points = @P, modified_date = CURRENT_TIMESTAMP`,
      { Opt: optionId, D: d, Y: y, M: month, C: counts, P: points },
    );
  }
}

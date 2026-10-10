import { Injectable } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import { ClubAdminDashboardService } from "../dashboards/club-admin-dashboard.service";

export interface FoundationGoalDto {
  goalId: number | null; clubId: number; yearId: number; yearLabel: string;
  apfGoal: number; polioPlusGoal: number; endowmentFundGoal: number; otherGoal: number;
  currency: string; remarks: string | null; isEditable: boolean; isCurrent: boolean; updatedDate: string | null; updatedBy: string | null;
}
export interface FoundationGoalSaveRequest { yearId: number; apfGoal: number; polioPlusGoal: number; endowmentFundGoal: number; otherGoal: number; currency: string; remarks: string | null }
export interface FoundationGoalYearRow { yearId: number; yearLabel: string; isCurrent: boolean; isEditable: boolean; hasGoal: boolean; totalGoal: number }
export interface FoundationGoalListResponse { clubId: number; clubName: string; currentSelection: FoundationGoalDto | null; years: FoundationGoalYearRow[]; pastGoals: FoundationGoalDto[] }

const n = (v: unknown) => Number(v ?? 0) || 0;
const b = (v: unknown) => v === true || Number(v ?? 0) !== 0;

/** Port of FoundationGoalsService.cs: Foundation collection goals, one active row per club per year. */
@Injectable()
export class FoundationGoalsService {
  constructor(private readonly db: Db) {}

  /** Club Admin (2) or Moderator (5) at the requested club (or override); else the member's latest Admin, then Moderator, club. */
  private async resolveClubId(conn: DbCommands, memberId: number, requested: number | null): Promise<number> {
    if (memberId <= 0) return 0;
    if (requested !== null && requested > 0) {
      let ok = n(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id IN (2, 5) AND fk_club_id = @ClubId
           AND IsActive = 1 AND isdeleted = 0`,
        { MemberId: memberId, ClubId: requested },
      ));
      if (ok === 0 && (await ClubAdminDashboardService.canOverrideClubAdmin(conn, memberId, requested))) ok = 1;
      if (ok === 0) throw new UnauthorizedAccessException("You are not an active admin for this club.");
      return requested;
    }
    for (const role of [2, 5]) {
      const clubId = n(await conn.executeScalar(
        `SELECT mr.fk_club_id FROM member_roles mr
         WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = @Role AND mr.IsActive = 1 AND mr.isdeleted = 0
         ORDER BY mr.pk_member_role_id DESC LIMIT 1`,
        { MemberId: memberId, Role: role },
      ));
      if (clubId > 0 || role === 5) return clubId;
    }
    return 0;
  }

  async getList(memberId: number, yearId: number | null, requestedClubId: number | null = null): Promise<FoundationGoalListResponse | null> {
    const conn = this.db;
    const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
    if (clubId === 0) return null;
    const clubName = ((await conn.executeScalar("SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0", { ClubId: clubId })) as string | null) ?? "";

    let selectedYearId = yearId ?? 0;
    if (selectedYearId <= 0) selectedYearId = n(await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 ORDER BY pk_year_id DESC LIMIT 1"));

    // Year dropdown: years with a saved goal ∪ current ∪ future.
    const yearRows = await conn.query(
      `SELECT y.pk_year_id AS yearId, y.YearLabel AS yearLabel, COALESCE(y.IsCurrent, 0) AS isCurrent, (y.EndDate >= CURDATE()) AS isEditable,
              (SELECT COUNT(*) FROM club_foundation_collection_goals g WHERE g.fk_club_id = @ClubId AND g.fk_year_id = y.pk_year_id AND g.isdeleted = 0) AS hasGoal,
              COALESCE((SELECT g.apf_goal_amount + g.polio_plus_goal_amount + g.endowment_fund_goal_amount + g.other_goal_amount
                          FROM club_foundation_collection_goals g
                         WHERE g.fk_club_id = @ClubId AND g.fk_year_id = y.pk_year_id AND g.isdeleted = 0 LIMIT 1), 0) AS totalGoal
       FROM rotary_year_master y
       WHERE y.isdeleted = 0
         AND (y.EndDate >= CURDATE()
              OR EXISTS (SELECT 1 FROM club_foundation_collection_goals g WHERE g.fk_club_id = @ClubId AND g.fk_year_id = y.pk_year_id AND g.isdeleted = 0))
       ORDER BY y.pk_year_id DESC`,
      { ClubId: clubId },
    );
    const years: FoundationGoalYearRow[] = yearRows.map((r) => ({
      yearId: n(r.yearId), yearLabel: (r.yearLabel as string) ?? "", isCurrent: b(r.isCurrent), isEditable: b(r.isEditable), hasGoal: n(r.hasGoal) > 0, totalGoal: n(r.totalGoal),
    }));

    const currentSelection = await this.getGoal(conn, clubId, selectedYearId);
    const pastGoals: FoundationGoalDto[] = [];
    for (const y of years.filter((y) => y.hasGoal && !y.isEditable)) {
      const g = await this.getGoal(conn, clubId, y.yearId);
      if (g) pastGoals.push(g);
    }
    return { clubId, clubName, currentSelection, years, pastGoals };
  }

  private async getGoal(conn: DbCommands, clubId: number, yearId: number): Promise<FoundationGoalDto | null> {
    if (yearId <= 0) return null;
    const yr = await conn.queryFirstOrDefault(
      `SELECT pk_year_id AS yearId, YearLabel AS yearLabel, COALESCE(IsCurrent, 0) AS isCurrent, (EndDate >= CURDATE()) AS isEditable
       FROM rotary_year_master WHERE pk_year_id = @YearId AND isdeleted = 0`,
      { YearId: yearId },
    );
    if (!yr) return null;
    const row = await conn.queryFirstOrDefault(
      `SELECT g.pk_goal_id AS goalId, g.apf_goal_amount AS apf, g.polio_plus_goal_amount AS polio, g.endowment_fund_goal_amount AS endowment,
              g.other_goal_amount AS other, COALESCE(g.currency, 'USD') AS currency, g.remarks AS remarks,
              DATE_FORMAT(COALESCE(g.modified_date, g.created_date), '%Y-%m-%d %H:%i') AS updatedDate,
              (SELECT m.MemberName FROM member_master_profile m WHERE m.pk_member_master_profile_id = COALESCE(g.modified_by, g.created_by)) AS updatedBy
       FROM club_foundation_collection_goals g
       WHERE g.fk_club_id = @ClubId AND g.fk_year_id = @YearId AND g.isdeleted = 0
       LIMIT 1`,
      { ClubId: clubId, YearId: yearId },
    );
    return {
      goalId: row ? n(row.goalId) : null, clubId, yearId, yearLabel: (yr.yearLabel as string) ?? "",
      apfGoal: row ? n(row.apf) : 0, polioPlusGoal: row ? n(row.polio) : 0, endowmentFundGoal: row ? n(row.endowment) : 0, otherGoal: row ? n(row.other) : 0,
      currency: row ? ((row.currency as string) ?? "USD") : "USD", remarks: row ? ((row.remarks as string) ?? null) : null,
      isEditable: b(yr.isEditable), isCurrent: b(yr.isCurrent),
      updatedDate: row ? ((row.updatedDate as string) ?? null) : null, updatedBy: row ? ((row.updatedBy as string) ?? null) : null,
    };
  }

  private async isEditableYear(conn: DbCommands, yearId: number) {
    return n(await conn.executeScalar("SELECT COALESCE((EndDate >= CURDATE()), 0) FROM rotary_year_master WHERE pk_year_id = @YearId AND isdeleted = 0", { YearId: yearId })) === 1;
  }

  async save(memberId: number, req: FoundationGoalSaveRequest, requestedClubId: number | null = null): Promise<FoundationGoalDto | null> {
    if (req.yearId <= 0) throw new InvalidOperationException("yearId required");
    const conn = this.db;
    const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
    if (clubId === 0) return null;
    if (!(await this.isEditableYear(conn, req.yearId))) throw new InvalidOperationException("Past years are read-only and cannot be edited.");
    if (req.apfGoal < 0 || req.polioPlusGoal < 0 || req.endowmentFundGoal < 0 || req.otherGoal < 0) throw new InvalidOperationException("Goal amounts must be zero or positive.");
    const currency = !req.currency || !req.currency.trim() ? "USD" : req.currency.trim();

    // UPSERT on the (club, year, isdeleted=0) unique key.
    await conn.execute(
      `INSERT INTO club_foundation_collection_goals
          (fk_club_id, fk_year_id, apf_goal_amount, polio_plus_goal_amount, endowment_fund_goal_amount, other_goal_amount,
           currency, remarks, created_by, created_date, isdeleted)
       VALUES (@ClubId, @YearId, @Apf, @Polio, @Endowment, @Other, @Currency, @Remarks, @MemberId, NOW(), 0)
       ON DUPLICATE KEY UPDATE
          apf_goal_amount = @Apf, polio_plus_goal_amount = @Polio, endowment_fund_goal_amount = @Endowment, other_goal_amount = @Other,
          currency = @Currency, remarks = @Remarks, modified_by = @MemberId, modified_date = NOW()`,
      { ClubId: clubId, YearId: req.yearId, Apf: req.apfGoal, Polio: req.polioPlusGoal, Endowment: req.endowmentFundGoal, Other: req.otherGoal, Currency: currency, Remarks: req.remarks, MemberId: memberId },
    );
    return this.getGoal(conn, clubId, req.yearId);
  }

  async delete(memberId: number, yearId: number, requestedClubId: number | null = null): Promise<boolean> {
    if (yearId <= 0) return false;
    const conn = this.db;
    const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
    if (clubId === 0) return false;
    if (!(await this.isEditableYear(conn, yearId))) throw new InvalidOperationException("Past years are read-only and cannot be deleted.");
    const rows = await conn.execute(
      `UPDATE club_foundation_collection_goals
       SET isdeleted = 1, deleted_by = @MemberId, deleted_date = NOW(), modified_by = @MemberId, modified_date = NOW()
       WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0`,
      { ClubId: clubId, YearId: yearId, MemberId: memberId },
    );
    return rows > 0;
  }
}

import { Controller, Get, Post, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { queryInt } from "../../common/binding";
import { badRequest, forbid, ok } from "../../common/results";
import { Db, type DbCommands } from "../../database/db.service";

const ADMIN_ROLE_ID = 2;

/**
 * Candidates: (club, member) pairs holding Club President/Secretary in a past year, still holding
 * club-admin access, and not holding either post for that club this year. Read-only; leans
 * towards keeping access (a soft-deleted past year drops out, the current-year check ignores isdeleted).
 */
async function findRevocationCandidates(conn: DbCommands, yearOnly: number | null) {
  return (await conn.query(
    `SELECT pb.fk_club_id AS ClubId, c.ClubName AS ClubName, d.DistrictNumber AS DistrictNumber,
            pb.fk_member_master_profile_id AS MemberId, m.MemberName AS MemberName, m.EmailId AS Email,
            GROUP_CONCAT(DISTINCT CONCAT(dm.designation_name, ' (', COALESCE(py.YearLabel, CONCAT('year #', py.pk_year_id)), ')') SEPARATOR ', ') AS PastRoles
     FROM board_of_directors pb
     JOIN designation_master dm    ON dm.pk_designation_id = pb.fk_designation_id
     JOIN rotary_year_master py    ON py.pk_year_id = pb.fk_year_id
     JOIN club_master c            ON c.pk_club_id = pb.fk_club_id
     LEFT JOIN district_master d   ON d.pk_district_id = c.fk_district_id
     JOIN member_master_profile m  ON m.pk_member_master_profile_id = pb.fk_member_master_profile_id
     WHERE pb.isdeleted = 0
       AND pb.fk_club_id > 0
       AND dm.designation_name IN ('Club President', 'Club Secretary')
       AND py.IsCurrent = 0
       AND py.isdeleted = 0
       AND (@YearOnly IS NULL OR py.pk_year_id = @YearOnly)
       AND NOT EXISTS (
             SELECT 1 FROM board_of_directors cb
             JOIN designation_master cdm ON cdm.pk_designation_id = cb.fk_designation_id
             JOIN rotary_year_master cy  ON cy.pk_year_id = cb.fk_year_id
             WHERE cb.fk_club_id = pb.fk_club_id AND cb.fk_member_master_profile_id = pb.fk_member_master_profile_id
               AND cb.isdeleted = 0 AND cy.IsCurrent = 1 AND cdm.designation_name IN ('Club President', 'Club Secretary'))
       AND EXISTS (
             SELECT 1 FROM member_roles mr
             WHERE mr.fk_member_master_profile_id = pb.fk_member_master_profile_id AND mr.fk_role_id = @AdminRoleId
               AND mr.fk_club_id = pb.fk_club_id AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0)
     GROUP BY pb.fk_club_id, c.ClubName, d.DistrictNumber, pb.fk_member_master_profile_id, m.MemberName, m.EmailId
     ORDER BY d.DistrictNumber, c.ClubName, m.MemberName`,
    { AdminRoleId: ADMIN_ROLE_ID, YearOnly: yearOnly },
  )).map((r) => ({
    clubId: Number(r.ClubId), clubName: r.ClubName ?? null, districtNumber: r.DistrictNumber ?? null, memberId: Number(r.MemberId),
    memberName: r.MemberName ?? null, email: r.Email ?? null, pastRoles: r.PastRoles ?? null,
  }));
}

/** Port of RiAdminCleanupController.cs: SuperAdmin-only revoke of past-officer club-admin access. */
@Controller("api/admin/ri-admin-cleanup")
@Authorize()
export class RiAdminCleanupController {
  constructor(private readonly db: Db) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  @Get("preview")
  async preview(@User() u: CurrentUser, @Query("yearId") y?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const items = await findRevocationCandidates(this.db, queryInt(y));
    return ok({
      count: items.length,
      message: items.length === 0 ? "No past-officer admin access found to revoke." : `${items.length} club-admin grant(s) would be revoked. Nothing has been changed.`,
      items,
    });
  }

  @Post("execute")
  async execute(@User() u: CurrentUser, @Query("yearId") y?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const userId = this.userId(u);
    try {
      return await this.db.session((conn) => conn.transaction(async (tx) => {
        const items = await findRevocationCandidates(tx, queryInt(y));
        let rowsRevoked = 0;
        for (const c of items)
          rowsRevoked += await tx.execute(
            `UPDATE member_roles
             SET IsActive = 0, isdeleted = 1, RevokedDate = NOW(), RevokedBy = @UserId, modified_by = @UserId, modified_date = NOW()
             WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = @AdminRoleId AND fk_club_id = @ClubId AND fk_club_id > 0 AND IsActive = 1 AND isdeleted = 0`,
            { MemberId: c.memberId, ClubId: c.clubId, AdminRoleId: ADMIN_ROLE_ID, UserId: userId },
          );
        return ok({
          success: true, count: items.length, rowsRevoked,
          message: items.length === 0 ? "No past-officer admin access found to revoke." : `Revoked club-admin access for ${items.length} member(s).`,
          items,
        });
      }));
    } catch (e) {
      return badRequest({ message: `Cleanup failed: ${(e as Error).message}` });
    }
  }
}

import { Controller, Get, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { queryInt, queryString, requireQuery } from "../../common/binding";
import { badRequest, ok, statusCode } from "../../common/results";
import { Db } from "../../database/db.service";

const ACTIVE_CHAIN = `cm.IsActive = 1 AND cm.isdeleted = 0 AND c.IsActive = 1 AND c.isdeleted = 0
              AND d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0`;

/**
 * Port of MobileLoginCheckController.cs: SuperAdmin diagnostic for "why can't this member log in on
 * the app" — the member, the club list the app would show, and an allowed/not verdict. Read-only.
 */
@Controller("api/admin/mobile-login-check")
@Authorize()
export class MobileLoginCheckController {
  constructor(private readonly db: Db) {}

  @Get()
  async check(@User() u: CurrentUser, @Query("mobile") m?: string, @Query("countryId") c?: string) {
    requireQuery({ mobile: m });
    const caller = parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
    const sa = Number(await this.db.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0", { MemberId: caller }));
    if (sa === 0) return statusCode(403, { message: "SuperAdmin access required." });
    const mobile = queryString(m);
    if (!mobile || !mobile.trim()) return badRequest({ message: "Mobile number is required." });
    const trimmed = mobile.trim();
    const countryId = queryInt(c);

    // Country is optional here: the tool is a diagnostic, not a login.
    const member = await this.db.queryFirstOrDefault(
      `SELECT pk_member_master_profile_id AS id, MemberName, EmailId, PrimaryMobileNumber, fk_primary_country_id AS countryId
       FROM member_master_profile
       WHERE PrimaryMobileNumber = @Mobile ${countryId !== null ? "AND fk_primary_country_id = @CId" : ""} AND isdeleted = 0
       ORDER BY pk_member_master_profile_id ASC LIMIT 1`,
      { Mobile: trimmed, CId: countryId },
    );
    if (!member) return ok({ allowed: false, reason: "No active rotarian found with this mobile number.", mobile: trimmed, member: null, clubs: [] });
    const memberId = Number(member.id);
    const summary = { id: memberId, name: String(member.MemberName ?? ""), email: member.EmailId ?? null };
    const denied = (reason: string) => ok({ allowed: false, reason, mobile: trimmed, member: summary, clubs: [] });
    const roleCount = (role: string) => this.db.executeScalar(
      `SELECT COUNT(*) FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
       WHERE mr.fk_member_master_profile_id = @MemberId AND r.RoleName = @Role AND mr.IsActive = 1 AND mr.isdeleted = 0`,
      { MemberId: memberId, Role: role },
    ).then(Number);

    // A SuperAdmin-only member (no other role, no club) is web-only.
    if ((await roleCount("SuperAdmin")) > 0) {
      const other = Number(await this.db.executeScalar(
        `SELECT (SELECT COUNT(*) FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
                 WHERE mr.fk_member_master_profile_id = @MemberId AND r.RoleName <> 'SuperAdmin' AND mr.IsActive = 1 AND mr.isdeleted = 0)
              + (SELECT COUNT(*) FROM club_members WHERE fk_member_master_profile_id = @MemberId AND IsActive = 1 AND isdeleted = 0)`,
        { MemberId: memberId },
      ));
      if (other === 0) return denied("SuperAdmin-only member cannot login on mobile (no other role, no club membership). Web portal only.");
    }
    // RI Director is global; everyone else needs one fully active club→district→zone chain.
    if ((await roleCount("RIDirector")) === 0) {
      const chains = Number(await this.db.executeScalar(
        `SELECT COUNT(*) FROM club_members cm
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE cm.fk_member_master_profile_id = @MemberId AND ${ACTIVE_CHAIN}`,
        { MemberId: memberId },
      ));
      if (chains === 0) return denied("No active club→district→zone chain. Member has no usable club membership for mobile login.");
    }
    const clubs = await this.db.query(
      `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, CAST(NULL AS CHAR) AS clubCode, d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber,
              z.pk_zone_id AS zoneId, z.ZoneName AS zoneName
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.fk_member_master_profile_id = @MemberId AND ${ACTIVE_CHAIN}
       ORDER BY c.ClubName`,
      { MemberId: memberId },
    );
    return ok({ allowed: true, reason: null, mobile: trimmed, member: summary, clubs });
  }
}

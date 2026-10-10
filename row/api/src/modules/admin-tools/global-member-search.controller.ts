import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryString, routeInt } from "../../common/binding";
import { conflict, forbid, notFound, ok } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db } from "../../database/db.service";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { ClubService } from "../clubs/clubs.service";

/** One query per kind of detail for all members shown; __mid groups the rows and is removed. */
// A function: the COG club id comes from the brand, which is not initialised at import time.
const DETAILS = (): [string, string][] => [
  ["clubs", `SELECT cm.fk_member_master_profile_id AS __mid, c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, c.City AS city, c.State AS state,
              d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber, z.pk_zone_id AS zoneId, z.ZoneName AS zoneName,
              ${cogJoinedDateExpr("cm")} AS joinedDate, cm.IsActive AS isActive, ${cogSelectColumns("cm")},
              cm.TerminationDate AS terminationDate, cm.TerminationReason AS terminationReason
       FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.fk_member_master_profile_id IN @Ids AND cm.isdeleted = 0 ORDER BY cm.IsActive DESC, c.ClubName`],
  ["roles", `SELECT mr.fk_member_master_profile_id AS __mid, r.RoleName AS roleName,
              CASE WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                   WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin' ELSE r.RoleName END AS displayRole,
              mr.fk_club_id AS clubId, mr.fk_district_id AS districtId, mr.fk_zone_id AS zoneId, mr.IsActive AS isActive
       FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
       WHERE mr.fk_member_master_profile_id IN @Ids AND mr.isdeleted = 0 AND mr.IsActive = 1`],
  ["designations", `SELECT b.fk_member_master_profile_id AS __mid, dm.designation_name AS designationName, c.ClubName AS clubName, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
       FROM board_of_directors b JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id JOIN club_master c ON c.pk_club_id = b.fk_club_id
       JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
       WHERE b.fk_member_master_profile_id IN @Ids AND b.isdeleted = 0 ORDER BY y.pk_year_id DESC, dm.sort_order`],
  ["districtCommittee", `SELECT dcm.fk_member_id AS __mid, dcm.district_designation AS designation, dcm.district_remark AS remark, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
       FROM district_committee_member dcm JOIN district_master d ON d.pk_district_id = dcm.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
       WHERE dcm.fk_member_id IN @Ids AND dcm.isdeleted = 0 ORDER BY y.pk_year_id DESC`],
  ["groupCommittee", `SELECT gm.fk_member_id AS __mid, gm.district_designation AS designation, gm.district_remark AS remark, g.group_name AS groupName, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
       FROM district_committee_group_member gm JOIN district_committee_group g ON g.id = gm.fk_group_id JOIN district_master d ON d.pk_district_id = g.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
       WHERE gm.fk_member_id IN @Ids AND gm.isdeleted = 0 ORDER BY y.pk_year_id DESC`],
  ["subGroupCommittee", `SELECT sgm.fk_member_id AS __mid, sgm.district_designation AS designation, sgm.district_remark AS remark, sg.sub_group_name AS subGroupName, g.group_name AS groupName,
              d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
       FROM district_committee_sub_group_member sgm JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id JOIN district_committee_group g ON g.id = sg.fk_group_id
       JOIN district_master d ON d.pk_district_id = g.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
       WHERE sgm.fk_member_id IN @Ids AND sgm.isdeleted = 0 ORDER BY y.pk_year_id DESC`],
  ["districtGovernor", `SELECT dg.fk_member_id AS __mid, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
       FROM district_governors dg JOIN district_master d ON d.pk_district_id = dg.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = dg.fk_year_id
       WHERE dg.fk_member_id IN @Ids AND dg.isdeleted = 0 ORDER BY y.pk_year_id DESC`],
  ["pastPresident", `SELECT pp.fk_member_master_profile_id AS __mid, c.ClubName AS clubName, y.YearLabel AS yearLabel
       FROM past_presidents pp JOIN club_master c ON c.pk_club_id = pp.fk_club_id JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
       WHERE pp.fk_member_master_profile_id IN @Ids AND pp.isdeleted = 0 ORDER BY y.pk_year_id DESC`],
  ["assistantGovernor", `SELECT ag.fk_member_id AS __mid, c.ClubName AS clubName, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
       FROM district_ag ag JOIN club_master c ON c.pk_club_id = ag.fk_club_id JOIN district_master d ON d.pk_district_id = ag.fk_district_id
       LEFT JOIN rotary_year_master y ON y.pk_year_id = ag.fk_year_id
       WHERE ag.fk_member_id IN @Ids AND ag.isdeleted = 0 ORDER BY y.pk_year_id DESC`],
  ["clubModerator", `SELECT cmod.fk_member_id AS __mid, c.ClubName AS clubName, d.DistrictNumber AS districtNumber, cmod.is_active AS isActive
       FROM district_club_moderator cmod JOIN club_master c ON c.pk_club_id = cmod.fk_club_id JOIN district_master d ON d.pk_district_id = cmod.fk_district_id
       WHERE cmod.fk_member_id IN @Ids AND cmod.isdeleted = 0 ORDER BY c.ClubName`],
  ["clubSubGroups", `SELECT sgm.fk_member_master_profile_id AS __mid, sg.GroupName AS groupName, c.ClubName AS clubName, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
       FROM sub_group_members sgm JOIN sub_groups sg ON sg.pk_sub_group_id = sgm.fk_sub_group_id AND sg.isdeleted = 0 JOIN club_master c ON c.pk_club_id = sg.fk_club_id
       LEFT JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
       WHERE sgm.fk_member_master_profile_id IN @Ids AND sgm.isdeleted = 0 ORDER BY y.pk_year_id DESC`],
  ["events", `SELECT epm.fk_member_profile_id AS __mid, el.Title AS eventTitle, epm.Amount AS amount, epm.IsPaid AS isPaid, epm.PaymentDate AS paymentDate, epm.ClubName AS clubName,
              epm.DistrictNumber AS districtNumber
       FROM event_payment_members epm JOIN event_payment_links el ON el.pk_id = epm.fk_payment_link_id
       WHERE epm.fk_member_profile_id IN @Ids AND epm.isdeleted = 0 ORDER BY epm.created_date DESC`],
  ["membershipDues", `SELECT dp.fk_member_profile_id AS __mid, COALESCE(NULLIF(md.Purpose, ''), 'Membership Dues') AS purpose, md.RotaryYear AS rotaryYear, c.ClubName AS clubName,
              dp.FeeType AS feeType, dp.Amount AS amount, dp.IsPaid AS isPaid, dp.PaymentStatus AS paymentStatus, dp.PaymentDate AS paymentDate
       FROM membership_dues_payments dp JOIN membership_dues md ON md.pk_membership_dues_id = dp.fk_membership_dues_id JOIN club_master c ON c.pk_club_id = md.fk_club_id
       WHERE dp.fk_member_profile_id IN @Ids AND dp.isdeleted = 0 ORDER BY dp.created_date DESC`],
  ["directorySubmissions", `SELECT dsl.fk_member_id AS __mid, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel, dsl.GroupType AS groupType, dsl.CompletedCount AS completedCount,
              dsl.TotalCount AS totalCount, dsl.SubmittedAt AS submittedAt
       FROM district_directory_submission_log dsl JOIN district_directory_config cfg ON cfg.pk_id = dsl.fk_config_id JOIN district_master d ON d.pk_district_id = cfg.fk_district_id
       LEFT JOIN rotary_year_master y ON y.pk_year_id = cfg.fk_year_id
       WHERE dsl.fk_member_id IN @Ids ORDER BY dsl.SubmittedAt DESC`],
];

/** Port of GlobalMemberSearchController.cs: SuperAdmin member lookup with every link the member has. */
@Controller("api/admin/global-member-search")
@Authorize()
export class GlobalMemberSearchController {
  constructor(private readonly db: Db, private readonly clubs: ClubService) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  /** Members in a club, plus role holders with no club (e.g. RI Directors). */
  @Get()
  async search(@User() u: CurrentUser, @Query("search") s?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const term = (queryString(s) ?? "").trim();
    if (term.length < 2) return ok([]);
    const like = `(m.MemberName LIKE @Search OR m.EmailId LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.SecondaryMobileNumber LIKE @Search OR m.RotaryId LIKE @Search`;
    const members = await this.db.query(
      `SELECT * FROM (
           SELECT m.* FROM member_master_profile m
           INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
           INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
           WHERE m.isdeleted = 0 AND ${like} OR c.ClubName LIKE @Search)
           UNION
           SELECT m.* FROM member_master_profile m
           INNER JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id AND mr.isdeleted = 0 AND mr.IsActive = 1
           INNER JOIN roles r ON r.pk_role_id = mr.fk_role_id AND r.RoleName IN ('Admin','SuperAdmin','ZonalCoordinator','ClubModerator','AG','RIDirector')
           WHERE m.isdeleted = 0 AND ${like})
       ) u
       ORDER BY u.MemberName
       LIMIT 50`,
      { Search: `%${term}%` },
    );
    if (!Brand.feature("member.bloodGroup")) for (const m of members) if ("BloodGroup" in m) m.BloodGroup = null;
    const ids = members.map((m) => Number(m.pk_member_master_profile_id));
    const details = new Map<string, Map<number, Record<string, unknown>[]>>();
    for (const [key, sql] of DETAILS()) {
      const byMember = new Map<number, Record<string, unknown>[]>();
      if (ids.length)
        for (const r of await this.db.query(sql, { Ids: ids })) {
          const mid = Number(r.__mid);
          delete r.__mid;
          byMember.set(mid, [...(byMember.get(mid) ?? []), r]);
        }
      details.set(key, byMember);
    }
    return ok(members.map((member) => {
      const id = Number(member.pk_member_master_profile_id);
      return { member, ...Object.fromEntries(DETAILS().map(([key]) => [key, details.get(key)!.get(id) ?? []])) };
    }));
  }

  @Get(":memberId/card")
  async card(@User() u: CurrentUser, @Param("memberId") m: string) {
    const memberId = routeInt(m);
    if (!this.isSuperAdmin(u)) return forbid();
    const member = await this.db.queryFirstOrDefault(
      `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.RotaryId AS rotaryId, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
              pc.PhoneCode AS mobileCode, m.SecondaryMobileNumber AS secondaryMobile,
              CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL WHEN m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                   WHEN m.ProfilePhotoPath LIKE '/Documents/%' THEN m.ProfilePhotoPath ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END AS profilePhoto
       FROM member_master_profile m LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
       WHERE m.pk_member_master_profile_id = @Id AND COALESCE(m.isdeleted, 0) = 0`, { Id: memberId });
    if (!member) return notFound({ message: "Member not found." });
    const clubs = await this.db.query(
      `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, c.City AS city, c.State AS state,
              d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName, cm.IsActive AS isActive
       FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0 ORDER BY cm.IsActive DESC, c.ClubName`, { Id: memberId });
    return ok({ member, clubs });
  }

  /** Removes the member from every club through the club removal logic; the profile row is kept. */
  @Post(":id/soft-delete")
  async softDelete(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const exists = await this.db.executeScalar("SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: id });
    if (exists === null || exists === undefined) return notFound({ message: "Member not found or already deleted." });
    const clubIds = (await this.db.query("SELECT DISTINCT fk_club_id AS c FROM club_members WHERE fk_member_master_profile_id = @Id AND isdeleted = 0", { Id: id })).map((r) => Number(r.c));
    const by = this.userId(u);
    if (clubIds.length > 0) {
      // Each removal recomputes "last club", so the final one frees the mobile and clears address/family.
      for (const clubId of clubIds) await this.clubs.removeMember(clubId, id, by, null);
    } else {
      await this.db.execute(
        `UPDATE member_master_profile
         SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = '' THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
             PrimaryMobileNumber = NULL, modified_by = @By, modified_date = NOW()
         WHERE pk_member_master_profile_id = @Id AND PrimaryMobileNumber IS NOT NULL`, { Id: id, By: by });
      await this.db.execute("UPDATE member_address_details SET isdeleted = 1, modified_date = NOW() WHERE fk_member_master_profile_id = @Id AND isdeleted = 0", { Id: id });
      await this.db.execute("UPDATE member_family_details SET isdeleted = 1, modified_date = NOW() WHERE fk_member_master_profile_id = @Id AND isdeleted = 0", { Id: id });
    }
    return ok({ message: "Member removed. Mobile freed, address/family soft-deleted; profile kept." });
  }

  /** Mobile numbers and email only. A primary number held by someone else moves to their secondary slot. */
  @Put(":id/contact")
  async contact(@User() u: CurrentUser, @Param("id") idText: string, @Body() body: unknown) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const exists = await this.db.executeScalar("SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: id });
    if (exists === null || exists === undefined) return notFound({ message: "Member not found." });
    const clean = (k: string) => { const v = bodyField(body, k); const s = v === null || v === undefined ? "" : String(v).trim(); return s || null; };
    const [primary, secondary, email] = [clean("primaryMobileNumber"), clean("secondaryMobileNumber"), clean("emailId")];
    const by = this.userId(u);
    if (email !== null && Number(await this.db.executeScalar("SELECT COUNT(*) FROM member_master_profile WHERE EmailId = @E AND isdeleted = 0 AND pk_member_master_profile_id <> @Id", { E: email, Id: id })) > 0)
      return conflict({ message: "This email is already used by another active member." });
    await this.db.session((conn) => conn.transaction(async (tx) => {
      if (primary !== null)
        await tx.execute(
          `UPDATE member_master_profile
           SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = '' THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
               PrimaryMobileNumber = NULL, modified_by = @By, modified_date = NOW()
           WHERE PrimaryMobileNumber = @M AND pk_member_master_profile_id <> @Id`, { M: primary, Id: id, By: by });
      await tx.execute(
        "UPDATE member_master_profile SET PrimaryMobileNumber = @Primary, SecondaryMobileNumber = @Secondary, EmailId = @Email, modified_by = @By, modified_date = NOW() WHERE pk_member_master_profile_id = @Id",
        { Id: id, Primary: primary, Secondary: secondary, Email: email, By: by });
    }));
    return ok({ message: "Contact details updated." });
  }
}

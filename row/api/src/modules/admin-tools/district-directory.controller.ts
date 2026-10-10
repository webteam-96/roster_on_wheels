import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { queryString, requireQuery } from "../../common/binding";
import { badRequest, notFound, ok } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db } from "../../database/db.service";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { getClubPeerMemberIds, shouldShowEmail, shouldShowPhone, viewerMemberId } from "../../services/member-privacy.helper";

type Row = Record<string, unknown>;
const ADDRESS = (types: string) => `
  SELECT a.fk_member_master_profile_id AS memberId, a.Address AS address, a.City AS city, a.State AS state, a.PinCode AS pinCode, a.PhoneNumber AS phoneNumber, a.fk_country_id AS countryId
  FROM member_address_details a
  JOIN (SELECT fk_member_master_profile_id, MAX(pk_member_address_details_id) AS pk_id FROM member_address_details
        WHERE AddressType IN (${types}) AND COALESCE(isdeleted, 0) = 0 GROUP BY fk_member_master_profile_id) latest ON latest.pk_id = a.pk_member_address_details_id
  WHERE a.AddressType IN (${types}) AND COALESCE(a.isdeleted, 0) = 0`;
const COMMITTEE = (alias: string, table: string, where: string) => `
  SELECT ${alias}.*, m.*, c.ClubName, ${alias}.name AS committeeName,
         CASE WHEN COALESCE(${alias}.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> '' THEN m.PrimaryMobileNumber ELSE ${alias}.mobile END AS committeeMobile,
         CASE WHEN COALESCE(${alias}.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> '' THEN m.EmailId ELSE ${alias}.email END AS committeeEmail,
         ${alias}.district_designation AS districtDesignation, ${alias}.district_remark AS districtRemark,
         CASE WHEN COALESCE(${alias}.fk_member_id, 0) > 0 THEN
              CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                   WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                   ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
              ELSE ${alias}.profile_photo END AS committeePhoto, ${alias}.is_member AS isMember, ${alias}.sort_order AS sortOrder
  FROM ${table} ${alias}
  LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = ${alias}.fk_member_id AND m.isdeleted = 0
  LEFT JOIN club_master c ON c.pk_club_id = ${alias}.fk_club_id AND c.isdeleted = 0
  WHERE ${where} AND ${alias}.isdeleted = 0
  ORDER BY ${alias}.sort_order, ${alias}.name`;

/**
 * Port of DistrictDirectoryController.cs: everything the district directory PDF needs for one district and year
 * (committees, groups, clubs with BOD and members, AGs, moderators). Member rows carry m.* plus addresses, spouse,
 * classification and phone code, with the members' contact-privacy flags applied.
 */
@Controller("api/district-directory")
@Authorize()
export class DistrictDirectoryController {
  constructor(private readonly db: Db) {}

  @Get(":districtNumber")
  async directory(@User() u: CurrentUser, @Param("districtNumber") districtNumber: string, @Query("rotaryYear") ry?: string) {
    requireQuery({ rotaryYear: ry });
    const rotaryYear = queryString(ry);
    if (!rotaryYear || !rotaryYear.trim()) return badRequest({ message: "rotaryYear is required (e.g. 2025-2026)." });
    // An inactive district's directory is not published.
    const district = await this.db.queryFirstOrDefault("SELECT * FROM district_master WHERE DistrictNumber = @Num AND isdeleted = 0 AND IsActive = 1", { Num: districtNumber });
    if (!district) return notFound({ message: `District '${districtNumber}' not found.` });
    const districtId = Number(district.pk_district_id);
    const year = await this.db.queryFirstOrDefault(
      "SELECT pk_year_id AS id, YearLabel AS yearLabel, StartDate AS startDate, EndDate AS endDate, IsCurrent AS isCurrent FROM rotary_year_master WHERE YearLabel = @Label", { Label: rotaryYear.trim() });
    if (!year) return notFound({ message: `Rotary year '${rotaryYear}' not found.` });
    const yearId = Number(year.id);
    const yearLabels = new Map((await this.db.query("SELECT pk_year_id AS id, YearLabel AS label FROM rotary_year_master")).map((r) => [Number(r.id), String(r.label)]));

    const familyOn = Brand.feature("member.familyDetails"), bloodOn = Brand.feature("member.bloodGroup");
    const byMember = (rows: Row[]) => new Map(rows.map((r) => {
      const { memberId, ...rest } = r;
      return [Number(memberId), rest];
    }));
    const residential = byMember(await this.db.query(ADDRESS("'Residential','Residence'")));
    const business = byMember(await this.db.query(ADDRESS("'Business'")));
    // The latest-changed spouse row (the one Directory Data Collection reads and saves).
    const spouses = familyOn ? byMember(await this.db.query(
      `SELECT f.fk_member_master_profile_id AS memberId, f.Name AS spouseName, f.BirthDate AS spouseDob,
              CASE WHEN f.PhotoPath IS NULL OR f.PhotoPath = '' THEN NULL WHEN f.PhotoPath LIKE '/%' THEN f.PhotoPath WHEN f.PhotoPath LIKE 'http%' THEN f.PhotoPath
                   ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(f.PhotoPath, '/', -1)) END AS spousePhoto
       FROM member_family_details f
       JOIN (SELECT pk_member_family_details_id AS pk_id,
                    ROW_NUMBER() OVER (PARTITION BY fk_member_master_profile_id ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC) AS rn
             FROM member_family_details WHERE LOWER(TRIM(Relation)) = 'spouse' AND COALESCE(isdeleted,0) = 0) latest
         ON latest.pk_id = f.pk_member_family_details_id AND latest.rn = 1`)) : new Map<number, Row>();
    const classification = new Map((await this.db.query(
      `SELECT cm.fk_member_master_profile_id AS memberId, cm.ClassificationProfession AS classification FROM club_members cm
       JOIN (SELECT fk_member_master_profile_id, MIN(pk_club_member_id) AS pk_id FROM club_members
             WHERE COALESCE(isdeleted,0) = 0 AND IsActive = 1 AND ClassificationProfession IS NOT NULL AND ClassificationProfession <> ''
             GROUP BY fk_member_master_profile_id) pick ON pick.pk_id = cm.pk_club_member_id`)).map((r) => [Number(r.memberId), r.classification ?? null]));
    const mobileCodes = byMember(await this.db.query(
      `SELECT m.pk_member_master_profile_id AS memberId, cty.PhoneCode AS phoneCode, cty.pk_country_id AS countryId, cty.CountryName AS countryName
       FROM member_master_profile m LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id WHERE m.isdeleted = 0`));
    const viewer = viewerMemberId(u);
    const peers = await getClubPeerMemberIds(this.db, viewer);

    const enrich = (row: Row): Row => {
      const d: Row = { ...row };
      const midRaw = row.pk_member_master_profile_id;
      const mid = midRaw === null || midRaw === undefined ? null : Number(midRaw);
      const sp = mid !== null ? spouses.get(mid) : undefined;
      const mc = mid !== null ? mobileCodes.get(mid) : undefined;
      const pp = typeof row.ProfilePhotoPath === "string" && row.ProfilePhotoPath.trim() ? row.ProfilePhotoPath : null;
      if (mid !== null) {
        const shares = peers.has(mid);
        if (!shouldShowPhone(viewer, mid, shares, d.ShowPhoneInMyClub, d.ShowPhoneInAllClubs)) {
          d.PrimaryMobileNumber = null;
          // A hidden live number falls back to the district's own typed copy.
          if ("committeeMobile" in d) d.committeeMobile = d.mobile ?? null;
          if ("agMobile" in d) d.agMobile = null;
          if ("moderatorMobile" in d) d.moderatorMobile = null;
        }
        if (!shouldShowEmail(viewer, mid, shares, d.ShowEmailInMyClub, d.ShowEmailInAllClubs)) {
          d.EmailId = null;
          if ("committeeEmail" in d) d.committeeEmail = d.email ?? null;
          if ("agEmail" in d) d.agEmail = null;
          if ("moderatorEmail" in d) d.moderatorEmail = null;
        }
      }
      if (!bloodOn && "BloodGroup" in d) d.BloodGroup = null;
      Object.assign(d, {
        residentialAddress: (mid !== null && residential.get(mid)) || null, businessAddress: (mid !== null && business.get(mid)) || null,
        classification: (mid !== null && classification.get(mid)) ?? null,
        spouseName: sp?.spouseName ?? null, spouseDob: sp?.spouseDob ?? null, spousePhoto: sp?.spousePhoto ?? null,
        mobileCountryCode: mc?.phoneCode ?? null, mobileCountryId: mc?.countryId === null || mc?.countryId === undefined ? null : Number(mc.countryId), mobileCountryName: mc?.countryName ?? null,
        profilePhoto: pp === null ? null : pp.startsWith("/") || pp.startsWith("http") ? pp : `/Documents/directory/${pp.slice(pp.lastIndexOf("/") + 1)}`,
      });
      return d;
    };

    const districtCommittee = (await this.db.query(COMMITTEE("dcm", "district_committee_member", "dcm.fk_district_id = @DistrictId AND dcm.fk_year_id = @YearId"), { DistrictId: districtId, YearId: yearId })).map(enrich);
    const groups = [];
    for (const g of await this.db.query(
      "SELECT g.id, g.group_name AS groupName, g.sort_order AS sortOrder, g.is_active AS isActive FROM district_committee_group g WHERE g.fk_district_id = @DistrictId AND g.fk_year_id = @YearId AND g.isdeleted = 0 ORDER BY g.sort_order, g.group_name",
      { DistrictId: districtId, YearId: yearId })) {
      const members = (await this.db.query(COMMITTEE("gm", "district_committee_group_member", "gm.fk_group_id = @GroupId"), { GroupId: g.id })).map(enrich);
      const subGroups = [];
      for (const sg of await this.db.query(
        "SELECT sg.id, sg.sub_group_name AS subGroupName, sg.sort_order AS sortOrder, sg.is_active AS isActive FROM district_committee_sub_group sg WHERE sg.fk_group_id = @GroupId AND sg.isdeleted = 0 ORDER BY sg.sort_order, sg.sub_group_name",
        { GroupId: g.id }))
        subGroups.push({ id: sg.id, subGroupName: sg.subGroupName, sortOrder: sg.sortOrder, isActive: sg.isActive,
          members: (await this.db.query(COMMITTEE("sgm", "district_committee_sub_group_member", "sgm.fk_sub_group_id = @SubGroupId"), { SubGroupId: sg.id })).map(enrich) });
      groups.push({ id: g.id, groupName: g.groupName, sortOrder: g.sortOrder, isActive: g.isActive, members, subGroups });
    }

    const agRows = await this.db.query(
      `SELECT ag.fk_club_id AS clubId, ag.fk_year_id AS yearId, ag.fk_member_id AS memberId, m.MemberName AS agName, m.PrimaryMobileNumber AS agMobile, m.EmailId AS agEmail,
              m.ProfilePhotoPath AS agPhoto, cty.PhoneCode AS agMobileCountryCode, m.*
       FROM district_ag ag JOIN member_master_profile m ON m.pk_member_master_profile_id = ag.fk_member_id AND m.isdeleted = 0
       LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
       WHERE ag.fk_district_id = @DistrictId AND ag.is_active = 1 AND ag.isdeleted = 0`, { DistrictId: districtId });
    // Per club: the AG of the requested year, else the most recent one.
    const agByClub = new Map<number, Row>();
    const agGroups = new Map<number, Row[]>();
    for (const r of agRows) agGroups.set(Number(r.clubId), [...(agGroups.get(Number(r.clubId)) ?? []), r]);
    for (const [clubId, grp] of agGroups) {
      const pick = grp.find((r) => r.yearId !== null && Number(r.yearId) === yearId) ?? [...grp].sort((a, b) => Number(b.yearId ?? -1) - Number(a.yearId ?? -1))[0];
      agByClub.set(clubId, { ...enrich(pick), agMemberId: Number(pick.memberId), agYearId: pick.yearId === null || pick.yearId === undefined ? null : Number(pick.yearId) });
    }
    const modRows = await this.db.query(
      `SELECT cm.fk_club_id AS clubId, cm.fk_member_id AS memberId, m.MemberName AS moderatorName, m.PrimaryMobileNumber AS moderatorMobile, m.EmailId AS moderatorEmail,
              m.ProfilePhotoPath AS moderatorPhoto, cty.PhoneCode AS moderatorMobileCountryCode, m.*
       FROM district_club_moderator cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_id AND m.isdeleted = 0
       LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
       WHERE cm.fk_district_id = @DistrictId AND cm.is_active = 1 AND cm.isdeleted = 0`, { DistrictId: districtId });
    const moderatorByClub = new Map(modRows.map((m) => [Number(m.clubId), { ...enrich(m), moderatorMemberId: Number(m.memberId) }]));

    const clubs = await this.db.query("SELECT c.* FROM club_master c WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 ORDER BY c.ClubName", { DistrictId: districtId });
    const clubResult = [];
    for (const club of clubs) {
      const clubId = Number(club.pk_club_id);
      // BOD of the requested year, else the latest earlier year with data (per club).
      const bodRaw = await this.db.query(
        `SELECT b.pk_board_director_id AS id, b.fk_designation_id AS designationId, b.fk_year_id AS effectiveYearId, d.designation_name AS designationName,
                d.sort_order AS designationSortOrder, m.*
         FROM board_of_directors b
         JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
         LEFT JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
         WHERE b.fk_club_id = @ClubId AND b.isdeleted = 0
           AND b.fk_year_id = (SELECT MAX(bb.fk_year_id) FROM board_of_directors bb WHERE bb.fk_club_id = @ClubId AND bb.fk_year_id <= @YearId AND bb.isdeleted = 0)
         ORDER BY d.sort_order, d.designation_name`, { ClubId: clubId, YearId: yearId });
      const effYear = bodRaw.length && bodRaw[0].effectiveYearId !== null && bodRaw[0].effectiveYearId !== undefined ? Number(bodRaw[0].effectiveYearId) : null;
      const members = (await this.db.query(
        `SELECT cm.pk_club_member_id AS clubMemberId, ${cogJoinedDateExpr("cm")} AS joinedDate, ${cogSelectColumns("cm")},
                cm.IsActive AS membershipActive, cm.TerminationDate, cm.TerminationReason, m.*
         FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 ORDER BY m.MemberName`, { ClubId: clubId })).map(enrich);
      clubResult.push({
        club, assistantGovernor: agByClub.get(clubId) ?? null, clubModerator: moderatorByClub.get(clubId) ?? null, boardOfDirectors: bodRaw.map(enrich),
        boardOfDirectorsYearId: effYear, boardOfDirectorsYearLabel: effYear !== null ? (yearLabels.get(effYear) ?? null) : null,
        boardOfDirectorsIsFallback: effYear !== null && effYear !== yearId, members,
      });
    }

    // Rosters: each AG / moderator with the clubs assigned to them.
    const clubName = new Map(clubs.map((c) => [Number(c.pk_club_id), String(c.ClubName ?? "")]));
    const roster = (rows: Row[], idKey: string, nameKey: string, withYear: boolean) => {
      const groupsBy = new Map<number, Row[]>();
      for (const r of rows) groupsBy.set(Number(r.memberId), [...(groupsBy.get(Number(r.memberId)) ?? []), r]);
      return [...groupsBy.values()].map((grp) => {
        const head = grp[0];
        const assigned = grp.map((r) => ({ clubId: Number(r.clubId), clubName: clubName.get(Number(r.clubId)) ?? null, ...(withYear ? { yearId: r.yearId === null || r.yearId === undefined ? null : Number(r.yearId) } : {}) }));
        return { ...enrich(head), [idKey]: Number(head.memberId), clubCount: assigned.length, clubs: assigned };
      }).sort((a, b) => String(a[nameKey] ?? "").localeCompare(String(b[nameKey] ?? "")));
    };

    if (!bloodOn) for (const c of clubs) if ("BloodGroup" in c) c.BloodGroup = null;
    return ok({
      district, rotaryYear: year, districtCommittee, groups, clubs: clubResult,
      assistantGovernors: roster(agRows, "agMemberId", "agName", true), clubModerators: roster(modRows, "moderatorMemberId", "moderatorName", false),
    });
  }
}

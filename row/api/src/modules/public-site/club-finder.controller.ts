import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { paramInt, queryInt, queryNumber, queryString } from "../../common/binding";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { buildWebsiteUrl } from "../../services/member-scopes.helper";
import { shouldShowEmail, shouldShowPhone, viewerMemberId, viewerSharesClub, viewerSharesClubWithMember } from "../../services/member-privacy.helper";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { EVENT_IMAGE, MEMBER_PHOTO } from "./public-site.helpers";

const CLUB_LOGO = `CASE WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath ELSE CONCAT('/uploads/club/', c.ClubLogoPath) END`;
const CLUB_COLUMNS = `c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, ${CLUB_LOGO} AS clubLogo, c.City AS city, c.State AS state, c.Country AS country,
  c.MeetingDay AS meetingDay, c.MeetingAddress AS meetingAddress, c.Latitude AS latitude, c.Longitude AS longitude, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName,
  c.IsSyncedFromRotaryOrg AS isSyncedFromRotaryOrg`;
const PRESIDENT_OR_SECRETARY = (where: string) => `SELECT m.MemberName AS name, ${MEMBER_PHOTO()} AS profilePhoto
  FROM board_of_directors b
  JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
  JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
  WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0 AND ${where} ORDER BY dm.sort_order LIMIT 1`;

function paging(page: number, pageSize: number) {
  return { page: page < 1 ? 1 : page, pageSize: pageSize < 1 ? 20 : pageSize > 100 ? 100 : pageSize };
}

/** Port of ClubFinderController.cs: the mobile Club Finder (signed-in users only). */
@Controller("api/mobile/club-finder")
@Authorize()
export class ClubFinderController {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver) {}

  private blocked = async (clubId: number) => (!(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null);
  private currentYear = async (conn: DbCommands) => { const v = await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1"); return v === null || v === undefined ? null : Number(v); };

  /** Filter mode: needs at least one filter, and a keyword of 2+ characters. */
  @Get()
  async search(@Query("keyword") k?: string, @Query("countryId") co?: string, @Query("state") s?: string, @Query("districtNumber") dn?: string, @Query("meetingDay") m?: string,
               @Query("page") pq?: string, @Query("pageSize") sq?: string) {
    const kw = queryString(k)?.trim() ?? "", countryId = queryInt(co), st = queryString(s)?.trim() ?? "", dnum = queryString(dn)?.trim() ?? "", md = queryString(m)?.trim() ?? "";
    let page = queryInt(pq, 1), pageSize = queryInt(sq, 20);
    if (!(kw || countryId !== null || st || dnum || md) || (kw && kw.length < 2)) return ok({ items: [], totalCount: 0, page, pageSize });
    ({ page, pageSize } = paging(page, pageSize));
    let where = `
      FROM club_master c
      JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
      LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
      LEFT JOIN country_master co ON co.CountryName = c.Country AND co.isdeleted = 0
      WHERE c.isdeleted = 0 AND c.IsActive = 1`;
    const p: Record<string, unknown> = {};
    if (kw) {
      where += ` AND (c.ClubName LIKE @Kw OR c.ClubRotaryId LIKE @Kw OR c.City LIKE @Kw OR c.State LIKE @Kw OR c.Country LIKE @Kw OR c.MeetingAddress LIKE @Kw
                 OR c.MeetingDay LIKE @Kw OR d.DistrictNumber LIKE @Kw OR z.ZoneName LIKE @Kw OR CAST(c.pk_club_id AS CHAR) = @KwExact)`;
      p.Kw = `%${kw}%`;
      p.KwExact = kw;
    }
    if (countryId !== null) { where += " AND co.pk_country_id = @CountryId"; p.CountryId = countryId; }
    if (st) { where += " AND c.State LIKE @State"; p.State = `%${st}%`; }
    if (dnum) { where += " AND d.DistrictNumber LIKE @DistrictNumber"; p.DistrictNumber = `%${dnum}%`; }
    if (md) { where += " AND c.MeetingDay LIKE @MeetingDay"; p.MeetingDay = `%${md}%`; }
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) ${where}`, p));
      const items = await conn.query(`SELECT ${CLUB_COLUMNS} ${where} ORDER BY c.ClubName LIMIT @PageSize OFFSET @Offset`, { ...p, Offset: (page - 1) * pageSize, PageSize: pageSize });
      return ok({ items, totalCount, page, pageSize });
    });
  }

  /** Near-me mode: a bounding box, then the haversine distance (km), at most 200 km. */
  @Get("near-me")
  async nearMe(@Query("userLatitude") la?: string, @Query("userLongitude") lo?: string, @Query("range") r?: string, @Query("meetingDay") m?: string,
               @Query("page") pq?: string, @Query("pageSize") sq?: string) {
    const lat = queryNumber(la), lng = queryNumber(lo), range = queryNumber(r);
    if (lat === null || lng === null) return badRequest({ message: "userLatitude and userLongitude are required." });
    if (range === null || range <= 0) return badRequest({ message: "range (in km) is required and must be > 0." });
    if (range > 200) return badRequest({ message: "range cannot exceed 200 km." });
    const { page, pageSize } = paging(queryInt(pq, 1), queryInt(sq, 20));
    const md = queryString(m)?.trim() ?? "";
    const latDelta = range / 111, lngDelta = range / (111 * Math.cos((lat * Math.PI) / 180));
    let where = `
      FROM club_master c
      JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
      LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
      WHERE c.isdeleted = 0 AND c.IsActive = 1 AND c.Latitude IS NOT NULL AND c.Longitude IS NOT NULL
        AND c.Latitude BETWEEN @MinLat AND @MaxLat AND c.Longitude BETWEEN @MinLng AND @MaxLng`;
    const p: Record<string, unknown> = { UserLat: lat, UserLng: lng, Range: range, MinLat: lat - latDelta, MaxLat: lat + latDelta, MinLng: lng - lngDelta, MaxLng: lng + lngDelta };
    if (md) { where += " AND c.MeetingDay LIKE @MeetingDay"; p.MeetingDay = `%${md}%`; }
    // Haversine (stable at small angles); LEAST guards ASIN against a value drifting just above 1.
    const dist = `(2 * 6371 * ASIN(LEAST(1.0, SQRT(POWER(SIN(RADIANS(c.Latitude - @UserLat) / 2), 2)
      + COS(RADIANS(@UserLat)) * COS(RADIANS(c.Latitude)) * POWER(SIN(RADIANS(c.Longitude - @UserLng) / 2), 2)))))`;
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM (SELECT ${dist} AS dist ${where}) t WHERE t.dist <= @Range`, p));
      const items = await conn.query(`SELECT ${CLUB_COLUMNS}, ROUND(${dist}, 2) AS distanceKm ${where} HAVING distanceKm <= @Range ORDER BY distanceKm LIMIT @PageSize OFFSET @Offset`,
        { ...p, Offset: (page - 1) * pageSize, PageSize: pageSize });
      return ok({ items, totalCount, page, pageSize });
    });
  }

  @Get("members/:memberId")
  async memberDetail(@Param("memberId") mid: string, @User() u: CurrentUser) {
    const memberId = paramInt(mid, "memberId");
    return this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${MEMBER_PHOTO()} AS profilePhoto, m.RotaryId AS rotaryId, m.EmailId AS email,
                m.PrimaryMobileNumber AS primaryMobile, m.SecondaryMobileNumber AS secondaryMobile, m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
                m.BloodGroup AS bloodGroup, m.Gender AS gender, m.PrimaryLanguage AS primaryLanguage, m.MemberIntroduction AS introduction, m.Facebook AS facebook,
                m.Instagram AS instagram, m.LinkedIn AS linkedIn, m.Twitter AS twitter, m.Youtube AS youtube, m.Website AS website, m.DonorRecognition AS donorRecognition,
                CASE WHEN m.FamilyPhotoPath IS NULL OR m.FamilyPhotoPath = '' THEN NULL WHEN m.FamilyPhotoPath LIKE '/Documents/directory/%' THEN m.FamilyPhotoPath
                     ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.FamilyPhotoPath, '/', -1)) END AS familyPhoto,
                m.IsPersonalDetailsVisible AS isPersonalDetailsVisible, m.IsFamilyDetailsVisible AS isFamilyDetailsVisible, m.IsYouth AS isYouth,
                m.ShowPhoneInMyClub AS showPhoneInMyClub, m.ShowPhoneInAllClubs AS showPhoneInAllClubs, m.ShowEmailInMyClub AS showEmailInMyClub, m.ShowEmailInAllClubs AS showEmailInAllClubs,
                pc.CountryName AS primaryCountry, pc.PhoneCode AS primaryPhoneCode, sc.CountryName AS secondaryCountry, sc.PhoneCode AS secondaryPhoneCode
         FROM member_master_profile m
         LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
         LEFT JOIN country_master sc ON sc.pk_country_id = m.fk_secondary_country_id
         WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0`, { Id: memberId });
      if (!member) return notFound({ message: "Member not found." });
      // Cross-club: "my club" visibility applies only when the viewer shares an active club with this member.
      const viewer = viewerMemberId(u);
      const shares = await viewerSharesClubWithMember(conn, viewer, memberId);
      if (!shouldShowPhone(viewer, memberId, shares, member.showPhoneInMyClub, member.showPhoneInAllClubs)) member.primaryMobile = null;
      if (!shouldShowEmail(viewer, memberId, shares, member.showEmailInMyClub, member.showEmailInAllClubs)) member.email = null;
      for (const k of ["showPhoneInMyClub", "showPhoneInAllClubs", "showEmailInMyClub", "showEmailInAllClubs"]) delete member[k];
      if (!Brand.feature("member.bloodGroup")) member.bloodGroup = null;
      if (!Brand.feature("member.familyDetails")) member.familyPhoto = null;
      const addresses = await conn.query(
        `SELECT a.AddressType AS addressType, a.PhoneNumber AS phoneNumber, a.Address AS address, a.City AS city, a.State AS state, a.PinCode AS pinCode, co.CountryName AS country,
                a.BusinessName AS businessName, a.BusinessEmailId AS businessEmail, a.Keywords AS keywords
         FROM member_address_details a LEFT JOIN country_master co ON co.pk_country_id = a.fk_country_id
         WHERE a.fk_member_master_profile_id = @Id AND a.isdeleted = 0`, { Id: memberId });
      const clubs = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, ${CLUB_LOGO} AS clubLogo, ${cogJoinedDateExpr("cm")} AS joinedDate, ${cogSelectColumns("cm")},
                d.DistrictNumber AS districtNumber, cm.Designation AS designation, cm.ClassificationProfession AS profession
         FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0 AND cm.IsActive = 1 ORDER BY cm.JoinedDate DESC`, { Id: memberId });
      const yearId = await this.currentYear(conn);
      const currentRoles = yearId === null ? [] : await conn.query(
        `SELECT b.fk_club_id AS clubId, c.ClubName AS clubName, dm.designation_name AS designationName, dm.sort_order AS sortOrder
         FROM board_of_directors b JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0 JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
         WHERE b.fk_member_master_profile_id = @Id AND b.fk_year_id = @YearId AND b.isdeleted = 0 ORDER BY dm.sort_order`, { Id: memberId, YearId: yearId });
      return ok({ member, addresses, clubs, currentRoles });
    });
  }

  @Get("events/:eventId")
  async eventDetail(@Param("eventId") e: string) {
    const eventId = paramInt(e, "eventId");
    const ev = await this.db.queryFirstOrDefault(
      `SELECT e.pk_upcoming_event_id AS eventId, e.fk_club_id AS clubId, c.ClubName AS clubName, ${CLUB_LOGO} AS clubLogo, d.DistrictNumber AS districtNumber, e.Title AS title,
              e.Description AS description, ${EVENT_IMAGE("e.")} AS imagePath, e.EventDate AS eventDate, e.PublishDate AS publishDate, e.ExpiryDate AS expiryDate,
              e.EventVenue AS venue, e.RegistrationLink AS registrationLink, e.Status AS status, cb.MemberName AS organizerName, cb.EmailId AS organizerEmail,
              cb.PrimaryMobileNumber AS organizerMobile
       FROM upcoming_events e JOIN club_master c ON c.pk_club_id = e.fk_club_id LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN member_master_profile cb ON cb.pk_member_master_profile_id = e.created_by
       WHERE e.pk_upcoming_event_id = @Id AND e.isdeleted = 0`, { Id: eventId });
    return ev ? ok(ev) : notFound({ message: "Event not found." });
  }

  @Get("projects/:projectId")
  async projectDetail(@Param("projectId") pr: string, @Query("yearId") y?: string) {
    const projectId = paramInt(pr, "projectId");
    const yearId = queryInt(y);
    return this.db.session(async (conn) => {
      let info: YearTableInfo | null = null;
      if (yearId !== null && yearId > 0) info = await this.yearTables.resolveByYearId(conn, yearId);
      else for (const t of await this.yearTables.getAllExistingYearTables(conn))
        if (Number(await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: projectId })) > 0) { info = t; break; }
      if (!info) return notFound({ message: "Project not found." });
      const project = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id AS projectId, p.fk_club_id AS clubId, c.ClubName AS clubName, ${CLUB_LOGO} AS clubLogo, d.DistrictNumber AS districtNumber, y.YearLabel AS yearName,
                p.title AS title, p.description AS description, p.location AS location, p.project_date AS projectDate, p.project_cost AS projectCost,
                p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved,
                COALESCE(p.rcc_involved,0) AS rccInvolved, p.project_type AS projectType, p.is_joint_project AS isJointProject, p.co_host_name AS coHostName, p.club_role AS clubRole,
                p.ongoing_group_title AS ongoingGroupTitle, md.ModuleName AS moduleName, a.name AS areaOfFocus, p.other_area_of_focus AS otherAreaOfFocus, cat.name AS categoryName,
                p.other_category AS otherCategory, sub.name AS subCategoryName, p.other_sub_category AS otherSubCategory, f.name AS fundingName, cb.MemberName AS createdByName,
                cb.EmailId AS createdByEmail, cb.PrimaryMobileNumber AS createdByMobile, p.created_date AS createdDate
         FROM \`${info.projectsTable}\` p
         JOIN club_master c ON c.pk_club_id = p.fk_club_id
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
         LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
         LEFT JOIN area_of_focus_master a ON a.pk_area_of_focus_id = p.fk_area_of_focus_id
         LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
         LEFT JOIN sub_category_master sub ON sub.pk_sub_category_id = p.fk_sub_category_id
         LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
         LEFT JOIN member_master_profile cb ON cb.pk_member_master_profile_id = p.created_by
         WHERE p.pk_project_id = @Id AND p.isdeleted = 0`, { Id: projectId });
      if (!project) return notFound({ message: "Project not found." });
      const suffix = info.yearLabel.replace(/-/g, "_");
      const photos = await conn.query(
        `SELECT ph.pk_photo_id AS photoId,
                CONCAT('/Documents/gallery/Group', @ClubId, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', ph.image_path) AS imagePath,
                ph.description AS description
         FROM \`${info.photosTable}\` ph JOIN \`${info.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id
         WHERE ph.fk_project_id = @Id ORDER BY ph.pk_photo_id`, { Id: projectId, ClubId: project.clubId === null ? 0 : Number(project.clubId) });
      return ok({ project, photos });
    });
  }

  /** The club, its President and Secretary this year, and its live club / district websites. */
  @Get(":clubId")
  async detail(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const club = await conn.queryFirstOrDefault(
        `SELECT c.*, d.DistrictNumber AS districtNumber, d.pk_district_id AS districtId, z.ZoneName AS zoneName
         FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE c.pk_club_id = @Id AND c.isdeleted = 0`, { Id: clubId });
      if (!club) return notFound({ message: "Club not found." });
      const yearId = await this.currentYear(conn);
      const p = { ClubId: clubId, YearId: yearId };
      const president = yearId === null ? null : await conn.queryFirstOrDefault(PRESIDENT_OR_SECRETARY(
        "LOWER(dm.designation_name) LIKE '%president%' AND LOWER(dm.designation_name) NOT LIKE '%vice%' AND LOWER(dm.designation_name) NOT LIKE '%past%'"), p);
      const secretary = yearId === null ? null : await conn.queryFirstOrDefault(PRESIDENT_OR_SECRETARY(
        "LOWER(dm.designation_name) LIKE '%secretary%' AND LOWER(dm.designation_name) NOT LIKE '%joint%'"), p);
      const setting = async (k: string) => { const v = await conn.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = @K", { K: k }); return v && v.trim() ? v : null; };
      const clubParent = (await setting("ClubWebsiteParentDomain")) ?? Brand.Current.domains.clubSiteParent;
      const districtParent = (await setting("DistrictWebsiteParentDomain")) ?? clubParent;
      // The app opens clientDomain as given: the final URL when a site is live, else "" (never "na" / "null").
      const site = (row: Record<string, unknown> | null, parent: string) => {
        if (!row) return { clientDomain: "", subdomain: "", status: "" };
        const cd = (row.clientDomain as string | null)?.trim() ?? null, sd = (row.subdomain as string | null)?.trim() ?? null;
        return { clientDomain: buildWebsiteUrl(cd, sd, parent), subdomain: sd ?? "", status: (row.status as string | null) ?? "" };
      };
      // Expired club sites count as none; district sites have no dates, only a status.
      const clubWebsite = site(await conn.queryFirstOrDefault(
        `SELECT Subdomain AS subdomain, ClientDomain AS clientDomain, Status AS status FROM club_websites
         WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0 AND Status = 'Active' AND CURDATE() BETWEEN StartDate AND EndDate LIMIT 1`, p), clubParent);
      const districtId = club.districtId === null || club.districtId === undefined ? null : Number(club.districtId);
      const districtWebsite = districtId === null ? site(null, districtParent) : site(await conn.queryFirstOrDefault(
        "SELECT Subdomain AS subdomain, ClientDomain AS clientDomain, Status AS status FROM district_websites WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND Status = 'Active' LIMIT 1",
        { DistrictId: districtId }), districtParent);
      return ok({ club, president, secretary, clubWebsite, districtWebsite });
    });
  }

  /** Paged active roster; contact details follow each member's visibility toggles for this viewer. */
  @Get(":clubId/members")
  async members(@Param("clubId") c: string, @User() u: CurrentUser, @Query("page") pq?: string, @Query("pageSize") sq?: string, @Query("search") s?: string) {
    const clubId = paramInt(c, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    const { page, pageSize } = paging(queryInt(pq, 1), queryInt(sq, 20));
    const search = queryString(s);
    return this.db.session(async (conn) => {
      const yearId = await this.currentYear(conn);
      let where = `
        FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
        WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND cm.IsActive = 1`;
      const p: Record<string, unknown> = { ClubId: clubId };
      if (search && search.trim()) {
        where += " AND (m.MemberName LIKE @S OR m.RotaryId LIKE @S OR m.EmailId LIKE @S OR m.PrimaryMobileNumber LIKE @S)";
        p.S = `%${search.trim()}%`;
      }
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) ${where}`, p));
      const raw = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${MEMBER_PHOTO()} AS profilePhoto, m.RotaryId AS rotaryId, m.EmailId AS email,
                m.PrimaryMobileNumber AS mobile, m.ShowPhoneInMyClub AS showPhoneInMyClub, m.ShowPhoneInAllClubs AS showPhoneInAllClubs, m.ShowEmailInMyClub AS showEmailInMyClub,
                m.ShowEmailInAllClubs AS showEmailInAllClubs, ${cogJoinedDateExpr("cm")} AS joinedDate, ${cogSelectColumns("cm")}, COALESCE(cm.IsHonoraryMember, 0) AS isHonorary,
                (SELECT GROUP_CONCAT(dm.designation_name ORDER BY dm.sort_order SEPARATOR ', ') FROM board_of_directors b
                 JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                 WHERE b.fk_club_id = @ClubId AND b.fk_member_master_profile_id = m.pk_member_master_profile_id AND b.fk_year_id = @YearId AND b.isdeleted = 0) AS currentDesignation
         ${where} ORDER BY m.MemberName LIMIT @PageSize OFFSET @Offset`, { ...p, YearId: yearId, Offset: (page - 1) * pageSize, PageSize: pageSize });
      const viewer = viewerMemberId(u);
      const shares = await viewerSharesClub(conn, viewer, clubId);
      const items = raw.map((r) => {
        const id = Number(r.memberId);
        return {
          memberId: id, memberName: r.memberName, profilePhoto: r.profilePhoto, rotaryId: r.rotaryId,
          email: shouldShowEmail(viewer, id, shares, r.showEmailInMyClub, r.showEmailInAllClubs) ? r.email : null,
          mobile: shouldShowPhone(viewer, id, shares, r.showPhoneInMyClub, r.showPhoneInAllClubs) ? r.mobile : null,
          joinedDate: r.joinedDate, isHonorary: r.isHonorary, currentDesignation: r.currentDesignation,
        };
      });
      // Whole-club split (ignores the search): regular vs honorary.
      const count = (extra: string) => conn.executeScalar(
        `SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND cm.IsActive = 1${extra}`, { ClubId: clubId }).then(Number);
      const honoraryCount = await count(" AND COALESCE(cm.IsHonoraryMember, 0) = 1");
      const roster = await count("");
      return ok({ items, totalCount, page, pageSize, memberCount: roster - honoraryCount, honoraryCount });
    });
  }

  @Get(":clubId/events")
  async events(@Param("clubId") c: string, @Query("page") pq?: string, @Query("pageSize") sq?: string) {
    const clubId = paramInt(c, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    const { page, pageSize } = paging(queryInt(pq, 1), queryInt(sq, 20));
    const where = "FROM upcoming_events e WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0 AND e.IsActive = 1 AND e.EventDate >= CURDATE()";
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) ${where}`, { ClubId: clubId }));
      const items = await conn.query(
        `SELECT e.pk_upcoming_event_id AS eventId, e.Title AS title, e.Description AS description, ${EVENT_IMAGE("e.")} AS imagePath, e.EventDate AS eventDate,
                e.EventVenue AS venue, e.RegistrationLink AS registrationLink, e.Status AS status ${where} ORDER BY e.EventDate LIMIT @PageSize OFFSET @Offset`,
        { ClubId: clubId, Offset: (page - 1) * pageSize, PageSize: pageSize });
      return ok({ items, totalCount, page, pageSize });
    });
  }

  /** Years with at least one non-meeting project for this club. */
  @Get(":clubId/project-years")
  async projectYears(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok([]);
      const legs = tables.map((t) => `(SELECT ${t.yearId} AS yearId, '${t.yearLabel}' AS yearName, (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = ${t.yearId}) AS isCurrent
          FROM \`${t.projectsTable}\` p LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
          WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND COALESCE(md.ModuleKey, '') <> 'club_service' LIMIT 1)`).join(" UNION ALL ");
      return ok(await conn.query(`SELECT * FROM (${legs}) u ORDER BY u.yearName DESC`, { ClubId: clubId }));
    });
  }

  /** Paged projects (club meetings excluded), one year or all years. */
  @Get(":clubId/projects")
  async projects(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("page") pq?: string, @Query("pageSize") sq?: string) {
    const clubId = paramInt(c, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    const yearId = queryInt(y);
    const { page, pageSize } = paging(queryInt(pq, 1), queryInt(sq, 20));
    return this.db.session(async (conn) => {
      const tables = yearId !== null
        ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t): t is YearTableInfo => t !== null) : await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok({ items: [], totalCount: 0, page, pageSize });
      const cond = "p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1 AND COALESCE(md.ModuleKey, '') <> 'club_service'";
      const items = tables.map((t) => {
        const suffix = t.yearLabel.replace(/-/g, "_");
        return `SELECT p.pk_project_id AS projectId, p.fk_year_id AS yearId, p.title AS title, p.description AS description, p.location AS location, p.project_date AS projectDate,
                       p.project_cost AS projectCost, p.direct_beneficiaries AS directBeneficiaries, p.project_type AS projectType, p.is_joint_project AS isJointProject,
                       p.co_host_name AS coHostName, md.ModuleName AS moduleName, a.name AS areaOfFocus,
                       (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', rp.image_path)
                        FROM \`${t.photosTable}\` rp WHERE rp.fk_project_id = p.pk_project_id ORDER BY rp.pk_photo_id LIMIT 1) AS coverPhoto,
                       (SELECT COUNT(*) FROM \`${t.photosTable}\` rp WHERE rp.fk_project_id = p.pk_project_id) AS photoCount
                FROM \`${t.projectsTable}\` p LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                LEFT JOIN area_of_focus_master a ON a.pk_area_of_focus_id = p.fk_area_of_focus_id
                WHERE ${cond}`;
      }).join(" UNION ALL ");
      const counts = tables.map((t) => `SELECT COUNT(*) AS c FROM \`${t.projectsTable}\` p LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id WHERE ${cond}`).join(" UNION ALL ");
      const totalCount = Number(await conn.executeScalar(`SELECT COALESCE(SUM(c), 0) FROM (${counts}) u`, { ClubId: clubId }));
      const rows = await conn.query(`SELECT * FROM (${items}) u ORDER BY u.projectDate DESC, u.projectId DESC LIMIT @PageSize OFFSET @Offset`,
        { ClubId: clubId, PageSize: pageSize, Offset: (page - 1) * pageSize });
      return ok({ items: rows, totalCount, page, pageSize });
    });
  }
}

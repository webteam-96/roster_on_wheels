import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { paramInt, queryInt } from "../../common/binding";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { ok, statusCode } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db } from "../../database/db.service";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";

const familyOn = () => Brand.feature("member.familyDetails");
const PHOTO = `CASE
                   WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                   WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                   ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
               END`;
const FAMILY_PHOTO = `CASE
                   WHEN fd.PhotoPath IS NULL OR fd.PhotoPath = '' THEN NULL
                   WHEN fd.PhotoPath LIKE '/%' THEN fd.PhotoPath
                   ELSE CONCAT('/uploads/family/', fd.PhotoPath)
               END`;
const IMAGE = (folder: string) => `CASE
                   WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                   WHEN ImagePath LIKE '/%' THEN ImagePath
                   WHEN Scope = 'ri' THEN CONCAT('/Documents/${folder}/ri/', ImagePath)
                   WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/${folder}/Group', fk_district_id, '/', ImagePath)
                   ELSE CONCAT('/Documents/${folder}/Group', fk_club_id, '/', ImagePath)
               END`;
const CONTACT = `m.EmailId AS email, m.PrimaryMobileNumber AS primaryMobile, m.SecondaryMobileNumber AS secondaryMobile,
                 NULLIF(TRIM(cm.Designation), '') AS designation, NULLIF(TRIM(cm.ClassificationProfession), '') AS classificationProfession`;

/** Member birthday/anniversary rows (recurring yearly, matched by month). scope = the club or district filter. */
const memberDates = (col: "BirthDate" | "AnniversaryDate", alias: string, scope: string, district: boolean) => `
  SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${PHOTO} AS profilePhoto,
         DATE_FORMAT(m.${col}, '%d-%m') AS ${alias}, DAY(m.${col}) AS day,
         ${district ? "c.pk_club_id AS clubId, c.ClubName AS clubName," : ""}
         ${CONTACT}${col === "AnniversaryDate" ? ", spouse.Name AS spouseName" : ""}
  FROM club_members cm
  ${district ? "JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0" : ""}
  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
  ${col === "AnniversaryDate" ? "LEFT JOIN member_family_details spouse ON spouse.fk_member_master_profile_id = m.pk_member_master_profile_id AND spouse.Relation = 'Spouse' AND spouse.isdeleted = 0" : ""}
  WHERE ${scope} AND cm.IsActive = 1 AND cm.isdeleted = 0
    AND m.${col} IS NOT NULL AND MONTH(m.${col}) = @Month
  ORDER BY DAY(m.${col})${district ? ", m.MemberName" : ""}`;

/** Family birthday/anniversary rows; contacts fall back to the member's own. */
const familyDates = (col: "BirthDate" | "AnniversaryDate", alias: string, scope: string, district: boolean) => `
  SELECT fd.pk_member_family_details_id AS familyId, fd.fk_member_master_profile_id AS memberId, m.MemberName AS memberName,
         cm.Designation AS designation, cm.ClassificationProfession AS classificationProfession,
         fd.Name AS familyMemberName, fd.Relation AS relation,
         DATE_FORMAT(fd.${col}, '%d-%m') AS ${alias}, DAY(fd.${col}) AS day, ${FAMILY_PHOTO} AS profilePhoto,
         COALESCE(NULLIF(TRIM(fd.EmailId), ''), m.EmailId) AS email,
         COALESCE(NULLIF(TRIM(fd.PhoneNumber), ''), m.PrimaryMobileNumber) AS mobile,
         country.CountryCode AS countryCode, country.PhoneCode AS phoneCode${district ? ", c.pk_club_id AS clubId, c.ClubName AS clubName" : ""}
  FROM member_family_details fd
  JOIN member_master_profile m ON m.pk_member_master_profile_id = fd.fk_member_master_profile_id AND m.isdeleted = 0
  JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
  ${district ? "JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0" : ""}
  LEFT JOIN country_master country ON country.pk_country_id = fd.fk_country_id AND country.isdeleted = 0
  WHERE ${scope} AND fd.isdeleted = 0 AND fd.${col} IS NOT NULL AND MONTH(fd.${col}) = @Month
  ORDER BY DAY(fd.${col}), m.MemberName`;

const EVENTS = (scope: string) => `
  SELECT pk_upcoming_event_id AS id, Title AS title, Description AS description, ${IMAGE("Event")} AS imagePath,
         EventDate AS eventDate, EventVenue AS eventVenue, RegistrationLink AS registrationLink, PublishDate AS publishDate, ExpiryDate AS expiryDate
  FROM upcoming_events
  WHERE ${scope} AND isdeleted = 0 AND EventDate >= @MonthStart AND EventDate <= @MonthEnd
  ORDER BY EventDate`;

/** Port of MobileCalendarController.cs: club and district month calendars (birthdays, anniversaries, events). */
@Controller("api/mobile")
@Authorize()
export class MobileCalendarController {
  constructor(private readonly db: Db) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10) || 0;

  /** month/year default to now (brand time zone); the month runs to its last second. */
  private period(month?: string, year?: string) {
    const now = nowIn(Brand.Current.locale.defaultTimeZone);
    const m = queryInt(month) ?? Number(now.slice(5, 7));
    const y = queryInt(year) ?? Number(now.slice(0, 4));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1) - 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
    return { m, y, start: iso(start), end: iso(end), label: formatDate(start.toISOString().slice(0, 19), "MMMM yyyy") };
  }

  private async familyRows(sql: string, p: Record<string, unknown>) {
    return familyOn() ? this.db.query(sql, p) : [];
  }

  @Get("club-calendar/my-clubs")
  async myClubs(@User() u: CurrentUser) {
    return ok(await this.db.query(
      `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
              CASE WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath ELSE CONCAT('/uploads/club/', c.ClubLogoPath) END AS clubLogo,
              d.DistrictNumber AS districtNumber
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE cm.fk_member_master_profile_id = @MemberId AND cm.IsActive = 1 AND cm.isdeleted = 0
       ORDER BY c.ClubName`,
      { MemberId: this.userId(u) },
    ));
  }

  @Get("club-calendar/:clubId")
  async clubCalendar(@Param("clubId") c: string, @Query("month") month?: string, @Query("year") year?: string) {
    const clubId = paramInt(c, "clubId");
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    const { m, y, start, end, label } = this.period(month, year);
    const p = { ClubId: clubId, Month: m, MonthStart: start, MonthEnd: end };
    const scope = "cm.fk_club_id = @ClubId";
    const birthdays = await this.db.query(memberDates("BirthDate", "birthDate", scope, false), p);
    const anniversaries = await this.db.query(memberDates("AnniversaryDate", "anniversaryDate", scope, false), p);
    if (!familyOn()) for (const r of anniversaries) r.spouseName = null;
    return ok({
      month: m, year: y, monthLabel: label, birthdays,
      familyBirthdays: await this.familyRows(familyDates("BirthDate", "birthDate", scope, false), p),
      anniversaries,
      familyAnniversaries: await this.familyRows(familyDates("AnniversaryDate", "anniversaryDate", scope, false), p),
      upcomingEvents: await this.db.query(EVENTS("fk_club_id = @ClubId"), p),
    });
  }

  @Get("district-calendar/my-districts")
  async myDistricts(@User() u: CurrentUser) {
    return ok(await this.db.query(
      `SELECT DISTINCT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.fk_member_master_profile_id = @MemberId AND cm.IsActive = 1 AND cm.isdeleted = 0
       ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
      { MemberId: this.userId(u) },
    ));
  }

  @Get("district-calendar/:districtId")
  async districtCalendar(@Param("districtId") d: string, @Query("month") month?: string, @Query("year") year?: string) {
    const districtId = paramInt(d, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    const { m, y, start, end, label } = this.period(month, year);
    const p = { DistrictId: districtId, Month: m, MonthStart: start, MonthEnd: end };
    const scope = "c.fk_district_id = @DistrictId";
    const birthdays = await this.db.query(memberDates("BirthDate", "birthDate", scope, true), p);
    const familyBirthdays = await this.familyRows(familyDates("BirthDate", "birthDate", scope, true), p);
    const anniversaries = await this.db.query(memberDates("AnniversaryDate", "anniversaryDate", scope, true), p);
    if (!familyOn()) for (const r of anniversaries) r.spouseName = null;
    const upcomingEvents = await this.db.query(EVENTS("fk_district_id = @DistrictId AND (fk_club_id = 0 OR fk_club_id IS NULL)"), p);
    const familyAnniversaries = await this.familyRows(familyDates("AnniversaryDate", "anniversaryDate", scope, true), p);
    const announcements = await this.db.query(
      `SELECT pk_announcement_id AS id, Title AS title, Description AS description, ${IMAGE("announcement")} AS imagePath,
              PublishDateTime AS publishDate, ExpiryDateTime AS expiryDate
       FROM announcements
       WHERE fk_district_id = @DistrictId AND (fk_club_id = 0 OR fk_club_id IS NULL) AND isdeleted = 0
         AND PublishDateTime >= @MonthStart AND PublishDateTime <= @MonthEnd
       ORDER BY PublishDateTime`,
      p,
    );
    return ok({ month: m, year: y, monthLabel: label, birthdays, familyBirthdays, anniversaries, familyAnniversaries, upcomingEvents, announcements });
  }
}

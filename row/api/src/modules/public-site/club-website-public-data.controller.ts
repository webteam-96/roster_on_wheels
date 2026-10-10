import { Controller, Get, Param, Query } from "@nestjs/common";
import { AllowAnonymous } from "../../auth/decorators";
import { queryInt, routeInt } from "../../common/binding";
import { nowIn } from "../../common/dotnet-format";
import { badRequest, notFound, ok } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { DG_EMAIL, DG_JOIN_MEMBER, DG_MOBILE, DG_NAME, DG_PHOTO } from "../../services/district-governor-sql";
import { shouldShowEmail, shouldShowPhone } from "../../services/member-privacy.helper";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { dayOf, EVENT_IMAGE, isClubServiceable, MEMBER_PHOTO, NEWSLETTER_FILE, num, resolveClubYear, stampOf, sumNullable, yearProjectLegs } from "./public-site.helpers";

// Projects = every avenue incl. Club Service (the home Avenues tile wants all six); Meetings = Club Service only.
const PROJECT_KEYS = ["community_service", "vocational_service", "international_service", "new_generation_service", "public_image_initiative", "club_service"];
const MEETINGS_KEY = "club_service";
const photoUrl = (suffix: string) => `CONCAT('/Documents/gallery/Group', @ClubId, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', ph.image_path)`;
const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/**
 * Port of ClubWebsitePublicDataController.cs: anonymous read-only feeds for the club-website app.
 * Every endpoint 404s unless the club has a website and its club → district → zone chain is active.
 */
@Controller("api/public/club")
@AllowAnonymous()
export class ClubWebsitePublicDataController {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver) {}

  /** Runs `work` on one connection after the kill-switch check. */
  private serve<T>(clubId: number, work: (conn: DbCommands) => Promise<T>) {
    return this.db.session(async (conn) => ((await isClubServiceable(conn, clubId)) ? work(conn) : notFound()));
  }
  private year = async (conn: DbCommands, clubId: number, y: string | undefined) => queryInt(y) ?? (await resolveClubYear(conn, this.yearTables, clubId));

  /** Years with BOD / project / event / past-president data, plus always the current year. */
  @Get(":clubId/years")
  years(@Param("clubId") c: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent FROM rotary_year_master y
       WHERE y.pk_year_id IN (
           SELECT DISTINCT fk_year_id FROM board_of_directors WHERE fk_club_id = @ClubId AND isdeleted = 0
           UNION SELECT fk_year_id FROM (${await yearProjectLegs(conn, this.yearTables)}) yp
           UNION SELECT DISTINCT fk_year_id FROM upcoming_events WHERE fk_club_id = @ClubId AND isdeleted = 0 AND IsActive = 1
           UNION SELECT DISTINCT fk_year_id FROM past_presidents WHERE fk_club_id = @ClubId AND isdeleted = 0
           UNION SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1)
       ORDER BY y.pk_year_id DESC`, { ClubId: clubId })));
  }

  /** Contacts are strictly year-scoped (no fallback to another year); social links are not year-wise. */
  @Get(":clubId/about")
  about(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => {
      const yearId = (await this.year(conn, clubId, y)) ?? 0;
      const a = await conn.queryFirstOrDefault(
        `SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                CASE WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL WHEN c.ClubLogoPath LIKE 'http%' THEN c.ClubLogoPath WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                     ELSE CONCAT('/Documents/group/', c.ClubLogoPath) END AS clubLogoPath,
                CASE WHEN c.RotaryLogoPath IS NULL OR c.RotaryLogoPath = '' THEN NULL WHEN c.RotaryLogoPath LIKE 'http%' THEN c.RotaryLogoPath WHEN c.RotaryLogoPath LIKE '/%' THEN c.RotaryLogoPath
                     ELSE CONCAT('/Documents/WebsiteData/Group', c.pk_club_id, '/LOGO/', c.RotaryLogoPath) END AS rotaryLogoPath,
                c.MeetingDay AS meetingDay, TIME_FORMAT(c.MeetingFromTime, '%H:%i') AS meetingFromTime, TIME_FORMAT(c.MeetingToTime, '%H:%i') AS meetingToTime,
                c.MeetingAddress AS meetingAddress, c.City AS city, c.State AS state, c.Pincode AS pincode, c.Latitude AS latitude, c.Longitude AS longitude,
                (SELECT a.content FROM club_website_about a WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0 AND a.is_active = 1
                 ORDER BY a.modified_date DESC, a.created_date DESC LIMIT 1) AS content
         FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @ClubId`, { ClubId: clubId });
      if (!a) return notFound();
      const contacts = await conn.query(
        `SELECT fk_year_id AS yearId, email, phone FROM club_website_contact_detail
         WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 AND is_active = 1 ORDER BY sort_order, pk_club_website_contact_detail_id`, { ClubId: clubId, YearId: yearId });
      const socials = await conn.query(
        `SELECT platform, link_url AS linkUrl FROM club_website_social_link WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1
         ORDER BY sort_order, pk_club_website_social_link_id`, { ClubId: clubId });
      return ok({
        clubName: a.clubName ?? "", districtNumber: a.districtNumber, clubLogoPath: a.clubLogoPath, rotaryLogoPath: a.rotaryLogoPath, content: a.content,
        contacts: contacts.map((r) => ({ yearId: Number(r.yearId), email: r.email ?? "", phone: r.phone ?? "" })),
        socials: socials.map((r) => ({ platform: r.platform ?? "", linkUrl: r.linkUrl ?? "" })),
        meetingDay: a.meetingDay, meetingFromTime: a.meetingFromTime, meetingToTime: a.meetingToTime, meetingAddress: a.meetingAddress,
        city: a.city, state: a.state, pincode: a.pincode, latitude: num(a.latitude), longitude: num(a.longitude),
      });
    });
  }

  @Get(":clubId/banners")
  banners(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT pk_club_website_banner_id AS id,
              CASE WHEN banner_image_path IS NULL OR banner_image_path = '' THEN NULL WHEN banner_image_path LIKE '/%' THEN banner_image_path
                   ELSE CONCAT('/uploads/banner/', banner_image_path) END AS bannerImagePath,
              CASE WHEN document_path IS NULL OR document_path = '' THEN NULL WHEN document_path LIKE '/%' THEN document_path
                   WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path) ELSE CONCAT('/uploads/banner/', document_path) END AS documentPath,
              link_url AS linkUrl, description, sort_order AS sortOrder
       FROM club_website_banner
       WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND (isdeleted = 0 OR isdeleted IS NULL) AND is_active = 1
       ORDER BY sort_order, pk_club_website_banner_id`, { ClubId: clubId, YearId: (await this.year(conn, clubId, y)) ?? 0 })));
  }

  @Get(":clubId/advertisements")
  advertisements(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT pk_club_website_advertisement_id AS id,
              CASE WHEN advertisement_image_path IS NULL OR advertisement_image_path = '' THEN NULL WHEN advertisement_image_path LIKE '/%' THEN advertisement_image_path
                   WHEN advertisement_image_path LIKE '%/%' THEN CONCAT('/', advertisement_image_path) ELSE CONCAT('/uploads/advertisement/', advertisement_image_path) END AS advertisementImagePath,
              CASE WHEN document_path IS NULL OR document_path = '' THEN NULL WHEN document_path LIKE '/%' THEN document_path
                   WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path) ELSE CONCAT('/uploads/advertisement/', document_path) END AS documentPath,
              link_url AS linkUrl, description, sort_order AS sortOrder
       FROM club_website_advertisement
       WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND COALESCE(isdeleted,0) = 0 AND is_active = 1
       ORDER BY sort_order, pk_club_website_advertisement_id`, { ClubId: clubId, YearId: (await this.year(conn, clubId, y)) ?? 0 })));
  }

  /** President first, then Secretary, then drag order (NULL = legacy, last), then designation order. */
  @Get(":clubId/bod")
  bod(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT bd.pk_board_director_id AS id, bd.fk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${MEMBER_PHOTO()} AS profilePhotoPath,
              d.designation_name AS designation, bd.sort_order AS sortOrder, d.sort_order AS designationSortOrder, m.MemberIntroduction AS memberIntroduction
       FROM board_of_directors bd
       JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
       JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
       WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId AND bd.isdeleted = 0 AND m.isdeleted = 0
       ORDER BY CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END, COALESCE(bd.sort_order, 9999), d.sort_order, bd.pk_board_director_id`,
      { ClubId: clubId, YearId: (await this.year(conn, clubId, y)) ?? 0 })));
  }

  /** Phone / email follow the member's own all-clubs visibility toggles (anonymous viewer, no self bypass). */
  @Get(":clubId/directory")
  directory(@Param("clubId") c: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => {
      const rows = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${MEMBER_PHOTO()} AS profilePhotoPath, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                cm.ClassificationProfession AS profession, cm.Designation AS designation, m.Gender AS gender, m.MemberIntroduction AS memberIntroduction,
                m.ShowPhoneInAllClubs AS showPhoneInAllClubs, m.ShowEmailInAllClubs AS showEmailInAllClubs, COALESCE(cm.IsHonoraryMember, 0) AS isHonorary
         FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 ORDER BY m.MemberName`, { ClubId: clubId });
      return ok(rows.map((r) => {
        const id = Number(r.memberId);
        const showPhone = shouldShowPhone(null, id, false, null, r.showPhoneInAllClubs), showEmail = shouldShowEmail(null, id, false, null, r.showEmailInAllClubs);
        return {
          memberId: id, memberName: r.memberName ?? "", profilePhotoPath: r.profilePhotoPath, email: showEmail ? r.email : null, mobile: showPhone ? r.mobile : null,
          profession: r.profession, designation: r.designation, gender: r.gender, memberIntroduction: r.memberIntroduction,
          isPersonalDetailsVisible: showPhone || showEmail, isHonorary: r.isHonorary !== null && Boolean(Number(r.isHonorary)),
        };
      }));
    });
  }

  @Get(":clubId/past-presidents")
  pastPresidents(@Param("clubId") c: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT pp.pk_past_president_id AS id, pp.fk_year_id AS yearId, y.YearLabel AS yearLabel, COALESCE(pp.fk_member_master_profile_id, 0) AS memberId,
              COALESCE(NULLIF(TRIM(m.MemberName), ''), NULLIF(TRIM(pp.non_member_name), ''), '') AS memberName,
              CASE WHEN pp.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NULL THEN
                     CASE WHEN pp.non_member_photo IS NULL OR pp.non_member_photo = '' THEN NULL
                          ELSE CONCAT('/Documents/pastpresidents/Group', pp.fk_club_id, '/', SUBSTRING_INDEX(pp.non_member_photo, '/', -1)) END
                   WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                   WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                   ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END AS profilePhotoPath
       FROM past_presidents pp
       JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id AND m.isdeleted = 0
       WHERE pp.fk_club_id = @ClubId AND pp.isdeleted = 0
         AND ((pp.fk_member_master_profile_id IS NOT NULL AND m.pk_member_master_profile_id IS NOT NULL) OR (pp.non_member_name IS NOT NULL AND TRIM(pp.non_member_name) <> ''))
       ORDER BY y.pk_year_id DESC`, { ClubId: clubId })));
  }

  /** One day (default: today in the brand time zone): birthdays and anniversaries by month + day, and that day's published events. */
  @Get(":clubId/calendar")
  calendar(@Param("clubId") c: string, @Query("date") date?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => {
      const parsed = date && !Number.isNaN(Date.parse(date)) ? /^\d{4}-\d{2}-\d{2}/.exec(date.trim())?.[0] ?? new Date(Date.parse(date)).toISOString().slice(0, 10) : null;
      const target = parsed ?? nowIn(Brand.Current.locale.defaultTimeZone).slice(0, 10);
      const [M, D] = [Number(target.slice(5, 7)), Number(target.slice(8, 10))];
      const people = (col: string) => conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${MEMBER_PHOTO()} AS profilePhotoPath
         FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
           AND m.${col} IS NOT NULL AND MONTH(m.${col}) = @M AND DAY(m.${col}) = @D ORDER BY m.MemberName`, { ClubId: clubId, M, D });
      const events = await conn.query(
        `SELECT pk_upcoming_event_id AS id, Title AS title, Description AS description, ${EVENT_IMAGE()} AS imagePath, EventDate AS eventDate,
                EventVenue AS venue, RegistrationLink AS registrationLink
         FROM upcoming_events
         WHERE fk_club_id = @ClubId AND isdeleted = 0 AND IsActive = 1 AND Status = 'Published' AND DATE(EventDate) = @Date ORDER BY EventDate`, { ClubId: clubId, Date: target });
      return ok({
        date: target, birthdays: await people("BirthDate"), anniversaries: await people("AnniversaryDate"),
        events: events.map((e) => ({ id: Number(e.id), title: e.title ?? "", description: e.description, imagePath: e.imagePath, eventDate: stampOf(e.eventDate), venue: e.venue, registrationLink: e.registrationLink })),
      });
    });
  }

  /**
   * Full project with up to 5 photos. Share links carry no yearId: the year tables are scanned, and when the
   * id exists in more than one year the caller must say which (ids repeat across years).
   */
  @Get(":clubId/projects/:projectId")
  projectDetail(@Param("clubId") c: string, @Param("projectId") p: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c), projectId = routeInt(p);
    const yearId = queryInt(y);
    return this.serve(clubId, async (conn) => {
      let info: YearTableInfo | null = null;
      if (yearId !== null && yearId > 0) info = await this.yearTables.resolveByYearId(conn, yearId);
      else {
        const matches: YearTableInfo[] = [];
        for (const t of await this.yearTables.getAllExistingYearTables(conn))
          if (Number(await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` WHERE pk_project_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1`, { Id: projectId, ClubId: clubId })) > 0)
            matches.push(t);
        if (matches.length > 1)
          return badRequest({ message: `yearId is required: project ${projectId} exists in more than one Rotary year for this club.`, years: matches.map((m) => ({ yearId: m.yearId, yearLabel: m.yearLabel })) });
        info = matches[0] ?? null;
      }
      if (!info) return notFound();
      const row = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, y.YearLabel AS yearLabel, mm.ModuleKey AS moduleKey, mm.ModuleName AS moduleName, p.title, p.description, p.location,
                p.project_date AS projectDate, COALESCE(aof.name, p.other_area_of_focus) AS areaOfFocus, COALESCE(cat.name, p.other_category) AS category,
                COALESCE(sc.name, p.other_sub_category) AS subCategory, p.project_type AS projectType, p.ongoing_group_title AS ongoingGroupTitle, p.is_joint_project AS isJointProject,
                p.co_host_name AS coHostName, p.club_role AS clubRole, f.name AS funding, p.project_cost AS projectCost, p.Currency AS currency,
                p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved,
                COALESCE(p.rcc_involved,0) AS rccInvolved, p.created_date AS createdDate, p.modified_date AS modifiedDate
         FROM \`${info.projectsTable}\` p
         JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
         JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
         LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
         LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
         LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
         WHERE p.pk_project_id = @ProjectId AND p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1
           AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')`, { ClubId: clubId, ProjectId: projectId });
      if (!row) return notFound();
      const photosOf = async (t: YearTableInfo, id: number) => {
        const rows = await conn.query(
          `SELECT ${photoUrl(t.yearLabel.replace(/-/g, "_"))} AS url, ph.description AS description
           FROM \`${t.photosTable}\` ph JOIN \`${t.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id
           WHERE ph.fk_project_id = @Id ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id LIMIT 5`, { Id: id, ClubId: clubId });
        return { photos: rows.map((r) => String(r.url)), photoDetails: rows.map((r) => ({ url: String(r.url), description: r.description })) };
      };
      const main = await photosOf(info, projectId);
      const children: Row[] = [];
      const type = String(row.projectType ?? "").toLowerCase();
      let sums: Record<string, number | null> = { cost: null, ben: null, mh: null, rot: null, rotr: null, rcc: null };
      // Ongoing and Ongoing/Repeat parents carry updates: children by parent_project_id, across every year.
      if (type === "ongoing" || type === "ongoing_repeat") {
        for (const t of await this.yearTables.getAllExistingYearTables(conn)) {
          // In another year, a parent id equal to this one points at that year's own project when it exists for this club.
          if (t.yearId !== info.yearId && Number(await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` WHERE pk_project_id = @Id AND fk_club_id = @ClubId`, { Id: projectId, ClubId: clubId })) > 0)
            continue;
          const rows = await conn.query(
            `SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, @YearLabel AS yearLabel, p.title, p.description, p.location, p.project_date AS projectDate,
                    p.project_cost AS projectCost, p.Currency AS currency, p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours,
                    p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved, COALESCE(p.rcc_involved,0) AS rccInvolved
             FROM \`${t.projectsTable}\` p
             WHERE p.parent_project_id = @ProjectId AND p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1
               AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
             ORDER BY p.project_date DESC, p.pk_project_id DESC`, { ProjectId: projectId, ClubId: clubId, YearLabel: t.yearLabel });
          for (const cr of rows) {
            const ph = await photosOf(t, Number(cr.id));
            children.push({
              id: Number(cr.id), yearId: Number(cr.yearId), yearLabel: cr.yearLabel ?? "", title: cr.title ?? "", description: cr.description, location: cr.location,
              projectDate: dayOf(cr.projectDate), projectCost: num(cr.projectCost), currency: cr.currency ?? Brand.Current.locale.defaultCurrency,
              directBeneficiaries: num(cr.directBeneficiaries), manHours: num(cr.manHours), rotariansInvolved: num(cr.rotariansInvolved), rotaractorsInvolved: num(cr.rotaractorsInvolved),
              rccInvolved: num(cr.rccInvolved), ...ph,
            });
          }
        }
        const sum = (own: unknown, key: string) => sumNullable([num(own), ...children.map((x) => x[key] as number | null)]);
        sums = { cost: round2(sum(row.projectCost, "projectCost")), ben: sum(row.directBeneficiaries, "directBeneficiaries"), mh: sum(row.manHours, "manHours"),
          rot: sum(row.rotariansInvolved, "rotariansInvolved"), rotr: sum(row.rotaractorsInvolved, "rotaractorsInvolved"), rcc: sum(row.rccInvolved, "rccInvolved") };
      }
      return ok({
        id: Number(row.id), yearId: Number(row.yearId), yearLabel: row.yearLabel ?? "", moduleKey: row.moduleKey ?? "", moduleName: row.moduleName ?? "", title: row.title ?? "",
        description: row.description, location: row.location, projectDate: dayOf(row.projectDate), areaOfFocus: row.areaOfFocus, category: row.category, subCategory: row.subCategory,
        projectType: row.projectType, ongoingGroupTitle: row.ongoingGroupTitle, isJointProject: row.isJointProject === null ? null : Boolean(Number(row.isJointProject)),
        coHostName: row.coHostName, clubRole: row.clubRole, funding: row.funding, projectCost: num(row.projectCost), currency: row.currency ?? Brand.Current.locale.defaultCurrency,
        directBeneficiaries: num(row.directBeneficiaries), manHours: num(row.manHours), rotariansInvolved: num(row.rotariansInvolved), rotaractorsInvolved: num(row.rotaractorsInvolved),
        rccInvolved: num(row.rccInvolved), createdDate: stampOf(row.createdDate), modifiedDate: stampOf(row.modifiedDate), ...main, children,
        summedProjectCost: sums.cost, summedDirectBeneficiaries: sums.ben, summedManHours: sums.mh, summedRotariansInvolved: sums.rot, summedRotaractorsInvolved: sums.rotr, summedRccInvolved: sums.rcc,
      });
    });
  }

  @Get(":clubId/projects")
  projects(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => ok(await this.queryProjects(conn, clubId, await this.year(conn, clubId, y), PROJECT_KEYS)));
  }

  @Get(":clubId/meetings")
  meetings(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => ok(await this.queryProjects(conn, clubId, await this.year(conn, clubId, y), [MEETINGS_KEY])));
  }

  /** One year's table when a year is known, else a UNION over every year table. Ongoing/repeat children of the grouped avenues are left out. */
  private async queryProjects(conn: DbCommands, clubId: number, yearId: number | null, keys: string[]) {
    const tables = yearId !== null && yearId > 0
      ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t): t is YearTableInfo => t !== null)
      : await this.yearTables.getAllExistingYearTables(conn);
    if (tables.length === 0) return [];
    const legs = tables.map((t) => {
      const suffix = t.yearLabel.replace(/-/g, "_");
      return `SELECT p.pk_project_id AS Id, p.fk_year_id AS YearId, '${t.yearLabel}' AS YearLabel, mm.ModuleKey AS ModuleKey, mm.ModuleName AS ModuleName, p.title AS Title,
                     p.description AS Description, p.location AS Location, p.project_date AS ProjectDate, aof.name AS AreaOfFocus, cat.name AS Category, sc.name AS SubCategory,
                     (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', ph.image_path)
                      FROM \`${t.photosTable}\` ph WHERE ph.fk_project_id = p.pk_project_id ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id LIMIT 1) AS PrimaryPhotoPath,
                     p.created_date AS CreatedDate, p.modified_date AS ModifiedDate
              FROM \`${t.projectsTable}\` p
              JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
              LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
              LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
              LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
              WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1 AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
                AND mm.ModuleKey IN @Keys AND NOT (mm.ModuleKey IN ('community_service','public_image_initiative') AND p.project_type = 'ongoing_repeat')`;
    });
    const raw = await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY COALESCE(u.ModifiedDate, u.CreatedDate) DESC, u.Id DESC`, { ClubId: clubId, Keys: keys });
    return raw.map((r) => ({
      id: Number(r.Id), yearId: Number(r.YearId), yearLabel: r.YearLabel ?? "", moduleKey: r.ModuleKey ?? "", moduleName: r.ModuleName ?? "", title: r.Title ?? "",
      description: r.Description, location: r.Location, projectDate: dayOf(r.ProjectDate), areaOfFocus: r.AreaOfFocus, category: r.Category, subCategory: r.SubCategory,
      primaryPhotoPath: r.PrimaryPhotoPath, createdDate: stampOf(r.CreatedDate), modifiedDate: stampOf(r.ModifiedDate),
    }));
  }

  /** The club's own menus (not district menus) with their sub-menus; document links resolve to the club's MENU folder. */
  @Get(":clubId/menus")
  menus(@Param("clubId") c: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => {
      const menus = await conn.query(
        `SELECT pk_club_website_menu_id AS id, menu_name AS menuName, link_type AS linkType,
                CASE WHEN link_value IS NULL OR link_value = '' THEN link_value
                     WHEN link_type = 'document' AND link_value NOT LIKE '/%' AND link_value NOT LIKE 'http%' THEN CONCAT('/Documents/WebsiteData/Group', fk_club_id, '/MENU/', link_value)
                     ELSE link_value END AS linkValue,
                content_html AS contentHtml, is_default AS isDefault, sort_order AS sortOrder
         FROM club_website_menu
         WHERE fk_club_id = @ClubId AND (fk_district_id IS NULL OR fk_district_id = 0) AND isdeleted = 0 AND is_active = 1
         ORDER BY sort_order, pk_club_website_menu_id`, { ClubId: clubId });
      const out = menus.map((m) => ({ id: Number(m.id), menuName: m.menuName ?? "", linkType: m.linkType ?? "page", linkValue: m.linkValue ?? "", contentHtml: m.contentHtml,
        isDefault: Boolean(Number(m.isDefault)), sortOrder: Number(m.sortOrder ?? 0), subMenus: [] as Row[] }));
      if (!out.length) return ok(out);
      const subs = await conn.query(
        `SELECT sm.pk_club_website_submenu_id AS id, sm.fk_menu_id AS menuId, sm.submenu_name AS submenuName, sm.link_type AS linkType,
                CASE WHEN sm.link_value IS NULL OR sm.link_value = '' THEN sm.link_value
                     WHEN sm.link_type = 'document' AND sm.link_value NOT LIKE '/%' AND sm.link_value NOT LIKE 'http%' THEN CONCAT('/Documents/WebsiteData/Group', m.fk_club_id, '/MENU/', sm.link_value)
                     ELSE sm.link_value END AS linkValue,
                sm.sort_order AS sortOrder
         FROM club_website_submenu sm JOIN club_website_menu m ON m.pk_club_website_menu_id = sm.fk_menu_id
         WHERE sm.fk_menu_id IN @Ids AND sm.isdeleted = 0 AND sm.is_active = 1 ORDER BY sm.sort_order, sm.pk_club_website_submenu_id`, { Ids: out.map((m) => m.id) });
      for (const s of subs)
        out.find((m) => m.id === Number(s.menuId))?.subMenus.push({ id: Number(s.id), subMenuName: s.submenuName ?? "", linkType: s.linkType ?? "page", linkValue: s.linkValue ?? "", sortOrder: Number(s.sortOrder ?? 0) });
      return ok(out);
    });
  }

  /** The same for every club: one row per year (default: the current year). */
  @Get(":clubId/international-president")
  internationalPresident(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => {
      const yearId = queryInt(y) ?? num(await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1"));
      if (yearId === null) return ok(null);
      return ok(await conn.queryFirstOrDefault(
        `SELECT p.pk_id AS id, p.fk_year_id AS yearId, y.YearLabel AS yearLabel, p.Name AS name, p.Designation AS designation,
                CASE WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                     ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath) END AS profilePhotoPath,
                p.Description AS description
         FROM international_president p JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
         WHERE p.fk_year_id = @YearId AND p.isdeleted = 0 LIMIT 1`, { YearId: yearId }));
    });
  }

  /** The club's district governor for the year; a member DG's name / contacts / photo come live from the profile. */
  @Get(":clubId/district-governor")
  districtGovernor(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => {
      const yearId = queryInt(y) ?? num(await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1"));
      if (yearId === null) return ok(null);
      return ok(await conn.queryFirstOrDefault(
        `SELECT g.pk_id AS id, g.fk_year_id AS yearId, y.YearLabel AS yearLabel, g.fk_member_id AS memberId, ${DG_NAME} AS memberName, ${DG_PHOTO} AS profilePhoto,
                g.description AS description, ${DG_MOBILE} AS mobileNumber, ${DG_EMAIL} AS email, 'District Governor' AS designation
         FROM district_governors g
         JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
         JOIN club_master c ON c.fk_district_id = g.fk_district_id
         ${DG_JOIN_MEMBER}
         WHERE c.pk_club_id = @ClubId AND g.fk_year_id = @YearId AND g.isdeleted = 0 LIMIT 1`, { ClubId: clubId, YearId: yearId }));
    });
  }

  /** Published, not expired, and not yet held. */
  @Get(":clubId/upcoming-events")
  upcomingEvents(@Param("clubId") c: string, @Query("limit") l?: string) {
    const clubId = routeInt(c);
    const limit = queryInt(l, 6);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT pk_upcoming_event_id AS id, Title AS title, Description AS description, EventVenue AS venue, EventDate AS eventDate, ${EVENT_IMAGE()} AS imagePath,
              RegistrationLink AS registrationLink
       FROM upcoming_events
       WHERE fk_club_id = @ClubId AND isdeleted = 0 AND PublishDate <= NOW() AND ExpiryDate >= NOW() AND EventDate >= CURDATE()
       ORDER BY EventDate ASC LIMIT @Limit`, { ClubId: clubId, Limit: limit })));
  }

  /** Published only; an expiry equal to (or before) the publish time means "never expires". */
  @Get(":clubId/newsletters")
  newsletters(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("limit") l?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y), limit = queryInt(l, 6);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT pk_newsletter_id AS id, fk_year_id AS yearId, Title AS title, PublishDateTime AS publishDateTime, ${NEWSLETTER_FILE} AS filePath, LinkUrl AS linkUrl, AttachmentType AS attachmentType
       FROM newsletters
       WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0 AND PublishDateTime <= NOW()
         AND (ExpiryDateTime IS NULL OR ExpiryDateTime <= PublishDateTime OR ExpiryDateTime >= NOW())
         ${yearId !== null ? "AND fk_year_id = @YearId" : ""}
       ORDER BY PublishDateTime DESC LIMIT @Limit`, { ClubId: clubId, YearId: yearId, Limit: limit })));
  }
}

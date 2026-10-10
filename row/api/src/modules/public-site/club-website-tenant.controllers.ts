import { Controller, Get, Param, Query } from "@nestjs/common";
import { AllowAnonymous } from "../../auth/decorators";
import { paramInt, queryInt, queryString, requireQuery, routeInt } from "../../common/binding";
import { notFound, ok } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { dayOf, EVENT_IMAGE, isClubServiceable, MEMBER_PHOTO, num, stampOf } from "./public-site.helpers";

/** Bare lowercase host: no scheme, path, port or leading "www." (stored values may be full URLs). */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "";
  let h = raw.trim().toLowerCase();
  if (h.startsWith("https://")) h = h.slice(8);
  else if (h.startsWith("http://")) h = h.slice(7);
  h = h.split("/")[0].split(":")[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}
/** normalizeHost applied in SQL to a stored column (a constant, never input). */
const normCol = (col: string) => `SUBSTRING_INDEX(REPLACE(REPLACE(REPLACE(LOWER(${col}),'https://',''),'http://',''),'www.',''),'/',1)`;

/**
 * Port of ClubWebsitePublicController.cs `by-host`: which club a Host belongs to, and its subscription state.
 * `renew-link` is not ported: it mints Payments links (website renewal, wallet top-up), see STATUS.md.
 */
@Controller("api/public/club-website")
@AllowAnonymous()
export class ClubWebsitePublicController {
  constructor(private readonly db: Db) {}

  /** ClientDomain match first, then Subdomain FQDN, then the Subdomain first label (legacy rows); the active chain only. */
  @Get("by-host")
  async byHost(@Query("host") hostQ?: string) {
    requireQuery({ host: hostQ });
    const host = normalizeHost(queryString(hostQ));
    if (!host) return notFound();
    const [cd, sd] = [normCol("w.ClientDomain"), normCol("w.Subdomain")];
    const row = await this.db.queryFirstOrDefault(
      `SELECT w.fk_club_id AS clubId, c.ClubName AS clubName, w.Subdomain AS subdomain, w.ClientDomain AS clientDomain, w.fk_theme_id AS themeId, t.theme_name AS themeName,
              w.EndDate AS endDate, w.AmountPaid AS amountPaid, w.TransactionId AS transactionId, DATEDIFF(w.EndDate, CURDATE()) AS daysRemaining
       FROM club_websites w
       JOIN club_master c ON c.pk_club_id = w.fk_club_id JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
       WHERE w.isdeleted = 0 AND c.isdeleted = 0 AND c.IsActive = 1 AND d.isdeleted = 0 AND d.IsActive = 1 AND z.isdeleted = 0 AND z.IsActive = 1
         AND (${cd} = @host OR ${sd} = @host OR ${sd} = @label)
       ORDER BY CASE WHEN ${cd} = @host THEN 0 WHEN ${sd} = @host THEN 1 ELSE 2 END, w.created_date DESC LIMIT 1`, { host, label: host.split(".")[0] });
    if (!row) return notFound();
    // No recorded payment = a trial allocation.
    const isPaid = (num(row.amountPaid) ?? 0) > 0 || !!(row.transactionId && String(row.transactionId).trim());
    const daysRemaining = Number(row.daysRemaining ?? 0), expired = daysRemaining < 0;
    const end = row.endDate === null ? null : (dayOf(row.endDate) ?? String(row.endDate));
    return ok({
      clubId: Number(row.clubId), clubName: row.clubName ?? "", subdomain: row.subdomain, clientDomain: row.clientDomain, themeId: Number(row.themeId ?? 0),
      themeKey: row.themeName && String(row.themeName).trim() ? String(row.themeName).trim().toLowerCase().replace(/ /g, "-") : "classic-blue",
      status: isPaid ? (expired ? "expired" : "active") : expired ? "trial_expired" : "trial",
      trialEndsAt: isPaid ? null : end, paidUntil: isPaid ? end : null, daysRemaining,
    });
  }
}

/** Port of ClubGalleryPublicController.cs: gallery and past events for the club website (same kill switch as the other feeds). */
@Controller("api/public/club")
@AllowAnonymous()
export class ClubGalleryPublicController {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver) {}

  @Get(":clubId/gallery")
  gallery(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("page") pq?: string, @Query("pageSize") sq?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y);
    let page = queryInt(pq, 1), pageSize = queryInt(sq, 24);
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 24;
    if (pageSize > 100) pageSize = 100;
    return this.db.session(async (conn) => {
      if (!(await isClubServiceable(conn, clubId))) return notFound();
      const tables = yearId !== null && yearId > 0
        ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t): t is YearTableInfo => t !== null) : await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok({ totalCount: 0, page, pageSize, photos: [] });
      const legs = tables.map((t) => {
        const suffix = t.yearLabel.replace(/-/g, "_");
        return `SELECT p.pk_project_id AS ProjectId, p.title AS ProjectTitle, mm.ModuleKey AS ModuleKey, mm.ModuleName AS ModuleName,
                       CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                              '/', ph.image_path) AS ImagePath,
                       ph.is_primary AS IsPrimary, ph.created_date AS CreatedDate
                FROM \`${t.photosTable}\` ph JOIN \`${t.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1 AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
                  AND ph.image_path IS NOT NULL AND ph.image_path <> ''`;
      }).join(" UNION ALL ");
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM (${legs}) u`, { ClubId: clubId }));
      const raw = await conn.query(`SELECT * FROM (${legs}) u ORDER BY COALESCE(u.CreatedDate, '1900-01-01') DESC, u.IsPrimary DESC, u.ProjectId DESC LIMIT @PageSize OFFSET @Offset`,
        { ClubId: clubId, PageSize: pageSize, Offset: (page - 1) * pageSize });
      return ok({
        totalCount, page, pageSize,
        photos: raw.map((r) => ({ projectId: Number(r.ProjectId), projectTitle: r.ProjectTitle ?? "", moduleKey: r.ModuleKey ?? "", moduleName: r.ModuleName ?? "", imagePath: r.ImagePath ?? "",
          isPrimary: r.IsPrimary !== null && Boolean(Number(r.IsPrimary)), createdDate: stampOf(r.CreatedDate) })),
      });
    });
  }

  /** Event date before today, whatever its publish / expiry; a year narrows it to that Rotary year's dates. */
  @Get(":clubId/past-events")
  pastEvents(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("limit") l?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y);
    let limit = queryInt(l, 99);
    if (limit < 1) limit = 99;
    if (limit > 500) limit = 500;
    return this.db.session(async (conn) => {
      if (!(await isClubServiceable(conn, clubId))) return notFound();
      const win = yearId !== null && yearId > 0
        ? await conn.queryFirstOrDefault("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Id AND isdeleted = 0 LIMIT 1", { Id: yearId }) : null;
      const rows = await conn.query(
        `SELECT pk_upcoming_event_id AS id, Title AS title, Description AS description, EventVenue AS venue, EventDate AS eventDate, ${EVENT_IMAGE()} AS imagePath,
                RegistrationLink AS registrationLink
         FROM upcoming_events
         WHERE fk_club_id = @ClubId AND isdeleted = 0 AND EventDate < CURDATE()${win ? " AND EventDate BETWEEN @WinStart AND @WinEnd" : ""}
         ORDER BY EventDate DESC LIMIT @Limit`, { ClubId: clubId, WinStart: win?.StartDate, WinEnd: win?.EndDate, Limit: limit });
      return ok(rows.map((r) => ({ id: Number(r.id), title: r.title ?? "", description: r.description, venue: r.venue, eventDate: stampOf(r.eventDate) ?? "", imagePath: r.imagePath,
        registrationLink: r.registrationLink })));
    });
  }
}

/** Port of PublicProjectController.cs: the no-login project page opened from WhatsApp links (project, photos, this year's President / Secretary). */
@Controller("api/public/projects")
@AllowAnonymous()
export class PublicProjectController {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver) {}

  @Get(":id")
  project(@Param("id") idText: string, @Query("yearId") y?: string) {
    const id = paramInt(idText);
    const yearId = queryInt(y);
    return this.db.session(async (conn) => {
      const info = await this.findTable(conn, id, yearId);
      if (!info) return notFound({ message: "Project not found." });
      const project = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id AS id, p.title, p.description, p.project_date AS projectDate, p.project_cost AS projectCost, COALESCE(p.Currency, @DefaultCurrency) AS currency,
                p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved,
                COALESCE(p.rcc_involved,0) AS rccInvolved, p.location, aof.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory, f.name AS funding,
                p.fk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, c.City AS clubCity, c.State AS clubState, d.DistrictNumber AS districtNumber,
                z.ZoneName AS zoneName, mm.ModuleKey AS moduleKey, p.meeting_type AS meetingType, p.attendance AS attendance, p.attendance_percentage AS attendancePercentage,
                p.agenda_document AS agendaDocument, p.minutes_document AS minutesDocument
         FROM \`${info.projectsTable}\` p
         LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
         LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
         LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
         LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
         LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE p.pk_project_id = @Id AND p.isdeleted = 0`, { Id: id, DefaultCurrency: Brand.Current.locale.defaultCurrency });
      if (!project) return notFound({ message: "Project not found." });
      const clubId = project.clubId === null ? 0 : Number(project.clubId);
      const suffix = info.yearLabel.replace(/-/g, "_");
      const photos = await conn.query(
        `SELECT CONCAT('/Documents/gallery/Group', @ClubId, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                       '/', ph.image_path) AS imagePath, ph.description, ph.is_primary AS isPrimary
         FROM \`${info.photosTable}\` ph JOIN \`${info.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id
         WHERE ph.fk_project_id = @Id ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.pk_photo_id ASC`, { Id: id, ClubId: clubId });
      // RIZones quirk kept: matches designations named exactly 'President' / 'Secretary'.
      const officers = clubId > 0 ? await conn.query(
        `SELECT dm.designation_name AS designation, m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile, ${MEMBER_PHOTO()} AS profilePhotoPath
         FROM board_of_directors bd
         JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
         JOIN rotary_year_master ry ON ry.pk_year_id = bd.fk_year_id
         JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
         WHERE bd.fk_club_id = @ClubId AND bd.isdeleted = 0 AND m.isdeleted = 0 AND CURDATE() BETWEEN ry.StartDate AND ry.EndDate
           AND (dm.designation_name = 'President' OR dm.designation_name = 'Secretary')
         ORDER BY FIELD(dm.designation_name, 'President', 'Secretary')`, { ClubId: clubId }) : [];
      return ok({ project, photos, officers });
    });
  }

  private async findTable(conn: DbCommands, id: number, yearId: number | null) {
    if (yearId !== null && yearId > 0) return this.yearTables.resolveByYearId(conn, yearId);
    for (const t of await this.yearTables.getAllExistingYearTables(conn))
      if (Number(await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: id })) > 0) return t;
    return null;
  }
}

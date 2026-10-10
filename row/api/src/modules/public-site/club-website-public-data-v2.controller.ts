import { Controller, Get, Param, Query } from "@nestjs/common";
import { AllowAnonymous } from "../../auth/decorators";
import { queryInt, queryString, routeInt } from "../../common/binding";
import { notFound, ok } from "../../common/results";
import { Db, type DbCommands } from "../../database/db.service";
import { convertCurrency, normalizeCurrency, resolveDefaultCurrency } from "../../services/currency.helper";
import { CurrencyRateService } from "../../services/currency-rate.service";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { dayOf, isClubServiceable, MEMBER_PHOTO, num, stampOf } from "./public-site.helpers";

const ALL_KEYS = ["community_service", "vocational_service", "international_service", "new_generation_service", "public_image_initiative", "club_service"];
const currentYear = async (conn: DbCommands) => num(await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1"));

/**
 * Port of ClubWebsitePublicDataV2Controller.cs: the additive /v2 feeds (media paths under
 * /Documents/WebsiteData, impact totals, a fault-tolerant year list, a paged gallery, typed project list).
 * When yearId is omitted these default to the current Rotary year.
 */
@Controller("api/public/club")
@AllowAnonymous()
export class ClubWebsitePublicDataV2Controller {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver, private readonly fx: CurrencyRateService) {}

  private serve<T>(clubId: number, work: (conn: DbCommands) => Promise<T>) {
    return this.db.session(async (conn) => ((await isClubServiceable(conn, clubId)) ? work(conn) : notFound()));
  }
  private tables = async (conn: DbCommands, yearId: number | null): Promise<YearTableInfo[]> =>
    yearId !== null && yearId > 0 ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t): t is YearTableInfo => t !== null) : this.yearTables.getAllExistingYearTables(conn);

  /** Image and document resolve to /Documents/WebsiteData/Group{club}/{folder}/{file name}. */
  private media = (col: string, folder: string) =>
    `CASE WHEN ${col} IS NULL OR ${col} = '' THEN NULL WHEN ${col} LIKE '/%' THEN ${col} ELSE CONCAT('/Documents/WebsiteData/Group', @ClubId, '/${folder}/', SUBSTRING_INDEX(${col}, '/', -1)) END`;

  @Get(":clubId/v2/banners")
  banners(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT pk_club_website_banner_id AS id, ${this.media("banner_image_path", "BANNERS")} AS bannerImagePath, ${this.media("document_path", "BANNERS")} AS documentPath,
              link_url AS linkUrl, description, sort_order AS sortOrder
       FROM club_website_banner WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND (isdeleted = 0 OR isdeleted IS NULL) AND is_active = 1
       ORDER BY sort_order, pk_club_website_banner_id`, { ClubId: clubId, YearId: yearId ?? (await currentYear(conn)) ?? 0 })));
  }

  @Get(":clubId/v2/advertisements")
  advertisements(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT pk_club_website_advertisement_id AS id, ${this.media("advertisement_image_path", "ADVERTISEMENT")} AS advertisementImagePath,
              ${this.media("document_path", "ADVERTISEMENT")} AS documentPath, link_url AS linkUrl, description, sort_order AS sortOrder
       FROM club_website_advertisement WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND COALESCE(isdeleted, 0) = 0 AND is_active = 1
       ORDER BY sort_order, pk_club_website_advertisement_id`, { ClubId: clubId, YearId: yearId ?? (await currentYear(conn)) ?? 0 })));
  }

  /**
   * Home-page impact band over the same set the /v2/projects list shows (one year, or lifetime). Project cost is
   * converted per stored currency into the district's currency; TRF is always USD.
   */
  @Get(":clubId/v2/impact")
  impact(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y);
    return this.serve(clubId, async (conn) => {
      const currency = resolveDefaultCurrency(await conn.executeScalar<string>(
        "SELECT d.DefaultCurrency FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @ClubId", { ClubId: clubId }));
      const empty = (yearLabel: string | null) => ({ yearId, yearLabel, projectCount: 0, totalProjectCost: 0, currency, totalManHours: 0, totalDirectBeneficiaries: 0, totalTrfUsd: 0 });
      let yearLabel: string | null = null;
      let tables: YearTableInfo[];
      if (yearId !== null && yearId > 0) {
        const info = await this.yearTables.resolveByYearId(conn, yearId);
        if (!info) return ok(empty(null));
        tables = [info];
        yearLabel = info.yearLabel;
      } else tables = await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok(empty(yearLabel));
      const legs = tables.map((t) =>
        `SELECT COALESCE(p.project_cost, 0) AS cost, CONVERT(COALESCE(p.Currency, '') USING utf8mb4) AS curr, COALESCE(p.man_hours, 0) AS hours,
                COALESCE(p.direct_beneficiaries, 0) AS beneficiaries, 1 AS cnt
         FROM \`${t.projectsTable}\` p JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1 AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
           AND mm.ModuleKey IN @Keys`).join(" UNION ALL ");
      const buckets = await conn.query(`SELECT curr, SUM(cost) AS cost, SUM(hours) AS hours, SUM(beneficiaries) AS beneficiaries, SUM(cnt) AS cnt FROM (${legs}) u GROUP BY curr`,
        { ClubId: clubId, Keys: ALL_KEYS });
      const rates = await this.fx.getRates();
      const trf = await conn.executeScalar(
        `SELECT COALESCE(SUM(AmountUSD), 0) FROM trf_contributions WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0${yearId !== null && yearId > 0 ? " AND fk_year_id = @YearId" : ""}`,
        { ClubId: clubId, YearId: yearId });
      return ok({
        yearId, yearLabel, projectCount: buckets.reduce((s, b) => s + Number(b.cnt ?? 0), 0),
        totalProjectCost: buckets.reduce((s, b) => s + convertCurrency(Number(b.cost ?? 0), normalizeCurrency(b.curr), currency, rates), 0),
        currency, totalManHours: buckets.reduce((s, b) => s + Number(b.hours ?? 0), 0), totalDirectBeneficiaries: buckets.reduce((s, b) => s + Number(b.beneficiaries ?? 0), 0),
        totalTrfUsd: Number(trf ?? 0),
      });
    });
  }

  /** Each source is read on its own, so one failing source cannot break the list. */
  @Get(":clubId/v2/years")
  years(@Param("clubId") c: string) {
    const clubId = routeInt(c);
    return this.serve(clubId, async (conn) => {
      const ids = new Set<number>();
      const collect = async (sql: string) => {
        try {
          for (const r of await conn.query(sql, { ClubId: clubId })) ids.add(Number(r.fk_year_id));
        } catch {
          // a bad source is skipped
        }
      };
      await collect("SELECT DISTINCT fk_year_id FROM board_of_directors WHERE fk_club_id = @ClubId AND isdeleted = 0 AND fk_year_id > 0");
      try {
        for (const t of await this.yearTables.getAllExistingYearTables(conn))
          if (Number(await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1 LIMIT 1`, { ClubId: clubId })) > 0) ids.add(t.yearId);
      } catch {
        // schema mismatch: skipped
      }
      await collect("SELECT DISTINCT fk_year_id FROM upcoming_events WHERE fk_club_id = @ClubId AND isdeleted = 0 AND IsActive = 1 AND fk_year_id > 0");
      await collect("SELECT DISTINCT fk_year_id FROM past_presidents WHERE fk_club_id = @ClubId AND isdeleted = 0 AND fk_year_id > 0");
      if (!ids.size) return ok([]);
      return ok(await conn.query("SELECT pk_year_id AS id, YearLabel AS yearLabel, IsCurrent AS isCurrent FROM rotary_year_master WHERE pk_year_id IN @Ids AND isdeleted = 0 ORDER BY YearLabel DESC",
        { Ids: [...ids] }));
    });
  }

  @Get(":clubId/v2/about")
  about(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    const yearIdQ = queryInt(y);
    return this.serve(clubId, async (conn) => {
      const yearId = yearIdQ ?? (await currentYear(conn)) ?? 0;
      const a = await conn.queryFirstOrDefault(
        `SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber, d.DefaultCurrency AS currency,
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
        `SELECT fk_year_id AS yearId, email, phone FROM club_website_contact_detail WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 AND is_active = 1
         ORDER BY sort_order, pk_club_website_contact_detail_id`, { ClubId: clubId, YearId: yearId });
      const socials = await conn.query(
        "SELECT platform, link_url AS linkUrl FROM club_website_social_link WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1 ORDER BY sort_order, pk_club_website_social_link_id",
        { ClubId: clubId });
      return ok({
        clubName: a.clubName ?? "", districtNumber: a.districtNumber, clubLogoPath: a.clubLogoPath, rotaryLogoPath: a.rotaryLogoPath, content: a.content,
        contacts: contacts.map((r) => ({ yearId: Number(r.yearId), email: r.email ?? "", phone: r.phone ?? "" })),
        socials: socials.map((r) => ({ platform: r.platform ?? "", linkUrl: r.linkUrl ?? "" })),
        meetingDay: a.meetingDay, meetingFromTime: a.meetingFromTime, meetingToTime: a.meetingToTime, meetingAddress: a.meetingAddress, city: a.city, state: a.state,
        pincode: a.pincode, latitude: num(a.latitude), longitude: num(a.longitude), currency: resolveDefaultCurrency(a.currency),
      });
    });
  }

  @Get(":clubId/v2/bod")
  bod(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y);
    return this.serve(clubId, async (conn) => ok(await conn.query(
      `SELECT bd.pk_board_director_id AS id, bd.fk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${MEMBER_PHOTO()} AS profilePhotoPath,
              d.designation_name AS designation, bd.sort_order AS sortOrder, d.sort_order AS designationSortOrder, m.MemberIntroduction AS memberIntroduction
       FROM board_of_directors bd
       JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
       JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
       WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId AND bd.isdeleted = 0 AND m.isdeleted = 0
       ORDER BY CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END, COALESCE(bd.sort_order, 9999), d.sort_order, bd.pk_board_director_id`,
      { ClubId: clubId, YearId: yearId ?? (await currentYear(conn)) ?? 0 })));
  }

  /** Text columns are CONVERTed to one collation so the UNION across year tables of mixed collations is legal. */
  @Get(":clubId/v2/gallery")
  gallery(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("page") pq?: string, @Query("pageSize") sq?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y);
    let page = queryInt(pq, 1), pageSize = queryInt(sq, 24);
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 24;
    if (pageSize > 100) pageSize = 100;
    return this.serve(clubId, async (conn) => {
      const tables = await this.tables(conn, yearId);
      if (!tables.length) return ok({ totalCount: 0, page, pageSize, photos: [] });
      const legs = tables.map((t) => {
        const suffix = t.yearLabel.replace(/-/g, "_");
        return `SELECT p.pk_project_id AS ProjectId, CONVERT(p.title USING utf8mb4) AS ProjectTitle, CONVERT(mm.ModuleKey USING utf8mb4) AS ModuleKey,
                       CONVERT(mm.ModuleName USING utf8mb4) AS ModuleName,
                       CONVERT(CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                               '/', ph.image_path) USING utf8mb4) AS ImagePath,
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

  /** ?projectType=ongoing → parent rows ('ongoing') only, onetime → 'one_time'; children are told apart by parentProjectId / childCount. */
  @Get(":clubId/v2/projects")
  projects(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("projectType") t?: string, @Query("moduleKey") m?: string) {
    const clubId = routeInt(c);
    const yearId = queryInt(y), moduleKey = queryString(m);
    const pt = (queryString(t) ?? "").trim().toLowerCase().replace(/-/g, "_");
    const ptFilter = pt === "ongoing" || pt === "ongoing_repeat" ? " AND p.project_type = 'ongoing'" : pt === "onetime" || pt === "one_time" ? " AND p.project_type = 'one_time'" : "";
    return this.serve(clubId, async (conn) => {
      const tables = await this.tables(conn, yearId);
      if (!tables.length) return ok([]);
      const legs = tables.map((tb) => {
        const suffix = tb.yearLabel.replace(/-/g, "_");
        return `SELECT p.pk_project_id AS Id, p.fk_year_id AS YearId, CONVERT('${tb.yearLabel}' USING utf8mb4) AS YearLabel, CONVERT(mm.ModuleKey USING utf8mb4) AS ModuleKey,
                       CONVERT(mm.ModuleName USING utf8mb4) AS ModuleName, CONVERT(p.title USING utf8mb4) AS Title, CONVERT(p.description USING utf8mb4) AS Description,
                       CONVERT(p.location USING utf8mb4) AS Location, p.project_date AS ProjectDate, CONVERT(aof.name USING utf8mb4) AS AreaOfFocus,
                       CONVERT(cat.name USING utf8mb4) AS Category, CONVERT(p.project_type USING utf8mb4) AS ProjectType, CONVERT(p.Currency USING utf8mb4) AS Currency,
                       p.parent_project_id AS ParentProjectId,
                       (SELECT COUNT(*) FROM \`${tb.projectsTable}\` c WHERE c.parent_project_id = p.pk_project_id AND c.isdeleted = 0) AS ChildCount,
                       CONVERT((SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                                      '/', ph.image_path)
                                FROM \`${tb.photosTable}\` ph WHERE ph.fk_project_id = p.pk_project_id ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id LIMIT 1) USING utf8mb4) AS PrimaryPhotoPath,
                       p.created_date AS CreatedDate, p.modified_date AS ModifiedDate
                FROM \`${tb.projectsTable}\` p
                JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
                WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1 AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
                  AND mm.ModuleKey IN @Keys${ptFilter}`;
      }).join(" UNION ALL ");
      const raw = await conn.query(`SELECT * FROM (${legs}) u ORDER BY COALESCE(u.ModifiedDate, u.CreatedDate) DESC, u.Id DESC`,
        { ClubId: clubId, Keys: moduleKey && moduleKey.trim() ? [moduleKey] : ALL_KEYS });
      return ok(raw.map((r) => ({
        id: Number(r.Id), yearId: Number(r.YearId), yearLabel: r.YearLabel ?? "", moduleKey: r.ModuleKey ?? "", moduleName: r.ModuleName ?? "", title: r.Title ?? "",
        description: r.Description, location: r.Location, projectDate: dayOf(r.ProjectDate), areaOfFocus: r.AreaOfFocus, category: r.Category, projectType: r.ProjectType,
        parentProjectId: r.ParentProjectId === null ? null : Number(r.ParentProjectId), childCount: Number(r.ChildCount ?? 0), primaryPhotoPath: r.PrimaryPhotoPath,
        currency: r.Currency ?? resolveDefaultCurrency(null), createdDate: stampOf(r.CreatedDate), modifiedDate: stampOf(r.ModifiedDate),
      })));
    });
  }
}

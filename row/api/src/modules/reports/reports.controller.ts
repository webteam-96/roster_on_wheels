import { Controller, Get, Query } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { forbid, ok } from "../../common/results";
import { queryInt, queryString } from "../../common/binding";
import { Brand } from "../../brand/brand";
import { YearTableResolver } from "../../services/year-table.resolver";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { DG_EMAIL, DG_JOIN_MEMBER, DG_MOBILE, DG_NAME } from "../../services/district-governor-sql";
import { PphCampService } from "../pph-camps/pph-camp.service";

/** [parameter name, value (null = filter off), SQL appended when on] */
type Filter = [string, unknown, string];
const DISTRICT_ORDER = "CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber";
const bloodGroupOn = () => Brand.feature("member.bloodGroup");
const familyOn = () => Brand.feature("member.familyDetails");

/**
 * Port of ReportsController.cs: the SuperAdmin "Reports" hub (api/admin/reports). Every
 * action returns raw rows the admin app exports to Excel; optional yearId / districtId
 * filters are appended to the SQL as the C# does with DynamicParameters.
 * ROW: blood group and family columns follow the member.bloodGroup / member.familyDetails flags.
 */
@Controller("api/admin/reports")
@Authorize()
export class ReportsController {
  constructor(
    private readonly db: Db,
    private readonly yearTables: YearTableResolver,
    private readonly pph: PphCampService,
  ) {}

  private isSa = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");

  /** SuperAdmin guard, then base SQL + the filters that have a value + ORDER BY. */
  private async rows(u: CurrentUser, sql: string, order: string, ...filters: Filter[]) {
    if (!this.isSa(u)) return forbid();
    const p: Record<string, unknown> = {};
    for (const [name, value, clause] of filters)
      if (value !== null && value !== undefined) {
        sql += clause;
        p[name] = value;
      }
    return ok(await this.db.query(sql + order, p));
  }

  private static year = (v: number | null, clause: string): Filter => ["YearId", v, clause];
  private static district = (v: number | null, clause: string): Filter => ["DistrictId", v, clause];

  @Get("districts-list")
  districtsList(@User() u: CurrentUser) {
    return this.rows(u, `SELECT pk_district_id AS id, DistrictNumber AS districtNumber FROM district_master WHERE isdeleted = 0`, " ORDER BY CAST(DistrictNumber AS UNSIGNED), DistrictNumber");
  }

  // ==================== ZONES ====================

  @Get("zones")
  zones(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT z.pk_zone_id AS zoneId,
              z.ZoneName AS zoneName,
              (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS districtCount,
              z.IsActive AS isActive,
              z.created_date AS createdDate
       FROM zone_master z
       WHERE z.isdeleted = 0`,
      " ORDER BY z.ZoneName",
    );
  }

  @Get("zone-coordinators")
  zoneCoordinators(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT z.ZoneName AS zoneName,
              m.MemberName AS memberName,
              m.RotaryId AS rotaryId,
              m.EmailId AS email,
              m.PrimaryMobileNumber AS mobile,
              c.ClubName AS clubName,
              d.DistrictNumber AS districtNumber,
              mr.AssignedDate AS assignedDate
       FROM member_roles mr
       JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id AND z.isdeleted = 0
       JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id AND m.isdeleted = 0
       LEFT JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            AND cm.IsActive = 1 AND cm.isdeleted = 0
       LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE mr.fk_role_id = 4 AND mr.IsActive = 1 AND mr.isdeleted = 0`,
      " ORDER BY z.ZoneName, m.MemberName",
    );
  }

  /** Role ids: 1 Member, 2 Admin (district + club), 3 SuperAdmin, 4 ZonalCoord, 5 ClubModerator, 6 AG, 7 RIDirector. */
  @Get("members-by-role")
  membersByRole(@User() u: CurrentUser, @Query("role") role?: string) {
    const key = (queryString(role) ?? "").trim().toLowerCase();
    const roleId = ({ superadmin: 3, ridirector: 7, ag: 6, clubmoderator: 5, districtadmin: 2, clubadmin: 2, alladmin: 2, admin: 2 } as Record<string, number>)[key] ?? null;
    const scopeFilter = key === "districtadmin" ? " AND mem_role.fk_district_id <> 0 " : key === "clubadmin" ? " AND mem_role.fk_club_id     <> 0 " : "";
    const allFilter = roleId === null ? " AND mem_role.fk_role_id <> 1 " : "";
    if (!this.isSa(u)) return forbid();
    return this.db
      .query(
        `SELECT DISTINCT
             dist.DistrictNumber   AS districtNumber,
             club.ClubName         AS clubName,
             pro.MemberName        AS memberName,
             pro.PrimaryMobileNumber AS mobile,
             pro.EmailId           AS email
         FROM member_master_profile pro
         INNER JOIN club_members club_mem
             ON club_mem.fk_member_master_profile_id = pro.pk_member_master_profile_id
            AND club_mem.IsActive = 1 AND COALESCE(club_mem.isdeleted, 0) = 0
         INNER JOIN club_master club
             ON club.pk_club_id = club_mem.fk_club_id
            AND COALESCE(club.isdeleted, 0) = 0
         INNER JOIN district_master dist
             ON dist.pk_district_id = club.fk_district_id
            AND COALESCE(dist.isdeleted, 0) = 0
         INNER JOIN member_roles mem_role
             ON mem_role.fk_member_master_profile_id = pro.pk_member_master_profile_id
            AND mem_role.IsActive = 1 AND COALESCE(mem_role.isdeleted, 0) = 0
         WHERE COALESCE(pro.isdeleted, 0) = 0
           AND club_mem.fk_club_id <> 0
           AND (@RoleId IS NULL OR mem_role.fk_role_id = @RoleId)
           ${scopeFilter}${allFilter}
         ORDER BY CAST(dist.DistrictNumber AS UNSIGNED), dist.DistrictNumber, club.ClubName, pro.MemberName`,
        { RoleId: roleId },
      )
      .then(ok);
  }

  // ==================== DISTRICTS ====================

  @Get("districts")
  districts(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.pk_district_id AS districtId,
              d.DistrictNumber AS districtNumber,
              z.ZoneName AS zoneName,
              (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS clubCount,
              d.created_date AS createdDate
       FROM district_master d
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
       WHERE d.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}`,
      ReportsController.district(queryInt(d), " AND d.pk_district_id = @DistrictId"),
    );
  }

  @Get("district-governors")
  districtGovernors(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber,
              y.YearLabel AS year,
              ${DG_NAME} AS memberName,
              COALESCE(${DG_EMAIL}, '') AS email,
              COALESCE(${DG_MOBILE}, '') AS mobile,
              g.description AS description,
              g.created_date AS createdDate
       FROM district_governors g
       JOIN district_master d ON d.pk_district_id = g.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
       ${DG_JOIN_MEMBER}
       WHERE g.isdeleted = 0`,
      ` ORDER BY y.YearLabel DESC, ${DISTRICT_ORDER}`,
      ReportsController.year(queryInt(y), " AND g.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND g.fk_district_id = @DistrictId"),
    );
  }

  // ==================== CLUBS ====================

  @Get("clubs")
  clubs(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT c.pk_club_id AS clubId, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName,
              d.DistrictNumber AS districtNumber,
              z.ZoneName AS zoneName,
              c.MeetingDay AS meetingDay, c.MeetingFromTime AS meetingFromTime, c.MeetingToTime AS meetingToTime,
              c.MeetingAddress AS meetingAddress,
              c.City AS city, c.State AS state, c.Country AS country, c.Pincode AS pincode,
              c.Latitude AS latitude, c.Longitude AS longitude,
              c.ClubWebsite AS clubWebsite,
              c.Timezone AS timezone,
              c.ActiveFromDate AS activeFromDate, c.ActiveToDate AS activeToDate,
              CASE WHEN c.IsAutomaticMeetingReminder = 1 THEN 'Yes' ELSE 'No' END AS autoReminder,
              CASE WHEN c.IsFamilyLogin = 1 THEN 'Yes' ELSE 'No' END AS familyLogin,
              (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0 AND cm.IsActive = 1 AND m.isdeleted = 0) AS totalMembers,
              CASE WHEN c.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive,
              c.ClubCharterDate AS charterDate
       FROM club_master c
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE c.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-members")
  clubMembers(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
              m.RotaryId AS rotaryId, m.EmailId AS email,
              m.PrimaryMobileNumber AS mobile, m.Gender AS gender,
              m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
              ${bloodGroupOn() ? "m.BloodGroup" : "NULL"} AS bloodGroup,
              c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
              d.DistrictNumber AS districtNumber,
              z.ZoneName AS zoneName,
              ${cogJoinedDateExpr("cm")} AS joinedDate,
              ${cogSelectColumns("cm")}
       FROM club_members cm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.isdeleted = 0 AND cm.IsActive = 1`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName, m.MemberName`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-leadership")
  clubLeadership(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber,
              c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName,
              y.YearLabel AS year,
              dm.designation_name AS designation,
              m.MemberName AS memberName,
              m.EmailId AS email, m.PrimaryMobileNumber AS mobile
       FROM board_of_directors b
       JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
       JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
       WHERE b.isdeleted = 0
         AND (LOWER(dm.designation_name) LIKE '%president%' OR LOWER(dm.designation_name) LIKE '%secretary%')
         AND LOWER(dm.designation_name) NOT LIKE '%vice%'
         AND LOWER(dm.designation_name) NOT LIKE '%past%'`,
      ` ORDER BY y.YearLabel DESC, ${DISTRICT_ORDER}, c.ClubName, dm.sort_order`,
      ReportsController.year(queryInt(y), " AND b.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-websites")
  clubWebsites(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber,
              c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
              w.Subdomain AS subdomain, w.ClientDomain AS thirdPartyDomain,
              t.theme_name AS theme,
              w.StartDate AS startDate, w.EndDate AS endDate,
              DATEDIFF(w.EndDate, CURDATE()) AS daysLeft,
              w.Status AS status,
              w.AmountPaid AS amountPaid,
              w.TransactionId AS transactionId, w.PaymentDate AS paymentDate
       FROM club_websites w
       JOIN club_master c ON c.pk_club_id = w.fk_club_id
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
       WHERE w.isdeleted = 0`,
      " ORDER BY w.Status, w.EndDate",
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("district-websites")
  districtWebsites(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber,
              w.Subdomain AS subdomain, w.ClientDomain AS thirdPartyDomain,
              w.Status AS status, w.Notes AS notes,
              w.created_date AS createdDate
       FROM district_websites w
       JOIN district_master d ON d.pk_district_id = w.fk_district_id
       WHERE w.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}`,
      ReportsController.district(queryInt(d), " AND w.fk_district_id = @DistrictId"),
    );
  }

  // ==================== SETTINGS ====================

  @Get("rotary-years")
  rotaryYears(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT pk_year_id AS yearId,
              YearLabel AS yearLabel,
              StartDate AS startDate,
              EndDate AS endDate,
              CASE WHEN IsCurrent = 1 THEN 'Yes' ELSE 'No' END AS isCurrent
       FROM rotary_year_master
       WHERE isdeleted = 0`,
      " ORDER BY YearLabel DESC",
    );
  }

  @Get("designations")
  designations(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT pk_designation_id AS designationId,
              designation_name AS designationName,
              sort_order AS sortOrder
       FROM designation_master
       WHERE isdeleted = 0`,
      " ORDER BY sort_order, designation_name",
    );
  }

  @Get("themes")
  themes(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT pk_theme_id AS themeId,
              theme_name AS themeName,
              CASE
                  WHEN theme_image_path IS NULL OR theme_image_path = '' THEN NULL
                  WHEN theme_image_path LIKE '/%' THEN theme_image_path
                  ELSE CONCAT('/uploads/theme/', theme_image_path)
              END AS imagePath,
              created_date AS createdDate
       FROM theme_master
       WHERE isdeleted = 0`,
      " ORDER BY theme_name",
    );
  }

  @Get("module-master")
  moduleMaster(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT m.pk_module_id AS moduleId,
              m.ModuleKey AS moduleKey,
              m.ModuleName AS moduleName,
              m.ModuleLevel AS level,
              m.Description AS description,
              m.RouteUrl AS routeUrl,
              CASE WHEN m.IsDefaultForDistrict = 1 THEN 'Yes' ELSE 'No' END AS defaultForDistrict,
              CASE WHEN m.IsDefaultForClub = 1 THEN 'Yes' ELSE 'No' END AS defaultForClub,
              m.SortOrder AS sortOrder
       FROM module_master m
       WHERE m.isdeleted = 0`,
      " ORDER BY m.SortOrder, m.ModuleName",
    );
  }

  @Get("areas-of-focus")
  areasOfFocus(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT a.pk_area_of_focus_id AS areaId,
              a.name AS areaName,
              m.ModuleName AS moduleName,
              a.sort_order AS sortOrder,
              CASE WHEN a.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
       FROM area_of_focus_master a
       LEFT JOIN module_master m ON m.pk_module_id = a.fk_module_id
       WHERE a.isdeleted = 0`,
      " ORDER BY a.sort_order, a.name",
    );
  }

  @Get("categories")
  categories(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT a.name AS areaOfFocus,
              c.name AS categoryName,
              s.name AS subCategoryName,
              c.sort_order AS categorySortOrder,
              s.sort_order AS subSortOrder,
              CASE WHEN c.is_active = 1 THEN 'Yes' ELSE 'No' END AS categoryActive,
              CASE WHEN s.is_active = 1 THEN 'Yes' ELSE 'No' END AS subCategoryActive
       FROM category_master c
       LEFT JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id AND a.isdeleted = 0
       LEFT JOIN sub_category_master s ON s.fk_category_id = c.pk_category_id AND s.isdeleted = 0
       WHERE c.isdeleted = 0`,
      " ORDER BY a.name, c.sort_order, c.name, s.sort_order, s.name",
    );
  }

  @Get("funding")
  funding(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT pk_funding_id AS fundingId,
              name AS fundingName,
              sort_order AS sortOrder,
              CASE WHEN is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
       FROM funding_master
       WHERE isdeleted = 0`,
      " ORDER BY sort_order, name",
    );
  }

  @Get("international-president")
  internationalPresident(@User() u: CurrentUser, @Query("yearId") y?: string) {
    return this.rows(
      u,
      `SELECT y.YearLabel AS year,
              p.Name AS name,
              p.Designation AS designation,
              CASE
                  WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL
                  WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                  ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath)
              END AS profilePhoto
       FROM international_president p
       JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
       WHERE p.isdeleted = 0`,
      " ORDER BY y.YearLabel DESC",
      ReportsController.year(queryInt(y), " AND p.fk_year_id = @YearId"),
    );
  }

  // ==================== YEAR-SCOPED CLUB DATA ====================

  @Get("board-of-directors")
  boardOfDirectors(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string, @Query("syncSource") s?: string) {
    const syncSource = queryString(s);
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName,
              y.YearLabel AS year, dm.designation_name AS designation,
              m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
              m.RotaryId AS rotaryId,
              IFNULL(b.SyncSource, 'Manual') AS syncSource
       FROM board_of_directors b
       JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
       JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
       WHERE b.isdeleted = 0`,
      ` ORDER BY y.YearLabel DESC, ${DISTRICT_ORDER}, c.ClubName, dm.sort_order`,
      ReportsController.year(queryInt(y), " AND b.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
      ["SyncSource", syncSource === "Auto" || syncSource === "Manual" ? syncSource : null, " AND IFNULL(b.SyncSource, 'Manual') = @SyncSource"],
    );
  }

  @Get("club-announcements")
  clubAnnouncements(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year, a.Title AS title,
              a.Description AS description,
              a.PublishDateTime AS publishDate,
              a.ExpiryDateTime AS expiryDate,
              a.Status AS status,
              CASE WHEN a.IsDisplayOnBanner = 1 THEN 'Yes' ELSE 'No' END AS displayBanner,
              CASE WHEN a.IsSendWhatsapp = 1 THEN 'Yes' ELSE 'No' END AS sendWhatsApp
       FROM announcements a
       JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN rotary_year_master y ON a.PublishDateTime >= y.StartDate AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
       WHERE a.isdeleted = 0`,
      " ORDER BY a.PublishDateTime DESC",
      ReportsController.year(queryInt(y), " AND y.pk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-upcoming-events")
  clubUpcomingEvents(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year, e.Title AS title,
              e.Description AS description,
              e.EventDate AS eventDate,
              e.EventVenue AS venue,
              e.RegistrationLink AS registrationLink,
              e.Status AS status
       FROM upcoming_events e
       JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN rotary_year_master y ON e.PublishDate >= y.StartDate AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
       WHERE e.isdeleted = 0`,
      " ORDER BY e.EventDate DESC",
      ReportsController.year(queryInt(y), " AND y.pk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-attendance")
  clubAttendance(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year, a.EventName AS eventName,
              a.EventDateTime AS eventDate,
              a.Description AS description,
              (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
              (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
              (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS visitingRotarians
       FROM club_attendance a
       JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
       WHERE a.isdeleted = 0`,
      " ORDER BY a.EventDateTime DESC",
      ReportsController.year(queryInt(y), " AND a.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-documents")
  clubDocuments(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year, doc.Title AS title,
              doc.AccessType AS accessType,
              CASE
                  WHEN doc.FilePath IS NULL OR doc.FilePath = '' THEN NULL
                  WHEN doc.FilePath LIKE '/%' THEN doc.FilePath
                  WHEN doc.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', doc.FilePath)
                  WHEN doc.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', doc.fk_district_id, '/', doc.FilePath)
                  ELSE CONCAT('/Documents/documentsafe/Group', doc.fk_club_id, '/', doc.FilePath)
              END AS filePath,
              doc.OriginalFileName AS fileName,
              doc.PublishDateTime AS publishDate,
              doc.ExpiryDateTime AS expiryDate,
              doc.Status AS status
       FROM club_documents doc
       JOIN club_master c ON c.pk_club_id = doc.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN rotary_year_master y ON doc.PublishDateTime >= y.StartDate AND doc.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
       WHERE doc.isdeleted = 0`,
      " ORDER BY doc.PublishDateTime DESC",
      ReportsController.year(queryInt(y), " AND y.pk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-monthly-reports")
  clubMonthlyReports(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year, r.ReportMonth AS month,
              r.MemberCountLastMonth AS lastMonthCount,
              r.MembersDeleted AS deleted,
              r.MembersAdded AS added,
              r.CurrentMemberCount AS currentCount,
              CASE WHEN r.IsUploadedToDistrict = 1 THEN 'Yes' ELSE 'No' END AS uploadedToDistrict,
              r.AdditionalRemarks AS remarks,
              r.created_date AS createdDate
       FROM club_monthly_reports r
       JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
       WHERE r.isdeleted = 0`,
      ` ORDER BY y.YearLabel DESC, ${DISTRICT_ORDER}, c.ClubName, r.ReportMonth`,
      ReportsController.year(queryInt(y), " AND r.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  /** One year's table when yearId is given, else UNION ALL across every existing year table. */
  @Get("rotary-projects")
  async rotaryProjects(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    if (!this.isSa(u)) return forbid();
    return this.db.session(async (conn) => {
      const tables = yearId !== null ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t) => t !== null) : await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok([]);
      const districtFilter = districtId !== null ? " AND c.fk_district_id = @DistrictId" : "";
      const legs = tables
        .map(
          (t) => `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                 '${t!.yearLabel}' AS year, md.ModuleName AS serviceType,
                 p.title AS title, p.description AS description, p.location AS location,
                 p.project_date AS projectDate, p.project_cost AS cost,
                 p.direct_beneficiaries AS beneficiaries, p.man_hours AS manHours,
                 p.rotarians_involved AS rotarians, p.rotaractors_involved AS rotaractors,
                 COALESCE(p.rcc_involved,0) AS rcc,
                 p.project_type AS projectType,
                 CASE WHEN p.is_joint_project = 1 THEN 'Yes' ELSE 'No' END AS jointProject,
                 p.co_host_name AS coHost,
                 a.name AS areaOfFocus, cat.name AS category, sub.name AS subCategory,
                 f.name AS funding,
                 p.global_grant_number AS globalGrantNumber,
                 p.amount_sanctioned AS amountSanctioned,
                 p.amount_received AS amountReceived,
                 p.amount_spent AS amountSpent,
                 p.host_clubs_districts AS hostClubsDistricts,
                 p.global_partner_clubs_districts AS globalPartnerClubsDistricts,
                 p.csr_company_name AS csrCompanyName
          FROM \`${t!.projectsTable}\` p
          JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
          JOIN district_master d ON d.pk_district_id = c.fk_district_id
          LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
          LEFT JOIN area_of_focus_master a ON a.pk_area_of_focus_id = p.fk_area_of_focus_id
          LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
          LEFT JOIN sub_category_master sub ON sub.pk_sub_category_id = p.fk_sub_category_id
          LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
          WHERE p.isdeleted = 0${districtFilter}`,
        )
        .join(" UNION ALL ");
      return ok(await conn.query(`SELECT * FROM (${legs}) u ORDER BY u.projectDate DESC`, districtId !== null ? { DistrictId: districtId } : {}));
    });
  }

  @Get("trf-contributions")
  trfContributions(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year, t.TrfDate AS trfDate,
              t.DonorName AS donorName,
              t.AmountUSD AS amountUSD,
              t.FundType AS fundType,
              f.FundName AS fundName,
              t.OtherFundName AS otherFundName
       FROM trf_contributions t
       JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = t.fk_year_id
       LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
       WHERE t.isdeleted = 0`,
      " ORDER BY t.TrfDate DESC",
      ReportsController.year(queryInt(y), " AND t.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("pph-camps")
  pphCamps(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              pc.Title AS title,
              pc.Description AS description,
              pc.Address AS address,
              pc.CampDate AS campDate,
              (SELECT COUNT(*) FROM pph_camp_attendance pa WHERE pa.fk_camp_id = pc.pk_camp_id) AS attendanceCount,
              CASE WHEN pc.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive
       FROM pph_camps pc
       JOIN club_master c ON c.pk_club_id = pc.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE pc.isdeleted = 0`,
      " ORDER BY pc.CampDate DESC",
      ReportsController.year(
        queryInt(y),
        ` AND pc.CampDate BETWEEN
            (SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @YearId)
            AND (SELECT EndDate FROM rotary_year_master WHERE pk_year_id = @YearId)`,
      ),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  /** Every attendee entry across all camps (never deduped), club-wise. */
  @Get("pph-attendees")
  async pphAttendees(@User() u: CurrentUser) {
    if (!this.isSa(u)) return forbid();
    return ok(await this.pph.getAttendeeReport("all", null));
  }

  @Get("newsletters")
  newsletters(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year, n.Title AS title,
              n.PublishDateTime AS publishDate,
              n.ExpiryDateTime AS expiryDate,
              n.AttachmentType AS attachmentType,
              n.LinkUrl AS linkUrl,
              CASE
                  WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                  WHEN n.FilePath LIKE '/%' THEN n.FilePath
                  WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                  WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                  WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                  ELSE NULL
              END AS filePath,
              n.Status AS status
       FROM newsletters n
       JOIN club_master c ON c.pk_club_id = n.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN rotary_year_master y ON n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
       WHERE n.isdeleted = 0`,
      " ORDER BY n.PublishDateTime DESC",
      ReportsController.year(queryInt(y), " AND y.pk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  // ==================== DISTRICT & SPECIALTY ====================

  @Get("district-committee")
  districtCommittee(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, y.YearLabel AS year,
              cm.name AS memberName,
              CASE WHEN COALESCE(cm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                   THEN m.PrimaryMobileNumber ELSE cm.mobile END AS mobile,
              CASE WHEN COALESCE(cm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                   THEN m.EmailId ELSE cm.email END AS email,
              cm.district_designation AS designation,
              c.ClubName AS clubName,
              cm.district_remark AS remark,
              cm.sort_order AS sortOrder,
              CASE WHEN cm.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
       FROM district_committee_member cm
       JOIN district_master d ON d.pk_district_id = cm.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = cm.fk_year_id
       LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_id AND m.isdeleted = 0
       WHERE cm.isdeleted = 0`,
      ` ORDER BY y.YearLabel DESC, ${DISTRICT_ORDER}, cm.sort_order`,
      ReportsController.year(queryInt(y), " AND cm.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND cm.fk_district_id = @DistrictId"),
    );
  }

  @Get("assistant-governors")
  assistantGovernors(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber,
              c.ClubName AS assignedClub, c.ClubRotaryId AS clubRotaryId,
              m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
              m.RotaryId AS rotaryId,
              y.YearLabel AS yearLabel,
              CASE WHEN ag.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive,
              ag.created_date AS assignedDate
       FROM district_ag ag
       JOIN district_master d ON d.pk_district_id = ag.fk_district_id
       JOIN club_master c ON c.pk_club_id = ag.fk_club_id AND c.isdeleted = 0
       JOIN member_master_profile m ON m.pk_member_master_profile_id = ag.fk_member_id AND m.isdeleted = 0
       LEFT JOIN rotary_year_master y ON y.pk_year_id = ag.fk_year_id
       WHERE ag.isdeleted = 0`,
      ` ORDER BY y.YearLabel DESC, ${DISTRICT_ORDER}, c.ClubName`,
      ReportsController.district(queryInt(d), " AND ag.fk_district_id = @DistrictId"),
      ReportsController.year(queryInt(y), " AND ag.fk_year_id = @YearId"),
    );
  }

  @Get("moderators")
  moderators(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber,
              c.ClubName AS assignedClub, c.ClubRotaryId AS clubRotaryId,
              m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
              m.RotaryId AS rotaryId,
              CASE WHEN mo.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive,
              mo.created_date AS assignedDate
       FROM district_club_moderator mo
       JOIN district_master d ON d.pk_district_id = mo.fk_district_id
       JOIN club_master c ON c.pk_club_id = mo.fk_club_id AND c.isdeleted = 0
       JOIN member_master_profile m ON m.pk_member_master_profile_id = mo.fk_member_id AND m.isdeleted = 0
       WHERE mo.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName`,
      ReportsController.district(queryInt(d), " AND mo.fk_district_id = @DistrictId"),
    );
  }

  @Get("district-upcoming-events")
  districtUpcomingEvents(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, y.YearLabel AS year,
              e.Title AS title, e.Description AS description,
              e.EventDate AS eventDate, e.EventVenue AS venue,
              e.RegistrationLink AS registrationLink, e.Status AS status
       FROM upcoming_events e
       JOIN district_master d ON d.pk_district_id = e.fk_district_id
       JOIN rotary_year_master y ON e.PublishDate >= y.StartDate AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
       WHERE e.isdeleted = 0 AND e.fk_district_id IS NOT NULL AND e.Scope = 'district'`,
      " ORDER BY e.EventDate DESC",
      ReportsController.year(queryInt(y), " AND y.pk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND e.fk_district_id = @DistrictId"),
    );
  }

  @Get("membership-dues")
  membershipDues(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              md.RotaryYear AS rotaryYear,
              md.Purpose AS purpose,
              md.DefaultCategoryType AS categoryType,
              md.DefaultAnnualAmount AS annualAmount,
              md.DefaultSemi1Amount AS semi1Amount,
              md.DefaultSemi2Amount AS semi2Amount,
              md.ModeOfPayment AS modeOfPayment,
              CASE WHEN md.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive,
              md.created_date AS createdDate
       FROM membership_dues md
       JOIN club_master c ON c.pk_club_id = md.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = md.fk_district_id
       WHERE md.isdeleted = 0`,
      ` ORDER BY md.RotaryYear DESC, ${DISTRICT_ORDER}, c.ClubName`,
      ReportsController.year(queryInt(y), " AND md.RotaryYear = (SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId)"),
      ReportsController.district(queryInt(d), " AND md.fk_district_id = @DistrictId"),
    );
  }

  @Get("event-payment-links")
  eventPaymentLinks(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT ep.pk_id AS linkId,
              ep.Title AS title,
              ep.Description AS description,
              ep.FormType AS formType,
              ep.AmountType AS amountType,
              d.DistrictNumber AS districtNumber,
              c.ClubName AS clubName,
              CASE WHEN ep.IsForAllDistricts = 1 THEN 'Yes' ELSE 'No' END AS forAllDistricts,
              ep.WeblinkUrl AS weblinkUrl,
              (SELECT COUNT(*) FROM event_payment_registrations r WHERE r.fk_payment_link_id = ep.pk_id) AS registrations,
              CASE WHEN ep.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive,
              ep.created_date AS createdDate
       FROM event_payment_links ep
       LEFT JOIN district_master d ON d.pk_district_id = ep.fk_district_master_id
       LEFT JOIN club_master c ON c.pk_club_id = ep.fk_club_id
       WHERE ep.isdeleted = 0`,
      " ORDER BY ep.created_date DESC",
      ReportsController.district(queryInt(d), " AND (ep.fk_district_master_id = @DistrictId OR c.fk_district_id = @DistrictId)"),
    );
  }

  @Get("zonal-awards")
  zonalAwards(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, y.YearLabel AS year,
              COUNT(DISTINCT e.pk_id) AS entryCount,
              SUM(e.received_points) AS totalPoints,
              SUM(e.entered_counts) AS totalCounts
       FROM zonal_awards_district_entry e
       JOIN district_master d ON d.pk_district_id = e.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = e.fk_year_id
       WHERE e.isdeleted = 0`,
      " GROUP BY d.DistrictNumber, y.YearLabel ORDER BY y.YearLabel DESC, totalPoints DESC",
      ReportsController.year(queryInt(y), " AND e.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND e.fk_district_id = @DistrictId"),
    );
  }

  @Get("district-citation")
  districtCitation(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year,
              COUNT(DISTINCT ce.pk_id) AS entryCount,
              SUM(ce.points_earned) AS pointsEarned,
              SUM(ce.bonus_earned) AS bonusEarned,
              (SUM(ce.points_earned) + SUM(ce.bonus_earned)) AS totalPoints
       FROM district_citation_club_entry ce
       JOIN club_master c ON c.pk_club_id = ce.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = ce.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = ce.fk_year_id
       WHERE ce.isdeleted = 0`,
      ` GROUP BY d.DistrictNumber, c.ClubName, y.YearLabel ORDER BY y.YearLabel DESC, ${DISTRICT_ORDER}, totalPoints DESC`,
      ReportsController.year(queryInt(y), " AND ce.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND ce.fk_district_id = @DistrictId"),
    );
  }

  // ==================== MEMBER & MODULE ====================

  /** One row per (member x family member). ROW: with family details off, one row per member and no family columns filled. */
  @Get("members-full-details")
  membersFullDetails(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT m.MemberName AS memberName, m.RotaryId AS rotaryId,
              m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
              m.SecondaryMobileNumber AS secondaryMobile,
              m.Gender AS gender, m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
              ${bloodGroupOn() ? "m.BloodGroup" : "NULL"} AS bloodGroup, m.PrimaryLanguage AS language,
              CASE WHEN cm.IsHonoraryMember = 1 THEN 'Yes' ELSE 'No' END AS isHonorary,
              CASE WHEN m.IsYouth = 1 THEN 'Yes' ELSE 'No' END AS isYouth,
              z.ZoneName AS zoneName, d.DistrictNumber AS districtNumber,
              c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
              ${cogJoinedDateExpr("cm")} AS joinedDate,
              ${cogSelectColumns("cm")},
              f.Name AS familyName, f.Relation AS familyRelation,
              f.PhoneNumber AS familyPhone, f.EmailId AS familyEmail,
              f.BirthDate AS familyBirthDate, f.AnniversaryDate AS familyAnniversaryDate,
              ${bloodGroupOn() ? "f.BloodGroup" : "NULL"} AS familyBloodGroup
       FROM club_members cm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       LEFT JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id AND f.isdeleted = 0${familyOn() ? "" : " AND 1 = 0"}
       WHERE cm.isdeleted = 0 AND cm.IsActive = 1`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName, m.MemberName, f.Relation`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("members-contact-summary")
  membersContactSummary(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT z.ZoneName AS zoneName,
              d.DistrictNumber AS districtNumber,
              c.ClubName AS clubName,
              m.MemberName AS memberName,
              m.PrimaryMobileNumber AS mobile,
              m.EmailId AS email
       FROM club_members cm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.isdeleted = 0 AND cm.IsActive = 1`,
      ` ORDER BY z.ZoneName, ${DISTRICT_ORDER}, c.ClubName, m.MemberName`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("mobile-app-users")
  mobileAppUsers(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT z.ZoneName AS zoneName,
              d.DistrictNumber AS districtNumber,
              c.ClubName AS clubName,
              m.MemberName AS memberName,
              m.RotaryId AS rotaryId,
              m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
              m.MobileLoginCount AS loginCount,
              m.LastImei AS lastImei,
              m.LastDeviceName AS lastDeviceName,
              m.FirstMobileVisit AS firstVisit,
              m.LastMobileVisit AS lastVisit,
              m.LastMobileLogout AS lastLogout
       FROM club_members cm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.isdeleted = 0 AND cm.IsActive = 1
         AND COALESCE(m.MobileLoginCount, 0) > 0`,
      " ORDER BY m.LastMobileVisit DESC",
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("members-addresses")
  membersAddresses(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber,
              c.ClubName AS clubName,
              m.MemberName AS memberName,
              m.RotaryId AS rotaryId,
              a.AddressType AS addressType,
              a.Address AS address,
              a.City AS city, a.State AS state, a.PinCode AS pincode,
              co.CountryName AS country,
              a.PhoneNumber AS phone,
              a.BusinessName AS businessName,
              a.BusinessEmailId AS businessEmail,
              cmd.Designation AS designation,
              cmd.ClassificationProfession AS profession,
              a.Keywords AS keywords
       FROM member_address_details a
       JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_master_profile_id AND m.isdeleted = 0
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0 AND cm.IsActive = 1
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN country_master co ON co.pk_country_id = a.fk_country_id
       LEFT JOIN (
           SELECT fk_member_master_profile_id,
                  MAX(Designation) AS Designation,
                  MAX(ClassificationProfession) AS ClassificationProfession
           FROM club_members
           WHERE COALESCE(isdeleted, 0) = 0
           GROUP BY fk_member_master_profile_id
       ) cmd ON cmd.fk_member_master_profile_id = m.pk_member_master_profile_id
       WHERE a.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName, m.MemberName, a.AddressType`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-weblinks")
  clubWeblinks(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              w.Level AS level,
              w.Title AS title,
              w.LinkType AS linkType,
              w.LinkUrl AS linkUrl,
              CASE
                  WHEN w.PdfPath IS NULL OR w.PdfPath = '' THEN NULL
                  WHEN w.PdfPath LIKE '/%' THEN w.PdfPath
                  WHEN w.Scope = 'ri' THEN CONCAT('/Documents/Weblink/ri/', w.PdfPath)
                  WHEN w.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', w.fk_district_id, '/', w.PdfPath)
                  ELSE CONCAT('/Documents/Weblink/Group', w.fk_club_id, '/', w.PdfPath)
              END AS pdfPath,
              w.YoutubeUrl AS youtubeUrl,
              w.ButtonText AS buttonText,
              w.SortOrder AS sortOrder,
              CASE WHEN w.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive
       FROM weblinks w
       JOIN club_master c ON c.pk_club_id = w.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE w.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName, w.Level, w.SortOrder`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("potential-members")
  potentialMembers(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              pm.name AS name,
              pm.email AS email,
              pm.mobile_number AS mobile,
              pm.reference_details AS referenceDetails,
              pm.created_date AS createdDate
       FROM potential_members pm
       JOIN club_master c ON c.pk_club_id = pm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE pm.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName, pm.created_date DESC`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-mass-emails")
  clubMassEmails(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              me.FromName AS fromName,
              me.ReplyName AS replyName,
              me.ReplyEmail AS replyEmail,
              me.Subject AS subject,
              me.Status AS status,
              me.TotalRecipients AS totalRecipients,
              me.SentCount AS sentCount,
              me.FailedCount AS failedCount,
              me.SentDate AS sentDate,
              me.created_date AS createdDate
       FROM club_mass_emails me
       JOIN club_master c ON c.pk_club_id = me.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE me.isdeleted = 0`,
      " ORDER BY me.created_date DESC",
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("ri-director-credits")
  riDirectorCredits(@User() u: CurrentUser) {
    return this.rows(
      u,
      `SELECT pk_credit_id AS creditId,
              CreditType AS creditType,
              CreditCount AS purchasedCount,
              UsedCount AS usedCount,
              PreviousCount AS previousCount,
              (CreditCount - UsedCount) AS balance,
              FromDate AS fromDate,
              ToDate AS toDate,
              TransactionId AS transactionId,
              PaymentDate AS paymentDate,
              CASE
                  WHEN ProofDocumentPath IS NULL OR ProofDocumentPath = '' THEN NULL
                  WHEN ProofDocumentPath LIKE '/%' THEN ProofDocumentPath
                  ELSE CONCAT('/Documents/ri_credit_proofs/', ProofDocumentPath)
              END AS proofDocumentPath
       FROM ri_director_credits`,
      " ORDER BY FromDate DESC, pk_credit_id DESC",
    );
  }

  @Get("ocv-documents")
  ocvDocuments(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              y.YearLabel AS year,
              cat.CategoryName AS category,
              t.TypeName AS type,
              doc.CustomTypeName AS customType,
              doc.OriginalFileName AS fileName,
              CASE
                  WHEN doc.FilePath IS NULL OR doc.FilePath = '' THEN NULL
                  WHEN doc.FilePath LIKE '/%' THEN doc.FilePath
                  ELSE CONCAT('/Documents/OCV/Group', doc.fk_club_id, '/', doc.FilePath)
              END AS filePath,
              doc.FileSize AS fileSize,
              doc.Amount AS amount,
              doc.PaidOn AS paidOn,
              doc.created_date AS createdDate
       FROM ocv_documents doc
       JOIN club_master c ON c.pk_club_id = doc.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN rotary_year_master y ON y.pk_year_id = doc.fk_year_id
       LEFT JOIN ocv_document_category cat ON cat.pk_category_id = doc.fk_category_id
       LEFT JOIN ocv_document_type t ON t.pk_type_id = doc.fk_type_id
       WHERE doc.isdeleted = 0`,
      " ORDER BY doc.created_date DESC",
      ReportsController.year(queryInt(y), " AND doc.fk_year_id = @YearId"),
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }

  @Get("club-social-links")
  clubSocialLinks(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.rows(
      u,
      `SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
              sl.platform AS platform,
              sl.link_url AS linkUrl,
              sl.sort_order AS sortOrder,
              CASE WHEN sl.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
       FROM club_website_social_link sl
       JOIN club_master c ON c.pk_club_id = sl.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE sl.isdeleted = 0`,
      ` ORDER BY ${DISTRICT_ORDER}, c.ClubName, sl.sort_order`,
      ReportsController.district(queryInt(d), " AND c.fk_district_id = @DistrictId"),
    );
  }
}

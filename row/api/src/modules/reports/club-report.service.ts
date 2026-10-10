import { Injectable } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { badRequest, file, notFound, ok, statusCode, type ActionResult } from "../../common/results";
import { dbDateTime } from "../../common/binding";
import { dotnetRound, formatDate, nowIn } from "../../common/dotnet-format";
import { YearTableResolver } from "../../services/year-table.resolver";
import { CurrencyRateService } from "../../services/currency-rate.service";
import { convertCurrency, resolveDefaultCurrency } from "../../services/currency.helper";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { webRootPath } from "../../services/media-storage";
import * as Dcf from "../../services/directory-data-collection-fields";
import { MonthlyReportService } from "../monthly-reports/monthly-report.service";
import { buildWordAnnualReport, loadPhoto } from "../monthly-reports/cmr-documents";
import { buildAnnualClubServiceRawData, buildAvenueRawData, type AvenueSection } from "./club-report-word";

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const bloodGroupOn = () => Brand.feature("member.bloodGroup");
const familyOn = () => Brand.feature("member.familyDetails");
const hideBloodGroup = (rows: Row[]) => {
  if (!bloodGroupOn()) for (const r of rows) r.bloodGroup = null;
  return rows;
};

/** Path.GetInvalidFileNameChars removed, spaces to underscores. */
export const safeFileName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/ /g, "_");
export const fileStamp = () => formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "dd-MM-yyyy HH-mm-ss");

/**
 * Port of ClubReportController.cs (api/clubs/{clubId}/club-report). The action
 * bodies live here so the mobile twin (MobileClubAdminReportController) can
 * delegate to them, as the C# does through ActivatorUtilities.
 * ROW: blood group and family lists follow the member.bloodGroup / member.familyDetails flags.
 */
@Injectable()
export class ClubReportService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly yearTables: YearTableResolver,
    private readonly fx: CurrencyRateService,
    private readonly cmr: MonthlyReportService,
  ) {}

  private blocked = () => statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
  private get frontendUrl() { return (this.config.get("FrontendUrl") ?? Brand.Current.domains.adminOrigin ?? "").replace(/\/+$/, ""); }

  private static async districtCurrency(conn: DbCommands, clubId: number) {
    const row = await conn.queryFirstOrDefault(
      `SELECT d.DefaultCurrency AS DefaultCurrency, d.Country AS Country
       FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE c.pk_club_id = @C LIMIT 1`,
      { C: clubId },
    );
    return resolveDefaultCurrency(typeof row?.DefaultCurrency === "string" ? row.DefaultCurrency : null);
  }

  async attendanceMatrix(clubId: number, yearId: number): Promise<ActionResult> {
    if (!(await isClubDrillReachable(this.db, clubId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const clubName = (await conn.executeScalar("SELECT ClubName FROM club_master WHERE pk_club_id = @C AND isdeleted = 0", { C: clubId })) ?? "";
      const yearLabel = (await conn.executeScalar("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", { Y: yearId })) ?? "";
      const events = await conn.query(
        `SELECT a.pk_attendance_id AS id, a.EventName AS name, a.EventDateTime AS dateTime
         FROM club_attendance a
         WHERE a.fk_club_id = @C AND a.fk_year_id = @Y AND a.isdeleted = 0
         ORDER BY a.EventDateTime, a.pk_attendance_id`,
        { C: clubId, Y: yearId },
      );
      const members = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0
         ORDER BY m.MemberName`,
        { C: clubId },
      );
      const pairs = await conn.query(
        `SELECT am.fk_member_id AS memberId, am.fk_attendance_id AS attendanceId
         FROM club_attendance_members am
         JOIN club_attendance a ON a.pk_attendance_id = am.fk_attendance_id
         WHERE a.fk_club_id = @C AND a.fk_year_id = @Y AND a.isdeleted = 0`,
        { C: clubId, Y: yearId },
      );
      const present = new Map<number, Set<number>>();
      for (const p of pairs) {
        const mid = Number(p.memberId);
        if (!present.has(mid)) present.set(mid, new Set());
        present.get(mid)!.add(Number(p.attendanceId));
      }
      return ok({
        clubName: String(clubName),
        yearLabel: String(yearLabel),
        events: events.map((e) => ({ id: Number(e.id), name: e.name ?? "", dateTime: e.dateTime ?? null })),
        members: members.map((m) => ({ memberName: m.memberName ?? "", present: events.map((e) => present.get(Number(m.memberId))?.has(Number(e.id)) ?? false) })),
      });
    });
  }

  async getReport(clubId: number, yearId: number): Promise<ActionResult> {
    if (!(await isClubDrillReachable(this.db, clubId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const club = await conn.queryFirstOrDefault(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                c.fk_district_id AS fkDistrictId,
                CASE
                    WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                    WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                    ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                END AS clubLogo,
                c.City AS city, c.State AS state,
                d.DistrictNumber AS districtNumber
         FROM club_master c
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.pk_club_id = @Id AND c.isdeleted = 0`,
        { Id: clubId },
      );
      if (!club) return notFound({ message: "Club not found." });
      const year = await conn.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel AS yearLabel FROM rotary_year_master WHERE pk_year_id = @Id", { Id: yearId });

      const info = await this.yearTables.resolveByYearId(conn, yearId);
      let projects: Row[] = [];
      if (info) {
        projects = await conn.query(
          `SELECT p.pk_project_id AS id, p.title, p.description, p.project_date AS projectDate,
                  p.project_cost AS projectCost, COALESCE(p.Currency, @DefaultCurrency) AS currency, p.direct_beneficiaries AS directBeneficiaries,
                  p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                  p.rotaractors_involved AS rotaractorsInvolved,
                  COALESCE(p.rcc_involved,0) AS rccInvolved, p.location,
                  af.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory,
                  f.name AS funding, mm.ModuleName AS moduleName, mm.ModuleKey AS moduleKey,
                  p.approval_status AS approvalStatus,
                  CONCAT(@FrontendUrl, '/public/project/', p.pk_project_id, '?year=', @YearId) AS publicPhotoUrl
           FROM \`${info.projectsTable}\` p
           LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
           LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
           WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
           ORDER BY p.project_date DESC`,
          { ClubId: clubId, YearId: yearId, FrontendUrl: this.frontendUrl, DefaultCurrency: Brand.Current.locale.defaultCurrency },
        );
      }
      const projectsByModule: Record<string, Row[]> = {};
      for (const p of projects) (projectsByModule[p.moduleKey ?? "other"] ??= []).push(p);

      const yp = { ClubId: clubId, YearId: yearId };
      const announcements = await conn.query(
        `SELECT a.Title AS title, a.Description AS description, a.PublishDateTime AS publishDate,
                a.ExpiryDateTime AS expiryDate, a.IsSendWhatsapp AS isSendWhatsapp, a.IsDisplayOnBanner AS isDisplayOnBanner,
                CASE
                    WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                    WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                    WHEN a.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', a.ImagePath)
                    WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                    ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                END AS imagePath,
                CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                     WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
         FROM announcements a
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
           AND a.PublishDateTime >= y.StartDate
           AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         ORDER BY a.PublishDateTime DESC`,
        yp,
      );
      const events = await conn.query(
        `SELECT e.Title AS title, e.Description AS description, e.EventDate AS eventDate,
                e.EventVenue AS eventVenue, e.PublishDate AS publishDate, e.ExpiryDate AS expiryDate,
                e.RegistrationLink AS registrationLink, e.IsSendWhatsapp AS isSendWhatsapp,
                CASE
                    WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                    WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                    ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                END AS imagePath,
                CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                     WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
         FROM upcoming_events e
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0
           AND e.PublishDate >= y.StartDate
           AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         ORDER BY e.EventDate DESC`,
        yp,
      );
      const newsletters = await conn.query(
        `SELECT n.Title AS title, n.PublishDateTime AS publishDate, n.ExpiryDateTime AS expiryDate,
                n.AttachmentType AS attachmentType, n.LinkUrl AS linkUrl,
                CASE
                    WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                    WHEN n.FilePath LIKE '/%' THEN n.FilePath
                    WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                    WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                    WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                    ELSE NULL
                END AS filePath,
                n.IsSendWhatsapp AS isSendWhatsapp,
                CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                     WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
         FROM newsletters n
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE n.fk_club_id = @ClubId AND n.isdeleted = 0
           AND n.PublishDateTime >= y.StartDate
           AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         ORDER BY n.PublishDateTime DESC`,
        yp,
      );
      const documents = await conn.query(
        `SELECT d.Title AS title, d.AccessType AS accessType,
                CASE
                    WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                    WHEN d.FilePath LIKE '/%' THEN d.FilePath
                    WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                    WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                    ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                END AS filePath,
                d.PublishDateTime AS publishDate, d.ExpiryDateTime AS expiryDate
         FROM club_documents d
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE d.fk_club_id = @ClubId AND d.isdeleted = 0
           AND d.PublishDateTime >= y.StartDate
           AND d.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         ORDER BY d.PublishDateTime DESC`,
        yp,
      );

      const activeMemberCount = Number((await conn.executeScalar("SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0", { C: clubId })) ?? 0);
      const attendance = await conn.query(
        `SELECT a.EventName AS eventName, a.EventDateTime AS eventDateTime,
                (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
                (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS rotarians,
                @Total AS totalMembers,
                ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 1) AS attendancePercent
         FROM club_attendance a
         WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0
         ORDER BY a.EventDateTime DESC`,
        { ...yp, Total: activeMemberCount },
      );
      const bod = await conn.query(
        `SELECT (SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId) AS clubName,
                m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                CASE
                    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                END AS profilePhoto,
                dm.designation_name AS designation, dm.sort_order AS sortOrder,
                COALESCE(b.SyncSource, 'Manual') AS autoManual
         FROM board_of_directors b
         JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
         JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
         WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
         ORDER BY dm.sort_order`,
        yp,
      );
      const addressSql = (type: string) => `(SELECT CONCAT_WS(', ',
                           NULLIF(ad.Address,''), NULLIF(ad.City,''),
                           NULLIF(ad.State,''),   NULLIF(ad.PinCode,''))
                   FROM member_address_details ad
                  WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND ad.AddressType = '${type}'
                    AND COALESCE(ad.isdeleted, 0) = 0
                  ORDER BY ad.pk_member_address_details_id DESC LIMIT 1)`;
      const members = hideBloodGroup(
        await conn.query(
          `SELECT (SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId) AS clubName,
                  m.MemberName AS memberName,
                  CASE
                      WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                      WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                      ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                  END AS profilePhoto,
                  cm.ClassificationProfession AS classification,
                  cm.Designation              AS clubDesignation,
                  CASE WHEN cm.IsHonoraryMember = 1 THEN 'Honorary' ELSE 'Active' END AS memberType,
                  (SELECT cy.CountryName
                     FROM member_address_details ad
                     LEFT JOIN country_master cy ON cy.pk_country_id = ad.fk_country_id
                    WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND ad.AddressType = 'Residence'
                      AND COALESCE(ad.isdeleted, 0) = 0
                    ORDER BY ad.pk_member_address_details_id DESC LIMIT 1) AS country,
                  m.PrimaryMobileNumber AS mobile,
                  m.EmailId AS email,
                  m.Gender AS gender,
                  m.PrimaryLanguage AS primaryLanguage,
                  CASE WHEN m.IsYouth = 1 THEN 'Yes' ELSE 'No' END AS youthFlag,
                  m.BirthDate AS dob,
                  m.AnniversaryDate AS doa,
                  m.BloodGroup AS bloodGroup,
                  m.LastDeviceName AS deviceName,
                  CASE WHEN m.LastDeviceName IS NULL OR m.LastDeviceName = '' THEN 'No' ELSE 'Yes' END AS downloaded,
                  ${addressSql("Residence")} AS address,
                  ${addressSql("Business")} AS businessAddress,
                  m.RotaryId AS rotaryId,
                  ${cogJoinedDateExpr("cm")} AS riAdmissionDate,
                  ${cogSelectColumns("cm")},
                  m.BirthDate AS birthDate,
                  m.AnniversaryDate AS anniversaryDate
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
           ORDER BY m.MemberName`,
          { ClubId: clubId },
        ),
      );
      const appUsers = await conn.query(
        `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile,
                m.EmailId AS email, m.LastDeviceName AS deviceName
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
           AND m.LastDeviceName IS NOT NULL AND m.LastDeviceName <> ''
         ORDER BY m.MemberName`,
        { ClubId: clubId },
      );
      const family = !familyOn()
        ? []
        : await conn.query(
            `SELECT (SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId) AS clubName,
                    m.MemberName AS memberName,
                    m.PrimaryMobileNumber AS mobile,
                    m.EmailId AS email,
                    m.BirthDate AS dob,
                    m.AnniversaryDate AS doa,
                    m.RotaryId AS rotaryId,
                    ${addressSql("Residence")} AS address,
                    f.Relation        AS familyRelation,
                    f.Name            AS familyName,
                    f.PhoneNumber     AS familyMobile,
                    f.EmailId         AS familyEmail,
                    f.BirthDate       AS familyDob,
                    f.AnniversaryDate AS familyAnniversary,
                    ${bloodGroupOn() ? "f.BloodGroup" : "NULL"} AS familyBloodGroup
             FROM club_members cm
             JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
             JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id
                                         AND COALESCE(f.isdeleted, 0) = 0
             WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
             ORDER BY m.MemberName, f.Relation`,
            { ClubId: clubId },
          );
      const bloodGroups = !bloodGroupOn()
        ? []
        : await conn.query(
            `SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                    m.MemberName AS ownerName, 'Member' AS relation,
                    m.MemberName AS personName, m.PrimaryMobileNumber AS mobile,
                    m.EmailId AS email, m.BloodGroup AS bloodGroup,
                    m.MemberName AS sortName, 0 AS sortFamily
             FROM club_members cm
             JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
             JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
             JOIN district_master d ON d.pk_district_id = c.fk_district_id
             WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
               AND COALESCE(m.BloodGroup,'') <> ''
             UNION ALL
             SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                    m.MemberName AS ownerName, COALESCE(NULLIF(f.Relation,''),'Family') AS relation,
                    f.Name AS personName, f.PhoneNumber AS mobile,
                    f.EmailId AS email, f.BloodGroup AS bloodGroup,
                    m.MemberName AS sortName, 1 AS sortFamily
             FROM club_members cm
             JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
             JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id AND COALESCE(f.isdeleted,0) = 0
             JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
             JOIN district_master d ON d.pk_district_id = c.fk_district_id
             WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
               AND COALESCE(f.BloodGroup,'') <> ''
             ORDER BY sortName, sortFamily, personName`,
            { ClubId: clubId },
          );

      const attendanceMeetingWise = await conn.query(
        `SELECT a.EventDateTime AS date,
                a.EventName     AS title,
                a.Description   AS description,
                (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                @Total AS totalMembers,
                ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 2) AS attendancePercent,
                (SELECT COUNT(*) FROM club_attendance_anns      x WHERE x.fk_attendance_id = a.pk_attendance_id) AS anns,
                (SELECT COUNT(*) FROM club_attendance_annets    x WHERE x.fk_attendance_id = a.pk_attendance_id) AS annets,
                (SELECT COUNT(*) FROM club_attendance_visitors  x WHERE x.fk_attendance_id = a.pk_attendance_id) AS visitors,
                (SELECT COUNT(*) FROM club_attendance_rotarians x WHERE x.fk_attendance_id = a.pk_attendance_id) AS rotarians,
                (SELECT COUNT(*) FROM club_attendance_delegates x WHERE x.fk_attendance_id = a.pk_attendance_id) AS delegates
         FROM club_attendance a
         WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0
         ORDER BY a.EventDateTime DESC`,
        { ...yp, Total: activeMemberCount },
      );
      const attendedSql = `(SELECT COUNT(*) FROM club_attendance_members am
                   JOIN club_attendance a ON a.pk_attendance_id = am.fk_attendance_id
                  WHERE am.fk_member_id = m.pk_member_master_profile_id
                    AND a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0)`;
      const meetingsSql = `(SELECT COUNT(*) FROM club_attendance a
                  WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0)`;
      const attendanceMemberWise = await conn.query(
        `SELECT m.MemberName AS memberName,
                m.PrimaryMobileNumber AS mobile,
                m.EmailId AS email,
                ${attendedSql} AS meetingsAttended,
                ${meetingsSql} AS totalMeetings,
                ROUND(${attendedSql} * 100.0 / NULLIF(${meetingsSql}, 0), 2) AS attendancePercent
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
         ORDER BY m.MemberName`,
        yp,
      );
      const clubDues = await conn.query(
        `SELECT d.Title AS documentType,
                COALESCE(d.OriginalFileName, d.FilePath) AS documentName,
                d.created_date AS uploadedOn,
                d.PublishDateTime AS paidOn,
                CAST(NULL AS DECIMAL(15,2)) AS amount
         FROM club_documents d
         WHERE d.fk_club_id = @ClubId AND d.isdeleted = 0
         ORDER BY d.created_date DESC`,
        { ClubId: clubId },
      );

      const ocvDuesCatId = Number((await conn.executeScalar("SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'dues' LIMIT 1")) ?? 0);
      let duesReportOcv: Row[] = [];
      if (ocvDuesCatId > 0) {
        duesReportOcv = await conn.query(
          `SELECT t.pk_type_id AS typeId, COALESCE(t.TypeName,'') AS documentType, t.SortOrder AS typeSort,
                  COALESCE(SUM(d.Amount),0) AS amount,
                  MAX(d.PaidOn) AS paidOn,
                  CASE WHEN COUNT(d.pk_document_id) > 0 THEN 1 ELSE 0 END AS isUploaded,
                  (SELECT dm.DistrictNumber FROM district_master dm
                    JOIN club_master c2 ON c2.fk_district_id = dm.pk_district_id
                   WHERE c2.pk_club_id = @ClubId LIMIT 1) AS districtNumber
           FROM ocv_document_type t
           LEFT JOIN ocv_documents d ON d.fk_type_id = t.pk_type_id AND d.fk_club_id = @ClubId
                AND d.fk_category_id = @DuesCat AND d.fk_year_id = @YearId AND d.isdeleted = 0
           WHERE t.fk_category_id = @DuesCat AND t.isdeleted = 0 AND t.IsActive = 1
           GROUP BY t.pk_type_id, t.TypeName, t.SortOrder
           ORDER BY t.SortOrder, t.TypeName`,
          { ...yp, DuesCat: ocvDuesCatId },
        );
      }

      // "2025-26" -> Jul-Dec carry 2025, Jan-Jun carry 2026
      const thisYear = Number(nowIn(Brand.Current.locale.defaultTimeZone).slice(0, 4));
      let [rotaryStartYear, rotaryEndYear] = [thisYear, thisYear + 1];
      const m = /^(\d+)-/.exec(String(year?.yearLabel ?? ""));
      if (m) [rotaryStartYear, rotaryEndYear] = [Number(m[1]), Number(m[1]) + 1];

      const monthlyReport = await conn.query(
        `SELECT r.ReportMonth AS monthNum,
                DATE_FORMAT(
                  STR_TO_DATE(
                    CONCAT(
                      CASE WHEN r.ReportMonth >= 7 THEN @StartYear ELSE @EndYear END,
                      '-', r.ReportMonth, '-01'
                    ),
                    '%Y-%c-%d'
                  ),
                  '%M %Y'
                ) AS month,
                (SELECT COUNT(*) FROM club_attendance a
                  WHERE a.fk_club_id = r.fk_club_id AND a.fk_year_id = r.fk_year_id AND a.isdeleted = 0
                    AND MONTH(a.EventDateTime) = r.ReportMonth) AS meeting,
                COALESCE((SELECT SUM(t.AmountUSD) FROM trf_contributions t
                           WHERE t.fk_club_id = r.fk_club_id AND t.fk_year_id = r.fk_year_id AND t.isdeleted = 0
                             AND MONTH(t.TrfDate) = r.ReportMonth), 0) AS trf,
                0 AS clubService,
                0 AS projects, 0 AS cost, 0 AS beneficiaries, 0 AS manHours,
                0 AS rotariansInvolved, 0 AS rotaractors, 0 AS rcc,
                r.CurrentMemberCount AS members
         FROM club_monthly_reports r
         WHERE r.fk_club_id = @ClubId AND r.fk_year_id = @YearId AND r.isdeleted = 0
         ORDER BY CASE WHEN r.ReportMonth >= 7 THEN r.ReportMonth - 7 ELSE r.ReportMonth + 5 END`,
        { ...yp, StartYear: rotaryStartYear, EndYear: rotaryEndYear },
      );

      const reportCurrency = await ClubReportService.districtCurrency(conn, clubId);
      const rates = await this.fx.getRates();
      const n = (v: unknown) => Number(v ?? 0) || 0;
      for (const r of monthlyReport) {
        const month = Number(r.monthNum);
        const monthAll = projects.filter((p) => p.projectDate && Number(String(p.projectDate).slice(5, 7)) === month);
        r.clubService = monthAll.filter((p) => p.moduleKey === "club_service").length;
        const mp = monthAll.filter((p) => p.moduleKey !== "club_service");
        r.projects = mp.length;
        r.cost = mp.reduce((s, p) => s + convertCurrency(n(p.projectCost), p.currency, reportCurrency, rates), 0);
        r.beneficiaries = mp.reduce((s, p) => s + n(p.directBeneficiaries), 0);
        r.manHours = mp.reduce((s, p) => s + n(p.manHours), 0);
        r.rotariansInvolved = mp.reduce((s, p) => s + n(p.rotariansInvolved), 0);
        r.rotaractors = mp.reduce((s, p) => s + n(p.rotaractorsInvolved), 0);
        r.rcc = mp.reduce((s, p) => s + n(p.rccInvolved), 0);
      }

      const pphCamps = await conn.query(
        `SELECT c.CampDate AS campDate,
                c.Title    AS campName,
                c.Address  AS campAddress,
                (SELECT COUNT(*) FROM pph_camp_attendies a WHERE a.fk_camp_id = c.pk_camp_id AND a.isdeleted = 0) AS totalAttendees,
                c.Description AS campDescription
         FROM pph_camps c
         WHERE c.fk_club_id = @ClubId AND c.isdeleted = 0
         ORDER BY c.CampDate DESC`,
        { ClubId: clubId },
      );
      const pphCampAttendees = await conn.query(
        `SELECT c.CampDate     AS campDate,
                c.Title        AS campName,
                pa.created_date AS readingDate,
                pa.RegistrationNo AS serialNumber,
                att.Name       AS name,
                att.MobileNo   AS mobileNumber,
                att.Address    AS address,
                att.Sex        AS gender,
                CASE WHEN att.IsConsentedForMessages = 1 THEN 'Yes' ELSE 'No' END AS approvalForSms,
                pa.Age         AS age,
                pa.BPSystolic  AS bpSystolic,
                pa.BPDiastolic AS bpDiastolic,
                CASE WHEN pa.BloodSugarType = 'FBS' THEN pa.BloodSugarValue ELSE NULL END AS fbs,
                CASE WHEN pa.BloodSugarType = 'RBS' THEN pa.BloodSugarValue ELSE NULL END AS rbs,
                pa.HeightCm    AS height,
                pa.WeightKg    AS weight,
                pa.BMI         AS bmi,
                pa.DiabetesStatus  AS diabetes,
                pa.BPStatus        AS highBloodPressure,
                CASE WHEN pa.IsObese      = 1 THEN 'Yes' ELSE 'No' END AS obese,
                CASE WHEN pa.IsOverweight = 1 THEN 'Yes' ELSE 'No' END AS overweight,
                pa.Remarks     AS remarks
         FROM pph_camp_attendies att
         JOIN pph_camps c ON c.pk_camp_id = att.fk_camp_id AND COALESCE(c.isdeleted, 0) = 0
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         LEFT JOIN pph_camp_attendance pa
                ON pa.fk_attendee_id = att.pk_attendee_id AND COALESCE(pa.isdeleted, 0) = 0
         WHERE c.fk_club_id = @ClubId AND COALESCE(att.isdeleted, 0) = 0
           AND c.CampDate >= y.StartDate AND c.CampDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         ORDER BY c.CampDate DESC, att.Name, att.pk_attendee_id, pa.pk_attendance_id`,
        yp,
      );

      let dataCollection: Row | null = null;
      const clubDistrictId = await conn.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C AND isdeleted = 0", { C: clubId });
      if (clubDistrictId !== null && clubDistrictId !== undefined) {
        const cfg = await ClubReportService.dcConfigRow(conn, Number(clubDistrictId), yearId);
        if (cfg) {
          dataCollection = {
            configId: Number(cfg.id),
            enabled: true,
            columns: {
              allMembers: clubDcColumnSpec(Dcf.deserializeKeys(cfg.memberJson)),
              bod: clubDcColumnSpec(Dcf.deserializeKeys(cfg.bodJson)),
              dc: clubDcColumnSpec(Dcf.deserializeKeys(cfg.dcJson)),
            },
          };
        }
      }

      const trf = await conn.query(
        `SELECT t.TrfDate AS trfDate, t.DonorName AS donorName, t.AmountUSD AS amountUsd,
                t.FundType AS fundType, t.OtherFundName AS otherFundName,
                COALESCE(f.FundName, t.OtherFundName) AS fundName
         FROM trf_contributions t
         LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
         WHERE t.fk_club_id = @ClubId AND t.fk_year_id = @YearId AND t.isdeleted = 0
         ORDER BY t.TrfDate DESC`,
        yp,
      );

      const avgAttendance = attendance.length ? attendance.reduce((s, a) => s + n(a.attendancePercent), 0) / attendance.length : 0;
      return ok({
        club,
        rotaryYear: year,
        summary: {
          totalProjects: projects.length,
          totalAnnouncements: announcements.length,
          totalEvents: events.length,
          totalNewsletters: newsletters.length,
          totalDocuments: documents.length,
          totalMeetings: attendance.length,
          avgAttendancePercent: dotnetRound(avgAttendance, 1),
          activeMembers: members.length,
          bodCount: bod.length,
          totalTrfAmount: trf.reduce((s, t) => s + n(t.amountUsd), 0),
          totalTrfContributions: trf.length,
        },
        projectsByModule,
        announcements,
        events,
        newsletters,
        documents,
        attendance,
        bod,
        members,
        appUsers,
        family,
        bloodGroups,
        trf,
        attendanceMeetingWise,
        attendanceMemberWise,
        clubDues,
        duesReportOcv,
        monthlyReport,
        pphCamps,
        pphCampAttendees,
        dataCollection,
      });
    });
  }

  private static dcConfigRow(conn: DbCommands, districtId: number, yearId: number) {
    return conn.queryFirstOrDefault(
      `SELECT pk_id AS id,
              COALESCE(DcFieldsJson, '[]')     AS dcJson,
              COALESCE(BodFieldsJson, '[]')    AS bodJson,
              COALESCE(MemberFieldsJson, '[]') AS memberJson
       FROM district_directory_config
       WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
       LIMIT 1`,
      { D: districtId, Y: yearId },
    );
  }

  private static async dcConfig(conn: DbCommands, clubId: number, yearId: number) {
    const club = await conn.queryFirstOrDefault("SELECT IFNULL(fk_district_id, 0) AS districtId, IFNULL(ClubName, '') AS clubName FROM club_master WHERE pk_club_id = @C AND isdeleted = 0", { C: clubId });
    const districtId = Number(club?.districtId ?? 0);
    if (districtId === 0) return null;
    const cfg = await ClubReportService.dcConfigRow(conn, districtId, yearId);
    if (!cfg) return null;
    return {
      configId: Number(cfg.id),
      dcKeys: Dcf.deserializeKeys(cfg.dcJson),
      bodKeys: Dcf.deserializeKeys(cfg.bodJson),
      memberKeys: Dcf.deserializeKeys(cfg.memberJson),
      districtId,
      clubName: String(club!.clubName),
    };
  }

  /** The three data-collection lists: active members, BOD (designations 1, 2), district committee members of this club. */
  async dataCollection(clubId: number, yearId: number, list: "all-members" | "bod" | "dc"): Promise<ActionResult> {
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: "This club is inactive." });
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const cfg = await ClubReportService.dcConfig(conn, clubId, yearId);
      if (!cfg) return ok({ rows: [] });
      const cols = `m.pk_member_master_profile_id AS id, m.MemberName AS name,
                    m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                    m.SecondaryMobileNumber AS secMobile`;
      const group = "GROUP BY m.pk_member_master_profile_id, m.MemberName, m.PrimaryMobileNumber, m.RotaryId, m.SecondaryMobileNumber";
      let members: Row[];
      let keys: string[];
      if (list === "all-members") {
        keys = cfg.memberKeys;
        members = await conn.query(
          `SELECT ${cols}
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0
           ORDER BY m.MemberName`,
          { C: clubId },
        );
      } else if (list === "bod") {
        keys = cfg.bodKeys;
        members = await conn.query(
          `SELECT ${cols}
           FROM board_of_directors b
           JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE b.fk_club_id = @C AND b.fk_year_id = @Y AND b.isdeleted = 0
             AND b.fk_designation_id IN (1, 2)
           ${group}
           ORDER BY m.MemberName`,
          { C: clubId, Y: yearId },
        );
      } else {
        keys = cfg.dcKeys;
        members = await conn.query(
          `SELECT ${cols}
           FROM district_committee_member dcm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id AND m.isdeleted = 0
           JOIN club_members cm        ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
           WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @Y AND dcm.isdeleted = 0 AND dcm.is_active = 1
             AND cm.fk_club_id = @C AND cm.IsActive = 1
           ${group}
           ORDER BY m.MemberName`,
          { D: cfg.districtId, C: clubId, Y: yearId },
        );
      }
      const rows = [];
      for (const x of members) rows.push(await dcRow(conn, cfg.configId, Number(x.id), String(x.name ?? ""), x.mobile, x.rotaryId, x.secMobile, keys, cfg.clubName));
      return ok({ rows });
    });
  }

  private async clubHeader(conn: DbCommands, clubId: number, yearId: number) {
    const club = await conn.queryFirstOrDefault("SELECT c.ClubName AS clubName FROM club_master c WHERE c.pk_club_id = @Id AND c.isdeleted = 0", { Id: clubId });
    if (!club) return null;
    const year = await conn.queryFirstOrDefault("SELECT YearLabel AS yearLabel FROM rotary_year_master WHERE pk_year_id = @Id", { Id: yearId });
    const membership = Number((await conn.executeScalar("SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0", { C: clubId })) ?? 0);
    return { clubName: String(club.clubName), yearLabel: String(year?.yearLabel ?? ""), membership };
  }

  async avenueOfServiceRawData(clubId: number, yearId: number): Promise<ActionResult> {
    if (!(await isClubDrillReachable(this.db, clubId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const h = await this.clubHeader(conn, clubId, yearId);
      if (!h) return notFound();
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      const sections: AvenueSection[] = [];
      if (info) {
        const rows = await conn.query(
          `SELECT mm.ModuleKey  AS moduleKey,
                  mm.ModuleName AS moduleName,
                  COALESCE(af.name, '(Uncategorised)') AS areaOfFocus,
                  COUNT(*)                              AS projects,
                  COALESCE(SUM(p.direct_beneficiaries), 0) AS beneficiaries,
                  COALESCE(SUM(p.project_cost), 0)         AS amountSpent
           FROM \`${info.projectsTable}\` p
           JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
           LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
           WHERE p.fk_club_id = @C AND p.isdeleted = 0
           GROUP BY mm.ModuleKey, mm.ModuleName, af.name
           ORDER BY mm.ModuleName, af.name`,
          { C: clubId },
        );
        for (const r of rows) {
          const name = String(r.moduleName);
          let s = sections.find((x) => x.avenueName === name);
          if (!s) sections.push((s = { avenueName: name, rows: [] }));
          s.rows.push({ areaOfFocus: String(r.areaOfFocus), projects: Number(r.projects), beneficiaries: Number(r.beneficiaries), amountSpent: Number(r.amountSpent) });
        }
      }
      const bytes = await buildAvenueRawData(h.clubName, h.yearLabel, h.membership, sections);
      return file(bytes, DOCX_CONTENT_TYPE, `${safeFileName(h.clubName)}_Avenue_of_Service_Raw_Data_${fileStamp()}.docx`);
    });
  }

  async annualClubServiceRawData(clubId: number, yearId: number): Promise<ActionResult> {
    if (!(await isClubDrillReachable(this.db, clubId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const h = await this.clubHeader(conn, clubId, yearId);
      if (!h) return notFound();
      const rows = await conn.query(
        `SELECT a.EventDateTime AS date,
                a.EventName     AS title,
                a.Description   AS description,
                (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent
         FROM club_attendance a
         WHERE a.fk_club_id = @C AND a.fk_year_id = @Y AND a.isdeleted = 0
         ORDER BY a.EventDateTime`,
        { C: clubId, Y: yearId },
      );
      const meetings = rows.map((r) => ({ dateLabel: formatDate(r.date, "dd MMM yyyy"), title: String(r.title ?? ""), description: String(r.description ?? ""), membersPresent: Number(r.membersPresent) }));
      const bytes = await buildAnnualClubServiceRawData(h.clubName, h.yearLabel, h.membership, meetings);
      return file(bytes, DOCX_CONTENT_TYPE, `${safeFileName(h.clubName)}_Annual_Club_Service_Raw_Data_${fileStamp()}.docx`);
    });
  }

  async annualReport(clubId: number, yearId: number): Promise<ActionResult> {
    if (!(await isClubDrillReachable(this.db, clubId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    const prep = await this.db.session(async (conn) => {
      const club = await conn.queryFirstOrDefault("SELECT ClubName AS clubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId });
      if (!club) return null;
      const yr = await conn.queryFirstOrDefault("SELECT YearLabel AS yearLabel, StartDate AS startDate, EndDate AS endDate FROM rotary_year_master WHERE pk_year_id = @Id", { Id: yearId });
      if (!yr) return null;
      const m = await conn.queryFirstOrDefault(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN mp.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                SUM(CASE WHEN mp.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
         FROM club_members cm
         JOIN member_master_profile mp ON mp.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0`,
        { C: clubId },
      );
      const added = Number(
        (await conn.executeScalar(
          `SELECT COUNT(*) FROM club_members
           WHERE fk_club_id = @C AND isdeleted = 0 AND JoinedDate >= @S AND JoinedDate <= @E`,
          { C: clubId, S: dbDateTime(yr.startDate), E: dbDateTime(yr.endDate) },
        )) ?? 0,
      );
      return {
        clubName: String(club.clubName),
        yearLabel: String(yr.yearLabel ?? ""),
        mem: { current: Number(m?.total ?? 0), male: Number(m?.male ?? 0), female: Number(m?.female ?? 0), honorary: Number(m?.honorary ?? 0), addedThisYear: added },
      };
    });
    if (!prep) return notFound();
    const items = await this.cmr.getWordProjectsForYear(clubId, yearId);
    const redirect = this.config.get("Media:RedirectBaseUrl") ?? null;
    for (const it of items) for (const ph of it.photos) await loadPhoto(webRootPath(this.config), redirect, ph);
    const mediaBase = redirect && redirect.trim() ? redirect : this.config.get("Api:BaseUrl") ?? "";
    const bytes = await buildWordAnnualReport(prep.clubName, prep.yearLabel, prep.mem, items, mediaBase);
    return file(bytes, DOCX_CONTENT_TYPE, `${safeFileName(prep.clubName)}_Annual_Report_${fileStamp()}.docx`);
  }

  async availableYears(clubId: number): Promise<ActionResult> {
    if (!(await isClubDrillReachable(this.db, clubId))) return this.blocked();
    return this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      const legs = tables.length === 0
        ? "SELECT NULL AS fk_year_id WHERE 1=0"
        : tables.map((t) => `(SELECT ${t.yearId} AS fk_year_id FROM \`${t.projectsTable}\` WHERE fk_club_id = @C AND isdeleted = 0 LIMIT 1)`).join(" UNION ");
      return ok(
        await conn.query(
          `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
           FROM rotary_year_master y
           WHERE y.pk_year_id IN (
               SELECT fk_year_id FROM (${legs}) yp
               UNION SELECT y2.pk_year_id FROM rotary_year_master y2
                      JOIN announcements a ON a.PublishDateTime >= y2.StartDate AND a.PublishDateTime < DATE_ADD(y2.EndDate, INTERVAL 1 DAY)
                      WHERE a.fk_club_id = @C AND a.isdeleted = 0
               UNION SELECT y3.pk_year_id FROM rotary_year_master y3
                      JOIN upcoming_events e ON e.PublishDate >= y3.StartDate AND e.PublishDate < DATE_ADD(y3.EndDate, INTERVAL 1 DAY)
                      WHERE e.fk_club_id = @C AND e.isdeleted = 0
               UNION SELECT y4.pk_year_id FROM rotary_year_master y4
                      JOIN newsletters n ON n.PublishDateTime >= y4.StartDate AND n.PublishDateTime < DATE_ADD(y4.EndDate, INTERVAL 1 DAY)
                      WHERE n.fk_club_id = @C AND n.isdeleted = 0
               UNION SELECT fk_year_id FROM club_attendance WHERE fk_club_id = @C AND isdeleted = 0
               UNION SELECT fk_year_id FROM board_of_directors WHERE fk_club_id = @C AND isdeleted = 0
           )
           OR y.IsCurrent = 1
           ORDER BY y.pk_year_id DESC`,
          { C: clubId },
        ),
      );
    });
  }
}

/** Data Collection column spec: fixed prefix, the configured fields, fixed completion suffix. */
export function clubDcColumnSpec(keys: string[]) {
  return [
    { key: "clubName", label: "Club Name" },
    { key: "memberName", label: "Member Name" },
    { key: "updatedOn", label: "Updated On" },
    { key: "mobile", label: "Mobile Number" },
    { key: "rotaryId", label: "Rotary Id" },
    { key: "secondaryMobile", label: "Secondary_mobile_Number" },
    ...keys.map(Dcf.getField).filter((x): x is Dcf.FieldDef => x !== null).map((x) => ({ key: x.key, label: x.label })),
    { key: "donePercent", label: "Done (%)" },
    { key: "pendingPercent", label: "Pending (%)" },
    { key: "totalFields", label: "No. of Total Fields" },
    { key: "pendingFields", label: "No. of Pending Fields" },
  ];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RenderForExport: Excel-friendly text for a data-collection value. */
export function renderForExport(x: Dcf.FieldDef, v: string | null | undefined): string | null {
  if (x.key === "memberIntroduction") return !v || !v.trim() ? "No" : "Yes";
  if (!v || !v.trim()) return null;
  switch (x.type) {
    case "image":
      return "Uploaded";
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
      if (!m) return v;
      return m[1] === "1900" ? `${m[3]}-${MON[+m[2] - 1]}` : `${m[3]}-${MON[+m[2] - 1]}-${m[1]}`;
    }
    case "address-bulk":
      try {
        const el = JSON.parse(v);
        const g = (n: string) => (el?.[n] === null || el?.[n] === undefined ? null : String(el[n]));
        const parts: string[] = [];
        const addr = g("Address");
        if (addr && addr.trim()) parts.push(addr);
        const csp = [g("City"), g("State"), g("PinCode")].filter((p) => p && p.trim()).join(", ");
        if (csp) parts.push(csp);
        const phone = g("PhoneNumber");
        if (phone && phone.trim()) parts.push("Ph: " + phone);
        const biz = g("BusinessName");
        if (biz && biz.trim()) parts.push(biz);
        return parts.join(" | ");
      } catch {
        return v;
      }
    default:
      return v;
  }
}

export async function dcRow(conn: DbCommands, configId: number, memberId: number, memName: string, mobile: unknown, rotaryId: unknown, secondaryMobile: unknown, keys: string[], clubLabel: string) {
  const values = await Dcf.loadValues(conn, memberId, keys);
  const { filled, total } = Dcf.computeCompletion(values, keys);
  const pendingCount = Math.max(0, total - filled);
  const donePct = total > 0 ? dotnetRound((100 * filled) / total) : 0;
  const pendingPct = total > 0 ? 100 - donePct : 0;
  const updatedOn = await conn.executeScalar(
    `SELECT MAX(SubmittedAt) FROM district_directory_submission_log
     WHERE fk_config_id = @C AND fk_member_id = @M`,
    { C: configId, M: memberId },
  );
  const row: Record<string, unknown> = {
    clubName: clubLabel,
    memberName: memName,
    updatedOn: updatedOn ? formatDate(String(updatedOn), "dd/MMM/yy hh:mm:ss tt") : null,
    mobile: mobile ?? "",
    rotaryId: rotaryId ?? "",
    secondaryMobile: secondaryMobile ?? "",
    donePercent: donePct + "%",
    pendingPercent: pendingPct + "%",
    totalFields: total,
    pendingFields: pendingCount,
  };
  for (const key of keys) {
    const x = Dcf.getField(key);
    row[key] = x ? renderForExport(x, values.get(key)) : null;
  }
  return row;
}

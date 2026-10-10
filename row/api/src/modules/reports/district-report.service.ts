import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { badRequest, notFound, ok, statusCode, type ActionResult } from "../../common/results";
import { dbDateTime } from "../../common/binding";
import { dotnetRound, formatDate, nowIn } from "../../common/dotnet-format";
import { YearTableResolver } from "../../services/year-table.resolver";
import { CurrencyRateService } from "../../services/currency-rate.service";
import { convertCurrency, resolveDefaultCurrency } from "../../services/currency.helper";
import { DISTRICT_BLOCKED_MESSAGE, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { DG_JOIN_MEMBER, DG_NAME, DG_PHOTO } from "../../services/district-governor-sql";
import { hideRotaract, notRotaract } from "../../services/club-scope.helper";
import { RotaryOrgApiClient, type RotaryOrgClubOfficer } from "../../services/rotary-org/rotary-org-api.client";
import * as Dcf from "../../services/directory-data-collection-fields";
import { renderForExport } from "./club-report.service";

const bloodGroupOn = () => Brand.feature("member.bloodGroup");
const csv = (ids: number[]) => (ids.length ? ids.join(",") : "0");

/**
 * Port of DistrictReportController.cs (api/districts/{districtId}/district-report). The
 * actions live here so the mobile twin (MobileDistrictAdminReportController) can delegate.
 * agMemberId narrows every report to that AG's clubs (null = no AG scoping; [] = AG with no clubs).
 * ROW: blood group data follows the member.bloodGroup flag.
 */
@Injectable()
export class DistrictReportService {
  private readonly log = new Logger("DistrictReportController");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly yearTables: YearTableResolver,
    private readonly fx: CurrencyRateService,
    private readonly rotaryOrg: RotaryOrgApiClient,
  ) {}

  private get frontendUrl() { return (this.config.get("FrontendUrl") ?? Brand.Current.domains.adminOrigin ?? "").replace(/\/+$/, ""); }
  private blocked = () => statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
  private blockedShort = () => statusCode(403, { message: "This district or its zone is inactive." });
  private notRotaractUnlessSa = (isSa: boolean, alias = "c") => (!hideRotaract(isSa) ? "" : " AND " + notRotaract(alias));

  private static async districtCurrency(conn: DbCommands, districtId: number) {
    const row = await conn.queryFirstOrDefault("SELECT DefaultCurrency, Country FROM district_master WHERE pk_district_id = @D LIMIT 1", { D: districtId });
    return resolveDefaultCurrency(typeof row?.DefaultCurrency === "string" ? row.DefaultCurrency : null);
  }

  /** Clubs the AG holds in this district this year; null when no AG was given. */
  private static async agScopeClubIds(conn: DbCommands, districtId: number, yearId: number, agMemberId: number | null): Promise<number[] | null> {
    if (agMemberId === null || agMemberId <= 0) return null;
    const rows = await conn.query(
      `SELECT DISTINCT a.fk_club_id AS id
       FROM district_ag a
       JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
       WHERE a.fk_member_id = @Ag AND a.fk_year_id = @YearId
         AND a.isdeleted = 0 AND a.is_active = 1
         AND c.fk_district_id = @D`,
      { Ag: agMemberId, YearId: yearId, D: districtId },
    );
    return rows.map((r) => Number(r.id));
  }

  private async districtClubIds(conn: DbCommands, districtId: number, isSa: boolean) {
    const rows = await conn.query(`SELECT pk_club_id AS id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0${this.notRotaractUnlessSa(isSa, "")}`, { D: districtId });
    return rows.map((r) => Number(r.id));
  }

  async getReport(districtId: number, yearId: number, agMemberId: number | null, isSa: boolean): Promise<ActionResult> {
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const district = await conn.queryFirstOrDefault(
        `SELECT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                z.ZoneName AS zoneName
         FROM district_master d
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE d.pk_district_id = @Id AND d.isdeleted = 0`,
        { Id: districtId },
      );
      if (!district) return notFound({ message: "District not found." });
      const year = await conn.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel AS yearLabel, StartDate AS startDate, EndDate AS endDate FROM rotary_year_master WHERE pk_year_id = @Id", { Id: yearId });
      const yrStart = dbDateTime(year?.startDate);
      const yrEnd = dbDateTime(year?.endDate);

      let clubIds = await this.districtClubIds(conn, districtId, isSa);
      const agClubIds = await DistrictReportService.agScopeClubIds(conn, districtId, yearId, agMemberId);
      if (agClubIds) clubIds = clubIds.filter((id) => agClubIds.includes(id));
      const totalClubs = clubIds.length;
      const ids = csv(clubIds);
      const p = { D: districtId, YearId: yearId };
      const range = { D: districtId, YearId: yearId, Start: yrStart, End: yrEnd };

      const pInfo = await this.yearTables.resolveByYearId(conn, yearId);
      let projects: Row[] = [];
      if (pInfo) {
        projects = await conn.query(
          `SELECT p.pk_project_id AS id, p.fk_club_id AS clubId, p.title, p.description, p.project_date AS projectDate,
                  p.project_cost AS projectCost, p.project_cost AS amountSpent,
                  COALESCE(p.Currency, @DefaultCurrency) AS currency,
                  p.direct_beneficiaries AS directBeneficiaries,
                  p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                  p.rotaractors_involved AS rotaractorsInvolved,
                  COALESCE(p.rcc_involved,0) AS rccInvolved,
                  p.location, af.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory,
                  f.name AS funding, mm.ModuleName AS moduleName, mm.ModuleKey AS moduleKey,
                  mm.ModuleName AS typeOfProject,
                  p.club_role AS clubRole, p.co_host_name AS coHostName,
                  p.global_grant_number AS globalGrantNumber, p.csr_company_name AS csrCompanyName,
                  p.amount_sanctioned AS amountSanctioned, p.amount_received AS amountReceived,
                  p.host_clubs_districts AS hostClubsDistricts,
                  p.global_partner_clubs_districts AS globalPartners,
                  CASE WHEN p.project_type = 'one_time' THEN 'One-time' ELSE 'Ongoing' END AS oneTimeOngoing,
                  CASE WHEN p.parent_project_id IS NULL OR p.parent_project_id = 0 THEN 'New' ELSE 'Existing' END AS newExisting,
                  p.approval_status AS approvalStatus,
                  COALESCE(c.ClubName, 'District Level') AS clubName,
                  CONCAT(@FrontendUrl, '/public/project/', p.pk_project_id, '?year=', @YearId) AS publicPhotoUrl
           FROM \`${pInfo.projectsTable}\` p
           LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
           LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
           LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
           WHERE p.isdeleted = 0
             AND (p.fk_district_id = @D OR p.fk_club_id IN (${ids}))
           ORDER BY p.project_date DESC`,
          { ...p, FrontendUrl: this.frontendUrl, DefaultCurrency: Brand.Current.locale.defaultCurrency },
        );
      }
      const projectsByModule: Record<string, Row[]> = {};
      for (const x of projects) (projectsByModule[x.moduleKey ?? "other"] ??= []).push(x);

      const thisYear = Number(nowIn(Brand.Current.locale.defaultTimeZone).slice(0, 4));
      const yrStartYear = yrStart ? Number(yrStart.slice(0, 4)) : thisYear;
      const yrEndYear = yrEnd ? Number(yrEnd.slice(0, 4)) : yrStartYear + 1;
      const clubMonthlyProjectDetails = await conn.query(
        `SELECT r.fk_club_id AS clubId, c.ClubName AS clubName,
                r.ReportMonth AS monthNum,
                DATE_FORMAT(
                  STR_TO_DATE(CONCAT(CASE WHEN r.ReportMonth >= 7 THEN @YrStartYear ELSE @YrEndYear END,
                                     '-', r.ReportMonth, '-01'), '%Y-%c-%d'),
                  '%M %Y') AS month,
                (SELECT COUNT(*) FROM club_attendance a
                  WHERE a.fk_club_id = r.fk_club_id AND a.fk_year_id = r.fk_year_id
                    AND a.isdeleted = 0 AND MONTH(a.EventDateTime) = r.ReportMonth) AS meeting,
                COALESCE((SELECT SUM(t.AmountUSD) FROM trf_contributions t
                           WHERE t.fk_club_id = r.fk_club_id AND t.fk_year_id = r.fk_year_id
                             AND t.isdeleted = 0 AND MONTH(t.TrfDate) = r.ReportMonth), 0) AS trf,
                0 AS clubService,
                0 AS projects, 0 AS cost, 0 AS beneficiaries, 0 AS manHours,
                0 AS rotariansInvolved, 0 AS rotaractors, 0 AS rcc
         FROM club_monthly_reports r
         JOIN club_master c ON c.pk_club_id = r.fk_club_id
         WHERE r.fk_year_id = @YearId AND r.isdeleted = 0 AND r.fk_club_id IN (${ids})
         ORDER BY c.ClubName,
                  CASE WHEN r.ReportMonth >= 7 THEN r.ReportMonth - 7 ELSE r.ReportMonth + 5 END`,
        { YearId: yearId, YrStartYear: yrStartYear, YrEndYear: yrEndYear },
      );

      const reportCurrency = await DistrictReportService.districtCurrency(conn, districtId);
      const rates = await this.fx.getRates();
      const n = (v: unknown) => Number(v ?? 0) || 0;
      const cost = (x: Row) => convertCurrency(n(x.projectCost), x.currency, reportCurrency, rates);
      for (const m of clubMonthlyProjectDetails) {
        const month = Number(m.monthNum);
        const cid = Number(m.clubId);
        const all = projects.filter((x) => x.clubId !== null && Number(x.clubId) === cid && x.projectDate && Number(String(x.projectDate).slice(5, 7)) === month);
        m.clubService = all.filter((x) => x.moduleKey === "club_service").length;
        const mp = all.filter((x) => x.moduleKey !== "club_service");
        m.projects = mp.length;
        m.cost = mp.reduce((s, x) => s + cost(x), 0);
        m.beneficiaries = mp.reduce((s, x) => s + n(x.directBeneficiaries), 0);
        m.manHours = mp.reduce((s, x) => s + n(x.manHours), 0);
        m.rotariansInvolved = mp.reduce((s, x) => s + n(x.rotariansInvolved), 0);
        m.rotaractors = mp.reduce((s, x) => s + n(x.rotaractorsInvolved), 0);
        m.rcc = mp.reduce((s, x) => s + n(x.rccInvolved), 0);
      }

      const announcements = await conn.query(
        `SELECT a.fk_club_id AS clubId, a.Title AS title, a.Description AS description, a.PublishDateTime AS publishDate,
                a.ExpiryDateTime AS expiryDate, a.IsSendWhatsapp AS isSendWhatsapp,
                CASE
                    WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                    WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                    WHEN a.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', a.ImagePath)
                    WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                    ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                END AS imagePath,
                COALESCE(c.ClubName, 'District Level') AS clubName,
                CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                     WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
         FROM announcements a
         LEFT JOIN club_master c ON c.pk_club_id = a.fk_club_id
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE a.isdeleted = 0
           AND a.PublishDateTime >= y.StartDate
           AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
           AND (a.fk_district_id = @D OR a.fk_club_id IN (${ids}))
         ORDER BY a.PublishDateTime DESC`,
        p,
      );
      const events = await conn.query(
        `SELECT e.fk_club_id AS clubId, e.Title AS title, e.Description AS description, e.EventDate AS eventDate,
                e.EventVenue AS eventVenue, e.PublishDate AS publishDate, e.ExpiryDate AS expiryDate,
                e.RegistrationLink AS registrationLink,
                CASE
                    WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                    WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                    WHEN e.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', e.fk_district_id, '/', e.ImagePath)
                    ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                END AS imagePath,
                COALESCE(c.ClubName, 'District Level') AS clubName,
                CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                     WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
         FROM upcoming_events e
         LEFT JOIN club_master c ON c.pk_club_id = e.fk_club_id
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE e.isdeleted = 0
           AND e.PublishDate >= y.StartDate
           AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
           AND (e.fk_district_id = @D OR e.fk_club_id IN (${ids}))
         ORDER BY e.EventDate DESC`,
        p,
      );
      const newsletters = await conn.query(
        `SELECT n.fk_club_id AS clubId, n.Title AS title, n.PublishDateTime AS publishDate, n.ExpiryDateTime AS expiryDate,
                n.AttachmentType AS attachmentType, n.LinkUrl AS linkUrl,
                CASE
                    WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                    WHEN n.FilePath LIKE '/%' THEN n.FilePath
                    WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                    WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                    WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                    ELSE NULL
                END AS filePath,
                COALESCE(c.ClubName, 'District Level') AS clubName,
                CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                     WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
         FROM newsletters n
         LEFT JOIN club_master c ON c.pk_club_id = n.fk_club_id
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE n.isdeleted = 0
           AND n.PublishDateTime >= y.StartDate
           AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
           AND (n.fk_district_id = @D OR n.fk_club_id IN (${ids}))
         ORDER BY n.PublishDateTime DESC`,
        p,
      );
      const documents = await conn.query(
        `SELECT d.fk_club_id AS clubId, d.Title AS title, d.AccessType AS accessType,
                CASE
                    WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                    WHEN d.FilePath LIKE '/%' THEN d.FilePath
                    WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                    WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                    ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                END AS filePath,
                d.PublishDateTime AS publishDate, d.ExpiryDateTime AS expiryDate,
                COALESCE(c.ClubName, 'District Level') AS clubName
         FROM club_documents d
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         LEFT JOIN club_master c ON c.pk_club_id = d.fk_club_id
         WHERE d.isdeleted = 0
           AND d.PublishDateTime >= y.StartDate
           AND d.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
           AND (d.fk_district_id = @D OR d.fk_club_id IN (${ids}))
         ORDER BY d.PublishDateTime DESC`,
        p,
      );
      const attendance = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                a.EventName AS eventName, a.Description AS description, a.EventDateTime AS eventDateTime,
                (SELECT COUNT(*) FROM club_attendance_members   m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersCount,
                (SELECT COUNT(*) FROM club_attendance_anns       x WHERE x.fk_attendance_id = a.pk_attendance_id) AS annsCount,
                (SELECT COUNT(*) FROM club_attendance_annets     x WHERE x.fk_attendance_id = a.pk_attendance_id) AS annetsCount,
                (SELECT COUNT(*) FROM club_attendance_visitors   x WHERE x.fk_attendance_id = a.pk_attendance_id) AS visitorsCount,
                (SELECT COUNT(*) FROM club_attendance_rotarians  x WHERE x.fk_attendance_id = a.pk_attendance_id) AS rotariansOtherClubsCount,
                (SELECT COUNT(*) FROM club_attendance_delegates  x WHERE x.fk_attendance_id = a.pk_attendance_id) AS districtDelegatesCount
         FROM club_attendance a
         JOIN club_master c ON c.pk_club_id = a.fk_club_id
         WHERE a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.fk_club_id IN (${ids})
         ORDER BY c.ClubName, a.EventDateTime DESC`,
        p,
      );
      const bod = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile,
                m.EmailId AS email, dm.designation_name AS designation, dm.sort_order AS sortOrder,
                COALESCE(b.SyncSource, 'Manual') AS autoManual
         FROM board_of_directors b
         JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
         JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
         JOIN club_master c ON c.pk_club_id = b.fk_club_id
         WHERE b.fk_year_id = @YearId AND b.isdeleted = 0 AND b.fk_club_id IN (${ids})
         ORDER BY c.ClubName, dm.sort_order`,
        p,
      );
      const members = await conn.query(
        `SELECT c.pk_club_id AS clubId,
                c.ClubName AS clubName,
                m.MemberName AS memberName,
                CASE
                    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                END AS profilePhoto,
                cm.ClassificationProfession AS classification,
                cm.Designation              AS clubDesignation,
                (SELECT cy.CountryName
                   FROM member_address_details ad
                   LEFT JOIN country_master cy ON cy.pk_country_id = ad.fk_country_id
                  WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND ad.AddressType = 'Residence' AND COALESCE(ad.isdeleted, 0) = 0
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
                (SELECT CONCAT_WS(', ',
                           NULLIF(ad.Address,''), NULLIF(ad.City,''),
                           NULLIF(ad.State,''),   NULLIF(cy2.CountryName,''),
                           NULLIF(ad.PinCode,''))
                   FROM member_address_details ad
                   LEFT JOIN country_master cy2 ON cy2.pk_country_id = ad.fk_country_id
                  WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND ad.AddressType = 'Residence' AND COALESCE(ad.isdeleted, 0) = 0
                  ORDER BY ad.pk_member_address_details_id DESC LIMIT 1) AS address,
                m.RotaryId AS rotaryId,
                ${cogJoinedDateExpr("cm")} AS riAdmissionDate,
                ${cogSelectColumns("cm")}
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_club_id IN (${ids})
         ORDER BY c.ClubName, m.MemberName`,
        p,
      );
      if (!bloodGroupOn()) for (const r of members) r.bloodGroup = null;
      const bloodGroups = !bloodGroupOn()
        ? []
        : await conn.query(
            `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                    m.MemberName AS ownerName, 'Member' AS relation,
                    m.MemberName AS personName, m.PrimaryMobileNumber AS mobile,
                    m.EmailId AS email, m.BloodGroup AS bloodGroup,
                    c.ClubName AS sortClub, m.MemberName AS sortName, 0 AS sortFamily
             FROM club_members cm
             JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
             JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
             JOIN district_master d ON d.pk_district_id = c.fk_district_id
             WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_club_id IN (${ids})
               AND COALESCE(m.BloodGroup,'') <> ''
             UNION ALL
             SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                    m.MemberName AS ownerName, COALESCE(NULLIF(f.Relation,''),'Family') AS relation,
                    f.Name AS personName, f.PhoneNumber AS mobile,
                    f.EmailId AS email, f.BloodGroup AS bloodGroup,
                    c.ClubName AS sortClub, m.MemberName AS sortName, 1 AS sortFamily
             FROM club_members cm
             JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
             JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id AND COALESCE(f.isdeleted,0) = 0
             JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
             JOIN district_master d ON d.pk_district_id = c.fk_district_id
             WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_club_id IN (${ids})
               AND COALESCE(f.BloodGroup,'') <> ''
             ORDER BY sortClub, sortName, sortFamily, personName`,
            p,
          );
      const trf = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, t.TrfDate AS trfDate, t.DonorName AS donorName,
                t.AmountUSD AS amountUsd, t.FundType AS fundType, t.OtherFundName AS otherFundName,
                COALESCE(f.FundName, t.OtherFundName) AS fundName
         FROM trf_contributions t
         LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
         JOIN club_master c ON c.pk_club_id = t.fk_club_id
         WHERE t.fk_year_id = @YearId AND t.isdeleted = 0 AND t.fk_club_id IN (${ids})
         ORDER BY t.TrfDate DESC`,
        p,
      );

      // A member-linked committee row shows the member's own mobile / email when set.
      const contact = (a: string) => `CASE WHEN COALESCE(${a}.fk_member_id, 0) > 0 AND mp.PrimaryMobileNumber IS NOT NULL AND TRIM(mp.PrimaryMobileNumber) <> ''
                     THEN mp.PrimaryMobileNumber ELSE ${a}.mobile END AS mobile,
                CASE WHEN COALESCE(${a}.fk_member_id, 0) > 0 AND mp.EmailId IS NOT NULL AND TRIM(mp.EmailId) <> ''
                     THEN mp.EmailId ELSE ${a}.email END AS email`;
      const committeeMain = await conn.query(
        `SELECT dcm.name               AS memberName,
                ${contact("dcm")},
                dcm.district_designation AS designation
         FROM district_committee_member dcm
         LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = dcm.fk_member_id AND mp.isdeleted = 0
         WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @YearId AND dcm.isdeleted = 0 AND dcm.is_active = 1
         ORDER BY dcm.name`,
        p,
      );
      const committeeGroup = await conn.query(
        `SELECT g.group_name           AS groupName,
                gm.name                AS memberName,
                ${contact("gm")},
                gm.district_designation AS designation
         FROM district_committee_group_member gm
         JOIN district_committee_group g ON g.id = gm.fk_group_id
         LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = gm.fk_member_id AND mp.isdeleted = 0
         WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
           AND gm.isdeleted = 0 AND gm.is_active = 1 AND g.isdeleted = 0
         ORDER BY g.group_name, gm.name`,
        p,
      );
      const committeeSubGroup = await conn.query(
        `SELECT g.group_name           AS groupName,
                sg.sub_group_name      AS subGroupName,
                sm.name                AS memberName,
                ${contact("sm")},
                sm.district_designation AS designation
         FROM district_committee_sub_group_member sm
         JOIN district_committee_sub_group sg ON sg.id = sm.fk_sub_group_id
         JOIN district_committee_group     g  ON g.id  = sg.fk_group_id
         LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = sm.fk_member_id AND mp.isdeleted = 0
         WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
           AND sm.isdeleted = 0 AND sm.is_active = 1 AND sg.isdeleted = 0 AND g.isdeleted = 0
         ORDER BY g.group_name, sg.sub_group_name, sm.name`,
        p,
      );
      const committee = await conn.query(
        `SELECT 'Main Committee' AS section, dcm.name AS memberName,
                ${contact("dcm")},
                dcm.district_designation AS designation, NULL AS groupName
         FROM district_committee_member dcm
         LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = dcm.fk_member_id AND mp.isdeleted = 0
         WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @YearId AND dcm.isdeleted = 0 AND dcm.is_active = 1
         UNION ALL
         SELECT 'Group' AS section, gm.name AS memberName,
                ${contact("gm")},
                gm.district_designation AS designation, g.group_name AS groupName
         FROM district_committee_group_member gm
         JOIN district_committee_group g ON g.id = gm.fk_group_id
         LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = gm.fk_member_id AND mp.isdeleted = 0
         WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
           AND gm.isdeleted = 0 AND gm.is_active = 1 AND g.isdeleted = 0
         UNION ALL
         SELECT 'Sub Group' AS section, sm.name AS memberName,
                ${contact("sm")},
                sm.district_designation AS designation,
                CONCAT(g.group_name, ' > ', sg.sub_group_name) AS groupName
         FROM district_committee_sub_group_member sm
         JOIN district_committee_sub_group sg ON sg.id = sm.fk_sub_group_id
         JOIN district_committee_group g ON g.id = sg.fk_group_id
         LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = sm.fk_member_id AND mp.isdeleted = 0
         WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
           AND sm.isdeleted = 0 AND sm.is_active = 1 AND sg.isdeleted = 0 AND g.isdeleted = 0
         ORDER BY section, groupName`,
        p,
      );
      const governor = await conn.queryFirstOrDefault(
        `SELECT ${DG_NAME} AS memberName, g.description,
                ${DG_PHOTO} AS profilePhoto
         FROM district_governors g
         ${DG_JOIN_MEMBER}
         WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId AND g.isdeleted = 0`,
        p,
      );
      const ags = await conn.query(
        `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                c.ClubName AS clubName
         FROM district_ag a
         JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id
         JOIN club_master c ON c.pk_club_id = a.fk_club_id
         WHERE a.fk_district_id = @D AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1
         ORDER BY c.ClubName`,
        p,
      );
      const moderators = await conn.query(
        `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                c.ClubName AS clubName
         FROM district_club_moderator cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_id
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         WHERE cm.fk_district_id = @D AND cm.isdeleted = 0 AND cm.is_active = 1
           AND cm.fk_club_id IN (${ids})
         ORDER BY c.ClubName`,
        p,
      );
      const monthlyReports = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, r.ReportMonth AS reportMonth,
                r.MemberCountLastMonth AS memberCountLastMonth, r.MembersDeleted AS membersDeleted,
                r.MembersAdded AS membersAdded, r.CurrentMemberCount AS currentMemberCount,
                r.IsUploadedToDistrict AS isUploadedToDistrict, r.created_date AS createdDate
         FROM club_monthly_reports r
         JOIN club_master c ON c.pk_club_id = r.fk_club_id
         WHERE r.fk_year_id = @YearId AND r.isdeleted = 0 AND r.fk_club_id IN (${ids})
         ORDER BY c.ClubName, r.ReportMonth`,
        p,
      );
      const districtCitation = await conn.query(
        `SELECT c.ClubName AS clubName,
                CAST(ROUND(SUM(e.points_earned)) AS SIGNED) AS totalPoints,
                CAST(ROUND(SUM(e.bonus_earned)) AS SIGNED) AS totalBonus,
                CAST(ROUND(SUM(e.points_earned + e.bonus_earned)) AS SIGNED) AS grandTotal,
                COUNT(*) AS entryCount
         FROM district_citation_club_entry e
         JOIN club_master c ON c.pk_club_id = e.fk_club_id
         WHERE e.fk_district_id = @D AND e.fk_year_id = @YearId AND e.isdeleted = 0
           AND e.fk_club_id IN (${ids})
         GROUP BY c.pk_club_id, c.ClubName
         ORDER BY grandTotal DESC`,
        p,
      );
      const pphCamps = await conn.query(
        `SELECT pc.fk_club_id AS clubId, COALESCE(c.ClubName, 'District Level') AS clubName,
                pc.Title AS title, pc.Description AS description, pc.Address AS address,
                pc.CampDate AS campDate,
                (SELECT COUNT(*) FROM pph_camp_attendance a WHERE a.fk_camp_id = pc.pk_camp_id AND a.isdeleted = 0) AS attendanceCount
         FROM pph_camps pc
         LEFT JOIN club_master c ON c.pk_club_id = pc.fk_club_id
         WHERE pc.isdeleted = 0
           AND (pc.fk_district_id = @D OR pc.fk_club_id IN (${ids}))
           AND (@Start IS NULL OR pc.CampDate BETWEEN @Start AND @End)
         ORDER BY pc.CampDate DESC`,
        range,
      );
      const massEmails = await conn.query(
        `SELECT COALESCE(c.ClubName, 'District Level') AS clubName,
                me.Subject AS subject, me.FromName AS fromName, me.Status AS status,
                me.TotalRecipients AS totalRecipients, me.SentCount AS sentCount,
                me.FailedCount AS failedCount, me.SentDate AS sentDate, me.created_date AS createdDate
         FROM club_mass_emails me
         LEFT JOIN club_master c ON c.pk_club_id = me.fk_club_id
         WHERE me.isdeleted = 0
           AND (me.fk_district_id = @D OR me.fk_club_id IN (${ids}))
           AND (@Start IS NULL OR me.created_date BETWEEN @Start AND @End)
         ORDER BY me.created_date DESC`,
        range,
      );
      const eventPaymentLinks = await conn.query(
        `SELECT COALESCE(c.ClubName, 'District Level') AS clubName,
                epl.Title AS title, epl.Description AS description, epl.WeblinkUrl AS weblinkUrl,
                epl.created_date AS createdDate,
                (SELECT COUNT(*) FROM event_payment_registrations r WHERE r.fk_payment_link_id = epl.pk_id AND r.isdeleted = 0) AS registrationCount,
                (SELECT COALESCE(SUM(r.Amount), 0) FROM event_payment_registrations r WHERE r.fk_payment_link_id = epl.pk_id AND r.isdeleted = 0) AS totalAmount
         FROM event_payment_links epl
         LEFT JOIN club_master c ON c.pk_club_id = epl.fk_club_id
         WHERE epl.isdeleted = 0
           AND (epl.fk_district_master_id = @D OR epl.fk_club_id IN (${ids}))
           AND (@Start IS NULL OR epl.created_date BETWEEN @Start AND @End)
         ORDER BY epl.created_date DESC`,
        range,
      );
      const zonalAwards = await conn.query(
        `SELECT g.title AS goalTitle, q.sub_title AS question, q.category,
                o.goal_requirement_label AS requirement, o.report_use_title AS optionLabel,
                e.month, e.entered_counts AS enteredCounts, e.received_points AS receivedPoints
         FROM zonal_awards_district_entry e
         JOIN zonal_awards_question_option o ON o.pk_id = e.fk_option_id
         JOIN zonal_awards_question q ON q.pk_id = o.fk_question_id
         JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
         WHERE e.fk_district_id = @D AND e.fk_year_id = @YearId AND e.isdeleted = 0
         ORDER BY g.sort_order, q.sort_order, o.sort_order, e.month`,
        p,
      );

      const clubList = await conn.query(
        `SELECT c.pk_club_id  AS clubId,
                c.ClubName    AS clubName,
                COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSyncedFromRotaryOrg
         FROM club_master c
         WHERE c.fk_district_id = @D AND c.isdeleted = 0
           AND c.pk_club_id IN (${ids})
         ORDER BY c.ClubName`,
        { D: districtId },
      );
      const agAllocation = await conn.query(
        `SELECT a.fk_member_id     AS agMemberId,
                m.MemberName       AS agName,
                m.PrimaryMobileNumber AS agMobile,
                m.EmailId          AS agEmail,
                c.pk_club_id       AS clubId,
                c.ClubName         AS clubName,
                c.ClubRotaryId     AS clubRotaryId,
                (SELECT c2.ClubName FROM club_members cm2
                   JOIN club_master c2 ON c2.pk_club_id = cm2.fk_club_id AND c2.isdeleted = 0
                  WHERE cm2.fk_member_master_profile_id = a.fk_member_id
                    AND cm2.isdeleted = 0 AND cm2.IsActive = 1
                  ORDER BY cm2.pk_club_member_id LIMIT 1) AS agClubName
         FROM district_ag a
         JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
         JOIN club_master c           ON c.pk_club_id                    = a.fk_club_id  AND c.isdeleted = 0
         WHERE a.fk_district_id = @D AND a.fk_year_id = @YearId
           AND a.isdeleted = 0 AND a.is_active = 1
           AND a.fk_club_id IN (${ids})
         ORDER BY m.MemberName, c.ClubName`,
        p,
      );
      const appUsers = await conn.query(
        `SELECT cm.fk_club_id     AS clubId,
                c.ClubName        AS clubName,
                m.MemberName      AS memberName,
                m.PrimaryMobileNumber AS mobile,
                m.EmailId         AS email,
                COALESCE(NULLIF(m.LastDeviceName, ''), '') AS deviceName,
                CASE WHEN m.LastDeviceName IS NULL OR m.LastDeviceName = '' THEN 'No' ELSE 'Yes' END AS downloaded,
                CASE
                    WHEN m.LastDeviceName IS NULL OR m.LastDeviceName = '' THEN ''
                    WHEN LOWER(m.LastDeviceName) LIKE '%iphone%'
                      OR LOWER(m.LastDeviceName) LIKE '%ipad%'
                      OR LOWER(m.LastDeviceName) LIKE '%ipod%'
                      OR LOWER(m.LastDeviceName) LIKE '%ios%'
                      OR LOWER(m.LastDeviceName) LIKE '%apple%'
                      OR LOWER(m.LastDeviceName) LIKE '%mac%' THEN 'iOS'
                    ELSE 'Android'
                END AS platform
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         JOIN club_master c           ON c.pk_club_id                    = cm.fk_club_id
         WHERE cm.fk_club_id IN (${ids})
           AND cm.IsActive = 1 AND cm.isdeleted = 0
         ORDER BY c.ClubName, m.MemberName`,
        p,
      );
      const pphCampAttendees = await conn.query(
        `SELECT pc.fk_club_id AS clubId,
                COALESCE(c.ClubName, 'District Level') AS clubName,
                pc.CampDate    AS campDate,
                pc.Title       AS campName,
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
                CASE WHEN pa.IsObese = 1 THEN 'Yes' ELSE 'No' END AS obese,
                CASE WHEN pa.IsOverweight = 1 THEN 'Yes' ELSE 'No' END AS overweight,
                pa.Remarks     AS remarks
         FROM pph_camp_attendies att
         JOIN pph_camps pc ON pc.pk_camp_id = att.fk_camp_id AND COALESCE(pc.isdeleted, 0) = 0
         JOIN rotary_year_master y ON y.pk_year_id = @YearId
         LEFT JOIN club_master c ON c.pk_club_id = pc.fk_club_id
         LEFT JOIN pph_camp_attendance pa
                ON pa.fk_attendee_id = att.pk_attendee_id AND COALESCE(pa.isdeleted, 0) = 0
         WHERE (pc.fk_district_id = @D OR pc.fk_club_id IN (${ids}))
           AND COALESCE(att.isdeleted, 0) = 0
           AND pc.CampDate >= y.StartDate AND pc.CampDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         ORDER BY pc.CampDate DESC, att.Name, att.pk_attendee_id, pa.pk_attendance_id`,
        p,
      );
      // "Submitted" = uploaded to the district; a report only started is not submitted.
      const monthlyReportSubmissions = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                r.ReportMonth AS reportMonth,
                CASE WHEN COALESCE(r.IsUploadedToDistrict, 0) = 1
                     THEN r.uploaded_to_district_date ELSE NULL END AS submittedDate
         FROM club_monthly_reports r
         JOIN club_master c ON c.pk_club_id = r.fk_club_id
         WHERE r.fk_year_id = @YearId AND r.isdeleted = 0 AND r.fk_club_id IN (${ids})
         ORDER BY c.ClubName, r.ReportMonth`,
        p,
      );

      const duesCategoryId = Number((await conn.executeScalar("SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'dues' LIMIT 1")) ?? 0);
      let duesReport: Row[] = [];
      if (duesCategoryId > 0) {
        duesReport = await conn.query(
          `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, dm.DistrictNumber AS districtNumber,
                  t.pk_type_id AS typeId, COALESCE(t.TypeName, '') AS documentType, t.SortOrder AS typeSort,
                  COALESCE(SUM(d.Amount), 0) AS amount,
                  MAX(d.PaidOn) AS paidOn,
                  CASE WHEN COUNT(d.pk_document_id) > 0 THEN 1 ELSE 0 END AS isUploaded,
                  (SELECT CASE WHEN d2.FilePath IS NULL OR d2.FilePath = '' THEN NULL
                               WHEN d2.FilePath LIKE '/%' THEN d2.FilePath
                               ELSE CONCAT('/Documents/OCV/Group', d2.fk_club_id, '/', d2.FilePath) END
                     FROM ocv_documents d2
                     WHERE d2.fk_club_id = c.pk_club_id AND d2.fk_type_id = t.pk_type_id
                       AND d2.fk_category_id = @DuesCat AND d2.fk_year_id = @YearId AND d2.isdeleted = 0
                     ORDER BY d2.created_date DESC LIMIT 1) AS filePath
           FROM club_master c
           JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
           CROSS JOIN ocv_document_type t
           LEFT JOIN ocv_documents d
                  ON d.fk_club_id = c.pk_club_id AND d.fk_type_id = t.pk_type_id
                 AND d.fk_category_id = @DuesCat AND d.fk_year_id = @YearId AND d.isdeleted = 0
           WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.pk_club_id IN (${ids})
                 AND t.fk_category_id = @DuesCat AND t.isdeleted = 0 AND t.IsActive = 1
           GROUP BY c.pk_club_id, c.ClubName, dm.DistrictNumber, t.pk_type_id, t.TypeName, t.SortOrder
           ORDER BY c.ClubName, t.SortOrder, t.TypeName`,
          { ...p, DuesCat: duesCategoryId },
        );
      }

      let districtProjects: Row[] = [];
      let districtEvents: Row[] = [];
      if (pInfo) {
        districtProjects = await conn.query(
          `SELECT p.title, p.description, p.project_date AS projectDate,
                  p.project_cost AS projectCost, p.project_cost AS amountSpent,
                  p.direct_beneficiaries AS directBeneficiaries,
                  p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                  p.location,
                  af.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory,
                  f.name AS funding,
                  p.global_grant_number AS globalGrantNumber, p.csr_company_name AS csrCompanyName,
                  p.amount_sanctioned AS amountSanctioned, p.amount_received AS amountReceived,
                  p.host_clubs_districts AS hostClubsDistricts,
                  p.global_partner_clubs_districts AS globalPartners,
                  CONCAT(@FrontendUrl, '/public/project/', p.pk_project_id, '?year=', @YearId) AS publicPhotoUrl
           FROM \`${pInfo.projectsTable}\` p
           LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
           LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           WHERE p.fk_district_id = @D
             AND (p.DistrictProjectType = 'Project' OR p.DistrictProjectType IS NULL)
             AND p.isdeleted = 0
           ORDER BY p.project_date DESC`,
          { D: districtId, YearId: yearId, FrontendUrl: this.frontendUrl },
        );
        districtEvents = await conn.query(
          `SELECT p.title, p.description, p.project_date AS eventDate,
                  (SELECT CONCAT('/Documents/DistrictEvent/', p.fk_district_id, '/', pp.image_path)
                     FROM \`${pInfo.photosTable}\` pp WHERE pp.fk_project_id = p.pk_project_id LIMIT 1) AS imagePath
           FROM \`${pInfo.projectsTable}\` p
           WHERE p.fk_district_id = @D AND p.DistrictProjectType = 'Event' AND p.isdeleted = 0
           ORDER BY p.project_date DESC`,
          { D: districtId },
        );
      }

      const nonRiSyncedClubs = await conn.query(
        `SELECT COALESCE(NULLIF(c.ClubRotaryId, ''), CAST(c.pk_club_id AS CHAR)) AS clubId,
                c.ClubName AS clubName,
                c.ClubCharterDate AS charterDate,
                CONCAT_WS(', ', NULLIF(c.MeetingAddress, ''), NULLIF(c.City, ''),
                                NULLIF(c.State, ''), NULLIF(c.Pincode, '')) AS address,
                d.DistrictNumber AS districtNumber
         FROM club_master c
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.fk_district_id = @D AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 0 AND c.isdeleted = 0
           AND c.pk_club_id IN (${ids})
         ORDER BY c.ClubName`,
        p,
      );
      const officer = (designation: number, col: string) => `(SELECT m.${col} FROM board_of_directors b
                   JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                  WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.fk_designation_id = ${designation} AND b.isdeleted = 0 LIMIT 1)`;
      const riSyncedClubs = await conn.query(
        `SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                ${officer(1, "MemberName")} AS president,
                ${officer(1, "PrimaryMobileNumber")} AS presidentMobile,
                ${officer(1, "EmailId")} AS presidentEmail,
                ${officer(2, "MemberName")} AS secretary,
                ${officer(2, "PrimaryMobileNumber")} AS secretaryMobile,
                ${officer(2, "EmailId")} AS secretaryEmail
         FROM club_master c
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.fk_district_id = @D AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 1 AND c.isdeleted = 0
           AND c.pk_club_id IN (${ids})
         ORDER BY c.ClubName`,
        p,
      );

      let dataCollection: Row | null = null;
      const cfg = await DistrictReportService.dcConfig(conn, districtId, yearId);
      if (cfg) {
        dataCollection = {
          configId: cfg.configId,
          enabled: true,
          columns: { allMembers: dcColumnSpec(cfg.memberKeys), bod: dcColumnSpec(cfg.bodKeys), dc: dcColumnSpec(cfg.dcKeys, true) },
        };
      }

      return ok({
        district,
        rotaryYear: year,
        summary: {
          totalClubs,
          totalProjects: projects.length,
          totalProjectCost: projects.reduce((s, x) => s + cost(x), 0),
          projectCostCurrency: reportCurrency,
          totalBeneficiaries: projects.reduce((s, x) => s + n(x.directBeneficiaries), 0),
          totalAnnouncements: announcements.length,
          totalEvents: events.length,
          totalNewsletters: newsletters.length,
          totalDocuments: documents.length,
          totalMeetings: attendance.length,
          totalMembers: members.length,
          totalBod: bod.length,
          totalTrfAmount: trf.reduce((s, t) => s + n(t.amountUsd), 0),
          totalTrfContributions: trf.length,
          totalCommitteeMembers: committee.length,
          totalAgs: ags.length,
          totalModerators: moderators.length,
          totalMonthlyReports: monthlyReports.length,
          totalZonalAwardEntries: zonalAwards.length,
          totalCitationClubs: districtCitation.length,
          totalPphCamps: pphCamps.length,
          totalMassEmails: massEmails.length,
          totalEventPaymentLinks: eventPaymentLinks.length,
        },
        projectsByModule,
        announcements,
        events,
        newsletters,
        documents,
        attendance,
        bod,
        members,
        bloodGroups,
        trf,
        committee,
        committeeMain,
        committeeGroup,
        committeeSubGroup,
        governor,
        ags,
        moderators,
        monthlyReports,
        clubMonthlyProjectDetails,
        zonalAwards,
        districtCitation,
        pphCamps,
        massEmails,
        eventPaymentLinks,
        clubList,
        agAllocation,
        appUsers,
        pphCampAttendees,
        monthlyReportSubmissions,
        duesReport,
        districtProjects,
        districtEvents,
        nonRiSyncedClubs,
        riSyncedClubs,
        dataCollection,
      });
    });
  }

  private static async dcConfig(conn: DbCommands, districtId: number, yearId: number) {
    const cfg = await conn.queryFirstOrDefault(
      `SELECT pk_id AS id,
              COALESCE(DcFieldsJson, '[]')     AS dcJson,
              COALESCE(BodFieldsJson, '[]')    AS bodJson,
              COALESCE(MemberFieldsJson, '[]') AS memberJson
       FROM district_directory_config
       WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
       LIMIT 1`,
      { D: districtId, Y: yearId },
    );
    if (!cfg) return null;
    return { configId: Number(cfg.id), dcKeys: Dcf.deserializeKeys(cfg.dcJson), bodKeys: Dcf.deserializeKeys(cfg.bodJson), memberKeys: Dcf.deserializeKeys(cfg.memberJson) };
  }

  /** All Members (list = "all-members") or BOD (designations 1, 2) data collection, optionally one club. */
  async dataCollectionClubList(districtId: number, yearId: number, clubId: number | null, agMemberId: number | null, isSa: boolean, list: "all-members" | "bod"): Promise<ActionResult> {
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blockedShort();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const cfg = await DistrictReportService.dcConfig(conn, districtId, yearId);
      if (!cfg) return ok({ rows: [] });
      const spouseNa = await Dcf.getSpouseNotApplicableMap(conn, cfg.configId);
      const agClubIds = await DistrictReportService.agScopeClubIds(conn, districtId, yearId, agMemberId);
      const col = list === "bod" ? "b.fk_club_id" : "cm.fk_club_id";
      let clubFilter: string;
      let params: Record<string, unknown> = { YearId: yearId };
      if (clubId !== null && clubId > 0) {
        // under AG scope a club outside the allocation gets nothing (the id could be tampered with)
        if (agClubIds && !agClubIds.includes(clubId)) return ok({ rows: [] });
        clubFilter = `${col} = @ClubId`;
        params = { ...params, ClubId: clubId };
      } else {
        let ids = await this.districtClubIds(conn, districtId, isSa);
        if (agClubIds) ids = ids.filter((id) => agClubIds.includes(id));
        clubFilter = `${col} IN (${csv(ids)})`;
      }
      const cols = `m.pk_member_master_profile_id AS id, m.MemberName AS name,
                    m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                    m.SecondaryMobileNumber AS secMobile, c.ClubName AS clubName`;
      const members =
        list === "all-members"
          ? await conn.query(
              `SELECT ${cols}
               FROM club_members cm
               JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
               JOIN club_master c           ON c.pk_club_id = cm.fk_club_id
               WHERE ${clubFilter} AND cm.IsActive = 1 AND cm.isdeleted = 0
               ORDER BY c.ClubName, m.MemberName`,
              params,
            )
          : await conn.query(
              `SELECT ${cols}
               FROM board_of_directors b
               JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
               JOIN club_master c            ON c.pk_club_id = b.fk_club_id
               WHERE ${clubFilter} AND b.fk_year_id = @YearId AND b.isdeleted = 0
                 AND b.fk_designation_id IN (1, 2)
               GROUP BY m.pk_member_master_profile_id, m.MemberName, m.PrimaryMobileNumber, m.RotaryId, m.SecondaryMobileNumber, c.ClubName
               ORDER BY c.ClubName, m.MemberName`,
              params,
            );
      const keys = list === "bod" ? cfg.bodKeys : cfg.memberKeys;
      const rows = [];
      for (const x of members) rows.push(await dcRow(conn, cfg.configId, Number(x.id), String(x.name ?? ""), x.mobile, x.rotaryId, x.secMobile, keys, spouseNa.get(Number(x.id)) === true, String(x.clubName ?? "")));
      return ok({ rows });
    });
  }

  /** District Committee data collection: all three committee levels, one row per person. */
  async dataCollectionDc(districtId: number, yearId: number, agMemberId: number | null): Promise<ActionResult> {
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blockedShort();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const cfg = await DistrictReportService.dcConfig(conn, districtId, yearId);
      if (!cfg) return ok({ rows: [] });
      const spouseNa = await Dcf.getSpouseNotApplicableMap(conn, cfg.configId);
      const agClubIds = await DistrictReportService.agScopeClubIds(conn, districtId, yearId, agMemberId);
      const agClubFilter = agClubIds === null
        ? ""
        : ` AND EXISTS (SELECT 1 FROM club_members cmag
                          WHERE cmag.fk_member_master_profile_id = m.pk_member_master_profile_id
                            AND cmag.IsActive = 1 AND cmag.isdeleted = 0
                            AND cmag.fk_club_id IN (${csv(agClubIds)}))`;
      // the ~20-row committee id set drives the query (driving from members timed out)
      const members = await conn.query(
        `SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name,
                m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                m.SecondaryMobileNumber AS secMobile,
                (SELECT c2.ClubName FROM club_members cm2
                   JOIN club_master c2 ON c2.pk_club_id = cm2.fk_club_id
                  WHERE cm2.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND cm2.IsActive = 1 AND cm2.isdeleted = 0
                  ORDER BY cm2.pk_club_member_id DESC LIMIT 1) AS clubName,
                ids.committee AS committee
         FROM (
             SELECT u.mid, GROUP_CONCAT(CONCAT('- ', u.src) ORDER BY u.srt SEPARATOR '\\n') AS committee
             FROM (
                 SELECT dcm.fk_member_id AS mid, 'District Committee' AS src, 1 AS srt
                 FROM district_committee_member dcm
                 WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @YearId
                   AND dcm.isdeleted = 0 AND dcm.is_active = 1
                   AND COALESCE(dcm.fk_member_id, 0) > 0
                 UNION
                 SELECT gm.fk_member_id, 'Group Committee', 2
                 FROM district_committee_group_member gm
                 JOIN district_committee_group g ON g.id = gm.fk_group_id
                      AND g.isdeleted = 0 AND g.is_active = 1
                 WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
                   AND gm.isdeleted = 0 AND gm.is_active = 1
                   AND COALESCE(gm.fk_member_id, 0) > 0
                 UNION
                 SELECT sgm.fk_member_id, 'Sub Group Committee', 3
                 FROM district_committee_sub_group_member sgm
                 JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id
                      AND sg.isdeleted = 0 AND sg.is_active = 1
                 JOIN district_committee_group g2 ON g2.id = sg.fk_group_id
                      AND g2.isdeleted = 0 AND g2.is_active = 1
                 WHERE g2.fk_district_id = @D AND g2.fk_year_id = @YearId
                   AND sgm.isdeleted = 0 AND sgm.is_active = 1
                   AND COALESCE(sgm.fk_member_id, 0) > 0
             ) u
             GROUP BY u.mid
         ) ids
         JOIN member_master_profile m
              ON m.pk_member_master_profile_id = ids.mid AND m.isdeleted = 0
         WHERE 1 = 1 ${agClubFilter}
         ORDER BY m.MemberName`,
        { D: districtId, YearId: yearId },
      );
      const rows = [];
      for (const x of members)
        rows.push(await dcRow(conn, cfg.configId, Number(x.id), String(x.name ?? ""), x.mobile, x.rotaryId, x.secMobile, cfg.dcKeys, spouseNa.get(Number(x.id)) === true, String(x.clubName ?? ""), String(x.committee ?? "")));
      return ok({ rows });
    });
  }

  /** Governor's Official Visit report: every OCV category x document type per club, uploaded or not. */
  async ocvGov(districtId: number, yearId: number, clubId: number | null, agMemberId: number | null, isSa: boolean): Promise<ActionResult> {
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blockedShort();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      let clubIds: number[];
      if (clubId !== null && clubId > 0) clubIds = [clubId];
      else if (agMemberId !== null && agMemberId > 0)
        clubIds = (
          await conn.query(
            `SELECT a.fk_club_id AS id FROM district_ag a
             WHERE a.fk_member_id = @Ag AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1`,
            { Ag: agMemberId, YearId: yearId },
          )
        ).map((r) => Number(r.id));
      else clubIds = await this.districtClubIds(conn, districtId, isSa);
      if (!clubIds.length) return ok({ districtNumber: "", clubs: [] });

      const districtNumber = (await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", { D: districtId })) ?? "";
      const clubMeta = await conn.query(
        `SELECT c.pk_club_id AS clubPk, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                (SELECT m.MemberName FROM board_of_directors b
                   JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                   JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                  WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.isdeleted = 0
                    AND dm.designation_name = 'Club President' LIMIT 1) AS presidentName,
                (SELECT m.MemberName FROM district_ag a
                   JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
                  WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1 LIMIT 1) AS agName
         FROM club_master c WHERE c.pk_club_id IN @ClubIds ORDER BY c.ClubName`,
        { YearId: yearId, ClubIds: clubIds },
      );
      const rows = await conn.query(
        `SELECT c.pk_club_id AS clubPk,
                cat.CategoryName AS moduleName,
                COALESCE(NULLIF(d.CustomTypeName, ''), t.TypeName) AS documentType,
                CASE WHEN d.pk_document_id IS NULL THEN 0 ELSE 1 END AS uploaded,
                CASE WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                     WHEN d.FilePath LIKE '/%' THEN d.FilePath
                     ELSE CONCAT('/Documents/OCV/Group', d.fk_club_id, '/', d.FilePath) END AS downloadUrl
         FROM club_master c
         CROSS JOIN ocv_document_category cat
         JOIN ocv_document_type t ON t.fk_category_id = cat.pk_category_id AND t.isdeleted = 0 AND t.IsActive = 1
         LEFT JOIN ocv_documents d ON d.fk_club_id = c.pk_club_id AND d.fk_year_id = @YearId
               AND d.fk_category_id = cat.pk_category_id AND d.fk_type_id = t.pk_type_id AND d.isdeleted = 0
         WHERE c.pk_club_id IN @ClubIds AND cat.IsActive = 1
         ORDER BY c.ClubName, cat.SortOrder, cat.CategoryName, t.SortOrder, t.TypeName, d.pk_document_id`,
        { YearId: yearId, ClubIds: clubIds },
      );
      const byClub = new Map<number, unknown[]>();
      for (const r of rows) {
        const k = Number(r.clubPk);
        if (!byClub.has(k)) byClub.set(k, []);
        byClub.get(k)!.push({ moduleName: r.moduleName, documentType: r.documentType, uploaded: Number(r.uploaded) === 1, downloadUrl: r.downloadUrl ?? null });
      }
      const clubs = clubMeta.map((cm) => ({
        clubId: Number(cm.clubPk),
        clubName: cm.clubName,
        clubRotaryId: cm.clubRotaryId ?? null,
        presidentName: cm.presidentName ?? null,
        agName: cm.agName ?? null,
        rows: byClub.get(Number(cm.clubPk)) ?? [],
      }));
      return ok({ districtNumber: String(districtNumber), yearId, clubs });
    });
  }

  /** Club Officers live from Rotary.org for the year's date range, gaps filled from our members by RotaryId. */
  async clubOfficersFromRi(districtId: number, yearId: number, clubId: number | null, agMemberId: number | null, isSa: boolean): Promise<ActionResult> {
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blockedShort();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const yr = await conn.queryFirstOrDefault("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", { Y: yearId });
      if (!yr) return badRequest({ message: "Invalid year." });
      const [startDate, endDate] = [formatDate(yr.StartDate, "MM/dd/yyyy"), formatDate(yr.EndDate, "MM/dd/yyyy")];
      const agIds = await DistrictReportService.agScopeClubIds(conn, districtId, yearId, agMemberId);
      const agFilter = agIds === null ? "" : `AND c.pk_club_id IN (${csv(agIds)})`;
      const clubs = await conn.query(
        `SELECT c.pk_club_id AS clubPk, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                COALESCE(NULLIF(c.ClubType,''),'Rotary Club') AS clubType
         FROM club_master c
         WHERE c.fk_district_id = @D AND c.isdeleted = 0${this.notRotaractUnlessSa(isSa)}
           AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''
           AND (@ClubId IS NULL OR c.pk_club_id = @ClubId)
           ${agFilter}
         ORDER BY c.ClubName`,
        { D: districtId, ClubId: clubId },
      );

      // bounded parallelism: Rotary.org is slow per call
      const perClub: { clubName: string; officers: RotaryOrgClubOfficer[] }[] = new Array(clubs.length);
      let next = 0;
      const worker = async () => {
        for (let i = next++; i < clubs.length; i = next++) {
          const c = clubs[i];
          const rid = /^\s*-?\d+\s*$/.test(String(c.clubRotaryId ?? "")) ? parseInt(String(c.clubRotaryId), 10) : 0;
          let officers: RotaryOrgClubOfficer[] = [];
          try {
            if (rid > 0) officers = await this.rotaryOrg.getClubOfficers(String(c.clubType), rid, startDate, endDate);
          } catch {
            officers = [];
          }
          perClub[i] = { clubName: String(c.clubName), officers };
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, clubs.length) }, worker));

      const rids = [...new Set(perClub.flatMap((x) => x.officers).map((o) => o.rotaryId).filter((x): x is string => !!x && !!x.trim()))];
      if (rids.length) {
        const dbByRid = new Map<string, Row>();
        for (const d of await conn.query("SELECT RotaryId AS rotaryId, EmailId AS email, PrimaryMobileNumber AS mobile, MemberName AS name FROM member_master_profile WHERE RotaryId IN @Rids AND isdeleted = 0", { Rids: rids }))
          if (!dbByRid.has(String(d.rotaryId))) dbByRid.set(String(d.rotaryId), d);
        const blank = (s: string | null) => !s || !s.trim();
        for (const { officers } of perClub)
          for (const o of officers) {
            const db = o.rotaryId && o.rotaryId.trim() ? dbByRid.get(o.rotaryId) : undefined;
            if (!db) continue;
            if (blank(o.email)) o.email = db.email ?? null;
            if (blank(o.phone)) o.phone = db.mobile ?? null;
            if (blank(o.name)) o.name = db.name ?? null;
          }
      }
      return ok(perClub.map((x) => mapOfficerRow(x.clubName, x.officers)));
    });
  }

  async availableYears(districtId: number, isSa: boolean): Promise<ActionResult> {
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blocked();
    return this.db.session(async (conn) => {
      const ids = csv(await this.districtClubIds(conn, districtId, isSa));
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      const legs = tables.length === 0
        ? "SELECT NULL AS fk_year_id WHERE 1=0"
        : tables.map((t) => `(SELECT ${t.yearId} AS fk_year_id FROM \`${t.projectsTable}\` WHERE isdeleted = 0 AND (fk_district_id = @D OR fk_club_id IN (${ids})) LIMIT 1)`).join(" UNION ");
      return ok(
        await conn.query(
          `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
           FROM rotary_year_master y
           WHERE y.pk_year_id IN (
               SELECT fk_year_id FROM (${legs}) yp
               UNION SELECT y2.pk_year_id FROM rotary_year_master y2
                      JOIN announcements a ON a.PublishDateTime >= y2.StartDate AND a.PublishDateTime < DATE_ADD(y2.EndDate, INTERVAL 1 DAY)
                      WHERE a.isdeleted = 0 AND (a.fk_district_id = @D OR a.fk_club_id IN (${ids}))
               UNION SELECT y3.pk_year_id FROM rotary_year_master y3
                      JOIN upcoming_events e ON e.PublishDate >= y3.StartDate AND e.PublishDate < DATE_ADD(y3.EndDate, INTERVAL 1 DAY)
                      WHERE e.isdeleted = 0 AND (e.fk_district_id = @D OR e.fk_club_id IN (${ids}))
               UNION SELECT y4.pk_year_id FROM rotary_year_master y4
                      JOIN newsletters n ON n.PublishDateTime >= y4.StartDate AND n.PublishDateTime < DATE_ADD(y4.EndDate, INTERVAL 1 DAY)
                      WHERE n.isdeleted = 0 AND (n.fk_district_id = @D OR n.fk_club_id IN (${ids}))
               UNION SELECT fk_year_id FROM club_attendance WHERE isdeleted = 0 AND fk_club_id IN (${ids})
               UNION SELECT fk_year_id FROM board_of_directors WHERE isdeleted = 0 AND fk_club_id IN (${ids})
               UNION SELECT fk_year_id FROM district_governors WHERE fk_district_id = @D AND isdeleted = 0
               UNION SELECT fk_year_id FROM district_committee_member WHERE fk_district_id = @D AND isdeleted = 0
               UNION SELECT fk_year_id FROM club_monthly_reports WHERE isdeleted = 0 AND fk_club_id IN (${ids})
           )
           OR y.IsCurrent = 1
           ORDER BY y.pk_year_id DESC`,
          { D: districtId },
        ),
      );
    });
  }

  /** Avenue of Service (All Clubs): one row per project of the year across the district's clubs. */
  async avenueOfServiceAllClubs(districtId: number, yearId: number, agMemberId: number | null): Promise<ActionResult> {
    this.log.log(`AvenueOfServiceAllClubs: district=${districtId} year=${yearId}`);
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const pInfo = await this.yearTables.resolveByYearId(conn, yearId);
      if (!pInfo) {
        this.log.warn(`AvenueOfServiceAllClubs: no year-wise projects table for yearId=${yearId}; returning empty.`);
        return ok([]);
      }
      const agIds = await DistrictReportService.agScopeClubIds(conn, districtId, yearId, agMemberId);
      const agFilter = agIds === null ? "" : `AND c.pk_club_id IN (${csv(agIds)})`;
      return ok(
        await conn.query(
          `SELECT c.ClubName               AS clubName,
                  d.DistrictNumber         AS districtNumber,
                  mm.ModuleName            AS typeOfProject,
                  mm.ModuleKey             AS moduleKey,
                  p.club_role              AS clubRole,
                  p.co_host_name           AS coHostName,
                  af.name                  AS areaOfFocus,
                  cat.name                 AS category,
                  sc.name                  AS subCategory,
                  p.project_date           AS projectDate,
                  p.title                  AS title,
                  p.description            AS description,
                  p.location               AS location,
                  p.project_cost           AS projectCost,
                  f.name                   AS funding,
                  p.global_grant_number    AS globalGrantNumber,
                  p.csr_company_name       AS csrCompanyName,
                  p.amount_sanctioned      AS amountSanctioned,
                  p.amount_received        AS amountReceived,
                  p.project_cost           AS amountSpent,
                  p.host_clubs_districts   AS hostClubsDistricts,
                  p.global_partner_clubs_districts AS globalPartners,
                  p.direct_beneficiaries   AS beneficiaries,
                  p.man_hours              AS manHours,
                  p.rotarians_involved     AS rotariansInvolved,
                  CONCAT(@FrontendUrl, '/public/project/', p.pk_project_id, '?year=', @YearId) AS publicPhotoUrl
           FROM \`${pInfo.projectsTable}\` p
           JOIN club_master c        ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
           JOIN district_master d    ON d.pk_district_id = c.fk_district_id
           JOIN module_master mm     ON mm.pk_module_id = p.fk_module_id
           LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master cat     ON cat.pk_category_id = p.fk_category_id
           LEFT JOIN sub_category_master sc  ON sc.pk_sub_category_id = p.fk_sub_category_id
           LEFT JOIN funding_master f        ON f.pk_funding_id = p.fk_funding_id
           WHERE c.fk_district_id = @D
             AND p.isdeleted = 0
             ${agFilter}
           ORDER BY c.ClubName, p.project_date DESC, p.pk_project_id DESC`,
          { D: districtId, YearId: yearId, FrontendUrl: this.frontendUrl },
        ),
      );
    });
  }

  /** Avenue of Service (Club Wise Count): projects per club for the year, Club Service excluded. */
  async avenueOfServiceClubCount(districtId: number, yearId: number, agMemberId: number | null, isSa: boolean): Promise<ActionResult> {
    this.log.log(`AvenueOfServiceClubCount: district=${districtId} year=${yearId}`);
    if (!(await isDistrictDrillReachable(this.db, districtId))) return this.blocked();
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.db.session(async (conn) => {
      const pInfo = await this.yearTables.resolveByYearId(conn, yearId);
      if (!pInfo) {
        this.log.warn(`AvenueOfServiceClubCount: no year-wise projects table for yearId=${yearId}; returning empty.`);
        return ok([]);
      }
      const agIds = await DistrictReportService.agScopeClubIds(conn, districtId, yearId, agMemberId);
      const agFilter = agIds === null ? "" : `AND c.pk_club_id IN (${csv(agIds)})`;
      return ok(
        await conn.query(
          `SELECT c.pk_club_id          AS clubId,
                  d.DistrictNumber      AS districtNumber,
                  c.ClubName            AS clubName,
                  COUNT(p.pk_project_id) AS projectCount
           FROM club_master c
           JOIN district_master d ON d.pk_district_id = c.fk_district_id
           LEFT JOIN \`${pInfo.projectsTable}\` p
               ON p.fk_club_id = c.pk_club_id
              AND p.isdeleted = 0
              AND p.fk_module_id IN (SELECT pk_module_id FROM module_master WHERE ModuleKey <> 'club_service')
           WHERE c.fk_district_id = @D AND c.isdeleted = 0${this.notRotaractUnlessSa(isSa)} ${agFilter}
           GROUP BY c.pk_club_id, d.DistrictNumber, c.ClubName
           ORDER BY c.ClubName`,
          { D: districtId },
        ),
      );
    });
  }
}

/** Column spec for the district data-collection reports; master marks the fixed columns. */
export function dcColumnSpec(keys: string[], includeCommittee = false) {
  return [
    { key: "clubName", label: "Club Name", master: true },
    { key: "memberName", label: "Member Name", master: true },
    ...(includeCommittee ? [{ key: "committee", label: "Committee", master: true }] : []),
    { key: "updatedOn", label: "Updated On", master: true },
    { key: "mobile", label: "Mobile Number", master: true },
    { key: "rotaryId", label: "Rotary Id", master: true },
    { key: "secondaryMobile", label: "Secondary_mobile_Number", master: true },
    ...keys.map(Dcf.getField).filter((x): x is Dcf.FieldDef => x !== null).map((x) => ({ key: x.key, label: x.label, master: false })),
    { key: "donePercent", label: "Done (%)", master: true },
    { key: "pendingPercent", label: "Pending (%)", master: true },
    { key: "totalFields", label: "No. of Total Fields", master: true },
    { key: "pendingFields", label: "No. of Pending Fields", master: true },
  ];
}

/** One data-collection row; spouse fields leave the completion score when "no spouse" was ticked. */
async function dcRow(conn: DbCommands, configId: number, memberId: number, memName: string, mobile: unknown, rotaryId: unknown, secondaryMobile: unknown, keys: string[], spouseNotApplicable: boolean, clubLabel: string, committee: string | null = null) {
  const values = await Dcf.loadValues(conn, memberId, keys);
  const { filled, total } = Dcf.computeCompletion(values, Dcf.applySpouseNotApplicable(keys, spouseNotApplicable));
  const donePct = total > 0 ? dotnetRound((100 * filled) / total) : 0;
  const updatedOn = await conn.executeScalar("SELECT MAX(SubmittedAt) FROM district_directory_submission_log WHERE fk_config_id = @C AND fk_member_id = @M", { C: configId, M: memberId });
  const row: Record<string, unknown> = { clubName: clubLabel, memberName: memName };
  if (committee !== null) row.committee = committee;
  Object.assign(row, {
    updatedOn: updatedOn ? formatDate(String(updatedOn), "dd/MMM/yy hh:mm:ss tt") : null,
    mobile: mobile ?? "",
    rotaryId: rotaryId ?? "",
    secondaryMobile: secondaryMobile ?? "",
    donePercent: donePct + "%",
    pendingPercent: (total > 0 ? 100 - donePct : 0) + "%",
    totalFields: total,
    pendingFields: Math.max(0, total - filled),
  });
  for (const key of keys) {
    const x = Dcf.getField(key);
    row[key] = x ? renderForExport(x, values.get(key)) : null;
  }
  return row;
}

/** Rotary.org officers -> the 8 fixed office columns, by role-name keywords. */
export function mapOfficerRow(clubName: string, officers: RotaryOrgClubOfficer[]) {
  const find = (match: (r: string) => boolean) => officers.find((o) => !!o.role && !!o.role.trim() && match(o.role.toLowerCase()));
  const pres = find((r) => r.includes("president") && !r.includes("vice") && !r.includes("past") && !r.includes("elect"));
  const execSec = find((r) => r.includes("executive secretary") || r.includes("exec secretary"));
  const sec = find((r) => r.includes("secretary") && !r.includes("executive") && !r.includes("exec"));
  const treas = find((r) => r.includes("treasurer"));
  const found = find((r) => r.includes("foundation"));
  const memb = find((r) => r.includes("membership"));
  const pubImg = find((r) => r.includes("public image") || r.includes("public relations") || r.includes("image"));
  const svc = find((r) => r.includes("service project") || r.includes("service projects") || r.includes("projects"));
  return {
    clubName,
    presidentName: pres?.name ?? null, presidentEmail: pres?.email ?? null, presidentMobile: pres?.phone ?? null,
    secretaryName: sec?.name ?? null, secretaryEmail: sec?.email ?? null, secretaryMobile: sec?.phone ?? null,
    execSecretaryName: execSec?.name ?? null, execSecretaryMobile: execSec?.phone ?? null, execSecretaryEmail: execSec?.email ?? null,
    treasurerName: treas?.name ?? null, treasurerEmail: treas?.email ?? null, treasurerMobile: treas?.phone ?? null,
    foundationChairName: found?.name ?? null, foundationChairEmail: found?.email ?? null, foundationChairMobile: found?.phone ?? null,
    membershipChairName: memb?.name ?? null, membershipChairEmail: memb?.email ?? null, membershipChairMobile: memb?.phone ?? null,
    publicImageChairName: pubImg?.name ?? null, publicImageChairEmail: pubImg?.email ?? null, publicImageChairMobile: pubImg?.phone ?? null,
    serviceProjectsChairName: svc?.name ?? null, serviceProjectsChairEmail: svc?.email ?? null, serviceProjectsChairMobile: svc?.phone ?? null,
  };
}

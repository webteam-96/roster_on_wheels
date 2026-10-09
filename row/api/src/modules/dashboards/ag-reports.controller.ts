import { Controller, Get, Query } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { forbid, ok } from "../../common/results";
import { queryInt } from "../../common/binding";
import { Brand } from "../../brand/brand";
import { YearTableResolver } from "../../services/year-table.resolver";

const bloodGroupOn = () => Brand.feature("member.bloodGroup");
const familyOn = () => Brand.feature("member.familyDetails");
const hideBloodGroup = (rows: Row[]) => {
  if (!bloodGroupOn()) for (const r of rows) r.bloodGroup = null;
  return rows;
};

/** Port of AgReportsController.cs: api/ag/reports, export lists over the AG's clubs (district_ag). */
@Controller("api/ag/reports")
@Authorize()
export class AgReportsController {
  constructor(
    private readonly db: Db,
    private readonly yearTables: YearTableResolver,
  ) {}

  private isAg = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("AG");
  private memberId = (u: CurrentUser) =>
    parseInt(u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "0", 10) || 0;

  private async myClubIds(conn: DbCommands, u: CurrentUser, clubFilter: number | null, yearFilter: number | null) {
    const memberId = this.memberId(u);
    if (memberId === 0) return [];
    const rows = await conn.query(
      `SELECT fk_club_id AS id FROM district_ag
       WHERE fk_member_id = @MemberId AND isdeleted = 0 AND is_active = 1 AND (@YearId IS NULL OR fk_year_id = @YearId)`,
      { MemberId: memberId, YearId: yearFilter },
    );
    const ids = [...new Set(rows.map((r) => Number(r.id)))];
    return clubFilter !== null ? ids.filter((x) => x === clubFilter) : ids;
  }

  /** The common shape: AG guard, the AG's club ids (optionally one club), then the report query. */
  private async report(u: CurrentUser, y: string | undefined, c: string | undefined, work: (conn: DbCommands, clubIds: number[], yearId: number | null) => Promise<Row[]>) {
    const [yearId, clubId] = [queryInt(y), queryInt(c)];
    if (!this.isAg(u)) return forbid();
    return this.db.session(async (conn) => {
      const clubIds = await this.myClubIds(conn, u, clubId, yearId);
      return ok(clubIds.length ? await work(conn, clubIds, yearId) : []);
    });
  }

  /** Appends the optional year filter and the ORDER BY, as the C# DynamicParameters branches do. */
  private static filtered(conn: DbCommands, sql: string, clubIds: number[], yearId: number | null, yearClause: string, orderBy: string) {
    return conn.query(`${sql}${yearId !== null ? ` ${yearClause}` : ""} ORDER BY ${orderBy}`, { ClubIds: clubIds, YearId: yearId });
  }

  @Get("my-clubs")
  async myClubs(@User() u: CurrentUser, @Query("yearId") y?: string) {
    const yearId = queryInt(y);
    if (!this.isAg(u)) return forbid();
    return ok(
      await this.db.query(
        `SELECT DISTINCT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, d.DistrictNumber AS districtNumber
         FROM district_ag ag
         JOIN club_master c ON c.pk_club_id = ag.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE ag.fk_member_id = @MemberId AND ag.isdeleted = 0 AND ag.is_active = 1 AND (@YearId IS NULL OR ag.fk_year_id = @YearId)
         ORDER BY c.ClubName`,
        { MemberId: this.memberId(u), YearId: yearId },
      ),
    );
  }

  @Get("my-years")
  async myYears(@User() u: CurrentUser) {
    if (!this.isAg(u)) return forbid();
    return ok(
      await this.db.query(
        `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent, y.StartDate AS startDate, y.EndDate AS endDate
         FROM district_ag ag
         JOIN rotary_year_master y ON y.pk_year_id = ag.fk_year_id
         WHERE ag.fk_member_id = @MemberId AND ag.isdeleted = 0 AND ag.is_active = 1
         ORDER BY y.IsCurrent DESC, y.pk_year_id DESC`,
        { MemberId: this.memberId(u) },
      ),
    );
  }

  @Get("clubs")
  clubs(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids) =>
      conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                z.ZoneName AS zoneName, c.MeetingDay AS meetingDay, c.MeetingFromTime AS meetingFromTime, c.MeetingToTime AS meetingToTime,
                c.MeetingAddress AS meetingAddress, c.City AS city, c.State AS state, c.Country AS country, c.Pincode AS pincode,
                c.ClubWebsite AS clubWebsite, c.ActiveFromDate AS activeFromDate, c.ActiveToDate AS activeToDate,
                (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0 AND cm.IsActive = 1 AND m.isdeleted = 0) AS totalMembers,
                CASE WHEN c.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive, c.ClubCharterDate AS charterDate
         FROM club_master c
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE c.pk_club_id IN @ClubIds AND c.isdeleted = 0
         ORDER BY c.ClubName`,
        { ClubIds: ids },
      ),
    );
  }

  @Get("club-members")
  clubMembers(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, async (conn, ids) =>
      hideBloodGroup(
        await conn.query(
          `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.RotaryId AS rotaryId, m.EmailId AS email,
                  m.PrimaryMobileNumber AS mobile, m.Gender AS gender, m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
                  m.BloodGroup AS bloodGroup, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, d.DistrictNumber AS districtNumber,
                  cm.JoinedDate AS joinedDate
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
           JOIN district_master d ON d.pk_district_id = c.fk_district_id
           WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
           ORDER BY c.ClubName, m.MemberName`,
          { ClubIds: ids },
        ),
      ),
    );
  }

  private static readonly BOD_FROM = `
    FROM board_of_directors bod
    JOIN club_master c ON c.pk_club_id = bod.fk_club_id AND c.isdeleted = 0
    JOIN district_master d ON d.pk_district_id = c.fk_district_id
    JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
    JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
    JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
    WHERE c.pk_club_id IN @ClubIds AND bod.isdeleted = 0`;

  /** Presidents and secretaries (designation ids 1 and 4). */
  @Get("club-leadership")
  clubLeadership(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT bod.pk_board_director_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, d.DistrictNumber AS districtNumber,
                y.YearLabel AS yearLabel, dg.designation_name AS designation, m.MemberName AS memberName,
                m.PrimaryMobileNumber AS mobile, m.EmailId AS email
         ${AgReportsController.BOD_FROM} AND bod.fk_designation_id IN (1, 4)`,
        ids, yearId, "AND bod.fk_year_id = @YearId", "y.YearLabel DESC, c.ClubName, dg.sort_order",
      ),
    );
  }

  @Get("board-of-directors")
  boardOfDirectors(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT bod.pk_board_director_id AS id, c.ClubName AS clubName, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
                dg.designation_name AS designation, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email
         ${AgReportsController.BOD_FROM}`,
        ids, yearId, "AND bod.fk_year_id = @YearId", "y.YearLabel DESC, c.ClubName, dg.sort_order",
      ),
    );
  }

  @Get("club-websites")
  clubWebsites(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids) =>
      conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber, c.ClubWebsite AS clubWebsite
         FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.pk_club_id IN @ClubIds AND c.isdeleted = 0
         ORDER BY c.ClubName`,
        { ClubIds: ids },
      ),
    );
  }

  @Get("club-announcements")
  clubAnnouncements(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT a.Title AS title, a.Description AS description,
                CASE
                    WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                    WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                    WHEN a.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', a.ImagePath)
                    WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                    ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                END AS imagePath,
                a.PublishDateTime AS publishedDate, a.ExpiryDateTime AS expiryDate, c.ClubName AS clubName,
                d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
         FROM announcements a
         JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON a.PublishDateTime >= y.StartDate AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         WHERE c.pk_club_id IN @ClubIds AND a.isdeleted = 0`,
        ids, yearId, "AND y.pk_year_id = @YearId", "a.PublishDateTime DESC",
      ),
    );
  }

  @Get("club-upcoming-events")
  clubUpcomingEvents(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT e.Title AS title, e.Description AS description, e.EventDate AS eventDate, DATE_FORMAT(e.EventDate, '%H:%i') AS eventTime,
                e.EventVenue AS location, c.ClubName AS clubName, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
         FROM upcoming_events e
         JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON e.PublishDate >= y.StartDate AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         WHERE c.pk_club_id IN @ClubIds AND e.isdeleted = 0`,
        ids, yearId, "AND y.pk_year_id = @YearId", "e.EventDate DESC",
      ),
    );
  }

  @Get("club-attendance")
  clubAttendance(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT a.EventDateTime AS meetingDate, a.EventName AS meetingTopic,
                (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS totalMembers,
                (SELECT COUNT(*) FROM club_attendance_members am WHERE am.fk_attendance_id = a.pk_attendance_id) AS presentMembers,
                c.ClubName AS clubName, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
         FROM club_attendance a
         JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
         WHERE c.pk_club_id IN @ClubIds AND a.isdeleted = 0`,
        ids, yearId, "AND a.fk_year_id = @YearId", "a.EventDateTime DESC",
      ),
    );
  }

  @Get("club-documents")
  clubDocuments(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT doc.Title AS title, doc.AccessType AS accessType,
                CASE
                    WHEN doc.FilePath IS NULL OR doc.FilePath = '' THEN NULL
                    WHEN doc.FilePath LIKE '/%' THEN doc.FilePath
                    WHEN doc.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', doc.FilePath)
                    WHEN doc.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', doc.fk_district_id, '/', doc.FilePath)
                    ELSE CONCAT('/Documents/documentsafe/Group', doc.fk_club_id, '/', doc.FilePath)
                END AS documentUrl,
                doc.PublishDateTime AS documentDate, c.ClubName AS clubName, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
         FROM club_documents doc
         JOIN club_master c ON c.pk_club_id = doc.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON doc.PublishDateTime >= y.StartDate AND doc.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         WHERE c.pk_club_id IN @ClubIds AND doc.isdeleted = 0`,
        ids, yearId, "AND y.pk_year_id = @YearId", "doc.PublishDateTime DESC",
      ),
    );
  }

  @Get("rotary-projects")
  rotaryProjects(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, async (conn, ids, yearId) => {
      const tables =
        yearId !== null
          ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t) => t !== null)
          : await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return [];
      const legs = tables.map(
        (t) => `SELECT p.title AS title, p.description AS description, p.location AS location, p.project_type AS projectType,
                       p.project_date AS startDate, NULL AS endDate, p.direct_beneficiaries AS totalBeneficiaries,
                       (COALESCE(p.rotarians_involved,0) + COALESCE(p.rotaractors_involved,0)) AS totalVolunteers,
                       p.project_cost AS totalCost, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       '${t.yearLabel}' AS yearLabel, md.ModuleName AS moduleName
                FROM \`${t.projectsTable}\` p
                JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                WHERE c.pk_club_id IN @ClubIds AND p.isdeleted = 0`,
      );
      return conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY u.startDate DESC`, { ClubIds: ids });
    });
  }

  @Get("trf-contributions")
  trfContributions(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT t.TrfDate AS contributionDate, t.AmountUSD AS amount, t.FundType AS recognition, t.OtherFundName AS remarks,
                COALESCE(f.FundName, t.OtherFundName) AS fundName, t.DonorName AS memberName, c.ClubName AS clubName,
                d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
         FROM trf_contributions t
         JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON y.pk_year_id = t.fk_year_id
         LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
         WHERE c.pk_club_id IN @ClubIds AND t.isdeleted = 0`,
        ids, yearId, "AND t.fk_year_id = @YearId", "t.TrfDate DESC",
      ),
    );
  }

  @Get("pph-camps")
  pphCamps(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT pc.Title AS campName, pc.CampDate AS campDate, pc.Address AS location,
                (SELECT COUNT(*) FROM pph_camp_attendance pa WHERE pa.fk_camp_id = pc.pk_camp_id) AS beneficiaryCount,
                c.ClubName AS clubName, d.DistrictNumber AS districtNumber, NULL AS yearLabel
         FROM pph_camps pc
         JOIN club_master c ON c.pk_club_id = pc.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.pk_club_id IN @ClubIds AND pc.isdeleted = 0`,
        ids, yearId,
        `AND pc.CampDate BETWEEN (SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @YearId)
                             AND (SELECT EndDate FROM rotary_year_master WHERE pk_year_id = @YearId)`,
        "pc.CampDate DESC",
      ),
    );
  }

  @Get("newsletters")
  newsletters(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT n.Title AS title, n.PublishDateTime AS publishedDate, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                y.YearLabel AS yearLabel
         FROM newsletters n
         JOIN club_master c ON c.pk_club_id = n.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         WHERE c.pk_club_id IN @ClubIds AND n.isdeleted = 0`,
        ids, yearId, "AND y.pk_year_id = @YearId", "n.PublishDateTime DESC",
      ),
    );
  }

  @Get("club-monthly-reports")
  clubMonthlyReports(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids, yearId) =>
      AgReportsController.filtered(
        conn,
        `SELECT r.ReportMonth AS reportMonth, CASE WHEN r.IsUploadedToDistrict = 1 THEN 'Yes' ELSE 'No' END AS isSubmitted,
                COALESCE(r.uploaded_to_district_date, r.created_date) AS submittedDate, c.ClubName AS clubName,
                d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
         FROM club_monthly_reports r
         JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
         WHERE c.pk_club_id IN @ClubIds AND r.isdeleted = 0`,
        ids, yearId, "AND r.fk_year_id = @YearId", "r.ReportMonth DESC",
      ),
    );
  }

  private static readonly MEMBERS_FROM = `
    FROM club_members cm
    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
    JOIN district_master d ON d.pk_district_id = c.fk_district_id`;

  @Get("members-full-details")
  membersFullDetails(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, async (conn, ids) =>
      hideBloodGroup(
        await conn.query(
          `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.RotaryId AS rotaryId, m.EmailId AS email,
                  m.PrimaryMobileNumber AS mobile, m.SecondaryMobileNumber AS secondaryMobile, m.Gender AS gender, m.BirthDate AS birthDate,
                  m.AnniversaryDate AS anniversaryDate, m.BloodGroup AS bloodGroup, m.PrimaryLanguage AS primaryLanguage,
                  m.MemberIntroduction AS introduction, m.Facebook AS facebook, m.Instagram AS instagram, m.LinkedIn AS linkedIn,
                  m.Twitter AS twitter, m.Youtube AS youtube, m.Website AS website, m.DonorRecognition AS donorRecognition,
                  c.ClubName AS clubName, d.DistrictNumber AS districtNumber
           ${AgReportsController.MEMBERS_FROM}
           WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
           ORDER BY c.ClubName, m.MemberName`,
          { ClubIds: ids },
        ),
      ),
    );
  }

  @Get("members-contact-summary")
  membersContactSummary(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids) =>
      conn.query(
        `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS primaryMobile, m.SecondaryMobileNumber AS secondaryMobile,
                m.EmailId AS email, c.ClubName AS clubName, d.DistrictNumber AS districtNumber
         ${AgReportsController.MEMBERS_FROM}
         WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
         ORDER BY c.ClubName, m.MemberName`,
        { ClubIds: ids },
      ),
    );
  }

  @Get("members-addresses")
  membersAddresses(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids) =>
      conn.query(
        `SELECT m.MemberName AS memberName, a.AddressType AS addressType, a.Address AS address, a.City AS city, a.State AS state,
                a.PinCode AS pinCode, a.PhoneNumber AS phoneNumber, a.BusinessName AS businessName, cm.Designation AS designation,
                cm.ClassificationProfession AS classification, a.Keywords AS keywords, c.ClubName AS clubName, d.DistrictNumber AS districtNumber
         ${AgReportsController.MEMBERS_FROM}
         LEFT JOIN member_address_details a ON a.fk_member_master_profile_id = m.pk_member_master_profile_id AND a.isdeleted = 0
         WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
         ORDER BY c.ClubName, m.MemberName, a.AddressType`,
        { ClubIds: ids },
      ),
    );
  }

  @Get("mobile-app-users")
  mobileAppUsers(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids) =>
      conn.query(
        `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, m.LastDeviceName AS lastDeviceName,
                m.MobileLoginCount AS loginCount, m.FirstMobileVisit AS firstVisit, m.LastMobileVisit AS lastLogin,
                m.LastMobileLogout AS lastLogout, c.ClubName AS clubName, d.DistrictNumber AS districtNumber
         ${AgReportsController.MEMBERS_FROM}
         WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1 AND COALESCE(m.MobileLoginCount, 0) > 0
         ORDER BY m.LastMobileVisit DESC`,
        { ClubIds: ids },
      ),
    );
  }

  @Get("potential-members")
  potentialMembers(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, (conn, ids) =>
      conn.query(
        `SELECT pm.name AS memberName, pm.mobile_number AS mobile, pm.email AS email, NULL AS classification,
                pm.reference_details AS referredBy, NULL AS status, pm.created_date AS addedOn, c.ClubName AS clubName,
                d.DistrictNumber AS districtNumber
         FROM potential_members pm
         JOIN club_master c ON c.pk_club_id = pm.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.pk_club_id IN @ClubIds AND pm.isdeleted = 0
         ORDER BY pm.created_date DESC`,
        { ClubIds: ids },
      ),
    );
  }

  @Get("family-details")
  familyDetails(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    return this.report(u, y, c, async (conn, ids) => {
      if (!familyOn()) return [];
      return hideBloodGroup(
        await conn.query(
          `SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber, m.MemberName AS rotarianName, f.Name AS familyMemberName,
                  f.Relation AS relation, f.PhoneNumber AS mobile, f.EmailId AS email, f.BloodGroup AS bloodGroup, f.BirthDate AS birthDate,
                  f.AnniversaryDate AS anniversaryDate
           FROM member_family_details f
           JOIN member_master_profile m ON m.pk_member_master_profile_id = f.fk_member_master_profile_id AND m.isdeleted = 0
           JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0 AND cm.IsActive = 1
           JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
           JOIN district_master d ON d.pk_district_id = c.fk_district_id
           WHERE c.pk_club_id IN @ClubIds AND f.isdeleted = 0
           ORDER BY c.ClubName, m.MemberName, f.Name`,
          { ClubIds: ids },
        ),
      );
    });
  }
}

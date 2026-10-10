import { Body, Controller, Delete, Get, Logger, Param, Post, Query } from "@nestjs/common";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { bodyField, bodyIntList, paramInt, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { YearTableResolver } from "../../services/year-table.resolver";
import { EmailService } from "../../services/email.service";
import { CreditManagementService } from "../../services/credit-management.service";
import { WhatsAppSender, memberE164 } from "../../services/messaging";
import { RoleService } from "../roles/role.service";
import { resolveDefaultCurrency } from "../../services/currency.helper";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
const PROFILE_PHOTO = `CASE
    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
  END`;
const footer = () => `<p style='color:#718096;font-size:12px;margin-top:24px;'>This is an automated notification from ${Brand.Current.productName}.</p>`;

/** The red "role removed" notice the moderator and AG endpoints send. */
function removedBody(memberName: string, role: string, districtNumber: string, title: string) {
  return `<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;'>
    <div style='background:#dc2626;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;'><h2 style='margin:0;'>${title}</h2></div>
    <div style='padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;'>
        <p>Dear <strong>${memberName}</strong>,</p>
        <p>Your <strong>${role}</strong> role for District <strong>${districtNumber}</strong> has been removed.</p>
        <p>If you have any questions, please contact your district administrator.</p>
        ${footer()}
    </div></div>`;
}

/** The blue assignment notice with the club list and login details. */
function assignedBody(memberName: string, role: string, title: string, districtNumber: string, clubNames: string[], mobile: string | null, tempPassword: string | null) {
  const box = "<div style='background-color:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>";
  const credentials =
    tempPassword !== null
      ? `${box}<p><strong>Username:</strong> ${mobile ?? ""}</p><p><strong>Temporary Password:</strong> ${tempPassword}</p></div><p style='color:#e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>`
      : `${box}<p><strong>Username:</strong> ${mobile ?? ""}</p><p>Use your existing password to login.</p></div>`;
  return `<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;'>
    <div style='background:#1a365d;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;'><h2 style='margin:0;'>${title}</h2></div>
    <div style='padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;'>
        <p>Dear <strong>${memberName}</strong>,</p>
        <p>You have been assigned as <strong>${role}</strong> for District <strong>${districtNumber}</strong>.</p>
        <h3 style='color:#1a365d;margin-top:20px;'>Assigned Clubs:</h3>
        <ul style='background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 16px 16px 32px;margin:8px 0;'>${clubNames.map((c) => `<li style='padding:4px 0;'>${c}</li>`).join("")}</ul>
        <h3 style='color:#1a365d;margin-top:20px;'>Login Details:</h3>
        ${credentials}
        ${footer()}
    </div></div>`;
}

/** Port of DistrictModulesController.cs, part 4: club drill-down, club monthly reports, club moderators and Assistant Governors. */
@Controller("api/districts/:districtId")
@Authorize()
export class DistrictPeopleController {
  private readonly log = new Logger("DistrictModulesController");

  constructor(
    private readonly db: Db,
    private readonly yearTables: YearTableResolver,
    private readonly email: EmailService,
    private readonly credits: CreditManagementService,
    private readonly whatsApp: WhatsAppSender,
    private readonly roles: RoleService,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async districtBlocked(districtId: number) {
    return !(await isDistrictDrillReachable(this.db, districtId)) ? statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE }) : null;
  }
  private async clubBlocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }
  private async districtNumber(conn: DbCommands, districtId: number) {
    return (await conn.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "";
  }
  private sendQuietly(to: string, subject: string, body: string) {
    return this.email.sendGenericEmail(to, subject, body).catch(() => undefined);
  }

  // ---- club drill-down ----

  @Get("clubs/:clubId/member-detail/:memberId")
  async memberDetail(@Param("districtId") d: string, @Param("clubId") c: string, @Param("memberId") m: string) {
    paramInt(d, "districtId");
    const [clubId, memberId] = [paramInt(c, "clubId"), paramInt(m, "memberId")];
    const block = await this.clubBlocked(clubId);
    if (block) return block;
    const member = await this.db.queryFirstOrDefault(
      `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${PROFILE_PHOTO} AS profilePhotoPath,
              m.PrimaryMobileNumber AS primaryMobileNumber, m.EmailId AS emailId, m.RotaryId AS rotaryId, m.BloodGroup AS bloodGroup,
              m.Gender AS gender, m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate, m.MemberIntroduction AS memberIntroduction,
              m.Facebook AS facebook, m.Instagram AS instagram, m.LinkedIn AS linkedIn, a.BusinessName AS businessName, a.BusinessEmailId AS businessEmailId,
              cmd.Designation AS designation, cmd.ClassificationProfession AS classificationProfession, a.Address AS businessAddress,
              a.City AS businessCity, a.State AS businessState, a.PinCode AS businessPinCode, a.PhoneNumber AS businessPhone
       FROM member_master_profile m
       LEFT JOIN member_address_details a ON a.fk_member_master_profile_id = m.pk_member_master_profile_id AND a.AddressType = 'Business' AND a.isdeleted = 0
       LEFT JOIN (SELECT fk_member_master_profile_id, MAX(Designation) AS Designation, MAX(ClassificationProfession) AS ClassificationProfession
                  FROM club_members WHERE COALESCE(isdeleted, 0) = 0 GROUP BY fk_member_master_profile_id
                 ) cmd ON cmd.fk_member_master_profile_id = m.pk_member_master_profile_id
       WHERE m.pk_member_master_profile_id = @MemberId AND m.isdeleted = 0
       LIMIT 1`,
      { MemberId: memberId },
    );
    if (!member) return notFound({ message: "Member not found" });
    if (!Brand.feature("member.bloodGroup")) member.bloodGroup = null;
    return ok(member);
  }

  private static readonly CLUB_SERVICE_RULE = `
    AND (@ModuleKey = 'club_service' OR mm.ModuleKey IS NULL OR mm.ModuleKey != 'club_service')
    AND (@ModuleKey IS NULL OR @ModuleKey = 'all' OR mm.ModuleKey = @ModuleKey)`;

  @Get("clubs/:clubId/projects-view")
  async projectsView(@Param("districtId") d: string, @Param("clubId") c: string, @Query("yearId") y?: string, @Query("moduleKey") moduleKey?: string) {
    paramInt(d, "districtId");
    const clubId = paramInt(c, "clubId");
    const yearId = queryInt(y);
    const block = await this.clubBlocked(clubId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const tables = yearId !== null ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t) => t !== null) : await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok([]);
      const legs = tables.map((t) => {
        const suffix = t.yearLabel.replace(/-/g, "_");
        return `SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, p.title, p.description, p.location, p.project_date AS projectDate,
                       p.project_cost AS projectCost, p.Currency AS currency, p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours,
                       p.rotarians_involved AS rotariansInvolved, p.fk_module_id AS moduleId, mm.ModuleName AS moduleName, mm.ModuleKey AS moduleKey,
                       p.fk_area_of_focus_id AS areaOfFocusId, af.name AS areaOfFocusName, p.other_area_of_focus AS otherAreaOfFocus,
                       p.fk_category_id AS categoryId, p.fk_sub_category_id AS subCategoryId,
                       (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                                '/', rpp.image_path)
                          FROM \`${t.photosTable}\` rpp WHERE rpp.fk_project_id = p.pk_project_id
                          ORDER BY rpp.is_primary DESC, rpp.sort_order LIMIT 1) AS primaryPhoto
                FROM \`${t.projectsTable}\` p
                LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                WHERE p.fk_club_id = @ClubId AND p.is_active = 1 AND p.isdeleted = 0 ${DistrictPeopleController.CLUB_SERVICE_RULE}`;
      });
      const rows = await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY u.projectDate DESC`, { ClubId: clubId, ModuleKey: queryString(moduleKey) });
      for (const r of rows) r.currency = r.currency ?? resolveDefaultCurrency(null);
      return ok(rows);
    });
  }

  @Get("clubs/:clubId/projects-view/available-years")
  async projectsViewYears(@Param("districtId") d: string, @Param("clubId") c: string, @Query("moduleKey") moduleKey?: string) {
    paramInt(d, "districtId");
    const clubId = paramInt(c, "clubId");
    const block = await this.clubBlocked(clubId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok([]);
      const legs = tables.map(
        (t) => `(SELECT ${t.yearId} AS id, '${t.yearLabel}' AS yearLabel, (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = ${t.yearId}) AS isCurrent
                 FROM \`${t.projectsTable}\` p LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                 WHERE p.fk_club_id = @ClubId AND p.is_active = 1 AND p.isdeleted = 0 ${DistrictPeopleController.CLUB_SERVICE_RULE}
                 LIMIT 1)`,
      );
      return ok(await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY u.yearLabel DESC`, { ClubId: clubId, ModuleKey: queryString(moduleKey) }));
    });
  }

  @Get("clubs/:clubId/info")
  async clubInfo(@Param("districtId") d: string, @Param("clubId") c: string) {
    paramInt(d, "districtId");
    const clubId = paramInt(c, "clubId");
    const block = await this.clubBlocked(clubId);
    if (block) return block;
    const club = await this.db.queryFirstOrDefault(
      `SELECT c.pk_club_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
              CASE WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                   ELSE CONCAT('/uploads/club/', c.ClubLogoPath) END AS clubLogoPath,
              c.ClubWebsite AS clubWebsite, c.MeetingDay AS meetingDay, c.MeetingFromTime AS meetingFromTime, c.MeetingToTime AS meetingToTime,
              c.MeetingAddress AS meetingAddress, c.ClubCharterDate AS clubCharterDate, c.City AS city, c.State AS state, c.Country AS country,
              c.Pincode AS pincode, c.IsActive AS isActive, c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName,
              (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0 AND cm.IsActive = 1 AND cm.TerminationDate IS NULL AND m.isdeleted = 0) AS totalMembers
       FROM club_master c
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0`,
      { ClubId: clubId },
    );
    return club ? ok(club) : notFound({ message: "Club not found" });
  }

  // ---- club monthly reports ----

  @Get("club-monthly-report/years")
  async reportYears(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
           FROM club_monthly_reports r
           INNER JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
           INNER JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
           WHERE r.isdeleted = 0
           UNION
           SELECT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent FROM rotary_year_master y WHERE y.IsCurrent = 1
           ORDER BY id DESC`,
          { DistrictId: districtId },
        ),
      )
    );
  }

  @Get("club-monthly-report/months/:yearId")
  async reportMonths(@Param("districtId") d: string, @Param("yearId") y: string) {
    const [districtId, yearId] = [paramInt(d, "districtId"), paramInt(y, "yearId")];
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const year = await conn.queryFirstOrDefault("SELECT StartDate, EndDate, IsCurrent FROM rotary_year_master WHERE pk_year_id = @YearId", { YearId: yearId });
      if (!year) return ok([]);
      const totalClubs = Number(await conn.executeScalar("SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club'", { DistrictId: districtId }));
      const submissions = new Map(
        (
          await conn.query(
            `SELECT r.ReportMonth AS month, COUNT(DISTINCT r.fk_club_id) AS submittedCount
             FROM club_monthly_reports r
             INNER JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
             WHERE r.fk_year_id = @YearId AND r.isdeleted = 0 AND r.IsUploadedToDistrict = 1
             GROUP BY r.ReportMonth`,
            { DistrictId: districtId, YearId: yearId },
          )
        ).map((r) => [Number(r.month), Number(r.submittedCount)]),
      );
      const [sy, sm] = String(year.StartDate).slice(0, 7).split("-").map(Number);
      const now = new Date();
      const [ey, em] = year.IsCurrent === true || Number(year.IsCurrent) === 1 ? [now.getUTCFullYear(), now.getUTCMonth() + 1] : String(year.EndDate).slice(0, 7).split("-").map(Number);
      const result = [];
      for (let yy = sy, mm = sm; yy < ey || (yy === ey && mm <= em); mm === 12 ? ((mm = 1), yy++) : mm++) {
        const submitted = submissions.get(mm) ?? 0;
        result.push({ month: mm, monthName: monthName(yy, mm), submittedCount: submitted, notSubmittedCount: totalClubs - submitted, totalClubs });
      }
      return ok(result);
    });
  }

  @Get("club-monthly-report/month-detail/:yearId/:month")
  async reportMonthDetail(@Param("districtId") d: string, @Param("yearId") y: string, @Param("month") mo: string) {
    const [districtId, yearId, month] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(mo, "month")];
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const p = { DistrictId: districtId, YearId: yearId, Month: month };
      const ag = `(SELECT m2.MemberName FROM district_ag a JOIN member_master_profile m2 ON m2.pk_member_master_profile_id = a.fk_member_id AND m2.isdeleted = 0
                    WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1 LIMIT 1) AS agName,
                  (SELECT a.fk_member_id FROM district_ag a WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1 LIMIT 1) AS agMemberId`;
      const submitted = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, r.pk_report_id AS reportId,
                r.IsUploadedToDistrict AS isUploadedToDistrict, COALESCE(r.uploaded_to_district_date, r.created_date) AS submittedDate, ${ag}
         FROM club_monthly_reports r
         INNER JOIN club_master c ON c.pk_club_id = r.fk_club_id
         WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
           AND r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0 AND r.IsUploadedToDistrict = 1
         ORDER BY c.ClubName`,
        p,
      );
      const notSubmittedClubs = await conn.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, ${ag}
         FROM club_master c
         WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
           AND c.pk_club_id NOT IN (SELECT r.fk_club_id FROM club_monthly_reports r
                                    WHERE r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0 AND r.IsUploadedToDistrict = 1)
         ORDER BY c.ClubName`,
        p,
      );
      const clubIds = notSubmittedClubs.map((c) => Number(c.clubId));
      const bod: Row[] = clubIds.length
        ? await conn.query(
            `SELECT bd.fk_club_id AS clubId, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, dm.designation_name AS designation
             FROM board_of_directors bd
             INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id AND m.isdeleted = 0
             INNER JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
             WHERE bd.fk_club_id IN @ClubIds AND bd.fk_year_id = @YearId AND bd.isdeleted = 0 AND dm.designation_name IN ('Club President', 'Club Secretary')`,
            { ClubIds: clubIds, YearId: yearId },
          )
        : [];
      const logs: Row[] = clubIds.length
        ? await conn.query(
            `SELECT l1.fk_club_id AS clubId, l1.email_status AS emailStatus, l1.whatsapp_status AS whatsappStatus, l1.sent_date AS sentDate
             FROM district_report_reminder_log l1
             INNER JOIN (SELECT fk_club_id, MAX(id) AS maxId FROM district_report_reminder_log
                         WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND report_month = @Month GROUP BY fk_club_id) l2 ON l1.id = l2.maxId`,
            p,
          )
        : [];
      const notSubmitted = notSubmittedClubs.map((c) => {
        const cid = Number(c.clubId);
        const pres = bod.find((b) => Number(b.clubId) === cid && b.designation === "Club President");
        const sec = bod.find((b) => Number(b.clubId) === cid && b.designation === "Club Secretary");
        const log = logs.find((l) => Number(l.clubId) === cid);
        return {
          clubId: cid, clubName: c.clubName, clubRotaryId: c.clubRotaryId ?? null, agName: c.agName ?? null,
          agMemberId: c.agMemberId === null || c.agMemberId === undefined ? null : Number(c.agMemberId),
          presidentName: pres?.memberName ?? null, presidentMobile: pres?.mobile ?? null, presidentEmail: pres?.email ?? null,
          secretaryName: sec?.memberName ?? null, secretaryMobile: sec?.mobile ?? null, secretaryEmail: sec?.email ?? null,
          lastEmailStatus: log?.emailStatus ?? null, lastWhatsappStatus: log?.whatsappStatus ?? null, lastReminderDate: log?.sentDate ?? null,
        };
      });
      return ok({ submitted, notSubmitted });
    });
  }

  @Post("club-monthly-report/send-reminder/:yearId/:month")
  async sendReminder(@Param("districtId") d: string, @Param("yearId") y: string, @Param("month") mo: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [districtId, yearId, month] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(mo, "month")];
    const sendEmail = bodyField(body, "sendEmail") === true;
    const sendWhatsApp = bodyField(body, "sendWhatsApp") === true;
    const agRaw = bodyField(body, "agMemberId");
    const agMemberId = agRaw === null || agRaw === undefined ? null : Math.trunc(Number(agRaw));
    if (!sendEmail && !sendWhatsApp) return badRequest({ message: "Select at least email or WhatsApp." });
    const bal = await this.credits.getDistrictCreditBalance(districtId);
    if (sendEmail && bal.emailRemaining <= 0) return badRequest({ message: "No email credits available." });
    if (sendWhatsApp && bal.whatsAppRemaining <= 0) return badRequest({ message: "No WhatsApp credits available." });
    const userId = this.userId(u);
    void this.deliverReminders(districtId, yearId, month, sendEmail, sendWhatsApp, agMemberId, userId).catch((e) => this.log.error(`Reminder error: ${(e as Error).message}`));
    return ok({ message: "Reminders are being sent in background. Refresh to check status." });
  }

  private async deliverReminders(districtId: number, yearId: number, month: number, sendEmail: boolean, sendWhatsApp: boolean, agMemberId: number | null, userId: number) {
    await this.db.session(async (conn) => {
      const year = await conn.queryFirstOrDefault("SELECT StartDate, YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId", { YearId: yearId });
      if (!year) return;
      const startYear = Number(String(year.StartDate).slice(0, 4));
      const label = monthName(month >= 7 ? startYear : startYear + 1, month);
      const districtNumber = await this.districtNumber(conn, districtId);
      const clubIds = (
        await conn.query(
          `SELECT c.pk_club_id AS id FROM club_master c
           WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
             AND c.pk_club_id NOT IN (SELECT r.fk_club_id FROM club_monthly_reports r WHERE r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0)
             AND (@AgMemberId IS NULL OR c.pk_club_id IN (SELECT a.fk_club_id FROM district_ag a
                                                          WHERE a.fk_member_id = @AgMemberId AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1))`,
          { DistrictId: districtId, YearId: yearId, Month: month, AgMemberId: agMemberId },
        )
      ).map((r) => Number(r.id));
      if (!clubIds.length) return;
      const recipients = await conn.query(
        `SELECT bd.fk_club_id AS clubId, c.ClubName AS clubName, m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                m.EmailId AS email, m.PrimaryMobileNumber AS mobile, dm.designation_name AS designation
         FROM board_of_directors bd
         INNER JOIN club_master c ON c.pk_club_id = bd.fk_club_id
         INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id AND m.isdeleted = 0
         INNER JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
         WHERE bd.fk_club_id IN @ClubIds AND bd.fk_year_id = @YearId AND bd.isdeleted = 0 AND dm.designation_name IN ('Club President', 'Club Secretary')
         ORDER BY c.ClubName, dm.sort_order`,
        { ClubIds: clubIds, YearId: yearId },
      );
      let emailSent = 0;
      let whatsAppSent = 0;
      for (const r of recipients) {
        let emailStatus = "not_sent";
        let waStatus = "not_sent";
        if (sendEmail && r.email) {
          try {
            await this.email.sendGenericEmail(
              String(r.email),
              `Reminder: Club Monthly Report not submitted - ${label}`,
              `
                <div style='font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#414042;'>
                    <div style='padding:24px;border:1px solid #ccc;'>
                        <p style='font-size:16px;font-style:italic;line-height:28px;'><b>Dear Club leader</b></p>
                        <p style='font-size:14px;font-style:italic;line-height:24px;'>The monthly report of your club for the month of <b>${label}</b> has not been submitted. Please log in using your username and password and click on the <b>Club Monthly Report</b> icon to submit the report.</p>
                        <p style='font-size:14px;font-style:italic;line-height:22px;'><b>District : ${districtNumber}</b><br/><b>Club : ${r.clubName}</b></p>
                        <p style='font-size:14px;font-style:italic;line-height:22px;'>If you are unable to get support, please contact your Asst. Governor.</p>
                        <p style='font-size:14px;font-style:italic;line-height:22px;'>Please note that the Club Monthly Report should be submitted only through the ${Brand.Current.productName} App, not by email or any physical format.</p>
                        <p style='font-size:13px;font-style:italic;line-height:22px;color:#718096;'>(Please ignore this email if the report is already submitted.)</p>
                        <p style='font-size:14px;font-style:italic;line-height:22px;'>Regards,<br/><strong>District Governor</strong></p>
                    </div>
                </div>`,
            );
            emailStatus = "sent";
            emailSent++;
          } catch {
            emailStatus = "failed";
          }
        }
        if (sendWhatsApp && r.mobile) {
          const e164 = await memberE164(conn, Number(r.memberId), r.mobile);
          const sent = e164
            ? await this.whatsApp.sendTemplate(e164, "club_monthly_report", Brand.Current.locale.defaultLanguage, [String(r.memberName), label, districtNumber, String(r.clubName)])
            : false;
          waStatus = sent ? "sent" : "failed";
          if (sent) whatsAppSent++;
        }
        await conn.execute(
          `INSERT INTO district_report_reminder_log (fk_district_id, fk_year_id, report_month, fk_club_id, fk_member_id, member_name, designation, email_status, whatsapp_status, sent_by)
           VALUES (@DistrictId, @YearId, @Month, @ClubId, @MemberId, @MemberName, @Designation, @EmailStatus, @WaStatus, @UserId)`,
          {
            DistrictId: districtId, YearId: yearId, Month: month, ClubId: r.clubId, MemberId: r.memberId, MemberName: r.memberName, Designation: r.designation,
            EmailStatus: emailStatus, WaStatus: waStatus, UserId: userId,
          },
        );
      }
      if (emailSent > 0) await this.credits.deductDistrictWithHistory(districtId, "Email", emailSent, "MonthlyReportReminder", yearId, `Monthly report reminder for ${label}`, userId);
      if (whatsAppSent > 0) await this.credits.deductDistrictWithHistory(districtId, "WhatsApp", whatsAppSent, "MonthlyReportReminder", yearId, `Monthly report WhatsApp reminder for ${label}`, userId);
    });
  }

  // ---- club moderators ----

  @Get("club-moderators")
  async moderators(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT dcm.id, dcm.fk_district_id AS districtId, dcm.fk_member_id AS memberId, dcm.fk_club_id AS clubId, dcm.is_active AS isActive,
                  m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, ${PROFILE_PHOTO} AS profilePhoto,
                  c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
           FROM district_club_moderator dcm
           INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id AND m.isdeleted = 0
           INNER JOIN club_master c ON c.pk_club_id = dcm.fk_club_id AND c.isdeleted = 0
           WHERE dcm.fk_district_id = @DistrictId AND dcm.isdeleted = 0
           ORDER BY m.MemberName, c.ClubName`,
          { DistrictId: districtId },
        ),
      )
    );
  }

  @Get("club-moderators/available-clubs")
  async moderatorAvailableClubs(@Param("districtId") d: string, @Query("excludeModeratorId") ex?: string) {
    const districtId = paramInt(d, "districtId");
    const exclude = queryInt(ex);
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT c.pk_club_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
           FROM club_master c
           WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
             AND c.pk_club_id NOT IN (SELECT fk_club_id FROM district_club_moderator
                                      WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND (@ExcludeMemberId IS NULL OR fk_member_id != @ExcludeMemberId))
           ORDER BY c.ClubName`,
          { DistrictId: districtId, ExcludeMemberId: exclude },
        ),
      )
    );
  }

  @Get("club-moderators/search-members")
  async moderatorSearch(@Param("districtId") d: string, @Query("search") search?: string) {
    const districtId = paramInt(d, "districtId");
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    if (!search || !search.trim() || search.length < 2) return ok([]);
    return ok(
      await this.db.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                ${PROFILE_PHOTO} AS profilePhoto, cm.fk_club_id AS clubId, c.ClubName AS clubName
         FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
         INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         WHERE c.fk_district_id = @DistrictId AND m.isdeleted = 0
           AND (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
           AND m.pk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0)
           AND m.pk_member_master_profile_id NOT IN (SELECT fk_member_id FROM district_club_moderator WHERE fk_district_id = @DistrictId AND isdeleted = 0)
         ORDER BY m.MemberName
         LIMIT 20`,
        { DistrictId: districtId, Search: `%${search}%` },
      ),
    );
  }

  @Get("club-moderators/member-clubs/:memberId")
  async moderatorClubs(@Param("districtId") d: string, @Param("memberId") m: string) {
    const [districtId, memberId] = [paramInt(d, "districtId"), paramInt(m, "memberId")];
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT dcm.id, dcm.fk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
           FROM district_club_moderator dcm INNER JOIN club_master c ON c.pk_club_id = dcm.fk_club_id
           WHERE dcm.fk_district_id = @DistrictId AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0
           ORDER BY c.ClubName`,
          { DistrictId: districtId, MemberId: memberId },
        ),
      )
    );
  }

  /** Activates the member's login if it is not active: a temporary "<prefix>@NNNN" password. Returns it, or null when a login exists. */
  private static async ensureLogin(conn: DbCommands, memberId: number, prefix: string) {
    const exists = Number(await conn.executeScalar("SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0", { Id: memberId }));
    if (exists > 0) return null;
    const tempPassword = `${prefix}@${randomInt(1000, 10000)}`;
    const hash = bcrypt.hashSync(tempPassword, 11);
    const updated = await conn.execute(
      "UPDATE member_credentials SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1 WHERE fk_member_master_profile_id = @Id",
      { Id: memberId, Hash: hash },
    );
    if (updated === 0) await conn.execute("INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES (@Id, @Hash, 1)", { Id: memberId, Hash: hash });
    return tempPassword;
  }

  private static conflictMessage(rows: Row[]) {
    return rows.map((c) => `${c.clubName} (assigned to ${c.memberName})`).join(", ");
  }

  @Post("club-moderators")
  async saveModerator(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const memberId = Math.trunc(Number(bodyField(body, "memberId") ?? 0)) || 0;
    const oldRaw = bodyField(body, "oldMemberId");
    const oldMemberId = oldRaw === null || oldRaw === undefined ? null : Math.trunc(Number(oldRaw));
    const clubIds = bodyIntList(body, "clubIds");
    if (!clubIds.length) return badRequest({ message: "Select at least one club." });
    try {
      await this.roles.checkRoleConflictPublic(memberId, 5);
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const exclude = oldMemberId !== null ? [memberId, oldMemberId] : [memberId];
      const conflicts = await conn.query(
        `SELECT c.ClubName AS clubName, m.MemberName AS memberName
         FROM district_club_moderator dcm
         INNER JOIN club_master c ON c.pk_club_id = dcm.fk_club_id
         INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id
         WHERE dcm.fk_district_id = @DistrictId AND dcm.fk_club_id IN @ClubIds AND dcm.fk_member_id NOT IN @ExcludeMembers AND dcm.isdeleted = 0`,
        { DistrictId: districtId, ClubIds: clubIds, ExcludeMembers: exclude },
      );
      if (conflicts.length) return badRequest({ message: `These clubs already have a moderator: ${DistrictPeopleController.conflictMessage(conflicts)}` });
      const districtNumber = await this.districtNumber(conn, districtId);
      if (oldMemberId !== null && oldMemberId !== memberId) {
        await conn.execute("UPDATE district_club_moderator SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND isdeleted = 0", {
          DistrictId: districtId, MemberId: oldMemberId, UserId: userId,
        });
        await conn.execute(
          "UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @UserId WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 5 AND IsActive = 1 AND isdeleted = 0",
          { MemberId: oldMemberId, UserId: userId },
        );
        const old = await conn.queryFirstOrDefault("SELECT MemberName AS memberName, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: oldMemberId });
        if (old?.email) {
          await this.sendQuietly(String(old.email), `${Brand.Current.shortName} - Club Moderator Role Removed`, removedBody(old.memberName, "Club Moderator", districtNumber, "Club Moderator Role Removed"));
        }
        for (const clubId of clubIds) {
          const reactivated = await conn.execute(
            "UPDATE district_club_moderator SET fk_member_id = @MemberId, isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_club_id = @ClubId AND isdeleted = 1",
            { DistrictId: districtId, MemberId: memberId, ClubId: clubId, UserId: userId },
          );
          if (reactivated === 0) {
            await conn.execute("INSERT INTO district_club_moderator (fk_district_id, fk_member_id, fk_club_id, is_active, created_by) VALUES (@DistrictId, @MemberId, @ClubId, 1, @UserId)", {
              DistrictId: districtId, MemberId: memberId, ClubId: clubId, UserId: userId,
            });
          }
        }
      } else {
        const current = (
          await conn.query("SELECT fk_club_id AS id FROM district_club_moderator WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND isdeleted = 0", {
            DistrictId: districtId, MemberId: memberId,
          })
        ).map((r) => Number(r.id));
        const toAdd = [...new Set(clubIds)].filter((x) => !current.includes(x));
        const toRemove = [...new Set(current)].filter((x) => !clubIds.includes(x));
        if (toRemove.length) {
          await conn.execute(
            "UPDATE district_club_moderator SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_club_id IN @ClubIds AND isdeleted = 0",
            { DistrictId: districtId, MemberId: memberId, ClubIds: toRemove, UserId: userId },
          );
        }
        for (const clubId of toAdd) {
          const p = { DistrictId: districtId, MemberId: memberId, ClubId: clubId, UserId: userId };
          if ((await conn.execute("UPDATE district_club_moderator SET isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_club_id = @ClubId AND isdeleted = 1", p)) > 0) continue;
          if ((await conn.execute("UPDATE district_club_moderator SET fk_member_id = @MemberId, isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_club_id = @ClubId AND isdeleted = 1", p)) > 0) continue;
          await conn.execute("INSERT INTO district_club_moderator (fk_district_id, fk_member_id, fk_club_id, is_active, created_by) VALUES (@DistrictId, @MemberId, @ClubId, 1, @UserId)", p);
        }
      }
      const hasRole = Number(await conn.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 5 AND IsActive = 1 AND isdeleted = 0", { MemberId: memberId }));
      if (hasRole === 0) {
        const reactivated = await conn.execute("UPDATE member_roles SET IsActive = 1, RevokedDate = NULL, RevokedBy = NULL WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 5 AND isdeleted = 0", { MemberId: memberId });
        if (reactivated === 0) {
          await conn.execute("INSERT IGNORE INTO member_roles (fk_member_master_profile_id, fk_role_id, IsActive, created_by, created_date) VALUES (@MemberId, 5, 1, @UserId, NOW())", { MemberId: memberId, UserId: userId });
        }
      }
      const member = await conn.queryFirstOrDefault("SELECT MemberName AS memberName, EmailId AS email, PrimaryMobileNumber AS mobile FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
      const clubNames = (await conn.query("SELECT ClubName AS n FROM club_master WHERE pk_club_id IN @ClubIds ORDER BY ClubName", { ClubIds: clubIds })).map((r) => String(r.n));
      const tempPassword = await DistrictPeopleController.ensureLogin(conn, memberId, "Mod");
      if (member?.email) {
        await this.sendQuietly(
          String(member.email),
          `${Brand.Current.shortName} - Club Moderator Assignment`,
          assignedBody(member.memberName, "Club Moderator", "Club Moderator Assignment", districtNumber, clubNames, member.mobile, tempPassword),
        );
      }
      return ok({ message: "Club moderator saved." });
    });
  }

  @Delete("club-moderators/member/:memberId")
  async deleteModeratorByMember(@Param("districtId") d: string, @Param("memberId") m: string, @User() u: CurrentUser) {
    const [districtId, memberId] = [paramInt(d, "districtId"), paramInt(m, "memberId")];
    return this.db.session(async (conn) => {
      await conn.execute("UPDATE district_club_moderator SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND isdeleted = 0", {
        DistrictId: districtId, MemberId: memberId, UserId: this.userId(u),
      });
      await conn.execute(
        "UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @UserId WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 5 AND IsActive = 1 AND isdeleted = 0",
        { MemberId: memberId, UserId: this.userId(u) },
      );
      const member = await conn.queryFirstOrDefault("SELECT MemberName AS memberName, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
      const districtNumber = await this.districtNumber(conn, districtId);
      if (member?.email) {
        await this.sendQuietly(String(member.email), `${Brand.Current.shortName} - Club Moderator Role Removed`, removedBody(member.memberName, "Club Moderator", districtNumber, "Club Moderator Role Removed"));
      }
      return ok({ message: "Club moderator removed." });
    });
  }

  @Delete("club-moderators/:id")
  async deleteModeratorAssignment(@Param("districtId") d: string, @Param("id") i: string) {
    await this.db.execute("UPDATE district_club_moderator SET isdeleted = 1 WHERE id = @Id AND fk_district_id = @DistrictId", { Id: paramInt(i), DistrictId: paramInt(d, "districtId") });
    return ok({ message: "Club moderator assignment removed." });
  }

  // ---- Assistant Governors ----

  @Get("ag")
  async ags(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT a.id, a.fk_district_id AS districtId, a.fk_member_id AS memberId, a.fk_club_id AS clubId, a.fk_year_id AS yearId, a.is_active AS isActive,
                  m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, ${PROFILE_PHOTO} AS profilePhoto,
                  c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, y.YearLabel AS yearLabel
           FROM district_ag a
           INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
           INNER JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
           LEFT JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
           WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0 AND (@YearId IS NULL OR a.fk_year_id = @YearId)
           ORDER BY m.MemberName, c.ClubName`,
          { DistrictId: districtId, YearId: yearId },
        ),
      )
    );
  }

  @Get("ag/years-with-data")
  async agYears(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
           FROM district_ag a INNER JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
           WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0
           ORDER BY y.IsCurrent DESC, y.pk_year_id DESC`,
          { DistrictId: districtId },
        ),
      )
    );
  }

  @Get("ag/available-clubs")
  async agAvailableClubs(@Param("districtId") d: string, @Query("excludeModeratorId") ex?: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const [exclude, yearId] = [queryInt(ex), queryInt(y)];
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT c.pk_club_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
           FROM club_master c
           WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
             AND c.pk_club_id NOT IN (SELECT fk_club_id FROM district_ag
                                      WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND (@YearId IS NULL OR fk_year_id = @YearId)
                                        AND (@ExcludeMemberId IS NULL OR fk_member_id != @ExcludeMemberId))
           ORDER BY c.ClubName`,
          { DistrictId: districtId, ExcludeMemberId: exclude, YearId: yearId },
        ),
      )
    );
  }

  @Get("ag/search-members")
  async agSearch(@Param("districtId") d: string, @Query("search") search?: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    if (!search || !search.trim() || search.length < 2) return ok([]);
    return ok(
      await this.db.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                ${PROFILE_PHOTO} AS profilePhoto, dm.clubId, dm.clubName,
                CASE
                    WHEN EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = m.pk_member_master_profile_id
                                   AND r.fk_role_id = 3 AND r.IsActive = 1 AND r.isdeleted = 0)
                         THEN 'Is a SuperAdmin — cannot be assigned as AG'
                    WHEN EXISTS (SELECT 1 FROM district_ag da WHERE da.fk_district_id = @DistrictId AND da.fk_member_id = m.pk_member_master_profile_id
                                   AND da.isdeleted = 0 AND (@YearId IS NULL OR da.fk_year_id = @YearId))
                         THEN 'Already assigned as AG for this year'
                    WHEN dm.activeCount = 0 THEN 'No active club membership in this district (membership ended)'
                    ELSE NULL
                END AS ineligibleReason
         FROM (SELECT cm.fk_member_master_profile_id AS mid,
                      MAX(CASE WHEN cm.IsActive = 1 THEN 1 ELSE 0 END) AS activeCount,
                      SUBSTRING_INDEX(GROUP_CONCAT(cm.fk_club_id ORDER BY cm.IsActive DESC, cm.pk_club_member_id DESC), ',', 1) AS clubId,
                      SUBSTRING_INDEX(GROUP_CONCAT(c.ClubName ORDER BY cm.IsActive DESC, cm.pk_club_member_id DESC SEPARATOR '||'), '||', 1) AS clubName
               FROM club_members cm
               JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @DistrictId
               WHERE cm.isdeleted = 0
               GROUP BY cm.fk_member_master_profile_id) dm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = dm.mid AND m.isdeleted = 0
         WHERE (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
         ORDER BY (ineligibleReason IS NULL) DESC, m.MemberName
         LIMIT 30`,
        { DistrictId: districtId, Search: `%${search}%`, YearId: yearId },
      ),
    );
  }

  @Post("ag")
  async saveAg(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const memberId = Math.trunc(Number(bodyField(body, "memberId") ?? 0)) || 0;
    const oldRaw = bodyField(body, "oldMemberId");
    const oldMemberId = oldRaw === null || oldRaw === undefined ? null : Math.trunc(Number(oldRaw));
    const clubIds = bodyIntList(body, "clubIds");
    const yearId = Math.trunc(Number(bodyField(body, "yearId") ?? 0)) || 0;
    if (!clubIds.length) return badRequest({ message: "Select at least one club." });
    if (yearId <= 0) return badRequest({ message: "Year is required." });
    try {
      await this.roles.checkRoleConflictPublic(memberId, 6);
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const districtNumber = await this.districtNumber(conn, districtId);
      if (oldMemberId === null) {
        const already = Number(
          await conn.executeScalar("SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_year_id = @YearId AND isdeleted = 0", {
            DistrictId: districtId, MemberId: memberId, YearId: yearId,
          }),
        );
        if (already > 0) return badRequest({ message: "This member is already an AG for the selected year. Edit their existing assignment instead." });
      }
      const exclude = oldMemberId !== null ? [memberId, oldMemberId] : [memberId];
      const conflicts = await conn.query(
        `SELECT c.ClubName AS clubName, m.MemberName AS memberName
         FROM district_ag a
         INNER JOIN club_master c ON c.pk_club_id = a.fk_club_id
         INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id
         WHERE a.fk_district_id = @DistrictId AND a.fk_club_id IN @ClubIds AND a.fk_year_id = @YearId AND a.fk_member_id NOT IN @ExcludeMembers AND a.isdeleted = 0`,
        { DistrictId: districtId, ClubIds: clubIds, YearId: yearId, ExcludeMembers: exclude },
      );
      if (conflicts.length) return badRequest({ message: `These clubs already have an AG: ${DistrictPeopleController.conflictMessage(conflicts)}` });
      if (oldMemberId !== null && oldMemberId !== memberId) {
        await conn.execute("UPDATE district_ag SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_year_id = @YearId AND isdeleted = 0", {
          DistrictId: districtId, MemberId: oldMemberId, YearId: yearId, UserId: userId,
        });
        const remaining = Number(await conn.executeScalar("SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND isdeleted = 0", { DistrictId: districtId, MemberId: oldMemberId }));
        if (remaining === 0) {
          await conn.execute(
            "UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @UserId WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
            { MemberId: oldMemberId, DistrictId: districtId, UserId: userId },
          );
        }
        const old = await conn.queryFirstOrDefault("SELECT MemberName AS memberName, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: oldMemberId });
        if (old?.email) {
          await this.sendQuietly(String(old.email), `${Brand.Current.shortName} - AG Role Removed`, removedBody(old.memberName, "Assistant Governor (AG)", districtNumber, "Assistant Governor Role Removed"));
        }
        for (const clubId of clubIds) {
          const p = { DistrictId: districtId, MemberId: memberId, ClubId: clubId, YearId: yearId, UserId: userId };
          const reactivated = await conn.execute(
            "UPDATE district_ag SET fk_member_id = @MemberId, isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 1",
            p,
          );
          if (reactivated === 0) await conn.execute("INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, created_by) VALUES (@DistrictId, @MemberId, @ClubId, @YearId, @UserId)", p);
        }
      } else {
        const current = (
          await conn.query("SELECT fk_club_id AS id FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_year_id = @YearId AND isdeleted = 0", {
            DistrictId: districtId, MemberId: memberId, YearId: yearId,
          })
        ).map((r) => Number(r.id));
        const toAdd = [...new Set(clubIds)].filter((x) => !current.includes(x));
        const toRemove = [...new Set(current)].filter((x) => !clubIds.includes(x));
        if (toRemove.length) {
          await conn.execute(
            "UPDATE district_ag SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_club_id IN @ClubIds AND fk_year_id = @YearId AND isdeleted = 0",
            { DistrictId: districtId, MemberId: memberId, ClubIds: toRemove, YearId: yearId, UserId: userId },
          );
          const removedNames = (await conn.query("SELECT ClubName AS n FROM club_master WHERE pk_club_id IN @ClubIds ORDER BY ClubName", { ClubIds: toRemove })).map((r) => String(r.n));
          const ag = await conn.queryFirstOrDefault("SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
          if (ag?.EmailId && String(ag.EmailId).trim()) {
            void this.email
              .sendRoleOrMembershipRemovedEmail(
                String(ag.EmailId), String(ag.MemberName), `AG coverage of ${removedNames.length} club(s)`,
                `Removed clubs: ${removedNames.join(", ")} (District ${districtNumber}). You remain AG for the other clubs assigned to you.`, null,
              )
              .catch(() => undefined);
          }
        }
        for (const clubId of toAdd) {
          const p = { DistrictId: districtId, MemberId: memberId, ClubId: clubId, YearId: yearId, UserId: userId };
          if ((await conn.execute("UPDATE district_ag SET isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 1", p)) > 0) continue;
          if ((await conn.execute("UPDATE district_ag SET fk_member_id = @MemberId, isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 1", p)) > 0) continue;
          await conn.execute("INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, created_by) VALUES (@DistrictId, @MemberId, @ClubId, @YearId, @UserId)", p);
        }
      }
      const p = { MemberId: memberId, DistrictId: districtId, UserId: userId };
      const hasRole = Number(await conn.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0", p));
      if (hasRole === 0) {
        const reactivated = await conn.execute("UPDATE member_roles SET IsActive = 1, RevokedDate = NULL, RevokedBy = NULL WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND isdeleted = 0", p);
        if (reactivated === 0) {
          await conn.execute("INSERT IGNORE INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, IsActive, created_by, created_date) VALUES (@MemberId, 6, @DistrictId, 1, @UserId, NOW())", p);
        }
      }
      const member = await conn.queryFirstOrDefault("SELECT MemberName AS memberName, EmailId AS email, PrimaryMobileNumber AS mobile FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
      const clubNames = (await conn.query("SELECT ClubName AS n FROM club_master WHERE pk_club_id IN @ClubIds ORDER BY ClubName", { ClubIds: clubIds })).map((r) => String(r.n));
      const tempPassword = await DistrictPeopleController.ensureLogin(conn, memberId, "AG");
      if (member?.email) {
        await this.sendQuietly(
          String(member.email),
          `${Brand.Current.shortName} - AG Assignment`,
          assignedBody(member.memberName, "Assistant Governor (AG)", "Assistant Governor (AG) Assignment", districtNumber, clubNames, member.mobile, tempPassword),
        );
      }
      return ok({ message: "AG saved." });
    });
  }

  @Delete("ag/member/:memberId")
  async deleteAg(@Param("districtId") d: string, @Param("memberId") m: string, @User() u: CurrentUser, @Query("yearId") y?: string) {
    const [districtId, memberId] = [paramInt(d, "districtId"), paramInt(m, "memberId")];
    const yearId = queryInt(y);
    return this.db.session(async (conn) => {
      await conn.execute(
        "UPDATE district_ag SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND (@YearId IS NULL OR fk_year_id = @YearId) AND isdeleted = 0",
        { DistrictId: districtId, MemberId: memberId, YearId: yearId, UserId: this.userId(u) },
      );
      const remaining = Number(await conn.executeScalar("SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND isdeleted = 0", { DistrictId: districtId, MemberId: memberId }));
      if (remaining === 0) {
        await conn.execute(
          "UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @UserId WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
          { MemberId: memberId, DistrictId: districtId, UserId: this.userId(u) },
        );
      }
      const member = await conn.queryFirstOrDefault("SELECT MemberName AS memberName, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
      const districtNumber = await this.districtNumber(conn, districtId);
      if (member?.email) {
        await this.sendQuietly(String(member.email), `${Brand.Current.shortName} - AG Role Removed`, removedBody(member.memberName, "Assistant Governor (AG)", districtNumber, "Assistant Governor Role Removed"));
      }
      return ok({ message: "AG removed." });
    });
  }
}

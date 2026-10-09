import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Post, Query, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { Db, type DbCommands } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { bodyField, dbDateTime, paramInt, queryInt } from "../../common/binding";
import { EmailService } from "../../services/email.service";
import { DcAutoGroupService } from "../../services/dc-auto-group.service";
import { BodSubGroupAutoService } from "../../services/bod-sub-group-auto.service";
import { ensureActiveClubAdminRole } from "../../services/club-admin-access.helper";

const ADMIN_ROLE_ID = 2;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string) => (s.length > 500 ? s.slice(0, 500) : s);
const int = (body: unknown, k: string) => Math.trunc(Number(bodyField(body, k) ?? 0)) || 0;
/** new Random().Next(1000, 9999) */
const tempPin = () => 1000 + Math.floor(Math.random() * 8999);

function designationFor(role: unknown): string | null {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "president" ? "Club President" : r === "secretary" ? "Club Secretary" : null;
}

const BOD_MEMBER = (designation: string) => `
            LEFT JOIN (
                SELECT b.fk_club_id, m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                       m.PrimaryMobileNumber AS mobile, m.EmailId AS email
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                WHERE b.fk_year_id = @YearId AND b.isdeleted = 0 AND d.designation_name = '${designation}'
            )`;
const IS_ADMIN = (alias: string) => `CAST(CASE WHEN ${alias}.memberId IS NOT NULL AND EXISTS (
                        SELECT 1 FROM member_roles mr
                        WHERE mr.fk_member_master_profile_id = ${alias}.memberId
                          AND mr.fk_role_id = @AdminRoleId AND mr.fk_club_id = c.pk_club_id
                          AND mr.IsActive = 1 AND mr.isdeleted = 0
                   ) THEN 1 ELSE 0 END AS UNSIGNED)`;

/** Ensure the member can sign in: a temporary password when they have no active credentials. Returns it, or null. */
async function ensureCredentials(conn: DbCommands, memberId: number, designation: string): Promise<string | null> {
  const exists = Number(await conn.executeScalar("SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0", { Id: memberId }));
  if (exists) return null;
  const temp = (designation === "Club President" ? "Pres@" : "Sec@") + tempPin();
  const hash = bcrypt.hashSync(temp, 11);
  const updated = await conn.execute("UPDATE member_credentials SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1 WHERE fk_member_master_profile_id = @Id", { Id: memberId, Hash: hash });
  if (!updated) await conn.execute("INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES (@Id, @Hash, 1)", { Id: memberId, Hash: hash });
  return temp;
}

/** Port of ClubLeadershipController.cs: api/admin/club-leadership (SuperAdmin). */
@Controller("api/admin/club-leadership")
@Authorize()
export class ClubLeadershipController {
  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
    private readonly dcAutoGroups: DcAutoGroupService,
    private readonly bodSubGroups: BodSubGroupAutoService,
  ) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? u.findFirst("nameid") ?? "0", 10) || 0;

  @Get()
  async leadership(@Query("districtId") d: string | undefined, @Query("yearId") y: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const [districtId, yearId] = [queryInt(d, 0), queryInt(y, 0)];
    if (districtId <= 0 || yearId <= 0) return badRequest({ message: "districtId and yearId are required." });
    return ok(
      await this.db.query(
        `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                pres.memberId AS presidentMemberId, pres.memberName AS presidentName,
                pres.mobile AS presidentMobile, pres.email AS presidentEmail,
                ${IS_ADMIN("pres")} AS presidentIsAdmin,
                sec.memberId AS secretaryMemberId, sec.memberName AS secretaryName,
                sec.mobile AS secretaryMobile, sec.email AS secretaryEmail,
                ${IS_ADMIN("sec")} AS secretaryIsAdmin,
                CAST(CASE WHEN c.IsActive = 1 AND c.isdeleted = 0 AND d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0
                          THEN 1 ELSE 0 END AS UNSIGNED) AS chainActive
         FROM club_master c
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         ${BOD_MEMBER("Club President")} pres ON pres.fk_club_id = c.pk_club_id
         ${BOD_MEMBER("Club Secretary")} sec ON sec.fk_club_id = c.pk_club_id
         WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0
         ORDER BY c.ClubName`,
        { DistrictId: districtId, YearId: yearId, AdminRoleId: ADMIN_ROLE_ID },
      ),
    );
  }

  @Get("club-members")
  async clubMembers(@Query("clubId") c: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = queryInt(c, 0);
    if (clubId <= 0) return badRequest({ message: "clubId is required." });
    return ok(
      await this.db.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
         ORDER BY m.MemberName`,
        { ClubId: clubId },
      ),
    );
  }

  @Post()
  async upsert(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const [clubId, yearId, memberId] = [int(body, "clubId"), int(body, "yearId"), int(body, "memberId")];
    if (clubId <= 0 || yearId <= 0 || memberId <= 0) return badRequest({ message: "clubId, yearId and memberId are required." });
    const designationName = designationFor(bodyField(body, "role"));
    if (!designationName) return badRequest({ message: "Role must be 'President' or 'Secretary'." });
    const isMember = Number(
      await this.db.executeScalar("SELECT COUNT(*) FROM club_members WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND IsActive = 1 AND isdeleted = 0", { ClubId: clubId, MemberId: memberId }),
    );
    if (!isMember) return badRequest({ message: "Selected member is not an active member of this club." });
    const designationId = await this.db.executeScalar<number>("SELECT pk_designation_id FROM designation_master WHERE designation_name = @Name", { Name: designationName });
    if (designationId === null || designationId === undefined) return badRequest({ message: `Designation '${designationName}' not found.` });
    const userId = this.userId(u);
    const p = { ClubId: clubId, YearId: yearId, DesignationId: Number(designationId), MemberId: memberId, UserId: userId };
    try {
      const replaced = await this.db.transaction(async (tx) => {
        const replacedIds = (
          await tx.query(
            `SELECT fk_member_master_profile_id AS Id FROM board_of_directors
             WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND fk_designation_id = @DesignationId AND isdeleted = 0 AND fk_member_master_profile_id <> @MemberId`,
            p,
          )
        ).map((r) => Number(r.Id));
        // only one President / Secretary per club per year
        await tx.execute(
          `UPDATE board_of_directors SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW()
           WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND fk_designation_id = @DesignationId AND isdeleted = 0 AND fk_member_master_profile_id <> @MemberId`,
          p,
        );
        for (const id of replacedIds) await this.dcAutoGroups.onBodRemoved(tx, clubId, id, p.DesignationId, yearId);
        const existing = await tx.executeScalar<number>(
          `SELECT pk_board_director_id FROM board_of_directors
           WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND fk_designation_id = @DesignationId AND fk_member_master_profile_id = @MemberId`,
          p,
        );
        if (existing === null || existing === undefined) {
          await tx.execute(
            `INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, fk_designation_id, fk_year_id, SyncSource, isdeleted, created_by)
             VALUES (@ClubId, @MemberId, @DesignationId, @YearId, 'Manual', 0, @UserId)`,
            p,
          );
        } else {
          await tx.execute(
            `UPDATE board_of_directors SET isdeleted = 0, deleted_by = NULL, deleted_date = NULL, SyncSource = 'Manual', modified_by = @UserId, modified_date = NOW()
             WHERE pk_board_director_id = @Id`,
            { Id: existing, UserId: userId },
          );
        }
        await this.dcAutoGroups.onBodAddedOrUpdated(tx, clubId, memberId, p.DesignationId, yearId, userId);
        // BOD sub-group sync (fire-and-forget): once per replaced member, then for the new one, as in RIZones
        for (let i = 0; i < replacedIds.length; i++) this.bodSubGroups.fire(clubId, p.DesignationId, yearId);
        this.bodSubGroups.fire(clubId, p.DesignationId, yearId);
        await ensureActiveClubAdminRole(tx, memberId, clubId, userId);
        await ensureCredentials(tx, memberId, designationName);
        // The replaced members lose Club Admin for this club unless they still hold a Pres/Sec seat this year
        for (const oldId of replacedIds) {
          const still = Number(
            await tx.executeScalar(
              `SELECT COUNT(*) FROM board_of_directors bd
               JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
               WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId AND bd.fk_member_master_profile_id = @OldId AND bd.isdeleted = 0
                 AND d.designation_name IN ('Club President', 'Club Secretary')`,
              { ClubId: clubId, YearId: yearId, OldId: oldId },
            ),
          );
          if (!still) {
            await tx.execute(
              `UPDATE member_roles SET IsActive = 0, isdeleted = 1, RevokedDate = NOW(), RevokedBy = @UserId, modified_by = @UserId, modified_date = NOW()
               WHERE fk_member_master_profile_id = @OldId AND fk_role_id = @AdminRoleId AND fk_club_id = @ClubId AND isdeleted = 0`,
              { OldId: oldId, AdminRoleId: ADMIN_ROLE_ID, ClubId: clubId, UserId: userId },
            );
          }
        }
        return replacedIds.length;
      });
      return ok({ success: true, message: `${designationName} saved.`, replacedMembers: replaced });
    } catch (e) {
      return badRequest({ message: `Failed: ${message(e)}` });
    }
  }

  @Post("schedule-email")
  async scheduleEmail(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const [districtId, yearId] = [int(body, "districtId"), int(body, "yearId")];
    if (districtId <= 0 || yearId <= 0) return badRequest({ message: "districtId and yearId are required." });
    const at = dbDateTime(bodyField(body, "scheduleDateTime"));
    const future = at !== null && Number(await this.db.executeScalar("SELECT @At > NOW() - INTERVAL 1 MINUTE", { At: at })) === 1;
    if (!future) return badRequest({ message: "Schedule date/time must be in the future." });
    const recipients = Number(
      await this.db.executeScalar(
        `SELECT COUNT(*) FROM board_of_directors b
         JOIN club_master c ON c.pk_club_id = b.fk_club_id
         JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
         JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
         WHERE c.fk_district_id = @D AND b.fk_year_id = @Y AND b.isdeleted = 0
           AND d.designation_name IN ('Club President', 'Club Secretary') AND m.EmailId IS NOT NULL AND m.EmailId <> ''`,
        { D: districtId, Y: yearId },
      ),
    );
    if (!recipients) return badRequest({ message: "No Presidents or Secretaries with email found for this district/year." });
    const id = await this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_leadership_email_schedule (fk_district_id, fk_year_id, ScheduleDateTime, Status, TotalRecipients, created_by)
         VALUES (@D, @Y, @Dt, 'Pending', @Total, @Uid)`,
        { D: districtId, Y: yearId, Dt: at, Total: recipients, Uid: this.userId(u) },
      );
      return Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
    });
    return ok({ success: true, scheduleId: id, totalRecipients: recipients });
  }

  @Post("make-admin")
  async makeAdmin(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const [clubId, yearId, districtId, memberId] = [int(body, "clubId"), int(body, "yearId"), int(body, "districtId"), int(body, "memberId")];
    if (clubId <= 0 || yearId <= 0 || districtId <= 0 || memberId <= 0) return badRequest({ message: "clubId, yearId, districtId and memberId are required." });
    const designationName = designationFor(bodyField(body, "role"));
    if (!designationName) return badRequest({ message: "Role must be 'President' or 'Secretary'." });
    return this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email
         FROM member_master_profile m WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0`,
        { Id: memberId },
      );
      if (!member) return badRequest({ message: "Member not found." });
      const email = typeof member.email === "string" ? member.email : "";
      if (!email.trim()) return badRequest({ message: "Member does not have an email address. Cannot send admin email." });
      // No role block: a SuperAdmin, RI Director or Zonal Coordinator can also be made Club Admin.
      const clubName = await conn.executeScalar<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id", { Id: clubId });
      const yearLabel = await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Id", { Id: yearId });
      const userId = this.userId(u);
      await ensureActiveClubAdminRole(conn, memberId, clubId, userId);
      const tempPassword = await ensureCredentials(conn, memberId, designationName);
      // a synthetic "instant" schedule so the log links correctly
      await conn.execute(
        `INSERT INTO club_leadership_email_schedule (fk_district_id, fk_year_id, ScheduleDateTime, Status, TotalRecipients, SentCount, FailedCount, ProcessedDate, created_by)
         VALUES (@D, @Y, NOW(), 'Processing', 1, 0, 0, NOW(), @Uid)`,
        { D: districtId, Y: yearId, Uid: userId },
      );
      const scheduleId = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      await conn.execute(
        `INSERT INTO club_leadership_email_log (fk_schedule_id, fk_district_id, fk_year_id, fk_club_id, fk_member_id, DesignationName, Email, Status)
         VALUES (@S, @D, @Y, @C, @M, @Des, @E, 'Processing')`,
        { S: scheduleId, D: districtId, Y: yearId, C: clubId, M: memberId, Des: designationName, E: email },
      );
      const logId = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      try {
        const warning = await this.email.sendClubAdminAssignmentEmail(email, String(member.memberName ?? ""), (member.mobile as string | null) ?? null, tempPassword, designationName, clubName ?? "", yearLabel ?? "");
        await conn.execute("UPDATE club_leadership_email_log SET Status = 'Sent', SentDate = NOW(), ErrorMessage = @Warn WHERE pk_id = @Id", { Id: logId, Warn: warning });
        await conn.execute("UPDATE club_leadership_email_schedule SET Status = 'Completed', SentCount = 1 WHERE pk_id = @Id", { Id: scheduleId });
        return ok({ success: true, message: `Admin email sent to ${member.memberName}.` });
      } catch (e) {
        await conn.execute("UPDATE club_leadership_email_log SET Status = 'Failed', ErrorMessage = @Err WHERE pk_id = @Id", { Id: logId, Err: clip(message(e)) });
        await conn.execute("UPDATE club_leadership_email_schedule SET Status = 'Failed', FailedCount = 1 WHERE pk_id = @Id", { Id: scheduleId });
        return badRequest({ message: `Email send failed: ${message(e)}` });
      }
    });
  }

  @Delete("schedule/:id")
  async deleteSchedule(@Param("id") i: string, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    if (!this.isSuperAdmin(u)) return forbid();
    if (id <= 0) return badRequest({ message: "Invalid id." });
    const status = await this.db.executeScalar<string>("SELECT Status FROM club_leadership_email_schedule WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
    if (status === null || status === undefined) return notFound({ message: "Schedule not found." });
    if (status.toLowerCase() !== "pending") return badRequest({ message: `Cannot delete — schedule status is '${status}'. Only Pending schedules can be deleted.` });
    await this.db.execute("UPDATE club_leadership_email_schedule SET isdeleted = 1 WHERE pk_id = @Id", { Id: id });
    return ok({ success: true, message: "Schedule deleted." });
  }

  @Get("debug/member-roles")
  async debugMemberRoles(@Query("memberId") m: string | undefined, @Query("clubId") c: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const [memberId, clubId] = [queryInt(m, 0), queryInt(c, 0)];
    const member = await this.db.queryFirstOrDefault("SELECT pk_member_master_profile_id AS id, MemberName AS name, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id", { Id: memberId });
    const allRoles = await this.db.query(
      `SELECT mr.pk_member_role_id AS id, mr.fk_role_id AS roleId, r.RoleName AS roleName, mr.fk_club_id AS clubId, c.ClubName AS clubName,
              mr.IsActive AS isActive, mr.isdeleted AS isDeleted, mr.AssignedDate AS assignedDate, mr.RevokedDate AS revokedDate
       FROM member_roles mr
       LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
       LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
       WHERE mr.fk_member_master_profile_id = @Id
       ORDER BY mr.isdeleted, mr.fk_role_id`,
      { Id: memberId },
    );
    const adminForThisClub = await this.db.queryFirstOrDefault(
      "SELECT pk_member_role_id AS id, IsActive AS isActive, isdeleted AS isDeleted FROM member_roles WHERE fk_member_master_profile_id = @Id AND fk_role_id = 2 AND fk_club_id = @ClubId",
      { Id: memberId, ClubId: clubId },
    );
    return ok({ member, allRoles, adminForThisClub });
  }

  @Get("all-schedules")
  async allSchedules(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(
      await this.db.query(
        `SELECT s.pk_id AS id, s.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, s.fk_year_id AS yearId, y.YearLabel AS yearLabel,
                s.ScheduleDateTime AS scheduleDateTime, s.Status AS status, s.TotalRecipients AS totalRecipients, s.SentCount AS sentCount,
                s.FailedCount AS failedCount, s.ProcessedDate AS processedDate, s.created_date AS createdDate
         FROM club_leadership_email_schedule s
         LEFT JOIN district_master d ON d.pk_district_id = s.fk_district_id
         LEFT JOIN rotary_year_master y ON y.pk_year_id = s.fk_year_id
         WHERE s.isdeleted = 0
         ORDER BY s.ScheduleDateTime DESC`,
      ),
    );
  }

  @Get("schedule-log")
  async scheduleLog(@Query("scheduleId") s: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const scheduleId = queryInt(s, 0);
    if (scheduleId <= 0) return badRequest({ message: "scheduleId is required." });
    return ok(
      await this.db.query(
        `SELECT c.ClubName AS clubName, m.MemberName AS memberName, l.DesignationName AS designation, l.Email AS email,
                l.Status AS status, l.SentDate AS sentDate, l.ErrorMessage AS errorMessage
         FROM club_leadership_email_log l
         JOIN club_master c ON c.pk_club_id = l.fk_club_id
         JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
         WHERE l.fk_schedule_id = @Id
         ORDER BY c.ClubName, l.DesignationName`,
        { Id: scheduleId },
      ),
    );
  }

  @Get("email-status")
  async emailStatus(@Query("districtId") d: string | undefined, @Query("yearId") y: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const p = { D: queryInt(d, 0), Y: queryInt(y, 0) };
    const schedules = await this.db.query(
      `SELECT pk_id AS id, ScheduleDateTime AS scheduleDateTime, Status AS status, TotalRecipients AS totalRecipients, SentCount AS sentCount,
              FailedCount AS failedCount, ProcessedDate AS processedDate, created_date AS createdDate
       FROM club_leadership_email_schedule
       WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
       ORDER BY ScheduleDateTime DESC`,
      p,
    );
    const logs = await this.db.query(
      `SELECT l.fk_schedule_id AS scheduleId, c.ClubName AS clubName, m.MemberName AS memberName, l.DesignationName AS designation,
              l.Email AS email, l.Status AS status, l.SentDate AS sentDate, l.ErrorMessage AS errorMessage
       FROM club_leadership_email_log l
       JOIN club_master c ON c.pk_club_id = l.fk_club_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
       WHERE l.fk_district_id = @D AND l.fk_year_id = @Y
       ORDER BY l.created_date DESC`,
      p,
    );
    return ok({ schedules, logs });
  }
}

/** Port of ClubLeadershipEmailBackgroundService.cs: every 30 s, send the due schedules (5 at a time). */
@Injectable()
export class ClubLeadershipEmailWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("ClubLeadershipEmailBackgroundService");
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
  ) {}

  onApplicationBootstrap() {
    this.log.log("ClubLeadership email background service started.");
    const loop = async () => {
      try {
        await this.processDue();
      } catch (e) {
        this.log.error(`Error in ClubLeadership email background service: ${message(e)}`);
      }
      if (!this.stopped) this.timer = setTimeout(() => void loop(), 30_000);
    };
    void loop();
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async processDue() {
    const due = await this.db.query(
      `SELECT pk_id AS id, fk_district_id AS districtId, fk_year_id AS yearId FROM club_leadership_email_schedule
       WHERE Status = 'Pending' AND ScheduleDateTime <= NOW() AND isdeleted = 0 ORDER BY ScheduleDateTime LIMIT 5`,
    );
    for (const s of due) {
      if (this.stopped) break;
      await this.process(Number(s.id), Number(s.districtId), Number(s.yearId));
    }
  }

  private async process(scheduleId: number, districtId: number, yearId: number) {
    await this.db.session(async (conn) => {
      await conn.execute("UPDATE club_leadership_email_schedule SET Status = 'Processing' WHERE pk_id = @Id", { Id: scheduleId });
      const yearLabel = await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", { Y: yearId });
      const recipients = await conn.query(
        `SELECT b.fk_club_id AS clubId, c.ClubName AS clubName, b.fk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                m.EmailId AS email, d.designation_name AS designation
         FROM board_of_directors b
         JOIN club_master c ON c.pk_club_id = b.fk_club_id
         JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
         JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
         WHERE c.fk_district_id = @D AND b.fk_year_id = @Y AND b.isdeleted = 0
           AND d.designation_name IN ('Club President', 'Club Secretary') AND m.EmailId IS NOT NULL AND m.EmailId <> ''`,
        { D: districtId, Y: yearId },
      );
      let [sent, failed] = [0, 0];
      for (const r of recipients) {
        await conn.execute(
          `INSERT INTO club_leadership_email_log (fk_schedule_id, fk_district_id, fk_year_id, fk_club_id, fk_member_id, DesignationName, Email, Status)
           VALUES (@S, @D, @Y, @C, @M, @Des, @E, 'Processing')`,
          { S: scheduleId, D: districtId, Y: yearId, C: r.clubId, M: r.memberId, Des: r.designation, E: r.email },
        );
        const logId = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
        try {
          const mobile = await conn.executeScalar<string>("SELECT PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @Id", { Id: r.memberId });
          const warning = await this.email.sendClubAdminAssignmentEmail(String(r.email), String(r.memberName ?? ""), mobile ?? null, null, String(r.designation), String(r.clubName ?? ""), yearLabel ?? "");
          await conn.execute("UPDATE club_leadership_email_log SET Status = 'Sent', SentDate = NOW(), ErrorMessage = @Warn WHERE pk_id = @Id", { Id: logId, Warn: warning });
          sent++;
        } catch (e) {
          this.log.error(`Failed to send leadership email to ${r.email}: ${message(e)}`);
          await conn.execute("UPDATE club_leadership_email_log SET Status = 'Failed', ErrorMessage = @Err WHERE pk_id = @Id", { Id: logId, Err: clip(message(e)) });
          failed++;
        }
      }
      await conn.execute("UPDATE club_leadership_email_schedule SET Status = 'Completed', SentCount = @S, FailedCount = @F, ProcessedDate = NOW() WHERE pk_id = @Id", {
        Id: scheduleId, S: sent, F: failed,
      });
    });
  }
}

@Module({ controllers: [ClubLeadershipController], providers: [ClubLeadershipEmailWorker] })
export class ClubLeadershipModule {}

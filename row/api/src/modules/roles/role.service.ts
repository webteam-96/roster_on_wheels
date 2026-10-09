import { Injectable, Logger } from "@nestjs/common";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request } from "express";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { pagedResult } from "../../common/paged";
import { ArgumentException, InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { AuditLogService } from "../../services/audit-log.service";
import { ensureActiveClubAdminRole } from "../../services/club-admin-access.helper";
import { hasActiveGoalRole } from "../../services/goal-login.helper";
import {
  MemberWithRolesDto, RIDirectorClubDto, RIDirectorDto, RIDirectorProfileDto, ZonalCoordinatorDto, ZonalMemberSearchDto, type RoleRequest,
} from "../../dtos/role.dtos";

const scalar = (rows: Row[]) => Number(Object.values(rows[0] ?? {})[0] ?? 0);
const hash = (password: string) => bcrypt.hashSync(password, 11);

/** Eight random capital letters (RoleService.GenerateTempPassword). */
function generateTempPassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 8; i++) s += upper[randomInt(upper.length)];
  return s;
}

/** Fire-and-forget, like Task.Run: errors are logged, never surfaced. */
function background(log: Logger, what: string, work: () => Promise<void>) {
  void work().catch((e) => log.error(`${what}: ${(e as Error).message}`));
}

/** Port of RoleService.cs: admin roles, zonal coordinators, RI Directors and the login they need. */
@Injectable()
export class RoleService {
  private readonly log = new Logger("RoleService");
  private static riCredTableEnsured = false;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly audit: AuditLogService,
  ) {}

  private loginUrl = () => (this.config.get("FrontendUrl") ?? "").replace(/\/+$/, "") + "/login";

  private static memberContact(conn: DbCommands, memberId: number) {
    return conn.queryFirstOrDefault(
      "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
      { MemberId: memberId },
    );
  }

  /**
   * Gives the member a working login: a new temporary password when there is
   * no credentials row or it was deleted, otherwise re-enables it. Returns the
   * temporary password when one was issued.
   */
  private static async ensureCredentials(conn: DbCommands, memberId: number, by: number, insertViaProcedure = false): Promise<string | null> {
    const cred = await conn.queryFirstOrDefault("SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @MemberId", { MemberId: memberId });
    if (!cred) {
      const temp = generateTempPassword();
      if (insertViaProcedure) {
        await conn.executeProcedure("sp_role_create_credentials", { p_MemberId: memberId, p_Hash: hash(temp), p_CreatedBy: by });
      } else {
        await conn.execute(
          `INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
           VALUES (@MemberId, @Hash, 1, 1, @CreatedBy)`,
          { MemberId: memberId, Hash: hash(temp), CreatedBy: by },
        );
      }
      return temp;
    }
    if (Number(cred.isdeleted) === 1) {
      const temp = generateTempPassword();
      await conn.execute(
        `UPDATE member_credentials
         SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
             modified_by = @ModifiedBy, modified_date = NOW()
         WHERE fk_member_master_profile_id = @MemberId`,
        { MemberId: memberId, Hash: hash(temp), ModifiedBy: by },
      );
      return temp;
    }
    if (Number(cred.IsActive) === 0) {
      await conn.execute(
        `UPDATE member_credentials
         SET IsActive = 1, modified_by = @ModifiedBy, modified_date = NOW()
         WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0`,
        { MemberId: memberId, ModifiedBy: by },
      );
    }
    return null;
  }

  /** Emails the member every role they now hold, plus login details. */
  private notifyRoles(member: Row | null, memberId: number, tempPassword: string | null, what: string) {
    if (!member?.EmailId) return;
    const email = String(member.EmailId);
    const name = String(member.MemberName ?? "");
    const mobile = (member.PrimaryMobileNumber as string | null) ?? null;
    background(this.log, `${what} for member ${memberId}`, async () => {
      const rolesHtml = await this.db.session((conn) => this.buildAllRolesHtml(conn, memberId));
      await this.sendRoleAssignmentEmail(email, name, mobile, tempPassword, rolesHtml);
    });
  }

  async assignAdminRole(request: RoleRequest, assignedBy: number) {
    if (!request.clubId) throw new ArgumentException("ClubId is required to assign Admin role.");
    const clubId = request.clubId;
    return this.db.session(async (conn) => {
      const exists = Number(await conn.executeScalar("SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0", { MemberId: request.memberId }));
      if (exists === 0) throw new KeyNotFoundException("Member not found.");
      const alreadyAdmin = Number(
        await conn.executeScalar(
          "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
          { MemberId: request.memberId, ClubId: clubId },
        ),
      );
      if (alreadyAdmin > 0) throw new InvalidOperationException("Member already has an active Admin role in this club.");
      await ensureActiveClubAdminRole(conn, request.memberId, clubId, assignedBy);
      const member = await RoleService.memberContact(conn, request.memberId);
      const temp = await RoleService.ensureCredentials(conn, request.memberId, assignedBy);
      this.notifyRoles(member, request.memberId, temp, "Role assignment email failed");
      return { message: "Admin role assigned successfully." };
    });
  }

  /** Used by goal-setting role assignment: make sure the member can log in and tell them. */
  async ensureLoginAndNotify(memberId: number, assignedBy: number, sendEmail = true): Promise<void> {
    if (memberId <= 0) return;
    await this.db.session(async (conn) => {
      const member = await RoleService.memberContact(conn, memberId);
      if (!member) return;
      const temp = await RoleService.ensureCredentials(conn, memberId, assignedBy);
      if (sendEmail) this.notifyRoles(member, memberId, temp, "Goal-role login/email provisioning failed");
    });
  }

  notifyGoalRoleRemoved(memberId: number, roleLabel: string, scopeContext: string | null): void {
    if (memberId <= 0) return;
    background(this.log, `Goal-role removal email failed for member ${memberId}`, () => this.sendDistrictRoleRemovedEmail(memberId, roleLabel, scopeContext));
  }

  /** No other admin-type role left: the login is switched off. */
  private static async deactivateCredentialsIfNoAdmin(conn: DbCommands, memberId: number, by: number) {
    const hasSuperAdmin = scalar(await conn.callProcedure("sp_role_check_has_superadmin", { p_MemberId: memberId }));
    const hasAnyAdmin = scalar(await conn.callProcedure("sp_role_check_has_any_admin", { p_MemberId: memberId }));
    if (hasSuperAdmin === 0 && hasAnyAdmin === 0) {
      await conn.executeProcedure("sp_role_deactivate_credentials", { p_MemberId: memberId, p_ModifiedBy: by });
    }
  }

  async removeAdminRole(request: RoleRequest, revokedBy: number) {
    if (!request.clubId) throw new ArgumentException("ClubId is required to remove Admin role.");
    const clubId = request.clubId;
    return this.db.session(async (conn) => {
      const rows = await conn.executeProcedure("sp_role_deactivate_admin", { p_MemberId: request.memberId, p_ClubId: clubId, p_RevokedBy: revokedBy });
      if (rows === 0) throw new InvalidOperationException("No active Admin role found for this member in this club.");
      await RoleService.deactivateCredentialsIfNoAdmin(conn, request.memberId, revokedBy);
      background(this.log, `Failed to send club role removed email for member ${request.memberId} club ${clubId}`, () => this.sendClubRoleRemovedEmail(request.memberId, clubId, "Club Admin"));
      return { message: "Admin role removed successfully." };
    });
  }

  private async sendClubRoleRemovedEmail(memberId: number, clubId: number, roleLabel: string) {
    await this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault("SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
      if (!member || !member.EmailId || !String(member.EmailId).trim()) return;
      const club = await conn.queryFirstOrDefault(
        `SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
         FROM club_master c
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE c.pk_club_id = @Id AND c.isdeleted = 0`,
        { Id: clubId },
      );
      const clubName = (club?.clubName as string | null) ?? "the club";
      const cc = await conn.query(
        `SELECT DISTINCT m.EmailId
         FROM member_master_profile m
         JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
         WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND (mr.isdeleted IS NULL OR mr.isdeleted = 0)
           AND m.pk_member_master_profile_id <> @MemberId
           AND m.EmailId IS NOT NULL AND m.EmailId <> ''
         UNION
         SELECT DISTINCT m.EmailId
         FROM board_of_directors bod
         JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
         JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
         WHERE bod.fk_club_id = @ClubId AND bod.fk_designation_id IN (1, 4) AND bod.isdeleted = 0
           AND m.pk_member_master_profile_id <> @MemberId
           AND m.EmailId IS NOT NULL AND m.EmailId <> ''`,
        { ClubId: clubId, MemberId: memberId },
      );
      const parts = [clubName];
      if (club?.districtNumber && String(club.districtNumber).trim()) parts.push(`District ${club.districtNumber}`);
      if (club?.zoneName && String(club.zoneName).trim()) parts.push(`Zone ${club.zoneName}`);
      const seen = new Set<string>();
      const ccList = cc.map((r) => String(r.EmailId)).filter((e) => !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
      await this.email.sendRoleOrMembershipRemovedEmail(String(member.EmailId), String(member.MemberName), `${roleLabel} role at ${clubName}`, parts.join(" — "), ccList);
    });
  }

  private async sendDistrictRoleRemovedEmail(memberId: number, roleLabel: string, scopeContext: string | null) {
    const member = await this.db.queryFirstOrDefault("SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
    if (!member || !member.EmailId || !String(member.EmailId).trim()) return;
    await this.email.sendRoleOrMembershipRemovedEmail(String(member.EmailId), String(member.MemberName), roleLabel, scopeContext, null);
  }

  async getMemberRoles(memberId: number): Promise<string[]> {
    return (await this.db.callProcedure("sp_role_get_active_roles", { p_MemberId: memberId })).map((r) => String(Object.values(r)[0]));
  }

  async getAllMembersWithRoles(page: number, pageSize: number, search: string | null) {
    const s = search && search.trim() ? search : null;
    return this.db.session(async (conn) => {
      const totalCount = scalar(await conn.callProcedure("sp_role_get_members_count", { p_Search: s }));
      const raw = await conn.callProcedure("sp_role_get_members_paginated", { p_Search: s, p_PageSize: pageSize, p_Offset: (page - 1) * pageSize });
      const items = raw.map((row) =>
        MemberWithRolesDto.create({
          Id: Number(row.Id),
          MemberName: row.MemberName ?? "",
          EmailId: row.EmailId ?? "",
          PrimaryMobileNumber: row.PrimaryMobileNumber ?? "",
          Roles: row.RoleNames ? String(row.RoleNames).split(",") : [],
          HasAdminRole: Number(row.HasAdminRole ?? 0) === 1,
          HasCredentials: Number(row.HasCredentials ?? 0) === 1,
        }),
      );
      const ids = items.map((i) => i.id as number);
      if (ids.length) {
        const clubRows = await conn.query(
          `SELECT cm.fk_member_master_profile_id AS MemberId,
                  GROUP_CONCAT(DISTINCT c.ClubName ORDER BY c.ClubName SEPARATOR ', ') AS ClubNames,
                  GROUP_CONCAT(DISTINCT d.DistrictNumber ORDER BY d.DistrictNumber SEPARATOR ', ') AS DistrictNumbers
           FROM club_members cm
           JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND COALESCE(c.isdeleted, 0) = 0
           LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id AND COALESCE(d.isdeleted, 0) = 0
           WHERE cm.fk_member_master_profile_id IN @Ids
             AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0
           GROUP BY cm.fk_member_master_profile_id`,
          { Ids: ids },
        );
        const byMember = new Map(clubRows.map((r) => [Number(r.MemberId), r]));
        for (const it of items) {
          const cd = byMember.get(it.id as number);
          if (cd) {
            it.clubName = cd.ClubNames ?? null;
            it.districtNumber = cd.DistrictNumbers ?? null;
          }
        }
      }
      return pagedResult(items, totalCount, page, pageSize);
    });
  }

  async getZonalCoordinator(zoneId: number) {
    return ZonalCoordinatorDto.map((await this.db.callProcedure("sp_zonal_coordinator_get_by_zone", { p_ZoneId: zoneId }))[0] ?? null);
  }

  async assignZonalCoordinator(memberId: number, zoneId: number, assignedBy: number) {
    return this.db.session(async (conn) => {
      if (scalar(await conn.callProcedure("sp_role_check_member_exists", { p_MemberId: memberId })) === 0) throw new KeyNotFoundException("Member not found.");
      await conn.transaction(async (tx) => {
        await tx.execute(
          `UPDATE member_roles
           SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @AssignedBy
           WHERE fk_role_id = 4 AND fk_zone_id = @ZoneId AND IsActive = 1 AND isdeleted = 0`,
          { ZoneId: zoneId, AssignedBy: assignedBy },
        );
        await tx.execute(
          `INSERT INTO member_roles
               (fk_member_master_profile_id, fk_role_id, fk_zone_id, AssignedBy, AssignedDate, IsActive, isdeleted)
           VALUES (@MemberId, 4, @ZoneId, @AssignedBy, NOW(), 1, 0)`,
          { MemberId: memberId, ZoneId: zoneId, AssignedBy: assignedBy },
        );
      });
      const member = await RoleService.memberContact(conn, memberId);
      const temp = await RoleService.ensureCredentials(conn, memberId, assignedBy, true);
      this.notifyRoles(member, memberId, temp, "Role assignment email failed");
      return { message: "Zonal Coordinator assigned successfully." };
    });
  }

  async removeZonalCoordinator(zoneId: number, revokedBy: number) {
    return this.db.session(async (conn) => {
      const coordinator = (await conn.callProcedure("sp_zonal_coordinator_get_by_zone", { p_ZoneId: zoneId }))[0];
      await conn.executeProcedure("sp_zonal_coordinator_remove", { p_ZoneId: zoneId, p_RevokedBy: revokedBy });
      if (coordinator) {
        const memberId = Number(coordinator.MemberId);
        await RoleService.deactivateCredentialsIfNoAdmin(conn, memberId, revokedBy);
        const zoneName = await conn.executeScalar<string>("SELECT ZoneName FROM zone_master WHERE pk_zone_id = @Id", { Id: zoneId });
        const scope = zoneName && zoneName.trim() ? `Zone ${zoneName}` : null;
        background(this.log, `Failed to send district role removed email for member ${memberId}`, () => this.sendDistrictRoleRemovedEmail(memberId, "Zonal Coordinator role", scope));
      }
      return { message: "Zonal Coordinator removed successfully." };
    });
  }

  async searchZoneMembers(zoneId: number, search: string | null) {
    return ZonalMemberSearchDto.mapAll(
      await this.db.query(
        `SELECT m.pk_member_master_profile_id            AS MemberId,
                m.MemberName                             AS MemberName,
                COALESCE(MAX(m.EmailId), '')             AS Email,
                MAX(c.ClubName)                          AS ClubName,
                MAX(d.DistrictNumber)                    AS DistrictNumber
         FROM club_members cm
         JOIN club_master c            ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
         JOIN district_master d        ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
         JOIN member_master_profile m  ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE d.fk_zone_id = @ZoneId
           AND cm.isdeleted = 0 AND cm.IsActive = 1 AND cm.TerminationDate IS NULL
           AND (@Search = ''
                OR m.MemberName LIKE CONCAT('%', @Search, '%')
                OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%')
                OR m.EmailId LIKE CONCAT('%', @Search, '%'))
         GROUP BY m.pk_member_master_profile_id, m.MemberName
         ORDER BY m.MemberName
         LIMIT 50`,
        { ZoneId: zoneId, Search: (search ?? "").trim() },
      ),
    );
  }

  /** An HTML table of every active role (and goal-setting role) the member holds. */
  private async buildAllRolesHtml(conn: DbCommands, memberId: number): Promise<string> {
    const roles = await conn.query(
      `SELECT r.fk_role_id AS RoleId,
              CASE r.fk_role_id
                  WHEN 2 THEN 'Club Admin'
                  WHEN 3 THEN 'Super Admin'
                  WHEN 4 THEN 'Zonal Coordinator'
                  WHEN 5 THEN 'AG'
                  WHEN 6 THEN 'Moderator'
                  WHEN 7 THEN 'District Admin'
                  ELSE 'Member'
              END AS RoleName,
              c.ClubName,
              d.DistrictNumber,
              z.ZoneName
       FROM member_roles r
       LEFT JOIN club_master c ON r.fk_club_id = c.pk_club_id
       LEFT JOIN district_master d ON c.fk_district_id = d.pk_district_id
       LEFT JOIN zone_master z ON r.fk_zone_id = z.pk_zone_id
       WHERE r.fk_member_master_profile_id = @MemberId AND r.IsActive = 1
       ORDER BY r.fk_role_id`,
      { MemberId: memberId },
    );
    const cell = "padding: 8px 12px; border: 1px solid #ddd;";
    let html =
      "<table style='border-collapse: collapse; width: 100%; margin: 12px 0;'>" +
      "<tr style='background-color: #17458F; color: white;'>" +
      `<th style='${cell.replace("border", "text-align: left; border")}'>Role</th>` +
      `<th style='${cell.replace("border", "text-align: left; border")}'>Details</th>` +
      "</tr>";
    const row = (name: string, details: string) => `<tr><td style='${cell} font-weight: bold;'>${name}</td><td style='${cell}'>${details}</td></tr>`;
    for (const r of roles) {
      const roleId = Number(r.RoleId);
      const district = (r.DistrictNumber as string | null) ?? "";
      const club = (r.ClubName as string | null) ?? "";
      let details = "";
      if (roleId === 2) details = `District ${district} - ${club}`;
      else if (roleId === 3) details = "All Districts & Clubs";
      else if (roleId === 4) details = (r.ZoneName as string | null) ?? "";
      else if (roleId === 5) details = `District ${district}`;
      else if (roleId === 6) details = club ? `District ${district} - ${club}` : `District ${district}`;
      else if (roleId === 7) details = `District ${district}`;
      html += row(String(r.RoleName), details);
    }
    const goalRoles = await conn.query(
      `SELECT a.RoleTitle, a.Avenue, a.RoleType, z.ZoneName AS SingleZone,
              (SELECT GROUP_CONCAT(DISTINCT zm.ZoneName ORDER BY zm.ZoneName SEPARATOR ', ')
                 FROM goal_role_assignment_zones raz JOIN zone_master zm ON zm.pk_zone_id = raz.fk_zone_id
                 WHERE raz.fk_assignment_id = a.pk_id) AS Zones,
              (SELECT GROUP_CONCAT(DISTINCT dm.DistrictNumber ORDER BY dm.DistrictNumber SEPARATOR ', ')
                 FROM goal_role_assignment_districts rad JOIN district_master dm ON dm.pk_district_id = rad.fk_district_id
                 WHERE rad.fk_assignment_id = a.pk_id) AS Districts
       FROM goal_role_assignments a
       LEFT JOIN zone_master z ON z.pk_zone_id = a.fk_zone_id
       WHERE a.fk_member_id = @MemberId AND a.IsActive = 1 AND a.isdeleted = 0
       ORDER BY a.pk_id`,
      { MemberId: memberId },
    );
    for (const g of goalRoles) {
      const title = (g.RoleTitle as string | null) ?? "Goal Setting Role";
      const roleType = (g.RoleType as string | null) ?? "";
      const avenue = g.Avenue as string | null;
      let details: string;
      if (roleType === "AllCategoryAllDistrictsFewZones") details = "Zones: " + ((g.Zones as string | null) ?? "-");
      else if (roleType === "FewDistrictsOneCategoryOneZone") {
        const dz = (g.SingleZone as string | null) ?? "";
        const dd = g.Districts as string | null;
        details = dd ? `${dz} · Districts: ${dd}` : dz;
      } else details = (g.SingleZone as string | null) ?? "";
      if (avenue && avenue !== "RI Director") details = details ? `${avenue} · ${details}` : avenue;
      html += row(`${title} (Goal Setting)`, details);
    }
    return html + "</table>";
  }

  /** Login details for a goal-setting role holder (RI Director / Regional Leader / Assistant Regional Leader). */
  async sendGoalRoleCredentialsEmail(memberId: number, roleType: string, assignedBy: number): Promise<void> {
    if (memberId <= 0) return;
    await this.db.session(async (conn) => {
      const member = await RoleService.memberContact(conn, memberId);
      if (!member) return;
      const email = member.EmailId as string | null;
      if (!email || !email.trim()) return;
      const temp = await RoleService.ensureCredentials(conn, memberId, assignedBy);
      const { subject, body } = this.buildGoalRoleEmail(roleType, String(member.MemberName), email, (member.PrimaryMobileNumber as string | null) ?? null, temp);
      try {
        await this.email.sendGenericEmail(email, subject, body);
      } catch (e) {
        this.log.error(`Goal-role email failed for member ${memberId}: ${(e as Error).message}`);
      }
    });
  }

  private buildGoalRoleEmail(roleType: string, memberName: string, email: string, mobile: string | null, tempPassword: string | null) {
    const loginUrl = this.loginUrl();
    const site = Brand.Current.productName;
    const [greeting, accessLine, subject] =
      roleType === "AllCategoryAllDistrictsFewZones"
        ? [`Dear RI Director ${memberName},`, "Your administrative access to the zonal report has been enabled.", `${site} — RI Director access enabled`]
        : roleType === "AllDistrictsOneCategoryOneZone"
          ? [`Dear Regional Leader ${memberName},`, "Your administrative access to the Zonal Report portal has been enabled.", `${site} — Regional Leader access enabled`]
          : [`Dear Assistant Regional Leader ${memberName},`, "Your administrative access to the assigned District Report has been enabled.", `${site} — Assistant Regional Leader access enabled`];
    const passwordLine = tempPassword !== null
      ? `<p style='margin:4px 0;'><strong>Password:</strong> ${tempPassword}</p>`
      : "<p style='margin:4px 0;'><strong>Password:</strong> Please use your existing password.</p>";
    const body = `${emailHeader()}
                    <p>${greeting}</p>
                    <p>${accessLine}</p>
                    <p>Please log in to view your report:</p>
                    <div style='background-color:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>
                        <p style='margin:4px 0;'><strong>Link:</strong> <a href='${loginUrl}' style='color:#3182ce;'>${loginUrl}</a></p>
                        ${mobile && mobile.trim() ? `<p style='margin:4px 0;'><strong>User name (mobile):</strong> ${mobile}</p>` : ""}
                        <p style='margin:4px 0;'><strong>User name (email):</strong> ${email}</p>
                        ${passwordLine}
                    </div>
                    ${tempPassword !== null ? "<p style='color:#e53e3e;'><strong>Note:</strong> You will be asked to set your own password the first time you log in.</p>" : ""}
                    <div style='text-align:center;margin:24px 0;'>
                        <a href='${loginUrl}' style='background-color:#3182ce;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;'>Login Now</a>
                    </div>
                    <p style='margin-top:20px;'>Regards,<br/>${site}</p>
            ${emailFooter()}`;
    return { subject, body };
  }

  private credentialsBlock(email: string, mobile: string | null, tempPassword: string | null) {
    const loginUrl = this.loginUrl();
    return tempPassword !== null
      ? `<div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <p><strong>Login URL:</strong> <a href='${loginUrl}' style='color: #3182ce;'>${loginUrl}</a></p>
                    ${mobile && mobile.trim() ? `<p><strong>Username (Mobile):</strong> ${mobile}</p>` : ""}
                    <p><strong>Username (Email):</strong> ${email}</p>
                    <p><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <p style='color: #e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>`
      : `<div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <p><strong>Login URL:</strong> <a href='${loginUrl}' style='color: #3182ce;'>${loginUrl}</a></p>
                    <p>Please use your existing credentials to login.</p>
                </div>`;
  }

  private loginButton() {
    return `<div style='text-align: center; margin: 24px 0;'>
                        <a href='${this.loginUrl()}' style='background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;'>Login Now</a>
                    </div>`;
  }

  private async sendRoleAssignmentEmail(email: string, memberName: string, mobile: string | null, tempPassword: string | null, rolesHtml: string) {
    const body = `${emailHeader()}
                    <h2 style='color: #1a365d; margin-top: 0;'>Role Assignment Notification</h2>
                    <p>Dear ${memberName},</p>
                    <p>You have been assigned the following role(s) on the ${Brand.Current.productName} Admin Portal:</p>
                    ${rolesHtml}
                    ${this.credentialsBlock(email, mobile, tempPassword)}
                    ${this.loginButton()}
            ${emailFooter()}`;
    await this.email.sendGenericEmail(email, `${Brand.Current.shortName} - Your Role Assignment`, body);
  }

  /** Role conflicts are not checked: any combination of roles is allowed. */
  async checkRoleConflictPublic(_memberId: number, _newRoleId: number): Promise<void> {}

  async getRIDirectorProfile(memberId: number) {
    return this.db.session(async (conn) => {
      const profile = RIDirectorProfileDto.map(
        await conn.queryFirstOrDefault(
          `SELECT m.pk_member_master_profile_id AS MemberId,
                  m.MemberName AS MemberName,
                  m.EmailId AS Email,
                  m.PrimaryMobileNumber AS Mobile,
                  (SELECT a.City FROM member_address_details a
                    WHERE a.fk_member_master_profile_id = m.pk_member_master_profile_id AND a.isdeleted = 0
                    ORDER BY a.AddressType = 'Residence' DESC, a.pk_member_address_details_id LIMIT 1) AS City,
                  (SELECT a.State FROM member_address_details a
                    WHERE a.fk_member_master_profile_id = m.pk_member_master_profile_id AND a.isdeleted = 0
                    ORDER BY a.AddressType = 'Residence' DESC, a.pk_member_address_details_id LIMIT 1) AS State,
                  m.RotaryId AS RotaryId,
                  CASE
                      WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                      WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                      ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                  END AS PhotoPath,
                  (SELECT MIN(mr.created_date) FROM member_roles mr
                    WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0) AS AssignedDate
           FROM member_master_profile m
           WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0`,
          { Id: memberId },
        ),
      );
      if (!profile) return null;
      profile.clubs = RIDirectorClubDto.mapAll(
        await conn.query(
          `SELECT c.pk_club_id AS ClubId,
                  c.ClubName AS ClubName,
                  d.DistrictNumber AS DistrictNumber,
                  z.ZoneName AS ZoneName,
                  COALESCE(cm.IsHonoraryMember, 0) AS IsHonorary,
                  (SELECT dg.designation_name
                     FROM board_of_directors bod
                     JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
                    WHERE bod.fk_member_master_profile_id = cm.fk_member_master_profile_id
                      AND bod.fk_club_id = c.pk_club_id AND bod.isdeleted = 0
                    ORDER BY bod.fk_year_id DESC, dg.sort_order LIMIT 1) AS Designation,
                  (SELECT COUNT(*) FROM member_roles mr
                    WHERE mr.fk_member_master_profile_id = cm.fk_member_master_profile_id
                      AND mr.fk_role_id = 2 AND mr.fk_club_id = c.pk_club_id
                      AND mr.IsActive = 1 AND mr.isdeleted = 0) > 0 AS IsClubAdmin
           FROM club_members cm
           JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
           LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
           LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
           WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
           ORDER BY c.ClubName`,
          { Id: memberId },
        ),
      );
      profile.adminDistricts = (
        await conn.query(
          `SELECT DISTINCT d.DistrictNumber
           FROM member_roles mr
           JOIN district_master d ON d.pk_district_id = mr.fk_district_id AND d.isdeleted = 0
           WHERE mr.fk_member_master_profile_id = @Id AND mr.fk_role_id = 2
             AND mr.fk_district_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0
           ORDER BY d.DistrictNumber`,
          { Id: memberId },
        )
      ).map((r) => String(r.DistrictNumber));
      profile.otherRoles = (
        await conn.query(
          `SELECT DISTINCT CASE mr.fk_role_id
                   WHEN 1 THEN 'Member' WHEN 2 THEN CASE WHEN mr.fk_district_id > 0 THEN 'District Admin' ELSE 'Club Admin' END
                   WHEN 3 THEN 'SuperAdmin' WHEN 4 THEN 'Zonal Coordinator' WHEN 5 THEN 'Club Moderator'
                   WHEN 6 THEN 'AG' WHEN 7 THEN 'RI Director' ELSE CONCAT('Role ', mr.fk_role_id) END AS RoleLabel
           FROM member_roles mr
           WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0
             AND mr.fk_role_id <> 7`,
          { Id: memberId },
        )
      ).map((r) => String(r.RoleLabel));
      return profile;
    });
  }

  async getRIDirectors() {
    return this.db.session(async (conn) => {
      await RoleService.ensureRiDirectorCredentialEmailTable(conn);
      return RIDirectorDto.mapAll(
        await conn.query(
          `SELECT m.pk_member_master_profile_id AS MemberId,
                  m.MemberName AS MemberName,
                  m.EmailId AS Email,
                  m.PrimaryMobileNumber AS Mobile,
                  mr.created_date AS AssignedDate,
                  COALESCE(ce.SentCount, 0) AS EmailSentCount,
                  ce.LastSentDate AS EmailLastSentDate
           FROM member_roles mr
           JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
           LEFT JOIN ri_director_credential_email ce ON ce.fk_member_id = m.pk_member_master_profile_id
           WHERE mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0
             AND m.isdeleted = 0
           ORDER BY m.MemberName`,
        ),
      );
    });
  }

  /** Assigning does not email: the login is sent later with "Send Email". */
  async assignRIDirector(memberId: number, assignedBy: number, req: Request | null) {
    return this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault(
        `SELECT pk_member_master_profile_id AS Id, MemberName, EmailId, PrimaryMobileNumber
         FROM member_master_profile
         WHERE pk_member_master_profile_id = @Id AND isdeleted = 0`,
        { Id: memberId },
      );
      if (!member) throw new KeyNotFoundException("Member not found.");
      const alreadyActive = Number(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM member_roles
           WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 7
             AND IsActive = 1 AND isdeleted = 0`,
          { MemberId: memberId },
        ),
      );
      if (alreadyActive > 0) throw new InvalidOperationException("Member is already an active RI Director.");
      await conn.execute(
        `INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, IsActive, created_by)
         VALUES (@MemberId, 7, 1, @AssignedBy)`,
        { MemberId: memberId, AssignedBy: assignedBy },
      );
      const issuesPassword = (await RoleService.ensureCredentials(conn, memberId, assignedBy)) !== null;
      await RoleService.ensureRiDirectorCredentialEmailTable(conn);
      await conn.execute(
        `INSERT INTO ri_director_credential_email (fk_member_id, IssuesPassword, SentCount, created_by)
         VALUES (@Id, @Issues, 0, @By)
         ON DUPLICATE KEY UPDATE IssuesPassword = VALUES(IssuesPassword), SentCount = 0,
             LastSentDate = NULL, LastSentBy = NULL, modified_by = @By, modified_date = NOW()`,
        { Id: memberId, Issues: issuesPassword ? 1 : 0, By: assignedBy },
      );
      await this.audit.log(assignedBy, "ASSIGN_ROLE", "ri_director", memberId, (member.MemberName as string | null) ?? null, { role: "RIDirector", targetMemberId: memberId }, req);
      return { message: "RI Director role assigned. Login details were not emailed — use Send Email on the list when the director asks for them." };
    });
  }

  /** Creates ri_director_credential_email on first use and backfills it for existing directors. */
  private static async ensureRiDirectorCredentialEmailTable(conn: DbCommands) {
    if (RoleService.riCredTableEnsured) return;
    const exists = Number(
      await conn.executeScalar(
        `SELECT COUNT(*) FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ri_director_credential_email'`,
      ),
    );
    if (exists === 0) {
      await conn.execute(
        `CREATE TABLE IF NOT EXISTS ri_director_credential_email (
             pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
             fk_member_id INT NOT NULL,
             IssuesPassword TINYINT(1) NOT NULL DEFAULT 0,
             SentCount INT NOT NULL DEFAULT 0,
             LastSentDate DATETIME NULL,
             LastSentBy INT NULL,
             created_by INT NULL,
             created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
             modified_by INT NULL,
             modified_date DATETIME NULL,
             UNIQUE KEY uk_ri_cred_member (fk_member_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      await conn.execute(
        `INSERT IGNORE INTO ri_director_credential_email (fk_member_id, IssuesPassword, SentCount, LastSentDate)
         SELECT mr.fk_member_master_profile_id,
                CASE WHEN mc.fk_member_master_profile_id IS NULL OR mc.IsTemporaryPassword = 1 THEN 1 ELSE 0 END,
                1, MAX(mr.created_date)
         FROM member_roles mr
         LEFT JOIN member_credentials mc ON mc.fk_member_master_profile_id = mr.fk_member_master_profile_id
         WHERE mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0
         GROUP BY mr.fk_member_master_profile_id, mc.fk_member_master_profile_id, mc.IsTemporaryPassword`,
      );
    }
    RoleService.riCredTableEnsured = true;
  }

  async sendRIDirectorCredentials(memberId: number, sentBy: number, req: Request | null) {
    return this.db.session(async (conn) => {
      await RoleService.ensureRiDirectorCredentialEmailTable(conn);
      const member = await conn.queryFirstOrDefault(
        `SELECT m.MemberName, m.EmailId, m.PrimaryMobileNumber
         FROM member_master_profile m
         WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0
           AND EXISTS (SELECT 1 FROM member_roles mr
                       WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                         AND mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0)`,
        { Id: memberId },
      );
      if (!member) throw new KeyNotFoundException("This member is not an active RI Director.");
      const memberEmail = (member.EmailId as string | null)?.trim();
      if (!memberEmail) throw new InvalidOperationException("This RI Director has no email address on the profile. Add one first.");

      const state = await conn.queryFirstOrDefault("SELECT IssuesPassword, SentCount FROM ri_director_credential_email WHERE fk_member_id = @Id", { Id: memberId });
      let issuesPassword = state
        ? Number(state.IssuesPassword) === 1
        : Number(await conn.executeScalar("SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsTemporaryPassword = 1", { Id: memberId })) > 0;
      const isResend = !!state && Number(state.SentCount) > 0;
      const cred = await conn.queryFirstOrDefault("SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @Id", { Id: memberId });
      if (!cred) issuesPassword = true;

      let tempPassword: string | null = null;
      if (issuesPassword) {
        tempPassword = generateTempPassword();
        if (!cred) {
          await conn.execute(
            `INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
             VALUES (@Id, @Hash, 1, 1, @By)`,
            { Id: memberId, Hash: hash(tempPassword), By: sentBy },
          );
        } else {
          await conn.execute(
            `UPDATE member_credentials
             SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                 modified_by = @By, modified_date = NOW()
             WHERE fk_member_master_profile_id = @Id`,
            { Id: memberId, Hash: hash(tempPassword), By: sentBy },
          );
        }
      } else if (Number(cred!.isdeleted) === 1 || Number(cred!.IsActive) === 0) {
        await conn.execute(
          `UPDATE member_credentials SET IsActive = 1, isdeleted = 0, modified_by = @By, modified_date = NOW()
           WHERE fk_member_master_profile_id = @Id`,
          { Id: memberId, By: sentBy },
        );
      }

      const body = `${emailHeader()}
            <h2 style='color: #1a365d; margin-top: 0;'>RI Director Role Assignment</h2>
            <p>Dear ${member.MemberName},</p>
            <p>You have been assigned the <strong>RI Director</strong> role on the ${Brand.Current.productName} Admin Portal.</p>
            ${this.credentialsBlock(memberEmail, (member.PrimaryMobileNumber as string | null) ?? null, tempPassword)}
            ${this.loginButton()}
            ${emailFooter()}`;
      try {
        await this.email.sendGenericEmail(memberEmail, `${Brand.Current.productName} — RI Director Login Details`, body);
      } catch (e) {
        this.log.error(`Failed to send RI Director login email to member ${memberId}: ${(e as Error).message}`);
        throw new InvalidOperationException("The email could not be sent. Please try again.");
      }
      this.log.log(`RI Director login email sent to ${memberEmail} (member ${memberId}, resend=${isResend})`);
      await conn.execute(
        `INSERT INTO ri_director_credential_email (fk_member_id, IssuesPassword, SentCount, LastSentDate, LastSentBy, created_by)
         VALUES (@Id, @Issues, 1, NOW(), @By, @By)
         ON DUPLICATE KEY UPDATE IssuesPassword = VALUES(IssuesPassword), SentCount = SentCount + 1,
             LastSentDate = NOW(), LastSentBy = @By, modified_by = @By, modified_date = NOW()`,
        { Id: memberId, Issues: issuesPassword ? 1 : 0, By: sentBy },
      );
      await this.audit.log(
        sentBy, isResend ? "RESEND_CREDENTIALS" : "SEND_CREDENTIALS", "ri_director", memberId, (member.MemberName as string | null) ?? null,
        { role: "RIDirector", targetMemberId: memberId, newPassword: tempPassword !== null }, req,
      );
      return { message: `Login details ${isResend ? "re-sent" : "sent"} to ${memberEmail}.` };
    });
  }

  async removeRIDirector(memberId: number, revokedBy: number, req: Request | null) {
    return this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault("SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
      if (!member) throw new InvalidOperationException("Member not found.");
      const rows = await conn.execute(
        `UPDATE member_roles
         SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @RevokedBy
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 7
           AND IsActive = 1 AND isdeleted = 0`,
        { MemberId: memberId, RevokedBy: revokedBy },
      );
      if (rows === 0) throw new InvalidOperationException("Member does not have an active RI Director role.");
      const otherAdmin = Number(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM member_roles mr
           JOIN roles r ON r.pk_role_id = mr.fk_role_id
           WHERE mr.fk_member_master_profile_id = @MemberId
             AND r.RoleName IN ('Admin','SuperAdmin','ZonalCoordinator','AG','ClubModerator','RIDirector')
             AND mr.IsActive = 1 AND mr.isdeleted = 0`,
          { MemberId: memberId },
        ),
      );
      if (otherAdmin === 0 && !(await hasActiveGoalRole(conn, memberId))) {
        await conn.execute("UPDATE member_credentials SET IsActive = 0 WHERE fk_member_master_profile_id = @Id", { Id: memberId });
      }
      await this.audit.log(revokedBy, "REMOVE_ROLE", "ri_director", memberId, (member.MemberName as string | null) ?? null, { role: "RIDirector", targetMemberId: memberId }, req);
      return { message: "RI Director role removed successfully." };
    });
  }
}

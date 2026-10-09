import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { AppConfig } from "../../config/app-config";
import { Db, type DbCommands } from "../../database/db.service";
import { JwtService } from "../../auth/jwt.service";
import { EmailService } from "../../services/email.service";
import { ensureMobileAllowed } from "../../services/login-allowlist.helper";
import { hasActiveGoalRole } from "../../services/goal-login.helper";
import { buildScopes } from "../../services/member-scopes.helper";
import { ArgumentException, InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import type { DtoObject } from "../../common/dto";
import { LoginAuditLogDto, LoginResponseDto } from "../../dtos/auth.dtos";

const GENERIC_RESET_MESSAGE = "If the account exists, a reset link has been sent to the registered email.";

/** Roles that may sign in to the web portal. */
const WEB_ROLE_SQL = `SELECT r.RoleName FROM member_roles mr
  JOIN roles r ON r.pk_role_id = mr.fk_role_id
  WHERE mr.fk_member_master_profile_id = @Id
    AND mr.IsActive = 1 AND mr.isdeleted = 0
    AND r.RoleName IN ('Admin', 'SuperAdmin', 'ZonalCoordinator', 'RIDirector', 'AG', 'ClubModerator')`;

export interface LoginRequest {
  email: string | null;
  countryCode: string | null;
  mobileNumber: string | null;
  password: string;
}

/** Port of AuthService.cs: web sign-in, password reset and change, login log. */
@Injectable()
export class AuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  private expiryMinutes(): number {
    return parseInt(this.config.get("JwtSettings:ExpiryMinutes") ?? "480", 10);
  }

  async login(request: LoginRequest, ipAddress: string | null, userAgent: string | null): Promise<DtoObject> {
    return this.db.session(async (conn) => {
      // Temporary allowlist gate (LoginAllowlist:Enabled).
      await ensureMobileAllowed(this.config, conn, request.mobileNumber, request.email);

      const emailOrMobile = request.email ?? `${request.countryCode ?? ""}${request.mobileNumber ?? ""}`;
      let memberId: number;
      let memberName: string;
      let email: string;

      if (request.email && request.email.trim()) {
        const member = (await conn.callProcedure("sp_auth_get_member_by_email", { p_Email: request.email }))[0];
        if (!member) {
          await this.logLoginAudit(conn, null, null, emailOrMobile, ipAddress, userAgent, "failed", "Member not found");
          throw new UnauthorizedAccessException("Invalid credentials.");
        }
        memberId = Number(member.Id);
        memberName = member.MemberName;
        email = member.EmailId;
      } else if (request.countryCode && request.countryCode.trim() && request.mobileNumber && request.mobileNumber.trim()) {
        const member = (await conn.callProcedure("sp_auth_get_member_by_mobile", { p_CountryCode: request.countryCode, p_MobileNumber: request.mobileNumber }))[0];
        if (!member) {
          await this.logLoginAudit(conn, null, null, emailOrMobile, ipAddress, userAgent, "failed", "Member not found");
          throw new UnauthorizedAccessException("Invalid credentials.");
        }
        memberId = Number(member.Id);
        memberName = member.MemberName;
        email = member.EmailId ?? "";
      } else {
        throw new ArgumentException("Email or CountryCode + MobileNumber is required.");
      }

      // An active web role, or a Goal Setting role (which lands on the goal oversight dashboard).
      const roles = (await conn.query<{ RoleName: string }>(WEB_ROLE_SQL, { Id: memberId })).map((r) => r.RoleName);
      if (roles.length === 0 && !(await hasActiveGoalRole(conn, memberId))) {
        await this.logLoginAudit(conn, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "No admin role");
        throw new UnauthorizedAccessException("You do not have permission to access the admin panel.");
      }

      const cred = (await conn.callProcedure("sp_auth_get_credentials", { p_MemberId: memberId }))[0];
      if (!cred) {
        await this.logLoginAudit(conn, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "No credentials");
        throw new UnauthorizedAccessException("No credentials found. Please contact administrator.");
      }

      const credId = Number(cred.Id);
      const passwordHash = String(cred.PasswordHash);
      const isTemporary = cred.IsTemporaryPassword !== null && cred.IsTemporaryPassword !== undefined && Boolean(Number(cred.IsTemporaryPassword));
      let failedAttempts = cred.FailedLoginAttempts !== null && cred.FailedLoginAttempts !== undefined ? Number(cred.FailedLoginAttempts) : 0;
      const lockoutEnd = cred.LockoutEndTime ? parseDbTime(cred.LockoutEndTime) : null;

      if (failedAttempts >= 5 && lockoutEnd && lockoutEnd.getTime() > Date.now()) {
        await this.logLoginAudit(conn, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "Account locked");
        throw new UnauthorizedAccessException("Account is locked due to multiple failed login attempts. Please try again later.");
      }

      if (!bcrypt.compareSync(request.password, passwordHash)) {
        failedAttempts++;
        const lockoutTime = failedAttempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
        await conn.executeProcedure("sp_auth_update_failed_login", { p_CredId: credId, p_Attempts: failedAttempts, p_Lockout: lockoutTime });
        await this.logLoginAudit(conn, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "Wrong password");
        throw new UnauthorizedAccessException("Invalid credentials.");
      }

      // Kill switch: at least one fully active club -> district -> zone chain is needed.
      // SuperAdmin, RI Director and the Goal Setting RI Director are global and exempt.
      const isLoginExempt = roles.includes("SuperAdmin") || roles.includes("RIDirector") || (await hasActiveGoalRole(conn, memberId, true));
      if (!isLoginExempt) {
        const hasActiveChain = Number(
          await conn.executeScalar(
            `SELECT COUNT(*)
             FROM club_members cm
             JOIN club_master c ON c.pk_club_id = cm.fk_club_id
             JOIN district_master d ON d.pk_district_id = c.fk_district_id
             JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
             WHERE cm.fk_member_master_profile_id = @MemberId
               AND cm.IsActive = 1 AND cm.isdeleted = 0
               AND c.IsActive = 1 AND c.isdeleted = 0
               AND d.IsActive = 1 AND d.isdeleted = 0
               AND z.IsActive = 1 AND z.isdeleted = 0`,
            { MemberId: memberId },
          ),
        );
        if (hasActiveChain === 0) {
          await this.logLoginAudit(conn, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "Zone/District/Club inactive");
          throw new UnauthorizedAccessException("Your zone, district, or club is currently inactive. Please contact your administrator.");
        }
      }

      // Last login, read before this one is recorded.
      let lastLogin: string | null = null;
      try {
        const row = (await conn.callProcedure("sp_login_audit_get_last_login", { p_MemberId: memberId }))[0];
        lastLogin = row ? (Object.values(row)[0] as string | null) ?? null : null;
      } catch {
        // the procedure may not exist yet
      }

      await conn.executeProcedure("sp_auth_update_success_login", { p_CredId: credId });
      await this.logLoginAudit(conn, memberId, memberName, emailOrMobile, ipAddress, userAgent, "success", null);

      const token = this.generateToken(memberId, memberName, email, roles);
      const scopes = await buildScopes(conn, memberId, false);
      return LoginResponseDto.create({
        Token: token,
        MemberName: memberName,
        Email: email,
        MemberId: memberId,
        Roles: roles,
        IsTemporaryPassword: isTemporary,
        LastLoginTime: lastLogin,
        SessionExpiryMinutes: this.expiryMinutes(),
        ScopedRoles: scopes.roles,
        AccessibleZones: scopes.zones,
        AccessibleDistricts: scopes.districts,
        AccessibleClubs: scopes.clubs,
        DistrictClubAccess: scopes.districtClubAccess,
      });
    });
  }

  /** A web session without a password, for the mobile -> web hand-off (same token and scopes as login). */
  async buildSessionForMember(memberId: number): Promise<DtoObject | null> {
    return this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault(
        "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
        { Id: memberId },
      );
      if (!member) return null;
      const memberName: string = member.MemberName ?? "";
      const email: string = member.EmailId ?? "";
      const roles = (await conn.query<{ RoleName: string }>(WEB_ROLE_SQL, { Id: memberId })).map((r) => r.RoleName);
      if (roles.length === 0 && !(await hasActiveGoalRole(conn, memberId))) return null;
      const token = this.generateToken(memberId, memberName, email, roles);
      const scopes = await buildScopes(conn, memberId, false);
      return LoginResponseDto.create({
        Token: token,
        MemberName: memberName,
        Email: email,
        MemberId: memberId,
        Roles: roles,
        IsTemporaryPassword: false,
        LastLoginTime: null,
        SessionExpiryMinutes: this.expiryMinutes(),
        ScopedRoles: scopes.roles,
        AccessibleZones: scopes.zones,
        AccessibleDistricts: scopes.districts,
        AccessibleClubs: scopes.clubs,
        DistrictClubAccess: scopes.districtClubAccess,
      });
    });
  }

  private async logLoginAudit(
    conn: DbCommands, memberId: number | null, memberName: string | null, emailOrMobile: string,
    ipAddress: string | null, userAgent: string | null, status: string, failureReason: string | null,
  ): Promise<void> {
    try {
      await conn.executeProcedure("sp_login_audit_create", {
        p_MemberId: memberId,
        p_MemberName: memberName ?? "",
        p_EmailOrMobile: emailOrMobile ?? "",
        p_IpAddress: ipAddress ?? "",
        p_UserAgent: userAgent && userAgent.length > 500 ? userAgent.slice(0, 500) : userAgent ?? "",
        p_Status: status,
        p_FailureReason: failureReason ?? "",
      });
    } catch {
      // audit logging never blocks login
    }
  }

  async forgotPassword(request: { email: string | null; countryCode: string | null; mobileNumber: string | null }): Promise<object> {
    return this.db.session(async (conn) => {
      let member;
      if (request.email && request.email.trim()) {
        member = (await conn.callProcedure("sp_auth_get_member_by_email", { p_Email: request.email }))[0];
      } else if (request.countryCode && request.countryCode.trim() && request.mobileNumber && request.mobileNumber.trim()) {
        member = (await conn.callProcedure("sp_auth_get_member_by_mobile", { p_CountryCode: request.countryCode, p_MobileNumber: request.mobileNumber }))[0];
      } else {
        return { message: GENERIC_RESET_MESSAGE };
      }
      // Same answer whether or not the account exists (no enumeration).
      if (!member) return { message: GENERIC_RESET_MESSAGE };

      const memberId = Number(member.Id);
      const memberName: string = member.MemberName;
      const memberEmail: string = member.EmailId ?? "";

      const roleCount = Number(await conn.executeScalar(WEB_ROLE_SQL.replace("SELECT r.RoleName", "SELECT COUNT(*)"), { Id: memberId }));
      if ((roleCount === 0 && !(await hasActiveGoalRole(conn, memberId))) || !memberEmail.trim()) return { message: GENERIC_RESET_MESSAGE };

      const token = randomBytes(64).toString("base64");
      // As in RIZones: the token lives 480 minutes although the email says 30.
      const expiry = new Date(Date.now() + 480 * 60_000);
      await conn.executeProcedure("sp_auth_create_reset_token", { p_MemberId: memberId, p_Token: token, p_Expiry: expiry });

      const frontendUrl = this.config.get("FrontendUrl") ?? "http://localhost:3000";
      const resetLink = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await this.email.sendPasswordResetEmail(memberEmail, memberName, resetLink);
      return { message: GENERIC_RESET_MESSAGE };
    });
  }

  async resetPassword(request: { token: string; newPassword: string; confirmPassword: string }): Promise<object> {
    if (request.newPassword !== request.confirmPassword) throw new ArgumentException("Passwords do not match.");
    validatePasswordComplexity(request.newPassword);
    return this.db.session(async (conn) => {
      const tokenRecord = (await conn.callProcedure("sp_auth_get_valid_reset_token", { p_Token: request.token }))[0];
      if (!tokenRecord) throw new ArgumentException("Invalid or expired reset token.");
      const newHash = bcrypt.hashSync(request.newPassword, 11);
      await conn.executeProcedure("sp_auth_reset_password", { p_MemberId: Number(tokenRecord.MemberId), p_Hash: newHash });
      await conn.executeProcedure("sp_auth_mark_token_used", { p_TokenId: Number(tokenRecord.Id) });
      return { message: "Password reset successfully." };
    });
  }

  async changePassword(memberId: number, request: { currentPassword: string; newPassword: string; confirmPassword: string }): Promise<object> {
    if (request.newPassword !== request.confirmPassword) throw new ArgumentException("Passwords do not match.");
    return this.db.session(async (conn) => {
      const cred = (await conn.callProcedure("sp_auth_get_credentials_for_change", { p_MemberId: memberId }))[0];
      if (!cred) throw new InvalidOperationException("No credentials found.");
      const currentHash = String(cred.PasswordHash);
      if (!bcrypt.compareSync(request.currentPassword, currentHash)) throw new UnauthorizedAccessException("Current password is incorrect.");
      if (bcrypt.compareSync(request.newPassword, currentHash)) throw new ArgumentException("New password must be different from the current password.");
      validatePasswordComplexity(request.newPassword);
      await conn.executeProcedure("sp_auth_change_password", { p_CredId: Number(cred.Id), p_Hash: bcrypt.hashSync(request.newPassword, 11) });

      const member = (await conn.callProcedure("sp_role_get_member_email", { p_MemberId: memberId }))[0];
      if (member?.EmailId) await this.email.sendPasswordChangedEmail(member.EmailId, member.MemberName);
      return { message: "Password changed successfully." };
    });
  }

  async getLoginLogs(search: string, status: string, fromDate: string | null, toDate: string | null, page: number, pageSize: number) {
    // fromDate from its start of day; toDate inclusive to the end of its day.
    const fromDt = fromDate ? fromDate.slice(0, 10) + " 00:00:00" : null;
    const toDt = toDate ? toDate.slice(0, 10) + " 23:59:59" : null;
    const where = `WHERE (@Search = '' OR member_name LIKE CONCAT('%', @Search, '%')
                           OR email_or_mobile LIKE CONCAT('%', @Search, '%'))
                     AND (@Status = '' OR login_status = @Status)
                     AND (@FromDt IS NULL OR login_time >= @FromDt)
                     AND (@ToDt   IS NULL OR login_time <= @ToDt)`;
    const params = { Search: search ?? "", Status: status ?? "", FromDt: fromDt, ToDt: toDt, PageSize: pageSize, Offset: (page - 1) * pageSize };
    const items = LoginAuditLogDto.mapAll(
      await this.db.query(
        `SELECT pk_log_id AS Id, fk_member_id AS MemberId, member_name AS MemberName,
                email_or_mobile AS EmailOrMobile, login_time AS LoginTime,
                ip_address AS IpAddress, user_agent AS UserAgent,
                login_status AS LoginStatus, failure_reason AS FailureReason
         FROM login_audit_logs
         ${where}
         ORDER BY login_time DESC
         LIMIT @PageSize OFFSET @Offset`,
        params,
      ),
    );
    const totalCount = Number(await this.db.executeScalar(`SELECT COUNT(*) FROM login_audit_logs ${where}`, params));
    return { items, totalCount };
  }

  private generateToken(memberId: number, name: string, email: string, roles: string[]): string {
    return this.jwt.sign(
      { memberId: String(memberId), name, email, roles: roles.join(",") },
      new Date(Date.now() + this.expiryMinutes() * 60_000),
    );
  }
}

function parseDbTime(value: string): Date {
  // DB values come back as "2026-09-30T14:00:00" (+ "Z" when stored in UTC).
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : value + "Z");
}

export function validatePasswordComplexity(password: string): void {
  if (password.length < 8) throw new ArgumentException("Password must be at least 8 characters long.");
  if (!/[A-Z]/.test(password)) throw new ArgumentException("Password must contain at least one uppercase letter.");
  if (!/[a-z]/.test(password)) throw new ArgumentException("Password must contain at least one lowercase letter.");
  if (!/[0-9]/.test(password)) throw new ArgumentException("Password must contain at least one digit.");
  if (!/[^a-zA-Z0-9]/.test(password)) throw new ArgumentException("Password must contain at least one special character.");
}

import { clientIp } from "../../common/http";
import { Body, Controller, Get, Logger, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "node:crypto";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryInt, queryString, routeInt } from "../../common/binding";
import { badRequest, forbid, notFound, ok, statusCode } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { SmsSender } from "../../services/messaging";

const ROLE_SUPERADMIN = 3;
const OTP_LOGIN_TYPE = "sa_approval";
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 12 characters, no ambiguous 0/O/l/1. */
export function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$";
  return [...randomBytes(12)].map((b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Port of SuperAdminController.cs: promote / remove SuperAdmin, approved by an OTP that goes only to a
 * fixed approver (SuperAdminApproval:OtpMobile / OtpEmail) and is never echoed to the requester.
 */
@Controller("api/admin/super-admins")
@Authorize()
export class SuperAdminsController {
  private readonly log = new Logger("SuperAdminsController");
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly email: EmailService, private readonly sms: SmsSender) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private me = (u: CurrentUser) => {
    const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "";
    return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
  };
  private get otpMobile() { return this.config.get("SuperAdminApproval:OtpMobile") ?? ""; }
  private get otpEmail() { return this.config.get("SuperAdminApproval:OtpEmail") ?? ""; }
  private activeSaCount = (conn: DbCommands = this.db) => conn.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_role_id = @Role AND IsActive = 1 AND (isdeleted IS NULL OR isdeleted = 0)", { Role: ROLE_SUPERADMIN }).then(Number);
  private isActiveSa = (id: number) => this.db.executeScalar(
    "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role AND IsActive = 1 AND (isdeleted IS NULL OR isdeleted = 0)", { Id: id, Role: ROLE_SUPERADMIN }).then((n) => Number(n) > 0);

  @Get()
  async list(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = await this.db.query(
      `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
              mr.created_date AS promotedOn, promoted_by_mem.MemberName AS promotedByName, COALESCE(ga.IsEnabled, 0) AS goalSettingEnabled
       FROM member_roles mr
       JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id AND m.isdeleted = 0
       LEFT JOIN member_master_profile promoted_by_mem ON promoted_by_mem.pk_member_master_profile_id = mr.created_by
       LEFT JOIN goal_oversight_access ga ON ga.fk_member_id = m.pk_member_master_profile_id
       WHERE mr.fk_role_id = @Role AND mr.IsActive = 1 AND (mr.isdeleted IS NULL OR mr.isdeleted = 0)
       ORDER BY mr.created_date DESC`, { Role: ROLE_SUPERADMIN });
    return ok(rows.map((r) => ({ ...r, goalSettingEnabled: Number(r.goalSettingEnabled ?? 0) === 1 })));
  }

  /** Per-member Goal Setting oversight switch (no OTP). */
  @Put(":memberId/goal-setting-access")
  async goalAccess(@User() u: CurrentUser, @Param("memberId") m: string, @Body() body: unknown) {
    const memberId = routeInt(m);
    if (!this.isSuperAdmin(u)) return forbid();
    if (memberId <= 0) return badRequest({ message: "Invalid memberId" });
    if (!(await this.isActiveSa(memberId))) return badRequest({ message: "This member is not an active SuperAdmin." });
    const enabled = bodyField(body, "enabled") === true;
    await this.db.execute(
      `INSERT INTO goal_oversight_access (fk_member_id, IsEnabled, created_date, modified_date, modified_by) VALUES (@Id, @En, NOW(), NOW(), @By)
       ON DUPLICATE KEY UPDATE IsEnabled = @En, modified_date = NOW(), modified_by = @By`, { Id: memberId, En: enabled ? 1 : 0, By: this.me(u) });
    this.log.log(`[SA] Goal Setting access ${enabled ? "ENABLED" : "DISABLED"} for member=${memberId} by=${this.me(u)}`);
    return ok({ message: `Goal Setting ${enabled ? "enabled" : "disabled"}.`, goalSettingEnabled: enabled });
  }

  @Get("search-members")
  async search(@User() u: CurrentUser, @Query("q") qText?: string, @Query("limit") l?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const q = (queryString(qText) ?? "").trim();
    if (q.length < 2) return ok([]);
    return ok(await this.db.query(
      `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, m.RotaryId AS rotaryId,
              c.ClubName AS clubName, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName,
              (SELECT GROUP_CONCAT(r.RoleName) FROM member_roles mr2 JOIN roles r ON r.pk_role_id = mr2.fk_role_id
                WHERE mr2.fk_member_master_profile_id = m.pk_member_master_profile_id AND mr2.IsActive = 1 AND (mr2.isdeleted IS NULL OR mr2.isdeleted = 0)) AS currentRoles
       FROM member_master_profile m
       LEFT JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0 AND cm.IsActive = 1
       LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE m.isdeleted = 0 AND (m.MemberName LIKE @Q OR m.PrimaryMobileNumber LIKE @Q OR m.EmailId LIKE @Q OR m.RotaryId LIKE @Q)
         AND NOT EXISTS (SELECT 1 FROM member_roles mr WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id AND mr.fk_role_id = @SARole
                         AND mr.IsActive = 1 AND (mr.isdeleted IS NULL OR mr.isdeleted = 0))
       ORDER BY m.MemberName
       LIMIT @Limit`, { Q: `%${q}%`, SARole: ROLE_SUPERADMIN, Limit: queryInt(l, 20) }));
  }

  private static action(body: unknown) {
    return String(bodyField(body, "action") ?? "").trim().toUpperCase();
  }

  @Post("send-otp")
  async sendOtp(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const memberId = Math.trunc(Number(bodyField(body, "memberId")) || 0);
    const action = SuperAdminsController.action(body);
    if (memberId <= 0) return badRequest({ message: "Invalid memberId" });
    if (action !== "PROMOTE" && action !== "REMOVE") return badRequest({ message: "action must be PROMOTE or REMOVE" });
    if (!this.otpMobile.trim() && !this.otpEmail.trim()) return statusCode(500, { message: "OTP approver not configured in appsettings (SuperAdminApproval.OtpMobile / OtpEmail)" });
    const target = await this.db.queryFirstOrDefault("SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
    if (!target) return notFound({ message: "Member not found" });
    if (action === "REMOVE") {
      if (!(await this.isActiveSa(memberId))) return badRequest({ message: "This member is not a SuperAdmin." });
      if (memberId === this.me(u)) return badRequest({ message: "You cannot remove your own SuperAdmin role." });
      if ((await this.activeSaCount()) <= 1) return badRequest({ message: "At least one SuperAdmin must remain — cannot remove the last one." });
    }
    const otp = String(randomInt(100000, 1000000));
    const identifier = `sa:${action}:${memberId}`;
    // Stale unused OTPs for the same action + member stop working.
    await this.db.execute("UPDATE mobile_login_otp SET is_used = 1 WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0", { Identifier: identifier, LoginType: OTP_LOGIN_TYPE });
    await this.db.execute(
      `INSERT INTO mobile_login_otp (fk_member_master_profile_id, login_type, identifier, country_id, otp_code, expires_at, max_attempts, is_used)
       VALUES (@MemberId, @LoginType, @Identifier, NULL, @Otp, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${OTP_EXPIRY_MINUTES} MINUTE), @MaxA, 0)`,
      { MemberId: memberId, LoginType: OTP_LOGIN_TYPE, Identifier: identifier, Otp: otp, MaxA: OTP_MAX_ATTEMPTS });
    const name = Brand.Current.productName;
    const targetName = String(target.MemberName ?? "member");
    const verb = action === "PROMOTE" ? "promote" : "remove SuperAdmin role from";
    const word = action === "PROMOTE" ? "Promotion" : "Removal";
    const body2 = `${emailHeader()}
<h2 style='color:#1a365d;margin-top:0;'>SuperAdmin ${word} OTP</h2>
<p>An existing SuperAdmin requested to <strong>${verb}</strong> <strong>${esc(targetName)}</strong>.</p>
<p>Please share this OTP with them only if you approve the action:</p>
<div style='background-color:#f7fafc;border:2px solid #3182ce;border-radius:8px;padding:20px;margin:16px 0;text-align:center;'>
  <p style='font-size:32px;font-weight:bold;color:#1a365d;letter-spacing:8px;margin:0;'>${otp}</p>
</div>
<p style='color:#e53e3e;'><strong>This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.</strong></p>
<p>If you did not expect this request, please contact the ${name} team immediately.</p>
${emailFooter()}`;
    let smsOk = false, emailOk = false;
    if (this.otpMobile.trim()) {
      try {
        smsOk = await this.sms.send(this.otpMobile.trim(), `${name}: OTP ${otp} to ${verb} ${targetName}. Expires in ${OTP_EXPIRY_MINUTES} min. Do not share.`);
      } catch (e) {
        this.log.warn(`SA-OTP SMS failed: ${(e as Error).message}`);
      }
    }
    if (this.otpEmail.trim()) {
      try {
        await this.email.send(this.otpEmail.trim(), `${name} — SuperAdmin ${word} OTP`, body2, { throwOnFailure: true });
        emailOk = true;
      } catch (e) {
        this.log.warn(`SA-OTP email failed: ${(e as Error).message}`);
      }
    }
    if (!smsOk && !emailOk) return statusCode(500, { message: "Failed to deliver OTP via SMS and email. Please check logs." });
    this.log.log(`[SA-OTP] action=${action} target=${memberId} by=${this.me(u)} sms=${smsOk} email=${emailOk}`);
    // The OTP itself is never returned to the requester.
    return ok({ message: "OTP sent to approver. Ask them for the code.", sentSms: smsOk, sentEmail: emailOk, expiryMinutes: OTP_EXPIRY_MINUTES });
  }

  @Post("verify-otp")
  async verifyOtp(@User() u: CurrentUser, @Body() body: unknown, @Req() req: Request) {
    if (!this.isSuperAdmin(u)) return forbid();
    const memberId = Math.trunc(Number(bodyField(body, "memberId")) || 0);
    const action = SuperAdminsController.action(body);
    const otp = String(bodyField(body, "otp") ?? "");
    if (memberId <= 0) return badRequest({ message: "Invalid memberId" });
    if (action !== "PROMOTE" && action !== "REMOVE") return badRequest({ message: "action must be PROMOTE or REMOVE" });
    if (!otp.trim() || otp.length !== 6) return badRequest({ message: "OTP must be 6 digits" });
    const row = await this.db.queryFirstOrDefault(
      `SELECT pk_otp_id AS id, otp_code, attempts, max_attempts, (expires_at < UTC_TIMESTAMP()) AS expired
       FROM mobile_login_otp WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0 ORDER BY pk_otp_id DESC LIMIT 1`,
      { Identifier: `sa:${action}:${memberId}`, LoginType: OTP_LOGIN_TYPE });
    if (!row) return badRequest({ message: "Please request an OTP first." });
    const used = () => this.db.execute("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", { Id: Number(row.id) });
    if (Number(row.expired) === 1 || row.expired === true) { await used(); return badRequest({ message: "OTP expired. Please request a new one." }); }
    const attempts = Number(row.attempts ?? 0), maxAttempts = Number(row.max_attempts ?? 0);
    if (attempts >= maxAttempts) { await used(); return badRequest({ message: "Too many attempts. Please request a new OTP." }); }
    if (String(row.otp_code) !== otp) {
      await this.db.execute("UPDATE mobile_login_otp SET attempts = attempts + 1 WHERE pk_otp_id = @Id", { Id: Number(row.id) });
      return badRequest({ message: `Invalid OTP. ${maxAttempts - attempts - 1} attempts left.` });
    }
    await used();
    const target = await this.db.queryFirstOrDefault("SELECT MemberName, PrimaryMobileNumber, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
    if (!target) return notFound({ message: "Member not found" });
    const [targetName, targetMobile, targetEmail] = [String(target.MemberName ?? ""), String(target.PrimaryMobileNumber ?? ""), String(target.EmailId ?? "")];
    const by = this.me(u);
    const ip = clientIp(req.ip);
    const otpSentTo = [this.otpMobile, this.otpEmail].filter((s) => s.trim()).join(", ");

    if (action === "PROMOTE") {
      // Every other role the member holds stays (no mutual exclusion since 2026-08-14).
      const temp = await this.db.session((conn) => conn.transaction(async (tx) => {
        const updated = await tx.execute("UPDATE member_roles SET IsActive = 1, modified_date = NOW(), modified_by = @By, isdeleted = 0 WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role", { Id: memberId, By: by, Role: ROLE_SUPERADMIN });
        if (updated === 0) await tx.execute("INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, IsActive, created_by, created_date) VALUES (@Id, @Role, 1, @By, NOW())", { Id: memberId, By: by, Role: ROLE_SUPERADMIN });
        let pw: string | null = null;
        const cred = Number(await tx.executeScalar("SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND (isdeleted IS NULL OR isdeleted = 0)", { Id: memberId }));
        if (cred === 0) {
          pw = tempPassword();
          const hash = bcrypt.hashSync(pw, 11);
          const n = await tx.execute("UPDATE member_credentials SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1, modified_date = NOW() WHERE fk_member_master_profile_id = @Id", { Id: memberId, Hash: hash });
          if (n === 0) await tx.execute("INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by) VALUES (@Id, @Hash, 1, 1, @By)", { Id: memberId, Hash: hash, By: by });
        }
        await tx.execute("INSERT INTO superadmin_audit (fk_target_member_id, fk_by_member_id, Action, OtpSentTo, IpAddress) VALUES (@Id, @By, 'PROMOTED', @Otp, @Ip)", { Id: memberId, By: by, Otp: otpSentTo, Ip: ip });
        return pw;
      }));
      if (targetEmail.trim()) {
        try { await this.email.sendSuperAdminWelcomeEmail(targetEmail, targetName, targetMobile, temp); } catch (e) { this.log.warn(`SA welcome email failed: ${(e as Error).message}`); }
      }
      this.log.log(`[SA] PROMOTED member=${memberId} by=${by}`);
      return ok({ message: "Member promoted to SuperAdmin.", credentialsSent: !!targetEmail.trim() });
    }

    if (memberId === by) return badRequest({ message: "You cannot remove your own SuperAdmin role." });
    const refused = await this.db.session((conn) => conn.transaction(async (tx) => {
      if ((await this.activeSaCount(tx)) <= 1) return true;
      await tx.execute("UPDATE member_roles SET IsActive = 0, modified_date = NOW(), modified_by = @By WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role AND IsActive = 1 AND (isdeleted IS NULL OR isdeleted = 0)", { Id: memberId, By: by, Role: ROLE_SUPERADMIN });
      await tx.execute("INSERT INTO superadmin_audit (fk_target_member_id, fk_by_member_id, Action, OtpSentTo, IpAddress) VALUES (@Id, @By, 'REMOVED', @Otp, @Ip)", { Id: memberId, By: by, Otp: otpSentTo, Ip: ip });
      return false;
    }));
    if (refused) return badRequest({ message: "At least one SuperAdmin must remain." });
    if (targetEmail.trim()) {
      try { await this.email.sendSuperAdminRevokedEmail(targetEmail, targetName); } catch (e) { this.log.warn(`SA revoked email failed: ${(e as Error).message}`); }
    }
    this.log.log(`[SA] REMOVED member=${memberId} by=${by}`);
    return ok({ message: "SuperAdmin role removed." });
  }
}

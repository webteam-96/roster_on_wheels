import { Injectable, Logger } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { AppConfig } from "../../config/app-config";
import { Db, type DbCommands } from "../../database/db.service";
import { JwtService } from "../../auth/jwt.service";
import { Brand } from "../../brand/brand";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { SmsSender, WhatsAppSender, countryDialInfo, otpChannelsFor, toE164 } from "../../services/messaging";
import { buildScopes } from "../../services/member-scopes.helper";
import { ensureMobileLoginAllowed } from "../../services/non-sync-login-guard.helper";
import { ArgumentException, InvalidOperationException, KeyNotFoundException, UnauthorizedAccessException } from "../../common/exceptions";
import { MobileRequestOtpResponse, MobileVerifyOtpResponse, MyContextResponse } from "../../dtos/mobile-auth.dtos";

const MOBILE_JWT_DAYS = 3650;
const OTP_EXPIRY_MINUTES = 5;
/** The approved Meta authentication template for login codes (one per language). */
const WHATSAPP_OTP_TEMPLATE = "otp";

export interface RequestOtp { loginType: string; identifier: string; countryId: number | null }
export interface VerifyOtp extends RequestOtp {
  otp: string; imei: string | null; deviceToken: string | null; deviceName: string | null; appVersion: string | null;
}

/** "2026-09-30T14:00:00Z" or "2026-09-30T14:00:00" (stored UTC) -> Date */
const utc = (v: string) => new Date(/Z$|[+-]\d{2}:\d{2}$/.test(v) ? v : v + "Z");
const sqlUtc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** Port of MobileAuthService.cs: OTP sign-in for members and family members on the app. */
@Injectable()
export class MobileAuthService {
  private readonly log = new Logger("MobileAuthService");

  constructor(
    private readonly config: AppConfig,
    private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly sms: SmsSender,
    private readonly whatsApp: WhatsAppSender,
  ) {}

  /** SuperAdmin-only accounts use the web portal; everyone but RI Directors needs an active club chain. */
  private async ensureMemberMayUseApp(conn: DbCommands, memberId: number): Promise<void> {
    const isSuperAdmin = Number(
      await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles mr
         JOIN roles r ON r.pk_role_id = mr.fk_role_id
         WHERE mr.fk_member_master_profile_id = @MemberId
           AND r.RoleName = 'SuperAdmin'
           AND mr.IsActive = 1 AND mr.isdeleted = 0`,
        { MemberId: memberId },
      ),
    );
    if (isSuperAdmin > 0) {
      const hasOtherUsableRole = Number(
        await conn.executeScalar(
          `SELECT
               (SELECT COUNT(*) FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = @MemberId
                  AND r.RoleName <> 'SuperAdmin'
                  AND mr.IsActive = 1 AND mr.isdeleted = 0)
             + (SELECT COUNT(*) FROM club_members
                WHERE fk_member_master_profile_id = @MemberId
                  AND IsActive = 1 AND isdeleted = 0)`,
          { MemberId: memberId },
        ),
      );
      if (hasOtherUsableRole === 0) throw new UnauthorizedAccessException("SuperAdmin cannot login on mobile. Please use the web portal.");
    }
    const isRid = Number(
      await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles mr
         JOIN roles r ON r.pk_role_id = mr.fk_role_id
         WHERE mr.fk_member_master_profile_id = @MemberId
           AND r.RoleName = 'RIDirector'
           AND mr.IsActive = 1 AND mr.isdeleted = 0`,
        { MemberId: memberId },
      ),
    );
    if (isRid === 0) {
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
      if (hasActiveChain === 0) throw new UnauthorizedAccessException("Your zone, district, or club is currently inactive. Please contact your administrator.");
    }
  }

  async requestOtp(dto: RequestOtp) {
    if (!dto.identifier || !dto.identifier.trim()) throw new ArgumentException("Identifier is required.");
    return this.db.session(async (conn) => {
      const identifier = dto.identifier.trim();
      const isEmail = identifier.includes("@");
      const loginType = (dto.loginType || "member").toLowerCase();
      if (!isEmail && !dto.countryId) throw new InvalidOperationException("Country ID is required for mobile number login.");

      let memberId: number;
      let familyMemberId: number | null = null;
      let targetEmail: string | null;
      let targetMobile: string | null;
      let memberCountryId: number | null;
      let memberName: string;

      if (loginType === "family") {
        const fam = isEmail
          ? await conn.queryFirstOrDefault(
              `SELECT pk_member_family_details_id AS id, fk_member_master_profile_id AS memberId, Name,
                      EmailId, PhoneNumber, fk_country_id AS countryId
               FROM member_family_details
               WHERE EmailId = @Id AND isdeleted = 0
               ORDER BY pk_member_family_details_id ASC LIMIT 1`,
              { Id: identifier },
            )
          : await conn.queryFirstOrDefault(
              `SELECT pk_member_family_details_id AS id, fk_member_master_profile_id AS memberId, Name,
                      EmailId, PhoneNumber, fk_country_id AS countryId
               FROM member_family_details
               WHERE PhoneNumber = @Id AND fk_country_id = @CId AND isdeleted = 0
               ORDER BY pk_member_family_details_id ASC LIMIT 1`,
              { Id: identifier, CId: dto.countryId },
            );
        if (!fam) throw new KeyNotFoundException("No family member found with this identifier.");
        familyMemberId = Number(fam.id);
        memberId = Number(fam.memberId);
        targetEmail = fam.EmailId ?? null;
        targetMobile = fam.PhoneNumber ?? null;
        memberCountryId = fam.countryId === null ? null : Number(fam.countryId);
        memberName = fam.Name ?? "";
      } else {
        const member = isEmail
          ? await conn.queryFirstOrDefault(
              `SELECT pk_member_master_profile_id AS id, MemberName, EmailId, PrimaryMobileNumber,
                      fk_primary_country_id AS countryId
               FROM member_master_profile
               WHERE EmailId = @Id AND isdeleted = 0
               ORDER BY pk_member_master_profile_id ASC LIMIT 1`,
              { Id: identifier },
            )
          : await conn.queryFirstOrDefault(
              `SELECT pk_member_master_profile_id AS id, MemberName, EmailId, PrimaryMobileNumber,
                      fk_primary_country_id AS countryId
               FROM member_master_profile
               WHERE PrimaryMobileNumber = @Id AND fk_primary_country_id = @CId AND isdeleted = 0
               ORDER BY pk_member_master_profile_id ASC LIMIT 1`,
              { Id: identifier, CId: dto.countryId },
            );
        if (!member) throw new KeyNotFoundException("No rotarian found with this mobile/email.");
        memberId = Number(member.id);
        targetEmail = member.EmailId ?? null;
        targetMobile = member.PrimaryMobileNumber ?? null;
        memberCountryId = member.countryId === null ? null : Number(member.countryId);
        memberName = member.MemberName ?? "";
        await ensureMobileLoginAllowed(conn, memberId);
        await this.ensureMemberMayUseApp(conn, memberId);
      }

      // App-store review account (TestAccount:Mobile / TestAccount:Otp): fixed code, nothing sent.
      const testMobile = this.config.get("TestAccount:Mobile");
      const testOtp = this.config.get("TestAccount:Otp");
      const isTestAccount = !isEmail && !!testMobile?.trim() && !!testOtp?.trim() && identifier === testMobile.trim();
      const otp = isTestAccount ? testOtp!.trim() : String(randomInt(100000, 1000000));
      const expiresAt = new Date(Date.now() + (isTestAccount ? 10 * 365 * 86_400_000 : OTP_EXPIRY_MINUTES * 60_000));

      let sentEmail = false;
      let sentSms = false;
      let sentWhatsApp = false;
      if (!isTestAccount) {
        // ROW: channels follow the brand's OTP policy for the member's country
        // (default email + WhatsApp, SMS only as a fallback).
        const { dialCode, iso } = await countryDialInfo(conn, memberCountryId ?? dto.countryId);
        const channels = otpChannelsFor(iso);
        const e164 = toE164(targetMobile, dialCode);
        if (channels.includes("email") && targetEmail && targetEmail.trim()) sentEmail = await this.sendOtpEmail(targetEmail, memberName, otp);
        if (channels.includes("whatsapp") && e164) {
          sentWhatsApp = await this.whatsApp.sendTemplate(e164, WHATSAPP_OTP_TEMPLATE, Brand.Current.locale.defaultLanguage, [otp], otp);
        }
        if (channels.includes("sms") && e164 && !sentEmail && !sentWhatsApp) {
          sentSms = await this.sms.send(e164, `${otp} is your ${Brand.Current.shortName} login code. It expires in ${OTP_EXPIRY_MINUTES} minutes.`);
        }
        if (!sentEmail && !sentSms && !sentWhatsApp) throw new InvalidOperationException("Failed to send OTP via email or SMS. Please try again.");
      }

      await conn.execute(
        `INSERT INTO mobile_login_otp
             (fk_member_master_profile_id, fk_family_member_id, login_type, identifier, country_id,
              otp_code, expires_at, sent_email, sent_sms, sent_whatsapp)
         VALUES (@MemberId, @FamilyId, @LoginType, @Identifier, @CountryId,
                 @Otp, @ExpiresAt, @SentEmail, @SentSms, @SentWhatsApp)`,
        {
          MemberId: memberId, FamilyId: familyMemberId, LoginType: loginType, Identifier: identifier, CountryId: dto.countryId,
          Otp: otp, ExpiresAt: sqlUtc(expiresAt), SentEmail: sentEmail, SentSms: sentSms, SentWhatsApp: sentWhatsApp,
        },
      );

      return MobileRequestOtpResponse.create({
        Message: "OTP sent successfully.",
        SentEmail: sentEmail,
        SentSms: sentSms,
        SentWhatsApp: sentWhatsApp,
        OtpExpiresInSeconds: OTP_EXPIRY_MINUTES * 60,
        DebugOtp: this.config.getBool("MobileOtp:ReturnDebugOtp") ? otp : null,
      });
    });
  }

  private async sendOtpEmail(to: string, memberName: string, otp: string): Promise<boolean> {
    try {
      const subject = `${Brand.Current.shortName} Mobile App - Login OTP`;
      const body = `${emailHeader()}
                    <h2 style='color: #1a365d; margin-top: 0;'>Mobile App Login OTP</h2>
                    <p>Dear ${memberName},</p>
                    <p>Your one-time password (OTP) to login to the ${Brand.Current.productName} mobile app is:</p>
                    <div style='background-color: #f7fafc; border: 2px solid #3182ce; border-radius: 8px; padding: 20px; margin: 16px 0; text-align: center;'>
                        <p style='font-size: 32px; font-weight: bold; color: #1a365d; letter-spacing: 8px; margin: 0;'>${otp}</p>
                    </div>
                    <p style='color: #e53e3e;'><strong>This OTP is valid for ${OTP_EXPIRY_MINUTES} minutes.</strong></p>
                    <p>If you did not request this OTP, please ignore this email.</p>
                    ${emailFooter()}`;
      await this.email.send(to, subject, body, { throwOnFailure: true });
      return true;
    } catch (e) {
      this.log.error(`Failed to send mobile login OTP email to ${to}: ${(e as Error).message}`);
      return false;
    }
  }

  async verifyOtp(dto: VerifyOtp) {
    if (!dto.otp || !dto.otp.trim()) throw new ArgumentException("OTP is required.");
    return this.db.session(async (conn) => {
      const identifier = dto.identifier.trim();
      const loginType = (dto.loginType || "member").toLowerCase();
      const otpRow = await conn.queryFirstOrDefault(
        `SELECT pk_otp_id AS id, fk_member_master_profile_id AS memberId,
                fk_family_member_id AS familyId, otp_code, attempts, max_attempts, expires_at
         FROM mobile_login_otp
         WHERE identifier = @Id AND login_type = @LoginType AND is_used = 0
         ORDER BY pk_otp_id DESC LIMIT 1`,
        { Id: identifier, LoginType: loginType },
      );
      if (!otpRow) throw new InvalidOperationException("No OTP request found. Please request a new OTP.");
      const otpId = Number(otpRow.id);
      const attempts = Number(otpRow.attempts);
      const maxAttempts = Number(otpRow.max_attempts);

      if (Date.now() > utc(String(otpRow.expires_at)).getTime()) {
        await conn.execute("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", { Id: otpId });
        throw new InvalidOperationException("OTP has expired. Please request a new one.");
      }
      if (attempts >= maxAttempts) {
        await conn.execute("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", { Id: otpId });
        throw new InvalidOperationException("Maximum OTP attempts exceeded. Please request a new one.");
      }
      if (String(otpRow.otp_code) !== dto.otp.trim()) {
        await conn.execute("UPDATE mobile_login_otp SET attempts = attempts + 1 WHERE pk_otp_id = @Id", { Id: otpId });
        throw new InvalidOperationException(`Invalid OTP. ${maxAttempts - attempts - 1} attempts remaining.`);
      }
      await conn.execute("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", { Id: otpId });

      const memberId = Number(otpRow.memberId);
      const familyMemberId = otpRow.familyId === null ? null : Number(otpRow.familyId);
      await ensureMobileLoginAllowed(conn, memberId);
      await this.ensureMemberMayUseApp(conn, memberId);

      const info = await conn.queryFirstOrDefault(
        `SELECT MemberName, EmailId, PrimaryMobileNumber
         FROM member_master_profile
         WHERE pk_member_master_profile_id = @Id AND isdeleted = 0`,
        { Id: memberId },
      );
      if (!info) throw new InvalidOperationException("Member profile not found.");
      let displayName: string = info.MemberName ?? "";
      let displayEmail: string | null = info.EmailId ?? null;
      let displayMobile: string | null = info.PrimaryMobileNumber ?? null;
      if (loginType === "family" && familyMemberId !== null) {
        const fam = await conn.queryFirstOrDefault(
          `SELECT Name, EmailId, PhoneNumber FROM member_family_details
           WHERE pk_member_family_details_id = @Id AND isdeleted = 0`,
          { Id: familyMemberId },
        );
        if (fam) {
          displayName = fam.Name ?? displayName;
          displayEmail = fam.EmailId ?? displayEmail;
          displayMobile = fam.PhoneNumber ?? displayMobile;
        }
      }

      // Mobile sessions never carry SuperAdmin.
      const scopes = await buildScopes(conn, memberId, true);
      const roles = [...new Set(scopes.roles.map((r) => String(r.roleName)))];
      if (loginType === "family" && !roles.includes("Member")) roles.push("Member");

      const now = sqlUtc(new Date());
      if (dto.imei && dto.imei.trim()) {
        await conn.execute(
          `INSERT INTO member_device_sessions
               (fk_member_master_profile_id, fk_family_member_id, imei, device_token, device_name,
                app_version, login_count, first_visit, last_visit, is_active)
           VALUES (@MemberId, @FamilyId, @Imei, @DevToken, @DevName, @AppVer, 1, @Now, @Now, 1)
           ON DUPLICATE KEY UPDATE
               login_count = login_count + 1,
               last_visit = @Now,
               device_token = @DevToken,
               device_name = @DevName,
               app_version = @AppVer,
               is_active = 1,
               last_logout = NULL`,
          { MemberId: memberId, FamilyId: familyMemberId, Imei: dto.imei, DevToken: dto.deviceToken, DevName: dto.deviceName, AppVer: dto.appVersion, Now: now },
        );
      }
      // A login without a push token keeps the stored one.
      await conn.execute(
        `UPDATE member_master_profile
         SET MobileLoginCount = COALESCE(MobileLoginCount, 0) + 1,
             LastImei = @Imei,
             LastDeviceToken = COALESCE(NULLIF(TRIM(@DevToken), ''), LastDeviceToken),
             LastDeviceName = @DevName,
             FirstMobileVisit = COALESCE(FirstMobileVisit, @Now),
             LastMobileVisit = @Now
         WHERE pk_member_master_profile_id = @MemberId`,
        { MemberId: memberId, Imei: dto.imei, DevToken: dto.deviceToken, DevName: dto.deviceName, Now: now },
      );

      const memberType = loginType === "family" ? "family" : "member";
      const expiresAt = new Date(Date.now() + MOBILE_JWT_DAYS * 86_400_000);
      const claims: Record<string, string> = {
        memberId: String(memberId), name: displayName, email: displayEmail ?? "", roles: roles.join(","),
        loginType: "mobile", memberType,
      };
      if (familyMemberId !== null) claims.familyMemberId = String(familyMemberId);
      if (dto.imei && dto.imei.trim()) claims.imei = dto.imei;

      return MobileVerifyOtpResponse.create({
        Token: this.jwt.sign(claims, expiresAt),
        ExpiresAt: expiresAt.toISOString(),
        MemberId: memberId,
        MemberName: displayName,
        Email: displayEmail,
        Mobile: displayMobile,
        MemberType: memberType,
        FamilyMemberId: familyMemberId,
        RoleNames: roles,
        Roles: scopes.roles,
        AccessibleZones: scopes.zones,
        AccessibleDistricts: scopes.districts,
        AccessibleClubs: scopes.clubs,
        DistrictClubAccess: scopes.districtClubAccess,
        MemberMobileDashboard: scopes.memberMobileDashboard,
      });
    });
  }

  async logout(memberId: number, imei: string | null): Promise<void> {
    const now = sqlUtc(new Date());
    await this.db.session(async (conn) => {
      if (imei && imei.trim()) {
        await conn.execute(
          `UPDATE member_device_sessions SET last_logout = @Now, is_active = 0
           WHERE fk_member_master_profile_id = @MemberId AND imei = @Imei`,
          { MemberId: memberId, Imei: imei, Now: now },
        );
      }
      await conn.execute("UPDATE member_master_profile SET LastMobileLogout = @Now WHERE pk_member_master_profile_id = @MemberId", { MemberId: memberId, Now: now });
    });
  }

  async getMyContext(memberId: number, familyMemberId: number | null) {
    return this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault(
        `SELECT MemberName, EmailId, PrimaryMobileNumber, fk_primary_country_id AS countryId
         FROM member_master_profile
         WHERE pk_member_master_profile_id = @Id AND isdeleted = 0`,
        { Id: memberId },
      );
      if (!member) throw new KeyNotFoundException("Member not found.");
      let displayName: string = member.MemberName ?? "";
      let displayEmail: string | null = member.EmailId ?? null;
      let displayMobile: string | null = member.PrimaryMobileNumber ?? null;
      if (familyMemberId !== null) {
        const fam = await conn.queryFirstOrDefault(
          `SELECT Name, EmailId, PhoneNumber FROM member_family_details
           WHERE pk_member_family_details_id = @Id AND isdeleted = 0`,
          { Id: familyMemberId },
        );
        if (fam) {
          displayName = fam.Name ?? displayName;
          displayEmail = fam.EmailId ?? displayEmail;
          displayMobile = fam.PhoneNumber ?? displayMobile;
        }
      }
      const scopes = await buildScopes(conn, memberId, false);
      return MyContextResponse.create({
        MemberId: memberId,
        MemberName: displayName,
        Email: displayEmail,
        Mobile: displayMobile,
        CountryId: member.countryId === null ? null : Number(member.countryId),
        MemberType: familyMemberId !== null ? "family" : "member",
        FamilyMemberId: familyMemberId,
        Roles: scopes.roles,
        AccessibleZones: scopes.zones,
        AccessibleDistricts: scopes.districts,
        AccessibleClubs: scopes.clubs,
        DistrictClubAccess: scopes.districtClubAccess,
        MemberMobileDashboard: scopes.memberMobileDashboard,
      });
    });
  }
}

export { utc as parseStoredUtc };

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Dapper;
using Microsoft.IdentityModel.Tokens;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class MobileAuthService : IMobileAuthService
{
    private readonly IConfiguration _configuration;
    private readonly IEmailService _emailService;
    private readonly ISmsService _smsService;
    private readonly IInteraktService _interaktService;
    private readonly ILogger<MobileAuthService> _logger;
    private readonly string _connectionString;

    // Mobile JWT settings
    // 10-year expiry per user 2026-07-10. Every mobile/OTP JWT stays valid
    // for 10 years so external integrations (web-directory partners) don't
    // need to re-auth. Regular mobile app users benefit too — no forced
    // re-login every 30 days. To revoke a specific compromised token there
    // is no per-token revocation; rotating JwtSettings.Secret in
    // appsettings.json invalidates ALL tokens (nuclear option).
    private const int MobileJwtDays = 3650;
    private const int OtpExpiryMinutes = 5;

    public MobileAuthService(
        IConfiguration configuration,
        IEmailService emailService,
        ISmsService smsService,
        IInteraktService interaktService,
        ILogger<MobileAuthService> logger)
    {
        _configuration = configuration;
        _emailService = emailService;
        _smsService = smsService;
        _interaktService = interaktService;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ══════════════════════════════════════════════════════════════
    // Request OTP
    // ══════════════════════════════════════════════════════════════
    public async Task<MobileRequestOtpResponse> RequestOtpAsync(MobileRequestOtpDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Identifier))
            throw new ArgumentException("Identifier is required.");

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var identifier = dto.Identifier.Trim();
        bool isEmail = identifier.Contains('@');
        var loginType = (dto.LoginType ?? "member").ToLowerInvariant();

        // If mobile number, require country id
        if (!isEmail && !dto.CountryId.HasValue)
            throw new InvalidOperationException("Country ID is required for mobile number login.");

        // ── Resolve the target (member or family) ──
        int? memberId = null;
        int? familyMemberId = null;
        string? targetEmail = null;
        string? targetMobile = null;
        int? memberCountryId = null;
        string memberName = "";

        if (loginType == "family")
        {
            // Family member lookup
            dynamic? fam = null;
            if (isEmail)
            {
                fam = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT pk_member_family_details_id AS id, fk_member_master_profile_id AS memberId, Name,
                           EmailId, PhoneNumber, fk_country_id AS countryId
                    FROM member_family_details
                    WHERE EmailId = @Id AND isdeleted = 0
                    ORDER BY pk_member_family_details_id ASC LIMIT 1",
                    new { Id = identifier });
            }
            else
            {
                fam = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT pk_member_family_details_id AS id, fk_member_master_profile_id AS memberId, Name,
                           EmailId, PhoneNumber, fk_country_id AS countryId
                    FROM member_family_details
                    WHERE PhoneNumber = @Id AND fk_country_id = @CId AND isdeleted = 0
                    ORDER BY pk_member_family_details_id ASC LIMIT 1",
                    new { Id = identifier, CId = dto.CountryId });
            }

            if (fam == null)
                throw new KeyNotFoundException("No family member found with this identifier.");

            // NOTE: cross-flow block intentionally removed (2026-06-13). A registered
            // Rotarian whose mobile/email is ALSO recorded as another Rotarian's
            // family member (e.g. spouse who is themselves a Rotarian) is allowed
            // to choose Family Login and land in the spouse's family-mode view.
            // They can still log in as themselves separately via Member Login.

            familyMemberId = (int)fam.id;
            memberId = (int)fam.memberId;
            targetEmail = (string?)fam.EmailId;
            targetMobile = (string?)fam.PhoneNumber;
            memberCountryId = fam.countryId == null ? null : (int?)fam.countryId;
            memberName = (string)fam.Name ?? "";
        }
        else
        {
            // Member (rotarian) lookup
            dynamic? member = null;
            if (isEmail)
            {
                member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT pk_member_master_profile_id AS id, MemberName, EmailId, PrimaryMobileNumber,
                           fk_primary_country_id AS countryId
                    FROM member_master_profile
                    WHERE EmailId = @Id AND isdeleted = 0
                    ORDER BY pk_member_master_profile_id ASC LIMIT 1",
                    new { Id = identifier });
            }
            else
            {
                member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT pk_member_master_profile_id AS id, MemberName, EmailId, PrimaryMobileNumber,
                           fk_primary_country_id AS countryId
                    FROM member_master_profile
                    WHERE PrimaryMobileNumber = @Id AND fk_primary_country_id = @CId AND isdeleted = 0
                    ORDER BY pk_member_master_profile_id ASC LIMIT 1",
                    new { Id = identifier, CId = dto.CountryId });
            }

            if (member == null)
                throw new KeyNotFoundException("No rotarian found with this mobile/email.");

            memberId = (int)member.id;
            targetEmail = (string?)member.EmailId;
            targetMobile = (string?)member.PrimaryMobileNumber;
            memberCountryId = member.countryId == null ? null : (int?)member.countryId;
            memberName = (string)member.MemberName ?? "";

            // Non-sync cascade login guard — block early (before sending OTP) if the member's
            // only club went non-sync. Family-login path is still covered at VerifyOtp.
            await NonSyncLoginGuardHelper.EnsureCanLoginAsync(conn, memberId.Value);

            // SuperAdmin policy on mobile:
            //   - SA is a web-only role (no mobile dashboard surface).
            //   - But a member who is SA + also Admin/ClubModerator/AG/RID/ZC/Member
            //     can use mobile via that *other* role. Mobile session strips SA.
            //   - SA-only (no other role + no club membership) → still web-only.
            var isSuperAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = @MemberId
                  AND r.RoleName = 'SuperAdmin'
                  AND mr.IsActive = 1 AND mr.isdeleted = 0",
                new { MemberId = memberId.Value });

            if (isSuperAdmin > 0)
            {
                var hasOtherUsableRole = await conn.ExecuteScalarAsync<int>(@"
                    SELECT
                        (SELECT COUNT(*) FROM member_roles mr
                         JOIN roles r ON r.pk_role_id = mr.fk_role_id
                         WHERE mr.fk_member_master_profile_id = @MemberId
                           AND r.RoleName <> 'SuperAdmin'
                           AND mr.IsActive = 1 AND mr.isdeleted = 0)
                      + (SELECT COUNT(*) FROM club_members
                         WHERE fk_member_master_profile_id = @MemberId
                           AND IsActive = 1 AND isdeleted = 0)",
                    new { MemberId = memberId.Value });

                if (hasOtherUsableRole == 0)
                    throw new UnauthorizedAccessException("SuperAdmin cannot login on mobile. Please use the web portal.");
            }

            // Kill-switch: block if user's entire club→district→zone chain is inactive.
            // RID is global — exempt. SA users on mobile go through this check as the
            // non-SA role they're logging in as (consistent with stripping SA from the session).
            var isRid = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = @MemberId
                  AND r.RoleName = 'RIDirector'
                  AND mr.IsActive = 1 AND mr.isdeleted = 0",
                new { MemberId = memberId.Value });
            if (isRid == 0)
            {
                var hasActiveChain = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*)
                    FROM club_members cm
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    JOIN district_master d ON d.pk_district_id = c.fk_district_id
                    JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                    WHERE cm.fk_member_master_profile_id = @MemberId
                      AND cm.IsActive = 1 AND cm.isdeleted = 0
                      AND c.IsActive = 1 AND c.isdeleted = 0
                      AND d.IsActive = 1 AND d.isdeleted = 0
                      AND z.IsActive = 1 AND z.isdeleted = 0",
                    new { MemberId = memberId.Value });
                if (hasActiveChain == 0)
                    throw new UnauthorizedAccessException("Your zone, district, or club is currently inactive. Please contact your administrator.");
            }
        }

        // ── Play Store review test account ──
        // A fixed mobile number reserved for the Play Store review team. When logging in
        // with this exact mobile number, do NOT send any real OTP — a fixed OTP (e.g. 666666)
        // is stored and accepted. Configured in appsettings (TestAccount:Mobile / TestAccount:Otp).
        var testMobile = _configuration["TestAccount:Mobile"];
        var testOtp = _configuration["TestAccount:Otp"];
        bool isTestAccount = !isEmail
            && !string.IsNullOrWhiteSpace(testMobile)
            && !string.IsNullOrWhiteSpace(testOtp)
            && identifier == testMobile.Trim();

        // ── Generate OTP ──
        var otp = isTestAccount ? testOtp!.Trim() : GenerateOtp();
        // Test account OTP never effectively expires (far-future) so reviewers can use it anytime.
        var expiresAt = isTestAccount
            ? DateTime.UtcNow.AddYears(10)
            : DateTime.UtcNow.AddMinutes(OtpExpiryMinutes);

        // ── Send OTP ──
        bool sentEmail = false;
        bool sentSms = false;
        bool sentWhatsApp = false;

        async Task<bool> TrySendLoginOtpEmailAsync()
        {
            if (string.IsNullOrWhiteSpace(targetEmail)) return false;
            try
            {
                var subject = "Rotary Mobile App - Login OTP";
                var body = $@"{EmailService.EMAIL_HEADER}
                    <h2 style='color: #1a365d; margin-top: 0;'>Mobile App Login OTP</h2>
                    <p>Dear {memberName},</p>
                    <p>Your one-time password (OTP) to login to the Rotary mobile app is:</p>
                    <div style='background-color: #f7fafc; border: 2px solid #3182ce; border-radius: 8px; padding: 20px; margin: 16px 0; text-align: center;'>
                        <p style='font-size: 32px; font-weight: bold; color: #1a365d; letter-spacing: 8px; margin: 0;'>{otp}</p>
                    </div>
                    <p style='color: #e53e3e;'><strong>This OTP is valid for {OtpExpiryMinutes} minutes.</strong></p>
                    <p>If you did not request this OTP, please ignore this email.</p>
                    {EmailService.EMAIL_FOOTER}";

                await _emailService.SendGenericEmailAsync(targetEmail, subject, body);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send mobile login OTP email to {Email}", targetEmail);
                return false;
            }
        }

        if (!isTestAccount)
        {
            // India = SMS OTP only, outside India = Email OTP only (business rule,
            // 2026-08-24). Previously every login sent email AND (SMS for India /
            // WhatsApp outside India) together; email is now dropped for India, and
            // WhatsApp is not used for India at all — SMS is the sole India channel.
            //
            // NOTE: no cross-country fallback — a member missing all contact info for
            // their country's channel (e.g. an India member with no mobile on file)
            // gets the "failed to send" error below rather than silently switching to
            // the other country's channel. Deliberate, per instruction 2026-08-24:
            // don't reactivate without asking first.
            var outsideIndiaDialCode = await OtpWhatsAppHelper.ResolveOutsideIndiaDialCodeAsync(conn, memberCountryId, targetMobile);
            bool isOutsideIndia = outsideIndiaDialCode != null;

            if (isOutsideIndia)
            {
                sentEmail = await TrySendLoginOtpEmailAsync();
            }
            else if (!string.IsNullOrWhiteSpace(targetMobile))
            {
                try
                {
                    sentSms = await _smsService.SendOtpSmsAsync(targetMobile, otp);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send mobile login OTP SMS to {Mobile}", targetMobile);
                }
            }

            if (!sentEmail && !sentSms && !sentWhatsApp)
                throw new InvalidOperationException("Failed to send OTP via email or SMS. Please try again.");
        }

        // ── Store OTP ──
        await conn.ExecuteAsync(@"
            INSERT INTO mobile_login_otp
                (fk_member_master_profile_id, fk_family_member_id, login_type, identifier, country_id,
                 otp_code, expires_at, sent_email, sent_sms, sent_whatsapp)
            VALUES (@MemberId, @FamilyId, @LoginType, @Identifier, @CountryId,
                    @Otp, @ExpiresAt, @SentEmail, @SentSms, @SentWhatsApp)",
            new
            {
                MemberId = memberId,
                FamilyId = familyMemberId,
                LoginType = loginType,
                Identifier = identifier,
                CountryId = dto.CountryId,
                Otp = otp,
                ExpiresAt = expiresAt,
                SentEmail = sentEmail ? 1 : 0,
                SentSms = sentSms ? 1 : 0,
                SentWhatsApp = sentWhatsApp ? 1 : 0
            });

        // TEMPORARY testing aid — echo the OTP in the response when the
        // MobileOtp:ReturnDebugOtp flag is set. Flip the flag to false in
        // appsettings.json to remove the debug echo. The flag is the ONLY
        // gate; never echo unconditionally.
        var returnDebugOtp = _configuration.GetValue<bool>("MobileOtp:ReturnDebugOtp");

        return new MobileRequestOtpResponse
        {
            Message = "OTP sent successfully.",
            SentEmail = sentEmail,
            SentSms = sentSms,
            SentWhatsApp = sentWhatsApp,
            OtpExpiresInSeconds = OtpExpiryMinutes * 60,
            DebugOtp = returnDebugOtp ? otp : null,
        };
    }

    // ══════════════════════════════════════════════════════════════
    // Verify OTP
    // ══════════════════════════════════════════════════════════════
    public async Task<MobileVerifyOtpResponse> VerifyOtpAsync(MobileVerifyOtpDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Otp))
            throw new ArgumentException("OTP is required.");

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var identifier = dto.Identifier.Trim();
        var loginType = (dto.LoginType ?? "member").ToLowerInvariant();

        // Find latest un-used OTP for this identifier
        var otpRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_otp_id AS id, fk_member_master_profile_id AS memberId,
                   fk_family_member_id AS familyId, otp_code, attempts, max_attempts, expires_at
            FROM mobile_login_otp
            WHERE identifier = @Id AND login_type = @LoginType AND is_used = 0
            ORDER BY pk_otp_id DESC LIMIT 1",
            new { Id = identifier, LoginType = loginType });

        if (otpRow == null)
            throw new InvalidOperationException("No OTP request found. Please request a new OTP.");

        var otpId = (int)otpRow.id;
        var storedOtp = (string)otpRow.otp_code;
        var attempts = (int)otpRow.attempts;
        var maxAttempts = (int)otpRow.max_attempts;
        var expiresAt = (DateTime)otpRow.expires_at;

        if (DateTime.UtcNow > expiresAt)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = otpId });
            throw new InvalidOperationException("OTP has expired. Please request a new one.");
        }

        if (attempts >= maxAttempts)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = otpId });
            throw new InvalidOperationException("Maximum OTP attempts exceeded. Please request a new one.");
        }

        if (storedOtp != dto.Otp.Trim())
        {
            await conn.ExecuteAsync(
                "UPDATE mobile_login_otp SET attempts = attempts + 1 WHERE pk_otp_id = @Id",
                new { Id = otpId });
            throw new InvalidOperationException($"Invalid OTP. {maxAttempts - attempts - 1} attempts remaining.");
        }

        // Mark used
        await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = otpId });

        int memberId = (int)otpRow.memberId;
        int? familyMemberId = otpRow.familyId == null ? null : (int?)otpRow.familyId;

        // Non-sync cascade login guard — deny if the member's only club went non-sync
        // (no active club_members, not in an exempt district, no global SA/ZC/RID role).
        await NonSyncLoginGuardHelper.EnsureCanLoginAsync(conn, memberId);

        // Re-check SuperAdmin policy (defense in depth — same rule as RequestOtp).
        // SA-only users are still blocked; SA + any other role/club membership is allowed
        // (mobile session strips SA via BuildMemberScopesAsync filter).
        var isSuperAdmin = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName = 'SuperAdmin'
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId });

        if (isSuperAdmin > 0)
        {
            var hasOtherUsableRole = await conn.ExecuteScalarAsync<int>(@"
                SELECT
                    (SELECT COUNT(*) FROM member_roles mr
                     JOIN roles r ON r.pk_role_id = mr.fk_role_id
                     WHERE mr.fk_member_master_profile_id = @MemberId
                       AND r.RoleName <> 'SuperAdmin'
                       AND mr.IsActive = 1 AND mr.isdeleted = 0)
                  + (SELECT COUNT(*) FROM club_members
                     WHERE fk_member_master_profile_id = @MemberId
                       AND IsActive = 1 AND isdeleted = 0)",
                new { MemberId = memberId });

            if (hasOtherUsableRole == 0)
                throw new UnauthorizedAccessException("SuperAdmin cannot login on mobile. Please use the web portal.");
        }

        // Re-check chain kill-switch (defense in depth — same rule as RequestOtp).
        // RID is global — exempt. SA-with-other-role users go through this check normally.
        var isRidVerify = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName = 'RIDirector'
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId });
        if (isRidVerify == 0)
        {
            var hasActiveChainVerify = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*)
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE cm.fk_member_master_profile_id = @MemberId
                  AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND c.IsActive = 1 AND c.isdeleted = 0
                  AND d.IsActive = 1 AND d.isdeleted = 0
                  AND z.IsActive = 1 AND z.isdeleted = 0",
                new { MemberId = memberId });
            if (hasActiveChainVerify == 0)
                throw new UnauthorizedAccessException("Your zone, district, or club is currently inactive. Please contact your administrator.");
        }

        // Load member basic info (the rotarian's profile)
        var memberInfo = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MemberName, EmailId, PrimaryMobileNumber
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = memberId });

        if (memberInfo == null)
            throw new InvalidOperationException("Member profile not found.");

        // For family login, override displayed name/email/mobile with the family member's own
        // details (the mobile app shows whatever's in MemberName as the logged-in user).
        string displayName = (string)memberInfo.MemberName ?? "";
        string? displayEmail = (string?)memberInfo.EmailId;
        string? displayMobile = (string?)memberInfo.PrimaryMobileNumber;
        if (loginType == "family" && familyMemberId.HasValue)
        {
            var fam = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT Name, EmailId, PhoneNumber
                FROM member_family_details
                WHERE pk_member_family_details_id = @Id AND isdeleted = 0",
                new { Id = familyMemberId.Value });
            if (fam != null)
            {
                displayName = (string?)fam.Name ?? displayName;
                displayEmail = (string?)fam.EmailId ?? displayEmail;
                displayMobile = (string?)fam.PhoneNumber ?? displayMobile;
            }
        }

        // Build full scoped roles (elevated + implicit Member from club_members + expansion)
        var scopes = await BuildMemberScopesAsync(conn, memberId);

        // Distinct role names (for JWT claim + backward compat)
        var roles = scopes.Roles.Select(r => r.RoleName).Distinct().ToList();
        if (loginType == "family" && !roles.Contains("Member"))
            roles.Add("Member");

        // ── Upsert device session ──
        var now = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(dto.Imei))
        {
            await conn.ExecuteAsync(@"
                INSERT INTO member_device_sessions
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
                    last_logout = NULL",
                new
                {
                    MemberId = memberId,
                    FamilyId = familyMemberId,
                    Imei = dto.Imei,
                    DevToken = dto.DeviceToken,
                    DevName = dto.DeviceName,
                    AppVer = dto.AppVersion,
                    Now = now
                });
        }

        // ── Update member profile summary columns ──
        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET MobileLoginCount = COALESCE(MobileLoginCount, 0) + 1,
                LastImei = @Imei,
                -- GUARD: a login that supplies no FCM token (permission denied / token
                -- not ready yet) must NOT wipe the member's existing token, or push reach
                -- collapses over time. Keep the stored value when @DevToken is null/blank.
                LastDeviceToken = COALESCE(NULLIF(TRIM(@DevToken), ''), LastDeviceToken),
                LastDeviceName = @DevName,
                FirstMobileVisit = COALESCE(FirstMobileVisit, @Now),
                LastMobileVisit = @Now
            WHERE pk_member_master_profile_id = @MemberId",
            new
            {
                MemberId = memberId,
                Imei = dto.Imei,
                DevToken = dto.DeviceToken,
                DevName = dto.DeviceName,
                Now = now
            });

        // ── Generate Mobile JWT ──
        var expiresAtUtc = DateTime.UtcNow.AddDays(MobileJwtDays);
        var token = GenerateMobileJwtToken(
            memberId,
            displayName,
            displayEmail ?? "",
            roles,
            loginType == "family" ? "family" : "member",
            familyMemberId,
            dto.Imei,
            expiresAtUtc);

        return new MobileVerifyOtpResponse
        {
            Token = token,
            ExpiresAt = expiresAtUtc,
            MemberId = memberId,
            MemberName = displayName,
            Email = displayEmail,
            Mobile = displayMobile,
            MemberType = loginType == "family" ? "family" : "member",
            FamilyMemberId = familyMemberId,
            RoleNames = roles,
            Roles = scopes.Roles,
            AccessibleZones = scopes.Zones,
            AccessibleDistricts = scopes.Districts,
            AccessibleClubs = scopes.Clubs,
            DistrictClubAccess = scopes.DistrictClubAccess,
            MemberMobileDashboard = scopes.MemberMobileDashboard
        };
    }

    // ══════════════════════════════════════════════════════════════
    // Logout
    // ══════════════════════════════════════════════════════════════
    public async Task LogoutAsync(int memberId, string? imei)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var now = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(imei))
        {
            await conn.ExecuteAsync(@"
                UPDATE member_device_sessions
                SET last_logout = @Now, is_active = 0
                WHERE fk_member_master_profile_id = @MemberId AND imei = @Imei",
                new { MemberId = memberId, Imei = imei, Now = now });
        }

        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET LastMobileLogout = @Now
            WHERE pk_member_master_profile_id = @MemberId",
            new { MemberId = memberId, Now = now });
    }

    // ══════════════════════════════════════════════════════════════
    // My Context (shared between web + mobile)
    // ══════════════════════════════════════════════════════════════
    public async Task<MyContextResponse> GetMyContextAsync(int memberId, int? familyMemberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MemberName, EmailId, PrimaryMobileNumber, fk_primary_country_id AS countryId
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = memberId });

        if (member == null)
            throw new KeyNotFoundException("Member not found.");

        // For family-member sessions, display the family member's own name/email/mobile (not the rotarian's).
        string displayName = (string?)member.MemberName ?? "";
        string? displayEmail = (string?)member.EmailId;
        string? displayMobile = (string?)member.PrimaryMobileNumber;
        if (familyMemberId.HasValue)
        {
            var fam = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT Name, EmailId, PhoneNumber
                FROM member_family_details
                WHERE pk_member_family_details_id = @Id AND isdeleted = 0",
                new { Id = familyMemberId.Value });
            if (fam != null)
            {
                displayName = (string?)fam.Name ?? displayName;
                displayEmail = (string?)fam.EmailId ?? displayEmail;
                displayMobile = (string?)fam.PhoneNumber ?? displayMobile;
            }
        }

        // my-context INCLUDES SuperAdmin (excludeSuperAdmin:false, 2026-08-14) so the mobile app can
        // show the SuperAdmin module (→ web SSO handoff). The mobile JWT itself still STRIPS SA
        // (VerifyOtp uses BuildMemberScopesAsync=true), so no mobile endpoint gains SA access — this
        // only surfaces the role so the app knows to offer the "open web" jump. Web already has SA via its JWT.
        var scopes = await MemberScopesHelper.BuildScopesAsync(conn, memberId, excludeSuperAdmin: false);

        return new MyContextResponse
        {
            MemberId = memberId,
            MemberName = displayName,
            Email = displayEmail,
            Mobile = displayMobile,
            CountryId = member.countryId == null ? null : (int?)member.countryId,
            MemberType = familyMemberId.HasValue ? "family" : "member",
            FamilyMemberId = familyMemberId,
            Roles = scopes.Roles,
            AccessibleZones = scopes.Zones,
            AccessibleDistricts = scopes.Districts,
            AccessibleClubs = scopes.Clubs,
            DistrictClubAccess = scopes.DistrictClubAccess,
            MemberMobileDashboard = scopes.MemberMobileDashboard
        };
    }

    // ══════════════════════════════════════════════════════════════
    // Build member scopes (roles + accessible zones/districts/clubs)
    // Mobile-side wrapper around the shared MemberScopesHelper. Mobile sessions
    // pass excludeSuperAdmin=true because SA is web-only — if the member is
    // SA + Admin/CM/AG/etc, the mobile session sees only the non-SA roles.
    // SA-only users are blocked earlier at request/verify time.
    // ══════════════════════════════════════════════════════════════
    private Task<MemberScopesHelper.MemberScopesResult> BuildMemberScopesAsync(MySqlConnection conn, int memberId)
        => MemberScopesHelper.BuildScopesAsync(conn, memberId, excludeSuperAdmin: true);

    // ══════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════
    private static string GenerateOtp()
    {
        var random = new Random();
        return random.Next(100000, 1000000).ToString();
    }

    private string GenerateMobileJwtToken(
        int memberId, string name, string email, List<string> roles,
        string memberType, int? familyMemberId, string? imei,
        DateTime expiresAtUtc)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secret = jwtSettings["Secret"]!;
        var issuer = jwtSettings["Issuer"];
        var audience = jwtSettings["Audience"];

        var claims = new List<Claim>
        {
            new("memberId", memberId.ToString()),
            new("name", name),
            new("email", email),
            new("roles", string.Join(",", roles)),
            new("loginType", "mobile"),
            new("memberType", memberType)
        };

        if (familyMemberId.HasValue)
            claims.Add(new Claim("familyMemberId", familyMemberId.Value.ToString()));

        if (!string.IsNullOrWhiteSpace(imei))
            claims.Add(new Claim("imei", imei));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: expiresAtUtc,
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

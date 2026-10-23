using System.Data;
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
    private readonly ILogger<MobileAuthService> _logger;
    private readonly string _connectionString;

    // Mobile JWT lifetime (ROW 2026-10-19): 90 days, the same as MobileJwtRefreshMiddleware, which re-issues the
    // token daily for active users. The original platform issued 10-year tokens that could not be revoked one by one; a lost
    // phone's token now expires 90 days after its last use.
    private const int MobileJwtDays = 90;
    private const int OtpExpiryMinutes = 5;

    public MobileAuthService(
        IConfiguration configuration,
        IEmailService emailService,
        ILogger<MobileAuthService> logger)
    {
        _configuration = configuration;
        _emailService = emailService;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ══════════════════════════════════════════════════════════════
    // Password login (email + password, every member; ROW 2026-10-19)
    // ══════════════════════════════════════════════════════════════

    // Compared against when no account matches, so a wrong email costs the same BCrypt time as a wrong password.
    private static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword("row-timing-equaliser");

    public async Task<MobileVerifyOtpResponse> LoginWithPasswordAsync(MobilePasswordLoginDto dto)
    {
        const string invalid = "Invalid email or password.";
        var email = (dto.Email ?? "").Trim();
        if (email.Length == 0 || string.IsNullOrEmpty(dto.Password))
            throw new ArgumentException("Email and password are required.");

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_member_by_email", new { p_Email = email }, commandType: CommandType.StoredProcedure);
        var cred = member == null ? null : await conn.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_credentials", new { p_MemberId = (int)member.Id }, commandType: CommandType.StoredProcedure);
        if (cred == null)
        {
            BCrypt.Net.BCrypt.Verify(dto.Password, DummyHash);
            throw new UnauthorizedAccessException(invalid);
        }

        int memberId = (int)member!.Id;
        int credId = (int)cred.Id;
        int failed = cred.FailedLoginAttempts != null ? Convert.ToInt32(cred.FailedLoginAttempts) : 0;
        DateTime? lockoutEnd = cred.LockoutEndTime as DateTime?;
        // Same lockout as the web login: 5 wrong passwords lock the account for 15 minutes.
        if (failed >= 5 && lockoutEnd != null && lockoutEnd > DateTime.UtcNow)
            throw new UnauthorizedAccessException("Account is locked due to multiple failed login attempts. Please try again later.");

        if (!BCrypt.Net.BCrypt.Verify(dto.Password, (string)cred.PasswordHash))
        {
            failed++;
            await conn.ExecuteAsync("sp_auth_update_failed_login",
                new { p_CredId = credId, p_Attempts = failed, p_Lockout = failed >= 5 ? DateTime.UtcNow.AddMinutes(15) : (DateTime?)null },
                commandType: CommandType.StoredProcedure);
            throw new UnauthorizedAccessException(invalid);
        }

        await conn.ExecuteAsync("sp_auth_update_success_login", new { p_CredId = credId }, commandType: CommandType.StoredProcedure);

        return await IssueSessionAsync(conn, memberId, null, "member", new MobileVerifyOtpDto
        {
            Imei = dto.Imei, DeviceToken = dto.DeviceToken, DeviceName = dto.DeviceName, AppVersion = dto.AppVersion,
        });
    }

    // Login guards, device session and the mobile JWT, shared by OTP and password sign-in.
    private async Task<MobileVerifyOtpResponse> IssueSessionAsync(
        MySqlConnection conn, int memberId, int? familyMemberId, string loginType, MobileVerifyOtpDto dto)
    {

        // Non-sync cascade login guard — deny if the member's only club went non-sync
        // (no active club_members, not in an exempt district, no global SA role).
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
        // SA-with-other-role users go through this check normally.
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

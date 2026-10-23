using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.IdentityModel.Tokens;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class AuthService : IAuthService
{
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;
    private readonly IEmailService _emailService;
    private readonly ILogger<AuthService> _logger;

    public AuthService(IConfiguration configuration, IEmailService emailService, ILogger<AuthService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _configuration = configuration;
        _emailService = emailService;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<LoginResponseDto> LoginAsync(LoginRequestDto request, string? ipAddress = null, string? userAgent = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // TEMPORARY allowlist gate — see LoginAllowlistHelper for details.
        // Set LoginAllowlist:Enabled=false in appsettings.json to remove the gate.
        await LoginAllowlistHelper.EnsureMobileAllowedAsync(
            _configuration, connection, request.MobileNumber, request.Email);

        string emailOrMobile = request.Email ?? $"{request.CountryCode}{request.MobileNumber}";

        // Find member by email or by countryCode + mobile
        int memberId;
        string memberName;
        string email;

        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
                "sp_auth_get_member_by_email",
                new { p_Email = request.Email },
                commandType: CommandType.StoredProcedure);
            if (member == null)
            {
                await LogLoginAudit(connection, null, null, emailOrMobile, ipAddress, userAgent, "failed", "Member not found");
                throw new UnauthorizedAccessException("Invalid credentials.");
            }

            memberId = (int)member.Id;
            memberName = (string)member.MemberName;
            email = (string)member.EmailId;
        }
        else if (!string.IsNullOrWhiteSpace(request.CountryCode) && !string.IsNullOrWhiteSpace(request.MobileNumber))
        {
            var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
                "sp_auth_get_member_by_mobile",
                new { p_CountryCode = request.CountryCode, p_MobileNumber = request.MobileNumber },
                commandType: CommandType.StoredProcedure);
            if (member == null)
            {
                await LogLoginAudit(connection, null, null, emailOrMobile, ipAddress, userAgent, "failed", "Member not found");
                throw new UnauthorizedAccessException("Invalid credentials.");
            }

            memberId = (int)member.Id;
            memberName = (string)member.MemberName;
            email = (string)(member.EmailId ?? "");
        }
        else
        {
            throw new ArgumentException("Email or CountryCode + MobileNumber is required.");
        }

        // Check member has an active admin role
        // Using inline SQL instead of SP to avoid stale SP issue (SYSTEM_USER privilege prevents SP update)
        var roles = (await connection.QueryAsync<string>(
            @"SELECT r.RoleName FROM member_roles mr
              JOIN roles r ON r.pk_role_id = mr.fk_role_id
              WHERE mr.fk_member_master_profile_id = @Id
                AND mr.IsActive = 1 AND mr.isdeleted = 0
                AND r.RoleName IN ('Admin', 'SuperAdmin', 'AG')",
            new { Id = memberId })).ToList();
        // N7: a governor-, president- or secretary-elect with no admin role signs in to plan next year (lands on /planning)
        if (roles.Count == 0 && await PlanningAccess.IsElectAsync(connection, _connectionString, memberId)) roles.Add("Elect");
        if (roles.Count == 0)
        {
            await LogLoginAudit(connection, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "No admin role");
            throw new UnauthorizedAccessException("You do not have permission to access the admin panel.");
        }

        // Get credentials
        var cred = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_credentials",
            new { p_MemberId = memberId },
            commandType: CommandType.StoredProcedure);
        if (cred == null)
        {
            await LogLoginAudit(connection, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "No credentials");
            throw new UnauthorizedAccessException("No credentials found. Please contact administrator.");
        }

        int credId = (int)cred.Id;
        string passwordHash = (string)cred.PasswordHash;
        bool isTemporary = cred.IsTemporaryPassword != null && Convert.ToBoolean(cred.IsTemporaryPassword);
        int failedAttempts = cred.FailedLoginAttempts != null ? Convert.ToInt32(cred.FailedLoginAttempts) : 0;
        DateTime? lockoutEnd = cred.LockoutEndTime as DateTime?;

        // Check lockout
        if (failedAttempts >= 5 && lockoutEnd != null && lockoutEnd > DateTime.UtcNow)
        {
            await LogLoginAudit(connection, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "Account locked");
            throw new UnauthorizedAccessException("Account is locked due to multiple failed login attempts. Please try again later.");
        }

        // Verify password
        if (!BCrypt.Net.BCrypt.Verify(request.Password, passwordHash))
        {
            // Increment failed attempts
            failedAttempts++;
            var lockoutTime = failedAttempts >= 5 ? DateTime.UtcNow.AddMinutes(15) : (DateTime?)null;
            await connection.ExecuteAsync(
                "sp_auth_update_failed_login",
                new { p_CredId = credId, p_Attempts = failedAttempts, p_Lockout = lockoutTime },
                commandType: CommandType.StoredProcedure);

            await LogLoginAudit(connection, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "Wrong password");
            throw new UnauthorizedAccessException("Invalid credentials.");
        }

        // Kill-switch: block login if user's entire club→district→zone chain is inactive.
        // SuperAdmin is a global role — never blocked regardless of zone status.
        // At least one chain must be fully active (cm.IsActive=1 AND c.IsActive=1 AND d.IsActive=1 AND z.IsActive=1).
        bool isLoginExempt = roles.Contains("SuperAdmin");
        if (!isLoginExempt)
        {
            var hasActiveChain = await connection.ExecuteScalarAsync<int>(@"
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
            if (hasActiveChain == 0)
            {
                await LogLoginAudit(connection, memberId, memberName, emailOrMobile, ipAddress, userAgent, "failed", "Zone/District/Club inactive");
                throw new UnauthorizedAccessException("Your zone, district, or club is currently inactive. Please contact your administrator.");
            }
        }

        // Get last login time BEFORE updating success login
        DateTime? lastLogin = null;
        try
        {
            lastLogin = await connection.QueryFirstOrDefaultAsync<DateTime?>(
                "sp_login_audit_get_last_login",
                new { p_MemberId = memberId },
                commandType: CommandType.StoredProcedure);
        }
        catch { /* SP may not exist yet on first run */ }

        // Success: reset failed attempts and update last login
        await connection.ExecuteAsync(
            "sp_auth_update_success_login",
            new { p_CredId = credId },
            commandType: CommandType.StoredProcedure);

        // Log successful login
        await LogLoginAudit(connection, memberId, memberName, emailOrMobile, ipAddress, userAgent, "success", null);

        // Generate JWT
        var expiryMinutes = int.Parse(_configuration["JwtSettings:ExpiryMinutes"] ?? "480");
        var token = GenerateJwtToken(memberId, memberName, email, roles);

        // Build full scope data so the web client can render the dashboard switcher
        // and route to the right club/district without extra round-trips.
        // Web keeps SuperAdmin (excludeSuperAdmin=false) — it's the headline web role.
        var scopes = await MemberScopesHelper.BuildScopesAsync(connection, memberId, excludeSuperAdmin: false);

        return new LoginResponseDto
        {
            Token = token,
            MemberName = memberName,
            Email = email,
            MemberId = memberId,
            Roles = roles,
            IsTemporaryPassword = isTemporary,
            LastLoginTime = lastLogin,
            SessionExpiryMinutes = expiryMinutes,
            ScopedRoles = scopes.Roles,
            AccessibleZones = scopes.Zones,
            AccessibleDistricts = scopes.Districts,
            AccessibleClubs = scopes.Clubs,
            DistrictClubAccess = scopes.DistrictClubAccess
        };
    }

    // Build a full WEB session for a member without a password — for the mobile→web SSO handoff.
    // Reuses the exact same JWT + scope assembly as LoginAsync so the frontend routing works unchanged.
    public async Task<LoginResponseDto?> BuildSessionForMemberAsync(int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = memberId });
        if (member == null) return null;
        string memberName = (string?)member.MemberName ?? "";
        string email = (string?)member.EmailId ?? "";

        var roles = (await connection.QueryAsync<string>(
            @"SELECT r.RoleName FROM member_roles mr
              JOIN roles r ON r.pk_role_id = mr.fk_role_id
              WHERE mr.fk_member_master_profile_id = @Id
                AND mr.IsActive = 1 AND mr.isdeleted = 0
                AND r.RoleName IN ('Admin', 'SuperAdmin', 'AG')",
            new { Id = memberId })).ToList();
        if (roles.Count == 0 && await PlanningAccess.IsElectAsync(connection, _connectionString, memberId)) roles.Add("Elect");
        // no admin role → no web session
        if (roles.Count == 0) return null;

        var expiryMinutes = int.Parse(_configuration["JwtSettings:ExpiryMinutes"] ?? "480");
        var token = GenerateJwtToken(memberId, memberName, email, roles);
        var scopes = await MemberScopesHelper.BuildScopesAsync(connection, memberId, excludeSuperAdmin: false);

        return new LoginResponseDto
        {
            Token = token,
            MemberName = memberName,
            Email = email,
            MemberId = memberId,
            Roles = roles,
            IsTemporaryPassword = false,
            LastLoginTime = null,
            SessionExpiryMinutes = expiryMinutes,
            ScopedRoles = scopes.Roles,
            AccessibleZones = scopes.Zones,
            AccessibleDistricts = scopes.Districts,
            AccessibleClubs = scopes.Clubs,
            DistrictClubAccess = scopes.DistrictClubAccess
        };
    }

    private static async Task LogLoginAudit(MySqlConnection connection, int? memberId, string? memberName, string emailOrMobile, string? ipAddress, string? userAgent, string status, string? failureReason)
    {
        try
        {
            await connection.ExecuteAsync(
                "sp_login_audit_create",
                new
                {
                    p_MemberId = memberId,
                    p_MemberName = memberName ?? "",
                    p_EmailOrMobile = emailOrMobile ?? "",
                    p_IpAddress = ipAddress ?? "",
                    p_UserAgent = userAgent?.Length > 500 ? userAgent[..500] : userAgent ?? "",
                    p_Status = status,
                    p_FailureReason = failureReason ?? ""
                },
                commandType: CommandType.StoredProcedure);
        }
        catch
        {
            // Audit logging should never block login
        }
    }

    /// <param name="anyMember">true for the mobile app, where every member signs in with a password;
    /// false keeps the web portal rule (admin roles only).</param>
    public async Task<object> ForgotPasswordAsync(ForgotPasswordRequestDto request, bool anyMember = false)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Find member by email or mobile
        dynamic? member;
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            member = await connection.QueryFirstOrDefaultAsync<dynamic>(
                "sp_auth_get_member_by_email",
                new { p_Email = request.Email },
                commandType: CommandType.StoredProcedure);
        }
        else if (!string.IsNullOrWhiteSpace(request.CountryCode) && !string.IsNullOrWhiteSpace(request.MobileNumber))
        {
            member = await connection.QueryFirstOrDefaultAsync<dynamic>(
                "sp_auth_get_member_by_mobile",
                new { p_CountryCode = request.CountryCode, p_MobileNumber = request.MobileNumber },
                commandType: CommandType.StoredProcedure);
        }
        else
        {
            return new { message = "If the account exists, a reset link has been sent to the registered email." };
        }

        // Always return same message to prevent enumeration
        if (member == null)
            return new { message = "If the account exists, a reset link has been sent to the registered email." };

        int memberId = (int)member.Id;
        string memberName = (string)member.MemberName;
        string memberEmail = (string)(member.EmailId ?? "");

        // Validate has an active admin role
        var roleCount = await connection.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM member_roles mr
              JOIN roles r ON r.pk_role_id = mr.fk_role_id
              WHERE mr.fk_member_master_profile_id = @Id
                AND mr.IsActive = 1 AND mr.isdeleted = 0
                AND r.RoleName IN ('Admin', 'SuperAdmin', 'AG')",
            new { Id = memberId });
        // N7: an elect member sets a first password here to sign in and plan next year
        if (roleCount == 0 && await PlanningAccess.IsElectAsync(connection, _connectionString, memberId)) roleCount = 1;

        if ((!anyMember && roleCount == 0)
            || string.IsNullOrWhiteSpace(memberEmail))
            return new { message = "If the account exists, a reset link has been sent to the registered email." };

        // Generate token
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
        var expiry = DateTime.Now.AddMinutes(480);

        // Insert into password_reset_tokens
        await connection.ExecuteAsync(
            "sp_auth_create_reset_token",
            new { p_MemberId = memberId, p_Token = token, p_Expiry = expiry },
            commandType: CommandType.StoredProcedure);

        // Build reset link
        var frontendUrl = _configuration["FrontendUrl"] ?? "http://localhost:3000";
        var resetLink = $"{frontendUrl}/reset-password?token={Uri.EscapeDataString(token)}";

        // Send email (fire and forget - don't throw on failure)
        await _emailService.SendPasswordResetEmailAsync(memberEmail, memberName, resetLink);

        return new { message = "If the account exists, a reset link has been sent to the registered email." };
    }

    public async Task<object> ResetPasswordAsync(ResetPasswordRequestDto request)
    {
        if (request.NewPassword != request.ConfirmPassword)
            throw new ArgumentException("Passwords do not match.");

        ValidatePasswordComplexity(request.NewPassword);

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Find token
        var tokenRecord = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_valid_reset_token",
            new { p_Token = request.Token },
            commandType: CommandType.StoredProcedure);
        if (tokenRecord == null)
            throw new ArgumentException("Invalid or expired reset token.");

        int tokenId = (int)tokenRecord.Id;
        int memberId = (int)tokenRecord.MemberId;

        // Hash new password
        var newHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);

        // A member who never had a password (mobile sign-up via "Forgot password") gets a credentials row.
        await connection.ExecuteAsync(@"
            INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword)
            SELECT @Id, @Hash, 0 FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM member_credentials
                              WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0)",
            new { Id = memberId, Hash = newHash });

        // Update member_credentials
        await connection.ExecuteAsync(
            "sp_auth_reset_password",
            new { p_MemberId = memberId, p_Hash = newHash },
            commandType: CommandType.StoredProcedure);

        // Mark token as used
        await connection.ExecuteAsync(
            "sp_auth_mark_token_used",
            new { p_TokenId = tokenId },
            commandType: CommandType.StoredProcedure);

        return new { message = "Password reset successfully." };
    }

    public async Task<object> ChangePasswordAsync(int memberId, ChangePasswordRequestDto request)
    {
        if (request.NewPassword != request.ConfirmPassword)
            throw new ArgumentException("Passwords do not match.");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get current credentials
        var cred = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_credentials_for_change",
            new { p_MemberId = memberId },
            commandType: CommandType.StoredProcedure);
        if (cred == null)
            throw new InvalidOperationException("No credentials found.");

        string currentHash = (string)cred.PasswordHash;
        int credId = (int)cred.Id;

        // Verify current password
        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, currentHash))
            throw new UnauthorizedAccessException("Current password is incorrect.");

        // Validate new != current
        if (BCrypt.Net.BCrypt.Verify(request.NewPassword, currentHash))
            throw new ArgumentException("New password must be different from the current password.");

        ValidatePasswordComplexity(request.NewPassword);

        // Update hash
        var newHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        await connection.ExecuteAsync(
            "sp_auth_change_password",
            new { p_CredId = credId, p_Hash = newHash },
            commandType: CommandType.StoredProcedure);

        // Send password changed confirmation email
        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_role_get_member_email",
            new { p_MemberId = memberId },
            commandType: CommandType.StoredProcedure);
        if (member?.EmailId != null)
        {
            await _emailService.SendPasswordChangedEmailAsync(member.EmailId, member.MemberName);
        }

        return new { message = "Password changed successfully." };
    }

    public async Task<(List<LoginAuditLogDto> items, int totalCount)> GetLoginLogsAsync(
        string search, string status, DateTime? fromDate, DateTime? toDate, int page, int pageSize)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inline SQL — SP `sp_login_audit_get_logs` cannot be updated due to SYSTEM_USER privilege issue.
        // Adds optional fromDate/toDate filters; toDate is treated as inclusive of end-of-day.
        var offset = (page - 1) * pageSize;
        var fromDt = fromDate?.Date;
        var toDt = toDate?.Date.AddDays(1).AddSeconds(-1);

        var items = (await connection.QueryAsync<LoginAuditLogDto>(@"
            SELECT pk_log_id AS Id, fk_member_id AS MemberId, member_name AS MemberName,
                   email_or_mobile AS EmailOrMobile, login_time AS LoginTime,
                   ip_address AS IpAddress, user_agent AS UserAgent,
                   login_status AS LoginStatus, failure_reason AS FailureReason
            FROM login_audit_logs
            WHERE (@Search = '' OR member_name LIKE CONCAT('%', @Search, '%')
                                  OR email_or_mobile LIKE CONCAT('%', @Search, '%'))
              AND (@Status = '' OR login_status = @Status)
              AND (@FromDt IS NULL OR login_time >= @FromDt)
              AND (@ToDt   IS NULL OR login_time <= @ToDt)
            ORDER BY login_time DESC
            LIMIT @PageSize OFFSET @Offset",
            new { Search = search ?? "", Status = status ?? "", FromDt = fromDt, ToDt = toDt, PageSize = pageSize, Offset = offset })).ToList();

        var totalCount = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM login_audit_logs
            WHERE (@Search = '' OR member_name LIKE CONCAT('%', @Search, '%')
                                  OR email_or_mobile LIKE CONCAT('%', @Search, '%'))
              AND (@Status = '' OR login_status = @Status)
              AND (@FromDt IS NULL OR login_time >= @FromDt)
              AND (@ToDt   IS NULL OR login_time <= @ToDt)",
            new { Search = search ?? "", Status = status ?? "", FromDt = fromDt, ToDt = toDt });

        return (items, totalCount);
    }

    private string GenerateJwtToken(int memberId, string name, string email, List<string> roles)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secret = jwtSettings["Secret"]!;
        var issuer = jwtSettings["Issuer"];
        var audience = jwtSettings["Audience"];
        var expiryMinutes = int.Parse(jwtSettings["ExpiryMinutes"] ?? "480");

        var claims = new List<Claim>
        {
            new("memberId", memberId.ToString()),
            new("name", name),
            new("email", email),
            new("roles", string.Join(",", roles))
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiryMinutes),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static void ValidatePasswordComplexity(string password)
    {
        if (password.Length < 8)
            throw new ArgumentException("Password must be at least 8 characters long.");
        if (!Regex.IsMatch(password, @"[A-Z]"))
            throw new ArgumentException("Password must contain at least one uppercase letter.");
        if (!Regex.IsMatch(password, @"[a-z]"))
            throw new ArgumentException("Password must contain at least one lowercase letter.");
        if (!Regex.IsMatch(password, @"[0-9]"))
            throw new ArgumentException("Password must contain at least one digit.");
        if (!Regex.IsMatch(password, @"[^a-zA-Z0-9]"))
            throw new ArgumentException("Password must contain at least one special character.");
    }
}

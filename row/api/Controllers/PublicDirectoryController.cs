using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using MySqlConnector;
using RotaryApi.Services;
using System.Globalization;
using System.Text.Json;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/public/directory")]
[AllowAnonymous]
public class PublicDirectoryController : ControllerBase
{
    // login_type column is VARCHAR(20) — both values below must stay ≤20 chars
    private const string LoginType = "directory_form";           // 14 chars
    private const string LoginTypeSession = "dir_form_sess";     // 13 chars
    private const int OtpExpiryMinutes = 10;

    private readonly string _connectionString;
    private readonly IConfiguration _config;
    private readonly IEmailService _email;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<PublicDirectoryController> _logger;
    private readonly string _apiBase;
    private readonly string _publicFrontendBase;
    private readonly AdminProxyTokenSigner _adminProxySigner;
    private readonly IMemoryCache _cache;

    public PublicDirectoryController(
        IConfiguration config,
        IEmailService email,
        IWebHostEnvironment env,
        ILogger<PublicDirectoryController> logger,
        AdminProxyTokenSigner adminProxySigner,
        IMemoryCache cache)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _email = email;
        _env = env;
        _logger = logger;
        // Same fallback chain as _publicFrontendBase. Without this, image URLs
        // embedded in submit-confirmation emails resolved to http://localhost:5000
        // whenever the Api section wasn't loaded — recipient's browser showed a
        // broken image. BackendUrl is set in both appsettings.json and
        // appsettings.Production.json so this always lands on portal.example.org/API.
        _apiBase = config["Api:BaseUrl"]
                   ?? config["BackendUrl"]
                   ?? RotaryApi.Services.Brand.ApiOrigin;
        // Fallback chain: PublicFrontend:BaseUrl → FrontendUrl → hard prod URL.
        // FrontendUrl is set in both appsettings.json and appsettings.Production.json,
        // so even if env=Production isn't applied we still resolve to portal.example.org
        // instead of leaking a localhost / legacy URL into emails and copy-link buttons.
        _publicFrontendBase = config["PublicFrontend:BaseUrl"]
                              ?? config["FrontendUrl"]
                              ?? RotaryApi.Services.Brand.PortalOrigin;
        _adminProxySigner = adminProxySigner;
        _cache = cache;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Step 0: verify URL and show district + year (no PII)
    [HttpGet("{urlHash}")]
    public async Task<ActionResult> GetConfig(string urlHash)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.pk_id AS id, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
                   CAST(COALESCE(c.IsActive, 1) AS SIGNED) AS isActive,
                   c.FirstContactName AS firstContactName, c.FirstContactMobile AS firstContactMobile,
                   c.SecondContactName AS secondContactName, c.SecondContactMobile AS secondContactMobile
            FROM district_directory_config c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.UrlHash = @urlHash AND c.isdeleted = 0",
            new { urlHash });
        if (cfg == null) return NotFound(new { message = "Invalid or expired link." });
        // Disabled by the district admin → tell the client to show a "Link is closed" screen
        // (200 so the page renders a clean message instead of a generic error).
        if (Convert.ToInt32(((IDictionary<string, object?>)cfg)["isActive"]) == 0)
            return Ok(new { closed = true, districtNumber = ((IDictionary<string, object?>)cfg)["districtNumber"], yearLabel = ((IDictionary<string, object?>)cfg)["yearLabel"] });
        return Ok(cfg);
    }

    // Admin-proxy login (?fetch=admin URL flow). The 2 contact persons configured on this
    // district_directory_config row can log in with their mobile + password set by SuperAdmin.
    // Returns a short-lived signed token the frontend includes in the eventual /submit call —
    // the existing per-member OTP step is then bypassed for this session.
    // Lockout: 5 failed attempts per (urlHash, mobile) within 15 minutes (in-memory).
    public class AdminLoginRequest
    {
        public string Mobile { get; set; } = "";
        public string Password { get; set; } = "";
    }

    [HttpPost("{urlHash}/admin-login")]
    public async Task<ActionResult> AdminLogin(string urlHash, [FromBody] AdminLoginRequest req)
    {
        var mobile = (req.Mobile ?? "").Trim();
        var password = req.Password ?? "";
        if (string.IsNullOrEmpty(mobile) || string.IsNullOrEmpty(password))
            return BadRequest(new { message = "Mobile and password are required." });

        // Lockout check FIRST — prevents brute-forcing the password column.
        var lockoutKey = $"adminproxy-lockout:{urlHash}:{mobile}";
        if (_cache.TryGetValue<int>(lockoutKey, out var fails) && fails >= 5)
            return StatusCode(429, new { message = "Too many failed attempts. Try again in 15 minutes." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.FirstContactMobile AS firstMobile, c.FirstContactPasswordHash AS firstHash,
                   c.SecondContactMobile AS secondMobile, c.SecondContactPasswordHash AS secondHash
            FROM district_directory_config c
            WHERE c.UrlHash = @urlHash AND c.isdeleted = 0",
            new { urlHash });
        if (cfg == null) return NotFound(new { message = "Invalid link" });

        string? matchedHash = null;
        string? slot = null;
        if (string.Equals((string?)cfg.firstMobile, mobile, StringComparison.Ordinal))
        {
            matchedHash = (string?)cfg.firstHash;
            slot = "first";
        }
        else if (string.Equals((string?)cfg.secondMobile, mobile, StringComparison.Ordinal))
        {
            matchedHash = (string?)cfg.secondHash;
            slot = "second";
        }

        if (matchedHash == null || !AdminProxyAuth.VerifyPassword(password, matchedHash))
        {
            // Record failed attempt — single counter per (urlHash, mobile) with 15-min sliding window.
            var newFails = (fails + 1);
            _cache.Set(lockoutKey, newFails, TimeSpan.FromMinutes(15));
            return Unauthorized(new { message = "Invalid credentials." });
        }

        // Success — clear failed counter, issue token. 2-hour TTL lets the admin fill multiple
        // members in one session without re-logging in.
        _cache.Remove(lockoutKey);
        var token = _adminProxySigner.Issue(urlHash, mobile, slot!, TimeSpan.FromHours(2));
        return Ok(new
        {
            adminToken = token,
            expiresAt = DateTimeOffset.UtcNow.AddHours(2).ToUnixTimeSeconds(),
            slot,
        });
    }

    // Step 1: smart search members within the district
    [HttpGet("{urlHash}/search")]
    public async Task<ActionResult> Search(string urlHash, [FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
            return Ok(Array.Empty<object>());

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var districtId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM district_directory_config WHERE UrlHash = @urlHash AND isdeleted = 0 AND COALESCE(IsActive, 1) = 1",
            new { urlHash });
        if (districtId == null) return NotFound(new { message = "Invalid link" });

        var like = $"%{q.Trim()}%";
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS name,
                   c.ClubName AS clubName
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                 AND cm.IsActive = 1 AND (cm.isdeleted IS NULL OR cm.isdeleted = 0)
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE c.fk_district_id = @districtId
              AND (m.isdeleted IS NULL OR m.isdeleted = 0)
              AND m.MemberName LIKE @like
            ORDER BY m.MemberName
            LIMIT 25",
            new { districtId, like });
        return Ok(rows);
    }

    // Step 2: return masked mobile + email so user can confirm identity before requesting OTP
    [HttpGet("{urlHash}/member/{memberId:int}/masked")]
    public async Task<ActionResult> GetMasked(string urlHash, int memberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await ValidateUrl(conn, urlHash)) return NotFound();

        var m = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.MemberName AS name, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   m.fk_primary_country_id AS countryId
            FROM member_master_profile m
            WHERE m.pk_member_master_profile_id = @memberId AND (m.isdeleted IS NULL OR m.isdeleted = 0)",
            new { memberId });
        if (m == null) return NotFound();

        // India = SMS-only, outside India = Email-only (see SendOtp below for the
        // actual routing). Exposed here so the form can label the "Send OTP" action
        // correctly instead of offering channels that will now never be used.
        int? countryId = m.countryId == null ? null : (int?)m.countryId;
        // ROW: the first channel of Brand:Providers:OtpPolicy for the member's country (see OtpChannelPolicy).
        var otpChannel = (await OtpChannelPolicy.ChannelsForAsync(conn, countryId)).FirstOrDefault(c => c is "email" or "sms") ?? "email";

        return Ok(new
        {
            name = (string)m.name,
            maskedMobile = DirectoryDataCollectionFields.MaskMobile((string?)m.mobile),
            maskedEmail = DirectoryDataCollectionFields.MaskEmail((string?)m.email),
            hasMobile = !string.IsNullOrWhiteSpace((string?)m.mobile),
            hasEmail = !string.IsNullOrWhiteSpace((string?)m.email),
            otpChannel,
        });
    }

    public class SendOtpRequest { public int MemberId { get; set; } public string Channel { get; set; } = "both"; }

    // Step 3: send OTP via email + SMS (channel: "email"|"sms"|"both")
    [HttpPost("{urlHash}/send-otp")]
    public async Task<ActionResult> SendOtp(string urlHash, [FromBody] SendOtpRequest req)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await ValidateUrl(conn, urlHash)) return NotFound();

        var m = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MemberName AS name, PrimaryMobileNumber AS mobile, EmailId AS email,
                   fk_primary_country_id AS countryId
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @id AND (isdeleted IS NULL OR isdeleted = 0)",
            new { id = req.MemberId });
        if (m == null) return NotFound(new { message = "Member not found" });

        var name = (string)m.name;
        var mobile = (string?)m.mobile;
        var email = (string?)m.email;
        int? countryId = m.countryId == null ? null : (int?)m.countryId;

        var otp = new Random().Next(100000, 1000000).ToString(CultureInfo.InvariantCulture);
        var expiresAt = DateTime.UtcNow.AddMinutes(OtpExpiryMinutes);
        bool sentEmail = false, sentSms = false, sentWhatsApp = false;

        async Task<bool> TrySendOtpEmailAsync()
        {
            if (string.IsNullOrWhiteSpace(email)) return false;
            try
            {
                var body = $@"{EmailService.EMAIL_HEADER}
<h2 style='color:#1a365d;margin-top:0;'>District Directory — Data Collection OTP</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(name)},</p>
<p>Your one-time password (OTP) to access the District Directory data collection form is:</p>
<div style='background-color:#f7fafc;border:2px solid #3182ce;border-radius:8px;padding:20px;margin:16px 0;text-align:center;'>
  <p style='font-size:32px;font-weight:bold;color:#1a365d;letter-spacing:8px;margin:0;'>{otp}</p>
</div>
<p style='color:#e53e3e;'><strong>This OTP is valid for {OtpExpiryMinutes} minutes.</strong></p>
<p>If you did not request this OTP, please ignore this email.</p>
{EmailService.EMAIL_FOOTER}";
                await _email.SendGenericEmailAsync(email, "District Directory — Data Collection OTP", body);
                _logger.LogInformation("[OTP-EMAIL] sent to member {MemberId}", req.MemberId);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("📧 [OTP-EMAIL] ❌ {Name} → {Email} FAILED: {Error}", name, email, ex.Message);
                return false;
            }
        }

        // India = SMS OTP only, outside India = Email OTP only (business rule,
        // 2026-08-24). `req.Channel` from the request body is intentionally ignored
        // for routing — the member's own country now decides the single channel
        // used, so the old email/sms/both picker is no longer meaningful.
        //
        // NOTE: no cross-country fallback — a member missing all contact info for
        // their country's channel (e.g. an India member with no mobile on file)
        // gets the "could not send" error below rather than silently switching to
        // the other country's channel. Deliberate, per instruction 2026-08-24:
        // don't reactivate without asking first.
        // ROW: channels from Brand:Providers:OtpPolicy for the member's country, in order, until one succeeds.
        foreach (var channel in await OtpChannelPolicy.ChannelsForAsync(conn, countryId))
        {
            if (channel == "email")
            {
                sentEmail = await TrySendOtpEmailAsync();
            }
            if (sentEmail || sentSms) break;
        }

        if (!sentEmail && !sentSms && !sentWhatsApp)
            return StatusCode(500, new { message = "Could not send OTP via email or SMS. Please try again." });

        await conn.ExecuteAsync(@"
            INSERT INTO mobile_login_otp
                (fk_member_master_profile_id, login_type, identifier, country_id, otp_code, expires_at, sent_email, sent_sms)
            VALUES (@MemberId, @LoginType, @Identifier, @CountryId, @Otp, @ExpiresAt, @SentEmail, @SentSms)",
            new
            {
                MemberId = req.MemberId,
                LoginType,
                Identifier = $"directory:{urlHash}:{req.MemberId}",
                CountryId = countryId,
                Otp = otp,
                ExpiresAt = expiresAt,
                SentEmail = sentEmail,
                SentSms = sentSms,
            });

        return Ok(new
        {
            sentEmail,
            sentSms,
            sentWhatsApp,
            // debugOtp removed post-go-live: returning the OTP in the response
            // body let anyone with the public link bypass email/SMS delivery and
            // walk straight into the directory form. Keep this OUT — if you ever
            // need to re-enable for a controlled QA pass, add a config-gated
            // flag rather than always-on.
            expiresInSec = OtpExpiryMinutes * 60,
        });
    }

    public class VerifyOtpRequest { public int MemberId { get; set; } public string Otp { get; set; } = ""; }

    // Step 4: verify OTP → return form payload (allowed fields + current values + completion %)
    [HttpPost("{urlHash}/verify-otp")]
    public async Task<ActionResult> VerifyOtp(string urlHash, [FromBody] VerifyOtpRequest req)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var cfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId,
                   d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
                   COALESCE(c.DcFieldsJson, '[]') AS dcJson,
                   COALESCE(c.BodFieldsJson, '[]') AS bodJson,
                   COALESCE(c.MemberFieldsJson, '[]') AS memJson
            FROM district_directory_config c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.UrlHash = @urlHash AND c.isdeleted = 0",
            new { urlHash });
        if (cfg == null) return NotFound(new { message = "Invalid link" });

        var otpRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_otp_id AS id, otp_code, attempts, max_attempts, expires_at
            FROM mobile_login_otp
            WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0
            ORDER BY pk_otp_id DESC LIMIT 1",
            new { Identifier = $"directory:{urlHash}:{req.MemberId}", LoginType });
        if (otpRow == null) return BadRequest(new { message = "Please request an OTP first." });
        if (DateTime.UtcNow > (DateTime)otpRow.expires_at)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @id", new { id = (long)otpRow.id });
            return BadRequest(new { message = "OTP expired. Please request a new one." });
        }
        if ((int)otpRow.attempts >= (int)otpRow.max_attempts)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @id", new { id = (long)otpRow.id });
            return BadRequest(new { message = "Too many attempts. Please request a new OTP." });
        }
        if (((string)otpRow.otp_code) != req.Otp)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET attempts = attempts + 1 WHERE pk_otp_id = @id", new { id = (long)otpRow.id });
            return BadRequest(new { message = "Invalid OTP." });
        }
        await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @id", new { id = (long)otpRow.id });

        // Issue a short-lived session token so subsequent submit doesn't need OTP re-entry.
        // Store the token INSIDE the identifier (VARCHAR 200) because otp_code is VARCHAR(10).
        var sessionToken = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        var sessionExpiry = DateTime.UtcNow.AddMinutes(60);
        await conn.ExecuteAsync(@"
            INSERT INTO mobile_login_otp
                (fk_member_master_profile_id, login_type, identifier, country_id, otp_code, expires_at, sent_email, sent_sms, is_used)
            VALUES (@MemberId, @LoginType, @Identifier, NULL, 'S', @Exp, 0, 0, 0)",
            new
            {
                MemberId = req.MemberId,
                LoginType = LoginTypeSession,
                Identifier = $"dsess:{req.MemberId}:{sessionToken}",
                Exp = sessionExpiry,
            });

        int districtId = (int)cfg.districtId;
        int yearId = (int)cfg.yearId;
        int configId = (int)cfg.id;
        string group = await DirectoryDataCollectionFields.ResolveGroupAsync(conn, req.MemberId, districtId, yearId);
        var keys = DirectoryDataCollectionFields.GroupKeys(group, (string)cfg.dcJson, (string)cfg.bodJson, (string)cfg.memJson);
        var values = await DirectoryDataCollectionFields.LoadValuesAsync(conn, req.MemberId, keys);

        // Spouse-not-applicable: load saved flag and exclude Family fields from the completion calc.
        // Form still receives the Family fields (frontend hides/shows based on the flag).
        bool spouseNotApplicable = await DirectoryDataCollectionFields.GetSpouseNotApplicableAsync(conn, configId, req.MemberId);
        bool hasSpouseFields = DirectoryDataCollectionFields.ConfigIncludesSpouseFields(keys);
        var effectiveKeys = DirectoryDataCollectionFields.ApplySpouseNotApplicable(keys, spouseNotApplicable);
        var (filled, total, pending) = DirectoryDataCollectionFields.ComputeCompletion(values, effectiveKeys);

        var fieldsPayload = keys
            .Select(DirectoryDataCollectionFields.GetField).Where(f => f != null).Cast<DirectoryDataCollectionFields.FieldDef>()
            // Render in canonical field order (AllFields order) so grouping-by-section is stable and
            // e.g. Anniversary Date always sits right below Spouse Date of Birth in the Family section,
            // regardless of the order the keys were saved in the config JSON.
            .OrderBy(f => DirectoryDataCollectionFields.AllFields.IndexOf(f))
            .Select(f => new
            {
                key = f.Key,
                label = f.Label,
                section = f.Section,
                type = f.Type,
                value = values.TryGetValue(f.Key, out var v) ? v : null,
            }).ToList();

        return Ok(new
        {
            sessionToken,
            memberId = req.MemberId,
            group,
            yearLabel = (string)cfg.yearLabel,
            districtNumber = (string)cfg.districtNumber,
            fields = fieldsPayload,
            spouseNotApplicable,
            hasSpouseFields,
            completion = new { filled, total, percent = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0, pending },
        });
    }

    // Admin-proxy: load form fields for a chosen member WITHOUT OTP. Mirrors the latter half of
    // VerifyOtp (after OTP is verified) — same response shape minus sessionToken, since the admin
    // will keep using their adminToken on the subsequent /submit call.
    public class AdminLoadFieldsRequest
    {
        public int MemberId { get; set; }
        public string AdminToken { get; set; } = "";
    }

    [HttpPost("{urlHash}/admin-load-fields")]
    public async Task<ActionResult> AdminLoadFields(string urlHash, [FromBody] AdminLoadFieldsRequest req)
    {
        var payload = _adminProxySigner.Validate(req.AdminToken);
        if (payload == null || !string.Equals(payload.UrlHash, urlHash, StringComparison.Ordinal))
            return Unauthorized(new { message = "Admin session expired. Please log in again." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId,
                   d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
                   COALESCE(c.DcFieldsJson, '[]') AS dcJson,
                   COALESCE(c.BodFieldsJson, '[]') AS bodJson,
                   COALESCE(c.MemberFieldsJson, '[]') AS memJson
            FROM district_directory_config c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.UrlHash = @urlHash AND c.isdeleted = 0",
            new { urlHash });
        if (cfg == null) return NotFound(new { message = "Invalid link" });

        int districtId = (int)cfg.districtId;
        int yearId = (int)cfg.yearId;
        int configId = (int)cfg.id;
        string group = await DirectoryDataCollectionFields.ResolveGroupAsync(conn, req.MemberId, districtId, yearId);
        var keys = DirectoryDataCollectionFields.GroupKeys(group, (string)cfg.dcJson, (string)cfg.bodJson, (string)cfg.memJson);
        var values = await DirectoryDataCollectionFields.LoadValuesAsync(conn, req.MemberId, keys);
        bool spouseNotApplicable = await DirectoryDataCollectionFields.GetSpouseNotApplicableAsync(conn, configId, req.MemberId);
        bool hasSpouseFields = DirectoryDataCollectionFields.ConfigIncludesSpouseFields(keys);
        var effectiveKeys = DirectoryDataCollectionFields.ApplySpouseNotApplicable(keys, spouseNotApplicable);
        var (filled, total, pending) = DirectoryDataCollectionFields.ComputeCompletion(values, effectiveKeys);

        var fieldsPayload = keys
            .Select(DirectoryDataCollectionFields.GetField).Where(f => f != null).Cast<DirectoryDataCollectionFields.FieldDef>()
            // Render in canonical field order (AllFields order) so grouping-by-section is stable and
            // e.g. Anniversary Date always sits right below Spouse Date of Birth in the Family section,
            // regardless of the order the keys were saved in the config JSON.
            .OrderBy(f => DirectoryDataCollectionFields.AllFields.IndexOf(f))
            .Select(f => new
            {
                key = f.Key,
                label = f.Label,
                section = f.Section,
                type = f.Type,
                value = values.TryGetValue(f.Key, out var v) ? v : null,
            }).ToList();

        return Ok(new
        {
            memberId = req.MemberId,
            group,
            yearLabel = (string)cfg.yearLabel,
            districtNumber = (string)cfg.districtNumber,
            fields = fieldsPayload,
            spouseNotApplicable,
            hasSpouseFields,
            completion = new { filled, total, percent = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0, pending },
        });
    }

    public class SubmitRequest
    {
        public int MemberId { get; set; }
        public string SessionToken { get; set; } = "";
        // Optional — present when an admin contact (First/Second on the config) is filling on the
        // member's behalf via the ?fetch=admin URL flow. When valid, the per-member OTP session check
        // is skipped and the admin's mobile is recorded in the audit log.
        public string? AdminToken { get; set; }
        public Dictionary<string, string?> Fields { get; set; } = new();
        // When true, member has indicated they have no spouse for this year.
        // Spouse fields are NOT cleared from the DB — only excluded from completion %.
        public bool SpouseNotApplicable { get; set; }
    }

    // Upload a photo for a member (Profile or Spouse). Requires a valid active session token.
    // Returns the relative path to store in the form state.
    [HttpPost("{urlHash}/upload-photo")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult> UploadPhoto(string urlHash,
        [FromQuery] int memberId,
        [FromQuery] string? sessionToken, // Empty when adminToken is supplied (admin-proxy flow)
        [FromQuery] string kind, // "profile" | "spouse"
        [FromQuery] string? adminToken, // Optional — present in ?fetch=admin URL flow
        IFormFile file)
    {
        if (kind != "profile" && kind != "spouse")
            return BadRequest(new { message = "kind must be 'profile' or 'spouse'" });
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowed = new[] { ".jpg", ".jpeg", ".png", ".webp" };
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowed.Contains(ext))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, webp" });
        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5 MB" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Auth: admin-proxy token bypasses per-member session check; otherwise verify session token.
        var adminPayload = _adminProxySigner.Validate(adminToken);
        bool isAdminProxy = adminPayload != null && string.Equals(adminPayload.UrlHash, urlHash, StringComparison.Ordinal);
        if (!isAdminProxy)
        {
            var session = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_otp_id AS id, expires_at
                FROM mobile_login_otp
                WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0
                ORDER BY pk_otp_id DESC LIMIT 1",
                new { Identifier = $"dsess:{memberId}:{sessionToken}", LoginType = LoginTypeSession });
            if (session == null || DateTime.UtcNow > (DateTime)session.expires_at)
                return Unauthorized(new { message = "Session expired. Please request OTP again." });
        }

        // Profile + Spouse photos both land under /Documents/directory/ so every
        // path served from the API converges to one folder. Read SQL uses
        // SUBSTRING_INDEX to extract just the filename and prepend the canonical
        // folder, so even legacy /uploads/profile/... or /Documents/WebsiteData/...
        // values still resolve under /Documents/directory/.
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "directory");
        Directory.CreateDirectory(uploadsPath);

        var now = DateTime.Now;
        var stamp = now.ToString("ddMMyyyyhhmmssfffffff", CultureInfo.InvariantCulture)
                  + now.ToString("tt", CultureInfo.InvariantCulture);
        var prefix = kind == "profile" ? "MEMBER" : "SPOUSE";
        var fileName = $"{prefix}{memberId}_{stamp}{ext}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using (var stream = new FileStream(filePath, FileMode.Create))
            await file.CopyToAsync(stream);

        var relative = $"/Documents/directory/{fileName}";
        _logger.LogInformation("📷 [PHOTO UPLOAD] member={MemberId} kind={Kind} path={Path}", memberId, kind, relative);
        return Ok(new { path = relative });
    }

    // Step 5: save fields directly into member_master_profile / member_address_details / member_family_details
    // Then fire-and-forget Email + WhatsApp confirmation.
    [HttpPost("{urlHash}/submit")]
    public async Task<ActionResult> Submit(string urlHash, [FromBody] SubmitRequest req)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var cfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId,
                   d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
                   COALESCE(c.DcFieldsJson, '[]') AS dcJson,
                   COALESCE(c.BodFieldsJson, '[]') AS bodJson,
                   COALESCE(c.MemberFieldsJson, '[]') AS memJson,
                   c.FirstContactName AS firstContactName, c.FirstContactMobile AS firstContactMobile,
                   c.SecondContactName AS secondContactName, c.SecondContactMobile AS secondContactMobile,
                   COALESCE(c.SendEmail, 1) AS sendEmail, COALESCE(c.SendWhatsapp, 1) AS sendWhatsapp
            FROM district_directory_config c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.UrlHash = @urlHash AND c.isdeleted = 0",
            new { urlHash });
        if (cfg == null) return NotFound(new { message = "Invalid link" });

        // Determine auth path: admin-proxy token OR per-member OTP session.
        // Admin path: valid AdminToken signed for THIS urlHash → skip per-member OTP entirely.
        string? filledByAdminMobile = null;
        var adminPayload = _adminProxySigner.Validate(req.AdminToken);
        bool isAdminProxy = adminPayload != null && string.Equals(adminPayload.UrlHash, urlHash, StringComparison.Ordinal);
        if (isAdminProxy)
        {
            filledByAdminMobile = adminPayload!.Mobile;
        }
        else
        {
            // Normal flow: validate the per-member OTP session token (token lives inside identifier; see VerifyOtp)
            var session = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_otp_id AS id, expires_at
                FROM mobile_login_otp
                WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0
                ORDER BY pk_otp_id DESC LIMIT 1",
                new
                {
                    Identifier = $"dsess:{req.MemberId}:{req.SessionToken}",
                    LoginType = LoginTypeSession,
                });
            if (session == null || DateTime.UtcNow > (DateTime)session.expires_at)
                return Unauthorized(new { message = "Session expired. Please request OTP again." });
        }

        int districtId = (int)cfg.districtId;
        int yearId = (int)cfg.yearId;

        string group = await DirectoryDataCollectionFields.ResolveGroupAsync(conn, req.MemberId, districtId, yearId);
        var allowedKeys = DirectoryDataCollectionFields.GroupKeys(group, (string)cfg.dcJson, (string)cfg.bodJson, (string)cfg.memJson);

        // Apply only allowed keys — ignore any others silently
        var submittedSafe = req.Fields
            .Where(kv => allowedKeys.Contains(kv.Key))
            .ToDictionary(kv => kv.Key, kv => kv.Value);

        // Validate address bulk fields: if any sub-field is filled, all core sub-fields must be filled
        foreach (var kv in submittedSafe)
        {
            var f = DirectoryDataCollectionFields.GetField(kv.Key);
            if (f == null || f.Type != "address-bulk" || string.IsNullOrWhiteSpace(kv.Value)) continue;
            try
            {
                using var doc = JsonDocument.Parse(kv.Value);
                var el = doc.RootElement;
                string? Get(string n) => el.TryGetProperty(n, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
                var anyFilled =
                    !string.IsNullOrWhiteSpace(Get("Address")) ||
                    !string.IsNullOrWhiteSpace(Get("City")) ||
                    !string.IsNullOrWhiteSpace(Get("State")) ||
                    !string.IsNullOrWhiteSpace(Get("PinCode")) ||
                    !string.IsNullOrWhiteSpace(Get("PhoneNumber")) ||
                    !string.IsNullOrWhiteSpace(Get("BusinessEmailId")) ||
                    !string.IsNullOrWhiteSpace(Get("Designation"));
                var allCore =
                    !string.IsNullOrWhiteSpace(Get("Address")) &&
                    !string.IsNullOrWhiteSpace(Get("City")) &&
                    !string.IsNullOrWhiteSpace(Get("State")) &&
                    !string.IsNullOrWhiteSpace(Get("PinCode"));
                if (anyFilled && !allCore)
                {
                    return BadRequest(new { message = $"{f.Label}: please fill Address, City, State and PinCode — or clear all fields." });
                }
            }
            catch { /* malformed JSON — ignore, will be skipped on save */ }
        }

        // If spouseNotApplicable is true, drop spouse-field updates so member_family_details isn't
        // touched even if the frontend accidentally posted blanked values. Existing spouse rows
        // stay untouched in DB so untick later restores everything.
        if (req.SpouseNotApplicable)
        {
            submittedSafe = submittedSafe
                .Where(kv => DirectoryDataCollectionFields.GetField(kv.Key) is { } f && !DirectoryDataCollectionFields.IsSpouseField(f))
                .ToDictionary(kv => kv.Key, kv => kv.Value);
        }

        await ApplyFieldUpdatesAsync(conn, req.MemberId, submittedSafe);

        // UPSERT spouse-not-applicable flag for this (config, member) pair
        await DirectoryDataCollectionFields.SetSpouseNotApplicableAsync(conn, (int)cfg.id, req.MemberId, req.SpouseNotApplicable);

        // No spouse => no wedding anniversary. When this config collects the Anniversary Date (now a
        // Family field) and the member ticks "Not Applicable (no spouse)", CLEAR the profile
        // AnniversaryDate so the member is never counted for an anniversary anywhere — every report,
        // WhatsApp and email filters on a real date, so an empty date drops out automatically.
        if (req.SpouseNotApplicable && allowedKeys.Contains("anniversaryDate"))
        {
            await conn.ExecuteAsync(
                "UPDATE member_master_profile SET AnniversaryDate = NULL, modified_date = NOW() WHERE pk_member_master_profile_id = @id",
                new { id = req.MemberId });
        }

        // Recompute completion after save — exclude Family fields if spouse is N/A
        var latest = await DirectoryDataCollectionFields.LoadValuesAsync(conn, req.MemberId, allowedKeys);
        var effectiveKeys = DirectoryDataCollectionFields.ApplySpouseNotApplicable(allowedKeys, req.SpouseNotApplicable);
        var (filled, total, pending) = DirectoryDataCollectionFields.ComputeCompletion(latest, effectiveKeys);

        // Audit row for anonymous public submit. FilledByAdminMobile is set ONLY when an admin
        // contact filled on the member's behalf via ?fetch=admin URL flow — null for normal flow.
        await conn.ExecuteAsync(@"
            INSERT INTO district_directory_submission_log
                (fk_config_id, fk_member_id, GroupType, FieldsSubmittedJson, CompletedCount, TotalCount, IpAddress, UserAgent, FilledByAdminMobile)
            VALUES (@ConfigId, @MemberId, @Group, @Json, @Filled, @Total, @Ip, @Ua, @AdminMobile)",
            new
            {
                ConfigId = (int)cfg.id,
                MemberId = req.MemberId,
                Group = group,
                Json = JsonSerializer.Serialize(submittedSafe.Keys.ToList()),
                Filled = filled,
                Total = total,
                Ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "",
                Ua = Request.Headers.UserAgent.ToString(),
                AdminMobile = filledByAdminMobile,
            });

        // Fire-and-forget — post-submit confirmation Email + WhatsApp (scoped to this member's group fields)
        var memberInfo = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MemberName AS name, PrimaryMobileNumber AS mobile, EmailId AS email
            FROM member_master_profile WHERE pk_member_master_profile_id = @id",
            new { id = req.MemberId });

        var contactText = DirectoryDataCollectionFields.BuildContactText(
            (string?)cfg.firstContactName, (string?)cfg.firstContactMobile,
            (string?)cfg.secondContactName, (string?)cfg.secondContactMobile);
        // Confirmation Email + WhatsApp go to the MEMBER. The link they receive must
        // always be the plain public URL — NEVER carry &fetch=admin (that's the
        // admin-proxy login screen and is meaningless / confusing for the member).
        var publicUrl = $"{_publicFrontendBase.TrimEnd('/')}/public/directory-data-collection?ID={urlHash}";

        // Pass the SPOUSE-N/A FILTERED key list so the post-submit email's "Completed / Pending" breakdown
        // and the WhatsApp pending list both honour the member's Not-Applicable choice. Otherwise the
        // counts at the top would be correct but the detailed HTML below would still list spouse fields
        // as Pending — confusing the member.
        var cfgSendEmail = Convert.ToInt32(cfg.sendEmail) != 0;
        var cfgSendWhatsapp = Convert.ToInt32(cfg.sendWhatsapp) != 0;

        var snapshot = new ConfirmationPayload(
            Name: (string)memberInfo.name ?? "",
            Mobile: (string?)memberInfo.mobile,
            Email: (string?)memberInfo.email,
            YearLabel: (string)cfg.yearLabel,
            DistrictNumber: (string)cfg.districtNumber,
            Filled: filled,
            Total: total,
            Pending: pending,
            Group: group,
            EnabledKeys: effectiveKeys,
            Values: latest,
            Url: publicUrl,
            ContactText: contactText,
            SendEmail: cfgSendEmail,
            SendWhatsapp: cfgSendWhatsapp);
        _ = Task.Run(() => SendSubmitConfirmationAsync(snapshot));

        // Message must reflect which confirmation channels are actually enabled for this district.
        var confirmChannels = new List<string>();
        if (cfgSendEmail) confirmChannels.Add("email");
        if (cfgSendWhatsapp) confirmChannels.Add("WhatsApp");
        var savedMessage = confirmChannels.Count == 0
            ? "Your details have been saved."
            : $"Your details have been saved. A confirmation is being sent to your {string.Join(" and ", confirmChannels)}.";

        return Ok(new
        {
            saved = submittedSafe.Count,
            completion = new { filled, total, percent = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0, pending },
            message = savedMessage
        });
    }

    // ---------- helpers ----------

    private static async Task<bool> ValidateUrl(MySqlConnection conn, string urlHash)
    {
        // IsActive = 1 required: a disabled link blocks every public action (search, OTP,
        // submit, …), not just the landing screen — so the form can't be used via the API.
        var n = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_directory_config WHERE UrlHash = @urlHash AND isdeleted = 0 AND COALESCE(IsActive, 1) = 1",
            new { urlHash });
        return n > 0;
    }

    private async Task ApplyFieldUpdatesAsync(MySqlConnection conn, int memberId, Dictionary<string, string?> fields)
    {
        // 1. Update member_master_profile — set each "profile" column individually.
        // CLEAR-ON-EMPTY: a blank submitted value now CLEARS the field (writes NULL) so the
        // user can remove a value (photo, email, etc.). Hidden/unselected fields are NOT
        // affected — the caller already filtered `fields` down to config-selected keys, so
        // only visible fields ever reach here. The form pre-loads existing values, so a blank
        // means the user deliberately cleared it (not an untouched field).
        foreach (var kv in fields)
        {
            var f = DirectoryDataCollectionFields.GetField(kv.Key);
            if (f == null || f.Storage != "profile" || f.Column == null) continue;

            object? value;
            if (string.IsNullOrWhiteSpace(kv.Value))
            {
                value = null; // cleared — write NULL
            }
            else if (f.Type == "date")
            {
                if (!DateTime.TryParse(kv.Value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
                    continue; // unparseable date — leave existing value untouched
                value = dt.Date;
                // Project rule: birthdays + anniversaries store year=1900 placeholder.
                // pre-1900 sentinel years (1753, 0001) are garbage — leave as-is.
                if (f.Column == "BirthDate" || f.Column == "AnniversaryDate")
                {
                    if (dt.Year < 1900) continue;
                    // 1900 is not a leap year — clamp Feb 29 to Feb 28 rather than throw.
                    var day = (dt.Month == 2 && dt.Day == 29) ? 28 : dt.Day;
                    value = new DateTime(1900, dt.Month, day);
                }
            }
            else
            {
                value = kv.Value;
            }

            try
            {
                await conn.ExecuteAsync(
                    $"UPDATE member_master_profile SET `{f.Column}` = @v, modified_date = NOW() WHERE pk_member_master_profile_id = @id",
                    new { v = value, id = memberId });
            }
            catch (Exception ex)
            {
                // A NOT NULL / constrained column (e.g. MemberName) can't be cleared — skip it
                // instead of 500-ing the whole submit. Non-empty writes still succeed.
                _logger.LogWarning(ex, "Directory submit: could not set profile column {Column} for member {Member}.", f.Column, memberId);
            }
        }

        // 2. Spouse (family) — UPDATE existing Relation='Spouse' row if any, else INSERT one
        var familyKeys = fields.Keys.Select(DirectoryDataCollectionFields.GetField)
            .Where(f => f != null && f.Storage == "family").Cast<DirectoryDataCollectionFields.FieldDef>().ToList();
        if (familyKeys.Any())
        {
            var existing = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_member_family_details_id FROM member_family_details WHERE fk_member_master_profile_id = @id AND Relation = 'Spouse' AND (isdeleted IS NULL OR isdeleted = 0) ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC LIMIT 1",
                new { id = memberId });

            var parms = new Dictionary<string, object?> { ["memberId"] = memberId };
            foreach (var f in familyKeys)
            {
                fields.TryGetValue(f.Key, out var v);
                object? val;
                if (f.Type == "date")
                {
                    val = !string.IsNullOrWhiteSpace(v)
                        && DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)
                        ? (object)dt.Date
                        : null;
                    // Project rule: family birthday + anniversary store year=1900 placeholder.
                    // Defensive guard: pre-1900 sentinel years (SQL Server's 1753, .NET's
                    // 0001) are garbage — coerce to NULL rather than fake a 1900-01-01.
                    if (val is DateTime d
                        && (f.Column == "BirthDate" || f.Column == "AnniversaryDate"))
                    {
                        val = d.Year < 1900 ? null : (object)new DateTime(1900, d.Month, (d.Month == 2 && d.Day == 29) ? 28 : d.Day);
                    }
                }
                else
                {
                    val = string.IsNullOrEmpty(v) ? null : v;
                }
                parms[f.Column!] = val;
            }

            if (existing == null)
            {
                // Member has no spouse row yet. Skip the INSERT if every spouse value is empty/null —
                // creates an empty placeholder otherwise, and the schema requires Name NOT NULL so
                // an all-empty submit (e.g. user untick'd Not-Applicable but hasn't typed anything yet)
                // would crash. If at least one value is provided, fall back to "" for Name so the
                // INSERT passes the NOT NULL constraint even if the user filled mobile/email but no name.
                bool hasAnyValue = parms.Any(kv =>
                    kv.Key != "memberId" &&
                    kv.Value != null &&
                    !(kv.Value is string s && string.IsNullOrWhiteSpace(s)));
                if (hasAnyValue)
                {
                    if (!parms.ContainsKey("Name") || parms["Name"] == null || (parms["Name"] is string ns && string.IsNullOrWhiteSpace(ns)))
                        parms["Name"] = "";
                    var cols = string.Join(",", familyKeys.Select(f => f.Column));
                    var vals = string.Join(",", familyKeys.Select(f => "@" + f.Column));
                    await conn.ExecuteAsync(
                        $"INSERT INTO member_family_details (fk_member_master_profile_id, Relation, {cols}) VALUES (@memberId, 'Spouse', {vals})",
                        parms);
                }
                // else: nothing meaningful to insert — skip family INSERT, continue with address handling below
            }
            else
            {
                // CLEAR-ON-EMPTY: update EVERY configured spouse column, writing NULL for blanks
                // so a removed spouse photo / cleared spouse field actually clears. Name is
                // NOT NULL, so an empty Name becomes "" instead of NULL.
                parms["id"] = existing.Value;
                if (familyKeys.Any(f => f.Column == "Name")
                    && (parms["Name"] == null || (parms["Name"] is string ns && string.IsNullOrWhiteSpace(ns))))
                    parms["Name"] = "";
                var sets = string.Join(",", familyKeys.Select(f => $"`{f.Column}` = @{f.Column}"));
                await conn.ExecuteAsync(
                    $"UPDATE member_family_details SET {sets}, modified_date = NOW() WHERE pk_member_family_details_id = @id",
                    parms);
            }
        }

        // 3. Address — upsert one row per AddressType. Process bulk first, then singles (so single-column fields overwrite bulk for that column).
        var addressKeys = fields.Keys.Select(DirectoryDataCollectionFields.GetField)
            .Where(f => f != null && f.Storage == "address").Cast<DirectoryDataCollectionFields.FieldDef>()
            .OrderBy(f => f.Type == "address-bulk" ? 0 : 1)
            .ToList();

        foreach (var f in addressKeys)
        {
            fields.TryGetValue(f.Key, out var raw);

            var existing = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_member_address_details_id FROM member_address_details WHERE fk_member_master_profile_id = @id AND AddressType = @t AND (isdeleted IS NULL OR isdeleted = 0) LIMIT 1",
                new { id = memberId, t = f.AddressType });

            if (f.Type == "address-bulk")
            {
                string? address = null, city = null, state = null, pinCode = null, phoneNumber = null, businessEmail = null, designation = null;
                int? countryId = null;
                if (!string.IsNullOrWhiteSpace(raw))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(raw);
                        var el = doc.RootElement;
                        string? Get(string n) => el.TryGetProperty(n, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
                        address = Get("Address"); city = Get("City"); state = Get("State"); pinCode = Get("PinCode");
                        phoneNumber = Get("PhoneNumber"); businessEmail = Get("BusinessEmailId"); designation = Get("Designation");
                        if (el.TryGetProperty("CountryId", out var cv))
                        {
                            if (cv.ValueKind == JsonValueKind.Number) countryId = cv.GetInt32();
                            else if (cv.ValueKind == JsonValueKind.String && int.TryParse(cv.GetString(), out var ci)) countryId = ci;
                        }
                    }
                    catch { continue; } // malformed JSON — leave the row as-is
                }

                // Business "Designation" lives on club_members — apply always (empty clears it).
                if (f.AddressType == "Business")
                    await UpdateMemberDesignationClassificationAsync(conn, memberId, designation, null, designationOnly: true);

                bool anyAddrFilled =
                    !string.IsNullOrWhiteSpace(address) || !string.IsNullOrWhiteSpace(city) ||
                    !string.IsNullOrWhiteSpace(state) || !string.IsNullOrWhiteSpace(pinCode) ||
                    !string.IsNullOrWhiteSpace(phoneNumber) || !string.IsNullOrWhiteSpace(businessEmail);

                if (!anyAddrFilled)
                {
                    // CLEARED — soft-delete the address row (per user instruction). BusinessName /
                    // Keywords ride on this row; the frontend re-submits their pre-loaded values
                    // via the address-single path below, which re-inserts them if still present.
                    if (existing != null)
                        await conn.ExecuteAsync(
                            "UPDATE member_address_details SET isdeleted = 1, modified_date = NOW() WHERE pk_member_address_details_id = @existingId",
                            new { existingId = existing });
                    continue;
                }

                var prms = new { id = memberId, t = f.AddressType, address, city, state, pinCode, phoneNumber, countryId = countryId ?? 1, businessEmail, existingId = existing };
                var isBiz = f.AddressType == "Business";
                if (existing == null)
                {
                    await conn.ExecuteAsync(
                        isBiz
                        ? @"INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber, Address, State, City, PinCode, BusinessEmailId)
                            VALUES (@id, @t, @countryId, @phoneNumber, @address, @state, @city, @pinCode, @businessEmail)"
                        : @"INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber, Address, State, City, PinCode)
                            VALUES (@id, @t, @countryId, @phoneNumber, @address, @state, @city, @pinCode)",
                        prms);
                }
                else
                {
                    // CLEAR-ON-EMPTY: write the actual sub-field values (NULL for blank optional
                    // sub-fields like Phone / BusinessEmail). Core fields are validated non-empty upstream.
                    await conn.ExecuteAsync(
                        isBiz
                        ? @"UPDATE member_address_details SET fk_country_id = @countryId, PhoneNumber = NULLIF(@phoneNumber,''), Address = NULLIF(@address,''), State = NULLIF(@state,''), City = NULLIF(@city,''), PinCode = NULLIF(@pinCode,''), BusinessEmailId = NULLIF(@businessEmail,''), modified_date = NOW() WHERE pk_member_address_details_id = @existingId"
                        : @"UPDATE member_address_details SET fk_country_id = @countryId, PhoneNumber = NULLIF(@phoneNumber,''), Address = NULLIF(@address,''), State = NULLIF(@state,''), City = NULLIF(@city,''), PinCode = NULLIF(@pinCode,''), modified_date = NOW() WHERE pk_member_address_details_id = @existingId",
                        prms);
                }
            }
            else if (f.Type == "address-single" && f.Column != null)
            {
                // Designation / ClassificationProfession live on club_members — apply always (empty clears).
                if (string.Equals(f.Column, "Designation", StringComparison.OrdinalIgnoreCase))
                {
                    await UpdateMemberDesignationClassificationAsync(conn, memberId, raw, null, designationOnly: true);
                    continue;
                }
                if (string.Equals(f.Column, "ClassificationProfession", StringComparison.OrdinalIgnoreCase))
                {
                    await UpdateMemberDesignationClassificationAsync(conn, memberId, null, raw, classificationOnly: true);
                    continue;
                }

                // BusinessName / Keywords — stored on the Business address row. Empty clears the column.
                var val = string.IsNullOrWhiteSpace(raw) ? null : raw;
                if (existing != null)
                {
                    await conn.ExecuteAsync(
                        $"UPDATE member_address_details SET `{f.Column}` = @v, modified_date = NOW() WHERE pk_member_address_details_id = @existingId",
                        new { v = val, existingId = existing });
                }
                else if (val != null)
                {
                    await conn.ExecuteAsync(
                        $"INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, `{f.Column}`) VALUES (@id, @t, @v)",
                        new { id = memberId, t = f.AddressType, v = val });
                }
            }
        }
    }

    // Designation + ClassificationProfession live on club_members (Step 11B 2026-06-18).
    // Apply per-member across every active club membership.
    private static async Task UpdateMemberDesignationClassificationAsync(
        MySqlConnection conn, int memberId, string? designation, string? classification,
        bool designationOnly = false, bool classificationOnly = false)
    {
        var d = string.IsNullOrWhiteSpace(designation) ? null : designation.Trim();
        var c = string.IsNullOrWhiteSpace(classification) ? null : classification.Trim();
        if (designationOnly)
        {
            await conn.ExecuteAsync(@"
                UPDATE club_members
                SET Designation = @D, modified_date = NOW()
                WHERE fk_member_master_profile_id = @M AND COALESCE(isdeleted, 0) = 0",
                new { D = d, M = memberId });
            return;
        }
        if (classificationOnly)
        {
            await conn.ExecuteAsync(@"
                UPDATE club_members
                SET ClassificationProfession = @C, modified_date = NOW()
                WHERE fk_member_master_profile_id = @M AND COALESCE(isdeleted, 0) = 0",
                new { C = c, M = memberId });
            return;
        }
        await conn.ExecuteAsync(@"
            UPDATE club_members
            SET Designation = @D, ClassificationProfession = @C, modified_date = NOW()
            WHERE fk_member_master_profile_id = @M AND COALESCE(isdeleted, 0) = 0",
            new { D = d, C = c, M = memberId });
    }

    private record ConfirmationPayload(
        string Name, string? Mobile, string? Email,
        string YearLabel, string DistrictNumber,
        int Filled, int Total, List<string> Pending, string Group,
        List<string> EnabledKeys, Dictionary<string, string?> Values,
        string Url, string ContactText,
        bool SendEmail, bool SendWhatsapp);

    private async Task SendSubmitConfirmationAsync(ConfirmationPayload p)
    {
        try
        {
            _logger.LogInformation("📝 SUBMIT CONFIRMATION START — {Name} / district={District} year={Year} group={Group} {Filled}/{Total}",
                p.Name, p.DistrictNumber, p.YearLabel, p.Group, p.Filled, p.Total);

            if (p.SendEmail && !string.IsNullOrWhiteSpace(p.Email))
            {
                var detailedHtml = DirectoryDataCollectionFields.BuildCompletedAndPendingHtml(p.EnabledKeys, p.Values, _apiBase);
                var pct = p.Total > 0 ? (int)Math.Round(100.0 * p.Filled / p.Total) : 0;
                var html = $@"{EmailService.EMAIL_HEADER}
<h2 style=""color:#1a365d;margin-top:0;"">District Directory — Submission Received</h2>
<p>Hello {System.Net.WebUtility.HtmlEncode(p.Name)},</p>
<p>Thank you for submitting your data for the <b>District Directory {p.YearLabel} (District {p.DistrictNumber})</b>.</p>
<p>Status: <b>{p.Filled} of {p.Total} fields completed — {pct}%</b>.</p>
{detailedHtml}
<p style=""margin-top:20px;"">If you require any assistance, please contact <b>{System.Net.WebUtility.HtmlEncode(p.ContactText)}</b>.</p>
<p style=""color:#64748b;font-size:13px;margin-top:20px;"">Regards,<br/><b>District Team</b></p>
{EmailService.EMAIL_FOOTER}";
                try
                {
                    await _email.SendGenericEmailAsync(p.Email, $"District Directory {p.YearLabel} — Submission Received", html);
                    _logger.LogInformation("📧 [SUBMIT-EMAIL] ✅ {Name} → {Email}", p.Name, p.Email);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("📧 [SUBMIT-EMAIL] ❌ {Name} → {Email} FAILED: {Error}", p.Name, p.Email, ex.Message);
                }
            }
            else
            {
                _logger.LogInformation("📧 [SUBMIT-EMAIL] ⏭ {Name} — skipped (no email on profile)", p.Name);
            }

        }
        catch (Exception ex) { _logger.LogError(ex, "SendSubmitConfirmationAsync failed"); }
    }
}

using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Privacy;

/// <summary>
/// Member privacy (master plan WS7): consent, export, erasure, the registry audit. ROW-only: every route answers
/// 404 unless the brand flag privacy.enabled is on. Same routes and JSON as the NestJS edition.
/// </summary>
[ApiController]
[Authorize]
[Route("api/privacy")]
public class PrivacyController : ControllerBase
{
    private static readonly object NotEnabled = new { message = "Privacy features are not enabled on this instance." };
    private readonly PrivacyService _svc;

    public PrivacyController(PrivacyService svc) => _svc = svc;

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private bool IsSuperAdmin => User.FindFirst("roles")?.Value?.Split(',').Select(r => r.Trim()).Contains("SuperAdmin") == true;
    private PrivacyCaller Caller => new(MemberId, IsSuperAdmin);

    private async Task<IActionResult> Guarded(Func<Task<object?>> work)
    {
        if (!PrivacyService.Enabled) return NotFound(NotEnabled);
        try { return Ok(await work()); }
        catch (PrivacyException ex)
        {
            return ex.Status switch
            {
                400 => BadRequest(new { message = ex.Message }),
                404 => NotFound(new { message = ex.Message }),
                _ => StatusCode(403, new { message = ex.Message }),
            };
        }
    }

    private static string? Field(JsonElement? body, string name) =>
        body is { ValueKind: JsonValueKind.Object } b && b.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    [HttpGet("consent")]
    public Task<IActionResult> Consent() => Guarded(async () => await _svc.ConsentStatusAsync(MemberId));

    [HttpPost("consent")]
    public Task<IActionResult> Accept([FromBody] JsonElement? body) => Guarded(async () =>
    {
        var ip = HttpContext.Connection.RemoteIpAddress is { } a ? (a.IsIPv4MappedToIPv6 ? a.MapToIPv4().ToString() : a.ToString()) : null;
        await _svc.AcceptConsentAsync(MemberId, Field(body, "policyVersion") ?? "", Field(body, "language") ?? "en", ip, Field(body, "channel") == "app" ? "app" : "web");
        return new { accepted = true };
    });

    [HttpPost("consent/withdraw")]
    public Task<IActionResult> Withdraw() => Guarded(async () => { await _svc.WithdrawConsentAsync(MemberId); return new { withdrawn = true }; });

    [HttpGet("requests")]
    public async Task<IActionResult> Requests([FromQuery] int districtId = 0)
    {
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        return await Guarded(async () => await _svc.ListRequestsAsync(Caller, districtId));
    }

    [HttpPost("members/{memberId:int}/export")]
    public Task<IActionResult> Export(int memberId) => Guarded(async () => await _svc.RequestExportAsync(Caller, memberId));

    [HttpPost("members/{memberId:int}/erase")]
    public Task<IActionResult> Erase(int memberId, [FromBody] JsonElement? body) =>
        Guarded(async () => await _svc.RequestErasureAsync(Caller, memberId, Field(body, "reason") ?? ""));

    [HttpPost("requests/{requestId:int}/approve")]
    public Task<IActionResult> Approve(int requestId) => Guarded(async () => await _svc.ApproveAsync(Caller, requestId));

    [HttpPost("requests/{requestId:int}/reject")]
    public Task<IActionResult> Reject(int requestId) => Guarded(async () => await _svc.RejectAsync(Caller, requestId));

    /// <summary>WS7-01 audit: personal-looking columns on tables missing from the registry (SuperAdmin).</summary>
    [HttpGet("registry/unlisted")]
    public async Task<IActionResult> Unlisted()
    {
        if (!IsSuperAdmin) return StatusCode(403, new { message = "SuperAdmin only." });
        return await Guarded(async () => await _svc.UnlistedColumnsAsync());
    }

    /// <summary>Runs the daily retention pass now, including the tenant rule for terminated members (SuperAdmin).</summary>
    [HttpPost("retention/run")]
    public async Task<IActionResult> RunRetention()
    {
        if (!IsSuperAdmin) return StatusCode(403, new { message = "SuperAdmin only." });
        return await Guarded(async () => new { done = await _svc.ApplyRetentionAsync() });
    }

    /// <summary>The ZIP behind an export's signed link (opened from a plain link, so no bearer token).</summary>
    [HttpGet("exports/{guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> Download(string guid, [FromQuery] string? expires, [FromQuery] string? sig)
    {
        if (!PrivacyService.Enabled) return NotFound(NotEnabled);
        try { return File(await _svc.ExportFileAsync(guid, expires ?? "", sig ?? ""), "application/zip", $"member-data-{guid[..Math.Min(8, guid.Length)]}.zip"); }
        catch (PrivacyException ex) { return NotFound(new { message = ex.Message }); }
    }
}

/// <summary>The signed-in member's interface language, so it follows them to other browsers and the app (WS2-03).</summary>
[ApiController]
[Authorize]
[Route("api/members/me")]
public class MemberLanguageController : ControllerBase
{
    private static readonly Regex LanguageCode = new(@"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$");
    private readonly string _connectionString;

    public MemberLanguageController(IConfiguration config) => _connectionString = config.GetConnectionString("DefaultConnection") ?? "";

    [HttpPut("language")]
    public async Task<IActionResult> SetLanguage([FromBody] JsonElement? body)
    {
        var language = body is { ValueKind: JsonValueKind.Object } b && b.TryGetProperty("language", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()!.Trim() : "";
        if (!LanguageCode.IsMatch(language)) return BadRequest(new { message = "language must be a language code such as \"en\" or \"pt-BR\"." });
        var memberId = int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
        if (memberId <= 0) return StatusCode(403, new { message = "Not signed in as a member." });
        await using var conn = new MySqlConnection(_connectionString);
        await conn.ExecuteAsync("UPDATE member_master_profile SET PrimaryLanguage = @Lang WHERE pk_member_master_profile_id = @Id", new { Lang = language, Id = memberId });
        return Ok(new { language });
    }
}

/// <summary>
/// Consent filter for broadcast messages (WS7-05 step 3): announcements, events, newsletters and other content
/// sent by email or push go only to members who accepted the current policy. Transactional messages do not use it.
/// "" unless privacy.enabled is on, a policy version is set and "announcement" is in Brand:Privacy:ConsentRequiredFor.
/// </summary>
public static class PrivacyConsent
{
    public static string BroadcastFilter(string memberIdColumn = "m.pk_member_master_profile_id")
    {
        if (!Brand.Feature("privacy.enabled") || Brand.PolicyVersion == "" || !Brand.ConsentRequiredFor.Contains("announcement")) return "";
        var safe = Regex.Replace(Brand.PolicyVersion, "[^A-Za-z0-9._-]", "");
        return $" AND EXISTS (SELECT 1 FROM member_consents mc WHERE mc.fk_member_id = {memberIdColumn} AND mc.withdrawn_at_utc IS NULL AND mc.policy_version = '{safe}')";
    }
}

/// <summary>Log retention (WS7-07): once a day, behind BackgroundJobs:Enabled and privacy.enabled.</summary>
public class PrivacyRetentionBackgroundService : BackgroundService
{
    private readonly PrivacyService _svc;
    private readonly IConfiguration _config;
    private readonly ILogger<PrivacyRetentionBackgroundService> _log;

    public PrivacyRetentionBackgroundService(PrivacyService svc, IConfiguration config, ILogger<PrivacyRetentionBackgroundService> log)
    {
        _svc = svc;
        _config = config;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_config.GetValue("BackgroundJobs:Enabled", true)) return;
        try { await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken); } catch (OperationCanceledException) { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            if (PrivacyService.Enabled)
            {
                try
                {
                    var done = await _svc.ApplyRetentionAsync();
                    _log.LogInformation(done.Count > 0 ? "retention applied: {Done}" : "retention: nothing to remove{Done}", string.Join("; ", done));
                }
                catch (Exception ex) { _log.LogError(ex, "retention failed"); }
            }
            try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }
}

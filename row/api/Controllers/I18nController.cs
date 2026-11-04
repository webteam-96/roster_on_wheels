using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySqlConnector;
using RotaryApi.Services;
using RotaryApi.Services.Localization;

namespace RotaryApi.Controllers;

/// <summary>
/// String catalogue (ROW Wave 1, build spec item 3): per-locale overrides of the admin's bundled messages. The
/// bundled English JSON stays the source; a key without an override falls back to it in the admin. Reading is
/// public and cached (ETag); writing is SuperAdmin only (also checked against member_roles by ScopeWriteGuard).
/// </summary>
[ApiController]
[Route("api/i18n")]
[Authorize]
public class I18nController : ControllerBase
{
    private static readonly Regex Locale = new(@"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$", RegexOptions.Compiled);
    private static readonly Regex Namespace = new(@"^[a-z][A-Za-z0-9_-]{0,49}$", RegexOptions.Compiled);
    private static readonly Regex Key = new(@"^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$", RegexOptions.Compiled);
    private readonly IAuditLogService _auditLog;
    private readonly string _connectionString;
    private readonly LocalizationService _localization;

    public I18nController(IAuditLogService auditLog, IConfiguration configuration, LocalizationService localization)
    {
        _auditLog = auditLog;
        _localization = localization;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    public record OverrideDto(string Namespace, string Key, string Text, bool Reviewed);
    public record SaveOverrideDto(string? Text, bool Reviewed);

    private bool IsSuperAdmin() => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");
    private int GetCurrentMemberId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    public record TranslateRequest(string? Target, string? Source, List<string>? Q);
    public record CorrectionDto(string? Locale, string? Source, string? Text);

    /// <summary>
    /// UI text for web and app. Anonymous for the sign-in and public pages: visitors get a smaller batch and a daily
    /// share of new text, cached text is free. Failures come back as the English text.
    /// </summary>
    [HttpPost("translate")]
    [AllowAnonymous]
    [EnableRateLimiting("translate")]
    public async Task<IActionResult> Translate([FromBody] TranslateRequest req, CancellationToken ct)
    {
        var target = (req.Target ?? "").Trim();
        var signedIn = User.Identity?.IsAuthenticated == true;
        var texts = (req.Q ?? new()).Take(signedIn ? LocalizationService.MaxBatch : LocalizationService.VisitorMaxBatch).ToList();
        if (!Locale.IsMatch(target) || texts.Count == 0 || (req.Source ?? "en") != "en") return Ok(new { translations = texts });
        return Ok(new { translations = await _localization.TranslateAsync(target, texts, signedIn, ct) });
    }

    /// <summary>Clients drop their saved translations when this changes (a correction was saved or removed).</summary>
    [HttpGet("memory/version")]
    [AllowAnonymous]
    [EnableRateLimiting("feed")]
    public async Task<IActionResult> MemoryVersion() => Ok(new { version = await _localization.MemoryVersionAsync() });

    [HttpGet("memory")]
    public async Task<IActionResult> Memory([FromQuery] string? locale, [FromQuery] string? search, [FromQuery] bool correctionsOnly = false,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can read translations." });
        if (locale == null || !Locale.IsMatch(locale)) return BadRequest(new { message = "Invalid locale." });
        var (rows, total) = await _localization.SearchAsync(locale, search?.Trim(), correctionsOnly, Math.Max(page, 1), Math.Clamp(pageSize, 1, 100));
        return Ok(new
        {
            rows, total,
            provider = _localization.Provider,
            configured = _localization.Configured,
            monthChars = await _localization.MonthCharsAsync(),
            monthlyLimit = _localization.MonthlyLimit,
        });
    }

    [HttpPut("memory")]
    public async Task<IActionResult> SaveCorrection([FromBody] CorrectionDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can edit translations." });
        var source = dto.Source ?? "";
        var text = dto.Text?.Trim() ?? "";
        if (dto.Locale == null || !Locale.IsMatch(dto.Locale)) return BadRequest(new { message = "Invalid locale." });
        if (source.Length is 0 or > 5000 || text.Length is 0 or > 5000) return BadRequest(new { message = "Text is required (5000 characters at most)." });
        if (!await _localization.SaveCorrectionAsync(dto.Locale, source, text, GetCurrentMemberId()))
            return BadRequest(new { message = "Keep every {placeholder}, link and email of the English text." });
        await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "translation_memory", null, dto.Locale, new { dto.Locale, source, text }, HttpContext);
        return NoContent();
    }

    [HttpDelete("memory/{locale}/{hash}")]
    public async Task<IActionResult> DeleteMemory(string locale, string hash)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can edit translations." });
        if (!Locale.IsMatch(locale) || !Regex.IsMatch(hash, "^[a-f0-9]{64}$")) return BadRequest(new { message = "Invalid request." });
        var source = await _localization.DeleteAsync(locale, hash);
        if (source == null) return NotFound(new { message = "No such translation." });
        await _auditLog.LogAsync(GetCurrentMemberId(), "DELETE", "translation_memory", null, locale, new { locale, source }, HttpContext);
        return NoContent();
    }

    [HttpGet("{locale}")]
    [AllowAnonymous]
    public async Task<IActionResult> Get(string locale)
    {
        if (!Locale.IsMatch(locale)) return BadRequest(new { message = "Invalid locale." });
        await using var conn = new MySqlConnection(_connectionString);
        var rows = (await conn.QueryAsync<OverrideDto>(@"
            SELECT namespace AS Namespace, msg_key AS `Key`, text AS Text, reviewed AS Reviewed
            FROM i18n_strings WHERE locale = @locale ORDER BY namespace, msg_key", new { locale })).ToList();

        var body = JsonSerializer.Serialize(rows, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var etag = $"\"{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body)))[..32]}\"";
        Response.Headers.ETag = etag;
        // no-cache: clients revalidate with the ETag (304). A max-age would let UseResponseCaching serve stale text after an edit.
        Response.Headers.CacheControl = "no-cache";
        if (Request.Headers.IfNoneMatch.ToString() == etag) return StatusCode(StatusCodes.Status304NotModified);
        return Content(body, "application/json");
    }

    [HttpPut("{locale}/{ns}/{key}")]
    public async Task<IActionResult> Save(string locale, string ns, string key, [FromBody] SaveOverrideDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can edit translations." });
        var error = ValidatePath(locale, ns, key);
        if (error != null) return BadRequest(new { message = error });
        var text = dto.Text?.Trim() ?? "";
        // An empty override would blank the text; remove the override instead so English shows.
        if (text.Length is 0 or > 4000) return BadRequest(new { message = "Text is required (4000 characters at most)." });

        await using var conn = new MySqlConnection(_connectionString);
        await conn.ExecuteAsync(@"
            INSERT INTO i18n_strings (namespace, msg_key, locale, text, reviewed, updated_by)
            VALUES (@ns, @key, @locale, @text, @reviewed, @by)
            ON DUPLICATE KEY UPDATE text = VALUES(text), reviewed = VALUES(reviewed), updated_by = VALUES(updated_by)",
            new { ns, key, locale, text, reviewed = dto.Reviewed, by = GetCurrentMemberId() });
        await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "i18n_string", null, $"{locale}/{ns}/{key}",
            new { locale, ns, key, text, dto.Reviewed }, HttpContext);
        return Ok(new OverrideDto(ns, key, text, dto.Reviewed));
    }

    [HttpDelete("{locale}/{ns}/{key}")]
    public async Task<IActionResult> Delete(string locale, string ns, string key)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can edit translations." });
        var error = ValidatePath(locale, ns, key);
        if (error != null) return BadRequest(new { message = error });
        await using var conn = new MySqlConnection(_connectionString);
        var removed = await conn.ExecuteAsync(
            "DELETE FROM i18n_strings WHERE locale = @locale AND namespace = @ns AND msg_key = @key", new { locale, ns, key });
        if (removed == 0) return NotFound(new { message = "No override for this key." });
        await _auditLog.LogAsync(GetCurrentMemberId(), "DELETE", "i18n_string", null, $"{locale}/{ns}/{key}", null, HttpContext);
        return NoContent();
    }

    private static string? ValidatePath(string locale, string ns, string key)
    {
        if (!Locale.IsMatch(locale)) return "Invalid locale.";
        if (!Namespace.IsMatch(ns)) return "Invalid namespace.";
        if (key.Length > 200 || !Key.IsMatch(key)) return "Invalid key.";
        return null;
    }
}

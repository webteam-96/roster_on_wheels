using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// N5 Communication upgrades (CommsService). Tenant routes take {scope} = clubs | districts and are for the managers
/// of that club or district only (checked here on reads too: the scope guard lets every member read). Behind the
/// flagged feature 'communication' (FeatureGate), except the unsubscribe link and the Brevo webhook: links already
/// in inboxes must keep working, and the webhook is shut by its own secret.
/// </summary>
[ApiController]
[Authorize]
public class CommsController : ControllerBase
{
    private const string Tenant = "api/{scope:regex(^(clubs|districts)$)}/{id:int}/comms";

    private readonly CommsService _comms;
    private readonly IAuditLogService _audit;
    private readonly IConfiguration _config;
    private readonly ILogger<CommsController> _log;
    private readonly string _cs;

    public CommsController(CommsService comms, IAuditLogService audit, IConfiguration config, ILogger<CommsController> log)
    {
        _comms = comms;
        _audit = audit;
        _config = config;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static CommsService.Tenant TenantOf(string scope, int id) => scope == "clubs" ? new(id, 0) : new(0, id);

    /// <summary>Null when the caller manages this club or district; otherwise the 403 to return.</summary>
    private async Task<ActionResult?> DenyAsync(string scope, int id)
        => MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId, scope == "clubs", id)
            ? null
            : StatusCode(403, new { message = scope == "clubs" ? "You do not manage this club." : "You do not manage this district." });

    private Task AuditAsync(string action, string entity, int? entityId, string? label, object details)
        => _audit.LogAsync(MemberId, action, entity, entityId, label, details, HttpContext);

    // ── Settings ─────────────────────────────────────────────────────────────────────────────

    [HttpGet(Tenant + "/settings")]
    public async Task<ActionResult<CommSettingsDto>> GetSettings(string scope, int id)
        => await DenyAsync(scope, id) ?? Ok(await _comms.GetSettingsAsync(TenantOf(scope, id)));

    [HttpPut(Tenant + "/settings")]
    public async Task<ActionResult> SaveSettings(string scope, int id, [FromBody] CommSettingsDto dto)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var error = await _comms.SaveSettingsAsync(TenantOf(scope, id), dto, MemberId);
        if (error != null) return BadRequest(new { message = error });
        await AuditAsync("UPDATE", "comm_settings", id, scope, new
        {
            dto.DefaultLanguage, dto.GovernorNoteEnabled, dto.GovernorName, dto.SenderFromName, dto.SenderFromEmail, dto.SenderReplyTo,
            dto.FoundationGivingUrl,
        });
        return Ok(await _comms.GetSettingsAsync(TenantOf(scope, id)));
    }

    // ── Templates ────────────────────────────────────────────────────────────────────────────

    [HttpGet(Tenant + "/templates")]
    public async Task<ActionResult<List<CommTemplateDto>>> GetTemplates(string scope, int id)
        => await DenyAsync(scope, id) ?? Ok(await _comms.GetTemplatesAsync(TenantOf(scope, id)));

    [HttpPut(Tenant + "/templates")]
    public async Task<ActionResult<CommTemplateDto>> SaveTemplate(string scope, int id, [FromBody] SaveCommTemplateDto dto)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var (saved, error) = await _comms.SaveTemplateAsync(TenantOf(scope, id), dto, MemberId);
        if (saved == null) return BadRequest(new { message = error });
        await AuditAsync("UPDATE", "comm_template", saved.Id, $"{saved.TemplateKey}/{saved.Language}", new { scope, id, saved.Subject, saved.Reviewed });
        return Ok(saved);
    }

    [HttpDelete(Tenant + "/templates/{templateId:int}")]
    public async Task<ActionResult> DeleteTemplate(string scope, int id, int templateId)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var row = await _comms.DeleteTemplateAsync(TenantOf(scope, id), templateId);
        if (row == null) return NotFound(new { message = "Template not found." });
        await AuditAsync("DELETE", "comm_template", templateId, $"{row.TemplateKey}/{row.Language}", new { scope, id });
        return NoContent();
    }

    // ── Sender domains ───────────────────────────────────────────────────────────────────────

    [HttpGet(Tenant + "/domains")]
    public async Task<ActionResult<List<SenderDomainDto>>> GetDomains(string scope, int id)
        => await DenyAsync(scope, id) ?? Ok(await _comms.GetDomainsAsync(TenantOf(scope, id)));

    [HttpPost(Tenant + "/domains")]
    public async Task<ActionResult<SenderDomainDto>> AddDomain(string scope, int id, [FromBody] AddSenderDomainDto dto)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var (added, error) = await _comms.AddDomainAsync(TenantOf(scope, id), dto, MemberId);
        if (added == null) return BadRequest(new { message = error });
        await AuditAsync("CREATE", "comm_sender_domain", added.Id, added.Domain, new { scope, id, added.DkimSelector });
        return Ok(added);
    }

    /// <summary>Looks up the domain's TXT records now (DNS only) and stores the result.</summary>
    [HttpPost(Tenant + "/domains/{domainId:int}/verify")]
    public async Task<ActionResult<SenderDomainDto>> VerifyDomain(string scope, int id, int domainId)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var d = await _comms.VerifyDomainAsync(TenantOf(scope, id), domainId);
        if (d == null) return NotFound(new { message = "Domain not found." });
        await AuditAsync("VERIFY", "comm_sender_domain", domainId, d.Domain, new { d.OwnershipOk, d.SpfOk, d.DkimOk, d.DmarcOk });
        return Ok(d);
    }

    [HttpDelete(Tenant + "/domains/{domainId:int}")]
    public async Task<ActionResult> DeleteDomain(string scope, int id, int domainId)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var d = await _comms.DeleteDomainAsync(TenantOf(scope, id), domainId);
        if (d == null) return NotFound(new { message = "Domain not found." });
        await AuditAsync("DELETE", "comm_sender_domain", domainId, d.Domain, new { scope, id });
        return NoContent();
    }

    // ── Usage, tracking, suppressions, opt-outs ──────────────────────────────────────────────

    [HttpGet(Tenant + "/usage")]
    public async Task<ActionResult<CommUsageDto>> GetUsage(string scope, int id, [FromQuery] string? month)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        DateTime m;
        if (string.IsNullOrWhiteSpace(month)) m = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        else if (!DateTime.TryParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out m))
            return BadRequest(new { message = "Month must be YYYY-MM." });
        return Ok(await _comms.GetUsageAsync(TenantOf(scope, id), m));
    }

    [HttpGet(Tenant + "/campaigns/{massEmailId:int}")]
    public async Task<ActionResult<CampaignTrackingDto>> GetCampaign(string scope, int id, int massEmailId)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var dto = await _comms.GetCampaignAsync(TenantOf(scope, id), massEmailId);
        return dto == null ? NotFound(new { message = "Mass email not found." }) : Ok(dto);
    }

    [HttpGet(Tenant + "/suppressions")]
    public async Task<ActionResult<List<CommSuppressionDto>>> GetSuppressions(string scope, int id)
        => await DenyAsync(scope, id) ?? Ok(await _comms.GetSuppressionsAsync(TenantOf(scope, id)));

    /// <summary>Lifts a suppression (for example after the member fixed a full mailbox).</summary>
    [HttpDelete(Tenant + "/suppressions/{suppressionId:int}")]
    public async Task<ActionResult> DeleteSuppression(string scope, int id, int suppressionId)
    {
        if (await DenyAsync(scope, id) is { } deny) return deny;
        var row = await _comms.DeleteSuppressionAsync(TenantOf(scope, id), suppressionId);
        if (row == null) return NotFound(new { message = "Suppression not found." });
        // the address itself is not written to the audit log (personal data)
        await AuditAsync("DELETE", "comm_suppression", suppressionId, row.Reason, new { scope, id });
        return NoContent();
    }

    [HttpGet(Tenant + "/opt-outs")]
    public async Task<ActionResult<List<CommOptOutDto>>> GetOptOuts(string scope, int id)
        => await DenyAsync(scope, id) ?? Ok(await _comms.GetOptOutsAsync(TenantOf(scope, id)));

    // ── The member's own consent per channel (app) ───────────────────────────────────────────

    [HttpGet("api/mobile/comms/preferences")]
    public async Task<ActionResult<MemberCommsPreferencesDto>> GetPreferences()
    {
        if (MemberId <= 0) return Unauthorized();
        return Ok(await _comms.GetPreferencesAsync(MemberId));
    }

    /// <summary>Email and push on or off. The language is set with PUT /api/members/me/language.</summary>
    [HttpPut("api/mobile/comms/preferences")]
    public async Task<ActionResult<MemberCommsPreferencesDto>> SetPreferences([FromBody] SetMemberConsentsDto dto)
    {
        if (MemberId <= 0) return Unauthorized();
        if (dto.Email is { } email) await _comms.SetConsentAsync(MemberId, "email", email, "member");
        if (dto.Push is { } push) await _comms.SetConsentAsync(MemberId, "push", push, "member");
        return Ok(await _comms.GetPreferencesAsync(MemberId));
    }

    // ── Public unsubscribe (signed token, no login) ──────────────────────────────────────────

    [AllowAnonymous]
    [EnableRateLimiting("unsubscribe")]
    [HttpGet("api/public/comms/unsubscribe/{token}")]
    public async Task<ActionResult<UnsubscribeInfoDto>> GetUnsubscribe(string token)
    {
        var memberId = _comms.UnsubscribeMember(token);
        var info = memberId == null ? null : await _comms.GetUnsubscribeInfoAsync(memberId.Value);
        return info == null ? NotFound(new { message = "This link is not valid." }) : Ok(info);
    }

    /// <summary>
    /// {"subscribe": false} unsubscribes, {"subscribe": true} subscribes again. A mail client's one-click request
    /// (RFC 8058: form body List-Unsubscribe=One-Click) unsubscribes.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting("unsubscribe")]
    [RequestSizeLimit(4096)]
    [HttpPost("api/public/comms/unsubscribe/{token}")]
    public async Task<ActionResult<UnsubscribeInfoDto>> PostUnsubscribe(string token)
    {
        var memberId = _comms.UnsubscribeMember(token);
        if (memberId == null || await _comms.GetUnsubscribeInfoAsync(memberId.Value) == null) return NotFound(new { message = "This link is not valid." });
        bool subscribe;
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync();
            if (form["List-Unsubscribe"] != "One-Click") return BadRequest(new { message = "Unknown request." });
            subscribe = false;
        }
        else
        {
            try
            {
                using var doc = await JsonDocument.ParseAsync(Request.Body);
                if (!doc.RootElement.TryGetProperty("subscribe", out var s) || s.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    return BadRequest(new { message = "subscribe must be true or false." });
                subscribe = s.GetBoolean();
            }
            catch (JsonException)
            {
                return BadRequest(new { message = "subscribe must be true or false." });
            }
        }
        await _comms.SetConsentAsync(memberId.Value, "email", subscribe, "unsubscribe_link");
        return Ok(await _comms.GetUnsubscribeInfoAsync(memberId.Value));
    }

    // ── Brevo webhook ────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Brevo transactional events (one object, or an array when the webhook is batched). Brevo does not sign
    /// payloads; the webhook is created with bearer authentication carrying Brevo:WebhookSecret, checked in constant
    /// time. No secret configured: the endpoint does not exist.
    /// </summary>
    [AllowAnonymous]
    [RequestSizeLimit(5_000_000)]
    [HttpPost("api/webhooks/brevo")]
    public async Task<ActionResult> BrevoWebhook()
    {
        var secret = _config["Brevo:WebhookSecret"] ?? "";
        if (secret.Length < 16) return NotFound();
        var auth = Request.Headers.Authorization.ToString();
        var given = auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? auth[7..].Trim() : "";
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(given)), SHA256.HashData(Encoding.UTF8.GetBytes(secret))))
            return Unauthorized();

        JsonDocument doc;
        try { doc = await JsonDocument.ParseAsync(Request.Body); }
        catch (JsonException) { return BadRequest(new { message = "Body must be JSON." }); }
        using (doc)
        {
            var events = doc.RootElement.ValueKind == JsonValueKind.Array ? doc.RootElement.EnumerateArray().ToList() : new() { doc.RootElement };
            int processed = 0, duplicates = 0;
            foreach (var e in events.Take(1000))
            {
                var result = await _comms.ProcessBrevoEventAsync(e);
                if (result == "processed") processed++;
                else if (result == "duplicate") duplicates++;
            }
            _log.LogInformation("Brevo webhook: {Processed} processed, {Duplicates} duplicates, {Total} received", processed, duplicates, events.Count);
            return Ok(new { processed, duplicates });
        }
    }
}

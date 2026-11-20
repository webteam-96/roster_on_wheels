using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Mass email compose upgrades for clubs and districts: template library, attachments, per-sender signature.
/// {scope} is "clubs" or "districts"; every call checks that the caller manages that club or district, and that the
/// template or campaign belongs to it.
/// </summary>
[ApiController]
[Authorize]
public class MassEmailComposeController : ControllerBase
{
    private readonly MassEmailComposeService _svc;
    private readonly IClubMassEmailService _campaigns;
    private readonly AdminYearGuard _guard;
    private readonly string _cs;

    public MassEmailComposeController(MassEmailComposeService svc, IClubMassEmailService campaigns, AdminYearGuard guard, IConfiguration config)
    {
        _svc = svc;
        _campaigns = campaigns;
        _guard = guard;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static (int ClubId, int DistrictId) Owner(string scope, int ownerId)
        => scope == "clubs" ? (ownerId, 0) : (0, ownerId);

    /// <summary>Null when the caller manages this club or district (and it is reachable); otherwise the error.</summary>
    private async Task<ActionResult?> DenyAsync(string scope, int ownerId, bool write)
    {
        var isClub = scope == "clubs";
        var reachable = isClub
            ? await KillSwitchHelper.IsClubDrillReachableAsync(_cs, ownerId)
            : await KillSwitchHelper.IsDistrictDrillReachableAsync(_cs, ownerId);
        if (!reachable) return StatusCode(403, new { message = "This club or district is inactive. Reactivate it first." });
        if (UserId <= 0 || !await ScopeWriteGuardMiddleware.AllowedAsync(_cs, UserId, isClub, ownerId))
            return StatusCode(403, new { message = "Only the people who manage this club or district can use its mass email tools." });
        if (write)
            return isClub ? await _guard.ClubYearlessAsync(User, ownerId) : await _guard.DistrictYearlessAsync(User, ownerId);
        return null;
    }

    private async Task<ActionResult?> DenyCampaignAsync(string scope, int ownerId, int emailId, bool write)
    {
        if (await DenyAsync(scope, ownerId, write) is { } deny) return deny;
        var belongs = scope == "clubs"
            ? await _campaigns.BelongsToAsync(emailId, ownerId, null)
            : await _campaigns.BelongsToAsync(emailId, null, ownerId);
        return belongs ? null : NotFound(new { message = "Mass email not found." });
    }

    // ===== Templates =====

    [HttpGet("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-email-templates")]
    public async Task<ActionResult> GetTemplates(string scope, int ownerId)
    {
        if (await DenyAsync(scope, ownerId, false) is { } deny) return deny;
        var (c, d) = Owner(scope, ownerId);
        return Ok(await _svc.GetLibraryAsync(c, d));
    }

    [HttpPost("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-email-templates")]
    public async Task<ActionResult> CreateTemplate(string scope, int ownerId, [FromBody] SaveMassEmailTemplateDto dto)
    {
        if (await DenyAsync(scope, ownerId, true) is { } deny) return deny;
        var (c, d) = Owner(scope, ownerId);
        try { return Ok(new { id = await _svc.CreateTemplateAsync(c, d, dto, UserId) }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-email-templates/{id:int}")]
    public async Task<ActionResult> UpdateTemplate(string scope, int ownerId, int id, [FromBody] SaveMassEmailTemplateDto dto)
    {
        if (await DenyAsync(scope, ownerId, true) is { } deny) return deny;
        var (c, d) = Owner(scope, ownerId);
        try
        {
            return await _svc.UpdateTemplateAsync(c, d, id, dto, UserId)
                ? Ok(new { message = "Template saved." })
                : NotFound(new { message = "Template not found." });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-email-templates/{id:int}")]
    public async Task<ActionResult> DeleteTemplate(string scope, int ownerId, int id)
    {
        if (await DenyAsync(scope, ownerId, true) is { } deny) return deny;
        var (c, d) = Owner(scope, ownerId);
        return await _svc.DeleteTemplateAsync(c, d, id, UserId)
            ? Ok(new { message = "Template deleted." })
            : NotFound(new { message = "Template not found." });
    }

    // ===== Attachments =====

    [HttpGet("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-emails/{emailId:int}/attachments")]
    public async Task<ActionResult> ListAttachments(string scope, int ownerId, int emailId)
    {
        if (await DenyCampaignAsync(scope, ownerId, emailId, false) is { } deny) return deny;
        return Ok(await _svc.ListAttachmentsAsync(emailId));
    }

    [HttpPost("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-emails/{emailId:int}/attachments")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult> AddAttachment(string scope, int ownerId, int emailId, IFormFile file)
    {
        if (await DenyCampaignAsync(scope, ownerId, emailId, true) is { } deny) return deny;
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file supplied." });
        if (file.Length > MassEmailComposeService.MaxFileBytes) return BadRequest(new { message = "Each file can be 5 MB at most." });
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        try { return Ok(await _svc.AddAttachmentAsync(emailId, file.FileName, ms.ToArray(), UserId)); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-emails/{emailId:int}/attachments/{attachmentId:int}")]
    public async Task<ActionResult> DeleteAttachment(string scope, int ownerId, int emailId, int attachmentId)
    {
        if (await DenyCampaignAsync(scope, ownerId, emailId, true) is { } deny) return deny;
        try
        {
            return await _svc.DeleteAttachmentAsync(emailId, attachmentId)
                ? Ok(new { message = "Attachment removed." })
                : NotFound(new { message = "Attachment not found." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/mass-emails/{emailId:int}/attachments/{attachmentId:int}/download")]
    public async Task<ActionResult> DownloadAttachment(string scope, int ownerId, int emailId, int attachmentId)
    {
        if (await DenyCampaignAsync(scope, ownerId, emailId, false) is { } deny) return deny;
        var file = await _svc.ReadAttachmentAsync(emailId, attachmentId);
        return file is { } f ? File(f.Content, f.ContentType, f.FileName) : NotFound(new { message = "Attachment not found." });
    }

    // ===== Signature (the signed-in sender's own) =====

    [HttpGet("api/mass-email/signature")]
    public async Task<ActionResult> GetSignature()
    {
        if (UserId <= 0) return Unauthorized();
        return Ok(new MassEmailSignatureDto { Html = await _svc.GetSignatureAsync(UserId) });
    }

    [HttpPut("api/mass-email/signature")]
    public async Task<ActionResult> SaveSignature([FromBody] MassEmailSignatureDto dto)
    {
        if (UserId <= 0) return Unauthorized();
        try { return Ok(new MassEmailSignatureDto { Html = await _svc.SaveSignatureAsync(UserId, dto.Html) }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }
}

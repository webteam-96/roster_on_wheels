using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// WordPress connector, admin side: a club or district admin manages its read-only website API keys and picks which
/// documents a connected website may list. Same rights check as the club/district Documents pages.
/// </summary>
[ApiController]
[Authorize]
[Route("api/{scopes:regex(^(clubs|districts)$)}/{scopeId:int}/website-api")]
public class WebsiteApiKeysController : ControllerBase
{
    private readonly WebsiteConnectorService _svc;
    private readonly AdminYearGuard _guard;

    public WebsiteApiKeysController(WebsiteConnectorService svc, AdminYearGuard guard)
    {
        _svc = svc;
        _guard = guard;
    }

    public sealed class CreateKeyDto { public string? Label { get; set; } }
    public sealed class DocumentPublicDto { public bool IsPublic { get; set; } }

    private static string Scope(string scopes) => scopes == "clubs" ? "club" : "district";

    private Task<ObjectResult?> DenyAsync(string scopes, int scopeId) => scopes == "clubs"
        ? _guard.ClubYearlessAsync(User, scopeId)
        : _guard.DistrictYearlessAsync(User, scopeId);

    [HttpGet("keys")]
    public async Task<IActionResult> List(string scopes, int scopeId)
    {
        if (await DenyAsync(scopes, scopeId) is { } denied) return denied;
        return Ok(await _svc.ListKeysAsync(Scope(scopes), scopeId));
    }

    [HttpPost("keys")]
    public async Task<IActionResult> Create(string scopes, int scopeId, [FromBody] CreateKeyDto dto)
    {
        if (await DenyAsync(scopes, scopeId) is { } denied) return denied;
        var label = dto.Label?.Trim() ?? "";
        if (label.Length is < 1 or > 100) return BadRequest(new { message = "Give the key a name of 1 to 100 characters." });
        var memberId = int.TryParse(User.FindFirst("memberId")?.Value, out var m) ? m : 0;
        var made = await _svc.CreateKeyAsync(Scope(scopes), scopeId, label, memberId);
        if (made is not { } k)
            return Conflict(new { message = $"Revoke a key first: at most {WebsiteConnectorService.MaxActiveKeys} keys can be active." });
        // the only time the key is ever returned
        return Ok(new { key = k.Key, item = k.Row });
    }

    [HttpDelete("keys/{keyId:int}")]
    public async Task<IActionResult> Revoke(string scopes, int scopeId, int keyId)
    {
        if (await DenyAsync(scopes, scopeId) is { } denied) return denied;
        return await _svc.RevokeKeyAsync(Scope(scopes), scopeId, keyId)
            ? Ok(new { message = "Key revoked." })
            : NotFound(new { message = "Key not found or already revoked." });
    }

    [HttpGet("documents")]
    public async Task<IActionResult> Documents(string scopes, int scopeId)
    {
        if (await DenyAsync(scopes, scopeId) is { } denied) return denied;
        return Ok(await _svc.ListDocumentsAsync(Scope(scopes), scopeId));
    }

    [HttpPut("documents/{documentId:int}")]
    public async Task<IActionResult> SetDocumentPublic(string scopes, int scopeId, int documentId, [FromBody] DocumentPublicDto dto)
    {
        if (await DenyAsync(scopes, scopeId) is { } denied) return denied;
        return await _svc.SetDocumentPublicAsync(Scope(scopes), scopeId, documentId, dto.IsPublic)
            ? Ok(new { documentId, dto.IsPublic })
            : NotFound(new { message = "Document not found." });
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// WordPress connector, read side (row/integrations/wordpress/row-connector). The X-ROW-Key header decides which
/// club or district is read; nothing in the URL can widen it. Public-safe fields only; rate limited per key.
/// </summary>
[ApiController]
[AllowAnonymous]
[EnableRateLimiting(WebsiteConnectorRateLimit.Policy)]
[Route("api/public/connector/v1")]
public class WebsiteConnectorController : ControllerBase
{
    private readonly WebsiteConnectorService _svc;

    public WebsiteConnectorController(WebsiteConnectorService svc) => _svc = svc;

    private async Task<(string Scope, int Id)?> KeyScopeAsync() =>
        await _svc.ResolveKeyAsync(Request.Headers[WebsiteConnectorService.KeyHeader].FirstOrDefault());

    private static UnauthorizedObjectResult BadKey() => new(new { message = "Missing, unknown or revoked website API key." });

    [HttpGet("site")]
    public async Task<IActionResult> Site() =>
        await KeyScopeAsync() is { } s ? Ok(new { scope = s.Scope, id = s.Id }) : BadKey();

    [HttpGet("events")]
    public async Task<IActionResult> Events([FromQuery] int? limit) =>
        await KeyScopeAsync() is { } s ? Ok(await _svc.EventsAsync(s.Scope, s.Id, WebsiteConnectorService.ClampLimit(limit))) : BadKey();

    [HttpGet("officers")]
    public async Task<IActionResult> Officers() =>
        await KeyScopeAsync() is { } s ? Ok(await _svc.OfficersAsync(s.Scope, s.Id)) : BadKey();

    [HttpGet("news")]
    public async Task<IActionResult> News([FromQuery] int? limit) =>
        await KeyScopeAsync() is { } s ? Ok(await _svc.NewsAsync(s.Scope, s.Id, WebsiteConnectorService.ClampLimit(limit))) : BadKey();

    [HttpGet("projects")]
    public async Task<IActionResult> Projects([FromQuery] int? limit) =>
        await KeyScopeAsync() is { } s ? Ok(await _svc.ProjectsAsync(s.Scope, s.Id, WebsiteConnectorService.ClampLimit(limit))) : BadKey();

    [HttpGet("directory")]
    public async Task<IActionResult> Directory() =>
        await KeyScopeAsync() is { } s ? Ok(await _svc.DirectoryAsync(s.Scope, s.Id)) : BadKey();

    [HttpGet("documents")]
    public async Task<IActionResult> Documents() =>
        await KeyScopeAsync() is { } s ? Ok(await _svc.DocumentsAsync(s.Scope, s.Id)) : BadKey();
}

/// <summary>
/// 120 requests a minute per calling server. Partitioned by IP, not by key: a per-key bucket could be dodged by
/// sending a fresh made-up key each time. The plugin caches every response, so a site needs a handful a minute.
/// </summary>
public static class WebsiteConnectorRateLimit
{
    public const string Policy = "website-connector";
    public const int PermitPerMinute = 120;

    public static string PartitionKey(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}

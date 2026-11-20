using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Website extras editor: social feed embeds, Google Analytics ID, and QR codes of the site's public pages. The path is
/// under api/clubs/{id} or api/districts/{id}, so ScopeWriteGuardMiddleware lets only that club's or district's
/// managers save and its members read (the app's share screen); AuditMiddleware records every write.
/// </summary>
[ApiController]
[Authorize]
[Route("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-extras")]
public class WebsiteExtrasController : ControllerBase
{
    private readonly IWebsiteExtrasService _extras;

    public WebsiteExtrasController(IWebsiteExtrasService extras) => _extras = extras;

    private static string Owner(string scope) => scope == "clubs" ? "club" : "district";
    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    [HttpGet]
    public async Task<IActionResult> Get(string scope, int ownerId) => Ok(await _extras.GetAsync(Owner(scope), ownerId));

    [HttpPut]
    public async Task<IActionResult> Save(string scope, int ownerId, [FromBody] WebsiteExtrasDto dto)
    {
        var error = await _extras.SaveAsync(Owner(scope), ownerId, dto, MemberId);
        return error == null ? Ok(await _extras.GetAsync(Owner(scope), ownerId)) : BadRequest(new { message = error });
    }

    /// <summary>QR code of one page of the site (path like /events), PNG or SVG, as a download.</summary>
    [HttpGet("qr")]
    public async Task<IActionResult> Qr(string scope, int ownerId, [FromQuery] string? path, [FromQuery] string format = "png")
    {
        if (!WebsiteExtrasService.IsSafePath(path)) return BadRequest(new { message = "Pick a page of the website." });
        var view = await _extras.GetAsync(Owner(scope), ownerId);
        if (view.SiteUrl == null) return NotFound(new { message = "The website has no address yet." });
        var url = view.SiteUrl.TrimEnd('/') + path;
        var name = "qr" + (path == "/" ? "-home" : "-" + WebsiteExtrasService.Slug(path!));
        return format == "svg"
            ? File(Encoding.UTF8.GetBytes(WebsiteExtrasService.QrSvg(url)), "image/svg+xml", name + ".svg")
            : File(WebsiteExtrasService.QrPng(url), "image/png", name + ".png");
    }
}

/// <summary>
/// What a public club or district site needs: its feeds and analytics ID; for club sites also search and the sitemap
/// entries. 404 when the site is off, like the other public site endpoints.
/// </summary>
[ApiController]
[AllowAnonymous]
[EnableRateLimiting("public-read")]
[Route("api/public/website-extras")]
public class PublicWebsiteExtrasController : ControllerBase
{
    private readonly IWebsiteExtrasService _extras;

    public PublicWebsiteExtrasController(IWebsiteExtrasService extras) => _extras = extras;

    [HttpGet("{scope:regex(^(club|district)$)}/{ownerId:int}")]
    public async Task<IActionResult> Get(string scope, int ownerId)
        => await _extras.GetPublicAsync(scope, ownerId) is { } dto ? Ok(dto) : NotFound();

    [HttpGet("club/{clubId:int}/search")]
    public async Task<IActionResult> Search(int clubId, [FromQuery] string? q)
        => await _extras.SearchClubAsync(clubId, q ?? "") is { } hits ? Ok(hits) : NotFound();

    [HttpGet("club/{clubId:int}/sitemap")]
    public async Task<IActionResult> Sitemap(int clubId)
        => await _extras.SitemapClubAsync(clubId) is { } entries ? Ok(entries) : NotFound();

    // The club site is static files on IIS: its web.config sends /sitemap.xml and /robots.txt here with ?host= (no dots
    // in these paths, so IIS never takes them for static files).

    /// <summary>sitemap.xml of the live club website on this host.</summary>
    [HttpGet("sitemap-xml")]
    [ResponseCache(Duration = 600, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "host" })]
    public async Task<IActionResult> SitemapXml([FromQuery] string? host)
    {
        if (await _extras.ClubByHostAsync(host) is not { } site) return NotFound();
        var entries = await _extras.SitemapClubAsync(site.ClubId);
        return entries == null ? NotFound() : Content(WebsiteExtrasService.SitemapXml(site.Host, entries), "application/xml; charset=utf-8");
    }

    /// <summary>robots.txt for this host: crawlable with a sitemap when it is a live club website, closed otherwise.</summary>
    [HttpGet("robots-txt")]
    [ResponseCache(Duration = 600, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "host" })]
    public async Task<IActionResult> RobotsTxt([FromQuery] string? host)
        => Content(WebsiteExtrasService.RobotsTxt((await _extras.ClubByHostAsync(host))?.Host), "text/plain; charset=utf-8");
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Website builder: custom pages with sections (rich text, picture, file, embed, live ROW data widgets), a home layout
/// (slug "home"), draft and publish, and the site's media library, for club and district websites.
/// Admin routes need the site admin's current-year rights (AdminYearGuard, also for reads: drafts are private).
/// Public reads (CORS "PublicOpen", so club domains may call them) return the published copy only. Members-only pages
/// and files need a club website member session (WebsiteMemberSession, header X-Site-Session); without one they are
/// never returned: the page answers 401 without its content, and members-only files are left out of every page.
/// </summary>
[ApiController]
public class WebsitePagesController : ControllerBase
{
    private const long MaxFileBytes = 10 * 1024 * 1024;
    private const string SessionHeader = "X-Site-Session";

    private static readonly Dictionary<string, string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".gif"] = "image/gif", [".webp"] = "image/webp",
        [".pdf"] = "application/pdf",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };

    private readonly AdminYearGuard _guard;
    private readonly WebsitePageService _pages;
    private readonly WebsiteMemberSession _session;
    private readonly IClubSiteCachePurger _purger;
    private readonly IWebHostEnvironment _env;

    public WebsitePagesController(AdminYearGuard guard, WebsitePageService pages, WebsiteMemberSession session,
        IClubSiteCachePurger purger, IWebHostEnvironment env)
    {
        _guard = guard;
        _pages = pages;
        _session = session;
        _purger = purger;
        _env = env;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static string? Owner(string scope) => scope switch { "clubs" => "club", "districts" => "district", _ => null };

    private string WebRoot => _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");

    /// <summary>Members-only files live here, outside the web root, so no static URL can reach them.</summary>
    private string PrivateRoot => Path.Combine(_env.ContentRootPath, "App_Data", "website-private");

    /// <summary>Disk path of a stored media url ("/uploads/..." public, "private/..." members-only). Both are built here.</summary>
    private string DiskPath(string url) => url.StartsWith("private/", StringComparison.Ordinal)
        ? Path.Combine(PrivateRoot, url["private/".Length..].Replace('/', Path.DirectorySeparatorChar))
        : Path.Combine(WebRoot, url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

    /// <summary>Null when allowed; otherwise the refusal to return.</summary>
    private async Task<ActionResult?> DenyAsync(string scope, int ownerId) => Owner(scope) switch
    {
        "club" => await _guard.ClubYearlessAsync(User, ownerId),
        "district" => await _guard.DistrictYearlessAsync(User, ownerId),
        _ => NotFound(),
    };

    private void Purge(string scope, int ownerId)
    {
        if (scope == "clubs") _purger.PurgeByClub(ownerId);
    }

    private static (string Slug, string Title, List<WebsiteSection> Sections) Validate(SaveWebsitePageDto dto)
    {
        var v = (WebsitePageRules.Slug(dto.Slug), WebsitePageRules.Title(dto.Title), WebsitePageRules.Sections(dto.Sections));
        if (dto.MembersOnly && v.Item1 == WebsitePageRules.HomeSlug)
            throw new ArgumentException("The home layout is always public. Put members-only content on a custom page.");
        return v;
    }

    [Authorize]
    [HttpGet("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-pages")]
    public async Task<ActionResult> List(string scope, int ownerId)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        return Ok(await _pages.ListAsync(Owner(scope)!, ownerId));
    }

    [Authorize]
    [HttpGet("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-pages/{id:int}")]
    public async Task<ActionResult> Get(string scope, int ownerId, int id)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        var page = await _pages.GetAsync(Owner(scope)!, ownerId, id);
        return page == null ? NotFound(new { message = "Page not found." }) : Ok(page);
    }

    [Authorize]
    [HttpPost("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-pages")]
    public async Task<ActionResult> Create(string scope, int ownerId, [FromBody] SaveWebsitePageDto dto)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        (string Slug, string Title, List<WebsiteSection> Sections) v;
        try { v = Validate(dto); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        var id = await _pages.CreateAsync(Owner(scope)!, ownerId, v.Slug, v.Title, v.Sections, dto.MembersOnly, UserId);
        return id == null ? Conflict(new { message = "Another page already uses this address." }) : Ok(new { id });
    }

    [Authorize]
    [HttpPut("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-pages/{id:int}")]
    public async Task<ActionResult> Update(string scope, int ownerId, int id, [FromBody] SaveWebsitePageDto dto)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        (string Slug, string Title, List<WebsiteSection> Sections) v;
        try { v = Validate(dto); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        var owner = Owner(scope)!;
        var existing = await _pages.GetAsync(owner, ownerId, id);
        if (existing == null) return NotFound(new { message = "Page not found." });
        // The home layout keeps its address; menus and the site rely on it.
        if (existing.Slug == WebsitePageRules.HomeSlug && v.Slug != WebsitePageRules.HomeSlug)
            return BadRequest(new { message = "The home layout's address cannot be changed." });
        var ok = await _pages.UpdateDraftAsync(owner, ownerId, id, v.Slug, v.Title, v.Sections, dto.MembersOnly, UserId);
        if (ok == null) return Conflict(new { message = "Another page already uses this address." });
        // Visibility applies at once (also to the published copy), so the cached public site must forget the page.
        if (existing.MembersOnly != dto.MembersOnly) Purge(scope, ownerId);
        return Ok(new { message = "Draft saved." });
    }

    [Authorize]
    [HttpPost("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-pages/{id:int}/publish")]
    public Task<ActionResult> Publish(string scope, int ownerId, int id) => SetPublished(scope, ownerId, id, true);

    [Authorize]
    [HttpPost("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-pages/{id:int}/unpublish")]
    public Task<ActionResult> Unpublish(string scope, int ownerId, int id) => SetPublished(scope, ownerId, id, false);

    private async Task<ActionResult> SetPublished(string scope, int ownerId, int id, bool publish)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        if (!await _pages.PublishAsync(Owner(scope)!, ownerId, id, publish, UserId)) return NotFound(new { message = "Page not found." });
        Purge(scope, ownerId);
        return Ok(new { message = publish ? "Published." : "Taken off the website." });
    }

    [Authorize]
    [HttpDelete("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-pages/{id:int}")]
    public async Task<ActionResult> Delete(string scope, int ownerId, int id)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        if (!await _pages.DeleteAsync(Owner(scope)!, ownerId, id)) return NotFound(new { message = "Page not found." });
        Purge(scope, ownerId);
        return Ok(new { message = "Page deleted." });
    }

    // ── Media library ──────────────────────────────────────────────────────────────────────────────────────

    [Authorize]
    [HttpGet("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-media")]
    public async Task<ActionResult> ListMedia(string scope, int ownerId)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        var list = await _pages.ListMediaAsync(Owner(scope)!, ownerId);
        foreach (var m in list.Where(m => m.MembersOnly)) m.Url = $"media:{m.Id}"; // never hand out the private path
        return Ok(list);
    }

    /// <summary>A short-lived link so the admin can open a members-only file.</summary>
    [Authorize]
    [HttpGet("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-media/{id:int}/link")]
    public async Task<ActionResult> MediaLink(string scope, int ownerId, int id)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        var row = await _pages.GetMediaAsync(id);
        if (row == null || row.OwnerType != Owner(scope) || row.OwnerId != ownerId) return NotFound(new { message = "File not found." });
        return Ok(new { url = row.MembersOnly ? _session.SignedFileUrl(Request.PathBase, id) : row.Url });
    }

    [Authorize]
    [HttpPost("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-media")]
    [RequestSizeLimit(MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult> UploadMedia(string scope, int ownerId, IFormFile file, [FromForm] bool membersOnly = false)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file supplied." });
        if (file.Length > MaxFileBytes) return BadRequest(new { message = "Files can be at most 10 MB." });
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedTypes.TryGetValue(ext, out var contentType))
            return BadRequest(new { message = "Only JPG, PNG, GIF, WEBP pictures and PDF, Word, Excel or PowerPoint files are allowed." });

        var owner = Owner(scope)!;
        var folder = $"{owner}-{ownerId}";
        var name = $"{Guid.NewGuid():N}{ext}";
        var url = membersOnly ? $"private/{folder}/{name}" : $"/uploads/website-pages/{folder}/{name}";
        var path = DiskPath(url);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using (var fs = new FileStream(path, FileMode.CreateNew))
            await file.CopyToAsync(fs);

        var original = Path.GetFileName(file.FileName);
        if (original.Length > 255) original = original[..255];
        var id = await _pages.AddMediaAsync(owner, ownerId, url, original, membersOnly, contentType, UserId);
        return Ok(new WebsiteMediaDto
        {
            Id = id, Url = membersOnly ? $"media:{id}" : url, FileName = original, CreatedAt = DateTime.UtcNow,
            MembersOnly = membersOnly, ContentType = contentType,
        });
    }

    [Authorize]
    [HttpDelete("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-media/{id:int}")]
    public async Task<ActionResult> DeleteMedia(string scope, int ownerId, int id)
    {
        if (await DenyAsync(scope, ownerId) is { } denied) return denied;
        var url = await _pages.DeleteMediaAsync(Owner(scope)!, ownerId, id);
        if (url == null) return NotFound(new { message = "File not found." });
        var path = DiskPath(url); // url is one this controller built, so the path stays in its folder
        if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
        return Ok(new { message = "File deleted." });
    }

    // ── Club website member session ────────────────────────────────────────────────────────────────────────

    public sealed class SiteSignInDto { public string? Email { get; set; } public string? Password { get; set; } }

    [AllowAnonymous]
    [EnableCors("PublicOpen")]
    [EnableRateLimiting("auth")]
    [HttpPost("api/public/website-session/club/{clubId:int}")]
    public async Task<ActionResult> SiteSignIn(int clubId, [FromBody] SiteSignInDto dto)
    {
        try
        {
            var (token, name, expires) = await _session.SignInAsync(clubId, dto?.Email, dto?.Password);
            Response.Headers.CacheControl = "no-store";
            return Ok(new { token, name, expiresAt = expires.UtcDateTime });
        }
        catch (UnauthorizedAccessException ex) { return Unauthorized(new { message = ex.Message }); }
    }

    [AllowAnonymous]
    [EnableCors("PublicOpen")]
    [HttpGet("api/public/website-session/club/{clubId:int}")]
    public async Task<ActionResult> SiteSession(int clubId)
    {
        Response.Headers.CacheControl = "no-store";
        return await _session.MemberAsync(Request.Headers[SessionHeader], clubId) == null
            ? Unauthorized(new { message = "Please sign in." })
            : Ok(new { signedIn = true });
    }

    /// <summary>A members-only file, through a signed link a member session received (valid one hour).</summary>
    [AllowAnonymous]
    [EnableCors("PublicOpen")]
    [HttpGet("api/public/website-files/{id:int}")]
    public async Task<ActionResult> SiteFile(int id, [FromQuery] long e, [FromQuery] string? s)
    {
        if (!_session.FileLinkValid(id, e, s)) return NotFound();
        var row = await _pages.GetMediaAsync(id);
        if (row == null || !row.MembersOnly) return NotFound();
        var path = DiskPath(row.Url);
        if (!System.IO.File.Exists(path)) return NotFound();
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return PhysicalFile(path, row.ContentType ?? "application/octet-stream", row.FileName);
    }

    // ── Public read ────────────────────────────────────────────────────────────────────────────────────────

    [AllowAnonymous]
    [EnableCors("PublicOpen")]
    [HttpGet("api/public/website-pages/{owner:regex(^(club|district)$)}/{ownerId:int}/{slug}")]
    public async Task<ActionResult> Public(string owner, int ownerId, string slug)
    {
        string clean;
        try { clean = WebsitePageRules.Slug(slug); }
        catch (ArgumentException) { return NotFound(); }
        var page = await _pages.GetPublishedAsync(owner, ownerId, clean);
        if (page == null) return NotFound(new { message = "Page not found." });

        // The member is looked up only when something members-only is on the page. District sites have no member sign-in.
        int? member = null;
        var looked = false;
        async Task<bool> SignedInAsync()
        {
            if (!looked) { looked = true; member = owner == "club" ? await _session.MemberAsync(Request.Headers[SessionHeader], ownerId) : null; }
            return member != null;
        }

        if (page.Value.MembersOnly)
        {
            Response.Headers.CacheControl = "private, no-store";
            if (!await SignedInAsync()) return Unauthorized(new { membersOnly = true, message = "This page is for members. Please sign in." });
        }

        var sections = new List<WebsiteSection>();
        foreach (var s in WebsitePageRules.PublicSections(page.Value.Sections))
        {
            if (WebsitePageRules.MediaRef(s.Url) is int mediaId)
            {
                var row = await _pages.GetMediaAsync(mediaId);
                if (row == null || row.OwnerType != owner || row.OwnerId != ownerId) continue;
                if (row.MembersOnly)
                {
                    if (!await SignedInAsync()) continue; // never shown, not even its name
                    Response.Headers.CacheControl = "private, no-store";
                    s.Url = _session.SignedFileUrl(Request.PathBase, mediaId);
                }
                else s.Url = row.Url;
                if (s.Type == "file" && s.Caption == null) s.Caption = row.FileName;
            }
            sections.Add(s);
        }
        return Ok(new
        {
            slug = clean,
            title = page.Value.Title,
            membersOnly = page.Value.MembersOnly,
            sections,
            publishedAt = page.Value.PublishedAt,
        });
    }
}

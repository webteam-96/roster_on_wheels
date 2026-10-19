using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// ONE share endpoint for all four surfaces (main web app, club website, district website,
/// mobile app):
///
///   GET /api/public/projects/{id}/share?yearId=            -> JSON { title, clubName, districtNumber,
///                                                                    summary, shareText, shareUrl, imageUrl, ... }
///   GET /api/public/projects/{id}/share-image.png?yearId=  -> 1200x630 PNG social-preview card
///
/// Both are [AllowAnonymous] — a share link has to open for a logged-out recipient. Unlike the
/// public directory/stats endpoints, a share link is meant to work as soon as a club creates the
/// project — waiting on district approval would defeat the point of sharing it — so the filter is
/// deliberately looser than PublicProjectStatsController's:
///   isdeleted = 0 AND is_active = 1 AND approval_status <> 'Rejected'   (Pending/blank/Approved all shareable)
/// plus the club -> district -> zone active chain (the public kill switch).
///
/// shareUrl points at the club's OWN website when that club has a LIVE site
/// (club_websites.Status='Active' AND CURDATE() BETWEEN StartDate AND EndDate AND the geo chain is
/// active — the same predicate PublicWebsiteDirectoryController uses), otherwise it falls back to
/// the public project page on portal.example.org.
/// </summary>
[ApiController]
[AllowAnonymous]
[EnableCors("PublicOpen")]   // called from the browser on ~1000 un-enumerable club/district domains
public class PublicProjectShareController : ControllerBase
{
    private readonly string _connStr;
    private readonly IYearTableResolver _yearTables;
    private readonly IConfiguration _config;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<PublicProjectShareController> _logger;

    public PublicProjectShareController(
        IConfiguration config,
        IYearTableResolver yearTables,
        IWebHostEnvironment env,
        ILogger<PublicProjectShareController> logger)
    {
        _config = config;
        _connStr = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _env = env;
        _logger = logger;
    }

    // ── Truncation rules ────────────────────────────────────────────────────
    // Summary: 200 chars, cut on a word boundary, ellipsis appended.
    //   Why 200: title (~70) + club + district (~50) + summary (200) + URL (~60) lands the whole
    //   shareText near 380 chars. WhatsApp shows ~700 chars before it folds behind "Read more",
    //   so the message stays fully visible in the chat bubble, and the same 200 chars fills the
    //   card's description block at 16.5pt without overflowing 630px.
    private const int SummaryMaxChars = 200;
    // Title on the card / in the text — untouched in the JSON `title` field.
    private const int TitleMaxChars = 110;

    private MySqlConnection CreateConn() => new(_connStr);

    // ── The share payload ───────────────────────────────────────────────────
    [HttpGet("api/public/projects/{id:int}/share")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetShare(int id, [FromQuery] int? yearId = null)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();

        var p = await LoadShareableProjectAsync(conn, id, yearId);
        if (p is null) return NotFound(new { message = "Project not found." });

        var (shareUrl, clubSiteBase) = await BuildShareUrlAsync(conn, p);
        var clubDisplay = ClubDisplayName(p.ClubName);
        var summary = Truncate(Normalise(p.Description), SummaryMaxChars);
        var title = string.IsNullOrWhiteSpace(p.Title) ? "Rotary service project" : p.Title!.Trim();

        return Ok(new
        {
            id = p.Id,
            yearId = p.YearId,
            title,
            clubName = p.ClubName ?? "",            // raw, as every other api/public/* route returns it
            clubDisplayName = clubDisplay,          // "Rotary Club of X" — the report-builder convention
            districtNumber = p.DistrictNumber ?? "",
            areaOfFocus = p.AreaOfFocus,
            summary,
            shareText = BuildShareText(title, clubDisplay, p.DistrictNumber, summary, shareUrl),
            shareTextSingleLine = BuildShareTextSingleLine(title, clubDisplay, p.DistrictNumber, summary, shareUrl),
            shareUrl,
            imageUrl = $"{ApiBaseUrl()}/api/public/projects/{p.Id}/share-image.png?yearId={p.YearId}",
            hasClubWebsite = clubSiteBase.Length > 0,   // false => shareUrl is the portal.example.org fallback
            clubWebsiteUrl = clubSiteBase.Length > 0 ? clubSiteBase : null,
        });
    }

    // ── The 1200x630 social-preview card ────────────────────────────────────
    // Generated on demand and cached to disk; a repeat hit (every crawler that unfurls the link,
    // every recipient's client) is a plain file read.
    [HttpGet("api/public/projects/{id:int}/share-image.png")]
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetShareImage(int id, [FromQuery] int? yearId = null)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();

        var p = await LoadShareableProjectAsync(conn, id, yearId);
        if (p is null) return NotFound(new { message = "Project not found." });

        var (shareUrl, _) = await BuildShareUrlAsync(conn, p);
        var title = Truncate(Normalise(p.Title), TitleMaxChars);
        if (string.IsNullOrWhiteSpace(title)) title = "Rotary service project";
        var summary = Truncate(Normalise(p.Description), SummaryMaxChars);
        var clubDisplay = ClubDisplayName(p.ClubName);

        // Cache key covers everything the card draws, so an edited project (or a swapped primary
        // photo) yields a different filename and regenerates instead of serving a stale card.
        var stamp = Hash($"{title}|{clubDisplay}|{p.DistrictNumber}|{p.AreaOfFocus}|{summary}|{p.PrimaryPhoto}|{HostOf(shareUrl)}|v1");
        var cacheFile = CachePath(p.YearLabel, p.Id, stamp);

        if (cacheFile != null && System.IO.File.Exists(cacheFile))
        {
            try { return File(await System.IO.File.ReadAllBytesAsync(cacheFile), "image/png"); }
            catch (IOException) { /* mid-write / locked — fall through and regenerate */ }
        }

        var photoBytes = await CmrMediaLoader.LoadBytesAsync(_env, _config["Media:RedirectBaseUrl"], p.PrimaryPhoto);

        byte[] png;
        try
        {
            png = ProjectShareCardBuilder.Render(new ProjectShareCardData
            {
                Title = title,
                ClubDisplayName = clubDisplay,
                DistrictNumber = p.DistrictNumber ?? "",
                AreaOfFocus = p.AreaOfFocus,
                Summary = summary,
                FooterHost = HostOf(shareUrl),
                PhotoBytes = photoBytes,
            });
        }
        catch (Exception ex)
        {
            // A card that cannot be drawn must not 500 the share flow — the JSON payload and the
            // link still work, the unfurl just falls back to no image.
            _logger.LogError(ex, "Share card render failed for project {ProjectId} ({YearLabel})", p.Id, p.YearLabel);
            return NotFound(new { message = "Share image unavailable." });
        }

        TryWriteCache(cacheFile, p.YearLabel, p.Id, png);
        return File(png, "image/png");
    }

    // ── project lookup ──────────────────────────────────────────────────────

    private sealed class ShareRow
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public string? Title { get; set; }
        public string? Description { get; set; }
        public string? AreaOfFocus { get; set; }
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public string? DistrictNumber { get; set; }
        public string? PrimaryPhoto { get; set; }
    }

    // Public filter + active club->district->zone chain, in one query per candidate year table.
    // Photo URL is built exactly like PublicProjectController / PublicProjectStatsController:
    //   /Documents/gallery/Group{clubId}/Album{old_pk}            (migrated rows)
    //   /Documents/gallery/Group{clubId}/{YYYY_YY}/Album{pk}      (rows created in the new app)
    private static string ShareSql(YearTableInfo t)
    {
        var suffix = t.YearLabel.Replace("-", "_");
        return $@"
            SELECT p.pk_project_id AS Id, p.fk_year_id AS YearId,
                   CONVERT(p.title USING utf8mb4)       AS Title,
                   CONVERT(p.description USING utf8mb4) AS Description,
                   CONVERT(COALESCE(NULLIF(aof.name,''), NULLIF(p.other_area_of_focus,'')) USING utf8mb4) AS AreaOfFocus,
                   p.fk_club_id AS ClubId,
                   CONVERT(c.ClubName USING utf8mb4)        AS ClubName,
                   CONVERT(d.DistrictNumber USING utf8mb4)  AS DistrictNumber,
                   CONVERT((SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                   CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                        ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                   '/', ph.image_path)
                            FROM `{t.PhotosTable}` ph
                            WHERE ph.fk_project_id = p.pk_project_id
                            ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id
                            LIMIT 1) USING utf8mb4) AS PrimaryPhoto
            FROM `{t.ProjectsTable}` p
            JOIN club_master c     ON c.pk_club_id      = p.fk_club_id      AND c.isdeleted = 0 AND c.IsActive = 1
            JOIN district_master d ON d.pk_district_id  = c.fk_district_id  AND d.isdeleted = 0 AND d.IsActive = 1
            JOIN zone_master z     ON z.pk_zone_id      = d.fk_zone_id      AND z.isdeleted = 0 AND z.IsActive = 1
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
            WHERE p.pk_project_id = @Id
              AND p.isdeleted = 0 AND p.is_active = 1
              AND COALESCE(p.approval_status,'') <> 'Rejected'
            LIMIT 1";
    }

    private async Task<ShareRow?> LoadShareableProjectAsync(MySqlConnection conn, int id, int? yearId)
    {
        // pk_project_id is only unique WITHIN a year table — when the caller passed yearId, that
        // (id, yearId) pair is the ONE project being asked about. If it doesn't pass the public
        // filter (not yet approved, inactive, geo chain down, ...), the correct answer is "not
        // shareable right now" — NOT some other, unrelated project that happens to reuse the same
        // numeric id in a different year. Falling through to the scan-all-years fallback below is
        // only correct when the caller supplied no yearId at all (a legacy link).
        if (yearId is > 0)
        {
            var info = await _yearTables.ResolveByYearIdAsync(conn, yearId.Value);
            return info == null ? null : await QueryOneAsync(conn, info, id);
        }

        // Fallback for legacy links that carry no yearId: scan the year tables and take the first
        // row that passes the PUBLIC filter. Scanning on isdeleted alone (as the older public
        // endpoint does) could stop on a year table holding a non-approved row and 404 a project
        // that is perfectly visible in another year.
        foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
        {
            var hit = await QueryOneAsync(conn, t, id);
            if (hit != null) return hit;
        }
        return null;
    }

    private static async Task<ShareRow?> QueryOneAsync(MySqlConnection conn, YearTableInfo t, int id)
    {
        try
        {
            var row = await conn.QueryFirstOrDefaultAsync<ShareRow>(ShareSql(t), new { Id = id });
            if (row == null) return null;
            row.YearLabel = t.YearLabel;
            // area_of_focus_master.name carries stored casing/padding ("COMMUNITY ECONOMIC DEVELOPMENT ").
            row.AreaOfFocus = string.IsNullOrWhiteSpace(row.AreaOfFocus) ? null : row.AreaOfFocus!.Trim();
            if (row.YearId <= 0) row.YearId = t.YearId;   // legacy rows can carry a stale fk_year_id
            return row;
        }
        catch (MySqlException)
        {
            // A year table listed in rotary_year_master whose photos twin is missing — skip it.
            return null;
        }
    }

    // ── share URL: the club's live site, else the public site ───────────────

    private sealed class SiteRow
    {
        public string? Subdomain { get; set; }
        public string? ClientDomain { get; set; }
    }

    // A club site counts as LIVE only when the subscription row is active AND unexpired AND the
    // club -> district -> zone chain is active. Same predicate as
    // PublicWebsiteDirectoryController.GetClubWebsites — anything looser would hand out a link
    // to a site that renders an expiry overlay (or 404s) for the recipient.
    private static async Task<SiteRow?> LiveClubSiteAsync(MySqlConnection conn, int clubId) =>
        await conn.QueryFirstOrDefaultAsync<SiteRow>(@"
            SELECT CONVERT(cw.Subdomain USING utf8mb4) AS Subdomain,
                   CONVERT(cw.ClientDomain USING utf8mb4) AS ClientDomain
            FROM club_websites cw
            JOIN club_master c     ON c.pk_club_id     = cw.fk_club_id     AND c.isdeleted = 0 AND c.IsActive = 1
            JOIN district_master d ON d.pk_district_id = c.fk_district_id  AND d.isdeleted = 0 AND d.IsActive = 1
            JOIN zone_master z     ON z.pk_zone_id     = d.fk_zone_id      AND z.isdeleted = 0 AND z.IsActive = 1
            WHERE cw.fk_club_id = @ClubId
              AND COALESCE(cw.isdeleted, 0) = 0
              AND cw.Status = 'Active'
              AND CURDATE() BETWEEN cw.StartDate AND cw.EndDate
            LIMIT 1", new { ClubId = clubId });

    private static async Task<string> ClubParentDomainAsync(MySqlConnection conn)
    {
        var v = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
        return string.IsNullOrWhiteSpace(v) ? RotaryApi.Services.Brand.ClubSiteParentDomain : v!;
    }

    // Returns (shareUrl, clubSiteBaseUrl). clubSiteBaseUrl is "" when the club has no live site,
    // which is exactly the condition that selects the portal.example.org fallback.
    private async Task<(string ShareUrl, string ClubSiteBase)> BuildShareUrlAsync(MySqlConnection conn, ShareRow p)
    {
        var site = await LiveClubSiteAsync(conn, p.ClubId);
        if (site != null)
        {
            var parent = await ClubParentDomainAsync(conn);
            var baseUrl = MemberScopesHelper.BuildWebsiteUrl(site.ClientDomain?.Trim(), site.Subdomain?.Trim(), parent);
            if (!string.IsNullOrWhiteSpace(baseUrl))
            {
                // club-website project route: /project?pid={id}&yearId={yearId} — the tenant (club)
                // comes from the Host header; pid + yearId identify the project inside its year table
                // (pk_project_id repeats across the per-year rotary_projects_YYYY_YY tables).
                baseUrl = baseUrl.TrimEnd('/');
                return ($"{baseUrl}/project?pid={p.Id}&yearId={p.YearId}", baseUrl);
            }
        }

        // Fallback: the server-rendered public project page on the main site.
        // rotary-frontend/src/app/(site)/projects/[id]/page.tsx — it needs ?yearId= to disambiguate
        // an id that repeats across year tables.
        return ($"{PublicSiteBaseUrl()}/projects/{p.Id}?yearId={p.YearId}", "");
    }

    private string PublicSiteBaseUrl()
    {
        var v = _config["PublicFrontend:BaseUrl"];
        if (string.IsNullOrWhiteSpace(v)) v = _config["FrontendUrl"];
        if (string.IsNullOrWhiteSpace(v)) v = RotaryApi.Services.Brand.PortalOrigin;
        return v!.TrimEnd('/');
    }

    private string ApiBaseUrl()
    {
        var v = _config["Api:BaseUrl"];
        if (!string.IsNullOrWhiteSpace(v)) return v!.TrimEnd('/');
        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : "";
        return $"{Request.Scheme}://{Request.Host}{pathBase}".TrimEnd('/');
    }

    // ── text ────────────────────────────────────────────────────────────────

    private static string ClubDisplayName(string? clubName)
    {
        var n = (clubName ?? "").Trim();
        if (n.Length == 0) return "Rotary Club";
        // club_master.ClubName holds the bare place name ("Burhanpur"); every report builder in
        // this repo renders it as "Rotary Club of {name}". Two of 6,407 active rows already carry
        // the prefix, so don't double it.
        return n.StartsWith("Rotary", StringComparison.OrdinalIgnoreCase) ? n : $"Rotary Club of {n}";
    }

    // MULTI-LINE. This text is for the clipboard / the OS native share sheet / the body a member
    // types into a WhatsApp chat — line breaks are fine there. It is NOT for a WhatsApp *template*
    // body, which Meta forbids from containing line breaks; use `shareTextSingleLine` for that.
    private static string BuildShareText(string title, string club, string? district, string summary, string url)
    {
        var sb = new StringBuilder();
        sb.Append(title).Append('\n');
        sb.Append(club);
        if (!string.IsNullOrWhiteSpace(district)) sb.Append(" | RI District ").Append(district!.Trim());
        sb.Append('\n');
        if (!string.IsNullOrWhiteSpace(summary)) sb.Append('\n').Append(summary).Append('\n');
        sb.Append('\n').Append(url);
        return sb.ToString();
    }

    // SINGLE LINE. Safe to drop into a WhatsApp template variable (Meta rejects template bodies
    // containing newlines — see the GreetingsWorker rule).
    private static string BuildShareTextSingleLine(string title, string club, string? district, string summary, string url)
    {
        var parts = new List<string> { title, club };
        if (!string.IsNullOrWhiteSpace(district)) parts.Add($"RI District {district!.Trim()}");
        var head = string.Join(" - ", parts);
        var sb = new StringBuilder(head);
        if (!string.IsNullOrWhiteSpace(summary)) sb.Append(". ").Append(summary);
        sb.Append(' ').Append(url);
        return sb.ToString().Replace('\n', ' ').Replace('\r', ' ');
    }

    // Collapse the stored description (newlines, stray HTML, entities, runs of whitespace) into
    // one clean line so it reads correctly in a chat bubble and on the card.
    private static string Normalise(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var s = System.Text.RegularExpressions.Regex.Replace(raw, "<[^>]+>", " ");
        s = System.Net.WebUtility.HtmlDecode(s);
        s = s.Replace("\\n", " ").Replace("\\r", " ");   // some legacy rows store literal "\n"
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ");
        return s.Trim();
    }

    // Cut on a word boundary and append a single-character ellipsis. `max` is now a hard ceiling
    // for the result INCLUDING the ellipsis (it used to return max+1 characters).
    private static string Truncate(string s, int max)
    {
        if (string.IsNullOrEmpty(s) || max <= 0) return "";
        if (s.Length <= max) return s;
        var cut = s[..(max - 1)];                       // reserve one unit for the "…"
        var lastSpace = cut.LastIndexOf(' ');
        if (lastSpace > max / 2) cut = cut[..lastSpace]; // word boundary, never mid-word
        else if (cut.Length > 0 && char.IsHighSurrogate(cut[^1])) cut = cut[..^1]; // don't split an emoji
        cut = cut.TrimEnd(' ', ',', ';', ':', '-', '.');
        return cut.Length == 0 ? "" : cut + "…";
    }

    private static string HostOf(string url)
    {
        try { return new Uri(url).Host; } catch { return ""; }
    }

    private static string Hash(string s)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(s));
        return Convert.ToHexString(bytes, 0, 6).ToLowerInvariant();   // 12 hex chars
    }

    // ── disk cache ──────────────────────────────────────────────────────────
    // Under the media web root (Media:WebRoot in production — the legacy httpdocs whose Documents
    // subtree the app pool has Read+Modify on). The bytes are streamed back by THIS controller,
    // never by a /Documents/... URL, so the Media:RedirectBaseUrl 302 mapper (which hijacks GETs
    // under /Documents, /uploads and /tempdocument in dev) can't intercept a share image.
    private string? CacheDir(string yearLabel)
    {
        var root = _env.WebRootPath;
        if (string.IsNullOrWhiteSpace(root)) return null;
        var safeYear = System.Text.RegularExpressions.Regex.Replace(yearLabel ?? "", "[^0-9A-Za-z_-]", "");
        if (safeYear.Length == 0) safeYear = "unknown";
        return Path.Combine(root, "Documents", "share-cache", safeYear);
    }

    private string? CachePath(string yearLabel, int id, string stamp)
    {
        var dir = CacheDir(yearLabel);
        return dir == null ? null : Path.Combine(dir, $"p{id}-{stamp}.png");
    }

    private void TryWriteCache(string? cacheFile, string yearLabel, int id, byte[] png)
    {
        if (cacheFile == null) return;
        try
        {
            var dir = Path.GetDirectoryName(cacheFile)!;
            Directory.CreateDirectory(dir);

            // Drop this project's older cards (title/photo edits change the stamp) so the folder
            // holds at most one file per project per year.
            foreach (var stale in Directory.EnumerateFiles(dir, $"p{id}-*.png"))
            {
                if (!string.Equals(stale, cacheFile, StringComparison.OrdinalIgnoreCase))
                    try { System.IO.File.Delete(stale); } catch { }
            }

            // Write-then-move so a concurrent reader never sees a half-written PNG.
            var tmp = cacheFile + "." + Guid.NewGuid().ToString("N")[..8] + ".tmp";
            System.IO.File.WriteAllBytes(tmp, png);
            System.IO.File.Move(tmp, cacheFile, overwrite: true);
        }
        catch (Exception ex)
        {
            // Read-only / permission-denied web root: serve the freshly generated bytes anyway.
            _logger.LogWarning(ex, "Could not cache share image for project {ProjectId} ({YearLabel})", id, yearLabel);
        }
    }
}

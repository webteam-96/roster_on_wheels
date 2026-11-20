using System.Security;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;
using QRCoder;
using RotaryApi.Controllers;

namespace RotaryApi.Services;

/// <summary>Social feeds and analytics of one club or district website. Null fields are off.</summary>
public sealed record WebsiteExtrasDto(string? FacebookPageUrl, string? InstagramUsername, string? XUsername, string? GaMeasurementId);

/// <summary>A public page of the site: its title and its path on the site (for QR codes and the app's share list).</summary>
public sealed record WebsitePageLink(string Title, string Path);

/// <summary>What the admin page and the app need: the settings, the site's address (null when no live site) and its pages.</summary>
public sealed record WebsiteExtrasView(WebsiteExtrasDto Settings, string? SiteUrl, IReadOnlyList<WebsitePageLink> Pages);

/// <summary>One site search hit. Kind: page, event, project, newsletter.</summary>
public sealed record WebsiteSearchHit(string Kind, string Title, string? Snippet, string Path);

/// <summary>One sitemap.xml entry; LastModifiedUtc null when unknown.</summary>
public sealed record WebsiteSitemapEntry(string Path, DateTime? LastModifiedUtc);

public interface IWebsiteExtrasService
{
    Task<WebsiteExtrasView> GetAsync(string scope, int ownerId);
    /// <returns>null on success, else the message for the admin.</returns>
    Task<string?> SaveAsync(string scope, int ownerId, WebsiteExtrasDto dto, int memberId);
    /// <returns>null when the site is not live.</returns>
    Task<WebsiteExtrasDto?> GetPublicAsync(string scope, int ownerId);
    Task<IReadOnlyList<WebsiteSearchHit>?> SearchClubAsync(int clubId, string q);
    Task<IReadOnlyList<WebsiteSitemapEntry>?> SitemapClubAsync(int clubId);
    /// <summary>The live club website served on this host (its normalized host and club id), or null.</summary>
    Task<(string Host, int ClubId)?> ClubByHostAsync(string? host);
}

/// <summary>
/// Website extras (competitor gap list 2026-11-19): Facebook / Instagram / X feed embeds and a Google Analytics ID per
/// club or district site, site search across pages, events, projects and newsletters, sitemap.xml / robots.txt, and
/// QR codes for any public page. Only published rows are searched or listed, by the same rules as the public pages.
/// </summary>
public class WebsiteExtrasService : IWebsiteExtrasService
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;
    private readonly string _parentDomain;
    private readonly bool _useHttps;

    public WebsiteExtrasService(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _parentDomain = config.GetSection("PleskSettings")["ParentDomain"] ?? "";
        _useHttps = string.Equals(config.GetSection("ClubSite")["UseHttps"], "true", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The club site's fixed pages (row/club-website src/App.jsx routes).</summary>
    public static readonly WebsitePageLink[] ClubPages =
    {
        new("Home", "/"), new("About", "/about"), new("Projects", "/projects"), new("Events", "/events"),
        new("Calendar", "/calendar"), new("Board of directors", "/directors"), new("Dignitaries", "/dignitary"),
        new("Past presidents", "/past-presidents"), new("Newsletters", "/newsletters"), new("Gallery", "/gallery"),
        new("Search", "/search"), new("Social media", "/social"),
    };
    private static readonly WebsitePageLink[] DistrictPages = { new("Home", "/") };

    // ── Validation (pure; unit tested) ──────────────────────────────────────

    private static readonly Regex FacebookUrl = new(
        @"^(?:https?://)?(?:(?:www|m|web)\.)?(?:facebook\.com|fb\.com)/(?<path>profile\.php\?id=\d{1,25}|[A-Za-z0-9.\-]{1,80}(?:/[A-Za-z0-9.\-]{1,80})?)/?$",
        RegexOptions.IgnoreCase);
    private static readonly Regex InstagramUrl = new(@"^(?:https?://)?(?:www\.)?instagram\.com/(?<u>[A-Za-z0-9._]{1,30})/?$", RegexOptions.IgnoreCase);
    private static readonly Regex XUrl = new(@"^(?:https?://)?(?:www\.)?(?:x|twitter)\.com/(?<u>[A-Za-z0-9_]{1,15})/?$", RegexOptions.IgnoreCase);
    private static readonly Regex Handle30 = new(@"^@?(?<u>[A-Za-z0-9._]{1,30})$");
    private static readonly Regex Handle15 = new(@"^@?(?<u>[A-Za-z0-9_]{1,15})$");
    private static readonly Regex GaId = new(@"^G-[A-Z0-9]{4,15}$");

    /// <summary>Normalizes what the admin typed (a link or a @name) or returns the error for the first bad field.</summary>
    public static (WebsiteExtrasDto? Value, string? Error) Normalize(WebsiteExtrasDto dto)
    {
        static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        string? fb = null, ig = null, x = null, ga = null;

        if (Blank(dto.FacebookPageUrl) is { } f)
        {
            var m = FacebookUrl.Match(f);
            if (!m.Success) return (null, "Enter the Facebook page link, like https://www.facebook.com/yourclub.");
            fb = "https://www.facebook.com/" + m.Groups["path"].Value;
        }
        if (Blank(dto.InstagramUsername) is { } i)
        {
            var m = InstagramUrl.Match(i);
            if (!m.Success) m = Handle30.Match(i);
            if (!m.Success) return (null, "Enter the Instagram account name or its link, like instagram.com/yourclub.");
            ig = m.Groups["u"].Value;
        }
        if (Blank(dto.XUsername) is { } h)
        {
            var m = XUrl.Match(h);
            if (!m.Success) m = Handle15.Match(h);
            if (!m.Success) return (null, "Enter the X account name (up to 15 letters, numbers or _) or its link.");
            x = m.Groups["u"].Value;
        }
        if (Blank(dto.GaMeasurementId) is { } g)
        {
            g = g.ToUpperInvariant();
            if (!GaId.IsMatch(g)) return (null, "Enter the Google Analytics measurement ID, like G-ABC123DEF4.");
            ga = g;
        }
        return (new WebsiteExtrasDto(fb, ig, x, ga), null);
    }

    /// <summary>A search term made safe for LIKE: trimmed, 2 to 80 characters, wildcards escaped. Null when unusable.</summary>
    public static string? LikePattern(string? q)
    {
        var t = (q ?? "").Trim();
        if (t.Length < 2 || t.Length > 80) return null;
        return "%" + t.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
    }

    /// <summary>A file-name-safe slug of a page path: "/event?id=12" -> "event-id-12".</summary>
    public static string Slug(string name) => Regex.Replace(name.ToLowerInvariant().Trim(), "[^a-z0-9]+", "-").Trim('-');

    /// <summary>Plain-text excerpt around the first match, for search results (stored HTML is stripped).</summary>
    public static string? Snippet(string? text, string q, int width = 160)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var plain = Regex.Replace(System.Net.WebUtility.HtmlDecode(Regex.Replace(text, "<[^>]*>", " ")), @"\s+", " ").Trim();
        if (plain.Length <= width) return plain;
        var at = Math.Max(0, plain.IndexOf(q.Trim(), StringComparison.OrdinalIgnoreCase));
        var start = Math.Max(0, Math.Min(at - width / 3, plain.Length - width));
        return (start > 0 ? "..." : "") + plain.Substring(start, width).Trim() + (start + width < plain.Length ? "..." : "");
    }

    /// <summary>A page path that may go into a QR code: site-relative, no scheme or host, printable, at most 300 chars.</summary>
    public static bool IsSafePath(string? path) =>
        !string.IsNullOrEmpty(path) && path.Length <= 300 && path[0] == '/' && !path.StartsWith("//") && !path.Contains('\\')
        && path.All(c => c > ' ' && c < 127);

    /// <summary>QR code of a URL as PNG bytes or SVG text.</summary>
    public static byte[] QrPng(string url)
    {
        using var data = new QRCodeGenerator().CreateQrCode(url, QRCodeGenerator.ECCLevel.M);
        return new PngByteQRCode(data).GetGraphic(12);
    }

    public static string QrSvg(string url)
    {
        using var data = new QRCodeGenerator().CreateQrCode(url, QRCodeGenerator.ECCLevel.M);
        return new SvgQRCode(data).GetGraphic(12);
    }

    /// <summary>sitemap.xml for https://{host}: one url element per entry, XML-escaped.</summary>
    public static string SitemapXml(string host, IEnumerable<WebsiteSitemapEntry> entries)
    {
        var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
        foreach (var e in entries)
        {
            sb.Append("  <url><loc>").Append(SecurityElement.Escape($"https://{host}{e.Path}")).Append("</loc>");
            if (e.LastModifiedUtc is { } m) sb.Append("<lastmod>").Append(m.ToString("yyyy-MM-dd")).Append("</lastmod>");
            sb.Append("</url>\n");
        }
        return sb.Append("</urlset>\n").ToString();
    }

    /// <summary>robots.txt for a host: a live site may be crawled (search results excepted) and names its sitemap.</summary>
    public static string RobotsTxt(string? host) => host == null
        ? "User-agent: *\nDisallow: /\n"
        : $"User-agent: *\nAllow: /\nDisallow: /search\n\nSitemap: https://{host}/sitemap.xml\n";

    // ── Data ────────────────────────────────────────────────────────────────

    private MySqlConnection Conn() => RowDb.Connect(_connectionString);

    private static async Task<WebsiteExtrasDto> ReadAsync(MySqlConnection conn, string scope, int ownerId) =>
        await conn.QueryFirstOrDefaultAsync<WebsiteExtrasDto>(@"
            SELECT facebook_page_url AS FacebookPageUrl, instagram_username AS InstagramUsername,
                   x_username AS XUsername, ga_measurement_id AS GaMeasurementId
            FROM website_extras WHERE scope = @scope AND owner_id = @ownerId", new { scope, ownerId })
        ?? new WebsiteExtrasDto(null, null, null, null);

    public async Task<WebsiteExtrasView> GetAsync(string scope, int ownerId)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var settings = await ReadAsync(conn, scope, ownerId);
        var site = scope == "club"
            ? await conn.QueryFirstOrDefaultAsync<(string? Sub, string? Client)>(@"
                SELECT Subdomain, ClientDomain FROM club_websites
                WHERE fk_club_id = @ownerId AND COALESCE(isdeleted, 0) = 0 ORDER BY created_date DESC LIMIT 1", new { ownerId })
            : await conn.QueryFirstOrDefaultAsync<(string? Sub, string? Client)>(@"
                SELECT Subdomain, ClientDomain FROM district_websites
                WHERE fk_district_id = @ownerId AND isdeleted = 0 AND Status = 'Active' ORDER BY created_date DESC LIMIT 1", new { ownerId });
        string? siteUrl = null;
        if (site.Sub != null || site.Client != null)
        {
            var parent = scope == "club"
                ? await conn.ExecuteScalarAsync<string?>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain' LIMIT 1") ?? _parentDomain
                : _parentDomain;
            siteUrl = await WebsiteReachability.ResolveAsync(site.Client, site.Sub, parent, _useHttps);
        }
        return new WebsiteExtrasView(settings, siteUrl, scope == "club" ? ClubPages : DistrictPages);
    }

    public async Task<string?> SaveAsync(string scope, int ownerId, WebsiteExtrasDto dto, int memberId)
    {
        var (value, error) = Normalize(dto);
        if (value == null) return error;
        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            INSERT INTO website_extras (scope, owner_id, facebook_page_url, instagram_username, x_username, ga_measurement_id, updated_by, updated_at_utc)
            VALUES (@scope, @ownerId, @FacebookPageUrl, @InstagramUsername, @XUsername, @GaMeasurementId, @memberId, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE facebook_page_url = VALUES(facebook_page_url), instagram_username = VALUES(instagram_username),
                x_username = VALUES(x_username), ga_measurement_id = VALUES(ga_measurement_id),
                updated_by = VALUES(updated_by), updated_at_utc = VALUES(updated_at_utc)",
            new { scope, ownerId, value.FacebookPageUrl, value.InstagramUsername, value.XUsername, value.GaMeasurementId, memberId });
        return null;
    }

    private static Task<bool> IsLiveAsync(MySqlConnection conn, string scope, int ownerId) => scope == "club"
        ? ClubWebsitePublicDataController.IsClubServiceableAsync(conn, ownerId)
        : DistrictWebsitePublicDataController.IsDistrictServiceableAsync(conn, ownerId);

    public async Task<WebsiteExtrasDto?> GetPublicAsync(string scope, int ownerId)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        return await IsLiveAsync(conn, scope, ownerId) ? await ReadAsync(conn, scope, ownerId) : null;
    }

    public async Task<(string Host, int ClubId)?> ClubByHostAsync(string? host)
    {
        var normalized = ClubWebsitePublicController.NormalizeHost(host);
        if (string.IsNullOrEmpty(normalized)) return null;
        var cd = ClubWebsitePublicController.NormCol("w.ClientDomain");
        var sd = ClubWebsitePublicController.NormCol("w.Subdomain");
        await using var conn = Conn();
        await conn.OpenAsync();
        // Same match as ClubWebsitePublicController.ResolveByHost (the site's own tenant lookup); live websites only.
        var clubId = await conn.ExecuteScalarAsync<int?>($@"
            SELECT w.fk_club_id FROM club_websites w
            WHERE w.isdeleted = 0 AND w.EndDate >= CURDATE() AND ({cd} = @host OR {sd} = @host OR {sd} = @label)
            ORDER BY CASE WHEN {cd} = @host THEN 0 WHEN {sd} = @host THEN 1 ELSE 2 END, w.created_date DESC
            LIMIT 1", new { host = normalized, label = normalized.Split('.')[0] });
        return clubId is > 0 && await ClubWebsitePublicDataController.IsClubServiceableAsync(conn, clubId.Value)
            ? (normalized, clubId.Value) : null;
    }

    // Published-row rules copied from ClubWebsitePublicDataController (upcoming-events, newsletters, projects).
    private const string LiveEvents = "fk_club_id = @clubId AND isdeleted = 0 AND PublishDate <= NOW() AND ExpiryDate >= NOW()";
    private const string LiveNewsletters = @"fk_club_id = @clubId AND COALESCE(isdeleted, 0) = 0 AND PublishDateTime <= NOW()
              AND (ExpiryDateTime IS NULL OR ExpiryDateTime <= PublishDateTime OR ExpiryDateTime >= NOW())";

    private async Task<string> ProjectsUnionAsync(MySqlConnection conn, string where)
    {
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        // Table names come from the resolver (rotary_year_master labels), never from the request.
        return string.Join(" UNION ALL ", tables.Select(t => $@"
            SELECT p.pk_project_id AS Id, p.fk_year_id AS YearId, p.title AS Title, p.description AS Description,
                   COALESCE(p.modified_date, p.created_date) AS Modified
            FROM `{t.ProjectsTable}` p
            WHERE p.fk_club_id = @clubId AND p.isdeleted = 0 AND p.is_active = 1 {where}"));
    }

    public async Task<IReadOnlyList<WebsiteSearchHit>?> SearchClubAsync(int clubId, string q)
    {
        var like = LikePattern(q);
        await using var conn = Conn();
        await conn.OpenAsync();
        if (!await ClubWebsitePublicDataController.IsClubServiceableAsync(conn, clubId)) return null;
        if (like == null) return Array.Empty<WebsiteSearchHit>();
        var term = q.Trim();
        var p = new { clubId, like };
        var hits = new List<WebsiteSearchHit>();

        hits.AddRange(ClubPages.Where(pg => pg.Title.Contains(term, StringComparison.OrdinalIgnoreCase))
            .Select(pg => new WebsiteSearchHit("page", pg.Title, null, pg.Path)));

        foreach (var bp in await conn.QueryAsync<(string Slug, string Title)>($@"
            SELECT slug, COALESCE(published_title, title) FROM website_pages
            WHERE {LiveBuilderPages} AND (published_title LIKE @like OR published_sections_json LIKE @like)
            ORDER BY published_at DESC LIMIT 10", p))
            hits.Add(new("page", bp.Title, null, "/p/" + bp.Slug));

        foreach (var e in await conn.QueryAsync<(int Id, string Title, string? Description)>($@"
            SELECT pk_upcoming_event_id, Title, Description FROM upcoming_events
            WHERE {LiveEvents} AND (Title LIKE @like OR Description LIKE @like OR EventVenue LIKE @like)
            ORDER BY EventDate DESC LIMIT 10", p))
            hits.Add(new("event", e.Title, Snippet(e.Description, term), "/event?id=" + e.Id));

        var union = await ProjectsUnionAsync(conn, "AND (p.title LIKE @like OR p.description LIKE @like)");
        if (union.Length > 0)
            foreach (var pr in await conn.QueryAsync<(int Id, int YearId, string Title, string? Description)>(
                $"SELECT Id, YearId, Title, Description FROM ({union}) u ORDER BY Modified DESC LIMIT 10", p))
                hits.Add(new("project", pr.Title, Snippet(pr.Description, term), $"/project?pid={pr.Id}&yearId={pr.YearId}"));

        foreach (var n in await conn.QueryAsync<(int Id, int YearId, string Title)>($@"
            SELECT pk_newsletter_id, fk_year_id, Title FROM newsletters
            WHERE {LiveNewsletters} AND Title LIKE @like ORDER BY PublishDateTime DESC LIMIT 10", p))
            hits.Add(new("newsletter", n.Title, null, "/newsletters?yearId=" + n.YearId));

        return hits;
    }

    // Website builder pages: published, public (not members-only), "home" is the home layout so it is not a page of its own.
    private const string LiveBuilderPages =
        "owner_type = 'club' AND owner_id = @clubId AND published_at IS NOT NULL AND members_only = 0 AND slug <> 'home'";

    public async Task<IReadOnlyList<WebsiteSitemapEntry>?> SitemapClubAsync(int clubId)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        if (!await ClubWebsitePublicDataController.IsClubServiceableAsync(conn, clubId)) return null;
        var p = new { clubId };
        var entries = ClubPages.Where(pg => pg.Path != "/search").Select(pg => new WebsiteSitemapEntry(pg.Path, null)).ToList();
        // shortcut: events and projects store server-local times, sent as dates here; fine for sitemap lastmod.
        foreach (var e in await conn.QueryAsync<(int Id, DateTime? Modified)>(
            $"SELECT pk_upcoming_event_id, COALESCE(modified_date, created_date) FROM upcoming_events WHERE {LiveEvents} LIMIT 1000", p))
            entries.Add(new("/event?id=" + e.Id, e.Modified));
        var union = await ProjectsUnionAsync(conn, "");
        if (union.Length > 0)
            foreach (var pr in await conn.QueryAsync<(int Id, int YearId, DateTime? Modified)>(
                $"SELECT Id, YearId, Modified FROM ({union}) u ORDER BY Modified DESC LIMIT 2000", p))
                entries.Add(new($"/project?pid={pr.Id}&yearId={pr.YearId}", pr.Modified));
        foreach (var bp in await conn.QueryAsync<(string Slug, DateTime? Published)>(
            $"SELECT slug, published_at FROM website_pages WHERE {LiveBuilderPages} LIMIT 500", p))
            entries.Add(new("/p/" + bp.Slug, bp.Published));
        return entries;
    }
}

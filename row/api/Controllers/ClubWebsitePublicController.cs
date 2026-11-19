using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Public, anonymous endpoints consumed by the multi-tenant club-website Next.js app.
// One deployed club-website folder serves every paid/trial club; this resolver tells
// it which club a given Host header belongs to plus current subscription state.

[ApiController]
[Route("api/public/club-website")]
[AllowAnonymous]
public class ClubWebsitePublicController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IConfiguration _config;

    public ClubWebsitePublicController(IConfiguration config)
    {
        _config = config;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    public class TenantDto
    {
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public string? Subdomain { get; set; }
        public string? ClientDomain { get; set; }
        public int ThemeId { get; set; }
        public string ThemeKey { get; set; } = "classic-blue";
        public string Status { get; set; } = "not_found";    // active | trial | trial_expired | expired
        public string? TrialEndsAt { get; set; }              // ISO date, populated only when status=trial or trial_expired
        public string? PaidUntil { get; set; }                // ISO date, populated only when status=active or expired
        public int DaysRemaining { get; set; }                // negative when expired
    }

    // Resolves a Host header → club identity + subscription status.
    // Lookup order: explicit ClientDomain (full host match) → Subdomain (leftmost label).
    // Skips clubs whose club / district / zone is inactive (kill-switch chain).
    // Host comes as ?host=... query parameter. Path-based routing (/by-host/{host})
    // breaks on IIS because dots in the FQDN (e.g. "club.example.org" → ".org")
    // are interpreted as file extensions and 404'd before ASP.NET Core sees them.
    // Query strings sidestep that without any IIS-level config.
    [HttpGet("by-host")]
    public async Task<ActionResult<TenantDto>> ResolveByHost([FromQuery] string host)
    {
        if (string.IsNullOrWhiteSpace(host)) return NotFound();
        var normalized = NormalizeHost(host);
        if (string.IsNullOrEmpty(normalized)) return NotFound();

        // First label of the host — used as candidate Subdomain match.
        // e.g.  "club.example.org" → "rcthanehills"
        //       "rotarymumbai.org"             → "rotarymumbai"  (also tried, harmless)
        //       "rcthanehills.localhost"       → "rcthanehills"  (dev)
        var firstLabel = normalized.Split('.')[0];

        using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();

        // ClientDomain/Subdomain are stored as full URLs (e.g. "https://www.rcmadras.in/"), so compare
        // their NORMALISED bare host (NormCol) against the already-normalised incoming host.
        var cd = NormCol("w.ClientDomain");
        var sd = NormCol("w.Subdomain");
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT w.pk_id              AS websiteId,
                   w.fk_club_id         AS clubId,
                   c.ClubName           AS clubName,
                   c.ClubType           AS clubType,
                   w.Subdomain          AS subdomain,
                   w.ClientDomain       AS clientDomain,
                   w.fk_theme_id        AS themeId,
                   t.theme_name         AS themeName,
                   w.StartDate          AS startDate,
                   w.EndDate            AS endDate,
                   w.Status             AS status,
                   w.AmountPaid         AS amountPaid,
                   w.TransactionId      AS transactionId,
                   DATEDIFF(w.EndDate, CURDATE()) AS daysRemaining
            FROM club_websites w
            JOIN club_master c   ON c.pk_club_id = w.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z   ON z.pk_zone_id = d.fk_zone_id
            LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
            WHERE w.isdeleted = 0
              AND c.isdeleted = 0 AND c.IsActive = 1
              AND d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1
              AND ({cd} = @host OR {sd} = @host OR {sd} = @label)
            ORDER BY
              -- Prefer an exact ClientDomain match, then exact Subdomain FQDN match,
              -- finally the broader Subdomain-label match (legacy data).
              CASE
                WHEN {cd} = @host THEN 0
                WHEN {sd} = @host THEN 1
                ELSE 2
              END,
              w.created_date DESC
            LIMIT 1",
            new { host = normalized, label = firstLabel });

        if (row == null) return NotFound();

        // Trial vs paid is inferred from AmountPaid / TransactionId.
        // A row with no recorded payment is treated as a trial allocation.
        bool isPaid = ((decimal?)row.amountPaid ?? 0m) > 0m
                      || !string.IsNullOrWhiteSpace((string?)row.transactionId);

        int daysRemaining = (int)(row.daysRemaining ?? 0);
        bool isExpired = daysRemaining < 0;

        string computedStatus = (isPaid, isExpired) switch
        {
            (true,  false) => "active",
            (true,  true)  => "expired",
            (false, false) => "trial",
            (false, true)  => "trial_expired",
        };

        var dto = new TenantDto
        {
            ClubId        = (int)row.clubId,
            ClubName      = (string)(row.clubName ?? ""),
            Subdomain     = (string?)row.subdomain,
            ClientDomain  = (string?)row.clientDomain,
            ThemeId       = (int)(row.themeId ?? 0),
            ThemeKey      = ToThemeKey((string?)row.themeName, (string?)row.clubType),
            Status        = computedStatus,
            TrialEndsAt   = !isPaid ? FormatDate(row.endDate) : null,
            PaidUntil     =  isPaid ? FormatDate(row.endDate) : null,
            DaysRemaining = daysRemaining,
        };
        return Ok(dto);
    }

    // PUBLIC (no-login) renewal/top-up pay links for a single club — meant to be called FROM the club
    // website itself (e.g. its expired/renew screen). Resolve by explicit clubId or by the site's own
    // Host (?host=). Returns the encrypted website-renewal link plus the Email credit link. The
    // token IS the authorization for paying, and price/GST/gateway are re-resolved server-side, so
    // minting a link publicly exposes nothing sensitive.
    [HttpGet("renew-link")]
    public async Task<ActionResult> RenewLink([FromQuery] int? clubId, [FromQuery] string? host)
    {
        using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();

        const string selectCols = @"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   w.EndDate AS endDate, DATEDIFF(w.EndDate, CURDATE()) AS daysRemaining,
                   w.Subdomain AS subdomain, w.ClientDomain AS clientDomain";

        dynamic? row = null;
        if (clubId.HasValue && clubId.Value > 0)
        {
            row = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
                {selectCols}
                FROM club_master c
                LEFT JOIN club_websites w ON w.pk_id = (
                    SELECT w2.pk_id FROM club_websites w2
                    WHERE w2.fk_club_id = c.pk_club_id AND COALESCE(w2.isdeleted, 0) = 0
                    ORDER BY w2.created_date DESC LIMIT 1)
                WHERE c.pk_club_id = @Id AND c.isdeleted = 0 AND c.IsActive = 1 AND {HierarchyScopeSql.ClubLive("c")}",
                new { Id = clubId.Value });
        }
        else if (!string.IsNullOrWhiteSpace(host))
        {
            var normalized = NormalizeHost(host);
            var firstLabel = normalized.Split('.')[0];
            var cd = NormCol("w.ClientDomain");
            var sd = NormCol("w.Subdomain");
            row = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
                {selectCols}
                FROM club_websites w
                JOIN club_master c ON c.pk_club_id = w.fk_club_id
                WHERE w.isdeleted = 0 AND c.isdeleted = 0 AND c.IsActive = 1 AND {HierarchyScopeSql.ClubLive("c")}
                  AND ({cd} = @host OR {sd} = @host OR {sd} = @label)
                ORDER BY CASE WHEN {cd} = @host THEN 0 WHEN {sd} = @host THEN 1 ELSE 2 END,
                         w.created_date DESC
                LIMIT 1",
                new { host = normalized, label = firstLabel });
        }
        else return BadRequest(new { message = "Provide clubId or host." });

        if (row == null) return NotFound(new { message = "Club not found." });

        int cid = (int)row.clubId;
        var frontend = (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
        int yearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1") ?? 0;

        int? daysRemaining = row.daysRemaining == null ? (int?)null : (int)row.daysRemaining;
        return Ok(new
        {
            clubId = cid,
            clubName = (string)(row.clubName ?? ""),
            endDate = row.endDate == null ? (DateTime?)null : (DateTime)row.endDate,
            daysRemaining,
            isExpired = daysRemaining.HasValue && daysRemaining.Value < 0,
            // Website renewal link (null only if no Rotary year is configured).
            websitePayLink = yearId > 0 ? $"{frontend}/pay/club-website/{WebsitePayLinkToken.Generate(_config, cid, yearId)}" : null,
            emailPayLink = $"{frontend}/pay/w/{WalletPayLinkToken.Generate(_config, "club", "email", cid)}",
        });
    }

    // Page labels for link previews, keyed by the club site's first path segment.
    private static readonly Dictionary<string, string> PreviewPages = new(StringComparer.OrdinalIgnoreCase)
    {
        ["about"] = "About Us", ["directors"] = "Board of Directors", ["directory"] = "Members",
        ["events"] = "Events", ["event"] = "Event", ["upcoming-events"] = "Events", ["gallery"] = "Gallery",
        ["projects"] = "Projects", ["project"] = "Project", ["newsletters"] = "Newsletters",
        ["past-presidents"] = "Past Presidents", ["calendar"] = "Calendar", ["dignitary"] = "Dignitaries",
    };

    /// <summary>
    /// Link preview (Open Graph) page for a club website. The club site's web.config redirects only
    /// link-preview bots (WhatsApp, Facebook, LinkedIn, X, Telegram, Slack, Discord) here, because the
    /// site is a static SPA and bots run no JavaScript. People never see it; a person who lands here is
    /// sent on to the club page. Only hosts that belong to a live club website are answered.
    /// </summary>
    [HttpGet("preview")]
    // The API caches public responses; without these keys every club would get the first cached preview.
    [ResponseCache(Duration = 600, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "host", "path" })]
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("public-read")]
    public async Task<IActionResult> Preview([FromQuery] string? host, [FromQuery] string? path)
    {
        var normalized = NormalizeHost(host);
        if (string.IsNullOrEmpty(normalized)) return NotFound();
        using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        var cd = NormCol("w.ClientDomain");
        var sd = NormCol("w.Subdomain");
        var club = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   c.ClubLogoPath AS logo
            FROM club_websites w
            JOIN club_master c ON c.pk_club_id = w.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE w.isdeleted = 0 AND c.isdeleted = 0 AND c.IsActive = 1
              AND d.isdeleted = 0 AND d.IsActive = 1 AND z.isdeleted = 0 AND z.IsActive = 1
              AND ({cd} = @host OR {sd} = @host OR {sd} = @label)
            ORDER BY CASE WHEN {cd} = @host THEN 0 WHEN {sd} = @host THEN 1 ELSE 2 END, w.created_date DESC
            LIMIT 1", new { host = normalized, label = normalized.Split('.')[0] });
        if (club == null) return NotFound();

        var banner = await conn.ExecuteScalarAsync<string?>(@"
            SELECT banner_image_path FROM club_website_banner
            WHERE fk_club_id = @id AND (isdeleted = 0 OR isdeleted IS NULL) AND is_active = 1
              AND banner_image_path IS NOT NULL AND banner_image_path <> ''
            ORDER BY fk_year_id DESC, sort_order, pk_club_website_banner_id LIMIT 1", new { id = (int)club.clubId });

        // Only a site-relative path is accepted, so the page can only ever point at the club's own host.
        var p = string.IsNullOrWhiteSpace(path) || !path.StartsWith('/') || path.StartsWith("//") ? "/" : path;
        var segment = p.TrimStart('/').Split('/', '?', '#')[0];
        var clubName = (string)club.clubName;
        var title = PreviewPages.TryGetValue(segment, out var page) ? $"{page} | {clubName}" : clubName;
        var description = $"{clubName}, Rotary District {club.districtNumber}. Projects, events and news from the club.";
        var origin = $"{Request.Scheme}://{Request.Host}{Request.PathBase}";
        string? Media(string? v, string folder) => string.IsNullOrWhiteSpace(v) ? null
            : v.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? v
            : origin + (v.StartsWith('/') ? v : folder + v);
        var image = Media(banner, "/uploads/banner/") ?? Media((string?)club.logo, "/Documents/group/");
        var url = $"https://{normalized}{p}";
        string E(string s) => System.Net.WebUtility.HtmlEncode(s);

        var html = $@"<!doctype html><html lang=""en""><head><meta charset=""utf-8"">
<title>{E(title)}</title>
<meta name=""description"" content=""{E(description)}"">
<meta property=""og:type"" content=""website"">
<meta property=""og:site_name"" content=""{E(clubName)}"">
<meta property=""og:title"" content=""{E(title)}"">
<meta property=""og:description"" content=""{E(description)}"">
<meta property=""og:url"" content=""{E(url)}"">
{(image != null ? $@"<meta property=""og:image"" content=""{E(image)}"">
<meta name=""twitter:image"" content=""{E(image)}"">" : "")}
<meta name=""twitter:card"" content=""{(image != null ? "summary_large_image" : "summary")}"">
<meta name=""twitter:title"" content=""{E(title)}"">
<meta name=""twitter:description"" content=""{E(description)}"">
<link rel=""canonical"" href=""{E(url)}"">
<meta http-equiv=""refresh"" content=""0;url={E(url)}"">
</head><body><a href=""{E(url)}"">{E(title)}</a></body></html>";
        return Content(html, "text/html; charset=utf-8");
    }

    // Normalise a host (or a stored URL-ish value) to a bare, lowercase host: strip scheme
    // (http/https), leading "www.", any path/trailing slash and the port. Mirrors the old ASP.NET
    // TenantResolver so ClientDomain/Subdomain stored as full URLs (e.g. "https://www.rcmadras.in/")
    // still match an incoming Host like "rcmadras.in" — no data migration needed.
    internal static string NormalizeHost(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var h = raw.Trim().ToLowerInvariant();
        if (h.StartsWith("https://")) h = h.Substring(8);
        else if (h.StartsWith("http://")) h = h.Substring(7);
        h = h.Split('/')[0];   // drop path + trailing slash
        h = h.Split(':')[0];   // drop port
        if (h.StartsWith("www.")) h = h.Substring(4);
        return h;
    }

    // SQL that normalises a stored column the SAME way as NormalizeHost, applied at query time so no
    // data migration is required. `col` is a controlled constant (never user input).
    internal static string NormCol(string col) =>
        $"SUBSTRING_INDEX(REPLACE(REPLACE(REPLACE(LOWER({col}),'https://',''),'http://',''),'www.',''),'/',1)";

    // No theme chosen: a Rotaract club gets the Rotaract template, every other club Classic Blue.
    private static string ToThemeKey(string? themeName, string? clubType)
    {
        if (string.IsNullOrWhiteSpace(themeName))
            return clubType?.StartsWith("Rotaract", StringComparison.OrdinalIgnoreCase) == true ? "rotaract" : "classic-blue";
        return themeName.Trim().ToLowerInvariant().Replace(' ', '-');
    }

    private static string? FormatDate(object? d)
    {
        if (d == null) return null;
        if (d is DateTime dt) return dt.ToString("yyyy-MM-dd");
        return d.ToString();
    }
}

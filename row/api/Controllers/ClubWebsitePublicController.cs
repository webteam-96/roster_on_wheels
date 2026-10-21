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

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // ClientDomain/Subdomain are stored as full URLs (e.g. "https://www.rcmadras.in/"), so compare
        // their NORMALISED bare host (NormCol) against the already-normalised incoming host.
        var cd = NormCol("w.ClientDomain");
        var sd = NormCol("w.Subdomain");
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT w.pk_id              AS websiteId,
                   w.fk_club_id         AS clubId,
                   c.ClubName           AS clubName,
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
            ThemeKey      = ToThemeKey((string?)row.themeName),
            Status        = computedStatus,
            TrialEndsAt   = !isPaid ? FormatDate(row.endDate) : null,
            PaidUntil     =  isPaid ? FormatDate(row.endDate) : null,
            DaysRemaining = daysRemaining,
        };
        return Ok(dto);
    }

    // PUBLIC (no-login) renewal/top-up pay links for a single club — meant to be called FROM the club
    // website itself (e.g. its expired/renew screen). Resolve by explicit clubId or by the site's own
    // Host (?host=). Returns the encrypted website-renewal link plus WhatsApp/Email credit links. The
    // token IS the authorization for paying, and price/GST/gateway are re-resolved server-side, so
    // minting a link publicly exposes nothing sensitive.
    [HttpGet("renew-link")]
    public async Task<ActionResult> RenewLink([FromQuery] int? clubId, [FromQuery] string? host)
    {
        using var conn = new MySqlConnection(_connectionString);
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
                WHERE c.pk_club_id = @Id AND c.isdeleted = 0 AND c.IsActive = 1",
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
                WHERE w.isdeleted = 0 AND c.isdeleted = 0 AND c.IsActive = 1
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
            whatsappPayLink = $"{frontend}/pay/w/{WalletPayLinkToken.Generate(_config, "club", "whatsapp", cid)}",
            emailPayLink = $"{frontend}/pay/w/{WalletPayLinkToken.Generate(_config, "club", "email", cid)}",
        });
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

    private static string ToThemeKey(string? themeName)
    {
        if (string.IsNullOrWhiteSpace(themeName)) return "classic-blue";
        return themeName.Trim().ToLowerInvariant().Replace(' ', '-');
    }

    private static string? FormatDate(object? d)
    {
        if (d == null) return null;
        if (d is DateTime dt) return dt.ToString("yyyy-MM-dd");
        return d.ToString();
    }
}

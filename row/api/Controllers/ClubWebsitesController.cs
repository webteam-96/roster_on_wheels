using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using System.Data;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/admin/club-websites")]
[Authorize]
public class ClubWebsitesController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IConfiguration _config;
    private readonly IEmailService _emailService;
    private readonly PleskService _plesk;
    private readonly IClubSiteCachePurger _purger;
    private readonly IClubWebsiteActivationService _activation;
    private readonly IDnsPointingChecker _dns;
    private readonly IYearTableResolver _years;
    private readonly IProjectCountRules _countRules;
    private readonly string _pleskParentDomain;
    private readonly bool _useHttps;

    public ClubWebsitesController(IConfiguration config, IEmailService emailService, PleskService plesk, IClubSiteCachePurger purger, IClubWebsiteActivationService activation, IDnsPointingChecker dns,
        IYearTableResolver years, IProjectCountRules countRules)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _emailService = emailService;
        _plesk = plesk;
        _purger = purger;
        _activation = activation;
        _dns = dns;
        _years = years;
        _countRules = countRules;
        _pleskParentDomain = config.GetSection("PleskSettings")["ParentDomain"] ?? "";
        _useHttps = string.Equals(config.GetSection("ClubSite")["UseHttps"], "true", StringComparison.OrdinalIgnoreCase);
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // Website status for the CLUB DASHBOARD pill. Club website is PAID:
    // active | trial | trial_expired | expired | not_configured (+ daysRemaining, visitUrl).
    [HttpGet("/api/clubs/{clubId}/website-status")]
    public async Task<ActionResult> GetClubWebsiteStatus(int clubId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // isdeleted is a nullable TINYINT(1) DEFAULT 0 — some legacy rows have NULL rather
        // than 0, which `w.isdeleted = 0` silently excludes (NULL = 0 is neither true nor
        // false in SQL). That caused this endpoint to report "not_configured" for clubs that
        // GlobalSearchController's already-defensive COALESCE(cw.isdeleted, 0) = 0 correctly
        // found an active website for. COALESCE here so both agree.
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT w.Subdomain AS subdomain, w.ClientDomain AS clientDomain, w.IsPurchased AS isPurchased,
                   w.AmountPaid AS amountPaid, w.TransactionId AS transactionId,
                   DATEDIFF(w.EndDate, CURDATE()) AS daysRemaining
            FROM club_websites w
            WHERE w.fk_club_id = @ClubId AND COALESCE(w.isdeleted, 0) = 0
            ORDER BY w.created_date DESC LIMIT 1",
            new { ClubId = clubId });

        if (row == null)
            return Ok(new { configured = false, status = "not_configured", daysRemaining = 0, visitUrl = (string?)null, isPaid = false });

        // Purchased is the source of truth once set explicitly (admin can mark Purchased with no
        // payment data yet); Amount/TransactionId remain a fallback for legacy rows.
        bool isPaid = Convert.ToBoolean(row.isPurchased)
            || ((decimal?)row.amountPaid ?? 0m) > 0m || !string.IsNullOrWhiteSpace((string?)row.transactionId);
        int daysRemaining = (int)(row.daysRemaining ?? 0);
        bool isExpired = daysRemaining < 0;
        string status = (isPaid, isExpired) switch
        {
            (true, false) => "active",
            (true, true) => "expired",
            (false, false) => "trial",
            (false, true) => "trial_expired",
        };
        var parentDomain = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain' LIMIT 1") ?? _pleskParentDomain;
        var visitUrl = await WebsiteReachability.ResolveAsync((string?)row.clientDomain, (string?)row.subdomain, parentDomain, _useHttps);
        return Ok(new { configured = true, status, daysRemaining, visitUrl, isPaid });
    }

    // Subdomain / ClientDomain / ParentDomain validation lives in WebsiteDomainHelper
    // (shared with DistrictWebsitesController) so a pasted URL is normalized to a clean
    // host before storage — see RotaryApi/Services/WebsiteDomainHelper.cs.

    private static async Task LogAction(MySqlConnection conn, int websiteId, string action, string? details, int userId, IDbTransaction? tx = null)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy)
            VALUES (@W, @A, @D, @U)",
            new { W = websiteId, A = action, D = details, U = userId }, tx);
    }

    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? status, [FromQuery] int? districtId, [FromQuery] string? search)
    {
        if (!IsSuperAdmin()) return Forbid();

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Auto-expire any active websites past end date. EXISTS guard against orphaned
        // fk_club_id rows (club deleted but website kept) — MySQL refuses the UPDATE with a
        // FK-violation on club_websites_ibfk_1 even though the UPDATE doesn't touch fk_club_id.
        // Same fix as ClubWebsiteReminderBackgroundService's auto-expire step.
        await conn.ExecuteAsync(@"
            UPDATE club_websites w SET Status = 'Expired'
            WHERE Status = 'Active' AND EndDate < CURDATE() AND COALESCE(w.isdeleted, 0) = 0
              AND EXISTS (SELECT 1 FROM club_master c WHERE c.pk_club_id = w.fk_club_id)");

        // Banner / advertisement / project counts for the exports (user 2026-09-29), all for the
        // CURRENT rotary year - which is exactly the period between its Start Date and End Date, and
        // is how the banner and advertisement rows are stamped (fk_year_id) and how projects are
        // partitioned into year tables.
        var curYear = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS Id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        int curYearId = curYear == null ? 0 : (int)curYear.Id;
        string curProjects = curYear == null ? "" : _years.GetProjectsTableName((string)curYear.YearLabel);
        // The SAME definition of a counted project the public site and the daily report use, so this
        // column cannot become a fourth different number. Club Service is not a project; an ongoing
        // project counts once (its parent, or its first entry of this year when the parent is older).
        var filter = await _countRules.GetFilterAsync(conn);
        string projectCount = curProjects == ""
            ? "0"
            : $@"(SELECT COUNT(*) FROM `{curProjects}` p
                  JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                       AND mm.ModuleKey IN ({ProjectCountFilter.ProjectModuleKeys})
                  WHERE p.fk_club_id = c.pk_club_id AND {filter.CountsAsProject(curProjects)})";

        var sql = @"
            SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName,
                   c.ClubRotaryId AS clubRotaryId, d.DistrictNumber AS districtNumber,
                   w.Subdomain AS subdomain, w.ClientDomain AS clientDomain,
                   w.ClientDomainProvisioned AS clientDomainProvisioned,
                   w.ClientDomainVerifiedDate AS clientDomainVerifiedDate,
                   w.fk_theme_id AS themeId, t.theme_name AS themeName,
                   w.StartDate AS startDate, w.EndDate AS endDate, w.Status AS status,
                   w.IsPurchased AS isPurchased,
                   w.ReminderDays AS reminderDays, w.AmountPaid AS amountPaid,
                   w.TransactionId AS transactionId, w.PaymentDate AS paymentDate,
                   w.PaymentMode AS paymentMode, w.PaymentProofPath AS paymentProofPath,
                   w.LastReminderSent AS lastReminderSent, w.Notes AS notes,
                   DATEDIFF(w.EndDate, CURDATE()) AS daysLeft,
                   w.created_date AS createdDate,
                   pres.name AS presidentName, pres.mobile AS presidentMobile, pres.email AS presidentEmail,
                   sec.name AS secretaryName, sec.mobile AS secretaryMobile, sec.email AS secretaryEmail,
                   -- Counts for the two exports (current rotary year, ACTIVE rows only).
                   (SELECT COUNT(*) FROM club_website_banner bn
                     WHERE bn.fk_club_id = c.pk_club_id AND bn.fk_year_id = @CurYearId
                       AND bn.is_active = 1 AND COALESCE(bn.isdeleted, 0) = 0) AS bannerCount,
                   (SELECT COUNT(*) FROM club_website_advertisement ad
                     WHERE ad.fk_club_id = c.pk_club_id AND ad.fk_year_id = @CurYearId
                       AND ad.is_active = 1 AND COALESCE(ad.isdeleted, 0) = 0) AS advertisementCount,
                   " + projectCount + @" AS projectCount,
                   -- Phase 4 kill-switch: chainActive=1 only when club + district + zone are all active.
                   CASE WHEN c.IsActive = 1 AND c.isdeleted = 0
                          AND d.IsActive = 1 AND d.isdeleted = 0
                          AND z.IsActive = 1 AND z.isdeleted = 0
                        THEN 1 ELSE 0 END AS chainActive
            FROM club_websites w
            JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
            -- Current-year President / Secretary contact (one row per club; MAX collapses rare dup board rows).
            LEFT JOIN (
                SELECT b.fk_club_id AS clubId, MAX(m.MemberName) AS name,
                       MAX(m.PrimaryMobileNumber) AS mobile, MAX(m.EmailId) AS email
                FROM board_of_directors b
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                WHERE dm.designation_name = 'Club President' AND b.isdeleted = 0
                  AND b.fk_year_id = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1)
                GROUP BY b.fk_club_id
            ) pres ON pres.clubId = w.fk_club_id
            LEFT JOIN (
                SELECT b.fk_club_id AS clubId, MAX(m.MemberName) AS name,
                       MAX(m.PrimaryMobileNumber) AS mobile, MAX(m.EmailId) AS email
                FROM board_of_directors b
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                WHERE dm.designation_name = 'Club Secretary' AND b.isdeleted = 0
                  AND b.fk_year_id = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1)
                GROUP BY b.fk_club_id
            ) sec ON sec.clubId = w.fk_club_id
            WHERE COALESCE(w.isdeleted, 0) = 0";
        var p = new DynamicParameters();
        p.Add("CurYearId", curYearId);
        if (!string.IsNullOrEmpty(status)) { sql += " AND w.Status = @Status"; p.Add("Status", status); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        if (!string.IsNullOrEmpty(search))
        {
            sql += " AND (c.ClubName LIKE @S OR w.Subdomain LIKE @S OR w.ClientDomain LIKE @S)";
            p.Add("S", $"%{search}%");
        }
        sql += " ORDER BY (w.Status='Active' AND DATEDIFF(w.EndDate, CURDATE()) <= 30) DESC, w.EndDate ASC";

        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("{id}/logs")]
    public async Task<ActionResult> GetLogs(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var logs = await conn.QueryAsync<dynamic>(@"
            SELECT l.pk_id AS id, l.Action AS action, l.Details AS details,
                   l.PerformedBy AS performedBy, m.MemberName AS performedByName,
                   l.PerformedDate AS performedDate
            FROM club_website_logs l
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.PerformedBy
            WHERE l.fk_website_id = @Id
            ORDER BY l.PerformedDate DESC",
            new { Id = id });
        return Ok(logs);
    }

    // Returns clubs in a district that DON'T have an active website record yet — for use in Add form
    [HttpGet("available-clubs")]
    public async Task<ActionResult> GetAvailableClubs([FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (districtId <= 0) return BadRequest(new { message = "districtId required" });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubs = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
            FROM club_master c
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
              AND NOT EXISTS (
                SELECT 1 FROM club_websites w
                WHERE w.fk_club_id = c.pk_club_id AND COALESCE(w.isdeleted, 0) = 0
              )
            ORDER BY c.ClubName",
            new { D = districtId });
        return Ok(clubs);
    }

    [HttpGet("club-history")]
    public async Task<ActionResult> GetClubHistory([FromQuery] int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var history = await conn.QueryAsync<dynamic>(@"
            SELECT w.pk_id AS id, w.Subdomain AS subdomain, w.StartDate AS startDate,
                   w.EndDate AS endDate, w.Status AS status, w.AmountPaid AS amountPaid
            FROM club_websites w
            WHERE w.fk_club_id = @ClubId AND COALESCE(w.isdeleted, 0) = 0
            ORDER BY w.StartDate DESC",
            new { ClubId = clubId });
        return Ok(history);
    }

    [HttpGet("settings")]
    public async Task<ActionResult> GetSettings()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var defaultDays = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteDefaultReminderDays'");
        var parentDomain = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
        return Ok(new {
            defaultReminderDays = int.TryParse(defaultDays, out var d) ? d : 15,
            parentDomain = parentDomain ?? RotaryApi.Services.Brand.ClubSiteParentDomain,  // Club websites parent — NOT the main portal portal.example.org.
            serverIp = _plesk.ServerIp                          // A-record target shown in the third-party domain DNS instructions.
        });
    }

    // ── Third-party (custom) domain: DNS pointing check + Plesk application status ─────────────
    public class DomainRequest { public string? Domain { get; set; } }

    // Does this domain currently resolve (A record) to our server IP? Drives the "Check pointing" button.
    [HttpPost("check-domain-pointing")]
    public async Task<ActionResult> CheckDomainPointing([FromBody] DomainRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Domain)) return BadRequest(new { message = "Domain is required." });
        var res = await _dns.CheckAsync(req.Domain, _plesk.ServerIp);
        return Ok(new { pointsToServer = res.PointsToServer, resolvedIps = res.ResolvedIps, expectedIp = res.ExpectedIp });
    }

    // Is this domain already added as an application (site-alias) on our Plesk server?
    // Edit uses this to decide whether the DNS "Check pointing" step is still needed.
    [HttpGet("domain-plesk-status")]
    public async Task<ActionResult> DomainPleskStatus([FromQuery] string domain)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(domain)) return BadRequest(new { message = "domain is required." });
        if (!_plesk.IsConfigured) return Ok(new { existsInPlesk = false, pleskConfigured = false });
        bool exists;
        try { exists = await _plesk.DomainAliasExistsAsync(domain); }
        catch (Exception ex) { return Ok(new { existsInPlesk = false, pleskConfigured = true, error = ex.Message }); }
        return Ok(new { existsInPlesk = exists, pleskConfigured = true });
    }

    public class UpdateSettingsRequest { public int DefaultReminderDays { get; set; } public string? ParentDomain { get; set; } }

    [HttpPut("settings")]
    public async Task<ActionResult> UpdateSettings([FromBody] UpdateSettingsRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.DefaultReminderDays < 1 || req.DefaultReminderDays > 180)
            return BadRequest(new { message = "Default reminder days must be between 1 and 180." });
        var parentDomainNorm = WebsiteDomainHelper.NormalizeClientDomain(req.ParentDomain);
        if (!string.IsNullOrWhiteSpace(req.ParentDomain))
        {
            var pdErr = WebsiteDomainHelper.ValidateClientDomain(parentDomainNorm, "Parent Domain");
            if (pdErr != null) return BadRequest(new { message = pdErr });
        }
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        await conn.ExecuteAsync(@"
            INSERT INTO system_settings (SettingKey, SettingValue, modified_by)
            VALUES ('ClubWebsiteDefaultReminderDays', @V, @U)
            ON DUPLICATE KEY UPDATE SettingValue = @V, modified_by = @U, modified_date = NOW()",
            new { V = req.DefaultReminderDays.ToString(), U = userId });
        if (!string.IsNullOrWhiteSpace(req.ParentDomain))
        {
            var pd = parentDomainNorm;
            await conn.ExecuteAsync(@"
                INSERT INTO system_settings (SettingKey, SettingValue, modified_by)
                VALUES ('ClubWebsiteParentDomain', @V, @U)
                ON DUPLICATE KEY UPDATE SettingValue = @V, modified_by = @U, modified_date = NOW()",
                new { V = pd, U = userId });
        }
        return Ok(new { success = true });
    }

    public class CreateRequest
    {
        public int ClubId { get; set; }
        public string Subdomain { get; set; } = "";
        public string? ClientDomain { get; set; }
        public int? ThemeId { get; set; }
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public int? ReminderDays { get; set; }
        public bool IsPurchased { get; set; }
        public decimal? AmountPaid { get; set; }
        public string? TransactionId { get; set; }
        public DateTime? PaymentDate { get; set; }
        public string? PaymentMode { get; set; }
        public string? PaymentProofPath { get; set; }
        public string? Notes { get; set; }
    }

    [HttpPost]
    public async Task<ActionResult> Create([FromBody] CreateRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.ClubId <= 0)
            return BadRequest(new { message = "clubId is required." });
        if (!req.ThemeId.HasValue || req.ThemeId <= 0)
            return BadRequest(new { message = "Template is required." });
        // Store the Subdomain / third-party Domain VERBATIM (product decision): ':' and '/' are
        // allowed and kept exactly as typed; we only check presence/length.
        var subdomain = (req.Subdomain ?? "").Trim().ToLowerInvariant();
        var subErr = WebsiteDomainHelper.ValidateSubdomain(subdomain);
        if (subErr != null) return BadRequest(new { message = subErr });
        var clientDomain = string.IsNullOrWhiteSpace(req.ClientDomain) ? null : req.ClientDomain.Trim().ToLowerInvariant();
        var cliErr = WebsiteDomainHelper.ValidateClientDomain(clientDomain);
        if (cliErr != null) return BadRequest(new { message = cliErr });
        if (req.EndDate <= req.StartDate)
            return BadRequest(new { message = "End date must be after start date." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        var themeExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM theme_master WHERE pk_theme_id = @Id AND isdeleted = 0",
            new { Id = req.ThemeId.Value });
        if (themeExists == 0) return BadRequest(new { message = "Selected template does not exist." });

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_websites WHERE Subdomain = @S AND COALESCE(isdeleted, 0) = 0",
            new { S = subdomain });
        if (exists > 0) return BadRequest(new { message = "Subdomain already in use in portal." });

        // One club = one ACTIVE website (soft-deleted historical records are fine)
        var clubHasActive = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_id AS id, Subdomain AS subdomain FROM club_websites
              WHERE fk_club_id = @C AND COALESCE(isdeleted, 0) = 0 LIMIT 1",
            new { C = req.ClubId });
        if (clubHasActive != null)
            return BadRequest(new {
                message = $"This club already has an active website record ({clubHasActive.subdomain}). Delete it first before adding a new one."
            });

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_websites (fk_club_id, Subdomain, ClientDomain, fk_theme_id, StartDate, EndDate,
                Status, IsPurchased, ReminderDays, AmountPaid, TransactionId, PaymentDate, PaymentMode, PaymentProofPath, Notes, created_by)
            VALUES (@ClubId, @Subdomain, @ClientDomain, @ThemeId, @StartDate, @EndDate,
                'Inactive', @IsPurchased, @ReminderDays, @AmountPaid, @TransactionId, @PaymentDate, @PaymentMode, @PaymentProofPath, @Notes, @UserId);
            SELECT LAST_INSERT_ID();",
            new { req.ClubId, Subdomain = subdomain, ClientDomain = clientDomain, req.ThemeId,
                  req.StartDate, req.EndDate, req.IsPurchased, req.ReminderDays, req.AmountPaid, req.TransactionId,
                  req.PaymentDate, req.PaymentMode, req.PaymentProofPath, req.Notes, UserId = userId });
        await LogAction(conn, id, "Created", $"Website record created for subdomain {subdomain}", userId);

        // Seed the default protected menus (is_default=1). Uses the shared seeder, which is
        // idempotent and retires any legacy .aspx menus first, so creating a website for a
        // club that already had migrated menus can't produce duplicate nav tabs.
        await ClubWebsiteMenuSeeder.SeedDefaultMenusAsync(conn, req.ClubId, userId);

        // Cache purge — new club_websites row could affect tenant resolution.
        _purger.PurgeByClub(req.ClubId);

        return Ok(new { success = true, id });
    }

    // Canonical club default-menu list (sort_order = array index + 1): 8 default top-level tabs
    // (+ 1 admin-added custom slot). "Events" sits between Calendar and Projects, Directory before
    // Directors. "Club Service" is NOT a default top-level tab — the Club Service avenue lives as a
    // sub-menu under Projects (ProjectsSubMenus). Keep in sync with ClubWebsiteMenuSeeder.
    private static readonly (string Name, string LinkValue)[] DefaultMenus =
    {
        ("Home",            "home"),
        ("About",           "about"),
        ("Directory",       "directory"),
        ("Directors",       "directors"),
        ("Calendar",        "calendar"),
        ("Events",          "events"),
        ("Projects",        "projects"),
        ("Past Presidents", "past-presidents"),
    };

    // Six avenue sub-menus locked under "Projects" parent. Ordered as user requested.
    // link_value is the avenue key — frontend uses /projects?avenue={key} for routing.
    // Marked is_system_managed=1 so admin UI cannot delete/edit them; backfill is idempotent.
    public static readonly (string Name, string AvenueKey)[] ProjectsSubMenus =
    {
        ("Community Service",      "community_service"),
        ("Club Service",           "club_service"),
        ("Vocational Service",     "vocational_service"),
        ("New Generation Service", "new_generation_service"),
        ("International Service",  "international_service"),
        ("Public Image Initiative","public_image_initiative"),
    };

    private static async Task SeedDefaultMenusAsync(MySqlConnection conn, int clubId, int userId)
    {
        int? projectsMenuId = null;
        for (int i = 0; i < DefaultMenus.Length; i++)
        {
            var (name, linkValue) = DefaultMenus[i];
            var menuId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO club_website_menu
                    (fk_club_id, menu_name, link_type, link_value, sort_order, is_active, is_default, created_by, isdeleted)
                VALUES (@ClubId, @Name, 'page', @LinkValue, @Sort, 1, 1, @UserId, 0);
                SELECT LAST_INSERT_ID();",
                new { ClubId = clubId, Name = name, LinkValue = linkValue, Sort = i + 1, UserId = userId });
            if (linkValue == "projects") projectsMenuId = menuId;
        }

        // Seed the 6 avenue sub-menus under the just-created Projects menu.
        if (projectsMenuId.HasValue)
            await SeedProjectsSubMenusAsync(conn, projectsMenuId.Value, userId);
    }

    // Inserts the 6 system-managed avenue sub-menus. Idempotent, keyed on the stable
    // avenue link_value (NOT the name) and counting rows REGARDLESS of isdeleted — so an
    // admin who RENAMES an avenue sub-menu doesn't get a duplicate, and one who DELETES it
    // doesn't get it resurrected. Backfill on API startup calls this for every club's
    // Projects menu.
    private static async Task SeedProjectsSubMenusAsync(MySqlConnection conn, int projectsMenuId, int userId)
    {
        for (int i = 0; i < ProjectsSubMenus.Length; i++)
        {
            var (name, key) = ProjectsSubMenus[i];
            var existing = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_website_submenu
                WHERE fk_menu_id = @MenuId AND link_value = @Key",
                new { MenuId = projectsMenuId, Key = key });
            if (existing > 0) continue;

            await conn.ExecuteAsync(@"
                INSERT INTO club_website_submenu
                    (fk_menu_id, submenu_name, link_type, link_value, sort_order,
                     is_active, is_system_managed, created_by, isdeleted)
                VALUES
                    (@MenuId, @Name, 'page', @Key, @Sort, 1, 1, @UserId, 0)",
                new { MenuId = projectsMenuId, Name = name, Key = key, Sort = i + 1, UserId = userId });
        }
    }

    public class UpdateRequest
    {
        public string Subdomain { get; set; } = "";
        public string? ClientDomain { get; set; }
        public int? ThemeId { get; set; }
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public int? ReminderDays { get; set; }
        public bool IsPurchased { get; set; }
        public decimal? AmountPaid { get; set; }
        public string? TransactionId { get; set; }
        public DateTime? PaymentDate { get; set; }
        public string? PaymentMode { get; set; }
        public string? PaymentProofPath { get; set; }
        public string? Notes { get; set; }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!req.ThemeId.HasValue || req.ThemeId <= 0)
            return BadRequest(new { message = "Template is required." });
        // Store the Subdomain / third-party Domain VERBATIM (product decision): ':' and '/' are
        // allowed and kept exactly as typed; we only check presence/length.
        var subdomain = (req.Subdomain ?? "").Trim().ToLowerInvariant();
        var subErr = WebsiteDomainHelper.ValidateSubdomain(subdomain);
        if (subErr != null) return BadRequest(new { message = subErr });
        var clientDomain = string.IsNullOrWhiteSpace(req.ClientDomain) ? null : req.ClientDomain.Trim().ToLowerInvariant();
        var cliErr = WebsiteDomainHelper.ValidateClientDomain(clientDomain);
        if (cliErr != null) return BadRequest(new { message = cliErr });
        if (req.EndDate <= req.StartDate)
            return BadRequest(new { message = "End date must be after start date." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        var themeExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM theme_master WHERE pk_theme_id = @Id AND isdeleted = 0",
            new { Id = req.ThemeId.Value });
        if (themeExists == 0) return BadRequest(new { message = "Selected template does not exist." });

        // Load current row to enforce the "subdomain frozen after activation" rule and to
        // preserve the stored subdomain on activated rows (Plesk has a vhost tied to it).
        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT Status AS status, Subdomain AS subdomain, ClientDomain AS clientDomain, ClientDomainProvisioned AS clientDomainProvisioned FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id });
        if (existing == null) return NotFound(new { message = "Record not found." });
        var isActivated = !string.Equals((string)existing.status, "Inactive", StringComparison.OrdinalIgnoreCase);
        // Compare NORMALIZED labels so a no-op edit on a legacy row whose subdomain was stored as a
        // full URL (e.g. "https://rcfoo/") is NOT mistaken for a rename — only a genuine label change
        // is blocked. Editing the third-party domain / dates on an activated club stays allowed.
        // Compare LABEL-to-LABEL — normalize BOTH sides. The form submits the full FQDN
        // "label.parentdomain"; the stored value may be a FQDN or a legacy URL. Only a genuine
        // label change is a rename. (Normalizing only the existing side made every edit on an
        // activated club falsely trip this guard.)
        var existingSubLabel = WebsiteDomainHelper.NormalizeSubdomain((string?)existing.subdomain);
        if (isActivated && !string.Equals(existingSubLabel, WebsiteDomainHelper.NormalizeSubdomain(subdomain), StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new {
                message = $"Subdomain cannot be changed once the website has been activated (current status: {existing.status}). " +
                          "To rename: Deactivate → Delete → Add new record with a different subdomain."
            });
        }
        // Activated rows keep their stored subdomain verbatim (don't rewrite a frozen field);
        // Inactive rows take the freshly normalized value.
        var subdomainToStore = isActivated ? (string)existing.subdomain : subdomain;

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_websites WHERE Subdomain = @S AND pk_id <> @Id AND COALESCE(isdeleted, 0) = 0",
            new { S = subdomainToStore, Id = id });
        if (exists > 0) return BadRequest(new { message = "Subdomain already used by another record." });
        // Plesk duplicate check removed — Activate flow handles leftover Plesk subdomains by reusing them.

        var updated = await conn.ExecuteAsync(@"
            UPDATE club_websites SET Subdomain = @Subdomain, ClientDomain = @ClientDomain,
                fk_theme_id = @ThemeId, StartDate = @StartDate, EndDate = @EndDate,
                IsPurchased = @IsPurchased, ReminderDays = @ReminderDays, AmountPaid = @AmountPaid, TransactionId = @TransactionId,
                PaymentDate = @PaymentDate, PaymentMode = @PaymentMode, PaymentProofPath = @PaymentProofPath,
                Notes = @Notes, modified_by = @UserId
            WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Subdomain = subdomainToStore, ClientDomain = clientDomain, req.ThemeId,
                  req.StartDate, req.EndDate, req.IsPurchased, req.ReminderDays, req.AmountPaid, req.TransactionId,
                  req.PaymentDate, req.PaymentMode, req.PaymentProofPath, req.Notes, UserId = userId, Id = id });
        if (updated == 0) return NotFound(new { message = "Record not found." });
        await LogAction(conn, id, "Updated", "Website details updated", userId);

        // A manual SuperAdmin date extension is the admin-side twin of a paid renewal, so it must also
        // re-enable the site: pushing EndDate back into the future while leaving Status = 'Expired'
        // means the row stays flagged as lapsed everywhere it is read (admin list, club finder,
        // renewal gating) until someone notices. Re-enabling is unconditional for 'Expired' for the
        // same reason as the paid path — an extended site must end up live.
        // Only 'Expired' is cleared: 'Inactive' means "never activated in Plesk" (a freshly created
        // row) or "explicitly deactivated", and both must still go through the Activate button so the
        // vhost/SSL steps actually run. Soft-deleted rows are excluded by the WHERE clause.
        if (string.Equals((string?)existing.status, "Expired", StringComparison.OrdinalIgnoreCase)
            && req.EndDate.Date >= DateTime.Today)
        {
            await conn.ExecuteAsync(
                "UPDATE club_websites SET Status = 'Active', modified_by = @U WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
                new { Id = id, U = userId });
            await LogAction(conn, id, "Reactivated",
                $"End date extended to {req.EndDate:yyyy-MM-dd} — status Expired → Active", userId);
        }

        // Third-party (custom) domain provisioning. A changed domain makes any prior verification/alias
        // stale, so reset the flags first; then (if the club site is Active in Plesk) provision the
        // alias + Let's Encrypt. Runs for a new/changed domain or an existing-but-unprovisioned one.
        string? domainProvisionSteps = null, domainProvisionError = null;
        var oldClientDomain = ((string?)existing.clientDomain ?? "").Trim();
        var domainChanged = !string.Equals(oldClientDomain, clientDomain ?? "", StringComparison.OrdinalIgnoreCase);
        var alreadyProvisioned = Convert.ToInt32(existing.clientDomainProvisioned ?? 0) == 1;
        // Provision when a domain is present and it's newly added/changed, OR it exists but was never
        // provisioned (legacy row / prior failed attempt). Unchanged + already-provisioned → no-op.
        if (!string.IsNullOrWhiteSpace(clientDomain) && (domainChanged || !alreadyProvisioned))
        {
            if (domainChanged)
                await conn.ExecuteAsync(
                    "UPDATE club_websites SET ClientDomainVerifiedDate = NULL, ClientDomainProvisioned = 0 WHERE pk_id = @Id",
                    new { Id = id });

            // Server-side DNS re-check (defense in depth — the UI already gated on it).
            var dns = await _dns.CheckAsync(clientDomain!, _plesk.ServerIp);
            if (dns.PointsToServer)
                await conn.ExecuteAsync(
                    "UPDATE club_websites SET ClientDomainVerifiedDate = NOW() WHERE pk_id = @Id", new { Id = id });

            // Provision now only if the site is Active (its Plesk subdomain site exists to host the alias).
            if (_plesk.IsConfigured && string.Equals((string)existing.status, "Active", StringComparison.OrdinalIgnoreCase))
            {
                if (!dns.PointsToServer)
                    domainProvisionError = $"Domain does not point to the server yet (found: {(dns.ResolvedIps.Count > 0 ? string.Join(", ", dns.ResolvedIps) : "no A record")}). Add an A record to {_plesk.ServerIp}, then edit again.";
                else
                {
                    var label = WebsiteDomainHelper.NormalizeSubdomain(subdomainToStore);
                    var pr = await ProvisionClientDomainAsync(conn, id, label, clientDomain!, userId);
                    domainProvisionSteps = pr.Ok ? string.Join("; ", pr.Steps) : null;
                    domainProvisionError = pr.Ok ? null : pr.Error;
                }
            }
        }

        // Fire-and-forget: notify the public club-website to drop its in-memory cache
        // for this club's host so the change (esp. theme) shows up on the next refresh.
        _purger.PurgeHost(subdomain);
        if (!string.IsNullOrWhiteSpace(clientDomain)) _purger.PurgeHost(clientDomain);

        return Ok(new { success = true, domainProvisionSteps, domainProvisionError });
    }

    // Adds a third-party domain as a Plesk site-alias on the club's subdomain site (+ best-effort
    // Let's Encrypt), idempotently. Assumes DNS already verified by the caller. Every step is logged.
    // Returns a small result so the caller can surface it. Never throws.
    private record ProvisionResult(bool Ok, string? Error, List<string> Steps);

    private async Task<ProvisionResult> ProvisionClientDomainAsync(MySqlConnection conn, int id, string subdomainLabel, string clientDomain, int userId)
    {
        var steps = new List<string>();
        if (!_plesk.IsConfigured)
            return new ProvisionResult(false, "Plesk is not configured.", steps);
        if (string.IsNullOrWhiteSpace(subdomainLabel))
            return new ProvisionResult(false, "Club subdomain label is empty — cannot attach the domain alias.", steps);
        try
        {
            // Idempotent: if the alias already exists, just mark provisioned.
            if (await _plesk.DomainAliasExistsAsync(clientDomain))
            {
                steps.Add($"Domain already an application on the server ({clientDomain}) — reusing");
                await LogAction(conn, id, "PleskAliasAlreadyExists", clientDomain, userId);
            }
            else
            {
                var fullSub = $"{subdomainLabel}.{_pleskParentDomain.ToLowerInvariant()}";
                await _plesk.AddDomainAliasAsync(fullSub, clientDomain);
                steps.Add($"Application added on the server ({clientDomain})");
                await LogAction(conn, id, "PleskAliasAdded", clientDomain, userId);
            }

            // SSL for the custom domain — wildcard doesn't cover it. Best-effort, non-fatal.
            var le = await _plesk.TryProvisionLetsEncryptForDomainAsync(clientDomain);
            steps.Add(le ? "SSL (Let's Encrypt) issued" : "SSL (Let's Encrypt) not issued yet — retry later");
            await LogAction(conn, id, le ? "PleskDomainLetsEncrypt" : "PleskDomainLetsEncryptFailed", clientDomain, userId);

            await conn.ExecuteAsync(
                "UPDATE club_websites SET ClientDomainProvisioned = 1, ClientDomainVerifiedDate = NOW(), modified_by = @U WHERE pk_id = @Id",
                new { Id = id, U = userId });
            return new ProvisionResult(true, null, steps);
        }
        catch (Exception ex)
        {
            await LogAction(conn, id, "PleskAliasFailed", ex.Message, userId);
            return new ProvisionResult(false, $"Adding the domain application failed: {ex.Message}", steps);
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id, [FromQuery] bool skipPlesk = false)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        var website = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id, Subdomain AS subdomain, Status AS status
            FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id });
        if (website == null) return NotFound(new { message = "Record not found." });

        // Attempt Plesk delete FIRST. DB is deleted ONLY if Plesk succeeds — so user can retry on failure.
        string? pleskResult = null;
        if (!skipPlesk && _plesk.IsConfigured)
        {
            var label = WebsiteDomainHelper.NormalizeSubdomain((string)website.subdomain);
            var fullSub = $"{label}.{_pleskParentDomain.ToLowerInvariant()}";
            try
            {
                // If subdomain doesn't exist in Plesk at all, skip the delete call (treat as already clean)
                if (!await _plesk.SubdomainExistsAsync(label))
                {
                    pleskResult = "Not in Plesk — nothing to delete";
                    await LogAction(conn, id, "PleskSubdomainAlreadyGone", $"{fullSub} not found in Plesk", userId);
                }
                else
                {
                    await _plesk.DeleteSubdomainAsync(label);
                    pleskResult = "Plesk subdomain deleted";
                    await LogAction(conn, id, "PleskSubdomainDeleted", fullSub, userId);
                }
            }
            catch (Exception ex) when (
                ex.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase) ||
                ex.Message.Contains("error 1013", StringComparison.OrdinalIgnoreCase) ||
                ex.Message.Contains("not found", StringComparison.OrdinalIgnoreCase))
            {
                // Plesk says subdomain doesn't exist — treat as success (nothing to delete)
                pleskResult = "Not in Plesk — nothing to delete";
                await LogAction(conn, id, "PleskSubdomainAlreadyGone", ex.Message, userId);
            }
            catch (Exception ex)
            {
                await LogAction(conn, id, "PleskSubdomainDeleteFailed", ex.Message, userId);
                // ABORT — don't touch DB. User can click Delete again to retry, or use Force Clean Plesk.
                return BadRequest(new {
                    message = $"Plesk delete failed — portal record preserved. Click Delete again to retry, or use 'Force Clean Plesk' button if the subdomain still exists in Plesk. Error: {ex.Message}",
                    pleskFailed = true
                });
            }
        }
        else if (skipPlesk)
        {
            await LogAction(conn, id, "PleskDeleteSkippedManual", "Admin chose DB-only delete", userId);
        }

        // Plesk delete succeeded (or skipped) — now soft-delete DB record and free up the subdomain name
        await conn.ExecuteAsync(@"
            UPDATE club_websites
            SET isdeleted = 1,
                Subdomain = CONCAT(Subdomain, '__del_', UNIX_TIMESTAMP(), '_', pk_id),
                modified_by = @U
            WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id, U = userId });
        await LogAction(conn, id, "Deleted", "Record soft-deleted (subdomain freed for re-use)", userId);

        // Cascade soft-delete: menus + sub-menus belong to the website. Re-creating the website seeds fresh defaults.
        var clubFk = await conn.ExecuteScalarAsync<int>(
            "SELECT fk_club_id FROM club_websites WHERE pk_id = @Id", new { Id = id });
        await conn.ExecuteAsync(@"
            UPDATE club_website_submenu
            SET isdeleted = 1, is_active = 0, modified_date = NOW()
            WHERE fk_menu_id IN (
                SELECT pk_club_website_menu_id FROM club_website_menu
                WHERE fk_club_id = @ClubId AND isdeleted = 0
            )",
            new { ClubId = clubFk });
        await conn.ExecuteAsync(@"
            UPDATE club_website_menu
            SET isdeleted = 1, is_active = 0, modified_date = NOW()
            WHERE fk_club_id = @ClubId AND isdeleted = 0",
            new { ClubId = clubFk });

        return Ok(new { success = true, pleskResult });
    }

    [HttpPost("{id}/activate")]
    public async Task<ActionResult> Activate(int id, [FromQuery] bool skipPlesk = false)
    {
        if (!IsSuperAdmin()) return Forbid();
        return await PerformActivationAsync(id, skipPlesk, "Activated");
    }

    [HttpPost("{id}/retry-activation")]
    public async Task<ActionResult> RetryActivation(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        return await PerformActivationAsync(id, skipPlesk: false, "RetryActivation");
    }

    // Re-apply wildcard SSL cert on an already-activated subdomain (no full re-activation).
    [HttpPost("{id}/retry-ssl")]
    public async Task<ActionResult> RetrySsl(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk not configured." });
        if (string.IsNullOrWhiteSpace(_plesk.WildcardCertName))
            return BadRequest(new { message = "WildcardCertName is not configured in appsettings." });

        using var conn = CreateConnection();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT Subdomain AS subdomain, Status AS status FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id });
        if (row == null) return NotFound(new { message = "Website record not found." });

        var subdomain = ((string?)row.subdomain ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(subdomain))
            return BadRequest(new { message = "Subdomain is empty." });

        var label = WebsiteDomainHelper.NormalizeSubdomain(subdomain);
        var userId = GetUserId();

        try
        {
            if (!await _plesk.SubdomainExistsAsync(label))
                return BadRequest(new { message = $"Subdomain '{label}.{_pleskParentDomain}' does not exist in Plesk. Activate it first." });

            await _plesk.AssignCertificateAsync(label, _plesk.WildcardCertName);
            var actual = await _plesk.GetSubdomainCertAsync(label);
            await LogAction(conn, id, "PleskCertRetried", _plesk.WildcardCertName, userId);
            return Ok(new
            {
                success = true,
                message = $"Cert '{_plesk.WildcardCertName}' assigned. Verify: Plesk → {label}.{_pleskParentDomain} → Hosting Settings → Certificate.",
                certificateName = actual
            });
        }
        catch (Exception ex)
        {
            await LogAction(conn, id, "PleskCertRetryFailed", ex.Message, userId);
            return BadRequest(new { message = $"Cert assignment failed: {ex.Message}" });
        }
    }

    // Dumps raw XML from site.get, subdomain.get, webspace.get for a given label — to see which endpoint exposes SSL props.
    [HttpGet("plesk/diagnostic-subdomain")]
    public async Task<ActionResult> PleskDiagnosticSubdomain([FromQuery] string label)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk not configured." });
        if (string.IsNullOrWhiteSpace(label)) return BadRequest(new { message = "label query param required" });
        var lbl = label.Trim().ToLowerInvariant();
        var parentSuffix = "." + _pleskParentDomain.ToLowerInvariant();
        if (lbl.EndsWith(parentSuffix)) lbl = lbl[..^parentSuffix.Length];
        try
        {
            var dump = await _plesk.DiagnosticSubdomainAsync(lbl);
            return Content(dump, "text/plain");
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // Returns raw XML request + response for debugging Plesk API issues
    [HttpGet("plesk/diagnostic")]
    public async Task<ActionResult> PleskDiagnostic([FromQuery] string type = "list-subdomains")
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk not configured." });
        try
        {
            var (req, res) = await _plesk.DiagnosticRawAsync(type);
            return Ok(new { type, request = req, response = res });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("plesk/list-subdomains")]
    public async Task<ActionResult> ListPleskSubdomains()
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!_plesk.IsConfigured)
            return BadRequest(new { message = "Plesk is not configured." });
        try
        {
            var list = await _plesk.ListAllSubdomainsAsync();
            return Ok(new { count = list.Count, subdomains = list.Select(x => new { name = x.Name, id = x.Id }) });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = $"List failed: {ex.Message}" });
        }
    }

    public class ForcePleskDeleteRequest { public string Label { get; set; } = ""; }

    // Force-delete a subdomain from Plesk only (no DB touching) — for cleaning up leftover/stuck Plesk entries.
    // Uses the same safety: re-points docroot first so ClubWebsite shared folder isn't wiped.
    [HttpPost("plesk/force-delete-subdomain")]
    public async Task<ActionResult> ForceDeletePleskSubdomain([FromBody] ForcePleskDeleteRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Label)) return BadRequest(new { message = "label required" });
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk not configured." });

        // Accept either the label only ("rcc2") OR the full FQDN ("club.example.org") — normalize to label
        var label = req.Label.Trim().ToLowerInvariant();
        var parentSuffix = "." + _pleskParentDomain.ToLowerInvariant();
        if (label.EndsWith(parentSuffix)) label = label[..^parentSuffix.Length];

        try
        {
            if (!await _plesk.SubdomainExistsAsync(label))
                return Ok(new { success = true, message = $"Subdomain '{label}.{_pleskParentDomain}' does not exist in Plesk — nothing to delete." });

            await _plesk.DeleteSubdomainAsync(label);
            return Ok(new { success = true, message = $"Deleted '{label}.{_pleskParentDomain}' from Plesk." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = $"Force-delete failed: {ex.Message}" });
        }
    }

    [HttpGet("plesk/test-connection")]
    public async Task<ActionResult> TestPleskConnection()
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!_plesk.IsConfigured)
            return BadRequest(new { message = "Plesk is not configured. Set PleskSettings.ApiKey in appsettings.json." });
        try
        {
            await _plesk.TestConnectionAsync();
            return Ok(new { success = true, message = "Plesk connection OK." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = $"Plesk test failed: {ex.Message}" });
        }
    }

    // Thin adapter over IClubWebsiteActivationService (logic extracted so the self-service
    // purchase flow can reuse it). Maps the plain result to the exact same HTTP responses
    // this endpoint has always returned.
    private async Task<ActionResult> PerformActivationAsync(int id, bool skipPlesk, string logAction)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var result = await _activation.ActivateAsync(conn, id, GetUserId(), skipPlesk, logAction);
        if (result.NotFound) return NotFound(new { message = "Record not found." });
        if (result.NoSubdomain)
            return BadRequest(new { message = "This website has no valid subdomain to provision. Edit the record, set a subdomain, then activate." });
        if (result.ActivationFailed)
            return BadRequest(new { message = $"Plesk activation failed: {result.PleskError}", pleskStepsDone = result.PleskStepsDone });
        return Ok(new
        {
            success = true,
            pleskStepsDone = result.PleskStepsDone,
            pleskError = result.PleskError,
            emailsSent = result.EmailsSent,
            emailsTotal = result.EmailsTotal,
            skipPlesk = result.SkipPlesk
        });
    }

    public class BulkStartTrialRequest
    {
        public List<int> Ids { get; set; } = new();
        public int Days { get; set; }
    }

    // Bulk-assign a trial period to selected club_websites rows.
    // Purchased rows (AmountPaid > 0 OR TransactionId present) are skipped — admin must
    // explicitly switch them to trial via the Edit dialog first.
    [HttpPost("bulk-start-trial")]
    public async Task<ActionResult> BulkStartTrial([FromBody] BulkStartTrialRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.Ids == null || req.Ids.Count == 0)
            return BadRequest(new { message = "Select at least one club." });
        if (req.Days <= 0 || req.Days > 3650)
            return BadRequest(new { message = "Trial period must be between 1 and 3650 days." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");

        int updated = 0, skippedPurchased = 0, notFound = 0, emailsSent = 0, emailsTotal = 0;
        var skippedNames = new List<string>();

        foreach (var id in req.Ids.Distinct())
        {
            var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName,
                       w.Subdomain AS subdomain, w.ClientDomain AS clientDomain, w.IsPurchased AS isPurchased,
                       w.AmountPaid AS amountPaid, w.TransactionId AS transactionId
                FROM club_websites w
                JOIN club_master c ON c.pk_club_id = w.fk_club_id
                WHERE w.pk_id = @Id AND COALESCE(w.isdeleted, 0) = 0",
                new { Id = id });

            if (row == null) { notFound++; continue; }

            var paid = row.amountPaid != null && Convert.ToDecimal(row.amountPaid) > 0m;
            var hasTxn = !string.IsNullOrWhiteSpace((string?)row.transactionId);
            if (Convert.ToBoolean(row.isPurchased) || paid || hasTxn)
            {
                skippedPurchased++;
                skippedNames.Add((string)row.clubName);
                continue;
            }

            var start = DateTime.Today;
            var end = start.AddDays(req.Days);

            await conn.ExecuteAsync(@"
                UPDATE club_websites
                SET StartDate     = @S,
                    EndDate       = @E,
                    Status        = 'Active',
                    IsPurchased   = 0,
                    AmountPaid    = NULL,
                    TransactionId = NULL,
                    PaymentDate   = NULL,
                    PaymentMode   = NULL,
                    modified_by   = @U,
                    modified_date = NOW()
                WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
                new { Id = id, S = start, E = end, U = userId });

            await LogAction(conn, (int)row.id, "TrialStarted",
                $"Trial set to {req.Days} day(s). End: {end:yyyy-MM-dd}", userId);
            updated++;

            // Notify Club President + Secretary (current year). Failures don't block the loop.
            if (currentYearId.HasValue)
            {
                var leaders = (await conn.QueryAsync<dynamic>(@"
                    SELECT m.MemberName AS memberName, m.EmailId AS email, d.designation_name AS designation
                    FROM board_of_directors b
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                    JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                    WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
                      AND d.designation_name IN ('Club President', 'Club Secretary')
                      AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                    new { ClubId = (int)row.clubId, YearId = currentYearId.Value })).ToList();

                emailsTotal += leaders.Count;
                foreach (var l in leaders)
                {
                    try
                    {
                        // Reuse the activation email — copy already describes "active from S to E",
                        // which is what a trial start communicates.
                        await _emailService.SendClubWebsiteActivationEmailAsync(
                            (string)l.email, (string)l.memberName, (string)row.clubName,
                            (string)l.designation, (string)row.subdomain,
                            (string?)row.clientDomain, start, end,
                            ccEmail: RotaryApi.Services.Brand.InternalCc);
                        emailsSent++;
                    }
                    catch { /* logged via email service */ }
                }
                await LogAction(conn, (int)row.id, "TrialEmailSent",
                    $"Sent to {leaders.Count} leader(s)", userId);
            }
        }

        return Ok(new
        {
            success = true,
            updated,
            skippedPurchased,
            skippedPurchasedNames = skippedNames,
            notFound,
            emailsSent,
            emailsTotal,
        });
    }

    // Recycles all IIS application pools for club website subdomains. Useful after
    // deploying a new club-website build so every pool picks up the new code in one shot
    // instead of clicking each pool in IIS Manager (could be 2000+ at scale).
    //
    // Returns counts + per-pool failure messages. Requires the API's app pool identity
    // to have rights to run appcmd.exe (typically: Administrators group, or IIS_IUSRS
    // with elevated permissions configured).
    [HttpPost("recycle-all-pools")]
    public async Task<ActionResult> RecycleAllPools([FromServices] IIisAppPoolRecycler recycler)
    {
        if (!IsSuperAdmin()) return Forbid();
        var result = await recycler.RecycleAllClubWebsitePoolsAsync();
        return Ok(result);
    }

    [HttpPost("{id}/deactivate")]
    public async Task<ActionResult> Deactivate(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        // Capture clubId before update so we can purge its cache.
        var clubId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_club_id FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id });

        var updated = await conn.ExecuteAsync(
            "UPDATE club_websites SET Status = 'Inactive', modified_by = @U WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id, U = userId });
        if (updated == 0) return NotFound(new { message = "Record not found." });
        await LogAction(conn, id, "Deactivated", "Status changed to Inactive", userId);

        if (clubId.HasValue) _purger.PurgeByClub(clubId.Value);

        return Ok(new { success = true });
    }

    [HttpPost("{id}/send-reminder")]
    public async Task<ActionResult> SendReminder(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        var website = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName,
                   w.Subdomain AS subdomain, w.EndDate AS endDate,
                   DATEDIFF(w.EndDate, CURDATE()) AS daysLeft
            FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
            WHERE w.pk_id = @Id AND COALESCE(w.isdeleted, 0) = 0",
            new { Id = id });
        if (website == null) return NotFound(new { message = "Record not found." });

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        if (!currentYearId.HasValue) return BadRequest(new { message = "No current rotary year set." });

        var leaders = (await conn.QueryAsync<dynamic>(@"
            SELECT m.MemberName AS memberName, m.EmailId AS email, d.designation_name AS designation
            FROM board_of_directors b
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
              AND d.designation_name IN ('Club President', 'Club Secretary', 'Club Treasurer')
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
            new { ClubId = (int)website.clubId, YearId = currentYearId.Value })).ToList();
        if (leaders.Count == 0)
            return BadRequest(new { message = "No President/Secretary with email found for this club+year." });

        // One-click renewal pay link (encrypted; price/gateway re-resolved server-side at pay time).
        var frontend = (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
        var payLink = $"{frontend}/pay/club-website/{WebsitePayLinkToken.Generate(_config, (int)website.clubId, currentYearId.Value)}";

        int sent = 0, failed = 0;
        foreach (var l in leaders)
        {
            try
            {
                await _emailService.SendClubWebsiteReminderEmailAsync(
                    (string)l.email, (string)l.memberName, (string)website.clubName,
                    (string)l.designation, (string)website.subdomain,
                    (DateTime)website.endDate, (int)website.daysLeft, payLink);
                sent++;
            }
            catch { failed++; }
        }
        await conn.ExecuteAsync(
            "UPDATE club_websites SET LastReminderSent = NOW() WHERE pk_id = @Id", new { Id = id });
        await LogAction(conn, id, "ReminderSent", $"Manual reminder — sent: {sent}, failed: {failed}", userId);
        return Ok(new { success = true, sent, failed });
    }

    // ══════════════ Per-club, per-Rotary-year pricing + gateway + bulk pay-link reminders ══════════════
    // A club_website_pricing row for (club, year) overrides the config default (price / tax % / gateway).
    // Rule: GST 0% => gateway MUST be 'route' with an active linked account. Reminders carry an encrypted
    // pay link; the amount is always re-resolved server-side (WebsiteBillingService.ResolveConfig) so the
    // client can never influence the price.

    public class PricingUpsertRequest
    {
        public int YearId { get; set; }
        public decimal BaseAmount { get; set; }      // New / purchase price
        public decimal RenewalAmount { get; set; }   // Renewal price
        public decimal GstPercent { get; set; }
        public string GatewayType { get; set; } = "normal";  // "normal" | "route"
        public int? RouteAccountId { get; set; }
    }
    public class PricingBatchRequest : PricingUpsertRequest
    {
        public int? DistrictId { get; set; }
        public List<int>? ClubIds { get; set; }
    }
    public class SendRemindersRequest
    {
        public List<int>? ClubIds { get; set; }
        public int? YearId { get; set; }   // null => current rotary year
    }

    // System-wide default New/Renewal/GST — the SuperAdmin-editable global default (system_settings),
    // appsettings as the seed. Used as the fallback when a club has no per-club/district pricing row.
    private Task<WebsiteDefaultPricing.Defaults> ResolveDefaultsAsync(MySqlConnection conn)
        => WebsiteDefaultPricing.ResolveAsync(conn, _config);
    private static decimal ComputeTotal(decimal baseAmount, decimal gstPercent)
        => baseAmount + Math.Round(baseAmount * gstPercent / 100m, 2, MidpointRounding.AwayFromZero);

    // Current-year President/Secretary contact, one row per club. designation is a hardcoded constant.
    private static string BoardContactSql(string designation) => $@"
        SELECT b.fk_club_id AS clubId, MAX(m.MemberName) AS name,
               MAX(m.PrimaryMobileNumber) AS mobile, MAX(m.EmailId) AS email
        FROM board_of_directors b
        JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
        JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
        WHERE dm.designation_name = '{designation}' AND b.isdeleted = 0
          AND b.fk_year_id = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1)
        GROUP BY b.fk_club_id";

    private async Task<int> CurrentYearIdAsync(MySqlConnection conn) =>
        await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1") ?? 0;

    // GST 0% => gateway must be 'route'; the Route account itself is ONE global selection (below),
    // so per-club we only validate that a global Route account exists when Route is chosen.
    private async Task<string?> ValidatePricingAsync(MySqlConnection conn, decimal gstPercent, string? gatewayType)
    {
        var gw = (gatewayType ?? "normal").Trim().ToLowerInvariant();
        if (gw != "normal" && gw != "route") return "Invalid payment gateway.";
        if (gstPercent < 0 || gstPercent > 100) return "GST% must be between 0 and 100.";
        if (gstPercent == 0m && gw != "route")
            return "GST 0% requires the Razorpay Route gateway.";
        if (gw == "route" && !await HasActiveGlobalRouteAccountAsync(conn))
            return "No club-website Route account is selected yet. Choose one at the top of the Pricing & Reminders tab first.";
        return null;
    }

    // The single global "Club Website Route account" (system_settings key), and whether it's active.
    private async Task<int?> GetGlobalRouteAccountIdAsync(MySqlConnection conn)
    {
        var raw = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteRouteAccountId' LIMIT 1");
        return int.TryParse(raw, out var x) && x > 0 ? x : (int?)null;
    }
    private async Task<bool> HasActiveGlobalRouteAccountAsync(MySqlConnection conn)
    {
        var id = await GetGlobalRouteAccountIdAsync(conn);
        if (!id.HasValue) return false;
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM razorpay_route_accounts WHERE pk_id = @Id AND IsActive = 1 AND isdeleted = 0",
            new { Id = id.Value }) > 0;
    }

    private static async Task UpsertPricingRowAsync(MySqlConnection conn, int clubId, int yearId, PricingUpsertRequest req, int userId)
    {
        var gw = (req.GatewayType ?? "normal").Trim().ToLowerInvariant();
        if (gw != "route") gw = "normal";
        // Route account is global (not per-club) — always store NULL here.
        await conn.ExecuteAsync(@"
            INSERT INTO club_website_pricing
                (fk_club_id, fk_year_id, BaseAmount, RenewalAmount, GstPercent, GatewayType, fk_route_account_id, modified_by, modified_date)
            VALUES (@Club, @Year, @Base, @Renewal, @Gst, @Gateway, NULL, @User, NOW())
            ON DUPLICATE KEY UPDATE
                BaseAmount = @Base, RenewalAmount = @Renewal, GstPercent = @Gst, GatewayType = @Gateway,
                fk_route_account_id = NULL, modified_by = @User, modified_date = NOW()",
            new { Club = clubId, Year = yearId, Base = req.BaseAmount, Renewal = req.RenewalAmount, Gst = req.GstPercent, Gateway = gw, User = userId });
    }

    // "Route ALL club-website payments through the selected account" — global override flag.
    private async Task<bool> GetRouteAllAsync(MySqlConnection conn)
    {
        var raw = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteRouteAll' LIMIT 1");
        return raw == "1" || string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase);
    }

    // ── Global "Club Website Route account" (one account for all club-website Route payments) ──
    [HttpGet("pricing/route-account")]
    public async Task<ActionResult> GetClubWebsiteRouteAccount()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var id = await GetGlobalRouteAccountIdAsync(conn);
        object? account = null;
        if (id.HasValue)
            account = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_id AS id, Name AS name, AccountId AS accountId, IsActive AS isActive, Status AS status FROM razorpay_route_accounts WHERE pk_id = @Id AND isdeleted = 0",
                new { Id = id.Value });
        return Ok(new { routeAccountId = id, account, routeAll = await GetRouteAllAsync(conn) });
    }

    public class SetRouteAccountRequest { public int? RouteAccountId { get; set; } public bool RouteAll { get; set; } }

    [HttpPut("pricing/route-account")]
    public async Task<ActionResult> SetClubWebsiteRouteAccount([FromBody] SetRouteAccountRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (req.RouteAccountId.HasValue && req.RouteAccountId.Value > 0)
        {
            var ok = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM razorpay_route_accounts WHERE pk_id = @Id AND IsActive = 1 AND isdeleted = 0",
                new { Id = req.RouteAccountId.Value });
            if (ok == 0) return BadRequest(new { message = "That Route account is inactive or does not exist." });
        }
        // "Route all" needs an account to route to.
        if (req.RouteAll && !(req.RouteAccountId.HasValue && req.RouteAccountId.Value > 0))
            return BadRequest(new { message = "Select a Route account before routing all payments through it." });

        var val = (req.RouteAccountId.HasValue && req.RouteAccountId.Value > 0) ? req.RouteAccountId.Value.ToString() : "";
        var userId = GetUserId();
        await conn.ExecuteAsync(@"
            INSERT INTO system_settings (SettingKey, SettingValue, modified_by)
            VALUES ('ClubWebsiteRouteAccountId', @V, @U)
            ON DUPLICATE KEY UPDATE SettingValue = @V, modified_by = @U, modified_date = NOW()",
            new { V = val, U = userId });
        await conn.ExecuteAsync(@"
            INSERT INTO system_settings (SettingKey, SettingValue, modified_by)
            VALUES ('ClubWebsiteRouteAll', @V, @U)
            ON DUPLICATE KEY UPDATE SettingValue = @V, modified_by = @U, modified_date = NOW()",
            new { V = req.RouteAll ? "1" : "0", U = userId });
        return Ok(new { success = true });
    }

    // ── System-wide DEFAULT pricing (New / Renewal / GST), OTP-gated edit ──────────
    // These are the fallback prices for every club that has no per-club/district override row.
    // Editing them is a money-setting, so a save requires an OTP sent to the acting SuperAdmin's
    // own registered mobile + email. Reuses the mobile_login_otp table (login_type 'cw_price').
    private const string CW_PRICE_OTP_TYPE = "cw_price";     // mobile_login_otp.login_type is VARCHAR(20)
    private const int CW_PRICE_OTP_EXPIRY_MIN = 5;
    private const int CW_PRICE_OTP_MAX_ATTEMPTS = 3;

    private static string MaskMobile(string m)
        => string.IsNullOrWhiteSpace(m) || m.Length < 4 ? "" : new string('•', m.Length - 3) + m[^3..];
    private static string MaskEmail(string e)
    {
        if (string.IsNullOrWhiteSpace(e) || !e.Contains('@')) return "";
        var at = e.IndexOf('@');
        var name = e[..at];
        var head = name.Length <= 1 ? name : name[0] + new string('•', Math.Max(1, name.Length - 1));
        return head + e[at..];
    }

    [HttpGet("default-pricing")]
    public async Task<ActionResult> GetDefaultPricing()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var d = await WebsiteDefaultPricing.ResolveAsync(conn, _config);
        return Ok(new
        {
            newAmount = d.NewAmount,
            renewalAmount = d.RenewalAmount,
            gstPercent = d.GstPercent,
            newTotal = ComputeTotal(d.NewAmount, d.GstPercent),
            renewalTotal = ComputeTotal(d.RenewalAmount, d.GstPercent),
            isCustom = d.IsCustom
        });
    }

    public class SendDefaultPricingOtpRequest
    {
        public decimal NewAmount { get; set; }
        public decimal RenewalAmount { get; set; }
        public decimal GstPercent { get; set; }
    }

    [HttpPost("default-pricing/send-otp")]
    public async Task<ActionResult> SendDefaultPricingOtp([FromBody] SendDefaultPricingOtpRequest? req)
    {
        if (!IsSuperAdmin()) return Forbid();
        int userId = GetUserId();
        if (userId <= 0) return Unauthorized(new { message = "Not signed in." });

        // OTP goes to a FIXED approver (the boss), configured in appsettings — NOT to the acting
        // SuperAdmin — so editing the system-wide default price always needs the approver's code.
        // Change ClubWebsitePricingApproval:OtpEmail after go-live to hand this to the boss.
        string email = (_config["ClubWebsitePricingApproval:OtpEmail"] ?? RotaryApi.Services.Brand.SupportEmail).Trim();
        string mobile = (_config["ClubWebsitePricingApproval:OtpMobile"] ?? "").Trim();
        if (mobile == "" && email == "")
            return StatusCode(500, new { message = "OTP approver is not configured (ClubWebsitePricingApproval:OtpEmail)." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var otp = System.Security.Cryptography.RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
        var expiresAt = DateTime.UtcNow.AddMinutes(CW_PRICE_OTP_EXPIRY_MIN);
        var identifier = $"cwprice:{userId}";

        await conn.ExecuteAsync(
            "UPDATE mobile_login_otp SET is_used = 1 WHERE identifier = @I AND login_type = @T AND is_used = 0",
            new { I = identifier, T = CW_PRICE_OTP_TYPE });
        await conn.ExecuteAsync(@"
            INSERT INTO mobile_login_otp
                (fk_member_master_profile_id, login_type, identifier, country_id, otp_code, expires_at, max_attempts, is_used)
            VALUES (@M, @T, @I, NULL, @O, @E, @Max, 0)",
            new { M = userId, T = CW_PRICE_OTP_TYPE, I = identifier, O = otp, E = expiresAt, Max = CW_PRICE_OTP_MAX_ATTEMPTS });

        // Current (old) defaults, the requester's name, and the proposed (new) values — so the OTP
        // email itself is the audit trail of exactly what is changing (old → new, GST-inclusive).
        var cur = await WebsiteDefaultPricing.ResolveAsync(conn, _config);
        var requestedBy = await conn.ExecuteScalarAsync<string?>(
            "SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id", new { Id = userId }) ?? "SuperAdmin";
        decimal pNew = req?.NewAmount ?? cur.NewAmount;
        decimal pRenewal = req?.RenewalAmount ?? cur.RenewalAmount;
        decimal pGst = req?.GstPercent ?? cur.GstPercent;

        string Inr(decimal v) => RotaryApi.Services.Brand.Money(v);
        string Row(string label, decimal oldBase, decimal oldGst, decimal newBase, decimal newGst)
        {
            bool changed = oldBase != newBase || oldGst != newGst;
            var arrow = changed ? "background:#fffbeb;" : "";
            return $@"<tr style='{arrow}'>
                <td style='padding:8px 10px;border:1px solid #D5DEE8;'>{label}</td>
                <td style='padding:8px 10px;border:1px solid #D5DEE8;text-align:right;color:#64748b;'>{Inr(oldBase)} + {oldGst:0.##}% = <strong>{Inr(ComputeTotal(oldBase, oldGst))}</strong></td>
                <td style='padding:8px 10px;border:1px solid #D5DEE8;text-align:right;color:#166534;'>{Inr(newBase)} + {newGst:0.##}% = <strong>{Inr(ComputeTotal(newBase, newGst))}</strong></td>
            </tr>";
        }

        var emailSubject = "ROW — Club Website Default Pricing change (OTP)";
        var emailBody = $@"{EmailService.EMAIL_HEADER}
<h2 style='color:#17458F;margin-top:0;'>Club Website Default Pricing — change request</h2>
<p><strong>{System.Net.WebUtility.HtmlEncode(requestedBy)}</strong> wants to change the <strong>system-wide default</strong> club-website prices. Share the OTP below only if you approve this exact change:</p>
<table style='border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;'>
  <thead>
    <tr style='background:#EDF4FB;'>
      <th style='padding:8px 10px;border:1px solid #D5DEE8;text-align:left;'>Item</th>
      <th style='padding:8px 10px;border:1px solid #D5DEE8;text-align:right;'>Current (old)</th>
      <th style='padding:8px 10px;border:1px solid #D5DEE8;text-align:right;'>New (proposed)</th>
    </tr>
  </thead>
  <tbody>
    {Row("New club website", cur.NewAmount, cur.GstPercent, pNew, pGst)}
    {Row("Renewal", cur.RenewalAmount, cur.GstPercent, pRenewal, pGst)}
  </tbody>
</table>
<p style='font-size:12px;color:#64748b;margin-top:0;'>Amounts are shown as base + GST% = total payable. Highlighted rows are changing.</p>
<div style='background-color:#F7F9FC;border:2px solid #17458F;border-radius:8px;padding:20px;margin:16px 0;text-align:center;'>
  <p style='font-size:32px;font-weight:bold;color:#17458F;letter-spacing:8px;margin:0;'>{otp}</p>
</div>
<p style='color:#e53e3e;'><strong>This OTP expires in {CW_PRICE_OTP_EXPIRY_MIN} minutes.</strong></p>
<p>If you did not expect this, ignore this email — nothing changes without the OTP.</p>
{EmailService.EMAIL_FOOTER}";

        bool emailOk = false;
        // The code goes by email only.
        if (email != "")
        {
            try { await _emailService.SendGenericEmailAsync(email, emailSubject, emailBody); emailOk = true; }
            catch (Exception ex) { _ = ex; }
        }
        if (!emailOk)
            return StatusCode(500, new { message = "Could not deliver the OTP by email. Please try again." });

        return Ok(new
        {
            message = "OTP sent to the authorised approver.",
            // Development only: anywhere else the requester would get the approver's OTP back.
            debugOtp = HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment() ? otp : null,
            sentEmail = emailOk,
            maskedMobile = MaskMobile(mobile),
            maskedEmail = MaskEmail(email),
            expiryMinutes = CW_PRICE_OTP_EXPIRY_MIN
        });
    }

    public class SaveDefaultPricingRequest
    {
        public decimal NewAmount { get; set; }
        public decimal RenewalAmount { get; set; }
        public decimal GstPercent { get; set; }
        public string Otp { get; set; } = "";
    }

    [HttpPost("default-pricing")]
    public async Task<ActionResult> SaveDefaultPricing([FromBody] SaveDefaultPricingRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        int userId = GetUserId();
        if (userId <= 0) return Unauthorized(new { message = "Not signed in." });
        if (req.NewAmount < 0 || req.RenewalAmount < 0) return BadRequest(new { message = "Amounts cannot be negative." });
        if (req.GstPercent < 0 || req.GstPercent > 100) return BadRequest(new { message = "GST% must be between 0 and 100." });
        var otp = (req.Otp ?? "").Trim();
        if (otp.Length != 6) return BadRequest(new { message = "Enter the 6-digit OTP." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var identifier = $"cwprice:{userId}";
        var otpRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_otp_id AS id, otp_code, attempts, max_attempts, expires_at
            FROM mobile_login_otp
            WHERE identifier = @I AND login_type = @T AND is_used = 0
            ORDER BY pk_otp_id DESC LIMIT 1",
            new { I = identifier, T = CW_PRICE_OTP_TYPE });
        if (otpRow == null) return BadRequest(new { message = "Please request an OTP first." });
        if (DateTime.UtcNow > (DateTime)otpRow.expires_at)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });
            return BadRequest(new { message = "OTP expired. Please request a new one." });
        }
        int attempts = Convert.ToInt32(otpRow.attempts), maxAttempts = Convert.ToInt32(otpRow.max_attempts);
        if (attempts >= maxAttempts)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });
            return BadRequest(new { message = "Too many attempts. Please request a new OTP." });
        }
        if ((string)otpRow.otp_code != otp)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET attempts = attempts + 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });
            return BadRequest(new { message = $"Invalid OTP. {maxAttempts - attempts - 1} attempt(s) left." });
        }
        await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });

        string Inv(decimal v) => v.ToString(System.Globalization.CultureInfo.InvariantCulture);
        await UpsertSettingAsync(conn, WebsiteDefaultPricing.KeyNew, Inv(req.NewAmount), userId);
        await UpsertSettingAsync(conn, WebsiteDefaultPricing.KeyRenewal, Inv(req.RenewalAmount), userId);
        await UpsertSettingAsync(conn, WebsiteDefaultPricing.KeyGst, Inv(req.GstPercent), userId);

        var d = await WebsiteDefaultPricing.ResolveAsync(conn, _config);
        return Ok(new
        {
            success = true,
            newAmount = d.NewAmount,
            renewalAmount = d.RenewalAmount,
            gstPercent = d.GstPercent,
            newTotal = ComputeTotal(d.NewAmount, d.GstPercent),
            renewalTotal = ComputeTotal(d.RenewalAmount, d.GstPercent)
        });
    }

    private static async Task UpsertSettingAsync(MySqlConnection conn, string key, string val, int userId)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO system_settings (SettingKey, SettingValue, modified_by)
            VALUES (@K, @V, @U)
            ON DUPLICATE KEY UPDATE SettingValue = @V, modified_by = @U, modified_date = NOW()",
            new { K = key, V = val, U = userId });
    }

    // Rotary years for the Pricing tab year selector.
    [HttpGet("pricing/years")]
    public async Task<ActionResult> GetPricingYears()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT pk_year_id AS id, YearLabel AS label, IsCurrent AS isCurrent
            FROM rotary_year_master WHERE isdeleted = 0
            ORDER BY IsCurrent DESC, StartDate DESC");
        return Ok(years);
    }

    // Clubs with their effective (row-or-default) price + gateway for the selected year, website status,
    // and current-year President/Secretary contact. Paginated (district/search filters).
    [HttpGet("pricing")]
    public async Task<ActionResult> GetPricing([FromQuery] int? yearId, [FromQuery] int? districtId,
        [FromQuery] string? search, [FromQuery] int? expiringInDays,
        [FromQuery] DateTime? expiryFrom, [FromQuery] DateTime? expiryTo,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 100)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 500) pageSize = 100;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        int yr = yearId ?? await CurrentYearIdAsync(conn);
        if (yr <= 0) return BadRequest(new { message = "No rotary year available." });

        var p = new DynamicParameters();
        p.Add("Year", yr);
        p.Add("Offset", (page - 1) * pageSize);
        p.Add("PageSize", pageSize);
        var where = "WHERE c.isdeleted = 0 AND c.IsActive = 1";
        if (districtId.HasValue) { where += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        if (!string.IsNullOrWhiteSpace(search)) { where += " AND (c.ClubName LIKE @S OR c.ClubRotaryId LIKE @S)"; p.Add("S", $"%{search}%"); }
        // Expiring-within filter: latest website's days-to-expiry is between now (0) and N
        // (clubs with no site, or already expired, are excluded — this is "expiring soon", not "expired").
        if (expiringInDays.HasValue)
        {
            where += @" AND (SELECT DATEDIFF(w2.EndDate, CURDATE()) FROM club_websites w2
                             WHERE w2.fk_club_id = c.pk_club_id AND COALESCE(w2.isdeleted, 0) = 0
                             ORDER BY w2.created_date DESC LIMIT 1) BETWEEN 0 AND @ExpiringInDays";
            p.Add("ExpiringInDays", expiringInDays.Value);
        }
        // Explicit expiry date-range filter — independent of, and combinable with, expiringInDays.
        if (expiryFrom.HasValue)
        {
            where += @" AND (SELECT w3.EndDate FROM club_websites w3
                             WHERE w3.fk_club_id = c.pk_club_id AND COALESCE(w3.isdeleted, 0) = 0
                             ORDER BY w3.created_date DESC LIMIT 1) >= @ExpiryFrom";
            p.Add("ExpiryFrom", expiryFrom.Value.Date);
        }
        if (expiryTo.HasValue)
        {
            where += @" AND (SELECT w3.EndDate FROM club_websites w3
                             WHERE w3.fk_club_id = c.pk_club_id AND COALESCE(w3.isdeleted, 0) = 0
                             ORDER BY w3.created_date DESC LIMIT 1) < @ExpiryToExclusive";
            p.Add("ExpiryToExclusive", expiryTo.Value.Date.AddDays(1));
        }

        var total = await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM club_master c {where}", p);
        // Any expiry-based filter narrows to "who's expiring" — soonest first is the useful order there;
        // otherwise keep the default alphabetical browse order.
        var orderBy = (expiringInDays.HasValue || expiryFrom.HasValue || expiryTo.HasValue)
            ? "ORDER BY daysLeft ASC, c.ClubName"
            : "ORDER BY c.ClubName";

        var sql = $@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                   w.Subdomain AS subdomain, w.Status AS websiteStatus, w.EndDate AS endDate,
                   DATEDIFF(w.EndDate, CURDATE()) AS daysLeft,
                   CASE WHEN w.pk_id IS NULL THEN 'New' ELSE 'Renewal' END AS orderType,
                   p.pk_id AS pricingId, p.BaseAmount AS baseAmount, p.RenewalAmount AS renewalAmount, p.GstPercent AS gstPercent,
                   p.GatewayType AS gatewayType, p.fk_route_account_id AS routeAccountId, ra.Name AS routeAccountName,
                   pres.name AS presidentName, pres.mobile AS presidentMobile, pres.email AS presidentEmail,
                   sec.name AS secretaryName, sec.mobile AS secretaryMobile, sec.email AS secretaryEmail
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN club_websites w ON w.pk_id = (
                SELECT w2.pk_id FROM club_websites w2 WHERE w2.fk_club_id = c.pk_club_id AND COALESCE(w2.isdeleted, 0) = 0
                ORDER BY w2.created_date DESC LIMIT 1)
            LEFT JOIN club_website_pricing p ON p.fk_club_id = c.pk_club_id AND p.fk_year_id = @Year
            LEFT JOIN razorpay_route_accounts ra ON ra.pk_id = p.fk_route_account_id
            LEFT JOIN ({BoardContactSql("Club President")}) pres ON pres.clubId = c.pk_club_id
            LEFT JOIN ({BoardContactSql("Club Secretary")}) sec ON sec.clubId = c.pk_club_id
            {where}
            {orderBy}
            LIMIT @Offset, @PageSize";
        var rows = (await conn.QueryAsync<dynamic>(sql, p)).ToList();

        var def = await ResolveDefaultsAsync(conn);
        decimal defBase = def.NewAmount, defRenewal = def.RenewalAmount, defGst = def.GstPercent;
        var frontend = (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
        var items = rows.Select(r =>
        {
            decimal effBase = r.baseAmount != null ? (decimal)r.baseAmount : defBase;
            decimal effRenewal = r.renewalAmount != null ? (decimal)r.renewalAmount : defRenewal;
            decimal effGst = r.gstPercent != null ? (decimal)r.gstPercent : defGst;
            int cid = (int)r.clubId;
            return new
            {
                clubId = cid,
                clubName = (string)r.clubName,
                clubRotaryId = (string?)r.clubRotaryId,
                districtId = r.districtId == null ? (int?)null : (int)r.districtId,
                districtNumber = (string?)r.districtNumber,
                subdomain = (string?)r.subdomain,
                websiteStatus = (string?)r.websiteStatus,
                endDate = r.endDate == null ? (DateTime?)null : (DateTime)r.endDate,
                daysLeft = r.daysLeft == null ? (int?)null : (int)r.daysLeft,
                orderType = (string)r.orderType,
                isCustom = r.pricingId != null,
                // Encrypted one-click pay link for this club + the selected year (copy-able in the UI).
                payLink = $"{frontend}/pay/club-website/{WebsitePayLinkToken.Generate(_config, cid, yr)}",
                // Wallet email-credit top-up link for this club.
                emailPayLink = $"{frontend}/pay/w/{WalletPayLinkToken.Generate(_config, "club", "email", cid)}",
                baseAmount = effBase,
                renewalAmount = effRenewal,
                gstPercent = effGst,
                totalAmount = ComputeTotal(effBase, effGst),
                renewalTotalAmount = ComputeTotal(effRenewal, effGst),
                gatewayType = ((string?)r.gatewayType ?? "normal"),
                routeAccountId = r.routeAccountId == null ? (int?)null : (int)r.routeAccountId,
                routeAccountName = (string?)r.routeAccountName,
                presidentName = (string?)r.presidentName, presidentMobile = (string?)r.presidentMobile, presidentEmail = (string?)r.presidentEmail,
                secretaryName = (string?)r.secretaryName, secretaryMobile = (string?)r.secretaryMobile, secretaryEmail = (string?)r.secretaryEmail
            };
        });
        // Common (pick-a-club) links shown at the top of the Club Wallet tab — no club baked in, no
        // expiry (user 2026-10-09). The per-club links above keep their 30 days.
        var commonLinks = new
        {
            website = $"{frontend}/pay/w/{WalletPayLinkToken.Generate(_config, "club", "website", 0, neverExpires: true)}",
            email = $"{frontend}/pay/w/{WalletPayLinkToken.Generate(_config, "club", "email", 0, neverExpires: true)}",
        };
        return Ok(new { items, total, page, pageSize, yearId = yr, routeAll = await GetRouteAllAsync(conn), commonLinks });
    }

    // Upsert a single club's price + gateway for a year.
    [HttpPut("pricing/{clubId:int}")]
    public async Task<ActionResult> UpsertPricing(int clubId, [FromBody] PricingUpsertRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        int yr = req.YearId > 0 ? req.YearId : await CurrentYearIdAsync(conn);
        if (yr <= 0) return BadRequest(new { message = "No rotary year available." });
        var err = await ValidatePricingAsync(conn, req.GstPercent, req.GatewayType);
        if (err != null) return BadRequest(new { message = err });
        await UpsertPricingRowAsync(conn, clubId, yr, req, GetUserId());
        return Ok(new { success = true });
    }

    // Batch-set a price + gateway for every club in a district (or an explicit club list) for a year.
    [HttpPut("pricing/batch")]
    public async Task<ActionResult> BatchPricing([FromBody] PricingBatchRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        int yr = req.YearId > 0 ? req.YearId : await CurrentYearIdAsync(conn);
        if (yr <= 0) return BadRequest(new { message = "No rotary year available." });
        var err = await ValidatePricingAsync(conn, req.GstPercent, req.GatewayType);
        if (err != null) return BadRequest(new { message = err });

        List<int> ids;
        if (req.ClubIds != null && req.ClubIds.Count > 0)
            ids = req.ClubIds.Distinct().ToList();
        else if (req.DistrictId.HasValue)
            ids = (await conn.QueryAsync<int>(
                "SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1",
                new { D = req.DistrictId.Value })).ToList();
        else
            return BadRequest(new { message = "Select a district or specific clubs." });

        if (ids.Count == 0) return Ok(new { success = true, updated = 0 });

        int userId = GetUserId();
        foreach (var clubId in ids)
            await UpsertPricingRowAsync(conn, clubId, yr, req, userId);
        return Ok(new { success = true, updated = ids.Count });
    }

    // Bulk buy/renew reminders: an email with an encrypted pay link, to the current-year President,
    // Secretary and Treasurer of each selected club. Skips clubs with an invalid config or no email.
    [HttpPost("pricing/send-reminders")]
    public async Task<ActionResult> SendPricingReminders([FromBody] SendRemindersRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.ClubIds == null || req.ClubIds.Count == 0) return BadRequest(new { message = "Select at least one club." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        int yr = req.YearId.HasValue && req.YearId.Value > 0 ? req.YearId.Value : await CurrentYearIdAsync(conn);
        if (yr <= 0) return BadRequest(new { message = "No rotary year available." });

        int userId = GetUserId();
        var frontend = (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
        var def = await ResolveDefaultsAsync(conn);
        decimal defBase = def.NewAmount, defGst = def.GstPercent;
        bool globalRouteOk = await HasActiveGlobalRouteAccountAsync(conn);  // one account for all Route payments
        bool routeAll = await GetRouteAllAsync(conn);                       // force Route for every club

        var rows = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   w.pk_id AS websiteId, w.Subdomain AS subdomain, w.ClientDomain AS clientDomain,
                   w.EndDate AS endDate, DATEDIFF(w.EndDate, CURDATE()) AS daysLeft,
                   p.BaseAmount AS baseAmount, p.GstPercent AS gstPercent, p.GatewayType AS gatewayType,
                   pres.name AS presidentName, pres.email AS presidentEmail,
                   sec.name AS secretaryName, sec.email AS secretaryEmail,
                   treas.name AS treasurerName, treas.email AS treasurerEmail
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN club_websites w ON w.pk_id = (
                SELECT w2.pk_id FROM club_websites w2 WHERE w2.fk_club_id = c.pk_club_id AND COALESCE(w2.isdeleted, 0) = 0
                ORDER BY w2.created_date DESC LIMIT 1)
            LEFT JOIN club_website_pricing p ON p.fk_club_id = c.pk_club_id AND p.fk_year_id = @Year
            LEFT JOIN ({BoardContactSql("Club President")}) pres ON pres.clubId = c.pk_club_id
            LEFT JOIN ({BoardContactSql("Club Secretary")}) sec ON sec.clubId = c.pk_club_id
            LEFT JOIN ({BoardContactSql("Club Treasurer")}) treas ON treas.clubId = c.pk_club_id
            WHERE c.pk_club_id IN @Ids AND c.isdeleted = 0",
            new { Year = yr, Ids = req.ClubIds })).ToList();

        int clubsProcessed = 0, emailsSent = 0, failed = 0;
        var skipped = new List<object>();

        foreach (var r in rows)
        {
            int clubId = (int)r.clubId;
            string clubName = (string)r.clubName;
            bool hasSite = r.websiteId != null;
            string orderType = hasSite ? "Renewal" : "New";
            decimal effBase = r.baseAmount != null ? (decimal)r.baseAmount : defBase;
            decimal effGst = r.gstPercent != null ? (decimal)r.gstPercent : defGst;
            string gw = ((string?)r.gatewayType ?? "normal").Trim().ToLowerInvariant();
            if (gw != "route") gw = "normal";
            if (routeAll) gw = "route";

            if (gw == "route" && !globalRouteOk) { skipped.Add(new { clubId, clubName, reason = "No club-website Route account is selected." }); continue; }
            if (effGst == 0m && gw != "route") { skipped.Add(new { clubId, clubName, reason = "GST 0% must use the Route gateway." }); continue; }

            decimal total = ComputeTotal(effBase, effGst);
            DateTime? endDate = r.endDate == null ? (DateTime?)null : (DateTime)r.endDate;
            int? daysLeft = r.daysLeft == null ? (int?)null : (int)r.daysLeft;
            // Don't nag a club whose website is active with plenty of time left (> 30 days).
            if (hasSite && daysLeft.HasValue && daysLeft.Value > 30)
            { skipped.Add(new { clubId, clubName, reason = $"Website active — {daysLeft} days remaining (over 30)." }); continue; }
            var token = WebsitePayLinkToken.Generate(_config, clubId, yr);
            var link = $"{frontend}/pay/club-website/{token}";

            var recips = new List<(string name, string email, string designation)>();
            if (!string.IsNullOrWhiteSpace((string?)r.presidentEmail))
                recips.Add(((string?)r.presidentName ?? "President", (string)r.presidentEmail, "Club President"));
            if (!string.IsNullOrWhiteSpace((string?)r.secretaryEmail))
                recips.Add(((string?)r.secretaryName ?? "Secretary", (string)r.secretaryEmail, "Club Secretary"));
            if (!string.IsNullOrWhiteSpace((string?)r.treasurerEmail))
                recips.Add(((string?)r.treasurerName ?? "Treasurer", (string)r.treasurerEmail, "Club Treasurer"));

            if (recips.Count == 0) { skipped.Add(new { clubId, clubName, reason = "No President/Secretary/Treasurer email found." }); continue; }

            bool anySent = false;
            foreach (var rc in recips)
            {
                try
                {
                    await _emailService.SendClubWebsitePayLinkEmailAsync(rc.email, rc.name, clubName, rc.designation, orderType, total, endDate, daysLeft, link);
                    emailsSent++; anySent = true;
                }
                catch { failed++; }
            }
            if (anySent)
            {
                clubsProcessed++;
                if (hasSite) await LogAction(conn, (int)r.websiteId, "ReminderSent", $"Bulk pay-link reminder (year {yr})", userId);
            }
        }
        return Ok(new { clubsProcessed, emailsSent, failed, skipped });
    }
}

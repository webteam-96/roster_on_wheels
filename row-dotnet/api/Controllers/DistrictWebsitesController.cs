using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using System.Data;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/admin/district-websites")]
[Authorize]
public class DistrictWebsitesController : ControllerBase
{
    private readonly string _connectionString;
    private readonly PleskService _plesk;
    private readonly string _pleskParentDomain;
    private readonly string _districtDocroot;
    private readonly bool _useHttps;

    public DistrictWebsitesController(IConfiguration config, PleskService plesk)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _plesk = plesk;
        _pleskParentDomain = config.GetSection("PleskSettings")["ParentDomain"] ?? "";
        _districtDocroot = config.GetSection("PleskSettings")["DistrictWebsiteSharedDocroot"] ?? "";
        _useHttps = string.Equals(config.GetSection("ClubSite")["UseHttps"], "true", StringComparison.OrdinalIgnoreCase);
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // Website status for the DISTRICT DASHBOARD pill. District website is FREE (status-only):
    // returns configured=true + visitUrl ONLY when an Active site exists; otherwise configured=false
    // so the dashboard hides the pill.
    [HttpGet("/api/districts/{districtId}/website-status")]
    public async Task<ActionResult> GetDistrictWebsiteStatus(int districtId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT Subdomain AS subdomain, ClientDomain AS clientDomain, Status AS status
            FROM district_websites
            WHERE fk_district_id = @DistrictId AND isdeleted = 0
            ORDER BY created_date DESC LIMIT 1",
            new { DistrictId = districtId });

        if (row == null || !string.Equals((string?)row.status, "Active", StringComparison.OrdinalIgnoreCase))
            return Ok(new { configured = false, status = "not_configured", visitUrl = (string?)null });

        var visitUrl = await WebsiteReachability.ResolveAsync(
            (string?)row.clientDomain, (string?)row.subdomain, _pleskParentDomain, _useHttps);
        return Ok(new { configured = true, status = "active", visitUrl });
    }

    // Subdomain / ClientDomain validation lives in WebsiteDomainHelper (shared with
    // ClubWebsitesController) so a pasted URL is normalized to a clean host before storage —
    // see RotaryApi/Services/WebsiteDomainHelper.cs.

    private static async Task LogAction(MySqlConnection conn, int websiteId, string action, string? details, int userId, IDbTransaction? tx = null)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO district_website_logs (fk_district_website_id, Action, Details, PerformedBy)
            VALUES (@W, @A, @D, @U)",
            new { W = websiteId, A = action, D = details, U = userId }, tx);
    }

    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? status, [FromQuery] int? districtId, [FromQuery] string? search)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var sql = @"
            SELECT w.pk_id AS id, w.fk_district_id AS districtId,
                   d.DistrictNumber AS districtNumber,
                   w.Subdomain AS subdomain, w.ClientDomain AS clientDomain,
                   w.Status AS status, w.Notes AS notes,
                   w.created_date AS createdDate,
                   -- Phase 4 kill-switch: chainActive=1 only when district + zone are both active.
                   CASE WHEN d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0
                        THEN 1 ELSE 0 END AS chainActive
            FROM district_websites w
            JOIN district_master d ON d.pk_district_id = w.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE w.isdeleted = 0";
        var p = new DynamicParameters();
        if (!string.IsNullOrEmpty(status)) { sql += " AND w.Status = @Status"; p.Add("Status", status); }
        if (districtId.HasValue) { sql += " AND w.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        if (!string.IsNullOrEmpty(search))
        {
            sql += " AND (d.DistrictNumber LIKE @S OR w.Subdomain LIKE @S OR w.ClientDomain LIKE @S)";
            p.Add("S", $"%{search}%");
        }
        sql += " ORDER BY w.created_date DESC";

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
            FROM district_website_logs l
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.PerformedBy
            WHERE l.fk_district_website_id = @Id
            ORDER BY l.PerformedDate DESC",
            new { Id = id });
        return Ok(logs);
    }

    // Districts that DON'T already have an active website record — for the Add dropdown
    [HttpGet("available-districts")]
    public async Task<ActionResult> GetAvailableDistricts()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districts = await conn.QueryAsync<dynamic>(@"
            SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber
            FROM district_master d
            WHERE d.isdeleted = 0
              AND NOT EXISTS (
                SELECT 1 FROM district_websites w
                WHERE w.fk_district_id = d.pk_district_id AND w.isdeleted = 0
              )
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber");
        return Ok(districts);
    }

    public class CreateRequest
    {
        public int DistrictId { get; set; }
        public string Subdomain { get; set; } = "";
        public string? ClientDomain { get; set; }
        public string? Notes { get; set; }
    }

    [HttpPost]
    public async Task<ActionResult> Create([FromBody] CreateRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.DistrictId <= 0) return BadRequest(new { message = "districtId is required." });
        // Store the Subdomain / third-party Domain VERBATIM (product decision): ':' and '/' are
        // allowed and kept exactly as typed; we only check presence/length.
        var subdomain = (req.Subdomain ?? "").Trim().ToLowerInvariant();
        var subErr = WebsiteDomainHelper.ValidateSubdomain(subdomain);
        if (subErr != null) return BadRequest(new { message = subErr });
        var clientDomain = string.IsNullOrWhiteSpace(req.ClientDomain) ? null : req.ClientDomain.Trim().ToLowerInvariant();
        var cliErr = WebsiteDomainHelper.ValidateClientDomain(clientDomain);
        if (cliErr != null) return BadRequest(new { message = cliErr });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_websites WHERE Subdomain = @S AND isdeleted = 0",
            new { S = subdomain });
        if (exists > 0) return BadRequest(new { message = "Subdomain already in use in portal." });

        var districtHasActive = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_id AS id, Subdomain AS subdomain FROM district_websites
              WHERE fk_district_id = @D AND isdeleted = 0 LIMIT 1",
            new { D = req.DistrictId });
        if (districtHasActive != null)
            return BadRequest(new {
                message = $"This district already has an active website record ({districtHasActive.subdomain}). Delete it first before adding a new one."
            });

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_websites (fk_district_id, Subdomain, ClientDomain, Status, Notes, created_by)
            VALUES (@DistrictId, @Subdomain, @ClientDomain, 'Inactive', @Notes, @UserId);
            SELECT LAST_INSERT_ID();",
            new { req.DistrictId, Subdomain = subdomain, ClientDomain = clientDomain, req.Notes, UserId = userId });
        await LogAction(conn, id, "Created", $"District website record created for subdomain {subdomain}", userId);

        // Seed the 8 default protected menus (is_default=1). Same set as clubs so the UX matches.
        await SeedDefaultDistrictMenusAsync(conn, req.DistrictId, userId);

        return Ok(new { success = true, id });
    }

    // Canonical district default-menu list (sort_order = array index + 1). District menus
    // differ from club menus — two of them have sub-menus seeded alongside them:
    //   * "Club Projects" → 6 avenue sub-menus (same set as the club side)
    //   * "Newsletter"    → "District Newsletter" + "Club Newsletter"
    // Marked is_default=1 so edit/delete/toggle is blocked in admin UI.
    private static readonly (string Name, string LinkValue)[] DefaultDistrictMenus =
    {
        ("Home",                "home"),
        ("About",               "about"),
        ("District Committee",  "district-committee"),
        ("Club Finder",         "club-finder"),
        ("Club Projects",       "club-projects"),
        ("Club Service",        "club-service"),
    };

    // Sub-menus seeded under the "Club Projects" parent — one per avenue, same keys as
    // ClubWebsitesController.ProjectsSubMenus so the public site can resolve them
    // identically (/projects?avenue={key}).
    private static readonly (string Name, string AvenueKey)[] DistrictClubProjectsSubMenus =
    {
        ("Community Service",       "community_service"),
        ("Club Service",            "club_service"),
        ("Vocational Service",      "vocational_service"),
        ("New Generation Service",  "new_generation_service"),
        ("International Service",   "international_service"),
        ("Public Image Initiative", "public_image_initiative"),
    };

    // Sub-menus seeded under the "Newsletter" parent.
    private static readonly (string Name, string LinkValue)[] DistrictNewsletterSubMenus =
    {
        ("District Newsletter", "district-newsletter"),
        ("Club Newsletter",     "club-newsletter"),
    };

    private static async Task SeedDefaultDistrictMenusAsync(MySqlConnection conn, int districtId, int userId)
    {
        for (int i = 0; i < DefaultDistrictMenus.Length; i++)
        {
            var (name, linkValue) = DefaultDistrictMenus[i];
            // Idempotent: if a same-named menu already exists for this district, just ensure
            // it's flagged is_default=1 + has the canonical link_value + correct sort_order,
            // then handle sub-menus. Skip the INSERT.
            var existingId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT pk_club_website_menu_id FROM club_website_menu
                WHERE fk_district_id = @DistrictId AND fk_club_id = 0
                  AND menu_name = @Name AND isdeleted = 0
                LIMIT 1",
                new { DistrictId = districtId, Name = name });

            int menuId;
            if (existingId.HasValue)
            {
                await conn.ExecuteAsync(@"
                    UPDATE club_website_menu
                    SET is_default = 1, link_type = 'page', link_value = @LinkValue, sort_order = @Sort
                    WHERE pk_club_website_menu_id = @Id",
                    new { Id = existingId.Value, LinkValue = linkValue, Sort = i + 1 });
                menuId = existingId.Value;
            }
            else
            {
                menuId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO club_website_menu
                        (fk_club_id, fk_district_id, menu_name, link_type, link_value, sort_order, is_active, is_default, created_by, created_date, isdeleted)
                    VALUES (0, @DistrictId, @Name, 'page', @LinkValue, @Sort, 1, 1, @UserId, NOW(), 0);
                    SELECT LAST_INSERT_ID();",
                    new { DistrictId = districtId, Name = name, LinkValue = linkValue, Sort = i + 1, UserId = userId });
            }

            // Sub-menu seeding for menus that need them. Each insertion is idempotent via
            // a name+menu existence check, so re-seeding is safe.
            if (linkValue == "club-projects")
                await SeedDistrictSubMenusAsync(conn, menuId, DistrictClubProjectsSubMenus.Select(s => (s.Name, s.AvenueKey)).ToArray(), userId, isSystemManaged: true);
            else if (linkValue == "newsletter")
                await SeedDistrictSubMenusAsync(conn, menuId, DistrictNewsletterSubMenus.Select(s => (s.Name, s.LinkValue)).ToArray(), userId, isSystemManaged: true);
        }
    }

    private static async Task SeedDistrictSubMenusAsync(
        MySqlConnection conn, int parentMenuId, (string Name, string LinkValue)[] subMenus, int userId, bool isSystemManaged)
    {
        for (int i = 0; i < subMenus.Length; i++)
        {
            var (name, linkValue) = subMenus[i];
            // Keyed on the stable link_value (not name) and counting regardless of isdeleted, so
            // an admin's rename doesn't duplicate the row and a delete isn't resurrected on re-seed.
            var existing = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_website_submenu
                WHERE fk_menu_id = @MenuId AND link_value = @LinkValue",
                new { MenuId = parentMenuId, LinkValue = linkValue });
            if (existing > 0) continue;
            await conn.ExecuteAsync(@"
                INSERT INTO club_website_submenu
                    (fk_menu_id, submenu_name, link_type, link_value, sort_order,
                     is_active, is_system_managed, created_by, isdeleted)
                VALUES (@MenuId, @Name, 'page', @LinkValue, @Sort, 1, @IsSysMan, @UserId, 0)",
                new { MenuId = parentMenuId, Name = name, LinkValue = linkValue, Sort = i + 1,
                      IsSysMan = isSystemManaged ? 1 : 0, UserId = userId });
        }
    }

    public class UpdateRequest
    {
        public string Subdomain { get; set; } = "";
        public string? ClientDomain { get; set; }
        public string? Notes { get; set; }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        // Store the Subdomain / third-party Domain VERBATIM (product decision): ':' and '/' are
        // allowed and kept exactly as typed; we only check presence/length.
        var subdomain = (req.Subdomain ?? "").Trim().ToLowerInvariant();
        var subErr = WebsiteDomainHelper.ValidateSubdomain(subdomain);
        if (subErr != null) return BadRequest(new { message = subErr });
        var clientDomain = string.IsNullOrWhiteSpace(req.ClientDomain) ? null : req.ClientDomain.Trim().ToLowerInvariant();
        var cliErr = WebsiteDomainHelper.ValidateClientDomain(clientDomain);
        if (cliErr != null) return BadRequest(new { message = cliErr });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        // Load current row to enforce the "subdomain frozen after activation" rule and to
        // preserve the stored subdomain on activated rows (Plesk has a vhost tied to it).
        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT Status AS status, Subdomain AS subdomain FROM district_websites WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (existing == null) return NotFound(new { message = "Record not found." });
        var isActivated = !string.Equals((string)existing.status, "Inactive", StringComparison.OrdinalIgnoreCase);
        // Compare NORMALIZED labels so a no-op edit on a legacy row whose subdomain was stored as a
        // full URL (e.g. "https://rcfoo/") is NOT mistaken for a rename — only a genuine label change
        // is blocked. Editing the third-party domain / notes on an activated district stays allowed.
        // Compare LABEL-to-LABEL — normalize BOTH sides (form submits a full FQDN; stored may be a
        // FQDN or legacy URL). Only a genuine label change is a rename.
        var existingSubLabel = WebsiteDomainHelper.NormalizeSubdomain((string?)existing.subdomain);
        if (isActivated && !string.Equals(existingSubLabel, WebsiteDomainHelper.NormalizeSubdomain(subdomain), StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new {
                message = $"Subdomain cannot be changed once the website has been activated (current status: {existing.status}). " +
                          "To rename: Deactivate → Delete → Add new record with a different subdomain."
            });
        }
        // Activated rows keep their stored subdomain verbatim; Inactive rows take the normalized value.
        var subdomainToStore = isActivated ? (string)existing.subdomain : subdomain;

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_websites WHERE Subdomain = @S AND pk_id <> @Id AND isdeleted = 0",
            new { S = subdomainToStore, Id = id });
        if (exists > 0) return BadRequest(new { message = "Subdomain already used by another record." });

        var updated = await conn.ExecuteAsync(@"
            UPDATE district_websites SET Subdomain = @Subdomain, ClientDomain = @ClientDomain,
                Notes = @Notes, modified_by = @UserId
            WHERE pk_id = @Id AND isdeleted = 0",
            new { Subdomain = subdomainToStore, ClientDomain = clientDomain, req.Notes, UserId = userId, Id = id });
        if (updated == 0) return NotFound(new { message = "Record not found." });
        await LogAction(conn, id, "Updated", "Website details updated", userId);
        return Ok(new { success = true });
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
            FROM district_websites WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (website == null) return NotFound(new { message = "Record not found." });

        string? pleskResult = null;
        if (!skipPlesk && _plesk.IsConfigured)
        {
            var label = WebsiteDomainHelper.NormalizeSubdomain((string)website.subdomain);
            var fullSub = $"{label}.{_pleskParentDomain.ToLowerInvariant()}";
            try
            {
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
                pleskResult = "Not in Plesk — nothing to delete";
                await LogAction(conn, id, "PleskSubdomainAlreadyGone", ex.Message, userId);
            }
            catch (Exception ex)
            {
                await LogAction(conn, id, "PleskSubdomainDeleteFailed", ex.Message, userId);
                return BadRequest(new {
                    message = $"Plesk delete failed — portal record preserved. Click Delete again to retry, or use 'Force Clean Subdomain' from Plesk Tools. Error: {ex.Message}",
                    pleskFailed = true
                });
            }
        }
        else if (skipPlesk)
        {
            await LogAction(conn, id, "PleskDeleteSkippedManual", "Admin chose DB-only delete", userId);
        }

        await conn.ExecuteAsync(@"
            UPDATE district_websites
            SET isdeleted = 1,
                Subdomain = CONCAT(Subdomain, '__del_', UNIX_TIMESTAMP(), '_', pk_id),
                modified_by = @U
            WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id, U = userId });
        await LogAction(conn, id, "Deleted", "Record soft-deleted (subdomain freed for re-use)", userId);
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

    [HttpPost("{id}/retry-ssl")]
    public async Task<ActionResult> RetrySsl(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk not configured." });
        if (string.IsNullOrWhiteSpace(_plesk.WildcardCertName))
            return BadRequest(new { message = "WildcardCertName is not configured in appsettings." });

        using var conn = CreateConnection();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT Subdomain AS subdomain, Status AS status FROM district_websites WHERE pk_id = @Id AND isdeleted = 0",
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

    public class ForcePleskDeleteRequest { public string Label { get; set; } = ""; }

    [HttpPost("plesk/force-delete-subdomain")]
    public async Task<ActionResult> ForceDeletePleskSubdomain([FromBody] ForcePleskDeleteRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Label)) return BadRequest(new { message = "label required" });
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk not configured." });
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
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk is not configured." });
        try { await _plesk.TestConnectionAsync(); return Ok(new { success = true, message = "Plesk connection OK." }); }
        catch (Exception ex) { return BadRequest(new { message = $"Plesk test failed: {ex.Message}" }); }
    }

    [HttpGet("plesk/list-subdomains")]
    public async Task<ActionResult> ListPleskSubdomains()
    {
        if (!IsSuperAdmin()) return Forbid();
        if (!_plesk.IsConfigured) return BadRequest(new { message = "Plesk not configured." });
        try
        {
            var list = await _plesk.ListAllSubdomainsAsync();
            return Ok(new { count = list.Count, subdomains = list.Select(x => new { name = x.Name, id = x.Id }) });
        }
        catch (Exception ex) { return BadRequest(new { message = $"List failed: {ex.Message}" }); }
    }

    private async Task<ActionResult> PerformActivationAsync(int id, bool skipPlesk, string logAction)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        var website = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT w.pk_id AS id, w.fk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                   w.Subdomain AS subdomain, w.ClientDomain AS clientDomain, w.Status AS status
            FROM district_websites w JOIN district_master d ON d.pk_district_id = w.fk_district_id
            WHERE w.pk_id = @Id AND w.isdeleted = 0",
            new { Id = id });
        if (website == null) return NotFound(new { message = "Record not found." });

        // Plesk subdomain LABEL — always reduce to the bare first label so a stored FQDN isn't given
        // the Plesk parent a second time (the doubled-domain bug). Storage stays verbatim.
        var label = WebsiteDomainHelper.NormalizeSubdomain((string)website.subdomain);
        var fullSub = $"{label}.{_pleskParentDomain.ToLowerInvariant()}";
        if (!skipPlesk && _plesk.IsConfigured && string.IsNullOrWhiteSpace(label))
            return BadRequest(new { message = "This website has no valid subdomain to provision. Edit the record, set a subdomain, then activate." });

        var pleskStepsDone = new List<string>();
        string? pleskError = null;

        if (!skipPlesk && _plesk.IsConfigured)
        {
            try
            {
                if (await _plesk.SubdomainExistsAsync(label))
                {
                    pleskStepsDone.Add($"Subdomain already existed ({label}.{_pleskParentDomain}) — reusing");
                    await LogAction(conn, id, "PleskSubdomainReused", $"{label}.{_pleskParentDomain} already existed", userId);
                    // Ensure docroot points at DistrictWebsite even if we're reusing a Plesk entry
                    if (!string.IsNullOrWhiteSpace(_districtDocroot))
                    {
                        try { await _plesk.SetSubdomainDocrootAsync(label, _districtDocroot); }
                        catch (Exception ex) { await LogAction(conn, id, "PleskDocrootRebindFailed", ex.Message, userId); }
                    }
                }
                else
                {
                    await _plesk.CreateSubdomainAsync(label, _districtDocroot);
                    pleskStepsDone.Add($"Subdomain created ({label}.{_pleskParentDomain})");
                    await LogAction(conn, id, "PleskSubdomainCreated", $"{label}.{_pleskParentDomain}", userId);
                }

                if (!string.IsNullOrWhiteSpace((string?)website.clientDomain))
                {
                    try
                    {
                        await _plesk.AddDomainAliasAsync(fullSub, (string)website.clientDomain);
                        pleskStepsDone.Add($"Alias added ({website.clientDomain})");
                        await LogAction(conn, id, "PleskAliasAdded", (string)website.clientDomain, userId);
                    }
                    catch (Exception ex)
                    {
                        await LogAction(conn, id, "PleskAliasFailed", ex.Message, userId);
                        pleskError = $"Alias failed: {ex.Message}";
                    }
                }

                if (!string.IsNullOrWhiteSpace(_plesk.WildcardCertName))
                {
                    try
                    {
                        await _plesk.AssignCertificateAsync(label, _plesk.WildcardCertName);
                        pleskStepsDone.Add($"Wildcard cert assigned ({_plesk.WildcardCertName})");
                        await LogAction(conn, id, "PleskCertAssigned", _plesk.WildcardCertName, userId);
                    }
                    catch (Exception ex)
                    {
                        await LogAction(conn, id, "PleskCertFailed", ex.Message, userId);
                    }
                }
                else
                {
                    await LogAction(conn, id, "PleskCertSkipped", "WildcardCertName not configured", userId);
                }
            }
            catch (Exception ex)
            {
                pleskError = ex.Message;
                await LogAction(conn, id, "PleskActivationFailed", ex.Message, userId);
                await conn.ExecuteAsync(
                    "UPDATE district_websites SET Status = 'ActivationFailed', modified_by = @U WHERE pk_id = @Id",
                    new { Id = id, U = userId });
                return BadRequest(new { message = $"Plesk activation failed: {ex.Message}", pleskStepsDone });
            }
        }
        else if (!skipPlesk && !_plesk.IsConfigured)
        {
            await LogAction(conn, id, "PleskSkippedNotConfigured", "Plesk not configured — skipped provisioning", userId);
        }
        else if (skipPlesk)
        {
            await LogAction(conn, id, "PleskSkippedManualOverride", "Admin chose manual activation", userId);
        }

        await conn.ExecuteAsync(
            "UPDATE district_websites SET Status = 'Active', modified_by = @U WHERE pk_id = @Id",
            new { Id = id, U = userId });
        await LogAction(conn, id, logAction, "Status set to Active", userId);

        return Ok(new { success = true, pleskStepsDone, pleskError, skipPlesk });
    }

    [HttpPost("{id}/deactivate")]
    public async Task<ActionResult> Deactivate(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        var updated = await conn.ExecuteAsync(
            "UPDATE district_websites SET Status = 'Inactive', modified_by = @U WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id, U = userId });
        if (updated == 0) return NotFound(new { message = "Record not found." });
        await LogAction(conn, id, "Deactivated", "Status changed to Inactive", userId);
        return Ok(new { success = true });
    }
}

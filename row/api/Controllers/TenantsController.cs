using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Tenant lifecycle and editions (ROW Wave 1, build spec items 1 and 5). SuperAdmin only, except the planning
/// state, which any signed-in user may read. Writes are also checked against member_roles by
/// ScopeWriteGuardMiddleware (role 3). Applying an edition only switches module rows on or off; it never deletes
/// them, so module data survives an edition change.
/// </summary>
[ApiController]
[Route("api")]
[Authorize]
public class TenantsController : ControllerBase
{
    private static readonly string[] States = { "planning", "live" };
    private static readonly string[] Regions = { "US", "EU", "APAC", "IN" };
    private readonly IAuditLogService _auditLog;
    private readonly string _connectionString;

    public TenantsController(IAuditLogService auditLog, IConfiguration configuration)
    {
        _auditLog = auditLog;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private bool IsSuperAdmin() => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");
    private int GetCurrentMemberId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private ObjectResult Forbidden() => StatusCode(403, new { message = "Only SuperAdmin can manage tenants and editions." });

    /// <summary>Build spec 3.5: sends the due renewal notices and overdue reminders now (the daily job does the same).</summary>
    [HttpPost("tenants/renewals/run")]
    public async Task<IActionResult> RunRenewals([FromServices] TenantRenewalService renewals)
    {
        if (!IsSuperAdmin()) return Forbidden();
        return Ok(new { done = await renewals.RunAsync() });
    }

    // ===== EDITIONS =====

    [HttpGet("editions")]
    public async Task<IActionResult> GetEditions()
    {
        if (!IsSuperAdmin()) return Forbidden();
        await using var conn = new MySqlConnection(_connectionString);
        var editions = (await conn.QueryAsync<EditionDto>("SELECT code AS Code, name AS Name FROM edition_catalogue ORDER BY code")).ToList();
        var keys = (await conn.QueryAsync<(string Code, string Key)>("SELECT edition_code, module_key FROM edition_modules")).ToList();
        foreach (var e in editions)
            e.ModuleKeys = keys.Where(k => k.Code == e.Code).Select(k => k.Key).OrderBy(k => k).ToList();
        return Ok(editions);
    }

    [HttpPut("editions/{code}")]
    public async Task<IActionResult> UpdateEdition(string code, [FromBody] UpdateEditionDto dto)
    {
        if (!IsSuperAdmin()) return Forbidden();
        var name = dto.Name?.Trim() ?? "";
        if (name.Length is 0 or > 100) return BadRequest(new { message = "Name is required (100 characters at most)." });
        var keys = (dto.ModuleKeys ?? new()).Select(k => k.Trim()).Distinct().ToList();

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM edition_catalogue WHERE code = @code", new { code }) == 0)
            return NotFound(new { message = "Edition not found." });
        if (keys.Count > 0)
        {
            var known = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM module_master WHERE isdeleted = 0 AND ModuleKey IN @keys", new { keys });
            if (known != keys.Count) return BadRequest(new { message = "Unknown module key." });
        }

        await using var tx = await conn.BeginTransactionAsync();
        await conn.ExecuteAsync("UPDATE edition_catalogue SET name = @name, modified_by = @by WHERE code = @code",
            new { name, by = GetCurrentMemberId(), code }, tx);
        await conn.ExecuteAsync("DELETE FROM edition_modules WHERE edition_code = @code", new { code }, tx);
        if (keys.Count > 0)
            await conn.ExecuteAsync("INSERT INTO edition_modules (edition_code, module_key) VALUES (@code, @key)",
                keys.Select(key => new { code, key }), tx);
        await tx.CommitAsync();

        await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "edition", null, code, new { name, moduleKeys = keys }, HttpContext);
        return Ok(new { code, name, moduleKeys = keys });
    }

    // ===== TENANTS (district subscriptions) =====

    private const string SubscriptionSelect = @"
        SELECT ts.fk_district_id AS DistrictId, d.DistrictNumber, ts.edition_code AS EditionCode,
               ts.member_band AS MemberBand, ts.term_start AS TermStart, ts.term_end AS TermEnd, ts.state AS State,
               ts.region AS Region, ts.bridge_start AS BridgeStart, ts.bridge_end AS BridgeEnd,
               ts.setup_fee_waived AS SetupFeeWaived, ts.platform_fee_pct AS PlatformFeePct,
               ts.platform_fee_fixed AS PlatformFeeFixed, ts.fee_waiver_until AS FeeWaiverUntil,
               ts.trial_ends AS TrialEnds, py.YearLabel AS PlanningYearLabel, ts.cutover_at AS CutoverAt,
               ts.cutover_done_at AS CutoverDoneAt, ts.anonymise_after_months AS AnonymiseAfterMonths,
               ts.auto_renew = 1 AS AutoRenew, ts.renewal_notice_for AS RenewalNoticeFor, ts.dunning_stage AS DunningStage
        FROM tenant_subscriptions ts
        LEFT JOIN district_master d ON d.pk_district_id = ts.fk_district_id
        LEFT JOIN rotary_year_master py ON py.pk_year_id = ts.planning_year_id
        WHERE ts.fk_club_id = 0";

    [HttpGet("tenants")]
    public async Task<IActionResult> GetTenants()
    {
        if (!IsSuperAdmin()) return Forbidden();
        await using var conn = new MySqlConnection(_connectionString);
        return Ok(await conn.QueryAsync<TenantSubscriptionDto>(SubscriptionSelect + " ORDER BY d.DistrictNumber"));
    }

    [HttpGet("tenants/{districtId:int}")]
    public async Task<IActionResult> GetTenant(int districtId)
    {
        if (!IsSuperAdmin()) return Forbidden();
        await using var conn = new MySqlConnection(_connectionString);
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_master WHERE pk_district_id = @districtId AND isdeleted = 0", new { districtId }) == 0)
            return NotFound(new { message = "District not found." });
        var sub = await conn.QueryFirstOrDefaultAsync<TenantSubscriptionDto>(SubscriptionSelect + " AND ts.fk_district_id = @districtId", new { districtId });
        var clubs = await conn.QueryAsync<TenantClubDto>(@"
            SELECT ts.fk_club_id AS ClubId, c.ClubName, ts.edition_code AS EditionCode
            FROM tenant_subscriptions ts
            JOIN club_master c ON c.pk_club_id = ts.fk_club_id AND c.isdeleted = 0
            WHERE ts.fk_district_id = @districtId AND ts.fk_club_id > 0
            ORDER BY c.ClubName", new { districtId });
        return Ok(new TenantDetailDto { Subscription = sub, Clubs = clubs.ToList() });
    }

    [HttpPut("tenants/{districtId:int}")]
    public async Task<IActionResult> SetTenant(int districtId, [FromBody] TenantSubscriptionDto dto)
    {
        if (!IsSuperAdmin()) return Forbidden();
        var error = Validate(dto);
        if (error != null) return BadRequest(new { message = error });

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_master WHERE pk_district_id = @districtId AND isdeleted = 0", new { districtId }) == 0)
            return NotFound(new { message = "District not found." });
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM edition_catalogue WHERE code = @EditionCode", new { dto.EditionCode }) == 0)
            return BadRequest(new { message = "Unknown edition." });

        var by = GetCurrentMemberId();
        await using var tx = await conn.BeginTransactionAsync();
        await conn.ExecuteAsync(@"
            INSERT INTO tenant_subscriptions
                (fk_district_id, fk_club_id, edition_code, member_band, term_start, term_end, state, region,
                 bridge_start, bridge_end, setup_fee_waived, platform_fee_pct, platform_fee_fixed, fee_waiver_until,
                 anonymise_after_months, auto_renew, created_by)
            VALUES (@districtId, 0, @EditionCode, @MemberBand, @TermStart, @TermEnd, @State, @Region,
                 @BridgeStart, @BridgeEnd, @SetupFeeWaived, @PlatformFeePct, @PlatformFeeFixed, @FeeWaiverUntil,
                 @AnonymiseAfterMonths, @AutoRenew, @by)
            ON DUPLICATE KEY UPDATE edition_code = VALUES(edition_code), member_band = VALUES(member_band),
                term_start = VALUES(term_start), term_end = VALUES(term_end), state = VALUES(state), region = VALUES(region),
                bridge_start = VALUES(bridge_start), bridge_end = VALUES(bridge_end),
                setup_fee_waived = VALUES(setup_fee_waived), platform_fee_pct = VALUES(platform_fee_pct),
                platform_fee_fixed = VALUES(platform_fee_fixed), fee_waiver_until = VALUES(fee_waiver_until),
                anonymise_after_months = VALUES(anonymise_after_months), auto_renew = VALUES(auto_renew), modified_by = @by",
            new { districtId, dto.EditionCode, dto.MemberBand, dto.TermStart, dto.TermEnd, dto.State, dto.Region,
                  dto.BridgeStart, dto.BridgeEnd, dto.SetupFeeWaived, dto.PlatformFeePct, dto.PlatformFeeFixed,
                  dto.FeeWaiverUntil, AnonymiseAfterMonths = dto.AnonymiseAfterMonths is > 0 ? dto.AnonymiseAfterMonths : null, AutoRenew = dto.AutoRenew ?? true, by }, tx);
        // A district subscription provisions every club: club_basic, or rotaract for Rotaract clubs. INSERT IGNORE
        // keeps a club that already has its own edition.
        var provisioned = await conn.ExecuteAsync(@"
            INSERT IGNORE INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code, created_by)
            SELECT @districtId, c.pk_club_id,
                   IF(COALESCE(c.ClubType, '') = 'Rotaract Club', 'rotaract', 'club_basic'), @by
            FROM club_master c
            WHERE c.fk_district_id = @districtId AND c.isdeleted = 0", new { districtId, by }, tx);
        await tx.CommitAsync();

        await _auditLog.LogAsync(by, "UPDATE", "tenant_subscription", districtId, dto.EditionCode,
            new { dto.EditionCode, dto.State, dto.Region, dto.MemberBand, dto.TermStart, dto.TermEnd, clubsProvisioned = provisioned }, HttpContext);
        return Ok(new { districtId, clubsProvisioned = provisioned });
    }

    [HttpPost("tenants/{districtId:int}/apply-edition")]
    public async Task<IActionResult> ApplyEdition(int districtId)
    {
        if (!IsSuperAdmin()) return Forbidden();
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var edition = await conn.ExecuteScalarAsync<string?>(
            "SELECT edition_code FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId });
        if (edition == null) return NotFound(new { message = "This district has no subscription yet." });

        var by = GetCurrentMemberId();
        var p = new { districtId, edition, by };
        await using var tx = await conn.BeginTransactionAsync();
        // On: the edition's modules (row added if missing). Off: every other module row. No row is deleted.
        var districtOn = await conn.ExecuteAsync(@"
            INSERT INTO district_modules (fk_district_id, fk_module_id, IsEnabled, AssignedBy)
            SELECT @districtId, m.pk_module_id, 1, @by
            FROM edition_modules em JOIN module_master m ON m.ModuleKey = em.module_key AND m.isdeleted = 0
            WHERE em.edition_code = @edition
            ON DUPLICATE KEY UPDATE IsEnabled = 1", p, tx);
        var districtOff = await conn.ExecuteAsync(@"
            UPDATE district_modules dm JOIN module_master m ON m.pk_module_id = dm.fk_module_id
            SET dm.IsEnabled = 0
            WHERE dm.fk_district_id = @districtId AND dm.IsEnabled = 1
              AND NOT EXISTS (SELECT 1 FROM edition_modules em WHERE em.edition_code = @edition AND em.module_key = m.ModuleKey)", p, tx);
        var clubOn = await conn.ExecuteAsync(@"
            INSERT INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
            SELECT ts.fk_club_id, m.pk_module_id, 1, @by
            FROM tenant_subscriptions ts
            JOIN club_master c ON c.pk_club_id = ts.fk_club_id AND c.isdeleted = 0 AND c.fk_district_id = @districtId
            JOIN edition_modules em ON em.edition_code = ts.edition_code
            JOIN module_master m ON m.ModuleKey = em.module_key AND m.isdeleted = 0
            WHERE ts.fk_district_id = @districtId AND ts.fk_club_id > 0
            ON DUPLICATE KEY UPDATE IsEnabled = 1", p, tx);
        var clubOff = await conn.ExecuteAsync(@"
            UPDATE club_modules cm
            JOIN tenant_subscriptions ts ON ts.fk_club_id = cm.fk_club_id AND ts.fk_district_id = @districtId
            JOIN module_master m ON m.pk_module_id = cm.fk_module_id
            SET cm.IsEnabled = 0
            WHERE cm.IsEnabled = 1
              AND NOT EXISTS (SELECT 1 FROM edition_modules em WHERE em.edition_code = ts.edition_code AND em.module_key = m.ModuleKey)", p, tx);
        await tx.CommitAsync();

        await _auditLog.LogAsync(by, "APPLY", "tenant_subscription", districtId, edition,
            new { districtOn, districtOff, clubOn, clubOff }, HttpContext);
        return Ok(new { districtId, edition, districtOn, districtOff, clubOn, clubOff });
    }

    /// <summary>Starts a 60-day trial (N7, flag planning_mode). A trial tenant is an ordinary tenant with an end
    /// date, so converting it later keeps every record.</summary>
    // shortcut: an expired trial only shows in Settings > Tenants (no lock-out), decide the expiry rule with payments.
    [HttpPost("tenants/{districtId:int}/trial")]
    public async Task<IActionResult> StartTrial(int districtId)
    {
        if (!IsSuperAdmin()) return Forbidden();
        await using var conn = new MySqlConnection(_connectionString);
        var n = await conn.ExecuteAsync(@"
            UPDATE tenant_subscriptions SET trial_ends = CURDATE() + INTERVAL 60 DAY, modified_by = @by
            WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId, by = GetCurrentMemberId() });
        if (n == 0) return NotFound(new { message = "This district has no subscription yet." });
        var trialEnds = await conn.ExecuteScalarAsync<DateTime>(
            "SELECT trial_ends FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId });
        await _auditLog.LogAsync(GetCurrentMemberId(), "TRIAL", "tenant_subscription", districtId, null, new { trialEnds }, HttpContext);
        TrialLock.Forget(); // an extended trial lets its members back in at once
        return Ok(new { districtId, trialEnds });
    }

    /// <summary>Converts a trial to paid: clears the end date and touches nothing else. The payment itself is
    /// taken outside ROW until payments are built (a SuperAdmin records the conversion here).</summary>
    [HttpPost("tenants/{districtId:int}/convert-trial")]
    public async Task<IActionResult> ConvertTrial(int districtId)
    {
        if (!IsSuperAdmin()) return Forbidden();
        await using var conn = new MySqlConnection(_connectionString);
        var n = await conn.ExecuteAsync(@"
            UPDATE tenant_subscriptions SET trial_ends = NULL, modified_by = @by
            WHERE fk_district_id = @districtId AND fk_club_id = 0 AND trial_ends IS NOT NULL", new { districtId, by = GetCurrentMemberId() });
        if (n == 0) return Conflict(new { message = "This district is not on a trial." });
        await _auditLog.LogAsync(GetCurrentMemberId(), "CONVERT", "tenant_subscription", districtId, null, new { converted = true }, HttpContext);
        TrialLock.Forget();
        return Ok(new { districtId, trialEnds = (DateTime?)null });
    }

    /// <summary>Planning state of a district (any signed-in user). No subscription means live.</summary>
    [HttpGet("tenants/{districtId:int}/state")]
    public async Task<IActionResult> GetState(int districtId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var state = await conn.ExecuteScalarAsync<string?>(
            "SELECT state FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId });
        return Ok(new { districtId, state = state ?? "live" });
    }

    private static string? Validate(TenantSubscriptionDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.EditionCode)) return "Edition is required.";
        if (!States.Contains(dto.State)) return "State must be planning or live.";
        if (dto.Region != null && !Regions.Contains(dto.Region)) return "Region must be US, EU, APAC or IN.";
        if (dto.MemberBand?.Length > 20) return "Member band is 20 characters at most.";
        if (dto.TermStart > dto.TermEnd) return "The term must end after it starts.";
        if (dto.BridgeStart > dto.BridgeEnd) return "The bridge period must end after it starts.";
        if (dto.PlatformFeePct is < 0 or > 100) return "Platform fee must be between 0 and 100 percent.";
        if (dto.PlatformFeeFixed is < 0 or > 99999999) return "Fixed platform fee is out of range.";
        if (dto.AnonymiseAfterMonths is < 0 or > 240) return "Anonymise after must be 0 to 240 months.";
        return null;
    }
}

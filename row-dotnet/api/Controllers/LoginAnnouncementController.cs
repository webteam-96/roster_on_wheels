using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/login-announcements")]
[Authorize]
public class LoginAnnouncementController : ControllerBase
{
    private readonly string _connectionString;

    public LoginAnnouncementController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    // ── SuperAdmin: Get all announcements ──
    [HttpGet]
    public async Task<ActionResult> GetAll()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_announcement_id AS id, content, is_active AS isActive,
                   created_date AS createdDate, modified_date AS modifiedDate,
                   target_roles AS targetRoles, target_filters AS targetFilters, target_locations AS targetLocations
            FROM login_announcements WHERE isdeleted = 0
            ORDER BY pk_announcement_id DESC");
        var result = new List<object>();
        foreach (var x in rows)
        {
            result.Add(new
            {
                id = x.id, content = x.content, isActive = x.isActive,
                createdDate = x.createdDate, modifiedDate = x.modifiedDate,
                targetRoles = LoginAnnouncementAudience.Parse((string?)x.targetRoles),
                targetFilters = LoginAnnouncementAudience.ParseFilters((string?)x.targetFilters),
                targetLocations = await LoginAnnouncementAudience.DescribeLocationsAsync(
                    conn, LoginAnnouncementAudience.ParseLocations((string?)x.targetLocations)),
            });
        }
        return Ok(result);
    }

    // ── SuperAdmin: Get by ID ──
    [HttpGet("{id}")]
    public async Task<ActionResult> GetById(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var item = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_announcement_id AS id, content, is_active AS isActive,
                   target_roles AS targetRoles, target_filters AS targetFilters, target_locations AS targetLocations
            FROM login_announcements WHERE pk_announcement_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (item == null) return NotFound(new { message = "Not found." });
        return Ok(new
        {
            id = item.id, content = item.content, isActive = item.isActive,
            targetRoles = LoginAnnouncementAudience.Parse((string?)item.targetRoles),
            targetFilters = LoginAnnouncementAudience.ParseFilters((string?)item.targetFilters),
            targetLocations = await LoginAnnouncementAudience.DescribeLocationsAsync(
                conn, LoginAnnouncementAudience.ParseLocations((string?)item.targetLocations)),
        });
    }

    // ── SuperAdmin: Create ──
    [HttpPost]
    public async Task<ActionResult> Create([FromBody] LoginAnnouncementDto dto)
    {
        if (!IsSuperAdmin()) return Forbid();
        // Older clients that don't send TargetRoles keep the previous behaviour (everyone = ALL).
        string? targetRoles = null;
        if (dto.TargetRoles != null)
        {
            var (stored, error) = LoginAnnouncementAudience.Normalize(dto.TargetRoles);
            if (error != null) return BadRequest(new { message = error });
            targetRoles = stored;
        }
        var (targetFilters, filterError) = LoginAnnouncementAudience.NormalizeFilters(dto.TargetFilters);
        if (filterError != null) return BadRequest(new { message = filterError });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var (targetLocations, locationError) = await LoginAnnouncementAudience.NormalizeLocationsAsync(conn, dto.TargetLocations);
        if (locationError != null) return BadRequest(new { message = locationError });

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO login_announcements (content, is_active, target_roles, target_filters, target_locations, created_by, created_date, isdeleted)
            VALUES (@Content, @IsActive, @TargetRoles, @TargetFilters, @TargetLocations, @UserId, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new
            {
                dto.Content, IsActive = dto.IsActive ? 1 : 0, TargetRoles = targetRoles,
                TargetFilters = targetFilters, TargetLocations = targetLocations, UserId = GetUserId(),
            });
        return Ok(new { id, message = "Announcement created." });
    }

    // ── SuperAdmin: Update (clears all reads so everyone sees updated content) ──
    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] LoginAnnouncementDto dto)
    {
        if (!IsSuperAdmin()) return Forbid();
        string? targetRoles = null;
        if (dto.TargetRoles != null)
        {
            var (stored, error) = LoginAnnouncementAudience.Normalize(dto.TargetRoles);
            if (error != null) return BadRequest(new { message = error });
            targetRoles = stored;
        }
        string? targetFilters = null;
        if (dto.TargetFilters != null)
        {
            var (stored, error) = LoginAnnouncementAudience.NormalizeFilters(dto.TargetFilters);
            if (error != null) return BadRequest(new { message = error });
            targetFilters = stored;
        }

        using var conn = CreateConnection();
        await conn.OpenAsync();
        string? targetLocations = null;
        if (dto.TargetLocations != null)
        {
            var (stored, error) = await LoginAnnouncementAudience.NormalizeLocationsAsync(conn, dto.TargetLocations);
            if (error != null) return BadRequest(new { message = error });
            targetLocations = stored;
        }

        // TargetRoles / TargetFilters / TargetLocations omitted (older client) → leave that part unchanged.
        await conn.ExecuteAsync($@"
            UPDATE login_announcements SET content = @Content, is_active = @IsActive,
                   {(dto.TargetRoles != null ? "target_roles = @TargetRoles," : "")}
                   {(dto.TargetFilters != null ? "target_filters = @TargetFilters," : "")}
                   {(dto.TargetLocations != null ? "target_locations = @TargetLocations," : "")}
                   modified_by = @UserId, modified_date = NOW()
            WHERE pk_announcement_id = @Id AND isdeleted = 0",
            new
            {
                dto.Content, IsActive = dto.IsActive ? 1 : 0, TargetRoles = targetRoles, TargetFilters = targetFilters,
                TargetLocations = targetLocations, UserId = GetUserId(), Id = id,
            });
        // Clear reads so all users see updated content
        await conn.ExecuteAsync(
            "DELETE FROM login_announcement_reads WHERE fk_announcement_id = @Id",
            new { Id = id });
        return Ok(new { message = "Announcement updated. All users will see the popup again." });
    }

    // ── SuperAdmin: Toggle active/inactive ──
    // When reactivating, clear all reads so everyone sees popup again
    [HttpPut("{id}/toggle")]
    public async Task<ActionResult> Toggle(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var current = await conn.ExecuteScalarAsync<bool>(
            "SELECT is_active FROM login_announcements WHERE pk_announcement_id = @Id AND isdeleted = 0",
            new { Id = id });

        await conn.ExecuteAsync(@"
            UPDATE login_announcements SET is_active = IF(is_active = 1, 0, 1),
                   modified_by = @UserId, modified_date = NOW()
            WHERE pk_announcement_id = @Id AND isdeleted = 0",
            new { UserId = GetUserId(), Id = id });

        // If was inactive (current=0) and now activating → clear all reads
        if (!current)
        {
            await conn.ExecuteAsync(
                "DELETE FROM login_announcement_reads WHERE fk_announcement_id = @Id",
                new { Id = id });
        }

        return Ok(new { message = current ? "Deactivated." : "Activated. All users will see this popup again." });
    }

    // ── SuperAdmin: Delete ──
    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE login_announcements SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
            WHERE pk_announcement_id = @Id",
            new { UserId = GetUserId(), Id = id });
        return Ok(new { message = "Announcement deleted." });
    }

    // ── Any user: every active, un-acknowledged announcement for their roles + filters + location ──
    // currentRole = role key of the dashboard the user landed on; its announcements are listed first.
    [HttpGet("active")]
    public async Task<ActionResult> GetActive([FromQuery] string? currentRole)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return Ok(await LoginAnnouncementAudience.BuildActivePayloadAsync(conn, GetUserId(), includeSuperAdmin: true, currentRole));
    }

    // ── Any user: Acknowledge several (popup OK — none of them show again) ──
    [HttpPost("acknowledge")]
    public async Task<ActionResult> AcknowledgeMany([FromBody] AcknowledgeLoginAnnouncementsDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await LoginAnnouncementAudience.AcknowledgeAsync(conn, GetUserId(), dto.Ids ?? new List<int>());
        return Ok(new { message = "Acknowledged." });
    }

    // ── Any user: Acknowledge (clicked OK — won't show again) ──
    [HttpPost("{id}/acknowledge")]
    public async Task<ActionResult> Acknowledge(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await LoginAnnouncementAudience.AcknowledgeAsync(conn, GetUserId(), new[] { id });
        return Ok(new { message = "Acknowledged." });
    }
}

/// <summary>
/// Mobile API endpoints for login announcement popup
/// </summary>
[ApiController]
[Route("api/mobile/login-announcement")]
[Authorize]
public class MobileLoginAnnouncementController : ControllerBase
{
    private readonly string _connectionString;

    public MobileLoginAnnouncementController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    // Family Login sessions carry a familyMemberId claim — they never see login announcements.
    private bool IsFamilySession() => User.FindFirst("familyMemberId") != null;

    // ── Get active announcements (role / filter / location targeted, un-acknowledged) ──
    // Response keeps show/id/content (= first item) for the current app; items[] drives ◀ ▶ navigation.
    [HttpGet("active")]
    public async Task<ActionResult> GetActive([FromQuery] string? currentRole)
    {
        if (IsFamilySession()) return Ok(new { show = false, items = Array.Empty<object>() });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return Ok(await LoginAnnouncementAudience.BuildActivePayloadAsync(conn, GetUserId(), includeSuperAdmin: false, currentRole));
    }

    // ── Acknowledge several (OK on the ◀ ▶ popup) ──
    [HttpPost("acknowledge")]
    public async Task<ActionResult> AcknowledgeMany([FromBody] AcknowledgeLoginAnnouncementsDto dto)
    {
        if (IsFamilySession()) return Ok(new { message = "Acknowledged." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await LoginAnnouncementAudience.AcknowledgeAsync(conn, GetUserId(), dto.Ids ?? new List<int>());
        return Ok(new { message = "Acknowledged." });
    }

    // ── Acknowledge (clicked OK — won't show again) ──
    [HttpPost("{id}/acknowledge")]
    public async Task<ActionResult> Acknowledge(int id)
    {
        if (IsFamilySession()) return Ok(new { message = "Acknowledged." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await LoginAnnouncementAudience.AcknowledgeAsync(conn, GetUserId(), new[] { id });
        return Ok(new { message = "Acknowledged." });
    }
}

public class LoginAnnouncementDto
{
    public string Content { get; set; } = "";
    public bool IsActive { get; set; } = true;
    // Role keys (see LoginAnnouncementAudience.RoleKeys) or ["ALL"]. Null = not sent by an older client.
    public List<string>? TargetRoles { get; set; }
    // Purchase filters {filterKey: value} (see LoginAnnouncementAudience.FilterDefs). Null = not sent.
    public Dictionary<string, string>? TargetFilters { get; set; }
    // Zone / district / club selection. Null = not sent; all-empty lists = no location filter.
    public LoginAnnouncementAudience.TargetLocations? TargetLocations { get; set; }
}

public class AcknowledgeLoginAnnouncementsDto
{
    public List<int>? Ids { get; set; }
}

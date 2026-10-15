using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

/// <summary>
/// Public endpoint Flutter mobile app calls on launch (before login) to check whether
/// a force/optional update is required. Plus SuperAdmin CRUD for managing the active version.
/// Single version row applies to both iOS + Android (per business rule).
/// </summary>
[ApiController]
public class MobileVersionController : ControllerBase
{
    private readonly string _connectionString;

    public MobileVersionController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // ─── Public — Flutter app calls this ───
    [HttpGet("api/mobile/version-check")]
    [AllowAnonymous]
    public async Task<ActionResult> VersionCheck([FromQuery] string currentVersion)
    {
        if (string.IsNullOrWhiteSpace(currentVersion))
            return BadRequest(new { message = "currentVersion required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var active = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id, Version AS version, Message AS message,
                   PlayStoreUrl AS playStoreUrl, AppStoreUrl AS appStoreUrl, Url AS url,
                   IsForceUpdate AS isForceUpdate
            FROM mobile_app_versions
            WHERE IsActive = 1 AND isdeleted = 0
            ORDER BY pk_id DESC LIMIT 1");

        if (active == null)
        {
            return Ok(new
            {
                isForceUpdate = false,
                isUpdateAvailable = false,
                currentVersion,
                requiredVersion = (string?)null,
                message = (string?)null,
                playStoreUrl = (string?)null,
                appStoreUrl = (string?)null,
                url = (string?)null,
            });
        }

        var requiredVersion = (string)active.version;
        var compare = CompareVersions(currentVersion, requiredVersion);
        var isUpdateAvailable = compare < 0; // current < required
        var isForceUpdate = isUpdateAvailable && Convert.ToInt32(active.isForceUpdate) == 1;

        return Ok(new
        {
            isForceUpdate,
            isUpdateAvailable,
            currentVersion,
            requiredVersion,
            message = (string?)active.message,
            playStoreUrl = (string?)active.playStoreUrl,
            appStoreUrl = (string?)active.appStoreUrl,
            url = (string?)active.url,
        });
    }

    /// <summary>Compares semver-style version strings ("1.2.3" vs "1.4.0"). Returns -1, 0, +1.</summary>
    private static int CompareVersions(string a, string b)
    {
        var aParts = (a ?? "0").Split('.', StringSplitOptions.RemoveEmptyEntries);
        var bParts = (b ?? "0").Split('.', StringSplitOptions.RemoveEmptyEntries);
        var len = Math.Max(aParts.Length, bParts.Length);
        for (int i = 0; i < len; i++)
        {
            int ai = i < aParts.Length && int.TryParse(aParts[i], out var x) ? x : 0;
            int bi = i < bParts.Length && int.TryParse(bParts[i], out var y) ? y : 0;
            if (ai != bi) return ai.CompareTo(bi);
        }
        return 0;
    }

    // ─── SuperAdmin CRUD ───

    [HttpGet("api/admin/mobile-versions")]
    [Authorize]
    public async Task<ActionResult> List()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, Version AS version, Message AS message,
                   PlayStoreUrl AS playStoreUrl, AppStoreUrl AS appStoreUrl, Url AS url,
                   IsForceUpdate AS isForceUpdate, IsActive AS isActive,
                   created_date AS createdDate, modified_date AS modifiedDate
            FROM mobile_app_versions
            WHERE isdeleted = 0
            ORDER BY pk_id DESC");
        return Ok(rows);
    }

    /// <summary>
    /// Add a new version. Newly added row is automatically marked Active and all previously
    /// active rows are auto-deactivated. To "edit" or "fix" a version, the SuperAdmin simply
    /// adds a new row — there is no update/edit/delete/activate flow exposed in the UI.
    /// </summary>
    [HttpPost("api/admin/mobile-versions")]
    [Authorize]
    public async Task<ActionResult> Create([FromBody] VersionRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Version)) return BadRequest(new { message = "Version required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            // 1) Deactivate every existing row
            await conn.ExecuteAsync(
                "UPDATE mobile_app_versions SET IsActive = 0 WHERE isdeleted = 0",
                null, tx);

            // 2) Insert new row as the single active version
            var id = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO mobile_app_versions
                    (Version, Message, PlayStoreUrl, AppStoreUrl, Url, IsForceUpdate, IsActive, created_by, created_date)
                VALUES (@Version, @Message, @PlayStoreUrl, @AppStoreUrl,
                        IFNULL(NULLIF(@Url, ''), ''),
                        @IsForceUpdate, 1, @U, NOW());
                SELECT LAST_INSERT_ID();",
                new { req.Version, req.Message, req.PlayStoreUrl, req.AppStoreUrl, req.Url,
                      IsForceUpdate = req.IsForceUpdate ? 1 : 0, U = GetUserId() }, tx);

            await tx.CommitAsync();
            return Ok(new { id });
        }
        catch { await tx.RollbackAsync(); throw; }
    }

    [HttpPut("api/admin/mobile-versions/{id:int}")]
    [Authorize]
    public async Task<ActionResult> Update(int id, [FromBody] VersionRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.ExecuteAsync(@"
            UPDATE mobile_app_versions
            SET Version = @Version, Message = @Message,
                PlayStoreUrl = @PlayStoreUrl, AppStoreUrl = @AppStoreUrl, Url = @Url,
                IsForceUpdate = @IsForceUpdate, modified_by = @U, modified_date = NOW()
            WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id, req.Version, req.Message, req.PlayStoreUrl, req.AppStoreUrl, req.Url,
                  IsForceUpdate = req.IsForceUpdate ? 1 : 0, U = GetUserId() });
        if (rows == 0) return NotFound();
        return Ok(new { message = "Updated" });
    }

    /// <summary>Activate one version → automatically deactivates all others (only one active at a time).</summary>
    [HttpPost("api/admin/mobile-versions/{id:int}/activate")]
    [Authorize]
    public async Task<ActionResult> Activate(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            await conn.ExecuteAsync("UPDATE mobile_app_versions SET IsActive = 0 WHERE isdeleted = 0", null, tx);
            var rows = await conn.ExecuteAsync(
                "UPDATE mobile_app_versions SET IsActive = 1, modified_date = NOW() WHERE pk_id = @Id AND isdeleted = 0",
                new { Id = id }, tx);
            await tx.CommitAsync();
            return rows == 0 ? NotFound() : Ok(new { message = "Activated" });
        }
        catch { await tx.RollbackAsync(); throw; }
    }

    [HttpPost("api/admin/mobile-versions/{id:int}/deactivate")]
    [Authorize]
    public async Task<ActionResult> Deactivate(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.ExecuteAsync(
            "UPDATE mobile_app_versions SET IsActive = 0, modified_date = NOW() WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id });
        return rows == 0 ? NotFound() : Ok(new { message = "Deactivated" });
    }

    [HttpDelete("api/admin/mobile-versions/{id:int}")]
    [Authorize]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.ExecuteAsync(@"
            UPDATE mobile_app_versions
            SET isdeleted = 1, IsActive = 0, modified_date = NOW()
            WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id });
        return rows == 0 ? NotFound() : Ok(new { message = "Deleted" });
    }

    public class VersionRequest
    {
        public string Version { get; set; } = "";
        public string? Message { get; set; }
        public string? PlayStoreUrl { get; set; }
        public string? AppStoreUrl { get; set; }
        public string? Url { get; set; }
        public bool IsForceUpdate { get; set; } = true;
    }
}

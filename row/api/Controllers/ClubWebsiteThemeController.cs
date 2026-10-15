using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// Phase 7: per-club active theme. The public club-website Next.js app reads
// club_websites.fk_theme_id via the resolver in ClubWebsitePublicController,
// so this endpoint writes there directly. Distinct from the legacy
// club_website_theme per-year table (left in place but no longer used).

[ApiController]
[Authorize]
public class ClubWebsiteThemeController : ControllerBase
{
    private readonly string _connectionString;

    public ClubWebsiteThemeController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    public class ActiveThemeDto
    {
        public bool HasWebsite { get; set; }
        public int? ThemeId { get; set; }
        public string? ThemeName { get; set; }
        public string? ThemeImagePath { get; set; }
    }

    public class SetActiveThemeDto
    {
        public int ThemeId { get; set; }
    }

    [HttpGet("api/clubs/{clubId:int}/website/active-theme")]
    public async Task<ActionResult<ActiveThemeDto>> Get(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT w.fk_theme_id AS themeId,
                   t.theme_name AS themeName,
                   CASE
                       WHEN t.theme_image_path IS NULL OR t.theme_image_path = '' THEN NULL
                       WHEN t.theme_image_path LIKE '/%' THEN t.theme_image_path
                       ELSE CONCAT('/uploads/theme/', t.theme_image_path)
                   END AS themeImagePath
            FROM club_websites w
            LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
            WHERE w.fk_club_id = @ClubId AND w.isdeleted = 0
            ORDER BY w.created_date DESC
            LIMIT 1",
            new { ClubId = clubId });

        if (row == null)
            return Ok(new ActiveThemeDto { HasWebsite = false });

        return Ok(new ActiveThemeDto
        {
            HasWebsite     = true,
            ThemeId        = (int?)row.themeId,
            ThemeName      = (string?)row.themeName,
            ThemeImagePath = (string?)row.themeImagePath,
        });
    }

    [HttpPut("api/clubs/{clubId:int}/website/active-theme")]
    public async Task<ActionResult> Set(int clubId, [FromBody] SetActiveThemeDto dto)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });

        if (dto.ThemeId <= 0)
            return BadRequest(new { message = "ThemeId is required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Validate the theme exists + isn't soft-deleted.
        var themeOk = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM theme_master WHERE pk_theme_id = @Id AND (isdeleted = 0 OR isdeleted IS NULL)",
            new { Id = dto.ThemeId });
        if (themeOk == 0) return BadRequest(new { message = "Invalid theme." });

        // Require a club_websites row to exist before allowing a theme switch —
        // otherwise the switch has nothing to attach to and won't reflect publicly.
        var websiteId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_id FROM club_websites WHERE fk_club_id = @ClubId AND isdeleted = 0 ORDER BY created_date DESC LIMIT 1",
            new { ClubId = clubId });
        if (websiteId == null)
            return BadRequest(new { message = "This club does not have a website yet. Ask the SuperAdmin to create one from Settings → Club Websites." });

        var rows = await conn.ExecuteAsync(@"
            UPDATE club_websites
            SET fk_theme_id   = @ThemeId,
                modified_by   = @U,
                modified_date = NOW()
            WHERE pk_id = @WebsiteId AND isdeleted = 0",
            new { ThemeId = dto.ThemeId, U = GetUserId(), WebsiteId = websiteId });

        return Ok(new { message = "Theme updated successfully.", changed = rows });
    }
}

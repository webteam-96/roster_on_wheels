using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Rotary Foundation designations per member with the date each was reached (build spec 3.12): Paul Harris Fellow
/// and PHF+1 to +8, Major Donor levels 1 to 4, Bequest Society. Entered by SuperAdmin and by the admins of the
/// member's club or district until Rotary.org feeds them (source = 'manual'). Flag membership_fields (FeatureGate).
/// The member reads their own list with the same GET (the app's self-view).
/// </summary>
[ApiController]
[Authorize]
public class FoundationDesignationsController : ControllerBase
{
    // Allowed levels per type; null = the type has no level. PHF level 0 is the first fellowship.
    private static readonly Dictionary<string, (int Min, int Max)?> Levels = new()
    {
        ["PHF"] = (0, 8),
        ["MAJOR_DONOR"] = (1, 4),
        ["BEQUEST_SOCIETY"] = null,
    };

    private readonly string _connectionString;

    public FoundationDesignationsController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
    }

    public class AddRequest
    {
        public string? Type { get; set; }
        public int? Level { get; set; }
        public DateTime? AwardedDate { get; set; }
        public string? Notes { get; set; }
    }

    private class Row
    {
        public int Id { get; set; }
        public int MemberId { get; set; }
        public string? MemberName { get; set; }
        public string? ClubName { get; set; }
        public string Type { get; set; } = "";
        public int? Level { get; set; }
        public DateTime AwardedDate { get; set; }
        public string? Notes { get; set; }
        public string? Source { get; set; }
    }

    internal static string Label(string type, int? level) => type switch
    {
        "PHF" => level > 0 ? $"Paul Harris Fellow +{level}" : "Paul Harris Fellow",
        "MAJOR_DONOR" => $"Major Donor Level {level}",
        _ => "Bequest Society",
    };

    private int CallerId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private ObjectResult Denied() => StatusCode(403, new { message = "You do not manage this member." });

    /// <summary>SuperAdmin, or whoever manages a club the member is active in or that club's district (the
    /// ScopeWriteGuardMiddleware rules: club Admin, AG, district Admin).</summary>
    private async Task<bool> CanManageAsync(MySqlConnection conn, int memberId)
    {
        var caller = CallerId();
        if (caller <= 0) return false;
        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0",
                new { M = caller }) > 0) return true;
        var clubs = await conn.QueryAsync<(int ClubId, int DistrictId)>(@"
            SELECT cm.fk_club_id, IFNULL(c.fk_district_id, 0) FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE cm.fk_member_master_profile_id = @M AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0",
            new { M = memberId });
        foreach (var (clubId, districtId) in clubs)
            if (await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, caller, true, clubId)
                || (districtId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, caller, false, districtId)))
                return true;
        return false;
    }

    private static object Shape(Row r) => new
    {
        id = r.Id, type = r.Type, level = r.Level, label = Label(r.Type, r.Level),
        awardedDate = r.AwardedDate.ToString("yyyy-MM-dd"), notes = r.Notes, source = r.Source,
    };

    [HttpGet("api/members/{memberId:int}/foundation-designations")]
    public async Task<IActionResult> List(int memberId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        if (CallerId() != memberId && !await CanManageAsync(conn, memberId)) return Denied();
        var rows = await conn.QueryAsync<Row>(@"
            SELECT pk_member_designation_id AS Id, designation_type AS Type, level AS Level,
                   awarded_date AS AwardedDate, notes AS Notes, source AS Source
            FROM member_foundation_designations
            WHERE fk_member_master_profile_id = @M AND isdeleted = 0
            ORDER BY awarded_date DESC, pk_member_designation_id DESC",
            new { M = memberId });
        return Ok(rows.Select(Shape));
    }

    // shortcut: no edit of a row, remove and add it again; add PUT if admins ask for it.
    [HttpPost("api/members/{memberId:int}/foundation-designations")]
    public async Task<IActionResult> Add(int memberId, [FromBody] AddRequest req)
    {
        await using var conn = new MySqlConnection(_connectionString);
        if (!await CanManageAsync(conn, memberId)) return Denied();

        var type = (req.Type ?? "").Trim().ToUpperInvariant();
        if (!Levels.TryGetValue(type, out var range))
            return BadRequest(new { message = "Type must be PHF, MAJOR_DONOR or BEQUEST_SOCIETY." });
        int? level = type == "PHF" ? req.Level ?? 0 : req.Level;
        if (range is null && level != null)
            return BadRequest(new { message = "Bequest Society has no level." });
        if (range is { } r && (level is null || level < r.Min || level > r.Max))
            return BadRequest(new { message = $"Level must be between {r.Min} and {r.Max}." });
        var date = req.AwardedDate?.Date;
        if (date is null || date < new DateTime(1917, 1, 1) || date > DateTime.UtcNow.Date.AddDays(1))
            return BadRequest(new { message = "Enter the date the designation was reached; it cannot be in the future." });
        var notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        if (notes?.Length > 500) return BadRequest(new { message = "Notes can be at most 500 characters." });

        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @M AND isdeleted = 0",
                new { M = memberId }) == 0)
            return NotFound(new { message = "Member not found." });
        if (await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_foundation_designations
                WHERE fk_member_master_profile_id = @M AND designation_type = @T AND level <=> @L AND isdeleted = 0",
                new { M = memberId, T = type, L = level }) > 0)
            return Conflict(new { message = $"{Label(type, level)} is already recorded for this member." });

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO member_foundation_designations
                (fk_member_master_profile_id, designation_type, level, awarded_date, notes, source, created_by)
            VALUES (@M, @T, @L, @D, @N, 'manual', @U);
            SELECT LAST_INSERT_ID();",
            new { M = memberId, T = type, L = level, D = date, N = notes, U = CallerId() });
        // A new Paul Harris Fellow shows in the app feed at once (engagement module); the daily pass catches any miss.
        if (type == "PHF" && await EngagementService.IsOnAsync(_connectionString))
            await EngagementService.CapturePhfAsync(conn, id);
        return Ok(new { id });
    }

    [HttpDelete("api/members/{memberId:int}/foundation-designations/{id:int}")]
    public async Task<IActionResult> Remove(int memberId, int id)
    {
        await using var conn = new MySqlConnection(_connectionString);
        if (!await CanManageAsync(conn, memberId)) return Denied();
        var n = await conn.ExecuteAsync(@"
            UPDATE member_foundation_designations SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
            WHERE pk_member_designation_id = @Id AND fk_member_master_profile_id = @M AND isdeleted = 0",
            new { Id = id, M = memberId, U = CallerId() });
        return n == 0 ? NotFound(new { message = "Designation not found." }) : Ok(new { message = "Designation removed." });
    }

    // "Members with designation X": each member's highest level of that type, for club or district admins.
    [HttpGet("api/clubs/{clubId:int}/foundation-designations")]
    public Task<IActionResult> ClubReport(int clubId, [FromQuery] string? type, [FromQuery] int minLevel = 0)
        => Report(true, clubId, type, minLevel);

    [HttpGet("api/districts/{districtId:int}/foundation-designations")]
    public Task<IActionResult> DistrictReport(int districtId, [FromQuery] string? type, [FromQuery] int minLevel = 0)
        => Report(false, districtId, type, minLevel);

    private async Task<IActionResult> Report(bool isClub, int scopeId, string? type, int minLevel)
    {
        // The scope guard lets every member of the club or district read; this report is for its admins.
        if (CallerId() <= 0 || !await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, CallerId(), isClub, scopeId))
            return StatusCode(403, new { message = isClub ? "You do not manage this club." : "You do not manage this district." });
        var t = (type ?? "").Trim().ToUpperInvariant();
        if (!Levels.ContainsKey(t))
            return BadRequest(new { message = "Type must be PHF, MAJOR_DONOR or BEQUEST_SOCIETY." });

        await using var conn = new MySqlConnection(_connectionString);
        // shortcut: no paging, at most 5,000 rows; page it when a district outgrows that.
        var rows = await conn.QueryAsync<Row>($@"
            SELECT Id, MemberId, MemberName, ClubName, Type, Level, AwardedDate FROM (
                SELECT d.pk_member_designation_id AS Id, d.fk_member_master_profile_id AS MemberId, m.MemberName,
                       c.ClubName, d.designation_type AS Type, d.level AS Level, d.awarded_date AS AwardedDate,
                       ROW_NUMBER() OVER (PARTITION BY d.fk_member_master_profile_id
                                          ORDER BY d.level DESC, d.awarded_date DESC) AS rn
                FROM member_foundation_designations d
                JOIN member_master_profile m ON m.pk_member_master_profile_id = d.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN club_members cm ON cm.fk_member_master_profile_id = d.fk_member_master_profile_id
                                    AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND IFNULL(c.isdeleted, 0) = 0
                WHERE d.isdeleted = 0 AND d.designation_type = @Type AND (d.level IS NULL OR d.level >= @MinLevel)
                  AND {(isClub ? "cm.fk_club_id = @Scope" : "c.fk_district_id = @Scope")}
            ) x WHERE rn = 1 ORDER BY MemberName LIMIT 5000",
            new { Type = t, MinLevel = minLevel, Scope = scopeId });
        return Ok(rows.Select(r => new
        {
            memberId = r.MemberId, memberName = r.MemberName, clubName = r.ClubName,
            level = r.Level, label = Label(r.Type, r.Level), awardedDate = r.AwardedDate.ToString("yyyy-MM-dd"),
        }));
    }
}

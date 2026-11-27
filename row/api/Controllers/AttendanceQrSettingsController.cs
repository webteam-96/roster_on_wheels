using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Settings → QR Attendance (SuperAdmin only). Marker: QR-ATTENDANCE
/// Switch the mobile QR attendance feature on for test clubs, then for all clubs.
/// Rules live in <see cref="AttendanceQrSwitch"/>.
/// </summary>
[ApiController]
[Authorize]
public class AttendanceQrSettingsController : ControllerBase
{
    private readonly string _connectionString;

    public AttendanceQrSettingsController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private bool IsSuperAdmin() => UserPermissionHelper.IsSuperAdmin(User);
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private ObjectResult SuperAdminOnly() =>
        StatusCode(403, new { message = "Only SuperAdmin can change QR Attendance settings." });

    public class SetFlagDto { public bool IsEnabled { get; set; } }

    [HttpGet("api/settings/attendance-qr")]
    public async Task<ActionResult> Get()
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        await AttendanceQrSwitch.EnsureTableAsync(conn);

        // modified_date is UTC; sent as ISO with Z so the page shows it in the viewer's zone.
        var rows = (await conn.QueryAsync(@"
            SELECT s.fk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   s.is_enabled = 1 AS isEnabled,
                   DATE_FORMAT(s.modified_date, '%Y-%m-%dT%H:%i:%sZ') AS modifiedDate,
                   m.MemberName AS modifiedByName
            FROM attendance_qr_settings s
            LEFT JOIN club_master c ON c.pk_club_id = s.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = s.modified_by
            ORDER BY d.DistrictNumber, c.ClubName")).ToList();

        var global = rows.FirstOrDefault(r => (int)r.clubId == 0);
        return Ok(new
        {
            allClubs = global != null && Convert.ToInt32(global.isEnabled) == 1,
            allClubsModifiedDate = (string?)global?.modifiedDate,
            allClubsModifiedByName = (string?)global?.modifiedByName,
            clubs = rows.Where(r => (int)r.clubId > 0).Select(r => new
            {
                clubId = (int)r.clubId,
                clubName = (string?)r.clubName,
                districtNumber = r.districtNumber?.ToString(),
                isEnabled = Convert.ToInt32(r.isEnabled) == 1,
                modifiedDate = (string?)r.modifiedDate,
                modifiedByName = (string?)r.modifiedByName,
            }),
        });
    }

    [HttpPut("api/settings/attendance-qr/all")]
    public async Task<ActionResult> SetAll([FromBody] SetFlagDto dto)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        await AttendanceQrSwitch.SetAsync(conn, 0, dto.IsEnabled, GetUserId());
        return Ok(new
        {
            message = dto.IsEnabled
                ? "QR Attendance is now ON for all clubs."
                : "QR Attendance is now OFF for all clubs. Only the clubs switched on below have it.",
            isEnabled = dto.IsEnabled,
        });
    }

    [HttpPut("api/settings/attendance-qr/club/{clubId:int}")]
    public async Task<ActionResult> SetClub(int clubId, [FromBody] SetFlagDto dto)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        if (clubId <= 0) return BadRequest(new { message = "clubId is required." });
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        if (exists == 0) return NotFound(new { message = "Club not found." });

        await AttendanceQrSwitch.SetAsync(conn, clubId, dto.IsEnabled, GetUserId());
        return Ok(new
        {
            message = dto.IsEnabled ? "QR Attendance switched ON for this club." : "QR Attendance switched OFF for this club.",
            isEnabled = dto.IsEnabled,
        });
    }

    [HttpDelete("api/settings/attendance-qr/club/{clubId:int}")]
    public async Task<ActionResult> RemoveClub(int clubId)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        await AttendanceQrSwitch.RemoveClubAsync(conn, clubId);
        return Ok(new { message = "Club removed from the list." });
    }
}

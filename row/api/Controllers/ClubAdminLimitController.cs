using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

/// <summary>
/// Club Admin limit (owner decision 2026-11-19), SuperAdmin only: read and change the per-club limit, and list the
/// clubs that already hold more active Club Admins than the limit (left unchanged, for the owner to decide).
/// The limit itself is enforced in ClubAdminLimit / ClubAdminAccessHelper on every grant path.
/// </summary>
[ApiController]
[Route("api/admin/club-admin-limit")]
[Authorize]
public class ClubAdminLimitController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IAuditLogService _audit;

    public ClubAdminLimitController(IConfiguration config, IAuditLogService audit)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _audit = audit;
    }

    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    private async Task<MySqlConnection?> OpenForSuperAdminAsync()
    {
        var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, GetUserId())) return conn;
        await conn.DisposeAsync();
        return null;
    }

    public sealed record LimitDto(int Max, int DefaultMax, bool IsDefault);
    public sealed class SetLimitRequest { public int Max { get; set; } }
    public sealed record AdminName(int MemberId, string Name);
    public sealed record OverLimitClub(int ClubId, string ClubName, string? DistrictNumber, int AdminCount, List<AdminName> Admins);

    [HttpGet]
    public async Task<ActionResult<LimitDto>> Get()
    {
        await using var conn = await OpenForSuperAdminAsync();
        if (conn == null) return Forbid();
        var raw = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = @Key LIMIT 1", new { Key = ClubAdminLimit.SettingKey });
        var max = ClubAdminLimit.Parse(raw);
        return Ok(new LimitDto(max, ClubAdminLimit.DefaultMax, raw == null || max == ClubAdminLimit.DefaultMax));
    }

    [HttpPut]
    public async Task<ActionResult<LimitDto>> Set([FromBody] SetLimitRequest req)
    {
        if (req == null || req.Max < 1 || req.Max > ClubAdminLimit.MaxAllowedSetting)
            return BadRequest(new { message = $"The limit must be a whole number from 1 to {ClubAdminLimit.MaxAllowedSetting}." });
        await using var conn = await OpenForSuperAdminAsync();
        if (conn == null) return Forbid();
        var before = await ClubAdminLimit.GetMaxAsync(conn);
        await conn.ExecuteAsync(@"
            INSERT INTO system_settings (SettingKey, SettingValue, Description, modified_by)
            VALUES (@Key, @Value, 'Most active Club Admins one club may have', @By)
            ON DUPLICATE KEY UPDATE SettingValue = VALUES(SettingValue), modified_by = VALUES(modified_by)",
            new { Key = ClubAdminLimit.SettingKey, Value = req.Max.ToString(), By = GetUserId() });
        await _audit.LogAsync(GetUserId(), "UPDATE", "club_admin_limit", null, ClubAdminLimit.SettingKey,
            new { before, after = req.Max }, HttpContext);
        return Ok(new LimitDto(req.Max, ClubAdminLimit.DefaultMax, req.Max == ClubAdminLimit.DefaultMax));
    }

    /// <summary>Clubs with more active Club Admins than the limit (SuperAdmins not counted), with the admins' names.</summary>
    [HttpGet("report")]
    public async Task<ActionResult> Report()
    {
        await using var conn = await OpenForSuperAdminAsync();
        if (conn == null) return Forbid();
        var max = await ClubAdminLimit.GetMaxAsync(conn);
        var rows = (await conn.QueryAsync<(int ClubId, string ClubName, string? DistrictNumber, int MemberId, string Name)>($@"
            SELECT c.pk_club_id, c.ClubName, d.DistrictNumber, m.pk_member_master_profile_id, IFNULL(m.MemberName, '')
            FROM (
                SELECT mr.fk_club_id AS club_id FROM member_roles mr
                WHERE mr.fk_club_id > 0 AND {ClubAdminLimit.CountedAdminsWhere.Replace("@ClubId", "mr.fk_club_id")}
                GROUP BY mr.fk_club_id
                HAVING COUNT(DISTINCT mr.fk_member_master_profile_id) > @Max
            ) o
            JOIN club_master c ON c.pk_club_id = o.club_id AND IFNULL(c.isdeleted, 0) = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN (SELECT DISTINCT mr.fk_club_id, mr.fk_member_master_profile_id FROM member_roles mr
                  WHERE mr.fk_club_id > 0 AND {ClubAdminLimit.CountedAdminsWhere.Replace("@ClubId", "mr.fk_club_id")}) a
              ON a.fk_club_id = o.club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_master_profile_id
            ORDER BY c.ClubName, m.MemberName", new { Max = max })).ToList();

        var clubs = rows.GroupBy(r => (r.ClubId, r.ClubName, r.DistrictNumber))
            .Select(g => new OverLimitClub(g.Key.ClubId, g.Key.ClubName, g.Key.DistrictNumber, g.Count(),
                g.Select(r => new AdminName(r.MemberId, r.Name)).ToList()))
            .OrderByDescending(c => c.AdminCount).ThenBy(c => c.ClubName).ToList();
        return Ok(new { max, clubs });
    }
}

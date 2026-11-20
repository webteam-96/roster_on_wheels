using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Time-limited cross-district access (Services/CrossDistrictAccess.cs). A SuperAdmin grants for any district; a
/// Zonal Coordinator (role 4) or RI Director (role 7) only for districts in a zone they hold. Roles are read from
/// member_roles on every call, never from the token. Every grant and revoke goes to audit_log; uses are logged by
/// the access checks. Not under api/districts/{id}, so the scope guard does not apply here: this controller checks.
/// </summary>
[ApiController]
[Authorize]
[Route("api/district-access-grants")]
public class DistrictAccessGrantsController : ControllerBase
{
    private const int ExpiringSoonDays = 7;
    private readonly string _cs;

    public DistrictAccessGrantsController(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    public sealed record CreateGrantDto(int MemberId, int DistrictId, bool CanWrite, string? Purpose, string? Note,
        DateTime StartsAtUtc, DateTime ExpiresAtUtc);
    public sealed record RevokeDto(string? Reason);

    private async Task<MySqlConnection> OpenAsync()
    {
        var conn = RowDb.Connect(_cs);
        await conn.OpenAsync();
        return conn;
    }

    /// <summary>Districts the caller may grant for: null = every district (SuperAdmin), empty = none.</summary>
    private static async Task<HashSet<int>?> GrantableDistrictsAsync(MySqlConnection conn, int me)
    {
        if (me <= 0) return new HashSet<int>();
        if (await conn.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M
                AND fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0", new { M = me }) > 0) return null;
        return (await conn.QueryAsync<int>(@"
            SELECT d.pk_district_id FROM district_master d
            JOIN member_roles mr ON mr.fk_zone_id = d.fk_zone_id
            WHERE mr.fk_member_master_profile_id = @M AND mr.fk_role_id IN (4, 7) AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND mr.fk_zone_id IS NOT NULL AND IFNULL(d.isdeleted, 0) = 0", new { M = me })).ToHashSet();
    }

    private static bool May(HashSet<int>? grantable, int districtId) => grantable == null || grantable.Contains(districtId);

    private ObjectResult NotGrantor() =>
        StatusCode(403, new { message = "Only a Super Admin, or a zone officer for a district in their zone, can manage cross-district access." });

    private const string ListSql = @"
        SELECT g.pk_grant_id AS id, g.fk_member_id AS memberId, m.MemberName AS memberName,
               g.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, g.can_write AS canWrite,
               g.purpose, g.note, g.starts_at_utc AS startsAtUtc, g.expires_at_utc AS expiresAtUtc,
               g.granted_by AS grantedBy, gb.MemberName AS grantedByName, g.granted_at_utc AS grantedAtUtc,
               g.revoked_at_utc AS revokedAtUtc, rb.MemberName AS revokedByName, g.revoke_reason AS revokeReason
        FROM district_access_grants g
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = g.fk_member_id
        LEFT JOIN member_master_profile gb ON gb.pk_member_master_profile_id = g.granted_by
        LEFT JOIN member_master_profile rb ON rb.pk_member_master_profile_id = g.revoked_by
        LEFT JOIN district_master d ON d.pk_district_id = g.fk_district_id";

    public sealed class GrantRow
    {
        public int Id { get; set; }
        public int MemberId { get; set; }
        public string? MemberName { get; set; }
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public bool CanWrite { get; set; }
        public string Purpose { get; set; } = "";
        public string? Note { get; set; }
        public DateTime StartsAtUtc { get; set; }
        public DateTime ExpiresAtUtc { get; set; }
        public int GrantedBy { get; set; }
        public string? GrantedByName { get; set; }
        public DateTime GrantedAtUtc { get; set; }
        public DateTime? RevokedAtUtc { get; set; }
        public string? RevokedByName { get; set; }
        public string? RevokeReason { get; set; }
        /// <summary>active | scheduled | expiring | expired | revoked, from the server clock.</summary>
        public string Status { get; set; } = "";
    }

    private static string StatusOf(GrantRow r, DateTime now) =>
        r.RevokedAtUtc != null ? "revoked"
        : r.ExpiresAtUtc <= now ? "expired"
        : r.StartsAtUtc > now ? "scheduled"
        : r.ExpiresAtUtc <= now.AddDays(ExpiringSoonDays) ? "expiring"
        : "active";

    private static IEnumerable<GrantRow> Stamp(IEnumerable<GrantRow> rows, DateTime now)
    {
        foreach (var r in rows)
        {
            r.Status = StatusOf(r, now);
            // DATETIME comes back Unspecified; these are UTC, so say so in the JSON.
            r.StartsAtUtc = DateTime.SpecifyKind(r.StartsAtUtc, DateTimeKind.Utc);
            r.ExpiresAtUtc = DateTime.SpecifyKind(r.ExpiresAtUtc, DateTimeKind.Utc);
            r.GrantedAtUtc = DateTime.SpecifyKind(r.GrantedAtUtc, DateTimeKind.Utc);
            if (r.RevokedAtUtc is { } rv) r.RevokedAtUtc = DateTime.SpecifyKind(rv, DateTimeKind.Utc);
            yield return r;
        }
    }

    /// <summary>Grants the caller manages, newest first, with live/expiring/expired/revoked status and counts.</summary>
    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? status)
    {
        await using var conn = await OpenAsync();
        var grantable = await GrantableDistrictsAsync(conn, Me);
        if (grantable is { Count: 0 }) return NotGrantor();
        var rows = (await conn.QueryAsync<GrantRow>(ListSql + (grantable == null ? "" : " WHERE g.fk_district_id IN @D")
            + " ORDER BY g.pk_grant_id DESC LIMIT 1000", new { D = grantable })).ToList();
        var now = DateTime.UtcNow;
        var all = Stamp(rows, now).ToList();
        var counts = all.GroupBy(r => r.Status).ToDictionary(g => g.Key, g => g.Count());
        var items = string.IsNullOrWhiteSpace(status) || status == "all"
            ? all
            : status == "live" ? all.Where(r => r.Status is "active" or "expiring").ToList()
            : all.Where(r => r.Status == status).ToList();
        return Ok(new { items, counts, expiringSoonDays = ExpiringSoonDays });
    }

    /// <summary>The districts the caller may grant for, for the create form.</summary>
    [HttpGet("districts")]
    public async Task<ActionResult> Districts()
    {
        await using var conn = await OpenAsync();
        var grantable = await GrantableDistrictsAsync(conn, Me);
        if (grantable is { Count: 0 }) return NotGrantor();
        var rows = await conn.QueryAsync(@"SELECT pk_district_id AS id, DistrictNumber AS districtNumber FROM district_master
            WHERE IFNULL(isdeleted, 0) = 0" + (grantable == null ? "" : " AND pk_district_id IN @D") +
            " ORDER BY DistrictNumber", new { D = grantable });
        return Ok(rows);
    }

    /// <summary>Member search for the create form: a SuperAdmin searches everyone, a zone officer the members of
    /// their zone's districts. Name, club and district only (no contact details).</summary>
    [HttpGet("members")]
    public async Task<ActionResult> Members([FromQuery] string? q)
    {
        await using var conn = await OpenAsync();
        var grantable = await GrantableDistrictsAsync(conn, Me);
        if (grantable is { Count: 0 }) return NotGrantor();
        var term = (q ?? "").Trim();
        if (term.Length < 2) return Ok(Array.Empty<object>());
        if (term.Length > 100) term = term[..100];
        var byId = int.TryParse(term, out var idTerm) ? idTerm : 0;
        var rows = await conn.QueryAsync(@"
            SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name, MIN(c.ClubName) AS clubName,
                   MIN(d.DistrictNumber) AS districtNumber
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND IFNULL(cm.isdeleted,0) = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE IFNULL(m.isdeleted, 0) = 0 AND (m.MemberName LIKE @Like OR m.pk_member_master_profile_id = @Id)" +
            (grantable == null ? "" : " AND c.fk_district_id IN @D") + @"
            GROUP BY m.pk_member_master_profile_id, m.MemberName ORDER BY m.MemberName LIMIT 20",
            new { Like = "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%", Id = byId, D = grantable });
        return Ok(rows);
    }

    [HttpPost]
    public async Task<ActionResult> Create([FromBody] CreateGrantDto dto)
    {
        await using var conn = await OpenAsync();
        var grantable = await GrantableDistrictsAsync(conn, Me);
        if (grantable is { Count: 0 } || !May(grantable, dto.DistrictId)) return NotGrantor();
        var starts = dto.StartsAtUtc.ToUniversalTime();
        var expires = dto.ExpiresAtUtc.ToUniversalTime();
        var now = DateTime.UtcNow;
        var error = CrossDistrictAccess.Validate(dto.MemberId, dto.DistrictId, dto.Purpose, dto.Note, starts, expires, now);
        if (error == null && dto.MemberId == Me) error = "You cannot grant access to yourself.";
        if (error != null) return BadRequest(new { message = error });
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @M AND IFNULL(isdeleted,0) = 0", new { M = dto.MemberId }) == 0)
            return BadRequest(new { message = "That member does not exist." });
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_master WHERE pk_district_id = @D AND IFNULL(isdeleted,0) = 0", new { D = dto.DistrictId }) == 0)
            return BadRequest(new { message = "That district does not exist." });
        // A zone officer must be able to see the grantee too (same rule as the member search).
        if (grantable != null && await conn.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                WHERE cm.fk_member_master_profile_id = @M AND cm.IsActive = 1 AND IFNULL(cm.isdeleted,0) = 0 AND c.fk_district_id IN @D",
                new { M = dto.MemberId, D = grantable }) == 0)
            return NotGrantor();
        if (await conn.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM district_access_grants WHERE fk_member_id = @M AND fk_district_id = @D
                AND revoked_at_utc IS NULL AND expires_at_utc > @Now", new { M = dto.MemberId, D = dto.DistrictId, Now = now }) > 0)
            return Conflict(new { message = "This member already has access to that district. Revoke it first to change it." });

        var purpose = dto.Purpose!.Trim().ToUpperInvariant();
        var note = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_access_grants (fk_member_id, fk_district_id, can_write, purpose, note, starts_at_utc,
                expires_at_utc, granted_by, granted_at_utc)
            VALUES (@M, @D, @W, @P, @N, @S, @E, @By, @Now); SELECT LAST_INSERT_ID();",
            new { M = dto.MemberId, D = dto.DistrictId, W = dto.CanWrite, P = purpose, N = note, S = starts, E = expires, By = Me, Now = now });
        await CrossDistrictAccess.AuditAsync(conn, Me, "GRANT", id, $"member {dto.MemberId} -> district {dto.DistrictId}",
            new { grantId = id, dto.MemberId, dto.DistrictId, dto.CanWrite, purpose, note, startsAtUtc = starts, expiresAtUtc = expires }, HttpContext);
        return Ok(new { id });
    }

    [HttpPost("{id:int}/revoke")]
    public async Task<ActionResult> Revoke(int id, [FromBody] RevokeDto? dto)
    {
        await using var conn = await OpenAsync();
        var grantable = await GrantableDistrictsAsync(conn, Me);
        if (grantable is { Count: 0 }) return NotGrantor();
        var row = await conn.QueryFirstOrDefaultAsync<(int DistrictId, int MemberId, DateTime? RevokedAt)>(
            "SELECT fk_district_id, fk_member_id, revoked_at_utc FROM district_access_grants WHERE pk_grant_id = @Id", new { Id = id });
        // Unknown and not-yours look the same, so ids cannot be probed.
        if (row.DistrictId == 0 || !May(grantable, row.DistrictId)) return NotFound(new { message = "Grant not found." });
        if (row.RevokedAt != null) return Conflict(new { message = "This grant is already revoked." });
        var reason = string.IsNullOrWhiteSpace(dto?.Reason) ? null : dto!.Reason!.Trim();
        if (reason is { Length: > 500 }) return BadRequest(new { message = "The reason can be at most 500 characters." });
        var n = await conn.ExecuteAsync(@"UPDATE district_access_grants SET revoked_at_utc = @Now, revoked_by = @By, revoke_reason = @R
            WHERE pk_grant_id = @Id AND revoked_at_utc IS NULL", new { Now = DateTime.UtcNow, By = Me, R = reason, Id = id });
        if (n == 0) return Conflict(new { message = "This grant is already revoked." });
        await CrossDistrictAccess.AuditAsync(conn, Me, "REVOKE", id, $"member {row.MemberId} -> district {row.DistrictId}",
            new { grantId = id, row.MemberId, row.DistrictId, reason }, HttpContext);
        return Ok(new { message = "Access revoked." });
    }

    /// <summary>The caller's own live and upcoming grants: the app shows these as extra districts.</summary>
    [HttpGet("mine")]
    public async Task<ActionResult> Mine()
    {
        if (Me <= 0) return Unauthorized();
        await using var conn = await OpenAsync();
        var now = DateTime.UtcNow;
        var rows = await conn.QueryAsync<GrantRow>(ListSql + @" WHERE g.fk_member_id = @M AND g.revoked_at_utc IS NULL
            AND g.expires_at_utc > @Now ORDER BY g.expires_at_utc", new { M = Me, Now = now });
        return Ok(Stamp(rows, now).Select(r => new
        {
            r.Id, r.DistrictId, r.DistrictNumber, r.CanWrite, r.Purpose, r.Note, r.StartsAtUtc, r.ExpiresAtUtc, r.GrantedByName, r.Status,
        }));
    }
}

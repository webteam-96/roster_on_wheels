using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// SuperAdmin global search — single endpoint that searches zones, districts,
// and clubs in one shot and returns mixed results. The Settings hub page that
// consumes this is empty on load and only fires after the SA types something,
// so we never return everything — the LIKE search is intentionally narrow.
//
// Result shape per row: { type, id, label, subLabel, districtId? }
//   - type: "zone" | "district" | "club"
//   - id: PK of the matched entity
//   - label: primary text (ZoneName / DistrictNumber / ClubName)
//   - subLabel: parent context (e.g. ZoneName under a district, DistrictNumber under a club)
//   - districtId: only set for type=club so the frontend can build /clubs/{id}/dashboard?districtId=X
[ApiController]
[Route("api/admin/global-search")]
[Authorize]
public class GlobalSearchController : ControllerBase
{
    private readonly string _connectionString;
    // 10 per type was a type-ahead cap - a search for a district number came back with 11 rows and the
    // pager never appeared (user 2026-10-01: "i am showing only 10 11 records everytime"). 100 each is
    // enough for every club of a district to list, and the screen pages them 20 at a time.
    private const int PerTypeLimit = 100;

    public GlobalSearchController(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet]
    public async Task<ActionResult> Search([FromQuery] string q)
    {
        if (!await IsSuperAdminAsync())
            return StatusCode(403, new { message = "SuperAdmin access required." });

        if (string.IsNullOrWhiteSpace(q))
            return Ok(new { zones = new object[0], districts = new object[0], clubs = new object[0] });

        var term = q.Trim();
        if (term.Length < 2)
            return Ok(new { zones = new object[0], districts = new object[0], clubs = new object[0] });

        var like = $"%{term}%";

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Zones — match by ZoneName. Includes district / club / member rollups for the row.
        var zones = (await conn.QueryAsync<dynamic>(@"
            SELECT z.pk_zone_id AS id,
                   z.ZoneName  AS label,
                   CAST(NULL AS CHAR) AS subLabel,
                   CAST(NULL AS UNSIGNED) AS districtId,
                   (SELECT COUNT(*) FROM district_master d
                     WHERE d.fk_zone_id = z.pk_zone_id AND d.IsActive = 1 AND d.isdeleted = 0) AS districtCount,
                   (SELECT COUNT(*) FROM club_master c
                     JOIN district_master d2 ON d2.pk_district_id = c.fk_district_id
                     WHERE d2.fk_zone_id = z.pk_zone_id AND d2.isdeleted = 0
                       AND c.IsActive = 1 AND c.isdeleted = 0) AS clubCount,
                   (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                     JOIN district_master d3 ON d3.pk_district_id = c2.fk_district_id AND d3.isdeleted = 0
                     WHERE d3.fk_zone_id = z.pk_zone_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS memberCount
            FROM zone_master z
            WHERE z.ZoneName LIKE @Like
              AND z.IsActive = 1
              AND z.isdeleted = 0
            ORDER BY z.ZoneName
            LIMIT @Limit",
            new { Like = like, Limit = PerTypeLimit })).ToList();

        // Districts — match by DistrictNumber. Zone as subLabel for context, plus the rollups the
        // SuperAdmin asked for on the row (user 2026-10-01): active clubs split into synced /
        // non-synced, and the district's active member count. Honorary members are NOT counted,
        // matching every other member figure in the system.
        var districts = (await conn.QueryAsync<dynamic>(@"
            SELECT d.pk_district_id AS id,
                   d.DistrictNumber AS label,
                   COALESCE(z.ZoneName, 'N/A') AS subLabel,
                   CAST(NULL AS UNSIGNED) AS districtId,
                   (SELECT COUNT(*) FROM club_master c
                     WHERE c.fk_district_id = d.pk_district_id AND c.IsActive = 1 AND c.isdeleted = 0) AS clubCount,
                   (SELECT COUNT(*) FROM club_master c
                     WHERE c.fk_district_id = d.pk_district_id AND c.IsActive = 1 AND c.isdeleted = 0
                       AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 1) AS syncedClubCount,
                   (SELECT COUNT(*) FROM club_master c
                     WHERE c.fk_district_id = d.pk_district_id AND c.IsActive = 1 AND c.isdeleted = 0
                       AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 0) AS nonSyncedClubCount,
                   (SELECT COUNT(*) FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0 AND c2.IsActive = 1
                     JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                     WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                       AND COALESCE(cm.IsHonoraryMember, 0) = 0) AS memberCount,
                   -- The district's own website, same shape as the club rows: the subdomain plus
                   -- 'active' / 'expired' / 'none' for the pill. district_websites carries no end
                   -- date, so Status alone decides (user 2026-10-01).
                   (SELECT dw.Subdomain FROM district_websites dw
                     WHERE dw.fk_district_id = d.pk_district_id AND COALESCE(dw.isdeleted, 0) = 0
                     ORDER BY dw.pk_id DESC LIMIT 1) AS districtWebsiteSubdomain,
                   (SELECT dw.ClientDomain FROM district_websites dw
                     WHERE dw.fk_district_id = d.pk_district_id AND COALESCE(dw.isdeleted, 0) = 0
                     ORDER BY dw.pk_id DESC LIMIT 1) AS districtWebsiteClientDomain,
                   (SELECT CASE WHEN dw.Status = 'Active' THEN 'active'
                                WHEN dw.Status IS NOT NULL THEN 'expired'
                                ELSE 'none' END
                      FROM district_websites dw
                     WHERE dw.fk_district_id = d.pk_district_id AND COALESCE(dw.isdeleted, 0) = 0
                     ORDER BY dw.pk_id DESC LIMIT 1) AS districtWebsiteStatus
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
            WHERE d.DistrictNumber LIKE @Like
              AND d.IsActive = 1
              AND d.isdeleted = 0
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber
            LIMIT @Limit",
            new { Like = like, Limit = PerTypeLimit })).ToList();

        // Clubs — match by ClubName. subLabel = DistrictNumber (raw, no "District " prefix
        // per the project-wide display rule). districtId is returned so the frontend can
        // build /clubs/{id}/dashboard?districtId=X navigation. Extra columns:
        //   isSyncedFromRotaryOrg → display as Yes/No
        //   clubWebsiteUrl        → public site if any (best-effort: latest active subdomain)
        //   memberCount           → active non-deleted members in this club
        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id   AS id,
                   c.ClubName     AS label,
                   d.DistrictNumber AS subLabel,
                   c.fk_district_id AS districtId,
                   c.ClubRotaryId AS clubRotaryId,
                   COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSyncedFromRotaryOrg,
                   (SELECT cw.Subdomain
                      FROM club_websites cw
                      WHERE cw.fk_club_id = c.pk_club_id
                        AND COALESCE(cw.isdeleted, 0) = 0
                      ORDER BY cw.pk_id DESC
                      LIMIT 1) AS clubWebsiteSubdomain,
                   -- 'active' / 'expired' / 'none' — drives the Site pill on the global search row.
                   (SELECT CASE
                             WHEN cw.Status = 'Active' AND (cw.EndDate IS NULL OR cw.EndDate >= CURDATE()) THEN 'active'
                             WHEN cw.Status = 'Active' AND cw.EndDate < CURDATE() THEN 'expired'
                             WHEN cw.Status IS NOT NULL THEN 'expired'
                             ELSE 'none'
                           END
                      FROM club_websites cw
                      WHERE cw.fk_club_id = c.pk_club_id
                        AND COALESCE(cw.isdeleted, 0) = 0
                      ORDER BY cw.pk_id DESC
                      LIMIT 1) AS clubWebsiteStatus,
                   (SELECT COUNT(*) FROM club_members cm
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                      WHERE cm.fk_club_id = c.pk_club_id
                        AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS memberCount
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE (c.ClubName LIKE @Like OR c.ClubRotaryId LIKE @Like)
              AND c.IsActive = 1
              AND c.isdeleted = 0
            ORDER BY c.ClubName
            LIMIT @Limit",
            new { Like = like, Limit = PerTypeLimit })).ToList();

        return Ok(new { zones, districts, clubs });
    }

    // No-zone districts — feeds the "assign zone" popup (small icon) on the global-search page.
    // A district auto-created by sync gets fk_zone_id = 0 (no zone). List them so a SuperAdmin can
    // open each (district edit page) and assign the correct zone.
    [HttpGet("no-zone-districts")]
    public async Task<ActionResult> NoZoneDistricts()
    {
        if (!await IsSuperAdminAsync())
            return StatusCode(403, new { message = "SuperAdmin access required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber, d.Country AS country
            FROM district_master d
            WHERE (d.fk_zone_id IS NULL OR d.fk_zone_id = 0)
              AND d.isdeleted = 0
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber")).ToList();
        return Ok(new { count = rows.Count, districts = rows });
    }

    private async Task<bool> IsSuperAdminAsync()
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM member_roles
              WHERE fk_member_master_profile_id = @MemberId
                AND fk_role_id = 3
                AND IsActive = 1
                AND isdeleted = 0",
            new { MemberId = GetUserId() });
        return count > 0;
    }
}

using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Public directory of LIVE district + club websites, for the main-site /websites page,
// the District Governors roster aggregation, and the prospective-member form.
// Consumed via src/lib/websiteDirectory.ts. Only active, non-expired sites on an active
// club→district→zone chain are surfaced; URLs are built with the same helper + parent-domain
// settings the rest of the app uses. All routes [AllowAnonymous].
[ApiController]
[Route("api/public/website-directory")]
[AllowAnonymous]
public class PublicWebsiteDirectoryController : ControllerBase
{
    private readonly string _connStr;
    public PublicWebsiteDirectoryController(IConfiguration config)
        => _connStr = config.GetConnectionString("DefaultConnection")!;

    private MySqlConnection CreateConn() => new(_connStr);

    private static async Task<string> ClubParentAsync(MySqlConnection conn)
    {
        var v = await conn.ExecuteScalarAsync<string?>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
        return string.IsNullOrWhiteSpace(v) ? RotaryApi.Services.Brand.ClubSiteParentDomain : v!;
    }

    private class SiteRow { public int DistrictId { get; set; } public string? DistrictNumber { get; set; } public int ClubId { get; set; } public string? ClubName { get; set; } public string? City { get; set; } public string? Subdomain { get; set; } public string? ClientDomain { get; set; } }

    // ── Live district websites ───────────────────────────────────────────
    [HttpGet("districts")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)]
    public async Task<ActionResult> GetDistrictWebsites()
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var clubParent = await ClubParentAsync(conn);
        var districtParent = await conn.ExecuteScalarAsync<string?>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'DistrictWebsiteParentDomain'");
        if (string.IsNullOrWhiteSpace(districtParent)) districtParent = clubParent;

        // district_websites has no StartDate/EndDate — expiry is tracked via Status only.
        var rows = await conn.QueryAsync<SiteRow>(@"
            SELECT dw.fk_district_id AS DistrictId, CONVERT(d.DistrictNumber USING utf8mb4) AS DistrictNumber,
                   CONVERT(dw.Subdomain USING utf8mb4) AS Subdomain, CONVERT(dw.ClientDomain USING utf8mb4) AS ClientDomain
            FROM district_websites dw
            JOIN district_master d ON d.pk_district_id = dw.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
            WHERE COALESCE(dw.isdeleted, 0) = 0 AND dw.Status = 'Active'
            ORDER BY d.DistrictNumber");

        var result = rows
            .Select(r => new { r.DistrictId, districtNumber = r.DistrictNumber ?? "", url = MemberScopesHelper.BuildWebsiteUrl(r.ClientDomain?.Trim(), r.Subdomain?.Trim(), districtParent) })
            .Where(x => !string.IsNullOrWhiteSpace(x.url))
            .Select(x => new { districtId = x.DistrictId, x.districtNumber, x.url });
        return Ok(result);
    }

    // ── Live club websites (optionally scoped to one district) ───────────
    [HttpGet("clubs")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetClubWebsites([FromQuery] int? districtId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var clubParent = await ClubParentAsync(conn);

        var rows = await conn.QueryAsync<SiteRow>(@"
            SELECT cw.fk_club_id AS ClubId, CONVERT(c.ClubName USING utf8mb4) AS ClubName, CONVERT(c.City USING utf8mb4) AS City,
                   c.fk_district_id AS DistrictId, CONVERT(d.DistrictNumber USING utf8mb4) AS DistrictNumber,
                   CONVERT(cw.Subdomain USING utf8mb4) AS Subdomain, CONVERT(cw.ClientDomain USING utf8mb4) AS ClientDomain
            FROM club_websites cw
            JOIN club_master c ON c.pk_club_id = cw.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
            WHERE COALESCE(cw.isdeleted, 0) = 0 AND cw.Status = 'Active'
              AND CURDATE() BETWEEN cw.StartDate AND cw.EndDate
              AND (@DistrictId IS NULL OR c.fk_district_id = @DistrictId)
            ORDER BY c.ClubName", new { DistrictId = districtId });

        var result = rows
            .Select(r => new { r.ClubId, clubName = r.ClubName ?? "", r.City, r.DistrictId, r.DistrictNumber, url = MemberScopesHelper.BuildWebsiteUrl(r.ClientDomain?.Trim(), r.Subdomain?.Trim(), clubParent) })
            .Where(x => !string.IsNullOrWhiteSpace(x.url))
            .Select(x => new { clubId = x.ClubId, x.clubName, city = x.City, districtId = x.DistrictId, districtNumber = x.DistrictNumber ?? "", x.url });
        return Ok(result);
    }
}

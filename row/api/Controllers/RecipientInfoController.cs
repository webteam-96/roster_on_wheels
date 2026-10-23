using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// "Will email X members (Y credits available)" next to the email checkbox on announcement / event / newsletter
/// forms.
/// </summary>
[ApiController]
[Authorize]
[Route("api/recipient-info")]
public class RecipientInfoController : ControllerBase
{
    private readonly string _connectionString;
    private readonly ICreditManagementService _credits;

    public RecipientInfoController(IConfiguration config, ICreditManagementService credits)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _credits = credits;
    }

    [HttpGet("club/{clubId}")]
    public async Task<ActionResult> GetForClub(int clubId)
    {
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var emails = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''", new { Id = clubId });
        var balance = await _credits.GetClubCreditBalanceAsync(clubId);
        return Ok(new { emailRecipientCount = emails, emailRemaining = balance.EmailRemaining });
    }

    [HttpGet("district/{districtId}")]
    public async Task<ActionResult> GetForDistrict(int districtId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var emails = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE c.fk_district_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND c.isdeleted = 0 AND m.isdeleted = 0
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''", new { Id = districtId });
        var balance = await _credits.GetDistrictCreditBalanceAsync(districtId);
        return Ok(new { emailRecipientCount = emails, emailRemaining = balance.EmailRemaining });
    }
}

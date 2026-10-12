using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Lightweight endpoints to show "Will send to X members (Y credits available)"
/// next to the WhatsApp checkbox on announcement/event/newsletter forms.
/// </summary>
[ApiController]
[Authorize]
[Route("api/whatsapp-info")]
public class WhatsAppInfoController : ControllerBase
{
    private readonly string _connectionString;
    private readonly ICreditManagementService _credits;

    public WhatsAppInfoController(IConfiguration config, ICreditManagementService credits)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _credits = credits;
    }

    [HttpGet("club/{clubId}")]
    public async Task<ActionResult> GetForClub(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        const string baseWhere = @"
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0";
        var waCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(DISTINCT m.pk_member_master_profile_id) " + baseWhere +
            " AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''", new { Id = clubId });
        var emCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(DISTINCT m.pk_member_master_profile_id) " + baseWhere +
            " AND m.EmailId IS NOT NULL AND m.EmailId <> ''", new { Id = clubId });
        var balance = await _credits.GetClubCreditBalanceAsync(clubId);
        return Ok(new
        {
            recipientCount = waCount,
            whatsAppRemaining = balance.WhatsAppRemaining,
            emailRecipientCount = emCount,
            emailRemaining = balance.EmailRemaining,
        });
    }

    [HttpGet("district/{districtId}")]
    public async Task<ActionResult> GetForDistrict(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var counts = await conn.QueryFirstAsync<(int WhatsAppCount, int EmailCount)>(@"
            SELECT
                COUNT(DISTINCT CASE WHEN m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> '' THEN m.pk_member_master_profile_id END) AS WhatsAppCount,
                COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId <> '' THEN m.pk_member_master_profile_id END) AS EmailCount
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE c.fk_district_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND c.isdeleted = 0 AND m.isdeleted = 0",
            new { Id = districtId });
        var balance = await _credits.GetDistrictCreditBalanceAsync(districtId);
        return Ok(new
        {
            recipientCount = counts.WhatsAppCount,
            whatsAppRemaining = balance.WhatsAppRemaining,
            emailRecipientCount = counts.EmailCount,
            emailRemaining = balance.EmailRemaining,
        });
    }
}

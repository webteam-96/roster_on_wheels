using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/credit-management")]
[Authorize]
public class CreditManagementController : ControllerBase
{
    private readonly ICreditManagementService _service;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;

    public CreditManagementController(ICreditManagementService service, IWebHostEnvironment env, IConfiguration configuration)
    {
        _service = service;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private bool IsAdmin() => User.FindFirst("roles")?.Value?.Contains("Admin") == true;
    private int GetAdminClubId() => int.Parse(User.FindFirst("clubId")?.Value ?? "0");

    // ── Permission helpers ──────────────────────────────────────────
    // JWT only carries memberId/name/email/roles — no clubId/districtId. We resolve
    // admin scope from member_roles each request.

    private async Task<bool> CanViewClubBalanceAsync(int clubId)
    {
        if (IsSuperAdmin()) return true;
        var memberId = GetUserId();
        if (memberId == 0) return false;

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var allowed = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND (
                  /* Club Admin of this club */
                  mr.fk_club_id = @ClubId
                  OR
                  /* District Admin of this club's parent district */
                  mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId)
              )",
            new { MemberId = memberId, ClubId = clubId });
        if (allowed > 0) return true;

        // Assistant Governor of this club (read-only: the AG club dashboard shows the balance).
        var agAssigned = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM district_ag
            WHERE fk_member_id = @MemberId AND fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1",
            new { MemberId = memberId, ClubId = clubId });
        return agAssigned > 0;
    }

    private async Task<bool> CanViewDistrictBalanceAsync(int districtId)
    {
        if (IsSuperAdmin()) return true;
        var memberId = GetUserId();
        if (memberId == 0) return false;

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var allowed = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_role_id = 2
              AND fk_district_id = @DistrictId
              AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, DistrictId = districtId });
        return allowed > 0;
    }

    [HttpGet]
    public async Task<ActionResult> GetCredits(
        [FromQuery] int? districtId, [FromQuery] int? clubId,
        [FromQuery] string? creditType, [FromQuery] string? status,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!IsSuperAdmin()) return Forbid();

        var (items, totalCount) = await _service.GetCreditsAsync(districtId, clubId, creditType, status, page, pageSize);
        return Ok(new { items, totalCount, page, pageSize });
    }

    [HttpPost]
    public async Task<ActionResult> AddCredit([FromForm] AddCreditDto dto, IFormFile? proofDocument)
    {
        if (!IsSuperAdmin()) return Forbid();
        // Email is the only credit that can be granted.
        if (dto.CreditType != "Email") return BadRequest(new { message = "Invalid credit type." });

        if (proofDocument != null && proofDocument.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png" };
            var extension = System.IO.Path.GetExtension(proofDocument.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG" });
        }

        try
        {
            var id = await _service.AddCreditAsync(dto, proofDocument, GetUserId(), _env);
            return Ok(new { id, message = "Credit added successfully." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> UpdateCredit(int id, [FromForm] UpdateCreditDto dto, IFormFile? proofDocument)
    {
        if (!IsSuperAdmin()) return Forbid();

        if (proofDocument != null && proofDocument.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png" };
            var extension = System.IO.Path.GetExtension(proofDocument.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG" });
        }

        await _service.UpdateCreditAsync(id, dto, proofDocument, GetUserId(), _env);
        return Ok(new { message = "Credit updated successfully." });
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteCredit(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        await _service.DeleteCreditAsync(id, GetUserId());
        return Ok(new { message = "Credit deleted successfully." });
    }

    [HttpGet("club/{clubId}/balance")]
    public async Task<ActionResult> GetClubBalance(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (!await CanViewClubBalanceAsync(clubId)) return Forbid();

        var balance = await _service.GetClubCreditBalanceAsync(clubId);
        return Ok(balance);
    }

    [HttpGet("district/{districtId}/balance")]
    public async Task<ActionResult> GetDistrictBalance(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (!await CanViewDistrictBalanceAsync(districtId)) return Forbid();

        var balance = await _service.GetDistrictCreditBalanceAsync(districtId);
        return Ok(balance);
    }

    [HttpGet("notifications")]
    public async Task<ActionResult> GetNotifications()
    {
        if (!IsAdmin() && !IsSuperAdmin()) return Forbid();

        var clubId = GetAdminClubId();
        if (clubId == 0) return Ok(Array.Empty<CreditNotificationDto>());

        var notifications = await _service.CheckExpiringCreditsAsync(clubId);
        return Ok(notifications);
    }

    [HttpGet("usage-history")]
    public async Task<ActionResult> GetUsageHistory(
        [FromQuery] int? clubId, [FromQuery] int? districtId,
        [FromQuery] string? creditType,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!IsSuperAdmin()) return Forbid();
        var items = await _service.GetUsageHistoryAsync(clubId, districtId, creditType, page, pageSize);
        return Ok(items);
    }
}

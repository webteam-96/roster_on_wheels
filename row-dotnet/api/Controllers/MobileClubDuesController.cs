using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Mobile payer surface for Club Dues. Only the Club President / Secretary /
// Treasurer (current-year BOD) may pay for a club — every endpoint is gated by
// CanPayForClub. For anyone else the module/pay action is simply not exposed
// (the Flutter app hides it) and these endpoints 403.
[ApiController]
[Route("api/mobile/club-dues")]
[Authorize]
public class MobileClubDuesController : ControllerBase
{
    private readonly IClubDuesService _service;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly string _connStr;

    public MobileClubDuesController(IClubDuesService service, IWebHostEnvironment env, IConfiguration config)
    {
        _service = service;
        _env = env;
        _config = config;
        _connStr = config.GetConnectionString("DefaultConnection")!;
    }

    private int GetMemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var x) ? x : 0;

    // A member may pay for a club only if they are its President / Secretary /
    // Treasurer in the CURRENT rotary year (matched by designation NAME).
    private async Task<bool> CanPayForClubAsync(int memberId, int clubId)
    {
        if (memberId <= 0) return false;
        await using var conn = new MySqlConnection(_connStr);
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM board_of_directors bod
            JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            WHERE bod.fk_club_id = @ClubId
              AND bod.fk_member_master_profile_id = @MemberId
              AND COALESCE(bod.isdeleted, 0) = 0
              AND y.IsCurrent = 1
              AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer')",
            new { ClubId = clubId, MemberId = memberId });
        return count > 0;
    }

    private ObjectResult Denied() => StatusCode(403, new { message = "Only the Club President, Secretary or Treasurer can pay district dues." });

    // Clubs the signed-in officer may pay for, with each club's live amount owed.
    [HttpGet("my-clubs")]
    public async Task<ActionResult> MyClubs()
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Denied();
        await using var conn = new MySqlConnection(_connStr);
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT cd.pk_club_dues_id AS DuesId, cd.Purpose, cd.RotaryYear,
                   c.pk_club_id AS ClubId, c.ClubName, d.DistrictNumber
            FROM board_of_directors bod
            JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            JOIN club_master c ON c.pk_club_id = bod.fk_club_id
            JOIN club_dues cd ON cd.fk_district_id = c.fk_district_id AND cd.IsActive = 1 AND cd.isdeleted = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE bod.fk_member_master_profile_id = @MemberId
              AND COALESCE(bod.isdeleted,0) = 0 AND y.IsCurrent = 1
              AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer')",
            new { MemberId = memberId });
        return Ok(rows);
    }

    [HttpGet("{duesId}")]
    public async Task<ActionResult> Get(int duesId, [FromQuery] int clubId)
    {
        if (!await CanPayForClubAsync(GetMemberId(), clubId)) return Denied();
        var dto = await _service.GetPublicDuesAsync(duesId, clubId);
        if (dto == null) return NotFound(new { message = "District dues not found." });
        return Ok(dto);
    }

    // Generate the shareable pay link (officer can send it to someone else to pay).
    // Non-expiring and stable — the same club always gets the same URL.
    [HttpPost("{duesId}/pay-link")]
    public async Task<ActionResult> PayLink(int duesId, [FromQuery] int clubId)
    {
        if (!await CanPayForClubAsync(GetMemberId(), clubId)) return Denied();
        return Ok(_service.GeneratePayLink(duesId, clubId, _config["FrontendUrl"] ?? ""));
    }

    [HttpPost("{duesId}/pay")]
    public async Task<ActionResult> Pay(int duesId, [FromQuery] int clubId)
    {
        var memberId = GetMemberId();
        if (!await CanPayForClubAsync(memberId, clubId)) return Denied();
        var result = await _service.CreatePaymentOrderAsync(duesId, new PublicClubDuesPaymentSubmitDto { FkClubId = clubId, PaidByMemberId = memberId });
        return Ok(result);
    }

    [HttpPost("{duesId}/offline-payment")]
    public async Task<ActionResult> Offline(int duesId, [FromQuery] int clubId, [FromForm] RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment)
    {
        var memberId = GetMemberId();
        if (!await CanPayForClubAsync(memberId, clubId)) return Denied();
        dto.FkClubId = clubId;
        dto.PaidByMemberId = memberId;
        var paymentId = await _service.RecordPublicOfflinePaymentAsync(duesId, dto, attachment, _env);
        return Ok(new { paymentId, message = "Submitted for approval." });
    }
}

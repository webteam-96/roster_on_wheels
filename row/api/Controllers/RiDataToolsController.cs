using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Rotary International data tools for a club: officer compare (ROW vs RI for the six RI-reported positions) and the
/// transfer-in wizard (people RI lists for the club who are missing in ROW). Reads only RI data the server sync has
/// stored; never calls Rotary.org. Club managers (and the district's managers, Super Admin) only.
/// </summary>
[ApiController]
[Authorize]
[Route("api/clubs/{clubId:int}/ri-tools")]
public class RiDataToolsController : ControllerBase
{
    private readonly string _cs;
    private readonly RiDataToolsService _svc;
    private readonly IAuditLogService _audit;

    public RiDataToolsController(IConfiguration config, RiDataToolsService svc, IAuditLogService audit)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _svc = svc;
        _audit = audit;
    }

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private Task<bool> MayManage(int clubId) => ScopeWriteGuardMiddleware.AllowedAsync(_cs, Me, true, clubId);

    [HttpGet("officers")]
    public async Task<IActionResult> Officers(int clubId, [FromQuery] int? yearId)
    {
        if (!await MayManage(clubId)) return StatusCode(403, new { message = "Only the club's managers see the RI officer compare." });
        var r = await _svc.GetOfficerCompareAsync(clubId, yearId);
        return r is null ? NotFound(new { message = "Club not found." }) : Ok(r);
    }

    [HttpGet("transfer-in")]
    public async Task<IActionResult> TransferIn(int clubId)
    {
        if (!await MayManage(clubId)) return StatusCode(403, new { message = "Only the club's managers use the transfer-in wizard." });
        var r = await _svc.GetTransferInAsync(clubId);
        return r is null ? NotFound(new { message = "Club not found." }) : Ok(r);
    }

    public sealed record TransferInRequest(long RotaryMemberId, string? Mode, int? MemberId);

    [HttpPost("transfer-in")]
    public async Task<IActionResult> TransferInOne(int clubId, [FromBody] TransferInRequest req)
    {
        if (!await MayManage(clubId)) return StatusCode(403, new { message = "Only the club's managers use the transfer-in wizard." });
        if (req.RotaryMemberId <= 0) return BadRequest(new { message = "rotaryMemberId is required." });
        var mode = (req.Mode ?? "").Trim().ToLowerInvariant();
        var r = await _svc.TransferInAsync(clubId, req.RotaryMemberId, mode, req.MemberId);
        if (!r.Ok) return StatusCode(r.Status, new { message = r.Message });
        await _audit.LogAsync(Me, "ri_transfer_in_" + mode, "member", r.MemberId, null,
            new { clubId, rotaryMemberId = req.RotaryMemberId }, HttpContext);
        return Ok(new { message = r.Message, memberId = r.MemberId });
    }
}

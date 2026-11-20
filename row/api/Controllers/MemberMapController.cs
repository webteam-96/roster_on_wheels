using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Member map and business directory (Services/MemberMapService.cs). A member manages only their own pin and listing
/// (the id comes from the token, never the URL). Maps and the directory search are read by members of that club or
/// district and by whoever manages it; reviews need someone who manages the listing's club or district. The club
/// website reads approved listings of the club's district anonymously.
/// </summary>
[ApiController]
[Authorize]
public class MemberMapController : ControllerBase
{
    private readonly MemberMapService _map;
    private readonly string _cs;

    public MemberMapController(MemberMapService map, IConfiguration configuration)
    {
        _map = map;
        _cs = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private Task<bool> ReadsAsync(bool isClub, int scopeId) =>
        MemberId > 0 ? ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, MemberId, isClub, scopeId) : Task.FromResult(false);

    private Task<bool> ManagesAsync(bool isClub, int scopeId) =>
        MemberId > 0 ? ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId, isClub, scopeId) : Task.FromResult(false);

    private ObjectResult Forbidden(string what) => StatusCode(403, new { message = what });
    private ObjectResult NoMember() => StatusCode(403, new { message = "Sign in as a member to do this." });

    // ───────────── map ─────────────

    [HttpGet("api/member-map/me")]
    public async Task<IActionResult> MyPin() => MemberId > 0 ? Ok(await _map.MyPinAsync(MemberId)) : NoMember();

    [HttpPut("api/member-map/me")]
    public async Task<IActionResult> SavePin([FromBody] SaveMapPinDto dto) =>
        MemberId > 0 ? Ok(await _map.SavePinAsync(MemberId, dto)) : NoMember();

    [HttpGet("api/clubs/{clubId:int}/member-map")]
    public async Task<IActionResult> ClubMap(int clubId) =>
        await ReadsAsync(true, clubId) ? Ok(await _map.MapAsync(true, clubId)) : Forbidden("Only the club's members can see its map.");

    [HttpGet("api/districts/{districtId:int}/member-map")]
    public async Task<IActionResult> DistrictMap(int districtId) =>
        await ReadsAsync(false, districtId) ? Ok(await _map.MapAsync(false, districtId)) : Forbidden("Only the district's members can see its map.");

    // ───────────── business directory ─────────────

    [HttpGet("api/business-directory/me")]
    public async Task<IActionResult> MyListing() => MemberId > 0 ? Ok(await _map.MyListingAsync(MemberId)) : NoMember();

    [HttpPut("api/business-directory/me")]
    public async Task<IActionResult> SaveListing([FromBody] SaveBusinessListingDto dto) =>
        MemberId > 0 ? Ok(await _map.SaveListingAsync(MemberId, dto)) : NoMember();

    [HttpDelete("api/business-directory/me")]
    public async Task<IActionResult> DeleteListing()
    {
        if (MemberId <= 0) return NoMember();
        return await _map.DeleteMyListingAsync(MemberId) ? NoContent() : NotFound(new { message = "You have no listing." });
    }

    [HttpGet("api/districts/{districtId:int}/business-directory")]
    public async Task<IActionResult> Search(int districtId, [FromQuery] string? q) =>
        await ReadsAsync(false, districtId) ? Ok(await _map.SearchAsync(districtId, q)) : Forbidden("Only the district's members can search its directory.");

    [HttpGet("api/clubs/{clubId:int}/business-directory/review")]
    public async Task<IActionResult> ClubReview(int clubId, [FromQuery] string? status) =>
        await ManagesAsync(true, clubId) ? Ok(await _map.ReviewListAsync(true, clubId, status)) : Forbidden("Only the club's admins can review its listings.");

    [HttpGet("api/districts/{districtId:int}/business-directory/review")]
    public async Task<IActionResult> DistrictReview(int districtId, [FromQuery] string? status) =>
        await ManagesAsync(false, districtId) ? Ok(await _map.ReviewListAsync(false, districtId, status)) : Forbidden("Only the district's admins can review its listings.");

    [HttpPost("api/business-directory/{id:int}/review")]
    public async Task<IActionResult> Review(int id, [FromBody] ReviewBusinessListingDto dto)
    {
        var scope = await _map.ListingScopeAsync(id);
        if (scope == null) return NotFound(new { message = "Listing not found." });
        if (!await ManagesAsync(true, scope.ClubId) && !await ManagesAsync(false, scope.DistrictId))
            return Forbidden("Only the club's or the district's admins can review this listing.");
        return Ok(await _map.ReviewAsync(id, dto, MemberId));
    }

    [AllowAnonymous]
    [HttpGet("api/public/club/{clubId:int}/business-directory")]
    public async Task<IActionResult> PublicSearch(int clubId, [FromQuery] string? q) =>
        await _map.DistrictOfClubAsync(clubId) is { } districtId
            ? Ok(await _map.SearchAsync(districtId, q))
            : NotFound(new { message = "Club not found." });
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>Club stories with editor approval (gap #6). Members submit under api/club-stories (outside the
/// api/clubs/{id} write guard, which admits managers only); every action checks club membership or the editor office
/// here. Approved stories are public on the club website.</summary>
[ApiController]
[Authorize]
public class ClubStoriesController : ControllerBase
{
    private readonly StoryService _service;
    private readonly string _cs;

    public ClubStoriesController(StoryService service, IConfiguration config)
    {
        _service = service;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private ObjectResult Forbidden(string message) => StatusCode(403, new { message });

    /// <summary>null = may use the club's stories (member or editor), else the refusal.</summary>
    private async Task<(ObjectResult? Deny, bool Editor)> AccessAsync(int clubId)
    {
        if (UserId <= 0 || !await KillSwitchHelper.IsClubDrillReachableAsync(_cs, clubId)) return (Forbidden("You do not have access to this club."), false);
        var editor = await _service.IsEditorAsync(clubId, UserId);
        if (!editor && !await _service.IsMemberAsync(clubId, UserId)) return (Forbidden("Only the club's members can send it stories."), false);
        return (null, editor);
    }

    [HttpGet("api/club-stories/{clubId:int}")]
    public async Task<ActionResult> List(int clubId, [FromQuery] string? status)
    {
        var (deny, editor) = await AccessAsync(clubId);
        if (deny != null) return deny;
        return Ok(new { canReview = editor, items = await _service.ListAsync(clubId, UserId, editor, string.IsNullOrWhiteSpace(status) ? null : status) });
    }

    [HttpPost("api/club-stories/{clubId:int}")]
    public async Task<ActionResult> Submit(int clubId, [FromBody] StoryDto dto)
    {
        var (deny, _) = await AccessAsync(clubId);
        if (deny != null) return deny;
        if (StoryService.Validate(dto) is { } error) return BadRequest(new { message = error });
        return Ok(new { id = await _service.SubmitAsync(clubId, dto, UserId) });
    }

    [HttpPut("api/club-stories/{clubId:int}/{id:int}")]
    public async Task<ActionResult> Edit(int clubId, int id, [FromBody] StoryDto dto)
    {
        var (deny, _) = await AccessAsync(clubId);
        if (deny != null) return deny;
        if (StoryService.Validate(dto) is { } error) return BadRequest(new { message = error });
        return await _service.EditAsync(clubId, id, dto, UserId) ? Ok(new { id })
            : NotFound(new { message = "You can edit only your own stories that are waiting or sent back for changes." });
    }

    [HttpDelete("api/club-stories/{clubId:int}/{id:int}")]
    public async Task<ActionResult> Withdraw(int clubId, int id)
    {
        var (deny, _) = await AccessAsync(clubId);
        if (deny != null) return deny;
        return await _service.WithdrawAsync(clubId, id, UserId) ? Ok(new { id }) : NotFound(new { message = "Story not found." });
    }

    [HttpPost("api/club-stories/{clubId:int}/{id:int}/review")]
    public async Task<ActionResult> Review(int clubId, int id, [FromBody] StoryReviewDto dto)
    {
        var (deny, editor) = await AccessAsync(clubId);
        if (deny != null) return deny;
        if (!editor) return Forbidden("Only the club's story editors can review stories.");
        if (StoryService.ValidateReview(dto) is { } error) return BadRequest(new { message = error });
        return await _service.ReviewAsync(clubId, id, dto, UserId) ? Ok(new { id })
            : NotFound(new { message = "No story waiting for review was found." });
    }

    /// <summary>Approved stories for the club website.</summary>
    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    [HttpGet("api/public/club/{clubId:int}/stories")]
    public async Task<ActionResult> Public(int clubId, [FromQuery] int limit = 30) => Ok(await _service.ApprovedAsync(clubId, limit));
}

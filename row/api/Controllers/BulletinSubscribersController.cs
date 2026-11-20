using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>Bulletin subscribers who are not members (gap #6): public double opt-in sign-up, confirm and
/// unsubscribe pages, and the managers' list. Managers' writes are also guarded by ScopeWriteGuardMiddleware.</summary>
[ApiController]
public class BulletinSubscribersController : ControllerBase
{
    private readonly BulletinSubscriberService _service;
    private readonly AdminYearGuard _guard;
    private readonly string _cs;

    public BulletinSubscribersController(BulletinSubscriberService service, AdminYearGuard guard, IConfiguration config)
    {
        _service = service;
        _guard = guard;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private const string Done = "Thank you. If this address is not subscribed yet, we have sent it a link to confirm.";
    private ContentResult Html(string title, string message, string? button = null, int status = 200) =>
        new() { Content = BulletinSubscriberService.Page(title, message, button), ContentType = "text/html; charset=utf-8", StatusCode = status };

    [AllowAnonymous]
    [EnableRateLimiting("join-form")]
    [RequestSizeLimit(4096)]
    [HttpPost("api/public/club/{clubId:int}/bulletin/subscribe")]
    public async Task<ActionResult> SignUp(int clubId, [FromBody] BulletinSignupDto dto)
    {
        if (!string.IsNullOrEmpty(dto.Website)) return Ok(new { message = Done }); // honeypot: a bot, answer as usual
        var email = BulletinSubscriberService.NormaliseEmail(dto.Email);
        if (email == null) return BadRequest(new { message = "Enter a valid email address." });
        if ((dto.Name?.Length ?? 0) > 120) return BadRequest(new { message = "The name can be at most 120 characters." });
        try
        {
            return await _service.SignUpAsync(clubId, email, dto.Name) ? Ok(new { message = Done }) : NotFound(new { message = "Club not found." });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [EnableRateLimiting("unsubscribe")]
    [HttpGet("api/public/bulletin/confirm/{token}")]
    public async Task<ContentResult> ConfirmPage(string token) => await _service.ConfirmInfoAsync(token) is { } club
        ? Html("Confirm your subscription", $"Confirm that you want to receive the email bulletin of {club}.", "Confirm")
        : Html("Link not valid", "This confirmation link has expired or was already used. Sign up again on the club website.", null, 404);

    [AllowAnonymous]
    [EnableRateLimiting("unsubscribe")]
    [RequestSizeLimit(4096)]
    [HttpPost("api/public/bulletin/confirm/{token}")]
    public async Task<ContentResult> Confirm(string token) => await _service.ConfirmAsync(token)
        ? Html("Subscription confirmed", "You will receive the club's next bulletins. Each one has a link to unsubscribe.")
        : Html("Link not valid", "This confirmation link has expired or was already used. Sign up again on the club website.", null, 404);

    [AllowAnonymous]
    [EnableRateLimiting("unsubscribe")]
    [HttpGet("api/public/bulletin/unsubscribe/{token}")]
    public async Task<ContentResult> UnsubscribePage(string token) => await _service.UnsubscribeInfoAsync(token) switch
    {
        null => Html("Link not valid", "This unsubscribe link is not valid.", null, 404),
        { Subscribed: false } i => Html("Unsubscribed", $"You no longer receive the bulletin of {i.Club}."),
        var i => Html("Unsubscribe", $"Stop receiving the email bulletin of {i.Value.Club}?", "Unsubscribe"),
    };

    /// <summary>The page's button, and a mail client's one-click request (RFC 8058).</summary>
    [AllowAnonymous]
    [EnableRateLimiting("unsubscribe")]
    [RequestSizeLimit(4096)]
    [HttpPost("api/public/bulletin/unsubscribe/{token}")]
    public async Task<ContentResult> Unsubscribe(string token) => await _service.UnsubscribeAsync(token)
        ? Html("Unsubscribed", "You no longer receive this bulletin.")
        : Html("Link not valid", "This unsubscribe link is not valid.", null, 404);

    [Authorize]
    [HttpGet("api/clubs/{clubId:int}/bulletin-subscribers")]
    public async Task<ActionResult> List(int clubId)
    {
        if (!await ManagerAsync(clubId)) return StatusCode(403, new { message = "Only the club's managers can see its subscribers." });
        return Ok(await _service.ListAsync(clubId));
    }

    [Authorize]
    [HttpDelete("api/clubs/{clubId:int}/bulletin-subscribers/{id:int}")]
    public async Task<ActionResult> Remove(int clubId, int id)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        return await _service.RemoveAsync(clubId, id) ? Ok(new { id }) : NotFound(new { message = "Subscriber not found." });
    }

    private async Task<bool> ManagerAsync(int clubId) =>
        int.TryParse(User.FindFirst("memberId")?.Value, out var m) && m > 0
        && await KillSwitchHelper.IsClubDrillReachableAsync(_cs, clubId)
        && await ScopeWriteGuardMiddleware.AllowedAsync(_cs, m, true, clubId);
}

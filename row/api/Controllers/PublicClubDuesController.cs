using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Unauthenticated public pay surface for Club Dues. Access is gated by a signed
// ClubDuesAccessToken (the "copy payment link" an officer shares, the link in the
// email reminders, or the link surfaced in the mobile app). The token binds
// the request to one dues campaign + one club, so a link can only pay for its own club.
// NOTE: these links are deliberately non-expiring — anyone the link is forwarded to
// keeps access to this club's pay page (see ClubDuesAccessToken).
[ApiController]
[Route("api/public/club-dues")]
[AllowAnonymous]
public class PublicClubDuesController : ControllerBase
{
    private readonly IClubDuesService _service;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;

    public PublicClubDuesController(IClubDuesService service, IWebHostEnvironment env, IConfiguration config)
    {
        _service = service;
        _env = env;
        _config = config;
    }

    private bool ValidToken(string? token, int duesId, int clubId, out string? error)
    {
        error = null;
        var secret = _config["JwtSettings:Secret"] ?? "";
        if (!ClubDuesAccessToken.TryVerify(token, secret, out var payload, out error)) return false;
        if (payload!.DuesId != duesId || payload.ClubId != clubId) { error = "This link is not valid for this club."; return false; }
        return true;
    }

    [HttpGet("{id}")]
    public async Task<ActionResult> Get(int id, [FromQuery] int clubId, [FromQuery] string? token)
    {
        if (!ValidToken(token, id, clubId, out var error)) return Unauthorized(new { message = error });
        var dto = await _service.GetPublicDuesAsync(id, clubId);
        if (dto == null) return NotFound(new { message = "District dues not found." });
        return Ok(dto);
    }

    [HttpPost("{id}/pay")]
    public async Task<ActionResult> Pay(int id, [FromQuery] string? token, [FromBody] PublicClubDuesPaymentSubmitDto dto)
    {
        if (!ValidToken(token, id, dto.FkClubId, out var error)) return Unauthorized(new { message = error });
        var result = await _service.CreatePaymentOrderAsync(id, dto);
        return Ok(result);
    }

    [HttpPost("{id}/offline-payment")]
    public async Task<ActionResult> Offline(int id, [FromQuery] string? token, [FromForm] RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment)
    {
        if (!ValidToken(token, id, dto.FkClubId, out var error)) return Unauthorized(new { message = error });
        var paymentId = await _service.RecordPublicOfflinePaymentAsync(id, dto, attachment, _env);
        return Ok(new { paymentId, message = "Submitted for approval." });
    }

    // Offline-payment account picker for the token-gated public pay page — brings this surface to
    // parity with the admin/district-admin/officer offline dialogs, which all already offer a picker.
    [HttpGet("{id}/offline-accounts")]
    public async Task<ActionResult> GetOfflineAccounts(int id, [FromQuery] int clubId, [FromQuery] string? token)
    {
        if (!ValidToken(token, id, clubId, out var error)) return Unauthorized(new { message = error });
        return Ok(await _service.GetOfflineAccountOptionsAsync(id, clubId));
    }

    // Razorpay checkout callback — verifies the payment signature (no token needed).
    [HttpPost("{id}/verify-payment")]
    public async Task<ActionResult> VerifyPayment(int id, [FromBody] ClubDuesVerifyDto dto)
    {
        var result = await _service.VerifyPaymentAsync(id, dto);
        return Ok(result);
    }

    [HttpPost("webhook")]
    public async Task<ActionResult> Webhook()
    {
        using var reader = new StreamReader(Request.Body);
        var payload = await reader.ReadToEndAsync();
        var sig = Request.Headers["X-Razorpay-Signature"].ToString();
        try { await _service.HandleWebhookAsync(payload, sig); return Ok(); }
        catch (UnauthorizedAccessException) { return Unauthorized(); }
    }

    // Public report (no token) — district-wide club paid/unpaid summary.
    [HttpGet("{id}/report")]
    public async Task<ActionResult> Report(int id)
    {
        var r = await _service.GetPublicReportAsync(id);
        if (r == null) return NotFound(new { message = "Not found." });
        return Ok(r);
    }
}

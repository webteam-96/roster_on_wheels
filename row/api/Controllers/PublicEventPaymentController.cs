using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/public/event-payment")]
public class PublicEventPaymentController : ControllerBase
{
    private readonly IEventPaymentLinkService _service;
    private readonly IConfiguration _config;

    public PublicEventPaymentController(IEventPaymentLinkService service, IConfiguration config)
    {
        _service = service;
        _config = config;
    }

    [HttpGet("{linkId}")]
    public async Task<ActionResult> GetPublicLinkDetails(int linkId)
    {
        var result = await _service.GetPublicLinkDetailsAsync(linkId);
        if (result == null) return NotFound(new { message = "Payment link not found or inactive." });
        return Ok(result);
    }

    [HttpGet("{linkId}/districts/{districtId}/clubs")]
    public async Task<ActionResult> GetClubsForDistrict(int linkId, int districtId)
    {
        var result = await _service.GetClubsForDistrictAsync(linkId, districtId);
        return Ok(result);
    }

    // The pay page's "find your name" step, anonymous by design: same rules as the dues search.
    [EnableRateLimiting("member-search")]
    [HttpGet("{linkId}/search-members")]
    public async Task<ActionResult> SearchMembers(int linkId, [FromQuery] int? districtId, [FromQuery] int? clubId, [FromQuery] string? query, [FromQuery] string? k)
    {
        if (!MobileDuesAccessToken.IsPayLinkKey(k, linkId, _config["JwtSettings:Secret"] ?? "", MobileDuesAccessToken.EventLinkKind))
            return StatusCode(403, new { message = "This payment link is out of date. Ask your club for the current link." });
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 2) return Ok(Array.Empty<object>());
        var result = await _service.SearchMembersForLinkAsync(linkId, districtId, clubId, query);
        return Ok(result);
    }

    [EnableRateLimiting("auth")]
    [HttpPost("{linkId}/send-otp")]
    public async Task<ActionResult> SendOtp(int linkId, [FromBody] SendOtpRequestDto dto)
    {
        try
        {
            var result = await _service.SendPaymentOtpAsync(linkId, dto);
            return Ok(new { success = result, message = result ? "OTP sent successfully." : "Failed to send OTP." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [EnableRateLimiting("auth")]
    [HttpPost("{linkId}/verify-otp")]
    public async Task<ActionResult> VerifyOtp(int linkId, [FromBody] VerifyOtpRequestDto dto)
    {
        try
        {
            var token = await _service.VerifyOtpAsync(linkId, dto);
            return Ok(new { success = token != null, message = token != null ? "OTP verified." : "Invalid or expired OTP.", token });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [HttpPost("{linkId}/create-order")]
    public async Task<ActionResult> CreatePaymentOrder(int linkId, [FromBody] PublicPaymentSubmitDto dto)
    {
        // Who pays comes from the verify-otp token, never from the request. A member's name and contacts come from their record.
        if (!EventPayerToken.TryVerify(Request.Headers["X-Payer-Token"].ToString(), linkId, _config["JwtSettings:Secret"] ?? "", out var memberId, out var email))
            return Unauthorized(new { message = "Verify the code sent to your email first." });
        dto.FkMemberProfileId = memberId > 0 ? memberId : null;
        dto.Email = memberId > 0 ? null : email;
        if (memberId > 0) { dto.MemberName = null; dto.Mobile = null; }
        try
        {
            var result = await _service.CreatePaymentOrderAsync(linkId, dto);
            return Ok(result);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("{linkId}/verify-payment")]
    public async Task<ActionResult> VerifyPayment(int linkId, [FromQuery] string orderId, [FromQuery] int memberPaymentId)
    {
        try
        {
            var result = await _service.VerifyPaymentAsync(linkId, orderId, memberPaymentId);
            return Ok(result);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("webhook")]
    public async Task<ActionResult> HandleWebhook()
    {
        using var reader = new StreamReader(Request.Body);
        var payload = await reader.ReadToEndAsync();
        try
        {
            await _service.HandleWebhookAsync(payload);
            return Ok();
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}

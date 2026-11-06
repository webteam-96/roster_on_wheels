using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/public/membership-dues")]
public class PublicMembershipDuesController : ControllerBase
{
    private readonly IMembershipDuesService _service;
    private readonly IConfiguration _config;

    public PublicMembershipDuesController(IMembershipDuesService service, IConfiguration config)
    {
        _service = service;
        _config = config;
    }

    [HttpGet("{id}")]
    public async Task<ActionResult> GetPublicDues(int id)
    {
        var result = await _service.GetPublicDuesAsync(id);
        if (result == null) return NotFound(new { message = "Club dues not found or inactive." });
        return Ok(result);
    }

    // The pay page's "find your name" step, anonymous by design: it needs the key only the real pay link carries, a
    // typed name, and answers id and name only (the OTP goes to the email on record, so the page needs no contact details).
    [EnableRateLimiting("member-search")]
    [HttpGet("{id}/search-members")]
    public async Task<ActionResult> SearchMembers(int id, [FromQuery] string? query, [FromQuery] string? k)
    {
        if (!MobileDuesAccessToken.IsPayLinkKey(k, id, _config["JwtSettings:Secret"] ?? ""))
            return StatusCode(403, new { message = "This payment link is out of date. Ask your club for the current link." });
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 2) return Ok(Array.Empty<object>());
        var result = await _service.SearchMembersAsync(id, query);
        return Ok(result);
    }

    // Mobile deep-link verification — the public /pay/dues/{id} page calls
    // this with ?memberId=&token= it received from the Flutter app. If the
    // HMAC signature checks out AND the duesId in the token matches the
    // route, return the member's dues status so the page can skip OTP and
    // jump straight to the member-specific paid/unpaid view.
    [HttpGet("{id}/verify-mobile-token")]
    public async Task<ActionResult> VerifyMobileToken(int id, [FromQuery] int memberId, [FromQuery] string token)
    {
        var secret = _config["JwtSettings:Secret"] ?? "";
        if (!MobileDuesAccessToken.TryVerify(token, secret, out var payload, out var error)
            || payload == null)
            return Unauthorized(new { message = error ?? "Invalid token." });

        if (payload.DuesId != id || payload.MemberId != memberId)
            return Unauthorized(new { message = "Token does not match this club dues / member." });

        var status = await _service.GetMemberDuesStatusAsync(id, memberId);
        if (status == null) return NotFound(new { message = "Member dues status not found." });
        return Ok(new { memberId, duesId = id, status });
    }

    // Holds the member's contact details and fees, so it needs the token verify-otp issued for this dues and member.
    [HttpGet("{id}/member/{memberProfileId}/status")]
    public async Task<ActionResult> GetMemberDuesStatus(int id, int memberProfileId, [FromQuery] string? token)
    {
        if (!MobileDuesAccessToken.TryVerify(token, _config["JwtSettings:Secret"] ?? "", out var payload, out _)
            || payload == null || payload.DuesId != id || payload.MemberId != memberProfileId)
            return Unauthorized(new { message = "Verify the code sent to your email first." });
        var result = await _service.GetMemberDuesStatusAsync(id, memberProfileId);
        if (result == null) return NotFound(new { message = "Member dues status not found." });
        return Ok(result);
    }

    [EnableRateLimiting("auth")]
    [HttpPost("{id}/send-otp")]
    public async Task<ActionResult> SendOtp(int id, [FromBody] SendOtpRequestDto dto)
    {
        try
        {
            var result = await _service.SendPaymentOtpAsync(id, dto);
            return Ok(new { success = result, message = result ? "OTP sent successfully." : "Failed to send OTP." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [EnableRateLimiting("auth")]
    [HttpPost("{id}/verify-otp")]
    public async Task<ActionResult> VerifyOtp(int id, [FromBody] VerifyOtpRequestDto dto)
    {
        try
        {
            var result = await _service.VerifyOtpAsync(id, dto);
            var token = result && dto.MemberProfileId is > 0
                ? MobileDuesAccessToken.Generate(id, dto.MemberProfileId.Value, _config["JwtSettings:Secret"] ?? "", 1)
                : null;
            return Ok(new { success = result, message = result ? "OTP verified." : "Invalid or expired OTP.", token });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    // Who pays comes from this token (verify-otp, or the app's signed link), never from the request.
    private bool TryPayer(int duesId, out int memberId)
    {
        memberId = 0;
        if (!MobileDuesAccessToken.TryVerify(Request.Headers["X-Payer-Token"].ToString(), _config["JwtSettings:Secret"] ?? "", out var payload, out _)
            || payload == null || payload.DuesId != duesId || payload.MemberId <= 0) return false;
        memberId = payload.MemberId;
        return true;
    }

    [HttpPost("{id}/pay")]
    public async Task<ActionResult> CreatePaymentOrder(int id, [FromBody] PublicDuesPaymentSubmitDto dto)
    {
        if (!TryPayer(id, out var payer)) return Unauthorized(new { message = "Verify the code sent to your email first." });
        dto.FkMemberProfileId = payer;
        try
        {
            var result = await _service.CreatePaymentOrderAsync(id, dto);
            return Ok(result);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{id}/offline-payment")]
    public async Task<ActionResult> SubmitOfflinePayment(int id, [FromForm] RecordOfflineDuesPaymentDto dto, IFormFile? attachment)
    {
        if (!TryPayer(id, out var payer)) return Unauthorized(new { message = "Verify the code sent to your email first." });
        dto.FkMemberProfileId = payer;
        if (attachment != null && attachment.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg" };
            var extension = System.IO.Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Only images (JPG, JPEG, PNG, GIF, WEBP, BMP, SVG) or PDF are allowed." });
        }

        try
        {
            var env = HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>();
            var paymentId = await _service.RecordPublicOfflinePaymentAsync(id, dto, attachment, env);
            return Ok(new { paymentId, message = "Offline payment submitted for approval." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [EnableRateLimiting("payment-status")]
    [HttpGet("{id}/verify-payment")]
    public async Task<ActionResult> VerifyPayment(int id, [FromQuery] string orderId, [FromQuery] int paymentId)
    {
        try
        {
            var result = await _service.VerifyPaymentAsync(id, orderId, paymentId);
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
            await _service.HandleWebhookAsync(payload, Request.Headers["x-webhook-signature"].ToString(), Request.Headers["x-webhook-timestamp"].ToString());
            return Ok();
        }
        catch (UnauthorizedAccessException) { return Unauthorized(); }
        catch (CashfreeWebhook.LookupFailedException) { return StatusCode(502); } // Cashfree retries; the row is still unpaid
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}

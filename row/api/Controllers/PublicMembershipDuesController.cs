using Microsoft.AspNetCore.Mvc;
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

    [HttpGet("{id}/search-members")]
    public async Task<ActionResult> SearchMembers(int id, [FromQuery] string? query)
    {
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

    [HttpGet("{id}/member/{memberProfileId}/status")]
    public async Task<ActionResult> GetMemberDuesStatus(int id, int memberProfileId)
    {
        var result = await _service.GetMemberDuesStatusAsync(id, memberProfileId);
        if (result == null) return NotFound(new { message = "Member dues status not found." });
        return Ok(result);
    }

    [HttpPost("{id}/send-otp")]
    public async Task<ActionResult> SendOtp(int id, [FromBody] SendOtpRequestDto dto)
    {
        try
        {
            var result = await _service.SendPaymentOtpAsync(id, dto);
            return Ok(new { success = result, message = result ? "OTP sent successfully." : "Failed to send OTP." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [HttpPost("{id}/verify-otp")]
    public async Task<ActionResult> VerifyOtp(int id, [FromBody] VerifyOtpRequestDto dto)
    {
        try
        {
            var result = await _service.VerifyOtpAsync(id, dto);
            return Ok(new { success = result, message = result ? "OTP verified." : "Invalid or expired OTP." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [HttpPost("{id}/pay")]
    public async Task<ActionResult> CreatePaymentOrder(int id, [FromBody] PublicDuesPaymentSubmitDto dto)
    {
        try
        {
            var result = await _service.CreatePaymentOrderAsync(id, dto);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{id}/offline-payment")]
    public async Task<ActionResult> SubmitOfflinePayment(int id, [FromForm] RecordOfflineDuesPaymentDto dto, IFormFile? attachment)
    {
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
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("{id}/verify-payment")]
    public async Task<ActionResult> VerifyPayment(int id, [FromQuery] string orderId, [FromQuery] int paymentId)
    {
        try
        {
            var result = await _service.VerifyPaymentAsync(id, orderId, paymentId);
            return Ok(result);
        }
        catch (Exception ex)
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
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("{id}/report")]
    public async Task<ActionResult> GetPublicReport(int id)
    {
        var result = await _service.GetPublicReportAsync(id);
        if (result == null) return NotFound(new { message = "Club dues not found." });
        return Ok(result);
    }

    // Same XLSX the SuperAdmin/Club Admin "Download Report" export produces —
    // exposed here (no auth) so the public Report Link page's Download button
    // gives an identical file instead of building its own simplified CSV.
    [HttpGet("{id}/report/export")]
    public async Task<ActionResult> ExportPublicReport(int id)
    {
        try
        {
            var bytes = await _service.ExportMembersCsvAsync(id);
            var ts = DateTime.Now.ToString("ddMMyyyy_HHmmss");
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"membership_dues_report_{id}_{ts}.xlsx");
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to export: {ex.Message}" });
        }
    }
}

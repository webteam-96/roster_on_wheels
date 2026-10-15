using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/public/event-payment")]
public class PublicEventPaymentController : ControllerBase
{
    private readonly IEventPaymentLinkService _service;

    public PublicEventPaymentController(IEventPaymentLinkService service)
    {
        _service = service;
    }

    [HttpGet("{linkId}/report")]
    public async Task<ActionResult> GetPublicReport(int linkId)
    {
        var result = await _service.GetPublicReportAsync(linkId);
        if (result == null) return NotFound(new { message = "Payment link not found." });
        return Ok(result);
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

    [HttpGet("{linkId}/search-members")]
    public async Task<ActionResult> SearchMembers(int linkId, [FromQuery] int? districtId, [FromQuery] int? clubId, [FromQuery] string? query)
    {
        var result = await _service.SearchMembersForLinkAsync(linkId, districtId, clubId, query);
        return Ok(result);
    }

    [HttpPost("{linkId}/send-otp")]
    public async Task<ActionResult> SendOtp(int linkId, [FromBody] SendOtpRequestDto dto)
    {
        try
        {
            var result = await _service.SendPaymentOtpAsync(linkId, dto);
            return Ok(new { success = result, message = result ? "OTP sent successfully." : "Failed to send OTP." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [HttpPost("{linkId}/verify-otp")]
    public async Task<ActionResult> VerifyOtp(int linkId, [FromBody] VerifyOtpRequestDto dto)
    {
        try
        {
            var result = await _service.VerifyOtpAsync(linkId, dto);
            return Ok(new { success = result, message = result ? "OTP verified." : "Invalid or expired OTP." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [HttpPost("{linkId}/create-order")]
    public async Task<ActionResult> CreatePaymentOrder(int linkId, [FromBody] PublicPaymentSubmitDto dto)
    {
        try
        {
            var result = await _service.CreatePaymentOrderAsync(linkId, dto);
            return Ok(result);
        }
        catch (Exception ex)
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
}

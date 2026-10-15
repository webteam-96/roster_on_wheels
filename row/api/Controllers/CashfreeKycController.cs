using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/cashfree-kyc")]
[Authorize]
public class CashfreeKycController : ControllerBase
{
    private readonly ICashfreeKycService _service;

    public CashfreeKycController(ICashfreeKycService service)
    {
        _service = service;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    [HttpGet("")]
    public async Task<ActionResult> GetAll()
    {
        if (!IsSuperAdmin()) return Forbid();

        var result = await _service.GetAllAsync();
        return Ok(result);
    }

    [HttpPost("send-otp")]
    public async Task<ActionResult> SendOtp()
    {
        if (!IsSuperAdmin()) return Forbid();

        try
        {
            var message = await _service.SendOtpAsync();
            return Ok(new { message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("verify-and-save")]
    public async Task<ActionResult> VerifyOtpAndSave([FromBody] CashfreeVerifyOtpDto dto)
    {
        if (!IsSuperAdmin()) return Forbid();

        try
        {
            var result = await _service.VerifyOtpAndSaveAsync(dto, GetUserId());
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{kycId}")]
    public async Task<ActionResult> Delete(int kycId)
    {
        if (!IsSuperAdmin()) return Forbid();

        await _service.DeleteAsync(kycId, GetUserId());
        return Ok(new { message = "KYC record deleted successfully." });
    }

    [HttpPut("{kycId}/toggle-active")]
    public async Task<ActionResult> ToggleActive(int kycId)
    {
        if (!IsSuperAdmin()) return Forbid();

        await _service.ToggleActiveAsync(kycId, GetUserId());
        return Ok(new { message = "KYC record active status toggled successfully." });
    }

    [HttpGet("{kycId}/detail")]
    public async Task<ActionResult> GetVendorDetail(int kycId)
    {
        if (!IsSuperAdmin()) return Forbid();

        try
        {
            var result = await _service.GetVendorDetailAsync(kycId);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    [HttpPost("refresh-all")]
    public async Task<ActionResult> RefreshAllStatus()
    {
        if (!IsSuperAdmin()) return Forbid();

        var count = await _service.RefreshAllStatusAsync(GetUserId());
        return Ok(new { message = $"Refreshed status for {count} vendor(s).", count });
    }

    [HttpPost("sync/{vendorId}")]
    public async Task<ActionResult> SyncVendorFromCashfree(string vendorId)
    {
        if (!IsSuperAdmin()) return Forbid();

        try
        {
            var kycId = await _service.SyncVendorFromCashfreeAsync(vendorId, GetUserId());
            return Ok(new { message = $"Vendor '{vendorId}' synced successfully.", kycId });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{kycId}/refresh")]
    public async Task<ActionResult> RefreshVendorStatus(int kycId)
    {
        if (!IsSuperAdmin()) return Forbid();

        try
        {
            var status = await _service.RefreshVendorStatusAsync(kycId, GetUserId());
            return Ok(new { message = "Vendor status refreshed.", status });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}

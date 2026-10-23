using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService)
    {
        _authService = authService;
    }

    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<LoginResponseDto>> Login([FromBody] LoginRequestDto request)
    {
        try
        {
            var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString();
            var userAgent = Request.Headers.UserAgent.ToString();
            var result = await _authService.LoginAsync(request, ipAddress, userAgent);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("forgot-password")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<object>> ForgotPassword([FromBody] ForgotPasswordRequestDto request)
    {
        try
        {
            var result = await _authService.ForgotPasswordAsync(request);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("reset-password")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<object>> ResetPassword([FromBody] ResetPasswordRequestDto request)
    {
        try
        {
            var result = await _authService.ResetPasswordAsync(request);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPost("change-password")]
    public async Task<ActionResult<object>> ChangePassword([FromBody] ChangePasswordRequestDto request)
    {
        try
        {
            var memberId = int.Parse(User.FindFirst("memberId")?.Value ?? "0");
            if (memberId == 0)
                return Unauthorized(new { message = "Invalid token." });

            var result = await _authService.ChangePasswordAsync(memberId, request);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>204 while the caller's token is valid. The admin's own server routes (app/api/i18n/translate) use it
    /// to tell signed-in callers from visitors without holding the JWT secret.</summary>
    [Authorize]
    [HttpGet("session")]
    public ActionResult Session() => NoContent();

    [Authorize]
    [HttpPost("logout")]
    public ActionResult Logout()
    {
        // JWT is stateless - client removes the token
        return Ok(new { message = "Logged out successfully." });
    }

    [Authorize]
    [HttpGet("login-logs")]
    public async Task<ActionResult> GetLoginLogs(
        [FromQuery] string search = "",
        [FromQuery] string status = "",
        [FromQuery] DateTime? fromDate = null,
        [FromQuery] DateTime? toDate = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (!roles.Contains("SuperAdmin"))
            return Forbid();

        var (items, totalCount) = await _authService.GetLoginLogsAsync(search, status, fromDate, toDate, page, pageSize);
        return Ok(new { items, totalCount, page, pageSize });
    }
}

using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
public class MobileAuthController : ControllerBase
{
    private readonly IMobileAuthService _mobileAuthService;
    private readonly ILogger<MobileAuthController> _logger;
    private readonly IConfiguration _config;

    private readonly IAuthService _authService;

    public MobileAuthController(IMobileAuthService mobileAuthService, IAuthService authService, ILogger<MobileAuthController> logger, IConfiguration config)
    {
        _mobileAuthService = mobileAuthService;
        _logger = logger;
        _config = config;
        _authService = authService;
    }

    // ── Mobile: Email + password login (public) ─────────────────
    [HttpPost("api/mobile/auth/login")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult> Login([FromBody] MobilePasswordLoginDto dto)
    {
        try
        {
            return Ok(await _mobileAuthService.LoginWithPasswordAsync(dto));
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (UnauthorizedAccessException ex) { return Unauthorized(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Mobile password login failed.");
            return StatusCode(500, new { message = "Sign-in failed." });
        }
    }

    // ── Mobile: set / reset password by email (public) ──────────
    // Any member may ask; the reply never says whether the email exists.
    [HttpPost("api/mobile/auth/forgot-password")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult> ForgotPassword([FromBody] MobileForgotPasswordDto dto)
    {
        try
        {
            return Ok(await _authService.ForgotPasswordAsync(new ForgotPasswordRequestDto { Email = dto.Email?.Trim() }, anyMember: true));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Mobile forgot-password failed.");
            return StatusCode(500, new { message = "Could not send the email. Please try again." });
        }
    }

    // ── Mobile: Logout (requires auth) ──────────────────────────
    [HttpPost("api/mobile/auth/logout")]
    [Authorize]
    public async Task<ActionResult> Logout([FromBody] MobileLogoutDto dto)
    {
        var memberId = GetMemberId();
        if (memberId == 0) return Unauthorized();
        try
        {
            await _mobileAuthService.LogoutAsync(memberId, dto?.Imei);
            return Ok(new { message = "Logged out" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Mobile logout failed.");
            return StatusCode(500, new { message = "Logout failed." });
        }
    }

    // ── Shared: my-context (requires auth — works for both web and mobile JWT) ──
    [HttpGet("api/auth/my-context")]
    [Authorize]
    public async Task<ActionResult> GetMyContext()
    {
        var memberId = GetMemberId();
        if (memberId == 0) return Unauthorized();

        // Continuous access check — MOBILE sessions only.
        //
        // The non-sync login guard runs at login, but a mobile JWT lives 90 days and rolls
        // itself daily (MobileJwtRefreshMiddleware), so a member removed from their club AFTER
        // logging in keeps full access indefinitely — they never have to log in again, so the
        // guard never gets a chance to run. The app calls my-context on open, which makes this
        // the point where such a session gets caught. 401 sends the app back to login, where the
        // guard then refuses the re-login.
        //
        // Catches removal by ANY path (cascade worker, club terminator, manual removal, SQL) —
        // nothing has to remember to stamp a marker.
        //
        // MOBILE-ONLY BY DESIGN: this endpoint is shared with web. Web/District/Club Admin/AG
        // have their own login rules (AuthService's club-chain check) and must never be gated
        // here — hence the loginType guard. Do not widen it.
        if (User.FindFirst("loginType")?.Value == "mobile")
        {
            try
            {
                await using var conn = new MySqlConnection(_config.GetConnectionString("DefaultConnection"));
                await conn.OpenAsync();
                if (!await NonSyncLoginGuardHelper.IsLoginAllowedAsync(conn, memberId))
                {
                    _logger.LogInformation(
                        "🔒 [MOBILE ACCESS] member={MemberId} has no live club membership — forcing re-login.", memberId);
                    Response.Headers["X-Force-Relogin"] = "1";   // same signal MobileJwtRefreshMiddleware sends
                    return Unauthorized(new { message = NonSyncLoginGuardHelper.DeniedMessage });
                }
            }
            catch (Exception ex)
            {
                // Fail OPEN on infra errors, matching MobileJwtRefreshMiddleware.ShouldForceReloginAsync:
                // a DB blip must not lock every mobile member out of the app.
                _logger.LogWarning(ex, "Mobile access check failed for member={MemberId}; allowing through.", memberId);
            }
        }

        int? familyMemberId = null;
        var famClaim = User.FindFirst("familyMemberId")?.Value;
        if (int.TryParse(famClaim, out var fid)) familyMemberId = fid;

        try
        {
            var result = await _mobileAuthService.GetMyContextAsync(memberId, familyMemberId);
            return Ok(result);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Get my-context failed.");
            return StatusCode(500, new { message = "Failed to load context." });
        }
    }

    private int GetMemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
}

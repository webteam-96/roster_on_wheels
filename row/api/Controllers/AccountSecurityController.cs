using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Account security (gap agent 2026-11-19): second step of sign-in (TOTP / recovery code), self-service MFA
/// enrolment, club MFA policy, and email magic-link sign-in for the web admin and the app.
/// Public endpoints carry the per-IP "auth" rate limit, same as the password logins.
/// </summary>
[ApiController]
public class AccountSecurityController : ControllerBase
{
    private readonly AccountSecurityService _svc;
    private readonly IAuthService _auth;
    private readonly IMobileAuthService _mobile;
    private readonly IConfiguration _config;
    private readonly ILogger<AccountSecurityController> _logger;

    public AccountSecurityController(AccountSecurityService svc, IAuthService auth, IMobileAuthService mobile, IConfiguration config, ILogger<AccountSecurityController> logger)
    {
        _svc = svc; _auth = auth; _mobile = mobile; _config = config; _logger = logger;
    }

    private string? Ip => HttpContext.Connection.RemoteIpAddress?.ToString();
    private string Ua => Request.Headers.UserAgent.ToString();
    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<ActionResult> Run(Func<Task<ActionResult>> f)
    {
        try { return await f(); }
        // Signed in but not allowed (club policy of another club) is 403: a 401 would sign the web admin out.
        catch (UnauthorizedAccessException ex) when (User.Identity?.IsAuthenticated == true) { return StatusCode(403, new { message = ex.Message }); }
        catch (UnauthorizedAccessException ex) { return Unauthorized(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Account security request failed.");
            return StatusCode(500, new { message = "Something went wrong. Please try again." });
        }
    }

    // ───────── web: second step + magic link ─────────

    [HttpPost("api/auth/mfa/setup")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> WebSetup([FromBody] MfaTokenRequest r) =>
        Run(async () => Ok(await _svc.StartSetupFromChallengeAsync(r.MfaToken, AccountSecurityService.Web)));

    [HttpPost("api/auth/mfa/verify")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> WebVerify([FromBody] MfaVerifyRequest r) => Run(async () =>
    {
        var v = await _svc.VerifyChallengeAsync(r.MfaToken, r.Code, AccountSecurityService.Web, Ip, Ua);
        var session = await _auth.BuildSessionForMemberAsync(v.MemberId, v.IsTemporary)
                      ?? throw new UnauthorizedAccessException("You do not have permission to access the admin panel.");
        session.RecoveryCodes = v.RecoveryCodes;
        return Ok(session);
    });

    [HttpPost("api/auth/magic-link")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> WebMagicRequest([FromBody] MagicLinkRequest r) => Run(async () =>
    {
        await using (var conn = await OpenAsync())
            await LoginAllowlistHelper.EnsureMobileAllowedAsync(_config, conn, null, r.Email); // same gate as the password login
        await _svc.RequestMagicLinkAsync(r.Email, AccountSecurityService.Web, Ip);
        return Ok(new { message = AccountSecurityService.MagicRequestedMessage });
    });

    [HttpPost("api/auth/magic-link/consume")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> WebMagicConsume([FromBody] MagicLinkConsumeRequest r) => Run(async () =>
    {
        var memberId = await _svc.ConsumeWebMagicLinkAsync(r.Token, Ip, Ua);
        await using (var conn = await OpenAsync())
        {
            var mfa = await AccountSecurityService.LoginGateAsync(conn, memberId, AccountSecurityService.Web, false, _config);
            if (mfa != null) return Ok(new LoginResponseDto { MfaRequired = true, MfaToken = mfa.MfaToken, MfaSetupRequired = mfa.MfaSetupRequired });
        }
        var session = await _auth.BuildSessionForMemberAsync(memberId)
                      ?? throw new UnauthorizedAccessException("You do not have permission to access the admin panel.");
        return Ok(session);
    });

    // ───────── app: second step + sign-in code ─────────

    [HttpPost("api/mobile/auth/mfa/setup")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> MobileSetup([FromBody] MfaTokenRequest r) =>
        Run(async () => Ok(await _svc.StartSetupFromChallengeAsync(r.MfaToken, AccountSecurityService.Mobile)));

    [HttpPost("api/mobile/auth/mfa/verify")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> MobileVerify([FromBody] MobileMfaVerifyRequest r) => Run(async () =>
    {
        var v = await _svc.VerifyChallengeAsync(r.MfaToken, r.Code, AccountSecurityService.Mobile, Ip, Ua);
        var session = await _mobile.IssueSessionForVerifiedMemberAsync(v.MemberId, Device(r.Imei, r.DeviceToken, r.DeviceName, r.AppVersion), v.IsTemporary);
        session.RecoveryCodes = v.RecoveryCodes;
        return Ok(session);
    });

    [HttpPost("api/mobile/auth/magic-link")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> MobileMagicRequest([FromBody] MagicLinkRequest r) => Run(async () =>
    {
        await _svc.RequestMagicLinkAsync(r.Email, AccountSecurityService.Mobile, Ip);
        return Ok(new { message = AccountSecurityService.MagicRequestedMessage });
    });

    [HttpPost("api/mobile/auth/magic-link/consume")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> MobileMagicConsume([FromBody] MobileMagicCodeRequest r) => Run(async () =>
    {
        var memberId = await _svc.ConsumeMobileCodeAsync(r.Email, r.Code, Ip, Ua);
        await using (var conn = await OpenAsync())
        {
            var mfa = await AccountSecurityService.LoginGateAsync(conn, memberId, AccountSecurityService.Mobile, false, _config);
            if (mfa != null) return Ok(new MobileVerifyOtpResponse { MfaRequired = true, MfaToken = mfa.MfaToken, MfaSetupRequired = mfa.MfaSetupRequired, MemberId = memberId });
        }
        return Ok(await _mobile.IssueSessionForVerifiedMemberAsync(memberId, Device(r.Imei, r.DeviceToken, r.DeviceName, r.AppVersion), false));
    });

    // ───────── signed in: my MFA (web and app tokens) ─────────

    [Authorize, HttpGet("api/account-security/mfa")]
    public Task<ActionResult> Status() => Run(async () => MemberId == 0 ? Unauthorized() : Ok(await _svc.GetStatusAsync(MemberId)));

    [Authorize, HttpPost("api/account-security/mfa/enrol")]
    public Task<ActionResult> Enrol() => Run(async () => MemberId == 0 ? Unauthorized() : Ok(await _svc.StartEnrolAsync(MemberId)));

    [Authorize, HttpPost("api/account-security/mfa/confirm")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> Confirm([FromBody] MfaCodeRequest r) =>
        Run(async () => MemberId == 0 ? Unauthorized() : Ok(new { recoveryCodes = await _svc.ConfirmEnrolAsync(MemberId, r.Code) }));

    [Authorize, HttpPost("api/account-security/mfa/disable")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> Disable([FromBody] MfaCodeRequest r) => Run(async () =>
    {
        if (MemberId == 0) return Unauthorized();
        await _svc.DisableAsync(MemberId, r.Code);
        return Ok(new { message = "Multi-factor sign-in is off." });
    });

    [Authorize, HttpPost("api/account-security/mfa/recovery-codes")]
    [EnableRateLimiting("auth")]
    public Task<ActionResult> RecoveryCodes([FromBody] MfaCodeRequest r) =>
        Run(async () => MemberId == 0 ? Unauthorized() : Ok(new { recoveryCodes = await _svc.RegenerateRecoveryCodesAsync(MemberId, r.Code) }));

    // ───────── club policy (club admin of that club, district admin with all-clubs access, SuperAdmin) ─────────

    [Authorize, HttpGet("api/account-security/club-policy/{clubId:int}")]
    public Task<ActionResult> GetPolicy(int clubId) => Run(async () => Ok(await _svc.GetClubPolicyAsync(MemberId, clubId)));

    [Authorize, HttpPut("api/account-security/club-policy/{clubId:int}")]
    public Task<ActionResult> SetPolicy(int clubId, [FromBody] ClubSecurityPolicyRequest r) =>
        Run(async () => Ok(await _svc.SetClubPolicyAsync(MemberId, clubId, r.RequireMfa)));

    private static MobileVerifyOtpDto Device(string? imei, string? token, string? name, string? version) =>
        new() { Imei = imei, DeviceToken = token, DeviceName = name, AppVersion = version };

    private async Task<MySqlConnection> OpenAsync()
    {
        var c = new MySqlConnection(_config.GetConnectionString("DefaultConnection"));
        await c.OpenAsync();
        return c;
    }
}

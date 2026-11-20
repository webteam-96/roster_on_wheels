using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>Club executives sign in with an emailed code (KIS/ROW/SUB/01 sections 4.1, 4.2; exception 1).</summary>
[ApiController]
[AllowAnonymous]
[Route("api/auth/exec-code")]
public class ExecutiveSignInController : ControllerBase
{
    private readonly ExecutiveSignInService _signIn;
    private readonly IAuthService _auth;
    private readonly AccountSecurityService _accountSecurity;

    public ExecutiveSignInController(ExecutiveSignInService signIn, IAuthService auth, AccountSecurityService accountSecurity)
    {
        _accountSecurity = accountSecurity;
        _signIn = signIn;
        _auth = auth;
    }

    public sealed record CodeRequest(string Email);
    public sealed record VerifyRequest(string Email, string Code);

    [HttpPost("request")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> RequestCode([FromBody] CodeRequest req)
    {
        try
        {
            await _signIn.RequestCodeAsync(req.Email);
            return Ok(new { message = "We sent a code to your email. It works for 10 minutes." });
        }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("verify")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Verify([FromBody] VerifyRequest req)
    {
        try
        {
            var memberId = await _signIn.VerifyCodeAsync(req.Email, req.Code);
            // Account security (gap agent): an emailed code is a first factor only; MFA still applies.
            var mfa = await _accountSecurity.WebLoginGateAsync(memberId);
            if (mfa != null) return Ok(new RotaryApi.DTOs.LoginResponseDto { MfaRequired = true, MfaToken = mfa.MfaToken, MfaSetupRequired = mfa.MfaSetupRequired });
            var session = await _auth.BuildSessionForMemberAsync(memberId);
            return session == null ? StatusCode(403, new { message = "Your account cannot sign in." }) : Ok(session);
        }
        catch (UnauthorizedAccessException ex) { return Unauthorized(new { message = ex.Message }); }
        catch (ClubAdminLimitException ex) { return Conflict(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }
}

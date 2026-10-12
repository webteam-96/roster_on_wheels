using System.Security.Cryptography;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Mobile → Web single-sign-on handoff. A member already authenticated in the MOBILE app requests a
/// one-time token; the mobile app opens the web at /sso?token=… and the web exchanges it for a full
/// web session (JWT) — no password re-entry. Primary use: a SuperAdmin (web-only) jumps from the
/// mobile dashboard straight into the web SuperAdmin portal (global search).
/// Tokens are opaque, single-use, and expire in 2 minutes.
/// </summary>
[ApiController]
public class WebSsoController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IConfiguration _config;
    private readonly IAuthService _auth;

    public WebSsoController(IConfiguration config, IAuthService auth)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _auth = auth;
    }

    private MySqlConnection Conn() => new(_connectionString);
    private int GetMemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static async Task EnsureTableAsync(MySqlConnection conn) =>
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS web_sso_token (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                token VARCHAR(80) NOT NULL,
                fk_member_id INT NOT NULL,
                expires_at DATETIME NOT NULL,
                used_at DATETIME NULL,
                created_date DATETIME NOT NULL,
                UNIQUE KEY uq_web_sso_token (token)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Mobile app (already logged in via mobile JWT) requests a one-time token to open the web logged-in.
    [Authorize]
    [HttpPost("api/mobile/auth/web-sso-token")]
    public async Task<IActionResult> IssueToken()
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Unauthorized();

        // Only members with a web admin role can get a web session.
        var session = await _auth.BuildSessionForMemberAsync(memberId);
        if (session == null) return StatusCode(403, new { message = "This member has no web portal access." });

        using var conn = Conn();
        await conn.OpenAsync();
        await EnsureTableAsync(conn);

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); // 64-char opaque token
        await conn.ExecuteAsync(@"
            INSERT INTO web_sso_token (token, fk_member_id, expires_at, created_date)
            VALUES (@Token, @Mem, DATE_ADD(NOW(), INTERVAL 2 MINUTE), NOW())",
            new { Token = token, Mem = memberId });

        var frontend = (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
        return Ok(new { token, url = $"{frontend}/sso?token={token}" });
    }

    // Web /sso page exchanges the one-time token for a full web login response. Single-use + short-lived.
    [AllowAnonymous]
    [HttpPost("api/auth/sso-exchange")]
    public async Task<IActionResult> Exchange([FromBody] SsoExchangeRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.Token))
            return BadRequest(new { message = "token required" });

        using var conn = Conn();
        await conn.OpenAsync();
        await EnsureTableAsync(conn);

        // Atomically consume: flip used_at only if the token is currently unused AND unexpired.
        // All-DB-time so there's no app/DB timezone drift on the 2-minute window.
        var consumed = await conn.ExecuteAsync(
            "UPDATE web_sso_token SET used_at = NOW() WHERE token = @T AND used_at IS NULL AND expires_at >= NOW()",
            new { T = req.Token });
        if (consumed == 0) return Unauthorized(new { message = "This sign-in link is invalid, already used, or expired." });

        var memberId = await conn.ExecuteScalarAsync<int>(
            "SELECT fk_member_id FROM web_sso_token WHERE token = @T", new { T = req.Token });

        var session = await _auth.BuildSessionForMemberAsync(memberId);
        if (session == null) return StatusCode(403, new { message = "This member has no web portal access." });
        return Ok(session);
    }

    public class SsoExchangeRequest { public string Token { get; set; } = ""; }
}

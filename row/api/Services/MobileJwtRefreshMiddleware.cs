using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Dapper;
using Microsoft.IdentityModel.Tokens;
using MySqlConnector;

namespace RotaryApi.Services;

// Checks if the current request is authenticated with a mobile JWT (loginType=mobile).
// Two responsibilities:
//   1. Force-relogin enforcement — if member_master_profile.mobile_force_relogin_at
//      is later than the JWT's iat (issued-at) claim, reject the request with 401 so
//      the mobile app drops back to the OTP login screen. Used when a Club Admin
//      changes a member's primary mobile (mobile JWT carries memberId only; without
//      this check the old token would keep working).
//   2. Token rolling — if the token is older than RefreshIfOlderThanDays, issue a
//      fresh MobileJwtDays token in the X-Refreshed-Token response header so active
//      users never expire. Web JWTs are ignored.
public class MobileJwtRefreshMiddleware
{
    private readonly RequestDelegate _next;
    private const int MobileJwtDays = 90;          // token lifetime
    private const int RefreshIfOlderThanDays = 1;  // top up once the token is older than this

    public MobileJwtRefreshMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, IConfiguration configuration)
    {
        // Force-relogin check runs BEFORE the request pipeline — if the token is
        // invalidated we short-circuit to 401 so the app reacts immediately.
        if (context.User?.Identity?.IsAuthenticated == true
            && context.User.FindFirst("loginType")?.Value == "mobile")
        {
            if (await ShouldForceReloginAsync(context, configuration))
            {
                context.Response.StatusCode = 401;
                context.Response.Headers["X-Force-Relogin"] = "1";
                await context.Response.WriteAsync("Mobile session invalidated. Please log in again.");
                return;
            }
        }

        await _next(context);

        // Only care about authenticated mobile requests
        if (context.User?.Identity?.IsAuthenticated != true) return;

        var loginType = context.User.FindFirst("loginType")?.Value;
        if (loginType != "mobile") return;

        // Read current token from Authorization header
        var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer ")) return;
        var currentToken = authHeader.Substring("Bearer ".Length).Trim();

        try
        {
            var handler = new JwtSecurityTokenHandler();
            var jwt = handler.ReadJwtToken(currentToken);

            // Re-issue once the token is older than RefreshIfOlderThanDays (remaining life
            // below TTL - 1 day). Tops an active user's full TTL back up ~once a day, so
            // anyone who opens the app within the TTL never expires — without minting a new
            // token on every request.
            var remaining = jwt.ValidTo - DateTime.UtcNow;
            if (remaining.TotalDays >= MobileJwtDays - RefreshIfOlderThanDays) return;

            // Re-issue with fresh expiry, preserving all claims
            var jwtSettings = configuration.GetSection("JwtSettings");
            var secret = jwtSettings["Secret"]!;
            var issuer = jwtSettings["Issuer"];
            var audience = jwtSettings["Audience"];

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
            var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            // Drop reserved time claims so the new token can set fresh ones
            var reserved = new HashSet<string> { "exp", "nbf", "iat", "iss", "aud" };
            var newClaims = jwt.Claims.Where(c => !reserved.Contains(c.Type)).ToList();

            var newToken = new JwtSecurityToken(
                issuer: issuer,
                audience: audience,
                claims: newClaims,
                expires: DateTime.UtcNow.AddDays(MobileJwtDays),
                signingCredentials: credentials
            );

            var newTokenString = handler.WriteToken(newToken);
            context.Response.Headers["X-Refreshed-Token"] = newTokenString;
            context.Response.Headers["X-Refreshed-Token-Expires-At"] = newToken.ValidTo.ToString("o");
        }
        catch
        {
            // Silently ignore refresh errors — the original request already completed
        }
    }

    // Returns true when the current mobile JWT's iat is older than the member's
    // mobile_force_relogin_at marker — meaning the token was issued BEFORE the most
    // recent force-relogin event (CA changing mobile, admin invalidating session etc.).
    // Wrapped in a try/catch so any infra hiccup (DB blip, missing column, missing claim)
    // falls back to "do not block" — better to let a stale token through than wedge
    // every mobile user out on a transient error.
    private static async Task<bool> ShouldForceReloginAsync(HttpContext context, IConfiguration configuration)
    {
        try
        {
            var memberIdStr = context.User.FindFirst("memberId")?.Value;
            if (!int.TryParse(memberIdStr, out var memberId) || memberId <= 0) return false;

            // From the validated token rather than the Authorization header, so the chat hub's query-string token
            // (Program.cs, /api/chat/hub) is checked too.
            var iatClaim = context.User.FindFirst("iat")?.Value;
            if (!long.TryParse(iatClaim, out var iatUnix)) return false;
            var jwtIssuedAtUtc = DateTimeOffset.FromUnixTimeSeconds(iatUnix).UtcDateTime;

            var connStr = configuration.GetConnectionString("DefaultConnection");
            if (string.IsNullOrEmpty(connStr)) return false;

            await using var conn = new MySqlConnection(connStr);
            await conn.OpenAsync();
            var forceAt = await conn.ExecuteScalarAsync<DateTime?>(
                "SELECT mobile_force_relogin_at FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
                new { Id = memberId });

            // No marker → token is fine.
            // Marker present + later than JWT iat → token is stale, force re-login.
            return forceAt.HasValue && forceAt.Value > jwtIssuedAtUtc;
        }
        catch
        {
            return false;
        }
    }
}

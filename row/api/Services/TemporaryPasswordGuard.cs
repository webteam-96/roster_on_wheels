namespace RotaryApi.Services;

/// <summary>
/// A session opened with a temporary password can only change that password (and use sign-in and public routes).
/// The login puts the claim in the token; signing in after the change gives a token without it.
/// </summary>
public class TemporaryPasswordGuard
{
    public const string Claim = "mustChangePassword";
    public const string ErrorCode = "PASSWORD_CHANGE_REQUIRED";
    private static readonly string[] Allowed = { "/api/auth", "/api/mobile/auth", "/api/i18n", "/api/public", "/api/health" };
    private readonly RequestDelegate _next;

    public TemporaryPasswordGuard(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx)
    {
        if (ctx.User.HasClaim(Claim, "1") && !Allowed.Any(p => ctx.Request.Path.StartsWithSegments(p, StringComparison.OrdinalIgnoreCase)))
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new { message = "Change your temporary password to continue.", code = ErrorCode });
            return;
        }
        await _next(ctx);
    }

    public static bool IsLocal(HttpContext ctx) =>
        ctx.Request.Host.Host is "localhost" or "127.0.0.1" or "[::1]";
}

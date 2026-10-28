using System.Collections.Concurrent;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Trial expiry (build spec 3.5, decision 2026-10-28: full lock-out, data kept). A member is locked out when every
/// district they belong to (active club memberships and district admin roles) is on a 60-day trial that has ended
/// (tenant_subscriptions.trial_ends before today). Super Admins never are. Extending or converting the trial
/// (Settings > Tenants) lifts it. Checked at sign-in and, through <see cref="TrialLockMiddleware"/>, on every
/// signed-in request, because app tokens live for 90 days.
/// </summary>
public static class TrialLock
{
    public const string Message =
        "Your district's ROW trial has ended. Your district can contact ROW to continue; all your data is kept.";

    public static async Task<bool> IsLockedAsync(MySqlConnection conn, int memberId) =>
        memberId > 0 && await conn.ExecuteScalarAsync<int>(@"
            SELECT CASE
                WHEN EXISTS (SELECT 1 FROM member_roles WHERE fk_member_master_profile_id = @m AND fk_role_id = 3
                             AND IsActive = 1 AND isdeleted = 0) THEN 0
                WHEN COUNT(*) = 0 THEN 0
                WHEN SUM(t.trial_ends IS NULL OR t.trial_ends >= CURDATE()) = 0 THEN 1 ELSE 0 END
            FROM (SELECT c.fk_district_id AS d FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                  WHERE cm.fk_member_master_profile_id = @m AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
                  UNION
                  SELECT mr.fk_district_id FROM member_roles mr
                  WHERE mr.fk_member_master_profile_id = @m AND mr.fk_role_id = 2 AND IFNULL(mr.fk_club_id, 0) = 0
                    AND mr.fk_district_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0) ds
            LEFT JOIN tenant_subscriptions t ON t.fk_district_id = ds.d AND t.fk_club_id = 0", new { m = memberId }) == 1;

    /// <summary>Throws the sign-in refusal (callers map UnauthorizedAccessException to 401 with its message).</summary>
    public static async Task RefuseIfLockedAsync(MySqlConnection conn, int memberId)
    {
        if (await IsLockedAsync(conn, memberId)) throw new UnauthorizedAccessException(Message);
    }

    // shortcut: per-process cache, 2 minutes; a scaled-out API keeps one per instance, which only delays an unlock.
    private static readonly ConcurrentDictionary<int, (bool Locked, DateTime Until)> Cache = new();

    public static async Task<bool> IsLockedCachedAsync(string connectionString, int memberId)
    {
        if (Cache.TryGetValue(memberId, out var hit) && hit.Until > DateTime.UtcNow) return hit.Locked;
        await using var conn = new MySqlConnection(connectionString);
        var locked = await IsLockedAsync(conn, memberId);
        Cache[memberId] = (locked, DateTime.UtcNow.AddMinutes(2));
        return locked;
    }

    /// <summary>After a trial is extended or converted, so its members are let back in at once.</summary>
    public static void Forget() => Cache.Clear();
}

/// <summary>Refuses signed-in requests of members whose trial has ended (403, code trial_expired).</summary>
public class TrialLockMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string _cs;

    public TrialLockMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var user = ctx.User;
        if (user.Identity?.IsAuthenticated == true
            && !(user.FindFirst("roles")?.Value ?? "").Split(',').Any(r => r.Trim() == "SuperAdmin")
            && int.TryParse(user.FindFirst("memberId")?.Value, out var id)
            && await TrialLock.IsLockedCachedAsync(_cs, id))
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new { message = TrialLock.Message, code = "trial_expired" });
            return;
        }
        await _next(ctx);
    }
}

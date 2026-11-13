using Dapper;
using Microsoft.Extensions.Caching.Memory;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Is Year-wise Admin Rights switched ON for this club / district?
///
/// SuperAdmin decides per scope on Settings → Year-wise Admin Rights. OFF means
/// that scope behaves as the platform did before YWAR: an admin of the club or
/// district adds, edits and deletes in ANY Rotary year.
///
/// ⚠️ OFF lifts only the YEAR half of the check. The "are you an admin here at
/// all?" half is untouched — <see cref="AdminYearService"/> widens EXISTING
/// standing and never invents it. See the comment on
/// <c>AdminYearService.HasClubAdminStandingAsync</c> for why that distinction
/// is the whole ball game.
///
/// ── Resolution: most specific wins ─────────────────────────────────────────
///   CLUB check     → club override → its district's override → platform default
///   DISTRICT check → district override → platform default
/// A club override never affects a district-scoped check. A District Admin with
/// all-clubs access writing into a club is a CLUB-scoped check, so the CLUB's
/// resolved value governs it — the flag follows where the write lands.
///
/// "Inherit" is the ABSENCE of a row, never a third value in IsEnabled.
/// </summary>
public class YearRuleScopeHelper
{
    private readonly IMemoryCache _cache;
    public YearRuleScopeHelper(IMemoryCache cache) => _cache = cache;

    /// <summary>
    /// Short on purpose. This is read on every one of the ~313 guarded writes, so
    /// it must not be a query each time; but a SuperAdmin who flips a switch should
    /// see it take effect without being told to wait, and <see cref="Invalidate"/>
    /// already clears it on save. The TTL only covers another app instance behind
    /// a load balancer, which has its own cache.
    /// </summary>
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);

    // ── Cache generation ────────────────────────────────────────────────────
    // Changing a DISTRICT or the PLATFORM DEFAULT changes the answer for every
    // club underneath it, and enumerating those clubs to evict them one by one
    // would be both slow and easy to get wrong. A generation counter baked into
    // every key invalidates the whole lot in one write.
    private const string GenKey = "yearrule:gen";

    private long Gen => _cache.GetOrCreate(GenKey, e =>
    {
        e.Priority = CacheItemPriority.NeverRemove;
        return 1L;
    });

    /// <summary>Call after ANY write to the table. Cheap: one cache set.</summary>
    public void Invalidate() => _cache.Set(GenKey, Gen + 1,
        new MemoryCacheEntryOptions { Priority = CacheItemPriority.NeverRemove });

    // ── Reads ───────────────────────────────────────────────────────────────

    public async Task<bool> IsOnForClubAsync(MySqlConnection conn, int clubId)
        => (await ResolveClubAsync(conn, clubId)).Enabled;

    public async Task<bool> IsOnForDistrictAsync(MySqlConnection conn, int districtId)
        => (await ResolveDistrictAsync(conn, districtId)).Enabled;

    /// <summary>Resolved value plus WHICH row decided it, for the UI and the debug endpoint.</summary>
    public async Task<(bool Enabled, string Source)> ResolveClubAsync(MySqlConnection conn, int clubId)
    {
        if (clubId <= 0) return (DefaultWhenMissing, "No club specified");

        var key = $"yearrule:{Gen}:club:{clubId}";
        if (_cache.TryGetValue(key, out (bool, string) hit)) return hit;

        var result = await ResolveClubUncachedAsync(conn, clubId);
        _cache.Set(key, result, Ttl);
        return result;
    }

    public async Task<(bool Enabled, string Source)> ResolveDistrictAsync(MySqlConnection conn, int districtId)
    {
        if (districtId <= 0) return (DefaultWhenMissing, "No district specified");

        var key = $"yearrule:{Gen}:district:{districtId}";
        if (_cache.TryGetValue(key, out (bool, string) hit)) return hit;

        var result = await ResolveDistrictUncachedAsync(conn, districtId);
        _cache.Set(key, result, Ttl);
        return result;
    }

    // ── The resolution itself ───────────────────────────────────────────────
    //
    // Static and cache-free so MemberScopesHelper — which is static, builds the
    // login / my-context payload, and has no access to the DI container — can call
    // the SAME code instead of carrying a second copy of these rules.
    //
    // ⚠️ That second copy is exactly the bug this split fixes. MemberScopesHelper
    // re-implements the year rules to fill the AllYears / YearIds the clients read,
    // so the switch worked on the server (writes were allowed) while every client
    // still hid its buttons. One implementation, two callers, from here on.
    //
    // Uncached is right for those callers: my-context runs once per app open or
    // page mount, not per write, so there is nothing to amortise and a stale read
    // at login would be the worst possible moment for one.

    /// <summary>
    /// clubId 0 would match the platform-default row on `fk_club_id = @ClubId` and
    /// be read as a club override, so it is refused rather than mis-resolved.
    /// </summary>
    public static async Task<(bool Enabled, string Source)> ResolveClubUncachedAsync(MySqlConnection conn, int clubId)
    {
        if (clubId <= 0) return (DefaultWhenMissing, "No club specified");

        var rows = (await conn.QueryAsync<ScopeRow>(@"
            SELECT s.fk_district_id AS DistrictId, s.fk_club_id AS ClubId, s.IsEnabled
            FROM year_rule_scope_settings s
            WHERE COALESCE(s.isdeleted, 0) = 0
              AND (
                    s.fk_club_id = @ClubId
                 OR (s.fk_club_id = 0 AND s.fk_district_id =
                        (SELECT c.fk_district_id FROM club_master c WHERE c.pk_club_id = @ClubId))
                 OR (s.fk_club_id = 0 AND s.fk_district_id = 0)
              )",
            new { ClubId = clubId })).ToList();

        // Most specific wins. Matched on the SCOPE columns, never on IsEnabled —
        // an override that says OFF is still an override.
        var club     = rows.FirstOrDefault(r => r.ClubId == clubId);
        var district = rows.FirstOrDefault(r => r.ClubId == 0 && r.DistrictId > 0);
        var global   = rows.FirstOrDefault(r => r.ClubId == 0 && r.DistrictId == 0);

        return club != null     ? (club.IsEnabled, "This club")
            : district != null  ? (district.IsEnabled, $"District {district.DistrictId}")
            : global != null    ? (global.IsEnabled, "Platform default")
            : (DefaultWhenMissing, "Platform default (no row)");
    }

    public static async Task<(bool Enabled, string Source)> ResolveDistrictUncachedAsync(MySqlConnection conn, int districtId)
    {
        if (districtId <= 0) return (DefaultWhenMissing, "No district specified");

        var rows = (await conn.QueryAsync<ScopeRow>(@"
            SELECT fk_district_id AS DistrictId, fk_club_id AS ClubId, IsEnabled
            FROM year_rule_scope_settings
            WHERE COALESCE(isdeleted, 0) = 0
              AND fk_club_id = 0
              AND fk_district_id IN (@DistrictId, 0)",
            new { DistrictId = districtId })).ToList();

        var own    = rows.FirstOrDefault(r => r.DistrictId == districtId);
        var global = rows.FirstOrDefault(r => r.DistrictId == 0);

        return own != null      ? (own.IsEnabled, "This district")
            : global != null    ? (global.IsEnabled, "Platform default")
            : (DefaultWhenMissing, "Platform default (no row)");
    }

    /// <summary>
    /// The platform default on its own, for a role that sits under no district and
    /// no club -- in practice the global SuperAdmin row. There is nothing more
    /// specific to resolve against, so the default row IS the answer.
    /// </summary>
    public static async Task<(bool Enabled, string Source)> ResolveGlobalUncachedAsync(MySqlConnection conn)
    {
        var row = await conn.QueryFirstOrDefaultAsync<ScopeRow>(@"
            SELECT fk_district_id AS DistrictId, fk_club_id AS ClubId, IsEnabled
            FROM year_rule_scope_settings
            WHERE COALESCE(isdeleted, 0) = 0
              AND fk_club_id = 0 AND fk_district_id = 0");

        return row != null
            ? (row.IsEnabled, "Platform default")
            : (DefaultWhenMissing, "Platform default (no row)");
    }

    /// <summary>
    /// What to answer when the table has no platform-default row at all.
    ///
    /// ON — because that is what the platform did before this switch existed, and
    /// the only way to reach this state is a migration that did not run. Falling
    /// OFF would quietly drop year enforcement everywhere on exactly the deploy
    /// where something went wrong.
    /// </summary>
    private const bool DefaultWhenMissing = true;

    // ── Writes ──────────────────────────────────────────────────────────────
    // Set/Clear live here rather than in the controller so no caller can change a
    // row and forget to invalidate.

    /// <summary>
    /// Upsert one scope. Pass clubId OR districtId (0 and 0 = the platform default).
    /// A previously cleared (soft-deleted) row is revived, never duplicated —
    /// uq_year_rule_scope covers the soft-deleted row too.
    /// </summary>
    public async Task SetAsync(MySqlConnection conn, int districtId, int clubId, bool enabled, int byMemberId, string? notes)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO year_rule_scope_settings
                (fk_district_id, fk_club_id, IsEnabled, Notes, created_by, created_date, isdeleted)
            VALUES (@D, @C, @E, @N, @U, NOW(), 0)
            ON DUPLICATE KEY UPDATE
                IsEnabled = @E,
                Notes = @N,
                isdeleted = 0,
                modified_by = @U,
                modified_date = NOW()",
            new { D = districtId, C = clubId, E = enabled ? 1 : 0, N = notes, U = byMemberId });
        Invalidate();
    }

    /// <summary>
    /// Clear an override so the scope inherits again. Soft delete — the row stays
    /// so the audit trail and created_by survive, and SetAsync revives it.
    /// </summary>
    public async Task ClearAsync(MySqlConnection conn, int districtId, int clubId, int byMemberId)
    {
        await conn.ExecuteAsync(@"
            UPDATE year_rule_scope_settings
            SET isdeleted = 1, modified_by = @U, modified_date = NOW()
            WHERE fk_district_id = @D AND fk_club_id = @C",
            new { D = districtId, C = clubId, U = byMemberId });
        Invalidate();
    }

    // A class, not a value tuple: FirstOrDefault on a tuple returns (0, 0, false),
    // which is indistinguishable from a real platform-default row that says OFF.
    // That bug would have read "global = OFF" as "no global row".
    private class ScopeRow
    {
        public int DistrictId { get; set; }
        public int ClubId { get; set; }
        public bool IsEnabled { get; set; }
    }
}

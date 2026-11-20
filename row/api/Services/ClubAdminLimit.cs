using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>Refused grant: the club already holds the most Club Admins allowed. The API answers 409.</summary>
public sealed class ClubAdminLimitException : InvalidOperationException
{
    public int ClubId { get; }
    public int Max { get; }

    public ClubAdminLimitException(int clubId, int max) : base(ClubAdminLimit.Message(max))
    {
        ClubId = clubId;
        Max = max;
    }
}

/// <summary>
/// Owner decision 2026-11-19: a club has at most N active Club Admins (member_roles role 2 with this fk_club_id),
/// N = system_settings 'ClubAdminMaxPerClub', default 3. Counted per person; a SuperAdmin holding a club Admin row
/// is not counted, and district roles (fk_club_id 0/NULL) never are. Clubs already over the limit are left as they
/// are (SuperAdmin report); they only cannot grow. Also compiled into the RotaryOrgSyncWorker (linked file), so this
/// uses only Dapper and MySqlConnector.
/// </summary>
public static class ClubAdminLimit
{
    public const string SettingKey = "ClubAdminMaxPerClub";
    public const int DefaultMax = 3;
    public const int MaxAllowedSetting = 50;

    public static string Message(int max) =>
        $"This club already has {max} active Club Admins, the most allowed. Remove one before adding another.";

    /// <summary>The setting value, or the default when it is missing or not a whole number from 1 to 50.</summary>
    public static int Parse(string? value) =>
        int.TryParse(value?.Trim(), out var n) && n >= 1 && n <= MaxAllowedSetting ? n : DefaultMax;

    /// <summary>True when granting would push the club past the limit. A person who is already an active admin of
    /// the club, or a SuperAdmin (not counted), is never refused.</summary>
    public static bool WouldExceed(int activeAdmins, int max, bool alreadyAdmin, bool granteeIsSuperAdmin) =>
        !alreadyAdmin && !granteeIsSuperAdmin && activeAdmins >= max;

    // Active club admins of a club, one per person, SuperAdmins left out.
    internal const string CountedAdminsWhere = @"
        mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND mr.isdeleted = 0
        AND NOT EXISTS (SELECT 1 FROM member_roles s WHERE s.fk_member_master_profile_id = mr.fk_member_master_profile_id
                        AND s.fk_role_id = 3 AND s.IsActive = 1 AND s.isdeleted = 0)";

    public static async Task<int> GetMaxAsync(MySqlConnection conn, MySqlTransaction? tx = null)
    {
        try
        {
            return Parse(await conn.ExecuteScalarAsync<string?>(
                "SELECT SettingValue FROM system_settings WHERE SettingKey = @Key LIMIT 1", new { Key = SettingKey }, tx));
        }
        catch (MySqlException) { return DefaultMax; } // table not there yet: the default still holds
    }

    public static Task<int> CountActiveAdminsAsync(MySqlConnection conn, int clubId, MySqlTransaction? tx = null) =>
        conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(DISTINCT mr.fk_member_master_profile_id) FROM member_roles mr WHERE {CountedAdminsWhere}",
            new { ClubId = clubId }, tx);

    /// <summary>Throws <see cref="ClubAdminLimitException"/> when making <paramref name="memberId"/> a Club Admin of
    /// <paramref name="clubId"/> would exceed the limit. Call before any write.</summary>
    // shortcut: two grants racing for the last seat can both pass (no row lock); add SELECT ... FOR UPDATE on
    // club_master if that is ever seen.
    public static async Task EnsureCanGrantAsync(MySqlConnection conn, int memberId, int clubId, MySqlTransaction? tx = null)
    {
        if (await CanGrantAsync(conn, memberId, clubId, tx) is int max)
            throw new ClubAdminLimitException(clubId, max);
    }

    /// <summary>Null when the grant is allowed, else the limit that refuses it.</summary>
    public static async Task<int?> CanGrantAsync(MySqlConnection conn, int memberId, int clubId, MySqlTransaction? tx = null)
    {
        if (memberId <= 0 || clubId <= 0) return null;
        var flags = await conn.QueryFirstAsync<(long Already, long Super)>(@"
            SELECT
              (SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
                 AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0),
              (SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 3
                 AND IsActive = 1 AND isdeleted = 0)",
            new { MemberId = memberId, ClubId = clubId }, tx);
        if (flags.Already > 0 || flags.Super > 0) return null;
        var max = await GetMaxAsync(conn, tx);
        var count = await CountActiveAdminsAsync(conn, clubId, tx);
        return WouldExceed(count, max, false, false) ? max : null;
    }
}

using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// QR attendance roll-out switch. Marker: QR-ATTENDANCE
///
/// One table, two kinds of row:
///   fk_club_id = 0  → "All clubs" (the platform-wide switch)
///   fk_club_id > 0  → a test club switched on on its own
///
/// A club has QR attendance when "All clubs" is ON, or when it is in the list.
/// No rows at all = OFF everywhere, so deploying the API turns nothing on by itself.
/// The table is created on first use; production also has
/// database/maintenance/2026-11-27-attendance-qr.sql (same DDL).
/// </summary>
public static class AttendanceQrSwitch
{
    private static volatile bool _tableReady;

    internal const string CreateTableSql = @"
        CREATE TABLE IF NOT EXISTS attendance_qr_settings (
            pk_id INT AUTO_INCREMENT PRIMARY KEY,
            fk_club_id INT NOT NULL,
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            modified_by INT NULL,
            modified_date DATETIME NOT NULL COMMENT 'UTC',
            UNIQUE KEY uq_attendance_qr_club (fk_club_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";

    public static async Task EnsureTableAsync(MySqlConnection conn)
    {
        if (_tableReady) return;
        await conn.ExecuteAsync(CreateTableSql);
        _tableReady = true;
    }

    public static async Task<bool> AllClubsAsync(MySqlConnection conn)
    {
        await EnsureTableAsync(conn);
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM attendance_qr_settings WHERE fk_club_id = 0 AND is_enabled = 1") > 0;
    }

    public static async Task<bool> IsClubEnabledAsync(MySqlConnection conn, int clubId)
    {
        await EnsureTableAsync(conn);
        var rows = await conn.QueryAsync<(int ClubId, bool IsEnabled)>(@"
            SELECT fk_club_id AS ClubId, is_enabled = 1 AS IsEnabled FROM attendance_qr_settings
            WHERE fk_club_id IN (0, @ClubId)", new { ClubId = clubId });
        return IsOn(rows, clubId);
    }

    /// <summary>The rule: ON when the "All clubs" row (club 0) is on, or this club's own row is on.</summary>
    public static bool IsOn(IEnumerable<(int ClubId, bool IsEnabled)> rows, int clubId) =>
        clubId > 0 && rows.Any(r => r.IsEnabled && (r.ClubId == 0 || r.ClubId == clubId));

    /// <summary>The member's active clubs that have QR attendance switched on.</summary>
    public static async Task<List<int>> EnabledClubsOfMemberAsync(MySqlConnection conn, int memberId)
    {
        var all = await AllClubsAsync(conn);
        var rows = await conn.QueryAsync<int>(@"
            SELECT DISTINCT cm.fk_club_id
            FROM club_members cm
            WHERE cm.fk_member_master_profile_id = @MemberId
              AND cm.isdeleted = 0 AND cm.IsActive = 1
              AND (@All = 1 OR EXISTS (SELECT 1 FROM attendance_qr_settings s
                                       WHERE s.fk_club_id = cm.fk_club_id AND s.is_enabled = 1))",
            new { MemberId = memberId, All = all ? 1 : 0 });
        return rows.ToList();
    }

    public static async Task SetAsync(MySqlConnection conn, int clubId, bool enabled, int byMemberId)
    {
        await EnsureTableAsync(conn);
        await conn.ExecuteAsync(@"
            INSERT INTO attendance_qr_settings (fk_club_id, is_enabled, modified_by, modified_date)
            VALUES (@ClubId, @On, @By, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE is_enabled = @On, modified_by = @By, modified_date = UTC_TIMESTAMP()",
            new { ClubId = clubId, On = enabled ? 1 : 0, By = byMemberId });
    }

    public static async Task RemoveClubAsync(MySqlConnection conn, int clubId)
    {
        await EnsureTableAsync(conn);
        await conn.ExecuteAsync(
            "DELETE FROM attendance_qr_settings WHERE fk_club_id = @ClubId AND fk_club_id > 0",
            new { ClubId = clubId });
    }
}

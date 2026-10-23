using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Push;

/// <summary>
/// Shared helpers for all content-push background services (announcements, events, newsletters,
/// projects, + their reminders). Centralizes the ONE thing that was wrong across the board:
///
///  • Recipient resolution — all active members of a club (club scope) or of every club in a
///    district (district scope) who have a valid LastDeviceToken and a live club→district→zone chain.
///    The old per-service copies also excluded any member whose last app action was a LOGOUT
///    (LastMobileVisit &lt;= LastMobileLogout). That filter dropped huge numbers of valid, installed
///    devices and is the main cause of "not sent to all members" — so it is REMOVED here.
///
///  • Send + per-token log + invalid-token cleanup — identical everywhere except the log table's
///    foreign-key column(s), which callers pass in.
/// </summary>
public static class PushDispatcher
{
    // token → memberId for every push recipient of a club- or district-scoped item.
    // districtId != null → district scope (all clubs in the district); else club scope.
    public static async Task<Dictionary<string, int>> ResolveClubDistrictTokensAsync(
        MySqlConnection conn, int clubId, int? districtId)
    {
        var rows = (await conn.QueryAsync<(int memberId, string fcmToken)>(
            districtId.HasValue
                ? @"SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.LastDeviceToken AS fcmToken
                    FROM member_master_profile m
                    JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
                    JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
                    JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
                    WHERE m.isdeleted = 0 AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'" + RotaryApi.Privacy.PrivacyConsent.BroadcastFilter()
                : @"SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.LastDeviceToken AS fcmToken
                    FROM member_master_profile m
                    JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
                    JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
                    JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
                    WHERE m.isdeleted = 0 AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'" + RotaryApi.Privacy.PrivacyConsent.BroadcastFilter(),
            new { ClubId = clubId, DistrictId = districtId })).ToList();

        var tokenToMember = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var row in rows)
            if (!string.IsNullOrWhiteSpace(row.fcmToken) && !tokenToMember.ContainsKey(row.fcmToken))
                tokenToMember[row.fcmToken] = row.memberId;
        return tokenToMember;
    }

    // Human-readable source for the notification title: club name (club scope) or "District <num>".
    public static async Task<string> ResolveSourceNameAsync(MySqlConnection conn, int clubId, int? districtId)
    {
        try
        {
            if (districtId.HasValue)
            {
                var num = await conn.ExecuteScalarAsync<string?>(
                    "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId.Value });
                return $"District {num ?? "-"}";
            }
            var name = await conn.ExecuteScalarAsync<string?>(
                "SELECT ClubName FROM club_master WHERE pk_club_id = @Id", new { Id = clubId });
            return string.IsNullOrWhiteSpace(name) ? "Rotary Club" : name!;
        }
        catch { return "ROW"; }
    }

    // Source-prefixed title, e.g. SourceTitle("Announcement", "RC Mumbai") => "New Announcement · RC Mumbai".
    public static string SourceTitle(string typeLabel, string sourceName) => $"New {typeLabel} · {sourceName}";
    // Reminder title, e.g. "Reminder · RC Mumbai".
    public static string ReminderTitle(string sourceName) => $"Reminder · {sourceName}";

    public static string Trim(string? s, int max)
        => string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s[..max] + "…");

    // Send to all tokens, log each result to <logTable>, and clear tokens Firebase reports invalid.
    // fkCols = the log table's foreign-key column(s) + value(s): single-fk (e.g. fk_announcement_id) or
    // dual-fk for reminder logs (fk_reminder_id + fk_announcement_id). Column names are code constants (safe).
    public static async Task<(int sent, int failed)> SendLogCleanupAsync(
        MySqlConnection conn, IFirebasePushService push,
        Dictionary<string, int> tokenToMember, string title, string body, IDictionary<string, string> data,
        string logTable, IReadOnlyList<(string col, int val)> fkCols, CancellationToken ct)
    {
        if (tokenToMember.Count == 0) return (0, 0);

        var results = await push.SendMulticastAsync(tokenToMember.Keys, title, body, data, ct);

        var fkColNames = string.Join(", ", fkCols.Select(f => f.col));
        var fkParams = string.Join(", ", fkCols.Select((_, i) => $"@fk{i}"));
        var insertSql = $@"INSERT INTO {logTable}
            ({fkColNames}, fk_member_master_profile_id, FcmToken, Status, FirebaseMessageId, ErrorMessage, SentAt, created_date)
            VALUES ({fkParams}, @Mid, @Tok, @Status, @MsgId, @Err, @Sent, NOW())";

        foreach (var r in results)
        {
            int memberId = tokenToMember.TryGetValue(r.Token, out var mid) ? mid : 0;
            var p = new DynamicParameters();
            for (int i = 0; i < fkCols.Count; i++) p.Add($"fk{i}", fkCols[i].val);
            p.Add("Mid", memberId);
            p.Add("Tok", r.Token.Length > 500 ? r.Token[..500] : r.Token);
            p.Add("Status", r.Success ? "Sent" : "Failed");
            p.Add("MsgId", r.FirebaseMessageId);
            p.Add("Err", string.IsNullOrEmpty(r.ErrorMessage) ? null : (r.ErrorMessage.Length > 1000 ? r.ErrorMessage[..1000] : r.ErrorMessage));
            p.Add("Sent", r.Success ? DateTime.Now : (DateTime?)null);
            await conn.ExecuteAsync(insertSql, p);

            if (r.IsTokenInvalid)
                await conn.ExecuteAsync(
                    "UPDATE member_master_profile SET LastDeviceToken = NULL WHERE LastDeviceToken = @T", new { T = r.Token });
        }

        return (results.Count(x => x.Success), results.Count(x => !x.Success));
    }
}

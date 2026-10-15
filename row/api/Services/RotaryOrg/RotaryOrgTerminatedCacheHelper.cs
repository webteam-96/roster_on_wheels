using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.RotaryOrg;

// Write-through cache for Rotary.org's live terminated-members data — every successful
// live fetch (club-level or district-level Rotary Network page) refreshes this table for
// that one club, so subsequent district-wide loads can read from the DB instead of
// re-hitting Rotary.org live every time. Best-effort: a caching failure must never break
// the actual live-fetch response, so callers should swallow/log exceptions from this.
public static class RotaryOrgTerminatedCacheHelper
{
    public static async Task UpsertAsync(MySqlConnection conn, int rotaryClubId, List<RotaryOrgClubMemberDto> members)
    {
        await conn.ExecuteAsync(
            "DELETE FROM rotary_org_terminated_cache WHERE fk_rotary_club_id = @C",
            new { C = rotaryClubId });

        if (members.Count == 0) return;

        var now = DateTime.UtcNow;
        var rows = members.Select(m => new
        {
            C = rotaryClubId,
            M = m.MemberId,
            LName = m.LocalizedName,
            Pre = m.Prefix,
            F = m.FirstName,
            Mid = m.MiddleName,
            L = m.LastName,
            Suf = m.Suffix,
            Adm = m.AdmissionDate,
            Term = m.TerminationDate,
            Reason = m.TerminationReason,
            Type = m.MemberType,
            Now = now,
        });

        await conn.ExecuteAsync(@"
            INSERT INTO rotary_org_terminated_cache
                (fk_rotary_club_id, RotaryMemberId, LocalizedName, Prefix, FirstName, MiddleName, LastName, Suffix,
                 AdmissionDate, TerminationDate, TerminationReason, MemberType, LastFetchedUtc)
            VALUES (@C, @M, @LName, @Pre, @F, @Mid, @L, @Suf, @Adm, @Term, @Reason, @Type, @Now)",
            rows);
    }
}

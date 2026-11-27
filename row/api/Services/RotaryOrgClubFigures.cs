using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// District Set Goals / District Awards auto answers from Rotary.org (user 2026-11-20): when a club's figures came from
// Rotary.org (club / DG sync, goal_rotary_org_values), the "added this year" questions take the Rotary.org figure - the
// same as RCC shows - instead of counting our own member list. A club with no Rotary.org figures stays as it was.
//   Member addition        = Members now - Members 1 July (Rotary.org), never below 0.
//   Women Members          = Female now (Rotary.org) - women on 1 July (the club's Goal Setting "existing_women_members").
// Goals are NEVER touched here. Member addition (Youth) has no Rotary.org figure - unchanged.
// The AwardsAutoCalcWorker keeps its own copy of this rule (CitationCalculator) - change both together.
public static class RotaryOrgClubFigures
{
    public enum Kind { None, Members, Women }

    public static Kind KindOf(string? activityName)
    {
        var a = (activityName ?? "").ToLowerInvariant();
        if ((a.Contains("member addition") && a.Contains("lady")) || a.Contains("women member")) return Kind.Women;
        if (a.Contains("member addition") && !a.Contains("youth")) return Kind.Members;
        return Kind.None;
    }

    // The club's "added this year" from Rotary.org; null = not a Rotary.org question, or the club has no Rotary.org figures.
    public static async Task<int?> AddedAsync(MySqlConnection conn, string? activityName, int clubId, int yearId)
    {
        var k = KindOf(activityName);
        if (k == Kind.None) return null;
        var v = (await conn.QueryAsync<(string Item, decimal Val)>(@"
            SELECT ItemName, NumericValue FROM goal_rotary_org_values
            WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_club_id = @C AND isdeleted = 0 AND NumericValue IS NOT NULL
              AND ItemName IN ('Members 1 July', 'Members now / 30 June', 'Female')", new { Y = yearId, C = clubId }))
            .GroupBy(x => x.Item).ToDictionary(g => g.Key, g => g.First().Val);
        if (k == Kind.Members)
            return v.TryGetValue("Members now / 30 June", out var now) && v.TryGetValue("Members 1 July", out var jul)
                ? (int)Math.Round(Math.Max(0m, now - jul), MidpointRounding.AwayFromZero) : null;
        if (!v.TryGetValue("Female", out var women)) return null;
        var july = await conn.ExecuteScalarAsync<decimal?>(@"
            SELECT e.NumericValue FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0 AND f.FieldKey = 'existing_women_members'
            WHERE e.fk_year_id = @Y AND e.EntityType = 'Club' AND e.fk_club_id = @C AND e.isdeleted = 0 AND e.NumericValue IS NOT NULL
            LIMIT 1", new { Y = yearId, C = clubId });
        return july == null ? null : (int)Math.Round(Math.Max(0m, women - july.Value), MidpointRounding.AwayFromZero);
    }

    // Any of these clubs answered from Rotary.org for this question? Then its month-wise (our own counting) would not
    // add up to the Rotary.org year figure - Month-wise / Quarterly leave the question out (yearly only).
    public static async Task<bool> AnyFromRotaryOrgAsync(MySqlConnection conn, string? activityName, IReadOnlyList<int> clubIds, int yearId)
    {
        var k = KindOf(activityName);
        if (k == Kind.None || clubIds.Count == 0) return false;
        if (clubIds.Count == 1) return await AddedAsync(conn, activityName, clubIds[0], yearId) != null;
        // Many clubs (district month-wise): one query - a club with both Rotary.org figures the rule needs.
        return await conn.ExecuteScalarAsync<int>(k == Kind.Members ? @"
            SELECT COUNT(*) FROM goal_rotary_org_values a
            JOIN goal_rotary_org_values b ON b.fk_club_id = a.fk_club_id AND b.fk_year_id = a.fk_year_id AND b.EntityType = 'Club'
                 AND b.isdeleted = 0 AND b.NumericValue IS NOT NULL AND b.ItemName = 'Members 1 July'
            WHERE a.fk_year_id = @Y AND a.EntityType = 'Club' AND a.fk_club_id IN @C AND a.isdeleted = 0 AND a.NumericValue IS NOT NULL
              AND a.ItemName = 'Members now / 30 June'" : @"
            SELECT COUNT(*) FROM goal_rotary_org_values a
            JOIN goal_entries e ON e.fk_club_id = a.fk_club_id AND e.fk_year_id = a.fk_year_id AND e.EntityType = 'Club' AND e.isdeleted = 0 AND e.NumericValue IS NOT NULL
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0 AND f.FieldKey = 'existing_women_members'
            WHERE a.fk_year_id = @Y AND a.EntityType = 'Club' AND a.fk_club_id IN @C AND a.isdeleted = 0 AND a.NumericValue IS NOT NULL
              AND a.ItemName = 'Female'", new { Y = yearId, C = clubIds }) > 0;
    }
}

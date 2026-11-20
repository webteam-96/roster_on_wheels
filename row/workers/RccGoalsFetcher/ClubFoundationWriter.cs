using Dapper;
using MySqlConnector;

namespace RccGoalsFetcher;

/// Club Foundation month-wise from a Rotary.org sync (user 2026-11-10). Exactly the rule of the Super Admin
/// "Foundation - Club" Excel import (GoalSettingService.ImportFoundationClubAsync), so both write the same
/// figures into the same Club Goals fields:
///   - goal_entries        = the year-to-date total (as the import does);
///   - goal_entries_monthly for the CURRENT month only = year-to-date − the earlier Rotary-year months
///     already saved. Earlier months are never touched; a later sync in the same month just refreshes it.
/// Only what Rotary.org gives per club: Annual Fund and PolioPlus. Other Funds, Endowment, AF per capita
/// and Total stay with the Excel import. Like the import, only clubs synced with Rotary.org get their own
/// figures. Targets are never touched.
public static class ClubFoundationWriter
{
    private static readonly Dictionary<string, string> ItemToField = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Annual Fund contributions"] = "club_annual_fund_ytd",
        ["PolioPlus Fund contributions"] = "club_polioplus_ytd",
    };

    public static async Task<int> ApplyAsync(MySqlConnection db, int yearId, IEnumerable<GoalDbRow> rows, int memberId, DateTime now)
    {
        var picked = rows.Where(r => r.EntityType == "Club" && r.Kind == "Achieved" && r.ClubId > 0 && ItemToField.ContainsKey(r.ItemName)).ToList();
        if (picked.Count == 0) return 0;

        var fieldIds = (await db.QueryAsync<(string Key, int Id)>(
                "SELECT FieldKey, pk_field_id FROM goal_fields WHERE FieldKey IN @Keys AND isdeleted = 0", new { Keys = ItemToField.Values.ToArray() }))
            .ToDictionary(x => x.Key, x => x.Id);
        var clubIds = picked.Select(r => r.ClubId).Distinct().ToList();
        var synced = (await db.QueryAsync<int>(
                "SELECT pk_club_id FROM club_master WHERE pk_club_id IN @clubIds AND COALESCE(isdeleted,0) = 0 AND COALESCE(IsSyncedFromRotaryOrg,0) = 1", new { clubIds }))
            .ToHashSet();

        var month = now.Month;
        var orderM = month >= 7 ? month - 6 : month + 6;   // Rotary-year order: Jul = 1 ... Jun = 12
        var prior = (await db.QueryAsync<(int F, int C, decimal S)>(@"
                SELECT fk_field_id, fk_club_id, COALESCE(SUM(NumericValue), 0)
                FROM goal_entries_monthly
                WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_district_id = 0 AND COALESCE(isdeleted, 0) = 0
                  AND fk_club_id IN @clubIds
                  AND (CASE WHEN PeriodMonth >= 7 THEN PeriodMonth - 6 ELSE PeriodMonth + 6 END) < @OrderM
                GROUP BY fk_field_id, fk_club_id", new { Y = yearId, clubIds, OrderM = orderM }))
            .ToDictionary(x => (x.F, x.C), x => x.S);

        var written = 0;
        await using var tx = await db.BeginTransactionAsync();
        foreach (var r in picked)
        {
            if (!synced.Contains(r.ClubId) || !fieldIds.TryGetValue(ItemToField[r.ItemName], out var fieldId)) continue;
            var ytd = Math.Round(r.Value, 2, MidpointRounding.AwayFromZero);
            prior.TryGetValue((fieldId, r.ClubId), out var before);
            await db.ExecuteAsync(@"
                INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted)
                VALUES (@F, @Y, 'Club', @C, 0, @V, @By, NOW(), 0)
                ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0",
                new { F = fieldId, Y = yearId, C = r.ClubId, V = ytd, By = memberId }, tx);
            await db.ExecuteAsync(@"
                INSERT INTO goal_entries_monthly (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
                VALUES (@F, @Y, 'Club', @C, 0, @M, @V, @By, NOW(), 0)
                ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0",
                new { F = fieldId, Y = yearId, C = r.ClubId, M = month, V = ytd - before, By = memberId }, tx);
            written++;
        }
        await tx.CommitAsync();
        return written;
    }
}

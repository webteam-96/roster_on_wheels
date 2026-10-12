using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Centralized Rotary year (July 1 → June 30) resolver.
///
/// Auto-creates the year row in rotary_year_master when a record (newsletter,
/// announcement, project, etc.) is saved with a date in a year that doesn't yet
/// exist. Without this, callers would silently produce fk_year_id = 0 and the
/// record would be invisible to every year-filtered listing.
///
/// New rows are inserted with IsCurrent = 0 (the existing current-year flag is
/// untouched) and isdeleted = 0. If a row exists but is soft-deleted, it is
/// restored.
/// </summary>
public static class RotaryYearHelper
{
    /// <summary>Returns pk_year_id for the Rotary year that contains <paramref name="date"/>, creating the row if missing.</summary>
    public static async Task<int> EnsureRotaryYearAsync(MySqlConnection connection, DateTime date, MySqlTransaction? transaction = null)
    {
        // Rotary year runs July 1 → June 30. A January date belongs to the year that started the previous July.
        var startYear = date.Month >= 7 ? date.Year : date.Year - 1;
        var startDate = new DateTime(startYear, 7, 1);
        var endDate = new DateTime(startYear + 1, 6, 30);
        var label = $"{startYear}-{(startYear + 1) % 100:D2}";

        // Look up by label (UNIQUE index — fast).
        var existingId = await connection.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE YearLabel = @Label LIMIT 1",
            new { Label = label }, transaction);

        if (existingId is > 0)
        {
            // Restore if soft-deleted, no-op otherwise.
            await connection.ExecuteAsync(
                "UPDATE rotary_year_master SET isdeleted = 0 WHERE pk_year_id = @Id AND isdeleted = 1",
                new { Id = existingId.Value }, transaction);
            // Tables might have been dropped while the year was soft-deleted; idempotent re-create.
            await YearTableResolver.EnsureTablesExistStaticAsync(connection, label, transaction);
            return existingId.Value;
        }

        // INSERT new year row. IsCurrent = 0 so the current-year flag is unaffected.
        var newId = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO rotary_year_master (YearLabel, StartDate, EndDate, IsCurrent, isdeleted, created_date)
              VALUES (@Label, @StartDate, @EndDate, 0, 0, NOW());
              SELECT LAST_INSERT_ID();",
            new { Label = label, StartDate = startDate, EndDate = endDate }, transaction);

        // Create matching year-wise rotary_projects_<suffix> + rotary_project_photos_<suffix>
        // tables so subsequent project saves for this year have a destination table to write to.
        await YearTableResolver.EnsureTablesExistStaticAsync(connection, label, transaction);
        return newId;
    }

    /// <summary>Convenience overload for nullable dates — falls back to the current year row when null.</summary>
    public static async Task<int> EnsureRotaryYearAsync(MySqlConnection connection, DateTime? date, MySqlTransaction? transaction = null)
    {
        if (date.HasValue) return await EnsureRotaryYearAsync(connection, date.Value, transaction);
        var currentId = await connection.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1",
            transaction: transaction);
        if (currentId is > 0) return currentId.Value;
        // No current year set — auto-create for today's date.
        return await EnsureRotaryYearAsync(connection, DateTime.Today, transaction);
    }
}

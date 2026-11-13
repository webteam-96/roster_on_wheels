using Dapper;
using MySqlConnector;

namespace AssistantIndexWorker.Services;

// Minimal copy of RotaryApi's YearTableResolver — only what the indexer needs: the naming helpers
// and GetAllExistingYearTablesAsync (every rotary_projects_YYYY_YY / rotary_project_photos_YYYY_YY
// pair that physically exists, joined to rotary_year_master for the year id and label).
public record YearTableInfo(int YearId, string YearLabel, string ProjectsTable, string PhotosTable);

public class YearTableResolver
{
    // YearLabel comes in as "2024-25"; the table suffix is "2024_25".
    public static string SuffixFromLabel(string yearLabel) => yearLabel.Replace("-", "_");
    public string GetProjectsTableName(string yearLabel) => $"rotary_projects_{SuffixFromLabel(yearLabel)}";
    public string GetPhotosTableName(string yearLabel) => $"rotary_project_photos_{SuffixFromLabel(yearLabel)}";

    public async Task<List<YearTableInfo>> GetAllExistingYearTablesAsync(MySqlConnection conn)
    {
        var rows = await conn.QueryAsync<(int yearId, string yearLabel)>(@"
            SELECT y.pk_year_id, y.YearLabel
            FROM rotary_year_master y
            WHERE y.isdeleted = 0
              AND EXISTS (
                  SELECT 1 FROM information_schema.tables t
                  WHERE t.table_schema = DATABASE()
                    AND t.table_name = CONCAT('rotary_projects_', REPLACE(y.YearLabel, '-', '_'))
              )
              AND EXISTS (
                  SELECT 1 FROM information_schema.tables t
                  WHERE t.table_schema = DATABASE()
                    AND t.table_name = CONCAT('rotary_project_photos_', REPLACE(y.YearLabel, '-', '_'))
              )
            ORDER BY y.StartDate");
        return rows.Select(r =>
            new YearTableInfo(r.yearId, r.yearLabel, GetProjectsTableName(r.yearLabel), GetPhotosTableName(r.yearLabel))
        ).ToList();
    }
}

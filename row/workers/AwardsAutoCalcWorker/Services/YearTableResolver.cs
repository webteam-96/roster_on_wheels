using Dapper;
using MySqlConnector;

namespace AwardsAutoCalcWorker.Services;

// Minimal copy of RotaryApi's YearTableResolver — only the bits the two
// calculators need. Both calculators resolve a single year-wise table by ID
// once per run, so we only port ResolveByYearIdAsync + name helpers.
public record YearTableInfo(int YearId, string YearLabel, string ProjectsTable, string PhotosTable);

public class YearTableResolver
{
    private static string SuffixFromLabel(string yearLabel) => yearLabel.Replace("-", "_");
    public string GetProjectsTableName(string yearLabel) => $"rotary_projects_{SuffixFromLabel(yearLabel)}";
    public string GetPhotosTableName(string yearLabel) => $"rotary_project_photos_{SuffixFromLabel(yearLabel)}";

    public async Task<YearTableInfo?> ResolveByYearIdAsync(MySqlConnection conn, int yearId)
    {
        var label = await conn.ExecuteScalarAsync<string?>(@"
            SELECT YearLabel FROM rotary_year_master
            WHERE pk_year_id = @Id AND isdeleted = 0 LIMIT 1",
            new { Id = yearId });
        if (string.IsNullOrEmpty(label)) return null;
        return new YearTableInfo(yearId, label, GetProjectsTableName(label), GetPhotosTableName(label));
    }
}

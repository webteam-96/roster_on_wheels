using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Fire-and-forget hook: nudge CitationAutoPointsBackgroundService to recompute
// auto-points for a specific club whenever its underlying data changes
// (pph_camps, newsletters, club_attendance, club_monthly_reports, projects,
// club_members). Without these hooks the District Awards count would stay
// stale until the nightly batch ran or someone clicked "Refresh Auto Points"
// on the club citation page — which was the original bug.
//
// Runs on Task.Run so the originating HTTP request returns immediately. The
// recalc itself is per-club and reads the district's active auto questions;
// duration depends on how many questions the district has configured.
//
// Implements IDisposable-friendly pattern via IServiceScopeFactory because
// CitationAutoPointsBackgroundService is registered as a Singleton but its
// own internal DI uses scopes (year-table resolver etc.).
public interface ICitationRecalcTrigger
{
    void TriggerForClub(int clubId);
    void TriggerForDistrictAllClubs(int districtId);
}

public class CitationRecalcTrigger : ICitationRecalcTrigger
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CitationRecalcTrigger> _logger;

    public CitationRecalcTrigger(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<CitationRecalcTrigger> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    private MySqlConnection CreateConnection()
        => new(_configuration.GetConnectionString("DefaultConnection")!);

    public void TriggerForClub(int clubId)
    {
        if (clubId <= 0) return;
        _ = Task.Run(async () => await RecalcClubAsync(clubId));
    }

    public void TriggerForDistrictAllClubs(int districtId)
    {
        if (districtId <= 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                List<int> clubIds;
                using (var conn = CreateConnection())
                {
                    await conn.OpenAsync();
                    clubIds = (await conn.QueryAsync<int>(
                        "SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0",
                        new { D = districtId })).ToList();
                }
                foreach (var clubId in clubIds)
                {
                    try { await RecalcClubAsync(clubId); }
                    catch (Exception ex) { _logger.LogWarning(ex, "District-wide citation recalc failed for club {ClubId}", clubId); }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "District-wide citation recalc failed for district {DistrictId}", districtId);
            }
        });
    }

    private async Task RecalcClubAsync(int clubId)
    {
        try
        {
            int districtId;
            using (var conn = CreateConnection())
            {
                await conn.OpenAsync();
                districtId = await conn.ExecuteScalarAsync<int>(
                    "SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0 LIMIT 1",
                    new { ClubId = clubId });
            }
            if (districtId <= 0) return;

            using var scope = _scopeFactory.CreateScope();
            var bg = scope.ServiceProvider.GetRequiredService<CitationAutoPointsBackgroundService>();
            await bg.CalculateForClubAsync(districtId, clubId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Citation auto-points recalc failed for club {ClubId}", clubId);
        }
    }
}

using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services.RotaryOrg;

namespace RotaryApi.Services;

public interface IDistrictRotaryRefreshJobRunner
{
    // Starts a refresh for the district, or — if one is already running — just returns that
    // job's current status instead of starting a duplicate. Returns immediately; the actual
    // work continues on a detached background task regardless of the HTTP request's lifetime.
    Task<DistrictRotaryRefreshJobStatusDto> StartAsync(int districtId, int? startedByMemberId);

    // The latest job for this district (running, or the most recently finished one). Null if
    // a refresh has never been run for this district.
    Task<DistrictRotaryRefreshJobStatusDto?> GetStatusAsync(int districtId);
}

// Runs the district-wide Rotary.org terminated-members cache refresh as a real server-side
// background job — started by one HTTP request, tracked in district_rotary_refresh_jobs, and
// pollable from any tab/session. This replaces the earlier client-driven batch-loop, which
// stopped the moment the browser tab that started it was closed or navigated away from.
public class DistrictRotaryRefreshJobRunner : IDistrictRotaryRefreshJobRunner
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly string _connectionString;
    // Singleton-wide lock around the "is one already running? if not, insert a row" check —
    // narrow enough to not serialize the actual refresh work, just the race-prone start step.
    private readonly SemaphoreSlim _startLock = new(1, 1);

    public DistrictRotaryRefreshJobRunner(IServiceScopeFactory scopeFactory, IConfiguration config)
    {
        _scopeFactory = scopeFactory;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<DistrictRotaryRefreshJobStatusDto> StartAsync(int districtId, int? startedByMemberId)
    {
        await _startLock.WaitAsync();
        try
        {
            using var conn = CreateConnection();
            await conn.OpenAsync();

            var existing = await conn.QueryFirstOrDefaultAsync<JobRow>(
                "SELECT * FROM district_rotary_refresh_jobs WHERE fk_district_id = @D AND Status = 'Running' ORDER BY pk_id DESC LIMIT 1",
                new { D = districtId });
            if (existing != null) return ToDto(existing);

            var now = DateTime.UtcNow;
            var jobId = await conn.ExecuteScalarAsync<long>(@"
                INSERT INTO district_rotary_refresh_jobs
                    (fk_district_id, Status, TotalLinkedClubs, ClubsDone, StartedByMemberId, StartedUtc, UpdatedUtc)
                VALUES (@DistrictId, 'Running', 0, 0, @StartedBy, @Now, @Now);
                SELECT LAST_INSERT_ID();",
                new { DistrictId = districtId, StartedBy = startedByMemberId, Now = now });

            // Deliberately not awaited — the whole point is that this outlives the HTTP request.
            // Runs in its own DI scope since the request's scope is disposed once the response
            // is sent (so anything scoped, like the Rotary.org HttpClient, must be re-resolved).
            _ = Task.Run(() => RunJobAsync((int)jobId, districtId));

            return new DistrictRotaryRefreshJobStatusDto
            {
                JobId = (int)jobId,
                DistrictId = districtId,
                Status = "Running",
                StartedUtc = now,
                UpdatedUtc = now,
            };
        }
        finally { _startLock.Release(); }
    }

    private async Task RunJobAsync(int jobId, int districtId)
    {
        using var scope = _scopeFactory.CreateScope();
        var rotaryOrgClient = scope.ServiceProvider.GetRequiredService<IRotaryOrgApiClient>();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        try
        {
            var linkedClubs = (await conn.QueryAsync<(int ClubId, string ClubName, string ClubRotaryId, string? ClubType)>(@"
                SELECT pk_club_id AS ClubId, ClubName, ClubRotaryId, ClubType
                FROM club_master
                WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1
                  AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> '' AND ClubRotaryId REGEXP '^[0-9]+$'
                ORDER BY pk_club_id",
                new { DistrictId = districtId })).ToList();

            await conn.ExecuteAsync(
                "UPDATE district_rotary_refresh_jobs SET TotalLinkedClubs = @Total, UpdatedUtc = @Now WHERE pk_id = @JobId",
                new { Total = linkedClubs.Count, Now = DateTime.UtcNow, JobId = jobId });

            var failedClubs = new List<string>();
            int done = 0;
            foreach (var c in linkedClubs)
            {
                try
                {
                    var rotaryOrgClubId = int.Parse(c.ClubRotaryId);
                    var clubType = string.IsNullOrWhiteSpace(c.ClubType) ? "Rotary Club" : c.ClubType!;
                    var list = await rotaryOrgClient.GetClubTerminatedMembersAsync(clubType, rotaryOrgClubId);
                    await RotaryOrgTerminatedCacheHelper.UpsertAsync(conn, rotaryOrgClubId, list);
                }
                catch
                {
                    // GetClubTerminatedMembersAsync already turns Rotary.org's "no records" response
                    // into an empty list (not an exception) — anything that DOES throw here is a
                    // genuine failure for that one club. Keep going; don't let one club stop the rest.
                    failedClubs.Add(c.ClubName);
                }
                done++;
                await conn.ExecuteAsync(
                    "UPDATE district_rotary_refresh_jobs SET ClubsDone = @Done, UpdatedUtc = @Now WHERE pk_id = @JobId",
                    new { Done = done, Now = DateTime.UtcNow, JobId = jobId });
            }

            string? warning = failedClubs.Count == 0 ? null
                : failedClubs.Count == 1 ? $"Couldn't refresh 1 club: {failedClubs[0]}. The rest completed — try that one again later."
                : $"Couldn't refresh {failedClubs.Count} clubs: {string.Join(", ", failedClubs.Take(5))}{(failedClubs.Count > 5 ? ", …" : "")}. The rest completed — try those again later.";

            await conn.ExecuteAsync(
                "UPDATE district_rotary_refresh_jobs SET Status = 'Done', Warning = @Warning, FinishedUtc = @Now, UpdatedUtc = @Now WHERE pk_id = @JobId",
                new { Warning = warning, Now = DateTime.UtcNow, JobId = jobId });
        }
        catch
        {
            try
            {
                await conn.ExecuteAsync(
                    "UPDATE district_rotary_refresh_jobs SET Status = 'Failed', Warning = @Warning, FinishedUtc = @Now, UpdatedUtc = @Now WHERE pk_id = @JobId",
                    new { Warning = "The refresh stopped unexpectedly partway through. Try starting it again.", Now = DateTime.UtcNow, JobId = jobId });
            }
            catch { /* best-effort status write — nothing more we can do if even this fails */ }
        }
    }

    public async Task<DistrictRotaryRefreshJobStatusDto?> GetStatusAsync(int districtId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<JobRow>(
            "SELECT * FROM district_rotary_refresh_jobs WHERE fk_district_id = @D ORDER BY pk_id DESC LIMIT 1",
            new { D = districtId });
        return row == null ? null : ToDto(row);
    }

    private static DistrictRotaryRefreshJobStatusDto ToDto(JobRow r) => new()
    {
        JobId = r.pk_id,
        DistrictId = r.fk_district_id,
        Status = r.Status,
        TotalLinkedClubs = r.TotalLinkedClubs,
        ClubsDone = r.ClubsDone,
        StartedUtc = r.StartedUtc,
        UpdatedUtc = r.UpdatedUtc,
        FinishedUtc = r.FinishedUtc,
        Warning = r.Warning,
    };

    private sealed class JobRow
    {
        public int pk_id { get; set; }
        public int fk_district_id { get; set; }
        public string Status { get; set; } = "";
        public int TotalLinkedClubs { get; set; }
        public int ClubsDone { get; set; }
        public DateTime StartedUtc { get; set; }
        public DateTime UpdatedUtc { get; set; }
        public DateTime? FinishedUtc { get; set; }
        public string? Warning { get; set; }
    }
}

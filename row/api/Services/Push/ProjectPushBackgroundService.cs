using Dapper;
using MySqlConnector;

using RotaryApi.Services.Localization;
namespace RotaryApi.Services.Push;

/// <summary>
/// Polls the year-wise project tables (rotary_projects_YYYY_YY) every 60 seconds and fires push
/// once per project when PushNotificationSent is still 0. Push fires ON CREATION. Recipient/send/log
/// shared via PushDispatcher. Club + district scope only (projects have no RI scope).
/// </summary>
public class ProjectPushBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<ProjectPushBackgroundService> _logger;

    public ProjectPushBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<ProjectPushBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ProjectPushBackgroundService started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessDueProjectsAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "Error in ProjectPushBackgroundService loop"); }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task ProcessDueProjectsAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("DefaultConnection")!;
        using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync(ct);

        using var scope = _scopeFactory.CreateScope();
        var yearTables = scope.ServiceProvider.GetRequiredService<IYearTableResolver>();
        var tables = await yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return;

        // CONVERT/COLLATE string columns — year-wise tables can carry different collations, so UNION ALL
        // fails with "Illegal mix of collations" without normalisation. No approval gate (push on creation).
        var legs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT p.pk_project_id AS Id, p.fk_club_id AS ClubId, p.fk_district_id AS DistrictId,
                      CONVERT(p.title USING utf8mb4) COLLATE utf8mb4_general_ci AS Title,
                      CONVERT(COALESCE(md.ModuleKey, '') USING utf8mb4) COLLATE utf8mb4_general_ci AS ModuleKey,
                      CONVERT(COALESCE(md.ModuleName, '') USING utf8mb4) COLLATE utf8mb4_general_ci AS ModuleName,
                      {t.YearId} AS YearId,
                      CONVERT('{t.ProjectsTable}' USING utf8mb4) COLLATE utf8mb4_general_ci AS YearTable
               FROM `{t.ProjectsTable}` p
               LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
               WHERE IFNULL(p.PushNotificationSent, 0) = 0 AND p.isdeleted = 0"));
        var due = (await conn.QueryAsync<dynamic>($"SELECT * FROM ({legs}) u LIMIT 5")).ToList();
        if (due.Count == 0) return;

        var push = scope.ServiceProvider.GetRequiredService<IFirebasePushService>();
        if (!push.IsAvailable)
        {
            _logger.LogWarning("Firebase not available — skipping {Count} due project(s)", due.Count);
            return;
        }

        foreach (var pr in due)
        {
            ct.ThrowIfCancellationRequested();
            int projectId = (int)pr.Id;
            int clubId = (int)pr.ClubId;
            int? districtId = pr.DistrictId == null ? null : (int?)pr.DistrictId;
            int yearId = (int)pr.YearId;
            string yearTable = (string)pr.YearTable;
            string title = (string)(pr.Title ?? "");
            string moduleKey = (string)(pr.ModuleKey ?? "");
            string moduleName = (string)(pr.ModuleName ?? "");

            // Mark sent IMMEDIATELY on the specific year table (race guard).
            var marked = await conn.ExecuteAsync(
                $"UPDATE `{yearTable}` SET PushNotificationSent = 1, PushNotificationSentAt = NOW() WHERE pk_project_id = @Id AND IFNULL(PushNotificationSent, 0) = 0",
                new { Id = projectId });
            if (marked == 0) continue;

            try { await SendForProjectAsync(conn, push, projectId, yearId, clubId, districtId, title, moduleKey, moduleName, ct); }
            catch (Exception ex) { _logger.LogError(ex, "Failed project push {Id} (year {Year})", projectId, yearId); }
        }
    }

    private async Task SendForProjectAsync(
        MySqlConnection conn, IFirebasePushService push,
        int projectId, int yearId, int clubId, int? districtId, string title, string moduleKey, string moduleName, CancellationToken ct)
    {
        var tokenToMember = await PushDispatcher.ResolveClubDistrictTokensAsync(conn, clubId, districtId);
        if (tokenToMember.Count == 0) { _logger.LogInformation("Project {Id}: no FCM tokens", projectId); return; }

        using var pushCulture = MessageCulture.Use(await PushDispatcher.TenantLanguageAsync(conn, clubId, districtId));
        var sourceName = await PushDispatcher.ResolveSourceNameAsync(conn, clubId, districtId);
        // Title carries the project TYPE (module display name → "New Community Service · <club>"),
        // falling back to the generic "Project" only when the module is unknown.
        var typeLabel = string.IsNullOrWhiteSpace(moduleName) ? "Project" : moduleName;
        var pushTitle = PushDispatcher.SourceTitle(typeLabel, sourceName);
        var pushBody = string.IsNullOrWhiteSpace(title) ? "A new project has been added." : title;

        // Deep-link contract (Firebase_Notification_Routes.md): type is club_project_<avenue> (module key),
        // app opens the avenue list then the project detail via (clubId, yearId, projectId).
        var avenue = string.IsNullOrWhiteSpace(moduleKey) ? "community_service" : moduleKey;
        var data = new Dictionary<string, string>
        {
            ["type"] = $"club_project_{avenue}",
            ["clubId"] = clubId.ToString(),
            ["projectId"] = projectId.ToString(),
            ["yearId"] = yearId.ToString(),
        };

        var (sent, failed) = await PushDispatcher.SendLogCleanupAsync(
            conn, push, tokenToMember, pushTitle, pushBody, data,
            "project_push_log", new[] { ("fk_project_id", projectId), ("fk_year_id", yearId) }, ct);
        _logger.LogInformation("Project {Id} push: sent={Sent} failed={Failed} totalTokens={Total}",
            projectId, sent, failed, tokenToMember.Count);
    }
}

using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public class CitationAutoPointsBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<CitationAutoPointsBackgroundService> _logger;
    private readonly string _connectionString;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;

    public CitationAutoPointsBackgroundService(IServiceProvider serviceProvider, IConfiguration configuration, ILogger<CitationAutoPointsBackgroundService> logger, IServiceScopeFactory scopeFactory)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _scopeFactory = scopeFactory;
        _configuration = configuration;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Kill switch — nightly recalc is owned by the standalone AwardsAutoCalcWorker
        // console (scheduled via Windows Task Scheduler at 02:30 AM). Keep this
        // background-service registration so the live recalc trigger (called from
        // write-side services after a citation-relevant save) still works, but DO
        // NOT run the 24-hour loop on every API startup — that was the root cause
        // of "MySQL choking every morning" the user reported on 2026-06-22.
        //
        // Default: false (server). Set CitationAutoPoints:DailyLoopEnabled=true
        // ONLY if you don't have the console worker running on Task Scheduler.
        if (!_configuration.GetValue<bool>("CitationAutoPoints:DailyLoopEnabled"))
        {
            _logger.LogInformation(
                "Citation auto-points 24h loop is PAUSED (CitationAutoPoints:DailyLoopEnabled=false). " +
                "Standalone AwardsAutoCalcWorker handles nightly recalc.");
            return;
        }

        // Wait 30 seconds after startup before first run
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                _logger.LogInformation("Citation auto points calculation started.");
                await CalculateAllAutoPointsAsync();
                _logger.LogInformation("Citation auto points calculation completed.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error calculating citation auto points.");
            }

            // Run every 24 hours
            await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
        }
    }

    public async Task CalculateAllAutoPointsAsync()
    {
        var runStart = DateTime.Now;
        int districtCount = 0;
        int clubCount = 0;
        int entryCount = 0;

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Get current year
        var currentYear = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, StartDate, EndDate, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (currentYear == null) return;

        int yearId = (int)currentYear.id;
        DateTime startDate = (DateTime)currentYear.StartDate;
        DateTime endDate = (DateTime)currentYear.EndDate;
        string yearLabel = currentYear.YearLabel?.ToString() ?? "";

        // Resolve the year-wise projects table ONCE — was previously re-resolved
        // inside every GetAutoCount call (thousands of times per run, each
        // creating a new DI scope + extra SELECT to rotary_year_master).
        // If the current year has no year-wise table yet (very new year), bail
        // out entirely rather than falling back to the legacy `rotary_projects`
        // union table which would scan every year's data.
        using var scopeOuter = _scopeFactory.CreateScope();
        var yearTablesOuter = scopeOuter.ServiceProvider.GetRequiredService<IYearTableResolver>();
        var projInfoOuter = await yearTablesOuter.ResolveByYearIdAsync(conn, yearId);
        if (projInfoOuter == null)
        {
            _logger.LogWarning("Skipping auto-points run — no year-wise projects table for current year {YearLabel} ({YearId}).", yearLabel, yearId);
            return;
        }
        string projTblOuter = projInfoOuter.ProjectsTable;

        // Get all districts with citation data for current year
        var districtIds = (await conn.QueryAsync<int>(
            "SELECT DISTINCT fk_district_id FROM district_citation_auto_question WHERE fk_year_id = @YearId AND isdeleted = 0",
            new { YearId = yearId })).ToList();
        districtCount = districtIds.Count;

        // Module ID lookup hoisted ABOVE the district loop — these never change
        // between districts, so doing the same 6 SELECTs N times was waste.
        var moduleKeysOuter = new Dictionary<string, string> {
            {"Club Service", "club_service"}, {"Community Service", "community_service"},
            {"Vocational Service", "vocational_service"}, {"International Service", "international_service"},
            {"New Generation Service", "new_generation_service"}, {"Public Image Initiative", "public_image_initiative"}
        };
        var moduleIdMapOuter = new Dictionary<string, int>();
        foreach (var kv in moduleKeysOuter)
        {
            var mid = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0",
                new { Key = kv.Value });
            if (mid.HasValue) moduleIdMapOuter[kv.Value] = mid.Value;
        }

        foreach (var districtId in districtIds)
        {
            // Get all clubs in district
            var clubs = (await conn.QueryAsync<dynamic>(
                "SELECT pk_club_id AS id FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1",
                new { DistrictId = districtId })).ToList();

            // Get all auto questions for this district+year
            var questions = (await conn.QueryAsync<dynamic>(@"
                SELECT q.pk_id AS id, q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
                       q.points, q.is_bonus AS isBonus, q.bonus_points AS bonusPoints, q.min_bonus AS minBonus, q.max_bonus AS maxBonus
                FROM district_citation_auto_question q
                INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
                WHERE q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0",
                new { DistrictId = districtId, YearId = yearId })).ToList();

            // Get sub-items
            var qIds = questions.Select(q => (int)q.id).ToList();
            var subItems = qIds.Count > 0
                ? (await conn.QueryAsync<dynamic>(@"
                    SELECT pk_id AS id, fk_auto_question_id AS questionId, sub_item_type AS subItemType,
                           sub_item_id AS subItemId, sub_item_name AS subItemName,
                           points, is_bonus AS isBonus, bonus_points AS bonusPoints, min_bonus AS minBonus, max_bonus AS maxBonus
                    FROM district_citation_auto_question_sub WHERE fk_auto_question_id IN @Ids AND isdeleted = 0",
                    new { Ids = qIds })).ToList()
                : new List<dynamic>();

            // moduleIdMap + projTbl come from the outer scope — see the
            // CalculateAllAutoPointsAsync hoist above. Both are identical
            // across every district, so reusing them avoids redundant work.
            var moduleIdMap = moduleIdMapOuter;
            string projTbl  = projTblOuter;

            foreach (var club in clubs)
            {
                int clubId = (int)club.id;
                clubCount++;

                foreach (var q in questions)
                {
                    string actName = (string)q.activityName;
                    var qSubs = subItems.Where(s => (int)s.questionId == (int)q.id).ToList();

                    // Only save main entry if no sub-items exist, or if main has points > 0
                    if (qSubs.Count == 0 || (decimal)q.points > 0)
                    {
                        int count = await GetAutoCount(conn, actName, clubId, yearId, startDate, endDate, moduleIdMap, projTbl, null);
                        (decimal earned, decimal bonus) = CalculatePoints(count, (decimal)q.points, (bool)Convert.ToBoolean(q.isBonus), (decimal)q.bonusPoints, (int)q.minBonus, (int)q.maxBonus);
                        await SaveAutoEntry(conn, districtId, yearId, clubId, (int)q.id, null, count.ToString(), earned, bonus);
                        entryCount++;
                    }
                    else await RetireMainEntry(conn, districtId, yearId, clubId, (int)q.id);

                    // Sub items
                    foreach (var sub in qSubs)
                    {
                        int subCount = await GetAutoCount(conn, actName, clubId, yearId, startDate, endDate, moduleIdMap, projTbl, sub);
                        (decimal subEarned, decimal subBonus) = CalculatePoints(subCount, (decimal)sub.points, (bool)Convert.ToBoolean(sub.isBonus), (decimal)sub.bonusPoints, (int)sub.minBonus, (int)sub.maxBonus);
                        await SaveAutoEntry(conn, districtId, yearId, clubId, (int)q.id, (int)sub.id, subCount.ToString(), subEarned, subBonus);
                        entryCount++;
                    }
                }
            }
        }

        // Send completion email to RotaryOrgSync:ReportRecipients
        await SendCompletionEmailAsync(runStart, DateTime.Now, districtCount, clubCount, entryCount, yearLabel);
    }

    private async Task SendCompletionEmailAsync(DateTime startTs, DateTime endTs, int districtCount, int clubCount, int entryCount, string yearLabel)
    {
        try
        {
            var recipients = _configuration.GetSection("RotaryOrgSync:ReportRecipients").Get<string[]>() ?? Array.Empty<string>();
            if (recipients.Length == 0) return;

            var duration = endTs - startTs;
            var subject = $"ROW - Auto Calculate District awards Points - {endTs:dd-MMM-yyyy hh:mm tt}";

            var body = $@"
<div style='font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6'>
  <h2 style='color:#1e3a8a;margin:0 0 12px 0'>Auto Calculate District Awards Points</h2>
  <p style='margin:0 0 16px 0;color:#475569'>The nightly background job has completed successfully.</p>

  <table style='border-collapse:collapse;width:100%;max-width:520px;border:1px solid #e2e8f0'>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:200px'>Run started</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{startTs:dd-MMM-yyyy hh:mm:ss tt}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Run completed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{endTs:dd-MMM-yyyy hh:mm:ss tt}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Duration</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{(int)duration.TotalMinutes} min {duration.Seconds} sec</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Rotary year</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{yearLabel}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Districts processed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{districtCount}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Clubs processed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{clubCount}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Entries written</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{entryCount}</td></tr>
  </table>

  <p style='margin:20px 0 0 0;color:#64748b;font-size:12px'>This is an automated notification from ROW.</p>
</div>";

            using var scope = _scopeFactory.CreateScope();
            var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();

            foreach (var to in recipients)
            {
                try { await emailService.SendGenericEmailAsync(to, subject, body); }
                catch (Exception ex) { _logger.LogWarning(ex, "Failed to send citation auto-points email to {Recipient}", to); }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send citation auto-points completion email.");
        }
    }

    public async Task CalculateForClubAsync(int districtId, int clubId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var currentYear = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (currentYear == null) return;

        int yearId = (int)currentYear.id;
        DateTime startDate = (DateTime)currentYear.StartDate;
        DateTime endDate = (DateTime)currentYear.EndDate;

        // Resolve year-wise projects table once. Bail if it doesn't exist —
        // avoids the legacy `rotary_projects` (all-year union) fallback.
        using var scopeLive = _scopeFactory.CreateScope();
        var yearTablesLive = scopeLive.ServiceProvider.GetRequiredService<IYearTableResolver>();
        var projInfoLive = await yearTablesLive.ResolveByYearIdAsync(conn, yearId);
        if (projInfoLive == null) return;
        string projTblLive = projInfoLive.ProjectsTable;

        var questions = (await conn.QueryAsync<dynamic>(@"
            SELECT q.pk_id AS id, q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
                   q.points, q.is_bonus AS isBonus, q.bonus_points AS bonusPoints, q.min_bonus AS minBonus, q.max_bonus AS maxBonus
            FROM district_citation_auto_question q
            INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            WHERE q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0",
            new { DistrictId = districtId, YearId = yearId })).ToList();

        var qIds = questions.Select(q => (int)q.id).ToList();
        var subItems = qIds.Count > 0
            ? (await conn.QueryAsync<dynamic>(@"
                SELECT pk_id AS id, fk_auto_question_id AS questionId, sub_item_type AS subItemType,
                       sub_item_id AS subItemId, sub_item_name AS subItemName,
                       points, is_bonus AS isBonus, bonus_points AS bonusPoints, min_bonus AS minBonus, max_bonus AS maxBonus
                FROM district_citation_auto_question_sub WHERE fk_auto_question_id IN @Ids AND isdeleted = 0",
                new { Ids = qIds })).ToList()
            : new List<dynamic>();

        var moduleKeys = new Dictionary<string, string> {
            {"Club Service", "club_service"}, {"Community Service", "community_service"},
            {"Vocational Service", "vocational_service"}, {"International Service", "international_service"},
            {"New Generation Service", "new_generation_service"}, {"Public Image Initiative", "public_image_initiative"}
        };
        var moduleIdMap = new Dictionary<string, int>();
        foreach (var kv in moduleKeys)
        {
            var mid = await conn.ExecuteScalarAsync<int?>("SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0", new { Key = kv.Value });
            if (mid.HasValue) moduleIdMap[kv.Value] = mid.Value;
        }

        foreach (var q in questions)
        {
            string actName = (string)q.activityName;
            var qSubs = subItems.Where(s => (int)s.questionId == (int)q.id).ToList();

            if (qSubs.Count == 0 || (decimal)q.points > 0)
            {
                int count = await GetAutoCount(conn, actName, clubId, yearId, startDate, endDate, moduleIdMap, projTblLive, null);
                (decimal earned, decimal bonus) = CalculatePoints(count, (decimal)q.points, (bool)Convert.ToBoolean(q.isBonus), (decimal)q.bonusPoints, (int)q.minBonus, (int)q.maxBonus);
                await SaveAutoEntry(conn, districtId, yearId, clubId, (int)q.id, null, count.ToString(), earned, bonus);
            }
            else await RetireMainEntry(conn, districtId, yearId, clubId, (int)q.id);

            foreach (var sub in qSubs)
            {
                int subCount = await GetAutoCount(conn, actName, clubId, yearId, startDate, endDate, moduleIdMap, projTblLive, sub);
                (decimal subEarned, decimal subBonus) = CalculatePoints(subCount, (decimal)sub.points, (bool)Convert.ToBoolean(sub.isBonus), (decimal)sub.bonusPoints, (int)sub.minBonus, (int)sub.maxBonus);
                await SaveAutoEntry(conn, districtId, yearId, clubId, (int)q.id, (int)sub.id, subCount.ToString(), subEarned, subBonus);
            }
        }
    }

    private async Task<int> GetAutoCount(MySqlConnection conn, string activityName, int clubId, int yearId,
        DateTime startDate, DateTime endDate, Dictionary<string, int> moduleIdMap, string projTbl, dynamic? subItem)
    {
        var act = activityName.ToLower();

        if (act.Contains("club website"))
            return 0; // Future

        if (act.Contains("club dues"))
            return 0; // Future
        // NOTE: projTbl is passed in by the caller (resolved ONCE per run from
        // the current rotary year). Was previously re-resolved here per call —
        // 15,000+ wasted DI-scope+SELECTs per district. Legacy
        // `?? "rotary_projects"` fallback removed: if the year-wise table
        // doesn't exist, the caller has already bailed out of the entire run.

        if (act.Contains("member addition") && act.Contains("lady"))
        {
            return await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_master_profile m
                INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND m.isdeleted = 0 AND m.Gender = 'Female'
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { ClubId = clubId, Start = startDate, End = endDate });
        }

        if (act.Contains("member addition") && act.Contains("youth"))
        {
            return await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_master_profile m
                INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND m.isdeleted = 0 AND m.IsYouth = 1
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { ClubId = clubId, Start = startDate, End = endDate });
        }

        if (act.Contains("member addition"))
        {
            return await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_master_profile m
                INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND m.isdeleted = 0
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { ClubId = clubId, Start = startDate, End = endDate });
        }

        if (act.Contains("newsletter"))
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM newsletters WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
                new { ClubId = clubId, YearId = yearId });
        }

        if (act.Contains("club monthly report"))
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM club_monthly_reports WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 AND IsUploadedToDistrict = 1",
                new { ClubId = clubId, YearId = yearId });
        }

        if (act.Contains("attendance"))
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM club_attendance WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
                new { ClubId = clubId, YearId = yearId });
        }

        if (act.Contains("pph camp"))
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM pph_camps WHERE fk_club_id = @ClubId AND isdeleted = 0 AND CampDate >= @Start AND CampDate <= @End",
                new { ClubId = clubId, Start = startDate, End = endDate });
        }

        // Service modules: Club Service, Community Service, Vocational, International, New Gen, Public Image
        if (act.Contains("club service"))
        {
            var modId = moduleIdMap.GetValueOrDefault("club_service", 0);
            if (modId == 0) return 0;
            if (subItem != null && (string)subItem.subItemType == "meeting_type")
            {
                string mtName = (string)subItem.subItemName;
                // Map display name to DB value
                var mtMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                    {"Regular","regular"},{"Fellowship","fellowship"},{"BOD","bod"},{"Assembly","assembly"},{"Trust","trust"}
                };
                var dbVal = mtMap.GetValueOrDefault(mtName, mtName.ToLower());
                return await conn.ExecuteScalarAsync<int>(
                    $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id = @ClubId AND fk_module_id = @ModId AND fk_year_id = @YearId AND meeting_type = @Mt AND isdeleted = 0",
                    new { ClubId = clubId, ModId = modId, YearId = yearId, Mt = dbVal });
            }
            return await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id = @ClubId AND fk_module_id = @ModId AND fk_year_id = @YearId AND isdeleted = 0",
                new { ClubId = clubId, ModId = modId, YearId = yearId });
        }

        // Community, Vocational, International, New Gen, Public Image
        var serviceModuleMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            {"community service","community_service"}, {"vocational service","vocational_service"},
            {"international service","international_service"}, {"new generation service","new_generation_service"},
            {"public image initiative","public_image_initiative"}
        };

        foreach (var kv in serviceModuleMap)
        {
            if (!act.Contains(kv.Key)) continue;
            var modId = moduleIdMap.GetValueOrDefault(kv.Value, 0);
            if (modId == 0) return 0;

            if (subItem != null)
            {
                string subType = (string)subItem.subItemType;
                int? subId = subItem.subItemId != null ? (int?)subItem.subItemId : null;

                if (subType == "area_of_focus" && subId.HasValue)
                    return await conn.ExecuteScalarAsync<int>(
                        $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND fk_area_of_focus_id=@AofId AND isdeleted=0",
                        new { ClubId = clubId, ModId = modId, YearId = yearId, AofId = subId.Value });

                if (subType == "category" && subId.HasValue)
                {
                    // For Community: subItemId is category_master id
                    // For others (Vocational etc): subItemId is area_of_focus_master id (labeled as "Category")
                    if (act.Contains("community"))
                        return await conn.ExecuteScalarAsync<int>(
                            $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND fk_category_id=@CatId AND isdeleted=0",
                            new { ClubId = clubId, ModId = modId, YearId = yearId, CatId = subId.Value });
                    else
                        return await conn.ExecuteScalarAsync<int>(
                            $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND fk_area_of_focus_id=@AofId AND isdeleted=0",
                            new { ClubId = clubId, ModId = modId, YearId = yearId, AofId = subId.Value });
                }

                if (subType == "sub_category" && subId.HasValue)
                {
                    if (act.Contains("community"))
                        return await conn.ExecuteScalarAsync<int>(
                            $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND fk_sub_category_id=@SubCatId AND isdeleted=0",
                            new { ClubId = clubId, ModId = modId, YearId = yearId, SubCatId = subId.Value });
                    else
                        return await conn.ExecuteScalarAsync<int>(
                            $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND fk_category_id=@CatId AND isdeleted=0",
                            new { ClubId = clubId, ModId = modId, YearId = yearId, CatId = subId.Value });
                }
            }

            return await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND isdeleted=0",
                new { ClubId = clubId, ModId = modId, YearId = yearId });
        }

        return 0;
    }

    private (decimal earned, decimal bonus) CalculatePoints(int count, decimal pointsPerUnit, bool isBonus, decimal bonusPoints, int minBonus, int maxBonus)
    {
        if (count == 0) return (0, 0);

        decimal earned;
        decimal bonus = 0;

        if (isBonus)
        {
            if (minBonus == 0 && maxBonus == 0)
            {
                // No min/max: count * points + bonus
                earned = count * pointsPerUnit;
                bonus = bonusPoints;
            }
            else
            {
                // Cap count at max for base calculation
                int cappedCount = maxBonus > 0 && count > maxBonus ? maxBonus : count;
                earned = cappedCount * pointsPerUnit;
                // Add bonus if count >= min
                if (count >= minBonus && minBonus > 0)
                    bonus = bonusPoints;
            }
        }
        else
        {
            earned = count * pointsPerUnit;
        }

        return (earned, bonus);
    }

    // The question-level row is only written while the question has no sub-items or its own points.
    // When the district later adds sub-items and sets the question to 0, the row written before stayed
    // with its old points (user 2026-10-08: Vocational Service showed as an extra "—" row worth 4 on
    // the club screen though the district setup has no such line). Soft-delete it.
    private static async Task RetireMainEntry(MySqlConnection conn, int districtId, int yearId, int clubId, int questionId)
        => await conn.ExecuteAsync(
            @"UPDATE district_citation_club_entry SET isdeleted = 1, modified_date = NOW()
              WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId
                AND entry_type='auto' AND fk_question_id=@QId AND fk_sub_question_id IS NULL AND isdeleted=0",
            new { DistrictId = districtId, YearId = yearId, ClubId = clubId, QId = questionId });

    private async Task SaveAutoEntry(MySqlConnection conn, int districtId, int yearId, int clubId, int questionId, int? subQuestionId, string countValue, decimal pointsEarned, decimal bonusEarned)
    {
        // Check if entry exists
        var existing = await conn.ExecuteScalarAsync<int?>(
            @"SELECT pk_id FROM district_citation_club_entry
              WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId
                AND entry_type='auto' AND fk_question_id=@QId AND (fk_sub_question_id=@SubQId OR (@SubQId IS NULL AND fk_sub_question_id IS NULL))
                AND isdeleted=0",
            new { DistrictId = districtId, YearId = yearId, ClubId = clubId, QId = questionId, SubQId = subQuestionId });

        if (existing.HasValue)
        {
            await conn.ExecuteAsync(
                "UPDATE district_citation_club_entry SET answer_value=@Count, points_earned=@Points, bonus_earned=@Bonus, modified_date=NOW() WHERE pk_id=@Id",
                new { Id = existing.Value, Count = countValue, Points = pointsEarned, Bonus = bonusEarned });
        }
        else
        {
            await conn.ExecuteAsync(
                @"INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id, answer_value, points_earned, bonus_earned, created_date)
                  VALUES (@DistrictId, @YearId, @ClubId, 'auto', @QId, @SubQId, @Count, @Points, @Bonus, NOW())",
                new { DistrictId = districtId, YearId = yearId, ClubId = clubId, QId = questionId, SubQId = subQuestionId, Count = countValue, Points = pointsEarned, Bonus = bonusEarned });
        }
    }
}

using Dapper;
using Microsoft.Extensions.Configuration;
using MySqlConnector;
using RccGoalsFetcher;

// RccGoalsFetcher - daily, READ-ONLY download of Rotary Club Central club goals to Excel.
// User 2026-10-21: zones 4-8, every field as Rotary gives it; all years on the first run, then the
// current year daily. Nothing is written to Rotary.org or to our database (Phase 2/3 decide that).
//
//   RccGoalsFetcher.exe                 (YearsMode from appsettings, default auto)
//   RccGoalsFetcher.exe --all-years
//   RccGoalsFetcher.exe --current-year
//   RccGoalsFetcher.exe --years 2026,2027
//   RccGoalsFetcher.exe --districts 3141,3142
//   RccGoalsFetcher.exe --show-browser  (watch the sign-in for troubleshooting)
//   RccGoalsFetcher.exe --fresh         (ignore the checkpoint: fetch every district again)
// A run that stops part-way resumes from the next district when started again (checkpoint\<year>\).
//   RccGoalsFetcher.exe --worker        (District Governors' own syncs from the web app - see WORKER_SETUP.md)
//   RccGoalsFetcher.exe --validate-excel <xlsx> --districts 3142,3141   (read-only check of the DB mapping)

var config = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false)
    .AddJsonFile("appsettings.secrets.json", optional: true)
    .AddEnvironmentVariables()
    .Build();
var s = Settings.Load(config);

string? Arg(string name) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
if (args.Contains("--all-years")) s.YearsMode = "all";
if (args.Contains("--current-year")) s.YearsMode = "current";
if (args.Contains("--show-browser")) s.Headless = false;
var resume = !args.Contains("--fresh");
var onlyYears = Arg("--years")?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(int.Parse).ToHashSet();
if (Arg("--districts") is { } dArg) s.DistrictNumbers = dArg.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

// Worker mode: District Governors' own syncs queued by the web API (SyncWorker.cs, WORKER_SETUP.md).
// Uses the DG's login from the database, not Rcc:Email / Rcc:Password. Also runs as a Windows Service.
if (args.Contains("--worker")) return await SyncWorker.RunHostAsync(s);

var runAt = DateTime.Now;
Directory.CreateDirectory(s.OutputFolder);
Directory.CreateDirectory(Path.Combine(s.OutputFolder, "logs"));
Log.FilePath = Path.Combine(s.OutputFolder, "logs", $"RccGoalsFetcher_{runAt:yyyy-MM-dd_HHmm}.log");
Log.Info($"RccGoalsFetcher start. Output: {s.OutputFolder}");

// READ-ONLY check of the worker's database mapping against rows already loaded from an Excel:
//   RccGoalsFetcher.exe --validate-excel D:\RccGoals\RCC_Goals_2026-27_2026-10-28.xlsx --districts 3142,3141 [--source "RCC fetch 2026-10-28"]
if (Arg("--validate-excel") is { } xlsx)
    return await ExcelValidate.RunAsync(s, xlsx, s.DistrictNumbers, Arg("--source") ?? "RCC fetch 2026-10-28");

if (string.IsNullOrWhiteSpace(s.Email) || string.IsNullOrWhiteSpace(s.Password))
{
    Log.Error("Rcc:Email / Rcc:Password are empty. Put them in appsettings.secrets.json next to the exe (or env Rcc__Email / Rcc__Password).");
    return 2;
}

var files = new List<string>();
var summary = new List<string>();
var exit = 0;
try
{
    // Districts of the configured zones (read-only DB query) unless an explicit list is given.
    var districts = s.DistrictNumbers;
    if (districts.Count == 0)
    {
        if (string.IsNullOrWhiteSpace(s.ConnectionString)) throw new InvalidOperationException("No ConnectionStrings:DefaultConnection and no Scope:DistrictNumbers.");
        await using var db = new MySqlConnection(s.ConnectionString);
        var rows = await db.QueryAsync<(string District, string Zone)>(@"
            SELECT d.DistrictNumber, z.ZoneName
            FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
            WHERE d.isdeleted = 0
            ORDER BY d.DistrictNumber");
        var zoneRx = s.ZoneNumbers.Select(z => new System.Text.RegularExpressions.Regex($@"(?<!\d){z}(?!\d)")).ToList();
        var picked = rows.Where(r => r.Zone.Contains("Zone", StringComparison.OrdinalIgnoreCase) && zoneRx.Any(rx => rx.IsMatch(r.Zone))).ToList();
        districts = picked.Select(r => r.District.Trim()).Where(d => d.All(char.IsDigit)).Distinct().ToList();
        Log.Info($"Zones {string.Join(",", s.ZoneNumbers)} -> {string.Join(", ", picked.Select(p => p.Zone).Distinct())}: {districts.Count} districts.");
    }
    if (districts.Count == 0) throw new InvalidOperationException("No districts to fetch.");

    await using var rcc = new RccSession(s);
    await rcc.LoginAsync();
    var fetcher = new GoalsFetcher(rcc, s);

    if (args.Contains("--probe"))
    {
        // One-time look at Rotary's data model (read-only): how clubs hang under districts.
        var dir = Path.Combine(s.OutputFolder, "probe");
        Directory.CreateDirectory(dir);
        async Task Save(string name, string url)
        {
            try { var (st, body) = await rcc.GetTextAsync(url); await File.WriteAllTextAsync(Path.Combine(dir, name), $"// {st} {url}\n{body}"); Log.Info($"probe {name}: HTTP {st}, {body.Length} chars"); }
            catch (Exception ex) { Log.Warn($"probe {name}: {ex.Message.Split((char)10)[0]}"); }   // first line only: Playwright appends the request headers (session cookie)
        }
        var fyId = 2027;
        if (args.Contains("--probe-rotaract-trend"))
        {
            // Which SelectedClubType gives a Rotaract club's member count on the Trends call (read-only, D3142).
            var dn = await rcc.GetListAsync($"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fyId})/?$filter=OrgNodeTypeId%20eq%202%20and%20Name%20eq%20'3142'");
            var did = Json.Str(dn[0], "OrgNodeId");
            var kids = await rcc.GetListAsync($"/v1/OrgNodeFiscalYears?$filter=FiscalYearId%20eq%20{fyId}%20and%20ParentOrgNodeId%20eq%20{did}");
            var rac = kids.Where(k => Json.Int(k, "OrgNodeTypeId") == 4).Select(k => Json.Str(k, "OrgNodeId")).Take(2).ToList();
            foreach (var id in rac.Prepend(did))
                for (var t = 0; t <= 6; t++)
                    await Save($"trend_{id![..8]}_type{t}.json", $"/v1/ClubDemographics/RCC.GetTrendData(OrgNodeId={id},SelectedClubType={t})/");
            Log.Info($"Probe saved in {dir}");
            return 0;
        }
        if (args.Contains("--probe-reports"))
        {
            // What the RCC "Reports" page offers, and the other per-club data sets (read-only, a few rows each).
            await Save("reports.json", "/v1/Reports?$expand=ReportSubCategory,ReportOrganizationType");
            await Save("report_categories.json", "/v1/ReportCategories?$expand=ReportSubCategories");
            await Save("club_demographics.json", $"/v1/ClubDemographics?$filter=FiscalYearId%20eq%20{fyId}&$top=20");
            await Save("club_ratings.json", $"/v1/ClubRatings?$filter=FiscalYearId%20eq%20{fyId}&$top=5");
            await Save("club_projects.json", $"/v1/ClubProjects?$filter=FiscalYearId%20eq%20{fyId}&$top=3");
            await Save("rolled_up_goals.json", $"/v1/RolledUpGoalsByOrgNodes?$filter=FiscalYearId%20eq%20{fyId}&$top=5");
            await Save("trend.json", "/v1/OrgNodes/RCC.GetTrendData()");
            // District 3142 summary page (rcc.rotary.org/#/summary-district): rolled-up goals per club type.
            await Save("totals_3142.json", $"/v1/BIAggregatesByOrgNodeAndFiscalYears/RCC.GetByOrgNodeAndFiscalYear(OrgNodeId=015e7711-b8b3-4990-bb87-f19dcf3db0d0,FiscalYearId={fyId})/");
            await Save("rollup_3142.json", $"/v1/RolledUpGoalsByOrgNodes?$filter=FiscalYearId%20eq%20{fyId}%20and%20OrgNodeId%20eq%20015e7711-b8b3-4990-bb87-f19dcf3db0d0");
            Log.Info($"Probe saved in {dir}");
            return 0;
        }
        await Save("metadata.xml", "/v1/$metadata");
        await Save("hierarchy.json", $"/api/OrgNodes/GetMyOrgHierarchy/{fyId}");
        await Save("clubs_top5.json", $"/v1/Clubs/RCC.GetClubsByFiscalYear(FiscalYearId={fyId})/?$top=5");
        await Save("myclub.json", $"/v1/MemberUsers/RCC.MyClub(FiscalYearId={fyId})/");
        for (var t = 1; t <= 12; t++)
            await Save($"orgnodes_type{t}.json", $"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fyId})/?$filter=OrgNodeTypeId%20eq%20{t}&$top=5");
        var d3142 = (await rcc.GetListAsync($"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fyId})/?$filter=OrgNodeTypeId%20eq%202%20and%20Name%20eq%20'3142'"));
        if (d3142.Count > 0)
        {
            var id = Json.Str(d3142[0], "OrgNodeId");
            await Save("district3142.json", $"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fyId})/?$filter=OrgNodeId%20eq%20{id}");
            await Save("clubs_by_district_path.json", $"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fyId})/?$filter=contains(OrgPath,'{id}')&$top=5");
        }
        Log.Info($"Probe saved in {dir}");
        return 0;
    }

    var years = await fetcher.GetFiscalYearsAsync();
    var today = DateTime.UtcNow.Date;
    var current = years.FirstOrDefault(y => y.Start.Date <= today && today <= y.End.Date);
    if (current.Id == 0) current = years.OrderByDescending(y => y.Start).First(y => y.Start.Date <= today);

    var markerFile = Path.Combine(s.OutputFolder, ".first-full-run-done");
    var mode = s.YearsMode == "auto" ? (File.Exists(markerFile) ? "current" : "all") : s.YearsMode;
    var toFetch = onlyYears != null ? years.Where(y => onlyYears.Contains(y.Id)).ToList()
                // all years: newest first - next year (if Rotary already has goals), this year, then back
                // to the first RCC year (user 2026-10-23).
                : mode == "all" ? years.Where(y => y.Id <= current.Id + 1 && y.Id >= s.FirstFiscalYearId).OrderByDescending(y => y.Id).ToList()
                : new() { current };
    Log.Info($"Rotary years available: {string.Join(", ", years.Select(y => GoalsFetcher.YearLabel(y.Id)))}. Fetching ({(onlyYears != null ? "--years" : mode)}): {string.Join(", ", toFetch.Select(y => GoalsFetcher.YearLabel(y.Id)))}");

    foreach (var y in toFetch)
    {
        var label = GoalsFetcher.YearLabel(y.Id);
        var noDataFile = Path.Combine(s.OutputFolder, $"RCC_Goals_{label}_NO_DATA.txt");
        // A past year is fetched once: when its Excel (or a no-data note) is already in the folder it is
        // skipped, so an all-years run that stopped carries on with the years still missing. --fresh = again.
        if (resume && y.Id < current.Id
            && (Directory.GetFiles(s.OutputFolder, $"RCC_Goals_{label}_*.xlsx").Length > 0 || File.Exists(noDataFile)))
        {
            Log.Info($"{label}: already downloaded - skipped (delete its Excel or use --fresh to fetch again).");
            continue;
        }
        var res = await fetcher.FetchYearAsync(y.Id, y.End, districts, resume);
        if (res.ClubGoals.Count == 0 && res.Errors.Count == 0)
        {
            // Nothing entered in RCC for this year (future year, or before clubs used RCC) - no empty Excel.
            File.WriteAllText(noDataFile, $"No club goals in Rotary Club Central for {label} (checked {runAt:dd-MM-yyyy HH:mm}, {res.Clubs.Count} clubs).");
            try { Directory.Delete(fetcher.CheckpointDir(res.Label), true); } catch { }
            summary.Add($"{label}: no goals in Rotary.org");
            Log.Info($"{label}: no club goals in Rotary.org - no Excel.");
            continue;
        }
        files.Add(ExcelOut.Write(res, s.OutputFolder, runAt));
        fetcher.SaveClubCounts(res);
        if (s.SaveRawJson) ExcelOut.WriteRaw(res, s.OutputFolder, runAt);
        // Excel saved - the year's checkpoint has done its job; the next run starts fresh.
        try { Directory.Delete(fetcher.CheckpointDir(res.Label), true); } catch (Exception ex) { Log.Warn($"Checkpoint not cleared: {ex.Message.Split((char)10)[0]}"); }
        summary.Add($"{res.Label}: {res.Clubs.Count} clubs, {res.ClubGoals.Count} club-goal rows, {res.Errors.Count} errors" +
                    (res.MissingDistricts.Count > 0 ? $", not visible: {string.Join(", ", res.MissingDistricts)}" : ""));
        if (res.Errors.Count > 0) exit = 1;
        Log.Info($"Saved {files[^1]}");
    }

    if (mode == "all" && onlyYears == null) File.WriteAllText(markerFile, runAt.ToString("O"));
}
catch (Exception ex)
{
    Log.Error($"{ex.GetType().Name}: {ex.Message.Split((char)10)[0]}");   // first line only - no request headers / cookie in the log
    summary.Add("FAILED: " + ex.Message.Split((char)10)[0]);
    Log.Error("Run stopped. Start the same command again - finished districts are taken from the checkpoint.");
    exit = 3;
}

await Mailer.SendAsync(s,
    $"Rotary Club Central goals download {runAt:dd MMM yyyy}" + (exit == 3 ? " - FAILED" : ""),
    "<p>" + string.Join("<br>", summary.Select(System.Net.WebUtility.HtmlEncode)) + "</p><p>Files: " +
    string.Join("<br>", files.Select(System.Net.WebUtility.HtmlEncode)) + "</p>",
    files);

Log.Info("Done. " + string.Join(" | ", summary));
return exit;

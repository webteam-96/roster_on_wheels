using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RccGoalsFetcher;

using Row = Dictionary<string, object?>;

public sealed class YearResult
{
    public int FiscalYearId;
    public string Label = "";
    public List<Row> Categories = new(), Goals = new(), DistrictNodes = new(), DistrictTotals = new(),
                     Clubs = new(), ClubGoals = new(), Contributions = new(), Women = new(), RotaractClubs = new();
    public List<string> MissingDistricts = new(), Errors = new(), SuspectDistricts = new();
    public List<(string District, string ClubName, string ClubId, JsonElement Goals)> Raw = new();
}

/// Progress of a fetch (worker mode shows it on the web page). Clubs = the district being fetched.
public sealed record FetchProgress(string Stage, int ClubsDone, int ClubsTotal);

// Pulls one Rotary year at a time: goal categories + goal definitions, the district org nodes of
// our zones, every club of those districts, and each club's goals with every field Rotary returns.
public sealed class GoalsFetcher
{
    private readonly RccSession _rcc;
    private readonly Settings _s;
    private bool _expandClub = true;
    private Action<FetchProgress>? _progress;
    private string _stage = "";
    private int _clubsDone, _clubsTotal;
    public GoalsFetcher(RccSession rcc, Settings s) { _rcc = rcc; _s = s; }

    public static string YearLabel(int fy) => $"{fy - 1}-{fy % 100:00}";

    public async Task<List<(int Id, DateTime Start, DateTime End, JsonElement Raw)>> GetFiscalYearsAsync()
    {
        var list = await _rcc.GetListAsync("/v1/FiscalYears?$orderby=StartDate");
        return list.Select(y =>
        {
            var id = Json.Int(y, "FiscalYearId", "Id", "Year") ?? 0;
            var start = Json.Date(y, "StartDate") ?? new DateTime(id - 1, 7, 1);
            var end = Json.Date(y, "EndDate") ?? new DateTime(id, 6, 30);
            return (id, start, end, y);
        }).Where(y => y.id > 0).ToList();
    }

    // Progress callback: never lets a listener's error stop the fetch.
    private void Report(string? stage = null)
    {
        if (stage != null) _stage = stage;
        var cb = _progress;
        if (cb == null) return;
        try { cb(new FetchProgress(_stage, Volatile.Read(ref _clubsDone), Volatile.Read(ref _clubsTotal))); } catch { }
    }

    /// progress: optional stage / club-count callback (worker mode). useCheckpoint = false: the
    /// checkpoint folder is neither read nor written (worker mode must not touch the normal run's).
    public async Task<YearResult> FetchYearAsync(int fy, DateTime yearEnd, IReadOnlyList<string> districtNumbers, bool resume = true,
        Action<FetchProgress>? progress = null, bool useCheckpoint = true)
    {
        _progress = progress;
        _clubsDone = _clubsTotal = 0;
        var res = new YearResult { FiscalYearId = fy, Label = YearLabel(fy) };
        Log.Info($"=== {res.Label} (FiscalYearId {fy}) ===");
        Report("Reading Rotary.org goal list");

        // Same window the RCC page uses: goals valid on the last day of the Rotary year.
        var win = $"EndDate%20ge%20{yearEnd.AddDays(-1):yyyy-MM-dd}T00:00:00Z%20and%20StartDate%20le%20{yearEnd:yyyy-MM-dd}T00:00:00Z";
        var cats = await _rcc.GetListAsync($"/v1/GoalCategories?$filter={win}&$orderby=SortOrder");
        var goals = await _rcc.GetListAsync($"/v1/Goals?$filter={win}&$orderby=ShouldPriorityGoals%20desc,SortOrder");
        var catName = cats.ToDictionary(c => Json.Str(c, "GoalCategoryId", "Id") ?? "", c => Json.Str(c, "Name", "Title") ?? "");
        var goalCat = goals.ToDictionary(g => Json.Str(g, "GoalId", "Id") ?? "", g => Json.Str(g, "GoalCategoryId") ?? "");
        res.Categories = cats.Select(c => Ctx(res.Label, fy, c)).ToList();
        res.Goals = goals.Select(g =>
        {
            var row = Ctx(res.Label, fy, null);
            row["Category Name"] = catName.GetValueOrDefault(Json.Str(g, "GoalCategoryId") ?? "");
            Json.Flatten(g, "", row);
            return row;
        }).ToList();
        Log.Info($"{cats.Count} goal categories, {goals.Count} goals.");

        // District org nodes visible to this account for the year.
        Report("Finding the district on Rotary.org");
        var nodes = await GetOrgNodesAsync(fy);
        var matched = new List<(string Num, JsonElement Node)>();
        foreach (var num in districtNumbers)
        {
            var rx = new Regex($@"(?<!\d){Regex.Escape(num)}(?!\d)");
            var cand = nodes.Where(n => rx.IsMatch(Json.Str(n, "Name") ?? "")).ToList();
            if (cand.Count == 0) { res.MissingDistricts.Add(num); continue; }
            var best = cand.OrderByDescending(n => (Json.Str(n, "Name") ?? "").Contains("District", StringComparison.OrdinalIgnoreCase))
                           .ThenByDescending(n => Json.Int(n, "ClubCount") ?? 0).First();
            matched.Add((num, best));
            var r = Ctx(res.Label, fy, null); r["District No"] = num; Json.Flatten(best, "", r);
            res.DistrictNodes.Add(r);
        }
        Log.Info($"Districts matched {matched.Count}/{districtNumbers.Count}" +
                 (res.MissingDistricts.Count > 0 ? $" - not visible: {string.Join(", ", res.MissingDistricts)}" : ""));

        // One district at a time: its clubs, the district totals RCC shows, and every club's goals.
        // Each finished district is saved under checkpoint\<year>\, so a run that dies part-way picks up
        // from the next district when started again; districts / clubs that failed are tried once more
        // at the end of the run (user 2026-10-22).
        var ckDir = useCheckpoint ? CheckpointDir(res.Label) : null;
        if (ckDir != null) Directory.CreateDirectory(ckDir);
        var parts = new List<DistrictPart>();
        var lastCounts = LoadClubCounts();
        for (var k = 0; k < matched.Count; k++)
        {
            var (num, node) = matched[k];
            var part = resume && ckDir != null ? DistrictPart.Load(ckDir, num, _s.ResumeMaxAgeHours) : null;
            if (part != null)
                Log.Info($"District {num} ({k + 1}/{matched.Count}): taken from the checkpoint of {part.SavedAt:dd-MM-yyyy HH:mm} ({part.Clubs.Count} clubs, {part.FailureCount} failures).");
            else
            {
                part = await FetchDistrictAsync(fy, res.Label, num, node, catName, goalCat);
                // When Rotary.org is struggling it can send a wrong club tree (2026-10-28 evening: 3262 gave
                // 193 clubs for 123 and 0 Rotaract clubs for 78) - wait and fetch the district again.
                for (var again = 1; again <= 2 && CountProblem(part, fy, lastCounts) is { } why; again++)
                {
                    Log.Warn($"  District {num}: {why} - fetching it again in 5 minutes ({again}/2).");
                    Report($"Rotary.org answer looked incomplete - trying again in 5 minutes ({again}/2)");
                    await Task.Delay(TimeSpan.FromMinutes(5));
                    part = await FetchDistrictAsync(fy, res.Label, num, node, catName, goalCat);
                }
                if (CountProblem(part, fy, lastCounts) is { } still)
                {
                    part.ExtraErrors.Add($"District {num}: {still} - check this district's figures.");
                    res.SuspectDistricts.Add(num);
                }
                if (ckDir != null) part.Save(ckDir);
                Log.Info($"District {num} ({k + 1}/{matched.Count}) done: {part.Clubs.Count} clubs, {part.ClubGoals.Count} club-goal rows, {part.FailureCount} failures.");
            }
            parts.Add(part);
        }

        // Retry pass - most failures are Rotary's own HTTP 500s that go away after a short wait.
        var failed = parts.Where(p => p.FailureCount > 0).ToList();
        if (failed.Count > 0)
        {
            Log.Info($"Retrying {failed.Count} district(s) with failures ({failed.Sum(p => p.FailureCount)} failures) in 60 seconds...");
            Report("Retrying what Rotary.org did not answer");
            await Task.Delay(TimeSpan.FromSeconds(60));
            foreach (var p in failed)
            {
                var node = matched.First(m => m.Num == p.District).Node;
                var i = parts.IndexOf(p);
                if (p.ClubListError != null)
                    parts[i] = await FetchDistrictAsync(fy, res.Label, p.District, node, catName, goalCat);   // the club list itself failed: whole district again
                else
                {
                    if (p.TotalsError != null) await FetchTotalsAsync(fy, res.Label, p, node);
                    if (p.FailedClubs.Count > 0)
                    {
                        var again = p.FailedClubs.Select(f => f.Club).ToList();
                        p.FailedClubs.Clear();
                        Interlocked.Exchange(ref _clubsDone, Math.Max(0, _clubsTotal - again.Count));
                        await FetchClubGoalsAsync(fy, res.Label, p, again, catName, goalCat);
                    }
                }
                if (ckDir != null) parts[i].Save(ckDir);
                Log.Info($"  Retry district {p.District}: {parts[i].FailureCount} failures left.");
            }
        }

        foreach (var p in parts)
        {
            res.Clubs.AddRange(p.Clubs);
            res.DistrictTotals.AddRange(p.DistrictTotals);
            res.ClubGoals.AddRange(p.ClubGoals);
            res.Contributions.AddRange(p.Contributions);
            res.Women.AddRange(p.Women);
            res.RotaractClubs.AddRange(p.RotaractClubs);
            res.Raw.AddRange(p.Raw.Select(r => (r.District, r.ClubName, r.ClubId, r.Goals)));
            res.Errors.AddRange(p.Errors);
        }
        // Rotary sometimes returns the same contribution twice inside one goal - keep one.
        res.Contributions = res.Contributions
            .GroupBy(r => r.TryGetValue("ClubGoalContributionCurrencyId", out var id) && id != null ? id.ToString()! : Guid.NewGuid().ToString())
            .Select(g => g.First()).ToList();
        foreach (var e in res.Errors.Take(20)) Log.Error(e);
        Log.Info($"{res.Label}: {res.Clubs.Count} clubs, {res.ClubGoals.Count} club-goal rows, {res.Errors.Count} errors.");
        return res;
    }

    // Rotary.org has no reliable Rotary club count per district (the district record's ClubCount is from
    // 2017), so: Rotary clubs vs the last good run (more than 10% / 5 clubs apart = wrong), Rotaract clubs
    // vs Rotary's own district total (RotoractClubs; matched within 1 on every district 2026-10-28).
    private static string? CountProblem(DistrictPart p, int fy, Dictionary<string, int> last)
    {
        if (p.ClubListError != null) return null;   // already a failure, retried by the normal pass
        if (last.TryGetValue($"{fy}|{p.District}", out var before) && Math.Abs(p.Clubs.Count - before) > Math.Max(5, before / 10))
            return $"{p.Clubs.Count} Rotary clubs, last run had {before}";
        var total = p.DistrictTotals.Select(r => r.TryGetValue("RotoractClubs", out var v) ? v : null).FirstOrDefault(v => v != null);
        if (total != null && long.TryParse(total.ToString(), out var rac) && Math.Abs(p.RotaractClubs.Count - rac) > 2)
            return $"{p.RotaractClubs.Count} Rotaract clubs, Rotary.org's district total says {rac}";
        return null;
    }

    private string ClubCountsFile => Path.Combine(_s.OutputFolder, "club-counts.json");

    private Dictionary<string, int> LoadClubCounts()
    {
        try { return File.Exists(ClubCountsFile) ? JsonSerializer.Deserialize<Dictionary<string, int>>(File.ReadAllText(ClubCountsFile)) ?? new() : new(); }
        catch { return new(); }
    }

    // After a year's Excel is saved: its club count per district becomes the "last good run" (key "fy|district").
    // Districts that still looked wrong keep their old count.
    public void SaveClubCounts(YearResult res)
    {
        var counts = LoadClubCounts();
        foreach (var g in res.Clubs.GroupBy(r => r.TryGetValue("District No", out var d) ? d?.ToString() ?? "" : ""))
            if (g.Key != "" && !res.SuspectDistricts.Contains(g.Key)) counts[$"{res.FiscalYearId}|{g.Key}"] = g.Count();
        File.WriteAllText(ClubCountsFile, JsonSerializer.Serialize(counts));
    }

    public string CheckpointDir(string label) => Path.Combine(_s.OutputFolder, "checkpoint", label);

    private async Task<DistrictPart> FetchDistrictAsync(int fy, string label, string num, JsonElement node,
        Dictionary<string, string> catName, Dictionary<string, string> goalCat)
    {
        var part = new DistrictPart { District = num };
        var nodeId = Json.Str(node, "OrgNodeId", "Id");
        var clubs = new List<ClubRef>();
        Interlocked.Exchange(ref _clubsDone, 0);
        Interlocked.Exchange(ref _clubsTotal, 0);
        Report($"Reading the clubs of district {num}");
        try
        {
            // Rotary's tree is per year in OrgNodeFiscalYears (ParentOrgNodeId). Below a district sit
            // clubs (OrgNodeTypeId 1) and groupings (6 = club group / AG, others) that hold clubs.
            var clubNodes = new List<(string ClubNodeId, string? Group)>();
            var rotaractNodes = new List<(string ClubNodeId, string? Group)>();
            var terminated = 0;
            var typeCount = new SortedDictionary<int, int>();
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { nodeId! };
            var par = new ParallelOptions { MaxDegreeOfParallelism = _s.MaxParallel };
            // Walked one level at a time; the nodes of a level are read in parallel, then merged in
            // order so each club keeps the same AG it got from the old one-by-one walk.
            var level = new List<(string NodeId, string? Group, int Depth)> { (nodeId!, null, 0) };
            while (level.Count > 0)
            {
                var kidsOf = new List<JsonElement>[level.Count];
                await Parallel.ForEachAsync(Enumerable.Range(0, level.Count), par, async (i, _) =>
                    kidsOf[i] = await _rcc.GetListAsync($"/v1/OrgNodeFiscalYears?$filter=FiscalYearId%20eq%20{fy}%20and%20ParentOrgNodeId%20eq%20{level[i].NodeId}"));

                var groups = new List<(string KidId, string? ParentGroup, int Depth)>();
                for (var i = 0; i < level.Count; i++)
                {
                    var (_, grp, depth) = level[i];
                    foreach (var k in kidsOf[i])
                    {
                        var kidId = Json.Str(k, "OrgNodeId");
                        var type = Json.Int(k, "OrgNodeTypeId") ?? 0;
                        if (kidId == null) continue;
                        typeCount[type] = typeCount.GetValueOrDefault(type) + 1;
                        if (type == 1) clubNodes.Add((kidId, grp));   // Rotary clubs only (4 = Rotaract, not wanted - user 2026-10-22)
                        else if (type == 4) rotaractNodes.Add((kidId, grp));   // only for the Rotaractors count (user 2026-10-26)
                        else if (type != 4 && type != 2 && type != 3 && type != 7 && type != 8 && depth < 4 && visited.Add(kidId))
                            groups.Add((kidId, grp, depth + 1));
                    }
                }

                // OrgNodeFiscalYears has no link to the node, so read each grouping's name (the AG) once.
                var names = new string?[groups.Count];
                await Parallel.ForEachAsync(Enumerable.Range(0, groups.Count), par, async (i, _) =>
                {
                    var gn = await _rcc.GetListAsync($"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fy})/?$filter=OrgNodeId%20eq%20{groups[i].KidId}");
                    names[i] = gn.Count > 0 ? Json.Str(gn[0], "Name") : null;
                });
                level = groups.Select((g, i) => (g.KidId, g.ParentGroup ?? names[i] ?? g.KidId, g.Depth)).ToList();
            }
            clubNodes = clubNodes.GroupBy(c => c.ClubNodeId, StringComparer.OrdinalIgnoreCase).Select(g => g.First()).ToList();
            Log.Info($"  District {num}: tree node types {string.Join(", ", typeCount.Select(t => $"type {t.Key} x{t.Value}"))} -> {clubNodes.Count} clubs.");

            // The club's own node record (name, RI club number, member count). Rotary caps a query
            // at 100 OData nodes, so 8 ids per call.
            foreach (var chunk in clubNodes.Chunk(8))
            {
                var filter = string.Join("%20or%20", chunk.Select(c => $"OrgNodeId%20eq%20{c.ClubNodeId}"));
                var found = (await _rcc.GetListAsync($"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fy})/?$filter={filter}"))
                    .GroupBy(n => Json.Str(n, "OrgNodeId") ?? "", StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
                // Terminated clubs stay in Rotary's year tree but RCC does not count them (3142: 120 nodes, 107 clubs).
                var clubRecs = (await _rcc.GetListAsync($"/v1/Clubs/RCC.GetClubsByFiscalYear(FiscalYearId={fy})/?$filter={filter}"))
                    .GroupBy(n => Json.Str(n, "OrgNodeId") ?? "", StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
                foreach (var c in chunk)
                {
                    JsonElement? rec = found.TryGetValue(c.ClubNodeId, out var f) ? f : null;
                    // The year tree also lists the AG groupings as type 1; their own record says 6 - not a club.
                    if (rec is { } rv && Json.Int(rv, "OrgNodeTypeId") is int t && t != 1) continue;
                    if (clubRecs.TryGetValue(c.ClubNodeId, out var club)
                        && (Json.Str(club, "IsTerminated") == "true" || Json.Str(club, "IsActive") == "false")) { terminated++; continue; }
                    clubs.Add(new ClubRef(num, c.ClubNodeId, c.Group, rec));
                    var r = Ctx(label, fy, null); r["District No"] = num; r["Club Group (AG)"] = c.Group; r["Club Node Id"] = c.ClubNodeId;
                    if (rec is { } rr) Json.Flatten(rr, "", r);
                    part.Clubs.Add(r);
                }
            }
            if (terminated > 0) Log.Info($"  District {num}: {terminated} terminated clubs left out.");
            await FetchRotaractAsync(fy, label, part, rotaractNodes);
        }
        catch (Exception ex)
        {
            part.ClubListError = $"Clubs of {num}: {ex.Message.Split((char)10)[0]}";
            Log.Error(part.ClubListError);
        }
        Interlocked.Exchange(ref _clubsTotal, clubs.Count);
        Report("Reading district totals");
        await FetchTotalsAsync(fy, label, part, node);
        Report("Reading club goals");
        if (part.ClubListError == null) await FetchClubGoalsAsync(fy, label, part, clubs, catName, goalCat);
        Report("Reading member counts (women, members, Rotaractors)");
        if (part.ClubListError == null) await FetchWomenAsync(fy, label, part, nodeId!, clubs);
        return part;
    }

    // Active Rotaract clubs of the district (list only - the Rotaractors count is the district Trends call)
    // (user 2026-10-26: the ClubsInDistrict report shows 1,136 for 3142). Same 8-ids-per-call lookups
    // as the Rotary clubs; terminated / inactive ones are left out.
    private async Task FetchRotaractAsync(int fy, string label, DistrictPart part, List<(string ClubNodeId, string? Group)> nodes)
    {
        try
        {
            nodes = nodes.GroupBy(c => c.ClubNodeId, StringComparer.OrdinalIgnoreCase).Select(g => g.First()).ToList();
            var left = 0;
            foreach (var chunk in nodes.Chunk(8))
            {
                var filter = string.Join("%20or%20", chunk.Select(c => $"OrgNodeId%20eq%20{c.ClubNodeId}"));
                var found = (await _rcc.GetListAsync($"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fy})/?$filter={filter}"))
                    .GroupBy(n => Json.Str(n, "OrgNodeId") ?? "", StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
                var clubRecs = (await _rcc.GetListAsync($"/v1/Clubs/RCC.GetClubsByFiscalYear(FiscalYearId={fy})/?$filter={filter}"))
                    .GroupBy(n => Json.Str(n, "OrgNodeId") ?? "", StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
                foreach (var c in chunk)
                {
                    if (!found.TryGetValue(c.ClubNodeId, out var rec) || Json.Int(rec, "OrgNodeTypeId") is int t && t != 4) continue;
                    if (clubRecs.TryGetValue(c.ClubNodeId, out var club)
                        && (Json.Str(club, "IsTerminated") == "true" || Json.Str(club, "IsActive") == "false")) { left++; continue; }
                    part.RotaractClubs.Add(new Row
                    {
                        ["Rotary Year"] = label, ["Fiscal Year Id"] = fy, ["District No"] = part.District,
                        ["Club Group (AG)"] = c.Group, ["Rotaract Club"] = Json.Str(rec, "Name"),
                        ["RI Club Id"] = Json.Str(rec, "RotaryOrganizationId"),
                    });
                }
            }
            Log.Info($"  District {part.District}: {part.RotaractClubs.Count} active Rotaract clubs ({left} terminated left out).");
        }
        catch (Exception ex) { part.ExtraErrors.Add($"Rotaract clubs of {part.District}: {ex.Message.Split((char)10)[0]}"); }
    }

    // Women count = RCC Trends "Gender Trends" (ClubDemographics/GetTrendData), Club Type = Rotary Club
    // (user 2026-10-26), for the district itself and for each club. Rotary returns ~5 years (2022-23 on)
    // and every one is kept, "Fiscal Year Id" = the trend's own year: this year's rows feed the normal
    // sheets, the earlier ones the history sheets. Past years can't be fetched on their own - their
    // district nodes are not visible to this account (2026-10-28) - so this is the only way to them.
    private async Task FetchWomenAsync(int fy, string label, DistrictPart part, string? districtNodeId, List<ClubRef> clubs)
    {
        async Task<List<(int Fy, Row Data)>> Trend(string nodeId, int clubType)
        {
            // The trailing "/" is required (Rotary's own page sends it); without it the server answers
            // "resource removed" as plain text (2026-10-28 run: every women count failed).
            var list = await _rcc.GetListAsync($"/v1/ClubDemographics/RCC.GetTrendData(OrgNodeId={nodeId},SelectedClubType={clubType})/");
            return list.Where(t => t.ValueKind == JsonValueKind.Object && Json.Int(t, "FiscalYearId") is int ty && ty <= fy)
                       .Select(t => (Json.Int(t, "FiscalYearId")!.Value, Data(t))).ToList();
        }
        static Row Data(JsonElement t) => new()
        {
                ["Female"] = Json.Int(t, "MembersGenderFemale"), ["Male"] = Json.Int(t, "MembersGenderMale"),
                ["Unreported"] = Json.Int(t, "MembersGenderUnreported"), ["Self-describe"] = Json.Int(t, "MembersGenderSelfDescribe"),
                ["Prefer not to identify"] = Json.Int(t, "MembersGenderPreferNotToIndentify"),
                ["Members 1 July"] = Json.Int(t, "MembersJuly1"), ["Members now"] = Json.Int(t, "MembersActual"),
                ["As of"] = Json.Str(t, "DemographicsAsOfDate"),
        };
        // This year's row first (always there, blank when Rotary has none), then one row per earlier year.
        static List<Row> Years(Row head, List<(int Fy, Row Data)> years, int fy)
        {
            var rows = new List<Row>();
            foreach (var (ty, data) in years.OrderByDescending(y => y.Fy))
            {
                var r = ty == fy ? head : new Row(head) { ["Rotary Year"] = YearLabel(ty), ["Fiscal Year Id"] = ty };
                foreach (var kv in data) r[kv.Key] = kv.Value;
                if (ty != fy) rows.Add(r);
            }
            rows.Insert(0, head);
            return rows;
        }
        Row Head(string level, string? group, string? club, string? riId) => new()
        {
            ["Rotary Year"] = label, ["Fiscal Year Id"] = fy, ["Level"] = level, ["District No"] = part.District,
            ["Club Group (AG)"] = group, ["Club"] = club, ["RI Club Id"] = riId,
        };

        if (districtNodeId != null) try   // null = one club's own sync: no district rows
        {
            part.Women.AddRange(Years(Head("District", null, null, null), await Trend(districtNodeId, _s.TrendClubType), fy));
            // Rotaractors = the district's Trends figure with Club Type 4 = Rotaract (D3142 1,136 = Rotary's
            // ClubsInDistrict report, checked 2026-10-28). Rotary has no per-club Rotaract count - each
            // Rotaract club's own trend is all 0 - so one call per district.
            part.Women.AddRange(Years(Head("Rotaract District", null, null, null), await Trend(districtNodeId, 4), fy));
        }
        catch (Exception ex) { part.ExtraErrors.Add($"Women count of district {part.District}: {ex.Message.Split((char)10)[0]}"); }

        var rows = new ConcurrentBag<(int Order, List<Row> Rows)>();
        var errors = new ConcurrentBag<string>();
        await Parallel.ForEachAsync(clubs.Select((c, i) => (c, i)), new ParallelOptions { MaxDegreeOfParallelism = _s.MaxParallel }, async (x, _) =>
        {
            var rec = x.c.Node;
            var r = Head("Club", x.c.Group, rec is { } r0 ? Json.Str(r0, "Name") : null, rec is { } r1 ? Json.Str(r1, "RotaryOrganizationId") : null);
            var list = new List<Row> { r };
            try { list = Years(r, await Trend(x.c.NodeId, _s.TrendClubType), fy); }
            catch (Exception ex) { errors.Add($"Women count of {part.District} / {r["Club"]}: {ex.Message.Split((char)10)[0]}"); }
            rows.Add((x.i, list));
        });
        part.Women.AddRange(rows.OrderBy(r => r.Order).SelectMany(r => r.Rows));
        part.ExtraErrors.AddRange(errors);
        Log.Info($"  District {part.District}: women count for the district + {clubs.Count} clubs ({errors.Count} errors).");
    }

    private async Task FetchTotalsAsync(int fy, string label, DistrictPart part, JsonElement node)
    {
        var nodeId = Json.Str(node, "OrgNodeId", "Id");
        try
        {
            var agg = await _rcc.GetAsync($"/v1/BIAggregatesByOrgNodeAndFiscalYears/RCC.GetByOrgNodeAndFiscalYear(OrgNodeId={nodeId},FiscalYearId={fy})/");
            var items = agg.ValueKind == JsonValueKind.Object && agg.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Array
                ? v.EnumerateArray().ToList() : new List<JsonElement> { agg };
            part.DistrictTotals.Clear();
            foreach (var a in items) { var r = Ctx(label, fy, null); r["District No"] = part.District; Json.Flatten(a, "", r); part.DistrictTotals.Add(r); }
            part.TotalsError = null;
        }
        catch (Exception ex) { part.TotalsError = $"Totals of {part.District}: {ex.Message.Split((char)10)[0]}"; }
    }

    // Every club's goals, looked up by the club's node (ClubGoal.OrgNodeId). The full Club record
    // is expanded onto each row when Rotary allows it (Club.* columns). Clubs that fail go to
    // part.FailedClubs for the retry pass.
    private async Task FetchClubGoalsAsync(int fy, string label, DistrictPart part, List<ClubRef> clubs,
        Dictionary<string, string> catName, Dictionary<string, string> goalCat)
    {
        var goalRows = new ConcurrentBag<(int Order, Row Row)>();
        var contribRows = new ConcurrentBag<(int Order, Row Row)>();
        var raw = new ConcurrentBag<(int Order, RawItem Item)>();
        var failedClubs = new ConcurrentBag<(int Order, FailedClub Item)>();
        var done = 0;
        await Parallel.ForEachAsync(clubs.Select((c, i) => (c, i)),
            new ParallelOptions { MaxDegreeOfParallelism = _s.MaxParallel },
            async (x, _) =>
            {
                var (district, clubNode, group, rec) = x.c;
                var clubName = rec is { } r0 ? Json.Str(r0, "Name") ?? "" : "";
                var riClubId = rec is { } r1 ? Json.Str(r1, "RotaryOrganizationId") : null;
                try
                {
                    var baseQ = $"/v1/ClubGoals?$filter=OrgNodeId%20eq%20{clubNode}%20and%20FiscalYearId%20eq%20{fy}&$orderby=Goal/GoalCategory/SortOrder,Goal/SortOrder&$expand=Goal,ClubGoalContributionCurrencies";
                    List<JsonElement> list;
                    if (_expandClub)
                    {
                        try { list = await _rcc.GetListAsync(baseQ + ",Club"); }
                        catch (HttpRequestException ex) when (ex.Message.Contains("HTTP 400"))
                        {
                            _expandClub = false;
                            Log.Warn("Rotary does not allow expanding Club on ClubGoals - continuing without Club.* columns.");
                            list = await _rcc.GetListAsync(baseQ);
                        }
                        catch (HttpRequestException ex) when (ex.Message.Contains("HTTP 500"))
                        {
                            Log.Warn($"Club record could not be attached for {clubName} - goals fetched without it.");
                            list = await _rcc.GetListAsync(baseQ);
                        }
                    }
                    else list = await _rcc.GetListAsync(baseQ);

                    var clubId = list.Select(g => Json.Str(g, "ClubId")).FirstOrDefault(id => id != null) ?? "";
                    raw.Add((x.i, new RawItem(district, clubName, clubId, JsonSerializer.SerializeToElement(list))));
                    var n = 0;
                    foreach (var g in list)
                    {
                        var row = Ctx(label, fy, null);
                        row["District No"] = district; row["Club Group (AG)"] = group; row["Club"] = clubName;
                        row["RI Club Id"] = riClubId; row["Club Node Id"] = clubNode;
                        var gid = Json.Str(g, "GoalId") ?? (Json.Prop(g, "Goal") is { } go ? Json.Str(go, "GoalId", "Id") : null) ?? "";
                        row["Category Name"] = catName.GetValueOrDefault(goalCat.GetValueOrDefault(gid) ?? "");
                        Json.Flatten(g, "", row);
                        goalRows.Add((x.i * 1000 + n++, row));

                        if (Json.Prop(g, "ClubGoalContributionCurrencies") is { ValueKind: JsonValueKind.Array } arr)
                        {
                            var m = 0;
                            foreach (var cc in arr.EnumerateArray())
                            {
                                var cr = Ctx(label, fy, null);
                                cr["District No"] = district; cr["Club"] = clubName; cr["RI Club Id"] = riClubId;
                                cr["Club Goal Id"] = Json.Str(g, "ClubGoalId", "Id"); cr["Goal Id"] = gid;
                                Json.Flatten(cc, "", cr);
                                contribRows.Add((x.i * 100000 + n * 100 + m++, cr));
                            }
                        }
                    }
                }
                catch (Exception ex) { failedClubs.Add((x.i, new FailedClub(x.c, $"{district} / {clubName} ({clubNode}): {ex.Message.Split((char)10)[0]}"))); }
                var d = Interlocked.Increment(ref done);
                Interlocked.Increment(ref _clubsDone);
                Report();
                if (d % 50 == 0 || d == clubs.Count) Log.Info($"  District {part.District}: club goals {d}/{clubs.Count}");
            });

        part.ClubGoals.AddRange(goalRows.OrderBy(r => r.Order).Select(r => r.Row));
        part.Contributions.AddRange(contribRows.OrderBy(r => r.Order).Select(r => r.Row));
        part.Raw.AddRange(raw.OrderBy(r => r.Order).Select(r => r.Item));
        part.FailedClubs.AddRange(failedClubs.OrderBy(r => r.Order).Select(r => r.Item));
    }
    /// ONE club's own sync (user 2026-11-10): a Club Admin / President / Secretary's Rotary.org login sees only
    /// its own club (Rotary's "MyClub"). Same calls as the district sync makes for each of its clubs - the
    /// club's goals and its member / women trend - but no club tree, no district totals, no district rows.
    public async Task<YearResult> FetchClubAsync(int fy, DateTime yearEnd, string districtNumber, JsonElement clubNode,
        Action<FetchProgress>? progress = null)
    {
        _progress = progress;
        _clubsDone = 0; _clubsTotal = 1;
        var res = new YearResult { FiscalYearId = fy, Label = YearLabel(fy) };
        Report("Reading Rotary.org goal list");
        var win = $"EndDate%20ge%20{yearEnd.AddDays(-1):yyyy-MM-dd}T00:00:00Z%20and%20StartDate%20le%20{yearEnd:yyyy-MM-dd}T00:00:00Z";
        var cats = await _rcc.GetListAsync($"/v1/GoalCategories?$filter={win}&$orderby=SortOrder");
        var goals = await _rcc.GetListAsync($"/v1/Goals?$filter={win}&$orderby=ShouldPriorityGoals%20desc,SortOrder");
        var catName = cats.ToDictionary(c => Json.Str(c, "GoalCategoryId", "Id") ?? "", c => Json.Str(c, "Name", "Title") ?? "");
        var goalCat = goals.ToDictionary(g => Json.Str(g, "GoalId", "Id") ?? "", g => Json.Str(g, "GoalCategoryId") ?? "");
        // The goal list is what turns the club's goals into columns / values (Output.GoalColumns) - without it
        // nothing but the member counts is saved (bug fixed 2026-11-12). Same as FetchYearAsync.
        res.Categories = cats.Select(c => Ctx(res.Label, fy, c)).ToList();
        res.Goals = goals.Select(g =>
        {
            var row = Ctx(res.Label, fy, null);
            row["Category Name"] = catName.GetValueOrDefault(Json.Str(g, "GoalCategoryId") ?? "");
            Json.Flatten(g, "", row);
            return row;
        }).ToList();

        var nodeId = Json.Str(clubNode, "OrgNodeId", "Id") ?? throw new InvalidOperationException("Rotary.org did not give this login's club.");
        var part = new DistrictPart { District = districtNumber };
        var club = new ClubRef(districtNumber, nodeId, null, clubNode);
        var r = Ctx(res.Label, fy, null); r["District No"] = districtNumber; r["Club Group (AG)"] = null; r["Club Node Id"] = nodeId;
        Json.Flatten(clubNode, "", r);
        part.Clubs.Add(r);

        Report("Reading club goals");
        await FetchClubGoalsAsync(fy, res.Label, part, new List<ClubRef> { club }, catName, goalCat);
        if (part.FailedClubs.Count > 0)
        {
            // Rotary's own HTTP 500s usually go away after a short wait - one more try.
            Report("Retrying what Rotary.org did not answer");
            await Task.Delay(TimeSpan.FromSeconds(30));
            part.FailedClubs.Clear();
            await FetchClubGoalsAsync(fy, res.Label, part, new List<ClubRef> { club }, catName, goalCat);
        }
        Report("Reading member counts (members, women)");
        await FetchWomenAsync(fy, res.Label, part, null, new List<ClubRef> { club });

        res.Clubs.AddRange(part.Clubs);
        res.ClubGoals.AddRange(part.ClubGoals);
        res.Contributions.AddRange(part.Contributions);
        res.Women.AddRange(part.Women);
        res.Raw.AddRange(part.Raw.Select(x => (x.District, x.ClubName, x.ClubId, x.Goals)));
        res.Errors.AddRange(part.Errors);
        return res;
    }

    private async Task<List<JsonElement>> GetOrgNodesAsync(int fy)
    {
        var baseUrl = $"/v1/OrgNodes/RCC.GetOrgNodesByYear(FiscalYearId={fy})/";
        // OrgNodeTypeId 2 = district (seen 2026-10-21: District 3142 node has type 2). Fast path first.
        try
        {
            var districts = await _rcc.GetPagedAsync(baseUrl + "?$filter=OrgNodeTypeId%20eq%202&$orderby=Name");
            if (districts.Count > 0) return districts;
        }
        catch (Exception ex) { Log.Warn($"District nodes (type 2) failed: {ex.Message.Split((char)10)[0]}"); }
        try { return await _rcc.GetPagedAsync(baseUrl + "?$orderby=Name"); }
        catch (Exception ex)
        {
            // Some OData functions insist on a type filter - fall back to one call per node type.
            Log.Warn($"OrgNodes without a type filter failed ({ex.Message.Split((char)10)[0]}); trying per type.");
            var all = new List<JsonElement>();
            for (var t = 1; t <= 12; t++)
                try { all.AddRange(await _rcc.GetPagedAsync($"{baseUrl}?$filter=OrgNodeTypeId%20eq%20{t}&$orderby=Name")); }
                catch { /* type not used */ }
            return all;
        }
    }

    private static Row Ctx(string label, int fy, JsonElement? flatten)
    {
        var r = new Row { ["Rotary Year"] = label, ["Fiscal Year Id"] = fy };
        if (flatten is { } f) Json.Flatten(f, "", r);
        return r;
    }
}

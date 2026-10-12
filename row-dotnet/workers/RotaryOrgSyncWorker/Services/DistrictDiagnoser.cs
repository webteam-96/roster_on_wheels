using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// For a given district, compares clubs in Rotary.org (via /clubs and /Clubs/search)
/// against clubs in our local DB. Reports clubs in API but missing from DB,
/// and clubs in DB but missing from API. Outputs to console + CSV.
/// </summary>
public class DistrictDiagnoser
{
    private static readonly string[] TargetCountries = { "India", "Sri Lanka", "Nepal" };

    private readonly IRotaryOrgApiClient _api;
    private readonly IConfiguration _config;
    private readonly ILogger<DistrictDiagnoser> _logger;
    private readonly string _connectionString;

    public DistrictDiagnoser(IRotaryOrgApiClient api, IConfiguration config, ILogger<DistrictDiagnoser> logger)
    {
        _api = api;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    /// <summary>
    /// Diagnoses ALL districts in district_master at once. For each, compares API count
    /// vs DB count and lists missing clubs.
    /// </summary>
    public async Task RunAllAsync(CancellationToken ct = default)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Diagnosing ALL districts ===");

        // 1. Fetch /clubs once
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs...");
        var allSyncClubs = await _api.GetClubsAsync(ct);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs: {allSyncClubs.Count} clubs total");

        // 2. Fetch /Clubs/search for 3 countries once
        var allSearchClubs = new List<RotaryOrgClubSearchDto>();
        foreach (var country in TargetCountries)
        {
            ct.ThrowIfCancellationRequested();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /Clubs/search for {country}...");
            var list = await _api.SearchClubsByCountryAsync(country, ct);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {country}: {list.Count} clubs");
            allSearchClubs.AddRange(list);
        }

        // 3. Build name lookup and per-district groupings
        var apiNameById = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var apiByDistrict = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var c in allSyncClubs)
        {
            if (!c.DistrictId.HasValue) continue;
            var districtKey = c.DistrictId.Value.ToString();
            var clubKey = c.ClubId.ToString();
            if (!apiByDistrict.TryGetValue(districtKey, out var ids))
                apiByDistrict[districtKey] = ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            ids.Add(clubKey);
            if (!apiNameById.ContainsKey(clubKey)) apiNameById[clubKey] = c.ClubName ?? "";
        }
        foreach (var c in allSearchClubs)
        {
            if (string.IsNullOrWhiteSpace(c.District)) continue;
            var clubKey = c.ClubId.ToString();
            if (!apiByDistrict.TryGetValue(c.District, out var ids))
                apiByDistrict[c.District] = ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            ids.Add(clubKey);
            if (!apiNameById.ContainsKey(clubKey)) apiNameById[clubKey] = c.ClubName ?? "";
        }

        // 4. Get all our local districts + their DB clubs
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var localDistricts = (await conn.QueryAsync<string>(@"
            SELECT DistrictNumber FROM district_master WHERE isdeleted = 0 ORDER BY DistrictNumber"))
            .ToList();
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Local districts: {localDistricts.Count}");

        var dbClubsByDistrict = (await conn.QueryAsync<(string DistrictNumber, string ClubRotaryId, string ClubName)>(@"
            SELECT d.DistrictNumber AS DistrictNumber,
                   IFNULL(cm.ClubRotaryId, '') AS ClubRotaryId,
                   IFNULL(cm.ClubName, '') AS ClubName
            FROM club_master cm
            JOIN district_master d ON d.pk_district_id = cm.fk_district_id
            WHERE cm.isdeleted = 0 AND cm.ClubRotaryId IS NOT NULL AND cm.ClubRotaryId <> ''"))
            .GroupBy(x => x.DistrictNumber, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => (Set: new HashSet<string>(g.Select(x => x.ClubRotaryId), StringComparer.OrdinalIgnoreCase),
                      List: g.ToList()),
                StringComparer.OrdinalIgnoreCase);

        // 5. Compare per district
        Console.WriteLine($"");
        Console.WriteLine($"=== Per-district comparison ===");
        Console.WriteLine($"District   API   DB    Missing(API→DB)");
        Console.WriteLine($"--------   ---   ---   ---------------");

        var allMissingInDb = new List<(string District, string ClubId, string Name)>();
        int totalMissing = 0;
        int districtsWithMissing = 0;

        foreach (var district in localDistricts)
        {
            apiByDistrict.TryGetValue(district, out var apiSet);
            apiSet ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            dbClubsByDistrict.TryGetValue(district, out var dbInfo);
            var dbSet = dbInfo.Set ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var missing = apiSet.Where(id => !dbSet.Contains(id)).ToList();
            Console.WriteLine($"{district,-10} {apiSet.Count,3}   {dbSet.Count,3}   {missing.Count,3}");
            if (missing.Count > 0)
            {
                districtsWithMissing++;
                totalMissing += missing.Count;
                foreach (var id in missing)
                    allMissingInDb.Add((district, id, apiNameById.GetValueOrDefault(id, "")));
            }
        }

        Console.WriteLine($"");
        Console.WriteLine($"=== Total ===");
        Console.WriteLine($"Districts with missing clubs: {districtsWithMissing} / {localDistricts.Count}");
        Console.WriteLine($"Total missing clubs:          {totalMissing}");
        Console.WriteLine($"");

        // 6. Print missing club details (capped at 50 lines)
        if (allMissingInDb.Count > 0)
        {
            Console.WriteLine($"=== Missing clubs (first 50) ===");
            Console.WriteLine($"District  ClubRotaryId  ClubName");
            Console.WriteLine($"--------  ------------  --------");
            foreach (var m in allMissingInDb.Take(50))
                Console.WriteLine($"{m.District,-8}  {m.ClubId,-12}  {m.Name}");
            if (allMissingInDb.Count > 50)
                Console.WriteLine($"... and {allMissingInDb.Count - 50} more (see CSV)");
            Console.WriteLine($"");
        }

        // 7. CSV
        var fileName = $"diagnose-all-{DateTime.Now:yyyyMMdd-HHmmss}.csv";
        var fullPath = Path.Combine(AppContext.BaseDirectory, fileName);
        using (var writer = new StreamWriter(fullPath))
        {
            await writer.WriteLineAsync("DistrictNumber,ClubRotaryId,ClubName");
            foreach (var m in allMissingInDb.OrderBy(x => x.District).ThenBy(x => x.Name))
                await writer.WriteLineAsync($"{m.District},{m.ClubId},{EscapeCsv(m.Name)}");
        }
        Console.WriteLine($"CSV saved to: {fullPath}");
    }

    /// <summary>
    /// Exports ALL clubs across all 3 countries from /Clubs/search and /clubs to a detailed CSV.
    /// Deduplicates by ClubId. Useful for analysis or backup.
    /// </summary>
    public async Task ExportAllAsync(CancellationToken ct = default)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Exporting ALL clubs (3 countries + sync feed) ===");

        // Fetch /clubs
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs...");
        var syncClubs = await _api.GetClubsAsync(ct);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs: {syncClubs.Count} clubs");

        // Fetch /Clubs/search for each country
        var searchByCountry = new Dictionary<string, List<RotaryOrgClubSearchDto>>();
        int totalRawSearch = 0;
        foreach (var country in TargetCountries)
        {
            ct.ThrowIfCancellationRequested();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /Clubs/search for {country}...");
            var list = await _api.SearchClubsByCountryAsync(country, ct);
            searchByCountry[country] = list;
            totalRawSearch += list.Count;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {country}: {list.Count} clubs (raw entries — may include duplicates)");
        }

        // Build unique map: ClubId → (best entry, source country)
        // /Clubs/search has richer data than /clubs, prefer it. Fall back to /clubs entry.
        var unique = new Dictionary<string, (RotaryOrgClubSearchDto? Search, RotaryOrgClubListDto? Sync, string Country)>(StringComparer.OrdinalIgnoreCase);

        foreach (var (country, list) in searchByCountry)
        {
            foreach (var c in list)
            {
                var key = c.ClubId.ToString();
                if (!unique.ContainsKey(key))
                    unique[key] = (c, null, country);
            }
        }
        foreach (var c in syncClubs)
        {
            var key = c.ClubId.ToString();
            if (!unique.ContainsKey(key))
                unique[key] = (null, c, c.ClubCountry ?? "");
        }

        Console.WriteLine($"");
        Console.WriteLine($"=== Summary ===");
        Console.WriteLine($"  /clubs: {syncClubs.Count} clubs");
        foreach (var (country, list) in searchByCountry)
            Console.WriteLine($"  /Clubs/search ({country}): {list.Count} raw entries");
        Console.WriteLine($"  Total raw search entries:  {totalRawSearch}");
        Console.WriteLine($"  Total unique ClubIds:      {unique.Count}");
        Console.WriteLine($"");

        // CSV
        var fileName = $"all-clubs-{DateTime.Now:yyyyMMdd-HHmmss}.csv";
        var fullPath = Path.Combine(AppContext.BaseDirectory, fileName);
        using (var writer = new StreamWriter(fullPath))
        {
            await writer.WriteLineAsync("Source,ClubId,ClubName,ClubType,District,Country,State,City,PostalCode,CharterDate,MeetingDay,MeetingTime,AddressLine1,AddressLine2,Email,Website");

            foreach (var (id, val) in unique.OrderBy(x => x.Value.Search?.ClubName ?? x.Value.Sync?.ClubName ?? ""))
            {
                if (val.Search != null)
                {
                    var c = val.Search;
                    await writer.WriteLineAsync(string.Join(",", new[]
                    {
                        "search",
                        c.ClubId.ToString(),
                        EscapeCsv(c.ClubName),
                        EscapeCsv(c.ClubType),
                        EscapeCsv(c.District),
                        EscapeCsv(c.Address?.Country ?? c.Location?.Country ?? val.Country),
                        EscapeCsv(c.Address?.State ?? c.Location?.State),
                        EscapeCsv(c.Address?.City),
                        EscapeCsv(c.Address?.PostalCode),
                        c.CharterDate?.ToString("yyyy-MM-dd") ?? "",
                        EscapeCsv(c.Address?.MeetingDay),
                        EscapeCsv(c.Address?.MeetingTime),
                        EscapeCsv(c.Address?.AddressLine1),
                        EscapeCsv(c.Address?.AddressLine2),
                        EscapeCsv(c.Email),
                        EscapeCsv(c.Website),
                    }));
                }
                else if (val.Sync != null)
                {
                    var c = val.Sync;
                    await writer.WriteLineAsync(string.Join(",", new[]
                    {
                        "clubs-only",
                        c.ClubId.ToString(),
                        EscapeCsv(c.ClubName),
                        EscapeCsv(c.ClubType),
                        c.DistrictId?.ToString() ?? "",
                        EscapeCsv(c.ClubCountry),
                        "", "", "", "", "", "", "", "", "", "",
                    }));
                }
            }
        }
        Console.WriteLine($"CSV saved to: {fullPath}");
        Console.WriteLine($"Total rows in CSV: {unique.Count}");
    }

    /// <summary>
    /// Exports ALL clubs for a given district from /Clubs/search to a detailed CSV.
    /// Useful for comparing with Postman / external tools to verify API behavior.
    /// </summary>
    public async Task ExportDistrictAsync(string districtNumber, CancellationToken ct = default)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Exporting D{districtNumber} clubs from /Clubs/search ===");

        var allMatching = new List<(string Country, RotaryOrgClubSearchDto Club)>();
        foreach (var country in TargetCountries)
        {
            ct.ThrowIfCancellationRequested();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /Clubs/search for {country}...");
            var list = await _api.SearchClubsByCountryAsync(country, ct);
            // Match by both string-equality and trimmed/numeric-equivalent comparison so we
            // catch clubs whose District is "3142", " 3142", or "03142" etc.
            int matchCount = 0;
            foreach (var c in list)
            {
                if (DistrictMatches(c.District, districtNumber))
                {
                    allMatching.Add((country, c));
                    matchCount++;
                }
            }
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {country}: matched {matchCount} clubs in D{districtNumber}");
        }

        // Also fetch /clubs to compare
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs (sync feed)...");
        var syncClubs = await _api.GetClubsAsync(ct);
        var syncInDistrict = syncClubs
            .Where(c => c.DistrictId.HasValue && c.DistrictId.Value.ToString() == districtNumber)
            .ToList();
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs in D{districtNumber}: {syncInDistrict.Count}");

        // Build set of ClubIds from search to find which sync clubs are missing from search
        var searchIds = new HashSet<string>(allMatching.Select(x => x.Club.ClubId.ToString()), StringComparer.OrdinalIgnoreCase);
        var syncOnlyInDistrict = syncInDistrict.Where(c => !searchIds.Contains(c.ClubId.ToString())).ToList();

        Console.WriteLine($"");
        Console.WriteLine($"=== Summary ===");
        Console.WriteLine($"  /Clubs/search (combined 3 countries): {allMatching.Count} clubs");
        Console.WriteLine($"  /clubs (sync):                        {syncInDistrict.Count} clubs");
        Console.WriteLine($"  /clubs ONLY (not in search):          {syncOnlyInDistrict.Count} clubs");
        Console.WriteLine($"  Combined unique:                      {searchIds.Count + syncOnlyInDistrict.Count} clubs");
        Console.WriteLine($"");

        // CSV
        var fileName = $"district-{districtNumber}-export-{DateTime.Now:yyyyMMdd-HHmmss}.csv";
        var fullPath = Path.Combine(AppContext.BaseDirectory, fileName);
        using (var writer = new StreamWriter(fullPath))
        {
            await writer.WriteLineAsync("Source,ClubId,ClubName,ClubType,District,Country,State,City,PostalCode,CharterDate,MeetingDay,MeetingTime,AddressLine1,AddressLine2,Email,Website");

            foreach (var (country, c) in allMatching.OrderBy(x => x.Club.ClubName))
            {
                await writer.WriteLineAsync(string.Join(",", new[]
                {
                    "search",
                    c.ClubId.ToString(),
                    EscapeCsv(c.ClubName),
                    EscapeCsv(c.ClubType),
                    EscapeCsv(c.District),
                    EscapeCsv(c.Address?.Country ?? c.Location?.Country ?? country),
                    EscapeCsv(c.Address?.State ?? c.Location?.State),
                    EscapeCsv(c.Address?.City),
                    EscapeCsv(c.Address?.PostalCode),
                    c.CharterDate?.ToString("yyyy-MM-dd") ?? "",
                    EscapeCsv(c.Address?.MeetingDay),
                    EscapeCsv(c.Address?.MeetingTime),
                    EscapeCsv(c.Address?.AddressLine1),
                    EscapeCsv(c.Address?.AddressLine2),
                    EscapeCsv(c.Email),
                    EscapeCsv(c.Website),
                }));
            }

            foreach (var c in syncOnlyInDistrict.OrderBy(x => x.ClubName))
            {
                await writer.WriteLineAsync(string.Join(",", new[]
                {
                    "clubs-only",
                    c.ClubId.ToString(),
                    EscapeCsv(c.ClubName),
                    EscapeCsv(c.ClubType),
                    c.DistrictId?.ToString() ?? "",
                    EscapeCsv(c.ClubCountry),
                    "", "", "", "", "", "", "", "", "", "",
                }));
            }
        }
        Console.WriteLine($"CSV saved to: {fullPath}");
        Console.WriteLine($"Open in Excel and compare with Postman to identify the 2 missing clubs.");
    }

    private static bool DistrictMatches(string? clubDistrict, string targetDistrict)
    {
        if (string.IsNullOrWhiteSpace(clubDistrict)) return false;
        var trimmed = clubDistrict.Trim();
        if (string.Equals(trimmed, targetDistrict, StringComparison.OrdinalIgnoreCase)) return true;
        // Try numeric comparison to catch leading-zero variants (e.g., "03142" vs "3142")
        if (int.TryParse(trimmed, out var a) && int.TryParse(targetDistrict, out var b))
            return a == b;
        return false;
    }

    public async Task RunAsync(string districtNumber, CancellationToken ct = default)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Diagnosing district {districtNumber} ===");

        // 1. Fetch /clubs (sync clubs in this district)
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs...");
        var allSyncClubs = await _api.GetClubsAsync(ct);
        var syncClubsInDistrict = allSyncClubs
            .Where(c => c.DistrictId.HasValue && c.DistrictId.Value.ToString() == districtNumber)
            .ToList();
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs in D{districtNumber}: {syncClubsInDistrict.Count} clubs");

        // 2. Fetch /Clubs/search for all 3 countries, filter to this district
        var searchInDistrict = new List<RotaryOrgClubSearchDto>();
        foreach (var country in TargetCountries)
        {
            ct.ThrowIfCancellationRequested();
            var list = await _api.SearchClubsByCountryAsync(country, ct);
            var inDistrict = list.Where(c => c.District == districtNumber).ToList();
            if (inDistrict.Count > 0)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /Clubs/search ({country}) in D{districtNumber}: {inDistrict.Count} clubs");
                searchInDistrict.AddRange(inDistrict);
            }
        }

        // 3. Build authoritative ID set from API
        var apiIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in syncClubsInDistrict) apiIds.Add(c.ClubId.ToString());
        foreach (var c in searchInDistrict) apiIds.Add(c.ClubId.ToString());
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   Combined API set: {apiIds.Count} unique ClubIds");

        // Build ClubId → name lookup for display
        var apiNameById = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in syncClubsInDistrict)
        {
            var key = c.ClubId.ToString();
            if (!apiNameById.ContainsKey(key)) apiNameById[key] = c.ClubName ?? "";
        }
        foreach (var c in searchInDistrict)
        {
            var key = c.ClubId.ToString();
            if (!apiNameById.ContainsKey(key)) apiNameById[key] = c.ClubName ?? "";
        }

        // 4. Get DB clubs in this district
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var dbClubs = (await conn.QueryAsync<(string ClubRotaryId, string ClubName, int IsSynced, int AddedByCountrySync)>(@"
            SELECT IFNULL(cm.ClubRotaryId, '') AS ClubRotaryId,
                   IFNULL(cm.ClubName, '') AS ClubName,
                   IFNULL(cm.IsSyncedFromRotaryOrg, 0) AS IsSynced,
                   IFNULL(cm.AddedByCountrySync, 0) AS AddedByCountrySync
            FROM club_master cm
            JOIN district_master d ON d.pk_district_id = cm.fk_district_id
            WHERE d.DistrictNumber = @D AND cm.isdeleted = 0
            ORDER BY cm.ClubName",
            new { D = districtNumber })).ToList();
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   DB clubs in D{districtNumber}: {dbClubs.Count} clubs");

        var dbIds = new HashSet<string>(dbClubs.Select(x => x.ClubRotaryId), StringComparer.OrdinalIgnoreCase);

        // 5. Differences
        var missingInDb = apiIds.Where(id => !dbIds.Contains(id))
            .Select(id => (Id: id, Name: apiNameById.GetValueOrDefault(id, "")))
            .OrderBy(x => x.Name)
            .ToList();

        var missingInApi = dbClubs.Where(c => !apiIds.Contains(c.ClubRotaryId)).ToList();

        Console.WriteLine($"");
        Console.WriteLine($"=== Summary for D{districtNumber} ===");
        Console.WriteLine($"  Clubs in API:          {apiIds.Count}");
        Console.WriteLine($"  Clubs in DB:           {dbClubs.Count}");
        Console.WriteLine($"  Missing in DB (API has, DB doesn't): {missingInDb.Count}");
        Console.WriteLine($"  Missing in API (DB has, API doesn't): {missingInApi.Count}");
        Console.WriteLine($"");

        if (missingInDb.Count > 0)
        {
            Console.WriteLine($"=== {missingInDb.Count} clubs in API but MISSING from your DB ===");
            Console.WriteLine($"ClubRotaryId  ClubName");
            Console.WriteLine($"------------  --------");
            foreach (var c in missingInDb)
                Console.WriteLine($"{c.Id,-12}  {c.Name}");
            Console.WriteLine($"");
        }

        if (missingInApi.Count > 0)
        {
            Console.WriteLine($"=== {missingInApi.Count} clubs in DB but NOT in API (Rotary.org doesn't list them) ===");
            Console.WriteLine($"ClubRotaryId  ClubName");
            Console.WriteLine($"------------  --------");
            foreach (var c in missingInApi)
                Console.WriteLine($"{c.ClubRotaryId,-12}  {c.ClubName}");
            Console.WriteLine($"");
        }

        // 6. CSV output
        var fileName = $"district-{districtNumber}-diagnose-{DateTime.Now:yyyyMMdd-HHmmss}.csv";
        var fullPath = Path.Combine(AppContext.BaseDirectory, fileName);
        using (var writer = new StreamWriter(fullPath))
        {
            await writer.WriteLineAsync("Status,ClubRotaryId,ClubName");
            foreach (var c in missingInDb)
                await writer.WriteLineAsync($"MISSING_IN_DB,{c.Id},{EscapeCsv(c.Name)}");
            foreach (var c in missingInApi)
                await writer.WriteLineAsync($"MISSING_IN_API,{c.ClubRotaryId},{EscapeCsv(c.ClubName)}");
        }
        Console.WriteLine($"CSV saved to: {fullPath}");
    }

    private static string EscapeCsv(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}

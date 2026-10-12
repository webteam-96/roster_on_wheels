using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Lists all unique districts found across /clubs and /Clubs/search (India + Sri Lanka + Nepal),
/// shows club count per district, and flags which are already in our local district_master.
/// Outputs to console and CSV file. Helps decide which districts to add.
/// </summary>
public class DistrictListExporter
{
    private static readonly string[] TargetCountries = { "India", "Sri Lanka", "Nepal" };

    private readonly IRotaryOrgApiClient _api;
    private readonly IConfiguration _config;
    private readonly ILogger<DistrictListExporter> _logger;
    private readonly string _connectionString;

    public DistrictListExporter(IRotaryOrgApiClient api, IConfiguration config, ILogger<DistrictListExporter> logger)
    {
        _api = api;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    public async Task RunAsync(CancellationToken ct = default)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Listing all districts from API ===");

        // Fetch from /clubs (sync clubs — has DistrictId int)
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs...");
        var syncClubs = await _api.GetClubsAsync(ct);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs: {syncClubs.Count} clubs");

        // Fetch /Clubs/search for each country (has District string + Country)
        var searchResults = new Dictionary<string, List<RotaryOrgClubSearchDto>>();
        foreach (var country in TargetCountries)
        {
            ct.ThrowIfCancellationRequested();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /Clubs/search for {country}...");
            var list = await _api.SearchClubsByCountryAsync(country, ct);
            searchResults[country] = list;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {country}: {list.Count} clubs");
        }

        // Build district aggregate: District# → (Country, ClubCount, Source)
        var districts = new Dictionary<string, DistrictInfo>(StringComparer.OrdinalIgnoreCase);

        // From /clubs (no country in this response, mark country as 'Unknown — sync feed')
        foreach (var c in syncClubs)
        {
            if (!c.DistrictId.HasValue) continue;
            var key = c.DistrictId.Value.ToString();
            if (!districts.TryGetValue(key, out var info))
            {
                info = new DistrictInfo { DistrictNumber = key, Country = c.ClubCountry ?? "" };
                districts[key] = info;
            }
            info.ClubCountFromClubs++;
            if (string.IsNullOrEmpty(info.Country) && !string.IsNullOrEmpty(c.ClubCountry))
                info.Country = c.ClubCountry;
        }

        // From /Clubs/search per country (has Country explicitly)
        foreach (var (country, clubs) in searchResults)
        {
            foreach (var c in clubs)
            {
                if (string.IsNullOrWhiteSpace(c.District)) continue;
                var key = c.District;
                if (!districts.TryGetValue(key, out var info))
                {
                    info = new DistrictInfo { DistrictNumber = key, Country = country };
                    districts[key] = info;
                }
                info.ClubCountFromSearch++;
                // Search results have authoritative country
                info.Country = country;
            }
        }

        // Load our local district_master
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var localDistrictNumbers = (await conn.QueryAsync<string>(@"
            SELECT DistrictNumber FROM district_master WHERE isdeleted = 0"))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Local district_master: {localDistrictNumbers.Count} districts");

        // Mark each as in-DB or not
        foreach (var info in districts.Values)
            info.InLocalDB = localDistrictNumbers.Contains(info.DistrictNumber);

        // Sort: country, then district number
        var sorted = districts.Values
            .OrderBy(d => d.Country, StringComparer.OrdinalIgnoreCase)
            .ThenBy(d => d.DistrictNumber, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Print to console (just summary; CSV has full list)
        Console.WriteLine($"");
        Console.WriteLine($"=== Summary ===");
        Console.WriteLine($"Total unique districts found: {sorted.Count}");
        var byCountry = sorted.GroupBy(d => d.Country).OrderBy(g => g.Key);
        foreach (var g in byCountry)
        {
            int inDB = g.Count(d => d.InLocalDB);
            int missing = g.Count(d => !d.InLocalDB);
            Console.WriteLine($"  {g.Key,-15} {g.Count(),3} districts  ({inDB} already in DB, {missing} missing)");
        }
        Console.WriteLine($"");

        // Write CSV
        var fileName = $"district-list-{DateTime.Now:yyyyMMdd-HHmmss}.csv";
        var fullPath = Path.Combine(AppContext.BaseDirectory, fileName);
        using (var writer = new StreamWriter(fullPath))
        {
            await writer.WriteLineAsync("DistrictNumber,Country,InLocalDB,ClubCount_FromClubsAPI,ClubCount_FromSearchAPI,TotalClubCount");
            foreach (var d in sorted)
            {
                int total = Math.Max(d.ClubCountFromClubs, d.ClubCountFromSearch);
                await writer.WriteLineAsync($"{d.DistrictNumber},{EscapeCsv(d.Country)},{(d.InLocalDB ? "YES" : "NO")},{d.ClubCountFromClubs},{d.ClubCountFromSearch},{total}");
            }
        }
        Console.WriteLine($"CSV saved to: {fullPath}");

        // Also print missing districts to console (capped at 50 lines)
        var missingList = sorted.Where(d => !d.InLocalDB).ToList();
        Console.WriteLine($"");
        Console.WriteLine($"=== Missing districts (not in our local district_master) ===");
        Console.WriteLine($"District   Country         FromClubs  FromSearch");
        Console.WriteLine($"--------   -------------   ---------  ----------");
        foreach (var d in missingList.Take(100))
        {
            Console.WriteLine($"{d.DistrictNumber,-10} {d.Country,-15} {d.ClubCountFromClubs,9}  {d.ClubCountFromSearch,10}");
        }
        if (missingList.Count > 100)
            Console.WriteLine($"... and {missingList.Count - 100} more (see CSV file)");
        Console.WriteLine($"");
        Console.WriteLine($"Total missing: {missingList.Count}");
    }

    private static string EscapeCsv(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }

    private class DistrictInfo
    {
        public string DistrictNumber { get; set; } = "";
        public string Country { get; set; } = "";
        public bool InLocalDB { get; set; }
        public int ClubCountFromClubs { get; set; }
        public int ClubCountFromSearch { get; set; }
    }
}

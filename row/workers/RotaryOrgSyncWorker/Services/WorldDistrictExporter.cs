using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Lists ALL districts worldwide by calling /Clubs/search for every Rotary country.
/// Outputs a CSV with: Country, DistrictNumber, ClubCount, InLocalDB.
/// No DB changes, no email — read-only diagnostic.
/// </summary>
public class WorldDistrictExporter
{
    // Comprehensive list of countries with Rotary clubs. Names must match Rotary.org's
    // /Clubs/search expected country values. If a country returns 0 or errors, it's
    // logged and skipped — does not abort the run.
    private static readonly string[] AllCountries = new[]
    {
        "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Aruba",
        "Australia", "Austria", "Azerbaijan",
        "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize",
        "Benin", "Bermuda", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil",
        "Bulgaria", "Burkina Faso", "Burundi",
        "Cambodia", "Cameroon", "Canada", "Cape Verde", "Cayman Islands", "Chad",
        "Chile", "China", "Colombia", "Congo", "Costa Rica", "Croatia", "Cuba",
        "Curacao", "Cyprus", "Czech Republic",
        "Denmark", "Djibouti", "Dominica", "Dominican Republic",
        "Ecuador", "Egypt", "El Salvador", "Estonia", "Ethiopia",
        "Faroe Islands", "Fiji", "Finland", "France", "French Guiana",
        "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Gibraltar", "Greece",
        "Greenland", "Grenada", "Guadeloupe", "Guam", "Guatemala", "Guinea", "Guyana",
        "Haiti", "Honduras", "Hong Kong", "Hungary",
        "Iceland", "India", "Indonesia", "Ireland", "Israel", "Italy",
        "Jamaica", "Japan", "Jordan",
        "Kazakhstan", "Kenya", "Korea", "South Korea", "Kosovo", "Kuwait", "Kyrgyzstan",
        "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Liechtenstein",
        "Lithuania", "Luxembourg",
        "Macau", "Macedonia", "North Macedonia", "Madagascar", "Malawi", "Malaysia",
        "Mali", "Malta", "Martinique", "Mauritania", "Mauritius", "Mexico", "Moldova",
        "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
        "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger",
        "Nigeria", "Norway",
        "Oman",
        "Pakistan", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
        "Philippines", "Poland", "Portugal", "Puerto Rico",
        "Qatar",
        "Reunion", "Romania", "Russia", "Rwanda",
        "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
        "Samoa", "San Marino", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
        "Sierra Leone", "Singapore", "Sint Maarten", "Slovakia", "Slovenia",
        "Solomon Islands", "South Africa", "Spain", "Sri Lanka", "Sudan", "Suriname",
        "Sweden", "Switzerland",
        "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo",
        "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turks and Caicos",
        "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
        "United States", "Uruguay", "Uzbekistan",
        "Vanuatu", "Venezuela", "Vietnam",
        "Yemen",
        "Zambia", "Zimbabwe",
        "Cote d'Ivoire", "Eswatini",
    };

    private readonly IRotaryOrgApiClient _api;
    private readonly IConfiguration _config;
    private readonly ILogger<WorldDistrictExporter> _logger;
    private readonly string _connectionString;

    public WorldDistrictExporter(IRotaryOrgApiClient api, IConfiguration config, ILogger<WorldDistrictExporter> logger)
    {
        _api = api;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    public async Task RunAsync(CancellationToken ct = default)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Listing ALL world districts ===");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Will probe {AllCountries.Length} countries via /Clubs/search...");
        Console.WriteLine("");

        // Aggregate: (Country, District) → ClubCount
        var byCountryDistrict = new Dictionary<(string Country, string District), int>();
        var perCountrySummary = new List<(string Country, int Districts, int Clubs, string Status)>();
        var failedCountries = new List<(string Country, string Error)>();
        int totalApiCalls = 0;
        int successCalls = 0;

        var startTime = DateTime.UtcNow;

        foreach (var country in AllCountries)
        {
            ct.ThrowIfCancellationRequested();
            totalApiCalls++;
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var clubs = await _api.SearchClubsByCountryAsync(country, ct);
                sw.Stop();
                successCalls++;

                if (clubs.Count == 0)
                {
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {country,-30} 0 clubs");
                    perCountrySummary.Add((country, 0, 0, "no clubs"));
                    continue;
                }

                var distinctDistricts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var c in clubs)
                {
                    if (string.IsNullOrWhiteSpace(c.District)) continue;
                    var key = (Country: country, District: c.District.Trim());
                    if (!byCountryDistrict.ContainsKey(key)) byCountryDistrict[key] = 0;
                    byCountryDistrict[key]++;
                    distinctDistricts.Add(c.District.Trim());
                }
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {country,-30} {distinctDistricts.Count,4} districts  {clubs.Count,5} clubs  ({sw.ElapsedMilliseconds}ms)");
                perCountrySummary.Add((country, distinctDistricts.Count, clubs.Count, "ok"));
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {country,-30} FAILED: {ex.Message}");
                failedCountries.Add((country, ex.Message));
                perCountrySummary.Add((country, 0, 0, $"error: {ex.Message}"));
            }
        }

        var elapsed = DateTime.UtcNow - startTime;
        Console.WriteLine("");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Probed {totalApiCalls} countries in {elapsed.TotalMinutes:F1} min ({successCalls} succeeded, {failedCountries.Count} failed)");

        // Load existing district_master to flag InLocalDB
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var localDistricts = (await conn.QueryAsync<string>(@"
            SELECT DistrictNumber FROM district_master WHERE isdeleted = 0"))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Local district_master: {localDistricts.Count} districts");

        // Build sorted output
        var rows = byCountryDistrict
            .Select(kv => new
            {
                Country = kv.Key.Country,
                District = kv.Key.District,
                ClubCount = kv.Value,
                InLocalDB = localDistricts.Contains(kv.Key.District),
            })
            .OrderBy(r => r.Country, StringComparer.OrdinalIgnoreCase)
            .ThenBy(r => r.District, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Console: per-country summary table
        Console.WriteLine("");
        Console.WriteLine($"=== Per-country summary ===");
        Console.WriteLine($"{"Country",-30} {"Districts",10} {"Clubs",6} {"In DB",6} {"Missing",8}");
        Console.WriteLine($"{new string('-', 30)} {new string('-', 10)} {new string('-', 6)} {new string('-', 6)} {new string('-', 8)}");

        foreach (var grp in rows.GroupBy(r => r.Country, StringComparer.OrdinalIgnoreCase).OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase))
        {
            int districts = grp.Count();
            int clubs = grp.Sum(r => r.ClubCount);
            int inDb = grp.Count(r => r.InLocalDB);
            int missing = districts - inDb;
            Console.WriteLine($"{grp.Key,-30} {districts,10} {clubs,6} {inDb,6} {missing,8}");
        }

        Console.WriteLine($"{new string('-', 30)} {new string('-', 10)} {new string('-', 6)} {new string('-', 6)} {new string('-', 8)}");
        var totalDistricts = rows.Count;
        var totalClubs = rows.Sum(r => r.ClubCount);
        var totalInDb = rows.Count(r => r.InLocalDB);
        var totalMissing = totalDistricts - totalInDb;
        Console.WriteLine($"{"TOTAL",-30} {totalDistricts,10} {totalClubs,6} {totalInDb,6} {totalMissing,8}");

        // CSV
        var fileName = $"world-districts-{DateTime.Now:yyyyMMdd-HHmmss}.csv";
        var fullPath = Path.Combine(AppContext.BaseDirectory, fileName);
        using (var writer = new StreamWriter(fullPath))
        {
            await writer.WriteLineAsync("Country,DistrictNumber,ClubCount,InLocalDB");
            foreach (var r in rows)
                await writer.WriteLineAsync($"{EscapeCsv(r.Country)},{EscapeCsv(r.District)},{r.ClubCount},{(r.InLocalDB ? "YES" : "NO")}");
        }
        Console.WriteLine("");
        Console.WriteLine($"CSV saved to: {fullPath}");
        Console.WriteLine($"Total rows: {rows.Count}");

        if (failedCountries.Count > 0)
        {
            Console.WriteLine("");
            Console.WriteLine($"=== Failed countries ({failedCountries.Count}) ===");
            foreach (var f in failedCountries)
                Console.WriteLine($"  {f.Country}: {f.Error}");
        }
    }

    private static string EscapeCsv(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}

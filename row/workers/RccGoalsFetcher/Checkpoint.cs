using System.Text.Json;

namespace RccGoalsFetcher;

using Row = Dictionary<string, object?>;

public sealed record ClubRef(string District, string NodeId, string? Group, JsonElement? Node);
public sealed record FailedClub(ClubRef Club, string Error);
public sealed record RawItem(string District, string ClubName, string ClubId, JsonElement Goals);

/// Everything fetched for one district in one Rotary year. Saved as checkpoint\<year>\D<district>.json
/// as soon as the district is done, so a run that stops part-way resumes from the next district
/// (user 2026-10-22). Only a cache: the run deletes the year's checkpoint once its Excel is saved.
public sealed class DistrictPart
{
    public string District { get; set; } = "";
    public DateTime SavedAt { get; set; }
    public string? ClubListError { get; set; }
    public string? TotalsError { get; set; }
    public List<Row> Clubs { get; set; } = new();
    public List<Row> DistrictTotals { get; set; } = new();
    public List<Row> ClubGoals { get; set; } = new();
    public List<Row> Contributions { get; set; } = new();
    public List<RawItem> Raw { get; set; } = new();
    public List<FailedClub> FailedClubs { get; set; } = new();
    // Women count (RCC Trends - Gender) for the district and each club, and the district's Rotaract
    // clubs with their member counts (user 2026-10-26). Their errors are reported, not retried.
    public List<Row> Women { get; set; } = new();
    public List<Row> RotaractClubs { get; set; } = new();
    public List<string> ExtraErrors { get; set; } = new();

    public int FailureCount => (ClubListError != null ? 1 : 0) + (TotalsError != null ? 1 : 0) + FailedClubs.Count;
    public IEnumerable<string> Errors =>
        new[] { ClubListError, TotalsError }.OfType<string>().Concat(FailedClubs.Select(f => f.Error)).Concat(ExtraErrors);

    private static string FileOf(string dir, string district) => Path.Combine(dir, $"D{district}.json");

    public void Save(string dir)
    {
        SavedAt = DateTime.UtcNow;
        var path = FileOf(dir, District);
        var tmp = path + ".tmp";   // written whole, then swapped in - a crash never leaves half a file
        File.WriteAllText(tmp, JsonSerializer.Serialize(this));
        File.Move(tmp, path, overwrite: true);
    }

    /// The saved district, or null when there is none, it is older than maxAgeHours (yesterday's run)
    /// or it cannot be read.
    public static DistrictPart? Load(string dir, string district, int maxAgeHours)
    {
        var path = FileOf(dir, district);
        if (!File.Exists(path)) return null;
        if (File.GetLastWriteTime(path) < DateTime.UtcNow.AddHours(-maxAgeHours))
        {
            Log.Info($"  District {district}: checkpoint is older than {maxAgeHours} h - fetching again.");
            return null;
        }
        try
        {
            var p = JsonSerializer.Deserialize<DistrictPart>(File.ReadAllText(path));
            if (p == null || p.District != district) return null;
            // Read back, the row values are JsonElements - turn them into the string / long / double /
            // bool values the Excel writer expects, the same as a fresh fetch.
            foreach (var list in new[] { p.Clubs, p.DistrictTotals, p.ClubGoals, p.Contributions, p.Women, p.RotaractClubs })
                foreach (var row in list)
                    foreach (var k in row.Keys.ToList())
                        row[k] = row[k] is JsonElement e ? Plain(e) : row[k];
            return p;
        }
        catch (Exception ex)
        {
            Log.Warn($"  District {district}: checkpoint unreadable ({ex.Message.Split((char)10)[0]}) - fetching again.");
            return null;
        }
    }

    private static object? Plain(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };
}

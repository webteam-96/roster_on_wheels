using Microsoft.Extensions.Configuration;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// ROW: which Rotary.org clubs this instance may sync. ROW syncs every country EXCEPT India
/// (India is RIZones' territory). RotaryOrgApiClient drops skipped clubs from every club list it
/// returns (/clubs, /clubs/updates, /Clubs/search), so no worker ever sees one.
///
/// Config:
///   RotaryOrgSync:SkipCountries         default ["India"]
///   RotaryOrgSync:SyncClubsWithNoCountry default false — a club Rotary.org sends without a
///                                        country is skipped, because it could be an Indian club.
/// </summary>
public sealed class CountryScope
{
    // Spellings Rotary.org and our own data use for India.
    private static readonly string[] IndiaAliases = { "India", "IN", "IND", "Bharat", "Republic of India" };

    private readonly HashSet<string> _skip = new(StringComparer.OrdinalIgnoreCase);
    private readonly bool _keepNoCountry;
    private readonly string[] _names;

    public CountryScope(IConfiguration config)
    {
        var configured = config.GetSection("RotaryOrgSync:SkipCountries").Get<string[]>();
        var names = configured is { Length: > 0 } ? configured : new[] { "India" };
        _names = names.Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n.Trim()).ToArray();
        foreach (var n in _names)
        {
            _skip.Add(n);
            if (IndiaAliases.Contains(n, StringComparer.OrdinalIgnoreCase))
                foreach (var a in IndiaAliases) _skip.Add(a);
        }
        _keepNoCountry = bool.TryParse(config["RotaryOrgSync:SyncClubsWithNoCountry"], out var keep) && keep;
    }

    /// <summary>The configured countries, for logs and report emails, e.g. "India, or no country".</summary>
    public string Describe => string.Join(", ", _names) + (_keepNoCountry ? "" : ", or no country");

    /// <summary>True when a club in <paramref name="country"/> must not be synced.</summary>
    public bool IsSkipped(string? country) => IsSkippedAny(country);

    /// <summary>True when ANY of the given country values marks the club as skipped.
    /// A club is kept only when at least one value is present and none of them is skipped.</summary>
    public bool IsSkippedAny(params string?[] countries)
    {
        var present = countries.Where(c => !string.IsNullOrWhiteSpace(c)).ToList();
        if (present.Count == 0) return !_keepNoCountry;
        return present.Any(c => _skip.Contains(c!.Trim()));
    }
}

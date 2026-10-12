namespace RotaryApi.Services;

public static class CurrencyHelper
{
    private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase) { "INR", "NPR", "LKR", "USD" };

    // v1 add/edit pages never send Currency, so this always resolves them to "INR" —
    // zero behavior change for those pages (every project was implicitly INR before this feature).
    public static string Normalize(string? currency) =>
        !string.IsNullOrWhiteSpace(currency) && Allowed.Contains(currency.Trim())
            ? currency.Trim().ToUpperInvariant()
            : "INR";

    // Convert `amount` from currency `from` to currency `to`, using a table of INR-per-unit rates
    // (see ICurrencyRateService.GetInrRatesAsync). Any→any goes through INR. Unknown codes → INR.
    public static decimal Convert(decimal amount, string? from, string? to, IReadOnlyDictionary<string, decimal> inrRates)
    {
        var f = Normalize(from);
        var t = Normalize(to);
        if (amount == 0m || f == t) return amount;
        var rf = inrRates.TryGetValue(f, out var a) ? a : 1m; // INR per 1 unit of `from`
        var rt = inrRates.TryGetValue(t, out var b) ? b : 1m; // INR per 1 unit of `to`
        return rt <= 0m ? amount : amount * rf / rt;
    }

    // Districts created before district_master.Country existed were backfilled from their OLD zone
    // name (see DatabaseInitializer.cs) — most pre-existing Indian districts carry one of these
    // literal artifacts rather than "India". Treat them (and null/blank) as INR. Mirrors the
    // frontend resolveDefaultCurrency() in src/lib/currency.ts so both sides agree.
    private static readonly HashSet<string> LegacyIndiaZoneNames =
        new(StringComparer.OrdinalIgnoreCase) { "zone 4", "zone 5", "zone 6", "zone 0", "zone 7", "testzone1" };

    // The currency a district's totals should be expressed in: the SuperAdmin-set
    // district_master.DefaultCurrency when valid, else a guess from the district's country.
    public static string ResolveDefaultCurrency(string? districtDefaultCurrency, string? districtCountry)
    {
        var explicitC = (districtDefaultCurrency ?? "").Trim().ToUpperInvariant();
        if (Allowed.Contains(explicitC)) return explicitC;

        var c = (districtCountry ?? "").Trim().ToLowerInvariant();
        if (c == "nepal") return "NPR";
        if (c == "sri lanka") return "LKR";
        if (c == "" || c == "india" || LegacyIndiaZoneNames.Contains(c)) return "INR";
        return "USD"; // Taiwan + any other world-sync country
    }
}

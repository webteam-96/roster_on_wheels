namespace RotaryApi.Services;

/// <summary>
/// Currencies for ROW (same rules as the NestJS edition's currency.helper.ts): the accepted currencies are
/// the brand's list (ISO 4217, <c>Brand:Locale:Currencies</c>); anything else falls back to the brand's
/// default currency (<c>Brand:Locale:DefaultCurrency</c>). The original platform accepted INR / NPR / LKR / USD and
/// turned everything else into INR.
/// </summary>
public static class CurrencyHelper
{
    private static bool Allowed(string code) =>
        Brand.Currencies.Contains(code, StringComparer.OrdinalIgnoreCase) || string.Equals(code, Brand.DefaultCurrency, StringComparison.OrdinalIgnoreCase);

    /// <summary>A valid code from the brand's list, else the brand's default currency.</summary>
    public static string Normalize(string? currency) =>
        !string.IsNullOrWhiteSpace(currency) && Allowed(currency.Trim())
            ? currency.Trim().ToUpperInvariant()
            : Brand.DefaultCurrency.ToUpperInvariant();

    /// <summary>
    /// Convert <paramref name="amount"/> between currencies with rates against one base currency:
    /// rates[X] = units of the base per 1 unit of X (the base itself is 1). See ICurrencyRateService.
    /// </summary>
    public static decimal Convert(decimal amount, string? from, string? to, IReadOnlyDictionary<string, decimal> rates)
    {
        var f = Normalize(from);
        var t = Normalize(to);
        if (amount == 0m || f == t) return amount;
        var rf = rates.TryGetValue(f, out var a) ? a : 1m;
        var rt = rates.TryGetValue(t, out var b) ? b : 1m;
        return rt <= 0m ? amount : amount * rf / rt;
    }

    /// <summary>A district's currency: its explicit DefaultCurrency when valid, else the brand's default.</summary>
    public static string ResolveDefaultCurrency(string? districtDefaultCurrency, string? districtCountry = null)
    {
        var explicitC = (districtDefaultCurrency ?? "").Trim().ToUpperInvariant();
        return explicitC.Length > 0 && Allowed(explicitC) ? explicitC : Brand.DefaultCurrency.ToUpperInvariant();
    }
}

using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace RotaryApi.Services;

/// <summary>
/// Live exchange rates for the brand's currencies (same rules as the NestJS edition's currency-rate.service.ts),
/// from the free, key-less open.er-api.com feed, cached in memory (12 h; 30 min after a failure). Rates are
/// "units of the brand's default currency per 1 unit of X" (the original platform used INR as that base), as
/// <see cref="CurrencyHelper.Convert"/> expects. When the feed is unreachable every rate falls back to 1, so
/// cost totals still render (summed unconverted).
/// </summary>
public interface ICurrencyRateService
{
    /// <summary>Value of one unit of each brand currency in the brand's default currency (the name is the original platform's).</summary>
    Task<IReadOnlyDictionary<string, decimal>> GetInrRatesAsync();

    /// <summary>One-off convert; for loops prefer GetInrRatesAsync() once + CurrencyHelper.Convert per row.</summary>
    Task<decimal> ConvertAsync(decimal amount, string? from, string? to);
}

public class CurrencyRateService : ICurrencyRateService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<CurrencyRateService> _log;

    private const string CacheKey = "fx_brand_rates_v1";
    private static readonly TimeSpan OkTtl = TimeSpan.FromHours(12);
    private static readonly TimeSpan FailTtl = TimeSpan.FromMinutes(30); // retry sooner after a miss
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public CurrencyRateService(IHttpClientFactory httpFactory, IMemoryCache cache, ILogger<CurrencyRateService> log)
    {
        _httpFactory = httpFactory;
        _cache = cache;
        _log = log;
    }

    private static string Base => Brand.DefaultCurrency.ToUpperInvariant();

    private static string[] Supported =>
        Brand.Currencies.Select(c => c.ToUpperInvariant()).Prepend(Base).Distinct().ToArray();

    /// <summary>Every rate 1: used when the feed is down and nothing is cached.</summary>
    public static IReadOnlyDictionary<string, decimal> Fallback =>
        Supported.ToDictionary(c => c, _ => 1m, StringComparer.OrdinalIgnoreCase);

    public async Task<IReadOnlyDictionary<string, decimal>> GetInrRatesAsync()
    {
        if (_cache.TryGetValue(CacheKey, out IReadOnlyDictionary<string, decimal>? cached) && cached is not null)
            return cached;

        await Gate.WaitAsync();
        try
        {
            if (_cache.TryGetValue(CacheKey, out cached) && cached is not null) return cached;
            var live = await FetchLiveRatesAsync();
            var rates = live ?? Fallback;
            _cache.Set(CacheKey, rates, live is not null ? OkTtl : FailTtl);
            return rates;
        }
        finally { Gate.Release(); }
    }

    public async Task<decimal> ConvertAsync(decimal amount, string? from, string? to)
        => CurrencyHelper.Convert(amount, from, to, await GetInrRatesAsync());

    private async Task<IReadOnlyDictionary<string, decimal>?> FetchLiveRatesAsync()
    {
        try
        {
            var http = _httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(8);
            // response.rates[X] = units of X per 1 base → base per 1 X = 1 / that.
            var json = await http.GetStringAsync($"https://open.er-api.com/v6/latest/{Base}");
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("result", out var res) && res.GetString() != "success") return null;
            if (!root.TryGetProperty("rates", out var ratesEl) || ratesEl.ValueKind != JsonValueKind.Object) return null;

            var map = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase) { [Base] = 1m };
            foreach (var code in Supported)
            {
                if (code == Base) continue;
                map[code] = ratesEl.TryGetProperty(code, out var v) && v.ValueKind == JsonValueKind.Number
                            && v.TryGetDecimal(out var perBase) && perBase > 0m
                    ? 1m / perBase
                    : 1m; // the feed omitted it: unconverted
            }
            return map;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Live FX fetch failed; using fallback/cached rates");
            return null;
        }
    }
}

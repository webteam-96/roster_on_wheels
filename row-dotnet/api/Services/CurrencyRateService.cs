using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace RotaryApi.Services;

// Live foreign-exchange rates for the four project currencies (INR/NPR/LKR/USD).
// Rates are fetched from a free, key-less endpoint (open.er-api.com), cached in-memory,
// and fall back to a static peg table if the API is unreachable so cost aggregation
// NEVER breaks. All rates are normalised to "INR per 1 unit of currency" — callers
// convert any→any through INR (see CurrencyHelper.Convert).
public interface ICurrencyRateService
{
    // INR value of one unit of each supported currency, e.g. { INR:1, USD:83.1, NPR:0.62, LKR:0.28 }.
    Task<IReadOnlyDictionary<string, decimal>> GetInrRatesAsync();

    // One-off convert; for loops prefer GetInrRatesAsync() once + CurrencyHelper.Convert per row.
    Task<decimal> ConvertAsync(decimal amount, string? from, string? to);
}

public class CurrencyRateService : ICurrencyRateService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<CurrencyRateService> _log;

    private const string CacheKey = "fx_inr_rates_v1";
    private static readonly TimeSpan OkTtl = TimeSpan.FromHours(12);
    private static readonly TimeSpan FailTtl = TimeSpan.FromMinutes(30); // retry sooner after a miss
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private static readonly string[] Supported = { "INR", "NPR", "LKR", "USD" };

    // Static fallback: INR value of 1 unit. Used only when the live API is down AND nothing is
    // cached. NPR is pegged to INR (1.6 NPR = 1 INR); USD/LKR are rough and only a safety net.
    public static readonly IReadOnlyDictionary<string, decimal> FallbackInr =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["INR"] = 1m,
            ["NPR"] = 0.625m,
            ["LKR"] = 0.28m,
            ["USD"] = 83m,
        };

    public CurrencyRateService(IHttpClientFactory httpFactory, IMemoryCache cache, ILogger<CurrencyRateService> log)
    {
        _httpFactory = httpFactory;
        _cache = cache;
        _log = log;
    }

    public async Task<IReadOnlyDictionary<string, decimal>> GetInrRatesAsync()
    {
        if (_cache.TryGetValue(CacheKey, out IReadOnlyDictionary<string, decimal>? cached) && cached is not null)
            return cached;

        await Gate.WaitAsync();
        try
        {
            if (_cache.TryGetValue(CacheKey, out cached) && cached is not null) return cached;
            var live = await FetchLiveInrRatesAsync();
            var rates = live ?? FallbackInr;
            _cache.Set(CacheKey, rates, live is not null ? OkTtl : FailTtl);
            return rates;
        }
        finally { Gate.Release(); }
    }

    public async Task<decimal> ConvertAsync(decimal amount, string? from, string? to)
        => CurrencyHelper.Convert(amount, from, to, await GetInrRatesAsync());

    private async Task<IReadOnlyDictionary<string, decimal>?> FetchLiveInrRatesAsync()
    {
        try
        {
            var http = _httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(8);
            // Base INR: response.rates[X] = units of X per 1 INR → INR per 1 X = 1 / that.
            var json = await http.GetStringAsync("https://open.er-api.com/v6/latest/INR");
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("result", out var res) && res.GetString() != "success") return null;
            if (!root.TryGetProperty("rates", out var ratesEl) || ratesEl.ValueKind != JsonValueKind.Object) return null;

            var map = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase) { ["INR"] = 1m };
            foreach (var code in Supported)
            {
                if (code == "INR") continue;
                if (ratesEl.TryGetProperty(code, out var v) && v.ValueKind == JsonValueKind.Number
                    && v.TryGetDecimal(out var perInr) && perInr > 0m)
                    map[code] = 1m / perInr;
                else
                    map[code] = FallbackInr[code]; // per-currency fallback if the feed omits one
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

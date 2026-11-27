using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace RotaryApi.Services;

/// <summary>
/// Live exchange rates for the brand's currencies (same rules as the NestJS edition's currency-rate.service.ts),
/// from the free, key-less open.er-api.com feed, cached in memory (12 h; 30 min after a failure). Rates are
/// "units of the brand's default currency per 1 unit of X" (the original platform used INR as that base), as
/// <see cref="CurrencyHelper.Convert"/> expects. When the feed is unreachable the last live rates stay in use, and
/// before the first answer the dated <see cref="CurrencySeedRates"/>; amounts are never added up unconverted.
/// </summary>
public interface ICurrencyRateService
{
    /// <summary>Value of one unit of each brand currency in the brand's default currency (the name is the original platform's).</summary>
    Task<IReadOnlyDictionary<string, decimal>> GetInrRatesAsync();

    /// <summary>One-off convert; for loops prefer GetInrRatesAsync() once + CurrencyHelper.Convert per row.</summary>
    Task<decimal> ConvertAsync(decimal amount, string? from, string? to);

    /// <summary>The day the rates in use are from, and whether they came from the live feed.</summary>
    Task<CurrencyRateInfo> GetInfoAsync();
}

public sealed record CurrencyRateInfo(string Base, DateTime AsOf, bool IsLive, IReadOnlyDictionary<string, decimal> Rates);

public class CurrencyRateService : ICurrencyRateService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<CurrencyRateService> _log;

    private const string CacheKey = "fx_brand_rates_v2";
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
        CountryCurrency.All.Concat(Brand.Currencies).Select(c => c.Trim().ToUpperInvariant()).Prepend(Base).Distinct().ToArray();

    private sealed record Rates(IReadOnlyDictionary<string, decimal> Map, DateTime AsOf, bool IsLive);

    private static volatile Rates? _lastLive;

    /// <summary>The seed rates in the brand's base currency: used until the feed answers.</summary>
    public static IReadOnlyDictionary<string, decimal> Fallback
    {
        get
        {
            var map = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            var basePerUsd = CurrencySeedRates.PerUsd.GetValueOrDefault(Base, 1m);
            foreach (var (code, perUsd) in CurrencySeedRates.PerUsd) map[code] = basePerUsd / perUsd;
            map[Base] = 1m;
            return map;
        }
    }

    public async Task<IReadOnlyDictionary<string, decimal>> GetInrRatesAsync() => (await GetRatesAsync()).Map;

    public async Task<CurrencyRateInfo> GetInfoAsync()
    {
        var r = await GetRatesAsync();
        return new CurrencyRateInfo(Base, r.AsOf, r.IsLive, r.Map);
    }

    private async Task<Rates> GetRatesAsync()
    {
        if (_cache.TryGetValue(CacheKey, out Rates? cached) && cached is not null) return cached;

        await Gate.WaitAsync();
        try
        {
            if (_cache.TryGetValue(CacheKey, out cached) && cached is not null) return cached;
            var live = await FetchLiveRatesAsync();
            if (live is not null) _lastLive = live;
            var rates = live ?? _lastLive ?? new Rates(Fallback, CurrencySeedRates.AsOf, false);
            _cache.Set(CacheKey, rates, live is not null ? OkTtl : FailTtl);
            return rates;
        }
        finally { Gate.Release(); }
    }

    public async Task<decimal> ConvertAsync(decimal amount, string? from, string? to)
        => CurrencyHelper.Convert(amount, from, to, await GetInrRatesAsync());

    private async Task<Rates?> FetchLiveRatesAsync()
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

            // Start from the last known rates, so a code the feed leaves out keeps its last value.
            var map = new Dictionary<string, decimal>(_lastLive?.Map ?? Fallback, StringComparer.OrdinalIgnoreCase) { [Base] = 1m };
            foreach (var code in Supported)
            {
                if (code == Base) continue;
                if (ratesEl.TryGetProperty(code, out var v) && v.ValueKind == JsonValueKind.Number
                    && v.TryGetDecimal(out var perBase) && perBase > 0m)
                    map[code] = 1m / perBase;
            }
            var asOf = root.TryGetProperty("time_last_update_unix", out var unix) && unix.TryGetInt64(out var s)
                ? DateTimeOffset.FromUnixTimeSeconds(s).UtcDateTime : DateTime.UtcNow;
            return new Rates(map, asOf, true);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Live FX fetch failed; using fallback/cached rates");
            return null;
        }
    }
}

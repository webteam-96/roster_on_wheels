using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Localization;

/// <summary>
/// S5: translates the server's fixed texts (<see cref="ServerStrings"/>) into every language in use: the tenants'
/// languages and the members' own. Runs only when Translation:Provider is set (libretranslate | deepl | mymemory);
/// "none", the default, keeps everything English and sends nothing anywhere. Only the English text with its {0}
/// placeholders is sent, never a value. One provider call per text and language, 8-second timeout, no retry: a
/// failed pair is skipped until the next start.
/// </summary>
public sealed class StringTranslationBackgroundService : BackgroundService
{
    private const int PerTick = 100;
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(20);

    private readonly string _cs;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<StringTranslationBackgroundService> _log;
    private readonly string _provider, _url, _key;
    private readonly HashSet<string> _failed = new();

    public StringTranslationBackgroundService(IConfiguration cfg, IHttpClientFactory http, ILogger<StringTranslationBackgroundService> log)
    {
        _cs = cfg.GetConnectionString("DefaultConnection")!;
        _http = http;
        _log = log;
        _provider = Provider(cfg);
        _url = (cfg["Translation:ApiUrl"] ?? "").TrimEnd('/');
        _key = cfg["Translation:ApiKey"] ?? "";
    }

    public static string Provider(IConfiguration cfg) => (cfg["Translation:Provider"] ?? "none").Trim().ToLowerInvariant();

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await RunOnceAsync(ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogWarning(ex, "Server string translation pass failed"); }
            try { await Task.Delay(Tick, ct); } catch (OperationCanceledException) { break; }
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        await using var conn = new MySqlConnection(_cs);
        foreach (var english in ServerStrings.TakePending(1000)) await ServerStrings.RegisterAsync(conn, english);

        var languages = await LanguagesInUseAsync(conn);
        int done = 0, failed = 0;
        foreach (var lang in languages)
            foreach (var english in ServerStrings.Keys.Keys)
            {
                if (done + failed >= PerTick || ct.IsCancellationRequested) goto end;
                if (ServerStrings.Has(lang, english) || _failed.Contains(lang + "\0" + english)) continue;
                var text = await TranslateAsync(english, lang, ct);
                if (text != null && ServerStrings.SamePlaceholders(english, text))
                {
                    await ServerStrings.StoreAsync(conn, lang, english, text);
                    done++;
                }
                else
                {
                    _failed.Add(lang + "\0" + english);
                    failed++;
                }
            }
        end:
        if (done + failed > 0) _log.LogInformation("Server strings: {Done} translated, {Failed} kept in English", done, failed);
    }

    /// <summary>Tenant languages and members' own languages, without English.</summary>
    private static async Task<List<string>> LanguagesInUseAsync(MySqlConnection conn)
    {
        var raw = (await conn.QueryAsync<string?>(@"
            SELECT default_language FROM comm_settings WHERE default_language IS NOT NULL
            UNION SELECT DISTINCT PrimaryLanguage FROM member_master_profile WHERE PrimaryLanguage IS NOT NULL")).ToList();
        raw.Add(Brand.DefaultLanguage);
        return raw.Select(CommsTemplates.LanguageOf).OfType<string>().Where(l => !ServerStrings.IsEnglish(l))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private async Task<string?> TranslateAsync(string text, string target, CancellationToken ct)
    {
        var lang = target.Split('-')[0];
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(8)); // a stuck provider must not hold the pass
        var client = _http.CreateClient();
        try
        {
            switch (_provider)
            {
                case "libretranslate":
                {
                    var res = await client.PostAsJsonAsync($"{_url}/translate", new Dictionary<string, string>
                    {
                        ["q"] = text, ["source"] = "en", ["target"] = lang, ["format"] = "text", ["api_key"] = _key,
                    }, cts.Token);
                    if (!res.IsSuccessStatusCode) return null;
                    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                    return doc.RootElement.TryGetProperty("translatedText", out var t) ? t.GetString() : null;
                }
                case "deepl":
                {
                    var url = _url.Length > 0 ? _url : "https://api-free.deepl.com";
                    using var req = new HttpRequestMessage(HttpMethod.Post, $"{url}/v2/translate")
                    {
                        Content = new FormUrlEncodedContent(new Dictionary<string, string>
                        {
                            ["text"] = text, ["source_lang"] = "EN", ["target_lang"] = lang.ToUpperInvariant(),
                        }),
                    };
                    req.Headers.TryAddWithoutValidation("Authorization", $"DeepL-Auth-Key {_key}");
                    var res = await client.SendAsync(req, cts.Token);
                    if (!res.IsSuccessStatusCode) return null;
                    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                    return doc.RootElement.GetProperty("translations")[0].GetProperty("text").GetString();
                }
                case "mymemory":
                {
                    var url = _url.Length > 0 ? _url : "https://api.mymemory.translated.net";
                    var res = await client.GetAsync($"{url}/get?q={Uri.EscapeDataString(text)}&langpair=en|{Uri.EscapeDataString(lang)}", cts.Token);
                    if (!res.IsSuccessStatusCode) return null;
                    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                    var root = doc.RootElement;
                    if (root.TryGetProperty("responseStatus", out var st) && st.ValueKind == JsonValueKind.Number && st.GetInt32() != 200) return null;
                    return root.GetProperty("responseData").GetProperty("translatedText").GetString();
                }
                default:
                    return null;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return null; // provider down or an unexpected answer: this text stays English
        }
    }
}

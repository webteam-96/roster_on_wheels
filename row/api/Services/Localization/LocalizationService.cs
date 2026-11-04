using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Localization;

/// <summary>
/// The one translation service for web, app and server texts. Order for each text: skip what must not be sent, then
/// translation memory (database, corrections win), then the machine provider, then English. A provider failure never
/// reaches the caller. Settings: Translation__Provider (none | deepl | libretranslate | google | mymemory),
/// Translation__ApiUrl, Translation__ApiKey, Translation__MonthlyCharLimit, Translation__VisitorDailyChars,
/// Translation__ProtectedTerms (comma separated, added to the built-in list).
/// </summary>
public sealed class LocalizationService
{
    public const int MaxBatch = 2000;
    public const int VisitorMaxBatch = 300;
    private const int MaxTextLength = 5000;
    private const int MaxCache = 50_000;
    private const int MaxParallel = 6;
    private static readonly TimeSpan ProviderTimeout = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan PauseAfterFailure = TimeSpan.FromSeconds(30);

    private static readonly string[] BuiltInTerms =
    {
        "Roster On Wheels", "Rotary International", "Rotary Foundation", "Paul Harris Fellow", "Paul Harris",
        "Rotaract", "Interact", "Rotarian", "Rotary", "ROW", "TRF",
    };

    // Values, codes and markup: a provider would corrupt them, and emails and links should not leave the server.
    private static readonly Regex Technical = new(
        @"https?://\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\{[^{}\s]*\}|%[sd]|</?[a-zA-Z][^<>]*>",
        RegexOptions.Compiled);
    private static readonly Regex Token = new(@"XQ(\d+)X", RegexOptions.Compiled);
    private static readonly Regex Letter = new(@"\p{L}{2,}", RegexOptions.Compiled);

    private readonly string _cs;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<LocalizationService> _log;
    private readonly string _url, _key;
    private readonly long _monthlyLimit, _visitorDailyLimit;
    private readonly Regex _terms;
    private readonly ConcurrentDictionary<string, string> _memory = new();
    private readonly SemaphoreSlim _parallel = new(MaxParallel);
    private readonly object _visitorLock = new();
    private string _visitorDay = "";
    private long _visitorUsed;
    private long _pauseUntilTicks;

    public string Provider { get; }
    public long MonthlyLimit => _monthlyLimit;
    public bool Configured => Provider != "none" && (Provider == "mymemory" || Provider == "libretranslate" ? true : _key.Length > 0);

    public LocalizationService(IConfiguration cfg, IHttpClientFactory http, ILogger<LocalizationService> log)
    {
        _cs = cfg.GetConnectionString("DefaultConnection")!;
        _http = http;
        _log = log;
        Provider = (cfg["Translation:Provider"] ?? "none").Trim().ToLowerInvariant();
        _url = (cfg["Translation:ApiUrl"] ?? "").TrimEnd('/');
        _key = cfg["Translation:ApiKey"] ?? "";
        _monthlyLimit = cfg.GetValue("Translation:MonthlyCharLimit", 450_000L);
        _visitorDailyLimit = cfg.GetValue("Translation:VisitorDailyChars", 200_000L);

        var extra = (cfg["Translation:ProtectedTerms"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var terms = BuiltInTerms.Concat(extra).Distinct().OrderByDescending(t => t.Length).Select(Regex.Escape);
        _terms = new Regex($@"(?<![\p{{L}}\p{{N}}])(?:{string.Join("|", terms)})(?![\p{{L}}\p{{N}}])", RegexOptions.Compiled);
    }

    public static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    private static string CacheKey(string target, string text) => $"{target}\0{text}";
    private MySqlConnection Conn() => new(_cs);

    /// <summary>True when nothing in the text needs a language: numbers, or only an email or link.</summary>
    public bool WorthTranslating(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > MaxTextLength) return false;
        var (masked, _) = Mask(text);
        return Letter.IsMatch(Token.Replace(masked, " "));
    }

    /// <summary>Hides protected terms and technical values behind XQ0X tokens, which providers leave alone.</summary>
    public (string Masked, List<string> Values) Mask(string text)
    {
        var values = new List<string>();
        string Hide(Match m) { values.Add(m.Value); return $"XQ{values.Count - 1}X"; }
        return (_terms.Replace(Technical.Replace(text, Hide), Hide), values);
    }

    /// <summary>Puts the values back. Null when the provider lost, repeated or invented a token: the text stays English.</summary>
    public static string? Unmask(string translated, List<string> values)
    {
        var seen = new HashSet<int>();
        foreach (Match m in Token.Matches(translated))
        {
            var i = int.Parse(m.Groups[1].Value);
            if (i >= values.Count || !seen.Add(i)) return null;
        }
        if (seen.Count != values.Count) return null;
        return Token.Replace(translated, m => values[int.Parse(m.Groups[1].Value)]);
    }

    /// <summary>Same order as <paramref name="texts"/>. Anything not translatable right now comes back as its English.</summary>
    public async Task<string[]> TranslateAsync(string target, IReadOnlyList<string> texts, bool signedIn, CancellationToken ct = default)
    {
        var result = texts.ToArray();
        if (target.Split('-')[0].Equals("en", StringComparison.OrdinalIgnoreCase)) return result;

        var wanted = texts.Where(WorthTranslating).Distinct().ToList();
        var found = new Dictionary<string, string>();
        var misses = new List<string>();
        foreach (var t in wanted)
        {
            if (_memory.TryGetValue(CacheKey(target, t), out var hit)) found[t] = hit;
            else misses.Add(t);
        }

        if (misses.Count > 0)
        {
            await using var conn = Conn();
            foreach (var chunk in misses.Chunk(500))
            {
                var rows = await conn.QueryAsync<(string Source, string Text)>(@"
                    SELECT source_text, translated_text FROM translation_memory
                    WHERE target_lang = @target AND source_hash IN @hashes",
                    new { target, hashes = chunk.Select(Hash).ToArray() });
                foreach (var r in rows)
                {
                    found[r.Source] = r.Text;
                    Remember(target, r.Source, r.Text);
                }
            }

            var toSend = misses.Where(t => !found.ContainsKey(t)).ToList();
            if (toSend.Count > 0 && Configured && !Paused)
            {
                var allowed = await TakeBudgetAsync(conn, toSend, signedIn);
                var sent = await Task.WhenAll(allowed.Select(t => TranslateNewAsync(target, t, ct)));
                foreach (var (text, translated) in sent)
                    if (translated != null) found[text] = translated;
                var chars = allowed.Sum(t => (long)t.Length);
                if (chars > 0)
                    await conn.ExecuteAsync(@"
                        INSERT INTO translation_usage (usage_month, provider, chars_sent, requests)
                        VALUES (@month, @Provider, @chars, @count)
                        ON DUPLICATE KEY UPDATE chars_sent = chars_sent + VALUES(chars_sent), requests = requests + VALUES(requests)",
                        new { month = DateTime.UtcNow.ToString("yyyy-MM"), Provider, chars, count = allowed.Count });
            }
        }

        for (var i = 0; i < result.Length; i++)
            if (found.TryGetValue(result[i], out var text)) result[i] = text;
        return result;
    }

    private void Remember(string target, string text, string translated)
    {
        if (_memory.Count < MaxCache) _memory[CacheKey(target, text)] = translated;
    }

    public bool Paused => Interlocked.Read(ref _pauseUntilTicks) > DateTime.UtcNow.Ticks;

    /// <summary>The texts this request may send: inside the monthly limit, and for visitors inside their daily share.</summary>
    private async Task<List<string>> TakeBudgetAsync(MySqlConnection conn, List<string> texts, bool signedIn)
    {
        long room = long.MaxValue;
        if (_monthlyLimit > 0)
        {
            var used = await conn.ExecuteScalarAsync<long?>(
                "SELECT SUM(chars_sent) FROM translation_usage WHERE usage_month = @month",
                new { month = DateTime.UtcNow.ToString("yyyy-MM") }) ?? 0;
            room = _monthlyLimit - used;
            if (room <= 0) _log.LogWarning("Translation monthly limit of {Limit} characters reached; new text stays English.", _monthlyLimit);
        }

        var allowed = new List<string>();
        foreach (var t in texts)
        {
            if (t.Length > room) break;
            if (!signedIn && !TakeVisitorShare(t.Length)) break;
            room -= t.Length;
            allowed.Add(t);
        }
        return allowed;
    }

    // shortcut: the visitor share lives in this process, one API server; move it to the database if the API is scaled out.
    private bool TakeVisitorShare(int chars)
    {
        lock (_visitorLock)
        {
            var day = DateTime.UtcNow.ToString("yyyy-MM-dd");
            if (_visitorDay != day) { _visitorDay = day; _visitorUsed = 0; }
            if (_visitorUsed + chars > _visitorDailyLimit) return false;
            _visitorUsed += chars;
            return true;
        }
    }

    private async Task<(string Text, string? Translated)> TranslateNewAsync(string target, string text, CancellationToken ct)
    {
        await _parallel.WaitAsync(ct);
        try
        {
            var (masked, values) = Mask(text);
            var raw = await CallProviderAsync(masked, target, ct);
            if (raw == null) return (text, null);
            var translated = Unmask(WebUtility.HtmlDecode(raw).Trim(), values);
            if (string.IsNullOrWhiteSpace(translated))
            {
                _log.LogInformation("Translation to {Target} dropped: the provider changed a protected value.", target);
                return (text, null);
            }

            await using var conn = Conn();
            await conn.ExecuteAsync(@"
                INSERT IGNORE INTO translation_memory (source_hash, target_lang, source_text, translated_text, provider, is_override, created_at, updated_at)
                VALUES (@hash, @target, @text, @translated, @Provider, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())",
                new { hash = Hash(text), target, text, translated, Provider });
            Remember(target, text, translated);
            return (text, translated);
        }
        finally { _parallel.Release(); }
    }

    private static string ProviderLang(string code, string provider)
    {
        if (code.Equals("zh-Hant", StringComparison.OrdinalIgnoreCase)) return provider == "mymemory" ? "zh-TW" : "zh-Hant";
        return code.Split('-')[0];
    }

    /// <summary>One provider call with a timeout and no retry. Null on any failure, and new calls pause briefly.</summary>
    private async Task<string?> CallProviderAsync(string text, string target, CancellationToken ct)
    {
        var lang = ProviderLang(target, Provider);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(ProviderTimeout);
        var client = _http.CreateClient();
        try
        {
            string? output = null;
            HttpResponseMessage res;
            switch (Provider)
            {
                case "libretranslate":
                    res = await client.PostAsync($"{_url}/translate", Json(new Dictionary<string, string>
                    {
                        ["q"] = text, ["source"] = "en", ["target"] = lang, ["format"] = "text", ["api_key"] = _key,
                    }), cts.Token);
                    if (res.IsSuccessStatusCode)
                    {
                        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                        output = doc.RootElement.GetProperty("translatedText").GetString();
                    }
                    // 400: a language this server has no model for. The server is fine, so other languages must not pause.
                    else if (res.StatusCode == System.Net.HttpStatusCode.BadRequest) return null;
                    break;
                case "deepl":
                {
                    // Free keys end in ":fx" and use the free host.
                    var host = _url.Length > 0 ? _url : _key.EndsWith(":fx", StringComparison.Ordinal) ? "https://api-free.deepl.com" : "https://api.deepl.com";
                    using var req = new HttpRequestMessage(HttpMethod.Post, $"{host}/v2/translate")
                    {
                        Content = new FormUrlEncodedContent(new Dictionary<string, string>
                        {
                            ["text"] = text, ["source_lang"] = "EN", ["target_lang"] = lang.ToUpperInvariant(),
                        }),
                    };
                    req.Headers.TryAddWithoutValidation("Authorization", $"DeepL-Auth-Key {_key}");
                    res = await client.SendAsync(req, cts.Token);
                    if (res.IsSuccessStatusCode)
                    {
                        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                        output = doc.RootElement.GetProperty("translations")[0].GetProperty("text").GetString();
                    }
                    break;
                }
                case "google":
                {
                    using var req = new HttpRequestMessage(HttpMethod.Post, $"{(_url.Length > 0 ? _url : "https://translation.googleapis.com")}/language/translate/v2")
                    {
                        Content = Json(new { q = text, source = "en", target = lang, format = "text" }),
                    };
                    req.Headers.TryAddWithoutValidation("X-goog-api-key", _key); // a header: a key in the URL ends up in logs
                    res = await client.SendAsync(req, cts.Token);
                    if (res.IsSuccessStatusCode)
                    {
                        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                        output = doc.RootElement.GetProperty("data").GetProperty("translations")[0].GetProperty("translatedText").GetString();
                    }
                    break;
                }
                case "mymemory":
                    res = await client.GetAsync($"{(_url.Length > 0 ? _url : "https://api.mymemory.translated.net")}/get?q={Uri.EscapeDataString(text)}&langpair=en|{Uri.EscapeDataString(lang)}", cts.Token);
                    if (res.IsSuccessStatusCode)
                    {
                        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                        var root = doc.RootElement;
                        var ok = !root.TryGetProperty("responseStatus", out var st) || st.ValueKind != JsonValueKind.Number || st.GetInt32() == 200;
                        var t = ok ? root.GetProperty("responseData").GetProperty("translatedText").GetString() : null;
                        // On quota errors MyMemory puts a warning where the translation goes.
                        output = t != null && !Regex.IsMatch(t, "MYMEMORY WARNING|QUOTA", RegexOptions.IgnoreCase) ? t : null;
                    }
                    break;
                default:
                    return null;
            }
            if (output == null) Pause();
            return output;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException)
        {
            if (!ct.IsCancellationRequested) Pause();
            return null;
        }
    }

    // A plain body with its length: some translation servers refuse chunked requests.
    private static StringContent Json(object body) => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private void Pause()
    {
        Interlocked.Exchange(ref _pauseUntilTicks, DateTime.UtcNow.Add(PauseAfterFailure).Ticks);
        _log.LogWarning("Translation provider {Provider} failed; new text stays English for {Seconds} seconds.", Provider, PauseAfterFailure.TotalSeconds);
    }

    // ── Corrections ─────────────────────────────────────────────────────────────────────────

    /// <summary>Changes when a correction is saved or removed, so devices drop their saved translations.</summary>
    public async Task<long> MemoryVersionAsync()
    {
        await using var conn = Conn();
        return await conn.ExecuteScalarAsync<long?>("SELECT version FROM translation_memory_version WHERE id = 1") ?? 0;
    }

    public sealed record MemoryRow(string Hash, string Source, string Text, string? Provider, bool IsOverride, DateTime UpdatedAt);

    public async Task<(List<MemoryRow> Rows, long Total)> SearchAsync(string target, string? search, bool correctionsOnly, int page, int pageSize)
    {
        var where = "target_lang = @target" + (correctionsOnly ? " AND is_override = 1" : "")
            + (string.IsNullOrWhiteSpace(search) ? "" : " AND (source_text LIKE @like OR translated_text LIKE @like)");
        var args = new { target, like = $"%{search}%", take = pageSize, skip = (page - 1) * pageSize };
        await using var conn = Conn();
        var rows = await conn.QueryAsync<MemoryRow>($@"
            SELECT source_hash AS Hash, source_text AS Source, translated_text AS Text, provider AS Provider,
                   is_override AS IsOverride, updated_at AS UpdatedAt
            FROM translation_memory WHERE {where} ORDER BY is_override DESC, updated_at DESC LIMIT @take OFFSET @skip", args);
        var total = await conn.ExecuteScalarAsync<long>($"SELECT COUNT(*) FROM translation_memory WHERE {where}", args);
        return (rows.ToList(), total);
    }

    public async Task<long> MonthCharsAsync()
    {
        await using var conn = Conn();
        return await conn.ExecuteScalarAsync<long?>("SELECT SUM(chars_sent) FROM translation_usage WHERE usage_month = @month",
            new { month = DateTime.UtcNow.ToString("yyyy-MM") }) ?? 0;
    }

    /// <summary>False when the correction lost or added a protected value of the English text.</summary>
    public async Task<bool> SaveCorrectionAsync(string target, string source, string text, int memberId)
    {
        var (_, values) = Mask(source);
        foreach (var value in values.Distinct())
            if (CountOf(text, value) != CountOf(source, value) && Technical.IsMatch(value)) return false;

        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            INSERT INTO translation_memory (source_hash, target_lang, source_text, translated_text, provider, is_override, updated_by, created_at, updated_at)
            VALUES (@hash, @target, @source, @text, 'correction', 1, @memberId, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text), provider = 'correction', is_override = 1,
                updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()",
            new { hash = Hash(source), target, source, text, memberId });
        await BumpVersionAsync(conn);
        _memory[CacheKey(target, source)] = text;
        return true;
    }

    /// <summary>Removes the row, so the text goes back to machine translation. Null when there was none; else the English.</summary>
    public async Task<string?> DeleteAsync(string target, string hash)
    {
        await using var conn = Conn();
        var source = await conn.ExecuteScalarAsync<string?>(
            "SELECT source_text FROM translation_memory WHERE target_lang = @target AND source_hash = @hash", new { target, hash });
        if (source == null) return null;
        await conn.ExecuteAsync("DELETE FROM translation_memory WHERE target_lang = @target AND source_hash = @hash", new { target, hash });
        await BumpVersionAsync(conn);
        _memory.TryRemove(CacheKey(target, source), out _);
        return source;
    }

    private static int CountOf(string text, string value) => Regex.Matches(text, Regex.Escape(value)).Count;

    private static Task BumpVersionAsync(MySqlConnection conn) => conn.ExecuteAsync(@"
        INSERT INTO translation_memory_version (id, version) VALUES (1, 1) ON DUPLICATE KEY UPDATE version = version + 1");
}

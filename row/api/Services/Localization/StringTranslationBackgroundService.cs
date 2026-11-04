using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Localization;

/// <summary>
/// S5: translates the server's fixed texts (<see cref="ServerStrings"/>) into every language in use: the tenants'
/// languages and the members' own. Runs only when Translation:Provider is set (libretranslate | deepl | mymemory);
/// "none", the default, keeps everything English and sends nothing anywhere. Only the English text with its {0}
/// placeholders is sent, never a value. The call goes through <see cref="LocalizationService"/>: a failed pair is
/// skipped until the next start.
/// </summary>
public sealed class StringTranslationBackgroundService : BackgroundService
{
    private const int PerTick = 100;
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(20);

    private readonly string _cs;
    private readonly LocalizationService _localization;
    private readonly ILogger<StringTranslationBackgroundService> _log;
    private readonly HashSet<string> _failed = new();

    public StringTranslationBackgroundService(IConfiguration cfg, LocalizationService localization, ILogger<StringTranslationBackgroundService> log)
    {
        _cs = cfg.GetConnectionString("DefaultConnection")!;
        _localization = localization;
        _log = log;
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
                if (_localization.Paused) goto end; // an outage is not this text's fault: try again next pass
                var text = await TranslateAsync(english, lang, ct);
                if (text == null && _localization.Paused) goto end;
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
        var translated = (await _localization.TranslateAsync(target, new[] { text }, signedIn: true, ct))[0];
        return translated == text ? null : translated; // unchanged means it could not be translated: stays English
    }
}

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Localization;

/// <summary>
/// S5 (build spec 3.3, 3.16): machine translations of the fixed text the server writes (emails, push, feed titles,
/// PDF and export labels). The key is the English text itself with composite placeholders ("Dear {0},"), so the
/// translation provider never sees names, links, tokens or passwords: the values are formatted in afterwards.
/// Rows live in server_strings and are held in memory. A text seen for the first time is queued for every language
/// in use; StringTranslationBackgroundService translates the queue. Also compiled into the GreetingsWorker (linked
/// file), which only reads, so this uses only Dapper and MySqlConnector.
/// </summary>
public static class ServerStrings
{
    public const string TableSql = @"
        CREATE TABLE IF NOT EXISTS server_strings (
            text_hash CHAR(64) NOT NULL,
            language VARCHAR(20) NOT NULL,
            english TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (text_hash, language)
        )";

    private static readonly Regex Hole = new(@"\{(\d+)(?:[,:][^}]*)?\}", RegexOptions.Compiled);

    // language -> english -> translation
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, string>> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, byte> Seen = new();
    private static readonly ConcurrentQueue<string> Pending = new();

    /// <summary>Whether new texts are queued for translation (a provider is configured). Off: lookups only.</summary>
    public static bool QueueEnabled { get; set; }

    public static string Hash(string english) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(english))).ToLowerInvariant();

    /// <summary>The translation of <paramref name="english"/> for a language ("pt-BR", then "pt"), or null.</summary>
    public static string? Find(string? language, string english)
    {
        if (string.IsNullOrEmpty(english)) return null;
        Note(english);
        if (string.IsNullOrEmpty(language) || IsEnglish(language)) return null;
        if (Cache.TryGetValue(language, out var m) && m.TryGetValue(english, out var t)) return t;
        var dash = language.IndexOf('-');
        return dash > 0 && Cache.TryGetValue(language[..dash], out m) && m.TryGetValue(english, out t) ? t : null;
    }

    public static IEnumerable<KeyValuePair<string, string>> All(string language)
        => Cache.TryGetValue(language, out var m) ? m : Enumerable.Empty<KeyValuePair<string, string>>();

    public static bool IsEnglish(string language) => language.Equals("en", StringComparison.OrdinalIgnoreCase)
        || language.StartsWith("en-", StringComparison.OrdinalIgnoreCase);

    private static void Note(string english)
    {
        if (QueueEnabled && Seen.TryAdd(english, 0)) Pending.Enqueue(english);
    }

    /// <summary>Takes up to <paramref name="max"/> queued texts.</summary>
    public static List<string> TakePending(int max)
    {
        var list = new List<string>();
        while (list.Count < max && Pending.TryDequeue(out var s)) list.Add(s);
        return list;
    }

    public static bool Has(string language, string english) => Cache.TryGetValue(language, out var m) && m.ContainsKey(english);

    /// <summary>
    /// A provider's answer is kept only when it has exactly the placeholders of the English text, so a mangled
    /// "{0}" can never drop or misplace a value.
    /// </summary>
    public static bool SamePlaceholders(string english, string translated)
    {
        static string Holes(string s) => string.Join(",", Hole.Matches(s).Select(m => m.Value).OrderBy(v => v, StringComparer.Ordinal));
        if (string.IsNullOrWhiteSpace(translated) || Holes(english) != Holes(translated)) return false;
        try { _ = string.Format(translated, Enumerable.Range(0, 10).Select(i => (object)i).ToArray()); return true; }
        catch (FormatException) { return false; } // a stray brace would throw at send time
    }

    /// <summary>Loads every stored translation (start-up, and after the background service adds rows).</summary>
    public static async Task LoadAsync(MySqlConnection conn)
    {
        IEnumerable<(string Language, string English, string Text)> rows;
        try
        {
            rows = await conn.QueryAsync<(string, string, string)>("SELECT language, english, text FROM server_strings");
        }
        catch (MySqlException)
        {
            return; // table not created yet (a worker on a database the API has not upgraded): English only
        }
        foreach (var (language, english, text) in rows)
        {
            Seen.TryAdd(english, 0);
            if (language.Length == 0) Keys.TryAdd(english, 0);
            else Cache.GetOrAdd(language, _ => new ConcurrentDictionary<string, string>())[english] = text;
        }
    }

    /// <summary>Every text known to need translating (rows with language ''), so new languages are covered too.</summary>
    public static readonly ConcurrentDictionary<string, byte> Keys = new();

    /// <summary>Records a text as needing translation: a row with language ''. The worker calls this for its texts.</summary>
    public static async Task RegisterAsync(MySqlConnection conn, string english)
    {
        if (!Keys.TryAdd(english, 0)) return;
        try
        {
            await conn.ExecuteAsync(@"INSERT IGNORE INTO server_strings (text_hash, language, english, text)
                VALUES (@H, '', @E, '')", new { H = Hash(english), E = english });
        }
        catch (MySqlException)
        {
            Keys.TryRemove(english, out _); // table not there yet: try again next time
        }
    }

    public static async Task StoreAsync(MySqlConnection conn, string language, string english, string text)
    {
        await conn.ExecuteAsync(@"INSERT IGNORE INTO server_strings (text_hash, language, english, text)
            VALUES (@H, @L, @E, @T)", new { H = Hash(english), L = language, E = english, T = text });
        Cache.GetOrAdd(language, _ => new ConcurrentDictionary<string, string>())[english] = text;
    }
}

using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace RccGoalsFetcher;

public sealed class Settings
{
    public string ConnectionString = "";
    public string Email = "", Password = "", LoginUrl = "", ApiBase = "", BrowserChannel = "";
    public bool Headless = true;
    public int MaxParallel = 4;
    public List<string> ZoneNumbers = new(), DistrictNumbers = new();
    public string YearsMode = "auto";
    public int FirstFiscalYearId = 2011;
    public string OutputFolder = "";
    public bool SaveRawJson = true;
    public int ResumeMaxAgeHours = 20;
    public int TrendClubType = 1;
    public bool EmailEnabled;
    public List<string> Recipients = new();
    public int MaxAttachmentMb = 8;
    public string BrevoApiKey = "", BrevoApiUrl = "", SenderEmail = "", SenderName = "";
    // Worker mode (--worker): District Governors' own syncs, queued by the web API.
    public string CredentialKey = "";
    public int NightlyHour = 1, PollSeconds = 20;
    public DayOfWeek WeeklyDay = DayOfWeek.Sunday;   // weekly auto-sync day (user 2026-11-06: fixed day)
    public List<string> WeeklyReportTo = new();      // who gets the weekly sync report mail
    public List<string> ClubReportTo = new();        // who gets the club sync report mail
    public int MonthEndHour = 22;                    // last day of every month: every saved login is synced at this hour
    public DayOfWeek ReportDay = DayOfWeek.Thursday; // weekly report day (after the Sat..Wed zone days)
    // Auto-sync day per Rotary zone number (RIZones 2026-11-10 spread its Indian zones over Sat..Wed). ROW: empty by
    // default, so every district uses WeeklyDay; set RotaryOrgSync:ZoneDays (e.g. { "4": "Saturday" }) to spread the load.
    // A district whose zone is not listed uses WeeklyDay.
    public Dictionary<int, DayOfWeek> ZoneDays = new();

    public static Settings Load(IConfiguration c) => new()
    {
        ConnectionString = c.GetConnectionString("DefaultConnection") ?? "",
        Email = c["Rcc:Email"] ?? "",
        Password = c["Rcc:Password"] ?? "",
        LoginUrl = c["Rcc:LoginUrl"] ?? "https://my.rotary.org/user/login?destination=https://rcc.rotary.org/",
        ApiBase = c["Rcc:ApiBase"] ?? "https://rcc.rotary.org",
        BrowserChannel = c["Rcc:BrowserChannel"] ?? "",
        Headless = !bool.TryParse(c["Rcc:Headless"], out var h) || h,
        MaxParallel = int.TryParse(c["Rcc:MaxParallelRequests"], out var p) && p > 0 ? p : 4,
        ZoneNumbers = c.GetSection("Scope:ZoneNumbers").GetChildren().Select(x => x.Value ?? "").Where(x => x != "").ToList(),
        DistrictNumbers = c.GetSection("Scope:DistrictNumbers").GetChildren().Select(x => x.Value ?? "").Where(x => x != "").ToList(),
        YearsMode = (c["Scope:YearsMode"] ?? "auto").Trim().ToLowerInvariant(),
        FirstFiscalYearId = int.TryParse(c["Scope:FirstFiscalYearId"], out var fyMin) ? fyMin : 2011,
        OutputFolder = c["Output:Folder"] ?? Path.Combine(AppContext.BaseDirectory, "output"),
        SaveRawJson = !bool.TryParse(c["Output:SaveRawJson"], out var r) || r,
        ResumeMaxAgeHours = int.TryParse(c["Output:ResumeMaxAgeHours"], out var ra) && ra > 0 ? ra : 20,
        TrendClubType = int.TryParse(c["Rcc:TrendClubType"], out var tct) ? tct : 1,
        EmailEnabled = bool.TryParse(c["Email:Enabled"], out var e) && e,
        Recipients = c.GetSection("Email:Recipients").GetChildren().Select(x => x.Value ?? "").Where(x => x != "").ToList(),
        MaxAttachmentMb = int.TryParse(c["Email:MaxAttachmentMb"], out var m) ? m : 8,
        BrevoApiKey = c["Brevo:ApiKey"] ?? "",
        BrevoApiUrl = c["Brevo:ApiUrl"] ?? "https://api.brevo.com/v3/smtp/email",
        SenderEmail = c["Brevo:SenderEmail"] ?? "",
        SenderName = c["Brevo:SenderName"] ?? "Roster on Wheels",
        CredentialKey = c["RotaryOrgSync:CredentialKey"] ?? "",
        NightlyHour = int.TryParse(c["RotaryOrgSync:NightlyHour"], out var nh) && nh is >= 0 and <= 23 ? nh : 1,
        PollSeconds = int.TryParse(c["RotaryOrgSync:PollSeconds"], out var ps) && ps >= 5 ? ps : 20,
        WeeklyDay = Enum.TryParse<DayOfWeek>(c["RotaryOrgSync:WeeklyDay"], true, out var wd) ? wd : DayOfWeek.Sunday,
        WeeklyReportTo = c.GetSection("RotaryOrgSync:WeeklyReportTo").GetChildren().Select(x => x.Value ?? "").Where(x => x != "").ToList(),
        ClubReportTo = c.GetSection("RotaryOrgSync:ClubReportTo").GetChildren().Select(x => x.Value ?? "").Where(x => x != "").ToList(),
        MonthEndHour = int.TryParse(c["RotaryOrgSync:MonthEndHour"], out var meh) && meh is >= 0 and <= 23 ? meh : 22,
        ReportDay = Enum.TryParse<DayOfWeek>(c["RotaryOrgSync:ReportDay"], true, out var rd) ? rd : DayOfWeek.Thursday,
        ZoneDays = c.GetSection("RotaryOrgSync:ZoneDays").GetChildren()
            .Select(x => (Ok: int.TryParse(x.Key, out var z) && Enum.TryParse<DayOfWeek>(x.Value, true, out var _), Zone: int.TryParse(x.Key, out var z2) ? z2 : 0, Day: Enum.TryParse<DayOfWeek>(x.Value, true, out var d) ? d : DayOfWeek.Sunday))
            .Where(x => x.Ok).ToDictionary(x => x.Zone, x => x.Day) is { Count: > 0 } zd ? zd
            : new() { [4] = DayOfWeek.Saturday, [5] = DayOfWeek.Sunday, [6] = DayOfWeek.Monday, [7] = DayOfWeek.Tuesday, [8] = DayOfWeek.Wednesday },
    };
}

public static class Log
{
    private static readonly object Gate = new();
    public static string? FilePath;
    /// Worker mode: one file per day, "<DailyPrefix>_yyyy-MM-dd.log" (wins over FilePath).
    public static string? DailyPrefix;
    public static void Info(string m) => Write("INFO ", m);
    public static void Warn(string m) => Write("WARN ", m);
    public static void Error(string m) => Write("ERROR", m);
    private static void Write(string level, string m)
    {
        var line = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} {level} {m}";
        lock (Gate)
        {
            Console.WriteLine(line);
            var path = DailyPrefix != null ? $"{DailyPrefix}_{DateTime.UtcNow:yyyy-MM-dd}.log" : FilePath;
            if (path != null) try { File.AppendAllText(path, line + Environment.NewLine); } catch { }
        }
    }
}

public static class Json
{
    /// Case-insensitive property lookup, trying several names.
    public static JsonElement? Prop(JsonElement e, params string[] names)
    {
        if (e.ValueKind != JsonValueKind.Object) return null;
        foreach (var n in names)
            foreach (var p in e.EnumerateObject())
                if (string.Equals(p.Name, n, StringComparison.OrdinalIgnoreCase)) return p.Value;
        return null;
    }

    public static string? Str(JsonElement e, params string[] names)
    {
        var v = Prop(e, names);
        if (v == null) return null;
        return v.Value.ValueKind switch
        {
            JsonValueKind.String => v.Value.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => v.Value.GetRawText(),
        };
    }

    public static int? Int(JsonElement e, params string[] names)
        => int.TryParse(Str(e, names), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : null;

    public static DateTime? Date(JsonElement e, params string[] names)
        => DateTime.TryParse(Str(e, names), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d) ? d : null;

    /// Flattens an object into "a.b.c" -> value. Nested objects become dotted columns; arrays are
    /// kept whole as JSON text so no field is ever dropped.
    public static void Flatten(JsonElement e, string prefix, IDictionary<string, object?> into)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in e.EnumerateObject())
                    Flatten(p.Value, prefix == "" ? p.Name : prefix + "." + p.Name, into);
                break;
            case JsonValueKind.Array:
                into[prefix] = e.GetRawText();
                break;
            case JsonValueKind.String:
                into[prefix] = e.GetString();
                break;
            case JsonValueKind.Number:
                into[prefix] = e.TryGetInt64(out var l) ? l : e.GetDouble();
                break;
            case JsonValueKind.True: into[prefix] = true; break;
            case JsonValueKind.False: into[prefix] = false; break;
            default: into[prefix] = null; break;
        }
    }
}

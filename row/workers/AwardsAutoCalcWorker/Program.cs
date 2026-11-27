using AwardsAutoCalcWorker.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// ════════════════════════════════════════════════════════════════════════
// Awards Auto-Calc Worker
//
// Mode:
//   --district-citation   Full district citation auto-points recalc (every
//                         district, every club, every auto question).
//                         Writes to district_citation_club_entry.
//
// Scheduled via Windows Task Scheduler. Sends a Brevo email on completion.
// ════════════════════════════════════════════════════════════════════════

Console.WriteLine("=========================================");
Console.WriteLine(" Awards Auto-Calc Worker");
Console.WriteLine("=========================================");

var mode = args.Length > 0 ? args[0].ToLowerInvariant() : "--help";

if (mode == "--help" || mode == "-h" || mode == "/?" || mode == "/help")
{
    Console.WriteLine("");
    Console.WriteLine("Usage:");
    Console.WriteLine("  AwardsAutoCalcWorker.exe --district-citation   Full district citation auto-points recalc");
    Console.WriteLine("");
    return 1;
}

// Configuration
var config = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
    .AddJsonFile("appsettings.secrets.json", optional: true, reloadOnChange: false)   // server only, git-ignored, never in an upload
    .AddEnvironmentVariables()   // secrets and Brand__* settings come from the environment
    .Build();
RotaryApi.Services.Brand.Init(config);

var connString = config.GetConnectionString("DefaultConnection")
                 ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing in appsettings.json");

// DI
var services = new ServiceCollection();
services.AddSingleton<IConfiguration>(config);
services.AddLogging(b => b
    .AddSimpleConsole(o =>
    {
        o.SingleLine = true;
        o.TimestampFormat = "HH:mm:ss ";
    })
    .SetMinimumLevel(LogLevel.Information));
services.AddHttpClient<BrevoEmailSender>((sp, http) =>
{
    http.Timeout = TimeSpan.FromSeconds(30);
});
services.AddSingleton<YearTableResolver>();
services.AddSingleton<CitationCalculator>(sp => new CitationCalculator(
    connString,
    sp.GetRequiredService<ILogger<CitationCalculator>>(),
    sp.GetRequiredService<YearTableResolver>()));
services.AddSingleton<BrevoEmailSender>(sp =>
{
    var brevo = config.GetSection("Brevo");
    return new BrevoEmailSender(
        sp.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(BrevoEmailSender)),
        sp.GetRequiredService<ILogger<BrevoEmailSender>>(),
        apiUrl: brevo["ApiUrl"] ?? "https://api.brevo.com/v3/smtp/email",
        apiKey: brevo["ApiKey"] ?? throw new InvalidOperationException("Brevo:ApiKey missing"),
        senderName: brevo["SenderName"] ?? "ROW",
        senderEmail: brevo["SenderEmail"] ?? RotaryApi.Services.Brand.NoReplyEmail);
});

var sp = services.BuildServiceProvider();
var log = sp.GetRequiredService<ILogger<Program>>();
var recipients = config.GetSection("ReportRecipients").Get<string[]>() ?? Array.Empty<string>();

try
{
    if (mode == "--district-citation")
    {
        var calc = sp.GetRequiredService<CitationCalculator>();
        log.LogInformation("District citation auto-points calculation started.");
        var stats = await calc.CalculateAllAutoPointsAsync();
        log.LogInformation("District citation auto-points calculation completed. Duration: {Min}m {Sec}s",
            (int)(stats.RunCompletedAt - stats.RunStartedAt).TotalMinutes,
            (stats.RunCompletedAt - stats.RunStartedAt).Seconds);
        // Disha Goals auto answers (user 2026-11-17) - same nightly run. A failure here never fails the awards run.
        // One email AFTER all three steps (user 2026-11-18): District Awards / District Set Goals, Disha Goals, RISAO.
        var extra = new NightExtra();
        var t0 = DateTime.UtcNow;
        try { extra.Disha = await calc.CalculateDishaAutoAsync(); log.LogInformation("Disha Goals auto answers written: {N}", extra.Disha); }
        catch (Exception dex) { extra.DishaError = dex.Message; log.LogError(dex, "Disha Goals auto answers failed."); }
        // RISAO-linked goal questions (user 2026-11-17) - same run, never fails the awards run.
        try { extra.Risao = await calc.PunchRisaoAsync(); log.LogInformation("RISAO goal answers written: {N}", extra.Risao); }
        catch (Exception rex) { extra.RisaoError = rex.Message; log.LogError(rex, "RISAO goal answers failed."); }
        extra.CompletedAt = DateTime.UtcNow;
        extra.Seconds = (int)(extra.CompletedAt - t0).TotalSeconds;
        await SendCitationEmailAsync(sp, recipients, stats, extra);
        return 0;
    }

    Console.WriteLine($"Unknown mode: {mode}. Use --help.");
    return 1;
}
catch (Exception ex)
{
    log.LogError(ex, "Unhandled error in {Mode}", mode);
    return 2;
}

static async Task SendCitationEmailAsync(IServiceProvider sp, string[] recipients, CitationCalculator.RunStats s, NightExtra x)
{
    if (recipients.Length == 0) return;
    var email = sp.GetRequiredService<BrevoEmailSender>();
    var duration = x.CompletedAt - s.RunStartedAt;
    bool failed = x.DishaError != null || x.RisaoError != null;
    var subject = $"ROW - Nightly District Awards / District Set Goals auto points{(failed ? " (with errors)" : "")} - {x.CompletedAt:dd-MMM-yyyy hh:mm tt} UTC";
    static string Row(string k, string v, string? color = null) =>
        $"<tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:200px'>{k}</td><td style='padding:8px 12px;border:1px solid #e2e8f0{(color != null ? $";color:{color};font-weight:bold" : "")}'>{v}</td></tr>";
    var night = $@"
    {(x.DishaError == null ? Row("Disha Goals answers", x.Disha.ToString()) : Row("Disha Goals", "FAILED - " + System.Net.WebUtility.HtmlEncode(x.DishaError), "#b91c1c"))}
    {(x.RisaoError == null ? Row("RISAO goal answers", x.Risao.ToString()) : Row("RISAO goal answers", "FAILED - " + System.Net.WebUtility.HtmlEncode(x.RisaoError), "#b91c1c"))}
    {Row("Whole run completed", x.CompletedAt.ToString("dd-MMM-yyyy hh:mm:ss tt") + " UTC")}";
    var body = $@"
<div style='font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6'>
  <h2 style='color:#1e3a8a;margin:0 0 12px 0'>Auto Calculate District Awards Points</h2>
  <p style='margin:0 0 16px 0;color:#475569'>The standalone worker (AwardsAutoCalcWorker --district-citation) has completed.</p>
  <table style='border-collapse:collapse;width:100%;max-width:520px;border:1px solid #e2e8f0'>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:200px'>Run started</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.RunStartedAt:dd-MMM-yyyy hh:mm:ss tt} UTC</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Run completed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.RunCompletedAt:dd-MMM-yyyy hh:mm:ss tt} UTC</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Duration</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{(int)duration.TotalMinutes} min {duration.Seconds} sec</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Rotary year</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.YearLabel}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Status</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{(s.Skipped ? $"Skipped — {s.SkipReason}" : "Completed")}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Districts processed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.DistrictCount}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Clubs processed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.ClubCount}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Entries written</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.EntryCount}</td></tr>
    {night}
  </table>
  <p style='margin:20px 0 0 0;color:#64748b;font-size:12px'>This is an automated notification from ROW.</p>
</div>";
    foreach (var to in recipients)
        await email.SendAsync(to, subject, body);
}

// Night-run results after District Awards (user 2026-11-18) - for the one summary email.
sealed class NightExtra
{
    public int Disha { get; set; }
    public string? DishaError { get; set; }
    public int Risao { get; set; }
    public string? RisaoError { get; set; }
    public DateTime CompletedAt { get; set; } = DateTime.UtcNow;
    public int Seconds { get; set; }
}

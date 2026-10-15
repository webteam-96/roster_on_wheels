using AwardsAutoCalcWorker.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// ════════════════════════════════════════════════════════════════════════
// Awards Auto-Calc Worker
//
// Two modes:
//   --district-citation   Full district citation auto-points recalc (every
//                         district, every club, every auto question).
//                         Writes to district_citation_club_entry.
//   --zonal-awards        Zonal Awards auto-calc (current year + zones where
//                         IsZonalAwardsEnabled=1 + districts that are active).
//                         Gated by ZonalAwards:AutoCalcEnabled in appsettings.
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
    Console.WriteLine("  AwardsAutoCalcWorker.exe --zonal-awards        Zonal Awards auto-calc (gated by ZonalAwards:AutoCalcEnabled)");
    Console.WriteLine("");
    return 1;
}

// Configuration
var config = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
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
services.AddSingleton<ZonalAwardsCalculator>(sp => new ZonalAwardsCalculator(
    connString,
    sp.GetRequiredService<ILogger<ZonalAwardsCalculator>>(),
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
        await SendCitationEmailAsync(sp, recipients, stats);
        return 0;
    }

    if (mode == "--zonal-awards")
    {
        var gate = config.GetValue<bool>("ZonalAwards:AutoCalcEnabled");
        if (!gate)
        {
            log.LogWarning("Zonal Awards auto-calc is PAUSED (ZonalAwards:AutoCalcEnabled=false in appsettings.json). Exiting.");
            return 0;
        }
        var calc = sp.GetRequiredService<ZonalAwardsCalculator>();
        log.LogInformation("Zonal Awards auto-calc started.");
        var stats = await calc.CalculateForCurrentYearAsync();
        log.LogInformation("Zonal Awards auto-calc completed. Duration: {Min}m {Sec}s",
            (int)(stats.RunCompletedAt - stats.RunStartedAt).TotalMinutes,
            (stats.RunCompletedAt - stats.RunStartedAt).Seconds);
        await SendZonalEmailAsync(sp, recipients, stats);
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

static async Task SendCitationEmailAsync(IServiceProvider sp, string[] recipients, CitationCalculator.RunStats s)
{
    if (recipients.Length == 0) return;
    var email = sp.GetRequiredService<BrevoEmailSender>();
    var duration = s.RunCompletedAt - s.RunStartedAt;
    var subject = $"ROW - Auto Calculate District awards Points - {s.RunCompletedAt:dd-MMM-yyyy hh:mm tt}";
    var body = $@"
<div style='font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6'>
  <h2 style='color:#1e3a8a;margin:0 0 12px 0'>Auto Calculate District Awards Points</h2>
  <p style='margin:0 0 16px 0;color:#475569'>The standalone worker (AwardsAutoCalcWorker --district-citation) has completed.</p>
  <table style='border-collapse:collapse;width:100%;max-width:520px;border:1px solid #e2e8f0'>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:200px'>Run started</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.RunStartedAt:dd-MMM-yyyy hh:mm:ss tt}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Run completed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.RunCompletedAt:dd-MMM-yyyy hh:mm:ss tt}</td></tr>
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
  </table>
  <p style='margin:20px 0 0 0;color:#64748b;font-size:12px'>This is an automated notification from ROW.</p>
</div>";
    foreach (var to in recipients)
        await email.SendAsync(to, subject, body);
}

static async Task SendZonalEmailAsync(IServiceProvider sp, string[] recipients, ZonalAwardsCalculator.RunStats s)
{
    if (recipients.Length == 0) return;
    var email = sp.GetRequiredService<BrevoEmailSender>();
    var duration = s.RunCompletedAt - s.RunStartedAt;
    var subject = $"ROW - Auto Calculate Zonal Awards Points - {s.RunCompletedAt:dd-MMM-yyyy hh:mm tt}";
    var body = $@"
<div style='font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6'>
  <h2 style='color:#1e3a8a;margin:0 0 12px 0'>Auto Calculate Zonal Awards Points</h2>
  <p style='margin:0 0 16px 0;color:#475569'>The standalone worker (AwardsAutoCalcWorker --zonal-awards) has completed.</p>
  <table style='border-collapse:collapse;width:100%;max-width:520px;border:1px solid #e2e8f0'>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:200px'>Run started</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.RunStartedAt:dd-MMM-yyyy hh:mm:ss tt}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Run completed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.RunCompletedAt:dd-MMM-yyyy hh:mm:ss tt}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Duration</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{(int)duration.TotalMinutes} min {duration.Seconds} sec</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Rotary year</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.YearLabel}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Status</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{(s.Skipped ? $"Skipped — {s.SkipReason}" : "Completed")}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Districts processed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.DistrictsProcessed}</td></tr>
    <tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc'>Districts failed</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>{s.DistrictsFailed}</td></tr>
  </table>
  <p style='margin:20px 0 0 0;color:#64748b;font-size:12px'>This is an automated notification from ROW.</p>
</div>";
    foreach (var to in recipients)
        await email.SendAsync(to, subject, body);
}

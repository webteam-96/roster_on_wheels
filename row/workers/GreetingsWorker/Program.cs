using GreetingsWorker.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// ════════════════════════════════════════════════════════════════════════
// Greetings Worker — daily birthday & anniversary greetings
//
//   --send   Find every active member whose BIRTHDAY or wedding ANNIVERSARY is
//            today and send an email (Brevo) and push greeting per the per-club
//            and per-district Greetings config.
//            Club AND district both send (a member covered by both gets one each).
//            Each send deducts 1 from the source's club/district credits
//            (unless Greetings:DeductCredits=false). A greeting_send_log makes
//            re-runs idempotent. Sends an admin summary email on completion.
//
// Scheduled via Windows Task Scheduler (see TaskScheduler-Greetings-Morning.xml).
// ════════════════════════════════════════════════════════════════════════

Console.WriteLine("=========================================");
Console.WriteLine(" Greetings Worker (birthday / anniversary)");
Console.WriteLine("=========================================");

var mode = args.Length > 0 ? args[0].ToLowerInvariant() : "--help";
if (mode is "--help" or "-h" or "/?" or "/help")
{
    Console.WriteLine();
    Console.WriteLine("Usage:");
    Console.WriteLine("  GreetingsWorker.exe --send       Send today's birthday & anniversary greetings (club + district)");
    Console.WriteLine("  GreetingsWorker.exe --dry-run    Preview who would be greeted today — NO sends, NO credit deductions, NO log writes");
    Console.WriteLine("  GreetingsWorker.exe --diagnose   Read-only report: club/district config flags, a member's dates + greeting_send_log history, and recent day-by-day activity for the scope");
    Console.WriteLine();
    Console.WriteLine("  Optional scope filters (for testing — restrict to one club and/or one district):");
    Console.WriteLine("    --club-name \"Thane City View\"     process only this club");
    Console.WriteLine("    --district-number 5656             process only this district");
    Console.WriteLine("    --date 2026-08-15                  match birthdays/anniversaries on this date instead of today (testing)");
    Console.WriteLine("    --member-name \"Raj Shah\"           (--diagnose only) also inspect this member's own record + send log");
    Console.WriteLine();
    Console.WriteLine("  e.g.  GreetingsWorker.exe --dry-run --club-name \"Thane City View\" --district-number 5656 --date 2026-08-15");
    Console.WriteLine("  e.g.  GreetingsWorker.exe --diagnose --club-name \"Thane City View\" --district-number 5656 --member-name \"Raj Shah\"");
    Console.WriteLine();
    return 1;
}

var config = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
    .AddEnvironmentVariables()   // secrets and Brand__* settings come from the environment
    .Build();
RotaryApi.Services.Brand.Init(config);

var connString = config.GetConnectionString("DefaultConnection")
                 ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing in appsettings.json");

var services = new ServiceCollection();
services.AddSingleton<IConfiguration>(config);
services.AddLogging(b => b
    .AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; })
    .SetMinimumLevel(LogLevel.Information));
services.AddHttpClient();
services.AddSingleton(config.GetSection("Greetings").Get<GreetingsOptions>() ?? new GreetingsOptions());

services.AddSingleton<BrevoEmailSender>(sp =>
{
    var brevo = config.GetSection("Brevo");
    return new BrevoEmailSender(
        sp.GetRequiredService<IHttpClientFactory>().CreateClient("brevo"),
        sp.GetRequiredService<ILogger<BrevoEmailSender>>(),
        apiUrl: brevo["ApiUrl"] ?? "https://api.brevo.com/v3/smtp/email",
        apiKey: brevo["ApiKey"] ?? throw new InvalidOperationException("Brevo:ApiKey missing"),
        senderName: brevo["SenderName"] ?? "ROW",
        senderEmail: brevo["SenderEmail"] ?? RotaryApi.Services.Brand.NoReplyEmail);
});
services.AddSingleton<FirebasePushSender>();
services.AddSingleton<GreetingsJob>(sp => new GreetingsJob(
    connString,
    sp.GetRequiredService<ILogger<GreetingsJob>>(),
    sp.GetRequiredService<BrevoEmailSender>(),
    sp.GetRequiredService<FirebasePushSender>(),
    sp.GetRequiredService<GreetingsOptions>()));

var provider = services.BuildServiceProvider();
var log = provider.GetRequiredService<ILogger<Program>>();
var recipients = config.GetSection("ReportRecipients").Get<string[]>() ?? Array.Empty<string>();

try
{
    if (mode == "--send" || mode == "--dry-run")
    {
        bool dry = mode == "--dry-run";
        var clubName = GetArg(args, "--club-name");
        var districtNumber = GetArg(args, "--district-number");
        var dateArg = GetArg(args, "--date");
        DateTime? overrideDate = null;
        if (!string.IsNullOrWhiteSpace(dateArg))
        {
            if (DateTime.TryParse(dateArg, out var d)) overrideDate = d;
            else { Console.WriteLine($"Invalid --date '{dateArg}'. Use YYYY-MM-DD."); return 1; }
        }
        var job = provider.GetRequiredService<GreetingsJob>();
        var scopeMsg = (clubName, districtNumber) switch
        {
            (null, null) => "ALL enabled clubs + districts",
            (not null, null) => $"club '{clubName}' only",
            (null, not null) => $"district '{districtNumber}' only",
            _ => $"club '{clubName}' + district '{districtNumber}' only"
        };
        log.LogInformation("{Mode} started. Scope: {Scope}. Match date: {Date}.",
            dry ? "Greetings DRY-RUN (no sends/credits/log writes)" : "Greetings run", scopeMsg,
            overrideDate?.ToString("dd-MMM") ?? "today");
        var stats = await job.RunAsync(dry, clubName, districtNumber, overrideDate);
        var dur = stats.RunCompletedAt - stats.RunStartedAt;
        log.LogInformation(
            "{Tag}done in {Sec}s. Email={E} (failed {EF}) | Push={P} (failed {PF}) | skipped={Sk} | clubs={C} districts={D}",
            dry ? "[DRY] " : "", (int)dur.TotalSeconds,
            stats.EmailSent, stats.EmailFailed,
            stats.PushSent, stats.PushFailed,
            stats.Skipped, stats.ClubsProcessed, stats.DistrictsProcessed);
        if (!dry) await SendSummaryAsync(provider, recipients, stats);
        return 0;
    }

    if (mode == "--diagnose")
    {
        var clubName = GetArg(args, "--club-name");
        var districtNumber = GetArg(args, "--district-number");
        var memberName = GetArg(args, "--member-name");
        if (string.IsNullOrWhiteSpace(clubName) && string.IsNullOrWhiteSpace(districtNumber) && string.IsNullOrWhiteSpace(memberName))
        {
            Console.WriteLine("--diagnose needs at least one of --club-name, --district-number, --member-name.");
            return 1;
        }
        var job = provider.GetRequiredService<GreetingsJob>();
        await job.DiagnoseAsync(clubName, districtNumber, memberName);
        return 0;
    }

    Console.WriteLine($"Unknown mode: {mode}. Use --help.");
    return 1;
}
catch (Exception ex)
{
    log.LogError(ex, "Unhandled error in greetings run");
    return 2;
}

static string? GetArg(string[] args, string key)
{
    var i = Array.FindIndex(args, a => a.Equals(key, StringComparison.OrdinalIgnoreCase));
    return (i >= 0 && i + 1 < args.Length) ? args[i + 1] : null;
}

static async Task SendSummaryAsync(IServiceProvider sp, string[] recipients, GreetingsJob.RunStats s)
{
    if (recipients.Length == 0) return;
    var email = sp.GetRequiredService<BrevoEmailSender>();
    var dur = s.RunCompletedAt - s.RunStartedAt;
    var subject = $"ROW - Daily Greetings Sent - {s.RunCompletedAt:dd-MMM-yyyy}";
    string Row(string k, object v) =>
        $"<tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:240px'>{k}</td>" +
        $"<td style='padding:8px 12px;border:1px solid #e2e8f0'>{v}</td></tr>";
    var body = $@"
<div style='font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6'>
  <div style='text-align:center;padding:6px 0 14px 0'><img src='{RotaryApi.Services.Brand.EmailLogoUrl}' alt='ROW' style='height:46px' /></div>
  <h2 style='color:#1e3a8a;margin:0 0 12px 0'>Daily Birthday &amp; Anniversary Greetings</h2>
  <p style='margin:0 0 16px 0;color:#475569'>The GreetingsWorker --send run has completed.</p>
  <table style='border-collapse:collapse;width:100%;max-width:560px;border:1px solid #e2e8f0'>
    {Row("Run started", $"{s.RunStartedAt:dd-MMM-yyyy hh:mm:ss tt}")}
    {Row("Run completed", $"{s.RunCompletedAt:dd-MMM-yyyy hh:mm:ss tt}")}
    {Row("Duration", $"{(int)dur.TotalMinutes} min {dur.Seconds} sec")}
    {Row("Clubs processed", s.ClubsProcessed)}
    {Row("Districts processed", s.DistrictsProcessed)}
    {Row("Email sent", s.EmailSent)}
    {Row("Email failed", s.EmailFailed)}
    {Row("Push sent", s.PushSent)}
    {Row("Push failed", s.PushFailed)}
    {Row("Skipped (no contact / no credits / etc.)", s.Skipped)}
  </table>
  <p style='margin:20px 0 0 0;color:#64748b;font-size:12px'>Automated notification from ROW. Details per recipient are in the greeting_send_log table.</p>
</div>";
    var summaryLog = sp.GetRequiredService<ILogger<Program>>();
    foreach (var to in recipients)
    {
        var ok = await email.SendAsync(to, subject, body);
        if (!ok) summaryLog.LogWarning("Admin summary email failed to send to {To}", to);
    }
}

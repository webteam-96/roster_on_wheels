using AssistantIndexWorker.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// ════════════════════════════════════════════════════════════════════════
// Assistant Index Worker
//
// Fills the Qdrant vector index the AI assistant (RotaryApi/Services/Assistant) searches, and
// purges old assistant data.
//   --full      Embed every live project and communication (first run, or after a model change).
//   --delta     Embed only rows whose content hash changed; delete points whose rows are gone.
//   --cleanup   90-day purge of assistant messages / conversations / security events, expired
//               answer cache, usage rows older than 400 days.
//   --dry-run   With --full/--delta (or alone = delta): count what would be embedded and deleted,
//               calling neither Gemini nor Qdrant. With --cleanup: count what would be purged.
//
// Reads MySQL; writes ONLY assistant_* tables and Qdrant. Secrets come from environment variables
// (ConnectionStrings__DefaultConnection, Assistant__Gemini__ApiKey, Assistant__Qdrant__ApiKey).
// Scheduled nightly via Windows Task Scheduler: --delta --cleanup.
// ════════════════════════════════════════════════════════════════════════

Console.WriteLine("=========================================");
Console.WriteLine(" Assistant Index Worker");
Console.WriteLine("=========================================");

var flags = args.Select(a => a.ToLowerInvariant()).ToHashSet();
string[] helpFlags = ["--help", "-h", "/?", "/help"];
string[] knownFlags = ["--full", "--delta", "--cleanup", "--dry-run", .. helpFlags];

if (flags.Count == 0 || flags.Overlaps(helpFlags))
{
    Console.WriteLine("");
    Console.WriteLine("Usage:");
    Console.WriteLine("  AssistantIndexWorker.exe --full               Embed every live project and communication");
    Console.WriteLine("  AssistantIndexWorker.exe --delta              Embed changed rows only; delete points for removed rows");
    Console.WriteLine("  AssistantIndexWorker.exe --cleanup            Purge old assistant data (90-day retention)");
    Console.WriteLine("  AssistantIndexWorker.exe --delta --cleanup    Nightly scheduled run");
    Console.WriteLine("  Add --dry-run to count what would be embedded / deleted without calling Gemini or Qdrant");
    Console.WriteLine("  (--dry-run alone previews a --delta).");
    Console.WriteLine("");
    return 1;
}

var unknown = flags.Except(knownFlags).ToList();
if (unknown.Count > 0)
{
    Console.WriteLine($"Unknown option(s): {string.Join(", ", unknown)}. Use --help.");
    return 1;
}

var full = flags.Contains("--full");
var delta = flags.Contains("--delta");
var cleanup = flags.Contains("--cleanup");
var dryRun = flags.Contains("--dry-run");
if (full && delta)
{
    Console.WriteLine("--full and --delta cannot be combined.");
    return 1;
}
if (dryRun && !full && !cleanup) delta = true;
var indexing = full || delta;

// Configuration — appsettings.json holds no secrets; environment variables override it.
var config = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
    .AddEnvironmentVariables()
    .Build();

var connString = config.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connString))
{
    Console.WriteLine("ConnectionStrings:DefaultConnection is empty. Set the environment variable ConnectionStrings__DefaultConnection.");
    return 1;
}
var geminiApiKey = config["Assistant:Gemini:ApiKey"] ?? "";
var embeddingModel = config["Assistant:Gemini:EmbeddingModel"] ?? "gemini-embedding-2";
var embeddingDims = config.GetValue("Assistant:Gemini:EmbeddingDims", 768);
var qdrantUrl = config["Assistant:Qdrant:Url"] ?? "http://127.0.0.1:6334";
var qdrantApiKey = config["Assistant:Qdrant:ApiKey"];
if (indexing && !dryRun && string.IsNullOrWhiteSpace(geminiApiKey))
{
    Console.WriteLine("Assistant:Gemini:ApiKey is empty. Set the environment variable Assistant__Gemini__ApiKey.");
    return 1;
}

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
services.AddSingleton<YearTableResolver>();
services.AddSingleton<SourceReader>(sp => new SourceReader(
    connString,
    sp.GetRequiredService<YearTableResolver>(),
    embeddingModel,
    embeddingDims,
    sp.GetRequiredService<ILogger<SourceReader>>()));
services.AddSingleton<GeminiEmbedder>(sp => new GeminiEmbedder(
    geminiApiKey, embeddingModel, embeddingDims, sp.GetRequiredService<ILogger<GeminiEmbedder>>()));
services.AddSingleton<QdrantStore>(sp => new QdrantStore(
    qdrantUrl, qdrantApiKey, embeddingDims, sp.GetRequiredService<ILogger<QdrantStore>>()));
services.AddSingleton<Indexer>(sp => new Indexer(
    connString,
    sp.GetRequiredService<SourceReader>(),
    () => sp.GetRequiredService<GeminiEmbedder>(),
    () => sp.GetRequiredService<QdrantStore>(),
    sp.GetRequiredService<ILogger<Indexer>>()));
services.AddSingleton<CleanupService>(sp => new CleanupService(
    connString, sp.GetRequiredService<ILogger<CleanupService>>()));

using var sp = services.BuildServiceProvider();
var log = sp.GetRequiredService<ILogger<Program>>();
var mode = string.Join(" ", new[]
{
    full ? "--full" : null, delta ? "--delta" : null, cleanup ? "--cleanup" : null, dryRun ? "--dry-run" : null,
}.Where(m => m != null));

try
{
    var started = DateTime.Now;
    log.LogInformation("Started: {Mode} (model {Model}, {Dims} dims, Qdrant {Url})", mode, embeddingModel, embeddingDims, qdrantUrl);

    // Cleanup first: the retention purge must not depend on Gemini or Qdrant being reachable.
    if (cleanup)
        await sp.GetRequiredService<CleanupService>().RunAsync(dryRun);

    if (indexing)
        await sp.GetRequiredService<Indexer>().RunAsync(full, dryRun);

    var duration = DateTime.Now - started;
    log.LogInformation("Completed: {Mode}. Duration: {Min}m {Sec}s", mode, (int)duration.TotalMinutes, duration.Seconds);
    return 0;
}
catch (Exception ex)
{
    log.LogError(ex, "Unhandled error in {Mode}", mode);
    return 2;
}

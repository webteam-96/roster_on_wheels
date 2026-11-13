namespace RotaryApi.Services.Assistant;

// Everything the AI assistant reads from the "Assistant" config section, resolved once at startup.
// API keys are deliberately NOT in appsettings.json - set them on the server as environment
// variables (Assistant__Anthropic__ApiKey, Assistant__Gemini__ApiKey, Assistant__Qdrant__ApiKey).
public sealed class AssistantSettings
{
    public bool Enabled { get; init; }

    public string AnthropicApiKey { get; init; } = "";
    public string SonnetModel { get; init; } = "claude-sonnet-5-5";
    public string SonnetEffort { get; init; } = "medium";
    public int SonnetMaxTokens { get; init; } = 16000;

    // A separate, billing-enabled Gemini key. Never fall back to the free-tier Gemini:ApiKey used by
    // project classification: free-tier prompts may be used by Google, and these carry member data.
    public string GeminiApiKey { get; init; } = "";
    public string FlashModel { get; init; } = "gemini-3.8-flash";
    public string EmbeddingModel { get; init; } = "gemini-embedding-2";
    public int EmbeddingDims { get; init; } = 768;

    public string QdrantUrl { get; init; } = "http://127.0.0.1:6334";
    public string QdrantApiKey { get; init; } = "";

    public int DailyQuestionsPerUser { get; init; } = 25;
    public decimal MonthlyBudgetUsd { get; init; } = 50m;
    public int MaxInputChars { get; init; } = 1000;
    public int MaxToolSteps { get; init; } = 6;
    public int HistoryTurns { get; init; } = 6;
    public int ContactLookupsPerDay { get; init; } = 10;
    public int FlaggedAttemptsBeforeBlock { get; init; } = 3;

    public int AnswerTtlMinutes { get; init; } = 30;
    public int ToolTtlMinutes { get; init; } = 10;

    public string ReadOnlyConnectionString { get; init; } = "";
    public string WriterConnectionString { get; init; } = "";

    public IReadOnlyList<ModelPrice> Prices { get; init; } = Array.Empty<ModelPrice>();

    public bool SonnetConfigured => !string.IsNullOrWhiteSpace(AnthropicApiKey);
    public bool FlashConfigured => !string.IsNullOrWhiteSpace(GeminiApiKey);

    public static AssistantSettings FromConfig(IConfiguration config)
    {
        var s = config.GetSection("Assistant");
        var writer = config.GetConnectionString("DefaultConnection") ?? "";
        var readOnly = config.GetConnectionString("AssistantReadOnly");
        return new AssistantSettings
        {
            Enabled = s.GetValue("Enabled", false),
            AnthropicApiKey = s["Anthropic:ApiKey"] ?? "",
            SonnetModel = s["Anthropic:Model"] ?? "claude-sonnet-5-5",
            SonnetEffort = s["Anthropic:Effort"] ?? "medium",
            SonnetMaxTokens = s.GetValue("Anthropic:MaxTokens", 16000),
            GeminiApiKey = s["Gemini:ApiKey"] ?? "",
            FlashModel = s["Gemini:Model"] ?? "gemini-3.8-flash",
            EmbeddingModel = s["Gemini:EmbeddingModel"] ?? "gemini-embedding-2",
            EmbeddingDims = s.GetValue("Gemini:EmbeddingDims", 768),
            QdrantUrl = s["Qdrant:Url"] ?? "http://127.0.0.1:6334",
            QdrantApiKey = s["Qdrant:ApiKey"] ?? "",
            DailyQuestionsPerUser = s.GetValue("Limits:DailyQuestionsPerUser", 25),
            MonthlyBudgetUsd = s.GetValue("Limits:MonthlyBudgetUsd", 50m),
            MaxInputChars = s.GetValue("Limits:MaxInputChars", 1000),
            MaxToolSteps = s.GetValue("Limits:MaxToolSteps", 6),
            HistoryTurns = s.GetValue("Limits:HistoryTurns", 6),
            ContactLookupsPerDay = s.GetValue("Limits:ContactLookupsPerDay", 10),
            FlaggedAttemptsBeforeBlock = s.GetValue("Limits:FlaggedAttemptsBeforeBlock", 3),
            AnswerTtlMinutes = s.GetValue("Cache:AnswerTtlMinutes", 30),
            ToolTtlMinutes = s.GetValue("Cache:ToolTtlMinutes", 10),
            WriterConnectionString = writer,
            // Until the read-only MySQL user exists the tools fall back to the main connection.
            // Tools only ever run SELECTs, but create the user (SQL/assistant_readonly_user.sql)
            // before go-live so a bug can never write.
            ReadOnlyConnectionString = string.IsNullOrWhiteSpace(readOnly) ? writer : readOnly,
            Prices = s.GetSection("Pricing").Get<List<ModelPrice>>() ?? new List<ModelPrice>(),
        };
    }

    // The price row for a model on a given day: the latest entry whose From date has passed
    // (Gemini 3.8 Flash doubles on 2027-01-01, so it carries two rows).
    public ModelPrice? PriceFor(string model, DateTime utcNow) =>
        Prices.Where(p => p.Model == model && (p.From == null || p.From <= utcNow))
              .OrderByDescending(p => p.From ?? DateTime.MinValue)
              .FirstOrDefault();
}

public sealed class ModelPrice
{
    public string Model { get; set; } = "";
    public DateTime? From { get; set; }
    public decimal InputPerM { get; set; }
    public decimal OutputPerM { get; set; }
    public decimal CacheReadPerM { get; set; }
    public decimal CacheWritePerM { get; set; }
}

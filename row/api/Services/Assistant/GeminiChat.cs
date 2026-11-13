using System.Text.Json;
using System.Text.Json.Nodes;
using Google.GenAI;
using Google.GenAI.Types;

namespace RotaryApi.Services.Assistant;

// Gemini Flash: the guard/router call, easy answers, and query embeddings.
//
// The answer loop appends each model Content exactly as returned so Gemini 3's thought signatures
// survive between function-calling turns. Implicit caching applies on its own because the system
// instruction and tool list come first and never change.
public sealed class GeminiChat
{
    private readonly AssistantSettings _settings;
    // Created on first use: the SDK rejects an empty key, and the key may not be set yet.
    private readonly Lazy<Client> _lazyClient;
    private Client _client => _lazyClient.Value;

    public GeminiChat(AssistantSettings settings)
    {
        _settings = settings;
        _lazyClient = new Lazy<Client>(() => new Client(apiKey: settings.GeminiApiKey));
    }

    // Fills the caller's LlmAnswer as it goes, so usage already spent is still known (and billed)
    // if the request is cancelled or fails part-way.
    public async Task AnswerAsync(LlmRequest req, LlmCallbacks cb, LlmAnswer answer, CancellationToken ct)
    {
        answer.Model = _settings.FlashModel;
        var config = new GenerateContentConfig
        {
            SystemInstruction = new Content { Parts = new List<Part> { new() { Text = req.SystemPrompt } } },
            Tools = new List<Tool>
            {
                new() { FunctionDeclarations = req.Tools.Select(ToDeclaration).ToList() },
            },
            ThinkingConfig = new ThinkingConfig { ThinkingLevel = ThinkingLevel.Low },
            MaxOutputTokens = 8192,
        };

        var contents = new List<Content>();
        foreach (var turn in req.History)
            contents.Add(new Content { Role = turn.Role == "user" ? "user" : "model", Parts = new List<Part> { new() { Text = turn.Content } } });
        contents.Add(new Content
        {
            Role = "user",
            Parts = new List<Part> { new() { Text = req.Context }, new() { Text = req.Question } },
        });

        for (var step = 0; step <= _settings.MaxToolSteps; step++)
        {
            ct.ThrowIfCancellationRequested();
            var resp = await _client.Models.GenerateContentAsync(_settings.FlashModel, contents, config, ct);
            answer.Usage = answer.Usage.Add(UsageOf(resp.UsageMetadata));

            var candidate = resp.Candidates?.FirstOrDefault();
            if (candidate?.Content?.Parts == null || IsRefusal(candidate.FinishReason))
            {
                answer.Refused = resp.PromptFeedback?.BlockReason != null || IsRefusal(candidate?.FinishReason);
                answer.WantsEscalation = !answer.Refused;
                return;
            }

            var calls = candidate.Content.Parts.Where(p => p.FunctionCall != null).Select(p => p.FunctionCall!).ToList();
            if (calls.Count == 0)
            {
                answer.Text = string.Concat(candidate.Content.Parts.Where(p => p.Text != null && p.Thought != true).Select(p => p.Text)).Trim();
                if (answer.Text.Contains("[[ESCALATE]]", StringComparison.Ordinal)) answer.WantsEscalation = true;
                return;
            }
            if (step == _settings.MaxToolSteps)
            {
                answer.HitStepLimit = true;
                return;
            }

            contents.Add(candidate.Content);
            var responseParts = new List<Part>();
            foreach (var fc in calls)
            {
                var name = fc.Name ?? "";
                answer.ToolsUsed.Add(name);
                var args = JsonSerializer.SerializeToElement(fc.Args ?? new Dictionary<string, object>());
                var json = await cb.RunTool(new ToolCall(fc.Id ?? name, name, args), ct);
                if (json.StartsWith("{\"error\"", StringComparison.Ordinal)) answer.ToolErrors++;
                responseParts.Add(new Part
                {
                    FunctionResponse = new FunctionResponse
                    {
                        Id = fc.Id,
                        Name = name,
                        Response = new Dictionary<string, object> { ["result"] = JsonNode.Parse(json)! },
                    },
                });
            }
            contents.Add(new Content { Role = "user", Parts = responseParts });
        }

        answer.HitStepLimit = true;
        return;
    }

    // One cheap structured-output call. Returns null when Gemini fails or refuses to answer.
    public async Task<(JsonElement? Result, LlmUsage Usage)> ClassifyAsync(string systemPrompt, string userText,
        JsonNode schema, CancellationToken ct)
    {
        var config = new GenerateContentConfig
        {
            SystemInstruction = new Content { Parts = new List<Part> { new() { Text = systemPrompt } } },
            ResponseMimeType = "application/json",
            ResponseJsonSchema = schema,
            ThinkingConfig = new ThinkingConfig { ThinkingLevel = ThinkingLevel.Low },
            MaxOutputTokens = 1024,
        };
        var resp = await _client.Models.GenerateContentAsync(_settings.FlashModel,
            new List<Content> { new() { Role = "user", Parts = new List<Part> { new() { Text = userText } } } }, config, ct);
        var usage = UsageOf(resp.UsageMetadata);
        var text = resp.Candidates?.FirstOrDefault()?.Content?.Parts?
            .Where(p => p.Text != null && p.Thought != true).Select(p => p.Text).FirstOrDefault();
        if (string.IsNullOrWhiteSpace(text)) return (null, usage);
        try { return (JsonDocument.Parse(text).RootElement.Clone(), usage); }
        catch (JsonException) { return (null, usage); }
    }

    // Query-side embedding. Must use the same model, size and prefix as AssistantIndexWorker's documents.
    public async Task<float[]> EmbedQueryAsync(string text, CancellationToken ct)
    {
        var resp = await _client.Models.EmbedContentAsync(_settings.EmbeddingModel,
            $"task: search result | query: {text}",
            new EmbedContentConfig { OutputDimensionality = _settings.EmbeddingDims }, ct);
        var values = resp.Embeddings?.FirstOrDefault()?.Values
                     ?? throw new InvalidOperationException("Embedding call returned no vector.");
        return values.Select(v => (float)v).ToArray();
    }

    private static FunctionDeclaration ToDeclaration(ToolSpec spec) => new()
    {
        Name = spec.Name,
        Description = spec.Description,
        ParametersJsonSchema = spec.InputSchema.DeepClone(),
    };

    private static bool IsRefusal(FinishReason? reason) =>
        reason == FinishReason.Safety || reason == FinishReason.ProhibitedContent ||
        reason == FinishReason.Blocklist || reason == FinishReason.Spii;

    // Gemini counts cached tokens inside the prompt count, and thinking apart from the answer.
    private static LlmUsage UsageOf(GenerateContentResponseUsageMetadata? u)
    {
        if (u == null) return LlmUsage.Zero;
        var cached = u.CachedContentTokenCount ?? 0;
        return new LlmUsage(
            Math.Max((u.PromptTokenCount ?? 0) - cached, 0),
            (u.CandidatesTokenCount ?? 0) + (u.ThoughtsTokenCount ?? 0),
            cached,
            0);
    }
}

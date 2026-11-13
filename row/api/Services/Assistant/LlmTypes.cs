using System.Text.Json;
using System.Text.Json.Nodes;

namespace RotaryApi.Services.Assistant;

// Token counts in one shape for both providers. Input = uncached prompt tokens only.
public sealed record LlmUsage(int InputTokens, int OutputTokens, int CacheReadTokens, int CacheWriteTokens)
{
    public static LlmUsage Zero { get; } = new(0, 0, 0, 0);

    public LlmUsage Add(LlmUsage o) => new(InputTokens + o.InputTokens, OutputTokens + o.OutputTokens,
        CacheReadTokens + o.CacheReadTokens, CacheWriteTokens + o.CacheWriteTokens);

    public decimal CostUsd(ModelPrice? p) => p == null ? 0m :
        (InputTokens * p.InputPerM + OutputTokens * p.OutputPerM +
         CacheReadTokens * p.CacheReadPerM + CacheWriteTokens * p.CacheWritePerM) / 1_000_000m;
}

// A tool as both providers see it. Schemas are strict JSON Schema objects
// (additionalProperties:false, every property listed in required; optional ones are nullable).
public sealed record ToolSpec(string Name, string Description, JsonObject InputSchema);

public sealed record ToolCall(string Id, string Name, JsonElement Arguments);

// What one answer loop produced, whichever model ran it.
public sealed class LlmAnswer
{
    public string Text { get; set; } = "";
    public string Model { get; set; } = "";
    public LlmUsage Usage { get; set; } = LlmUsage.Zero;
    public decimal CostUsd { get; set; }
    public List<string> ToolsUsed { get; } = new();
    public bool Refused { get; set; }
    public bool HitStepLimit { get; set; }
    public bool WantsEscalation { get; set; }
    public int ToolErrors { get; set; }
}

// The orchestrator's hooks into a running answer loop.
public sealed class LlmCallbacks
{
    public required Func<ToolCall, CancellationToken, Task<string>> RunTool { get; init; }
    public required Func<string, Task> Status { get; init; }
    // Null = buffer the answer (Gemini, so an escalation can replace it without showing it).
    public Func<string, Task>? TextDelta { get; init; }
    // A streamed step turned out to be preamble before tool calls - the client clears it.
    public Func<Task>? ResetText { get; init; }
}

public sealed record ChatTurn(string Role, string Content);

public sealed class LlmRequest
{
    public required string SystemPrompt { get; init; }
    public required IReadOnlyList<ToolSpec> Tools { get; init; }
    public required IReadOnlyList<ChatTurn> History { get; init; }
    public required string Question { get; init; }
    // Per-request facts (date, the member's scope). Sent after the question so the cached prefix
    // (tools + system prompt) stays byte-identical across members and days.
    public required string Context { get; init; }
}

public static class ToolJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static string Serialize(object value) => JsonSerializer.Serialize(value, Options);

    public static string Error(string message) => Serialize(new { error = message });
}

using System.Text.Json;
using Anthropic;
using Anthropic.Helpers;
using Anthropic.Models.Messages;

namespace RotaryApi.Services.Assistant;

// Claude Sonnet answer loop: stream a turn, run the tool calls it asks for, repeat until it answers.
//
// Prompt caching: tools + system prompt are the cached prefix (breakpoint on the system block; the
// tool list is sorted and fixed). Everything per request - history, the member's scope, today's
// date, the question - comes after it, so the prefix is byte-identical for every member.
public sealed class AnthropicChat
{
    private readonly AssistantSettings _settings;
    // Created on first use, so the API starts even before the key is configured.
    private readonly Lazy<AnthropicClient> _lazyClient;
    private AnthropicClient _client => _lazyClient.Value;

    public AnthropicChat(AssistantSettings settings)
    {
        _settings = settings;
        _lazyClient = new Lazy<AnthropicClient>(() => new AnthropicClient { ApiKey = settings.AnthropicApiKey });
    }

    // Fills the caller's LlmAnswer as it goes, so usage already spent is still known (and billed)
    // if the request is cancelled or fails part-way.
    public async Task AnswerAsync(LlmRequest req, LlmCallbacks cb, LlmAnswer answer, CancellationToken ct)
    {
        answer.Model = _settings.SonnetModel;
        var tools = req.Tools.Select(t => (ToolUnion)ToTool(t)).ToList();

        var messages = new List<MessageParam>();
        foreach (var turn in req.History)
            messages.Add(turn.Role == "user"
                ? new UserMessageParam { Content = turn.Content }
                : new AssistantMessageParam { Content = turn.Content });
        messages.Add(new UserMessageParam
        {
            Content = new List<ContentBlockParam>
            {
                new TextBlockParam { Text = req.Context },
                new TextBlockParam { Text = req.Question },
            },
        });

        for (var step = 0; step <= _settings.MaxToolSteps; step++)
        {
            ct.ThrowIfCancellationRequested();
            var parameters = new MessageCreateParams
            {
                Model = _settings.SonnetModel,
                MaxTokens = _settings.SonnetMaxTokens,
                Thinking = new ThinkingConfigAdaptive(),
                OutputConfig = new OutputConfig { Effort = ParseEffort(_settings.SonnetEffort) },
                System = new List<TextBlockParam>
                {
                    new() { Text = req.SystemPrompt, CacheControl = new CacheControlEphemeral() },
                },
                Tools = tools,
                Messages = messages,
            };

            var aggregator = new MessageContentAggregator();
            var streamedText = false;
            await foreach (var ev in aggregator.CollectAsync(_client.Messages.CreateStreaming(parameters, ct)))
            {
                if (cb.TextDelta != null && ev.TryPickContentBlockDelta(out var delta) && delta.Delta.TryPickText(out var text))
                {
                    streamedText = true;
                    await cb.TextDelta(text.Text);
                }
            }
            var message = aggregator.Message();
            answer.Usage = answer.Usage.Add(UsageOf(message.Usage));

            var stop = message.StopReason?.Raw();
            if (stop == "refusal")
            {
                answer.Refused = true;
                return;
            }

            var assistantContent = new List<ContentBlockParam>();
            var toolCalls = new List<ToolUseBlock>();
            var finalText = new System.Text.StringBuilder();
            foreach (var block in message.Content)
            {
                if (block.TryPickText(out var t))
                {
                    finalText.Append(t.Text);
                    assistantContent.Add(new TextBlockParam { Text = t.Text });
                }
                else if (block.TryPickThinking(out var th))
                    // Signature must come back unchanged or the API rejects the next request.
                    assistantContent.Add(new ThinkingBlockParam { Thinking = th.Thinking, Signature = th.Signature });
                else if (block.TryPickRedactedThinking(out var rt))
                    assistantContent.Add(new RedactedThinkingBlockParam { Data = rt.Data });
                else if (block.TryPickToolUse(out var tu))
                {
                    toolCalls.Add(tu);
                    assistantContent.Add(new ToolUseBlockParam { ID = tu.ID, Name = tu.Name, Input = tu.Input });
                }
            }

            if (stop != "tool_use" || toolCalls.Count == 0)
            {
                answer.Text = finalText.ToString().Trim();
                return;
            }

            // Text streamed before the tool calls was preamble, not the answer.
            if (streamedText && cb.ResetText != null) await cb.ResetText();
            if (step == _settings.MaxToolSteps)
            {
                answer.HitStepLimit = true;
                return;
            }

            // Run every call of this turn, then send all results back in one user message.
            var results = new List<ContentBlockParam>();
            foreach (var tu in toolCalls)
            {
                answer.ToolsUsed.Add(tu.Name);
                var json = await cb.RunTool(new ToolCall(tu.ID, tu.Name, JsonSerializer.SerializeToElement(tu.Input)), ct);
                var isError = json.StartsWith("{\"error\"", StringComparison.Ordinal);
                if (isError) answer.ToolErrors++;
                results.Add(new ToolResultBlockParam { ToolUseID = tu.ID, Content = json, IsError = isError });
            }
            messages.Add(new AssistantMessageParam { Content = assistantContent });
            messages.Add(new UserMessageParam { Content = results });
        }

        answer.HitStepLimit = true;
        return;
    }

    private static Tool ToTool(ToolSpec spec)
    {
        var raw = spec.InputSchema.ToDictionary(kv => kv.Key, kv => JsonSerializer.SerializeToElement(kv.Value));
        return new Tool
        {
            Name = spec.Name,
            Description = spec.Description,
            InputSchema = InputSchema.FromRawUnchecked(raw),
            // Not strict: strict mode allows at most 24 optional parameters across all tools and these
            // have 40+. ToolArgs validates every argument and returns a readable error to the model.
        };
    }

    private static Effort ParseEffort(string value) => value.ToLowerInvariant() switch
    {
        "low" => Effort.Low,
        "high" => Effort.High,
        _ => Effort.Medium,
    };

    private static LlmUsage UsageOf(Usage u) => new(
        (int)u.InputTokens,
        (int)u.OutputTokens,
        (int)(u.CacheReadInputTokens ?? 0),
        (int)(u.CacheCreationInputTokens ?? 0));
}

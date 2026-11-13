using Google.GenAI;
using Google.GenAI.Types;
using Microsoft.Extensions.Logging;

namespace AssistantIndexWorker.Services;

// Document embeddings via the Gemini API. Must use the same model and size as the API's
// GeminiChat.EmbedQueryAsync (gemini-embedding-2 at 768 dims returns normalised vectors).
public sealed class GeminiEmbedder
{
    public const int BatchSize = 100;
    private const int MaxAttempts = 6;   // 1 call + 5 retries: 2, 4, 8, 16, 32 s (+ jitter)

    private readonly Client _client;
    private readonly string _model;
    private readonly int _dims;
    private readonly EmbedContentConfig _config;
    private readonly ILogger<GeminiEmbedder> _log;

    public GeminiEmbedder(string apiKey, string model, int dims, ILogger<GeminiEmbedder> log)
    {
        _client = new Client(apiKey: apiKey);
        _model = model;
        _dims = dims;
        _config = new EmbedContentConfig { OutputDimensionality = dims };
        _log = log;
    }

    // One vector per text, in the same order. texts.Count must be <= BatchSize.
    public async Task<List<float[]>> EmbedAsync(IReadOnlyList<string> texts)
    {
        var contents = texts.Select(t => new Content { Parts = new List<Part> { new() { Text = t } } }).ToList();
        var resp = await WithRetryAsync(() => _client.Models.EmbedContentAsync(_model, contents, _config));
        var embeddings = resp.Embeddings ?? new List<ContentEmbedding>();
        if (embeddings.Count == texts.Count)
            return embeddings.Select(ToVector).ToList();

        // Never pair vectors with the wrong texts: if a batch comes back short (or aggregated into a
        // single vector), embed this batch one text at a time instead.
        _log.LogWarning("Embedding batch returned {Got} vectors for {Sent} texts; embedding this batch one by one.",
            embeddings.Count, texts.Count);
        var vectors = new List<float[]>(texts.Count);
        foreach (var text in texts)
        {
            var single = await WithRetryAsync(() => _client.Models.EmbedContentAsync(_model, text, _config));
            vectors.Add(ToVector(single.Embeddings?.FirstOrDefault()));
        }
        return vectors;
    }

    private float[] ToVector(ContentEmbedding? embedding)
    {
        var values = embedding?.Values ?? throw new InvalidOperationException("Embedding call returned no vector.");
        if (values.Count != _dims)
            throw new InvalidOperationException($"Embedding has {values.Count} dimensions, expected {_dims}.");
        return values.Select(v => (float)v).ToArray();
    }

    // Retries rate limits (429), server errors (5xx) and network failures with exponential backoff.
    private async Task<T> WithRetryAsync<T>(Func<Task<T>> call)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await call();
            }
            catch (Exception ex) when (attempt < MaxAttempts && IsTransient(ex))
            {
                var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt)) + TimeSpan.FromMilliseconds(Random.Shared.Next(0, 1000));
                _log.LogWarning("Gemini embedding call failed ({Reason}); retry {Attempt}/{Max} in {Seconds:F0}s.",
                    ex is ApiException api ? $"HTTP {api.StatusCode}" : ex.GetType().Name,
                    attempt, MaxAttempts - 1, delay.TotalSeconds);
                await Task.Delay(delay);
            }
        }
    }

    private static bool IsTransient(Exception ex) => ex switch
    {
        ApiException api => api.StatusCode == 429 || api.StatusCode >= 500,
        HttpRequestException => true,
        TaskCanceledException => true,   // HttpClient timeout
        _ => false,
    };
}

using Qdrant.Client;
using Qdrant.Client.Grpc;

namespace RotaryApi.Services.Assistant;

// One semantic match: cosine score and the point's payload (ints come back as long, strings as string).
public sealed class VectorHit
{
    public float Score { get; init; }
    public IReadOnlyDictionary<string, object?> Payload { get; init; } = new Dictionary<string, object?>();

    public int? Int(string key) => Payload.TryGetValue(key, out var v) ? v switch
    {
        long l when l is >= int.MinValue and <= int.MaxValue => (int)l,
        double d when d % 1 == 0 && d is >= int.MinValue and <= int.MaxValue => (int)d,
        string s when int.TryParse(s, out var i) => i,
        _ => null,
    } : null;

    public string? Str(string key) => Payload.TryGetValue(key, out var v) ? v?.ToString() : null;
}

// Payload filter for one search, without exposing Qdrant types to the tools.
//   Where / WhereAny  - every one must match.
//   Reach*            - the caller's visibility: the point must match AT LEAST ONE. Calling any
//                       Reach method marks the filter restricted, so a member whose reach turns out
//                       to be empty gets no hits instead of an unfiltered search.
public sealed class VectorFilter
{
    private readonly List<Condition> _must = new();
    private readonly List<Condition> _reach = new();
    private bool _restricted;

    public VectorFilter Where(string field, long value) { _must.Add(Conditions.Match(field, value)); return this; }
    public VectorFilter Where(string field, string value) { _must.Add(Conditions.MatchKeyword(field, value)); return this; }

    public VectorFilter WhereAny(string field, IEnumerable<string> values)
    {
        _must.Add(Conditions.Match(field, values.Distinct().ToList()));
        return this;
    }

    public VectorFilter ReachAny(string field, IEnumerable<int> ids)
    {
        _restricted = true;
        var list = ids.Distinct().Select(i => (long)i).ToList();
        if (list.Count > 0) _reach.Add(Conditions.Match(field, list));
        return this;
    }

    public VectorFilter ReachIs(string field, string value)
    {
        _restricted = true;
        _reach.Add(Conditions.MatchKeyword(field, value));
        return this;
    }

    internal bool MatchesNothing => _restricted && _reach.Count == 0;

    internal Filter? Build()
    {
        if (_must.Count == 0 && _reach.Count == 0) return null;
        var filter = new Filter();
        filter.Must.AddRange(_must);
        if (_reach.Count > 0)
        {
            var any = new Filter();
            any.Should.AddRange(_reach);
            filter.Must.Add(Conditions.Filter(any));
        }
        return filter;
    }
}

// Semantic search over the assistant's Qdrant collections (rotary_projects, rotary_comms), which
// AssistantIndexWorker fills. Read-only. Returns null - never throws - when Gemini or Qdrant is not
// configured or not reachable, so every caller can fall back to SQL. Hits are candidates only:
// callers must re-check each one in SQL and with ScopeGuard before showing it.
public sealed class VectorSearch : IDisposable
{
    private readonly AssistantSettings _settings;
    private readonly GeminiChat _gemini;
    private readonly ILogger<VectorSearch>? _logger;
    private readonly QdrantClient? _client;
    private long _downUntilTicks;   // after a Qdrant failure, skip it briefly instead of failing every tool call

    private static readonly TimeSpan Backoff = TimeSpan.FromSeconds(30);

    public VectorSearch(AssistantSettings settings, GeminiChat gemini, ILogger<VectorSearch>? logger = null)
    {
        _settings = settings;
        _gemini = gemini;
        _logger = logger;
        // A missing or malformed URL leaves search off (every call returns null) instead of failing DI.
        if (Uri.TryCreate(settings.QdrantUrl, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
        {
            try
            {
                _client = new QdrantClient(uri,
                    apiKey: string.IsNullOrWhiteSpace(settings.QdrantApiKey) ? null : settings.QdrantApiKey,
                    grpcTimeout: TimeSpan.FromSeconds(5));
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Assistant vector search disabled: bad Qdrant URL {Url}", settings.QdrantUrl);
            }
        }
    }

    public bool IsConfigured => _client != null && _settings.FlashConfigured;

    public async Task<List<VectorHit>?> SearchAsync(string collection, string query, VectorFilter filter, int limit,
        CancellationToken ct)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(query)) return null;
        if (filter.MatchesNothing) return new List<VectorHit>();
        if (DateTime.UtcNow.Ticks < Interlocked.Read(ref _downUntilTicks)) return null;

        float[] vector;
        try
        {
            vector = await _gemini.EmbedQueryAsync(query, ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            _logger?.LogWarning(ex, "Assistant vector search: query embedding failed, falling back to SQL");
            return null;
        }
        if (vector.Length != _settings.EmbeddingDims)
        {
            _logger?.LogWarning("Assistant vector search: embedding has {Got} dims, expected {Want}", vector.Length, _settings.EmbeddingDims);
            return null;
        }

        try
        {
            var points = await _client!.QueryAsync(collection, query: vector, filter: filter.Build(),
                limit: (ulong)Math.Clamp(limit, 1, 200), payloadSelector: true, cancellationToken: ct);
            return points.Select(p => new VectorHit { Score = p.Score, Payload = ToDictionary(p.Payload) }).ToList();
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            Interlocked.Exchange(ref _downUntilTicks, DateTime.UtcNow.Add(Backoff).Ticks);
            _logger?.LogWarning(ex, "Assistant vector search: Qdrant query on {Collection} failed, falling back to SQL", collection);
            return null;
        }
    }

    private static Dictionary<string, object?> ToDictionary(IDictionary<string, Value> payload)
    {
        var dict = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in payload)
        {
            dict[key] = value.KindCase switch
            {
                Value.KindOneofCase.IntegerValue => value.IntegerValue,
                Value.KindOneofCase.DoubleValue => value.DoubleValue,
                Value.KindOneofCase.StringValue => value.StringValue,
                Value.KindOneofCase.BoolValue => value.BoolValue,
                _ => null,
            };
        }
        return dict;
    }

    public void Dispose() => _client?.Dispose();
}

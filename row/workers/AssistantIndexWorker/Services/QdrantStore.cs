using Microsoft.Extensions.Logging;
using Qdrant.Client;
using Qdrant.Client.Grpc;

namespace AssistantIndexWorker.Services;

// Thin wrapper over the Qdrant gRPC client. Collection layout is the contract the API reads:
// one unnamed vector (size = EmbeddingDims, Cosine) + payload indexes on the filter fields.
public sealed class QdrantStore : IDisposable
{
    public const string ProjectsCollection = "rotary_projects";
    public const string CommsCollection = "rotary_comms";

    private static readonly string[] IntegerIndexes = { "club_id", "district_id", "zone_id", "year_id" };
    private static readonly string[] KeywordIndexes = { "type", "scope" };

    private readonly QdrantClient _client;
    private readonly int _dims;
    private readonly ILogger<QdrantStore> _log;

    public QdrantStore(string url, string? apiKey, int dims, ILogger<QdrantStore> log)
    {
        _client = new QdrantClient(new Uri(url), apiKey: string.IsNullOrWhiteSpace(apiKey) ? null : apiKey,
            grpcTimeout: TimeSpan.FromMinutes(2));
        _dims = dims;
        _log = log;
    }

    // Creates the collection and any missing payload index. Returns true when the collection was
    // just created (it is empty, so everything has to be embedded again).
    public async Task<bool> EnsureCollectionAsync(string name)
    {
        var created = false;
        if (!await _client.CollectionExistsAsync(name))
        {
            await _client.CreateCollectionAsync(name, new VectorParams { Size = (ulong)_dims, Distance = Distance.Cosine });
            _log.LogInformation("Created Qdrant collection {Name} ({Dims} dims, Cosine).", name, _dims);
            created = true;
        }

        var info = await _client.GetCollectionInfoAsync(name);
        var vectors = info.Config?.Params?.VectorsConfig?.Params;
        if (vectors == null || vectors.Size != (ulong)_dims || vectors.Distance != Distance.Cosine)
            throw new InvalidOperationException(
                $"Qdrant collection '{name}' is not a single {_dims}-dim Cosine vector (found: " +
                $"{(vectors == null ? "named/no vectors" : $"{vectors.Size} dims, {vectors.Distance}")}). " +
                "Fix Assistant:Gemini:EmbeddingDims or delete the collection and run --full.");

        foreach (var field in IntegerIndexes.Where(f => !info.PayloadSchema.ContainsKey(f)))
            await _client.CreatePayloadIndexAsync(name, field, PayloadSchemaType.Integer);
        foreach (var field in KeywordIndexes.Where(f => !info.PayloadSchema.ContainsKey(f)))
            await _client.CreatePayloadIndexAsync(name, field, PayloadSchemaType.Keyword);

        return created;
    }

    public async Task UpsertAsync(string collection, IReadOnlyList<IndexItem> items, IReadOnlyList<float[]> vectors)
    {
        var points = new List<PointStruct>(items.Count);
        for (var i = 0; i < items.Count; i++)
        {
            var point = new PointStruct { Id = items[i].PointId, Vectors = vectors[i] };
            foreach (var (key, value) in items[i].Payload)
                point.Payload[key] = value switch
                {
                    int n => (long)n,
                    string s => s,
                    _ => throw new InvalidOperationException($"Unsupported payload type for {key}: {value.GetType().Name}"),
                };
            point.Payload["content_hash"] = items[i].ContentHash;
            points.Add(point);
        }
        await _client.UpsertAsync(collection, points, wait: true);
    }

    public async Task DeleteAsync(string collection, IReadOnlyList<Guid> ids)
    {
        foreach (var chunk in ids.Chunk(500))
            await _client.DeleteAsync(collection, chunk, wait: true);
    }

    // Every UUID point id in the collection (no payloads or vectors fetched).
    public async Task<HashSet<Guid>> GetAllPointIdsAsync(string collection)
    {
        var ids = new HashSet<Guid>();
        PointId? offset = null;
        do
        {
            var page = await _client.ScrollAsync(collection, filter: null, limit: 1000, offset: offset,
                payloadSelector: false, vectorsSelector: false);
            foreach (var p in page.Result)
                if (p.Id.HasUuid && Guid.TryParse(p.Id.Uuid, out var id)) ids.Add(id);
            offset = page.NextPageOffset;
        } while (offset != null);
        return ids;
    }

    public void Dispose() => _client.Dispose();
}

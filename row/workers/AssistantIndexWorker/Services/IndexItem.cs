using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace AssistantIndexWorker.Services;

// One document for the vector index: the exact text that gets embedded, its Qdrant payload, and the
// hash a --delta run compares with assistant_index_items to decide whether to re-embed it.
public sealed class IndexItem
{
    public const int MaxBodyChars = 6000;

    public string Source { get; }       // assistant_index_items.source: "project" | "comms"
    public string ItemKey { get; }      // assistant_index_items.item_key: "2025_26:1234" | "announcement:55"
    public Guid PointId { get; }        // MD5 of "project:2025-26:1234" | "comms:announcement:55"
    public string Text { get; }         // "title: {title} | text: {body}" — must match the API's query side
    public SortedDictionary<string, object> Payload { get; }   // int or string values; content_hash is added on upsert
    public string ContentHash { get; }

    public IndexItem(string source, string itemKey, string pointKey, string? title, string? body,
        SortedDictionary<string, object> payload, string embeddingModel, int embeddingDims)
    {
        Source = source;
        ItemKey = itemKey;
        PointId = PointIdFor(pointKey);

        var cleanTitle = (title ?? "").Trim();
        var cleanBody = (body ?? "").Trim();
        if (cleanBody.Length > MaxBodyChars) cleanBody = cleanBody[..MaxBodyChars];
        Text = $"title: {(cleanTitle.Length == 0 ? "none" : cleanTitle)} | text: {cleanBody}";

        payload["title"] = cleanTitle;
        Payload = payload;

        // Model + size are part of the hash so a model change re-embeds everything on the next delta
        // instead of leaving a mixed-model index.
        var sb = new StringBuilder();
        sb.Append(embeddingModel).Append('|').Append(embeddingDims).Append('\n').Append(Text);
        foreach (var (key, value) in payload)
            sb.Append('\n').Append(key).Append('=').Append(Convert.ToString(value, CultureInfo.InvariantCulture));
        ContentHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())));
    }

    // Deterministic point id: the 16 MD5 bytes of the key string fed straight into new Guid(byte[]).
    public static Guid PointIdFor(string pointKey) => new(MD5.HashData(Encoding.UTF8.GetBytes(pointKey)));
}

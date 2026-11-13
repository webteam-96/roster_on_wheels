using System.Diagnostics;
using Dapper;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace AssistantIndexWorker.Services;

// --full / --delta for both sources.
//
// State lives in assistant_index_items (source, item_key, point_id, content_hash):
//   new or changed hash  → embed + upsert the point, then upsert its state row (per batch of 100,
//                          so an interrupted run keeps what it finished and the next run resumes)
//   state row whose source row is gone/hidden → delete the point, then the state row
//   --full                → re-embed everything, and also delete any Qdrant point no source row backs
//   collection missing    → created, and that source is re-embedded in full even on --delta
public sealed class Indexer
{
    private readonly string _connString;
    private readonly SourceReader _reader;
    private readonly Func<GeminiEmbedder> _embedder;   // resolved lazily: a dry run never builds a client
    private readonly Func<QdrantStore> _qdrant;
    private readonly ILogger<Indexer> _log;

    public Indexer(string connString, SourceReader reader, Func<GeminiEmbedder> embedder, Func<QdrantStore> qdrant,
        ILogger<Indexer> log)
    {
        _connString = connString;
        _reader = reader;
        _embedder = embedder;
        _qdrant = qdrant;
        _log = log;
    }

    private sealed class StateRow
    {
        public string ItemKey { get; set; } = "";
        public string PointId { get; set; } = "";
        public string ContentHash { get; set; } = "";
    }

    public async Task RunAsync(bool full, bool dryRun)
    {
        await RunSourceAsync("project", QdrantStore.ProjectsCollection, _reader.ReadProjectsAsync, full, dryRun);
        await RunSourceAsync("comms", QdrantStore.CommsCollection, _reader.ReadCommsAsync, full, dryRun);
    }

    private async Task RunSourceAsync(string source, string collection, Func<Task<List<IndexItem>>> read,
        bool full, bool dryRun)
    {
        var sw = Stopwatch.StartNew();
        _log.LogInformation("[{Source}] Reading source rows...", source);
        var current = await read();
        var state = await LoadStateAsync(source);

        var collectionCreated = !dryRun && await _qdrant().EnsureCollectionAsync(collection);
        if (collectionCreated && !full)
            _log.LogWarning("[{Source}] Collection {Collection} was missing — re-embedding every row.", source, collection);
        var embedAll = full || collectionCreated;

        var isNew = 0;
        var changed = 0;
        var toEmbed = new List<IndexItem>();
        foreach (var item in current)
        {
            if (!state.TryGetValue(item.ItemKey, out var s)) isNew++;
            else if (s.ContentHash != item.ContentHash || s.PointId != item.PointId.ToString()) changed++;
            else if (!embedAll) continue;
            toEmbed.Add(item);
        }
        var currentKeys = current.Select(i => i.ItemKey).ToHashSet(StringComparer.Ordinal);
        var removed = state.Values.Where(s => !currentKeys.Contains(s.ItemKey)).ToList();

        _log.LogInformation(
            "[{Source}] {Total} rows: {New} new, {Changed} changed, {Unchanged} unchanged{All} → {Embed} to embed, {Removed} to delete.",
            source, current.Count, isNew, changed, current.Count - isNew - changed,
            embedAll ? " (full re-embed)" : "", toEmbed.Count, removed.Count);

        if (dryRun)
        {
            _log.LogInformation("[{Source}] Dry run — nothing embedded, written or deleted.", source);
            return;
        }

        // 1. Embed + upsert in batches; record state after each batch lands in Qdrant.
        var embedder = _embedder();
        var qdrant = _qdrant();
        var done = 0;
        foreach (var batch in toEmbed.Chunk(GeminiEmbedder.BatchSize))
        {
            var vectors = await embedder.EmbedAsync(batch.Select(i => i.Text).ToList());
            await qdrant.UpsertAsync(collection, batch, vectors);
            await SaveStateAsync(batch);
            done += batch.Length;
            if (done % 1000 < GeminiEmbedder.BatchSize || done == toEmbed.Count)
                _log.LogInformation("[{Source}] Embedded {Done}/{Total}", source, done, toEmbed.Count);
        }

        // 2. Rows that are gone: delete their points, then their state rows.
        if (removed.Count > 0)
        {
            await qdrant.DeleteAsync(collection, removed.Select(r => Guid.Parse(r.PointId)).ToList());
            await DeleteStateAsync(source, removed.Select(r => r.ItemKey).ToList());
            _log.LogInformation("[{Source}] Deleted {Count} points for removed rows.", source, removed.Count);
        }

        // 3. --full only: anything left in Qdrant that no source row backs (e.g. after the state table was reset).
        if (full)
        {
            var wanted = current.Select(i => i.PointId).ToHashSet();
            var orphans = (await qdrant.GetAllPointIdsAsync(collection)).Where(id => !wanted.Contains(id)).ToList();
            if (orphans.Count > 0)
            {
                await qdrant.DeleteAsync(collection, orphans);
                _log.LogInformation("[{Source}] Deleted {Count} orphan points not backed by any row.", source, orphans.Count);
            }
        }

        _log.LogInformation("[{Source}] Done in {Min}m {Sec}s.", source, (int)sw.Elapsed.TotalMinutes, sw.Elapsed.Seconds);
    }

    // ── assistant_index_items ───────────────────────────────────────────────

    private async Task<Dictionary<string, StateRow>> LoadStateAsync(string source)
    {
        await using var conn = new MySqlConnection(_connString);
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<StateRow>(@"
            SELECT item_key AS ItemKey, point_id AS PointId, content_hash AS ContentHash
            FROM assistant_index_items WHERE source = @source", new { source }, commandTimeout: 300);
        return rows.ToDictionary(r => r.ItemKey, StringComparer.Ordinal);
    }

    private async Task SaveStateAsync(IReadOnlyList<IndexItem> items)
    {
        await using var conn = new MySqlConnection(_connString);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await conn.ExecuteAsync(@"
            INSERT INTO assistant_index_items (source, item_key, point_id, content_hash, indexed_date)
            VALUES (@Source, @ItemKey, @PointId, @ContentHash, NOW())
            ON DUPLICATE KEY UPDATE point_id = VALUES(point_id), content_hash = VALUES(content_hash),
                                    indexed_date = VALUES(indexed_date)",
            items.Select(i => new { i.Source, i.ItemKey, PointId = i.PointId.ToString(), i.ContentHash }), tx);
        await tx.CommitAsync();
    }

    private async Task DeleteStateAsync(string source, IReadOnlyList<string> itemKeys)
    {
        await using var conn = new MySqlConnection(_connString);
        await conn.OpenAsync();
        foreach (var chunk in itemKeys.Chunk(500))
            await conn.ExecuteAsync("DELETE FROM assistant_index_items WHERE source = @source AND item_key IN @keys",
                new { source, keys = chunk });
    }
}

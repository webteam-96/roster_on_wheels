using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;

namespace RotaryApi.Services.Assistant;

// text/event-stream over the response. Every write is flushed at once (IIS / Kestrel buffering is
// switched off for the response) and serialised, because the heartbeat writes from another thread.
public sealed class SseWriter : IAsyncDisposable
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly HttpResponse _response;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly CancellationTokenSource _heartbeatStop = new();
    private Task? _heartbeat;

    public SseWriter(HttpResponse response) => _response = response;

    public async Task StartAsync(CancellationToken ct)
    {
        _response.StatusCode = StatusCodes.Status200OK;
        _response.ContentType = "text/event-stream; charset=utf-8";
        _response.Headers.CacheControl = "no-cache, no-transform";
        _response.Headers["X-Accel-Buffering"] = "no";
        _response.HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        await WriteRawAsync(": ok\n\n", ct);

        // IIS drops a connection that stays silent for 120s; Sonnet can think quietly for a while.
        _heartbeat = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
            try
            {
                while (await timer.WaitForNextTickAsync(_heartbeatStop.Token))
                    await WriteRawAsync(": ping\n\n", _heartbeatStop.Token);
            }
            // Stopped, or the client went away - either way the main request handles the outcome.
            catch (Exception) { }
        });
    }

    public Task EventAsync(string name, object data, CancellationToken ct = default) =>
        WriteRawAsync($"event: {name}\ndata: {JsonSerializer.Serialize(data, Json)}\n\n", ct);

    private async Task WriteRawAsync(string frame, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            await _response.Body.WriteAsync(Encoding.UTF8.GetBytes(frame), ct);
            await _response.Body.FlushAsync(ct);
        }
        finally { _gate.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        _heartbeatStop.Cancel();
        if (_heartbeat != null) await _heartbeat;
        _heartbeatStop.Dispose();
        _gate.Dispose();
    }
}

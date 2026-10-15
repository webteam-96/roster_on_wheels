namespace RotaryApi.Services.Push;

public interface IFirebasePushService
{
    /// <summary>
    /// Sends the same notification payload to many tokens. Returns per-token results
    /// (token → success/failure + Firebase message id or error). Handles batching
    /// internally (Firebase caps at 500 tokens per multicast call).
    /// </summary>
    Task<List<PushSendResult>> SendMulticastAsync(
        IEnumerable<string> tokens,
        string title,
        string body,
        IDictionary<string, string>? data,
        CancellationToken ct = default);

    /// <summary>True if Firebase Admin SDK initialized successfully at startup.</summary>
    bool IsAvailable { get; }
}

public class PushSendResult
{
    public string Token { get; set; } = "";
    public bool Success { get; set; }
    public string? FirebaseMessageId { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    /// <summary>True when Firebase says the token is invalid/unregistered (we should disable it).</summary>
    public bool IsTokenInvalid { get; set; }
}

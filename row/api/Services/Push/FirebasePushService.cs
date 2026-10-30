using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;

namespace RotaryApi.Services.Push;

/// <summary>
/// Wraps Firebase Admin SDK for push notifications. Initialized once at app startup.
/// Reads service-account JSON from a path configured via Firebase:ServiceAccountPath
/// (relative to ContentRoot) or Firebase:ServiceAccountAbsolutePath (absolute, takes precedence).
/// If neither is set or file missing, the service stays in "unavailable" state and no-ops.
/// </summary>
public class FirebasePushService : IFirebasePushService
{
    private readonly ILogger<FirebasePushService> _logger;
    private readonly FirebaseMessaging? _messaging;

    public bool IsAvailable => _messaging != null;

    public FirebasePushService(IConfiguration config, IWebHostEnvironment env, ILogger<FirebasePushService> logger)
    {
        _logger = logger;
        try
        {
            var absolutePath = config["Firebase:ServiceAccountAbsolutePath"];
            var relativePath = config["Firebase:ServiceAccountPath"] ?? "App_Data/firebase-admin.json";
            var path = !string.IsNullOrWhiteSpace(absolutePath)
                ? absolutePath
                : Path.Combine(env.ContentRootPath, relativePath);

            if (!File.Exists(path))
            {
                _logger.LogWarning("Firebase service account file not found at {Path}. Push notifications DISABLED.", path);
                return;
            }

            // Reuse default app if already initialized (e.g. in tests / re-runs)
            var app = FirebaseApp.DefaultInstance ?? FirebaseApp.Create(new AppOptions
            {
                Credential = GoogleCredential.FromFile(path),
            });
            _messaging = FirebaseMessaging.GetMessaging(app);
            _logger.LogInformation("Firebase Admin SDK initialized from {Path}", path);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize Firebase Admin SDK. Push notifications DISABLED.");
        }
    }

    public async Task<List<PushSendResult>> SendMulticastAsync(
        IEnumerable<string> tokens,
        string title,
        string body,
        IDictionary<string, string>? data,
        CancellationToken ct = default)
    {
        var results = new List<PushSendResult>();
        if (_messaging == null)
        {
            _logger.LogWarning("Firebase not initialized — skipping push send");
            return results;
        }

        var allTokens = tokens.Where(t => !string.IsNullOrWhiteSpace(t)).Distinct().ToList();
        if (allTokens.Count == 0) return results;

        const int FirebaseMulticastLimit = 500;
        for (int i = 0; i < allTokens.Count; i += FirebaseMulticastLimit)
        {
            ct.ThrowIfCancellationRequested();
            var batch = allTokens.Skip(i).Take(FirebaseMulticastLimit).ToList();
            var msg = new MulticastMessage
            {
                Tokens = batch,
                Notification = new Notification { Title = title, Body = body },
                Data = data != null ? new Dictionary<string, string>(data) : new Dictionary<string, string>(),
                Android = new AndroidConfig
                {
                    Priority = Priority.High,
                    // EventTimestamp: FirebaseAdmin always sends event_time and defaults it to year 1, so Android showed
                    // the push as thousands of years old ("2032y"); stamp the send time.
                    Notification = new AndroidNotification { ChannelId = "high_importance_channel_sound", Sound = "notification", EventTimestamp = DateTime.UtcNow },
                },
                Apns = new ApnsConfig
                {
                    Aps = new Aps { Sound = "notification.caf", ContentAvailable = true },
                },
            };

            try
            {
                var resp = await _messaging.SendEachForMulticastAsync(msg, ct);
                for (int j = 0; j < resp.Responses.Count; j++)
                {
                    var r = resp.Responses[j];
                    var tok = batch[j];
                    if (r.IsSuccess)
                    {
                        results.Add(new PushSendResult
                        {
                            Token = tok,
                            Success = true,
                            FirebaseMessageId = r.MessageId,
                        });
                    }
                    else
                    {
                        var code = r.Exception?.MessagingErrorCode?.ToString();
                        var invalid = code == "Unregistered" || code == "InvalidArgument" || code == "SenderIdMismatch";
                        results.Add(new PushSendResult
                        {
                            Token = tok,
                            Success = false,
                            ErrorCode = code,
                            ErrorMessage = r.Exception?.Message,
                            IsTokenInvalid = invalid,
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Firebase multicast batch failed (batch starting at {Index})", i);
                foreach (var tok in batch)
                {
                    results.Add(new PushSendResult
                    {
                        Token = tok,
                        Success = false,
                        ErrorCode = "BatchException",
                        ErrorMessage = ex.Message,
                    });
                }
            }
        }
        return results;
    }
}

using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GreetingsWorker.Services;

// Slim Firebase push sender for the greetings worker — mirrors RotaryApi's FirebasePushService.
// Reads the service-account JSON from Firebase:ServiceAccountAbsolutePath (absolute, preferred) or
// Firebase:ServiceAccountPath (relative to the exe dir; default "firebase-admin.json"). If the file
// is missing, the sender stays "unavailable" and every send is a no-op — greetings still go out by
// email. Push is free, so there is no credit interaction here.
public class FirebasePushSender
{
    private readonly ILogger<FirebasePushSender> _log;
    private readonly FirebaseMessaging? _messaging;

    public bool IsAvailable => _messaging != null;

    public FirebasePushSender(IConfiguration config, ILogger<FirebasePushSender> log)
    {
        _log = log;
        try
        {
            var abs = config["Firebase:ServiceAccountAbsolutePath"];
            var rel = config["Firebase:ServiceAccountPath"] ?? "firebase-admin.json";
            // Try, in order: explicit absolute path (only if it exists) → file next to the
            // exe → file in the current working directory. This survives a stale abs path and
            // makes a missing file obvious in the log (the #1 cause of greeting push silently
            // failing on the deploy host).
            var candidates = new[]
            {
                string.IsNullOrWhiteSpace(abs) ? null : abs,
                Path.Combine(AppContext.BaseDirectory, rel),
                Path.Combine(Directory.GetCurrentDirectory(), rel),
            }.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!).Distinct().ToArray();
            var path = candidates.FirstOrDefault(File.Exists);
            if (path == null)
            {
                _log.LogWarning("Firebase service account not found — greeting push DISABLED. Looked in: {Paths}",
                    string.Join(" | ", candidates));
                return;
            }
            var app = FirebaseApp.DefaultInstance ?? FirebaseApp.Create(new AppOptions
            {
                Credential = GoogleCredential.FromFile(path),
            });
            _messaging = FirebaseMessaging.GetMessaging(app);
            _log.LogInformation("Firebase Admin SDK initialized from {Path}", path);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to initialize Firebase Admin SDK. Greeting push DISABLED.");
        }
    }

    // Send to one device token. Returns true on success. Never throws.
    public async Task<bool> SendToTokenAsync(string token, string title, string body, IDictionary<string, string>? data, CancellationToken ct = default)
    {
        if (_messaging == null || string.IsNullOrWhiteSpace(token)) return false;
        try
        {
            var msg = new Message
            {
                Token = token,
                Notification = new Notification { Title = title, Body = body },
                Data = data != null ? new Dictionary<string, string>(data) : new Dictionary<string, string>(),
                Android = new AndroidConfig { Priority = Priority.High, Notification = new AndroidNotification { ChannelId = "high_importance_channel_sound", Sound = "notification" } },
                Apns = new ApnsConfig { Aps = new Aps { Sound = "notification.caf", ContentAvailable = true } },
            };
            await _messaging.SendAsync(msg, ct);
            return true;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Greeting push failed to token");
            return false;
        }
    }

    // Broadcast the same notification to many tokens (batched at Firebase's 500-per-call limit).
    // Returns (sent, failed) device counts. Never throws.
    public async Task<(int sent, int failed)> SendMulticastAsync(IReadOnlyList<string> tokens, string title, string body, IDictionary<string, string>? data, CancellationToken ct = default)
    {
        if (_messaging == null) return (0, 0);
        var distinct = tokens.Where(t => !string.IsNullOrWhiteSpace(t)).Distinct().ToList();
        if (distinct.Count == 0) return (0, 0);

        int sent = 0, failed = 0;
        const int limit = 500;
        for (int i = 0; i < distinct.Count; i += limit)
        {
            var batch = distinct.Skip(i).Take(limit).ToList();
            var msg = new MulticastMessage
            {
                Tokens = batch,
                Notification = new Notification { Title = title, Body = body },
                Data = data != null ? new Dictionary<string, string>(data) : new Dictionary<string, string>(),
                Android = new AndroidConfig { Priority = Priority.High, Notification = new AndroidNotification { ChannelId = "high_importance_channel_sound", Sound = "notification" } },
                Apns = new ApnsConfig { Aps = new Aps { Sound = "notification.caf", ContentAvailable = true } },
            };
            try
            {
                var resp = await _messaging.SendEachForMulticastAsync(msg, ct);
                sent += resp.SuccessCount;
                failed += resp.FailureCount;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Digest multicast batch failed");
                failed += batch.Count;
            }
        }
        return (sent, failed);
    }
}

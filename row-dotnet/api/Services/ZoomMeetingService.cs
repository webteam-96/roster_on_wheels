using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace RotaryApi.Services;

// Zoom Server-to-Server OAuth. Registered as a singleton so the access token (valid ~1h) is
// cached and shared across requests. All times are sent in the configured IANA timezone
// (Asia/Kolkata) with a naive start_time, so Zoom interprets them as local wall-clock.
public class ZoomMeetingService : IZoomMeetingService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<ZoomMeetingService> _logger;

    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private string? _token;
    private DateTime _tokenExpiryUtc = DateTime.MinValue;

    public ZoomMeetingService(IHttpClientFactory httpFactory, IConfiguration config, ILogger<ZoomMeetingService> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    private string BaseUrl => (_config["Zoom:BaseUrl"] ?? "https://api.zoom.us/v2").TrimEnd('/');
    private string OAuthUrl => _config["Zoom:OAuthUrl"] ?? "https://zoom.us/oauth/token";
    private string HostUserId => _config["Zoom:HostUserId"] ?? "me";
    private string Timezone => _config["Zoom:Timezone"] ?? "Asia/Kolkata";

    private static bool Present(string? v) =>
        !string.IsNullOrWhiteSpace(v) && !v.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase);

    public bool IsConfigured =>
        Present(_config["Zoom:AccountId"]) && Present(_config["Zoom:ClientId"]) && Present(_config["Zoom:ClientSecret"]);

    private async Task<string?> GetTokenAsync()
    {
        if (!IsConfigured) return null;
        if (_token != null && DateTime.UtcNow < _tokenExpiryUtc) return _token;

        await _tokenLock.WaitAsync();
        try
        {
            if (_token != null && DateTime.UtcNow < _tokenExpiryUtc) return _token;

            var accountId = _config["Zoom:AccountId"]!;
            var clientId = _config["Zoom:ClientId"]!;
            var secret = _config["Zoom:ClientSecret"]!;

            var http = _httpFactory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Post,
                $"{OAuthUrl}?grant_type=account_credentials&account_id={Uri.EscapeDataString(accountId)}");
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{clientId}:{secret}"));
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);

            var res = await http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                _logger.LogError("Zoom token request failed: {Status} {Body}", res.StatusCode, body);
                return null;
            }
            using var doc = JsonDocument.Parse(body);
            _token = doc.RootElement.GetProperty("access_token").GetString();
            var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 3600;
            _tokenExpiryUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, expiresIn - 300)); // refresh 5 min early
            return _token;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Zoom token request threw.");
            return null;
        }
        finally { _tokenLock.Release(); }
    }

    public async Task<ZoomMeetingResult?> CreateMeetingAsync(string topic, DateTime startIst, int durationMinutes)
    {
        var token = await GetTokenAsync();
        if (token == null) return null;

        var payload = new
        {
            topic,
            type = 2, // scheduled meeting
            start_time = startIst.ToString("yyyy-MM-ddTHH:mm:ss"),
            timezone = Timezone,
            duration = durationMinutes,
            settings = new { join_before_host = true, waiting_room = false, host_video = true, participant_video = true }
        };

        try
        {
            var http = _httpFactory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/users/{HostUserId}/meetings")
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var res = await http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                _logger.LogError("Zoom create-meeting failed: {Status} {Body}", res.StatusCode, body);
                return null;
            }
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            string? id = root.TryGetProperty("id", out var idEl)
                ? (idEl.ValueKind == JsonValueKind.Number ? idEl.GetInt64().ToString() : idEl.GetString())
                : null;
            string? join = root.TryGetProperty("join_url", out var j) ? j.GetString() : null;
            string? start = root.TryGetProperty("start_url", out var s) ? s.GetString() : null;
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(join)) return null;
            return new ZoomMeetingResult(id!, join!, start ?? "");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Zoom create-meeting threw.");
            return null;
        }
    }

    public async Task<bool> UpdateMeetingTimeAsync(string meetingId, DateTime startIst, int durationMinutes)
    {
        var token = await GetTokenAsync();
        if (token == null || string.IsNullOrWhiteSpace(meetingId)) return false;

        var payload = new
        {
            start_time = startIst.ToString("yyyy-MM-ddTHH:mm:ss"),
            timezone = Timezone,
            duration = durationMinutes
        };
        try
        {
            var http = _httpFactory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Patch, $"{BaseUrl}/meetings/{meetingId}")
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var res = await http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync();
                _logger.LogError("Zoom update-meeting failed: {Status} {Body}", res.StatusCode, body);
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Zoom update-meeting threw.");
            return false;
        }
    }
}

using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace RotaryOrgSyncWorker.Services;

public class RotaryOrgApiClient : IRotaryOrgApiClient
{
    private static readonly TimeSpan TokenTtl = TimeSpan.FromMinutes(55);

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<RotaryOrgApiClient> _logger;
    private readonly SemaphoreSlim _authLock = new(1, 1);
    private CachedRotaryOrgToken? _cached;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new FlexibleDateTimeConverter() },
    };

    public RotaryOrgApiClient(HttpClient http, IConfiguration config, ILogger<RotaryOrgApiClient> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(120);
        _http.DefaultRequestHeaders.Accept.Clear();
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        _http.DefaultRequestHeaders.UserAgent.Clear();
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("ROW-Sync-Worker", "1.0"));
        var baseUrl = (config["RotaryOrgApi:BaseUrl"] ?? "https://api.rotary.org:8443/v1.1").TrimEnd('/') + "/";
        _http.BaseAddress = new Uri(baseUrl);
    }

    public async Task<string> GetTokenAsync(CancellationToken ct = default)
    {
        if (_cached != null && !_cached.IsExpired) return _cached.Token;

        await _authLock.WaitAsync(ct);
        try
        {
            if (_cached != null && !_cached.IsExpired) return _cached.Token;
            return await AuthenticateInternalAsync(ct);
        }
        finally { _authLock.Release(); }
    }

    public async Task<string> ReauthenticateAsync(CancellationToken ct = default)
    {
        await _authLock.WaitAsync(ct);
        try
        {
            _cached = null;
            return await AuthenticateInternalAsync(ct);
        }
        finally { _authLock.Release(); }
    }

    private async Task<string> AuthenticateInternalAsync(CancellationToken ct)
    {
        var username = _config["RotaryOrgApi:Username"] ?? "";
        var password = _config["RotaryOrgApi:Password"] ?? "";
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("RotaryOrgApi:Username / Password not configured in appsettings.json.");

        var payload = JsonSerializer.Serialize(new RotaryOrgAuthRequest { Username = username, Password = password });
        using var req = new HttpRequestMessage(HttpMethod.Post, "authentication")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };

        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await _http.SendAsync(req, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();

        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org authentication failed: {(int)resp.StatusCode} {resp.ReasonPhrase}. Body: {Truncate(body, 200)}");

        var token = TryExtractToken(body);
        if (string.IsNullOrWhiteSpace(token))
            throw new InvalidOperationException($"Rotary.org auth response could not be parsed. Body: {Truncate(body, 200)}");

        _cached = new CachedRotaryOrgToken { Token = token, ExpiresAtUtc = DateTime.UtcNow.Add(TokenTtl) };
        _logger.LogInformation("[RI.org] auth OK in {Ms}ms", sw.ElapsedMilliseconds);
        return token;
    }

    private static string? TryExtractToken(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        body = body.Trim();
        if (body.StartsWith("\"") && body.EndsWith("\""))
            return body.Substring(1, body.Length - 2);
        try
        {
            using var doc = JsonDocument.Parse(body);
            foreach (var key in new[] { "auth_token", "authToken", "AuthToken", "token", "Token", "access_token", "AccessToken" })
            {
                if (doc.RootElement.TryGetProperty(key, out var tok) && tok.ValueKind == JsonValueKind.String)
                    return tok.GetString();
            }
        }
        catch { }
        if (!body.StartsWith("{") && !body.StartsWith("[")) return body;
        return null;
    }

    private async Task<HttpResponseMessage> SendAuthenticatedAsync(string path, CancellationToken ct)
    {
        var token = await GetTokenAsync(ct);
        using var req1 = new HttpRequestMessage(HttpMethod.Get, path);
        req1.Headers.TryAddWithoutValidation("auth_token", token);
        var resp = await _http.SendAsync(req1, ct);
        if (resp.StatusCode != HttpStatusCode.Unauthorized) return resp;

        resp.Dispose();
        token = await ReauthenticateAsync(ct);
        using var req2 = new HttpRequestMessage(HttpMethod.Get, path);
        req2.Headers.TryAddWithoutValidation("auth_token", token);
        return await _http.SendAsync(req2, ct);
    }

    public async Task<List<RotaryOrgClubListDto>> GetClubsAsync(CancellationToken ct = default)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await SendAuthenticatedAsync("clubs", ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /clubs failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        var list = JsonSerializer.Deserialize<List<RotaryOrgClubListDto>>(body, JsonOpts) ?? new List<RotaryOrgClubListDto>();
        _logger.LogInformation("[RI.org] GET /clubs OK in {Ms}ms — {Count} clubs", sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    public async Task<RotaryOrgClubDetailDto?> GetClubDetailAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}?summary=false";
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (resp.StatusCode == HttpStatusCode.NotFound) return null;
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET club detail failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        return JsonSerializer.Deserialize<RotaryOrgClubDetailDto>(body, JsonOpts);
    }

    public async Task<List<RotaryOrgMemberUpdateNotificationDto>> GetMemberUpdateNotificationsAsync(DateTime startDate, DateTime endDate, CancellationToken ct = default)
    {
        var s = startDate.ToString("MM-dd-yyyy");
        var e = endDate.ToString("MM-dd-yyyy");
        var path = $"individuals/updates?startDate={s}&endDate={e}";
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /individuals/updates failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        var list = JsonSerializer.Deserialize<List<RotaryOrgMemberUpdateNotificationDto>>(body, JsonOpts) ?? new List<RotaryOrgMemberUpdateNotificationDto>();
        _logger.LogInformation("[RI.org] GET /individuals/updates ({Start} → {End}) OK in {Ms}ms — {Count} change notifications", s, e, sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    public async Task<RotaryOrgMemberDto?> GetMemberDetailAsync(long memberId, CancellationToken ct = default)
    {
        var path = $"individuals/{memberId}";
        using var resp = await SendAuthenticatedAsync(path, ct);
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound ||
            resp.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
            resp.StatusCode == System.Net.HttpStatusCode.Forbidden) return null;
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /individuals/{memberId} failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        return JsonSerializer.Deserialize<RotaryOrgMemberDto>(body, JsonOpts);
    }

    public async Task<List<RotaryOrgClubSearchDto>> SearchClubsByCountryAsync(string country, CancellationToken ct = default)
    {
        // Path: Clubs/search?searchterm=(type=country:value=<country>)&searchterm=(type=ClubType:value=Rotary Club)
        // Note: 'searchterm' parameter is repeated. Special chars in (type=country:value=Sri Lanka) need URL encoding.
        var countryParam = $"(type=country:value={country})";
        var typeParam = "(type=ClubType:value=Rotary Club)";
        var path = $"Clubs/search?searchterm={Uri.EscapeDataString(countryParam)}&searchterm={Uri.EscapeDataString(typeParam)}";

        // /Clubs/search for a large country (India ~4k clubs) is a heavy query and Rotary.org
        // intermittently answers 400 {"Message":"A timeout occurred retrieving data."} — that's
        // a timeout on THEIR side, not a real "no results". Retry with backoff rather than
        // failing the whole run (this call gates the sync->non-sync cascade).
        const int maxAttempts = 4;
        int[] backoffSeconds = { 10, 30, 60 };
        for (int attempt = 1; ; attempt++)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            using var resp = await SendAuthenticatedAsync(path, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            sw.Stop();

            if (resp.IsSuccessStatusCode)
            {
                var list = JsonSerializer.Deserialize<List<RotaryOrgClubSearchDto>>(body, JsonOpts) ?? new List<RotaryOrgClubSearchDto>();
                _logger.LogInformation("[RI.org] GET /Clubs/search country={Country} OK in {Ms}ms — {Count} clubs (attempt {Attempt})",
                    country, sw.ElapsedMilliseconds, list.Count, attempt);
                return list;
            }

            var transient = (int)resp.StatusCode >= 500
                            || resp.StatusCode == System.Net.HttpStatusCode.RequestTimeout
                            || (int)resp.StatusCode == 429
                            || body.Contains("timeout", StringComparison.OrdinalIgnoreCase);

            if (!transient || attempt >= maxAttempts)
                throw new HttpRequestException(
                    $"Rotary.org GET /Clubs/search ({country}) failed after {attempt} attempt(s): {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");

            var wait = backoffSeconds[Math.Min(attempt - 1, backoffSeconds.Length - 1)];
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] /Clubs/search ({country}) transient {(int)resp.StatusCode} from Rotary.org — retrying in {wait}s (attempt {attempt}/{maxAttempts})...");
            _logger.LogWarning("[RI.org] /Clubs/search {Country} transient {Code} attempt {Attempt}/{Max} — retry in {Wait}s. Body: {Body}",
                country, (int)resp.StatusCode, attempt, maxAttempts, wait, Truncate(body, 120));
            await Task.Delay(TimeSpan.FromSeconds(wait), ct);
        }
    }

    public async Task<List<RotaryOrgClubListDto>> GetClubUpdatesAsync(DateTime startDate, DateTime endDate, CancellationToken ct = default)
    {
        // Old sync app used MM-dd-yyyy format for the /individuals/updates endpoint, so we mirror that here.
        var s = startDate.ToString("MM-dd-yyyy");
        var e = endDate.ToString("MM-dd-yyyy");
        var path = $"clubs/updates?startDate={s}&endDate={e}";
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /clubs/updates failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        var list = JsonSerializer.Deserialize<List<RotaryOrgClubListDto>>(body, JsonOpts) ?? new List<RotaryOrgClubListDto>();
        _logger.LogInformation("[RI.org] GET /clubs/updates ({Start} → {End}) OK in {Ms}ms — {Count} club(s) changed",
            s, e, sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    public async Task<(int StatusCode, string Body)> GetClubMembersRawAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/members";
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        return ((int)resp.StatusCode, body);
    }

    public async Task<(int StatusCode, string Body)> GetRawAsync(string path, CancellationToken ct = default)
    {
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        return ((int)resp.StatusCode, body);
    }

    // Single-year convenience — delegates to the wide-range variant with toYear = fromYear.
    public Task<List<RotaryOrgClubOfficerDto>> GetClubOfficersAsync(string clubType, int clubId, int fromYear, CancellationToken ct = default)
        => GetClubOfficersAsync(clubType, clubId, fromYear, fromYear, ct);

    public async Task<List<RotaryOrgClubOfficerDto>> GetClubOfficersAsync(string clubType, int clubId, int fromYear, int toYear, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var fromDate = $"07/01/{fromYear}";
        var toDate = $"06/30/{toYear + 1}";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/officers?startDate={fromDate}&endDate={toDate}";
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();

        // Some ranges legitimately return 400 (e.g., before club charter date, or outside
        // Rotary.org's data range). Treat as empty rather than crash the per-club loop.
        if (resp.StatusCode == HttpStatusCode.NotFound ||
            resp.StatusCode == HttpStatusCode.Unauthorized ||
            resp.StatusCode == HttpStatusCode.Forbidden ||
            resp.StatusCode == HttpStatusCode.BadRequest)
            return new List<RotaryOrgClubOfficerDto>();

        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /clubs/{clubType}/{clubId}/officers failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");

        var list = JsonSerializer.Deserialize<List<RotaryOrgClubOfficerDto>>(body, JsonOpts) ?? new List<RotaryOrgClubOfficerDto>();
        _logger.LogDebug("[RI.org] GET /clubs/{Type}/{Id}/officers ({From}→{To}) OK in {Ms}ms — {Count} officer(s)",
            clubType, clubId, fromYear, toYear + 1, sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    public async Task<List<RotaryOrgClubMemberDto>> GetClubMembersAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        // Path format: /clubs/{type}/{id}/members/{offset}/{limit}/Active
        // 1500 is a generous upper bound; fetch one page (no club has more than this).
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/members/0/1500/Active";
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();

        if (resp.StatusCode == HttpStatusCode.NotFound ||
            resp.StatusCode == HttpStatusCode.Unauthorized ||
            resp.StatusCode == HttpStatusCode.Forbidden)
            return new List<RotaryOrgClubMemberDto>();

        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /clubs/{clubType}/{clubId}/members failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");

        var wrapper = JsonSerializer.Deserialize<RotaryOrgClubMembersResponse>(body, JsonOpts);
        var list = wrapper?.ClubMembers ?? new List<RotaryOrgClubMemberDto>();
        _logger.LogInformation("[RI.org] GET /clubs/{Type}/{Id}/members OK in {Ms}ms — {Count} member(s)",
            clubType, clubId, sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    /// <summary>
    /// Fetch HONORARY members for a club. Same DTO shape as /Active but the
    /// status filter is /Honorary. Called separately by the member sweep
    /// because the /Active endpoint filters honorary members out entirely.
    /// Non-fatal on 404 — some clubs simply have no honorary members and
    /// Rotary.org's response varies. Returns empty list in that case.
    /// </summary>
    public async Task<List<RotaryOrgClubMemberDto>> GetClubHonoraryMembersAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/members/0/1500/Honorary";
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();

        if (resp.StatusCode == HttpStatusCode.NotFound ||
            resp.StatusCode == HttpStatusCode.Unauthorized ||
            resp.StatusCode == HttpStatusCode.Forbidden)
            return new List<RotaryOrgClubMemberDto>();

        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogWarning("[RI.org] GET /clubs/{Type}/{Id}/members/.../Honorary returned {Status} — treating as zero honorary members. Body: {Body}",
                clubType, clubId, (int)resp.StatusCode, Truncate(body, 200));
            return new List<RotaryOrgClubMemberDto>();
        }

        var wrapper = JsonSerializer.Deserialize<RotaryOrgClubMembersResponse>(body, JsonOpts);
        var list = wrapper?.ClubMembers ?? new List<RotaryOrgClubMemberDto>();
        _logger.LogInformation("[RI.org] GET /clubs/{Type}/{Id}/members/.../Honorary OK in {Ms}ms — {Count} honorary member(s)",
            clubType, clubId, sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    public async Task<List<RotaryOrgClubMemberDto>> GetClubTerminatedMembersAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/members/terminated";
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();

        if (resp.StatusCode == HttpStatusCode.NotFound ||
            resp.StatusCode == HttpStatusCode.Unauthorized ||
            resp.StatusCode == HttpStatusCode.Forbidden)
            return new List<RotaryOrgClubMemberDto>();

        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /clubs/{clubType}/{clubId}/members/terminated failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");

        // Defensive parsing — terminated endpoint has been observed as a bare array;
        // /members (active) uses { "ClubMembers": [...] } wrapper. Handle both shapes
        // plus a possible "TerminatedMembers" wrapper variant.
        var trimmed = body?.TrimStart() ?? "";
        List<RotaryOrgClubMemberDto> list = new();
        if (trimmed.StartsWith("["))
        {
            list = JsonSerializer.Deserialize<List<RotaryOrgClubMemberDto>>(body!, JsonOpts) ?? new List<RotaryOrgClubMemberDto>();
        }
        else
        {
            try
            {
                var wrapper = JsonSerializer.Deserialize<RotaryOrgClubMembersResponse>(body!, JsonOpts);
                if (wrapper?.ClubMembers != null) list = wrapper.ClubMembers;
            }
            catch (JsonException) { /* fall through to per-key probe */ }
            if (list.Count == 0 && !string.IsNullOrWhiteSpace(body))
            {
                try
                {
                    using var doc = JsonDocument.Parse(body!);
                    foreach (var key in new[] { "ClubMembers", "clubMembers", "TerminatedMembers", "terminatedMembers", "Members", "members" })
                    {
                        if (doc.RootElement.TryGetProperty(key, out var arr) && arr.ValueKind == JsonValueKind.Array)
                        {
                            list = JsonSerializer.Deserialize<List<RotaryOrgClubMemberDto>>(arr.GetRawText(), JsonOpts) ?? new List<RotaryOrgClubMemberDto>();
                            break;
                        }
                    }
                }
                catch { /* malformed — return empty */ }
            }
        }
        _logger.LogInformation("[RI.org] GET /clubs/{Type}/{Id}/members/terminated OK in {Ms}ms — {Count} historical row(s)",
            clubType, clubId, sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    public async Task<RotaryOrgIndividualProfileResponse?> GetIndividualProfileAsync(long memberId, CancellationToken ct = default)
    {
        var path = $"individuals/{memberId}/profile";
        using var resp = await SendAuthenticatedAsync(path, ct);
        if (resp.StatusCode == HttpStatusCode.NotFound ||
            resp.StatusCode == HttpStatusCode.Unauthorized ||
            resp.StatusCode == HttpStatusCode.Forbidden)
            return null;
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /individuals/{memberId}/profile failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        return JsonSerializer.Deserialize<RotaryOrgIndividualProfileResponse>(body, JsonOpts);
    }

    private static string Truncate(string s, int max)
        => string.IsNullOrEmpty(s) ? "" : s.Length <= max ? s : s.Substring(0, max) + "…";
}

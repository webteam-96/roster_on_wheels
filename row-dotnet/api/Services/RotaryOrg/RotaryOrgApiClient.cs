using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace RotaryApi.Services.RotaryOrg;

/// <summary>
/// HTTP client for Rotary.org Data Integration API. Single-instance token cache
/// (process-scoped) with TTL + lazy refresh. On 401 we auto re-auth once then retry.
/// Cleaner than the old sync app which re-authenticated every 10 clubs.
/// </summary>
public class RotaryOrgApiClient : IRotaryOrgApiClient
{
    // Rotary.org authentication token lifetime — conservative; we auto-refresh on 401 regardless.
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
        _http.Timeout = TimeSpan.FromSeconds(90);
        _http.DefaultRequestHeaders.Accept.Clear();
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        // Mimic the old HttpWebRequest which sent a default User-Agent. Some RI.org endpoints
        // reject requests with no UA (HttpClient sends none by default).
        _http.DefaultRequestHeaders.UserAgent.Clear();
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("ROW-Sync", "1.0"));
        // Base URL set via appsettings — trailing slash ensures relative paths resolve right
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
            throw new InvalidOperationException("RotaryOrgApi:Username / Password not configured in appsettings.");

        var payload = JsonSerializer.Serialize(new RotaryOrgAuthRequest { Username = username, Password = password });
        using var req = new HttpRequestMessage(HttpMethod.Post, "authentication")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };

        _logger.LogInformation("🔑 [RI.org] POST /authentication — user={User}", username);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using var resp = await _http.SendAsync(req, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        sw.Stop();

        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogWarning("🔑 [RI.org] auth FAILED status={Status} body={Body}", (int)resp.StatusCode, Truncate(body, 300));
            throw new HttpRequestException($"Rotary.org authentication failed: {(int)resp.StatusCode} {resp.ReasonPhrase}. Body: {Truncate(body, 200)}");
        }

        // Rotary.org's auth endpoint returns the token either as a bare JSON string ("abc.def.ghi")
        // or as an object. Try both shapes.
        var token = TryExtractToken(body);
        if (string.IsNullOrWhiteSpace(token))
            throw new InvalidOperationException($"Rotary.org auth response could not be parsed. Body: {Truncate(body, 200)}");

        _cached = new CachedRotaryOrgToken { Token = token, ExpiresAtUtc = DateTime.UtcNow.Add(TokenTtl) };
        _logger.LogInformation("🔑 [RI.org] auth OK in {Ms}ms — token len={Len}", sw.ElapsedMilliseconds, token.Length);
        return token;
    }

    private static string? TryExtractToken(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        body = body.Trim();
        // Case 1: bare JSON string — "abc.def.ghi"
        if (body.StartsWith("\"") && body.EndsWith("\""))
            return body.Substring(1, body.Length - 2);
        // Case 2: JSON object — look for common token keys
        try
        {
            using var doc = JsonDocument.Parse(body);
            foreach (var key in new[] { "auth_token", "authToken", "AuthToken", "token", "Token", "access_token", "AccessToken" })
            {
                if (doc.RootElement.TryGetProperty(key, out var tok) && tok.ValueKind == JsonValueKind.String)
                    return tok.GetString();
            }
        }
        catch { /* not JSON */ }
        // Case 3: plain string body (not JSON-quoted)
        if (!body.StartsWith("{") && !body.StartsWith("[")) return body;
        return null;
    }

    // ───────────── Authenticated GET helpers ─────────────

    private async Task<HttpResponseMessage> SendAuthenticatedAsync(string path, CancellationToken ct)
    {
        // Rotary.org expects a custom `auth_token` header (not the standard Authorization: Bearer scheme).
        var token = await GetTokenAsync(ct);
        _logger.LogInformation("🔑 [RI.org] GET {Path} — token len={Len} startsWith={Start}",
            path, token.Length, token.Substring(0, Math.Min(20, token.Length)));

        using var req1 = new HttpRequestMessage(HttpMethod.Get, path);
        req1.Headers.TryAddWithoutValidation("auth_token", token);
        var resp = await _http.SendAsync(req1, ct);
        if (resp.StatusCode != HttpStatusCode.Unauthorized) return resp;

        // One retry after force re-auth
        resp.Dispose();
        _logger.LogInformation("🔑 [RI.org] 401 on {Path} — re-authenticating and retrying", path);
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
        {
            _logger.LogWarning("🔑 [RI.org] GET /clubs FAILED status={Status} body={Body}", (int)resp.StatusCode, Truncate(body, 300));
            throw new HttpRequestException($"Rotary.org GET /clubs failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        }
        var list = JsonSerializer.Deserialize<List<RotaryOrgClubListDto>>(body, JsonOpts) ?? new List<RotaryOrgClubListDto>();
        _logger.LogInformation("🔑 [RI.org] GET /clubs OK in {Ms}ms — {Count} clubs", sw.ElapsedMilliseconds, list.Count);
        return list;
    }

    public async Task<RotaryOrgClubDetailDto?> GetClubDetailAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        // URL-encode the type segment (it contains a space) — HttpClient will not double-encode if we use Uri.EscapeDataString
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}?summary=false";
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (resp.StatusCode == HttpStatusCode.NotFound) return null;
        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogWarning("🔑 [RI.org] GET /clubs/{Type}/{Id} FAILED status={Status}", clubType, clubId, (int)resp.StatusCode);
            throw new HttpRequestException($"Rotary.org GET club detail failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        }
        return JsonSerializer.Deserialize<RotaryOrgClubDetailDto>(body, JsonOpts);
    }

    public async Task<List<RotaryOrgClubSearchDto>> SearchClubsByCountryAsync(string country, CancellationToken ct = default)
    {
        var countryParam = $"(type=country:value={country})";
        var typeParam = "(type=ClubType:value=Rotary Club)";
        var path = $"Clubs/search?searchterm={Uri.EscapeDataString(countryParam)}&searchterm={Uri.EscapeDataString(typeParam)}";
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /Clubs/search failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        return JsonSerializer.Deserialize<List<RotaryOrgClubSearchDto>>(body, JsonOpts) ?? new List<RotaryOrgClubSearchDto>();
    }

    public async Task<List<RotaryOrgClubMemberDto>> GetClubMembersAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/members/0/1500/Active";
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (resp.StatusCode == HttpStatusCode.NotFound ||
            resp.StatusCode == HttpStatusCode.Unauthorized ||
            resp.StatusCode == HttpStatusCode.Forbidden)
            return new List<RotaryOrgClubMemberDto>();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Rotary.org GET /clubs/{clubType}/{clubId}/members failed: {(int)resp.StatusCode}. Body: {Truncate(body, 200)}");
        var wrapper = JsonSerializer.Deserialize<RotaryOrgClubMembersResponse>(body, JsonOpts);
        return wrapper?.ClubMembers ?? new List<RotaryOrgClubMemberDto>();
    }

    public async Task<List<RotaryOrgClubOfficerDto>> GetClubOfficersAsync(string clubType, int clubId, string startDate, string endDate, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/officers?startDate={Uri.EscapeDataString(startDate)}&endDate={Uri.EscapeDataString(endDate)}";
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode) return new List<RotaryOrgClubOfficerDto>();

        var result = new List<RotaryOrgClubOfficerDto>();
        try
        {
            using var doc = JsonDocument.Parse(body);
            // Response may be a bare array or a wrapper { Officers|officers|ClubOfficers: [...] }.
            JsonElement arr;
            if (doc.RootElement.ValueKind == JsonValueKind.Array) arr = doc.RootElement;
            else if (!(TryProp(doc.RootElement, out arr, "Officers", "officers", "ClubOfficers", "clubOfficers") && arr.ValueKind == JsonValueKind.Array))
                return result;

            foreach (var o in arr.EnumerateArray())
            {
                // The person may be inline or nested under Individual/Member.
                var person = o;
                if (TryProp(o, out var indiv, "Individual", "individual", "Member", "member") && indiv.ValueKind == JsonValueKind.Object)
                    person = indiv;
                result.Add(new RotaryOrgClubOfficerDto
                {
                    Role  = FirstStr(o, "Role", "RoleName", "role", "Title", "OfficerRole", "PositionName"),
                    Name  = FirstStr(person, "Name", "FullName", "MemberName", "IndividualName", "PreferredName", "name")
                            ?? JoinName(FirstStr(person, "FirstName", "firstName"), FirstStr(person, "LastName", "lastName")),
                    Email = FirstStr(person, "Email", "EmailAddress", "EmailId", "Email1", "email"),
                    Phone = FirstStr(person, "Phone", "Mobile", "PhoneNumber", "Phone1", "MobileNumber", "phone"),
                    // Rotary individual id (used to fill email/mobile from our DB by RotaryId).
                    RotaryId = FirstStr(person, "Id", "id", "MemberId", "memberId", "IndividualId", "individualId", "RiIndividualId", "riIndividualId")
                               ?? FirstStr(o, "Id", "id", "MemberId", "memberId", "IndividualId", "individualId"),
                });
            }
        }
        catch { /* shape mismatch → empty */ }
        return result;
    }

    private static bool TryProp(JsonElement el, out JsonElement value, params string[] names)
    {
        if (el.ValueKind == JsonValueKind.Object)
            foreach (var n in names)
                if (el.TryGetProperty(n, out value)) return true;
        value = default;
        return false;
    }

    private static string? FirstStr(JsonElement el, params string[] names)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        foreach (var n in names)
            if (el.TryGetProperty(n, out var v))
            {
                if (v.ValueKind == JsonValueKind.String) { var s = v.GetString(); if (!string.IsNullOrWhiteSpace(s)) return s.Trim(); }
                else if (v.ValueKind == JsonValueKind.Number) return v.ToString();
            }
        return null;
    }

    private static string? JoinName(string? first, string? last)
    {
        var s = string.Join(" ", new[] { first, last }.Where(x => !string.IsNullOrWhiteSpace(x)));
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }

    public async Task<List<RotaryOrgClubMemberDto>> GetClubHonoraryMembersAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/members/0/1500/Honorary";
        using var resp = await SendAuthenticatedAsync(path, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        // Non-fatal: many clubs have no honorary endpoint / return 404. Treat any failure as zero honorary.
        if (!resp.IsSuccessStatusCode)
            return new List<RotaryOrgClubMemberDto>();
        var wrapper = JsonSerializer.Deserialize<RotaryOrgClubMembersResponse>(body, JsonOpts);
        return wrapper?.ClubMembers ?? new List<RotaryOrgClubMemberDto>();
    }

    // GET /v1.1/clubs/{type}/{id}/members/{currentRecord}/{recordCount}/Terminated, paginated.
    // Verified directly against the live API (2026-07-31): currentRecord is a 1-based cursor —
    // currentRecord=N returns records starting at 0-based index (N-1), with 0 treated the same
    // as 1 (both start from the very first record). There is no RecordCount/total field in the
    // response (despite Rotary.org's own doc text implying one) — a page shorter than the
    // requested pageSize is the only "no more data" signal. Starting at currentRecord=1 (not 0)
    // keeps the "next = current + returned count" formula uniform across every page, including
    // the first.
    public async Task<List<RotaryOrgClubMemberDto>> GetClubTerminatedMembersAsync(string clubType, int clubId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clubType)) clubType = "Rotary Club";
        const int pageSize = 100;
        const int maxPages = 50; // safety valve — 5,000 lifetime-terminated members would be extraordinary
        var all = new List<RotaryOrgClubMemberDto>();
        int currentRecord = 1;
        for (int page = 0; page < maxPages; page++)
        {
            var path = $"clubs/{Uri.EscapeDataString(clubType)}/{clubId}/members/{currentRecord}/{pageSize}/Terminated";
            using var resp = await SendAuthenticatedAsync(path, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (resp.StatusCode == HttpStatusCode.NotFound ||
                resp.StatusCode == HttpStatusCode.Unauthorized ||
                resp.StatusCode == HttpStatusCode.Forbidden)
                break;
            // Rotary.org's own way of saying "this club has zero terminated members" is a 400
            // with this specific message — not a real failure, just an empty result.
            if (resp.StatusCode == HttpStatusCode.BadRequest && body.Contains("do not exist", StringComparison.OrdinalIgnoreCase))
                break;
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"Rotary.org didn't return a result for this club (unexpected response). Try again shortly, or refresh just this club again later.");

            var pageItems = ParseMembersResponse(body);
            if (pageItems.Count == 0) break;
            all.AddRange(pageItems);
            if (pageItems.Count < pageSize) break; // short page = last page
            currentRecord += pageItems.Count;
        }
        return all;
    }

    // Shared defensive parser for every shape Rotary.org's /members endpoints have been observed
    // to return: bare array, {"ClubMembers":[...]}, {"TerminatedClubMembers":[...]}, or other
    // wrapper key names.
    private static List<RotaryOrgClubMemberDto> ParseMembersResponse(string body)
    {
        var trimmed = body?.TrimStart() ?? "";
        if (trimmed.StartsWith("["))
        {
            return JsonSerializer.Deserialize<List<RotaryOrgClubMemberDto>>(body!, JsonOpts) ?? new List<RotaryOrgClubMemberDto>();
        }
        try
        {
            var wrapper = JsonSerializer.Deserialize<RotaryOrgClubMembersResponse>(body!, JsonOpts);
            if (wrapper?.ClubMembers != null) return wrapper.ClubMembers;
        }
        catch (JsonException) { /* fall through to the per-key probe below */ }
        using var doc = JsonDocument.Parse(body!);
        foreach (var key in new[] { "ClubMembers", "clubMembers", "TerminatedClubMembers", "terminatedClubMembers", "TerminatedMembers", "terminatedMembers", "Members", "members" })
        {
            if (doc.RootElement.TryGetProperty(key, out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                return JsonSerializer.Deserialize<List<RotaryOrgClubMemberDto>>(arr.GetRawText(), JsonOpts) ?? new List<RotaryOrgClubMemberDto>();
            }
        }
        return new List<RotaryOrgClubMemberDto>();
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

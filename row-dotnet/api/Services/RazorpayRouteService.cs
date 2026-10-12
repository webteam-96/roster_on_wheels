using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Razorpay Route linked-account onboarding via the v2 Accounts APIs (Basic auth, same
// KeyId/KeySecret as the rest of the integration; the parent account must have Route enabled).
// Sequence: create account -> create stakeholder -> request route product -> set settlement bank.
// Ref https://razorpay.com/docs/api/partnerships/account-onboarding
public class RazorpayRouteService : IRazorpayRouteService
{
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<RazorpayRouteService> _logger;

    public RazorpayRouteService(IConfiguration config, IHttpClientFactory httpFactory, ILogger<RazorpayRouteService> logger)
    {
        _config = config;
        _httpFactory = httpFactory;
        _logger = logger;
    }

    // Generic defaults applied when the (minimal) form leaves a field blank. These get the
    // account to "needs_clarification" so the rest of KYC is finished in the Razorpay dashboard.
    private static string DefaultPhone => RotaryApi.Services.Brand.SupportPhone;
    private const string DefaultBusinessType = "trust";
    private const string DefaultCategory = "not_for_profit";
    private const string DefaultSubcategory = "charity";
    private const string DefaultStreet = "ROW 5 6 7 8";
    private const string DefaultCity = "Mumbai";
    private const string DefaultState = "Maharashtra";
    private const string DefaultPostalCode = "400001";
    private static string OrDefault(string? v, string fallback) => string.IsNullOrWhiteSpace(v) ? fallback : v.Trim();

    // The PAN's 4th character encodes the holder type — use it so the account's business_type
    // matches the PAN for KYC (falls back to the default when no/short PAN is given).
    private static string BusinessTypeFromPan(string? pan, string fallback)
    {
        var p = pan?.Trim();
        if (string.IsNullOrEmpty(p) || p.Length < 4) return fallback;
        return char.ToUpperInvariant(p[3]) switch
        {
            'C' => "private_limited",
            'H' => "huf",
            'F' => "partnership",         // firm
            'A' => "society",             // association of persons
            'T' => "trust",
            'P' => "proprietorship",      // individual PAN (proprietor)
            'B' => "not_yet_registered",  // body of individuals
            'L' or 'J' or 'G' => "society",
            _ => fallback,
        };
    }

    // legal_info.pan is a *company/entity* PAN. Razorpay rejects it for business types whose
    // registration uses an individual PAN — for those the PAN is captured later via KYC, not here.
    private static bool HasCompanyPan(string? businessType) => (businessType ?? "").Trim().ToLowerInvariant() switch
    {
        "individual" or "proprietorship" or "not_yet_registered" => false,
        _ => true,
    };

    // Razorpay v2 host derived from the configured v1 base so a host override still applies.
    private string V2Base()
    {
        var root = (_config["Razorpay:BaseUrl"] ?? "https://api.razorpay.com/v1").TrimEnd('/');
        if (root.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)) root = root[..^3];
        else if (root.EndsWith("/v2", StringComparison.OrdinalIgnoreCase)) root = root[..^3];
        return root.TrimEnd('/') + "/v2";
    }

    private (string keyId, string keySecret)? Credentials()
    {
        var keyId = _config["Razorpay:KeyId"];
        var keySecret = _config["Razorpay:KeySecret"];
        if (string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(keySecret)
            || keySecret!.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
            return null;
        return (keyId!, keySecret);
    }

    public async Task<RouteOnboardingResult> CreateLinkedAccountAsync(RazorpayRouteOnboardingDto dto)
    {
        var result = new RouteOnboardingResult();
        var creds = Credentials();
        if (creds == null) { result.FatalError = "Razorpay is not configured."; return result; }

        var v2 = V2Base();
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{creds.Value.keyId}:{creds.Value.keySecret}"));

        // ── Step 1: create the linked account (minimal form + generic defaults) ─────
        var legalName = OrDefault(dto.LegalBusinessName, "Rotary Linked Account");
        var businessType = OrDefault(dto.BusinessType, BusinessTypeFromPan(dto.Pan, DefaultBusinessType));
        var accountPayload = new Dictionary<string, object?>
        {
            ["email"] = dto.Email?.Trim(),
            ["phone"] = CleanPhone(OrDefault(dto.Phone, DefaultPhone)),
            ["type"] = "route",
            ["legal_business_name"] = legalName,
            ["business_type"] = businessType,
            ["customer_facing_business_name"] = OrDefault(dto.CustomerFacingBusinessName, legalName),
            ["profile"] = new Dictionary<string, object?>
            {
                ["category"] = OrDefault(dto.Category, DefaultCategory),
                ["subcategory"] = OrDefault(dto.Subcategory, DefaultSubcategory),
                ["addresses"] = new Dictionary<string, object?>
                {
                    ["registered"] = new Dictionary<string, object?>
                    {
                        ["street1"] = OrDefault(dto.Street1, DefaultStreet),
                        ["street2"] = OrDefault(dto.Street2, DefaultStreet),
                        ["city"] = OrDefault(dto.City, DefaultCity),
                        ["state"] = OrDefault(dto.State, DefaultState),
                        ["postal_code"] = OrDefault(dto.PostalCode, DefaultPostalCode),
                        ["country"] = OrDefault(dto.Country, "IN"),
                    }
                }
            },
        };
        if (!string.IsNullOrWhiteSpace(dto.ReferenceId))
            accountPayload["reference_id"] = dto.ReferenceId!.Trim();
        // PAN/GST only if explicitly supplied (never defaulted — bad values get rejected outright).
        // The company PAN goes in only for business types that actually have one; Razorpay rejects
        // legal_info.pan for individual/proprietorship/not-yet-registered ("company pan field is
        // invalid for business type: proprietorship"). GST is accepted for any type.
        var legal = new Dictionary<string, object?>();
        if (HasCompanyPan(businessType) && !string.IsNullOrWhiteSpace(dto.Pan))
            legal["pan"] = dto.Pan!.Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(dto.Gst))
            legal["gst"] = dto.Gst!.Trim().ToUpperInvariant();
        if (legal.Count > 0)
            accountPayload["legal_info"] = legal;

        var (accOk, accBody, accErr) = await PostAsync($"{v2}/accounts", accountPayload, basic);
        if (!accOk)
        {
            result.FatalError = accErr ?? "Could not create the linked account on Razorpay.";
            return result;
        }
        result.AccountId = ReadId(accBody);
        if (string.IsNullOrWhiteSpace(result.AccountId))
        {
            result.FatalError = "Razorpay did not return an account id.";
            return result;
        }
        result.Status = ReadStatus(accBody);
        result.RawJson = accBody;
        var accountId = result.AccountId!;

        // Stakeholder + individual-PAN KYC are intentionally NOT done here (they require a valid
        // personal PAN and add form friction) — finish them in the Razorpay dashboard.

        // ── Step 2: request the Route product configuration ────────────────────────
        var (prOk, prBody, prErr) = await PostAsync($"{v2}/accounts/{accountId}/products",
            new Dictionary<string, object?> { ["product_name"] = "route", ["tnc_accepted"] = true }, basic);
        if (!prOk)
        {
            result.Warnings.Add($"Route product not requested: {prErr}. Complete it in the Razorpay dashboard.");
            return result; // no product id => can't set bank; keep the acc_ id.
        }
        result.ProductConfigId = ReadId(prBody);
        result.Status = ReadStatus(prBody) ?? result.Status;
        result.RawJson = prBody;

        // ── Step 3: set the settlement bank account on the product config ──────────
        // Only account number + IFSC are required; beneficiary defaults to the business name.
        if (!string.IsNullOrWhiteSpace(result.ProductConfigId)
            && !string.IsNullOrWhiteSpace(dto.BankAccountNumber)
            && !string.IsNullOrWhiteSpace(dto.BankIfsc))
        {
            var bankPayload = new Dictionary<string, object?>
            {
                ["settlements"] = new Dictionary<string, object?>
                {
                    ["account_number"] = dto.BankAccountNumber!.Trim(),
                    ["ifsc_code"] = dto.BankIfsc!.Trim().ToUpperInvariant(),
                    ["beneficiary_name"] = OrDefault(dto.BankBeneficiaryName, legalName),
                },
                ["tnc_accepted"] = true,
            };
            var (bkOk, bkBody, bkErr) = await PatchAsync($"{v2}/accounts/{accountId}/products/{result.ProductConfigId}", bankPayload, basic);
            if (bkOk) { result.Status = ReadStatus(bkBody) ?? result.Status; result.RawJson = bkBody; }
            else result.Warnings.Add($"Settlement bank not saved: {bkErr}. Add it in the Razorpay dashboard.");
        }
        else result.Warnings.Add("Settlement bank skipped (add account number + IFSC in the Razorpay dashboard).");

        return result;
    }

    public async Task<RouteStatusResult> GetLinkedAccountAsync(string accountId)
    {
        var creds = Credentials();
        if (creds == null) return new RouteStatusResult(null, "");
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{creds.Value.keyId}:{creds.Value.keySecret}"));
        var (ok, body, _) = await GetAsync($"{V2Base()}/accounts/{accountId}", basic);
        return new RouteStatusResult(ok ? ReadStatus(body) : null, body);
    }

    public async Task<RouteStatusResult> GetRouteProductAsync(string accountId, string productId)
    {
        var creds = Credentials();
        if (creds == null) return new RouteStatusResult(null, "");
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{creds.Value.keyId}:{creds.Value.keySecret}"));
        var (ok, body, _) = await GetAsync($"{V2Base()}/accounts/{accountId}/products/{productId}", basic);
        return new RouteStatusResult(ok ? ReadStatus(body) : null, body);
    }

    private static string? CleanPhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        var s = phone.Replace("+91", "").Replace("+", "").Trim();
        return s.Length > 10 ? s[^10..] : s;
    }

    private async Task<(bool ok, string body, string? error)> PostAsync(string url, object payload, string basic)
        => await SendAsync(HttpMethod.Post, url, payload, basic);

    private async Task<(bool ok, string body, string? error)> PatchAsync(string url, object payload, string basic)
        => await SendAsync(HttpMethod.Patch, url, payload, basic);

    private async Task<(bool ok, string body, string? error)> GetAsync(string url, string basic)
    {
        try
        {
            var http = _httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(40);
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
            var res = await http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (res.IsSuccessStatusCode) return (true, body, null);
            _logger.LogWarning("Razorpay Route GET {Url} failed: {Status} {Body}", url, res.StatusCode, body);
            return (false, body, ExtractError(body) ?? $"Razorpay returned {(int)res.StatusCode}.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Razorpay Route GET {Url} threw.", url);
            return (false, "", "Could not reach Razorpay. Please try again.");
        }
    }

    private async Task<(bool ok, string body, string? error)> SendAsync(HttpMethod method, string url, object payload, string basic)
    {
        try
        {
            var http = _httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(40);
            using var req = new HttpRequestMessage(method, url)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
            var res = await http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (res.IsSuccessStatusCode) return (true, body, null);
            _logger.LogWarning("Razorpay Route {Method} {Url} failed: {Status} {Body}", method, url, res.StatusCode, body);
            return (false, body, ExtractError(body) ?? $"Razorpay returned {(int)res.StatusCode}.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Razorpay Route {Method} {Url} threw.", method, url);
            return (false, "", "Could not reach Razorpay. Please try again.");
        }
    }

    private static string? ReadId(string body)
    {
        try { using var doc = JsonDocument.Parse(body); return doc.RootElement.TryGetProperty("id", out var id) ? id.GetString() : null; }
        catch { return null; }
    }

    // Prefer the product/account activation_status (matches the dashboard's "Account Status");
    // fall back to the account-level status (created/suspended). Also handles the products list shape.
    private static string? ReadStatus(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("activation_status", out var a) && a.ValueKind == JsonValueKind.String) return a.GetString();
            // GET /products returns { items: [ { activation_status, ... } ] }
            if (root.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array && items.GetArrayLength() > 0)
            {
                var first = items[0];
                if (first.TryGetProperty("activation_status", out var ia) && ia.ValueKind == JsonValueKind.String) return ia.GetString();
            }
            if (root.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.String) return s.GetString();
        }
        catch { /* ignore */ }
        return null;
    }

    // Razorpay errors: { "error": { "description": "...", "field": "..." } }
    private static string? ExtractError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var err))
            {
                var desc = err.TryGetProperty("description", out var d) ? d.GetString() : null;
                var field = err.TryGetProperty("field", out var f) ? f.GetString() : null;
                if (!string.IsNullOrWhiteSpace(desc))
                    return string.IsNullOrWhiteSpace(field) ? desc : $"{desc} (field: {field})";
            }
        }
        catch { /* fall through */ }
        return null;
    }
}

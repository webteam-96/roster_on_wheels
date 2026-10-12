using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Pull-based Razorpay settlement reconciliation. There is no settlement.processed webhook wired
// up anywhere in this codebase (only payment.captured/order.paid), so this polls Razorpay's
// Settlement Recon (Combined) API instead — GET /v1/settlements/recon/combined?year=&month=,
// mirroring MembershipDuesService.RefreshSettlementsAsync's shape for Cashfree, adapted for
// Razorpay's response fields (entity_id/payment_id/settlement_id/settlement_utr/credit/settled_at).
public class RazorpaySettlementService : IRazorpaySettlementService
{
    private readonly string _conn;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<RazorpaySettlementService> _logger;

    public RazorpaySettlementService(IConfiguration config, IHttpClientFactory httpFactory, ILogger<RazorpaySettlementService> logger)
    {
        _config = config;
        _conn = config.GetConnectionString("DefaultConnection")!;
        _httpFactory = httpFactory;
        _logger = logger;
    }

    private MySqlConnection NewConn() => new(_conn);

    public async Task<int> SyncMonthAsync(int year, int month, string? impersonateAccountId = null)
    {
        var baseUrl = (_config["Razorpay:BaseUrl"] ?? "https://api.razorpay.com/v1").TrimEnd('/');
        var keyId = _config["Razorpay:KeyId"];
        var keySecret = _config["Razorpay:KeySecret"];
        if (string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(keySecret)
            || keySecret!.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("Razorpay is not configured — skipping settlement sync.");
            return 0;
        }

        var http = _httpFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/settlements/recon/combined?year={year}&month={month:D2}&count=1000");
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{keyId}:{keySecret}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        if (!string.IsNullOrWhiteSpace(impersonateAccountId))
            req.Headers.Add("X-Razorpay-Account", impersonateAccountId);

        HttpResponseMessage res;
        string body;
        try
        {
            res = await http.SendAsync(req);
            body = await res.Content.ReadAsStringAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Razorpay settlement recon request failed for {Year}-{Month} (account={Account})", year, month, impersonateAccountId ?? "master");
            return 0;
        }

        if (!res.IsSuccessStatusCode)
        {
            // Route sub-account impersonation via X-Razorpay-Account isn't confirmed to be supported
            // on this specific endpoint — log and move on rather than fail the whole sync.
            _logger.LogWarning("Razorpay settlement recon returned {Status} for {Year}-{Month} (account={Account}): {Body}",
                res.StatusCode, year, month, impersonateAccountId ?? "master", body);
            return 0;
        }

        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
            return 0;

        await using var conn = NewConn();
        await conn.OpenAsync();

        int upserted = 0;
        foreach (var item in items.EnumerateArray())
        {
            try
            {
                var type = item.TryGetProperty("type", out var t) ? t.GetString() : null;
                // For a "payment" row the payment id IS the entity; for transfer/refund/adjustment
                // rows, payment_id links back to the originating payment. Skip rows with neither.
                string? paymentId = type == "payment"
                    ? (item.TryGetProperty("entity_id", out var eid) ? eid.GetString() : null)
                    : (item.TryGetProperty("payment_id", out var pid) && pid.ValueKind != JsonValueKind.Null ? pid.GetString() : null);
                if (string.IsNullOrWhiteSpace(paymentId)) continue;

                var settled = item.TryGetProperty("settled", out var s) && s.ValueKind == JsonValueKind.True;
                if (!settled) continue; // only record rows that have actually settled

                string? orderId = item.TryGetProperty("order_id", out var oid) && oid.ValueKind != JsonValueKind.Null ? oid.GetString() : null;
                string? settlementId = item.TryGetProperty("settlement_id", out var sid) && sid.ValueKind != JsonValueKind.Null ? sid.GetString() : null;
                string? utr = item.TryGetProperty("settlement_utr", out var u) && u.ValueKind != JsonValueKind.Null ? u.GetString() : null;
                decimal creditPaise = item.TryGetProperty("credit", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetDecimal() : 0m;
                DateTime? settledAt = item.TryGetProperty("settled_at", out var sa) && sa.ValueKind == JsonValueKind.Number && sa.GetInt64() > 0
                    ? DateTimeOffset.FromUnixTimeSeconds(sa.GetInt64()).UtcDateTime.ToLocalTime()
                    : null;

                await conn.ExecuteAsync(@"
                    INSERT INTO razorpay_settlements
                        (RazorpayPaymentId, RazorpayOrderId, SettlementId, SettlementUtr, SettlementAmount,
                         SettlementStatus, SettlementDate, LinkedAccountId, RawJson, created_date)
                    VALUES (@PaymentId, @OrderId, @SettlementId, @Utr, @Amount, 'settled', @SettledAt, @Account, @Raw, NOW())
                    ON DUPLICATE KEY UPDATE
                        RazorpayOrderId = COALESCE(VALUES(RazorpayOrderId), RazorpayOrderId),
                        SettlementId = VALUES(SettlementId), SettlementUtr = VALUES(SettlementUtr),
                        SettlementAmount = VALUES(SettlementAmount), SettlementStatus = VALUES(SettlementStatus),
                        SettlementDate = VALUES(SettlementDate), LinkedAccountId = VALUES(LinkedAccountId),
                        RawJson = VALUES(RawJson), modified_date = NOW()",
                    new
                    {
                        PaymentId = paymentId, OrderId = orderId, SettlementId = settlementId, Utr = utr,
                        Amount = creditPaise / 100m, SettledAt = settledAt, Account = impersonateAccountId,
                        Raw = item.GetRawText()
                    });
                upserted++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse/upsert one settlement recon row for {Year}-{Month}", year, month);
            }
        }

        return upserted;
    }

    public async Task SyncRecentAsync(int monthsBack = 3)
    {
        var months = new List<(int Year, int Month)>();
        var cursor = DateTime.Today;
        for (int i = 0; i < Math.Max(1, monthsBack); i++)
        {
            months.Add((cursor.Year, cursor.Month));
            cursor = cursor.AddMonths(-1);
        }

        foreach (var (year, month) in months)
        {
            var n = await SyncMonthAsync(year, month);
            _logger.LogInformation("Razorpay settlement sync (master account) {Year}-{Month}: {Count} rows", year, month, n);
        }

        List<string> routeAccountIds;
        await using (var conn = NewConn())
        {
            await conn.OpenAsync();
            routeAccountIds = (await conn.QueryAsync<string>(
                "SELECT AccountId FROM razorpay_route_accounts WHERE IsActive = 1 AND isdeleted = 0")).ToList();
        }

        foreach (var accountId in routeAccountIds)
        {
            foreach (var (year, month) in months)
            {
                var n = await SyncMonthAsync(year, month, accountId);
                _logger.LogInformation("Razorpay settlement sync (route account {Account}) {Year}-{Month}: {Count} rows", accountId, year, month, n);
            }
        }
    }
}

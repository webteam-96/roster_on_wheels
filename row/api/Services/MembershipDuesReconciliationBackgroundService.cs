using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  Cashfree payment reconciliation for MEMBERSHIP DUES
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
// ---------------
// An online dues payment is written as PaymentStatus='ACTIVE', IsPaid=0 the moment
// the member clicks Pay — BEFORE any money moves. It is flipped to paid by the
// Cashfree webhook, which travels Cashfree → PHP relay at example.org →
// POST /api/public/membership-dues/webhook. If ANY hop drops that call, the member
// has paid and the portal never records it. This service is the backstop: it asks
// Cashfree directly.
//
// THE CORRECTNESS CONSTRAINT (read before changing anything here)
// ---------------------------------------------------------------
// 'ACTIVE' is ALSO the normal resting state of an ABANDONED checkout. A member who
// opened the payment page and walked away leaves a row that is byte-identical to a
// member whose webhook was lost. There is NO local signal that separates them.
// Therefore this service marks a row paid ONLY when Cashfree itself explicitly
// reports the order as PAID *and* reports at least one SUCCESS payment against it.
// Age, amount, and the mere existence of the row are NEVER evidence of payment.
//
// CASHFREE SEMANTICS (PG API, x-api-version 2023-08-01)
// -----------------------------------------------------
//   GET /pg/orders/{order_id}            → order_status ∈ ACTIVE | PAID | EXPIRED |
//                                          TERMINATED | TERMINATION_REQUESTED
//   GET /pg/orders/{order_id}/payments   → array; payment_status ∈ SUCCESS |
//                                          NOT_ATTEMPTED | FAILED | USER_DROPPED |
//                                          PENDING | CANCELLED | VOID
//   Only order_status == "PAID" AND some payment_status == "SUCCESS" is treated as
//   money received. Anything else → leave the row untouched.
//
//   {order_id} MUST be OUR MERCHANT order id ("DUES105_08082026125943123456").
//   Cashfree's own numeric cf_order_id ("6600000000") is NOT accepted by any REST
//   endpoint — it returns 404 order_not_found on /orders/{id}, /payments and
//   /settlements alike (verified against the live API). That numeric value is what
//   the CfOrderId column holds; the merchant order id lives in TransactionId.
//   Rows created before TransactionId was persisted therefore CANNOT be reconciled
//   through the API at all — they are counted and logged as unresolvable, and need
//   a Cashfree Dashboard lookup by cf_order_id instead.
//
// SAFETY
// ------
// • Disabled by default (MembershipDuesReconciliation:Enabled = false).
// • Read-only against Cashfree — only GETs, no order creation, no capture, no refund.
// • Every write goes through IMembershipDuesService.MarkOnlineDuesPaymentPaidAsync,
//   the same method the webhook uses, guarded by IsPaid=0 AND PaymentStatus='ACTIVE'
//   with a rows-affected check, so re-runs can never double-credit.
// • One bad order can never kill the loop: per-order try/catch, then per-cycle
//   try/catch.
public class MembershipDuesReconciliationBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MembershipDuesReconciliationBackgroundService> _logger;
    private readonly IConfiguration _config;
    private readonly HttpClient _httpClient;
    private readonly string _connStr;

    public MembershipDuesReconciliationBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<MembershipDuesReconciliationBackgroundService> logger,
        IConfiguration config,
        IHttpClientFactory httpClientFactory)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _config = config;
        _httpClient = httpClientFactory.CreateClient();
        _connStr = config.GetConnectionString("DefaultConnection")!;
    }

    // ── Tunables (appsettings → "MembershipDuesReconciliation") ──────────────
    private bool Enabled => _config.GetValue("MembershipDuesReconciliation:Enabled", false);
    // How often a sweep runs.
    private int IntervalMinutes => Clamp(_config.GetValue("MembershipDuesReconciliation:IntervalMinutes", 5), 1, 1440);
    // Grace period: a member may still be mid-checkout. Never touch anything younger.
    private int MinAgeMinutes => Clamp(_config.GetValue("MembershipDuesReconciliation:MinAgeMinutes", 10), 1, 10080);
    // Bounded window so we never rescan years of abandoned orders every 5 minutes.
    private int LookbackDays => Clamp(_config.GetValue("MembershipDuesReconciliation:LookbackDays", 7), 1, 365);
    // Hard ceiling on Cashfree calls per sweep.
    private int MaxOrdersPerCycle => Clamp(_config.GetValue("MembershipDuesReconciliation:MaxOrdersPerCycle", 100), 1, 2000);
    // Throttle between outbound calls so a backlog can't hammer the gateway.
    private int DelayBetweenCallsMs => Clamp(_config.GetValue("MembershipDuesReconciliation:DelayBetweenCallsMs", 400), 0, 10000);

    private static int Clamp(int v, int min, int max) => v < min ? min : v > max ? max : v;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled)
        {
            _logger.LogInformation(
                "MembershipDuesReconciliation is DISABLED (MembershipDuesReconciliation:Enabled=false). No dues payments will be reconciled.");
            return;
        }

        _logger.LogInformation(
            "MembershipDuesReconciliation started. Interval={Interval}m, MinAge={MinAge}m, Lookback={Lookback}d, MaxPerCycle={Max}, Throttle={Throttle}ms.",
            IntervalMinutes, MinAgeMinutes, LookbackDays, MaxOrdersPerCycle, DelayBetweenCallsMs);

        // Let the app finish starting before the first sweep.
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Never let a cycle failure kill the worker.
                _logger.LogError(ex, "MembershipDuesReconciliation cycle failed.");
            }

            try { await Task.Delay(TimeSpan.FromMinutes(IntervalMinutes), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        _logger.LogInformation("MembershipDuesReconciliation stopped.");
    }

    private sealed class PendingOrder
    {
        public int PkId { get; set; }
        public int DuesId { get; set; }
        public decimal Amount { get; set; }
        public string? TransactionId { get; set; }   // our merchant order_id
        public string? CfOrderId { get; set; }       // Cashfree's numeric id
        public DateTime CreatedDate { get; set; }
    }

    private async Task RunCycleAsync(CancellationToken ct)
    {
        var cf = _config.GetSection("CashfreePayment");
        var baseUrl = cf["BaseUrl"];
        var clientId = cf["ClientId"];
        var clientSecret = cf["ClientSecret"];
        var apiVersion = cf["ApiVersion"];

        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(clientId)
            || string.IsNullOrWhiteSpace(clientSecret) || string.IsNullOrWhiteSpace(apiVersion))
        {
            _logger.LogWarning("MembershipDuesReconciliation: CashfreePayment config incomplete — cycle skipped.");
            return;
        }

        List<PendingOrder> pending;
        using (var conn = new MySqlConnection(_connStr))
        {
            // Candidate set: online dues orders still sitting in the pre-payment state,
            // old enough that checkout is definitely over, young enough to be worth asking about.
            pending = (await conn.QueryAsync<PendingOrder>(@"
                SELECT pk_id AS PkId, fk_membership_dues_id AS DuesId, Amount,
                       TransactionId, CfOrderId, created_date AS CreatedDate
                FROM membership_dues_payments
                WHERE PaymentStatus='ACTIVE'
                  AND IsPaid=0
                  AND isdeleted=0
                  AND created_date < NOW() - INTERVAL @MinAge MINUTE
                  AND created_date > NOW() - INTERVAL @Lookback DAY
                ORDER BY created_date DESC
                LIMIT @Max",
                new { MinAge = MinAgeMinutes, Lookback = LookbackDays, Max = MaxOrdersPerCycle })).AsList();
        }

        if (pending.Count == 0)
        {
            _logger.LogInformation("MembershipDuesReconciliation: no ACTIVE unpaid dues orders in the last {Lookback}d older than {MinAge}m. Nothing to do.",
                LookbackDays, MinAgeMinutes);
            return;
        }

        _logger.LogInformation("MembershipDuesReconciliation: checking {Count} ACTIVE unpaid dues order(s) against Cashfree.", pending.Count);

        int markedPaid = 0, leftAlone = 0, unresolvable = 0, apiErrors = 0;

        foreach (var row in pending)
        {
            if (ct.IsCancellationRequested) break;

            try
            {
                // Resolve the only identifier Cashfree's REST API accepts.
                var merchantOrderId = ResolveMerchantOrderId(row);
                if (merchantOrderId == null)
                {
                    unresolvable++;
                    _logger.LogWarning(
                        "Dues payment {PaymentId} (dues {DuesId}, ₹{Amount}, created {Created:yyyy-MM-dd HH:mm}): NO merchant order_id stored " +
                        "(CfOrderId='{CfOrderId}' is Cashfree's numeric id, which the API rejects). Cannot reconcile via API — " +
                        "look this order up in the Cashfree Dashboard by cf_order_id. Row left untouched.",
                        row.PkId, row.DuesId, row.Amount, row.CreatedDate, row.CfOrderId);
                    continue;
                }

                var status = await FetchOrderStatusAsync(baseUrl!, clientId!, clientSecret!, apiVersion!, merchantOrderId, ct);

                if (status.Error != null)
                {
                    apiErrors++;
                    _logger.LogWarning(
                        "Dues payment {PaymentId} (order {OrderId}): Cashfree lookup failed — {Error}. Row left untouched.",
                        row.PkId, merchantOrderId, status.Error);
                    continue;
                }

                if (status.OrderStatus != "PAID")
                {
                    leftAlone++;
                    // The overwhelmingly common case: a genuinely abandoned checkout.
                    _logger.LogInformation(
                        "Dues payment {PaymentId} (order {OrderId}): Cashfree order_status={Status} — not paid, left alone.",
                        row.PkId, merchantOrderId, status.OrderStatus ?? "(none)");
                    continue;
                }

                // order_status says PAID. Confirm with the payments endpoint before touching money.
                var success = await HasSuccessfulPaymentAsync(baseUrl!, clientId!, clientSecret!, apiVersion!, merchantOrderId, ct);
                if (success.Error != null)
                {
                    apiErrors++;
                    _logger.LogWarning(
                        "Dues payment {PaymentId} (order {OrderId}): order_status=PAID but the payments lookup failed — {Error}. " +
                        "NOT marking paid without confirmation. Row left untouched.",
                        row.PkId, merchantOrderId, success.Error);
                    continue;
                }

                if (!success.HasSuccess)
                {
                    leftAlone++;
                    _logger.LogWarning(
                        "Dues payment {PaymentId} (order {OrderId}): order_status=PAID but NO payment with payment_status=SUCCESS " +
                        "(saw: {Statuses}). Left alone — this needs a human.",
                        row.PkId, merchantOrderId, success.StatusesSeen);
                    continue;
                }

                // Confirmed by the gateway. Mark paid through the SAME path the webhook uses.
                using var scope = _scopeFactory.CreateScope();
                var duesService = scope.ServiceProvider.GetRequiredService<IMembershipDuesService>();
                var flipped = await duesService.MarkOnlineDuesPaymentPaidAsync(
                    row.PkId, paidSource: "Reconciled", viaWebhook: false, requireActiveStatus: true);

                if (flipped)
                {
                    markedPaid++;
                    _logger.LogWarning(
                        "RECONCILED: dues payment {PaymentId} (dues {DuesId}, order {OrderId}, ₹{Amount}) confirmed PAID by Cashfree " +
                        "(payment_status=SUCCESS) but never marked in the portal — now marked paid, PaidSource='Reconciled'. " +
                        "The webhook for this order was lost.",
                        row.PkId, row.DuesId, merchantOrderId, row.Amount);
                }
                else
                {
                    leftAlone++;
                    _logger.LogInformation(
                        "Dues payment {PaymentId} (order {OrderId}): Cashfree says PAID but the guarded UPDATE affected 0 rows " +
                        "— another path (webhook/thank-you page) already marked it. No double-credit.",
                        row.PkId, merchantOrderId);
                }
            }
            catch (Exception ex)
            {
                // One bad order must never abort the sweep.
                apiErrors++;
                _logger.LogError(ex, "MembershipDuesReconciliation: unexpected error on dues payment {PaymentId}. Row left untouched.", row.PkId);
            }

            if (DelayBetweenCallsMs > 0 && !ct.IsCancellationRequested)
            {
                try { await Task.Delay(DelayBetweenCallsMs, ct); }
                catch (OperationCanceledException) { break; }
            }
        }

        _logger.LogInformation(
            "MembershipDuesReconciliation cycle done. Checked={Checked}, MarkedPaid={Paid}, LeftAlone={Left}, Unresolvable={Unresolvable}, ApiErrors={Errors}.",
            pending.Count, markedPaid, leftAlone, unresolvable, apiErrors);
    }

    // TransactionId holds our merchant order_id. CfOrderId is only usable if it is
    // NOT the numeric cf_order_id (older rows stored the merchant id there).
    private static string? ResolveMerchantOrderId(PendingOrder row)
    {
        if (!string.IsNullOrWhiteSpace(row.TransactionId))
            return row.TransactionId!.Trim();

        var cf = row.CfOrderId?.Trim();
        if (!string.IsNullOrWhiteSpace(cf) && !cf!.All(char.IsDigit))
            return cf;

        return null;
    }

    private readonly record struct OrderStatusResult(string? OrderStatus, string? Error);

    private async Task<OrderStatusResult> FetchOrderStatusAsync(
        string baseUrl, string clientId, string clientSecret, string apiVersion, string orderId, CancellationToken ct)
    {
        using var request = BuildRequest(HttpMethod.Get, $"{baseUrl}orders/{Uri.EscapeDataString(orderId)}", clientId, clientSecret, apiVersion);
        using var response = await _httpClient.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            return new OrderStatusResult(null, $"HTTP {(int)response.StatusCode}: {Truncate(body, 300)}");

        try
        {
            var order = JsonSerializer.Deserialize<JsonElement>(body);
            var status = order.TryGetProperty("order_status", out var s) ? s.GetString() : null;
            return new OrderStatusResult(status, null);
        }
        catch (JsonException ex)
        {
            return new OrderStatusResult(null, $"unparseable response: {ex.Message}");
        }
    }

    private readonly record struct PaymentsResult(bool HasSuccess, string StatusesSeen, string? Error);

    private async Task<PaymentsResult> HasSuccessfulPaymentAsync(
        string baseUrl, string clientId, string clientSecret, string apiVersion, string orderId, CancellationToken ct)
    {
        using var request = BuildRequest(HttpMethod.Get, $"{baseUrl}orders/{Uri.EscapeDataString(orderId)}/payments", clientId, clientSecret, apiVersion);
        using var response = await _httpClient.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            return new PaymentsResult(false, "", $"HTTP {(int)response.StatusCode}: {Truncate(body, 300)}");

        try
        {
            var payments = JsonSerializer.Deserialize<JsonElement>(body);
            if (payments.ValueKind != JsonValueKind.Array)
                return new PaymentsResult(false, "", "payments response was not an array");

            var seen = new List<string>();
            bool hasSuccess = false;
            foreach (var p in payments.EnumerateArray())
            {
                var ps = p.TryGetProperty("payment_status", out var v) ? v.GetString() : null;
                if (ps != null) seen.Add(ps);
                if (ps == "SUCCESS") hasSuccess = true;
            }
            return new PaymentsResult(hasSuccess, seen.Count > 0 ? string.Join(",", seen) : "(none)", null);
        }
        catch (JsonException ex)
        {
            return new PaymentsResult(false, "", $"unparseable response: {ex.Message}");
        }
    }

    private static HttpRequestMessage BuildRequest(HttpMethod method, string url, string clientId, string clientSecret, string apiVersion)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("x-client-id", clientId);
        request.Headers.Add("x-client-secret", clientSecret);
        request.Headers.Add("x-api-version", apiVersion);
        return request;
    }

    private static string Truncate(string s, int max) =>
        string.IsNullOrEmpty(s) ? "" : s.Length <= max ? s : s[..max] + "…";
}

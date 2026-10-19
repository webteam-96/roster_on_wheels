using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Razorpay-backed wallet top-up: club/district admins buy WhatsApp/Email credits.
// Pricing is server-authoritative; GST is added on top of the base amount; credits derive from
// the BASE amount only. A payment credits the wallet exactly once (atomic claim shared by the
// client verify callback and the webhook).
//
// NOTE (single webhook URL): Razorpay's dashboard has exactly ONE webhook registered, pointing at
// /api/wallet/webhook. Club-website and club-dues payments are created against the SAME Razorpay
// account, so their events land here too. HandleWebhookAsync therefore dispatches on the incoming
// RazorpayOrderId and hands non-wallet orders to the service that owns that table. Never let an
// unmatched order return silently — that is how paid orders were left un-marked.
public class WalletService : IWalletService
{
    private readonly string _conn;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ICreditManagementService _credit;
    private readonly IWebsiteBillingService _websiteBilling;
    private readonly IClubDuesService _clubDues;
    private readonly IConfiguration _config;
    private readonly ILogger<WalletService> _logger;

    public WalletService(IConfiguration config, IHttpClientFactory httpFactory,
        ICreditManagementService credit, IWebsiteBillingService websiteBilling,
        IClubDuesService clubDues, ILogger<WalletService> logger)
    {
        _config = config;
        _conn = config.GetConnectionString("DefaultConnection")!;
        _httpFactory = httpFactory;
        _credit = credit;
        _websiteBilling = websiteBilling;
        _clubDues = clubDues;
        _logger = logger;
    }

    private MySqlConnection NewConn() => new(_conn);

    // ── pricing ────────────────────────────────────────────────────────────
    private (int RatePaise, decimal MinAmount) PricingFor(string creditType)
    {
        var p = _config.GetSection("Razorpay:Pricing");
        return (p.GetValue("EmailRatePaise", 30), p.GetValue("EmailMinAmount", 500m));
    }
    private int GstPercent() => _config.GetValue("Razorpay:GstPercent", 18);

    private record Priced(bool Ok, string? Error, int Credits, decimal Min, long BasePaise,
        decimal BaseAmount, decimal Gst, decimal Total, long TotalPaise, int RatePaise);

    private Priced Compute(string creditType, decimal baseAmount)
    {
        // ROW has no WhatsApp (2026-10-19): email credits are the only top-up.
        if (creditType != "Email")
            return new Priced(false, "Invalid credit type.", 0, 0, 0, baseAmount, 0, 0, 0, 0);
        var (ratePaise, min) = PricingFor(creditType);
        if (baseAmount < min)
            return new Priced(false, $"Minimum top-up for {creditType} is ₹{min:0}.", 0, min, 0, baseAmount, 0, 0, 0, ratePaise);

        long basePaise = (long)Math.Round(baseAmount * 100m, MidpointRounding.AwayFromZero);
        int credits = (int)(basePaise / ratePaise);                       // floor; GST excluded
        decimal gst = Math.Round(baseAmount * GstPercent() / 100m, 2, MidpointRounding.AwayFromZero);
        decimal total = baseAmount + gst;
        long totalPaise = (long)Math.Round(total * 100m, MidpointRounding.AwayFromZero);
        return new Priced(true, null, credits, min, basePaise, baseAmount, gst, total, totalPaise, ratePaise);
    }

    public WalletQuoteResponseDto Quote(string creditType, decimal baseAmount)
    {
        var c = Compute(creditType, baseAmount);
        return new WalletQuoteResponseDto
        {
            CreditType = creditType, CreditCount = c.Credits, BaseAmount = c.BaseAmount,
            GstAmount = c.Gst, TotalAmount = c.Total, MinAmount = c.Min, Error = c.Error
        };
    }

    // ── create order ───────────────────────────────────────────────────────
    public async Task<CreateTopupOrderResponseDto> CreateTopupOrderAsync(CreateTopupOrderDto dto, int userId)
    {
        var scope = (dto.Scope ?? "").ToLowerInvariant();
        if (scope != "club" && scope != "district")
            throw new InvalidOperationException("Invalid scope.");

        var c = Compute(dto.CreditType, dto.Amount);
        if (!c.Ok) throw new InvalidOperationException(c.Error);

        await using var conn = NewConn();
        await conn.OpenAsync();

        int fkClubId, fkDistrictId;
        if (scope == "club")
        {
            if (dto.ClubId <= 0) throw new InvalidOperationException("ClubId required.");
            fkClubId = dto.ClubId;
            fkDistrictId = await conn.ExecuteScalarAsync<int>(
                "SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", new { Id = dto.ClubId });
            if (fkDistrictId <= 0) throw new InvalidOperationException("Club has no district.");
        }
        else
        {
            if (dto.DistrictId <= 0) throw new InvalidOperationException("DistrictId required.");
            fkClubId = 0;
            fkDistrictId = dto.DistrictId;
        }

        var topupOrderId = await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO wallet_topup_orders
                (fk_district_id, fk_club_id, ScopeType, CreditType, BaseAmount, GstAmount, TotalAmount,
                 CreditCount, RatePaise, Currency, PaymentStatus, IsCredited, created_by, created_date, isdeleted)
            VALUES (@District, @Club, @Scope, @Type, @Base, @Gst, @Total, @Credits, @Rate, 'INR', 'CREATED', 0, @User, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new { District = fkDistrictId, Club = fkClubId, Scope = scope, Type = dto.CreditType,
                  Base = c.BaseAmount, Gst = c.Gst, Total = c.Total, Credits = c.Credits, Rate = c.RatePaise, User = userId });

        var keyId = _config["Razorpay:KeyId"] ?? "";
        // Entity name (for the Razorpay description/notes so the accountant can sort by club/district).
        string entityName = scope == "club"
            ? (await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id", new { Id = fkClubId }) ?? $"Club {fkClubId}")
            : ("District " + (await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = fkDistrictId }) ?? fkDistrictId.ToString()));
        var razorpayOrderId = await CreateRazorpayOrderAsync(c.TotalPaise, $"WTP{topupOrderId}", topupOrderId, scope, dto.CreditType, entityName);

        await conn.ExecuteAsync(
            "UPDATE wallet_topup_orders SET RazorpayOrderId = @Rid, PaymentStatus = 'ACTIVE', modified_date = NOW() WHERE pk_id = @Id",
            new { Rid = razorpayOrderId, Id = topupOrderId });

        return new CreateTopupOrderResponseDto
        {
            TopupOrderId = topupOrderId, RazorpayOrderId = razorpayOrderId, KeyId = keyId,
            AmountPaise = c.TotalPaise, Currency = "INR", CreditCount = c.Credits,
            BaseAmount = c.BaseAmount, GstAmount = c.Gst, TotalAmount = c.Total
        };
    }

    private async Task<string> CreateRazorpayOrderAsync(long amountPaise, string receipt, long topupOrderId, string scope, string creditType, string entityName)
    {
        var baseUrl = (_config["Razorpay:BaseUrl"] ?? "https://api.razorpay.com/v1").TrimEnd('/');
        var keyId = _config["Razorpay:KeyId"];
        var keySecret = _config["Razorpay:KeySecret"];
        if (string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(keySecret)
            || keySecret!.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Razorpay is not configured.");

        var payload = new
        {
            amount = amountPaise,
            currency = "INR",
            receipt,
            // Accountant-friendly notes: club/district name + settlement account (credits are always the
            // normal Rotary account, whose last-4 is 2321).
            notes = new { topupOrderId = topupOrderId.ToString(), scope, creditType, clubName = entityName, description = $"{creditType} credits — {entityName}", accountLast4 = "2321" }
        };

        var http = _httpFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/orders")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{keyId}:{keySecret}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);

        var res = await http.SendAsync(req);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            _logger.LogError("Razorpay order create failed: {Status} {Body}", res.StatusCode, body);
            throw new InvalidOperationException("Payment gateway error creating order.");
        }
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("id").GetString()!;
    }

    // ── verify (client callback) ─────────────────────────────────────────────
    public async Task<VerifyTopupResponseDto> VerifyAndCreditAsync(VerifyTopupDto dto, int userId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();

        var order = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, fk_district_id, fk_club_id, CreditType, CreditCount, RazorpayOrderId, IsCredited
            FROM wallet_topup_orders WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = dto.TopupOrderId });
        if (order == null) return new VerifyTopupResponseDto { IsSuccess = false, Message = "Order not found." };
        if ((string?)order.RazorpayOrderId != dto.RazorpayOrderId)
            return new VerifyTopupResponseDto { IsSuccess = false, Message = "Order mismatch." };

        int fkClub = (int)order.fk_club_id;
        int fkDistrict = (int)order.fk_district_id;
        int creditCount = (int)order.CreditCount;
        bool alreadyCredited = Convert.ToBoolean(order.IsCredited);

        if (!alreadyCredited)
        {
            if (!RazorpayGatewayProxy.VerifyPaymentSignature(_config, dto.RazorpayOrderId, dto.RazorpayPaymentId, dto.RazorpaySignature))
                return new VerifyTopupResponseDto { IsSuccess = false, Message = "Payment signature verification failed." };
            await CreditOnceAsync(conn, dto.TopupOrderId, dto.RazorpayPaymentId, dto.RazorpaySignature, "verify", userId);
        }

        var balance = fkClub > 0
            ? await _credit.GetClubCreditBalanceAsync(fkClub)
            : await _credit.GetDistrictCreditBalanceAsync(fkDistrict);
        return new VerifyTopupResponseDto
        {
            IsSuccess = true, PaymentStatus = "PAID", CreditCount = creditCount,
            NewBalance = balance, Message = alreadyCredited ? "Already credited." : null
        };
    }

    // ── webhook ──────────────────────────────────────────────────────────────
    public async Task HandleWebhookAsync(string rawBody, string signatureHeader)
    {
        if (!RazorpayGatewayProxy.VerifyWebhookSignature(_config, rawBody, signatureHeader))
            throw new UnauthorizedAccessException("Invalid webhook signature.");

        string? razorpayOrderId = null, paymentId = null;
        try
        {
            using var doc = JsonDocument.Parse(rawBody);
            var root = doc.RootElement;
            var evt = root.TryGetProperty("event", out var e) ? e.GetString() : null;
            if (evt != "payment.captured" && evt != "order.paid") return;

            if (root.TryGetProperty("payload", out var payload))
            {
                if (payload.TryGetProperty("payment", out var pay) && pay.TryGetProperty("entity", out var payEnt))
                {
                    if (payEnt.TryGetProperty("order_id", out var oid)) razorpayOrderId = oid.GetString();
                    if (payEnt.TryGetProperty("id", out var pid)) paymentId = pid.GetString();
                }
                if (razorpayOrderId == null && payload.TryGetProperty("order", out var ord) && ord.TryGetProperty("entity", out var ordEnt)
                    && ordEnt.TryGetProperty("id", out var oid2))
                    razorpayOrderId = oid2.GetString();
            }
        }
        catch (Exception ex) { _logger.LogError(ex, "Razorpay webhook parse failed"); return; }

        if (string.IsNullOrWhiteSpace(razorpayOrderId))
        {
            _logger.LogWarning("Razorpay webhook: no order_id found in the payload — nothing can be marked paid.");
            return;
        }

        await using var conn = NewConn();
        await conn.OpenAsync();
        var order = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, IsCredited FROM wallet_topup_orders WHERE RazorpayOrderId = @Rid AND isdeleted = 0",
            new { Rid = razorpayOrderId });

        // ── wallet order: existing behaviour, unchanged ──────────────────────
        if (order != null)
        {
            if (Convert.ToBoolean(order.IsCredited)) return;

            await conn.ExecuteAsync(
                "UPDATE wallet_topup_orders SET IsWebhookReceived = 1, WebhookReceivedDate = NOW() WHERE pk_id = @Id",
                new { Id = (long)order.pk_id });
            await CreditOnceAsync(conn, (long)order.pk_id, paymentId ?? "", "", "webhook", 0);
            return;
        }

        // ── not a wallet order: this is the only registered webhook URL, so route it ──
        await DispatchNonWalletWebhookAsync(conn, razorpayOrderId!, rawBody, signatureHeader);
    }

    // Routes a verified Razorpay webhook whose order id is NOT a wallet top-up to the service that
    // owns that order table. Each owning service re-verifies the signature (same secret, same raw
    // body — deterministic pass) and runs its own idempotent mark-paid path; we deliberately do NOT
    // duplicate their SQL here. The only lookups done here are read-only existence probes.
    private async Task DispatchNonWalletWebhookAsync(MySqlConnection conn, string razorpayOrderId,
        string rawBody, string signatureHeader)
    {
        // 1) club website purchase / renewal → WebsiteBillingService
        var websiteOrderId = await conn.ExecuteScalarAsync<long?>(
            "SELECT pk_id FROM club_website_orders WHERE RazorpayOrderId = @Rid AND isdeleted = 0 LIMIT 1",
            new { Rid = razorpayOrderId });
        if (websiteOrderId != null)
        {
            _logger.LogInformation("Razorpay webhook {OrderId} is a club-website order (club_website_orders.pk_id={Id}) — routing to WebsiteBillingService.",
                razorpayOrderId, websiteOrderId);
            await _websiteBilling.HandleWebhookAsync(rawBody, signatureHeader);
            return;
        }

        // 2) district/club dues payment → ClubDuesService
        var duesPaymentId = await conn.ExecuteScalarAsync<long?>(
            "SELECT pk_club_dues_payment_id FROM club_dues_payments WHERE RazorpayOrderId = @Rid LIMIT 1",
            new { Rid = razorpayOrderId });
        if (duesPaymentId != null)
        {
            _logger.LogInformation("Razorpay webhook {OrderId} is a club-dues payment (club_dues_payments.pk={Id}) — routing to ClubDuesService.",
                razorpayOrderId, duesPaymentId);
            await _clubDues.HandleWebhookAsync(rawBody, signatureHeader);
            return;
        }

        // 3) nobody owns it — used to be a silent return, which is how paid orders went unnoticed.
        _logger.LogWarning("Razorpay webhook {OrderId} matched no wallet_topup_orders, club_website_orders or club_dues_payments row — payment NOT marked paid. Investigate this order id in the Razorpay dashboard.",
            razorpayOrderId);
    }

    // ── the exactly-once credit writer ───────────────────────────────────────
    private async Task CreditOnceAsync(MySqlConnection conn, long topupOrderId, string paymentId, string signature, string source, int userId)
    {
        // Atomic claim: only the caller that flips IsCredited 0→1 actually adds credits.
        var claimed = await conn.ExecuteAsync(@"
            UPDATE wallet_topup_orders
            SET IsCredited = 1, PaymentStatus = 'PAID',
                RazorpayPaymentId = COALESCE(NULLIF(@Pid,''), RazorpayPaymentId),
                RazorpaySignature = COALESCE(NULLIF(@Sig,''), RazorpaySignature),
                CreditedDate = NOW(), modified_date = NOW()
            WHERE pk_id = @Id AND IsCredited = 0",
            new { Pid = paymentId, Sig = signature, Id = topupOrderId });
        if (claimed == 0) return; // someone else already credited (verify/webhook race)

        var o = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT fk_district_id, fk_club_id, CreditType, CreditCount, RazorpayPaymentId, created_by
            FROM wallet_topup_orders WHERE pk_id = @Id", new { Id = topupOrderId });
        if (o == null) return;

        int fkClub = (int)o.fk_club_id, fkDistrict = (int)o.fk_district_id, credits = (int)o.CreditCount;
        string type = (string)o.CreditType;
        int by = userId > 0 ? userId : (int)o.created_by;
        var txn = (string?)o.RazorpayPaymentId ?? paymentId;

        var credit = await AddPurchasedCreditsAsync(conn, fkClub, fkDistrict, type, credits, txn, by);
        await conn.ExecuteAsync("UPDATE wallet_topup_orders SET fk_credit_id = @Cid, FromDate = @From, ToDate = @To WHERE pk_id = @Id",
            new { Cid = credit.Id, From = credit.FromDate, To = credit.ToDate, Id = topupOrderId });
        _logger.LogInformation("Wallet topup {Id} credited {Credits} {Type} (club={Club} district={District}) via {Source}",
            topupOrderId, credits, type, fkClub, fkDistrict, source);
    }

    // Scoped on BOTH fk_club_id AND fk_district_id (unlike CreditManagementService.AddCreditAsync,
    // whose dedup is club-only and would merge district pools). Extends an active pack or inserts new.
    private async Task<(int Id, DateTime FromDate, DateTime ToDate)> AddPurchasedCreditsAsync(MySqlConnection conn, int fkClubId, int fkDistrictId,
        string creditType, int credits, string? transactionId, int userId)
    {
        int months = _config.GetValue("Razorpay:CreditValidityMonths", 12);
        var newToDate = DateTime.Now.AddMonths(months);

        var currentBalance = await conn.ExecuteScalarAsync<int?>(@"
            SELECT SUM(CreditCount - UsedCount) FROM club_credits
            WHERE fk_club_id = @Club AND fk_district_id = @District AND CreditType = @Type
              AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { Club = fkClubId, District = fkDistrictId, Type = creditType }) ?? 0;

        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_credit_id AS Id, FromDate, ToDate FROM club_credits
            WHERE fk_club_id = @Club AND fk_district_id = @District AND CreditType = @Type
              AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate
            ORDER BY ToDate DESC LIMIT 1",
            new { Club = fkClubId, District = fkDistrictId, Type = creditType });

        if (existing != null)
        {
            var toDate = (DateTime)existing.ToDate > newToDate ? (DateTime)existing.ToDate : newToDate;
            await conn.ExecuteAsync(@"
                UPDATE club_credits
                SET CreditCount = CreditCount + @Add, ToDate = @ToDate, PreviousCount = @Prev,
                    TransactionId = @Txn, PaymentDate = NOW(), modified_by = @User, modified_date = NOW()
                WHERE pk_credit_id = @Id",
                new { Add = credits, ToDate = toDate, Prev = currentBalance, Txn = transactionId, User = userId, Id = (int)existing.Id });
            return ((int)existing.Id, (DateTime)existing.FromDate, toDate);
        }

        var newId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_credits (fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount,
                  PreviousCount, FromDate, ToDate, TransactionId, PaymentDate, IsActive, created_by, created_date, isdeleted)
            VALUES (@District, @Club, @Type, @Credits, 0, @Prev, NOW(), @ToDate, @Txn, NOW(), 1, @User, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new { District = fkDistrictId, Club = fkClubId, Type = creditType, Credits = credits,
                  Prev = currentBalance, ToDate = newToDate, Txn = transactionId, User = userId });
        return (newId, DateTime.Now, newToDate);
    }

    public async Task<(string Scope, int ClubId, int DistrictId)?> GetOrderScopeAsync(long topupOrderId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        var o = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT ScopeType, fk_club_id, fk_district_id FROM wallet_topup_orders WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = topupOrderId });
        if (o == null) return null;
        return ((string)o.ScopeType, (int)o.fk_club_id, (int)o.fk_district_id);
    }
}

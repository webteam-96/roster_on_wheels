using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Razorpay-backed club website purchase/renewal. Price is server-authoritative
// (₹10,999 + 18% GST). Payment CAPTURE (verify/webhook) is decoupled from PROVISIONING:
// verify/webhook only mark the order PAID and return immediately, so the browser never
// blocks. A background worker (WebsiteProvisioningBackgroundService) then claims paid orders
// exactly once and creates/renews the site (Plesk vhost + wildcard SSL) and emails the buyer —
// so provisioning completes even if the user leaves the page.
public class WebsiteBillingService : IWebsiteBillingService
{
    private readonly string _conn;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IClubWebsiteActivationService _activation;
    private readonly IEmailService _email;
    private readonly IConfiguration _config;
    private readonly ILogger<WebsiteBillingService> _logger;

    public WebsiteBillingService(IConfiguration config, IHttpClientFactory httpFactory,
        IClubWebsiteActivationService activation, IEmailService email, ILogger<WebsiteBillingService> logger)
    {
        _config = config;
        _conn = config.GetConnectionString("DefaultConnection")!;
        _httpFactory = httpFactory;
        _activation = activation;
        _email = email;
        _logger = logger;
    }

    private MySqlConnection NewConn() => new(_conn);

    // ── config / pricing ─────────────────────────────────────────────────────
    // New/Renewal/GST system-wide defaults come from WebsiteDefaultPricing (system_settings,
    // SuperAdmin-editable with OTP, appsettings as the seed) — resolved per call in ResolveConfigAsync.
    private int ValidityMonths() => _config.GetValue("Razorpay:WebsiteValidityMonths", 12);
    private string ParentDomain() => (_config.GetSection("PleskSettings")["ParentDomain"] ?? RotaryApi.Services.Brand.ClubSiteParentDomain).ToLowerInvariant();
    private string Prefix() => _config["Razorpay:WebsiteSubdomainPrefix"] ?? "rc";

    private record Priced(decimal Base, decimal Gst, decimal Total, long TotalPaise);

    // Per-club, per-Rotary-year resolved billing config. A club_website_pricing row for
    // (club, year) is the source of truth; with no row we fall back to the config default
    // (₹10,999 / 18% / normal gateway). RouteAccountAcc is the Razorpay acc_… id (only when
    // the gateway is 'route' AND the linked account is active & not deleted).
    private sealed record ClubBillingConfig(
        int YearId, decimal BaseAmount, decimal RenewalAmount, decimal GstPercent, string GatewayType,
        int? RouteAccountId, string? RouteAccountAcc);

    // Picks the New (BaseAmount) or Renewal (RenewalAmount) base, then adds GST. GST% is shared.
    private Priced PriceFrom(ClubBillingConfig c, bool isRenewal)
    {
        decimal b = isRenewal ? c.RenewalAmount : c.BaseAmount;
        decimal gst = Math.Round(b * c.GstPercent / 100m, 2, MidpointRounding.AwayFromZero);
        decimal total = b + gst;
        long paise = (long)Math.Round(total * 100m, MidpointRounding.AwayFromZero);
        return new Priced(b, gst, total, paise);
    }

    private async Task<int> ResolveYearIdAsync(MySqlConnection conn, int? yearId)
    {
        if (yearId.HasValue && yearId.Value > 0) return yearId.Value;
        var cur = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        return cur ?? 0;
    }

    // Single source of truth for a club's price + gateway in a given Rotary year — used by BOTH
    // the club-admin self-service flow and the SuperAdmin public reminder link, so the amount is
    // always server-authoritative (never client-supplied).
    private async Task<ClubBillingConfig> ResolveConfigAsync(MySqlConnection conn, int clubId, int? yearId)
    {
        int yr = await ResolveYearIdAsync(conn, yearId);
        var def = await WebsiteDefaultPricing.ResolveAsync(conn, _config);
        decimal baseAmount = def.NewAmount;
        decimal renewalAmount = def.RenewalAmount;
        decimal gstPercent = def.GstPercent;
        string gateway = "normal";
        if (yr > 0)
        {
            var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT BaseAmount AS baseAmount, RenewalAmount AS renewalAmount, GstPercent AS gstPercent, GatewayType AS gatewayType
                FROM club_website_pricing WHERE fk_club_id = @C AND fk_year_id = @Y LIMIT 1",
                new { C = clubId, Y = yr });
            if (row != null)
            {
                baseAmount = (decimal)row.baseAmount;
                // RenewalAmount is nullable (older rows) → fall back to the global default renewal price.
                renewalAmount = row.renewalAmount == null ? def.RenewalAmount : (decimal)row.renewalAmount;
                gstPercent = (decimal)row.gstPercent;
                gateway = ((string?)row.gatewayType ?? "normal").Trim().ToLowerInvariant();
                if (gateway != "route") gateway = "normal";
            }
        }
        // Global "route all" override: when on, EVERY club-website payment settles via Route to
        // the one global account, regardless of the per-club Normal/Route setting.
        if (await IsRouteAllAsync(conn)) gateway = "route";

        // The Route account is a single GLOBAL selection for ALL club-website payments
        // (system_settings key ClubWebsiteRouteAccountId), not per-club.
        int? raId = null; string? raAcc = null;
        if (gateway == "route")
            (raId, raAcc) = await ResolveGlobalRouteAccountAsync(conn);
        return new ClubBillingConfig(yr, baseAmount, renewalAmount, gstPercent, gateway, raId, raAcc);
    }

    private async Task<bool> IsRouteAllAsync(MySqlConnection conn)
    {
        var raw = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteRouteAll' LIMIT 1");
        return raw == "1" || string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase);
    }

    // The one Route linked account all club-website Route payments settle to. Returns (pk_id, acc_… id)
    // only when it is set AND the account is active; null otherwise (CreateOrder then surfaces a clear error).
    private async Task<(int? id, string? acc)> ResolveGlobalRouteAccountAsync(MySqlConnection conn)
    {
        var raw = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteRouteAccountId' LIMIT 1");
        if (!int.TryParse(raw, out var id) || id <= 0) return (null, null);
        var acc = await conn.ExecuteScalarAsync<string?>(
            "SELECT AccountId FROM razorpay_route_accounts WHERE pk_id = @Id AND IsActive = 1 AND isdeleted = 0 LIMIT 1",
            new { Id = id });
        return string.IsNullOrWhiteSpace(acc) ? (null, null) : (id, acc);
    }

    private static DateTime NewEndFrom(DateTime? currentEnd, int months)
    {
        var basis = (currentEnd.HasValue && currentEnd.Value > DateTime.Today) ? currentEnd.Value : DateTime.Today;
        return basis.AddMonths(months);
    }

    // Renewal window: a PAID, active website with more than this many days left cannot be
    // re-purchased/renewed yet (prevents premature/duplicate purchases). Trial, expired,
    // near-expiry (<= window), and clubs with no site can always buy/renew.
    private const int RenewalWindowDays = 30;
    private async Task<(bool allowed, string? reason, int daysRemaining)> CheckPurchaseAllowedAsync(MySqlConnection conn, int clubId)
    {
        var w = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsPurchased AS isPurchased, AmountPaid AS amountPaid, TransactionId AS transactionId,
                   DATEDIFF(EndDate, CURDATE()) AS daysRemaining
            FROM club_websites
            WHERE fk_club_id = @C AND COALESCE(isdeleted, 0) = 0
            ORDER BY created_date DESC LIMIT 1",
            new { C = clubId });
        if (w == null) return (true, null, 0);   // no site → can buy
        bool isPaid = Convert.ToBoolean(w.isPurchased)
            || ((decimal?)w.amountPaid ?? 0m) > 0m || !string.IsNullOrWhiteSpace((string?)w.transactionId);
        int daysRemaining = w.daysRemaining == null ? 0 : (int)w.daysRemaining;
        if (isPaid && daysRemaining > RenewalWindowDays)
            return (false, $"Your club website is active with {daysRemaining} days remaining. Renewal opens in the last {RenewalWindowDays} days before it expires.", daysRemaining);
        return (true, null, daysRemaining);
    }

    // ── quote ──────────────────────────────────────────────────────────────
    public async Task<WebsiteQuoteResponseDto> QuoteAsync(int clubId, int? yearId = null)
    {
        int months = ValidityMonths();

        await using var conn = NewConn();
        await conn.OpenAsync();
        var cfg = await ResolveConfigAsync(conn, clubId, yearId);
        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, Subdomain, Status, EndDate FROM club_websites WHERE fk_club_id = @C AND isdeleted = 0 LIMIT 1",
            new { C = clubId });
        // A club that already has a site is renewing → price with the Renewal amount.
        bool isRenewal = existing != null;
        var p = PriceFrom(cfg, isRenewal);

        var dto = new WebsiteQuoteResponseDto
        {
            ValidityMonths = months,
            BaseAmount = p.Base, GstAmount = p.Gst, GstPercent = (int)Math.Round(cfg.GstPercent), TotalAmount = p.Total,
            SubdomainPrefix = Prefix(), ParentDomain = ParentDomain(),
            GatewayType = cfg.GatewayType
        };
        if (existing != null)
        {
            DateTime? curEnd = existing.EndDate == null ? (DateTime?)null : (DateTime)existing.EndDate;
            dto.OrderType = "Renewal";
            // Return ONLY the bare label — clients (web AND mobile) append the parent domain, so a
            // stored full host ("club.example.org") must not include it or it double-appends.
            dto.CurrentSubdomain = WebsiteDomainHelper.BareSubdomain((string?)existing.Subdomain);
            dto.CurrentEndDate = curEnd;
            dto.NewEndDate = NewEndFrom(curEnd, months);
        }
        else
        {
            dto.OrderType = "New";
            dto.NewEndDate = DateTime.Today.AddMonths(months);
        }

        // An active paid site with > renewal window days left can't be purchased/renewed yet.
        var (allowed, reason, daysRemaining) = await CheckPurchaseAllowedAsync(conn, clubId);
        dto.CanPurchase = allowed;
        dto.PurchaseBlockedReason = reason;
        dto.DaysRemaining = daysRemaining;
        return dto;
    }

    // ── subdomain checks ─────────────────────────────────────────────────────
    public SubdomainCheckResponseDto ValidateSubdomainInput(string? input)
    {
        var err = WebsiteDomainHelper.ValidatePurchaseSubdomainInput(input);
        var label = WebsiteDomainHelper.BuildPurchaseLabel(input);
        return new SubdomainCheckResponseDto { Label = label, Available = err == null, Reason = err };
    }

    public async Task<SubdomainCheckResponseDto> CheckSubdomainAsync(string? input, int? clubId = null)
    {
        var res = ValidateSubdomainInput(input);
        if (!res.Available) return res;   // format error already set

        await using var conn = NewConn();
        await conn.OpenAsync();
        var (ok, reason) = await IsLabelFreeAsync(conn, res.Label, clubId);
        res.Available = ok;
        res.Reason = reason;
        return res;
    }

    // How long a not-yet-paid order "reserves" a subdomain. After this window an abandoned/failed
    // order no longer holds the subdomain — otherwise a subdomain could be locked forever by a
    // checkout that was never completed.
    private const int ReservationWindowMinutes = 30;

    // Free = not held by a live club_websites row AND not reserved by a RECENT, still-pending order
    // from a DIFFERENT club. The requesting club's OWN pending orders never block it, so a failed or
    // abandoned payment can always be retried with the same subdomain.
    private async Task<(bool Ok, string? Reason)> IsLabelFreeAsync(MySqlConnection conn, string label, int? requestingClubId = null)
    {
        var taken = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_websites WHERE Subdomain = @S AND isdeleted = 0", new { S = label });
        if (taken > 0) return (false, "This subdomain is already taken.");

        var reserved = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_website_orders
            WHERE Subdomain = @S AND IsProvisioned = 0 AND PaymentStatus IN ('CREATED','ACTIVE') AND isdeleted = 0
              AND (@ClubId IS NULL OR fk_club_id <> @ClubId)
              AND created_date >= (NOW() - INTERVAL @Mins MINUTE)",
            new { S = label, ClubId = requestingClubId, Mins = ReservationWindowMinutes });
        if (reserved > 0) return (false, "This subdomain is being purchased by another club right now.");

        return (true, null);
    }

    // ── create order ─────────────────────────────────────────────────────────
    public async Task<CreateWebsiteOrderResponseDto> CreateOrderAsync(CreateWebsiteOrderDto dto, int userId, int? yearId = null)
    {
        if (dto.ClubId <= 0) throw new InvalidOperationException("ClubId required.");
        int months = ValidityMonths();

        await using var conn = NewConn();
        await conn.OpenAsync();

        // Guard: an active paid site with more than the renewal window left can't be re-purchased yet.
        var (allowed, blockReason, _) = await CheckPurchaseAllowedAsync(conn, dto.ClubId);
        if (!allowed) throw new InvalidOperationException(blockReason ?? "This club's website is active — renewal is not open yet.");

        // Price + gateway resolved server-side from the per-club/year config (never client-supplied).
        // Price picked below once we know New vs Renewal.
        var cfg = await ResolveConfigAsync(conn, dto.ClubId, yearId);
        if (cfg.GatewayType == "route" && string.IsNullOrWhiteSpace(cfg.RouteAccountAcc))
            throw new InvalidOperationException("This club is set to Razorpay Route but has no valid linked account configured. Please contact the Rotary office.");

        int fkDistrictId = await conn.ExecuteScalarAsync<int>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", new { Id = dto.ClubId });
        if (fkDistrictId <= 0) throw new InvalidOperationException("Club has no district.");

        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, Subdomain FROM club_websites WHERE fk_club_id = @C AND isdeleted = 0 LIMIT 1",
            new { C = dto.ClubId });

        string orderType, label;
        int? themeId = null;
        if (existing != null)
        {
            orderType = "Renewal";
            label = (string)existing.Subdomain;   // subdomain never changes on renewal
        }
        else
        {
            orderType = "New";
            var err = WebsiteDomainHelper.ValidatePurchaseSubdomainInput(dto.SubdomainInput);
            if (err != null) throw new InvalidOperationException(err);
            label = WebsiteDomainHelper.BuildPurchaseLabel(dto.SubdomainInput);
            // Release this club's own earlier unprovisioned attempts on the same subdomain (a prior
            // failed/abandoned payment) so re-initiating the purchase is always possible.
            await conn.ExecuteAsync(@"
                UPDATE club_website_orders SET isdeleted = 1, modified_date = NOW()
                WHERE fk_club_id = @C AND Subdomain = @S AND IsProvisioned = 0
                  AND PaymentStatus IN ('CREATED','ACTIVE') AND isdeleted = 0",
                new { C = dto.ClubId, S = label });
            var (free, reason) = await IsLabelFreeAsync(conn, label, dto.ClubId);
            if (!free) throw new InvalidOperationException(reason ?? "Subdomain unavailable.");

            themeId = dto.ThemeId.HasValue && dto.ThemeId > 0
                ? dto.ThemeId
                : await conn.ExecuteScalarAsync<int?>(
                    "SELECT pk_theme_id FROM theme_master WHERE isdeleted = 0 ORDER BY pk_theme_id ASC LIMIT 1");
            if (themeId == null || themeId <= 0) throw new InvalidOperationException("No website template is available.");
        }

        // Now that New vs Renewal is known, resolve the amount (Renewal uses RenewalAmount).
        var p = PriceFrom(cfg, orderType == "Renewal");

        int reminderDays = dto.ReminderDays > 0 ? dto.ReminderDays : _config.GetValue("Razorpay:WebsiteDefaultReminderDays", 15);

        var orderId = await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO club_website_orders
                (fk_club_id, fk_district_id, OrderType, Subdomain, fk_theme_id, ReminderDays, ValidityMonths,
                 BaseAmount, GstAmount, TotalAmount, Currency, GatewayType, fk_route_account_id,
                 PaymentStatus, IsProvisioned, created_by, created_date, isdeleted)
            VALUES (@Club, @District, @Type, @Sub, @Theme, @Rem, @Months,
                 @Base, @Gst, @Total, 'INR', @Gateway, @RouteAccountId, 'CREATED', 0, @User, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new { Club = dto.ClubId, District = fkDistrictId, Type = orderType, Sub = label, Theme = themeId,
                  Rem = reminderDays, Months = months, Base = p.Base, Gst = p.Gst, Total = p.Total,
                  Gateway = cfg.GatewayType, RouteAccountId = cfg.RouteAccountId, User = userId });

        var keyId = _config["Razorpay:KeyId"] ?? "";
        // Accountant-friendly metadata: club name + which account settles this payment. A normal order
        // settles to the main Rotary account (last-4 = 2321); a Route order settles to the linked account
        // (its bank last-4 isn't stored, so we record the Route account's name).
        var clubName = await conn.ExecuteScalarAsync<string?>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @C", new { C = dto.ClubId }) ?? $"Club {dto.ClubId}";
        string accountNote = cfg.GatewayType == "route"
            ? (await conn.ExecuteScalarAsync<string?>("SELECT Name FROM razorpay_route_accounts WHERE pk_id = @Id", new { Id = cfg.RouteAccountId }) ?? "route")
            : "2321";
        var razorpayOrderId = await CreateRazorpayOrderAsync(p.TotalPaise, $"CWO{orderId}", orderId, dto.ClubId, orderType,
            cfg.GatewayType == "route" ? cfg.RouteAccountAcc : null, clubName, accountNote);

        await conn.ExecuteAsync(
            "UPDATE club_website_orders SET RazorpayOrderId = @Rid, PaymentStatus = 'ACTIVE', modified_date = NOW() WHERE pk_id = @Id",
            new { Rid = razorpayOrderId, Id = orderId });

        return new CreateWebsiteOrderResponseDto
        {
            WebsiteOrderId = orderId, RazorpayOrderId = razorpayOrderId, KeyId = keyId,
            AmountPaise = p.TotalPaise, Currency = "INR", OrderType = orderType, Subdomain = label,
            BaseAmount = p.Base, GstAmount = p.Gst, TotalAmount = p.Total, ClubName = clubName
        };
    }

    // routeAccountId (acc_…) set => Razorpay Route: transfer the FULL amount to that one linked account
    // (platform keeps nothing). Null => plain order (unchanged behaviour). Ref https://razorpay.com/docs/api/payments/route
    private async Task<string> CreateRazorpayOrderAsync(long amountPaise, string receipt, long websiteOrderId, int clubId, string orderType, string? routeAccountId = null, string clubName = "", string accountLast4 = "2321")
    {
        var baseUrl = (_config["Razorpay:BaseUrl"] ?? "https://api.razorpay.com/v1").TrimEnd('/');
        var keyId = _config["Razorpay:KeyId"];
        var keySecret = _config["Razorpay:KeySecret"];
        if (string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(keySecret)
            || keySecret!.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Razorpay is not configured.");

        var notes = new { websiteOrderId = websiteOrderId.ToString(), clubId = clubId.ToString(), orderType, clubName, description = $"Club website {orderType} — {clubName}", accountLast4 };
        object payload = string.IsNullOrWhiteSpace(routeAccountId)
            ? new { amount = amountPaise, currency = "INR", receipt, notes }
            : new
            {
                amount = amountPaise,
                currency = "INR",
                receipt,
                notes,
                transfers = new[]
                {
                    new { account = routeAccountId, amount = amountPaise, currency = "INR", on_hold = 0 }
                }
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
            _logger.LogError("Razorpay website order create failed: {Status} {Body}", res.StatusCode, body);
            throw new InvalidOperationException("Payment gateway error creating order.");
        }
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("id").GetString()!;
    }

    // ── verify (client callback) — captures payment only; worker provisions ──────
    public async Task<VerifyWebsiteOrderResponseDto> VerifyPaymentAsync(VerifyWebsiteOrderDto dto, int userId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();

        var order = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, OrderType, Subdomain, RazorpayOrderId, PaymentStatus FROM club_website_orders WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = dto.WebsiteOrderId });
        if (order == null)
        {
            _logger.LogWarning("Website verify failed: order {WebsiteOrderId} not found (razorpay order {RazorpayOrderId}, payment {PaymentId}).",
                dto.WebsiteOrderId, dto.RazorpayOrderId, dto.RazorpayPaymentId);
            return new VerifyWebsiteOrderResponseDto { IsSuccess = false, Message = "Order not found." };
        }
        if ((string?)order.RazorpayOrderId != dto.RazorpayOrderId)
        {
            _logger.LogWarning("Website verify failed: order mismatch for order {WebsiteOrderId} — stored razorpay order {StoredOrderId}, posted {PostedOrderId} (payment {PaymentId}).",
                dto.WebsiteOrderId, (string?)order.RazorpayOrderId, dto.RazorpayOrderId, dto.RazorpayPaymentId);
            return new VerifyWebsiteOrderResponseDto { IsSuccess = false, Message = "Order mismatch." };
        }

        bool alreadyPaid = (string?)order.PaymentStatus == "PAID";
        if (!alreadyPaid)
        {
            if (!RazorpayGatewayProxy.VerifyPaymentSignature(_config, dto.RazorpayOrderId, dto.RazorpayPaymentId, dto.RazorpaySignature))
            {
                _logger.LogWarning("Website verify failed: payment signature verification failed for order {WebsiteOrderId} (razorpay order {RazorpayOrderId}, payment {PaymentId}). Order left UNPAID.",
                    dto.WebsiteOrderId, dto.RazorpayOrderId, dto.RazorpayPaymentId);
                return new VerifyWebsiteOrderResponseDto { IsSuccess = false, Message = "Payment signature verification failed." };
            }
            await MarkPaidAsync(conn, dto.WebsiteOrderId, dto.RazorpayPaymentId, dto.RazorpaySignature);
        }

        // Provisioning is handed off to WebsiteProvisioningBackgroundService so it completes even
        // if the user leaves this page. Return immediately with a "Provisioning" status.
        return new VerifyWebsiteOrderResponseDto
        {
            IsSuccess = true,
            PaymentStatus = "PAID",
            OrderType = (string)order.OrderType,
            Subdomain = (string)order.Subdomain,
            ProvisionStatus = "Provisioning",
            Message = "Payment received. Your website is being set up in the background."
        };
    }

    // Idempotent payment capture. Provisioning is claimed separately by the worker.
    private async Task MarkPaidAsync(MySqlConnection conn, long orderId, string paymentId, string signature)
    {
        await conn.ExecuteAsync(@"
            UPDATE club_website_orders
            SET PaymentStatus = 'PAID',
                RazorpayPaymentId = COALESCE(NULLIF(@Pid,''), RazorpayPaymentId),
                RazorpaySignature = COALESCE(NULLIF(@Sig,''), RazorpaySignature),
                modified_date = NOW()
            WHERE pk_id = @Id AND PaymentStatus <> 'PAID'",
            new { Pid = paymentId, Sig = signature, Id = orderId });
    }

    // ── webhook — also just captures payment; worker provisions ─────────────────
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
        catch (Exception ex) { _logger.LogError(ex, "Razorpay website webhook parse failed"); return; }

        if (string.IsNullOrWhiteSpace(razorpayOrderId)) return;

        await using var conn = NewConn();
        await conn.OpenAsync();
        var order = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, PaymentStatus FROM club_website_orders WHERE RazorpayOrderId = @Rid AND isdeleted = 0",
            new { Rid = razorpayOrderId });
        if (order == null)
        {
            _logger.LogWarning("Website webhook: no club_website_orders row for razorpay order {RazorpayOrderId} (payment {PaymentId}) — nothing marked paid.",
                razorpayOrderId, paymentId);
            return;
        }

        await conn.ExecuteAsync(
            "UPDATE club_website_orders SET IsWebhookReceived = 1, WebhookReceivedDate = NOW() WHERE pk_id = @Id",
            new { Id = (long)order.pk_id });
        if ((string?)order.PaymentStatus != "PAID")
            await MarkPaidAsync(conn, (long)order.pk_id, paymentId ?? "", "");
    }

    // ── background provisioner (driven by WebsiteProvisioningBackgroundService) ──
    public async Task<List<long>> GetPaidUnprovisionedOrderIdsAsync(int limit)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        var ids = await conn.QueryAsync<long>(@"
            SELECT pk_id FROM club_website_orders
            WHERE PaymentStatus = 'PAID' AND IsProvisioned = 0 AND isdeleted = 0
            ORDER BY pk_id ASC LIMIT @Lim", new { Lim = limit });
        return ids.ToList();
    }

    // Exactly-once: atomic claim on IsProvisioned (PAID only), then create/renew + activate, then email the buyer.
    public async Task ProvisionPaidOrderAsync(long orderId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();

        var claimed = await conn.ExecuteAsync(@"
            UPDATE club_website_orders
            SET IsProvisioned = 1, ProvisionedDate = NOW(), modified_date = NOW()
            WHERE pk_id = @Id AND IsProvisioned = 0 AND PaymentStatus = 'PAID'",
            new { Id = orderId });
        if (claimed == 0) return; // already claimed by another tick/instance

        var o = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT fk_club_id, fk_district_id, OrderType, Subdomain, fk_theme_id, ReminderDays,
                   ValidityMonths, TotalAmount, RazorpayPaymentId, created_by
            FROM club_website_orders WHERE pk_id = @Id", new { Id = orderId });
        if (o == null) return;

        int clubId = (int)o.fk_club_id;
        int by = (int)o.created_by;
        int months = o.ValidityMonths == null ? ValidityMonths() : (int)o.ValidityMonths;
        int reminderDays = o.ReminderDays == null ? _config.GetValue("Razorpay:WebsiteDefaultReminderDays", 15) : (int)o.ReminderDays;
        decimal total = (decimal)o.TotalAmount;
        string label = (string)o.Subdomain;
        string orderType = (string)o.OrderType;
        var txn = (string?)o.RazorpayPaymentId;

        string provisionStatus = "Active";
        int? websiteId = null;
        DateTime? orderStartDate = null, orderEndDate = null;

        try
        {
            if (orderType == "Renewal")
            {
                var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
                    "SELECT pk_id, Status, EndDate FROM club_websites WHERE fk_club_id = @C AND isdeleted = 0 LIMIT 1",
                    new { C = clubId });
                if (existing != null)
                {
                    websiteId = (int)existing.pk_id;
                    DateTime? curEnd = existing.EndDate == null ? (DateTime?)null : (DateTime)existing.EndDate;
                    var newEnd = NewEndFrom(curEnd, months);
                    // This renewal's coverage starts the day after the prior period ended (continuous
                    // coverage), or today if there was no prior end date.
                    orderStartDate = curEnd?.AddDays(1) ?? DateTime.Today;
                    orderEndDate = newEnd;
                    await conn.ExecuteAsync(@"
                        UPDATE club_websites
                        SET EndDate = @End, Status = 'Active', AmountPaid = @Paid, TransactionId = @Txn,
                            PaymentDate = CURDATE(), PaymentMode = 'Razorpay', ReminderDays = @Rem,
                            modified_by = @By, modified_date = NOW()
                        WHERE pk_id = @Id",
                        new { End = newEnd, Paid = total, Txn = txn, Rem = reminderDays, By = by, Id = websiteId });
                    await LogWebsiteAsync(conn, websiteId.Value, "Renewed", $"Renewed to {newEnd:yyyy-MM-dd} via Razorpay (worker)", by);

                    // Re-activation is UNCONDITIONAL for every non-live status — a member who has PAID
                    // must end up with a live site, so we never skip it behind a status allow-list.
                    // This previously only fired for 'Inactive'/'ActivationFailed', which silently left
                    // 'Expired' (by far the most common lapsed state) and any legacy/blank status
                    // half-renewed: the date moved but the Plesk vhost, docroot, wildcard cert and the
                    // club-site cache purge were never re-checked, and ProvisionStatus was reported
                    // 'Active' without anything having verified it.
                    // ActivateAsync is idempotent — an existing Plesk subdomain is reused (docroot
                    // re-pointed, cert re-assigned), Status is flipped to Active and the cache purged.
                    // Sites already 'Active' (early renewal inside the renewal window) need none of
                    // that; the date extension above is the whole job.
                    var status = ((string?)existing.Status ?? "").Trim();
                    if (!string.Equals(status, "Active", StringComparison.OrdinalIgnoreCase))
                    {
                        var act = await _activation.ActivateAsync(conn, websiteId.Value, by, false, "RenewalProvision");
                        provisionStatus = act.ActivationFailed ? "ActivationFailed" : "Active";
                        _logger.LogInformation(
                            "Website order {Id}: renewal re-activated club {Club} website {WebsiteId} from status '{Previous}' → {Result}.",
                            orderId, clubId, websiteId, status.Length == 0 ? "(blank)" : status, provisionStatus);
                    }
                }
                else
                {
                    // No LIVE club_websites row for a "Renewal": either the club never had one, or the
                    // row was soft-deleted (isdeleted = 1) between order creation and provisioning.
                    // Soft-deleted rows are deliberately left untouched — their Plesk vhost and
                    // subdomain name are already released — so the paying club is given a fresh site
                    // via the "New" path below rather than resurrecting a deleted record.
                    var softDeleted = await conn.ExecuteScalarAsync<int>(
                        "SELECT COUNT(*) FROM club_websites WHERE fk_club_id = @C AND isdeleted = 1", new { C = clubId });
                    _logger.LogWarning(
                        "Website order {Id}: Renewal for club {Club} found no live club_websites row ({Deleted} soft-deleted row(s) left alone) — provisioning as New.",
                        orderId, clubId, softDeleted);
                    orderType = "New"; // no live record for a "Renewal" (edge case) → provision as new below
                }
            }

            if (orderType == "New")
            {
                var (free, _) = await IsLabelFreeAsync(conn, label);
                var clubHasRow = await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM club_websites WHERE fk_club_id = @C AND isdeleted = 0", new { C = clubId });
                if (!free || clubHasRow > 0)
                {
                    provisionStatus = "ActivationFailed";
                    _logger.LogWarning("Website order {Id}: subdomain '{Label}' unavailable or club {Club} already has a site at provision time.", orderId, label, clubId);
                }
                else
                {
                    try
                    {
                        var newEnd = DateTime.Today.AddMonths(months);
                        orderStartDate = DateTime.Today;
                        orderEndDate = newEnd;
                        websiteId = await conn.ExecuteScalarAsync<int>(@"
                            INSERT INTO club_websites
                                (fk_club_id, Subdomain, ClientDomain, fk_theme_id, StartDate, EndDate, Status,
                                 ReminderDays, AmountPaid, TransactionId, PaymentDate, PaymentMode, created_by)
                            VALUES (@Club, @Sub, NULL, @Theme, CURDATE(), @End, 'Inactive',
                                 @Rem, @Paid, @Txn, CURDATE(), 'Razorpay', @By);
                            SELECT LAST_INSERT_ID();",
                            new { Club = clubId, Sub = label, Theme = (int?)o.fk_theme_id, End = newEnd,
                                  Rem = reminderDays, Paid = total, Txn = txn, By = by });
                        await LogWebsiteAsync(conn, websiteId.Value, "Purchased", "Website purchased via Razorpay (worker)", by);

                        await ClubWebsiteMenuSeeder.SeedDefaultMenusAsync(conn, clubId, by);

                        var act = await _activation.ActivateAsync(conn, websiteId.Value, by, false, "PurchaseProvision");
                        provisionStatus = act.ActivationFailed ? "ActivationFailed" : "Active";
                    }
                    catch (MySqlException ex) when (ex.Number == 1062)   // uk_subdomain race
                    {
                        provisionStatus = "ActivationFailed";
                        _logger.LogWarning(ex, "Website order {Id}: duplicate subdomain '{Label}' on insert.", orderId, label);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            provisionStatus = "ActivationFailed";
            _logger.LogError(ex, "Website order {Id} provisioning failed after payment.", orderId);
        }

        await conn.ExecuteAsync(
            "UPDATE club_website_orders SET fk_website_id = @Wid, ProvisionStatus = @PS, StartDate = @Start, EndDate = @End, modified_date = NOW() WHERE pk_id = @Id",
            new { Wid = websiteId, PS = provisionStatus, Start = orderStartDate, End = orderEndDate, Id = orderId });
        _logger.LogInformation("Website order {Id} provisioned ({Type}, {Status}) club={Club}", orderId, orderType, provisionStatus, clubId);

        if (provisionStatus == "Active" && websiteId != null)
            await SendBuyerReadyEmailAsync(conn, clubId, by, label, websiteId.Value);
    }

    // ProvisionPaidOrderAsync's claim (IsProvisioned=1, set BEFORE any actual work) and its
    // final status write (ProvisionStatus, set AFTER all work) are two separate statements.
    // If the process restarts/crashes in between — an app-pool recycle mid-provision is the
    // realistic case — the order is orphaned: IsProvisioned=1 means it will never be retried,
    // but ProvisionStatus is still stuck at its initial 'Provisioning' value forever, even
    // though the site itself may already be live (club_websites.Status went 'Active' earlier
    // in the same crashed run, well before the final order write). The frontend toast reads
    // ProvisionStatus, so the user sees "Setting up your website…" indefinitely while the
    // dashboard's own (differently-sourced) badge already says Active.
    //
    // Called every tick from the background service. A 10-minute grace period avoids racing
    // a order that is still genuinely mid-provision (Plesk/SSL calls can take a little while).
    // If the club already has an Active website, the order just never got its own status/email
    // — both are completed here. The email is safe to (re)send: this can only fire for orders
    // whose crash happened strictly before the final DB write, which in the normal flow is
    // strictly before the email send too, so there is no double-send path.  If the club still
    // has no active website after the grace period, provisioning genuinely never finished, so
    // the order is marked ActivationFailed instead of hanging forever.
    public async Task ReconcileStaleProvisioningOrdersAsync()
    {
        await using var conn = NewConn();
        await conn.OpenAsync();

        // ProvisionStatus is NULL until the final write, not the literal string
        // 'Provisioning' (that string only ever exists in the synthesized frontend/BuildStatusAsync
        // status, never in this column) — confirmed against live data, where every genuinely stuck
        // row had ProvisionStatus IS NULL. The 'Provisioning' literal is still matched defensively
        // in case some other path ever writes it.
        var stale = await conn.QueryAsync<dynamic>(@"
            SELECT pk_id, fk_club_id, Subdomain, created_by
            FROM club_website_orders
            WHERE IsProvisioned = 1 AND (ProvisionStatus IS NULL OR ProvisionStatus = 'Provisioning')
              AND ProvisionedDate IS NOT NULL AND ProvisionedDate < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
              AND isdeleted = 0");

        foreach (var o in stale)
        {
            long orderId = (long)o.pk_id;
            int clubId = (int)o.fk_club_id;
            string label = (string)o.Subdomain;
            int by = (int)o.created_by;

            var website = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_id, Status, StartDate, EndDate FROM club_websites WHERE fk_club_id = @C AND isdeleted = 0 LIMIT 1",
                new { C = clubId });

            if (website != null && string.Equals((string?)website.Status, "Active", StringComparison.OrdinalIgnoreCase))
            {
                int websiteId = (int)website.pk_id;
                await conn.ExecuteAsync(
                    "UPDATE club_website_orders SET fk_website_id = @Wid, ProvisionStatus = 'Active', StartDate = @Start, EndDate = @End, modified_date = NOW() WHERE pk_id = @Id",
                    new { Wid = websiteId, Start = (DateTime?)website.StartDate, End = (DateTime?)website.EndDate, Id = orderId });
                _logger.LogWarning(
                    "Website order {Id}: reconciled stale 'Provisioning' status to Active (club {Club} website {WebsiteId} was already live).",
                    orderId, clubId, websiteId);
                await SendBuyerReadyEmailAsync(conn, clubId, by, label, websiteId);
            }
            else
            {
                await conn.ExecuteAsync(
                    "UPDATE club_website_orders SET ProvisionStatus = 'ActivationFailed', modified_date = NOW() WHERE pk_id = @Id",
                    new { Id = orderId });
                _logger.LogError(
                    "Website order {Id}: reconciled stale 'Provisioning' status to ActivationFailed (club {Club} still has no active website after 10+ minutes).",
                    orderId, clubId);
            }
        }
    }

    // Emails the purchasing club admin (created_by) that their website is live.
    private async Task SendBuyerReadyEmailAsync(MySqlConnection conn, int clubId, int buyerId, string label, int websiteId)
    {
        try
        {
            var buyer = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id", new { Id = buyerId });
            var email = (string?)buyer?.EmailId;
            if (string.IsNullOrWhiteSpace(email)) return;

            var clubName = await conn.ExecuteScalarAsync<string?>(
                "SELECT ClubName FROM club_master WHERE pk_club_id = @C", new { C = clubId }) ?? "";
            var w = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT ClientDomain, StartDate, EndDate FROM club_websites WHERE pk_id = @Id", new { Id = websiteId });
            var start = w?.StartDate == null ? DateTime.Today : (DateTime)w.StartDate;
            var end = w?.EndDate == null ? DateTime.Today.AddMonths(ValidityMonths()) : (DateTime)w.EndDate;

            await _email.SendClubWebsiteActivationEmailAsync(
                email!, (string?)buyer?.MemberName ?? "", clubName, "Club Admin",
                $"{label}.{ParentDomain()}", (string?)w?.ClientDomain, start, end,
                ccEmail: RotaryApi.Services.Brand.InternalCc);
            _logger.LogInformation("Sent 'website ready' email to buyer {Buyer} for club {Club}", buyerId, clubId);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Buyer 'website ready' email failed for club {Club}", clubId); }
    }

    // ── status (for the frontend notification card) ──────────────────────────────
    public async Task<WebsiteOrderStatusDto?> GetOrderStatusAsync(long orderId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        var o = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, fk_club_id, OrderType, Subdomain, PaymentStatus, IsProvisioned, ProvisionStatus, fk_website_id FROM club_website_orders WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = orderId });
        return o == null ? null : await BuildStatusAsync(conn, o);
    }

    public async Task<WebsiteOrderStatusDto?> GetLatestOrderForClubAsync(int clubId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        var o = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, fk_club_id, OrderType, Subdomain, PaymentStatus, IsProvisioned, ProvisionStatus, fk_website_id FROM club_website_orders WHERE fk_club_id = @C AND isdeleted = 0 ORDER BY pk_id DESC LIMIT 1",
            new { C = clubId });
        return o == null ? null : await BuildStatusAsync(conn, o);
    }

    private async Task<WebsiteOrderStatusDto> BuildStatusAsync(MySqlConnection conn, dynamic o)
    {
        string paymentStatus = (string)o.PaymentStatus;
        string? provision = (string?)o.ProvisionStatus;
        string status = provision == "Active" ? "Active"
            : provision == "ActivationFailed" ? "ActivationFailed"
            : paymentStatus == "PAID" ? "Provisioning"
            : "AwaitingPayment";
        string label = (string)o.Subdomain;
        DateTime? endDate = null;
        if (o.fk_website_id != null)
        {
            var w = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT EndDate FROM club_websites WHERE pk_id = @Id", new { Id = (int)o.fk_website_id });
            if (w?.EndDate != null) endDate = (DateTime)w.EndDate;
        }
        return new WebsiteOrderStatusDto
        {
            WebsiteOrderId = (long)o.pk_id,
            ClubId = (int)o.fk_club_id,
            OrderType = (string)o.OrderType,
            Subdomain = label,
            PaymentStatus = paymentStatus,
            Status = status,
            VisitUrl = status == "Active" ? $"https://{label}.{ParentDomain()}" : null,
            EndDate = endDate
        };
    }

    private static async Task LogWebsiteAsync(MySqlConnection conn, int websiteId, string action, string? details, int userId)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy)
            VALUES (@W, @A, @D, @U)",
            new { W = websiteId, A = action, D = details, U = userId });
    }

    public async Task<int?> GetOrderClubIdAsync(long websiteOrderId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        return await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_club_id FROM club_website_orders WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = websiteOrderId });
    }
}

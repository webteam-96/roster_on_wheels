using Dapper;
using MySqlConnector;
using RotaryApi.Services.Payments;

namespace RotaryApi.Services;

/// <summary>
/// Buying and renewing District and Club subscriptions (KIS/ROW/SUB/01 sections 4.1, 4.3, 4.5, 5).
/// A paid order adds one year to the end of the current term when the subscription still works (active or in grace),
/// otherwise starts a new year today. Paying again while active is a renewal (exception 5). Offline payments are
/// activated by Kaizen (Super Admin, exception 7). Prices are Super Admin settings (subscription_prices).
/// </summary>
public sealed class SubscriptionBillingService
{
    public const string KindDistrict = "district";
    public const string KindClub = "club";

    private readonly string _conn;
    private readonly PaymentCheckoutService _checkout;
    private readonly SubscriptionOfficers _officers;
    private readonly ExecutiveSignInService _signIn;
    private readonly IEmailService _email;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<SubscriptionBillingService> _logger;

    public SubscriptionBillingService(IConfiguration config, PaymentCheckoutService checkout, SubscriptionOfficers officers,
        ExecutiveSignInService signIn, IEmailService email, IServiceScopeFactory scopes, ILogger<SubscriptionBillingService> logger)
    {
        _scopes = scopes;
        _conn = config.GetConnectionString("DefaultConnection")!;
        _checkout = checkout;
        _officers = officers;
        _signIn = signIn;
        _email = email;
        _logger = logger;
    }

    private MySqlConnection Conn() => new(_conn);

    public sealed record Price(string Kind, decimal Amount, string Currency);

    public async Task<List<Price>> GetPricesAsync()
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<Price>("SELECT kind AS Kind, amount AS Amount, currency AS Currency FROM subscription_prices")).ToList();
    }

    public async Task SetPriceAsync(string kind, decimal amount, string currency, int by)
    {
        if (kind is not (KindDistrict or KindClub)) throw new ArgumentException("Kind must be district or club.");
        if (amount <= 0) throw new ArgumentException("The price must be more than 0.");
        currency = (currency ?? "").Trim().ToUpperInvariant();
        if (currency.Length != 3) throw new ArgumentException("Use a 3-letter currency code, for example USD.");
        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            INSERT INTO subscription_prices (kind, amount, currency, modified_by) VALUES (@kind, @amount, @currency, @by)
            ON DUPLICATE KEY UPDATE amount = @amount, currency = @currency, modified_by = @by",
            new { kind, amount, currency, by });
    }

    public sealed record OrderResult(long OrderId, bool IsRenewal, decimal Amount, string Currency, CheckoutSessionDto? Checkout);

    /// <summary>
    /// Section 4.1 / 4.3 step 1-2: checks the buyer holds the office, prices the order on the server and opens checkout.
    /// <paramref name="clubId"/> = 0 for a District subscription.
    /// </summary>
    public async Task<OrderResult> CreateOrderAsync(string kind, int districtId, int clubId, int buyerMemberId, bool buyerIsSuperAdmin,
        string? returnPath)
    {
        await using var conn = Conn();
        await conn.OpenAsync();

        if (kind == KindClub)
        {
            districtId = await conn.ExecuteScalarAsync<int>(
                "SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId AND isdeleted = 0", new { clubId });
            if (districtId <= 0) throw new KeyNotFoundException("Club not found.");
            if (!buyerIsSuperAdmin)
            {
                await _officers.SyncClubAsync(conn, clubId);
                if (await SubscriptionOfficers.StandingAtClubAsync(conn, buyerMemberId, clubId) != ExecutiveStanding.Current)
                    throw new UnauthorizedAccessException("Only a current club executive on record with RI can buy the Club subscription.");
            }
        }
        else if (kind == KindDistrict)
        {
            clubId = 0;
            if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_master WHERE pk_district_id = @districtId AND isdeleted = 0",
                    new { districtId }) == 0)
                throw new KeyNotFoundException("District not found.");
            if (!buyerIsSuperAdmin && !await SubscriptionOfficers.IsDistrictBuyerAsync(conn, buyerMemberId, districtId))
                throw new UnauthorizedAccessException("Only the District Governor, Governor-Elect or District Secretary can buy the District subscription.");
        }
        else throw new ArgumentException("Kind must be district or club.");

        var price = await conn.QueryFirstOrDefaultAsync<Price>(
            "SELECT kind AS Kind, amount AS Amount, currency AS Currency FROM subscription_prices WHERE kind = @kind", new { kind })
            ?? throw new InvalidOperationException("The subscription price is not set yet. Ask ROW support.");
        var isRenewal = IsWorking(await CurrentTermEndAsync(conn, districtId, clubId));

        var orderId = await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO subscription_orders (kind, fk_district_id, fk_club_id, fk_buyer_member_id, amount, currency, is_renewal)
            VALUES (@kind, @districtId, @clubId, @buyerMemberId, @Amount, @Currency, @isRenewal); SELECT LAST_INSERT_ID();",
            new { kind, districtId, clubId, buyerMemberId, price.Amount, price.Currency, isRenewal });
        var merchantOrderId = $"SUB{orderId}";
        await conn.ExecuteAsync("UPDATE subscription_orders SET merchant_order_id = @merchantOrderId WHERE pk_id = @orderId",
            new { merchantOrderId, orderId });

        if (!_checkout.Enabled) return new OrderResult(orderId, isRenewal, price.Amount, price.Currency, null);
        var back = _checkout.LocalUrl(returnPath);
        var scope = kind == KindClub
            ? await conn.ExecuteScalarAsync<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId })
            : "District " + await conn.ExecuteScalarAsync<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @districtId", new { districtId });
        var session = await _checkout.CreateAsync(new CheckoutRequest(PaymentSettlementService.FlowSubscription, orderId, merchantOrderId,
            price.Amount, price.Currency, $"{(kind == KindClub ? "Club" : "District")} subscription{(isRenewal ? " renewal" : "")}: {scope}",
            back, back));
        return new OrderResult(orderId, isRenewal, price.Amount, price.Currency, session);
    }

    /// <summary>Checkout settled the order: activate or extend the subscription. Safe to call twice.</summary>
    public async Task SettleOnlineAsync(long orderId, string gatewayPaymentId) => await ActivateAsync(orderId, gatewayPaymentId, "online");

    /// <summary>Exception 7: a payment made offline, activated by Kaizen (Super Admin).</summary>
    public async Task<long> ActivateOfflineAsync(string kind, int districtId, int clubId, int superAdminId, decimal amount, string currency)
    {
        await using var conn = Conn();
        if (kind == KindClub)
            districtId = await conn.ExecuteScalarAsync<int>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId", new { clubId });
        else clubId = 0;
        if (districtId <= 0) throw new KeyNotFoundException("Club or district not found.");
        var orderId = await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO subscription_orders (kind, fk_district_id, fk_club_id, fk_buyer_member_id, amount, currency, is_renewal, merchant_order_id)
            VALUES (@kind, @districtId, @clubId, @superAdminId, @amount, @currency, 0, NULL); SELECT LAST_INSERT_ID();",
            new { kind, districtId, clubId, superAdminId, amount, currency = currency.ToUpperInvariant() });
        await ActivateAsync(orderId, $"OFFLINE-{orderId}", "offline");
        return orderId;
    }

    private async Task ActivateAsync(long orderId, string gatewayPaymentId, string via)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var order = await conn.QueryFirstOrDefaultAsync<(string Kind, int DistrictId, int ClubId, string Status, int Buyer)>(
            "SELECT kind, fk_district_id, fk_club_id, status, fk_buyer_member_id FROM subscription_orders WHERE pk_id = @orderId FOR UPDATE",
            new { orderId }, tx);
        if (order.Kind == null) throw new KeyNotFoundException($"Subscription order {orderId} not found.");
        if (order.Status == "paid") { await tx.CommitAsync(); return; }

        var currentEnd = await CurrentTermEndAsync(conn, order.DistrictId, order.ClubId, tx);
        var (start, end) = NextTerm(currentEnd, DateTime.UtcNow.Date, SubscriptionAccess.GraceDays);
        await conn.ExecuteAsync(@"
            INSERT INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code, term_start, term_end, state, created_by)
            VALUES (@DistrictId, @ClubId, @Kind, @start, @end, 'live', @Buyer)
            ON DUPLICATE KEY UPDATE term_start = IF(term_end IS NULL OR term_end < @start, @start, term_start),
                                    term_end = @end, state = 'live', modified_by = @Buyer",
            new { order.DistrictId, order.ClubId, order.Kind, start, end, order.Buyer }, tx);
        await conn.ExecuteAsync(@"
            UPDATE subscription_orders SET status = 'paid', paid_via = @via, gateway_payment_id = @gatewayPaymentId,
                   term_start = @start, term_end = @end, paid_date = UTC_TIMESTAMP() WHERE pk_id = @orderId",
            new { via, gatewayPaymentId, start, end, orderId }, tx);
        await tx.CommitAsync();
        SubscriptionGateMiddleware.Invalidate(); // 4.3 step 2: the club is Full straight away
        _logger.LogInformation("Subscription order {OrderId} paid ({Via}): {Kind} district {District} club {Club} until {End:yyyy-MM-dd}",
            orderId, via, order.Kind, order.DistrictId, order.ClubId, end);

        // Section 4.1 steps 3-4 / 4.3 step 3: read the executives from RI and invite them. One club is one RI call,
        // done now. A district is one call per club, so it runs after this request: a payment callback must not
        // wait minutes on RI. The nightly pass repeats the same work if the process stops in between.
        if (order.Kind == KindClub) await AfterActivationAsync(order.Kind, order.DistrictId, order.ClubId, order.Buyer, orderId);
        else
            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = _scopes.CreateScope(); // IEmailService is scoped
                    await scope.ServiceProvider.GetRequiredService<SubscriptionBillingService>()
                        .AfterActivationAsync(order.Kind, order.DistrictId, order.ClubId, order.Buyer, orderId);
                }
                catch (Exception ex) { _logger.LogError(ex, "Officer sync after subscription order {OrderId} failed", orderId); }
            });
    }

    /// <summary>Reads the executives from RI, invites them, and tells a district buyer which clubs have none (exception 2).</summary>
    private async Task AfterActivationAsync(string kind, int districtId, int clubId, int buyer, long orderId)
    {
        try
        {
            await using var conn = Conn();
            await conn.OpenAsync();
            var clubIds = kind == KindDistrict
                ? (await _officers.SyncDistrictAsync(conn, districtId)).Select(r => r.ClubId).ToList()
                : new List<int> { (await _officers.SyncClubAsync(conn, clubId)).ClubId };
            var (_, without) = await _signIn.InviteAsync(conn, clubIds);
            if (kind == KindDistrict && without.Count > 0)
            {
                var buyerEmail = await conn.ExecuteScalarAsync<string?>(
                    "SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @buyer", new { buyer });
                if (!string.IsNullOrWhiteSpace(buyerEmail))
                    await _email.SendScopedEmailAsync(buyerEmail, "Clubs with no executives on record",
                        "<p>The District subscription is active. These clubs have no executive on record with Rotary International, " +
                        "so nobody from them was invited. Ask them to update My Rotary:</p><ul>" +
                        string.Concat(without.Select(n => $"<li>{System.Net.WebUtility.HtmlEncode(n)}</li>")) + "</ul>",
                        null, districtId);
            }
        }
        catch (Exception ex) when (ex is MySqlException or HttpRequestException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Officer sync after subscription order {OrderId} failed; the nightly sync retries.", orderId);
        }
    }

    /// <summary>
    /// Section 4.5 step 2: a renewal adds one year to the end of the current term with no interruption, while the
    /// subscription still works (active or in grace). After that it starts a fresh year today.
    /// </summary>
    public static (DateTime Start, DateTime End) NextTerm(DateTime? currentEnd, DateTime today, int graceDays)
    {
        if (currentEnd is DateTime end && SubscriptionAccess.StateOn(end, today, graceDays) is SubscriptionState.Active or SubscriptionState.Grace)
            return (end.AddDays(1), end.AddYears(1));
        return (today, today.AddYears(1).AddDays(-1));
    }

    private static bool IsWorking(DateTime? end) =>
        SubscriptionAccess.StateOn(end, DateTime.UtcNow.Date, SubscriptionAccess.GraceDays) is SubscriptionState.Active or SubscriptionState.Grace;

    private static Task<DateTime?> CurrentTermEndAsync(MySqlConnection conn, int districtId, int clubId, MySqlTransaction? tx = null) =>
        conn.ExecuteScalarAsync<DateTime?>(@"
            SELECT term_end FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = @clubId AND state = 'live'",
            new { districtId, clubId }, tx);

    public sealed record OrderStatus(long OrderId, string Kind, string Status, bool IsRenewal, DateTime? TermEnd);

    public async Task<OrderStatus?> GetOrderAsync(long orderId, int memberId, bool isSuperAdmin)
    {
        await using var conn = Conn();
        return await conn.QueryFirstOrDefaultAsync<OrderStatus>(@"
            SELECT pk_id AS OrderId, kind AS Kind, status AS Status, is_renewal AS IsRenewal, term_end AS TermEnd
            FROM subscription_orders WHERE pk_id = @orderId AND (fk_buyer_member_id = @memberId OR @isSuperAdmin)",
            new { orderId, memberId, isSuperAdmin });
    }
}

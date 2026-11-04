using System.Security.Cryptography;
using Dapper;
using MySqlConnector;
using System.Text.Json;

namespace RotaryApi.Services.Payments;

/// <summary>What a payment flow asks the gateway to collect. Amount is always priced on the server.</summary>
public sealed record CheckoutRequest(
    string Flow, long FlowRef, string MerchantOrderId, decimal Amount, string Currency, string Description,
    string? ReturnUrl = null, string? CancelUrl = null);

/// <summary>Gateway-neutral session the browser or app is sent to (admin types/payments.ts CheckoutSession).</summary>
public sealed record CheckoutSessionDto(string Kind, string RedirectUrl, string MerchantOrderId, string Gateway, string Token);

public sealed record CheckoutSessionRow(
    string Token, string Gateway, string Flow, long FlowRef, string MerchantOrderId, decimal Amount, string Currency,
    string Description, string? ReturnUrl, string? CancelUrl, string Status, DateTime ExpiresAt);

/// <summary>
/// One hosted payment page. To add Stripe: implement this with a Checkout Session (put Flow, FlowRef and the session
/// token in its metadata), register it in Program.cs, set Payments__Provider=stripe, and have its signed webhook call
/// PaymentSettlementService.SettleAsync. No payment flow changes.
/// </summary>
public interface IPaymentGateway
{
    string Code { get; }
    Task<string> CreateHostedPageAsync(CheckoutRequest request, string sessionToken);
}

/// <summary>No money moves: sends the payer to ROW's own /pay/simulated page, which chooses the outcome.</summary>
public sealed class SimulatedPaymentGateway : IPaymentGateway
{
    public const string GatewayCode = "simulated";
    private readonly IConfiguration _config;
    public SimulatedPaymentGateway(IConfiguration config) => _config = config;
    public string Code => GatewayCode;

    public Task<string> CreateHostedPageAsync(CheckoutRequest request, string sessionToken) =>
        Task.FromResult($"{(_config["FrontendUrl"] ?? "http://localhost:3000").TrimEnd('/')}/pay/simulated/{sessionToken}");
}

/// <summary>Turns an order's stored splits into the rows a settlement report shows when no real gateway settles.</summary>
public static class SimulatedSettlements
{
    public static List<(string VendorId, decimal Amount)> Split(string? splitsJson, decimal total)
    {
        var rows = new List<(string, decimal)>();
        if (!string.IsNullOrWhiteSpace(splitsJson))
        {
            using var doc = JsonDocument.Parse(splitsJson);
            foreach (var s in doc.RootElement.EnumerateArray())
            {
                var vendor = s.TryGetProperty("vendor_id", out var v) ? v.GetString() : null;
                if (string.IsNullOrWhiteSpace(vendor)) continue;
                var amount = s.TryGetProperty("amount", out var a) ? a.GetDecimal()
                    : s.TryGetProperty("percentage", out var p) ? Math.Round(total * p.GetDecimal() / 100m, 2, MidpointRounding.AwayFromZero)
                    : 0m;
                if (amount > 0) rows.Add((vendor, amount));
            }
        }
        if (rows.Count == 0) rows.Add(("MAIN", total));
        return rows;
    }
}

/// <summary>Picks the configured gateway and stores each session. Payments:Provider unset = the seam is off.</summary>
public sealed class PaymentCheckoutService
{
    private readonly string _conn;
    private readonly string _frontendUrl;
    private readonly IPaymentGateway? _gateway;

    public PaymentCheckoutService(IConfiguration config, IWebHostEnvironment env, IEnumerable<IPaymentGateway> gateways,
        ILogger<PaymentCheckoutService> logger)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
        _frontendUrl = (config["FrontendUrl"] ?? "http://localhost:3000").TrimEnd('/');

        var provider = config["Payments:Provider"]?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(provider)) return;

        // A simulated payment marks real rows paid, so production needs a second, explicit setting.
        if (provider == SimulatedPaymentGateway.GatewayCode && env.IsProduction()
            && !config.GetValue("Payments:AllowSimulatedInProduction", false))
        {
            logger.LogError("Payments:Provider=simulated is refused in Production without Payments:AllowSimulatedInProduction.");
            return;
        }
        _gateway = gateways.FirstOrDefault(g => g.Code == provider);
        if (_gateway == null) logger.LogError("Payments:Provider {Provider} has no gateway registered.", provider);
    }

    public bool Enabled => _gateway != null;
    public string? GatewayCode => _gateway?.Code;
    public bool IsSimulated => _gateway?.Code == SimulatedPaymentGateway.GatewayCode;

    private MySqlConnection Conn() => new(_conn);

    /// <summary>Absolute URL for a path inside the admin app; anything that is not a plain local path falls to null.</summary>
    public string? LocalUrl(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || path[0] != '/' || path.StartsWith("//") || path.Contains('\\')) return null;
        return _frontendUrl + path;
    }

    public async Task<CheckoutSessionDto> CreateAsync(CheckoutRequest r)
    {
        if (_gateway == null) throw new InvalidOperationException("Online payments are not switched on.");
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var redirectUrl = await _gateway.CreateHostedPageAsync(r, token);

        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            INSERT INTO payment_checkout_sessions
                (session_token, gateway, flow, flow_ref, merchant_order_id, amount, currency, description,
                 return_url, cancel_url, status, expires_at, created_date)
            VALUES (@Token, @Gateway, @Flow, @FlowRef, @MerchantOrderId, @Amount, @Currency, @Description,
                 @ReturnUrl, @CancelUrl, 'open', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), UTC_TIMESTAMP())",
            new { Token = token, Gateway = _gateway.Code, r.Flow, r.FlowRef, r.MerchantOrderId, r.Amount, r.Currency,
                  r.Description, r.ReturnUrl, r.CancelUrl });
        return new CheckoutSessionDto("Redirect", redirectUrl, r.MerchantOrderId, _gateway.Code, token);
    }

    public async Task<CheckoutSessionRow?> GetAsync(string token)
    {
        await using var conn = Conn();
        return await conn.QueryFirstOrDefaultAsync<CheckoutSessionRow>(@"
            SELECT session_token AS Token, gateway AS Gateway, flow AS Flow, flow_ref AS FlowRef,
                   merchant_order_id AS MerchantOrderId, amount AS Amount, currency AS Currency,
                   description AS Description, return_url AS ReturnUrl, cancel_url AS CancelUrl,
                   status AS Status, expires_at AS ExpiresAt
            FROM payment_checkout_sessions WHERE session_token = @Token", new { Token = token });
    }

    /// <summary>Atomic: only the one caller that moves an unexpired session out of 'open' gets true.</summary>
    public async Task<bool> TryCloseAsync(string token, string status, string? gatewayPaymentId)
    {
        await using var conn = Conn();
        return await conn.ExecuteAsync(@"
            UPDATE payment_checkout_sessions
            SET status = @Status, gateway_payment_id = @GatewayPaymentId, completed_date = UTC_TIMESTAMP()
            WHERE session_token = @Token AND status = 'open' AND expires_at > UTC_TIMESTAMP()",
            new { Token = token, Status = status, GatewayPaymentId = gatewayPaymentId }) == 1;
    }

    /// <summary>Puts a claimed session back when settling failed, so the payment can be retried.</summary>
    public async Task ReopenAsync(string token)
    {
        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            UPDATE payment_checkout_sessions SET status = 'open', gateway_payment_id = NULL, completed_date = NULL
            WHERE session_token = @Token", new { Token = token });
    }
}

/// <summary>
/// Marks the business record paid once a gateway confirms money. The simulator calls this today, a Stripe webhook
/// later. Each flow's method is idempotent, so a repeated confirmation changes nothing.
/// </summary>
public sealed class PaymentSettlementService
{
    public const string FlowWallet = "wallet";
    public const string FlowWebsite = "website";
    public const string FlowClubDues = "club_dues";
    public const string FlowMembershipDues = "membership_dues";
    public const string FlowEventLink = "event_link";

    private readonly PaymentCheckoutService _checkout;
    private readonly IWalletService _wallet;
    private readonly IWebsiteBillingService _website;
    private readonly IClubDuesService _clubDues;
    private readonly IMembershipDuesService _membershipDues;
    private readonly IEventPaymentLinkService _eventLinks;

    public PaymentSettlementService(PaymentCheckoutService checkout, IWalletService wallet, IWebsiteBillingService website,
        IClubDuesService clubDues, IMembershipDuesService membershipDues, IEventPaymentLinkService eventLinks)
    {
        _checkout = checkout;
        _wallet = wallet;
        _website = website;
        _clubDues = clubDues;
        _membershipDues = membershipDues;
        _eventLinks = eventLinks;
    }

    public async Task SettleAsync(string flow, long flowRef, string gatewayPaymentId)
    {
        switch (flow)
        {
            case FlowWallet: await _wallet.SettleOnlineAsync(flowRef, gatewayPaymentId); break;
            case FlowWebsite: await _website.SettleOnlineAsync(flowRef, gatewayPaymentId); break;
            case FlowClubDues: await _clubDues.SettleOnlineAsync((int)flowRef, gatewayPaymentId); break;
            case FlowMembershipDues: await _membershipDues.MarkOnlineDuesPaymentPaidAsync((int)flowRef, "Page", false, false); break;
            case FlowEventLink: await _eventLinks.SettleOnlineAsync((int)flowRef, gatewayPaymentId); break;
            default: throw new InvalidOperationException($"Unknown payment flow '{flow}'.");
        }
    }

    /// <summary>Applies the outcome picked on the simulated page. Returns null when the token is not a simulated session.</summary>
    public async Task<CheckoutSessionRow?> SimulateAsync(string token, string outcome)
    {
        var session = await _checkout.GetAsync(token);
        if (session == null || session.Gateway != SimulatedPaymentGateway.GatewayCode
            || _checkout.GatewayCode != SimulatedPaymentGateway.GatewayCode) return null;

        if (outcome != "paid")
        {
            await _checkout.TryCloseAsync(token, outcome, null);
            return await _checkout.GetAsync(token);
        }

        var paymentId = $"sim_{Guid.NewGuid():N}";
        if (await _checkout.TryCloseAsync(token, "paid", paymentId))
        {
            try { await SettleAsync(session.Flow, session.FlowRef, paymentId); }
            catch
            {
                await _checkout.ReopenAsync(token);
                throw;
            }
        }
        return await _checkout.GetAsync(token);
    }
}

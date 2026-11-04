using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services.Payments;

namespace RotaryApi.Controllers;

/// <summary>
/// Hosted checkout status, and the simulated gateway's outcome. Anonymous because payers on public pay links have no
/// sign-in; the 256-bit session token is the only key, and amounts are never taken from the client.
/// </summary>
[ApiController]
[AllowAnonymous]
[EnableRateLimiting("feed")]
[Route("api/public/payments/checkout")]
public class PublicPaymentCheckoutController : ControllerBase
{
    private static readonly HashSet<string> Outcomes = new() { "paid", "failed", "cancelled" };
    private readonly PaymentCheckoutService _checkout;
    private readonly PaymentSettlementService _settlement;

    public PublicPaymentCheckoutController(PaymentCheckoutService checkout, PaymentSettlementService settlement)
    {
        _checkout = checkout;
        _settlement = settlement;
    }

    public sealed record SimulateRequest(string? Outcome);

    private static object View(CheckoutSessionRow s) => new
    {
        s.Status, s.Amount, s.Currency, s.Description, s.Gateway, s.MerchantOrderId, s.ReturnUrl, s.CancelUrl,
        Simulated = s.Gateway == SimulatedPaymentGateway.GatewayCode,
        Expired = s.Status == "open" && s.ExpiresAt <= DateTime.UtcNow,
    };

    [HttpGet("{token}")]
    public async Task<ActionResult> Get(string token)
    {
        var session = await _checkout.GetAsync(token);
        return session == null ? NotFound() : Ok(View(session));
    }

    [HttpPost("{token}/simulate")]
    public async Task<ActionResult> Simulate(string token, [FromBody] SimulateRequest req)
    {
        if (req.Outcome == null || !Outcomes.Contains(req.Outcome))
            return BadRequest(new { message = "Unknown outcome." });
        var session = await _settlement.SimulateAsync(token, req.Outcome);
        return session == null ? NotFound() : Ok(View(session));
    }
}

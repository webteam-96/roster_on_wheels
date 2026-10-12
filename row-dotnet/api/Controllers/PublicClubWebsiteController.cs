using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// OPEN (no-login) club-website purchase, reached from the SuperAdmin's encrypted pay link
// (/pay/club-website/{token}). The token carries only { clubId, yearId, expiry }; the price,
// GST and gateway are always re-resolved server-side (WebsiteBillingService.ResolveConfig via
// QuoteAsync/CreateOrderAsync), so nothing about the amount is client-supplied ("no foul play").
[ApiController]
[Route("api/public/club-website")]
[AllowAnonymous]
public class PublicClubWebsiteController : ControllerBase
{
    private readonly IWebsiteBillingService _billing;
    private readonly IConfiguration _config;
    private readonly string _connectionString;
    private readonly ILogger<PublicClubWebsiteController> _logger;

    public PublicClubWebsiteController(IWebsiteBillingService billing, IConfiguration config, ILogger<PublicClubWebsiteController> logger)
    {
        _billing = billing;
        _config = config;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    private bool TryToken(string? token, out int clubId, out int yearId, out string? error)
    {
        clubId = 0; yearId = 0;
        if (!WebsitePayLinkToken.TryDecrypt(_config, token, out var payload, out error) || payload == null)
            return false;
        clubId = payload.ClubId;
        yearId = payload.YearId;
        return true;
    }

    public class PublicCreateOrderRequest { public string? SubdomainInput { get; set; } }
    public class PublicVerifyRequest
    {
        public long WebsiteOrderId { get; set; }
        public string RazorpayOrderId { get; set; } = "";
        public string RazorpayPaymentId { get; set; } = "";
        public string RazorpaySignature { get; set; } = "";
    }

    // Display data for the pay page: club name, New/Renewal, base/GST/total, subdomain prefix/parent,
    // gateway label, and (renewal) current subdomain + expiry.
    [HttpGet("{token}")]
    public async Task<ActionResult> Get(string token)
    {
        if (!TryToken(token, out var clubId, out var yearId, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.ClubName AS clubName, c.IsActive AS isActive, c.isdeleted AS isDeleted
            FROM club_master c WHERE c.pk_club_id = @C", new { C = clubId });
        if (club == null || Convert.ToBoolean(club.isDeleted) || !Convert.ToBoolean(club.isActive))
            return BadRequest(new { message = "This club is not available for a website purchase right now." });

        var quote = await _billing.QuoteAsync(clubId, yearId);
        return Ok(new
        {
            clubId,
            clubName = (string)club.clubName,
            orderType = quote.OrderType,
            currentSubdomain = quote.CurrentSubdomain,
            currentEndDate = quote.CurrentEndDate,
            newEndDate = quote.NewEndDate,
            validityMonths = quote.ValidityMonths,
            baseAmount = quote.BaseAmount,
            gstAmount = quote.GstAmount,
            gstPercent = quote.GstPercent,
            totalAmount = quote.TotalAmount,
            subdomainPrefix = quote.SubdomainPrefix,
            parentDomain = quote.ParentDomain,
            gatewayType = quote.GatewayType,
            canPurchase = quote.CanPurchase,
            purchaseBlockedReason = quote.PurchaseBlockedReason,
            daysRemaining = quote.DaysRemaining
        });
    }

    // Subdomain availability probe (New only). Reuses the same format + reservation rules as self-service.
    [HttpGet("{token}/check-subdomain")]
    public async Task<ActionResult> CheckSubdomain(string token, [FromQuery] string? input)
    {
        if (!TryToken(token, out var clubId, out _, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        return Ok(await _billing.CheckSubdomainAsync(input, clubId));
    }

    // Create the Razorpay order. Price + gateway come from the per-club/year config (token pins the year);
    // the client only supplies the subdomain (New). Returns keyId/orderId/amountPaise for checkout.js.
    [HttpPost("{token}/create-order")]
    public async Task<ActionResult> CreateOrder(string token, [FromBody] PublicCreateOrderRequest req)
    {
        if (!TryToken(token, out var clubId, out var yearId, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        try
        {
            var dto = new CreateWebsiteOrderDto
            {
                ClubId = clubId,
                SubdomainInput = req?.SubdomainInput,
                ReminderDays = 0,   // server default
                ThemeId = null      // server picks the default theme
            };
            // created_by = 0 (public/no-login): activation emails still go to President/Secretary.
            var res = await _billing.CreateOrderAsync(dto, 0, yearId);
            return Ok(res);
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Capture the payment. Re-checks the order belongs to the token's club before verifying.
    [HttpPost("{token}/verify")]
    public async Task<ActionResult> Verify(string token, [FromBody] PublicVerifyRequest req)
    {
        if (!TryToken(token, out var clubId, out _, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });

        var orderClubId = await _billing.GetOrderClubIdAsync(req.WebsiteOrderId);
        if (orderClubId == null) return NotFound(new { message = "Order not found." });
        if (orderClubId.Value != clubId) return BadRequest(new { message = "Order does not match this link." });

        var v = await _billing.VerifyPaymentAsync(new VerifyWebsiteOrderDto
        {
            WebsiteOrderId = req.WebsiteOrderId,
            RazorpayOrderId = req.RazorpayOrderId,
            RazorpayPaymentId = req.RazorpayPaymentId,
            RazorpaySignature = req.RazorpaySignature
        }, 0);
        return Ok(v);
    }
}

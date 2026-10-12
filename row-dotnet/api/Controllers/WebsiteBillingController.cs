using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Self-service club website purchase/renewal via Razorpay. A club admin buys/renews their own
// club's public website; on payment the site is auto-provisioned (Plesk vhost + wildcard SSL).
[ApiController]
[Route("api/website-billing")]
[Authorize]
public class WebsiteBillingController : ControllerBase
{
    private readonly IWebsiteBillingService _billing;
    private readonly string _connectionString;
    private readonly ILogger<WebsiteBillingController> _logger;

    public WebsiteBillingController(IWebsiteBillingService billing, IConfiguration config, ILogger<WebsiteBillingController> logger)
    {
        _billing = billing;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    // Owner-scoped: only a club-admin (role 2) of THIS club (or a SuperAdmin) may buy/renew it.
    private async Task<bool> CanBuyWebsiteAsync(int clubId)
    {
        if (IsSuperAdmin()) return true;
        var memberId = GetUserId();
        if (memberId == 0 || clubId <= 0) return false;
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var allowed = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
              AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, ClubId = clubId });
        return allowed > 0;
    }

    // Price + New/Renewal + new expiry for a club (still re-computed server-side on order create).
    [HttpGet("quote")]
    public async Task<ActionResult> Quote([FromQuery] int clubId)
    {
        if (!await CanBuyWebsiteAsync(clubId)) return Forbid();
        return Ok(await _billing.QuoteAsync(clubId));
    }

    // Availability + format check for a proposed subdomain input. Any authenticated user may probe.
    [HttpGet("check-subdomain")]
    public async Task<ActionResult> CheckSubdomain([FromQuery] string? input, [FromQuery] int? clubId = null)
    {
        if (GetUserId() == 0 && !IsSuperAdmin()) return Forbid();
        return Ok(await _billing.CheckSubdomainAsync(input, clubId));
    }

    [HttpPost("create-order")]
    public async Task<ActionResult> CreateOrder([FromBody] CreateWebsiteOrderDto dto)
    {
        if (!await CanBuyWebsiteAsync(dto.ClubId)) return Forbid();
        try
        {
            return Ok(await _billing.CreateOrderAsync(dto, GetUserId()));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("verify")]
    public async Task<ActionResult> Verify([FromBody] VerifyWebsiteOrderDto dto)
    {
        // Re-authorize against the order's OWN club so a user can't verify someone else's order.
        var clubId = await _billing.GetOrderClubIdAsync(dto.WebsiteOrderId);
        if (clubId == null) return NotFound(new { message = "Order not found." });
        if (!await CanBuyWebsiteAsync(clubId.Value)) return Forbid();
        // Captures payment and returns immediately; provisioning runs in the background worker.
        return Ok(await _billing.VerifyPaymentAsync(dto, GetUserId()));
    }

    // Live status of an order (notification-card polling). Owner-scoped.
    [HttpGet("order-status/{orderId:long}")]
    public async Task<ActionResult> OrderStatus(long orderId)
    {
        var clubId = await _billing.GetOrderClubIdAsync(orderId);
        if (clubId == null) return NotFound(new { message = "Order not found." });
        if (!await CanBuyWebsiteAsync(clubId.Value)) return Forbid();
        return Ok(await _billing.GetOrderStatusAsync(orderId));
    }

    // Latest order for a club — lets the notification card re-attach after a reload. Owner-scoped.
    [HttpGet("latest-order")]
    public async Task<ActionResult> LatestOrder([FromQuery] int clubId)
    {
        if (!await CanBuyWebsiteAsync(clubId)) return Forbid();
        return Ok(await _billing.GetLatestOrderForClubAsync(clubId));
    }

    // Razorpay server-to-server webhook — no JWT; authenticity via X-Razorpay-Signature over the raw body.
    [HttpPost("webhook")]
    [AllowAnonymous]
    public async Task<ActionResult> Webhook()
    {
        using var reader = new StreamReader(Request.Body);
        var rawBody = await reader.ReadToEndAsync();
        var signature = Request.Headers["X-Razorpay-Signature"].ToString();
        try
        {
            await _billing.HandleWebhookAsync(rawBody, signature);
            return Ok(new { received = true });
        }
        catch (UnauthorizedAccessException)
        {
            return BadRequest(new { message = "Invalid signature" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Website billing webhook handling failed");
            return Ok(new { received = true }); // ack so Razorpay doesn't hammer retries; we logged it
        }
    }
}

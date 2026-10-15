using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Self-service wallet top-up: club/district admins buy WhatsApp/Email credits via Razorpay.
[ApiController]
[Route("api/wallet")]
[Authorize]
public class WalletController : ControllerBase
{
    private readonly IWalletService _wallet;
    private readonly string _connectionString;
    private readonly ILogger<WalletController> _logger;

    public WalletController(IWalletService wallet, IConfiguration config, ILogger<WalletController> logger)
    {
        _wallet = wallet;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    // Owner-scoped: only a club-admin (role 2) of THIS club (or a SuperAdmin) may top it up.
    private async Task<bool> CanTopUpClubAsync(int clubId)
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

    private async Task<bool> CanTopUpDistrictAsync(int districtId)
    {
        if (IsSuperAdmin()) return true;
        var memberId = GetUserId();
        if (memberId == 0 || districtId <= 0) return false;
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var allowed = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
              AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, DistrictId = districtId });
        return allowed > 0;
    }

    private async Task<bool> AuthorizeScopeAsync(string scope, int clubId, int districtId)
        => (scope ?? "").ToLowerInvariant() == "club"
            ? await CanTopUpClubAsync(clubId)
            : await CanTopUpDistrictAsync(districtId);

    // Live preview of credits/GST/total for an entered amount (still re-validated on order create).
    [HttpGet("quote")]
    public ActionResult Quote([FromQuery] string creditType, [FromQuery] decimal amount)
        => Ok(_wallet.Quote(creditType, amount));

    [HttpPost("create-order")]
    public async Task<ActionResult> CreateOrder([FromBody] CreateTopupOrderDto dto)
    {
        if (!await AuthorizeScopeAsync(dto.Scope, dto.ClubId, dto.DistrictId)) return Forbid();
        try
        {
            var res = await _wallet.CreateTopupOrderAsync(dto, GetUserId());
            return Ok(res);
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("verify")]
    public async Task<ActionResult> Verify([FromBody] VerifyTopupDto dto)
    {
        // Re-authorize against the order's OWN scope so a user can't verify someone else's order.
        var scope = await _wallet.GetOrderScopeAsync(dto.TopupOrderId);
        if (scope == null) return NotFound(new { message = "Order not found." });
        if (!await AuthorizeScopeAsync(scope.Value.Scope, scope.Value.ClubId, scope.Value.DistrictId)) return Forbid();

        var res = await _wallet.VerifyAndCreditAsync(dto, GetUserId());
        return Ok(res);
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
            await _wallet.HandleWebhookAsync(rawBody, signature);
            return Ok(new { received = true });
        }
        catch (UnauthorizedAccessException)
        {
            return BadRequest(new { message = "Invalid signature" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wallet webhook handling failed");
            return Ok(new { received = true }); // ack so Razorpay doesn't hammer retries; we logged it
        }
    }
}

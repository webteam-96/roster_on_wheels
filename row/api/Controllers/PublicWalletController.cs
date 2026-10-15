using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// OPEN (no-login) Wallet purchase, reached from the SuperAdmin's encrypted pay links (/pay/w/{token}).
// Handles WhatsApp/Email credit top-ups (club + district) inline, and hands "common" website links
// back to the existing club-website flow. The token carries only { scope, purpose, entityId, expiry };
// credit pricing (rate/GST) is always re-resolved server-side (WalletService), so nothing about the
// amount is client-supplied ("no foul play"). Crediting is exactly-once and the client verify callback
// is cross-checked against the order's own scope/entity.
[ApiController]
[Route("api/public/wallet")]
[AllowAnonymous]
public class PublicWalletController : ControllerBase
{
    private readonly IWalletService _wallet;
    private readonly IWebsiteBillingService _billing;
    private readonly ICreditManagementService _credit;
    private readonly IConfiguration _config;
    private readonly string _connectionString;

    public PublicWalletController(IWalletService wallet, IWebsiteBillingService billing,
        ICreditManagementService credit, IConfiguration config)
    {
        _wallet = wallet;
        _billing = billing;
        _credit = credit;
        _config = config;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private bool TryToken(string? token, out WalletPayLinkToken.Payload payload, out string? error)
    {
        payload = new WalletPayLinkToken.Payload();
        if (!WalletPayLinkToken.TryDecrypt(_config, token, out var p, out error) || p == null)
            return false;
        payload = p;
        return true;
    }

    private static string? CreditTypeFor(string purpose) => purpose switch
    {
        "whatsapp" => "WhatsApp",
        "email" => "Email",
        _ => null,
    };

    // Resolve an entity's display name + active state. Returns null when it doesn't exist / inactive.
    private async Task<(string Name, string? DistrictNumber)?> ResolveEntityAsync(MySqlConnection conn, string scope, int id)
    {
        if (id <= 0) return null;
        if (scope == "club")
        {
            var c = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT c.ClubName AS name, d.DistrictNumber AS districtNumber, c.IsActive AS isActive, c.isdeleted AS isDeleted
                FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id = @Id", new { Id = id });
            if (c == null || Convert.ToBoolean(c.isDeleted) || !Convert.ToBoolean(c.isActive)) return null;
            return ((string)c.name, (string?)c.districtNumber);
        }
        var dist = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT DistrictNumber AS number, IsActive AS isActive, isdeleted AS isDeleted
            FROM district_master WHERE pk_district_id = @Id", new { Id = id });
        if (dist == null || Convert.ToBoolean(dist.isDeleted) || !Convert.ToBoolean(dist.isActive)) return null;
        return ($"District {(string)dist.number}", (string?)dist.number);
    }

    // Full status snapshot for a resolved entity: WhatsApp + Email balances, and (club) the website state.
    private async Task<PublicWalletStatusDto> BuildStatusAsync(string scope, int entityId)
    {
        var status = new PublicWalletStatusDto();
        if (scope == "club")
        {
            var bal = await _credit.GetClubCreditBalanceAsync(entityId);
            status.WhatsAppRemaining = bal.WhatsAppRemaining;
            status.EmailRemaining = bal.EmailRemaining;
            try
            {
                var q = await _billing.QuoteAsync(entityId, null);
                status.WebsiteOrderType = q.OrderType;
                status.WebsiteSubdomain = q.CurrentSubdomain;
                status.WebsiteCurrentEndDate = q.CurrentEndDate;
                status.WebsiteNewEndDate = q.NewEndDate;
                status.WebsiteCanPurchase = q.CanPurchase;
                status.WebsitePurchaseBlockedReason = q.PurchaseBlockedReason;
            }
            catch { /* website quote unavailable — leave website fields null */ }
        }
        else
        {
            var bal = await _credit.GetDistrictCreditBalanceAsync(entityId);
            status.WhatsAppRemaining = bal.WhatsAppRemaining;
            status.EmailRemaining = bal.EmailRemaining;
        }
        return status;
    }

    private async Task<int> CurrentYearIdAsync(MySqlConnection conn) =>
        await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1") ?? 0;

    // Link resolve: scope/purpose + (specific link) entity name & status, or requiresPick for common links.
    [HttpGet("{token}")]
    public async Task<ActionResult> Get(string token)
    {
        if (!TryToken(token, out var t, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        if (t.Scope != "club" && t.Scope != "district")
            return BadRequest(new { message = "Invalid link." });
        if (t.Purpose != "website" && t.Purpose != "whatsapp" && t.Purpose != "email")
            return BadRequest(new { message = "Invalid link." });
        if (t.Purpose == "website" && t.Scope != "club")
            return BadRequest(new { message = "Invalid link." });

        var dto = new PublicWalletInfoDto
        {
            Scope = t.Scope, Purpose = t.Purpose, EntityId = t.EntityId, RequiresPick = t.EntityId <= 0,
        };

        if (t.EntityId > 0)
        {
            using var conn = new MySqlConnection(_connectionString);
            await conn.OpenAsync();
            var entity = await ResolveEntityAsync(conn, t.Scope, t.EntityId);
            if (entity == null) return BadRequest(new { message = "This club/district is not available right now." });
            dto.EntityName = entity.Value.Name;
            dto.DistrictNumber = entity.Value.DistrictNumber;
            dto.Status = await BuildStatusAsync(t.Scope, t.EntityId);
        }
        return Ok(dto);
    }

    // Smart search over active clubs (scope=club) or districts (scope=district) — common links only.
    [HttpGet("{token}/search")]
    public async Task<ActionResult> Search(string token, [FromQuery] string? q)
    {
        if (!TryToken(token, out var t, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        var term = (q ?? "").Trim();
        if (term.Length < 2) return Ok(Array.Empty<PublicWalletSearchResultDto>());

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var like = $"%{term}%";
        List<PublicWalletSearchResultDto> results;
        if (t.Scope == "club")
        {
            results = (await conn.QueryAsync<PublicWalletSearchResultDto>(@"
                SELECT c.pk_club_id AS Id, c.ClubName AS Name, d.DistrictNumber AS DistrictNumber
                FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.IsActive = 1 AND c.isdeleted = 0
                  AND (c.ClubName LIKE @Q OR c.ClubRotaryId LIKE @Q)
                ORDER BY c.ClubName LIMIT 20", new { Q = like })).ToList();
        }
        else
        {
            results = (await conn.QueryAsync<PublicWalletSearchResultDto>(@"
                SELECT pk_district_id AS Id, CONCAT('District ', DistrictNumber) AS Name, DistrictNumber AS DistrictNumber
                FROM district_master
                WHERE IsActive = 1 AND isdeleted = 0 AND DistrictNumber LIKE @Q
                ORDER BY CAST(DistrictNumber AS UNSIGNED), DistrictNumber LIMIT 20", new { Q = like })).ToList();
        }
        return Ok(results);
    }

    // Status snapshot for a picked entity (common links, after the payer selects one).
    [HttpGet("{token}/entity/{entityId:int}")]
    public async Task<ActionResult> Entity(string token, int entityId)
    {
        if (!TryToken(token, out var t, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var entity = await ResolveEntityAsync(conn, t.Scope, entityId);
        if (entity == null) return BadRequest(new { message = "This club/district is not available right now." });
        return Ok(new PublicWalletInfoDto
        {
            Scope = t.Scope, Purpose = t.Purpose, EntityId = entityId, RequiresPick = false,
            EntityName = entity.Value.Name, DistrictNumber = entity.Value.DistrictNumber,
            Status = await BuildStatusAsync(t.Scope, entityId),
        });
    }

    // Website purpose: mint a club-website pay token so the frontend can redirect into the existing flow.
    [HttpPost("{token}/website-token")]
    public async Task<ActionResult> WebsiteToken(string token, [FromBody] PublicWalletWebsiteTokenRequest req)
    {
        if (!TryToken(token, out var t, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        if (t.Purpose != "website" || t.Scope != "club")
            return BadRequest(new { message = "This link is not for a website purchase." });

        int clubId = t.EntityId > 0 ? t.EntityId : req.EntityId;
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (await ResolveEntityAsync(conn, "club", clubId) == null)
            return BadRequest(new { message = "Please select a valid club." });

        int yearId = await CurrentYearIdAsync(conn);
        if (yearId <= 0) return BadRequest(new { message = "No rotary year is available." });
        return Ok(new PublicWalletWebsiteTokenResponse { WebsiteToken = WebsitePayLinkToken.Generate(_config, clubId, yearId) });
    }

    // Live credits/GST/total preview for an entered amount (WhatsApp/Email links only).
    [HttpGet("{token}/quote")]
    public ActionResult Quote(string token, [FromQuery] decimal amount)
    {
        if (!TryToken(token, out var t, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        var creditType = CreditTypeFor(t.Purpose);
        if (creditType == null) return BadRequest(new { message = "This link is not a credit top-up." });
        return Ok(_wallet.Quote(creditType, amount));
    }

    // Create the Razorpay order for a credit top-up. Amount is re-priced server-side.
    [HttpPost("{token}/create-order")]
    public async Task<ActionResult> CreateOrder(string token, [FromBody] PublicWalletCreateOrderRequest req)
    {
        if (!TryToken(token, out var t, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });
        var creditType = CreditTypeFor(t.Purpose);
        if (creditType == null) return BadRequest(new { message = "This link is not a credit top-up." });

        // Specific link forces its baked entity; common link takes the payer's picked entity.
        int entityId = t.EntityId > 0 ? t.EntityId : req.EntityId;
        using (var conn = new MySqlConnection(_connectionString))
        {
            await conn.OpenAsync();
            if (await ResolveEntityAsync(conn, t.Scope, entityId) == null)
                return BadRequest(new { message = "Please select a valid club/district." });
        }

        var dto = new CreateTopupOrderDto
        {
            Scope = t.Scope,
            ClubId = t.Scope == "club" ? entityId : 0,
            DistrictId = t.Scope == "district" ? entityId : 0,
            CreditType = creditType,
            Amount = req.Amount,
        };
        try
        {
            var res = await _wallet.CreateTopupOrderAsync(dto, 0);   // created_by = 0 (public/no-login)
            return Ok(res);
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Capture the payment. Re-checks the order's own scope/entity matches this link before crediting.
    [HttpPost("{token}/verify")]
    public async Task<ActionResult> Verify(string token, [FromBody] PublicWalletVerifyRequest req)
    {
        if (!TryToken(token, out var t, out var error))
            return BadRequest(new { message = error ?? "Invalid link." });

        var scope = await _wallet.GetOrderScopeAsync(req.TopupOrderId);
        if (scope == null) return NotFound(new { message = "Order not found." });
        if (!string.Equals(scope.Value.Scope, t.Scope, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Order does not match this link." });
        if (t.EntityId > 0)
        {
            int orderEntity = t.Scope == "club" ? scope.Value.ClubId : scope.Value.DistrictId;
            if (orderEntity != t.EntityId) return BadRequest(new { message = "Order does not match this link." });
        }

        var res = await _wallet.VerifyAndCreditAsync(new VerifyTopupDto
        {
            TopupOrderId = req.TopupOrderId,
            RazorpayOrderId = req.RazorpayOrderId,
            RazorpayPaymentId = req.RazorpayPaymentId,
            RazorpaySignature = req.RazorpaySignature,
        }, 0);
        return Ok(res);
    }
}

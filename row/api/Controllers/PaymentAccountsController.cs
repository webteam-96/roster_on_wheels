using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using RotaryApi.Services.Payments;

namespace RotaryApi.Controllers;

/// <summary>
/// A district's or club's connected payment account (admin PaymentAccountsPanel). Only the gateway switched on with
/// Payments:Provider can be connected. shortcut: the simulated gateway has no credentials, so nothing secret is stored
/// yet; add encrypted columns (Data Protection, as ClubRotaryOrgCredentialService does) with the Stripe gateway.
/// </summary>
[ApiController]
[Authorize]
[Route("api/payments")]
public class PaymentAccountsController : ControllerBase
{
    private readonly string _conn;
    private readonly PaymentCheckoutService _checkout;

    public PaymentAccountsController(IConfiguration config, PaymentCheckoutService checkout)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
        _checkout = checkout;
    }

    public sealed record ConnectRequest(string? OwnerType, int OwnerId, string? Gateway, string? DisplayName, string? Currency);
    public sealed record ActiveRequest(bool IsActive);

    private sealed record AccountRow(int Id, string OwnerType, int OwnerId, string Gateway, string DisplayName,
        string Currency, bool IsActive, DateTime? VerifiedAt);

    private const string Select = @"
        SELECT pk_id AS Id, owner_type AS OwnerType, owner_id AS OwnerId, gateway AS Gateway, display_name AS DisplayName,
               currency AS Currency, is_active AS IsActive, verified_at AS VerifiedAt
        FROM payment_accounts";

    private static object View(AccountRow a) => new
    {
        a.Id, a.OwnerType, a.OwnerId, a.Gateway, a.DisplayName, a.Currency, a.IsActive, a.VerifiedAt,
        SecretLast4 = (string?)null,
        WebhookUrl = "",
    };

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> CanManageAsync(MySqlConnection conn, string? ownerType, int ownerId)
    {
        if (ownerId <= 0 || MemberId <= 0) return false;
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, MemberId)) return true;
        if (ownerType == "club")
        {
            try { await ClubAdminAccessHelper.EnsureClubAdminAsync(conn, MemberId, ownerId); return true; }
            catch (UnauthorizedAccessException) { return false; }
        }
        if (ownerType != "district") return false;
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @District
              AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
            new { MemberId, District = ownerId }) > 0;
    }

    [HttpGet("accounts")]
    public async Task<ActionResult> List([FromQuery] string? ownerType, [FromQuery] int ownerId)
    {
        await using var conn = new MySqlConnection(_conn);
        if (!await CanManageAsync(conn, ownerType, ownerId)) return Forbid();
        var rows = await conn.QueryAsync<AccountRow>(Select + " WHERE owner_type = @ownerType AND owner_id = @ownerId ORDER BY pk_id DESC",
            new { ownerType, ownerId });
        return Ok(rows.Select(View));
    }

    [HttpGet("coverage")]
    public async Task<ActionResult> Coverage([FromQuery] string? ownerType, [FromQuery] int ownerId)
    {
        await using var conn = new MySqlConnection(_conn);
        if (!await CanManageAsync(conn, ownerType, ownerId)) return Forbid();
        return Ok(new
        {
            CountryIso = (string?)null,
            CountryName = (string?)null,
            Gateways = _checkout.GatewayCode == null ? Array.Empty<string>() : new[] { _checkout.GatewayCode },
        });
    }

    [HttpPost("accounts")]
    public async Task<ActionResult> Connect([FromBody] ConnectRequest req)
    {
        var name = req.DisplayName?.Trim();
        var currency = req.Currency?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(name) || name.Length > 100) return BadRequest(new { message = "Enter a display name." });
        if (currency == null || !Brand.Currencies.Contains(currency)) return BadRequest(new { message = "Choose a currency." });
        if (req.Gateway == null || req.Gateway != _checkout.GatewayCode)
            return BadRequest(new { message = "This payment gateway is not available yet." });

        await using var conn = new MySqlConnection(_conn);
        if (!await CanManageAsync(conn, req.OwnerType, req.OwnerId)) return Forbid();
        await conn.ExecuteAsync(@"
            INSERT INTO payment_accounts (owner_type, owner_id, gateway, display_name, currency, is_active, created_by, created_date)
            VALUES (@OwnerType, @OwnerId, @Gateway, @Name, @Currency, 1, @MemberId, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), currency = VALUES(currency), is_active = 1",
            new { req.OwnerType, req.OwnerId, req.Gateway, Name = name, Currency = currency, MemberId });
        return Ok(View(await conn.QuerySingleAsync<AccountRow>(
            Select + " WHERE owner_type = @OwnerType AND owner_id = @OwnerId AND gateway = @Gateway",
            new { req.OwnerType, req.OwnerId, req.Gateway })));
    }

    private async Task<AccountRow?> OwnedAsync(MySqlConnection conn, int id)
    {
        var account = await conn.QueryFirstOrDefaultAsync<AccountRow>(Select + " WHERE pk_id = @id", new { id });
        return account != null && await CanManageAsync(conn, account.OwnerType, account.OwnerId) ? account : null;
    }

    [HttpPost("accounts/{id:int}/verify")]
    public async Task<ActionResult> Verify(int id)
    {
        await using var conn = new MySqlConnection(_conn);
        var account = await OwnedAsync(conn, id);
        if (account == null) return NotFound();
        if (account.Gateway != _checkout.GatewayCode) return BadRequest(new { message = "This payment gateway is not available yet." });
        await conn.ExecuteAsync("UPDATE payment_accounts SET verified_at = UTC_TIMESTAMP() WHERE pk_id = @id", new { id });
        return Ok(View(await conn.QuerySingleAsync<AccountRow>(Select + " WHERE pk_id = @id", new { id })));
    }

    [HttpPut("accounts/{id:int}/active")]
    public async Task<ActionResult> SetActive(int id, [FromBody] ActiveRequest req)
    {
        await using var conn = new MySqlConnection(_conn);
        if (await OwnedAsync(conn, id) == null) return NotFound();
        await conn.ExecuteAsync("UPDATE payment_accounts SET is_active = @Active WHERE pk_id = @id", new { Active = req.IsActive, id });
        return Ok(View(await conn.QuerySingleAsync<AccountRow>(Select + " WHERE pk_id = @id", new { id })));
    }
}

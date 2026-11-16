using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Dapper;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>District and Club subscriptions (KIS/ROW/SUB/01): what a club or district may use today.</summary>
[ApiController]
[Authorize]
[Route("api/subscriptions")]
public class SubscriptionsController : ControllerBase
{
    private readonly string _connectionString;
    private readonly SubscriptionBillingService _billing;
    private readonly SubscriptionOfficers _officers;

    public SubscriptionsController(IConfiguration configuration, SubscriptionBillingService billing, SubscriptionOfficers officers)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _billing = billing;
        _officers = officers;
    }

    private bool IsSuperAdmin() => UserPermissionHelper.IsSuperAdmin(User);
    private int MemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    /// <summary>The club's access level (None / Reporting / Full) and both subscriptions' states.</summary>
    [HttpGet("club/{clubId:int}")]
    public async Task<IActionResult> GetClub(int clubId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var access = await SubscriptionAccess.GetClubAccessAsync(conn, clubId);
        if (access == null) return NotFound(new { message = "Club not found." });
        var clubName = await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId });
        var canBuy = IsSuperAdmin() || await SubscriptionOfficers.StandingAtClubAsync(conn, MemberId(), clubId) == ExecutiveStanding.Current;
        return Ok(new
        {
            clubName,
            canBuy,
            access.ClubId,
            access.DistrictId,
            level = access.Level.ToString(),
            clubSubscription = new { state = access.ClubState.ToString(), termEnd = access.ClubTermEnd },
            districtSubscription = new { state = access.DistrictState.ToString(), termEnd = access.DistrictTermEnd },
            enforced = SubscriptionAccess.Enforce,
            graceDays = SubscriptionAccess.GraceDays,
        });
    }

    /// <summary>The District subscription's state.</summary>
    [HttpGet("district/{districtId:int}")]
    public async Task<IActionResult> GetDistrict(int districtId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var (state, termEnd) = await SubscriptionAccess.GetDistrictStateAsync(conn, districtId);
        var districtNumber = await conn.ExecuteScalarAsync<string?>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @districtId AND isdeleted = 0", new { districtId });
        if (districtNumber == null) return NotFound(new { message = "District not found." });
        var canBuy = IsSuperAdmin() || await SubscriptionOfficers.IsDistrictBuyerAsync(conn, MemberId(), districtId);
        // Section 5 rows 2 and 3: clubs with no executives on record, and clubs not synced with RI. District officers only.
        var manages = IsSuperAdmin() || canBuy || await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId(), false, districtId);
        var flagged = !manages ? null : (await conn.QueryAsync(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   CASE s.status WHEN 'no_officers' THEN 'No executives on record' WHEN 'error' THEN 'RI could not be reached'
                        ELSE 'Not synced' END AS reason, s.synced_at AS syncedAt
            FROM club_master c LEFT JOIN ri_club_officer_sync s ON s.fk_club_id = c.pk_club_id
            WHERE c.fk_district_id = @districtId AND c.isdeleted = 0 AND c.IsActive = 1 AND IFNULL(s.status, 'not_synced') <> 'ok'
            ORDER BY c.ClubName LIMIT 500", new { districtId })).ToList();
        return Ok(new
        {
            districtId, districtNumber, canBuy, state = state.ToString(), termEnd,
            enforced = SubscriptionAccess.Enforce, graceDays = SubscriptionAccess.GraceDays,
            flaggedClubs = flagged,
        });
    }

    public sealed record BuyRequest(string Kind, int DistrictId, int ClubId, string? ReturnPath);

    /// <summary>Sections 4.1 / 4.3: buy or renew. Amount comes from the server; the office is checked against RI.</summary>
    [HttpPost("orders")]
    public async Task<IActionResult> Buy([FromBody] BuyRequest req)
    {
        try
        {
            var r = await _billing.CreateOrderAsync(req.Kind, req.DistrictId, req.ClubId, MemberId(), IsSuperAdmin(), req.ReturnPath);
            return Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("orders/{orderId:long}")]
    public async Task<IActionResult> GetOrder(long orderId)
    {
        var o = await _billing.GetOrderAsync(orderId, MemberId(), IsSuperAdmin());
        return o == null ? NotFound(new { message = "Order not found." }) : Ok(o);
    }

    [HttpGet("prices")]
    public async Task<IActionResult> Prices() => Ok(await _billing.GetPricesAsync());

    public sealed record PriceRequest(decimal Amount, string Currency);

    /// <summary>Super Admin sets the yearly price of each subscription.</summary>
    [HttpPut("prices/{kind}")]
    public async Task<IActionResult> SetPrice(string kind, [FromBody] PriceRequest req)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only a Super Admin can set prices." });
        try { await _billing.SetPriceAsync(kind, req.Amount, req.Currency, MemberId()); return Ok(); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    public sealed record OfflineRequest(string Kind, int DistrictId, int ClubId, decimal Amount, string Currency);

    /// <summary>Exception 7: a payment made offline, activated by Kaizen.</summary>
    [HttpPost("activate-offline")]
    public async Task<IActionResult> ActivateOffline([FromBody] OfflineRequest req)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only a Super Admin can activate an offline payment." });
        try { return Ok(new { orderId = await _billing.ActivateOfflineAsync(req.Kind, req.DistrictId, req.ClubId, MemberId(), req.Amount, req.Currency) }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    /// <summary>The club's executives from RI (section 2), and the last sync result (section 5: clubs without executives).</summary>
    [HttpGet("club/{clubId:int}/executives")]
    public async Task<IActionResult> Executives(int clubId, [FromQuery] bool refresh = false)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (!IsSuperAdmin() && !await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, MemberId(), true, clubId))
            return StatusCode(403, new { message = "You do not have access to this club." });
        SubscriptionOfficers.SyncResult? sync = null;
        if (refresh && IsSuperAdmin()) sync = await _officers.SyncClubAsync(conn, clubId);
        var execs = await SubscriptionOfficers.GetExecutivesAsync(conn, clubId);
        var isOwn = IsSuperAdmin() || execs.Any(e => e.MemberId == MemberId());
        return Ok(new
        {
            sync,
            executives = execs.Select(e => new
            {
                e.Role, standing = e.Standing.ToString(), e.Start, e.End, e.Name,
                hasRowLogin = e.MemberId != null,
                email = isOwn ? e.Email : null,
            }),
        });
    }

    /// <summary>Runs the daily pass now (renewal reminders, officer sync). Super Admin only.</summary>
    [HttpPost("run-daily")]
    public async Task<IActionResult> RunDaily([FromServices] SubscriptionDailyService daily, CancellationToken ct)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only a Super Admin can run this." });
        return Ok(new { done = await daily.RunAsync(ct) });
    }
}

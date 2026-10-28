using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// DGE sign-up at the booth (build spec 3.1, decision 2026-10-28). A governor-elect signs the district up on a public
/// page (plan and member band); nothing happens until a Super Admin marks the sign-up paid, which is a stub until
/// Stripe: that creates the district tenant with Club Basic for every club and starts planning with the DGE (matched
/// by email), who is emailed the launchpad. Planning mode (planning_mode) must be on.
/// </summary>
[ApiController]
public class BoothSignupController : ControllerBase
{
    private readonly string _cs;
    private readonly PlanningService _planning;
    private readonly IAuditLogService _audit;

    public BoothSignupController(IConfiguration config, PlanningService planning, IAuditLogService audit)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _planning = planning;
        _audit = audit;
    }

    public const string TableSql = @"
        CREATE TABLE IF NOT EXISTS booth_signups (
            pk_signup_id INT AUTO_INCREMENT PRIMARY KEY,
            fk_district_id INT NOT NULL,
            edition_code VARCHAR(20) NOT NULL,
            member_band VARCHAR(20) NULL,
            contact_name VARCHAR(150) NOT NULL,
            contact_email VARCHAR(200) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'awaiting_payment',
            payment_note VARCHAR(200) NULL,
            result_note VARCHAR(500) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            decided_by INT NULL,
            decided_at DATETIME NULL,
            KEY ix_booth_status (status, created_at)
        )";

    public record SignupDto(int DistrictId, string EditionCode, string? MemberBand, string Name, string Email);
    public record SignupRow(int Id, int DistrictId, string? DistrictNumber, string EditionCode, string? MemberBand,
        string ContactName, string ContactEmail, string Status, string? PaymentNote, string? ResultNote, DateTime CreatedAt);
    public record ProvisionDto(string? PaymentNote);

    private bool IsSuperAdmin => (User.FindFirst("roles")?.Value ?? "").Split(',').Select(r => r.Trim()).Contains("SuperAdmin");
    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    /// <summary>What the public page offers: whether sign-ups are open, the districts and the plans.</summary>
    [HttpGet("api/public/booth/options")]
    [AllowAnonymous]
    public async Task<IActionResult> Options()
    {
        var open = await FeatureGate.IsOnAsync("planning_mode", _cs);
        if (!open) return Ok(new { open, districts = Array.Empty<object>(), editions = Array.Empty<object>() });
        await using var c = new MySqlConnection(_cs);
        var districts = await c.QueryAsync("SELECT pk_district_id AS id, DistrictNumber AS number FROM district_master WHERE isdeleted = 0 ORDER BY DistrictNumber");
        var editions = await c.QueryAsync("SELECT code, name FROM edition_catalogue WHERE code <> 'club_basic' ORDER BY name");
        return Ok(new { open, districts, editions });
    }

    [HttpPost("api/public/booth/signups")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> SignUp([FromBody] SignupDto dto)
    {
        if (!await FeatureGate.IsOnAsync("planning_mode", _cs)) return NotFound(new { message = "Sign-ups are not open." });
        var name = dto.Name?.Trim() ?? "";
        var email = dto.Email?.Trim() ?? "";
        if (name.Length is 0 or > 150) return BadRequest(new { message = "Give your name (150 characters at most)." });
        if (email.Length > 200 || !System.Net.Mail.MailAddress.TryCreate(email, out _)) return BadRequest(new { message = "Give a valid email address." });
        if (dto.MemberBand?.Length > 20) return BadRequest(new { message = "Member band is 20 characters at most." });
        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_master WHERE pk_district_id = @DistrictId AND isdeleted = 0", new { dto.DistrictId }) == 0
            || await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM edition_catalogue WHERE code = @EditionCode", new { dto.EditionCode }) == 0)
            return BadRequest(new { message = "Pick your district and a plan." });
        // one open sign-up per district and email: a repeat updates it instead of piling up
        var id = await c.ExecuteScalarAsync<int?>(@"SELECT pk_signup_id FROM booth_signups
            WHERE fk_district_id = @DistrictId AND contact_email = @email AND status = 'awaiting_payment' LIMIT 1", new { dto.DistrictId, email });
        if (id is int existing)
            await c.ExecuteAsync(@"UPDATE booth_signups SET edition_code = @EditionCode, member_band = @MemberBand, contact_name = @name
                WHERE pk_signup_id = @existing", new { dto.EditionCode, dto.MemberBand, name, existing });
        else
            id = await c.ExecuteScalarAsync<int>(@"INSERT INTO booth_signups (fk_district_id, edition_code, member_band, contact_name, contact_email)
                VALUES (@DistrictId, @EditionCode, @MemberBand, @name, @email); SELECT LAST_INSERT_ID();",
                new { dto.DistrictId, dto.EditionCode, dto.MemberBand, name, email });
        return Ok(new { id, status = "awaiting_payment" });
    }

    [HttpGet("api/booth/signups")]
    [Authorize]
    public async Task<IActionResult> List()
    {
        if (!IsSuperAdmin) return StatusCode(403, new { message = "Super Admin only." });
        await using var c = new MySqlConnection(_cs);
        return Ok(await c.QueryAsync<SignupRow>(@"
            SELECT s.pk_signup_id AS Id, s.fk_district_id AS DistrictId, d.DistrictNumber, s.edition_code AS EditionCode,
                   s.member_band AS MemberBand, s.contact_name AS ContactName, s.contact_email AS ContactEmail, s.status AS Status,
                   s.payment_note AS PaymentNote, s.result_note AS ResultNote, s.created_at AS CreatedAt
            FROM booth_signups s LEFT JOIN district_master d ON d.pk_district_id = s.fk_district_id
            ORDER BY s.status = 'awaiting_payment' DESC, s.created_at DESC LIMIT 200"));
    }

    /// <summary>The payment stub: a Super Admin confirms the payment was taken, then the tenant is set up.</summary>
    [HttpPost("api/booth/signups/{id:int}/provision")]
    [Authorize]
    public async Task<IActionResult> Provision(int id, [FromBody] ProvisionDto dto)
    {
        if (!IsSuperAdmin) return StatusCode(403, new { message = "Super Admin only." });
        if (!await FeatureGate.IsOnAsync("planning_mode", _cs)) return Conflict(new { message = "Turn planning mode on first (Settings > Features)." });
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var s = await c.QueryFirstOrDefaultAsync<(int DistrictId, string Edition, string? Band, string Email, string Status)?>(@"
            SELECT fk_district_id, edition_code, member_band, contact_email, status FROM booth_signups WHERE pk_signup_id = @id", new { id });
        if (s is not { } signup) return NotFound(new { message = "Sign-up not found." });
        if (signup.Status != "awaiting_payment") return Conflict(new { message = "This sign-up is already decided." });

        await using (var tx = await c.BeginTransactionAsync())
        {
            await c.ExecuteAsync(@"
                INSERT INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code, member_band, state, created_by)
                VALUES (@DistrictId, 0, @Edition, @Band, 'planning', @Me)
                ON DUPLICATE KEY UPDATE edition_code = VALUES(edition_code), member_band = VALUES(member_band), modified_by = @Me",
                new { signup.DistrictId, signup.Edition, signup.Band, Me }, tx);
            // same provisioning as TenantsController.SetTenant: Club Basic for every club, rotaract for Rotaract clubs
            await c.ExecuteAsync(@"
                INSERT IGNORE INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code, created_by)
                SELECT @DistrictId, c.pk_club_id, IF(COALESCE(c.ClubType, '') = 'Rotaract Club', 'rotaract', 'club_basic'), @Me
                FROM club_master c WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0", new { signup.DistrictId, Me }, tx);
            await c.ExecuteAsync(@"UPDATE booth_signups SET status = 'provisioned', payment_note = @note, decided_by = @Me, decided_at = NOW()
                WHERE pk_signup_id = @id", new { note = dto.PaymentNote?.Trim() is { Length: > 0 } n ? n[..Math.Min(n.Length, 200)] : "Marked paid by Super Admin", Me, id }, tx);
            await tx.CommitAsync();
        }

        // start planning with the DGE when ROW knows them by this email; otherwise the Super Admin starts it later
        var dge = await c.ExecuteScalarAsync<int?>(@"SELECT pk_member_master_profile_id FROM member_master_profile
            WHERE EmailId = @Email AND isdeleted = 0 LIMIT 1", new { signup.Email });
        string result;
        try
        {
            if (dge == null) throw new ArgumentException("ROW has no member with this email.");
            await _planning.StartAsync(signup.DistrictId, dge, Me, HttpContext);
            result = "Tenant created in planning; the governor-elect was emailed the launchpad.";
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or KeyNotFoundException)
        {
            result = $"Tenant created. Planning not started: {ex.Message} Start it from the district's planning page.";
        }
        await c.ExecuteAsync("UPDATE booth_signups SET result_note = @result WHERE pk_signup_id = @id", new { result, id });
        await _audit.LogAsync(Me, "PROVISION", "booth_signup", id, signup.Edition, new { signup.DistrictId, signup.Edition, planningStarted = result.StartsWith("Tenant created in planning") }, HttpContext);
        return Ok(new { id, status = "provisioned", result });
    }

    [HttpPost("api/booth/signups/{id:int}/reject")]
    [Authorize]
    public async Task<IActionResult> Reject(int id)
    {
        if (!IsSuperAdmin) return StatusCode(403, new { message = "Super Admin only." });
        await using var c = new MySqlConnection(_cs);
        var n = await c.ExecuteAsync(@"UPDATE booth_signups SET status = 'rejected', decided_by = @Me, decided_at = NOW()
            WHERE pk_signup_id = @id AND status = 'awaiting_payment'", new { id, Me });
        return n == 0 ? Conflict(new { message = "Only a sign-up waiting for payment can be rejected." }) : Ok(new { id, status = "rejected" });
    }
}

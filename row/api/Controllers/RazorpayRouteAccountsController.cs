using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

// SuperAdmin CRUD for Razorpay Route (marketplace) linked accounts. The linked account
// (acc_XXXXXXXX) must already be created/activated in the Razorpay dashboard; this module
// only stores/selects the account id so the club-website pricing tab can route a club's
// payment to it. Backing table: razorpay_route_accounts (SQL/razorpay_route_accounts.sql).
[ApiController]
[Route("api/admin/razorpay-route-accounts")]
[Authorize]
public class RazorpayRouteAccountsController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IRazorpayRouteService _route;
    private readonly IEmailService _email;
    private readonly ILogger<RazorpayRouteAccountsController> _logger;

    // Route-onboarding OTPs reuse the shared event_payment_otp table, namespaced per admin so
    // they never collide with real dues/event link ids.
    private const int RouteOtpLinkBase = 900_000_000;
    private int OtpLinkId() => RouteOtpLinkBase + GetUserId();

    public RazorpayRouteAccountsController(IConfiguration config, IRazorpayRouteService route,
        IEmailService email, ILogger<RazorpayRouteAccountsController> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _route = route;
        _email = email;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    public class RouteAccountRequest
    {
        public string? AccountId { get; set; }
        public string? Name { get; set; }
        public bool IsActive { get; set; } = true;
        public string? Notes { get; set; }
        // Settlement bank details — not returned by Razorpay's Route API in a reliably
        // structured form, so this is the SuperAdmin re-entering/backfilling what they
        // already typed in at onboarding (see RazorpayRouteOnboardingDto.BankAccountNumber).
        public string? BankAccountNumber { get; set; }
        public string? BankIfsc { get; set; }
    }

    [HttpGet]
    public async Task<ActionResult> List([FromQuery] bool activeOnly = false)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT pk_id AS id, AccountId AS accountId, Name AS name, IsActive AS isActive,
                   Notes AS notes, Status AS status, StakeholderId AS stakeholderId,
                   ProductConfigId AS productConfigId, StatusRefreshedDate AS statusRefreshedDate,
                   BankAccountLast4 AS bankAccountLast4, BankIfsc AS bankIfsc,
                   created_date AS createdDate, modified_date AS modifiedDate, RazorpayJson AS razorpayJson
            FROM razorpay_route_accounts
            WHERE isdeleted = 0";
        if (activeOnly) sql += " AND IsActive = 1";
        sql += " ORDER BY Name";
        var rows = (await conn.QueryAsync<dynamic>(sql)).ToList();
        // Surface the settlement bank details (account_number / beneficiary_name / ifsc_code),
        // which are only stored inside the raw RazorpayJson. Additive — existing consumers ignore them.
        var result = rows.Select(r =>
        {
            var d = (IDictionary<string, object>)r;
            var (acctNo, benName, ifsc) = ExtractBankFromRazorpayJson(d.TryGetValue("razorpayJson", out var j) ? j as string : null);
            return new
            {
                id = d["id"], accountId = d["accountId"], name = d["name"], isActive = d["isActive"],
                notes = d["notes"], status = d["status"], stakeholderId = d["stakeholderId"],
                productConfigId = d["productConfigId"], statusRefreshedDate = d["statusRefreshedDate"],
                createdDate = d["createdDate"], modifiedDate = d["modifiedDate"],
                bankAccountLast4 = d.TryGetValue("bankAccountLast4", out var b4) ? b4 : null,
                bankIfsc = d.TryGetValue("bankIfsc", out var bi) ? bi : null,
                accountNumber = acctNo, beneficiaryName = benName, ifsc = ifsc
            };
        });
        return Ok(result);
    }

    // Pull account_number / beneficiary_name / ifsc(_code) out of the stored Razorpay linked-account
    // JSON, wherever they're nested. Returns nulls if absent or unparseable.
    private static (string? accountNumber, string? beneficiaryName, string? ifsc) ExtractBankFromRazorpayJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return (null, null, null);
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            string? acct = null, ben = null, ifsc = null;
            void Walk(System.Text.Json.JsonElement el)
            {
                if (el.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    foreach (var p in el.EnumerateObject())
                    {
                        if (p.Value.ValueKind == System.Text.Json.JsonValueKind.String)
                        {
                            var key = p.Name.ToLowerInvariant();
                            if (acct == null && key == "account_number") acct = p.Value.GetString();
                            else if (ben == null && key == "beneficiary_name") ben = p.Value.GetString();
                            else if (ifsc == null && (key == "ifsc_code" || key == "ifsc")) ifsc = p.Value.GetString();
                        }
                        else Walk(p.Value);
                    }
                }
                else if (el.ValueKind == System.Text.Json.JsonValueKind.Array)
                    foreach (var item in el.EnumerateArray()) Walk(item);
            }
            Walk(doc.RootElement);
            return (acct, ben, ifsc);
        }
        catch { return (null, null, null); }
    }

    // The logged-in SuperAdmin's own registered email (the OTP is sent here — the admin
    // always controls this inbox, so it's a proper action-confirmation gate).
    private async Task<string?> GetAdminEmailAsync(MySqlConnection conn)
    {
        var uid = GetUserId();
        if (uid <= 0) return null;
        return await conn.ExecuteScalarAsync<string?>(
            "SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = uid });
    }

    // Sends a 6-digit OTP to the LOGGED-IN SuperAdmin's email; must be verified on Create.
    [HttpPost("send-otp")]
    public async Task<ActionResult> SendOtp()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var email = (await GetAdminEmailAsync(conn))?.Trim();
        if (string.IsNullOrWhiteSpace(email))
            return BadRequest(new { message = "Your account has no email on file to send the OTP to." });

        var otp = System.Security.Cryptography.RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
        await conn.ExecuteAsync(@"
            INSERT INTO event_payment_otp (fk_payment_link_id, Email, Mobile, OtpCode, ExpiresAt)
            VALUES (@LinkId, @Email, NULL, @Otp, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
            new { LinkId = OtpLinkId(), Email = email, Otp = otp });

        try
        {
            await _email.SendGenericEmailAsync(email!, "Razorpay Route Onboarding — OTP Verification",
                $@"{EmailService.EMAIL_HEADER}
                    <h2 style='color:#1a365d;margin-top:0;'>OTP Verification</h2>
                    <p>Your OTP to confirm creating this Razorpay Route linked account is:</p>
                    <div style='text-align:center;margin:20px 0;'>
                        <span style='font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a365d;'>{otp}</span>
                    </div>
                    <p style='color:#718096;'>Valid for 10 minutes.</p>
                {EmailService.EMAIL_FOOTER}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Route onboarding OTP email failed to {Email}", LogMask.Email(email));
            return StatusCode(500, new { message = "Failed to send the OTP email." });
        }
        return Ok(new { success = true, email });
    }

    // Verify + consume the route-onboarding OTP for this admin/email.
    private async Task<bool> VerifyOtpAsync(MySqlConnection conn, string? email, string? otp)
    {
        if (string.IsNullOrWhiteSpace(otp) || string.IsNullOrWhiteSpace(email)) return false;
        var valid = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM event_payment_otp
            WHERE fk_payment_link_id = @LinkId AND Email = @Email AND OtpCode = @Code
              AND ExpiresAt > NOW() AND IsVerified = 0",
            new { LinkId = OtpLinkId(), Email = email.Trim(), Code = otp.Trim() });
        if (valid == 0) return false;
        await conn.ExecuteAsync(@"
            UPDATE event_payment_otp SET IsVerified = 1
            WHERE fk_payment_link_id = @LinkId AND Email = @Email AND OtpCode = @Code",
            new { LinkId = OtpLinkId(), Email = email.Trim(), Code = otp.Trim() });
        return true;
    }

    // Creates the linked account ON Razorpay (account + stakeholder + Route product + settlement
    // bank), then stores the returned acc_… id locally. If the account itself can't be created,
    // nothing is saved and Razorpay's error is surfaced. If the account IS created but a later step
    // fails, the acc_… id is still persisted (so it isn't orphaned) and the warnings are returned.
    [HttpPost]
    public async Task<ActionResult> Create([FromBody] RazorpayRouteOnboardingDto req)
    {
        if (!IsSuperAdmin()) return Forbid();

        // Minimal required set — everything else is generic-defaulted server-side.
        if (string.IsNullOrWhiteSpace(req.LegalBusinessName)) return BadRequest(new { message = "Account name is required." });
        if (string.IsNullOrWhiteSpace(req.Email)) return BadRequest(new { message = "Contact email is required." });
        if (string.IsNullOrWhiteSpace(req.BankAccountNumber)) return BadRequest(new { message = "Settlement account number is required." });
        if (string.IsNullOrWhiteSpace(req.BankIfsc)) return BadRequest(new { message = "Settlement IFSC is required." });

        var name = string.IsNullOrWhiteSpace(req.Name) ? req.LegalBusinessName!.Trim() : req.Name!.Trim();

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // OTP gate — verify against the logged-in admin's email BEFORE any Razorpay call, so a bad
        // OTP never creates a real account.
        var adminEmail = await GetAdminEmailAsync(conn);
        if (!await VerifyOtpAsync(conn, adminEmail, req.Otp))
            return BadRequest(new { message = "Invalid or expired OTP. Please request a new one." });

        var result = await _route.CreateLinkedAccountAsync(req);
        if (!result.AccountCreated)
            return BadRequest(new { message = result.FatalError ?? "Could not create the linked account on Razorpay." });

        // Razorpay's Route API doesn't reliably echo the settlement bank details back in a
        // structured form, so persist what the SuperAdmin already typed in (and Razorpay already
        // accepted) at onboarding, rather than trying to parse it back out of a response.
        var bankLast4 = req.BankAccountNumber!.Trim()[^Math.Min(4, req.BankAccountNumber.Trim().Length)..];
        var bankIfsc = req.BankIfsc!.Trim();

        // Account exists on Razorpay now — persist the id + onboarding state even if later steps warned.
        var dup = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM razorpay_route_accounts WHERE AccountId = @A AND isdeleted = 0",
            new { A = result.AccountId });
        int id;
        if (dup > 0)
        {
            id = await conn.ExecuteScalarAsync<int>(
                "SELECT pk_id FROM razorpay_route_accounts WHERE AccountId = @A AND isdeleted = 0 LIMIT 1",
                new { A = result.AccountId });
            await conn.ExecuteAsync(@"
                UPDATE razorpay_route_accounts
                SET Status = @Status, StakeholderId = @Sth, ProductConfigId = @Prod, RazorpayJson = @Json,
                    BankAccountLast4 = @BankLast4, BankIfsc = @BankIfsc,
                    StatusRefreshedDate = NOW(), modified_by = @User, modified_date = NOW()
                WHERE pk_id = @Id",
                new { Status = result.Status, Sth = result.StakeholderId, Prod = result.ProductConfigId,
                      Json = result.RawJson, BankLast4 = bankLast4, BankIfsc = bankIfsc, User = GetUserId(), Id = id });
        }
        else
        {
            id = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO razorpay_route_accounts
                    (AccountId, Name, IsActive, Notes, Status, StakeholderId, ProductConfigId, RazorpayJson,
                     BankAccountLast4, BankIfsc, StatusRefreshedDate, created_by, created_date)
                VALUES (@AccountId, @Name, @IsActive, @Notes, @Status, @Sth, @Prod, @Json, @BankLast4, @BankIfsc, NOW(), @User, NOW());
                SELECT LAST_INSERT_ID();",
                new { AccountId = result.AccountId, Name = name, IsActive = req.IsActive ? 1 : 0, Notes = req.Notes?.Trim(),
                      Status = result.Status, Sth = result.StakeholderId, Prod = result.ProductConfigId, Json = result.RawJson,
                      BankLast4 = bankLast4, BankIfsc = bankIfsc, User = GetUserId() });
        }

        return Ok(new { success = true, id, accountId = result.AccountId, status = result.Status, warnings = result.Warnings });
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] RouteAccountRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        var accountId = req.AccountId?.Trim();
        var name = req.Name?.Trim();
        if (string.IsNullOrWhiteSpace(accountId))
            return BadRequest(new { message = "Razorpay account id (acc_…) is required." });
        if (!accountId.StartsWith("acc_", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Account id must be a Razorpay linked account id starting with 'acc_'." });
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { message = "Display name is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var dup = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM razorpay_route_accounts WHERE AccountId = @A AND pk_id <> @Id AND isdeleted = 0",
            new { A = accountId, Id = id });
        if (dup > 0) return BadRequest(new { message = "This account id already exists." });

        var bankLast4 = string.IsNullOrWhiteSpace(req.BankAccountNumber)
            ? null
            : req.BankAccountNumber.Trim()[^Math.Min(4, req.BankAccountNumber.Trim().Length)..];

        var updated = await conn.ExecuteAsync(@"
            UPDATE razorpay_route_accounts
            SET AccountId = @AccountId, Name = @Name, IsActive = @IsActive, Notes = @Notes,
                BankAccountLast4 = COALESCE(@BankLast4, BankAccountLast4),
                BankIfsc = COALESCE(@BankIfsc, BankIfsc),
                modified_by = @User, modified_date = NOW()
            WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id, AccountId = accountId, Name = name, IsActive = req.IsActive ? 1 : 0, Notes = req.Notes?.Trim(),
                  BankLast4 = bankLast4, BankIfsc = string.IsNullOrWhiteSpace(req.BankIfsc) ? null : req.BankIfsc.Trim(), User = GetUserId() });
        if (updated == 0) return NotFound(new { message = "Record not found." });
        return Ok(new { success = true });
    }

    // Pull live status from Razorpay for one account and store it. Prefers the product's
    // activation_status (matches the dashboard "Account Status") when a product config exists.
    [HttpPost("{id}/refresh")]
    public async Task<ActionResult> Refresh(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT AccountId AS accountId, ProductConfigId AS productConfigId FROM razorpay_route_accounts WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (row == null) return NotFound(new { message = "Account not found." });
        string? accountId = (string?)row.accountId;
        if (string.IsNullOrWhiteSpace(accountId) || !accountId.StartsWith("acc_", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "This account has no live Razorpay account id to refresh." });

        var (status, raw) = await RefreshOneAsync(conn, id, accountId!, (string?)row.productConfigId);
        return Ok(new { success = true, status });
    }

    // Refresh every account not yet activated.
    [HttpPost("refresh-all")]
    public async Task<ActionResult> RefreshAll()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, AccountId AS accountId, ProductConfigId AS productConfigId, Status AS status
            FROM razorpay_route_accounts WHERE isdeleted = 0
              AND (Status IS NULL OR LOWER(Status) NOT IN ('activated','active'))")).ToList();
        int refreshed = 0;
        foreach (var r in rows)
        {
            string? accountId = (string?)r.accountId;
            if (string.IsNullOrWhiteSpace(accountId) || !accountId.StartsWith("acc_", StringComparison.OrdinalIgnoreCase)) continue;
            try { await RefreshOneAsync(conn, (int)r.id, accountId!, (string?)r.productConfigId); refreshed++; }
            catch (Exception ex) { _logger.LogWarning(ex, "Route refresh failed for {AccountId}", accountId); }
        }
        return Ok(new { success = true, refreshed });
    }

    private async Task<(string? status, string raw)> RefreshOneAsync(MySqlConnection conn, int id, string accountId, string? productConfigId)
    {
        var acc = await _route.GetLinkedAccountAsync(accountId);
        string? status = acc.Status;
        string raw = acc.RawJson;
        if (!string.IsNullOrWhiteSpace(productConfigId))
        {
            var prod = await _route.GetRouteProductAsync(accountId, productConfigId);
            if (!string.IsNullOrWhiteSpace(prod.Status)) { status = prod.Status; raw = prod.RawJson; }
        }
        await conn.ExecuteAsync(@"
            UPDATE razorpay_route_accounts
            SET Status = COALESCE(@Status, Status), RazorpayJson = COALESCE(@Json, RazorpayJson), StatusRefreshedDate = NOW()
            WHERE pk_id = @Id",
            new { Status = status, Json = string.IsNullOrWhiteSpace(raw) ? null : raw, Id = id });
        return (status, raw);
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Guard: don't soft-delete an account still referenced by a club's pricing config.
        var inUse = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_website_pricing WHERE fk_route_account_id = @Id",
            new { Id = id });
        if (inUse > 0)
            return BadRequest(new { message = $"This account is used by {inUse} club pricing configuration(s). Reassign them before deleting." });

        var deleted = await conn.ExecuteAsync(
            "UPDATE razorpay_route_accounts SET isdeleted = 1, modified_by = @User, modified_date = NOW() WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id, User = GetUserId() });
        if (deleted == 0) return NotFound(new { message = "Record not found." });
        return Ok(new { success = true });
    }
}

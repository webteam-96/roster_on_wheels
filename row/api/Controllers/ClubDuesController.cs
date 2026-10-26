using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Web admin surface for Club Dues (District Dues). SuperAdmin CRUD, plus:
//   • officer/*  — Club President/Secretary/Treasurer pay their own club (BOD-gated)
//   • {id}/content, my-district — District Admin edits branding + email copy only
// Separate from MembershipDuesController — never touches membership dues.
[ApiController]
[Route("api/club-dues")]
[Authorize]
public class ClubDuesController : ControllerBase
{
    private readonly IClubDuesService _service;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly string _connStr;

    public ClubDuesController(IClubDuesService service, IWebHostEnvironment env, IConfiguration config)
    {
        _service = service;
        _env = env;
        _config = config;
        _connStr = config.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // Was "SuperAdmin or Admin": in ROW every club admin holds Admin, so any of them could read and change every
    // district's campaigns. District admins keep their own district through the IsDistrictAdmin* checks below.
    private bool IsSuperAdmin() => UserPermissionHelper.IsSuperAdmin(User);

    private ObjectResult Denied() => StatusCode(403, new { message = "Access denied." });

    // A member may pay for a club only if they are its President / Secretary /
    // Treasurer in the CURRENT rotary year (matched by designation NAME), and only
    // for a campaign of the club's own district (else any officer could open another
    // district's campaign, its bank details and pay link).
    // Same rule as MobileClubDuesController.CanPayForClubAsync, plus the district match.
    private async Task<bool> CanPayForClubAsync(int memberId, int clubId, int duesId)
    {
        if (memberId <= 0 || clubId <= 0) return false;
        await using var conn = new MySqlConnection(_connStr);
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM board_of_directors bod
            JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            JOIN club_master c ON c.pk_club_id = bod.fk_club_id
            JOIN club_dues cd ON cd.pk_club_dues_id = @DuesId AND cd.fk_district_id = c.fk_district_id AND cd.isdeleted = 0
            WHERE bod.fk_club_id = @ClubId
              AND bod.fk_member_master_profile_id = @MemberId
              AND COALESCE(bod.isdeleted, 0) = 0
              AND y.IsCurrent = 1
              AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer')",
            new { ClubId = clubId, MemberId = memberId, DuesId = duesId });
        return count > 0;
    }

    private ObjectResult OfficerDenied() => StatusCode(403, new { message = "Only the Club President, Secretary or Treasurer can pay district dues." });

    // True when this member is a District Admin (member_roles fk_role_id=2, no club) for the
    // district that owns the given campaign. Mirrors ClubAdminAccessHelper's district pattern,
    // scoped to the campaign's district. SuperAdmin always passes via IsSuperAdmin.
    private async Task<bool> IsDistrictAdminForDuesAsync(int memberId, int duesId)
    {
        if (memberId <= 0 || duesId <= 0) return false;
        await using var conn = new MySqlConnection(_connStr);
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_dues cd
            JOIN member_roles mr ON mr.fk_district_id = cd.fk_district_id
            WHERE cd.pk_club_dues_id = @DuesId AND cd.isdeleted = 0
              AND mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { DuesId = duesId, MemberId = memberId });
        return count > 0;
    }

    // District Admin of the district that owns the campaign this PAYMENT belongs to.
    // Used to let a district admin approve/reject/view offline payments for their own clubs.
    private async Task<bool> IsDistrictAdminForPaymentAsync(int memberId, int paymentId)
    {
        if (memberId <= 0 || paymentId <= 0) return false;
        await using var conn = new MySqlConnection(_connStr);
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_dues_payments p
            JOIN club_dues cd ON cd.pk_club_dues_id = p.fk_club_dues_id
            JOIN member_roles mr ON mr.fk_district_id = cd.fk_district_id
            WHERE p.pk_club_dues_payment_id = @PaymentId AND p.isdeleted = 0
              AND mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { PaymentId = paymentId, MemberId = memberId });
        return count > 0;
    }

    // ── CRUD ───────────────────────────────────────────────────────
    [HttpGet("")]
    public async Task<ActionResult> GetList([FromQuery] int? districtId, [FromQuery] string? search, [FromQuery] string? year)
    {
        if (!IsSuperAdmin()) return Denied();
        return Ok(await _service.GetListAsync(districtId, search, year));
    }

    [HttpGet("{id}")]
    public async Task<ActionResult> GetDetail(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        var result = await _service.GetDetailAsync(id);
        if (result == null) return NotFound(new { message = "District dues not found." });
        return Ok(result);
    }

    [HttpPost("")]
    public async Task<ActionResult> Create([FromForm] CreateClubDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!IsSuperAdmin()) return Denied();
        try
        {
            var id = await _service.CreateAsync(dto, logo, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { id });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromForm] CreateClubDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!IsSuperAdmin()) return Denied();
        await _service.UpdateAsync(id, dto, logo, bgImage, emailLogo, GetUserId(), _env);
        return Ok(new { message = "Updated." });
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Deleted." });
    }

    [HttpPatch("{id}/toggle-active")]
    public async Task<ActionResult> ToggleActive(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        await _service.ToggleActiveAsync(id, GetUserId());
        return Ok(new { message = "Toggled." });
    }

    // ── Clubs + members ────────────────────────────────────────────
    [HttpPost("{id}/sync")]
    public async Task<ActionResult> Sync(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        await _service.SyncClubsAndMembersAsync(id, GetUserId());
        return Ok(new { message = "Synced." });
    }

    [HttpGet("{id}/clubs")]
    public async Task<ActionResult> GetClubs(int id, [FromQuery] string? search, [FromQuery] bool includeNonSynced = true)
    {
        // Read-only: SuperAdmin OR the campaign's district admin (to see paid/pending clubs).
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        return Ok(await _service.GetClubsAsync(id, search, includeNonSynced));
    }

    [HttpGet("{id}/clubs/{clubId}/members")]
    public async Task<ActionResult> GetClubMembers(int id, int clubId)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        return Ok(await _service.GetClubMembersAsync(id, clubId));
    }

    [HttpPut("{id}/clubs/{clubDuesClubId}/rate")]
    public async Task<ActionResult> UpdateRate(int id, int clubDuesClubId, [FromBody] UpdateClubDuesRateDto dto)
    {
        if (!IsSuperAdmin()) return Denied();
        await _service.UpdateClubRateAsync(id, clubDuesClubId, dto, GetUserId());
        return Ok(new { message = "Rate updated." });
    }

    // ── Offline + approval ─────────────────────────────────────────
    // SuperAdmin OR the campaign's district admin may record an offline payment for a club
    // (recorded as paid directly — the district is the authority on money it received offline).
    [HttpPost("{id}/offline-payment")]
    public async Task<ActionResult> RecordOffline(int id, [FromForm] RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        var paymentId = await _service.RecordOfflinePaymentAsync(id, dto, attachment, GetUserId(), _env);
        return Ok(new { paymentId });
    }

    [HttpPost("payments/{paymentId}/approve-reject")]
    public async Task<ActionResult> ApproveReject(int paymentId, [FromBody] ApproveClubDuesPaymentDto dto)
    {
        // SuperAdmin OR the district admin of the district that owns this payment's campaign.
        if (!IsSuperAdmin() && !await IsDistrictAdminForPaymentAsync(GetUserId(), paymentId)) return Denied();
        try
        {
            await _service.ApproveRejectPaymentAsync(paymentId, dto, GetUserId());
            return Ok(new { message = dto.IsApproved ? "Approved." : "Rejected." });
        }
        catch (AlreadyHandledException ex)
        {
            return Ok(new { alreadyHandled = true, message = ex.Message });
        }
    }

    [HttpPost("payments/{paymentId}/receipt")]
    public async Task<ActionResult> SendReceipt(int paymentId)
    {
        if (!IsSuperAdmin()) return Denied();
        await _service.SendReceiptEmailAsync(paymentId);
        return Ok(new { message = "Receipt sent." });
    }

    [HttpGet("payments/{paymentId}/offline-details")]
    public async Task<ActionResult> GetOfflineDetails(int paymentId)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForPaymentAsync(GetUserId(), paymentId)) return Denied();
        var d = await _service.GetOfflinePaymentDetailAsync(paymentId);
        if (d == null) return NotFound(new { message = "Offline payment not found." });
        return Ok(d);
    }

    [HttpPut("payments/{paymentId}/update-offline")]
    public async Task<ActionResult> UpdateOffline(int paymentId, [FromForm] RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForPaymentAsync(GetUserId(), paymentId)) return Denied();
        await _service.UpdateOfflinePaymentAsync(paymentId, dto, attachment, GetUserId(), _env);
        return Ok(new { message = "Offline payment updated." });
    }

    // ── Per-club Razorpay split override ────────────────────────
    [HttpGet("{id}/clubs/{clubId}/vendors")]
    public async Task<ActionResult> GetClubVendors(int id, int clubId)
    {
        if (!IsSuperAdmin()) return Denied();
        return Ok(await _service.GetClubVendorsAsync(id, clubId));
    }

    [HttpGet("{id}/all-club-vendors")]
    public async Task<ActionResult> GetAllClubVendors(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        return Ok(await _service.GetAllClubVendorsAsync(id));
    }

    [HttpPut("{id}/clubs/{clubId}/vendors")]
    public async Task<ActionResult> SaveClubVendors(int id, int clubId, [FromBody] ClubVendorsSaveDto dto)
    {
        if (!IsSuperAdmin()) return Denied();
        await _service.SaveClubVendorsAsync(id, clubId, dto.VendorsJson, GetUserId(), dto.IsOnline);
        return Ok(new { message = "Split saved." });
    }

    // Offline-payment account picker (admin side): effective accounts for this club — its own
    // override if configured, else the campaign default. Same accounts used for online routing.
    [HttpGet("{id}/clubs/{clubId}/offline-accounts")]
    public async Task<ActionResult> GetOfflineAccounts(int id, int clubId)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        return Ok(await _service.GetOfflineAccountOptionsAsync(id, clubId));
    }

    // Offline-payment account picker (officer side) — same data, gated by club-officer check
    // instead of admin, matching OfficerOffline's auth pattern.
    [HttpGet("officer/{duesId}/offline-accounts")]
    public async Task<ActionResult> OfficerGetOfflineAccounts(int duesId, [FromQuery] int clubId)
    {
        if (!await CanPayForClubAsync(GetUserId(), clubId, duesId)) return OfficerDenied();
        return Ok(await _service.GetOfflineAccountOptionsAsync(duesId, clubId));
    }

    // ── Reminders ──────────────────────────────────────────────────
    // Email reminders may be sent by SuperAdmin OR the campaign's district admin.
    [HttpPost("{id}/reminder")]
    public async Task<ActionResult> BulkReminder(int id, [FromBody] ClubDuesReminderDto dto)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        await _service.BulkSendReminderEmailAsync(id, dto.Remark);
        return Ok(new { message = "Reminders sent." });
    }

    [HttpPost("{id}/clubs/{clubId}/reminder")]
    public async Task<ActionResult> ClubReminder(int id, int clubId, [FromBody] ClubDuesReminderDto dto)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        await _service.SendReminderEmailAsync(id, clubId, dto.Remark);
        return Ok(new { message = "Reminder sent." });
    }

    // Send a TEST reminder/receipt email (sample values, current template) — FREE, no wallet credit.
    // Multipart so an unsaved email-header logo can be sent + embedded inline for a true pre-save preview.
    // SuperAdmin or the district's own admin.
    [HttpPost("test-email")]
    public async Task<ActionResult> SendTestEmail([FromForm] ClubDuesTestEmailDto dto, IFormFile? emailLogo)
    {
        if (!IsSuperAdmin() && !(dto.DistrictId > 0 && await IsDistrictAdminOfDistrictAsync(GetUserId(), dto.DistrictId)))
            return Denied();
        try
        {
            await _service.SendTestEmailAsync(dto, emailLogo, GetUserId());
            return Ok(new { message = $"Test email sent to {dto.Email}." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Export + pay link ──────────────────────────────────────────
    [HttpGet("{id}/export")]
    public async Task<ActionResult> Export(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        var bytes = await _service.ExportClubsCsvAsync(id);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"DistrictDues_{id}.xlsx");
    }

    [HttpGet("{id}/clubs/{clubId}/pay-link")]
    public ActionResult GetPayLink(int id, int clubId)
    {
        if (!IsSuperAdmin()) return Denied();
        var frontendUrl = _config["FrontendUrl"] ?? "";
        return Ok(_service.GeneratePayLink(id, clubId, frontendUrl));
    }

    // ── Google Sheets ────────────────────────────────────────────
    [HttpPost("{id}/create-google-sheet")]
    public async Task<ActionResult> CreateGoogleSheet(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        try
        {
            var sheetId = await _service.CreateGoogleSheetAsync(id);
            return Ok(new { googleSheetId = sheetId, message = "Google Sheet created successfully." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException) { return StatusCode(500, new { message = $"Failed to create Google Sheet: {ex.Message}" }); }
    }

    [HttpDelete("{id}/delete-google-sheet")]
    public async Task<ActionResult> DeleteGoogleSheet(int id)
    {
        if (!IsSuperAdmin()) return Denied();
        try
        {
            await _service.DeleteGoogleSheetAsync(id);
            return Ok(new { message = "Google Sheet deleted from Drive." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException) { return StatusCode(500, new { message = $"Failed to delete Google Sheet: {ex.Message}" }); }
    }

    // Maintenance action: renames every District Dues sheet still titled "ClubDues_..." to
    // "DistrictDues_...", and rewrites headers+rows on every campaign that has a sheet so the
    // offline-column-shape fix applies retroactively. Not surfaced in the UI — call once.
    [HttpPost("resync-all-google-sheets")]
    public async Task<ActionResult> ResyncAllGoogleSheets()
    {
        if (!IsSuperAdmin()) return Denied();
        try
        {
            var count = await _service.ResyncAllGoogleSheetsAsync();
            return Ok(new { message = $"Resynced {count} Google Sheet(s)." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException) { return StatusCode(500, new { message = $"Failed to resync Google Sheets: {ex.Message}" }); }
    }

    // ══════════════════════════════════════════════════════════════
    //  Officer surface (Club President / Secretary / Treasurer)
    //  Authenticated web endpoints — same BOD gate as the mobile app.
    //  The club-admin dashboard's Club Dues page calls these.
    // ══════════════════════════════════════════════════════════════

    // Campaigns the signed-in officer may pay for (one row per club they lead).
    [HttpGet("officer/my-clubs")]
    public async Task<ActionResult> OfficerMyClubs()
    {
        var memberId = GetUserId();
        if (memberId <= 0) return OfficerDenied();
        await using var conn = new MySqlConnection(_connStr);
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT cd.pk_club_dues_id AS duesId, cd.Purpose AS purpose, cd.RotaryYear AS rotaryYear,
                   c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber
            FROM board_of_directors bod
            JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            JOIN club_master c ON c.pk_club_id = bod.fk_club_id
            JOIN club_dues cd ON cd.fk_district_id = c.fk_district_id AND cd.IsActive = 1 AND cd.isdeleted = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE bod.fk_member_master_profile_id = @MemberId
              AND COALESCE(bod.isdeleted,0) = 0 AND y.IsCurrent = 1
              AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer')",
            new { MemberId = memberId });
        return Ok(rows);
    }

    // Live snapshot for one of the officer's clubs (amount owed = unpaid x rate).
    [HttpGet("officer/{duesId}")]
    public async Task<ActionResult> OfficerGet(int duesId, [FromQuery] int clubId)
    {
        if (!await CanPayForClubAsync(GetUserId(), clubId, duesId)) return OfficerDenied();
        var dto = await _service.GetPublicDuesAsync(duesId, clubId);
        if (dto == null) return NotFound(new { message = "District dues not found." });
        return Ok(dto);
    }

    // Start an online (Razorpay) payment for the officer's club.
    [HttpPost("officer/{duesId}/pay")]
    public async Task<ActionResult> OfficerPay(int duesId, [FromQuery] int clubId)
    {
        var memberId = GetUserId();
        if (!await CanPayForClubAsync(memberId, clubId, duesId)) return OfficerDenied();
        try
        {
            var result = await _service.CreatePaymentOrderAsync(duesId, new PublicClubDuesPaymentSubmitDto { FkClubId = clubId, PaidByMemberId = memberId });
            return Ok(result);
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Verify the Razorpay checkout callback (marks paid + covers members, idempotent).
    [HttpPost("officer/{duesId}/verify")]
    public async Task<ActionResult> OfficerVerify(int duesId, [FromQuery] int clubId, [FromBody] ClubDuesVerifyDto dto)
    {
        if (!await CanPayForClubAsync(GetUserId(), clubId, duesId)) return OfficerDenied();
        return Ok(await _service.VerifyPaymentAsync(duesId, dto));
    }

    // Generate the shareable pay link the officer can forward to someone else.
    // Non-expiring and stable — the same club always gets the same URL.
    [HttpGet("officer/{duesId}/pay-link")]
    public async Task<ActionResult> OfficerPayLink(int duesId, [FromQuery] int clubId)
    {
        if (!await CanPayForClubAsync(GetUserId(), clubId, duesId)) return OfficerDenied();
        return Ok(_service.GeneratePayLink(duesId, clubId, _config["FrontendUrl"] ?? ""));
    }

    // Officer records an OFFLINE payment → Pending, routed to the district approver.
    [HttpPost("officer/{duesId}/offline-payment")]
    public async Task<ActionResult> OfficerOffline(int duesId, [FromQuery] int clubId, [FromForm] RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment)
    {
        var memberId = GetUserId();
        if (!await CanPayForClubAsync(memberId, clubId, duesId)) return OfficerDenied();
        dto.FkClubId = clubId;
        dto.PaidByMemberId = memberId;
        try
        {
            var paymentId = await _service.RecordPublicOfflinePaymentAsync(duesId, dto, attachment, _env);
            return Ok(new { paymentId, message = "Submitted for approval." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ══════════════════════════════════════════════════════════════
    //  District-admin content surface — branding + email copy ONLY
    //  A District Admin may view + edit their own district's campaign
    //  content, but never amounts, dates, approver, splits or clubs.
    // ══════════════════════════════════════════════════════════════

    // The active campaign(s) for a district. The dashboard passes its selected districtId,
    // which lets it work for a SuperAdmin borrowing a district via global search (they hold no
    // district-admin role). Access: SuperAdmin for any district, else the district's own admin.
    [HttpGet("my-district")]
    public async Task<ActionResult> MyDistrict([FromQuery] int? districtId)
    {
        var memberId = GetUserId();
        if (memberId <= 0) return Denied();
        await using var conn = new MySqlConnection(_connStr);

        if (districtId.HasValue && districtId.Value > 0 &&
            (IsSuperAdmin() || await IsDistrictAdminOfDistrictAsync(memberId, districtId.Value)))
        {
            var byDistrict = await conn.QueryAsync<ClubDuesListDto>(@"
                SELECT cd.pk_club_dues_id AS Id, d.DistrictNumber, cd.RotaryYear, cd.Purpose,
                       cd.DefaultPerMemberRate, cd.IsActive, cd.created_date AS CreatedDate
                FROM club_dues cd
                LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
                WHERE cd.isdeleted = 0 AND cd.fk_district_id = @DistrictId
                ORDER BY cd.created_date DESC", new { DistrictId = districtId.Value });
            return Ok(byDistrict);
        }

        // Fallback: campaigns for the signed-in member's own district-admin role(s).
        var rows = await conn.QueryAsync<ClubDuesListDto>(@"
            SELECT cd.pk_club_dues_id AS Id, d.DistrictNumber, cd.RotaryYear, cd.Purpose,
                   cd.DefaultPerMemberRate, cd.IsActive, cd.created_date AS CreatedDate
            FROM club_dues cd
            JOIN member_roles mr ON mr.fk_district_id = cd.fk_district_id
            LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
            WHERE cd.isdeleted = 0
              AND mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
              AND mr.IsActive = 1 AND mr.isdeleted = 0
            ORDER BY cd.created_date DESC",
            new { MemberId = memberId });
        return Ok(rows);
    }

    // District Admin (member_roles fk_role_id=2, no club) of a specific district.
    private async Task<bool> IsDistrictAdminOfDistrictAsync(int memberId, int districtId)
    {
        if (memberId <= 0 || districtId <= 0) return false;
        await using var conn = new MySqlConnection(_connStr);
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = 2
              AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId, DistrictId = districtId });
        return count > 0;
    }

    // Campaign detail for the edit form — SuperAdmin or the district's own admin.
    [HttpGet("{id}/content")]
    public async Task<ActionResult> GetContent(int id)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        var result = await _service.GetDetailAsync(id);
        if (result == null) return NotFound(new { message = "District dues not found." });
        return Ok(result);
    }

    // Content-only update (logos + email copy). SuperAdmin or the district's own admin.
    [HttpPatch("{id}/content")]
    public async Task<ActionResult> UpdateContent(int id, [FromForm] UpdateClubDuesContentDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!IsSuperAdmin() && !await IsDistrictAdminForDuesAsync(GetUserId(), id)) return Denied();
        await _service.UpdateContentAsync(id, dto, logo, bgImage, emailLogo, GetUserId(), _env);
        return Ok(new { message = "Content updated." });
    }
}

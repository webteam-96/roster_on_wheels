using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Controllers;

// Mobile Settings screen — per-member privacy + per-module notification toggles.
// SELF-SERVICE: the member edits THEIR OWN settings (memberId resolved from JWT).
// Storage is global on member_master_profile (the 8 columns added in
// DatabaseInitializer's idempotent ALTER block). No per-club rows.
//
// Read-side gating (applying these flags in find-rotarian / club-finder /
// club-website directory) is Phase 2 — these endpoints persist the toggles
// today; downstream readers will honor them in a follow-up commit.
[ApiController]
[Route("api/mobile")]
[Authorize]
public class MobileMemberSettingsController : ControllerBase
{
    private readonly string _connectionString;

    public MobileMemberSettingsController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private int GetMemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // ── GET /api/mobile/member-settings ───────────────────────────────────
    // Returns the current 8 flags for the JWT-authed member. New members
    // default to all-true (matches the column defaults), so this never 404s.
    [HttpGet("member-settings")]
    public async Task<ActionResult<MobileMemberSettingsDto>> Get()
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Unauthorized();

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<MobileMemberSettingsDto>(@"
            SELECT
                CAST(ShowPhoneInMyClub    AS UNSIGNED) AS ShowPhoneInMyClub,
                CAST(ShowPhoneInAllClubs  AS UNSIGNED) AS ShowPhoneInAllClubs,
                CAST(ShowEmailInMyClub    AS UNSIGNED) AS ShowEmailInMyClub,
                CAST(ShowEmailInAllClubs  AS UNSIGNED) AS ShowEmailInAllClubs,
                CAST(NotifyUpcomingEvents AS UNSIGNED) AS NotifyUpcomingEvents,
                CAST(NotifyAnnouncements  AS UNSIGNED) AS NotifyAnnouncements,
                CAST(NotifyNewsletters    AS UNSIGNED) AS NotifyNewsletters,
                CAST(NotifyDocuments      AS UNSIGNED) AS NotifyDocuments
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = memberId });

        if (row == null) return NotFound(new { message = "Member profile not found." });
        return Ok(row);
    }

    // ── PUT /api/mobile/member-settings/privacy ───────────────────────────
    // Updates the 4 visibility flags. Returns the fresh settings state.
    [HttpPut("member-settings/privacy")]
    public async Task<ActionResult<MobileMemberSettingsDto>> UpdatePrivacy([FromBody] UpdateMobileMemberPrivacyDto dto)
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Unauthorized();
        if (dto == null) return BadRequest(new { message = "Body required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rows = await conn.ExecuteAsync(@"
            UPDATE member_master_profile SET
                ShowPhoneInMyClub   = @ShowPhoneInMyClub,
                ShowPhoneInAllClubs = @ShowPhoneInAllClubs,
                ShowEmailInMyClub   = @ShowEmailInMyClub,
                ShowEmailInAllClubs = @ShowEmailInAllClubs,
                modified_by = @MemberId,
                modified_date = NOW()
            WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new
            {
                MemberId = memberId,
                ShowPhoneInMyClub   = dto.ShowPhoneInMyClub   ? 1 : 0,
                ShowPhoneInAllClubs = dto.ShowPhoneInAllClubs ? 1 : 0,
                ShowEmailInMyClub   = dto.ShowEmailInMyClub   ? 1 : 0,
                ShowEmailInAllClubs = dto.ShowEmailInAllClubs ? 1 : 0,
            });

        if (rows == 0) return NotFound(new { message = "Member profile not found." });
        return await Get();
    }

    // ── PUT /api/mobile/member-settings/notifications ─────────────────────
    // Updates the 4 module notification toggles. Returns the fresh settings state.
    [HttpPut("member-settings/notifications")]
    public async Task<ActionResult<MobileMemberSettingsDto>> UpdateNotifications([FromBody] UpdateMobileMemberNotificationsDto dto)
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Unauthorized();
        if (dto == null) return BadRequest(new { message = "Body required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rows = await conn.ExecuteAsync(@"
            UPDATE member_master_profile SET
                NotifyUpcomingEvents = @NotifyUpcomingEvents,
                NotifyAnnouncements  = @NotifyAnnouncements,
                NotifyNewsletters    = @NotifyNewsletters,
                NotifyDocuments      = @NotifyDocuments,
                modified_by = @MemberId,
                modified_date = NOW()
            WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new
            {
                MemberId = memberId,
                NotifyUpcomingEvents = dto.NotifyUpcomingEvents ? 1 : 0,
                NotifyAnnouncements  = dto.NotifyAnnouncements  ? 1 : 0,
                NotifyNewsletters    = dto.NotifyNewsletters    ? 1 : 0,
                NotifyDocuments      = dto.NotifyDocuments      ? 1 : 0,
            });

        if (rows == 0) return NotFound(new { message = "Member profile not found." });
        return await Get();
    }
}

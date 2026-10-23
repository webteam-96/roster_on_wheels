using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Public "interested in joining" form (club and district websites) and the guest RSVP page behind a member's invite
/// link (feature contacts_growth, N3). Anonymous. Spam protection: per-IP rate limit ("public-form"), a honeypot
/// field, a minimum fill time and a daily cap per club. Consent is required and its date is stored.
/// Routed under api/public/join so the club websites may call it from the browser (PublicCorsControllerConvention).
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/join")]
public class PublicJoinController : ControllerBase
{
    private const int DailyCapPerClub = 50;
    private const int MinFillMs = 3000;
    private const string Thanks = "Thank you. The club will be in touch soon.";

    private readonly IPotentialMemberService _prospects;
    private readonly ContactService _contacts;
    private readonly InvitePromptService _invites;
    private readonly string _connectionString;

    public PublicJoinController(IPotentialMemberService prospects, ContactService contacts, InvitePromptService invites, IConfiguration configuration)
    {
        _prospects = prospects;
        _contacts = contacts;
        _invites = invites;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    /// <summary>Bots fill the hidden field or post at once; they get the normal answer and nothing is stored.</summary>
    private static bool LooksAutomated(string? honeypot, int elapsedMs) => !string.IsNullOrEmpty(honeypot) || elapsedMs < MinFillMs;

    private async Task<bool> OverDailyCapAsync(MySqlConnection conn, int clubId) => await conn.ExecuteScalarAsync<int>(@"
        SELECT (SELECT COUNT(*) FROM potential_members WHERE fk_club_id = @C AND source <> 'manual' AND created_date >= CURDATE())
             + (SELECT COUNT(*) FROM contacts WHERE fk_club_id = @C AND source = 'invite' AND created_date >= CURDATE())",
        new { C = clubId }) >= DailyCapPerClub;

    [HttpGet("club/{clubId:int}")]
    public async Task<ActionResult> Club(int clubId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var name = await conn.ExecuteScalarAsync<string?>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @C AND isdeleted = 0 AND IsActive = 1", new { C = clubId });
        return name == null ? NotFound(new { message = "Club not found." }) : Ok(new { clubId, clubName = name });
    }

    [HttpGet("district/{districtId:int}")]
    public async Task<ActionResult> District(int districtId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var number = await conn.ExecuteScalarAsync<string?>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D AND isdeleted = 0 AND IsActive = 1", new { D = districtId });
        if (number == null) return NotFound(new { message = "District not found." });
        var clubs = await conn.QueryAsync(
            "SELECT pk_club_id AS id, ClubName AS name FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1 ORDER BY ClubName",
            new { D = districtId });
        return Ok(new { districtId, districtNumber = number, clubs });
    }

    [HttpPost]
    [EnableRateLimiting("join-form")]
    public async Task<ActionResult> Join([FromBody] PublicJoinRequest req)
    {
        if (LooksAutomated(req.Website, req.ElapsedMs)) return Ok(new { message = Thanks });
        if (!req.Consent) return BadRequest(new { message = "Please agree to the club keeping your details." });
        string name; string? email, phone, message;
        try
        {
            (name, email, phone, message) = (ContactRules.Name(req.Name), ContactRules.Email(req.Email), ContactRules.Phone(req.Phone, 20),
                ContactRules.Clean(req.Message, 1000, "Message"));
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        if (email == null) return BadRequest(new { message = "Please give your email so the club can reply." });

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        // shortcut: the district website's form files the prospect under the club the visitor picks, because
        // potential_members.fk_club_id is NOT NULL; add a district inbox (nullable club) if districts want unassigned enquiries.
        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM club_master WHERE pk_club_id = @C AND isdeleted = 0 AND IsActive = 1 AND (@D IS NULL OR fk_district_id = @D)",
                new { C = req.ClubId, D = req.DistrictId }) == 0)
            return BadRequest(new { message = "Please pick a club." });
        if (await OverDailyCapAsync(conn, req.ClubId)) return StatusCode(429, new { message = "Too many enquiries today. Please try again tomorrow." });

        await _prospects.CreateFromPublicAsync(req.ClubId, name, email, phone,
            message == null ? "Website enquiry" : $"Website enquiry: {message}",
            req.DistrictId == null ? "website" : "district_site", "inquiry", null);
        return Ok(new { message = Thanks });
    }

    [HttpGet("~/api/public/invite/{token}")]
    public async Task<ActionResult<PublicInviteDto>> Invite(string token)
        => await _invites.ResolveAsync(token) is { } r ? Ok(r.Dto) : NotFound(new { message = "This invitation is not available." });

    [HttpPost("~/api/public/invite/{token}/rsvp")]
    [EnableRateLimiting("join-form")]
    public async Task<ActionResult> Rsvp(string token, [FromBody] PublicRsvpRequest req)
    {
        if (LooksAutomated(req.Website, req.ElapsedMs)) return Ok(new { message = Thanks });
        if (await _invites.ResolveAsync(token) is not { } invite) return NotFound(new { message = "This invitation is not available." });
        if (!req.Consent) return BadRequest(new { message = "Please agree to the club keeping your details." });
        string name; string? email, phone;
        try { (name, email, phone) = (ContactRules.Name(req.Name), ContactRules.Email(req.Email), ContactRules.Phone(req.Phone, 20)); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        if (email == null && phone == null) return BadRequest(new { message = "Please give an email or a phone number." });

        await using (var conn = new MySqlConnection(_connectionString))
        {
            await conn.OpenAsync();
            if (await OverDailyCapAsync(conn, invite.ClubId)) return StatusCode(429, new { message = "Too many replies today. Please try again tomorrow." });
        }

        var note = $"Guest of {invite.Dto.InviterName}"
                 + (invite.Dto.MeetingDate is { } d ? $", meeting on {d:d MMM yyyy}" : "")
                 + (req.Attending ? ": coming" : ": not coming");
        if (req.InterestedInJoining)
        {
            await _prospects.CreateFromPublicAsync(invite.ClubId, name, email, phone, note, "invite", "invited", invite.MemberId);
            return Ok(new { message = Thanks, kind = "prospect" });
        }
        try
        {
            await _contacts.CreateAsync(new ContactOwner(invite.ClubId, 0),
                new SaveContactDto { Name = name, Email = email, Mobile = phone, ContactType = "guest", Notes = note }, invite.MemberId, "invite");
        }
        catch (Exception ex) when (ex is InvalidOperationException or MySqlException { ErrorCode: MySqlErrorCode.DuplicateKeyEntry })
        { /* already a contact of the club: nothing to add */ }
        return Ok(new { message = Thanks, kind = "contact" });
    }
}

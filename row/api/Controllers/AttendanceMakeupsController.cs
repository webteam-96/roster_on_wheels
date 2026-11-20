using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Makeups, leave of absence, exemptions and attendance percentage (gap #5, 2026-11-19). Under api/clubs/{clubId}
/// ScopeWriteGuardMiddleware lets only the club's managers write and only its members read; members see their own
/// rows only. A member records their own makeup through api/attendance/my-makeups.
/// </summary>
[ApiController]
[Authorize]
public class AttendanceMakeupsController : ControllerBase
{
    private readonly AttendanceStandingService _service;
    private readonly AdminYearGuard _guard;
    private readonly IAuditLogService _audit;
    private readonly string _connectionString;

    public AttendanceMakeupsController(AttendanceStandingService service, AdminYearGuard guard, IAuditLogService audit, IConfiguration configuration)
    {
        _service = service;
        _guard = guard;
        _audit = audit;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    public sealed record MakeupInput(int MemberId, DateOnly MakeupDate, string? MakeupType, string? Note, int? MissedAttendanceId);
    public sealed record MyMakeupInput(int ClubId, DateOnly MakeupDate, string? MakeupType, string? Note, int? MissedAttendanceId);
    public sealed record LeaveInput(int MemberId, DateOnly FromDate, DateOnly ToDate, string? Reason);
    public sealed record ExemptionInput(int MemberId, string? Reason, DateOnly? EndDate);
    public sealed record SettingsInput(int MakeupWindowDays);
    public sealed record ReviewInput(bool Approve, string? Note);
    public sealed record MemberTypeRuleInput(string? MemberType, string? Rule);

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private Task<bool> ManagesAsync(int clubId) => ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, Me, true, clubId);
    /// <summary>Reads: club reachable, and the caller is its member, a manager of it or its district, or a SuperAdmin
    /// (the same rule ScopeWriteGuardMiddleware applies, kept here too so no read depends on the middleware alone).</summary>
    private async Task<ActionResult?> ReadDeniedAsync(int clubId)
    {
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return Inactive();
        return await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, Me, true, clubId)
            ? null : StatusCode(403, new { message = "You do not have access to this club." });
    }

    private ObjectResult Inactive() => StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });

    private async Task<(AttendanceStandingService.Period? Period, int? Only, ActionResult? Error)> ReadScopeAsync(int clubId, int yearId, int? month)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return (null, null, denied);
        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var p = await AttendanceStandingService.PeriodAsync(conn, yearId, month);
        if (p == null) return (null, null, BadRequest(new { message = "yearId is required." }));
        return (p, await ManagesAsync(clubId) ? null : Me, null);
    }

    [HttpGet("api/clubs/{clubId}/attendance/standing")]
    public async Task<ActionResult> Standing(int clubId, [FromQuery] int yearId, [FromQuery] int? month)
    {
        var (p, only, error) = await ReadScopeAsync(clubId, yearId, month);
        if (error != null) return error;
        var s = await _service.GetStandingAsync(clubId, yearId, month);
        if (s == null) return BadRequest(new { message = "yearId is required." });
        return Ok(only == null ? s : s with { Members = s.Members.Where(m => m.MemberId == only).ToList() });
    }

    [HttpGet("api/clubs/{clubId}/attendance/makeups")]
    public async Task<ActionResult> Makeups(int clubId, [FromQuery] int yearId, [FromQuery] int? month, [FromQuery] string? status)
    {
        var (p, only, error) = await ReadScopeAsync(clubId, yearId, month);
        if (error != null) return error;
        if (status != null && status is not (AttendanceStandingService.Pending or AttendanceStandingService.Approved or AttendanceStandingService.Rejected))
            return BadRequest(new { message = "status must be pending, approved or rejected." });
        return Ok(await _service.ListMakeupsAsync(clubId, p!, only, status));
    }

    /// <summary>Meetings the member missed in the period (a member sees their own; a manager names memberId).</summary>
    [HttpGet("api/clubs/{clubId}/attendance/missed")]
    public async Task<ActionResult> Missed(int clubId, [FromQuery] int yearId, [FromQuery] int? memberId)
    {
        var (p, only, error) = await ReadScopeAsync(clubId, yearId, null);
        if (error != null) return error;
        var who = only ?? memberId ?? Me;
        return Ok(await _service.MissedMeetingsAsync(clubId, who, p!));
    }

    /// <summary>An officer approves or rejects a makeup a member logged in the app.</summary>
    [HttpPost("api/clubs/{clubId}/attendance/makeups/{id}/review")]
    public async Task<ActionResult> ReviewMakeup(int clubId, int id, [FromBody] ReviewInput dto)
    {
        var date = await _service.MakeupDateAsync(clubId, id);
        if (date == null) return NotFound(new { message = "Makeup not found." });
        var denied = await _guard.ClubYearForDateAsync(User, clubId, date.Value.ToDateTime(TimeOnly.MinValue));
        if (denied != null) return denied;
        try
        {
            return await _service.ReviewMakeupAsync(clubId, id, dto.Approve, dto.Note, Me)
                ? Ok(new { message = dto.Approve ? "Makeup approved." : "Makeup rejected." })
                : Conflict(new { message = "This makeup has already been reviewed." });
        }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("api/clubs/{clubId}/attendance/makeups")]
    public async Task<ActionResult> AddMakeup(int clubId, [FromBody] MakeupInput dto)
    {
        var denied = await _guard.ClubYearForDateAsync(User, clubId, dto.MakeupDate.ToDateTime(TimeOnly.MinValue));
        if (denied != null) return denied;
        try { return Ok(new { id = await _service.AddMakeupAsync(clubId, dto.MemberId, dto.MakeupDate, dto.MakeupType, dto.Note, dto.MissedAttendanceId, Me) }); }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>A member records their own makeup (app). Only for a club they are an active member of.</summary>
    [HttpPost("api/attendance/my-makeups")]
    public async Task<ActionResult> AddMyMakeup([FromBody] MyMakeupInput dto)
    {
        if (Me <= 0 || !await _service.IsClubMemberAsync(dto.ClubId, Me))
            return StatusCode(403, new { message = "You are not an active member of this club." });
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, dto.ClubId)) return Inactive();
        try { return Ok(new { id = await _service.AddMakeupAsync(dto.ClubId, Me, dto.MakeupDate, dto.MakeupType, dto.Note, dto.MissedAttendanceId, Me, selfLogged: true), status = AttendanceStandingService.Pending }); }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>A member withdraws their own makeup while an officer has not reviewed it yet.</summary>
    [HttpDelete("api/attendance/my-makeups/{id}")]
    public async Task<ActionResult> WithdrawMyMakeup(int id)
    {
        try
        {
            return Me > 0 && await _service.WithdrawMyMakeupAsync(Me, id)
                ? Ok(new { message = "Makeup withdrawn." })
                : NotFound(new { message = "No pending makeup of yours with that id." });
        }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
    }

    // ── meetings: close and reopen, sign-in sheet ──

    [HttpGet("api/clubs/{clubId}/attendance/meetings")]
    public async Task<ActionResult> Meetings(int clubId, [FromQuery] int yearId)
    {
        var (p, _, error) = await ReadScopeAsync(clubId, yearId, null);
        return error ?? Ok(await _service.ListMeetingsAsync(clubId, p!));
    }

    /// <summary>Closes a meeting: its attendance and the makeups that could cover it are locked until reopened. Audited.</summary>
    [HttpPost("api/clubs/{clubId}/attendance/{id:int}/close")]
    public Task<ActionResult> Close(int clubId, int id) => SetClosed(clubId, id, true);

    [HttpPost("api/clubs/{clubId}/attendance/{id:int}/reopen")]
    public Task<ActionResult> Reopen(int clubId, int id) => SetClosed(clubId, id, false);

    private async Task<ActionResult> SetClosed(int clubId, int id, bool close)
    {
        var meeting = await _service.MeetingAsync(clubId, id);
        if (meeting == null) return NotFound(new { message = "Meeting not found." });
        var denied = await _guard.ClubYearAsync(User, clubId, meeting.Value.YearId);
        if (denied != null) return denied;
        if (!await _service.SetClosedAsync(clubId, id, close, Me))
            return Conflict(new { message = close ? "This meeting is already closed." : "This meeting is not closed." });
        await _audit.LogAsync(Me, close ? "Close" : "Reopen", "club_attendance", id, meeting.Value.Name,
            new { clubId, meetingDate = meeting.Value.At.ToString("yyyy-MM-dd") }, HttpContext);
        return Ok(new { message = close ? "Meeting closed." : "Meeting reopened.", closed = close });
    }

    /// <summary>Printable sign-in sheet (PDF): every member on the roll that day, with a signature column. Officers only.</summary>
    [HttpGet("api/clubs/{clubId}/attendance/{id:int}/sign-in-sheet")]
    public async Task<ActionResult> SignInSheet(int clubId, int id)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        if (!await ManagesAsync(clubId)) return StatusCode(403, new { message = "Only the club's officers can print the sign-in sheet." });
        var meeting = await _service.MeetingAsync(clubId, id);
        if (meeting == null) return NotFound(new { message = "Meeting not found." });
        var (club, names) = await _service.SignInNamesAsync(clubId, meeting.Value.At);
        var pdf = AttendancePrintBuilder.SignInSheet(club, meeting.Value.Name, meeting.Value.At, names);
        return File(pdf, "application/pdf", $"sign-in-sheet-{meeting.Value.At:yyyy-MM-dd}.pdf");
    }

    // ── rule of 85 report ──

    /// <summary>Members who qualify for the rule of 85: json (screen), csv or pdf. Officers only (it shows ages).</summary>
    [HttpGet("api/clubs/{clubId}/attendance/rule85")]
    public async Task<ActionResult> Rule85(int clubId, [FromQuery] string? format)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        if (!await ManagesAsync(clubId)) return StatusCode(403, new { message = "Only the club's officers can see this report." });
        var f = (format ?? "json").ToLowerInvariant();
        if (f is not ("json" or "csv" or "pdf")) return BadRequest(new { message = "format must be json, csv or pdf." });
        var (club, rows) = await _service.Rule85ReportAsync(clubId);
        return f switch
        {
            "csv" => File(System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(AttendancePrintBuilder.Rule85Csv(rows))).ToArray(),
                "text/csv", "rule-of-85.csv"),
            "pdf" => File(AttendancePrintBuilder.Rule85Pdf(club, rows, DateOnly.FromDateTime(DateTime.UtcNow)), "application/pdf", "rule-of-85.pdf"),
            _ => Ok(rows),
        };
    }

    // ── member-type rules ──

    [HttpGet("api/clubs/{clubId}/attendance/member-type-rules")]
    public async Task<ActionResult> MemberTypeRules(int clubId)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        return Ok(await _service.GetMemberTypeRulesAsync(clubId));
    }

    [HttpPut("api/clubs/{clubId}/attendance/member-type-rules")]
    public async Task<ActionResult> SaveMemberTypeRule(int clubId, [FromBody] MemberTypeRuleInput dto)
    {
        try { await _service.SetMemberTypeRuleAsync(clubId, dto.MemberType, dto.Rule, Me); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        return Ok(await _service.GetMemberTypeRulesAsync(clubId));
    }

    [HttpDelete("api/clubs/{clubId}/attendance/makeups/{id}")]
    public async Task<ActionResult> DeleteMakeup(int clubId, int id)
    {
        var date = await _service.MakeupDateAsync(clubId, id);
        if (date == null) return NotFound(new { message = "Makeup not found." });
        var denied = await _guard.ClubYearForDateAsync(User, clubId, date.Value.ToDateTime(TimeOnly.MinValue));
        if (denied != null) return denied;
        try { await _service.EnsureMakeupOpenAsync(clubId, id); }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
        await _service.DeleteAsync("club_attendance_makeups", "pk_makeup_id", clubId, id);
        return Ok(new { message = "Makeup deleted." });
    }

    [HttpGet("api/clubs/{clubId}/attendance/leaves")]
    public async Task<ActionResult> Leaves(int clubId, [FromQuery] int yearId)
    {
        var (p, only, error) = await ReadScopeAsync(clubId, yearId, null);
        return error ?? Ok(await _service.ListLeavesAsync(clubId, p!, only));
    }

    [HttpPost("api/clubs/{clubId}/attendance/leaves")]
    public async Task<ActionResult> AddLeave(int clubId, [FromBody] LeaveInput dto)
    {
        var denied = await _guard.ClubYearForDateAsync(User, clubId, dto.FromDate.ToDateTime(TimeOnly.MinValue));
        if (denied != null) return denied;
        try { return Ok(new { id = await _service.AddLeaveAsync(clubId, dto.MemberId, dto.FromDate, dto.ToDate, dto.Reason, Me) }); }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/clubs/{clubId}/attendance/leaves/{id}")]
    public async Task<ActionResult> DeleteLeave(int clubId, int id)
        => await _service.DeleteAsync("club_member_leaves", "pk_leave_id", clubId, id)
            ? Ok(new { message = "Leave deleted." })
            : NotFound(new { message = "Leave not found." });

    [HttpGet("api/clubs/{clubId}/attendance/exemptions")]
    public async Task<ActionResult> Exemptions(int clubId)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        return Ok(await _service.ListExemptionsAsync(clubId, await ManagesAsync(clubId) ? null : Me));
    }

    [HttpPut("api/clubs/{clubId}/attendance/exemptions")]
    public async Task<ActionResult> SetExemption(int clubId, [FromBody] ExemptionInput dto)
    {
        try { await _service.SetExemptionAsync(clubId, dto.MemberId, dto.Reason, dto.EndDate, Me); }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        return Ok(new { message = "Exemption saved." });
    }

    [HttpDelete("api/clubs/{clubId}/attendance/exemptions/{id}")]
    public async Task<ActionResult> DeleteExemption(int clubId, int id)
        => await _service.DeleteAsync("club_member_attendance_exemptions", "pk_exemption_id", clubId, id)
            ? Ok(new { message = "Exemption removed." })
            : NotFound(new { message = "Exemption not found." });

    [HttpGet("api/clubs/{clubId}/attendance/settings")]
    public async Task<ActionResult> Settings(int clubId)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        return Ok(new { makeupWindowDays = await _service.GetWindowAsync(clubId) });
    }

    [HttpPut("api/clubs/{clubId}/attendance/settings")]
    public async Task<ActionResult> SaveSettings(int clubId, [FromBody] SettingsInput dto)
    {
        try { await _service.SetWindowAsync(clubId, dto.MakeupWindowDays, Me); }
        catch (AttendanceStandingService.ClosedMeetingException ex) { return Conflict(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        return Ok(new { makeupWindowDays = dto.MakeupWindowDays });
    }
}

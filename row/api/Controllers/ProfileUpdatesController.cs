using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Profile update requests and the years-of-service / anniversaries report (competitor gaps #3 and #4,
/// ProfileUpdateService). Club routes sit under api/clubs/{clubId}: ScopeWriteGuardMiddleware lets the club's members
/// read and its managers write; the request screens are for managers only (checked here). The emailed link is public
/// and works by its token alone.
/// </summary>
[ApiController]
public class ProfileUpdatesController : ControllerBase
{
    private readonly ProfileUpdateService _service;
    private readonly string _connectionString;

    public ProfileUpdatesController(ProfileUpdateService service, IConfiguration config)
    {
        _service = service;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
    }

    private int CallerId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int clubId)
        => CallerId() > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, CallerId(), true, clubId);

    private ObjectResult NotManager() => StatusCode(403, new { message = "You do not manage this club." });

    public class SendRequest
    {
        public List<int>? MemberIds { get; set; }
        public bool IncompleteOnly { get; set; }
        public string? Message { get; set; }
    }

    // ── Club managers ──

    [Authorize]
    [HttpGet("api/clubs/{clubId:int}/profile-updates/members")]
    public async Task<IActionResult> Members(int clubId)
    {
        if (!await ManagesAsync(clubId)) return NotManager();
        return Ok(await _service.CandidatesAsync(clubId));
    }

    [Authorize]
    [HttpGet("api/clubs/{clubId:int}/profile-updates/requests")]
    public async Task<IActionResult> Requests(int clubId)
    {
        if (!await ManagesAsync(clubId)) return NotManager();
        return Ok(await _service.RequestsAsync(clubId));
    }

    [Authorize]
    [HttpPost("api/clubs/{clubId:int}/profile-updates/requests")]
    public async Task<IActionResult> Send(int clubId, [FromBody] SendRequest req)
    {
        if (!await ManagesAsync(clubId)) return NotManager();
        var ids = (req.MemberIds ?? new List<int>()).Where(i => i > 0).Distinct().ToList();
        if (!req.IncompleteOnly && ids.Count == 0)
            return BadRequest(new { message = "Choose at least one member, or ask every member with an incomplete profile." });
        if (ids.Count > ProfileUpdateService.MaxMembersPerSend)
            return BadRequest(new { message = $"Ask at most {ProfileUpdateService.MaxMembersPerSend} members at a time." });
        var message = string.IsNullOrWhiteSpace(req.Message) ? null : req.Message.Trim();
        if (message?.Length > ProfileUpdateService.MessageMax)
            return BadRequest(new { message = $"The note can be at most {ProfileUpdateService.MessageMax} characters." });
        var r = await _service.SendAsync(clubId, CallerId(), ids, req.IncompleteOnly, message);
        return Ok(new { requested = r.Requested, emailed = r.Emailed, noEmail = r.NoEmail, skipped = r.Skipped });
    }

    // ── Years of service and anniversaries: every member of the club may read it ──

    /// <summary>The report for a month (default: this month in the club's zone). format=csv downloads it.</summary>
    [Authorize]
    [HttpGet("api/clubs/{clubId:int}/anniversaries")]
    public async Task<IActionResult> Anniversaries(int clubId, [FromQuery] int? year, [FromQuery] int? month, [FromQuery] string? format)
    {
        if (month is < 1 or > 12) return BadRequest(new { message = "Month must be 1 to 12." });
        if (year is < 1900 or > 2200) return BadRequest(new { message = "Year is not valid." });
        // ScopeWriteGuardMiddleware has already refused a caller who is not a member or manager of the club.
        var manages = await ManagesAsync(clubId);
        var (clubName, rows, y, m, today) = await _service.ReportAsync(clubId, year, month, CallerId(), manages);

        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase))
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(ProfileUpdateService.ReportCsv(rows))).ToArray(),
                "text/csv", $"anniversaries-{clubId}-{y}-{m:00}.csv");

        return Ok(new
        {
            clubId,
            clubName,
            year = y,
            month = m,
            today = today.ToString("yyyy-MM-dd"),
            counts = new
            {
                members = rows.Count,
                milestones = rows.Count(r => r.Milestone),
                joiningAnniversaries = rows.Count(r => r.JoinAnniversaryDay != null),
                birthdays = rows.Count(r => r.BirthdayDay != null),
                weddingAnniversaries = rows.Count(r => r.WeddingAnniversaryDay != null),
            },
            members = rows,
        });
    }

    // ── The member's emailed link: no sign-in, the token is the key ──

    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    [HttpGet("api/public/profile-update/{token}")]
    public async Task<IActionResult> GetLink(string token)
    {
        var l = await _service.LinkAsync(token);
        if (l == null) return NotFound(new { message = "This link has expired or is not valid. Please ask your club for a new one." });
        static string? D(DateTime? d) => d is DateTime v && v.Year >= 1900 ? v.ToString("yyyy-MM-dd") : null;
        return Ok(new
        {
            clubName = l.ClubName,
            memberName = l.MemberName,
            email = l.EmailId,
            mobile = l.PrimaryMobileNumber,
            secondaryEmailId = l.SecondaryEmailId,
            secondaryMobileNumber = l.SecondaryMobileNumber,
            birthDate = D(l.BirthDate),
            anniversaryDate = D(l.AnniversaryDate),
            memberIntroduction = l.MemberIntroduction,
            linkedIn = l.LinkedIn,
            website = l.Website,
            classificationProfession = l.ClassificationProfession,
            alreadyUpdated = l.CompletedAt != null,
        });
    }

    [AllowAnonymous]
    [EnableRateLimiting("public-form")]
    [HttpPost("api/public/profile-update/{token}")]
    public async Task<IActionResult> SaveLink(string token, [FromBody] ProfileUpdateService.LinkUpdate body)
    {
        var problem = ProfileUpdateService.Validate(body, DateTime.UtcNow);
        if (problem != null) return BadRequest(new { message = problem });
        if (!await _service.SaveLinkAsync(token, body))
            return NotFound(new { message = "This link has expired or is not valid. Please ask your club for a new one." });
        return Ok(new { message = body.ConfirmOnly ? "Thank you. Your club knows your details are up to date." : "Thank you. Your profile is updated." });
    }
}

using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Engagement (build list #26-#28, flag engagement): highlights of membership milestones and new Paul Harris Fellows
/// for a club or district (read by its members: the bulletin, greetings and the app pull them), the spotlight card
/// queue (pending, approved, rejected) with the card image for the admins of the event's club or district, and the
/// district settings (milestone years, Governor message). EngagementService records the events.
/// </summary>
[ApiController]
[Authorize]
public class EngagementController : ControllerBase
{
    private static readonly string[] Statuses = { "pending", "approved", "rejected" };
    private const int GovernorMessageMax = 2000;

    private readonly string _connectionString;
    private readonly EngagementService _service;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;

    public EngagementController(IConfiguration config, EngagementService service, IWebHostEnvironment env)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
        _service = service;
        _env = env;
        _config = config;
    }

    public class SettingsRequest
    {
        public List<int>? MilestoneYears { get; set; }
        public string? GovernorMessage { get; set; }
    }

    private sealed class SettingsRow
    {
        public string Years { get; set; } = "";
        public string? Message { get; set; }
    }

    private sealed class Row
    {
        public int Id { get; set; }
        public string Type { get; set; } = "";
        public int Level { get; set; }
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public string? PhotoUrl { get; set; }
        public DateTime OccurredOn { get; set; }
        public DateTime CreatedDate { get; set; }
        public string CardStatus { get; set; } = "";
        public DateTime? CardDecidedDate { get; set; }
    }

    // Erased members drop out, and so does a PHF highlight whose designation was removed.
    private static readonly string SelectRows = $@"
        SELECT e.pk_engagement_event_id AS Id, e.event_type AS Type, e.level AS Level,
               e.fk_member_master_profile_id AS MemberId, m.MemberName, e.fk_club_id AS ClubId, c.ClubName,
               e.fk_district_id AS DistrictId, dm.DistrictNumber, {MobileNotificationFeedService.ProfilePhotoCase} AS PhotoUrl,
               e.occurred_on AS OccurredOn, e.created_date AS CreatedDate, e.card_status AS CardStatus,
               e.card_decided_date AS CardDecidedDate
        FROM engagement_events e
        JOIN member_master_profile m ON m.pk_member_master_profile_id = e.fk_member_master_profile_id AND m.isdeleted = 0
        LEFT JOIN club_master c ON c.pk_club_id = e.fk_club_id
        LEFT JOIN district_master dm ON dm.pk_district_id = e.fk_district_id
        LEFT JOIN member_foundation_designations d ON d.pk_member_designation_id = e.fk_designation_id
        WHERE (e.fk_designation_id IS NULL OR d.isdeleted = 0)";

    private int CallerId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(bool isClub, int scopeId)
        => CallerId() > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, CallerId(), isClub, scopeId);

    /// <summary>Admins of the event's club, or of its district (district Admin, SuperAdmin).</summary>
    private async Task<bool> ManagesEventAsync(Row r)
        => await ManagesAsync(true, r.ClubId) || await ManagesAsync(false, r.DistrictId);

    private static object Shape(Row r, bool withCard) => new
    {
        id = r.Id,
        type = r.Type,
        label = EngagementService.Label(r.Type, r.Level),
        text = EngagementService.Sentence(r.Type, r.Level, r.MemberName, r.ClubName),
        memberId = r.MemberId,
        memberName = r.MemberName,
        clubId = r.ClubId,
        clubName = r.ClubName,
        photoUrl = r.PhotoUrl,
        occurredOn = r.OccurredOn.ToString("yyyy-MM-dd"),
        createdDate = r.CreatedDate,
        cardStatus = withCard ? r.CardStatus : null,
        cardDecidedDate = withCard ? r.CardDecidedDate : null,
    };

    private async Task<Row?> LoadAsync(MySqlConnection conn, int id)
        => await conn.QueryFirstOrDefaultAsync<Row>(SelectRows + " AND e.pk_engagement_event_id = @Id", new { Id = id });

    // ── Highlights: members of the club or district read them (ScopeWriteGuardMiddleware checks the read) ──

    [HttpGet("api/clubs/{clubId:int}/engagement/highlights")]
    public Task<IActionResult> ClubHighlights(int clubId, [FromQuery] int days = 90) => Highlights(true, clubId, days);

    [HttpGet("api/districts/{districtId:int}/engagement/highlights")]
    public Task<IActionResult> DistrictHighlights(int districtId, [FromQuery] int days = 90) => Highlights(false, districtId, days);

    private async Task<IActionResult> Highlights(bool isClub, int scopeId, int days)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var rows = await conn.QueryAsync<Row>(SelectRows + $@"
              AND e.{(isClub ? "fk_club_id" : "fk_district_id")} = @Scope AND e.created_date >= NOW() - INTERVAL @Days DAY
            ORDER BY e.created_date DESC, e.pk_engagement_event_id DESC LIMIT 200",
            new { Scope = scopeId, Days = Math.Clamp(days, 1, 365) });
        return Ok(rows.Select(r => Shape(r, withCard: false)));
    }

    // ── Spotlight cards: the admins of the club or district ──

    [HttpGet("api/clubs/{clubId:int}/engagement/cards")]
    public Task<IActionResult> ClubCards(int clubId, [FromQuery] string? status) => Cards(true, clubId, status);

    [HttpGet("api/districts/{districtId:int}/engagement/cards")]
    public Task<IActionResult> DistrictCards(int districtId, [FromQuery] string? status) => Cards(false, districtId, status);

    private async Task<IActionResult> Cards(bool isClub, int scopeId, string? status)
    {
        // The scope guard lets every member of the club or district read; the queue is for its admins.
        if (!await ManagesAsync(isClub, scopeId))
            return StatusCode(403, new { message = isClub ? "You do not manage this club." : "You do not manage this district." });
        status = string.IsNullOrWhiteSpace(status) ? null : status.Trim().ToLowerInvariant();
        if (status != null && !Statuses.Contains(status))
            return BadRequest(new { message = "Status must be pending, approved or rejected." });

        await using var conn = new MySqlConnection(_connectionString);
        // shortcut: newest 500 only, no paging; page it when a district's queue outgrows that.
        var rows = await conn.QueryAsync<Row>(SelectRows + $@"
              AND e.{(isClub ? "fk_club_id" : "fk_district_id")} = @Scope AND (@Status IS NULL OR e.card_status = @Status)
            ORDER BY e.created_date DESC, e.pk_engagement_event_id DESC LIMIT 500",
            new { Scope = scopeId, Status = status });
        return Ok(rows.Select(r => Shape(r, withCard: true)));
    }

    /// <summary>The 1200x630 card as PNG. Preview any time; download=true only once the card is approved.</summary>
    [HttpGet("api/engagement/spotlight-cards/{id:int}/image")]
    public async Task<IActionResult> CardImage(int id, [FromQuery] bool download = false)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var r = await LoadAsync(conn, id);
        if (r == null) return NotFound(new { message = "Spotlight card not found." });
        if (!await ManagesEventAsync(r)) return StatusCode(403, new { message = "You do not manage this club." });
        if (download && r.CardStatus != "approved")
            return Conflict(new { message = "Approve the card before downloading it." });

        // Language: the tenant default (English texts for now), like the milestone email in EngagementService.
        // shortcut: rendered on every request, no cache; cache it like PublicProjectShareController if previews get heavy.
        var png = ProjectShareCardBuilder.Render(new ProjectShareCardData
        {
            Title = r.MemberName,
            AreaOfFocus = EngagementService.Label(r.Type, r.Level),
            ClubDisplayName = r.ClubName ?? "",
            DistrictNumber = r.DistrictNumber ?? "",
            Summary = r.Type == "PHF"
                ? $"Recognised by The Rotary Foundation as a {EngagementService.Label(r.Type, r.Level)}."
                : $"Celebrating {r.Level} {(r.Level == 1 ? "year" : "years")} of Rotary membership. Thank you for your service.",
            FooterHost = Brand.PortalDomain.Length > 0 ? Brand.PortalDomain : Brand.ProductName,
            PhotoBytes = await CmrMediaLoader.LoadBytesAsync(_env, _config["Media:RedirectBaseUrl"], r.PhotoUrl),
            PanelLabel = "SPOTLIGHT",
        });
        return download ? File(png, "image/png", $"spotlight-{id}.png") : File(png, "image/png");
    }

    [HttpPost("api/engagement/spotlight-cards/{id:int}/approve")]
    public Task<IActionResult> Approve(int id) => Decide(id, "approved");

    [HttpPost("api/engagement/spotlight-cards/{id:int}/reject")]
    public Task<IActionResult> Reject(int id) => Decide(id, "rejected");

    // A decision can be changed later (approve after a reject, or the other way round).
    private async Task<IActionResult> Decide(int id, string status)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var r = await LoadAsync(conn, id);
        if (r == null) return NotFound(new { message = "Spotlight card not found." });
        if (!await ManagesEventAsync(r)) return StatusCode(403, new { message = "You do not manage this club." });
        await conn.ExecuteAsync(@"
            UPDATE engagement_events SET card_status = @Status, card_decided_by = @By, card_decided_date = NOW()
            WHERE pk_engagement_event_id = @Id",
            new { Status = status, By = CallerId(), Id = id });
        return Ok(new { id, cardStatus = status });
    }

    // ── District settings ──

    [HttpGet("api/districts/{districtId:int}/engagement/settings")]
    public async Task<IActionResult> GetSettings(int districtId)
    {
        if (!await ManagesAsync(false, districtId)) return StatusCode(403, new { message = "You do not manage this district." });
        await using var conn = new MySqlConnection(_connectionString);
        var row = await conn.QueryFirstOrDefaultAsync<SettingsRow>(@"
            SELECT milestone_years AS Years, governor_message AS Message FROM engagement_district_settings
            WHERE fk_district_id = @D", new { D = districtId });
        var governor = await EngagementService.CurrentGovernorAsync(conn, districtId);
        return Ok(new
        {
            milestoneYears = row == null ? EngagementService.DefaultMilestones : EngagementService.ParseYears(row.Years) ?? Array.Empty<int>(),
            governorMessage = row?.Message,
            governorName = governor,
        });
    }

    [HttpPut("api/districts/{districtId:int}/engagement/settings")]
    public async Task<IActionResult> SaveSettings(int districtId, [FromBody] SettingsRequest req)
    {
        if (!await ManagesAsync(false, districtId)) return StatusCode(403, new { message = "You do not manage this district." });
        var years = EngagementService.ParseYears(string.Join(",", req.MilestoneYears ?? new List<int>()));
        if (years == null)
            return BadRequest(new { message = "Milestone years must be whole numbers from 1 to 100, at most 10 of them." });
        var message = string.IsNullOrWhiteSpace(req.GovernorMessage) ? null : req.GovernorMessage.Trim();
        if (message?.Length > GovernorMessageMax)
            return BadRequest(new { message = $"The Governor message can be at most {GovernorMessageMax} characters." });

        await using var conn = new MySqlConnection(_connectionString);
        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM district_master WHERE pk_district_id = @D AND isdeleted = 0", new { D = districtId }) == 0)
            return NotFound(new { message = "District not found." });
        await conn.ExecuteAsync(@"
            INSERT INTO engagement_district_settings (fk_district_id, milestone_years, governor_message, modified_by)
            VALUES (@D, @Years, @Message, @By)
            ON DUPLICATE KEY UPDATE milestone_years = VALUES(milestone_years), governor_message = VALUES(governor_message),
                                    modified_by = VALUES(modified_by)",
            new { D = districtId, Years = string.Join(",", years), Message = message, By = CallerId() });
        return Ok(new { milestoneYears = years, governorMessage = message });
    }

    // ── Run the daily pass now (SuperAdmin; also in ScopeWriteGuardMiddleware.RoleOnly) ──

    [HttpPost("api/engagement/run")]
    public async Task<IActionResult> Run([FromQuery] int? districtId)
    {
        if (!(User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin"))
            return StatusCode(403, new { message = "Only SuperAdmin can run the engagement pass." });
        var (milestones, highlights) = await _service.RunAsync(districtId);
        return Ok(new { milestones, highlights });
    }
}

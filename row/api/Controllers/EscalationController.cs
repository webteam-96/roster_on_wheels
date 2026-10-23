using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Escalation ladder (B.1 #32, flag escalation): a district's rules and its alert log, for the district's managers
/// (district Admin, SuperAdmin); ScopeWriteGuardMiddleware already limits writes to them, and the reads are checked
/// here because the guard lets every member of the district read. Also the SuperAdmin "run now" of the daily passes
/// for escalation and target celebration (B.1 #35, flag celebration), the same code the daily job runs.
/// </summary>
[ApiController]
[Authorize]
public class EscalationController : ControllerBase
{
    private const int LogRows = 500;

    private readonly string _cs;
    private readonly EscalationService _escalation;
    private readonly CelebrationService _celebration;

    public EscalationController(IConfiguration config, EscalationService escalation, CelebrationService celebration)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _escalation = escalation;
        _celebration = celebration;
    }

    private int CallerId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private bool IsSuperAdmin() => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");

    private async Task<bool> ManagesAsync(int districtId)
        => CallerId() > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_cs, CallerId(), false, districtId);

    private ObjectResult Forbidden() => StatusCode(403, new { message = "You do not manage this district." });

    private async Task<bool> DistrictExistsAsync(int districtId)
    {
        await using var conn = new MySqlConnection(_cs);
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_master WHERE pk_district_id = @D AND isdeleted = 0", new { D = districtId }) > 0;
    }

    [HttpGet("api/districts/{districtId:int}/escalation/settings")]
    public async Task<IActionResult> GetSettings(int districtId)
    {
        if (!await ManagesAsync(districtId)) return Forbidden();
        if (!await DistrictExistsAsync(districtId)) return NotFound(new { message = "District not found." });
        var on = await FeatureGate.OnAsync(_cs);
        return Ok(Shape(await _escalation.GetRulesAsync(districtId), on));
    }

    [HttpPut("api/districts/{districtId:int}/escalation/settings")]
    public async Task<IActionResult> SaveSettings(int districtId, [FromBody] EscalationService.Rules req)
    {
        if (!await ManagesAsync(districtId)) return Forbidden();
        req.TargetStatus = string.IsNullOrWhiteSpace(req.TargetStatus) ? null : req.TargetStatus.Trim().ToLowerInvariant();
        if (EscalationService.Validate(req) is { } error) return BadRequest(new { message = error });
        if (!await DistrictExistsAsync(districtId)) return NotFound(new { message = "District not found." });
        await _escalation.SaveRulesAsync(districtId, req, CallerId());
        return Ok(Shape(req, await FeatureGate.OnAsync(_cs)));
    }

    // targetRuleActive / meetingRuleActive: the rule also needs its source module switched on.
    private static object Shape(EscalationService.Rules r, HashSet<string> on) => new
    {
        targetStatus = r.TargetStatus,
        meetingShortfall = r.MeetingShortfall,
        agDelayDays = r.AgDelayDays,
        dgDelayDays = r.DgDelayDays,
        targetRuleActive = on.Contains("target_dashboard"),
        meetingRuleActive = on.Contains(MeetingsService.FeatureKey),
    };

    private sealed class AlertRow
    {
        public int Id { get; set; }
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public string Rule { get; set; } = "";
        public string Period { get; set; } = "";
        public int Level { get; set; }
        public int? MemberId { get; set; }
        public string? RecipientName { get; set; }
        public string Reason { get; set; } = "";
        public string EmailStatus { get; set; } = "";
        public DateTime CreatedDate { get; set; }
    }

    /// <summary>The alert log, newest first: who received which level for which club, rule and period, when and why.</summary>
    [HttpGet("api/districts/{districtId:int}/escalation/alerts")]
    public async Task<IActionResult> Alerts(int districtId, [FromQuery] int? clubId, [FromQuery] string? rule)
    {
        if (!await ManagesAsync(districtId)) return Forbidden();
        rule = string.IsNullOrWhiteSpace(rule) ? null : rule.Trim().ToLowerInvariant();
        if (rule != null && !EscalationService.RuleKeys.Contains(rule)) return BadRequest(new { message = "Rule must be target or meetings." });
        await using var conn = new MySqlConnection(_cs);
        // shortcut: newest 500 rows, no paging; page it when a district's log outgrows that.
        var rows = await conn.QueryAsync<AlertRow>($@"
            SELECT a.pk_alert_id AS Id, a.fk_club_id AS ClubId, c.ClubName, a.rule_key AS Rule, a.period AS Period, a.level AS Level,
                   a.fk_member_id AS MemberId, a.recipient_name AS RecipientName, a.reason AS Reason, a.email_status AS EmailStatus,
                   a.created_date AS CreatedDate
            FROM escalation_alerts a
            LEFT JOIN club_master c ON c.pk_club_id = a.fk_club_id
            WHERE a.fk_district_id = @D AND (@Club IS NULL OR a.fk_club_id = @Club) AND (@Rule IS NULL OR a.rule_key = @Rule)
            ORDER BY a.created_date DESC, a.pk_alert_id DESC LIMIT {LogRows}",
            new { D = districtId, Club = clubId, Rule = rule });
        return Ok(rows.Select(r => new
        {
            id = r.Id, clubId = r.ClubId, clubName = r.ClubName, rule = r.Rule, period = r.Period, level = r.Level,
            role = EscalationService.RoleName(r.Level), memberId = r.MemberId, recipientName = r.RecipientName,
            reason = r.Reason, emailStatus = r.EmailStatus, createdDate = r.CreatedDate,
        }));
    }

    // ── Run the daily passes now (SuperAdmin; also in ScopeWriteGuardMiddleware.RoleOnly) ──

    [HttpPost("api/escalation/run")]
    public async Task<IActionResult> RunEscalation([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can run the escalation pass." });
        return Ok(new { alerts = await _escalation.RunAsync(districtId) });
    }

    [HttpPost("api/celebration/run")]
    public async Task<IActionResult> RunCelebration([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can run the celebration pass." });
        return Ok(new { celebrations = await _celebration.RunAsync(districtId) });
    }
}

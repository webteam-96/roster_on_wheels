using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Platform module switches (Services/FeatureGate.cs). Any signed-in user reads them (the admin hides pages and
/// links with the result); only a SuperAdmin turns a flagged module on or off. Skipped modules cannot be turned on.
/// </summary>
[ApiController]
[Route("api/features")]
[Authorize]
public class FeaturesController : ControllerBase
{
    private readonly IAuditLogService _auditLog;
    private readonly string _connectionString;

    public FeaturesController(IAuditLogService auditLog, IConfiguration configuration)
    {
        _auditLog = auditLog;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    public record FeatureDto(string Key, string Label, string Kind, bool Enabled, string[] AdminPaths);
    public record SetFeatureDto(bool Enabled);

    private bool IsSuperAdmin() => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");
    private int GetCurrentMemberId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet]
    public async Task<ActionResult<IEnumerable<FeatureDto>>> GetAll()
    {
        var on = await FeatureGate.OnAsync(_connectionString);
        return Ok(FeatureGate.All.Select(f => new FeatureDto(f.Key, f.Label, f.Kind.ToString().ToLowerInvariant(),
            f.Kind == FeatureGate.Kind.Flagged && on.Contains(f.Key), f.Admin)));
    }

    [HttpPut("{key}")]
    public async Task<ActionResult> Set(string key, [FromBody] SetFeatureDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can change features." });
        var f = FeatureGate.All.FirstOrDefault(x => x.Key == key);
        if (f == null) return NotFound(new { message = "Unknown feature." });
        if (f.Kind != FeatureGate.Kind.Flagged) return BadRequest(new { message = "This module is skipped for ROW and cannot be turned on." });

        await using (var conn = new MySqlConnection(_connectionString))
            await conn.ExecuteAsync(@"INSERT INTO platform_features (feature_key, enabled, modified_by) VALUES (@Key, @On, @By)
                ON DUPLICATE KEY UPDATE enabled = @On, modified_by = @By",
                new { Key = key, On = dto.Enabled, By = GetCurrentMemberId() });
        FeatureGate.Invalidate();
        await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "platform_feature", 0, key, new { dto.Enabled }, HttpContext);
        return NoContent();
    }
}

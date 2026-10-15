using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/mobile/fcm")]
[Authorize]
public class MobileFcmController : ControllerBase
{
    private readonly string _connectionString;
    private readonly ILogger<MobileFcmController> _logger;

    public MobileFcmController(IConfiguration config, ILogger<MobileFcmController> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private int GetMemberId()
    {
        var raw = User.FindFirst("memberId")?.Value
                  ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(raw, out var x) ? x : 0;
    }

    public class FcmRegisterRequest
    {
        public string FcmToken { get; set; } = "";
        public string? DeviceType { get; set; }   // Android / iOS
        public string? DeviceId { get; set; }     // optional unique device id
    }

    [HttpPost("register")]
    public async Task<ActionResult> Register([FromBody] FcmRegisterRequest req)
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Unauthorized();
        // Reject null / blank / '0' / pure-whitespace tokens so they never enter the table
        var token = req.FcmToken?.Trim() ?? "";
        if (string.IsNullOrEmpty(token) || token == "0")
            return BadRequest(new { message = "fcmToken is required and must not be empty or '0'." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // If the same token already exists, update its owner + last_used and re-activate
        var existing = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_id FROM member_fcm_tokens WHERE FcmToken = @T LIMIT 1",
            new { T = token });

        if (existing != null)
        {
            await conn.ExecuteAsync(@"
                UPDATE member_fcm_tokens
                SET fk_member_master_profile_id = @Mid,
                    DeviceType = @Dt,
                    DeviceId = @Did,
                    IsActive = 1,
                    isdeleted = 0,
                    last_used_date = NOW()
                WHERE pk_id = @Id",
                new { Id = existing, Mid = memberId, Dt = req.DeviceType, Did = req.DeviceId });
        }
        else
        {
            await conn.ExecuteAsync(@"
                INSERT INTO member_fcm_tokens
                    (fk_member_master_profile_id, FcmToken, DeviceType, DeviceId, IsActive, isdeleted, created_date, last_used_date)
                VALUES (@Mid, @Tok, @Dt, @Did, 1, 0, NOW(), NOW())",
                new { Mid = memberId, Tok = token, Dt = req.DeviceType, Did = req.DeviceId });
        }

        // Optional: if DeviceId is provided, soft-deactivate any other tokens for the same device that aren't this token
        // (covers app reinstall yielding new token on same physical device).
        if (!string.IsNullOrWhiteSpace(req.DeviceId))
        {
            await conn.ExecuteAsync(@"
                UPDATE member_fcm_tokens
                SET IsActive = 0, last_used_date = NOW()
                WHERE DeviceId = @Did AND FcmToken <> @Tok AND IsActive = 1",
                new { Did = req.DeviceId, Tok = token });
        }

        return Ok(new { success = true });
    }

    public class FcmUnregisterRequest
    {
        public string FcmToken { get; set; } = "";
    }

    [HttpPost("unregister")]
    public async Task<ActionResult> Unregister([FromBody] FcmUnregisterRequest req)
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Unauthorized();
        if (string.IsNullOrWhiteSpace(req.FcmToken))
            return BadRequest(new { message = "fcmToken is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        await conn.ExecuteAsync(@"
            UPDATE member_fcm_tokens
            SET IsActive = 0, last_used_date = NOW()
            WHERE FcmToken = @T AND fk_member_master_profile_id = @Mid",
            new { T = req.FcmToken, Mid = memberId });

        return Ok(new { success = true });
    }
}

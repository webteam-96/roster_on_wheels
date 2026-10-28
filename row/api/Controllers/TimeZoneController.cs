using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// The IANA zone a club's or district's events are in (build spec 3.3): screens show event times in it, with the
/// viewer's own time alongside. A club uses its district's zone. Zone names are not sensitive, so any signed-in user
/// may ask.
/// </summary>
[ApiController]
[Route("api/time-zone")]
[Authorize]
public class TimeZoneController : ControllerBase
{
    private readonly string _connectionString;

    public TimeZoneController(IConfiguration configuration) =>
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;

    [HttpGet]
    public async Task<ActionResult> Get([FromQuery] int? clubId, [FromQuery] int? districtId)
    {
        if ((clubId is > 0) == (districtId is > 0)) return BadRequest(new { message = "Pass either clubId or districtId." });
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var zone = clubId is > 0 ? await ZoneTime.OfClubAsync(conn, clubId.Value) : await ZoneTime.OfDistrictAsync(conn, districtId!.Value);
        return Ok(new { timeZone = ZoneTime.IanaId(zone) });
    }
}

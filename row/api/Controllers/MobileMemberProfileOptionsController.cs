using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// Mobile member profile dropdowns (upstream 2026-11-06): T-shirt sizes (members use XS to XXXL only, from
// Settings > Event Masters > T-Shirt) and blood groups (same list as the web form). The profile itself is
// read / saved with GET / PUT api/members/{id} (fields bloodGroup, tshirtSizeId, tshirtSize).
[ApiController]
[Route("api/mobile/member-profile-options")]
[Authorize]
public class MobileMemberProfileOptionsController : ControllerBase
{
    private static readonly string[] MemberSizes = { "XS", "S", "M", "L", "XL", "XXL", "XXXL" };
    private static readonly string[] BloodGroups = { "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-" };
    private readonly string _cs;

    public MobileMemberProfileOptionsController(IConfiguration config)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    [HttpGet]
    public async Task<ActionResult> Get()
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var sizes = await c.QueryAsync<(int Id, string SizeName)>(@"
            SELECT pk_id, SizeName FROM event_tshirt_sizes
            WHERE COALESCE(IsActive,1) = 1 AND UPPER(TRIM(SizeName)) IN @S ORDER BY SortOrder, pk_id", new { S = MemberSizes });
        return Ok(new
        {
            tshirtSizes = sizes.Select(s => new { id = s.Id, sizeName = s.SizeName }),
            bloodGroups = BloodGroups,
        });
    }
}

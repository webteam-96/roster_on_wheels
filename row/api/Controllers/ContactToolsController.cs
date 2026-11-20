using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Contacts export (Excel or CSV), duplicate finder and merge (gap agent, 2026-11-19), feature contacts_growth (the
/// FeatureGate path rule for <c>/contacts</c> covers these routes). Only the club's or district's managers: reads are
/// checked here, writes by ScopeWriteGuardMiddleware, as in <see cref="ContactsController"/>.
/// </summary>
[ApiController]
[Authorize]
[Route("api/{scope:regex(^clubs$|^districts$)}/{ownerId:int}/contacts")]
public class ContactToolsController : ControllerBase
{
    private readonly ContactToolsService _service;
    private readonly string _connectionString;

    public ContactToolsController(ContactToolsService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static ContactOwner Owner(string scope, int ownerId) => scope == "clubs" ? new(ownerId, 0) : new(0, ownerId);

    private async Task<bool> MayManageAsync(string scope, int ownerId)
        => UserId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, UserId, scope == "clubs", ownerId);

    private ActionResult Denied() => StatusCode(403, new { message = "Only the people who manage this club or district can see its contacts." });

    [HttpGet("export")]
    public async Task<ActionResult> Export(string scope, int ownerId, [FromQuery] string format = "xlsx", [FromQuery] string? search = null,
        [FromQuery] string? type = null, [FromQuery] int? groupId = null)
    {
        if (!await MayManageAsync(scope, ownerId)) return Denied();
        try
        {
            var (bytes, contentType, fileName) = await _service.ExportAsync(Owner(scope, ownerId), format, search, type, groupId, UserId);
            return File(bytes, contentType, fileName);
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("duplicates")]
    public async Task<ActionResult> Duplicates(string scope, int ownerId)
        => await MayManageAsync(scope, ownerId) ? Ok(await _service.FindDuplicatesAsync(Owner(scope, ownerId))) : Denied();

    [HttpPost("merge")]
    public async Task<ActionResult> Merge(string scope, int ownerId, [FromBody] MergeContactsRequest req)
    {
        // The write guard already ran; checked again so the rule does not depend on middleware order.
        if (!await MayManageAsync(scope, ownerId)) return Denied();
        try { return Ok(await _service.MergeAsync(Owner(scope, ownerId), req, UserId)); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpGet("{id:int}/merge-history")]
    public async Task<ActionResult> History(string scope, int ownerId, int id)
        => await MayManageAsync(scope, ownerId) ? Ok(await _service.HistoryAsync(Owner(scope, ownerId), id)) : Denied();
}

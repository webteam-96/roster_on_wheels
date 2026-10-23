using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Contacts and contact groups of a club (<c>api/clubs/{id}/...</c>) or a district (<c>api/districts/{id}/...</c>),
/// feature contacts_growth. ScopeWriteGuardMiddleware lets only the club's or district's managers write; reads are
/// limited here to the same managers, because contacts are non-members' personal data (the guard alone would let
/// every member read them).
/// </summary>
[ApiController]
[Authorize]
[Route("api/{scope:regex(^clubs$|^districts$)}/{ownerId:int}")]
public class ContactsController : ControllerBase
{
    private readonly ContactService _service;
    private readonly string _connectionString;

    public ContactsController(ContactService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static ContactOwner Owner(string scope, int ownerId) => scope == "clubs" ? new(ownerId, 0) : new(0, ownerId);

    private async Task<ActionResult?> DenyReadAsync(string scope, int ownerId)
        => UserId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, UserId, scope == "clubs", ownerId)
            ? null
            : StatusCode(403, new { message = "Only the people who manage this club or district can see its contacts." });

    private static bool Expected(Exception ex) => ex is ArgumentException or InvalidOperationException or KeyNotFoundException
        or MySqlException { ErrorCode: MySqlErrorCode.DuplicateKeyEntry };

    private static ActionResult Fail(Exception ex) => ex switch
    {
        ArgumentException => new BadRequestObjectResult(new { message = ex.Message }),
        KeyNotFoundException => new NotFoundObjectResult(new { message = ex.Message }),
        // uk_contacts_owner_email: a second save of the same email that raced past the service's own check
        MySqlException => new ConflictObjectResult(new { message = "A contact with this email already exists." }),
        _ => new ConflictObjectResult(new { message = ex.Message }),
    };

    [HttpGet("contacts")]
    public async Task<ActionResult> List(string scope, int ownerId, [FromQuery] string? search, [FromQuery] string? type,
        [FromQuery] int? groupId, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        if (await DenyReadAsync(scope, ownerId) is { } deny) return deny;
        return Ok(await _service.ListAsync(Owner(scope, ownerId), search, type, groupId, page, pageSize));
    }

    [HttpPost("contacts")]
    public async Task<ActionResult> Create(string scope, int ownerId, [FromBody] SaveContactDto dto)
    {
        try { return Ok(new { id = await _service.CreateAsync(Owner(scope, ownerId), dto, UserId) }); }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    [HttpPut("contacts/{id:int}")]
    public async Task<ActionResult> Update(string scope, int ownerId, int id, [FromBody] SaveContactDto dto)
    {
        try
        {
            return await _service.UpdateAsync(Owner(scope, ownerId), id, dto, UserId)
                ? Ok(new { message = "Contact updated." })
                : NotFound(new { message = "Contact not found." });
        }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    [HttpDelete("contacts/{id:int}")]
    public async Task<ActionResult> Delete(string scope, int ownerId, int id)
        => await _service.DeleteAsync(Owner(scope, ownerId), id)
            ? Ok(new { message = "Contact deleted." })
            : NotFound(new { message = "Contact not found." });

    [HttpPost("contacts/import/preview")]
    public async Task<ActionResult> PreviewImport(string scope, int ownerId, [FromBody] ContactImportRequest req)
    {
        try { return Ok(await _service.PreviewImportAsync(Owner(scope, ownerId), req.Rows)); }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    [HttpPost("contacts/import")]
    public async Task<ActionResult> Import(string scope, int ownerId, [FromBody] ContactImportRequest req)
    {
        try { return Ok(await _service.ImportAsync(Owner(scope, ownerId), req, UserId)); }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    /// <summary>Mass email draft inviting contact groups to one of the owner's upcoming events.</summary>
    [HttpPost("contacts/invite-event")]
    public async Task<ActionResult> InviteToEvent(string scope, int ownerId, [FromBody] InviteEventRequest req)
    {
        try { return Ok(new { massEmailId = await _service.InviteToEventAsync(Owner(scope, ownerId), req, UserId) }); }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    [HttpGet("contact-groups")]
    public async Task<ActionResult> ListGroups(string scope, int ownerId)
    {
        if (await DenyReadAsync(scope, ownerId) is { } deny) return deny;
        return Ok(await _service.ListGroupsAsync(Owner(scope, ownerId)));
    }

    [HttpPost("contact-groups")]
    public async Task<ActionResult> CreateGroup(string scope, int ownerId, [FromBody] SaveContactGroupDto dto)
    {
        try { return Ok(new { id = await _service.CreateGroupAsync(Owner(scope, ownerId), dto.Name, UserId) }); }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    [HttpPut("contact-groups/{id:int}")]
    public async Task<ActionResult> RenameGroup(string scope, int ownerId, int id, [FromBody] SaveContactGroupDto dto)
    {
        try
        {
            return await _service.RenameGroupAsync(Owner(scope, ownerId), id, dto.Name)
                ? Ok(new { message = "Group renamed." })
                : NotFound(new { message = "Group not found." });
        }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    [HttpDelete("contact-groups/{id:int}")]
    public async Task<ActionResult> DeleteGroup(string scope, int ownerId, int id)
        => await _service.DeleteGroupAsync(Owner(scope, ownerId), id)
            ? Ok(new { message = "Group deleted." })
            : NotFound(new { message = "Group not found." });
}

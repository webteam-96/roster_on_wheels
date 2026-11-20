using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Member flexibility for a club (gap agent, 2026-11-19): tags on members and contacts, custom profile fields,
/// smart lists. ScopeWriteGuardMiddleware lets only the club's managers write under api/clubs/{clubId}. Reads of
/// tags and smart lists are limited here to the same managers; profile fields and a member's values are readable by
/// active members of the club, who see the members-visible fields only.
/// </summary>
[ApiController]
[Authorize]
[Route("api/clubs/{clubId:int}")]
public class MemberFlexController : ControllerBase
{
    private readonly MemberFlexService _service;
    private readonly string _connectionString;

    public MemberFlexController(MemberFlexService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int clubId) => UserId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, UserId, true, clubId);

    private ObjectResult NotManager() => StatusCode(403, new { message = "Only the people who manage this club can see this." });

    private static bool Expected(Exception ex) => ex is ArgumentException or InvalidOperationException
        or MySqlException { ErrorCode: MySqlErrorCode.DuplicateKeyEntry };

    private static ActionResult Fail(Exception ex) => ex switch
    {
        ArgumentException => new BadRequestObjectResult(new { message = ex.Message }),
        MySqlException => new ConflictObjectResult(new { message = "That name is already used." }),
        _ => new ConflictObjectResult(new { message = ex.Message }),
    };

    private async Task<ActionResult> Run(Func<Task<ActionResult>> work)
    {
        try { return await work(); }
        catch (Exception ex) when (Expected(ex)) { return Fail(ex); }
    }

    // ── Tags (managers) ────────────────────────────────────────────────────────────────

    [HttpGet("tags")]
    public async Task<ActionResult> ListTags(int clubId)
        => await ManagesAsync(clubId) ? Ok(await _service.ListTagsAsync(clubId)) : NotManager();

    [HttpPost("tags")]
    public Task<ActionResult> CreateTag(int clubId, [FromBody] SaveClubTagDto dto)
        => Run(async () => Ok(new { id = await _service.CreateTagAsync(clubId, dto, UserId) }));

    [HttpPut("tags/{id:int}")]
    public Task<ActionResult> UpdateTag(int clubId, int id, [FromBody] SaveClubTagDto dto)
        => Run(async () => await _service.UpdateTagAsync(clubId, id, dto) ? Ok(new { message = "Tag saved." }) : NotFound(new { message = "Tag not found." }));

    [HttpDelete("tags/{id:int}")]
    public async Task<ActionResult> DeleteTag(int clubId, int id)
        => await _service.DeleteTagAsync(clubId, id) ? Ok(new { message = "Tag deleted." }) : NotFound(new { message = "Tag not found." });

    [HttpPut("members/{memberId:int}/tags")]
    public Task<ActionResult> SetMemberTags(int clubId, int memberId, [FromBody] SetTagsDto dto)
        => Run(async () => await _service.SetTagsAsync(clubId, "member", memberId, dto.TagIds, UserId)
            ? Ok(new { message = "Tags saved." }) : NotFound(new { message = "Member not found in this club." }));

    [HttpPut("contacts/{contactId:int}/tags")]
    public Task<ActionResult> SetContactTags(int clubId, int contactId, [FromBody] SetTagsDto dto)
        => Run(async () => await _service.SetTagsAsync(clubId, "contact", contactId, dto.TagIds, UserId)
            ? Ok(new { message = "Tags saved." }) : NotFound(new { message = "Contact not found in this club." }));

    // ── Profile fields ─────────────────────────────────────────────────────────────────

    /// <summary>Managers get every field; active members of the club get the members-visible ones.</summary>
    [HttpGet("profile-fields")]
    public async Task<ActionResult> ListFields(int clubId)
    {
        if (await ManagesAsync(clubId)) return Ok(await _service.ListFieldsAsync(clubId, false));
        return await _service.IsActiveMemberAsync(clubId, UserId) ? Ok(await _service.ListFieldsAsync(clubId, true)) : NotManager();
    }

    [HttpPost("profile-fields")]
    public Task<ActionResult> CreateField(int clubId, [FromBody] SaveProfileFieldDto dto)
        => Run(async () => Ok(new { id = await _service.CreateFieldAsync(clubId, dto, UserId) }));

    [HttpPut("profile-fields/{id:int}")]
    public Task<ActionResult> UpdateField(int clubId, int id, [FromBody] SaveProfileFieldDto dto)
        => Run(async () => await _service.UpdateFieldAsync(clubId, id, dto) ? Ok(new { message = "Field saved." }) : NotFound(new { message = "Field not found." }));

    [HttpDelete("profile-fields/{id:int}")]
    public async Task<ActionResult> DeleteField(int clubId, int id)
        => await _service.DeleteFieldAsync(clubId, id) ? Ok(new { message = "Field deleted." }) : NotFound(new { message = "Field not found." });

    /// <summary>A club member's profile field values. Managers see all fields; a fellow active member sees the
    /// members-visible fields only.</summary>
    [HttpGet("members/{memberId:int}/profile-fields")]
    public async Task<ActionResult> GetValues(int clubId, int memberId)
    {
        var manager = await ManagesAsync(clubId);
        if (!manager && !await _service.IsActiveMemberAsync(clubId, UserId)) return NotManager();
        if (!await _service.IsActiveMemberAsync(clubId, memberId)) return NotFound(new { message = "Member not found in this club." });
        return Ok(await _service.GetValuesAsync(clubId, memberId, !manager));
    }

    [HttpPut("members/{memberId:int}/profile-fields")]
    public Task<ActionResult> SaveValues(int clubId, int memberId, [FromBody] SaveProfileValuesDto dto)
        => Run(async () =>
        {
            if (!await _service.IsActiveMemberAsync(clubId, memberId)) return NotFound(new { message = "Member not found in this club." });
            await _service.SaveValuesAsync(clubId, memberId, dto.Values, UserId);
            return Ok(new { message = "Profile fields saved." });
        });

    // ── Smart lists (managers) ─────────────────────────────────────────────────────────

    [HttpGet("committees")]
    public async Task<ActionResult> Committees(int clubId)
        => await ManagesAsync(clubId) ? Ok(await _service.ListCommitteesAsync(clubId)) : NotManager();

    [HttpGet("smart-lists")]
    public async Task<ActionResult> ListSmartLists(int clubId)
        => await ManagesAsync(clubId) ? Ok(await _service.ListSmartListsAsync(clubId)) : NotManager();

    /// <summary>Members matching a filter, with their tags. POST because the filter is a body; it changes nothing.
    /// The member browser uses it too (filter by tag).</summary>
    [HttpPost("smart-lists/preview")]
    public Task<ActionResult> Preview(int clubId, [FromBody] SmartListPreviewRequest req)
        => Run(async () => Ok(await _service.PreviewAsync(clubId, req.Filter, req.Page, req.PageSize)));

    [HttpGet("smart-lists/{id:int}/members")]
    public async Task<ActionResult> Members(int clubId, int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        if (!await ManagesAsync(clubId)) return NotManager();
        var list = await _service.GetSmartListAsync(clubId, id);
        if (list == null) return NotFound(new { message = "List not found." });
        return await Run(async () => Ok(await _service.PreviewAsync(clubId, list.Filter, page, pageSize)));
    }

    [HttpPost("smart-lists")]
    public Task<ActionResult> CreateSmartList(int clubId, [FromBody] SaveSmartListDto dto)
        => Run(async () => Ok(new { id = await _service.CreateSmartListAsync(clubId, dto, UserId) }));

    [HttpPut("smart-lists/{id:int}")]
    public Task<ActionResult> UpdateSmartList(int clubId, int id, [FromBody] SaveSmartListDto dto)
        => Run(async () => await _service.UpdateSmartListAsync(clubId, id, dto) ? Ok(new { message = "List saved." }) : NotFound(new { message = "List not found." }));

    [HttpDelete("smart-lists/{id:int}")]
    public async Task<ActionResult> DeleteSmartList(int clubId, int id)
        => await _service.DeleteSmartListAsync(clubId, id) ? Ok(new { message = "List deleted." }) : NotFound(new { message = "List not found." });

    [HttpGet("smart-lists/{id:int}/export")]
    public async Task<ActionResult> Export(int clubId, int id)
    {
        if (!await ManagesAsync(clubId)) return NotManager();
        return await Run(async () =>
        {
            var csv = await _service.ExportCsvAsync(clubId, id);
            if (csv == null) return NotFound(new { message = "List not found." });
            return File(Encoding.UTF8.GetBytes("﻿" + csv.Value.Csv), "text/csv", $"smart-list-{id}.csv");
        });
    }

    /// <summary>Mass email draft to the list's members; the admin finishes and sends it from Mass Email.</summary>
    [HttpPost("smart-lists/{id:int}/mass-email")]
    public Task<ActionResult> MassEmail(int clubId, int id, [FromBody] SmartListMassEmailRequest req)
        => Run(async () =>
        {
            var draft = await _service.CreateMassEmailDraftAsync(clubId, id, req, UserId);
            return draft == null ? NotFound(new { message = "List not found." }) : Ok(new { massEmailId = draft });
        });
}

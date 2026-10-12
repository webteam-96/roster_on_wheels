using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class RiDirectorController : ControllerBase
{
    private readonly IRiDirectorService _ri;
    private readonly IWebHostEnvironment _env;

    public RiDirectorController(IRiDirectorService ri, IWebHostEnvironment env)
    {
        _ri = ri;
        _env = env;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // ── Dashboard ──
    [HttpGet("api/ri-director/context")]
    public async Task<ActionResult<RiDirectorContextDto>> GetContext() =>
        Ok(await _ri.GetContextAsync());

    // ── Credits ──
    [HttpGet("api/ri-director/credits/balance")]
    public async Task<ActionResult<RiCreditBalanceDto>> GetCreditBalance() =>
        Ok(await _ri.GetCreditBalanceAsync());

    [HttpGet("api/ri-director/credits")]
    public async Task<ActionResult> GetCredits([FromQuery] string? creditType = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        var (items, totalCount) = await _ri.GetCreditsAsync(creditType, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpPost("api/ri-director/credits")]
    public async Task<ActionResult> AddCredit([FromForm] RiAddCreditDto dto, IFormFile? proofDocument = null)
    {
        var id = await _ri.AddCreditAsync(dto, proofDocument, GetUserId(), _env);
        return Ok(new { id });
    }

    [HttpGet("api/ri-director/credits/history")]
    public async Task<ActionResult> GetCreditHistory([FromQuery] string? creditType = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        var (items, totalCount) = await _ri.GetUsageHistoryAsync(creditType, page, pageSize);
        return Ok(new { items, totalCount });
    }

    // ── Announcements ──
    [HttpGet("api/ri-director/announcements")]
    public async Task<ActionResult> GetAnnouncements([FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        var (items, totalCount) = await _ri.GetAnnouncementsAsync(status, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/ri-director/announcements/{id}")]
    public async Task<ActionResult<AnnouncementDetailDto>> GetAnnouncement(int id)
    {
        var result = await _ri.GetAnnouncementByIdAsync(id);
        if (result == null) return NotFound(new { message = "Announcement not found." });
        return Ok(result);
    }

    [HttpPost("api/ri-director/announcements")]
    public async Task<ActionResult> CreateAnnouncement([FromBody] CreateAnnouncementDto dto)
    {
        var id = await _ri.CreateAnnouncementAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/ri-director/announcements/{id}")]
    public async Task<ActionResult> UpdateAnnouncement(int id, [FromBody] UpdateAnnouncementDto dto)
    {
        await _ri.UpdateAnnouncementAsync(id, dto, GetUserId());
        return Ok(new { message = "Announcement updated successfully." });
    }

    [HttpDelete("api/ri-director/announcements/{id}")]
    public async Task<ActionResult> DeleteAnnouncement(int id)
    {
        await _ri.DeleteAnnouncementAsync(id, GetUserId());
        return Ok(new { message = "Announcement deleted successfully." });
    }

    [HttpPost("api/ri-director/announcements/upload")]
    public async Task<ActionResult<object>> UploadAnnouncementImage(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });
        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });
        var path = await _ri.UploadAnnouncementImageAsync(file);
        return Ok(new { path });
    }

    // ── Recipient count helper ──
    [HttpGet("api/ri-director/recipients/count")]
    public async Task<ActionResult> GetRecipientCount(
        [FromQuery] string channel = "email",
        [FromQuery] string target = "all",
        [FromQuery] int[]? zoneIds = null,
        [FromQuery] int[]? districtIds = null,
        [FromQuery] int[]? subgroupIds = null)
    {
        var count = await _ri.GetRecipientCountAsync(channel, target, zoneIds, districtIds, subgroupIds);
        return Ok(new { count });
    }

    // ══════════════════════════════════════════════════════════════
    // Upcoming Events
    // ══════════════════════════════════════════════════════════════
    [HttpGet("api/ri-director/upcoming-events")]
    public async Task<ActionResult> GetUpcomingEvents([FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        var (items, totalCount) = await _ri.GetUpcomingEventsAsync(status, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/ri-director/upcoming-events/{id}")]
    public async Task<ActionResult<UpcomingEventDetailDto>> GetUpcomingEvent(int id)
    {
        var result = await _ri.GetUpcomingEventByIdAsync(id);
        if (result == null) return NotFound(new { message = "Event not found." });
        return Ok(result);
    }

    [HttpPost("api/ri-director/upcoming-events")]
    public async Task<ActionResult> CreateUpcomingEvent([FromBody] CreateUpcomingEventDto dto)
    {
        try
        {
            var id = await _ri.CreateUpcomingEventAsync(dto, GetUserId());
            return Ok(new { id });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("api/ri-director/upcoming-events/{id}")]
    public async Task<ActionResult> UpdateUpcomingEvent(int id, [FromBody] UpdateUpcomingEventDto dto)
    {
        try
        {
            await _ri.UpdateUpcomingEventAsync(id, dto, GetUserId());
            return Ok(new { message = "Event updated successfully." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/ri-director/upcoming-events/{id}")]
    public async Task<ActionResult> DeleteUpcomingEvent(int id)
    {
        await _ri.DeleteUpcomingEventAsync(id, GetUserId());
        return Ok(new { message = "Event deleted successfully." });
    }

    [HttpPost("api/ri-director/upcoming-events/upload")]
    public async Task<ActionResult<object>> UploadUpcomingEventImage(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded" });
        var allowed = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        if (!allowed.Contains(Path.GetExtension(file.FileName).ToLower()))
            return BadRequest(new { message = "Invalid file type." });
        if (file.Length > 5 * 1024 * 1024) return BadRequest(new { message = "File size must be less than 5MB" });
        var path = await _ri.UploadUpcomingEventImageAsync(file);
        return Ok(new { path });
    }

    // ══════════════════════════════════════════════════════════════
    // Sub Groups
    // ══════════════════════════════════════════════════════════════
    [HttpGet("api/ri-director/sub-groups")]
    public async Task<ActionResult> GetSubGroups([FromQuery] int? yearId = null)
    {
        var items = await _ri.GetSubGroupsAsync(yearId);
        return Ok(items);
    }

    [HttpGet("api/ri-director/sub-groups/years")]
    public async Task<ActionResult> GetSubGroupYears()
    {
        var items = await _ri.GetSubGroupYearsAsync();
        return Ok(items);
    }

    [HttpGet("api/ri-director/sub-groups/{id}")]
    public async Task<ActionResult<RiSubGroupDetailDto>> GetSubGroup(int id)
    {
        var result = await _ri.GetSubGroupByIdAsync(id);
        if (result == null) return NotFound(new { message = "Sub group not found." });
        return Ok(result);
    }

    [HttpPost("api/ri-director/sub-groups")]
    public async Task<ActionResult> CreateSubGroup([FromBody] RiCreateSubGroupDto dto)
    {
        try
        {
            var id = await _ri.CreateSubGroupAsync(dto, GetUserId());
            return Ok(new { id });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("api/ri-director/sub-groups/{id}")]
    public async Task<ActionResult> UpdateSubGroup(int id, [FromBody] RiCreateSubGroupDto dto)
    {
        try
        {
            await _ri.UpdateSubGroupAsync(id, dto, GetUserId());
            return Ok(new { message = "Sub group updated successfully." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/ri-director/sub-groups/{id}")]
    public async Task<ActionResult> DeleteSubGroup(int id)
    {
        await _ri.DeleteSubGroupAsync(id, GetUserId());
        return Ok(new { message = "Sub group deleted successfully." });
    }

    [HttpGet("api/ri-director/sub-groups/available-members")]
    public async Task<ActionResult> GetAvailableMembers([FromQuery] string? search = null)
    {
        var items = await _ri.GetAvailableMembersAsync(search);
        return Ok(items);
    }

    // ══════════════════════════════════════════════════════════════
    // Mass Emails
    // ══════════════════════════════════════════════════════════════
    [HttpGet("api/ri-director/mass-emails")]
    public async Task<ActionResult> GetMassEmails([FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        var (items, totalCount) = await _ri.GetMassEmailsAsync(status, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/ri-director/mass-emails/{id}")]
    public async Task<ActionResult<RiMassEmailDetailDto>> GetMassEmail(int id)
    {
        var result = await _ri.GetMassEmailByIdAsync(id);
        if (result == null) return NotFound(new { message = "Mass email not found." });
        return Ok(result);
    }

    [HttpPost("api/ri-director/mass-emails")]
    public async Task<ActionResult> CreateMassEmail([FromBody] RiCreateMassEmailDto dto)
    {
        try
        {
            var id = await _ri.CreateMassEmailAsync(dto, GetUserId());
            return Ok(new { id });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("api/ri-director/mass-emails/{id}")]
    public async Task<ActionResult> UpdateMassEmail(int id, [FromBody] RiCreateMassEmailDto dto)
    {
        try
        {
            await _ri.UpdateMassEmailAsync(id, dto, GetUserId());
            return Ok(new { message = "Mass email updated." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/ri-director/mass-emails/{id}")]
    public async Task<ActionResult> DeleteMassEmail(int id)
    {
        await _ri.DeleteMassEmailAsync(id, GetUserId());
        return Ok(new { message = "Mass email deleted." });
    }

    [HttpPost("api/ri-director/mass-emails/{id}/send")]
    public async Task<ActionResult> SendMassEmail(int id)
    {
        try
        {
            await _ri.SendMassEmailAsync(id, GetUserId());
            return Ok(new { message = "Mass email is being sent." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ══════════════════════════════════════════════════════════════
    // Web Links
    // ══════════════════════════════════════════════════════════════
    [HttpGet("api/ri-director/weblinks")]
    public async Task<ActionResult> GetWeblinks() => Ok(await _ri.GetWeblinksAsync());

    [HttpGet("api/ri-director/weblinks/{id}")]
    public async Task<ActionResult<RiWeblinkListDto>> GetWeblink(int id)
    {
        var r = await _ri.GetWeblinkByIdAsync(id);
        if (r == null) return NotFound(new { message = "Weblink not found." });
        return Ok(r);
    }

    [HttpPost("api/ri-director/weblinks")]
    public async Task<ActionResult> CreateWeblink([FromBody] RiCreateWeblinkDto dto)
    {
        try { var id = await _ri.CreateWeblinkAsync(dto, GetUserId()); return Ok(new { id }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("api/ri-director/weblinks/{id}")]
    public async Task<ActionResult> UpdateWeblink(int id, [FromBody] RiCreateWeblinkDto dto)
    {
        try { await _ri.UpdateWeblinkAsync(id, dto, GetUserId()); return Ok(new { message = "Updated." }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/ri-director/weblinks/{id}")]
    public async Task<ActionResult> DeleteWeblink(int id)
    {
        await _ri.DeleteWeblinkAsync(id, GetUserId());
        return Ok(new { message = "Deleted." });
    }

    // ══════════════════════════════════════════════════════════════
    // Documents
    // ══════════════════════════════════════════════════════════════
    [HttpGet("api/ri-director/documents")]
    public async Task<ActionResult> GetDocuments([FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        var (items, totalCount) = await _ri.GetDocumentsAsync(status, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/ri-director/documents/{id}")]
    public async Task<ActionResult<DocumentDetailDto>> GetDocument(int id)
    {
        var r = await _ri.GetDocumentByIdAsync(id);
        if (r == null) return NotFound(new { message = "Document not found." });
        return Ok(r);
    }

    [HttpPost("api/ri-director/documents")]
    public async Task<ActionResult> CreateDocument([FromBody] CreateDocumentDto dto)
    {
        var id = await _ri.CreateDocumentAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/ri-director/documents/{id}")]
    public async Task<ActionResult> UpdateDocument(int id, [FromBody] UpdateDocumentDto dto)
    {
        await _ri.UpdateDocumentAsync(id, dto, GetUserId());
        return Ok(new { message = "Updated." });
    }

    [HttpDelete("api/ri-director/documents/{id}")]
    public async Task<ActionResult> DeleteDocument(int id)
    {
        await _ri.DeleteDocumentAsync(id, GetUserId());
        return Ok(new { message = "Deleted." });
    }

    [HttpPost("api/ri-director/documents/upload")]
    public async Task<ActionResult<object>> UploadDocumentFile(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded" });
        if (file.Length > 20 * 1024 * 1024) return BadRequest(new { message = "File must be under 20MB" });
        var (path, originalName) = await _ri.UploadDocumentFileAsync(file);
        return Ok(new { path, originalFileName = originalName });
    }

    // ══════════════════════════════════════════════════════════════
    // Newsletters
    // ══════════════════════════════════════════════════════════════
    [HttpGet("api/ri-director/newsletters")]
    public async Task<ActionResult> GetNewsletters([FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        var (items, totalCount) = await _ri.GetNewslettersAsync(status, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/ri-director/newsletters/{id}")]
    public async Task<ActionResult<NewsletterDetailDto>> GetNewsletter(int id)
    {
        var r = await _ri.GetNewsletterByIdAsync(id);
        if (r == null) return NotFound(new { message = "Newsletter not found." });
        return Ok(r);
    }

    [HttpPost("api/ri-director/newsletters")]
    public async Task<ActionResult> CreateNewsletter([FromBody] RiCreateNewsletterDto dto)
    {
        try { var id = await _ri.CreateNewsletterAsync(dto, GetUserId()); return Ok(new { id }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("api/ri-director/newsletters/{id}")]
    public async Task<ActionResult> UpdateNewsletter(int id, [FromBody] RiCreateNewsletterDto dto)
    {
        try { await _ri.UpdateNewsletterAsync(id, dto, GetUserId()); return Ok(new { message = "Updated." }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/ri-director/newsletters/{id}")]
    public async Task<ActionResult> DeleteNewsletter(int id)
    {
        await _ri.DeleteNewsletterAsync(id, GetUserId());
        return Ok(new { message = "Deleted." });
    }

    [HttpPost("api/ri-director/newsletters/upload")]
    public async Task<ActionResult<object>> UploadNewsletterFile(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded" });
        if (file.Length > 20 * 1024 * 1024) return BadRequest(new { message = "File must be under 20 MB." });
        var path = await _ri.UploadNewsletterFileAsync(file);
        return Ok(new { path });
    }

    // ══════════════════════════════════════════════════════════════
    // Reports (XLSX — colorful Excel)
    // ══════════════════════════════════════════════════════════════
    private const string XlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static FileContentResult XlsxFile(byte[] bytes, string name) =>
        new FileContentResult(bytes, XlsxMime) { FileDownloadName = name };

    [HttpGet("api/ri-director/reports/zones")]
    public async Task<ActionResult> ReportZones() => XlsxFile(await _ri.GetReportZonesXlsxAsync(), $"ri_zones_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx");

    [HttpGet("api/ri-director/reports/districts")]
    public async Task<ActionResult> ReportDistricts() => XlsxFile(await _ri.GetReportDistrictsXlsxAsync(), $"ri_districts_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx");

    [HttpGet("api/ri-director/reports/clubs")]
    public async Task<ActionResult> ReportClubs() => XlsxFile(await _ri.GetReportClubsXlsxAsync(), $"ri_clubs_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx");

    [HttpGet("api/ri-director/reports/members")]
    public async Task<ActionResult> ReportMembers() => XlsxFile(await _ri.GetReportMembersXlsxAsync(), $"ri_members_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx");

    [HttpGet("api/ri-director/reports/communications")]
    public async Task<ActionResult> ReportCommunications() => XlsxFile(await _ri.GetReportCommunicationsXlsxAsync(), $"ri_communications_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx");
}

using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

public class DistrictProjectDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }
    public string? EventDate { get; set; } // unused, for compatibility
    public int? AreaOfFocusId { get; set; }
    public string? OtherAreaOfFocus { get; set; }
    public string? ProjectDate { get; set; }
    public decimal? ProjectCost { get; set; }
    public int? FundingId { get; set; }
    // Funding-conditional fields (Global Grant / CSR) — mirror club Community Service.
    public string? GlobalGrantNumber { get; set; }
    public decimal? AmountSanctioned { get; set; }
    public decimal? AmountReceived { get; set; }
    public decimal? AmountSpent { get; set; }
    public string? HostClubsDistricts { get; set; }
    public string? GlobalPartnerClubsDistricts { get; set; }
    public string? CsrCompanyName { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public int? ManHours { get; set; }
    public int? RotariansInvolved { get; set; }
    public int? RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int? RccInvolved { get; set; }
    public List<DistrictPhotoDto>? Photos { get; set; }
}

public class DistrictEventDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? EventDate { get; set; }
    public string? ProjectDate { get; set; } // unused, for compatibility
    public List<DistrictPhotoDto>? Photos { get; set; }
}

public class DistrictPhotoDto { public string ImagePath { get; set; } = ""; public string? Description { get; set; } public bool IsPrimary { get; set; } public int SortOrder { get; set; } }
public class DistrictBannerDto { public int? YearId { get; set; } public string BannerImagePath { get; set; } = ""; public string? DocumentPath { get; set; } public string? LinkUrl { get; set; } public string? Description { get; set; } public int SortOrder { get; set; } public bool IsActive { get; set; } = true; }
public class DistrictAdvertisementDto { public int? YearId { get; set; } public string AdvertisementImagePath { get; set; } = ""; public string? DocumentPath { get; set; } public string? LinkUrl { get; set; } public string? Description { get; set; } public int SortOrder { get; set; } public bool IsActive { get; set; } = true; }
public class DistrictSocialLinkDto { public string Platform { get; set; } = ""; public string LinkUrl { get; set; } = ""; public int SortOrder { get; set; } public bool IsActive { get; set; } = true; }
public class DistrictMenuDto { public string MenuName { get; set; } = ""; public string LinkType { get; set; } = "page"; public string LinkValue { get; set; } = ""; public int SortOrder { get; set; } public bool IsActive { get; set; } = true; }
public class DistrictSubMenuDto { public string SubMenuName { get; set; } = ""; public string LinkType { get; set; } = "page"; public string LinkValue { get; set; } = ""; public int SortOrder { get; set; } public bool IsActive { get; set; } = true; }
public class DistrictReorderDto { public int Id1 { get; set; } public int Id2 { get; set; } }
public class DistrictAboutDto { public string Content { get; set; } = ""; public bool IsActive { get; set; } = true; }
public class DistrictContactDetailDto { public int YearId { get; set; } public string Email { get; set; } = ""; public string Phone { get; set; } = ""; public int SortOrder { get; set; } public bool IsActive { get; set; } = true; }

// District Committee DTOs
public class DistrictCommitteeMemberDto
{
    public int YearId { get; set; }
    public int? MemberId { get; set; }
    public bool IsMember { get; set; } = true;
    public string Name { get; set; } = "";
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? DistrictDesignation { get; set; }
    public int? ClubId { get; set; }
    public string? ClubName { get; set; }
    public string? DistrictRemark { get; set; }
    public string? ProfilePhoto { get; set; }
}
public class DistrictCommitteeGroupDto
{
    public int YearId { get; set; }
    public string GroupName { get; set; } = "";
}
public class DistrictCommitteeSubGroupDto
{
    public string SubGroupName { get; set; } = "";
}

[ApiController]
[Authorize]
public class DistrictModulesController : ControllerBase
{
    private readonly IUpcomingEventService _eventService;
    private readonly IAnnouncementService _announcementService;
    private readonly INewsletterService _newsletterService;
    private readonly IDocumentService _documentService;
    private readonly IGreetingService _greetingService;
    private readonly IWeblinkService _weblinkService;
    private readonly ISubGroupService _subGroupService;
    private readonly IClubMassEmailService _massEmailService;
    private readonly IEmailService _emailService;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;
    private readonly IRoleService _roleService;
    private readonly IAuditLogService _auditLog;
    private readonly IDcAutoGroupService _dcAutoGroups;
    private readonly IYearTableResolver _yearTables;

    public DistrictModulesController(
        IUpcomingEventService eventService,
        IAnnouncementService announcementService,
        INewsletterService newsletterService,
        IDocumentService documentService,
        IGreetingService greetingService,
        IWeblinkService weblinkService,
        ISubGroupService subGroupService,
        IClubMassEmailService massEmailService,
        IEmailService emailService,
        IWebHostEnvironment env,
        IConfiguration configuration,
        IRoleService roleService,
        IAuditLogService auditLog,
        IDcAutoGroupService dcAutoGroups,
        IYearTableResolver yearTables)
    {
        _eventService = eventService;
        _announcementService = announcementService;
        _newsletterService = newsletterService;
        _documentService = documentService;
        _greetingService = greetingService;
        _weblinkService = weblinkService;
        _subGroupService = subGroupService;
        _massEmailService = massEmailService;
        _emailService = emailService;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _configuration = configuration;
        _roleService = roleService;
        _auditLog = auditLog;
        _dcAutoGroups = dcAutoGroups;
        _yearTables = yearTables;
    }

    /// <summary>Returns 400 BadRequest if the named group is auto-managed (CP/CS) — admins can't mutate these.</summary>
    private async Task<ActionResult?> RejectIfAutoManagedGroupByIdAsync(MySqlConnection conn, int groupId)
    {
        var name = await conn.ExecuteScalarAsync<string?>(
            "SELECT group_name FROM district_committee_group WHERE id = @Id LIMIT 1",
            new { Id = groupId });
        if (_dcAutoGroups.IsAutoManagedGroup(name))
            return BadRequest(new { message = "This group is auto-managed by BOD (Club President / Club Secretary) and cannot be edited directly. Make changes via Board of Directors instead." });
        return null;
    }

    private ActionResult? RejectIfAutoManagedGroupByName(string? name)
    {
        if (_dcAutoGroups.IsAutoManagedGroup(name))
            return BadRequest(new { message = "Group names matching 'Club President' or 'Club Secretary' (any variation) are reserved for auto-managed BOD groups." });
        return null;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // ══════════════════════════════════════════════════════════════════════
    // ── Upcoming Events ──────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/upcoming-events")]
    public async Task<ActionResult> GetDistrictEvents(int districtId, [FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _eventService.GetAllAsync(0, status, search, page, pageSize, districtId);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/districts/{districtId}/upcoming-events/{id}")]
    public async Task<ActionResult<UpcomingEventDetailDto>> GetDistrictEventById(int districtId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _eventService.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Event not found." });
        return Ok(result);
    }

    [HttpPost("api/districts/{districtId}/upcoming-events")]
    public async Task<ActionResult> CreateDistrictEvent(int districtId, [FromBody] CreateUpcomingEventDto dto)
    {
        var id = await _eventService.CreateAsync(0, dto, GetUserId(), districtId);
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/upcoming-events/{id}")]
    [OwnedBy(Owns.DistrictEvent, "id", "districtId")]
    public async Task<ActionResult> UpdateDistrictEvent(int districtId, int id, [FromBody] UpdateUpcomingEventDto dto)
    {
        await _eventService.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Event updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/upcoming-events/{id}")]
    [OwnedBy(Owns.DistrictEvent, "id", "districtId")]
    public async Task<ActionResult> DeleteDistrictEvent(int districtId, int id)
    {
        await _eventService.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Event deleted successfully." });
    }

    [HttpPost("api/districts/{districtId}/upcoming-events/upload")]
    public async Task<ActionResult<object>> UploadDistrictEventImage(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });

        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var path = await _eventService.UploadImageAsync(districtId, file);
        return Ok(new { path });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Announcements ────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/announcements")]
    public async Task<ActionResult> GetDistrictAnnouncements(int districtId, [FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _announcementService.GetAllAsync(0, status, search, page, pageSize, districtId);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/districts/{districtId}/announcements/{id}")]
    public async Task<ActionResult<AnnouncementDetailDto>> GetDistrictAnnouncementById(int districtId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _announcementService.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Announcement not found." });
        return Ok(result);
    }

    [HttpPost("api/districts/{districtId}/announcements")]
    public async Task<ActionResult> CreateDistrictAnnouncement(int districtId, [FromBody] CreateAnnouncementDto dto)
    {
        var id = await _announcementService.CreateAsync(0, dto, GetUserId(), districtId);
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/announcements/{id}")]
    [OwnedBy(Owns.DistrictAnnouncement, "id", "districtId")]
    public async Task<ActionResult> UpdateDistrictAnnouncement(int districtId, int id, [FromBody] UpdateAnnouncementDto dto)
    {
        await _announcementService.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Announcement updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/announcements/{id}")]
    [OwnedBy(Owns.DistrictAnnouncement, "id", "districtId")]
    public async Task<ActionResult> DeleteDistrictAnnouncement(int districtId, int id)
    {
        await _announcementService.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Announcement deleted successfully." });
    }

    [HttpPost("api/districts/{districtId}/announcements/upload")]
    public async Task<ActionResult<object>> UploadDistrictAnnouncementImage(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });

        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var path = await _announcementService.UploadImageAsync(districtId, file);
        return Ok(new { path });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Newsletters ──────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/newsletters")]
    public async Task<ActionResult> GetDistrictNewsletters(int districtId, [FromQuery] int yearId, [FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _newsletterService.GetAllAsync(0, yearId, status, search, page, pageSize, districtId);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/districts/{districtId}/newsletters/{id}")]
    public async Task<ActionResult<NewsletterDetailDto>> GetDistrictNewsletterById(int districtId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _newsletterService.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Newsletter not found." });
        return Ok(result);
    }

    [HttpPost("api/districts/{districtId}/newsletters")]
    public async Task<ActionResult> CreateDistrictNewsletter(int districtId, [FromBody] CreateNewsletterDto dto)
    {
        var id = await _newsletterService.CreateAsync(0, dto, GetUserId(), districtId);
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/newsletters/{id}")]
    [OwnedBy(Owns.DistrictNewsletter, "id", "districtId")]
    public async Task<ActionResult> UpdateDistrictNewsletter(int districtId, int id, [FromBody] UpdateNewsletterDto dto)
    {
        await _newsletterService.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Newsletter updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/newsletters/{id}")]
    [OwnedBy(Owns.DistrictNewsletter, "id", "districtId")]
    public async Task<ActionResult> DeleteDistrictNewsletter(int districtId, int id)
    {
        await _newsletterService.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Newsletter deleted successfully." });
    }

    [HttpPost("api/districts/{districtId}/newsletters/upload")]
    public async Task<ActionResult<object>> UploadDistrictNewsletterFile(int districtId, IFormFile file)
    {
        if (districtId <= 0)
            return BadRequest(new { message = "Invalid district id. Files cannot be uploaded without a district context." });

        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".pdf" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Only PDF files are allowed." });

        if (file.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 20 MB." });

        var path = await _newsletterService.UploadFileAsync(districtId, file);
        return Ok(new { path });
    }

    [HttpGet("api/districts/{districtId}/newsletters/years")]
    public async Task<ActionResult> GetDistrictNewsletterYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _newsletterService.GetYearsAsync(0, districtId);
        return Ok(result);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Documents ────────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/documents")]
    public async Task<ActionResult> GetDistrictDocuments(int districtId, [FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _documentService.GetAllAsync(0, status, search, page, pageSize, districtId);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/districts/{districtId}/documents/{id}")]
    public async Task<ActionResult<DocumentDetailDto>> GetDistrictDocumentById(int districtId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _documentService.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Document not found." });
        return Ok(result);
    }

    [HttpPost("api/districts/{districtId}/documents")]
    public async Task<ActionResult> CreateDistrictDocument(int districtId, [FromBody] CreateDocumentDto dto)
    {
        var id = await _documentService.CreateAsync(0, dto, GetUserId(), districtId);
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/documents/{id}")]
    [OwnedBy(Owns.DistrictDocument, "id", "districtId")]
    public async Task<ActionResult> UpdateDistrictDocument(int districtId, int id, [FromBody] UpdateDocumentDto dto)
    {
        await _documentService.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Document updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/documents/{id}")]
    [OwnedBy(Owns.DistrictDocument, "id", "districtId")]
    public async Task<ActionResult> DeleteDistrictDocument(int districtId, int id)
    {
        await _documentService.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Document deleted successfully." });
    }

    [HttpPost("api/districts/{districtId}/documents/upload")]
    public async Task<ActionResult<object>> UploadDistrictDocumentFile(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        if (file.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 20 MB." });

        var (path, originalName) = await _documentService.UploadFileAsync(districtId, file);
        return Ok(new { path, originalName });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Greetings ────────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/greetings")]
    public async Task<ActionResult> GetDistrictGreetingSettings(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _greetingService.GetDistrictSettingsAsync(districtId);
        if (result == null) return Ok(new { });
        return Ok(result);
    }

    [HttpPut("api/districts/{districtId}/greetings")]
    public async Task<ActionResult> UpdateDistrictGreetingSettings(int districtId, [FromBody] UpdateDistrictGreetingSettingsDto dto)
    {
        await _greetingService.UpdateDistrictSettingsAsync(districtId, dto, GetUserId());
        return Ok(new { message = "District greeting settings updated successfully." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Weblinks ─────────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/weblinks")]
    public async Task<ActionResult> GetDistrictWeblinks(int districtId, [FromQuery] int? parentId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var weblinks = await _weblinkService.GetWeblinksAsync(0, parentId, districtId);
        return Ok(weblinks);
    }

    [HttpGet("api/districts/{districtId}/weblinks/tree")]
    public async Task<ActionResult> GetDistrictWeblinkTree(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var tree = await _weblinkService.GetWeblinkTreeAsync(0, districtId);
        return Ok(tree);
    }

    [HttpPost("api/districts/{districtId}/weblinks")]
    public async Task<ActionResult> CreateDistrictWeblink(int districtId, [FromForm] CreateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf)
    {
        // Validate logo
        if (logo != null)
        {
            if (logo.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Logo file size must be less than 5MB." });

            if (!logo.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Logo must be an image file." });
        }

        // Validate banner
        if (banner != null)
        {
            if (banner.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Banner file size must be less than 5MB." });

            if (!banner.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Banner must be an image file." });
        }

        // Validate PDF
        if (pdf != null)
        {
            if (pdf.Length > 10 * 1024 * 1024)
                return BadRequest(new { message = "PDF file size must be less than 10MB." });

            var pdfExt = Path.GetExtension(pdf.FileName).ToLowerInvariant();
            if (pdfExt != ".pdf")
                return BadRequest(new { message = "Only .pdf files are allowed." });
        }

        try
        {
            var result = await _weblinkService.CreateWeblinkAsync(0, dto, logo, banner, pdf, GetUserId(), _env, districtId);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("api/districts/{districtId}/weblinks/{weblinkId}")]
    public async Task<ActionResult> UpdateDistrictWeblink(int districtId, int weblinkId, [FromForm] UpdateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf)
    {
        // Validate logo
        if (logo != null)
        {
            if (logo.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Logo file size must be less than 5MB." });

            if (!logo.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Logo must be an image file." });
        }

        // Validate banner
        if (banner != null)
        {
            if (banner.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Banner file size must be less than 5MB." });

            if (!banner.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Banner must be an image file." });
        }

        // Validate PDF
        if (pdf != null)
        {
            if (pdf.Length > 10 * 1024 * 1024)
                return BadRequest(new { message = "PDF file size must be less than 10MB." });

            var pdfExt = Path.GetExtension(pdf.FileName).ToLowerInvariant();
            if (pdfExt != ".pdf")
                return BadRequest(new { message = "Only .pdf files are allowed." });
        }

        try
        {
            var result = await _weblinkService.UpdateWeblinkAsync(0, weblinkId, dto, logo, banner, pdf, GetUserId(), _env, districtId);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("api/districts/{districtId}/weblinks/{weblinkId}")]
    [OwnedBy(Owns.DistrictWeblink, "weblinkId", "districtId")]
    public async Task<ActionResult> DeleteDistrictWeblink(int districtId, int weblinkId)
    {
        await _weblinkService.DeleteWeblinkAsync(weblinkId, GetUserId());
        return Ok(new { message = "Weblink deleted successfully." });
    }

    [HttpPut("api/districts/{districtId}/weblinks/{weblinkId}/toggle-active")]
    [OwnedBy(Owns.DistrictWeblink, "weblinkId", "districtId")]
    public async Task<ActionResult> ToggleDistrictWeblinkActive(int districtId, int weblinkId)
    {
        await _weblinkService.ToggleActiveAsync(weblinkId, GetUserId());
        return Ok(new { message = "Weblink status toggled successfully." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Sub Groups ───────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/sub-groups")]
    public async Task<ActionResult> GetDistrictSubGroups(int districtId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var groups = await _subGroupService.GetSubGroupsAsync(0, yearId, districtId);
        return Ok(groups);
    }

    [HttpGet("api/districts/{districtId}/sub-groups/available-years")]
    public async Task<ActionResult> GetDistrictSubGroupAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var years = await _subGroupService.GetAvailableYearsAsync(null, districtId);
        return Ok(years);
    }

    [HttpGet("api/districts/{districtId}/sub-groups/{subGroupId}")]
    public async Task<ActionResult> GetDistrictSubGroupDetail(int districtId, int subGroupId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        try
        {
            var group = await _subGroupService.GetSubGroupDetailAsync(subGroupId);
            return Ok(group);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    // District sub group members must be members of the district's clubs (ids come from the request body; former members stay valid on edit).
    private async Task<bool> SubGroupMembersInDistrictAsync(int districtId, List<int>? memberIds)
    {
        var ids = memberIds?.Distinct().ToList() ?? new List<int>();
        if (ids.Count == 0) return true;
        using var conn = CreateConnection();
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id WHERE c.fk_district_id = @D AND cm.fk_member_master_profile_id IN @Ids",
            new { D = districtId, Ids = ids }) == ids.Count;
    }

    [HttpPost("api/districts/{districtId}/sub-groups")]
    public async Task<ActionResult> CreateDistrictSubGroup(int districtId, [FromBody] CreateSubGroupDto dto)
    {
        if (!await SubGroupMembersInDistrictAsync(districtId, dto.MemberIds)) return BadRequest(new { message = "Every member must belong to a club of this district." });
        var result = await _subGroupService.CreateSubGroupAsync(0, dto, GetUserId(), districtId);
        return Ok(result);
    }

    [HttpPut("api/districts/{districtId}/sub-groups/{subGroupId}")]
    [OwnedBy(Owns.DistrictSubGroup, "subGroupId", "districtId")]
    public async Task<ActionResult> UpdateDistrictSubGroup(int districtId, int subGroupId, [FromBody] UpdateSubGroupDto dto)
    {
        if (!await SubGroupMembersInDistrictAsync(districtId, dto.MemberIds)) return BadRequest(new { message = "Every member must belong to a club of this district." });
        var result = await _subGroupService.UpdateSubGroupAsync(subGroupId, dto, GetUserId());
        return Ok(result);
    }

    [HttpDelete("api/districts/{districtId}/sub-groups/{subGroupId}")]
    [OwnedBy(Owns.DistrictSubGroup, "subGroupId", "districtId")]
    public async Task<ActionResult> DeleteDistrictSubGroup(int districtId, int subGroupId)
    {
        await _subGroupService.DeleteSubGroupAsync(subGroupId, GetUserId());
        return Ok(new { message = "Sub group deleted successfully." });
    }

    [HttpGet("api/districts/{districtId}/sub-groups/district-members")]
    public async Task<ActionResult> GetDistrictMembers(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var members = await _subGroupService.GetDistrictMembersAsync(districtId);
        return Ok(members);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Mass Emails ───────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>Null when the caller manages this district; otherwise 403. Campaigns carry the recipients' addresses,
    /// so plain members may not read them.</summary>
    private async Task<ActionResult?> DenyMassEmailReadAsync(int districtId)
        => GetUserId() > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, GetUserId(), false, districtId)
            ? null
            : StatusCode(403, new { message = "Only the people who manage this district can see its mass emails." });

    [HttpGet("api/districts/{districtId}/mass-emails")]
    public async Task<ActionResult> GetDistrictMassEmails(int districtId,
        [FromQuery] string? status, [FromQuery] string? search,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (await DenyMassEmailReadAsync(districtId) is { } deny) return deny;
        var (items, totalCount) = await _massEmailService.GetListAsync(0, status, search, page, pageSize, districtId);
        return Ok(new { items, totalCount, page, pageSize });
    }

    [HttpGet("api/districts/{districtId}/mass-emails/{id}")]
    public async Task<ActionResult> GetDistrictMassEmailDetail(int districtId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (await DenyMassEmailReadAsync(districtId) is { } deny) return deny;
        if (!await _massEmailService.BelongsToAsync(id, null, districtId)) return NotFound(new { message = "Mass email not found." });
        var detail = await _massEmailService.GetDetailAsync(id);
        if (detail == null) return NotFound(new { message = "Mass email not found." });
        return Ok(detail);
    }

    [HttpPost("api/districts/{districtId}/mass-emails")]
    public async Task<ActionResult> CreateDistrictMassEmail(int districtId, [FromBody] CreateMassEmailDto dto)
    {
        try
        {
            var id = await _massEmailService.CreateAsync(0, dto, GetUserId(), districtId);
            return Ok(new { id, message = "Mass email created successfully." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException) // validation text only; anything else is a generic 500
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("api/districts/{districtId}/mass-emails/{id}")]
    public async Task<ActionResult> UpdateDistrictMassEmail(int districtId, int id, [FromBody] CreateMassEmailDto dto)
    {
        if (!await _massEmailService.BelongsToAsync(id, null, districtId)) return NotFound(new { message = "Mass email not found." });
        try
        {
            await _massEmailService.UpdateAsync(id, dto, GetUserId());
            return Ok(new { message = "Mass email updated successfully." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException) // validation text only; anything else is a generic 500
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("api/districts/{districtId}/mass-emails/{id}")]
    public async Task<ActionResult> DeleteDistrictMassEmail(int districtId, int id)
    {
        if (!await _massEmailService.BelongsToAsync(id, null, districtId)) return NotFound(new { message = "Mass email not found." });
        try
        {
            await _massEmailService.DeleteAsync(id, GetUserId());
            return Ok(new { message = "Mass email deleted successfully." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException) // validation text only; anything else is a generic 500
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("api/districts/{districtId}/mass-emails/{id}/send")]
    public async Task<ActionResult> SendDistrictMassEmail(int districtId, int id)
    {
        if (!await _massEmailService.BelongsToAsync(id, null, districtId)) return NotFound(new { message = "Mass email not found." });
        try
        {
            await _massEmailService.SendAsync(id, GetUserId());
            return Ok(new { message = "Mass email is being sent." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException) // validation text only; anything else is a generic 500
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("api/districts/{districtId}/mass-emails/{id}/recipients")]
    public async Task<ActionResult> GetDistrictMassEmailRecipients(int districtId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (await DenyMassEmailReadAsync(districtId) is { } deny) return deny;
        if (!await _massEmailService.BelongsToAsync(id, null, districtId)) return NotFound(new { message = "Mass email not found." });
        var recipients = await _massEmailService.GetRecipientsAsync(id);
        return Ok(recipients);
    }

    // Sender identity used for the actual Brevo dispatch of mass emails.
    // The compose form calls this so admins see the EXACT address that will
    // appear in recipient inboxes. Single source of truth: the hardcoded
    // constant EmailService.MASS_EMAIL_SENDER_EMAIL — change it there and
    // BOTH the send path and this UI display update together.
    [HttpGet("api/mass-emails/sender-info")]
    [AllowAnonymous]
    public ActionResult GetMassEmailSenderInfo()
    {
        return Ok(new { senderEmail = RotaryApi.Services.EmailService.MASS_EMAIL_SENDER_EMAIL });
    }

    [HttpGet("api/districts/{districtId}/mass-emails/recipient-count")]
    public async Task<ActionResult> GetDistrictRecipientCount(int districtId,
        [FromQuery] int recipientType, [FromQuery] string? subgroupIds,
        [FromQuery] string? clubIds, [FromQuery] string? memberIds, [FromQuery] string? contactGroupIds)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (await DenyMassEmailReadAsync(districtId) is { } deny) return deny;
        List<int>? parsedSubgroupIds = null;
        if (!string.IsNullOrEmpty(subgroupIds))
            parsedSubgroupIds = subgroupIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();

        List<int>? parsedClubIds = null;
        if (!string.IsNullOrEmpty(clubIds))
            parsedClubIds = clubIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();

        List<int>? parsedMemberIds = null;
        if (!string.IsNullOrEmpty(memberIds))
            parsedMemberIds = memberIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();

        var parsedContactGroupIds = contactGroupIds?.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => int.TryParse(s, out var n) ? n : 0).Where(n => n > 0).ToList();

        var count = await _massEmailService.GetRecipientCountAsync(0, recipientType, parsedSubgroupIds, parsedMemberIds, districtId, parsedClubIds, parsedContactGroupIds);
        return Ok(count);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Members Admin Actions ────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpPost("api/districts/{districtId}/members/{memberId}/assign-admin")]
    public async Task<ActionResult> AssignDistrictAdmin(int districtId, int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var assignedBy = GetUserId();

        // Verify member exists
        var memberExists = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = memberId });

        if (memberExists == 0)
            return NotFound(new { message = "Member not found." });

        // Mutual exclusion: District Admin (role 2) cannot coexist with SA
        try { await _roleService.CheckRoleConflictPublicAsync(memberId, 2); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }

        // Wrap DB writes in a transaction so that if ANY write throws, nothing
        // persists — and we DO NOT send a promotion email. User reported the
        // email going out even when no member_roles row appeared; the in-line
        // INSERT/UPDATE/credentials were running on the same connection without
        // an explicit transaction, so a partial failure could leave state
        // inconsistent (e.g. credentials inserted, role insert silently rolled
        // back by the connection close). 2026-06-13.
        using var tx = await connection.BeginTransactionAsync();

        // Per project rule: a district may have N active District Admins (no cap).
        // The one-per-district block was removed so any number of members can hold
        // the role concurrently. Duplicate insertion for the SAME (member, district)
        // is still prevented by the reactivate-or-insert logic below.

        // Reactivate any existing row for this (member, district, role=2) — covers soft-deleted
        // (isdeleted=1) and revoked (IsActive=0) rows. Insert a new row only if no row exists.
        // fk_club_id IS NULL OR = 0 — the DB writes 0 (not NULL) as the "no club" sentinel
        // for District Admin rows. Without handling both, we'd either collide with a Club
        // Admin row (no fk_club_id filter) or never match an existing District Admin row
        // (filtering only by NULL).
        var existingRowId = await connection.ExecuteScalarAsync<int?>(
            "SELECT pk_member_role_id FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId AND (fk_club_id IS NULL OR fk_club_id = 0) LIMIT 1",
            new { MemberId = memberId, DistrictId = districtId }, transaction: tx);
        if (existingRowId.HasValue)
        {
            await connection.ExecuteAsync(@"
                UPDATE member_roles SET IsActive = 1, isdeleted = 0, RevokedDate = NULL, RevokedBy = NULL,
                       created_by = @AssignedBy, modified_by = @AssignedBy, modified_date = NOW()
                WHERE pk_member_role_id = @Id",
                new { Id = existingRowId.Value, AssignedBy = assignedBy }, transaction: tx);
        }
        else
        {
            await connection.ExecuteAsync(@"
                INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, IsActive, created_by)
                VALUES (@MemberId, 2, @DistrictId, 1, @AssignedBy)",
                new { MemberId = memberId, DistrictId = districtId, AssignedBy = assignedBy }, transaction: tx);
        }

        // Get member details
        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = memberId }, transaction: tx);

        // Read isdeleted too — a SOFT-DELETED row (e.g. a disabled CP/CS credential) still occupies the
        // UNIQUE fk_member_master_profile_id, so an INSERT throws "Duplicate entry ... for key
        // member_credentials.fk_member_master_profile_id". Undelete + reset instead of INSERT.
        var credState = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @MemberId",
            new { MemberId = memberId }, transaction: tx);

        string? tempPassword = null;
        if (credState == null)
        {
            tempPassword = GenerateTempPassword();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                VALUES (@MemberId, @Hash, 1, 1, @CreatedBy)",
                new { MemberId = memberId, Hash = passwordHash, CreatedBy = assignedBy }, transaction: tx);
        }
        else if (Convert.ToInt32(credState.isdeleted) == 1)
        {
            // Soft-deleted credentials → undelete + reset with a fresh temp password.
            tempPassword = GenerateTempPassword();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                    modified_by = @ModifiedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId",
                new { MemberId = memberId, Hash = passwordHash, ModifiedBy = assignedBy }, transaction: tx);
        }
        else if (Convert.ToInt32(credState.IsActive) == 0)
        {
            // Reactivate without changing password — member can log in with their existing credentials.
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET IsActive = 1, modified_by = @ModifiedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, ModifiedBy = assignedBy }, transaction: tx);
        }

        // Commit DB writes BEFORE sending email. If the commit fails the email
        // never goes — guarantees that any sent promotion email corresponds to a
        // real persisted member_roles row.
        await tx.CommitAsync();

        // Send email notification
        try
        {
            if (member?.EmailId != null)
            {
                var rolesHtml = await BuildAllRolesHtmlAsync(connection, memberId);
                var loginUrl = _configuration["FrontendUrl"]?.TrimEnd('/') + "/login";
                var subject = "Rotary Club - Your Role Assignment";

                var credentialsHtml = tempPassword != null
                    ? $@"<div style='background-color: #F7F9FC; border: 1px solid #D5DEE8; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                            <p><strong>Login URL:</strong> <a href='{loginUrl}' style='color: #17458F;'>{loginUrl}</a></p>
                            {(!string.IsNullOrWhiteSpace((string?)member.PrimaryMobileNumber) ? $"<p><strong>Username (Mobile):</strong> {member.PrimaryMobileNumber}</p>" : "")}
                            <p><strong>Username (Email):</strong> {member.EmailId}</p>
                            <p><strong>Temporary Password:</strong> {tempPassword}</p>
                        </div>
                        <p style='color: #e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>"
                    : $@"<div style='background-color: #F7F9FC; border: 1px solid #D5DEE8; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                            <p><strong>Login URL:</strong> <a href='{loginUrl}' style='color: #17458F;'>{loginUrl}</a></p>
                            <p>Please use your existing credentials to login.</p>
                        </div>";

                var body = $@"{EmailService.EMAIL_HEADER}
                            <h2 style='color: #17458F; margin-top: 0;'>Role Assignment Notification</h2>
                            <p>Dear {member.MemberName},</p>
                            <p>You have been assigned the following role(s) on {RotaryApi.Services.Brand.ProductName}:</p>
                            {rolesHtml}
                            {credentialsHtml}
                            <div style='text-align: center; margin: 24px 0;'>
                                <a href='{loginUrl}' style='background-color: #17458F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;'>Login Now</a>
                            </div>
                    {EmailService.EMAIL_FOOTER}";

                await _emailService.SendGenericEmailAsync((string)member.EmailId, subject, body);
            }
        }
        catch
        {
            return Ok(new { message = "District Admin role assigned successfully. The email could not be sent." });
        }

        return Ok(new { message = "District Admin role assigned successfully. Email sent." });
    }

    // sendEmail=false lets SuperAdmin remove a District Admin SILENTLY (no notification email).
    [HttpPost("api/districts/{districtId}/members/{memberId}/remove-admin")]
    public async Task<ActionResult> RemoveDistrictAdmin(int districtId, int memberId, [FromQuery] bool sendEmail = true)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var revokedBy = GetUserId();

        // Deactivate district admin role
        var rowsAffected = await connection.ExecuteAsync(@"
            UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @RevokedBy
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, DistrictId = districtId, RevokedBy = revokedBy });

        if (rowsAffected == 0)
            return BadRequest(new { message = "No active District Admin role found for this member." });

        // Check if member has any remaining admin/superadmin roles
        var hasOtherRoles = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND r.RoleName IN ('Admin', 'SuperAdmin')",
            new { MemberId = memberId });

        // If no remaining admin roles, deactivate credentials.
        if (hasOtherRoles == 0)
        {
            await connection.ExecuteAsync(@"
                UPDATE member_credentials SET IsActive = 0 WHERE fk_member_master_profile_id = @MemberId",
                new { MemberId = memberId });
        }

        // Fire removal email (fire-and-forget) — district-scoped, no CC. Skipped entirely
        // when sendEmail=false (SuperAdmin chose to remove the admin silently).
        if (sendEmail)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    using var conn2 = CreateConnection();
                    await conn2.OpenAsync();
                    var mem = await conn2.QueryFirstOrDefaultAsync<dynamic>(
                        "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
                        new { Id = memberId });
                    if (mem == null || string.IsNullOrWhiteSpace((string?)mem.EmailId)) return;
                    var districtNumber = await conn2.ExecuteScalarAsync<string?>(
                        "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId });
                    await _emailService.SendRoleOrMembershipRemovedEmailAsync(
                        (string)mem.EmailId,
                        (string)mem.MemberName,
                        "District Admin role",
                        !string.IsNullOrWhiteSpace(districtNumber) ? $"District {districtNumber}" : null,
                        null);
                }
                catch { /* fire-and-forget — failure already surfaces via EmailService's internal logger */ }
            });
        }

        return Ok(new { message = sendEmail ? "District Admin role removed successfully." : "District Admin role removed (no email sent)." });
    }

    // ── District Admin "all clubs access" toggle (SuperAdmin ONLY) ─────────────
    // Sets member_roles.AllClubsAccess on the target's District-Admin row for this district.
    // The member MUST already be an active District Admin here (assign-admin first) — the
    // toggle is meaningless otherwise. Only SuperAdmin may call this; a district admin can
    // never grant themselves or others club access.
    [HttpPost("api/districts/{districtId}/members/{memberId}/club-access")]
    public async Task<ActionResult> SetDistrictAdminClubAccess(int districtId, int memberId, [FromBody] DistrictAdminClubAccessDto dto)
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (!roles.Contains("SuperAdmin"))
            return StatusCode(403, new { message = "Only SuperAdmin can change District Admin club access." });

        using var connection = CreateConnection();
        await connection.OpenAsync();

        var rows = await connection.ExecuteAsync(@"
            UPDATE member_roles
            SET AllClubsAccess = @Enabled, modified_by = @By, modified_date = NOW()
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId
              AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
            new { Enabled = dto.Enabled ? 1 : 0, MemberId = memberId, DistrictId = districtId, By = GetUserId() });

        if (rows == 0)
            return BadRequest(new { message = "This member is not an active District Admin for this district. Assign District Admin first." });

        return Ok(new { message = dto.Enabled ? "All-clubs access enabled." : "All-clubs access disabled.", allClubsAccess = dto.Enabled });
    }

    // ── District Admin makes another member a District Admin (district-scoped) ──
    // Callable by an active District Admin OF THIS district (or SuperAdmin). Promotes the
    // target to District Admin for the SAME district only, and NEVER grants club access
    // (AllClubsAccess stays 0 — only SuperAdmin can grant that). Reuses AssignDistrictAdmin
    // so credentials + notification email behave identically.
    [HttpPost("api/district-admin/districts/{districtId}/members/{memberId}/assign-admin")]
    public async Task<ActionResult> AssignDistrictAdminByDistrictAdmin(int districtId, int memberId)
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (!roles.Contains("SuperAdmin"))
        {
            using var conn = CreateConnection();
            await conn.OpenAsync();
            var isDa = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @Caller AND fk_role_id = 2 AND fk_district_id = @DistrictId
                  AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
                new { Caller = GetUserId(), DistrictId = districtId });
            if (isDa == 0)
                return StatusCode(403, new { message = "You are not a District Admin for this district." });
        }
        // Delegate — the INSERT/reactivate never sets AllClubsAccess, so no club access is granted.
        return await AssignDistrictAdmin(districtId, memberId);
    }

    // user 2026-10-08: Rotaract clubs (ClubType = 'Rotaract Club') are listed only for SuperAdmin;
    // District / Club Admin club lists, counts and reports hide them. Empty string for SuperAdmin.
    private string NotRotaractUnlessSa(string alias = "c") =>
        !ClubScopeSql.HideRotaract(UserPermissionHelper.IsSuperAdmin(User)) ? "" : " AND " + ClubScopeSql.NotRotaract(alias);

    // ── Clubs of a district, for the District-Admin club switcher dropdown ──────
    // Only a District Admin WITH all-clubs access for this district (or SuperAdmin)
    // may list them. Returns every non-deleted club in the district.
    [HttpGet("api/district-admin/districts/{districtId}/all-clubs")]
    public async Task<ActionResult> GetDistrictAllClubsForAdmin(int districtId)
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        using var connection = CreateConnection();
        await connection.OpenAsync();
        if (!roles.Contains("SuperAdmin"))
        {
            var ok = await connection.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @Caller AND fk_role_id = 2 AND fk_district_id = @DistrictId
                  AND (fk_club_id IS NULL OR fk_club_id = 0) AND AllClubsAccess = 1 AND IsActive = 1 AND isdeleted = 0",
                new { Caller = GetUserId(), DistrictId = districtId });
            if (ok == 0)
                return StatusCode(403, new { message = "You do not have all-clubs access for this district." });
        }
        var clubs = await connection.QueryAsync<dynamic>($@"
            SELECT pk_club_id AS clubId, ClubName AS clubName, ClubRotaryId AS clubRotaryId
            FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0{NotRotaractUnlessSa("")}
            ORDER BY ClubName",
            new { DistrictId = districtId });
        return Ok(clubs);
    }

    private async Task<string> BuildAllRolesHtmlAsync(MySqlConnection connection, int memberId)
    {
        var roles = await connection.QueryAsync<dynamic>(@"
            SELECT r.fk_role_id AS RoleId,
                   CASE r.fk_role_id
                       WHEN 2 THEN CASE WHEN r.fk_district_id IS NOT NULL THEN 'District Admin' ELSE 'Club Admin' END
                       WHEN 3 THEN 'Super Admin'
                       ELSE 'Member'
                   END AS RoleName,
                   c.ClubName,
                   d.DistrictNumber,
                   d2.DistrictNumber AS DirectDistrictNumber
            FROM member_roles r
            LEFT JOIN club_master c ON r.fk_club_id = c.pk_club_id
            LEFT JOIN district_master d ON c.fk_district_id = d.pk_district_id
            LEFT JOIN district_master d2 ON r.fk_district_id = d2.pk_district_id
            WHERE r.fk_member_master_profile_id = @MemberId AND r.IsActive = 1 AND r.isdeleted = 0
            ORDER BY r.fk_role_id", new { MemberId = memberId });

        var html = "<table style='border-collapse: collapse; width: 100%; margin: 12px 0;'>"
            + "<tr style='background-color: #17458F; color: white;'>"
            + "<th style='padding: 8px 12px; text-align: left; border: 1px solid #D5DEE8;'>Role</th>"
            + "<th style='padding: 8px 12px; text-align: left; border: 1px solid #D5DEE8;'>Details</th>"
            + "</tr>";

        foreach (var r in roles)
        {
            int roleId = (int)r.RoleId;
            string roleName = (string)r.RoleName;
            string details = "";

            if (roleId == 2 && r.fk_district_id != null)
            {
                details = $"District {(string?)r.DirectDistrictNumber ?? ""}";
            }
            else if (roleId == 2)
            {
                var district = (string?)r.DistrictNumber ?? "";
                var club = (string?)r.ClubName ?? "";
                details = $"District {district} - {club}";
            }
            else if (roleId == 3)
            {
                details = "All Districts & Clubs";
            }

            html += $"<tr><td style='padding: 8px 12px; border: 1px solid #D5DEE8; font-weight: bold;'>{roleName}</td>"
                  + $"<td style='padding: 8px 12px; border: 1px solid #D5DEE8;'>{details}</td></tr>";
        }

        html += "</table>";
        return html;
    }

    private static string GenerateTempPassword()
    {
        const string upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var random = new Random();
        var password = new char[8];
        for (int i = 0; i < 8; i++)
            password[i] = upper[random.Next(upper.Length)];
        return new string(password);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Projects ────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/projects")]
    public async Task<ActionResult> GetDistrictProjects(int districtId, [FromQuery] int? yearId, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var offset = (page - 1) * pageSize;

        // Year-wise: if yearId provided, read from that year's tables only. If "all years",
        // UNION ALL across every existing year-wise pair (rare for district list — usually filtered).
        var tables = yearId.HasValue
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(new { items = Array.Empty<object>(), totalCount = 0, page, pageSize });

        var itemsUnion = string.Join(" UNION ALL ", tables.Select(t => {
            var suffix = t.YearLabel.Replace("-", "_");
            return $@"
                SELECT p.pk_project_id AS id, p.title, p.description,
                       p.location, p.project_date AS projectDate, p.project_cost AS projectCost,
                       COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') AS currency,
                       p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours,
                       p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved,
                       p.fk_year_id AS yearId,
                       aof.name AS areaOfFocusName,
                       (SELECT CONCAT('/Documents/DistrictProject/', p.fk_district_id, '/', pp.image_path)
                        FROM `{t.PhotosTable}` pp WHERE pp.fk_project_id = p.pk_project_id LIMIT 1) AS primaryPhoto,
                       p.created_date AS createdDate
                FROM `{t.ProjectsTable}` p
                LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                WHERE p.fk_district_id = @DistrictId AND (p.DistrictProjectType = 'Project' OR p.DistrictProjectType IS NULL)
                  AND p.isdeleted = 0
                  AND (@Search IS NULL OR p.title LIKE CONCAT('%', @Search, '%'))";
        }));
        var itemsSql = $"SELECT * FROM ({itemsUnion}) u ORDER BY u.createdDate DESC LIMIT @PageSize OFFSET @Offset";
        var items = (await conn.QueryAsync<dynamic>(itemsSql,
            new { DistrictId = districtId, Search = string.IsNullOrWhiteSpace(search) ? null : search, PageSize = pageSize, Offset = offset })).ToList();

        var countUnion = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT COUNT(*) AS c FROM `{t.ProjectsTable}` p
               WHERE p.fk_district_id = @DistrictId AND (p.DistrictProjectType = 'Project' OR p.DistrictProjectType IS NULL)
                 AND p.isdeleted = 0
                 AND (@Search IS NULL OR p.title LIKE CONCAT('%', @Search, '%'))"));
        var totalCount = await conn.ExecuteScalarAsync<int>(
            $"SELECT COALESCE(SUM(c), 0) FROM ({countUnion}) u",
            new { DistrictId = districtId, Search = string.IsNullOrWhiteSpace(search) ? null : search });

        return Ok(new { items, totalCount, page, pageSize });
    }

    // A district project or event id from another district answers 404 (records live in year-wise tables).
    private async Task<bool> DistrictRecordInYearAsync(int districtId, int yearId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        return info != null && await conn.ExecuteScalarAsync<int?>(
            $"SELECT 1 FROM `{info.ProjectsTable}` WHERE pk_project_id = @Id AND fk_district_id = @D LIMIT 1", new { Id = id, D = districtId }) == 1;
    }

    [HttpGet("api/districts/{districtId}/projects/{yearId}/{id}")]
    public async Task<ActionResult> GetDistrictProject(int districtId, int yearId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null) return NotFound();

        var project = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, p.title, p.description,
                   p.location, p.fk_area_of_focus_id AS areaOfFocusId, p.other_area_of_focus AS otherAreaOfFocus,
                   p.project_date AS projectDate, p.project_cost AS projectCost,
                   p.fk_funding_id AS fundingId,
                   p.global_grant_number AS globalGrantNumber, p.amount_sanctioned AS amountSanctioned,
                   p.amount_received AS amountReceived, p.amount_spent AS amountSpent,
                   p.host_clubs_districts AS hostClubsDistricts, p.global_partner_clubs_districts AS globalPartnerClubsDistricts,
                   p.csr_company_name AS csrCompanyName,
                   p.direct_beneficiaries AS directBeneficiaries,
                   p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                   p.rotaractors_involved AS rotaractorsInvolved
            FROM `{info.ProjectsTable}` p
            WHERE p.pk_project_id = @Id AND p.fk_district_id = @DistrictId AND p.isdeleted = 0",
            new { Id = id, DistrictId = districtId });
        if (project == null) return NotFound();

        // Reconstruct full URL from filename. District uploads live under Documents/DistrictProject/<districtId>/.
        var photos = await conn.QueryAsync<dynamic>($@"
            SELECT pk_photo_id AS id,
                   CONCAT('/Documents/DistrictProject/', @DistrictId, '/', image_path) AS imagePath,
                   description, is_primary AS isPrimary, sort_order AS sortOrder
            FROM `{info.PhotosTable}` WHERE fk_project_id = @Id",
            new { Id = id, DistrictId = districtId });

        return Ok(new { project, photos });
    }

    // ── Funding-conditional helpers (mirror ProjectService for parity with club Community Service) ──
    private static string ClassifyFunding(string? fundingName)
    {
        if (string.IsNullOrWhiteSpace(fundingName)) return "";
        var n = fundingName.Trim().ToLowerInvariant();
        if (n.Contains("global grant")) return "global_grant";
        if (n == "csr" || n.StartsWith("csr ") || n.Contains(" csr") || n.Contains("(csr)")) return "csr";
        return "";
    }

    private async Task<string> GetFundingClassAsync(MySqlConnection conn, int? fundingId)
    {
        if (fundingId == null || fundingId.Value <= 0) return "";
        var name = await conn.ExecuteScalarAsync<string?>(
            "SELECT name FROM funding_master WHERE pk_funding_id = @id AND isdeleted = 0",
            new { id = fundingId.Value });
        return ClassifyFunding(name);
    }

    // Validates required fields per funding type and nulls out non-applicable ones.
    private static void ValidateAndNormalizeDistrictFunding(string fundingClass, DistrictProjectDto dto)
    {
        if (fundingClass == "global_grant")
        {
            dto.CsrCompanyName = null;
            if (string.IsNullOrWhiteSpace(dto.GlobalGrantNumber)) throw new InvalidOperationException("Global Grant Number is required for Global Grant funding.");
            if (dto.AmountSanctioned is null) throw new InvalidOperationException("Amount Sanctioned is required for Global Grant funding.");
            if (dto.AmountReceived is null) throw new InvalidOperationException("Amount Received is required for Global Grant funding.");
            if (dto.AmountSpent is null) throw new InvalidOperationException("Amount Spent Till Date is required for Global Grant funding.");
            if (string.IsNullOrWhiteSpace(dto.HostClubsDistricts)) throw new InvalidOperationException("Host Clubs / Districts is required for Global Grant funding.");
            if (string.IsNullOrWhiteSpace(dto.GlobalPartnerClubsDistricts)) throw new InvalidOperationException("Global Partner Clubs / Districts is required for Global Grant funding.");
        }
        else if (fundingClass == "csr")
        {
            dto.GlobalGrantNumber = null;
            dto.HostClubsDistricts = null;
            dto.GlobalPartnerClubsDistricts = null;
            dto.AmountSpent = null;
            if (string.IsNullOrWhiteSpace(dto.CsrCompanyName)) throw new InvalidOperationException("CSR Company Name is required for CSR funding.");
            if (dto.AmountSanctioned is null) throw new InvalidOperationException("Amount Sanctioned is required for CSR funding.");
            if (dto.AmountReceived is null) throw new InvalidOperationException("Amount Received is required for CSR funding.");
        }
        else
        {
            dto.GlobalGrantNumber = null;
            dto.AmountSanctioned = null;
            dto.AmountReceived = null;
            dto.AmountSpent = null;
            dto.HostClubsDistricts = null;
            dto.GlobalPartnerClubsDistricts = null;
            dto.CsrCompanyName = null;
        }
    }

    [HttpPost("api/districts/{districtId}/projects")]
    public async Task<ActionResult> CreateDistrictProject(int districtId, [FromBody] DistrictProjectDto dto)
    {
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this project." });
        // project_date decides the year-partitioned table below, so a typo'd year creates a junk
        // rotary year that pollutes the public year filter. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.ValidateText(dto.ProjectDate) ?? ProjectDateValidator.ValidateText(dto.EventDate);
        if (dateError != null) return BadRequest(new { message = dateError });
        try
        {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Year-wise routing: derive yearId from project_date and write into the matching
        // rotary_projects_<suffix> table.
        var yearId = await GetRotaryYearIdAsync(conn, dto.ProjectDate ?? dto.EventDate);
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"No year-wise table resolved for yearId {yearId}.");
        var moduleId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_module_id FROM module_master WHERE ModuleKey = 'community_service' AND isdeleted = 0 LIMIT 1") ?? 0;

        // Funding-conditional: validate required fields and null out non-applicable ones.
        var fundingClass = await GetFundingClassAsync(conn, dto.FundingId);
        ValidateAndNormalizeDistrictFunding(fundingClass, dto);

        var id = await conn.ExecuteScalarAsync<int>($@"
            INSERT INTO `{info.ProjectsTable}` (fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType,
                title, description, location, fk_area_of_focus_id, other_area_of_focus,
                project_date, project_cost, fk_funding_id,
                global_grant_number, amount_sanctioned, amount_received, amount_spent, host_clubs_districts, global_partner_clubs_districts, csr_company_name,
                direct_beneficiaries, man_hours,
                rotarians_involved, rotaractors_involved, rcc_involved, created_by, created_date)
            VALUES (0, @DistrictId, @ModuleId, @YearId, 'Project',
                @Title, @Description, @Location, @AreaOfFocusId, @OtherAreaOfFocus,
                @ProjectDate, @ProjectCost, @FundingId,
                @GlobalGrantNumber, @AmountSanctioned, @AmountReceived, @AmountSpent, @HostClubsDistricts, @GlobalPartnerClubsDistricts, @CsrCompanyName,
                @DirectBeneficiaries, @ManHours,
                @RotariansInvolved, @RotaractorsInvolved, @RccInvolved, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new {
                DistrictId = districtId, ModuleId = moduleId, YearId = yearId,
                Title = dto.Title, Description = dto.Description, Location = dto.Location,
                AreaOfFocusId = dto.AreaOfFocusId, OtherAreaOfFocus = dto.OtherAreaOfFocus,
                ProjectDate = dto.ProjectDate, ProjectCost = dto.ProjectCost, FundingId = dto.FundingId,
                GlobalGrantNumber = dto.GlobalGrantNumber, AmountSanctioned = dto.AmountSanctioned,
                AmountReceived = dto.AmountReceived, AmountSpent = dto.AmountSpent,
                HostClubsDistricts = dto.HostClubsDistricts, GlobalPartnerClubsDistricts = dto.GlobalPartnerClubsDistricts,
                CsrCompanyName = dto.CsrCompanyName,
                DirectBeneficiaries = dto.DirectBeneficiaries, ManHours = dto.ManHours,
                RotariansInvolved = dto.RotariansInvolved, RotaractorsInvolved = dto.RotaractorsInvolved,
                RccInvolved = dto.RccInvolved ?? 0,
                UserId = GetUserId()
            });

        // Save photos — store filename only; full URL reconstructed at read time.
        if (dto.Photos != null)
        {
            int sort = 0;
            foreach (var photo in dto.Photos)
            {
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);
                await conn.ExecuteAsync($@"
                    INSERT INTO `{info.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
                    VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder, NOW())",
                    new { ProjectId = id, ImagePath = fileName, Description = photo.Description, IsPrimary = sort == 0 ? 1 : 0, SortOrder = sort++ });
            }
        }

        return Ok(new { id, yearId, message = "District project created." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}", dtoTitle = dto?.Title, dtoDesc = dto?.Description });
        }
    }

    [HttpPut("api/districts/{districtId}/projects/{yearId}/{id}")]
    public async Task<ActionResult> UpdateDistrictProject(int districtId, int yearId, int id, [FromBody] DistrictProjectDto dto)
    {
        if (!await DistrictRecordInYearAsync(districtId, yearId, id)) return NotFound(new { message = "Not found." });
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this project." });
        // Same year-table guard as create. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.ValidateText(dto.ProjectDate) ?? ProjectDateValidator.ValidateText(dto.EventDate);
        if (dateError != null) return BadRequest(new { message = dateError });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"No year-wise table resolved for yearId {yearId}.");
        // Year-move guard: if project_date now belongs to a different rotary year, signal the frontend
        // (409) to confirm a move; it then calls the /move endpoint. DTO date is a string — parse it.
        if (!string.IsNullOrWhiteSpace(dto.ProjectDate) && DateTime.TryParse(dto.ProjectDate, out var parsedDate))
        {
            var dateYearId = await RotaryApi.Services.RotaryYearHelper.EnsureRotaryYearAsync(conn, parsedDate);
            if (dateYearId != yearId)
            {
                var toInfo = await _yearTables.ResolveByYearIdAsync(conn, dateYearId);
                return Conflict(new
                {
                    requiresMove = true,
                    fromYearId = yearId,
                    toYearId = dateYearId,
                    fromYearLabel = info.YearLabel,
                    toYearLabel = toInfo?.YearLabel ?? dateYearId.ToString(),
                    message = $"This project's date moves it from {info.YearLabel} to {toInfo?.YearLabel ?? dateYearId.ToString()}. " +
                              $"Move the project and its photos? It will get a new ID in {toInfo?.YearLabel ?? dateYearId.ToString()}."
                });
            }
        }

        // Funding-conditional: validate required fields and null out non-applicable ones.
        var fundingClass = await GetFundingClassAsync(conn, dto.FundingId);
        try { ValidateAndNormalizeDistrictFunding(fundingClass, dto); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }

        await conn.ExecuteAsync($@"
            UPDATE `{info.ProjectsTable}` SET title=@Title, description=@Description, location=@Location,
                fk_area_of_focus_id=@AreaOfFocusId, other_area_of_focus=@OtherAreaOfFocus,
                project_date=@ProjectDate, project_cost=@ProjectCost, fk_funding_id=@FundingId,
                global_grant_number=@GlobalGrantNumber, amount_sanctioned=@AmountSanctioned,
                amount_received=@AmountReceived, amount_spent=@AmountSpent,
                host_clubs_districts=@HostClubsDistricts, global_partner_clubs_districts=@GlobalPartnerClubsDistricts,
                csr_company_name=@CsrCompanyName,
                direct_beneficiaries=@DirectBeneficiaries, man_hours=@ManHours,
                rotarians_involved=@RotariansInvolved, rotaractors_involved=@RotaractorsInvolved, rcc_involved=@RccInvolved,
                modified_by=@UserId, modified_date=NOW()
            WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
            new {
                Id = id, DistrictId = districtId,
                Title = dto.Title, Description = dto.Description, Location = dto.Location,
                AreaOfFocusId = dto.AreaOfFocusId, OtherAreaOfFocus = dto.OtherAreaOfFocus,
                ProjectDate = dto.ProjectDate, ProjectCost = dto.ProjectCost, FundingId = dto.FundingId,
                GlobalGrantNumber = dto.GlobalGrantNumber, AmountSanctioned = dto.AmountSanctioned,
                AmountReceived = dto.AmountReceived, AmountSpent = dto.AmountSpent,
                HostClubsDistricts = dto.HostClubsDistricts, GlobalPartnerClubsDistricts = dto.GlobalPartnerClubsDistricts,
                CsrCompanyName = dto.CsrCompanyName,
                DirectBeneficiaries = dto.DirectBeneficiaries, ManHours = dto.ManHours,
                RotariansInvolved = dto.RotariansInvolved, RotaractorsInvolved = dto.RotaractorsInvolved,
                RccInvolved = dto.RccInvolved ?? 0,
                UserId = GetUserId()
            });

        // Replace photos — store filename only.
        if (dto.Photos != null)
        {
            await conn.ExecuteAsync($"DELETE FROM `{info.PhotosTable}` WHERE fk_project_id=@Id", new { Id = id });
            int sort = 0;
            foreach (var photo in dto.Photos)
            {
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);
                await conn.ExecuteAsync($@"
                    INSERT INTO `{info.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
                    VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder, NOW())",
                    new { ProjectId = id, ImagePath = fileName, Description = photo.Description, IsPrimary = sort == 0 ? 1 : 0, SortOrder = sort++ });
            }
        }

        return Ok(new { message = "District project updated." });
    }

    [HttpDelete("api/districts/{districtId}/projects/{yearId}/{id}")]
    public async Task<ActionResult> DeleteDistrictProject(int districtId, int yearId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null) return NotFound();
        await conn.ExecuteAsync($"UPDATE `{info.ProjectsTable}` SET isdeleted=1, deleted_by=@UserId, deleted_date=NOW() WHERE pk_project_id=@Id AND fk_district_id=@DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        return Ok(new { message = "Deleted." });
    }

    [HttpPost("api/districts/{districtId}/projects/upload")]
    public async Task<ActionResult> UploadDistrictProjectPhoto(int districtId, IFormFile file, [FromQuery] bool strict = false)
    {
        // Compress oversized (mobile-raw) photos to ≤5 MB before the size guard; web uploads pass through.
        file = RotaryApi.Services.ImageCompressor.EnsureWithinLimit(file);
        var v = RotaryApi.Services.ImageQualityValidator.Validate(file, strict);
        if (!v.Ok) return BadRequest(new { message = v.Error });

        var dir = Path.Combine(_env.WebRootPath, "Documents", "DistrictProject", districtId.ToString());
        Directory.CreateDirectory(dir);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(dir, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return Ok(new { path = $"/Documents/DistrictProject/{districtId}/{fileName}", width = v.Width, height = v.Height, sizeBytes = v.SizeBytes });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Events ──────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/district-events")]
    public async Task<ActionResult> GetDistrictEvents(int districtId, [FromQuery] int? yearId, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var offset = (page - 1) * pageSize;

        var tables = yearId.HasValue
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(new { items = Array.Empty<object>(), totalCount = 0, page, pageSize });

        var itemsUnion = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT p.pk_project_id AS id, p.title, p.description,
                      p.project_date AS eventDate, p.fk_year_id AS yearId,
                      (SELECT CONCAT('/Documents/DistrictEvent/', p.fk_district_id, '/', pp.image_path)
                       FROM `{t.PhotosTable}` pp WHERE pp.fk_project_id = p.pk_project_id LIMIT 1) AS primaryPhoto,
                      p.created_date AS createdDate
               FROM `{t.ProjectsTable}` p
               WHERE p.fk_district_id = @DistrictId AND p.DistrictProjectType = 'Event'
                 AND p.isdeleted = 0
                 AND (@Search IS NULL OR p.title LIKE CONCAT('%', @Search, '%'))"));
        var items = (await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({itemsUnion}) u ORDER BY u.createdDate DESC LIMIT @PageSize OFFSET @Offset",
            new { DistrictId = districtId, Search = string.IsNullOrWhiteSpace(search) ? null : search, PageSize = pageSize, Offset = offset })).ToList();

        var countUnion = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT COUNT(*) AS c FROM `{t.ProjectsTable}` p
               WHERE p.fk_district_id = @DistrictId AND p.DistrictProjectType = 'Event' AND p.isdeleted = 0
                 AND (@Search IS NULL OR p.title LIKE CONCAT('%', @Search, '%'))"));
        var totalCount = await conn.ExecuteScalarAsync<int>(
            $"SELECT COALESCE(SUM(c), 0) FROM ({countUnion}) u",
            new { DistrictId = districtId, Search = string.IsNullOrWhiteSpace(search) ? null : search });

        return Ok(new { items, totalCount, page, pageSize });
    }

    [HttpGet("api/districts/{districtId}/district-events/{yearId}/{id}")]
    public async Task<ActionResult> GetDistrictEvent(int districtId, int yearId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null) return NotFound();

        var evt = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, p.title, p.description,
                   p.project_date AS eventDate
            FROM `{info.ProjectsTable}` p
            WHERE p.pk_project_id = @Id AND p.fk_district_id = @DistrictId AND p.isdeleted = 0",
            new { Id = id, DistrictId = districtId });
        if (evt == null) return NotFound();

        var photos = await conn.QueryAsync<dynamic>($@"
            SELECT pk_photo_id AS id,
                   CONCAT('/Documents/DistrictEvent/', @DistrictId, '/', image_path) AS imagePath,
                   description, sort_order AS sortOrder
            FROM `{info.PhotosTable}` WHERE fk_project_id = @Id",
            new { Id = id, DistrictId = districtId });

        return Ok(new { eventDetail = evt, photos });
    }

    [HttpPost("api/districts/{districtId}/district-events")]
    public async Task<ActionResult> CreateDistrictEvent(int districtId, [FromBody] DistrictEventDto dto)
    {
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this event." });
        // District events share the year-partitioned project tables — a typo'd date creates a junk
        // rotary year that pollutes the public year filter. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.ValidateText(dto.EventDate) ?? ProjectDateValidator.ValidateText(dto.ProjectDate);
        if (dateError != null) return BadRequest(new { message = dateError });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var yearId = await GetRotaryYearIdAsync(conn, dto.ProjectDate ?? dto.EventDate);
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"No year-wise table resolved for yearId {yearId}.");
        var moduleId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_module_id FROM module_master WHERE ModuleKey = 'community_service' AND isdeleted = 0 LIMIT 1") ?? 0;

        var id = await conn.ExecuteScalarAsync<int>($@"
            INSERT INTO `{info.ProjectsTable}` (fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType,
                title, description, project_date, created_by, created_date)
            VALUES (0, @DistrictId, @ModuleId, @YearId, 'Event', @Title, @Description, @EventDate, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { DistrictId = districtId, ModuleId = moduleId, YearId = yearId, Title = dto.Title, Description = dto.Description, EventDate = dto.EventDate, UserId = GetUserId() });

        if (dto.Photos != null)
        {
            int sort = 0;
            foreach (var photo in dto.Photos)
            {
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);
                await conn.ExecuteAsync($@"
                    INSERT INTO `{info.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
                    VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder, NOW())",
                    new { ProjectId = id, ImagePath = fileName, Description = photo.Description, IsPrimary = sort == 0 ? 1 : 0, SortOrder = sort++ });
            }
        }

        return Ok(new { id, yearId, message = "District event created." });
    }

    [HttpPut("api/districts/{districtId}/district-events/{yearId}/{id}")]
    public async Task<ActionResult> UpdateDistrictEventItem(int districtId, int yearId, int id, [FromBody] DistrictEventDto dto)
    {
        if (!await DistrictRecordInYearAsync(districtId, yearId, id)) return NotFound(new { message = "Not found." });
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this event." });
        // Same year-table guard as create. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.ValidateText(dto.EventDate) ?? ProjectDateValidator.ValidateText(dto.ProjectDate);
        if (dateError != null) return BadRequest(new { message = dateError });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"No year-wise table resolved for yearId {yearId}.");
        // Year-move guard for events: if EventDate belongs to a different rotary year, signal a move (409).
        if (!string.IsNullOrWhiteSpace(dto.EventDate) && DateTime.TryParse(dto.EventDate, out var parsedEvtDate))
        {
            var dateYearId = await RotaryApi.Services.RotaryYearHelper.EnsureRotaryYearAsync(conn, parsedEvtDate);
            if (dateYearId != yearId)
            {
                var toInfo = await _yearTables.ResolveByYearIdAsync(conn, dateYearId);
                return Conflict(new
                {
                    requiresMove = true,
                    fromYearId = yearId,
                    toYearId = dateYearId,
                    fromYearLabel = info.YearLabel,
                    toYearLabel = toInfo?.YearLabel ?? dateYearId.ToString(),
                    message = $"This event's date moves it from {info.YearLabel} to {toInfo?.YearLabel ?? dateYearId.ToString()}. " +
                              $"Move the event and its photos? It will get a new ID in {toInfo?.YearLabel ?? dateYearId.ToString()}."
                });
            }
        }

        await conn.ExecuteAsync($@"
            UPDATE `{info.ProjectsTable}` SET title=@Title, description=@Description, project_date=@EventDate,
                modified_by=@UserId, modified_date=NOW()
            WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
            new { Id = id, DistrictId = districtId, Title = dto.Title, Description = dto.Description, EventDate = dto.EventDate, UserId = GetUserId() });

        if (dto.Photos != null)
        {
            await conn.ExecuteAsync($"DELETE FROM `{info.PhotosTable}` WHERE fk_project_id=@Id", new { Id = id });
            int sort = 0;
            foreach (var photo in dto.Photos)
            {
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);
                await conn.ExecuteAsync($@"
                    INSERT INTO `{info.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
                    VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder, NOW())",
                    new { ProjectId = id, ImagePath = fileName, Description = photo.Description, IsPrimary = sort == 0 ? 1 : 0, SortOrder = sort++ });
            }
        }

        return Ok(new { message = "District event updated." });
    }

    [HttpDelete("api/districts/{districtId}/district-events/{yearId}/{id}")]
    public async Task<ActionResult> DeleteDistrictEventItem(int districtId, int yearId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null) return NotFound();
        await conn.ExecuteAsync($"UPDATE `{info.ProjectsTable}` SET isdeleted=1, deleted_by=@UserId, deleted_date=NOW() WHERE pk_project_id=@Id AND fk_district_id=@DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        return Ok(new { message = "Deleted." });
    }

    [HttpPost("api/districts/{districtId}/district-events/upload")]
    public async Task<ActionResult> UploadDistrictEventPhoto(int districtId, IFormFile file, [FromQuery] bool strict = false)
    {
        // Compress oversized (mobile-raw) photos to ≤5 MB before the size guard; web uploads pass through.
        file = RotaryApi.Services.ImageCompressor.EnsureWithinLimit(file);
        var v = RotaryApi.Services.ImageQualityValidator.Validate(file, strict);
        if (!v.Ok) return BadRequest(new { message = v.Error });

        var dir = Path.Combine(_env.WebRootPath, "Documents", "DistrictEvent", districtId.ToString());
        Directory.CreateDirectory(dir);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(dir, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return Ok(new { path = $"/Documents/DistrictEvent/{districtId}/{fileName}", width = v.Width, height = v.Height, sizeBytes = v.SizeBytes });
    }

    // ── Cross-year move (district projects + events) ───────────────────────
    // All columns of the year-wise project table except the auto-increment pk. Used by the
    // relocate helper to copy a row into another year's table verbatim (pk regenerated).
    private const string DistrictMoveColumns =
        "fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType, project_type, " +
        "parent_project_id, ongoing_group_title, is_joint_project, co_host_name, club_role, title, " +
        "description, location, fk_area_of_focus_id, other_area_of_focus, " +
        "project_date, project_cost, fk_funding_id, " +
        "direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved, rcc_involved, " +
        "meeting_type, agenda_document, minutes_document, attendance, attendance_percentage, " +
        "global_grant_number, amount_sanctioned, amount_received, amount_spent, host_clubs_districts, " +
        "global_partner_clubs_districts, csr_company_name, " +
        "is_active, created_by, created_date, modified_by, modified_date, " +
        "isdeleted, deleted_by, deleted_date, old_pk";

    // Relocates an already-updated district record (project or event) + its photos to the target
    // year's tables, verifies the copy, then soft-deletes the source. District photos live under
    // /Documents/DistrictProject|Event/{districtId}/ (filename in DB), so no disk move is needed —
    // the path is year-independent. Returns the new project id. Throws on verification failure.
    private async Task<int> RelocateDistrictRowAsync(
        MySqlConnection conn, MySqlTransaction tx,
        YearTableInfo src, YearTableInfo tgt, int id, int districtId, int newYearId, int userId)
    {
        // SELECT list = same columns, but fk_year_id replaced with the target year.
        var selectCols = DistrictMoveColumns.Replace("fk_year_id", "@NewYearId AS fk_year_id");
        var newId = await conn.ExecuteScalarAsync<int>($@"
            INSERT INTO `{tgt.ProjectsTable}` ({DistrictMoveColumns})
            SELECT {selectCols} FROM `{src.ProjectsTable}`
            WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0;
            SELECT LAST_INSERT_ID();",
            new { NewYearId = newYearId, Id = id, DistrictId = districtId }, tx);

        await conn.ExecuteAsync($@"
            INSERT INTO `{tgt.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
            SELECT @NewId, image_path, description, is_primary, sort_order, created_date
            FROM `{src.PhotosTable}` WHERE fk_project_id=@Id",
            new { NewId = newId, Id = id }, tx);

        var srcPhotos = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM `{src.PhotosTable}` WHERE fk_project_id=@Id", new { Id = id }, tx);
        var tgtPhotos = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM `{tgt.PhotosTable}` WHERE fk_project_id=@NewId", new { NewId = newId }, tx);
        var tgtExists = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM `{tgt.ProjectsTable}` WHERE pk_project_id=@NewId", new { NewId = newId }, tx);

        if (tgtExists != 1 || srcPhotos != tgtPhotos)
            throw new InvalidOperationException(
                $"Move verification failed (target rows={tgtExists}, photos src={srcPhotos}/tgt={tgtPhotos}). Nothing deleted.");

        await conn.ExecuteAsync($"DELETE FROM `{src.PhotosTable}` WHERE fk_project_id=@Id", new { Id = id }, tx);
        await conn.ExecuteAsync(
            $@"UPDATE `{src.ProjectsTable}` SET isdeleted=1, deleted_by=@UserId, deleted_date=NOW()
               WHERE pk_project_id=@Id AND fk_district_id=@DistrictId", new { Id = id, DistrictId = districtId, UserId = userId }, tx);

        return newId;
    }

    [HttpPost("api/districts/{districtId}/projects/{yearId}/{id}/move")]
    public async Task<ActionResult> MoveDistrictProject(int districtId, int yearId, int id, [FromBody] DistrictProjectDto dto)
    {
        if (!await DistrictRecordInYearAsync(districtId, yearId, id)) return NotFound(new { message = "Not found." });
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this project." });
        if (string.IsNullOrWhiteSpace(dto.ProjectDate) || !DateTime.TryParse(dto.ProjectDate, out var parsed))
            return BadRequest(new { message = "A valid project date is required to move the project." });
        // The move target year is derived from this date — same guard. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.Validate(parsed);
        if (dateError != null) return BadRequest(new { message = dateError });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var src = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"No year-wise table for yearId {yearId}.");
        var toYearId = await RotaryApi.Services.RotaryYearHelper.EnsureRotaryYearAsync(conn, parsed);
        if (toYearId == yearId) return BadRequest(new { message = "Project date is in the same year — use normal update, not move." });
        var tgt = await _yearTables.ResolveByYearIdAsync(conn, toYearId)
            ?? throw new InvalidOperationException($"No year-wise table for yearId {toYearId}.");

        using var tx = await conn.BeginTransactionAsync();
        try
        {
            // Apply the edit to the source row + its photos (same as the normal update), then relocate.
            await conn.ExecuteAsync($@"
                UPDATE `{src.ProjectsTable}` SET title=@Title, description=@Description, location=@Location,
                    fk_area_of_focus_id=@AreaOfFocusId, other_area_of_focus=@OtherAreaOfFocus,
                    project_date=@ProjectDate, project_cost=@ProjectCost, fk_funding_id=@FundingId,
                    direct_beneficiaries=@DirectBeneficiaries, man_hours=@ManHours,
                    rotarians_involved=@RotariansInvolved, rotaractors_involved=@RotaractorsInvolved, rcc_involved=@RccInvolved,
                    modified_by=@UserId, modified_date=NOW()
                WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
                new {
                    Id = id, DistrictId = districtId,
                    Title = dto.Title, Description = dto.Description, Location = dto.Location,
                    AreaOfFocusId = dto.AreaOfFocusId, OtherAreaOfFocus = dto.OtherAreaOfFocus,
                    ProjectDate = dto.ProjectDate, ProjectCost = dto.ProjectCost, FundingId = dto.FundingId,
                    DirectBeneficiaries = dto.DirectBeneficiaries, ManHours = dto.ManHours,
                    RotariansInvolved = dto.RotariansInvolved, RotaractorsInvolved = dto.RotaractorsInvolved,
                    RccInvolved = dto.RccInvolved ?? 0,
                    UserId = GetUserId()
                }, tx);

            await conn.ExecuteAsync($"DELETE FROM `{src.PhotosTable}` WHERE fk_project_id=@Id", new { Id = id }, tx);
            int sort = 0;
            foreach (var photo in dto.Photos)
            {
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);
                await conn.ExecuteAsync($@"
                    INSERT INTO `{src.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
                    VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder, NOW())",
                    new { ProjectId = id, ImagePath = fileName, Description = photo.Description, IsPrimary = sort == 0 ? 1 : 0, SortOrder = sort++ }, tx);
            }

            var newId = await RelocateDistrictRowAsync(conn, tx, src, tgt, id, districtId, toYearId, GetUserId());
            await tx.CommitAsync();
            return Ok(new { message = $"District project moved to {tgt.YearLabel} successfully.", newYearId = toYearId, newId, newYearLabel = tgt.YearLabel });
        }
        catch
        {
            try { await tx.RollbackAsync(); } catch { }
            throw;
        }
    }

    [HttpPost("api/districts/{districtId}/district-events/{yearId}/{id}/move")]
    public async Task<ActionResult> MoveDistrictEvent(int districtId, int yearId, int id, [FromBody] DistrictEventDto dto)
    {
        if (!await DistrictRecordInYearAsync(districtId, yearId, id)) return NotFound(new { message = "Not found." });
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this event." });
        if (string.IsNullOrWhiteSpace(dto.EventDate) || !DateTime.TryParse(dto.EventDate, out var parsed))
            return BadRequest(new { message = "A valid event date is required to move the event." });
        // The move target year is derived from this date — same guard. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.Validate(parsed);
        if (dateError != null) return BadRequest(new { message = dateError });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var src = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"No year-wise table for yearId {yearId}.");
        var toYearId = await RotaryApi.Services.RotaryYearHelper.EnsureRotaryYearAsync(conn, parsed);
        if (toYearId == yearId) return BadRequest(new { message = "Event date is in the same year — use normal update, not move." });
        var tgt = await _yearTables.ResolveByYearIdAsync(conn, toYearId)
            ?? throw new InvalidOperationException($"No year-wise table for yearId {toYearId}.");

        using var tx = await conn.BeginTransactionAsync();
        try
        {
            await conn.ExecuteAsync($@"
                UPDATE `{src.ProjectsTable}` SET title=@Title, description=@Description, project_date=@EventDate,
                    modified_by=@UserId, modified_date=NOW()
                WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
                new { Id = id, DistrictId = districtId, Title = dto.Title, Description = dto.Description, EventDate = dto.EventDate, UserId = GetUserId() }, tx);

            await conn.ExecuteAsync($"DELETE FROM `{src.PhotosTable}` WHERE fk_project_id=@Id", new { Id = id }, tx);
            int sort = 0;
            foreach (var photo in dto.Photos)
            {
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);
                await conn.ExecuteAsync($@"
                    INSERT INTO `{src.PhotosTable}` (fk_project_id, image_path, is_primary, sort_order, created_date)
                    VALUES (@ProjectId, @ImagePath, @IsPrimary, @SortOrder, NOW())",
                    new { ProjectId = id, ImagePath = fileName, IsPrimary = sort == 0 ? 1 : 0, SortOrder = sort++ }, tx);
            }

            var newId = await RelocateDistrictRowAsync(conn, tx, src, tgt, id, districtId, toYearId, GetUserId());
            await tx.CommitAsync();
            return Ok(new { message = $"District event moved to {tgt.YearLabel} successfully.", newYearId = toYearId, newId, newYearLabel = tgt.YearLabel });
        }
        catch
        {
            try { await tx.RollbackAsync(); } catch { }
            throw;
        }
    }

    [HttpGet("api/districts/{districtId}/projects/available-years")]
    public async Task<ActionResult> GetDistrictProjectAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Year-wise: ask every existing year-wise project table whether it holds a row
        // for this district + 'Project' type. Builds UNION ALL across the tables.
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        // Each leg wrapped in parens — MySQL rejects `LIMIT 1 UNION ALL` without them.
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"(SELECT {t.YearId} AS id, '{t.YearLabel}' AS yearLabel,
                       (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS isCurrent
                FROM `{t.ProjectsTable}`
                WHERE fk_district_id = @DistrictId AND (DistrictProjectType = 'Project' OR DistrictProjectType IS NULL) AND isdeleted = 0
                LIMIT 1)"));
        var years = await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({unionLegs}) u ORDER BY u.yearLabel DESC",
            new { DistrictId = districtId });
        return Ok(years);
    }

    [HttpGet("api/districts/{districtId}/district-events/available-years")]
    public async Task<ActionResult> GetDistrictEventAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"(SELECT {t.YearId} AS id, '{t.YearLabel}' AS yearLabel,
                       (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS isCurrent
                FROM `{t.ProjectsTable}`
                WHERE fk_district_id = @DistrictId AND DistrictProjectType = 'Event' AND isdeleted = 0
                LIMIT 1)"));
        var years = await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({unionLegs}) u ORDER BY u.yearLabel DESC",
            new { DistrictId = districtId });
        return Ok(years);
    }

    // ── Website Data: Available Years ──────────────────────────────────
    [HttpGet("api/districts/{districtId}/website-data/banners/available-years")]
    public async Task<ActionResult> GetDistrictBannerAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection(); await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
            FROM club_website_banner b INNER JOIN rotary_year_master ry ON ry.pk_year_id = b.fk_year_id
            WHERE b.fk_district_id = @DistrictId AND b.fk_club_id = 0 AND COALESCE(b.isdeleted, 0) = 0 ORDER BY ry.YearLabel DESC", new { DistrictId = districtId });
        return Ok(years);
    }

    [HttpGet("api/districts/{districtId}/website-data/advertisements/available-years")]
    public async Task<ActionResult> GetDistrictAdAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection(); await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
            FROM club_website_advertisement a INNER JOIN rotary_year_master ry ON ry.pk_year_id = a.fk_year_id
            WHERE a.fk_district_id = @DistrictId AND a.fk_club_id = 0 AND COALESCE(a.isdeleted,0) = 0 ORDER BY ry.YearLabel DESC", new { DistrictId = districtId });
        return Ok(years);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Banners ───────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/website-data/banners")]
    public async Task<ActionResult> GetDistrictBanners(int districtId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var yId = yearId ?? await conn.ExecuteScalarAsync<int>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        var banners = await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_website_banner_id AS id,
                   CASE
                       WHEN banner_image_path IS NULL OR banner_image_path = '' THEN NULL
                       WHEN banner_image_path LIKE '/%' THEN banner_image_path
                       ELSE CONCAT('/uploads/banner/', banner_image_path)
                   END AS bannerImagePath,
                   CASE
                       WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path)
                       ELSE CONCAT('/uploads/banner/', document_path)
                   END AS documentPath,
                   link_url AS linkUrl,
                   description, sort_order AS sortOrder, is_active AS isActive,
                   fk_year_id AS yearId
            FROM club_website_banner
            WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND fk_year_id = @YearId
              AND COALESCE(isdeleted, 0) = 0
            ORDER BY sort_order",
            new { DistrictId = districtId, YearId = yId });
        return Ok(banners);
    }

    [HttpPost("api/districts/{districtId}/website-data/banners")]
    public async Task<ActionResult> CreateDistrictBanner(int districtId, [FromBody] DistrictBannerDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        int yearId = (int)(dto.YearId ?? await conn.ExecuteScalarAsync<int>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1"));
        string bannerImagePath = dto.BannerImagePath;
        string? description = dto.Description;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_banner (fk_club_id, fk_district_id, fk_year_id, banner_image_path, document_path, link_url, description, sort_order, is_active, created_by, created_date)
            VALUES (0, @DistrictId, @YearId, @BannerImagePath, @DocumentPath, @LinkUrl, @Description, @SortOrder, @IsActive, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { DistrictId = districtId, YearId = yearId, BannerImagePath = bannerImagePath,
                  DocumentPath = string.IsNullOrWhiteSpace(dto.DocumentPath) ? null : dto.DocumentPath.Trim(),
                  LinkUrl = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(),
                  Description = description, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/website-data/banners/{id}")]
    public async Task<ActionResult> UpdateDistrictBanner(int districtId, int id, [FromBody] DistrictBannerDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        string bannerImagePath = dto.BannerImagePath;
        string? description = dto.Description;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        await conn.ExecuteAsync(@"
            UPDATE club_website_banner SET banner_image_path = @BannerImagePath, document_path = @DocumentPath, link_url = @LinkUrl,
                description = @Description, sort_order = @SortOrder, is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_banner_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, BannerImagePath = bannerImagePath,
                  DocumentPath = string.IsNullOrWhiteSpace(dto.DocumentPath) ? null : dto.DocumentPath.Trim(),
                  LinkUrl = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(),
                  Description = description, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { message = "Banner updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/website-data/banners/{id}")]
    public async Task<ActionResult> DeleteDistrictBanner(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_website_banner SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_banner_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        return Ok(new { message = "Banner deleted successfully." });
    }

    // Optional document a district banner can point to (alternative to a link).
    [HttpPost("api/districts/{districtId}/website-data/banners/upload-document")]
    public async Task<ActionResult> UploadDistrictBannerDocument(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded" });
        var allowed = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png" };
        if (!allowed.Contains(Path.GetExtension(file.FileName).ToLower()))
            return BadRequest(new { message = "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx, jpg, jpeg, png" });
        if (file.Length > 10 * 1024 * 1024) return BadRequest(new { message = "File size must be less than 10 MB." });
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "banner");
        Directory.CreateDirectory(uploadsPath);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        using (var stream = new FileStream(Path.Combine(uploadsPath, fileName), FileMode.Create))
            await file.CopyToAsync(stream);
        return Ok(new { path = fileName });
    }

    [HttpPost("api/districts/{districtId}/website-data/banners/upload")]
    public async Task<ActionResult> UploadDistrictBannerImage(int districtId, IFormFile file, [FromQuery] bool strict = false)
    {
        // Compress oversized (mobile-raw) photos to ≤5 MB before the size guard; web uploads pass through.
        file = RotaryApi.Services.ImageCompressor.EnsureWithinLimit(file);
        var v = RotaryApi.Services.ImageQualityValidator.Validate(file, strict);
        if (!v.Ok) return BadRequest(new { message = v.Error });

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "banner");
        Directory.CreateDirectory(uploadsPath);
        var fileName = $"{Guid.NewGuid()}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // path = filename only (stored as-is; SQL CONCAT rebuilds on read). url = ready-to-use
        // relative path for the immediate preview before save.
        return Ok(new { path = fileName, url = "/uploads/banner/" + fileName, width = v.Width, height = v.Height, sizeBytes = v.SizeBytes });
    }

    // Drag-and-drop reorder: takes the full ordered list of district-banner ids and rewrites sort_order.
    [HttpPut("api/districts/{districtId}/website-data/banners/reorder-all")]
    public async Task<ActionResult> ReorderDistrictBannersAll(int districtId, [FromBody] ReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                @"UPDATE club_website_banner SET sort_order=@S
                  WHERE pk_club_website_banner_id=@Id AND fk_district_id=@D AND fk_club_id=0",
                new { S = i, Id = dto.OrderedIds[i], D = districtId });
        return Ok(new { message = "Order saved." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Advertisements ────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/website-data/advertisements")]
    public async Task<ActionResult> GetDistrictAdvertisements(int districtId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var yId = yearId ?? await conn.ExecuteScalarAsync<int>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        var ads = await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_website_advertisement_id AS id,
                   CASE
                       WHEN advertisement_image_path IS NULL OR advertisement_image_path = '' THEN NULL
                       WHEN advertisement_image_path LIKE '/%' THEN advertisement_image_path
                       -- Legacy/migrated rows can carry an already-relative nested path rather than a
                       -- bare filename — blindly prefixing '/uploads/advertisement/' onto that produced
                       -- a non-existent, double-nested path.
                       WHEN advertisement_image_path LIKE '%/%' THEN CONCAT('/', advertisement_image_path)
                       ELSE CONCAT('/uploads/advertisement/', advertisement_image_path)
                   END AS advertisementImagePath,
                   CASE
                       WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path)
                       ELSE CONCAT('/uploads/advertisement/', document_path)
                   END AS documentPath,
                   link_url AS linkUrl,
                   description, sort_order AS sortOrder, is_active AS isActive,
                   fk_year_id AS yearId
            FROM club_website_advertisement
            WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND fk_year_id = @YearId
              AND COALESCE(isdeleted, 0) = 0
            ORDER BY sort_order",
            new { DistrictId = districtId, YearId = yId });
        return Ok(ads);
    }

    [HttpPost("api/districts/{districtId}/website-data/advertisements")]
    public async Task<ActionResult> CreateDistrictAdvertisement(int districtId, [FromBody] DistrictAdvertisementDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        int yearId = (int)(dto.YearId ?? await conn.ExecuteScalarAsync<int>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1"));
        string advertisementImagePath = dto.AdvertisementImagePath;
        string? documentPath = dto.DocumentPath;
        string? description = dto.Description;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_advertisement (fk_club_id, fk_district_id, fk_year_id, advertisement_image_path, document_path, link_url, description, sort_order, is_active, created_by, created_date)
            VALUES (0, @DistrictId, @YearId, @AdvertisementImagePath, @DocumentPath, @LinkUrl, @Description, @SortOrder, @IsActive, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { DistrictId = districtId, YearId = yearId, AdvertisementImagePath = advertisementImagePath,
                  DocumentPath = string.IsNullOrWhiteSpace(documentPath) ? null : documentPath.Trim(),
                  LinkUrl = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(),
                  Description = description, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/website-data/advertisements/{id}")]
    public async Task<ActionResult> UpdateDistrictAdvertisement(int districtId, int id, [FromBody] DistrictAdvertisementDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        string advertisementImagePath = dto.AdvertisementImagePath;
        string? documentPath = dto.DocumentPath;
        string? description = dto.Description;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        await conn.ExecuteAsync(@"
            UPDATE club_website_advertisement SET advertisement_image_path = @AdvertisementImagePath,
                document_path = @DocumentPath, link_url = @LinkUrl, description = @Description,
                sort_order = @SortOrder, is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_advertisement_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, AdvertisementImagePath = advertisementImagePath,
                  DocumentPath = string.IsNullOrWhiteSpace(documentPath) ? null : documentPath.Trim(),
                  LinkUrl = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(),
                  Description = description, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { message = "Advertisement updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/website-data/advertisements/{id}")]
    public async Task<ActionResult> DeleteDistrictAdvertisement(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_website_advertisement SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_advertisement_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        return Ok(new { message = "Advertisement deleted successfully." });
    }

    // Optional document a district advertisement can point to (alternative to a link).
    [HttpPost("api/districts/{districtId}/website-data/advertisements/upload-document")]
    public async Task<ActionResult> UploadDistrictAdvertisementDocument(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded" });
        var allowed = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png" };
        if (!allowed.Contains(Path.GetExtension(file.FileName).ToLower()))
            return BadRequest(new { message = "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx, jpg, jpeg, png" });
        if (file.Length > 10 * 1024 * 1024) return BadRequest(new { message = "File size must be less than 10 MB." });
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "advertisement");
        Directory.CreateDirectory(uploadsPath);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        using (var stream = new FileStream(Path.Combine(uploadsPath, fileName), FileMode.Create))
            await file.CopyToAsync(stream);
        return Ok(new { path = fileName });
    }

    [HttpPost("api/districts/{districtId}/website-data/advertisements/upload")]
    public async Task<ActionResult> UploadDistrictAdvertisementImage(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "advertisement");
        Directory.CreateDirectory(uploadsPath);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // path = filename only (stored as-is; SQL CONCAT rebuilds on read). url = ready-to-use
        // relative path for the immediate preview before save.
        return Ok(new { path = fileName, url = "/uploads/advertisement/" + fileName });
    }

    // Drag-and-drop reorder: takes the full ordered list of district-advertisement ids and rewrites sort_order.
    [HttpPut("api/districts/{districtId}/website-data/advertisements/reorder-all")]
    public async Task<ActionResult> ReorderDistrictAdvertisementsAll(int districtId, [FromBody] ReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                @"UPDATE club_website_advertisement SET sort_order=@S
                  WHERE pk_club_website_advertisement_id=@Id AND fk_district_id=@D AND fk_club_id=0",
                new { S = i, Id = dto.OrderedIds[i], D = districtId });
        return Ok(new { message = "Order saved." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Social Media Links ────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    // Social media links are NOT year-wise — one set per district, persisting across years.
    [HttpGet("api/districts/{districtId}/website-data/social-links")]
    public async Task<ActionResult> GetDistrictSocialLinks(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var links = await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_website_social_link_id AS id, platform, link_url AS linkUrl,
                   sort_order AS sortOrder, is_active AS isActive
            FROM club_website_social_link
            WHERE fk_district_id = @DistrictId AND fk_club_id = 0
              AND (isdeleted = 0 OR isdeleted IS NULL)
            ORDER BY sort_order",
            new { DistrictId = districtId });
        return Ok(links);
    }

    [HttpPost("api/districts/{districtId}/website-data/social-links")]
    public async Task<ActionResult> CreateDistrictSocialLink(int districtId, [FromBody] DistrictSocialLinkDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        string platform = dto.Platform;
        string linkUrl = dto.LinkUrl;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        // Platform must be UNIQUE per district. Frontend enforces this too
        // (see /district-admin-dashboard/my-district-website/social-media-links),
        // but the API guard is required — a direct POST would otherwise
        // bypass the check. Case-insensitive to catch "Facebook" vs
        // "facebook".
        var dupeCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_website_social_link
            WHERE fk_district_id = @DistrictId
              AND LOWER(platform) = LOWER(@Platform)
              AND isdeleted = 0",
            new { DistrictId = districtId, Platform = platform });
        if (dupeCount > 0)
        {
            return BadRequest(new { message = $"{platform} is already added for this district. Edit the existing entry instead of creating a duplicate." });
        }

        // Social media links are NOT year-wise — fk_year_id was dropped from the table.
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_social_link (fk_club_id, fk_district_id, platform, link_url, sort_order, is_active, created_by, created_date)
            VALUES (0, @DistrictId, @Platform, @LinkUrl, @SortOrder, @IsActive, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { DistrictId = districtId, Platform = platform, LinkUrl = linkUrl, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/website-data/social-links/{id}")]
    public async Task<ActionResult> UpdateDistrictSocialLink(int districtId, int id, [FromBody] DistrictSocialLinkDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        string platform = dto.Platform;
        string linkUrl = dto.LinkUrl;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        // Uniqueness guard on update too — reject if another row (not this
        // one) already uses the same platform.
        var dupeCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_website_social_link
            WHERE fk_district_id = @DistrictId
              AND LOWER(platform) = LOWER(@Platform)
              AND pk_club_website_social_link_id <> @Id
              AND isdeleted = 0",
            new { DistrictId = districtId, Platform = platform, Id = id });
        if (dupeCount > 0)
        {
            return BadRequest(new { message = $"{platform} is already added for this district. Edit the existing entry instead of creating a duplicate." });
        }

        await conn.ExecuteAsync(@"
            UPDATE club_website_social_link SET platform = @Platform, link_url = @LinkUrl,
                sort_order = @SortOrder, is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_social_link_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, Platform = platform, LinkUrl = linkUrl, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { message = "Social link updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/website-data/social-links/{id}")]
    public async Task<ActionResult> DeleteDistrictSocialLink(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_website_social_link SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_social_link_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        return Ok(new { message = "Social link deleted successfully." });
    }

    // Drag-and-drop reorder: takes the full ordered list of district social-link ids and rewrites sort_order.
    [HttpPut("api/districts/{districtId}/website-data/social-links/reorder-all")]
    public async Task<ActionResult> ReorderDistrictSocialLinksAll(int districtId, [FromBody] ReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                @"UPDATE club_website_social_link SET sort_order=@S
                  WHERE pk_club_website_social_link_id=@Id AND fk_district_id=@D AND fk_club_id=0",
                new { S = i, Id = dto.OrderedIds[i], D = districtId });
        return Ok(new { message = "Order saved." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Logo ──────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/website-data/logo")]
    public async Task<ActionResult> GetDistrictLogo(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var logoPath = await conn.ExecuteScalarAsync<string?>(@"
            SELECT CASE
                       WHEN DistrictLogoPath IS NULL OR DistrictLogoPath = '' THEN NULL
                       WHEN DistrictLogoPath LIKE '/%' THEN DistrictLogoPath
                       ELSE CONCAT('/uploads/district/', DistrictLogoPath)
                   END
            FROM district_master WHERE pk_district_id = @DistrictId",
            new { DistrictId = districtId });
        return Ok(new { logoPath });
    }

    [HttpPost("api/districts/{districtId}/website-data/logo/upload")]
    public async Task<ActionResult> UploadDistrictLogo(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });
        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        // Use the same folder as DistrictService.UploadLogoAsync so the column has a single canonical folder.
        // Store filename only — full URL reconstructed on SELECT via CONCAT('/uploads/district/', DistrictLogoPath).
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "district");
        Directory.CreateDirectory(uploadsPath);
        var fileName = $"{Guid.NewGuid()}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE district_master SET DistrictLogoPath = @LogoPath WHERE pk_district_id = @DistrictId",
            new { LogoPath = fileName, DistrictId = districtId });
        return Ok(new { path = fileName });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Menu List ─────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/website-data/menus")]
    public async Task<ActionResult> GetDistrictMenus(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var menus = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_club_website_menu_id AS id, m.menu_name AS menuName, m.link_type AS linkType,
                   CASE
                       WHEN m.link_value IS NULL OR m.link_value = '' THEN m.link_value
                       WHEN m.link_type = 'document'
                            AND m.link_value NOT LIKE '/%'
                            AND m.link_value NOT LIKE 'http%'
                            THEN CONCAT('/uploads/menu/', m.link_value)
                       ELSE m.link_value
                   END AS linkValue,
                   m.sort_order AS sortOrder, m.is_active AS isActive,
                   COALESCE(m.is_default, 0) AS isDefault,
                   (SELECT COUNT(*) FROM club_website_submenu s
                    WHERE s.fk_menu_id = m.pk_club_website_menu_id AND s.isdeleted = 0) AS subMenuCount
            FROM club_website_menu m
            WHERE m.fk_district_id = @DistrictId AND m.fk_club_id = 0
              AND (m.isdeleted = 0 OR m.isdeleted IS NULL)
            ORDER BY m.sort_order",
            new { DistrictId = districtId });
        return Ok(menus);
    }

    [HttpPost("api/districts/{districtId}/website-data/menus")]
    public async Task<ActionResult> CreateDistrictMenu(int districtId, [FromBody] DistrictMenuDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        string menuName = dto.MenuName;
        string linkType = dto.LinkType;
        string linkValue = dto.LinkValue;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        // Enforce the 9-menu cap on the district. Frontend also blocks the
        // Add button when count >= 9, but the API guard is required — a
        // direct POST would otherwise sneak past. Excludes soft-deleted
        // rows. Historical districts that already exceed the cap can't add
        // MORE; they must delete some before creating new ones.
        var currentCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_website_menu
            WHERE fk_district_id = @DistrictId AND isdeleted = 0",
            new { DistrictId = districtId });
        if (currentCount >= 9)
        {
            return BadRequest(new { message = $"Menu limit reached ({currentCount}/9). Delete an existing menu before adding a new one." });
        }

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_menu (fk_club_id, fk_district_id, menu_name, link_type, link_value, sort_order, is_active, created_by, created_date)
            VALUES (0, @DistrictId, @MenuName, @LinkType, @LinkValue, @SortOrder, @IsActive, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { DistrictId = districtId, MenuName = menuName, LinkType = linkType, LinkValue = linkValue, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/website-data/menus/{id}")]
    public async Task<ActionResult> UpdateDistrictMenu(int districtId, int id, [FromBody] DistrictMenuDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Block edits on default-seeded menus (is_default=1) — they're protected like the club side.
        var isDefault = await conn.ExecuteScalarAsync<int?>(
            "SELECT is_default FROM club_website_menu WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND isdeleted = 0",
            new { Id = id, DistrictId = districtId });
        if (isDefault == 1)
            return BadRequest(new { message = "Default menus cannot be edited." });

        string menuName = dto.MenuName;
        string linkType = dto.LinkType;
        string linkValue = dto.LinkValue;
        int sortOrder = dto.SortOrder;
        bool isActive = dto.IsActive;

        await conn.ExecuteAsync(@"
            UPDATE club_website_menu SET menu_name = @MenuName, link_type = @LinkType,
                link_value = @LinkValue, sort_order = @SortOrder, is_active = @IsActive,
                modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, MenuName = menuName, LinkType = linkType, LinkValue = linkValue, SortOrder = sortOrder, IsActive = isActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { message = "Menu updated successfully." });
    }

    // Active/Inactive switch only. Works on default menus too (which UpdateDistrictMenu refuses) —
    // name, link and order stay untouched. An inactive menu and its sub-menus drop off the
    // public district site (the public GET only reads is_active = 1 menus).
    [HttpPut("api/districts/{districtId}/website-data/menus/{id}/active")]
    public async Task<ActionResult> SetDistrictMenuActive(int districtId, int id, [FromBody] SetMenuActiveDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var isHome = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_website_menu
            WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND fk_club_id = 0 AND isdeleted = 0
              AND is_default = 1 AND LOWER(TRIM(link_value)) = 'home'",
            new { Id = id, DistrictId = districtId });
        if (isHome > 0)
            return BadRequest(new { message = "The Home menu is always active." });

        var rows = await conn.ExecuteAsync(@"
            UPDATE club_website_menu SET is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND fk_club_id = 0 AND isdeleted = 0",
            new { Id = id, DistrictId = districtId, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        if (rows == 0) return NotFound(new { message = "Menu not found." });
        return Ok(new { message = dto.IsActive ? "Menu activated." : "Menu deactivated." });
    }

    [HttpDelete("api/districts/{districtId}/website-data/menus/{id}")]
    public async Task<ActionResult> DeleteDistrictMenu(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Block delete on default-seeded menus (is_default=1).
        var isDefault = await conn.ExecuteScalarAsync<int?>(
            "SELECT is_default FROM club_website_menu WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND isdeleted = 0",
            new { Id = id, DistrictId = districtId });
        if (isDefault == 1)
            return BadRequest(new { message = "Default menus cannot be deleted." });

        await conn.ExecuteAsync(@"
            UPDATE club_website_menu SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        // Also soft-delete all sub-menus under this menu
        await conn.ExecuteAsync(@"
            UPDATE club_website_submenu SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
            WHERE fk_menu_id = @Id AND isdeleted = 0",
            new { Id = id, UserId = GetUserId() });
        return Ok(new { message = "Menu deleted successfully." });
    }

    // ── District Menus: Reorder ──

    [HttpPost("api/districts/{districtId}/website-data/menus/reorder")]
    public async Task<ActionResult> ReorderDistrictMenus(int districtId, [FromBody] DistrictReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Swap sort_order values between the two menus
        await conn.ExecuteAsync(@"
            UPDATE club_website_menu m1
            JOIN club_website_menu m2 ON m2.pk_club_website_menu_id = @Id2
            SET m1.sort_order = m2.sort_order, m2.sort_order = m1.sort_order
            WHERE m1.pk_club_website_menu_id = @Id1",
            new { Id1 = dto.Id1, Id2 = dto.Id2 });
        return Ok(new { message = "Menus reordered successfully." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Sub-Menus ─────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/website-data/menus/{menuId}/submenus")]
    public async Task<ActionResult> GetDistrictSubMenus(int districtId, int menuId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var subMenus = await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_website_submenu_id AS id, fk_menu_id AS menuId,
                   submenu_name AS subMenuName, link_type AS linkType,
                   CASE
                       WHEN link_value IS NULL OR link_value = '' THEN link_value
                       WHEN link_type = 'document'
                            AND link_value NOT LIKE '/%'
                            AND link_value NOT LIKE 'http%'
                            THEN CONCAT('/uploads/menu/', link_value)
                       ELSE link_value
                   END AS linkValue,
                   sort_order AS sortOrder, is_active AS isActive,
                   COALESCE(is_system_managed, 0) AS isSystemManaged
            FROM club_website_submenu WHERE fk_menu_id = @MenuId AND isdeleted = 0
            ORDER BY sort_order ASC",
            new { MenuId = menuId });
        return Ok(subMenus);
    }

    [HttpPost("api/districts/{districtId}/website-data/menus/{menuId}/submenus")]
    [OwnedBy(Owns.DistrictMenu, "menuId", "districtId")]
    public async Task<ActionResult> CreateDistrictSubMenu(int districtId, int menuId, [FromBody] DistrictSubMenuDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value, sort_order, is_active, created_by, created_date)
            VALUES (@MenuId, @SubMenuName, @LinkType, @LinkValue, @SortOrder, @IsActive, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { MenuId = menuId, SubMenuName = dto.SubMenuName, LinkType = dto.LinkType, LinkValue = dto.LinkValue, SortOrder = dto.SortOrder, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { id });
    }

    [HttpPut("api/districts/{districtId}/website-data/menus/{menuId}/submenus/{id}")]
    [OwnedBy(Owns.DistrictMenu, "menuId", "districtId")]
    [OwnedBy(Owns.SubMenuInMenu, "id", "menuId")]
    public async Task<ActionResult> UpdateDistrictSubMenu(int districtId, int menuId, int id, [FromBody] DistrictSubMenuDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // System-managed sub-menus (the 6 avenues under Club Projects + the 2 Newsletter items)
        // are editable — admins may rename them or change their link. They stay identified by
        // their stable link_value so the seeders never re-insert a duplicate. Mirrors club side.
        await conn.ExecuteAsync(@"
            UPDATE club_website_submenu SET submenu_name = @SubMenuName, link_type = @LinkType,
                link_value = @LinkValue, sort_order = @SortOrder, is_active = @IsActive,
                modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId",
            new { Id = id, MenuId = menuId, SubMenuName = dto.SubMenuName, LinkType = dto.LinkType, LinkValue = dto.LinkValue, SortOrder = dto.SortOrder, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { message = "Sub-menu updated successfully." });
    }

    [HttpDelete("api/districts/{districtId}/website-data/menus/{menuId}/submenus/{id}")]
    [OwnedBy(Owns.DistrictMenu, "menuId", "districtId")]
    [OwnedBy(Owns.SubMenuInMenu, "id", "menuId")]
    public async Task<ActionResult> DeleteDistrictSubMenu(int districtId, int menuId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // System-managed sub-menus can be deleted too — the seeders key on link_value and count
        // regardless of isdeleted, so a removed avenue/Newsletter item is not re-created. Mirrors club side.
        await conn.ExecuteAsync(@"
            UPDATE club_website_submenu SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId",
            new { Id = id, MenuId = menuId, UserId = GetUserId() });
        return Ok(new { message = "Sub-menu deleted successfully." });
    }

    [HttpPost("api/districts/{districtId}/website-data/menus/{menuId}/submenus/reorder")]
    [OwnedBy(Owns.DistrictMenu, "menuId", "districtId")]
    public async Task<ActionResult> ReorderDistrictSubMenus(int districtId, int menuId, [FromBody] DistrictReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_website_submenu s1
            JOIN club_website_submenu s2 ON s2.pk_club_website_submenu_id = @Id2
            SET s1.sort_order = s2.sort_order, s2.sort_order = s1.sort_order
            WHERE s1.pk_club_website_submenu_id = @Id1",
            new { Id1 = dto.Id1, Id2 = dto.Id2 });
        return Ok(new { message = "Sub-menus reordered successfully." });
    }

    /// <summary>Drag-and-drop full-list reorder for district menus. Body: { orderedIds: [1, 3, 2, ...] }</summary>
    [HttpPut("api/districts/{districtId}/website-data/menus/reorder-bulk")]
    public async Task<ActionResult> ReorderDistrictMenusBulk(int districtId, [FromBody] DistrictBulkReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var ids = dto.OrderedIds ?? new List<int>();
        for (int i = 0; i < ids.Count; i++)
        {
            await conn.ExecuteAsync(
                @"UPDATE club_website_menu SET sort_order = @Sort, modified_date = NOW()
                  WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND fk_club_id = 0
                    AND (isdeleted = 0 OR isdeleted IS NULL)",
                new { Sort = i + 1, Id = ids[i], DistrictId = districtId });
        }
        return Ok(new { message = "Menus reordered successfully." });
    }

    [HttpPut("api/districts/{districtId}/website-data/menus/{menuId}/submenus/reorder-bulk")]
    [OwnedBy(Owns.DistrictMenu, "menuId", "districtId")]
    public async Task<ActionResult> ReorderDistrictSubMenusBulk(int districtId, int menuId, [FromBody] DistrictBulkReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var ids = dto.OrderedIds ?? new List<int>();
        for (int i = 0; i < ids.Count; i++)
        {
            await conn.ExecuteAsync(
                @"UPDATE club_website_submenu SET sort_order = @Sort, modified_date = NOW()
                  WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId
                    AND (isdeleted = 0 OR isdeleted IS NULL)",
                new { Sort = i + 1, Id = ids[i], MenuId = menuId });
        }
        return Ok(new { message = "Sub-menus reordered successfully." });
    }

    public class DistrictBulkReorderDto
    {
        public List<int>? OrderedIds { get; set; }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Contact Details ─────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/website-data/contact-details")]
    public async Task<ActionResult> GetDistrictContactDetails(int districtId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection(); await conn.OpenAsync();
        var yId = yearId ?? await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1") ?? 0;
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_website_contact_detail_id AS id, email, phone, sort_order AS sortOrder, is_active AS isActive
            FROM club_website_contact_detail
            WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND fk_year_id = @YearId AND isdeleted = 0
            ORDER BY sort_order ASC",
            new { DistrictId = districtId, YearId = yId });
        return Ok(items);
    }

    [HttpPost("api/districts/{districtId}/website-data/contact-details")]
    public async Task<ActionResult> CreateDistrictContactDetail(int districtId, [FromBody] DistrictContactDetailDto dto)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        var yearId = dto.YearId > 0 ? dto.YearId : await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1") ?? 1;
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_contact_detail (fk_club_id, fk_district_id, fk_year_id, email, phone, sort_order, is_active, created_by, created_date)
            VALUES (0, @DistrictId, @YearId, @Email, @Phone, @SortOrder, @IsActive, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { DistrictId = districtId, YearId = yearId, dto.Email, dto.Phone, dto.SortOrder, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { id, message = "Contact detail added." });
    }

    [HttpPut("api/districts/{districtId}/website-data/contact-details/{id}")]
    public async Task<ActionResult> UpdateDistrictContactDetail(int districtId, int id, [FromBody] DistrictContactDetailDto dto)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_website_contact_detail SET email = @Email, phone = @Phone, sort_order = @SortOrder, is_active = @IsActive,
                modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_contact_detail_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, dto.Email, dto.Phone, dto.SortOrder, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { message = "Contact detail updated." });
    }

    [HttpDelete("api/districts/{districtId}/website-data/contact-details/{id}")]
    public async Task<ActionResult> DeleteDistrictContactDetail(int districtId, int id)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        await conn.ExecuteAsync("UPDATE club_website_contact_detail SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE pk_club_website_contact_detail_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        return Ok(new { message = "Deleted." });
    }

    [HttpGet("api/districts/{districtId}/website-data/contact-details/available-years")]
    public async Task<ActionResult> GetDistrictContactDetailAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection(); await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
            FROM club_website_contact_detail cd INNER JOIN rotary_year_master ry ON ry.pk_year_id = cd.fk_year_id
            WHERE cd.fk_district_id = @DistrictId AND cd.fk_club_id = 0 AND cd.isdeleted = 0
            ORDER BY ry.YearLabel DESC", new { DistrictId = districtId });
        return Ok(years);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: About ─────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    // About is NOT year-wise — one About per district, persisting across years.
    [HttpGet("api/districts/{districtId}/website-data/about")]
    public async Task<ActionResult> GetDistrictAbout(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_website_about_id AS id, content, is_active AS isActive
            FROM club_website_about
            WHERE fk_district_id = @DistrictId AND fk_club_id = 0
              AND (isdeleted = 0 OR isdeleted IS NULL)
            ORDER BY modified_date DESC, created_date DESC, pk_club_website_about_id DESC
            LIMIT 1",
            new { DistrictId = districtId });
        return Ok(items);
    }

    [HttpPost("api/districts/{districtId}/website-data/about")]
    public async Task<ActionResult> CreateDistrictAbout(int districtId, [FromBody] DistrictAboutDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_about (fk_club_id, fk_district_id, content, is_active, created_by, created_date)
            VALUES (0, @DistrictId, @Content, @IsActive, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new { DistrictId = districtId, Content = dto.Content, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { id, message = "About content created." });
    }

    [HttpPut("api/districts/{districtId}/website-data/about/{id}")]
    public async Task<ActionResult> UpdateDistrictAbout(int districtId, int id, [FromBody] DistrictAboutDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_website_about SET content = @Content, is_active = @IsActive,
                modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_about_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, Content = dto.Content, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        return Ok(new { message = "About content updated." });
    }

    [HttpDelete("api/districts/{districtId}/website-data/about/{id}")]
    public async Task<ActionResult> DeleteDistrictAbout(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync("UPDATE club_website_about SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE pk_club_website_about_id = @Id AND fk_district_id = @DistrictId",
            new { Id = id, DistrictId = districtId, UserId = GetUserId() });
        return Ok(new { message = "Deleted." });
    }

    [HttpPost("api/districts/{districtId}/website-data/about/upload-image")]
    public async Task<ActionResult> UploadDistrictAboutImage(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "about");
        Directory.CreateDirectory(uploadsPath);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // Return filename only. Caller / frontend is responsible for embedding with /uploads/about/ prefix.
        return Ok(new { path = fileName });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Website Data: Menu Document Upload ──────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpPost("api/districts/{districtId}/website-data/menus/upload")]
    public async Task<ActionResult> UploadDistrictMenuDocument(int districtId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "menu");
        Directory.CreateDirectory(uploadsPath);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // Return filename only. SELECTs that read link_value with link_type='document'
        // reconstruct the full URL via SQL CONCAT('/uploads/menu/', ...).
        return Ok(new { path = fileName });
    }

    // Auto-creates the Rotary year row if missing — see Services/RotaryYearHelper.
    private static async Task<int> GetRotaryYearIdAsync(MySqlConnection conn, string? dateStr)
    {
        if (!string.IsNullOrEmpty(dateStr) && DateTime.TryParse(dateStr, out var date))
            return await Services.RotaryYearHelper.EnsureRotaryYearAsync(conn, date);
        return await Services.RotaryYearHelper.EnsureRotaryYearAsync(conn, (DateTime?)null);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Clubs View: Member Detail + Club Projects ─────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/clubs/{clubId}/member-detail/{memberId}")]
    [OwnedBy(Owns.ClubInDistrict, "clubId", "districtId")]
    [OwnedBy(Owns.MemberInClub, "memberId", "clubId")]
    public async Task<ActionResult> GetClubMemberDetail(int districtId, int clubId, int memberId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhotoPath,
                   m.PrimaryMobileNumber AS primaryMobileNumber,
                   m.EmailId AS emailId, m.RotaryId AS rotaryId, m.BloodGroup AS bloodGroup,
                   m.Gender AS gender, m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
                   m.MemberIntroduction AS memberIntroduction,
                   m.Facebook AS facebook, m.Instagram AS instagram, m.LinkedIn AS linkedIn,
                   a.BusinessName AS businessName, a.BusinessEmailId AS businessEmailId,
                   cmd.Designation AS designation, cmd.ClassificationProfession AS classificationProfession,
                   a.Address AS businessAddress, a.City AS businessCity, a.State AS businessState,
                   a.PinCode AS businessPinCode, a.PhoneNumber AS businessPhone
            FROM member_master_profile m
            LEFT JOIN member_address_details a ON a.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND a.AddressType = 'Business' AND a.isdeleted = 0
            LEFT JOIN (
                SELECT fk_member_master_profile_id,
                       MAX(Designation) AS Designation,
                       MAX(ClassificationProfession) AS ClassificationProfession
                FROM club_members
                WHERE COALESCE(isdeleted, 0) = 0
                GROUP BY fk_member_master_profile_id
            ) cmd ON cmd.fk_member_master_profile_id = m.pk_member_master_profile_id
            WHERE m.pk_member_master_profile_id = @MemberId AND m.isdeleted = 0
            LIMIT 1",
            new { MemberId = memberId });
        if (member == null) return NotFound(new { message = "Member not found" });
        return Ok(member);
    }

    [HttpGet("api/districts/{districtId}/clubs/{clubId}/projects-view")]
    public async Task<ActionResult> GetClubProjectsView(int districtId, int clubId, [FromQuery] int? yearId, [FromQuery] string? moduleKey)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: when yearId provided, hit that year's table. When not, UNION ALL across all.
        var tables = yearId.HasValue
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(Array.Empty<object>());

        var unionLegs = string.Join(" UNION ALL ", tables.Select(t => {
            var suffix = t.YearLabel.Replace("-", "_");
            return $@"
                SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, p.title, p.description, p.location,
                       p.project_date AS projectDate,
                       p.project_cost AS projectCost, COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') AS currency, p.direct_beneficiaries AS directBeneficiaries,
                       p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                       p.fk_module_id AS moduleId, mm.ModuleName AS moduleName, mm.ModuleKey AS moduleKey,
                       p.fk_area_of_focus_id AS areaOfFocusId, af.name AS areaOfFocusName,
                       p.other_area_of_focus AS otherAreaOfFocus,
                       (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                     ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                '/', rpp.image_path)
                        FROM `{t.PhotosTable}` rpp
                        WHERE rpp.fk_project_id = p.pk_project_id
                        ORDER BY rpp.is_primary DESC, rpp.sort_order LIMIT 1) AS primaryPhoto
                FROM `{t.ProjectsTable}` p
                LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                WHERE p.fk_club_id = @ClubId AND p.is_active = 1 AND p.isdeleted = 0
                  -- Club Service stays OUT of the avenue lists ('all' and every other module), the same
                  -- rule the project counts use. Asking for it BY NAME is the one exception, so the
                  -- mobile Club Service tab gets its rows instead of an empty list (user 2026-09-29).
                  AND (@ModuleKey = 'club_service' OR mm.ModuleKey IS NULL OR mm.ModuleKey != 'club_service')
                  AND (@ModuleKey IS NULL OR @ModuleKey = 'all' OR mm.ModuleKey = @ModuleKey)";
        }));
        var sql = $"SELECT * FROM ({unionLegs}) u ORDER BY u.projectDate DESC";
        var projects = await conn.QueryAsync<dynamic>(sql, new { ClubId = clubId, ModuleKey = moduleKey });
        return Ok(projects);
    }

    [HttpGet("api/districts/{districtId}/clubs/{clubId}/projects-view/available-years")]
    public async Task<ActionResult> GetClubProjectsAvailableYears(int districtId, int clubId, [FromQuery] string? moduleKey)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"(SELECT {t.YearId} AS id, '{t.YearLabel}' AS yearLabel,
                       (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS isCurrent
                FROM `{t.ProjectsTable}` p
                LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                WHERE p.fk_club_id = @ClubId AND p.is_active = 1 AND p.isdeleted = 0
                  -- Mirrors the list above: Club Service only when it is asked for by name.
                  AND (@ModuleKey = 'club_service' OR mm.ModuleKey IS NULL OR mm.ModuleKey != 'club_service')
                  AND (@ModuleKey IS NULL OR @ModuleKey = 'all' OR mm.ModuleKey = @ModuleKey)
                LIMIT 1)"));
        var years = await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({unionLegs}) u ORDER BY u.yearLabel DESC",
            new { ClubId = clubId, ModuleKey = moduleKey });
        return Ok(years);
    }

    [HttpGet("api/districts/{districtId}/clubs/{clubId}/info")]
    public async Task<ActionResult> GetClubInfoForDistrict(int districtId, int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.pk_club_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogoPath,
                   c.ClubWebsite AS clubWebsite,
                   c.MeetingDay AS meetingDay, c.MeetingFromTime AS meetingFromTime,
                   c.MeetingToTime AS meetingToTime, c.MeetingAddress AS meetingAddress,
                   c.ClubCharterDate AS clubCharterDate, c.City AS city, c.State AS state,
                   c.Country AS country, c.Pincode AS pincode, c.IsActive AS isActive,
                   c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName,
                   (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0 AND cm.IsActive = 1 AND cm.TerminationDate IS NULL AND m.isdeleted = 0) AS totalMembers
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0",
            new { ClubId = clubId });
        if (club == null) return NotFound(new { message = "Club not found" });
        return Ok(club);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Club Monthly Report ───────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/club-monthly-report/years")]
    public async Task<ActionResult> GetDistrictReportYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM club_monthly_reports r
            INNER JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
            INNER JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
            WHERE r.isdeleted = 0
            UNION
            SELECT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM rotary_year_master y WHERE y.IsCurrent = 1
            ORDER BY id DESC",
            new { DistrictId = districtId });
        return Ok(years);
    }

    [HttpGet("api/districts/{districtId}/club-monthly-report/months/{yearId}")]
    public async Task<ActionResult> GetDistrictReportMonths(int districtId, int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate, EndDate, IsCurrent FROM rotary_year_master WHERE pk_year_id = @YearId",
            new { YearId = yearId });
        if (year == null) return Ok(Array.Empty<object>());

        DateTime startDate = year.StartDate;
        DateTime endDate = year.EndDate;
        bool isCurrent = Convert.ToBoolean(year.IsCurrent);

        var totalClubs = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1{NotRotaractUnlessSa("")}",
            new { DistrictId = districtId });

        var submissions = (await conn.QueryAsync<dynamic>($@"
            SELECT r.ReportMonth AS month, COUNT(DISTINCT r.fk_club_id) AS submittedCount
            FROM club_monthly_reports r
            INNER JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1{NotRotaractUnlessSa()}
            WHERE r.fk_year_id = @YearId AND r.isdeleted = 0
              AND r.IsUploadedToDistrict = 1   -- submitted = actually uploaded to district (matches month-detail + Submitted Date)
            GROUP BY r.ReportMonth",
            new { DistrictId = districtId, YearId = yearId })).ToDictionary(x => (int)x.month, x => (int)x.submittedCount);

        var result = new List<object>();
        var current = new DateTime(startDate.Year, startDate.Month, 1);
        var end = isCurrent
            ? new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1)
            : new DateTime(endDate.Year, endDate.Month, 1);

        while (current <= end)
        {
            int m = current.Month;
            int submitted = submissions.ContainsKey(m) ? submissions[m] : 0;
            result.Add(new {
                month = m,
                monthName = current.ToString("MMMM yyyy"),
                submittedCount = submitted,
                notSubmittedCount = totalClubs - submitted,
                totalClubs
            });
            current = current.AddMonths(1);
        }
        return Ok(result);
    }

    [HttpGet("api/districts/{districtId}/club-monthly-report/month-detail/{yearId}/{month}")]
    public async Task<ActionResult> GetDistrictReportMonthDetail(int districtId, int yearId, int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var submitted = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   r.pk_report_id AS reportId, r.IsUploadedToDistrict AS isUploadedToDistrict,
                   -- Submitted = when the club uploaded to district (set on upload), NOT the row
                   -- creation time. Fall back to created_date for legacy pre-column rows.
                   COALESCE(r.uploaded_to_district_date, r.created_date) AS submittedDate,
                   (SELECT m2.MemberName FROM district_ag a
                      JOIN member_master_profile m2 ON m2.pk_member_master_profile_id = a.fk_member_id AND m2.isdeleted = 0
                     WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1
                     LIMIT 1) AS agName,
                   (SELECT a.fk_member_id FROM district_ag a
                     WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1
                     LIMIT 1) AS agMemberId
            FROM club_monthly_reports r
            INNER JOIN club_master c ON c.pk_club_id = r.fk_club_id
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
              AND r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0
              AND r.IsUploadedToDistrict = 1   -- submitted = actually uploaded to district
            ORDER BY c.ClubName",
            new { DistrictId = districtId, YearId = yearId, Month = month });

        // Not submitted clubs — no report row OR a report that isn't uploaded to district (IsUploadedToDistrict NULL/0)
        var notSubmittedClubs = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   (SELECT m2.MemberName FROM district_ag a
                      JOIN member_master_profile m2 ON m2.pk_member_master_profile_id = a.fk_member_id AND m2.isdeleted = 0
                     WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1
                     LIMIT 1) AS agName,
                   (SELECT a.fk_member_id FROM district_ag a
                     WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1
                     LIMIT 1) AS agMemberId
            FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1{NotRotaractUnlessSa()}
              AND c.pk_club_id NOT IN (
                SELECT r.fk_club_id FROM club_monthly_reports r
                WHERE r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0
                  AND r.IsUploadedToDistrict = 1   -- only clubs that actually uploaded count as submitted
              )
            ORDER BY c.ClubName",
            new { DistrictId = districtId, YearId = yearId, Month = month })).ToList();

        // Get President & Secretary for not-submitted clubs (from the selected report year)
        var clubIds = notSubmittedClubs.Select(x => (int)x.clubId).ToList();
        var bodMembers = clubIds.Count > 0 ? (await conn.QueryAsync<dynamic>(@"
            SELECT bd.fk_club_id AS clubId, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   dm.designation_name AS designation
            FROM board_of_directors bd
            INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id AND m.isdeleted = 0
            INNER JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
            WHERE bd.fk_club_id IN @ClubIds AND bd.fk_year_id = @YearId AND bd.isdeleted = 0
              AND dm.designation_name IN ('Club President', 'Club Secretary')",
            new { ClubIds = clubIds, YearId = yearId })).ToList() : new List<dynamic>();

        // Get last reminder log per club
        var reminderLogs = clubIds.Count > 0 ? (await conn.QueryAsync<dynamic>(@"
            SELECT l1.fk_club_id AS clubId, l1.email_status AS emailStatus, l1.sent_date AS sentDate
            FROM district_report_reminder_log l1
            INNER JOIN (
                SELECT fk_club_id, MAX(id) AS maxId
                FROM district_report_reminder_log
                WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND report_month = @Month
                GROUP BY fk_club_id
            ) l2 ON l1.id = l2.maxId",
            new { DistrictId = districtId, YearId = yearId, Month = month })).ToList() : new List<dynamic>();

        // Combine data
        var notSubmitted = notSubmittedClubs.Select(c => {
            int cid = (int)c.clubId;
            var pres = bodMembers.FirstOrDefault(b => (int)b.clubId == cid && (string)b.designation == "Club President");
            var sec = bodMembers.FirstOrDefault(b => (int)b.clubId == cid && (string)b.designation == "Club Secretary");
            var log = reminderLogs.FirstOrDefault(l => (int)l.clubId == cid);
            return new {
                clubId = cid,
                clubName = (string)c.clubName,
                clubRotaryId = (string?)c.clubRotaryId,
                agName = (string?)c.agName,
                agMemberId = c.agMemberId == null ? (int?)null : (int?)Convert.ToInt32(c.agMemberId),
                presidentName = pres != null ? (string?)pres.memberName : null,
                presidentMobile = pres != null ? (string?)pres.mobile : null,
                presidentEmail = pres != null ? (string?)pres.email : null,
                secretaryName = sec != null ? (string?)sec.memberName : null,
                secretaryMobile = sec != null ? (string?)sec.mobile : null,
                secretaryEmail = sec != null ? (string?)sec.email : null,
                lastEmailStatus = log != null ? (string?)log.emailStatus : null,
                lastReminderDate = log != null ? (DateTime?)log.sentDate : null
            };
        }).ToList();

        return Ok(new { submitted, notSubmitted });
    }

    public class SendReportReminderDto
    {
        public bool SendEmail { get; set; }
        // When set, only clubs allocated to this AG (district_ag.fk_member_id) are targeted.
        public int? AgMemberId { get; set; }
    }

    [HttpPost("api/districts/{districtId}/club-monthly-report/send-reminder/{yearId}/{month}")]
    public async Task<ActionResult> SendReportReminder(int districtId, int yearId, int month, [FromBody] SendReportReminderDto dto)
    {
        if (!dto.SendEmail)
            return BadRequest(new { message = "Select email to send reminders." });

        // Check DISTRICT credit balance before sending (not club).
        var creditSvc = HttpContext.RequestServices.GetRequiredService<ICreditManagementService>();
        var bal = await creditSvc.GetDistrictCreditBalanceAsync(districtId);
        if (dto.SendEmail && bal.EmailRemaining <= 0)
            return BadRequest(new { message = "No email credits available." });

        var userId = GetUserId();
        var connStr = _connectionString;
        var emailSvc = _emailService;
        var creditSvc2 = HttpContext.RequestServices.GetRequiredService<ICreditManagementService>();

        _ = Task.Run(async () =>
        {
            try
            {
                using var conn = new MySqlConnection(connStr);
                await conn.OpenAsync();

                var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
                    "SELECT StartDate, YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId", new { YearId = yearId });
                if (year == null) return;
                var monthDate = new DateTime(month >= 7 ? ((DateTime)year.StartDate).Year : ((DateTime)year.StartDate).Year + 1, month, 1);
                var monthNameWithYear = monthDate.ToString("MMMM yyyy");

                var districtNumber = await conn.ExecuteScalarAsync<string>(
                    "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";

                // user 2026-10-08: Rotaract clubs never get the monthly-report reminder.
                var notSubmittedClubIds = (await conn.QueryAsync<int>(@"
                    SELECT c.pk_club_id
                    FROM club_master c
                    WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
                      AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
                      AND c.pk_club_id NOT IN (
                        SELECT r.fk_club_id FROM club_monthly_reports r
                        WHERE r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0
                      )
                      -- When an AG is chosen, restrict to that AG's allocated clubs.
                      AND (@AgMemberId IS NULL OR c.pk_club_id IN (
                        SELECT a.fk_club_id FROM district_ag a
                        WHERE a.fk_member_id = @AgMemberId AND a.fk_year_id = @YearId
                          AND a.isdeleted = 0 AND a.is_active = 1
                      ))",
                    new { DistrictId = districtId, YearId = yearId, Month = month, AgMemberId = dto.AgMemberId })).ToList();

                if (notSubmittedClubIds.Count == 0) return;

                var recipients = (await conn.QueryAsync<dynamic>(@"
                    SELECT bd.fk_club_id AS clubId, c.ClubName AS clubName,
                           m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                           m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                           dm.designation_name AS designation
                    FROM board_of_directors bd
                    INNER JOIN club_master c ON c.pk_club_id = bd.fk_club_id
                    INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id AND m.isdeleted = 0
                    INNER JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
                    WHERE bd.fk_club_id IN @ClubIds
                      AND bd.fk_year_id = @YearId
                      AND bd.isdeleted = 0
                      AND dm.designation_name IN ('Club President', 'Club Secretary')
                    ORDER BY c.ClubName, dm.sort_order",
                    new { ClubIds = notSubmittedClubIds, YearId = yearId })).ToList();

                var emailService = emailSvc;
                var creditService = creditSvc2;
                int emailSent = 0;

                foreach (var r in recipients)
                {
                    string emailStatus = "not_sent";

                    if (dto.SendEmail && !string.IsNullOrEmpty((string?)r.email))
                    {
                        try
                        {
                            var subject = $"Reminder: Club Monthly Report not submitted - {monthNameWithYear}";
                            // Aligned to the district-governor reminder template: month/year specific,
                            // "not submitted", submit via the app, contact AG, ignore-if-submitted.
                            var body = $@"
                                <div style='font-family:Figtree, Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#1B2C42;'>
                                    <div style='padding:24px;border:1px solid #B7C3D2;'>
                                        <p style='font-size:16px;font-style:italic;line-height:28px;'><b>Dear Club leader</b></p>
                                        <p style='font-size:14px;font-style:italic;line-height:24px;'>The monthly report of your club for the month of <b>{monthNameWithYear}</b> has not been submitted. Please log in using your username and password and click on the <b>Club Monthly Report</b> icon to submit the report.</p>
                                        <p style='font-size:14px;font-style:italic;line-height:22px;'><b>District : {districtNumber}</b><br/><b>Club : {(string)r.clubName}</b></p>
                                        <p style='font-size:14px;font-style:italic;line-height:22px;'>If you are unable to get support, please contact your Asst. Governor.</p>
                                        <p style='font-size:14px;font-style:italic;line-height:22px;'>Please note that the Club Monthly Report should be submitted only through the ROW App, not by email or any physical format.</p>
                                        <p style='font-size:13px;font-style:italic;line-height:22px;color:#64748B;'>(Please ignore this email if the report is already submitted.)</p>
                                        <p style='font-size:14px;font-style:italic;line-height:22px;'>Regards,<br/><strong>District Governor</strong></p>
                                    </div>
                                </div>";
                            await emailService.SendGenericEmailAsync((string)r.email, subject, body);
                            emailStatus = "sent";
                            emailSent++;
                        }
                        catch { emailStatus = "failed"; }
                    }


                    // Log reminder status
                    await conn.ExecuteAsync(@"
                        INSERT INTO district_report_reminder_log (fk_district_id, fk_year_id, report_month, fk_club_id, fk_member_id, member_name, designation, email_status, sent_by)
                        VALUES (@DistrictId, @YearId, @Month, @ClubId, @MemberId, @MemberName, @Designation, @EmailStatus, @UserId)",
                        new { DistrictId = districtId, YearId = yearId, Month = month, ClubId = (int)r.clubId,
                              MemberId = (int)r.memberId, MemberName = (string)r.memberName, Designation = (string)r.designation,
                              EmailStatus = emailStatus, UserId = userId });
                }

                // Deduct from the DISTRICT wallet (fk_club_id = 0, fk_district_id = districtId).
                if (emailSent > 0)
                    await creditService.DeductDistrictWithHistoryAsync(districtId, "Email", emailSent, "MonthlyReportReminder", yearId, $"Monthly report reminder for {monthNameWithYear}", userId);
            }
            catch (Exception ex) { Console.WriteLine($"Reminder error: {ex.Message}"); }
        });

        return Ok(new { message = "Reminders are being sent in background. Refresh to check status." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── AG (Assistant Governor) ────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/ag")]
    public async Task<ActionResult> GetAGs(int districtId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Year filter: when yearId is supplied, scope to that year only. Without it,
        // return everything (used by reports/export). Frontend always passes the
        // currently-selected year from its dropdown.
        var result = await conn.QueryAsync<dynamic>(@"
            SELECT a.id, a.fk_district_id AS districtId, a.fk_member_id AS memberId,
                   a.fk_club_id AS clubId, a.fk_year_id AS yearId, a.is_active AS isActive,
                   m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   y.YearLabel AS yearLabel
            FROM district_ag a
            INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
            INNER JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
            LEFT JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
            WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0
              AND (@YearId IS NULL OR a.fk_year_id = @YearId)
            ORDER BY m.MemberName, c.ClubName",
            new { DistrictId = districtId, YearId = yearId });
        return Ok(result);
    }

    // Lists rotary years that have at least one AG record for this district.
    // Frontend uses this to populate the year selector — only years with data are shown.
    [HttpGet("api/districts/{districtId}/ag/years-with-data")]
    public async Task<ActionResult> GetAGYearsWithData(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM district_ag a
            INNER JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
            WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0
            ORDER BY y.IsCurrent DESC, y.pk_year_id DESC",
            new { DistrictId = districtId });
        return Ok(years);
    }

    [HttpGet("api/districts/{districtId}/ag/available-clubs")]
    public async Task<ActionResult> GetAvailableClubsForAG(int districtId, [FromQuery] int? excludeMemberId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // "Already-assigned" check is now year-scoped: a club assigned to an AG in
        // 2024-25 is still available for assignment in 2025-26.
        var clubs = await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
            FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1{NotRotaractUnlessSa()}
              AND c.pk_club_id NOT IN (
                SELECT fk_club_id FROM district_ag
                WHERE fk_district_id = @DistrictId AND isdeleted = 0
                  AND (@YearId IS NULL OR fk_year_id = @YearId)
                  AND (@ExcludeMemberId IS NULL OR fk_member_id != @ExcludeMemberId)
              )
            ORDER BY c.ClubName",
            new { DistrictId = districtId, ExcludeMemberId = excludeMemberId, YearId = yearId });
        return Ok(clubs);
    }

    [HttpGet("api/districts/{districtId}/ag/search-members")]
    public async Task<ActionResult> SearchMembersForAG(int districtId, [FromQuery] string? search, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (string.IsNullOrWhiteSpace(search) || search.Length < 2)
            return Ok(Array.Empty<object>());
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Return every DISTRICT member matching the search — but instead of silently
        // hiding the ineligible ones, surface WHY they can't be assigned (ineligibleReason,
        // null = eligible). Eligible members sort first. The frontend greys out and
        // disables the ineligible rows so admins can see the reason at a glance.
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS name, m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   dm.clubId, dm.clubName,
                   CASE
                       WHEN EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = m.pk_member_master_profile_id
                                      AND r.fk_role_id = 3 AND r.IsActive = 1 AND r.isdeleted = 0)
                            THEN 'Is a SuperAdmin — cannot be assigned as AG'
                       WHEN EXISTS (SELECT 1 FROM district_ag da WHERE da.fk_district_id = @DistrictId
                                      AND da.fk_member_id = m.pk_member_master_profile_id AND da.isdeleted = 0
                                      AND (@YearId IS NULL OR da.fk_year_id = @YearId))
                            THEN 'Already assigned as AG for this year'
                       WHEN dm.activeCount = 0
                            THEN 'No active club membership in this district (membership ended)'
                       ELSE NULL
                   END AS ineligibleReason
            FROM (
                -- District members matching the search (bounded to the district first → fast).
                SELECT cm.fk_member_master_profile_id AS mid,
                       MAX(CASE WHEN cm.IsActive = 1 THEN 1 ELSE 0 END) AS activeCount,
                       SUBSTRING_INDEX(GROUP_CONCAT(cm.fk_club_id ORDER BY cm.IsActive DESC, cm.pk_club_member_id DESC), ',', 1) AS clubId,
                       SUBSTRING_INDEX(GROUP_CONCAT(c.ClubName ORDER BY cm.IsActive DESC, cm.pk_club_member_id DESC SEPARATOR '||'), '||', 1) AS clubName
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @DistrictId
                WHERE cm.isdeleted = 0
                GROUP BY cm.fk_member_master_profile_id
            ) dm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = dm.mid AND m.isdeleted = 0
            WHERE (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
            ORDER BY (ineligibleReason IS NULL) DESC, m.MemberName
            LIMIT 30",
            new { DistrictId = districtId, Search = $"%{search}%", YearId = yearId });
        return Ok(members);
    }

    public class AGDto
    {
        public int MemberId { get; set; }
        public int? OldMemberId { get; set; }
        public List<int> ClubIds { get; set; } = new();
        // Required — AG assignments are year-scoped. Same club can have a different AG
        // each rotary year, and the same member can be AG of different clubs across years.
        public int YearId { get; set; }
    }

    [HttpPost("api/districts/{districtId}/ag")]
    public async Task<ActionResult> SaveAG(int districtId, [FromBody] AGDto dto)
    {
        if (dto.ClubIds.Count == 0)
            return BadRequest(new { message = "Select at least one club." });
        if (dto.YearId <= 0)
            return BadRequest(new { message = "Year is required." });

        // Mutual exclusion: AG (role 6) cannot coexist with SA
        try { await _roleService.CheckRoleConflictPublicAsync(dto.MemberId, 6); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        bool memberChanged = dto.OldMemberId.HasValue && dto.OldMemberId.Value != dto.MemberId;
        var districtNumber = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";

        // Prevent duplicate AG assignment in the same (district, year). SearchMembersForAG
        // already excludes them from the picker; enforce at API too for direct callers.
        if (!dto.OldMemberId.HasValue)
        {
            var alreadyAg = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_year_id = @YearId AND isdeleted = 0",
                new { DistrictId = districtId, MemberId = dto.MemberId, YearId = dto.YearId });
            if (alreadyAg > 0)
                return BadRequest(new { message = "This member is already an AG for the selected year. Edit their existing assignment instead." });
        }

        // Conflict check — scoped to selected year. Conflict in 2024-25 doesn't block 2025-26.
        var excludeMembers = new List<int> { dto.MemberId };
        if (dto.OldMemberId.HasValue) excludeMembers.Add(dto.OldMemberId.Value);
        var conflicts = (await conn.QueryAsync<dynamic>(@"
            SELECT c.ClubName AS clubName, m.MemberName AS memberName
            FROM district_ag a
            INNER JOIN club_master c ON c.pk_club_id = a.fk_club_id
            INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id
            WHERE a.fk_district_id = @DistrictId AND a.fk_club_id IN @ClubIds
              AND a.fk_year_id = @YearId
              AND a.fk_member_id NOT IN @ExcludeMembers AND a.isdeleted = 0",
            new { DistrictId = districtId, ClubIds = dto.ClubIds, YearId = dto.YearId, ExcludeMembers = excludeMembers })).ToList();
        if (conflicts.Count > 0)
        {
            var msg = string.Join(", ", conflicts.Select(c => $"{(string)c.clubName} (assigned to {(string)c.memberName})"));
            return BadRequest(new { message = $"These clubs already have an AG: {msg}" });
        }

        // ── If member changed ── (year-scoped — only touches this year's assignments)
        if (memberChanged)
        {
            var oldMemberId = dto.OldMemberId!.Value;
            await conn.ExecuteAsync("UPDATE district_ag SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_year_id = @YearId AND isdeleted = 0",
                new { DistrictId = districtId, MemberId = oldMemberId, YearId = dto.YearId, UserId = userId });
            // Revoke AG role only if old member has no other active district_ag rows in this district
            // (across all years). member_roles is the role flag — not year-wise. If they remain AG
            // in another year, they keep mobile login + dashboard access for that year's data.
            var oldRemaining = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND isdeleted = 0",
                new { DistrictId = districtId, MemberId = oldMemberId });
            if (oldRemaining == 0)
            {
                await conn.ExecuteAsync("UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @UserId WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
                    new { MemberId = oldMemberId, DistrictId = districtId, UserId = userId });
            }

            // Send removal email to old member
            var oldMember = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MemberName AS memberName, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", new { Id = oldMemberId });
            if (oldMember != null && !string.IsNullOrEmpty((string?)oldMember.email))
            {
                var removeBody = $@"<div style='font-family:Figtree, Arial,sans-serif;max-width:600px;margin:0 auto;'>
                    <div style='background:#dc2626;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;'><h2 style='margin:0;'>Assistant Governor Role Removed</h2></div>
                    <div style='padding:24px;border:1px solid #D5DEE8;border-top:none;border-radius:0 0 8px 8px;'>
                        <p>Dear <strong>{(string)oldMember.memberName}</strong>,</p>
                        <p>Your <strong>Assistant Governor (AG)</strong> role for District <strong>{districtNumber}</strong> has been removed.</p>
                        <p>If you have any questions, please contact your district administrator.</p>
                        <p style='color:#64748B;font-size:12px;margin-top:24px;'>This is an automated notification from ROW.</p>
                    </div></div>";
                try { await _emailService.SendGenericEmailAsync((string)oldMember.email, "ROW - AG Role Removed", removeBody); } catch { }
            }

            foreach (var clubId in dto.ClubIds)
            {
                // Reactivate this year's soft-deleted row for this club, if any.
                var reactivated = await conn.ExecuteAsync("UPDATE district_ag SET fk_member_id = @MemberId, isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 1",
                    new { DistrictId = districtId, MemberId = dto.MemberId, ClubId = clubId, YearId = dto.YearId, UserId = userId });
                if (reactivated == 0)
                    await conn.ExecuteAsync("INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, created_by) VALUES (@DistrictId, @MemberId, @ClubId, @YearId, @UserId)",
                        new { DistrictId = districtId, MemberId = dto.MemberId, ClubId = clubId, YearId = dto.YearId, UserId = userId });
            }
        }
        else
        {
            // ── Same member, update clubs (scoped to selected year) ──
            var currentClubIds = (await conn.QueryAsync<int>("SELECT fk_club_id FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_year_id = @YearId AND isdeleted = 0",
                new { DistrictId = districtId, MemberId = dto.MemberId, YearId = dto.YearId })).ToList();
            var toAdd = dto.ClubIds.Except(currentClubIds).ToList();
            var toRemove = currentClubIds.Except(dto.ClubIds).ToList();

            if (toRemove.Count > 0)
            {
                await conn.ExecuteAsync("UPDATE district_ag SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_club_id IN @ClubIds AND fk_year_id = @YearId AND isdeleted = 0",
                    new { DistrictId = districtId, MemberId = dto.MemberId, ClubIds = toRemove, YearId = dto.YearId, UserId = userId });

                // Notify AG: they remain AG, but these specific clubs are no longer under their coverage.
                var removedClubNames = (await conn.QueryAsync<string>("SELECT ClubName FROM club_master WHERE pk_club_id IN @ClubIds ORDER BY ClubName", new { ClubIds = toRemove })).ToList();
                var agMember = await conn.QueryFirstOrDefaultAsync<dynamic>("SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", new { Id = dto.MemberId });
                if (agMember != null && !string.IsNullOrWhiteSpace((string?)agMember.EmailId))
                {
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _emailService.SendRoleOrMembershipRemovedEmailAsync(
                                (string)agMember.EmailId,
                                (string)agMember.MemberName,
                                $"AG coverage of {removedClubNames.Count} club(s)",
                                $"Removed clubs: {string.Join(", ", removedClubNames)} (District {districtNumber}). You remain AG for the other clubs assigned to you.",
                                null);
                        }
                        catch { /* fire-and-forget */ }
                    });
                }
            }

            foreach (var clubId in toAdd)
            {
                // Reactivate same member's soft-deleted row for this club + year.
                var reactivated = await conn.ExecuteAsync("UPDATE district_ag SET isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 1",
                    new { DistrictId = districtId, MemberId = dto.MemberId, ClubId = clubId, YearId = dto.YearId, UserId = userId });
                if (reactivated == 0)
                {
                    // Another member previously held this club in this year (soft-deleted) — reuse the row.
                    var otherDeleted = await conn.ExecuteAsync("UPDATE district_ag SET fk_member_id = @MemberId, isdeleted = 0, is_active = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 1",
                        new { DistrictId = districtId, MemberId = dto.MemberId, ClubId = clubId, YearId = dto.YearId, UserId = userId });
                    if (otherDeleted == 0)
                        await conn.ExecuteAsync("INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, created_by) VALUES (@DistrictId, @MemberId, @ClubId, @YearId, @UserId)",
                            new { DistrictId = districtId, MemberId = dto.MemberId, ClubId = clubId, YearId = dto.YearId, UserId = userId });
                }
            }
        }

        // ── Ensure AG role ── (per (member, district) — NOT year-scoped).
        // member_roles is just the role flag. Year-specific data (which clubs in which
        // year) lives in district_ag. So a member who is AG in any year of this district
        // gets exactly one member_roles row.
        var hasRole = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0", new { MemberId = dto.MemberId, DistrictId = districtId });
        if (hasRole == 0)
        {
            var reactivatedRole = await conn.ExecuteAsync("UPDATE member_roles SET IsActive = 1, RevokedDate = NULL, RevokedBy = NULL WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND isdeleted = 0", new { MemberId = dto.MemberId, DistrictId = districtId });
            if (reactivatedRole == 0)
                await conn.ExecuteAsync("INSERT IGNORE INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, IsActive, created_by, created_date) VALUES (@MemberId, 6, @DistrictId, 1, @UserId, NOW())", new { MemberId = dto.MemberId, DistrictId = districtId, UserId = userId });
        }

        // ── Credentials + Email ──
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>("SELECT MemberName AS memberName, EmailId AS email, PrimaryMobileNumber AS mobile FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", new { Id = dto.MemberId });
        var clubNames = (await conn.QueryAsync<string>("SELECT ClubName FROM club_master WHERE pk_club_id IN @ClubIds ORDER BY ClubName", new { ClubIds = dto.ClubIds })).ToList();

        string? tempPassword = null;
        var credExists = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0", new { Id = dto.MemberId });
        if (credExists == 0)
        {
            tempPassword = "AG@" + Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(5));
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            var updated = await conn.ExecuteAsync("UPDATE member_credentials SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1 WHERE fk_member_master_profile_id = @Id", new { Id = dto.MemberId, Hash = hash });
            if (updated == 0)
                await conn.ExecuteAsync("INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES (@Id, @Hash, 1)", new { Id = dto.MemberId, Hash = hash });
        }

        if (member != null && !string.IsNullOrEmpty((string?)member.email))
        {
            var clubListHtml = string.Join("", clubNames.Select(c => $"<li style='padding:4px 0;'>{c}</li>"));
            var credentialHtml = tempPassword != null
                ? $@"<div style='background-color:#F7F9FC;border:1px solid #D5DEE8;border-radius:8px;padding:16px;margin:16px 0;'><p><strong>Username:</strong> {(string)member.mobile}</p><p><strong>Temporary Password:</strong> {tempPassword}</p></div><p style='color:#e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>"
                : $@"<div style='background-color:#F7F9FC;border:1px solid #D5DEE8;border-radius:8px;padding:16px;margin:16px 0;'><p><strong>Username:</strong> {(string)member.mobile}</p><p>Use your existing password to login.</p></div>";
            var body = $@"<div style='font-family:Figtree, Arial,sans-serif;max-width:600px;margin:0 auto;'>
                <div style='background:#17458F;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;'><h2 style='margin:0;'>Assistant Governor (AG) Assignment</h2></div>
                <div style='padding:24px;border:1px solid #D5DEE8;border-top:none;border-radius:0 0 8px 8px;'>
                    <p>Dear <strong>{(string)member.memberName}</strong>,</p>
                    <p>You have been assigned as <strong>Assistant Governor (AG)</strong> for District <strong>{districtNumber}</strong>.</p>
                    <h3 style='color:#17458F;margin-top:20px;'>Assigned Clubs:</h3>
                    <ul style='background:#F7F9FC;border:1px solid #D5DEE8;border-radius:8px;padding:16px 16px 16px 32px;margin:8px 0;'>{clubListHtml}</ul>
                    <h3 style='color:#17458F;margin-top:20px;'>Login Details:</h3>
                    {credentialHtml}
                    <p style='color:#64748B;font-size:12px;margin-top:24px;'>This is an automated notification from ROW.</p>
                </div></div>";
            try { await _emailService.SendGenericEmailAsync((string)member.email, "ROW - AG Assignment", body); } catch { }
        }

        return Ok(new { message = "AG saved." });
    }

    [HttpDelete("api/districts/{districtId}/ag/member/{memberId}")]
    public async Task<ActionResult> DeleteAGByMember(int districtId, int memberId, [FromQuery] int? yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Year-scoped delete: removing AG from 2024-25 doesn't touch a fresh 2025-26 assignment.
        // When yearId is omitted, fall back to deleting all years (legacy behavior — admin tool).
        await conn.ExecuteAsync("UPDATE district_ag SET isdeleted = 1, modified_by = @UserId WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND (@YearId IS NULL OR fk_year_id = @YearId) AND isdeleted = 0",
            new { DistrictId = districtId, MemberId = memberId, YearId = yearId, UserId = GetUserId() });
        // Revoke AG role only if member has no other active district_ag rows in this district
        // (across all years). If they remain AG for another year, keep role active so they
        // can still log in and see that year's data.
        var remaining = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @DistrictId AND fk_member_id = @MemberId AND isdeleted = 0",
            new { DistrictId = districtId, MemberId = memberId });
        if (remaining == 0)
        {
            await conn.ExecuteAsync("UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @UserId WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 6 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId, DistrictId = districtId, UserId = GetUserId() });
        }

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>("SELECT MemberName AS memberName, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", new { Id = memberId });
        var districtNumber = await conn.ExecuteScalarAsync<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
        if (member != null && !string.IsNullOrEmpty((string?)member.email))
        {
            var body = $@"<div style='font-family:Figtree, Arial,sans-serif;max-width:600px;margin:0 auto;'>
                <div style='background:#dc2626;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;'><h2 style='margin:0;'>Assistant Governor Role Removed</h2></div>
                <div style='padding:24px;border:1px solid #D5DEE8;border-top:none;border-radius:0 0 8px 8px;'>
                    <p>Dear <strong>{(string)member.memberName}</strong>,</p>
                    <p>Your <strong>Assistant Governor (AG)</strong> role for District <strong>{districtNumber}</strong> has been removed.</p>
                    <p>If you have any questions, please contact your district administrator.</p>
                    <p style='color:#64748B;font-size:12px;margin-top:24px;'>This is an automated notification from ROW.</p>
                </div></div>";
            try { await _emailService.SendGenericEmailAsync((string)member.email, "ROW - AG Role Removed", body); } catch { }
        }
        return Ok(new { message = "AG removed." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Citation ──────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    // ── Activity Master (common dropdown) ──
    [HttpGet("api/district-modules/citation/activities")]
    public async Task<ActionResult> GetCitationActivities()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var result = await conn.QueryAsync<dynamic>("SELECT pk_id AS id, activity_name AS activityName, sub_type AS subType, sort_order AS sortOrder FROM district_citation_activity_master ORDER BY sort_order");
        return Ok(result);
    }

    // ── Meeting Types (for Club Service subtype=1) ──
    [HttpGet("api/district-modules/citation/meeting-types")]
    public async Task<ActionResult> GetCitationMeetingTypes()
    {
        return Ok(new[] {
            new { id = "regular", name = "Regular" },
            new { id = "fellowship", name = "Fellowship" },
            new { id = "bod", name = "BOD" },
            new { id = "assembly", name = "Assembly" },
            new { id = "trust", name = "Trust" }
        });
    }

    // ── Area of Focus (for Community/Vocational/International/NewGen/PublicImage) ──
    [HttpGet("api/district-modules/citation/area-of-focus")]
    public async Task<ActionResult> GetCitationAreaOfFocus([FromQuery] string? moduleKey)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = "SELECT pk_area_of_focus_id AS id, name FROM area_of_focus_master WHERE isdeleted = 0";
        if (!string.IsNullOrEmpty(moduleKey))
        {
            var moduleId = await conn.ExecuteScalarAsync<int?>("SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0", new { Key = moduleKey });
            if (moduleId.HasValue) sql += $" AND (fk_module_id = {moduleId.Value} OR fk_module_id IS NULL)";
        }
        sql += " ORDER BY name";
        return Ok(await conn.QueryAsync<dynamic>(sql));
    }

    // ── Citation Categories (Main Criteria) ──
    [HttpGet("api/district-modules/{districtId}/citation/categories")]
    public async Task<ActionResult> GetCitationCategoriesByDistrict(int districtId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId,
                           c.category_name AS categoryName, c.sort_order AS sortOrder, c.is_active AS isActive,
                           y.YearLabel AS yearLabel
                    FROM district_citation_category c
                    LEFT JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
                    WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0";
        if (yearId.HasValue) sql += " AND c.fk_year_id = @YearId";
        sql += " ORDER BY c.sort_order, c.category_name";
        return Ok(await conn.QueryAsync<dynamic>(sql, new { DistrictId = districtId, YearId = yearId }));
    }

    public class CitationCategoryDto
    {
        public int YearId { get; set; }
        public string CategoryName { get; set; } = "";
        public int SortOrder { get; set; }
    }

    [HttpPost("api/district-modules/{districtId}/citation/categories")]
    public async Task<ActionResult> CreateCitationCategory(int districtId, [FromBody] CitationCategoryDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_citation_category (fk_district_id, fk_year_id, category_name, sort_order, created_by)
            VALUES (@DistrictId, @YearId, @Name, @Sort, @UserId); SELECT LAST_INSERT_ID()",
            new { DistrictId = districtId, YearId = dto.YearId, Name = dto.CategoryName, Sort = dto.SortOrder, UserId = GetUserId() });
        return Ok(new { id, message = "Category created." });
    }

    [HttpPut("api/district-modules/{districtId}/citation/categories/{id}")]
    public async Task<ActionResult> UpdateCitationCategory(int districtId, int id, [FromBody] CitationCategoryDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"UPDATE district_citation_category SET category_name=@Name, sort_order=@Sort, modified_by=@UserId WHERE pk_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
            new { Id = id, DistrictId = districtId, Name = dto.CategoryName, Sort = dto.SortOrder, UserId = GetUserId() });
        return Ok(new { message = "Category updated." });
    }

    [HttpDelete("api/district-modules/{districtId}/citation/categories/{id}")]
    public async Task<ActionResult> DeleteCitationCategory(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Check if any auto/manual questions use this category
        var autoCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_citation_auto_question WHERE fk_category_id=@Id AND isdeleted=0", new { Id = id });
        var manualCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_citation_manual_criteria WHERE fk_category_id=@Id AND isdeleted=0", new { Id = id });
        if (autoCount > 0 || manualCount > 0)
            return BadRequest(new { message = "Cannot delete category with existing questions." });
        await conn.ExecuteAsync("UPDATE district_citation_category SET isdeleted=1 WHERE pk_id=@Id AND fk_district_id=@DistrictId", new { Id = id, DistrictId = districtId });
        return Ok(new { message = "Category deleted." });
    }

    // ── Citation Description ──
    [HttpGet("api/district-modules/{districtId}/citation/description")]
    public async Task<ActionResult> GetCitationDescription(int districtId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var result = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id, description_html AS descriptionHtml FROM district_citation_description
            WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, YearId = yearId });
        return Ok(result ?? new { id = 0, descriptionHtml = "" });
    }

    public class CitationDescriptionDto
    {
        public int YearId { get; set; }
        public string DescriptionHtml { get; set; } = "";
    }

    [HttpPost("api/district-modules/{districtId}/citation/description")]
    public async Task<ActionResult> SaveCitationDescription(int districtId, [FromBody] CitationDescriptionDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var existing = await conn.ExecuteScalarAsync<int?>("SELECT pk_id FROM district_citation_description WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, YearId = dto.YearId });
        if (existing.HasValue)
            await conn.ExecuteAsync("UPDATE district_citation_description SET description_html=@Html, modified_by=@UserId WHERE pk_id=@Id",
                new { Id = existing.Value, Html = dto.DescriptionHtml, UserId = GetUserId() });
        else
            await conn.ExecuteAsync(@"INSERT INTO district_citation_description (fk_district_id, fk_year_id, description_html, created_by) VALUES (@DistrictId, @YearId, @Html, @UserId)",
                new { DistrictId = districtId, YearId = dto.YearId, Html = dto.DescriptionHtml, UserId = GetUserId() });
        return Ok(new { message = "Description saved." });
    }

    // ── Citation Auto Questions ──
    [HttpGet("api/district-modules/{districtId}/citation/auto-questions")]
    public async Task<ActionResult> GetCitationAutoQuestions(int districtId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"SELECT q.pk_id AS id, q.fk_category_id AS categoryId, cc.category_name AS categoryName,
                           q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
                           CAST(ROUND(q.points) AS SIGNED) AS points, q.is_bonus AS isBonus,
                           CAST(ROUND(q.bonus_points) AS SIGNED) AS bonusPoints,
                           q.min_bonus AS minBonus, q.max_bonus AS maxBonus,
                           q.sort_order AS sortOrder, q.fk_year_id AS yearId
                    FROM district_citation_auto_question q
                    INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
                    INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
                    WHERE q.fk_district_id=@DistrictId AND q.isdeleted=0";
        if (yearId.HasValue) sql += " AND q.fk_year_id=@YearId";
        sql += " ORDER BY cc.sort_order, q.sort_order";
        var questions = (await conn.QueryAsync<dynamic>(sql, new { DistrictId = districtId, YearId = yearId })).ToList();

        // Load sub-items for each question
        var qIds = questions.Select(q => (int)q.id).ToList();
        if (qIds.Count > 0)
        {
            // The area-of-focus label admin needs to tell apart the N rows of the same activity
            // (e.g. three "Club Service" auto questions, each scoped to a different area_of_focus).
            // It comes from the sub-item itself (sub_item_type, sub_item_id) or from filter_aof_id.
            var subs = (await conn.QueryAsync<dynamic>(@"
                SELECT s.pk_id AS id, s.fk_auto_question_id AS autoQuestionId, s.sub_item_type AS subItemType,
                       s.sub_item_id AS subItemId, s.sub_item_name AS subItemName,
                       s.filter_aof_id AS filterAofId,
                       CAST(ROUND(s.points) AS SIGNED) AS points, s.is_bonus AS isBonus,
                       CAST(ROUND(s.bonus_points) AS SIGNED) AS bonusPoints,
                       s.min_bonus AS minBonus, s.max_bonus AS maxBonus,
                       COALESCE(aof_only.name, aof_by_filter.name) AS areaOfFocusName
                FROM district_citation_auto_question_sub s
                LEFT JOIN area_of_focus_master aof_only      ON LOWER(s.sub_item_type) = 'area_of_focus' AND aof_only.pk_area_of_focus_id = s.sub_item_id
                LEFT JOIN area_of_focus_master aof_by_filter ON s.filter_aof_id IS NOT NULL AND aof_by_filter.pk_area_of_focus_id = s.filter_aof_id
                WHERE s.fk_auto_question_id IN @Ids AND s.isdeleted = 0
                ORDER BY s.sort_order",
                new { Ids = qIds })).ToList();

            foreach (var q in questions)
                q.subItems = subs.Where(s => (int)s.autoQuestionId == (int)q.id).ToList();
        }
        else
        {
            foreach (var q in questions) q.subItems = new List<dynamic>();
        }
        return Ok(questions);
    }

    public class CitationAutoQuestionDto
    {
        public int YearId { get; set; }
        public int CategoryId { get; set; }
        public int ActivityId { get; set; }
        public int Points { get; set; }
        public bool IsBonus { get; set; }
        public int BonusPoints { get; set; }
        public int MinBonus { get; set; }
        public int MaxBonus { get; set; }
        public int SortOrder { get; set; }
        public List<CitationAutoSubItemDto> SubItems { get; set; } = new();
    }

    public class CitationAutoSubItemDto
    {
        public int Id { get; set; }
        public string SubItemType { get; set; } = "";
        public int? SubItemId { get; set; }
        public string? SubItemName { get; set; }
        public int? FilterAofId { get; set; }
        public int Points { get; set; }
        public bool IsBonus { get; set; }
        public int BonusPoints { get; set; }
        public int MinBonus { get; set; }
        public int MaxBonus { get; set; }
    }

    [HttpPost("api/district-modules/{districtId}/citation/auto-questions")]
    public async Task<ActionResult> CreateCitationAutoQuestion(int districtId, [FromBody] CitationAutoQuestionDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_citation_auto_question (fk_district_id, fk_year_id, fk_category_id, fk_activity_id, points, is_bonus, bonus_points, min_bonus, max_bonus, sort_order, created_by)
            VALUES (@DistrictId, @YearId, @CategoryId, @ActivityId, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @Sort, @UserId); SELECT LAST_INSERT_ID()",
            new { DistrictId = districtId, dto.YearId, dto.CategoryId, dto.ActivityId, dto.Points, IsBonus = dto.IsBonus ? 1 : 0, dto.BonusPoints, dto.MinBonus, dto.MaxBonus, Sort = dto.SortOrder, UserId = userId });

        foreach (var sub in dto.SubItems)
        {
            await conn.ExecuteAsync(@"INSERT INTO district_citation_auto_question_sub (fk_auto_question_id, sub_item_type, sub_item_id, sub_item_name, filter_aof_id, points, is_bonus, bonus_points, min_bonus, max_bonus, created_by)
                VALUES (@QId, @Type, @SubId, @SubName, @FilterAofId, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @UserId)",
                new { QId = id, Type = sub.SubItemType, SubId = sub.SubItemId, SubName = sub.SubItemName, sub.FilterAofId, sub.Points, IsBonus = sub.IsBonus ? 1 : 0, sub.BonusPoints, sub.MinBonus, sub.MaxBonus, UserId = userId });
        }
        return Ok(new { id, message = "Auto question created." });
    }

    [HttpPut("api/district-modules/{districtId}/citation/auto-questions/{id}")]
    public async Task<ActionResult> UpdateCitationAutoQuestion(int districtId, int id, [FromBody] CitationAutoQuestionDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        await conn.ExecuteAsync(@"UPDATE district_citation_auto_question SET fk_category_id=@CategoryId, fk_activity_id=@ActivityId,
            points=@Points, is_bonus=@IsBonus, bonus_points=@BonusPoints, min_bonus=@MinBonus, max_bonus=@MaxBonus, sort_order=@Sort, modified_by=@UserId
            WHERE pk_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
            new { Id = id, DistrictId = districtId, dto.CategoryId, dto.ActivityId, dto.Points, IsBonus = dto.IsBonus ? 1 : 0, dto.BonusPoints, dto.MinBonus, dto.MaxBonus, Sort = dto.SortOrder, UserId = userId });

        // Soft-delete existing subs and re-insert
        await conn.ExecuteAsync("UPDATE district_citation_auto_question_sub SET isdeleted=1 WHERE fk_auto_question_id=@Id", new { Id = id });
        foreach (var sub in dto.SubItems)
        {
            await conn.ExecuteAsync(@"INSERT INTO district_citation_auto_question_sub (fk_auto_question_id, sub_item_type, sub_item_id, sub_item_name, filter_aof_id, points, is_bonus, bonus_points, min_bonus, max_bonus, created_by)
                VALUES (@QId, @Type, @SubId, @SubName, @FilterAofId, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @UserId)",
                new { QId = id, Type = sub.SubItemType, SubId = sub.SubItemId, SubName = sub.SubItemName, sub.FilterAofId, sub.Points, IsBonus = sub.IsBonus ? 1 : 0, sub.BonusPoints, sub.MinBonus, sub.MaxBonus, UserId = userId });
        }
        return Ok(new { message = "Auto question updated." });
    }

    [HttpDelete("api/district-modules/{districtId}/citation/auto-questions/{id}")]
    public async Task<ActionResult> DeleteCitationAutoQuestion(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubEntries = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_citation_club_entry WHERE entry_type='auto' AND fk_question_id=@Id AND isdeleted=0", new { Id = id });
        if (clubEntries > 0) return BadRequest(new { message = "Cannot delete: clubs have entered points." });
        await conn.ExecuteAsync("UPDATE district_citation_auto_question SET isdeleted=1 WHERE pk_id=@Id AND fk_district_id=@DistrictId", new { Id = id, DistrictId = districtId });
        await conn.ExecuteAsync("UPDATE district_citation_auto_question_sub SET isdeleted=1 WHERE fk_auto_question_id=@Id", new { Id = id });
        return Ok(new { message = "Auto question deleted." });
    }

    // ── Citation Manual Criteria & Sub Criteria ──
    [HttpGet("api/district-modules/{districtId}/citation/manual-criteria")]
    public async Task<ActionResult> GetCitationManualCriteria(int districtId, [FromQuery] int? yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"SELECT mc.pk_id AS id, mc.fk_category_id AS categoryId, cc.category_name AS categoryName,
                           mc.criteria_name AS criteriaName, mc.sort_order AS sortOrder, mc.fk_year_id AS yearId
                    FROM district_citation_manual_criteria mc
                    INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
                    WHERE mc.fk_district_id=@DistrictId AND mc.isdeleted=0";
        if (yearId.HasValue) sql += " AND mc.fk_year_id=@YearId";
        sql += " ORDER BY cc.sort_order, mc.sort_order";
        var criteria = (await conn.QueryAsync<dynamic>(sql, new { DistrictId = districtId, YearId = yearId })).ToList();

        var mcIds = criteria.Select(c => (int)c.id).ToList();
        if (mcIds.Count > 0)
        {
            var subs = (await conn.QueryAsync<dynamic>(@"
                SELECT sc.pk_id AS id, sc.fk_criteria_id AS criteriaId, sc.sub_criteria_title AS subCriteriaTitle,
                       sc.answer_type AS answerType,
                       CAST(ROUND(sc.points) AS SIGNED) AS points,
                       sc.is_bonus AS isBonus,
                       CAST(ROUND(sc.bonus_points) AS SIGNED) AS bonusPoints,
                       sc.min_bonus AS minBonus, sc.max_bonus AS maxBonus, sc.remark, sc.sort_order AS sortOrder
                FROM district_citation_manual_sub_criteria sc WHERE sc.fk_criteria_id IN @Ids AND sc.isdeleted=0 ORDER BY sc.sort_order",
                new { Ids = mcIds })).ToList();

            var subIds = subs.Select(s => (int)s.id).ToList();
            var options = subIds.Count > 0
                ? (await conn.QueryAsync<dynamic>(@"
                    SELECT pk_id AS id, fk_sub_criteria_id AS subCriteriaId, option_text AS optionText,
                           CAST(ROUND(option_points) AS SIGNED) AS optionPoints,
                           sort_order AS sortOrder
                    FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted=0 ORDER BY sort_order",
                    new { Ids = subIds })).ToList()
                : new List<dynamic>();

            foreach (var s in subs)
                s.options = options.Where(o => (int)o.subCriteriaId == (int)s.id).ToList();
            foreach (var c in criteria)
                c.subCriteria = subs.Where(s => (int)s.criteriaId == (int)c.id).ToList();
        }
        else
        {
            foreach (var c in criteria) c.subCriteria = new List<dynamic>();
        }
        return Ok(criteria);
    }

    public class CitationManualCriteriaDto
    {
        public int YearId { get; set; }
        public int CategoryId { get; set; }
        public string CriteriaName { get; set; } = "";
        public int SortOrder { get; set; }
        public List<CitationManualSubCriteriaDto> SubCriteria { get; set; } = new();
    }

    public class CitationManualSubCriteriaDto
    {
        public int Id { get; set; }
        public string? SubCriteriaTitle { get; set; }
        public string AnswerType { get; set; } = "number";
        public int Points { get; set; }
        public bool IsBonus { get; set; }
        public int BonusPoints { get; set; }
        public int MinBonus { get; set; }
        public int MaxBonus { get; set; }
        public string? Remark { get; set; }
        public int SortOrder { get; set; }
        public List<CitationSubCriteriaOptionDto> Options { get; set; } = new();
    }

    public class CitationSubCriteriaOptionDto
    {
        public int Id { get; set; }
        public string OptionText { get; set; } = "";
        public int OptionPoints { get; set; }
        public int SortOrder { get; set; }
    }

    [HttpPost("api/district-modules/{districtId}/citation/manual-criteria")]
    public async Task<ActionResult> CreateCitationManualCriteria(int districtId, [FromBody] CitationManualCriteriaDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_citation_manual_criteria (fk_district_id, fk_year_id, fk_category_id, criteria_name, sort_order, created_by)
            VALUES (@DistrictId, @YearId, @CategoryId, @Name, @Sort, @UserId); SELECT LAST_INSERT_ID()",
            new { DistrictId = districtId, dto.YearId, dto.CategoryId, Name = dto.CriteriaName, Sort = dto.SortOrder, UserId = userId });

        foreach (var sub in dto.SubCriteria)
        {
            var subId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO district_citation_manual_sub_criteria (fk_criteria_id, sub_criteria_title, answer_type, points, is_bonus, bonus_points, min_bonus, max_bonus, remark, sort_order, created_by)
                VALUES (@CriteriaId, @Title, @AnswerType, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @Remark, @Sort, @UserId); SELECT LAST_INSERT_ID()",
                new { CriteriaId = id, Title = sub.SubCriteriaTitle, sub.AnswerType, sub.Points, IsBonus = sub.IsBonus ? 1 : 0, sub.BonusPoints, sub.MinBonus, sub.MaxBonus, sub.Remark, Sort = sub.SortOrder, UserId = userId });

            if (sub.AnswerType == "choose_one")
            {
                foreach (var opt in sub.Options)
                    await conn.ExecuteAsync(@"INSERT INTO district_citation_manual_sub_criteria_option (fk_sub_criteria_id, option_text, option_points, sort_order, created_by)
                        VALUES (@SubId, @Text, @Points, @Sort, @UserId)",
                        new { SubId = subId, Text = opt.OptionText, Points = opt.OptionPoints, Sort = opt.SortOrder, UserId = userId });
            }
        }
        return Ok(new { id, message = "Manual criteria created." });
    }

    [HttpPut("api/district-modules/{districtId}/citation/manual-criteria/{id}")]
    public async Task<ActionResult> UpdateCitationManualCriteria(int districtId, int id, [FromBody] CitationManualCriteriaDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        await conn.ExecuteAsync("UPDATE district_citation_manual_criteria SET fk_category_id=@CategoryId, criteria_name=@Name, sort_order=@Sort, modified_by=@UserId WHERE pk_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
            new { Id = id, DistrictId = districtId, dto.CategoryId, Name = dto.CriteriaName, Sort = dto.SortOrder, UserId = userId });

        // Soft-delete old subs and options, re-insert
        var oldSubIds = (await conn.QueryAsync<int>("SELECT pk_id FROM district_citation_manual_sub_criteria WHERE fk_criteria_id=@Id AND isdeleted=0", new { Id = id })).ToList();
        if (oldSubIds.Count > 0)
        {
            await conn.ExecuteAsync("UPDATE district_citation_manual_sub_criteria SET isdeleted=1 WHERE fk_criteria_id=@Id", new { Id = id });
            await conn.ExecuteAsync($"UPDATE district_citation_manual_sub_criteria_option SET isdeleted=1 WHERE fk_sub_criteria_id IN ({string.Join(",", oldSubIds)})");
        }

        foreach (var sub in dto.SubCriteria)
        {
            var subId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO district_citation_manual_sub_criteria (fk_criteria_id, sub_criteria_title, answer_type, points, is_bonus, bonus_points, min_bonus, max_bonus, remark, sort_order, created_by)
                VALUES (@CriteriaId, @Title, @AnswerType, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @Remark, @Sort, @UserId); SELECT LAST_INSERT_ID()",
                new { CriteriaId = id, Title = sub.SubCriteriaTitle, sub.AnswerType, sub.Points, IsBonus = sub.IsBonus ? 1 : 0, sub.BonusPoints, sub.MinBonus, sub.MaxBonus, sub.Remark, Sort = sub.SortOrder, UserId = userId });

            if (sub.AnswerType == "choose_one")
            {
                foreach (var opt in sub.Options)
                    await conn.ExecuteAsync(@"INSERT INTO district_citation_manual_sub_criteria_option (fk_sub_criteria_id, option_text, option_points, sort_order, created_by)
                        VALUES (@SubId, @Text, @Points, @Sort, @UserId)",
                        new { SubId = subId, Text = opt.OptionText, Points = opt.OptionPoints, Sort = opt.SortOrder, UserId = userId });
            }
        }
        return Ok(new { message = "Manual criteria updated." });
    }

    [HttpDelete("api/district-modules/{districtId}/citation/manual-criteria/{id}")]
    public async Task<ActionResult> DeleteCitationManualCriteria(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Check if clubs have entries
        var subIds = (await conn.QueryAsync<int>("SELECT pk_id FROM district_citation_manual_sub_criteria WHERE fk_criteria_id=@Id AND isdeleted=0", new { Id = id })).ToList();
        if (subIds.Count > 0)
        {
            var clubEntries = await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM district_citation_club_entry WHERE entry_type='manual' AND fk_question_id IN ({string.Join(",", subIds)}) AND isdeleted=0");
            if (clubEntries > 0) return BadRequest(new { message = "Cannot delete: clubs have entered points." });
            await conn.ExecuteAsync($"UPDATE district_citation_manual_sub_criteria SET isdeleted=1 WHERE fk_criteria_id=@Id", new { Id = id });
            await conn.ExecuteAsync($"UPDATE district_citation_manual_sub_criteria_option SET isdeleted=1 WHERE fk_sub_criteria_id IN ({string.Join(",", subIds)})");
        }
        await conn.ExecuteAsync("UPDATE district_citation_manual_criteria SET isdeleted=1 WHERE pk_id=@Id AND fk_district_id=@DistrictId", new { Id = id, DistrictId = districtId });
        return Ok(new { message = "Manual criteria deleted." });
    }

    // ── Citation Club Points View ──
    [HttpGet("api/district-modules/{districtId}/citation/club-points")]
    public async Task<ActionResult> GetCitationClubPoints(int districtId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Get all clubs in the district
        var clubs = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
            FROM club_master c WHERE c.fk_district_id=@DistrictId AND c.isdeleted=0 AND c.IsActive=1{NotRotaractUnlessSa()}
            ORDER BY c.ClubName",
            new { DistrictId = districtId })).ToList();

        // Get all club entries for this district+year.
        // Only count entries whose underlying question/sub-criteria still exists
        // for THIS district+year — matches the club citation page totals, which
        // INNER JOIN auto_question / manual_sub_criteria. Without this filter,
        // orphan entries (deleted/migrated questions still referenced) inflate
        // the district view past the per-club page total (user reported
        // 66290 vs 57290 for Calcutta Mahanagar, 2026-06-13).
        var entries = (await conn.QueryAsync<dynamic>(@"
            SELECT clubId, SUM(score) AS totalPoints FROM (
                SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
                FROM district_citation_club_entry e
                INNER JOIN district_citation_auto_question q
                    ON q.pk_id = e.fk_question_id
                   AND q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0
                WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId
                  AND e.entry_type='auto' AND e.isdeleted=0
                UNION ALL
                SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
                FROM district_citation_club_entry e
                INNER JOIN district_citation_manual_sub_criteria sc
                    ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
                INNER JOIN district_citation_manual_criteria mc
                    ON mc.pk_id = sc.fk_criteria_id
                   AND mc.fk_district_id = @DistrictId AND mc.fk_year_id = @YearId AND mc.isdeleted = 0
                WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId
                  AND e.entry_type='manual' AND e.isdeleted=0
            ) t
            GROUP BY clubId",
            new { DistrictId = districtId, YearId = yearId })).ToDictionary(e => (int)e.clubId, e => (decimal)e.totalPoints);

        var result = clubs.Select(c => new {
            clubId = (int)c.clubId,
            clubName = (string)c.clubName,
            clubRotaryId = (string?)c.clubRotaryId,
            totalPoints = (int)Math.Round(entries.ContainsKey((int)c.clubId) ? entries[(int)c.clubId] : 0m)
        }).OrderByDescending(c => c.totalPoints).ToList();

        return Ok(result);
    }

    // ── Citation Club Detailed Report (CSV) ──
    [HttpGet("api/district-modules/{districtId}/citation/club-report")]
    public async Task<ActionResult> GetCitationClubReport(int districtId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Get all clubs
        var clubs = (await conn.QueryAsync<dynamic>(
            $"SELECT pk_club_id AS clubId, ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE fk_district_id=@DistrictId AND isdeleted=0 AND IsActive=1{NotRotaractUnlessSa("")} ORDER BY ClubName",
            new { DistrictId = districtId })).ToList();

        // Get all auto questions with sub-items
        var autoQuestions = (await conn.QueryAsync<dynamic>(@"
            SELECT q.pk_id AS id, cc.category_name AS categoryName, a.activity_name AS activityName,
                   q.points AS basePoints
            FROM district_citation_auto_question q
            INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
            WHERE q.fk_district_id=@DistrictId AND q.fk_year_id=@YearId AND q.isdeleted=0
            ORDER BY cc.sort_order, q.sort_order",
            new { DistrictId = districtId, YearId = yearId })).ToList();

        var autoQIds = autoQuestions.Select(q => (int)q.id).ToList();
        var autoSubs = autoQIds.Count > 0
            ? (await conn.QueryAsync<dynamic>(@"
                SELECT pk_id AS id, fk_auto_question_id AS questionId, sub_item_type AS subItemType, sub_item_name AS subItemName
                FROM district_citation_auto_question_sub WHERE fk_auto_question_id IN @Ids AND isdeleted=0 ORDER BY sort_order",
                new { Ids = autoQIds })).ToList()
            : new List<dynamic>();

        // Get all manual sub-criteria
        var manualSubs = (await conn.QueryAsync<dynamic>(@"
            SELECT sc.pk_id AS id, cc.category_name AS categoryName, sc.sub_criteria_title AS title, sc.answer_type AS answerType
            FROM district_citation_manual_sub_criteria sc
            INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
            INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
            WHERE mc.fk_district_id=@DistrictId AND mc.fk_year_id=@YearId AND mc.isdeleted=0 AND sc.isdeleted=0
            ORDER BY cc.sort_order, mc.sort_order, sc.sort_order",
            new { DistrictId = districtId, YearId = yearId })).ToList();

        // Get all club entries
        var allEntries = (await conn.QueryAsync<dynamic>(@"
            SELECT fk_club_id AS clubId, entry_type AS entryType, fk_question_id AS questionId, fk_sub_question_id AS subQuestionId,
                   answer_value AS answerValue, points_earned AS pointsEarned, bonus_earned AS bonusEarned
            FROM district_citation_club_entry
            WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, YearId = yearId })).ToList();

        // Build column headers
        var columns = new List<string> { "Club Name", "Club ID" };

        // Auto question columns: build flat list
        var autoColumnKeys = new List<(string type, int qId, int? subId)>();
        foreach (var q in autoQuestions)
        {
            var qSubs = autoSubs.Where(s => (int)s.questionId == (int)q.id).ToList();
            if (qSubs.Count == 0 || (decimal)q.basePoints > 0)
            {
                columns.Add($"{(string)q.activityName}");
                autoColumnKeys.Add(("auto", (int)q.id, null));
            }
            foreach (var s in qSubs)
            {
                columns.Add($"{(string)q.activityName} - {(string)(s.subItemName ?? s.subItemType)}");
                autoColumnKeys.Add(("auto", (int)q.id, (int)s.id));
            }
        }

        // Manual sub-criteria columns
        var manualColumnKeys = new List<int>();
        foreach (var ms in manualSubs)
        {
            columns.Add($"{(string)ms.title}");
            manualColumnKeys.Add((int)ms.id);
        }

        columns.Add("Total Auto");
        columns.Add("Total Manual");
        columns.Add("Grand Total");

        // Build Excel with ClosedXML
        using var workbook = new XLWorkbook();
        var ws = workbook.Worksheets.Add("Awards Report");

        // Title row
        ws.Cell(1, 1).Value = $"District Awards Report";
        ws.Range(1, 1, 1, columns.Count).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 16;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.DarkBlue;
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        // Group row (Auto / Manual labels)
        int groupRow = 3;
        // Header row
        int headerRow = 4;
        int autoStartCol = 3;
        int autoEndCol = autoStartCol + autoColumnKeys.Count - 1;
        int manualStartCol = autoEndCol + 1;
        int manualEndCol = manualStartCol + manualColumnKeys.Count - 1;
        int totalAutoCol = manualEndCol + 1;
        int totalManualCol = totalAutoCol + 1;
        int grandTotalCol = totalManualCol + 1;

        for (int c = 0; c < columns.Count; c++)
        {
            var cell = ws.Cell(headerRow, c + 1);
            cell.Value = columns[c];
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            cell.Style.Alignment.WrapText = true;
            cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Bottom;

            // Color code headers
            if (c < 2) // Club Name, Club ID
                cell.Style.Fill.BackgroundColor = XLColor.DarkSlateGray;
            else if (c < 2 + autoColumnKeys.Count) // Auto columns
                cell.Style.Fill.BackgroundColor = XLColor.RoyalBlue;
            else if (c < 2 + autoColumnKeys.Count + manualColumnKeys.Count) // Manual columns
                cell.Style.Fill.BackgroundColor = XLColor.SeaGreen;
            else // Totals
                cell.Style.Fill.BackgroundColor = XLColor.DarkOrange;
        }

        // Group row — Auto / Manual labels
        if (autoColumnKeys.Count > 0)
        {
            var autoRange = ws.Range(groupRow, autoStartCol, groupRow, autoEndCol);
            autoRange.Merge();
            autoRange.Value = "AUTO POINTS";
            autoRange.Style.Font.Bold = true;
            autoRange.Style.Font.FontColor = XLColor.White;
            autoRange.Style.Fill.BackgroundColor = XLColor.RoyalBlue;
            autoRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }
        if (manualColumnKeys.Count > 0)
        {
            var manualRange = ws.Range(groupRow, manualStartCol, groupRow, manualEndCol);
            manualRange.Merge();
            manualRange.Value = "MANUAL POINTS";
            manualRange.Style.Font.Bold = true;
            manualRange.Style.Font.FontColor = XLColor.White;
            manualRange.Style.Fill.BackgroundColor = XLColor.SeaGreen;
            manualRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }
        ws.Row(groupRow).Height = 25;

        // Data rows
        int row = headerRow + 1;
        int rank = 1;
        foreach (var club in clubs)
        {
            int cId = (int)club.clubId;
            var clubEntries = allEntries.Where(e => (int)e.clubId == cId).ToList();

            ws.Cell(row, 1).Value = (string)club.clubName;
            ws.Cell(row, 2).Value = (string?)club.clubRotaryId ?? "";

            int col = 3;
            decimal totalAuto = 0;
            foreach (var (type, qId, subId) in autoColumnKeys)
            {
                var entry = clubEntries.FirstOrDefault(e =>
                    (string)e.entryType == "auto" && (int)e.questionId == qId &&
                    (subId == null ? e.subQuestionId == null : (int?)e.subQuestionId == subId));
                decimal pts = entry != null ? (decimal)entry.pointsEarned + (decimal)entry.bonusEarned : 0;
                totalAuto += pts;
                ws.Cell(row, col).Value = pts;
                ws.Cell(row, col).Style.NumberFormat.Format = "General";
                ws.Cell(row, col).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                if (pts > 0) ws.Cell(row, col).Style.Fill.BackgroundColor = XLColor.LightBlue;
                col++;
            }

            decimal totalManual = 0;
            foreach (var msId in manualColumnKeys)
            {
                var entry = clubEntries.FirstOrDefault(e => (string)e.entryType == "manual" && (int)e.questionId == msId);
                decimal pts = entry != null ? (decimal)entry.pointsEarned + (decimal)entry.bonusEarned : 0;
                totalManual += pts;
                ws.Cell(row, col).Value = pts;
                ws.Cell(row, col).Style.NumberFormat.Format = "General";
                ws.Cell(row, col).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                if (pts > 0) ws.Cell(row, col).Style.Fill.BackgroundColor = XLColor.LightGreen;
                col++;
            }

            // Totals
            ws.Cell(row, col).Value = totalAuto;
            ws.Cell(row, col).Style.Font.Bold = true;
            ws.Cell(row, col).Style.Fill.BackgroundColor = XLColor.LightSkyBlue;
            ws.Cell(row, col).Style.NumberFormat.Format = "General";
            ws.Cell(row, col).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            col++;

            ws.Cell(row, col).Value = totalManual;
            ws.Cell(row, col).Style.Font.Bold = true;
            ws.Cell(row, col).Style.Fill.BackgroundColor = XLColor.PaleGreen;
            ws.Cell(row, col).Style.NumberFormat.Format = "General";
            ws.Cell(row, col).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            col++;

            ws.Cell(row, col).Value = totalAuto + totalManual;
            ws.Cell(row, col).Style.Font.Bold = true;
            ws.Cell(row, col).Style.Font.FontSize = 12;
            ws.Cell(row, col).Style.Fill.BackgroundColor = XLColor.Gold;
            ws.Cell(row, col).Style.NumberFormat.Format = "General";
            ws.Cell(row, col).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

            // Alternate row color
            if (rank % 2 == 0)
            {
                ws.Range(row, 1, row, 2).Style.Fill.BackgroundColor = XLColor.WhiteSmoke;
            }

            rank++;
            row++;
        }

        // Add borders
        var dataRange = ws.Range(headerRow, 1, row - 1, columns.Count);
        dataRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        dataRange.Style.Border.InsideBorder = XLBorderStyleValues.Thin;

        // Set column widths and header row height
        ws.Column(1).Width = 25; // Club Name
        ws.Column(2).Width = 15; // Club ID
        for (int c = 3; c <= columns.Count; c++)
            ws.Column(c).Width = 20;
        ws.Row(headerRow).Height = 60;

        // Freeze header
        ws.SheetView.FreezeRows(headerRow);
        ws.SheetView.FreezeColumns(2);

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"citation_report_{districtId}_{yearId}.xlsx");
    }

    // ── Citation Single Club Report (Excel) ──
    [HttpGet("api/district-modules/{districtId}/citation/club-report/{clubId}")]
    public async Task<ActionResult> GetCitationSingleClubReport(int districtId, int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE pk_club_id=@Id AND isdeleted=0", new { Id = clubId });
        if (club == null) return NotFound(new { message = "Club not found." });

        var district = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id=@Id", new { Id = districtId });

        // Auto entries
        var autoEntries = (await conn.QueryAsync<dynamic>(@"
            SELECT e.fk_question_id AS questionId, e.fk_sub_question_id AS subQuestionId,
                   e.answer_value AS count, e.points_earned AS pointsEarned, e.bonus_earned AS bonusEarned,
                   cc.category_name AS categoryName, a.activity_name AS activityName,
                   s.sub_item_name AS subItemName, s.sub_item_type AS subItemType
            FROM district_citation_club_entry e
            INNER JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
            INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
            -- isdeleted = 0: a sub-item the district DELETED must vanish from the club's list
            -- too. Without it the club kept listing sub-items no longer in the district setup
            -- at all (864 such rows across 109 clubs in 2026-27).
            LEFT JOIN district_citation_auto_question_sub s ON s.pk_id = e.fk_sub_question_id AND s.isdeleted = 0
            WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.fk_club_id=@ClubId AND e.entry_type='auto' AND e.isdeleted=0
              -- and drop the entry outright when its sub-item is gone: with the LEFT JOIN above
              -- it would otherwise survive as a nameless row carrying the question's points.
              AND (e.fk_sub_question_id IS NULL OR s.pk_id IS NOT NULL)
            ORDER BY cc.sort_order, q.sort_order, s.sort_order",
            new { DistrictId = districtId, YearId = yearId, ClubId = clubId })).ToList();

        // Manual entries
        var manualEntries = (await conn.QueryAsync<dynamic>(@"
            SELECT cc.category_name AS categoryName, sc.sub_criteria_title AS title, sc.answer_type AS answerType,
                   e.answer_value AS answerValue, e.points_earned AS pointsEarned, e.bonus_earned AS bonusEarned
            FROM district_citation_club_entry e
            -- isdeleted = 0 on BOTH: a question the district removed must not come back in this
            -- report. Without these two the Excel listed answers to sub-criteria that no longer
            -- exist and added their points to the club's total, while the club's own screen and
            -- the district ranking (which both filter) showed the smaller, correct figure.
            INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
            INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id AND mc.isdeleted = 0
            INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
            WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.fk_club_id=@ClubId AND e.entry_type='manual' AND e.isdeleted=0
            ORDER BY cc.sort_order, mc.sort_order, sc.sort_order",
            new { DistrictId = districtId, YearId = yearId, ClubId = clubId })).ToList();

        // Also get unanswered manual questions
        var allManualSubs = (await conn.QueryAsync<dynamic>(@"
            SELECT sc.pk_id AS id, cc.category_name AS categoryName, sc.sub_criteria_title AS title, sc.answer_type AS answerType
            FROM district_citation_manual_sub_criteria sc
            INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
            INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
            WHERE mc.fk_district_id=@DistrictId AND mc.fk_year_id=@YearId AND mc.isdeleted=0 AND sc.isdeleted=0
            ORDER BY cc.sort_order, mc.sort_order, sc.sort_order",
            new { DistrictId = districtId, YearId = yearId })).ToList();

        var answeredManualIds = manualEntries.Select(e => {
            // match by title since we don't have id in entry query easily
            return (string)e.title;
        }).ToHashSet();

        using var workbook = new XLWorkbook();
        var ws = workbook.Worksheets.Add("Club Citation");

        // Title
        ws.Cell(1, 1).Value = $"{(string)club.clubName} - Citation Report";
        ws.Range(1, 1, 1, 6).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 16;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.DarkBlue;
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        ws.Cell(2, 1).Value = $"District: {(string?)district?.DistrictNumber ?? ""} | Club ID: {(string?)club.clubRotaryId ?? ""}";
        ws.Range(2, 1, 2, 6).Merge();
        ws.Cell(2, 1).Style.Font.Italic = true;
        ws.Cell(2, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        // AUTO POINTS section
        int row = 4;
        ws.Cell(row, 1).Value = "AUTO POINTS";
        ws.Range(row, 1, row, 6).Merge();
        ws.Cell(row, 1).Style.Font.Bold = true;
        ws.Cell(row, 1).Style.Font.FontSize = 13;
        ws.Cell(row, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(row, 1).Style.Fill.BackgroundColor = XLColor.RoyalBlue;
        ws.Cell(row, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        row++;

        // Auto header
        var autoHeaders = new[] { "#", "Category", "Activity", "Sub Item", "Count", "Points" };
        for (int c = 0; c < autoHeaders.Length; c++)
        {
            ws.Cell(row, c + 1).Value = autoHeaders[c];
            ws.Cell(row, c + 1).Style.Font.Bold = true;
            ws.Cell(row, c + 1).Style.Fill.BackgroundColor = XLColor.LightSteelBlue;
            ws.Cell(row, c + 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }
        row++;

        decimal totalAutoPoints = 0;
        int autoIdx = 1;
        foreach (var e in autoEntries)
        {
            ws.Cell(row, 1).Value = autoIdx++;
            ws.Cell(row, 2).Value = (string)e.categoryName;
            ws.Cell(row, 3).Value = (string)e.activityName;
            ws.Cell(row, 4).Value = (string?)e.subItemName ?? "-";
            ws.Cell(row, 5).Value = (string?)e.count ?? "0";
            ws.Cell(row, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            decimal pts = (decimal)e.pointsEarned + (decimal)e.bonusEarned;
            ws.Cell(row, 6).Value = pts;
            ws.Cell(row, 6).Style.NumberFormat.Format = "General";
            ws.Cell(row, 6).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            if (pts > 0) ws.Cell(row, 6).Style.Fill.BackgroundColor = XLColor.LightBlue;
            totalAutoPoints += pts;
            if (autoIdx % 2 == 0) ws.Range(row, 1, row, 6).Style.Fill.BackgroundColor = XLColor.AliceBlue;
            row++;
        }
        // Auto total
        ws.Cell(row, 1).Value = "";
        ws.Range(row, 1, row, 5).Merge();
        ws.Cell(row, 1).Value = "Total Auto Points";
        ws.Cell(row, 1).Style.Font.Bold = true;
        ws.Cell(row, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        ws.Cell(row, 6).Value = totalAutoPoints;
        ws.Cell(row, 6).Style.Font.Bold = true;
        ws.Cell(row, 6).Style.Fill.BackgroundColor = XLColor.LightSkyBlue;
        ws.Cell(row, 6).Style.NumberFormat.Format = "General";
        ws.Cell(row, 6).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        row += 2;

        // MANUAL POINTS section
        ws.Cell(row, 1).Value = "MANUAL POINTS";
        ws.Range(row, 1, row, 6).Merge();
        ws.Cell(row, 1).Style.Font.Bold = true;
        ws.Cell(row, 1).Style.Font.FontSize = 13;
        ws.Cell(row, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(row, 1).Style.Fill.BackgroundColor = XLColor.SeaGreen;
        ws.Cell(row, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        row++;

        var manualHeaders = new[] { "#", "Category", "Question", "Answer", "Type", "Points" };
        for (int c = 0; c < manualHeaders.Length; c++)
        {
            ws.Cell(row, c + 1).Value = manualHeaders[c];
            ws.Cell(row, c + 1).Style.Font.Bold = true;
            ws.Cell(row, c + 1).Style.Fill.BackgroundColor = XLColor.LightGreen;
            ws.Cell(row, c + 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }
        row++;

        decimal totalManualPoints = 0;
        int manualIdx = 1;
        // Show all manual questions, answered or not
        foreach (var ms in allManualSubs)
        {
            var entry = manualEntries.FirstOrDefault(e => (string)e.title == (string)ms.title && (string)e.categoryName == (string)ms.categoryName);
            ws.Cell(row, 1).Value = manualIdx++;
            ws.Cell(row, 2).Value = (string)ms.categoryName;
            ws.Cell(row, 3).Value = (string)ms.title;
            ws.Cell(row, 4).Value = entry != null ? (string?)entry.answerValue ?? "0" : "0";
            ws.Cell(row, 4).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Cell(row, 5).Value = (string)ms.answerType;
            decimal pts = entry != null ? (decimal)entry.pointsEarned + (decimal)entry.bonusEarned : 0;
            ws.Cell(row, 6).Value = pts;
            ws.Cell(row, 6).Style.NumberFormat.Format = "General";
            ws.Cell(row, 6).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            if (pts > 0) ws.Cell(row, 6).Style.Fill.BackgroundColor = XLColor.LightGreen;
            totalManualPoints += pts;
            if (manualIdx % 2 == 0) ws.Range(row, 1, row, 6).Style.Fill.BackgroundColor = XLColor.Honeydew;
            row++;
        }
        // Manual total
        ws.Range(row, 1, row, 5).Merge();
        ws.Cell(row, 1).Value = "Total Manual Points";
        ws.Cell(row, 1).Style.Font.Bold = true;
        ws.Cell(row, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        ws.Cell(row, 6).Value = totalManualPoints;
        ws.Cell(row, 6).Style.Font.Bold = true;
        ws.Cell(row, 6).Style.Fill.BackgroundColor = XLColor.PaleGreen;
        ws.Cell(row, 6).Style.NumberFormat.Format = "General";
        ws.Cell(row, 6).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        row += 2;

        // GRAND TOTAL
        ws.Range(row, 1, row, 5).Merge();
        ws.Cell(row, 1).Value = "GRAND TOTAL";
        ws.Cell(row, 1).Style.Font.Bold = true;
        ws.Cell(row, 1).Style.Font.FontSize = 14;
        ws.Cell(row, 1).Style.Fill.BackgroundColor = XLColor.Gold;
        ws.Cell(row, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        ws.Cell(row, 6).Value = totalAutoPoints + totalManualPoints;
        ws.Cell(row, 6).Style.Font.Bold = true;
        ws.Cell(row, 6).Style.Font.FontSize = 14;
        ws.Cell(row, 6).Style.Fill.BackgroundColor = XLColor.Gold;
        ws.Cell(row, 6).Style.NumberFormat.Format = "General";
        ws.Cell(row, 6).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        // Column widths
        ws.Column(1).Width = 6;
        ws.Column(2).Width = 22;
        ws.Column(3).Width = 28;
        ws.Column(4).Width = 20;
        ws.Column(5).Width = 12;
        ws.Column(6).Width = 12;

        // Borders
        ws.Range(5, 1, row, 6).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        ws.Range(5, 1, row, 6).Style.Border.InsideBorder = XLBorderStyleValues.Thin;

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        var clubNameClean = ((string)club.clubName).Replace(" ", "_");
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"citation_{clubNameClean}_{yearId}.xlsx");
    }

    // ── Citation Available Years ──
    [HttpGet("api/district-modules/{districtId}/citation/available-years")]
    public async Task<ActionResult> GetCitationAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM district_citation_category c
            INNER JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.fk_district_id=@DistrictId AND c.isdeleted=0
            ORDER BY id DESC",
            new { DistrictId = districtId });
        return Ok(years);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Club Citation Entry ────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    // Get auto points (from saved entries) + manual questions with answers
    // Accepts optional ?yearId= to align with the dashboard's global year
    // selector — without this, the V2 page always showed current-year totals
    // while the Overview's Citation Score card reflected the selected year,
    // and the two diverged (user-reported 2026-06-12).
    [HttpGet("api/clubs/{clubId}/citation")]
    public async Task<ActionResult> GetClubCitation(int clubId, [FromQuery] int districtId, [FromQuery] int? yearId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });

        // NOTE: do NOT trigger CitationAutoPointsBackgroundService.CalculateForClubAsync here.
        // It scans every auto question + sub-item for the district and runs an UPSERT per
        // row — ~hundreds of round-trips for a single club. Running it on every GET made
        // this endpoint take 40-45 seconds. Users have an explicit "Refresh Auto Points"
        // button wired to POST /citation/refresh-auto for when they want fresh numbers;
        // GET should read the already-saved entries and return immediately.

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Resolve year: explicit yearId from query wins; otherwise current rotary year.
        dynamic? targetYear;
        if (yearId.HasValue && yearId.Value > 0)
        {
            targetYear = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_year_id AS id, YearLabel, StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Id AND isdeleted = 0 LIMIT 1",
                new { Id = yearId.Value });
        }
        else
        {
            targetYear = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_year_id AS id, YearLabel, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        }
        if (targetYear == null) return Ok(new { yearId = 0, autoEntries = Array.Empty<object>(), manualQuestions = Array.Empty<object>(), totalAuto = 0, totalManual = 0, grandTotal = 0 });

        int resolvedYearId = (int)targetYear.id;

        // Get description
        var desc = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT description_html AS descriptionHtml FROM district_citation_description WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, YearId = resolvedYearId });

        // Get auto entries (saved by background job)
        // subItemDisplay shows the area of focus a sub-item points at, so admins can tell the rows
        // apart without needing to remember the master table (matched via sub_item_id + sub_item_type).
        var autoEntries = (await conn.QueryAsync<dynamic>(@"
            SELECT e.pk_id AS id, e.fk_question_id AS questionId, e.fk_sub_question_id AS subQuestionId,
                   CAST(ROUND(e.points_earned) AS SIGNED) AS pointsEarned,
                   CAST(ROUND(e.bonus_earned) AS SIGNED) AS bonusEarned,
                   e.answer_value AS answerValue,
                   q.fk_category_id AS categoryId, cc.category_name AS categoryName,
                   a.activity_name AS activityName, a.sub_type AS subType,
                   CAST(ROUND(q.points) AS SIGNED) AS basePoints, q.is_bonus AS isBonus,
                   CAST(ROUND(q.bonus_points) AS SIGNED) AS bonusPoints,
                   q.min_bonus AS minBonus, q.max_bonus AS maxBonus,
                   s.sub_item_type AS subItemType, s.sub_item_name AS subItemName, s.sub_item_id AS subItemId,
                   CAST(ROUND(s.points) AS SIGNED) AS subBasePoints, s.is_bonus AS subIsBonus,
                   CAST(ROUND(s.bonus_points) AS SIGNED) AS subBonusPoints,
                   -- The FIRST branch is the one that matters (user, 2026-09-28: all extra and
                   -- wrong data). A sub-item stores its own name AND an id, but the id is only an
                   -- area-of-focus id for the avenue questions; for the others it numbers that
                   -- activity's own list. So: trust the stored name unless the area of focus it
                   -- points at carries that same name.
                   CASE
                       WHEN COALESCE(s.sub_item_name, '') <> ''
                            AND LOWER(TRIM(COALESCE(
                                CASE WHEN LOWER(s.sub_item_type) = 'area_of_focus' THEN aof_only.name END, ''))) <> LOWER(TRIM(s.sub_item_name))
                           THEN s.sub_item_name
                       WHEN LOWER(s.sub_item_type) = 'area_of_focus' THEN COALESCE(aof_only.name, s.sub_item_name)
                       ELSE s.sub_item_name
                   END AS subItemDisplay
            FROM district_citation_club_entry e
            INNER JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
            INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
            -- isdeleted = 0: a sub-item the district DELETED must vanish from the club's list
            -- too. Without it the club kept listing sub-items no longer in the district setup
            -- at all (864 such rows across 109 clubs in 2026-27).
            LEFT JOIN district_citation_auto_question_sub s ON s.pk_id = e.fk_sub_question_id AND s.isdeleted = 0
            LEFT JOIN area_of_focus_master aof_only ON LOWER(s.sub_item_type) = 'area_of_focus' AND aof_only.pk_area_of_focus_id = s.sub_item_id
            WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.fk_club_id=@ClubId AND e.entry_type='auto' AND e.isdeleted=0
              -- and drop the entry outright when its sub-item is gone: with the LEFT JOIN above
              -- it would otherwise survive as a nameless row carrying the question's points.
              AND (e.fk_sub_question_id IS NULL OR s.pk_id IS NOT NULL)
            ORDER BY cc.sort_order, q.sort_order, s.sort_order",
            new { DistrictId = districtId, YearId = resolvedYearId, ClubId = clubId })).ToList();

        // Get manual questions with club's answers
        var manualCriteria = (await conn.QueryAsync<dynamic>(@"
            SELECT mc.pk_id AS criteriaId, mc.fk_category_id AS categoryId, cc.category_name AS categoryName, mc.sort_order AS sortOrder
            FROM district_citation_manual_criteria mc
            INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
            WHERE mc.fk_district_id=@DistrictId AND mc.fk_year_id=@YearId AND mc.isdeleted=0
            ORDER BY cc.sort_order, mc.sort_order",
            new { DistrictId = districtId, YearId = resolvedYearId })).ToList();

        var mcIds = manualCriteria.Select(c => (int)c.criteriaId).ToList();
        var subCriteria = mcIds.Count > 0
            ? (await conn.QueryAsync<dynamic>(@"
                SELECT sc.pk_id AS id, sc.fk_criteria_id AS criteriaId, sc.sub_criteria_title AS title, sc.answer_type AS answerType,
                       CAST(ROUND(sc.points) AS SIGNED) AS points, sc.is_bonus AS isBonus,
                       CAST(ROUND(sc.bonus_points) AS SIGNED) AS bonusPoints,
                       sc.min_bonus AS minBonus, sc.max_bonus AS maxBonus, sc.remark
                FROM district_citation_manual_sub_criteria sc WHERE sc.fk_criteria_id IN @Ids AND sc.isdeleted=0 ORDER BY sc.sort_order",
                new { Ids = mcIds })).ToList()
            : new List<dynamic>();

        var subIds = subCriteria.Select(s => (int)s.id).ToList();
        var options = subIds.Count > 0
            ? (await conn.QueryAsync<dynamic>(@"
                SELECT pk_id AS id, fk_sub_criteria_id AS subCriteriaId, option_text AS optionText,
                       CAST(ROUND(option_points) AS SIGNED) AS optionPoints
                FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted=0 ORDER BY sort_order",
                new { Ids = subIds })).ToList()
            : new List<dynamic>();

        // Get club's manual entries
        var manualEntries = subIds.Count > 0
            ? (await conn.QueryAsync<dynamic>(@"
                SELECT fk_question_id AS subCriteriaId, answer_value AS answerValue,
                       CAST(ROUND(points_earned) AS SIGNED) AS pointsEarned,
                       CAST(ROUND(bonus_earned) AS SIGNED) AS bonusEarned
                FROM district_citation_club_entry
                WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId AND entry_type='manual' AND fk_question_id IN @Ids AND isdeleted=0",
                new { DistrictId = districtId, YearId = resolvedYearId, ClubId = clubId, Ids = subIds })).ToDictionary(e => (int)e.subCriteriaId)
            : new Dictionary<int, dynamic>();

        // Build manual questions with answers
        foreach (var sc in subCriteria)
        {
            sc.options = options.Where(o => (int)o.subCriteriaId == (int)sc.id).ToList();
            var entry = manualEntries.ContainsKey((int)sc.id) ? manualEntries[(int)sc.id] : null;
            sc.answerValue = entry != null ? (string?)entry.answerValue : null;
            sc.pointsEarned = entry != null ? Convert.ToInt32(entry.pointsEarned) : 0;
            sc.bonusEarned = entry != null ? Convert.ToInt32(entry.bonusEarned) : 0;
        }
        foreach (var mc in manualCriteria)
            mc.subCriteria = subCriteria.Where(s => (int)s.criteriaId == (int)mc.criteriaId).ToList();

        // Explicit foreach instead of LINQ Sum() — Sum() on List<dynamic> with a
        // lambda whose body uses dynamic property reads dispatches via the C#
        // dynamic binder, which can fail to pick the long-returning overload at
        // runtime ("Failed to load awards data" crash on the V2 club page).
        long totalAuto = 0;
        foreach (var e in autoEntries)
            totalAuto += Convert.ToInt64(e.pointsEarned) + Convert.ToInt64(e.bonusEarned);
        long totalManual = 0;
        foreach (var s in subCriteria)
            totalManual += Convert.ToInt64(s.pointsEarned) + Convert.ToInt64(s.bonusEarned);

        return Ok(new {
            yearId = resolvedYearId,
            yearLabel = (string)targetYear.YearLabel,
            descriptionHtml = desc != null ? (string?)desc.descriptionHtml : null,
            autoEntries, manualQuestions = manualCriteria,
            totalAuto, totalManual, grandTotal = totalAuto + totalManual
        });
    }

    // Save manual entries
    // PointsEarned/BonusEarned are decimal — DB columns are DECIMAL(10,2). Earlier
    // int typing rejected decimal payloads from mobile with "could not be converted
    // to System.Int32", which also tripped the "entries field is required" error
    // because the whole list failed to deserialize.
    public class ClubManualEntryDto
    {
        public int DistrictId { get; set; }
        public int SubCriteriaId { get; set; }
        public string? AnswerValue { get; set; }
        public decimal PointsEarned { get; set; }
        public decimal BonusEarned { get; set; }
    }

    [HttpPost("api/clubs/{clubId}/citation/save-manual")]
    public async Task<ActionResult> SaveClubManualEntries(int clubId, [FromBody] List<ClubManualEntryDto> entries)
    {
        if (entries.Count == 0) return Ok(new { message = "Nothing to save." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        int userId = GetUserId();

        var currentYear = await conn.QueryFirstOrDefaultAsync<dynamic>("SELECT pk_year_id AS id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (currentYear == null) return BadRequest(new { message = "No current year." });
        int yearId = (int)currentYear.id;
        int districtId = entries[0].DistrictId;

        // Gate: if a SuperAdmin has DISABLED District Awards for this district+year, clubs are
        // read-only — reject the save server-side so it can't be bypassed from the UI.
        if (!await RotaryApi.Services.DistrictAwardsConfigHelper.IsEnabledAsync(conn, districtId, yearId))
            return StatusCode(403, new { message = "District Awards is currently disabled by the administrator. Point entry is read-only." });

        // No negative figures (user 2026-10-08) - same rule as the Save button on the club form.
        if (entries.Any(e => e.PointsEarned < 0 || e.BonusEarned < 0
                || (decimal.TryParse(e.AnswerValue, System.Globalization.NumberStyles.Number,
                        System.Globalization.CultureInfo.InvariantCulture, out var n) && n < 0)))
            return BadRequest(new { message = "Points cannot be negative. Please enter 0 or more." });

        foreach (var e in entries)
        {
            var existing = await conn.ExecuteScalarAsync<int?>(
                @"SELECT pk_id FROM district_citation_club_entry
                  WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId AND entry_type='manual' AND fk_question_id=@QId AND isdeleted=0",
                new { DistrictId = districtId, YearId = yearId, ClubId = clubId, QId = e.SubCriteriaId });

            if (existing.HasValue)
                await conn.ExecuteAsync(
                    "UPDATE district_citation_club_entry SET answer_value=@Answer, points_earned=@Points, bonus_earned=@Bonus, modified_by=@UserId, modified_date=NOW() WHERE pk_id=@Id",
                    new { Id = existing.Value, Answer = e.AnswerValue, Points = e.PointsEarned, Bonus = e.BonusEarned, UserId = userId });
            else
                await conn.ExecuteAsync(
                    @"INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, answer_value, points_earned, bonus_earned, created_by, created_date)
                      VALUES (@DistrictId, @YearId, @ClubId, 'manual', @QId, @Answer, @Points, @Bonus, @UserId, NOW())",
                    new { DistrictId = districtId, YearId = yearId, ClubId = clubId, QId = e.SubCriteriaId, Answer = e.AnswerValue, Points = e.PointsEarned, Bonus = e.BonusEarned, UserId = userId });
        }
        return Ok(new { message = "Manual entries saved." });
    }

    // Trigger manual refresh of auto points for a specific club
    [HttpPost("api/clubs/{clubId}/citation/refresh-auto")]
    public async Task<ActionResult> RefreshClubAutoPoints(int clubId, [FromQuery] int districtId)
    {
        var bgService = HttpContext.RequestServices.GetRequiredService<CitationAutoPointsBackgroundService>();
        await bgService.CalculateForClubAsync(districtId, clubId);
        return Ok(new { message = "Auto points refreshed." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Committee: Search District Members ────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/committee/search-members")]
    public async Task<ActionResult> SearchDistrictCommitteeMembers(int districtId, [FromQuery] string? search)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (string.IsNullOrWhiteSpace(search) || search.Length < 2)
            return Ok(Array.Empty<object>());
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS name,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   cm.fk_club_id AS clubId,
                   c.ClubName AS clubName
            FROM member_master_profile m
            INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE c.fk_district_id = @DistrictId
              AND m.isdeleted = 0
              AND (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
            ORDER BY m.MemberName
            LIMIT 20",
            new { DistrictId = districtId, Search = $"%{search}%" });
        return Ok(members);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Committee: Photo Upload ───────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpPost("api/districts/{districtId}/committee/upload-photo")]
    public async Task<ActionResult> UploadCommitteePhoto(int districtId, IFormFile file, [FromQuery] bool isMember = false, [FromQuery] int? clubId = null)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded" });
        // Rotarian photos go to /Documents/directory/ (matches legacy example.org layout).
        // Non-member photos go to /Documents/DistrictCommittee/Group<clubId|districtId>/
        // — preserves the legacy folder pattern when a club is associated, otherwise falls
        //   back to the district id (current behavior when no clubId is supplied).
        string relFolder;
        if (isMember)
        {
            relFolder = "Documents/directory";
        }
        else
        {
            var groupKey = clubId.HasValue && clubId.Value > 0 ? clubId.Value : districtId;
            relFolder = $"Documents/DistrictCommittee/Group{groupKey}";
        }
        var folder = Path.Combine(_env.WebRootPath, relFolder.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(folder);
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(folder, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return Ok(new { path = $"/{relFolder}/{fileName}" });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Committee Members (Level 1) ───────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/committee/members")]
    public async Task<ActionResult> GetCommitteeMembers(int districtId, [FromQuery] int? yearId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 200) pageSize = 200;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var where = @"WHERE dcm.fk_district_id = @DistrictId AND dcm.isdeleted = 0";
        if (yearId.HasValue) where += " AND dcm.fk_year_id = @YearId";
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += @" AND (dcm.name LIKE @Search OR dcm.mobile LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR dcm.email LIKE @Search OR m.EmailId LIKE @Search
                         OR (CASE WHEN COALESCE(dcm.fk_member_id,0) > 0 THEN c.ClubName ELSE dcm.club_name END) LIKE @Search)";
        }

        var countSql = @"SELECT COUNT(DISTINCT dcm.id)
                         FROM district_committee_member dcm
                         LEFT JOIN club_master c ON c.pk_club_id = dcm.fk_club_id
                         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id AND m.isdeleted = 0
                         " + where;
        var parameters = new DynamicParameters();
        parameters.Add("DistrictId", districtId);
        parameters.Add("YearId", yearId);
        parameters.Add("Search", string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%");
        var totalCount = await conn.ExecuteScalarAsync<int>(countSql, parameters);

        // Photo URL CASE — relative path for the 302 Media:RedirectBaseUrl mapper:
        //   member  → /Documents/directory/<filename>      (legacy rotarian layout)
        //   non-member → /Documents/DistrictCommittee/Group<clubId|districtId>/<filename>
        //   any value already starting with '/' is returned as-is (already a path).
        var pageSql = @"SELECT dcm.id, dcm.fk_district_id AS districtId, dcm.fk_year_id AS yearId,
                               dcm.fk_member_id AS memberId, dcm.is_member AS isMember,
                               dcm.name,
                               -- Member rows: LIVE profile mobile + email, so a Directory edit shows here at once.
                               -- dcm.mobile/email are only add-time copies (kept for non-members). Name stays
                               -- as typed: committee names carry titles (Dr./Mr.) the profile doesn't.
                               CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                                    THEN m.PrimaryMobileNumber ELSE dcm.mobile END AS mobile,
                               CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                                    THEN m.EmailId ELSE dcm.email END AS email,
                               dcm.district_designation AS districtDesignation,
                               dcm.fk_club_id AS clubId,
                               CASE WHEN COALESCE(dcm.fk_member_id,0) > 0 THEN c.ClubName ELSE dcm.club_name END AS clubName,
                               dcm.district_remark AS districtRemark,
                               CASE
                                   -- Member rows: prefer the LIVE member photo so a directory upload shows
                                   -- immediately. dcm.profile_photo is only a stale add-time snapshot — falling
                                   -- through to it (below) left newly-uploaded photos blank.
                                   WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND m.ProfilePhotoPath IS NOT NULL AND m.ProfilePhotoPath <> '' THEN
                                        CASE WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                             ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                                   -- Member with NO profile photo shows none: the photo lives on the member
                                   -- profile only, so a removal there removes it here too (2026-10-06).
                                   WHEN COALESCE(dcm.fk_member_id, 0) > 0 THEN NULL
                                   WHEN dcm.profile_photo IS NULL OR dcm.profile_photo = '' THEN NULL
                                   WHEN dcm.profile_photo LIKE '/%' THEN dcm.profile_photo
                                   ELSE CONCAT('/Documents/DistrictCommittee/Group', COALESCE(dcm.fk_club_id, dcm.fk_district_id), '/', dcm.profile_photo)
                               END AS profilePhoto,
                               dcm.sort_order AS sortOrder, dcm.is_active AS isActive,
                               y.YearLabel AS yearLabel
                        FROM district_committee_member dcm
                        LEFT JOIN club_master c ON c.pk_club_id = dcm.fk_club_id
                        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id AND m.isdeleted = 0
                        LEFT JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
                        " + where + @"
                        ORDER BY dcm.sort_order
                        LIMIT @PageSize OFFSET @Offset";
        parameters.Add("PageSize", pageSize);
        parameters.Add("Offset", (page - 1) * pageSize);
        var items = await conn.QueryAsync<dynamic>(pageSql, parameters);

        var totalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize);
        return Ok(new { items, totalCount, page, pageSize, totalPages });
    }

    [HttpGet("api/districts/{districtId}/committee/members/available-years")]
    public async Task<ActionResult> GetCommitteeMemberAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM district_committee_member dcm
            INNER JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
            WHERE dcm.fk_district_id = @DistrictId AND dcm.isdeleted = 0
            ORDER BY y.pk_year_id DESC",
            new { DistrictId = districtId });
        return Ok(years);
    }

    [HttpPost("api/districts/{districtId}/committee/members")]
    public async Task<ActionResult> CreateCommitteeMember(int districtId, [FromBody] DistrictCommitteeMemberDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Append to the END of the manually-sorted list (per district + year) so a
        // new member never disturbs the existing order.
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_member WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, dto.YearId });
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_member (fk_district_id, fk_year_id, fk_member_id, is_member, name, mobile, email,
                district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
            VALUES (@DistrictId, @YearId, @MemberId, @IsMember, @Name, @Mobile, @Email,
                @DistrictDesignation, @ClubId, @ClubName, @DistrictRemark, @ProfilePhoto, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { DistrictId = districtId, dto.YearId, dto.MemberId, dto.IsMember, dto.Name, dto.Mobile, dto.Email,
                  dto.DistrictDesignation, dto.ClubId, ClubName = (dto.MemberId.HasValue && dto.MemberId.Value > 0) ? null : dto.ClubName, dto.DistrictRemark, dto.ProfilePhoto, SortOrder = nextSort, UserId = GetUserId() });
        return Ok(new { id, message = "Committee member added." });
    }

    [HttpPut("api/districts/{districtId}/committee/members/{id}")]
    public async Task<ActionResult> UpdateCommitteeMember(int districtId, int id, [FromBody] DistrictCommitteeMemberDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE district_committee_member SET fk_year_id=@YearId, fk_member_id=@MemberId, is_member=@IsMember,
                name=@Name, mobile=@Mobile, email=@Email, district_designation=@DistrictDesignation,
                fk_club_id=@ClubId, club_name=@ClubName, district_remark=@DistrictRemark, profile_photo=@ProfilePhoto, modified_by=@UserId
            WHERE id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
            new { Id = id, DistrictId = districtId, dto.YearId, dto.MemberId, dto.IsMember, dto.Name, dto.Mobile, dto.Email,
                  dto.DistrictDesignation, dto.ClubId, ClubName = (dto.MemberId.HasValue && dto.MemberId.Value > 0) ? null : dto.ClubName, dto.DistrictRemark, dto.ProfilePhoto, UserId = GetUserId() });
        return Ok(new { message = "Committee member updated." });
    }

    [HttpDelete("api/districts/{districtId}/committee/members/{id}")]
    public async Task<ActionResult> DeleteCommitteeMember(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync("UPDATE district_committee_member SET isdeleted=1 WHERE id=@Id AND fk_district_id=@DistrictId",
            new { Id = id, DistrictId = districtId });
        return Ok(new { message = "Committee member deleted." });
    }

    // Non-sync cascade (Phase 4): committee members that were soft-deleted because their club
    // went NON-SYNC. Surfaced greyed so a DC admin can re-add them as a non-member.
    [HttpGet("api/districts/{districtId}/committee/members/non-sync-removed")]
    public async Task<ActionResult> GetCommitteeMembersNonSyncRemoved(int districtId, [FromQuery] int? yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var where = @"WHERE dcm.fk_district_id = @DistrictId AND dcm.isdeleted = 1 AND dcm.fk_club_id IS NOT NULL
                      AND EXISTS (SELECT 1 FROM club_master c WHERE c.pk_club_id = dcm.fk_club_id
                                    AND c.isdeleted = 0 AND IFNULL(c.IsSyncedFromRotaryOrg,0) = 0)";
        if (yearId.HasValue) where += " AND dcm.fk_year_id = @YearId";
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT dcm.id, dcm.fk_member_id AS memberId, dcm.is_member AS isMember, dcm.name, dcm.mobile, dcm.email,
                   dcm.district_designation AS districtDesignation, dcm.fk_club_id AS clubId, c.ClubName AS clubName,
                   dcm.district_remark AS districtRemark, dcm.profile_photo AS profilePhoto, dcm.fk_year_id AS yearId
            FROM district_committee_member dcm
            LEFT JOIN club_master c ON c.pk_club_id = dcm.fk_club_id
            " + where + " ORDER BY dcm.name",
            new { DistrictId = districtId, YearId = yearId });
        return Ok(new { items });
    }

    // Re-add a non-sync-removed committee member as a NON-member (is_member=0, no fk_club_id;
    // keeps fk_member_id + name/mobile/email so their identity is preserved).
    [HttpPost("api/districts/{districtId}/committee/members/{id}/add-as-non-member")]
    public async Task<ActionResult> AddCommitteeMemberAsNonMember(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var src = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_year_id AS yearId, fk_member_id AS memberId, name, mobile, email,
                     district_designation AS designation, district_remark AS remark, profile_photo AS photo
              FROM district_committee_member WHERE id=@Id AND fk_district_id=@DistrictId LIMIT 1",
            new { Id = id, DistrictId = districtId });
        if (src == null) return NotFound(new { message = "Committee member not found." });
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_member WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, YearId = (int?)src.yearId });
        var newId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_member (fk_district_id, fk_year_id, fk_member_id, is_member, name, mobile, email,
                district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
            VALUES (@DistrictId, @YearId, @MemberId, 0, @Name, @Mobile, @Email,
                @Designation, NULL, NULL, @Remark, @Photo, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { DistrictId = districtId, YearId = (int?)src.yearId, MemberId = (int?)src.memberId,
                  Name = (string?)src.name, Mobile = (string?)src.mobile, Email = (string?)src.email,
                  Designation = (string?)src.designation, Remark = (string?)src.remark, Photo = (string?)src.photo,
                  SortOrder = nextSort, UserId = GetUserId() });
        return Ok(new { id = newId, message = "Added as non-member." });
    }

    // ── Non-sync-removed GROUP members + add-as-non-member ──
    [HttpGet("api/districts/{districtId}/committee/groups/{groupId}/members/non-sync-removed")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    public async Task<ActionResult> GetGroupMembersNonSyncRemoved(int districtId, int groupId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT gm.id, gm.fk_member_id AS memberId, gm.is_member AS isMember, gm.name, gm.mobile, gm.email,
                   gm.district_designation AS districtDesignation, gm.fk_club_id AS clubId, c.ClubName AS clubName,
                   gm.district_remark AS districtRemark, gm.profile_photo AS profilePhoto
            FROM district_committee_group_member gm
            LEFT JOIN club_master c ON c.pk_club_id = gm.fk_club_id
            WHERE gm.fk_group_id = @GroupId AND gm.isdeleted = 1 AND gm.fk_club_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM club_master cc WHERE cc.pk_club_id = gm.fk_club_id
                            AND cc.isdeleted = 0 AND IFNULL(cc.IsSyncedFromRotaryOrg,0) = 0)
            ORDER BY gm.name",
            new { GroupId = groupId });
        return Ok(new { items });
    }

    [HttpPost("api/districts/{districtId}/committee/groups/{groupId}/members/{id}/add-as-non-member")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    [OwnedBy(Owns.CommitteeGroupMember, "id", "groupId")]
    public async Task<ActionResult> AddGroupMemberAsNonMember(int districtId, int groupId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rejection = await RejectIfAutoManagedGroupByIdAsync(conn, groupId);
        if (rejection != null) return rejection;
        var src = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_member_id AS memberId, name, mobile, email, district_designation AS designation,
                     district_remark AS remark, profile_photo AS photo
              FROM district_committee_group_member WHERE id=@Id AND fk_group_id=@GroupId LIMIT 1",
            new { Id = id, GroupId = groupId });
        if (src == null) return NotFound(new { message = "Group member not found." });
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_group_member WHERE fk_group_id=@GroupId AND isdeleted=0",
            new { GroupId = groupId });
        var newId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_group_member (fk_group_id, fk_member_id, is_member, name, mobile, email,
                district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
            VALUES (@GroupId, @MemberId, 0, @Name, @Mobile, @Email, @Designation, NULL, NULL, @Remark, @Photo, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { GroupId = groupId, MemberId = (int?)src.memberId, Name = (string?)src.name, Mobile = (string?)src.mobile,
                  Email = (string?)src.email, Designation = (string?)src.designation, Remark = (string?)src.remark,
                  Photo = (string?)src.photo, SortOrder = nextSort, UserId = GetUserId() });
        return Ok(new { id = newId, message = "Added as non-member." });
    }

    // ── Non-sync-removed SUB-GROUP members + add-as-non-member ──
    [HttpGet("api/districts/{districtId}/committee/sub-groups/{subGroupId}/members/non-sync-removed")]
    [OwnedBy(Owns.CommitteeSubGroup, "subGroupId", "districtId")]
    public async Task<ActionResult> GetSubGroupMembersNonSyncRemoved(int districtId, int subGroupId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT sgm.id, sgm.fk_member_id AS memberId, sgm.is_member AS isMember, sgm.name, sgm.mobile, sgm.email,
                   sgm.district_designation AS districtDesignation, sgm.fk_club_id AS clubId, c.ClubName AS clubName,
                   sgm.district_remark AS districtRemark, sgm.profile_photo AS profilePhoto
            FROM district_committee_sub_group_member sgm
            LEFT JOIN club_master c ON c.pk_club_id = sgm.fk_club_id
            WHERE sgm.fk_sub_group_id = @SubGroupId AND sgm.isdeleted = 1 AND sgm.fk_club_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM club_master cc WHERE cc.pk_club_id = sgm.fk_club_id
                            AND cc.isdeleted = 0 AND IFNULL(cc.IsSyncedFromRotaryOrg,0) = 0)
            ORDER BY sgm.name",
            new { SubGroupId = subGroupId });
        return Ok(new { items });
    }

    [HttpPost("api/districts/{districtId}/committee/sub-groups/{subGroupId}/members/{id}/add-as-non-member")]
    [OwnedBy(Owns.CommitteeSubGroup, "subGroupId", "districtId")]
    [OwnedBy(Owns.CommitteeSubGroupMember, "id", "subGroupId")]
    public async Task<ActionResult> AddSubGroupMemberAsNonMember(int districtId, int subGroupId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var src = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_member_id AS memberId, name, mobile, email, district_designation AS designation,
                     district_remark AS remark, profile_photo AS photo
              FROM district_committee_sub_group_member WHERE id=@Id AND fk_sub_group_id=@SubGroupId LIMIT 1",
            new { Id = id, SubGroupId = subGroupId });
        if (src == null) return NotFound(new { message = "Sub-group member not found." });
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_sub_group_member WHERE fk_sub_group_id=@SubGroupId AND isdeleted=0",
            new { SubGroupId = subGroupId });
        var newId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_sub_group_member (fk_sub_group_id, fk_member_id, is_member, name, mobile, email,
                district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
            VALUES (@SubGroupId, @MemberId, 0, @Name, @Mobile, @Email, @Designation, NULL, NULL, @Remark, @Photo, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { SubGroupId = subGroupId, MemberId = (int?)src.memberId, Name = (string?)src.name, Mobile = (string?)src.mobile,
                  Email = (string?)src.email, Designation = (string?)src.designation, Remark = (string?)src.remark,
                  Photo = (string?)src.photo, UserId = GetUserId() });
        return Ok(new { id = newId, message = "Added as non-member." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Committee Groups (Level 2) ────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/committee/groups")]
    public async Task<ActionResult> GetCommitteeGroups(int districtId, [FromQuery] int? yearId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 200) pageSize = 200;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var where = @"WHERE g.fk_district_id = @DistrictId AND g.isdeleted = 0";
        if (yearId.HasValue) where += " AND g.fk_year_id = @YearId";
        if (!string.IsNullOrWhiteSpace(search)) where += " AND g.group_name LIKE @Search";

        var parameters = new DynamicParameters();
        parameters.Add("DistrictId", districtId);
        parameters.Add("YearId", yearId);
        parameters.Add("Search", string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%");

        var countSql = "SELECT COUNT(*) FROM district_committee_group g " + where;
        var totalCount = await conn.ExecuteScalarAsync<int>(countSql, parameters);

        var pageSql = @"SELECT g.id, g.fk_district_id AS districtId, g.fk_year_id AS yearId,
                               g.group_name AS groupName, g.sort_order AS sortOrder, g.is_active AS isActive,
                               y.YearLabel AS yearLabel,
                               (SELECT COUNT(*) FROM district_committee_group_member gm WHERE gm.fk_group_id = g.id AND gm.isdeleted = 0) AS memberCount,
                               (SELECT COUNT(*) FROM district_committee_sub_group sg WHERE sg.fk_group_id = g.id AND sg.isdeleted = 0) AS subGroupCount
                        FROM district_committee_group g
                        LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
                        " + where + @"
                        ORDER BY g.sort_order, g.group_name
                        LIMIT @PageSize OFFSET @Offset";
        parameters.Add("PageSize", pageSize);
        parameters.Add("Offset", (page - 1) * pageSize);
        var items = await conn.QueryAsync<dynamic>(pageSql, parameters);

        var totalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize);
        return Ok(new { items, totalCount, page, pageSize, totalPages });
    }

    // Lightweight single-group lookup — used by group detail page to populate breadcrumb
    // without paying the COUNT-subquery cost of the paginated list endpoint.
    [HttpGet("api/districts/{districtId}/committee/groups/{groupId}")]
    public async Task<ActionResult> GetCommitteeGroupById(int districtId, int groupId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var group = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT g.id, g.fk_district_id AS districtId, g.fk_year_id AS yearId,
                   g.group_name AS groupName, g.is_active AS isActive,
                   y.YearLabel AS yearLabel
            FROM district_committee_group g
            LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
            WHERE g.id = @GroupId AND g.fk_district_id = @DistrictId AND g.isdeleted = 0",
            new { GroupId = groupId, DistrictId = districtId });
        if (group == null) return NotFound(new { message = "Group not found." });
        return Ok(group);
    }

    [HttpGet("api/districts/{districtId}/committee/groups/available-years")]
    public async Task<ActionResult> GetCommitteeGroupAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM district_committee_group g
            INNER JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
            WHERE g.fk_district_id = @DistrictId AND g.isdeleted = 0
            ORDER BY y.pk_year_id DESC",
            new { DistrictId = districtId });
        return Ok(years);
    }

    [HttpPost("api/districts/{districtId}/committee/groups")]
    public async Task<ActionResult> CreateCommitteeGroup(int districtId, [FromBody] DistrictCommitteeGroupDto dto)
    {
        // Reject if user tries to manually create a "Club Presidents" or "Club Secretaries" group
        var rejection = RejectIfAutoManagedGroupByName(dto.GroupName);
        if (rejection != null) return rejection;

        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Append to the END of the manually-sorted group list (per district + year).
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_group WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, dto.YearId });
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, sort_order, created_by)
            VALUES (@DistrictId, @YearId, @GroupName, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { DistrictId = districtId, dto.YearId, dto.GroupName, SortOrder = nextSort, UserId = GetUserId() });
        return Ok(new { id, message = "Group created." });
    }

    [HttpPut("api/districts/{districtId}/committee/groups/{id}")]
    public async Task<ActionResult> UpdateCommitteeGroup(int districtId, int id, [FromBody] DistrictCommitteeGroupDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Block if EITHER the existing group OR the new name is an auto-managed CP/CS group
        var existingReject = await RejectIfAutoManagedGroupByIdAsync(conn, id);
        if (existingReject != null) return existingReject;
        var nameReject = RejectIfAutoManagedGroupByName(dto.GroupName);
        if (nameReject != null) return nameReject;

        // Only overwrite the year when a real one is supplied. An inline rename sends
        // just the name (YearId = 0); preserve the group's existing year so it doesn't
        // vanish from the year-filtered listing.
        await conn.ExecuteAsync(@"
            UPDATE district_committee_group
            SET group_name=@GroupName,
                fk_year_id = IF(@YearId > 0, @YearId, fk_year_id),
                modified_by=@UserId
            WHERE id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
            new { Id = id, DistrictId = districtId, dto.GroupName, dto.YearId, UserId = GetUserId() });
        return Ok(new { message = "Group updated." });
    }

    [HttpDelete("api/districts/{districtId}/committee/groups/{id}")]
    public async Task<ActionResult> DeleteCommitteeGroup(int districtId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rejection = await RejectIfAutoManagedGroupByIdAsync(conn, id);
        if (rejection != null) return rejection;

        // Also soft-delete group members, sub-groups and sub-group members
        await conn.ExecuteAsync("UPDATE district_committee_group SET isdeleted=1 WHERE id=@Id AND fk_district_id=@DistrictId", new { Id = id, DistrictId = districtId });
        await conn.ExecuteAsync("UPDATE district_committee_group_member SET isdeleted=1 WHERE fk_group_id=@Id", new { Id = id });
        var subGroupIds = await conn.QueryAsync<int>("SELECT id FROM district_committee_sub_group WHERE fk_group_id=@Id AND isdeleted=0", new { Id = id });
        if (subGroupIds.Any())
        {
            await conn.ExecuteAsync("UPDATE district_committee_sub_group SET isdeleted=1 WHERE fk_group_id=@Id", new { Id = id });
            await conn.ExecuteAsync($"UPDATE district_committee_sub_group_member SET isdeleted=1 WHERE fk_sub_group_id IN ({string.Join(",", subGroupIds)})");
        }
        return Ok(new { message = "Group deleted." });
    }

    // ── Group Members ──────────────────────────────────────────────────

    [HttpGet("api/districts/{districtId}/committee/groups/{groupId}/members")]
    public async Task<ActionResult> GetGroupMembers(int districtId, int groupId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 200) pageSize = 200;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var where = "WHERE gm.fk_group_id = @GroupId AND gm.isdeleted = 0";
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += @" AND (gm.name LIKE @Search OR gm.mobile LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR gm.email LIKE @Search OR m.EmailId LIKE @Search
                         OR (CASE WHEN COALESCE(gm.fk_member_id,0) > 0 THEN c.ClubName ELSE gm.club_name END) LIKE @Search)";
        }

        var parameters = new DynamicParameters();
        parameters.Add("GroupId", groupId);
        parameters.Add("Search", string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%");

        var countSql = @"SELECT COUNT(DISTINCT gm.id)
                         FROM district_committee_group_member gm
                         LEFT JOIN club_master c ON c.pk_club_id = gm.fk_club_id
                         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = gm.fk_member_id AND m.isdeleted = 0
                         " + where;
        var totalCount = await conn.ExecuteScalarAsync<int>(countSql, parameters);

        // Photo URL CASE — same logic as level-1 committee members.
        // Group members don't carry fk_district_id, so non-member fallback uses fk_club_id (legacy
        // group folders only existed when a club was attached).
        // Enriched (2026-07-10) with: classification (from club_members), spouseName / spouseDob /
        // spousePhoto (from member_family_details WHERE Relation='Spouse'), mobileCountryCode
        // (from country_master via member_master_profile.fk_primary_country_id).
        var pageSql = @"SELECT gm.id, gm.fk_group_id AS groupId, gm.fk_member_id AS memberId, gm.is_member AS isMember,
                               gm.name,
                               -- Member rows: LIVE profile mobile + email (same rule as level-1 committee).
                               CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                                    THEN m.PrimaryMobileNumber ELSE gm.mobile END AS mobile,
                               CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                                    THEN m.EmailId ELSE gm.email END AS email,
                               gm.district_designation AS districtDesignation,
                               gm.fk_club_id AS clubId,
                               CASE WHEN COALESCE(gm.fk_member_id,0) > 0 THEN c.ClubName ELSE gm.club_name END AS clubName,
                               gm.district_remark AS districtRemark,
                               CASE
                                   -- Member rows: prefer the LIVE member photo (same fix as level-1 committee).
                                   WHEN COALESCE(gm.fk_member_id, 0) > 0 AND m.ProfilePhotoPath IS NOT NULL AND m.ProfilePhotoPath <> '' THEN
                                        CASE WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                             ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                                   -- Member with NO profile photo shows none (photo lives on the profile only).
                                   WHEN COALESCE(gm.fk_member_id, 0) > 0 THEN NULL
                                   WHEN gm.profile_photo IS NULL OR gm.profile_photo = '' THEN NULL
                                   WHEN gm.profile_photo LIKE '/%' THEN gm.profile_photo
                                   ELSE CONCAT('/Documents/DistrictCommittee/Group', COALESCE(gm.fk_club_id, 0), '/', gm.profile_photo)
                               END AS profilePhoto,
                               gm.sort_order AS sortOrder, gm.is_active AS isActive,
                               cls.ClassificationProfession AS classification,
                               sp.Name       AS spouseName,
                               sp.BirthDate  AS spouseDob,
                               CASE
                                   WHEN sp.PhotoPath IS NULL OR sp.PhotoPath = '' THEN NULL
                                   WHEN sp.PhotoPath LIKE '/%'    THEN sp.PhotoPath
                                   WHEN sp.PhotoPath LIKE 'http%' THEN sp.PhotoPath
                                   ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(sp.PhotoPath, '/', -1))
                               END           AS spousePhoto,
                               cty.PhoneCode     AS mobileCountryCode,
                               cty.pk_country_id AS mobileCountryId,
                               cty.CountryName   AS mobileCountryName
                        FROM district_committee_group_member gm
                        LEFT JOIN club_master c ON c.pk_club_id = gm.fk_club_id
                        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = gm.fk_member_id AND m.isdeleted = 0
                        LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
                        LEFT JOIN (
                            SELECT cm.fk_member_master_profile_id, cm.ClassificationProfession
                            FROM club_members cm
                            JOIN (
                                SELECT fk_member_master_profile_id, MIN(pk_club_member_id) AS pk_id
                                FROM club_members
                                WHERE COALESCE(isdeleted,0) = 0 AND IsActive = 1
                                  AND ClassificationProfession IS NOT NULL AND ClassificationProfession <> ''
                                GROUP BY fk_member_master_profile_id
                            ) pick ON pick.pk_id = cm.pk_club_member_id
                        ) cls ON cls.fk_member_master_profile_id = gm.fk_member_id
                        LEFT JOIN (
                            SELECT f.fk_member_master_profile_id, f.Name, f.BirthDate, f.PhotoPath
                            FROM member_family_details f
                            JOIN (
                                -- Latest-changed spouse row, same pick as the Directory.
                                SELECT pk_member_family_details_id AS pk_id,
                                       ROW_NUMBER() OVER (PARTITION BY fk_member_master_profile_id
                                                          ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC) AS rn
                                FROM member_family_details
                                WHERE LOWER(TRIM(Relation)) = 'spouse' AND COALESCE(isdeleted,0) = 0
                            ) pick ON pick.pk_id = f.pk_member_family_details_id AND pick.rn = 1
                        ) sp ON sp.fk_member_master_profile_id = gm.fk_member_id
                        " + where + @"
                        ORDER BY gm.sort_order
                        LIMIT @PageSize OFFSET @Offset";
        parameters.Add("PageSize", pageSize);
        parameters.Add("Offset", (page - 1) * pageSize);
        var items = await conn.QueryAsync<dynamic>(pageSql, parameters);

        var totalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize);
        return Ok(new { items, totalCount, page, pageSize, totalPages });
    }

    [HttpPost("api/districts/{districtId}/committee/groups/{groupId}/members")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    public async Task<ActionResult> CreateGroupMember(int districtId, int groupId, [FromBody] DistrictCommitteeMemberDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rejection = await RejectIfAutoManagedGroupByIdAsync(conn, groupId);
        if (rejection != null) return rejection;

        // Append to the END of the group's manually-sorted member list.
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_group_member WHERE fk_group_id=@GroupId AND isdeleted=0",
            new { GroupId = groupId });
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_group_member (fk_group_id, fk_member_id, is_member, name, mobile, email,
                district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
            VALUES (@GroupId, @MemberId, @IsMember, @Name, @Mobile, @Email,
                @DistrictDesignation, @ClubId, @ClubName, @DistrictRemark, @ProfilePhoto, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { GroupId = groupId, dto.MemberId, dto.IsMember, dto.Name, dto.Mobile, dto.Email,
                  dto.DistrictDesignation, dto.ClubId, ClubName = (dto.MemberId.HasValue && dto.MemberId.Value > 0) ? null : dto.ClubName, dto.DistrictRemark, dto.ProfilePhoto, SortOrder = nextSort, UserId = GetUserId() });
        return Ok(new { id, message = "Member added to group." });
    }

    [HttpPut("api/districts/{districtId}/committee/groups/{groupId}/members/{id}")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    [OwnedBy(Owns.CommitteeGroupMember, "id", "groupId")]
    public async Task<ActionResult> UpdateGroupMember(int districtId, int groupId, int id, [FromBody] DistrictCommitteeMemberDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rejection = await RejectIfAutoManagedGroupByIdAsync(conn, groupId);
        if (rejection != null) return rejection;

        await conn.ExecuteAsync(@"
            UPDATE district_committee_group_member SET fk_member_id=@MemberId, is_member=@IsMember,
                name=@Name, mobile=@Mobile, email=@Email, district_designation=@DistrictDesignation,
                fk_club_id=@ClubId, club_name=@ClubName, district_remark=@DistrictRemark, profile_photo=@ProfilePhoto, modified_by=@UserId
            WHERE id=@Id AND fk_group_id=@GroupId AND isdeleted=0",
            new { Id = id, GroupId = groupId, dto.MemberId, dto.IsMember, dto.Name, dto.Mobile, dto.Email,
                  dto.DistrictDesignation, dto.ClubId, ClubName = (dto.MemberId.HasValue && dto.MemberId.Value > 0) ? null : dto.ClubName, dto.DistrictRemark, dto.ProfilePhoto, UserId = GetUserId() });
        return Ok(new { message = "Group member updated." });
    }

    [HttpDelete("api/districts/{districtId}/committee/groups/{groupId}/members/{id}")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    [OwnedBy(Owns.CommitteeGroupMember, "id", "groupId")]
    public async Task<ActionResult> DeleteGroupMember(int districtId, int groupId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rejection = await RejectIfAutoManagedGroupByIdAsync(conn, groupId);
        if (rejection != null) return rejection;

        await conn.ExecuteAsync("UPDATE district_committee_group_member SET isdeleted=1 WHERE id=@Id AND fk_group_id=@GroupId",
            new { Id = id, GroupId = groupId });
        return Ok(new { message = "Group member deleted." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── District Committee Sub Groups (Level 3) ────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpGet("api/districts/{districtId}/committee/groups/{groupId}/sub-groups")]
    public async Task<ActionResult> GetSubGroups(int districtId, int groupId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var result = await conn.QueryAsync<dynamic>(@"
            SELECT sg.id, sg.fk_group_id AS groupId, sg.sub_group_name AS subGroupName,
                   sg.sort_order AS sortOrder, sg.is_active AS isActive,
                   (SELECT COUNT(*) FROM district_committee_sub_group_member sgm WHERE sgm.fk_sub_group_id = sg.id AND sgm.isdeleted = 0) AS memberCount
            FROM district_committee_sub_group sg
            WHERE sg.fk_group_id = @GroupId AND sg.isdeleted = 0
            ORDER BY sg.sort_order, sg.sub_group_name",
            new { GroupId = groupId });
        return Ok(result);
    }

    [HttpPost("api/districts/{districtId}/committee/groups/{groupId}/sub-groups")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    public async Task<ActionResult> CreateSubGroup(int districtId, int groupId, [FromBody] DistrictCommitteeSubGroupDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Append to the END of the group's manually-sorted sub-group list.
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_sub_group WHERE fk_group_id=@GroupId AND isdeleted=0",
            new { GroupId = groupId });
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_sub_group (fk_group_id, sub_group_name, sort_order, created_by)
            VALUES (@GroupId, @SubGroupName, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { GroupId = groupId, dto.SubGroupName, SortOrder = nextSort, UserId = GetUserId() });
        return Ok(new { id, message = "Sub group created." });
    }

    [HttpPut("api/districts/{districtId}/committee/groups/{groupId}/sub-groups/{id}")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    [OwnedBy(Owns.CommitteeSubGroupInGroup, "id", "groupId")]
    public async Task<ActionResult> UpdateSubGroupCommittee(int districtId, int groupId, int id, [FromBody] DistrictCommitteeSubGroupDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync("UPDATE district_committee_sub_group SET sub_group_name=@SubGroupName, modified_by=@UserId WHERE id=@Id AND fk_group_id=@GroupId AND isdeleted=0",
            new { Id = id, GroupId = groupId, dto.SubGroupName, UserId = GetUserId() });
        return Ok(new { message = "Sub group updated." });
    }

    [HttpDelete("api/districts/{districtId}/committee/groups/{groupId}/sub-groups/{id}")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    [OwnedBy(Owns.CommitteeSubGroupInGroup, "id", "groupId")]
    public async Task<ActionResult> DeleteSubGroupCommittee(int districtId, int groupId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync("UPDATE district_committee_sub_group SET isdeleted=1 WHERE id=@Id AND fk_group_id=@GroupId", new { Id = id, GroupId = groupId });
        await conn.ExecuteAsync("UPDATE district_committee_sub_group_member SET isdeleted=1 WHERE fk_sub_group_id=@Id", new { Id = id });
        return Ok(new { message = "Sub group deleted." });
    }

    // ── Sub Group Members ──────────────────────────────────────────────

    [HttpGet("api/districts/{districtId}/committee/sub-groups/{subGroupId}/members")]
    public async Task<ActionResult> GetSubGroupMembers(int districtId, int subGroupId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var result = await conn.QueryAsync<dynamic>(@"
            SELECT sgm.id, sgm.fk_sub_group_id AS subGroupId, sgm.fk_member_id AS memberId, sgm.is_member AS isMember,
                   sgm.name,
                   -- Member rows: LIVE profile mobile + email (same rule as level-1 committee).
                   CASE WHEN COALESCE(sgm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                        THEN m.PrimaryMobileNumber ELSE sgm.mobile END AS mobile,
                   CASE WHEN COALESCE(sgm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                        THEN m.EmailId ELSE sgm.email END AS email,
                   sgm.district_designation AS districtDesignation,
                   sgm.fk_club_id AS clubId,
                   CASE WHEN COALESCE(sgm.fk_member_id,0) > 0 THEN c.ClubName ELSE sgm.club_name END AS clubName,
                   sgm.district_remark AS districtRemark,
                   -- Member rows: the member PROFILE photo only (same rule as level-1 and group), so an
                   -- upload or removal on the member add/edit page shows here.
                   -- Non-members keep the photo uploaded on this screen, exactly as before.
                   CASE
                       WHEN COALESCE(sgm.fk_member_id, 0) > 0 THEN
                            CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                                 WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                 ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                       ELSE sgm.profile_photo
                   END AS profilePhoto,
                   sgm.sort_order AS sortOrder, sgm.is_active AS isActive
            FROM district_committee_sub_group_member sgm
            LEFT JOIN club_master c ON c.pk_club_id = sgm.fk_club_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = sgm.fk_member_id AND m.isdeleted = 0
            WHERE sgm.fk_sub_group_id = @SubGroupId AND sgm.isdeleted = 0
            ORDER BY sgm.sort_order, sgm.name",
            new { SubGroupId = subGroupId });
        return Ok(result);
    }

    [HttpPost("api/districts/{districtId}/committee/sub-groups/{subGroupId}/members")]
    [OwnedBy(Owns.CommitteeSubGroup, "subGroupId", "districtId")]
    public async Task<ActionResult> CreateSubGroupMember(int districtId, int subGroupId, [FromBody] DistrictCommitteeMemberDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Append to the END of the sub-group's manually-sorted member list.
        var nextSort = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM district_committee_sub_group_member WHERE fk_sub_group_id=@SubGroupId AND isdeleted=0",
            new { SubGroupId = subGroupId });
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_sub_group_member (fk_sub_group_id, fk_member_id, is_member, name, mobile, email,
                district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
            VALUES (@SubGroupId, @MemberId, @IsMember, @Name, @Mobile, @Email,
                @DistrictDesignation, @ClubId, @ClubName, @DistrictRemark, @ProfilePhoto, @SortOrder, @UserId);
            SELECT LAST_INSERT_ID()",
            new { SubGroupId = subGroupId, dto.MemberId, dto.IsMember, dto.Name, dto.Mobile, dto.Email,
                  dto.DistrictDesignation, dto.ClubId, ClubName = (dto.MemberId.HasValue && dto.MemberId.Value > 0) ? null : dto.ClubName, dto.DistrictRemark, dto.ProfilePhoto, SortOrder = nextSort, UserId = GetUserId() });
        return Ok(new { id, message = "Member added to sub group." });
    }

    [HttpPut("api/districts/{districtId}/committee/sub-groups/{subGroupId}/members/{id}")]
    [OwnedBy(Owns.CommitteeSubGroup, "subGroupId", "districtId")]
    [OwnedBy(Owns.CommitteeSubGroupMember, "id", "subGroupId")]
    public async Task<ActionResult> UpdateSubGroupMember(int districtId, int subGroupId, int id, [FromBody] DistrictCommitteeMemberDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE district_committee_sub_group_member SET fk_member_id=@MemberId, is_member=@IsMember,
                name=@Name, mobile=@Mobile, email=@Email, district_designation=@DistrictDesignation,
                fk_club_id=@ClubId, club_name=@ClubName, district_remark=@DistrictRemark, profile_photo=@ProfilePhoto, modified_by=@UserId
            WHERE id=@Id AND fk_sub_group_id=@SubGroupId AND isdeleted=0",
            new { Id = id, SubGroupId = subGroupId, dto.MemberId, dto.IsMember, dto.Name, dto.Mobile, dto.Email,
                  dto.DistrictDesignation, dto.ClubId, ClubName = (dto.MemberId.HasValue && dto.MemberId.Value > 0) ? null : dto.ClubName, dto.DistrictRemark, dto.ProfilePhoto, UserId = GetUserId() });
        return Ok(new { message = "Sub group member updated." });
    }

    [HttpDelete("api/districts/{districtId}/committee/sub-groups/{subGroupId}/members/{id}")]
    [OwnedBy(Owns.CommitteeSubGroup, "subGroupId", "districtId")]
    [OwnedBy(Owns.CommitteeSubGroupMember, "id", "subGroupId")]
    public async Task<ActionResult> DeleteSubGroupMember(int districtId, int subGroupId, int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync("UPDATE district_committee_sub_group_member SET isdeleted=1 WHERE id=@Id AND fk_sub_group_id=@SubGroupId",
            new { Id = id, SubGroupId = subGroupId });
        return Ok(new { message = "Sub group member deleted." });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Reorder endpoints (drag & drop sort) ──────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    [HttpPut("api/districts/{districtId}/committee/members/reorder")]
    public async Task<ActionResult> ReorderCommitteeMembers(int districtId, [FromBody] ReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync("UPDATE district_committee_member SET sort_order=@S WHERE id=@Id AND fk_district_id=@D",
                new { S = i, Id = dto.OrderedIds[i], D = districtId });
        return Ok(new { message = "Order saved." });
    }

    [HttpPut("api/districts/{districtId}/committee/groups/reorder")]
    public async Task<ActionResult> ReorderCommitteeGroups(int districtId, [FromBody] ReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync("UPDATE district_committee_group SET sort_order=@S WHERE id=@Id AND fk_district_id=@D",
                new { S = i, Id = dto.OrderedIds[i], D = districtId });
        return Ok(new { message = "Order saved." });
    }

    [HttpPut("api/districts/{districtId}/committee/groups/{groupId}/members/reorder")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    public async Task<ActionResult> ReorderGroupMembers(int districtId, int groupId, [FromBody] ReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync("UPDATE district_committee_group_member SET sort_order=@S WHERE id=@Id AND fk_group_id=@G",
                new { S = i, Id = dto.OrderedIds[i], G = groupId });
        return Ok(new { message = "Order saved." });
    }

    [HttpPut("api/districts/{districtId}/committee/groups/{groupId}/sub-groups/reorder")]
    [OwnedBy(Owns.CommitteeGroup, "groupId", "districtId")]
    public async Task<ActionResult> ReorderSubGroups(int districtId, int groupId, [FromBody] ReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync("UPDATE district_committee_sub_group SET sort_order=@S WHERE id=@Id AND fk_group_id=@G",
                new { S = i, Id = dto.OrderedIds[i], G = groupId });
        return Ok(new { message = "Order saved." });
    }

    [HttpPut("api/districts/{districtId}/committee/sub-groups/{subGroupId}/members/reorder")]
    [OwnedBy(Owns.CommitteeSubGroup, "subGroupId", "districtId")]
    public async Task<ActionResult> ReorderSubGroupMembers(int districtId, int subGroupId, [FromBody] ReorderDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync("UPDATE district_committee_sub_group_member SET sort_order=@S WHERE id=@Id AND fk_sub_group_id=@S2",
                new { S = i, Id = dto.OrderedIds[i], S2 = subGroupId });
        return Ok(new { message = "Order saved." });
    }
}

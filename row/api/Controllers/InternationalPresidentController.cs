using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/admin/international-president")]
[Authorize]
public class InternationalPresidentController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public InternationalPresidentController(IConfiguration config, IWebHostEnvironment env)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // List across all years (for admin overview)
    [HttpGet("all")]
    public async Task<ActionResult> GetAll()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT p.pk_id AS id, p.fk_year_id AS yearId, y.YearLabel AS yearName, y.IsCurrent AS isCurrent,
                   p.Name AS name, p.Designation AS designation,
                   CASE
                       WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL
                       WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                       ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath)
                   END AS profilePhoto,
                   p.Description AS description,
                   p.created_date AS createdDate, p.modified_date AS modifiedDate
            FROM international_president p
            JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
            WHERE p.isdeleted = 0
            ORDER BY y.YearLabel DESC");
        return Ok(rows);
    }

    // Single record for a year (may return null if not yet created)
    [HttpGet]
    public async Task<ActionResult> GetByYear([FromQuery] int yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (yearId <= 0) return BadRequest(new { message = "yearId is required" });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.pk_id AS id, p.fk_year_id AS yearId, y.YearLabel AS yearName,
                   p.Name AS name, p.Designation AS designation,
                   CASE
                       WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL
                       WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                       ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath)
                   END AS profilePhoto,
                   p.Description AS description
            FROM international_president p
            JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
            WHERE p.fk_year_id = @YearId AND p.isdeleted = 0",
            new { YearId = yearId });
        return Ok(row); // null if no record yet
    }

    // Reduce a stored/incoming photo value to filename-only when it carries our own upload folder
    // prefix (which the GET adds back on read). Leaves bare filenames, legacy /Documents/directory/…
    // paths, and null/empty untouched so we never break migrated records.
    private static string? NormalizeProfilePhoto(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return path;
        const string ipPrefix = "/Documents/WebsiteData/International_President/";
        var idx = path.LastIndexOf(ipPrefix, StringComparison.OrdinalIgnoreCase);
        if (idx >= 0) return path.Substring(idx + ipPrefix.Length);
        return path;
    }

    public class UpsertRequest
    {
        public int YearId { get; set; }
        public string Name { get; set; } = "";
        public string? Designation { get; set; }
        public string? ProfilePhotoPath { get; set; }
        public string? Description { get; set; }
    }

    [HttpPut]
    public async Task<ActionResult> Upsert([FromBody] UpsertRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.YearId <= 0) return BadRequest(new { message = "yearId is required" });
        if (string.IsNullOrWhiteSpace(req.Name)) return BadRequest(new { message = "Name is required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();

        // Store FILENAME-ONLY (rule: rebuild the URL on read via CONCAT). The GET returns the photo as a
        // full URL (/Documents/WebsiteData/International_President/<file>), so if the client re-saves an
        // already-loaded record it would send that full URL back — storing it would double-prefix on the
        // next read (…/International_President//Documents/…) and the photo vanishes. Strip our own prefix
        // back down to the bare filename. Legacy /Documents/directory/… paths and bare filenames pass through.
        var photo = NormalizeProfilePhoto(req.ProfilePhotoPath);

        // Check for soft-deleted row for this year — if exists, resurrect it
        var existingId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_id FROM international_president WHERE fk_year_id = @Y LIMIT 1",
            new { Y = req.YearId });

        if (existingId.HasValue)
        {
            await conn.ExecuteAsync(@"
                UPDATE international_president
                SET Name = @Name, Designation = @Designation,
                    ProfilePhotoPath = @ProfilePhotoPath, Description = @Description,
                    isdeleted = 0, modified_by = @UserId
                WHERE pk_id = @Id",
                new {
                    Id = existingId.Value,
                    req.Name, req.Designation, ProfilePhotoPath = photo, req.Description,
                    UserId = userId
                });
            return Ok(new { success = true, id = existingId.Value, message = "International President updated." });
        }

        var newId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO international_president
                (fk_year_id, Name, Designation, ProfilePhotoPath, Description, created_by)
            VALUES (@YearId, @Name, @Designation, @ProfilePhotoPath, @Description, @UserId);
            SELECT LAST_INSERT_ID();",
            new {
                req.YearId, req.Name, req.Designation, ProfilePhotoPath = photo, req.Description,
                UserId = userId
            });
        return Ok(new { success = true, id = newId, message = "International President saved." });
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var userId = GetUserId();
        var updated = await conn.ExecuteAsync(
            "UPDATE international_president SET isdeleted = 1, modified_by = @U WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id, U = userId });
        if (updated == 0) return NotFound(new { message = "Record not found." });
        return Ok(new { success = true });
    }

    // Photo upload — stores under wwwroot/Documents/WebsiteData/International_President/
    // Filename convention: PRESIDENT{ddMMyyyyhhmmssfffffff}{AM|PM}{ext}
    // e.g. PRESIDENT160620251053175875643AM.png
    [HttpPost("upload-photo")]
    public async Task<ActionResult> UploadPhoto(IFormFile file)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "WebsiteData", "International_President");
        Directory.CreateDirectory(uploadsPath);

        var now = DateTime.Now;
        var stamp = now.ToString("ddMMyyyyhhmmssfffffff", System.Globalization.CultureInfo.InvariantCulture)
                  + now.ToString("tt", System.Globalization.CultureInfo.InvariantCulture);
        var fileName = $"PRESIDENT{stamp}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using (var stream = new FileStream(filePath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }
        // Store filename only — full URL reconstructed on SELECT via CONCAT('/Documents/WebsiteData/International_President/', ProfilePhotoPath)
        return Ok(new { path = fileName });
    }
}

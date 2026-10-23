using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Documents per district committee (district_committee_group) or sub-committee (district_committee_sub_group),
/// build spec 3.12. ScopeWriteGuardMiddleware already limits writes to the district's managers and reads to its
/// members and managers; each call also checks the committee belongs to the district in the URL.
/// Flag membership_fields (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
public class DistrictCommitteeDocumentsController : ControllerBase
{
    private static readonly string[] AllowedExtensions = { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx" };

    private readonly string _connectionString;
    private readonly IDocumentService _documents;

    public DistrictCommitteeDocumentsController(IConfiguration config, IDocumentService documents)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
        _documents = documents;
    }

    public class UploadForm
    {
        public int? GroupId { get; set; }
        public int? SubGroupId { get; set; }
        public string? Title { get; set; }
        public IFormFile? File { get; set; }
    }

    private int CallerId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    /// <summary>The committee and optional sub-committee a document belongs to, when exactly one of the two ids is
    /// given and it belongs to this district; otherwise null.</summary>
    private static async Task<(int GroupId, int? SubGroupId)?> ResolveAsync(MySqlConnection conn, int districtId, int? groupId, int? subGroupId)
    {
        if ((groupId is > 0) == (subGroupId is > 0)) return null;
        if (groupId is > 0)
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM district_committee_group WHERE id = @G AND fk_district_id = @D AND IFNULL(isdeleted, 0) = 0",
                new { G = groupId, D = districtId }) > 0 ? (groupId.Value, null) : null;
        var parent = await conn.ExecuteScalarAsync<int?>(@"
            SELECT g.id FROM district_committee_sub_group s
            JOIN district_committee_group g ON g.id = s.fk_group_id
            WHERE s.id = @S AND g.fk_district_id = @D AND IFNULL(s.isdeleted, 0) = 0 AND IFNULL(g.isdeleted, 0) = 0",
            new { S = subGroupId, D = districtId });
        return parent is null ? null : (parent.Value, subGroupId);
    }

    [HttpGet("api/districts/{districtId:int}/committee/documents")]
    public async Task<IActionResult> List(int districtId, [FromQuery] int? groupId, [FromQuery] int? subGroupId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var target = await ResolveAsync(conn, districtId, groupId, subGroupId);
        if (target is null) return NotFound(new { message = "Committee not found." });
        var rows = await conn.QueryAsync(@"
            SELECT id, title, original_file_name AS originalFileName,
                   CONCAT('/Documents/documentsafe/Group', fk_district_id, '/', file_path) AS url,
                   created_date AS createdDate
            FROM district_committee_documents
            WHERE fk_group_id = @G AND fk_sub_group_id <=> @S AND isdeleted = 0
            ORDER BY created_date DESC, id DESC",
            new { G = target.Value.GroupId, S = target.Value.SubGroupId });
        return Ok(rows);
    }

    [HttpPost("api/districts/{districtId:int}/committee/documents")]
    public async Task<IActionResult> Upload(int districtId, [FromForm] UploadForm form)
    {
        var title = form.Title?.Trim();
        if (string.IsNullOrEmpty(title) || title.Length > 200)
            return BadRequest(new { message = "Enter a title of at most 200 characters." });
        if (form.File == null || form.File.Length == 0)
            return BadRequest(new { message = "No file uploaded" });
        if (!AllowedExtensions.Contains(Path.GetExtension(form.File.FileName).ToLowerInvariant()))
            return BadRequest(new { message = "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX" });
        if (form.File.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 20 MB." });

        await using var conn = new MySqlConnection(_connectionString);
        var target = await ResolveAsync(conn, districtId, form.GroupId, form.SubGroupId);
        if (target is null) return NotFound(new { message = "Committee not found." });

        var (path, originalName) = await _documents.UploadFileAsync(districtId, form.File);
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_committee_documents
                (fk_district_id, fk_group_id, fk_sub_group_id, title, file_path, original_file_name, created_by)
            VALUES (@D, @G, @S, @T, @P, @O, @U);
            SELECT LAST_INSERT_ID();",
            new
            {
                D = districtId, G = target.Value.GroupId, S = target.Value.SubGroupId, T = title, P = path,
                O = originalName.Length > 255 ? originalName[..255] : originalName, U = CallerId(),
            });
        return Ok(new { id });
    }

    [HttpDelete("api/districts/{districtId:int}/committee/documents/{id:int}")]
    public async Task<IActionResult> Remove(int districtId, int id)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var n = await conn.ExecuteAsync(@"
            UPDATE district_committee_documents SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
            WHERE id = @Id AND fk_district_id = @D AND isdeleted = 0",
            new { Id = id, D = districtId, U = CallerId() });
        return n == 0 ? NotFound(new { message = "Document not found." }) : Ok(new { message = "Document removed." });
    }
}

using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/district-governors")]
[Authorize]
public class DistrictGovernorController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public DistrictGovernorController(IConfiguration config, IWebHostEnvironment env)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    [HttpGet]
    public async Task<ActionResult> GetAll([FromQuery] int? districtId, [FromQuery] int? yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var where = "g.isdeleted = 0";
        if (districtId.HasValue) where += " AND g.fk_district_id = @DistrictId";
        if (yearId.HasValue) where += " AND g.fk_year_id = @YearId";

        // A DG who IS a member reads name/photo/email/mobile from member_master_profile — the member
        // record stays the single source of truth for them. A DG who is not a member of any club has
        // no fk_member_id, so those same fields come from the row's own columns instead of blank.
        var items = await conn.QueryAsync<dynamic>(
            $@"SELECT g.pk_id AS id, g.fk_district_id AS districtId, g.fk_year_id AS yearId,
                      g.fk_member_id AS memberId,
                      {DistrictGovernorSql.Name} AS memberName,
                      g.description,
                      {DistrictGovernorSql.Photo} AS profilePhoto,
                      {DistrictGovernorSql.Email} AS email,
                      {DistrictGovernorSql.Mobile} AS mobile,
                      d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
                      g.created_date AS createdDate,
                      -- Phase 4 kill-switch: row is reachable only when district AND zone are active.
                      CASE WHEN d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0
                           THEN 1 ELSE 0 END AS isActive
               FROM district_governors g
               JOIN district_master d ON d.pk_district_id = g.fk_district_id
               JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
               JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
               {DistrictGovernorSql.JoinMember}
               WHERE {where}
               ORDER BY y.pk_year_id DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { DistrictId = districtId, YearId = yearId });
        return Ok(items);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult> GetById(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Same rule as GetAll: the member record wins when one is linked, otherwise the row's own columns.
        var item = await conn.QueryFirstOrDefaultAsync<dynamic>(
            $@"SELECT g.pk_id AS id, g.fk_district_id AS districtId, g.fk_year_id AS yearId,
                     g.fk_member_id AS memberId,
                     {DistrictGovernorSql.Name} AS memberName,
                     g.description,
                     {DistrictGovernorSql.Photo} AS profilePhoto,
                     {DistrictGovernorSql.Email} AS email,
                     {DistrictGovernorSql.Mobile} AS mobile
              FROM district_governors g
              {DistrictGovernorSql.JoinMember}
              WHERE g.pk_id = @Id AND g.isdeleted = 0",
            new { Id = id });
        if (item == null) return NotFound(new { message = "Not found." });
        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult> Create([FromBody] DistrictGovernorDto dto)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Check duplicate
        var exists = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM district_governors
              WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0",
            new { dto.DistrictId, dto.YearId });
        if (exists > 0)
            throw new InvalidOperationException("District Governor already assigned for this district and rotary year.");

        if (string.IsNullOrWhiteSpace(dto.MemberName))
            throw new InvalidOperationException("Name is required.");

        var p = OwnFields(dto, GetUserId());

        // uk_district_year ignores isdeleted, so a DELETED governor still holds that district+year
        // slot and a plain INSERT fails with a raw duplicate-key error. Reuse the old row instead.
        var slotHolder = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_id FROM district_governors
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 1
            ORDER BY pk_id DESC LIMIT 1",
            new { p.DistrictId, p.YearId });

        if (slotHolder.HasValue)
        {
            await conn.ExecuteAsync($@"
                UPDATE district_governors SET {SetClause}, isdeleted = 0,
                       created_by = COALESCE(created_by, @UserId)
                WHERE pk_id = @Id",
                Args(p, slotHolder.Value));
            return Ok(new { id = slotHolder.Value, message = "District Governor added." });
        }

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_governors (fk_district_id, fk_year_id, fk_member_id, member_name, description, profile_photo, email, mobile_number, created_by, created_date, isdeleted)
            VALUES (@DistrictId, @YearId, @MemberId, @MemberName, @Description, @ProfilePhoto, @Email, @Mobile, @UserId, NOW(), 0);
            SELECT LAST_INSERT_ID();", p);
        return Ok(new { id, message = "District Governor added." });
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] DistrictGovernorDto dto)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Check duplicate (exclude current record)
        var exists = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM district_governors
              WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0 AND pk_id != @Id",
            new { dto.DistrictId, dto.YearId, Id = id });
        if (exists > 0)
            throw new InvalidOperationException("District Governor already assigned for this district and rotary year.");

        if (string.IsNullOrWhiteSpace(dto.MemberName))
            throw new InvalidOperationException("Name is required.");

        var p = OwnFields(dto, GetUserId());

        // Moving a governor onto a district+year whose old row was deleted hits the same unique key
        // (see Create). Revive that row with the new values and retire the one being edited, so the
        // slot ends up with exactly one live governor and nothing is hard-deleted.
        var slotHolder = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_id FROM district_governors
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 1 AND pk_id != @Id
            ORDER BY pk_id DESC LIMIT 1",
            new { p.DistrictId, p.YearId, Id = id });

        if (slotHolder.HasValue)
        {
            await conn.ExecuteAsync(
                "UPDATE district_governors SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_id = @Id",
                new { p.UserId, Id = id });
            await conn.ExecuteAsync($@"
                UPDATE district_governors SET {SetClause}, isdeleted = 0
                WHERE pk_id = @Id",
                Args(p, slotHolder.Value));
            return Ok(new { message = "District Governor updated." });
        }

        await conn.ExecuteAsync($@"
            UPDATE district_governors SET {SetClause}
            WHERE pk_id = @Id AND isdeleted = 0",
            Args(p, id));
        return Ok(new { message = "District Governor updated." });
    }

    private const string SetClause = @"fk_district_id = @DistrictId, fk_year_id = @YearId,
                   fk_member_id = @MemberId, member_name = @MemberName, description = @Description,
                   profile_photo = @ProfilePhoto, email = @Email, mobile_number = @Mobile,
                   modified_by = @UserId, modified_date = NOW()";

    private static object Args(DgWrite p, int id) => new
    {
        p.DistrictId, p.YearId, p.MemberId, p.MemberName, p.Description, p.ProfilePhoto,
        p.Email, p.Mobile, p.UserId, Id = id,
    };

    // Values written to the DG row itself. A member-linked DG keeps reading name/photo/contacts from
    // member_master_profile, so its own contact columns are cleared to stop a stale copy lingering;
    // member_name / profile_photo stay written as they always have been. A non-member DG has nothing
    // else to read from, so everything typed on the form is stored here.
    private sealed record DgWrite(int DistrictId, int YearId, int? MemberId, string MemberName,
        string? Description, string? ProfilePhoto, string? Email, string? Mobile, int UserId);

    private static DgWrite OwnFields(DistrictGovernorDto dto, int userId) => new(
        dto.DistrictId,
        dto.YearId,
        dto.MemberId,
        dto.MemberName.Trim(),
        dto.Description,
        NormalizePhoto(dto.ProfilePhoto),
        dto.MemberId.HasValue ? null : Blank(dto.Email),
        dto.MemberId.HasValue ? null : Blank(dto.Mobile),
        userId);

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // Photos are stored filename-only; the URL is rebuilt on read (DistrictGovernorSql.Photo).
    // Strips any folder the client sent back so re-saving a loaded record can't double-prefix it.
    private static string? NormalizePhoto(string? path)
    {
        var p = Blank(path);
        if (p == null || p.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return p;
        var name = p.Replace('\\', '/').TrimEnd('/');
        var slash = name.LastIndexOf('/');
        return slash >= 0 ? name[(slash + 1)..] : name;
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(
            "UPDATE district_governors SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_id = @Id",
            new { UserId = GetUserId(), Id = id });
        return Ok(new { message = "District Governor deleted." });
    }

    // Distinct districts that have at least one non-deleted DG record — used by listing-page District filter.
    [HttpGet("filter-districts")]
    public async Task<ActionResult> GetFilterDistricts()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT d.pk_district_id AS id, d.DistrictNumber AS districtNumber
            FROM district_governors g
            JOIN district_master d ON d.pk_district_id = g.fk_district_id
            WHERE g.isdeleted = 0 AND d.isdeleted = 0
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber");
        return Ok(items);
    }

    // Distinct rotary years that have at least one non-deleted DG record — used by listing-page Year filter.
    [HttpGet("filter-years")]
    public async Task<ActionResult> GetFilterYears()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM district_governors g
            JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
            WHERE g.isdeleted = 0
            ORDER BY y.pk_year_id DESC");
        return Ok(items);
    }

    // Photo for a DG who is not a member (a member's photo comes from their own profile).
    // Returns the stored filename; the servable URL is rebuilt on read.
    [HttpPost("upload-photo")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult> UploadPhoto(IFormFile file)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });

        file = ImageCompressor.EnsureWithinLimit(file);
        var check = ImageQualityValidator.Validate(file, false);
        if (!check.Ok) return BadRequest(new { message = check.Error });

        var folder = Path.Combine(_env.WebRootPath, "Documents", "WebsiteData", "District_Governor");
        Directory.CreateDirectory(folder);

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        var fileName = $"DG{DateTime.Now:ddMMyyyyHHmmssfff}{ext}";
        await using (var stream = new FileStream(Path.Combine(folder, fileName), FileMode.Create))
            await file.CopyToAsync(stream);

        return Ok(new { path = fileName });
    }

    // Search members across all zones (the DG picker of this SuperAdmin page; it returns mobiles and emails)
    [HttpGet("search-members")]
    public async Task<ActionResult> SearchMembers([FromQuery] string search)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(search) || search.Length < 2) return Ok(Array.Empty<object>());
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   c.ClubName AS clubName, d.DistrictNumber AS districtNumber
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
            WHERE m.isdeleted = 0
              AND (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
            ORDER BY m.MemberName
            LIMIT 20",
            new { Search = $"%{search}%" });
        return Ok(members);
    }
}

public class DistrictGovernorDto
{
    public int DistrictId { get; set; }
    public int YearId { get; set; }
    public int? MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? Description { get; set; }
    public string? ProfilePhoto { get; set; }
    // Only used when MemberId is null: a DG who is not a member has no member record to read from.
    public string? Email { get; set; }
    public string? Mobile { get; set; }
}

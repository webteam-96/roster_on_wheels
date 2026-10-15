using Dapper;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class PastPresidentService : IPastPresidentService
{
    private readonly string _connectionString;

    public PastPresidentService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Shared SELECT projection: returns one row per past_presidents entry, resolving member vs non-member
    // display fields. LEFT JOINs on member_master_profile so non-member rows (fk_member_master_profile_id
    // NULL) still appear. IsMember is computed as 1 when an FK is set, 0 otherwise.
    private const string SelectColumns = @"
        pp.pk_past_president_id AS Id,
        pp.fk_club_id AS ClubId,
        pp.fk_member_master_profile_id AS MemberId,
        pp.non_member_name AS NonMemberName,
        CASE WHEN pp.fk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END AS IsMember,
        COALESCE(m.MemberName, pp.non_member_name, '') AS MemberName,
        CASE
            -- Non-member entry: rebuild from non_member_photo FILENAME →
            -- /Documents/pastpresidents/Group{clubId}/{filename} (SUBSTRING_INDEX tolerates any legacy path prefix).
            WHEN pp.fk_member_master_profile_id IS NULL THEN
                CASE
                    WHEN pp.non_member_photo IS NULL OR pp.non_member_photo = '' THEN NULL
                    ELSE CONCAT('/Documents/pastpresidents/Group', pp.fk_club_id, '/', SUBSTRING_INDEX(pp.non_member_photo, '/', -1))
                END
            WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
            WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
            ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
        END AS ProfilePhotoPath,
        pp.fk_year_id AS YearId,
        y.YearLabel AS YearLabel";

    public async Task<List<PastPresidentDto>> GetByClubAsync(int clubId)
    {
        // Inline SQL (sp_past_president_get_by_club can't be dropped — SYSTEM_USER privilege).
        // LEFT JOIN member_master_profile so non-member rows (member FK NULL) are returned.
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var rows = await connection.QueryAsync<PastPresidentDto>($@"
            SELECT {SelectColumns}
            FROM past_presidents pp
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
            WHERE pp.fk_club_id = @ClubId AND pp.isdeleted = 0
            ORDER BY y.StartDate DESC",
            new { ClubId = clubId });
        return rows.ToList();
    }

    public async Task<PastPresidentDto?> GetByIdAsync(int id)
    {
        // Inline SQL (sp_past_president_get_by_id can't be dropped — SYSTEM_USER privilege).
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<PastPresidentDto>($@"
            SELECT {SelectColumns}
            FROM past_presidents pp
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
            WHERE pp.pk_past_president_id = @Id AND pp.isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateAsync(int clubId, CreatePastPresidentDto dto, IFormFile? photo, int createdBy, IWebHostEnvironment env)
    {
        // Rules:
        //   (a) Year must be a PAST rotary year — not current, not future.
        //   (b) EXACTLY ONE of (MemberId>0) and (NonMemberName not blank) must be supplied.
        //   (c) Only ONE active PP per (club, year). "Visible in listing" now means EITHER a valid
        //       linked member OR a non-blank NonMemberName — non-member rows count as occupying the slot.
        //   (d) The unique key uk_club_year(fk_club_id, fk_year_id) does NOT include isdeleted,
        //       so a soft-deleted row physically occupies the slot — reactivate it in place instead of INSERT.
        //   (e) A profile photo is accepted ONLY for non-member entries; members use their own
        //       member_master_profile.ProfilePhotoPath. For members any uploaded photo is ignored.
        var (memberId, nonMemberName) = NormalizeMemberInput(dto.MemberId, dto.NonMemberName);
        ValidateExactlyOneOfMemberOrNonMember(memberId, nonMemberName);

        // Non-member photo: save to disk (filename only stored). Validate size on ADD (memory rule:
        // image size validation is ADD-only). Members never get a non-member photo.
        string? nonMemberPhoto = null;
        if (!memberId.HasValue && photo != null && photo.Length > 0)
        {
            ValidateImageOnAdd(photo);
            nonMemberPhoto = await SaveNonMemberPhotoAsync(clubId, photo, env);
        }

        using var connection = CreateConnection();
        await connection.OpenAsync();

        await EnsureYearIsPastAsync(connection, dto.YearId);

        // visibleInListing = isdeleted=0 AND ((member FK set AND member row exists) OR NonMemberName not blank)
        var existing = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pp.pk_past_president_id AS id,
                   pp.isdeleted AS isdeleted,
                   (CASE WHEN pp.fk_member_master_profile_id IS NOT NULL
                              AND m.pk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END) AS memberExists,
                   (CASE WHEN pp.non_member_name IS NOT NULL AND TRIM(pp.non_member_name) <> '' THEN 1 ELSE 0 END) AS hasNonMemberName
            FROM past_presidents pp
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
            WHERE pp.fk_club_id = @ClubId AND pp.fk_year_id = @YearId
            LIMIT 1",
            new { ClubId = clubId, YearId = dto.YearId });

        if (existing != null)
        {
            int isdeleted = Convert.ToInt32(existing.isdeleted ?? 0);
            int memberExists = Convert.ToInt32(existing.memberExists ?? 0);
            int hasNonMemberName = Convert.ToInt32(existing.hasNonMemberName ?? 0);
            bool visibleInListing = isdeleted == 0 && (memberExists == 1 || hasNonMemberName == 1);

            if (visibleInListing)
                throw new InvalidOperationException("A Past President already exists for this club and year. Only one is allowed per year.");

            // Invisible slot (soft-deleted OR orphan member with no NonMemberName) — overwrite in place to satisfy uk_club_year.
            await connection.ExecuteAsync(@"
                UPDATE past_presidents
                SET fk_member_master_profile_id = @MemberId,
                    non_member_name = @NonMemberName,
                    non_member_photo = @NonMemberPhoto,
                    isdeleted = 0,
                    deleted_by = NULL,
                    deleted_date = NULL,
                    modified_by = @CreatedBy
                WHERE pk_past_president_id = @Id",
                new { Id = (int)existing.id, MemberId = memberId, NonMemberName = nonMemberName, NonMemberPhoto = nonMemberPhoto, CreatedBy = createdBy });
            return (int)existing.id;
        }

        return await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO past_presidents (fk_club_id, fk_member_master_profile_id, non_member_name, non_member_photo, fk_year_id, created_by)
            VALUES (@ClubId, @MemberId, @NonMemberName, @NonMemberPhoto, @YearId, @CreatedBy);
            SELECT LAST_INSERT_ID();",
            new { ClubId = clubId, MemberId = memberId, NonMemberName = nonMemberName, NonMemberPhoto = nonMemberPhoto, YearId = dto.YearId, CreatedBy = createdBy });
    }

    public async Task UpdateAsync(int id, UpdatePastPresidentDto dto, IFormFile? photo, int modifiedBy, IWebHostEnvironment env)
    {
        // Inline SQL (sp_past_president_update can't be updated — SYSTEM_USER privilege). Enforces:
        //   - target year must be past
        //   - exactly one of MemberId / NonMemberName provided
        //   - (club, year) slot not occupied by ANOTHER visible row (member-row OR non-member-row)
        //   - Member→Non-Member conversion REJECTED (a row that was attached to a real member cannot be
        //     downgraded to a non-member; delete and recreate if needed)
        //   - Non-Member→Member is allowed (we NULL out non_member_name and set the FK)
        //   - Non-member photo: replace (new file), remove (RemovePhoto flag), or keep (neither). On
        //     NM→Member conversion the photo is cleared. Size validation is ADD-only, so NOT re-checked here.
        var (memberId, nonMemberName) = NormalizeMemberInput(dto.MemberId, dto.NonMemberName);
        ValidateExactlyOneOfMemberOrNonMember(memberId, nonMemberName);

        using var connection = CreateConnection();
        await connection.OpenAsync();

        await EnsureYearIsPastAsync(connection, dto.YearId);

        var existingRow = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT fk_club_id AS clubId,
                   fk_member_master_profile_id AS existingMemberId,
                   non_member_name AS existingNonMemberName,
                   non_member_photo AS existingNonMemberPhoto,
                   isdeleted AS isdeleted
            FROM past_presidents WHERE pk_past_president_id = @Id",
            new { Id = id });
        if (existingRow == null)
            throw new InvalidOperationException("Past President record not found.");

        int clubId = Convert.ToInt32(existingRow.clubId);
        int? existingMemberId = existingRow.existingMemberId == null ? null : (int?)Convert.ToInt32(existingRow.existingMemberId);
        string? existingNonMemberPhoto = existingRow.existingNonMemberPhoto as string;

        // M→NM conversion is blocked: existing row had a real member FK, incoming request switches to NonMemberName-only.
        if (existingMemberId.HasValue && existingMemberId.Value > 0 && !memberId.HasValue)
            throw new InvalidOperationException("Cannot convert a Member entry back to a Non-Member entry. Delete and recreate if needed.");

        // Same logic as CreateAsync: only block when conflicting row is visible (active + (real member OR non-member name)).
        var conflictId = await connection.ExecuteScalarAsync<int?>(@"
            SELECT pp.pk_past_president_id FROM past_presidents pp
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
            WHERE pp.fk_club_id = @ClubId AND pp.fk_year_id = @YearId
              AND pp.pk_past_president_id <> @Id AND pp.isdeleted = 0
              AND (
                    (pp.fk_member_master_profile_id IS NOT NULL AND m.pk_member_master_profile_id IS NOT NULL)
                 OR (pp.non_member_name IS NOT NULL AND TRIM(pp.non_member_name) <> '')
              )
            LIMIT 1",
            new { ClubId = clubId, YearId = dto.YearId, Id = id });
        if (conflictId.HasValue)
            throw new InvalidOperationException("A Past President already exists for this club and year. Only one is allowed per year.");

        // Resolve the non-member photo for this save.
        //   - Result is a member (NM→M or already M): clear photo, delete the old file.
        //   - New file uploaded: save it, delete the old file, store the new filename.
        //   - RemovePhoto flag: delete the old file, store NULL.
        //   - Otherwise: keep the existing filename unchanged.
        string? finalPhoto = existingNonMemberPhoto;
        if (memberId.HasValue)
        {
            if (!string.IsNullOrEmpty(existingNonMemberPhoto)) DeletePhotoFromDisk(clubId, existingNonMemberPhoto, env);
            finalPhoto = null;
        }
        else if (photo != null && photo.Length > 0)
        {
            if (!string.IsNullOrEmpty(existingNonMemberPhoto)) DeletePhotoFromDisk(clubId, existingNonMemberPhoto, env);
            finalPhoto = await SaveNonMemberPhotoAsync(clubId, photo, env);
        }
        else if (dto.RemovePhoto)
        {
            if (!string.IsNullOrEmpty(existingNonMemberPhoto)) DeletePhotoFromDisk(clubId, existingNonMemberPhoto, env);
            finalPhoto = null;
        }

        await connection.ExecuteAsync(@"
            UPDATE past_presidents
            SET fk_member_master_profile_id = @MemberId,
                non_member_name = @NonMemberName,
                non_member_photo = @NonMemberPhoto,
                fk_year_id = @YearId,
                modified_by = @ModifiedBy
            WHERE pk_past_president_id = @Id AND isdeleted = 0",
            new { Id = id, MemberId = memberId, NonMemberName = nonMemberName, NonMemberPhoto = finalPhoto, YearId = dto.YearId, ModifiedBy = modifiedBy });
    }

    private static (int? memberId, string? nonMemberName) NormalizeMemberInput(int? rawMemberId, string? rawNonMemberName)
    {
        // Treat MemberId<=0 as null; trim NonMemberName, treat blank as null.
        int? memberId = (rawMemberId.HasValue && rawMemberId.Value > 0) ? rawMemberId : null;
        string? nonMemberName = string.IsNullOrWhiteSpace(rawNonMemberName) ? null : rawNonMemberName.Trim();
        return (memberId, nonMemberName);
    }

    private static void ValidateExactlyOneOfMemberOrNonMember(int? memberId, string? nonMemberName)
    {
        bool hasMember = memberId.HasValue;
        bool hasNonMember = !string.IsNullOrWhiteSpace(nonMemberName);
        if (hasMember == hasNonMember)
            throw new InvalidOperationException("Past President must have either a member selected or a non-member name, not both and not neither.");
    }

    private static async Task EnsureYearIsPastAsync(MySqlConnection connection, int yearId)
    {
        // A year is "past" iff its EndDate is strictly before today. Excludes current (whose EndDate is
        // today or later) and future years. Single SQL — no time-zone gymnastics in C#.
        var status = await connection.ExecuteScalarAsync<string?>(@"
            SELECT CASE
                WHEN EndDate < CURDATE() THEN 'past'
                WHEN StartDate > CURDATE() THEN 'future'
                ELSE 'current'
            END
            FROM rotary_year_master
            WHERE pk_year_id = @Id AND isdeleted = 0",
            new { Id = yearId });

        if (status == null)
            throw new InvalidOperationException("Selected rotary year is invalid.");
        if (status != "past")
            throw new InvalidOperationException("Past Presidents can only be added for past rotary years, not the current or future year.");
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        // Inline SQL (sp_past_president_delete can't be updated — SYSTEM_USER privilege).
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE past_presidents
            SET isdeleted = 1,
                deleted_by = @DeletedBy,
                deleted_date = NOW()
            WHERE pk_past_president_id = @Id",
            new { Id = id, DeletedBy = deletedBy });
    }

    // ── Non-member photo file helpers ──────────────────────────────────────
    // Photos live under wwwroot/Documents/pastpresidents/Group{clubId}/ (Group{clubId} matches the legacy
    // example.org layout). Only the FILENAME is stored in the DB — the URL is rebuilt in SelectColumns.

    private const long MaxNonMemberPhotoBytes = 2 * 1024 * 1024; // 2 MB
    private static readonly string[] AllowedImageExtensions = { ".jpg", ".jpeg", ".png", ".webp", ".gif" };

    // ADD-only validation (memory rule: image size validation is enforced on create, skipped on edit).
    private static void ValidateImageOnAdd(IFormFile file)
    {
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedImageExtensions.Contains(ext) || !(file.ContentType ?? "").StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Profile photo must be an image (JPG, PNG, WEBP or GIF).");
        if (file.Length > MaxNonMemberPhotoBytes)
            throw new InvalidOperationException("Profile photo must be 2 MB or smaller.");
    }

    private static async Task<string> SaveNonMemberPhotoAsync(int clubId, IFormFile file, IWebHostEnvironment env)
    {
        var uploadsPath = Path.Combine(env.WebRootPath, "Documents", "pastpresidents", $"Group{clubId}");
        Directory.CreateDirectory(uploadsPath);

        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var baseName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(file.FileName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(baseName)) baseName = "file";
        var extension = Path.GetExtension(file.FileName);
        var timestamp = DateTime.Now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"pp_{baseName}_{Guid.NewGuid().ToString("N")[..8]}{timestamp}{extension}";
        var fullPath = Path.Combine(uploadsPath, fileName);

        using (var stream = new FileStream(fullPath, FileMode.Create))
            await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed via SQL CONCAT on read.
        return fileName;
    }

    private static void DeletePhotoFromDisk(int clubId, string? storedFileName, IWebHostEnvironment env)
    {
        if (string.IsNullOrEmpty(storedFileName)) return;
        // Tolerate any legacy path prefix — only the basename lives in our Group{clubId} folder.
        var fileName = Path.GetFileName(storedFileName.Replace('\\', '/'));
        if (string.IsNullOrEmpty(fileName)) return;
        var fullPath = Path.Combine(env.WebRootPath, "Documents", "pastpresidents", $"Group{clubId}", fileName);
        if (File.Exists(fullPath))
            File.Delete(fullPath);
    }

    public async Task<List<ClubMemberSearchDto>> SearchClubMembersAsync(int clubId, string? search)
    {
        // Inline SQL — sp_past_president_search_club_members did not filter cm.IsActive = 1. Inline version
        // applies all three guards: cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0, so the
        // dropdown only shows currently active club members.
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var searchTerm = search ?? "";
        var rows = await connection.QueryAsync<ClubMemberSearchDto>(@"
            SELECT
                m.pk_member_master_profile_id AS Id,
                m.MemberName,
                CASE
                    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                END AS ProfilePhotoPath
            FROM club_members cm
            INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1
              AND cm.isdeleted = 0
              AND m.isdeleted = 0
              AND (@Search = '' OR m.MemberName LIKE CONCAT('%', @Search, '%'))
            ORDER BY m.MemberName
            LIMIT 20",
            new { ClubId = clubId, Search = searchTerm });
        return rows.ToList();
    }
}

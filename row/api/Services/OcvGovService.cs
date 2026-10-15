using System.Globalization;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class OcvGovService : IOcvGovService
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public OcvGovService(IConfiguration configuration, IYearTableResolver yearTables)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Categories ──────────────────────────────────────────────────────

    public async Task<IEnumerable<OcvCategoryDto>> GetCategoriesAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<OcvCategoryDto>(
            @"SELECT pk_category_id AS Id, CategoryName, CategoryCode, IconClass, SortOrder
              FROM ocv_document_category
              WHERE IsActive = 1
              ORDER BY SortOrder, pk_category_id");
    }

    // ── Document Types (Settings) ───────────────────────────────────────

    public async Task<IEnumerable<OcvDocumentTypeDto>> GetDocumentTypesAsync(int categoryId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<OcvDocumentTypeDto>(
            @"SELECT pk_type_id AS Id, fk_category_id AS CategoryId, TypeName,
                     AllowMultiple, SortOrder, IsActive
              FROM ocv_document_type
              WHERE fk_category_id = @CategoryId AND isdeleted = 0
              ORDER BY SortOrder, pk_type_id",
            new { CategoryId = categoryId });
    }

    public async Task<OcvDocumentTypeDto> CreateDocumentTypeAsync(CreateOcvDocumentTypeDto dto)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var id = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO ocv_document_type (fk_category_id, TypeName, AllowMultiple, SortOrder, IsActive, isdeleted, created_date)
              VALUES (@CategoryId, @TypeName, @AllowMultiple, @SortOrder, 1, 0, NOW());
              SELECT LAST_INSERT_ID();",
            new { dto.CategoryId, dto.TypeName, AllowMultiple = dto.AllowMultiple ? 1 : 0, dto.SortOrder });

        return new OcvDocumentTypeDto
        {
            Id = id,
            CategoryId = dto.CategoryId,
            TypeName = dto.TypeName,
            AllowMultiple = dto.AllowMultiple,
            SortOrder = dto.SortOrder,
            IsActive = true
        };
    }

    public async Task UpdateDocumentTypeAsync(int typeId, UpdateOcvDocumentTypeDto dto)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE ocv_document_type
              SET TypeName = @TypeName, AllowMultiple = @AllowMultiple, SortOrder = @SortOrder, modified_date = NOW()
              WHERE pk_type_id = @TypeId AND isdeleted = 0",
            new { TypeId = typeId, dto.TypeName, AllowMultiple = dto.AllowMultiple ? 1 : 0, dto.SortOrder });
    }

    public async Task DeleteDocumentTypeAsync(int typeId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE ocv_document_type SET isdeleted = 1, modified_date = NOW() WHERE pk_type_id = @TypeId",
            new { TypeId = typeId });
    }

    // ── Documents (Club) ────────────────────────────────────────────────

    public async Task<IEnumerable<OcvDocumentListItemDto>> GetDocumentsAsync(int clubId, int yearId, int categoryId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Static Documents are NOT year-related (constitution, bylaws, etc.) — they are shared
        // across all Rotary years, so retrieval ignores the year for that category. Every other
        // category stays year-scoped. Category is identified by its code via the join on ocv_category.
        return await connection.QueryAsync<OcvDocumentListItemDto>(
            @"SELECT d.pk_document_id AS Id, d.fk_type_id AS TypeId, t.TypeName,
                     d.CustomTypeName, d.FileName, d.OriginalFileName,
                     CASE
                         WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                         WHEN d.FilePath LIKE '/%' THEN d.FilePath
                         ELSE CONCAT('/Documents/OCV/Group', d.fk_club_id, '/', d.FilePath)
                     END AS FilePath,
                     d.FileSize,
                     d.Amount, d.PaidOn, d.created_date AS CreatedDate
              FROM ocv_documents d
              INNER JOIN ocv_document_type t ON t.pk_type_id = d.fk_type_id
              INNER JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
              WHERE d.fk_club_id = @ClubId
                    AND d.fk_category_id = @CategoryId AND d.isdeleted = 0
                    AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)
              ORDER BY t.SortOrder, d.created_date DESC",
            new { ClubId = clubId, YearId = yearId, CategoryId = categoryId });
    }

    public async Task<OcvDocumentListItemDto> UploadDocumentAsync(int clubId, UploadOcvDocumentDto dto, IFormFile file, int uploadedBy, IWebHostEnvironment env)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check AllowMultiple constraint
        var allowMultiple = await connection.ExecuteScalarAsync<bool>(
            "SELECT AllowMultiple FROM ocv_document_type WHERE pk_type_id = @TypeId AND isdeleted = 0",
            new { dto.TypeId });

        if (!allowMultiple)
        {
            // Static Documents are year-agnostic, so the "only one" rule is enforced across ALL years
            // for that category; every other category enforces it within the given year.
            var existingCount = await connection.ExecuteScalarAsync<int>(
                @"SELECT COUNT(*) FROM ocv_documents d
                  INNER JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
                  WHERE d.fk_club_id = @ClubId
                        AND d.fk_category_id = @CategoryId AND d.fk_type_id = @TypeId AND d.isdeleted = 0
                        AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)",
                new { ClubId = clubId, YearId = dto.YearId, CategoryId = dto.CategoryId, TypeId = dto.TypeId });

            if (existingCount > 0)
                throw new InvalidOperationException("A document already exists for this type. Only one document is allowed.");
        }

        // Save file
        var (filePath, fileName, originalFileName, fileSize) = await SaveFileAsync(clubId, file, env);

        // Insert record
        var id = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO ocv_documents (fk_club_id, fk_year_id, fk_category_id, fk_type_id,
                     CustomTypeName, FileName, OriginalFileName, FilePath, FileSize, Amount, PaidOn, UploadedBy, created_date, isdeleted)
              VALUES (@ClubId, @YearId, @CategoryId, @TypeId,
                     @CustomTypeName, @FileName, @OriginalFileName, @FilePath, @FileSize, @Amount, @PaidOn, @UploadedBy, NOW(), 0);
              SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = clubId,
                YearId = dto.YearId,
                CategoryId = dto.CategoryId,
                TypeId = dto.TypeId,
                CustomTypeName = dto.CustomTypeName,
                FileName = fileName,
                OriginalFileName = originalFileName,
                FilePath = filePath,
                FileSize = fileSize,
                Amount = dto.Amount,
                PaidOn = dto.PaidOn,
                UploadedBy = uploadedBy
            });

        var typeName = await connection.ExecuteScalarAsync<string>(
            "SELECT TypeName FROM ocv_document_type WHERE pk_type_id = @TypeId",
            new { dto.TypeId }) ?? "";

        return new OcvDocumentListItemDto
        {
            Id = id,
            TypeId = dto.TypeId,
            TypeName = typeName,
            CustomTypeName = dto.CustomTypeName,
            FileName = fileName,
            OriginalFileName = originalFileName,
            // Reconstruct full URL (DB stores filename only)
            FilePath = string.IsNullOrEmpty(filePath) ? filePath :
                       filePath.StartsWith("/") ? filePath :
                       $"/Documents/OCV/Group{clubId}/{filePath}",
            FileSize = fileSize,
            Amount = dto.Amount,
            PaidOn = dto.PaidOn,
            CreatedDate = DateTime.Now
        };
    }

    public async Task<OcvDocumentListItemDto> UpdateDocumentAsync(int clubId, int documentId, UpdateOcvDocumentDto dto, IFormFile? file, int modifiedBy, IWebHostEnvironment env)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get existing document — FilePathRaw is filename-only (DB value), FilePathFull is reconstructed for disk-delete
        var existing = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_document_id, fk_type_id, FileName, OriginalFileName,
                     FilePath AS FilePathRaw,
                     CASE
                         WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                         WHEN FilePath LIKE '/%' THEN FilePath
                         ELSE CONCAT('/Documents/OCV/Group', fk_club_id, '/', FilePath)
                     END AS FilePathFull,
                     FileSize, Amount, PaidOn
              FROM ocv_documents WHERE pk_document_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
            new { Id = documentId, ClubId = clubId });

        if (existing == null)
            throw new KeyNotFoundException("Document not found.");

        string fileName = (string)existing.FileName;
        string originalFileName = (string)existing.OriginalFileName;
        // filePath stored in DB is filename only (post-migration); keep that for DB write
        string filePath = (string)existing.FilePathRaw;
        long fileSize = (long)existing.FileSize;

        if (file != null)
        {
            // Delete old file from disk using reconstructed full URL
            DeleteFileFromDisk((string)existing.FilePathFull, env);

            // Save new file (returns filename only)
            (filePath, fileName, originalFileName, fileSize) = await SaveFileAsync(clubId, file, env);
        }

        await connection.ExecuteAsync(
            @"UPDATE ocv_documents
              SET fk_type_id = @TypeId, CustomTypeName = @CustomTypeName,
                  FileName = @FileName, OriginalFileName = @OriginalFileName,
                  FilePath = @FilePath, FileSize = @FileSize, Amount = @Amount, PaidOn = @PaidOn,
                  modified_date = NOW()
              WHERE pk_document_id = @Id AND isdeleted = 0",
            new
            {
                Id = documentId,
                TypeId = dto.TypeId,
                CustomTypeName = dto.CustomTypeName,
                FileName = fileName,
                OriginalFileName = originalFileName,
                FilePath = filePath,
                FileSize = fileSize,
                Amount = dto.Amount,
                PaidOn = dto.PaidOn
            });

        var typeName = await connection.ExecuteScalarAsync<string>(
            "SELECT TypeName FROM ocv_document_type WHERE pk_type_id = @TypeId",
            new { dto.TypeId }) ?? "";

        return new OcvDocumentListItemDto
        {
            Id = documentId,
            TypeId = dto.TypeId,
            TypeName = typeName,
            CustomTypeName = dto.CustomTypeName,
            FileName = fileName,
            OriginalFileName = originalFileName,
            // Reconstruct full URL (DB stores filename only)
            FilePath = string.IsNullOrEmpty(filePath) ? filePath :
                       filePath.StartsWith("/") ? filePath :
                       $"/Documents/OCV/Group{clubId}/{filePath}",
            FileSize = fileSize,
            Amount = dto.Amount,
            PaidOn = dto.PaidOn,
            CreatedDate = DateTime.Now
        };
    }

    public async Task DeleteDocumentAsync(int documentId, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE ocv_documents SET isdeleted = 1, modified_date = NOW() WHERE pk_document_id = @Id",
            new { Id = documentId });
    }

    public async Task<(string FilePath, string OriginalFileName)?> GetDocumentFileAsync(int clubId, int documentId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var row = await connection.QueryFirstOrDefaultAsync<(string filePath, string originalFileName)?>(
            @"SELECT
                  CASE
                      WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                      WHEN FilePath LIKE '/%' THEN FilePath
                      ELSE CONCAT('/Documents/OCV/Group', fk_club_id, '/', FilePath)
                  END AS filePath,
                  OriginalFileName AS originalFileName
              FROM ocv_documents
              WHERE pk_document_id = @DocumentId AND fk_club_id = @ClubId AND isdeleted = 0
              LIMIT 1",
            new { DocumentId = documentId, ClubId = clubId });
        return row;
    }

    // ── OCV Report ──────────────────────────────────────────────────────

    public async Task<IEnumerable<OcvReportItemDto>> GetOcvReportAsync(int clubId, int yearId, string? status)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var results = await connection.QueryAsync<OcvReportItemDto>(
            @"SELECT c.CategoryName, c.CategoryCode, c.pk_category_id AS CategoryId,
                     t.pk_type_id AS TypeId, t.TypeName,
                     CASE WHEN d.pk_document_id IS NOT NULL THEN 1 ELSE 0 END AS IsUploaded,
                     d.pk_document_id AS DocumentId,
                     CASE
                         WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                         WHEN d.FilePath LIKE '/%' THEN d.FilePath
                         ELSE CONCAT('/Documents/OCV/Group', d.fk_club_id, '/', d.FilePath)
                     END AS FilePath,
                     d.OriginalFileName
              FROM ocv_document_type t
              INNER JOIN ocv_document_category c ON c.pk_category_id = t.fk_category_id
              LEFT JOIN ocv_documents d ON d.fk_type_id = t.pk_type_id
                    AND d.fk_club_id = @ClubId AND d.isdeleted = 0
                    AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)
              WHERE t.isdeleted = 0 AND t.IsActive = 1 AND c.IsActive = 1
              ORDER BY c.SortOrder, c.pk_category_id, t.SortOrder, t.pk_type_id",
            new { ClubId = clubId, YearId = yearId });

        if (!string.IsNullOrEmpty(status) && status != "all")
        {
            if (status == "yes")
                results = results.Where(r => r.IsUploaded);
            else if (status == "no")
                results = results.Where(r => !r.IsUploaded);
        }

        return results;
    }

    // ── OCV Word Report ─────────────────────────────────────────────────

    // "Live Documents" modules rendered into the Word report. Each module's rows are read live
    // (nothing is stored), so the report carries a snapshot. Newsletters are excluded here —
    // they get their own hyperlinked section.
    private static readonly (string Module, string Label, (string Column, string Header)[] Columns)[] LiveModules =
    {
        ("community_service", "Community Service Projects", new[] { ("title", "Title"), ("projectDate", "Date"), ("areaOfFocus", "Area of Focus"), ("location", "Location"), ("projectCost", "Cost"), ("directBeneficiaries", "Beneficiaries") }),
        ("vocational_service", "Vocational Service", new[] { ("title", "Title"), ("projectDate", "Date"), ("areaOfFocus", "Area of Focus"), ("location", "Location"), ("projectCost", "Cost"), ("directBeneficiaries", "Beneficiaries") }),
        ("international_service", "International Service", new[] { ("title", "Title"), ("projectDate", "Date"), ("areaOfFocus", "Area of Focus"), ("location", "Location"), ("projectCost", "Cost"), ("directBeneficiaries", "Beneficiaries") }),
        ("new_generation_service", "New Generation Service", new[] { ("title", "Title"), ("projectDate", "Date"), ("areaOfFocus", "Area of Focus"), ("location", "Location"), ("projectCost", "Cost"), ("directBeneficiaries", "Beneficiaries") }),
        ("public_image_initiative", "Public Image Initiative", new[] { ("title", "Title"), ("projectDate", "Date"), ("areaOfFocus", "Area of Focus"), ("location", "Location"), ("projectCost", "Cost"), ("directBeneficiaries", "Beneficiaries") }),
        ("club_service", "Club Service", new[] { ("title", "Title"), ("projectDate", "Date"), ("location", "Location"), ("manHours", "Man Hours"), ("approvalStatus", "Status") }),
        ("announcements", "Announcements", new[] { ("title", "Title"), ("publishDate", "Publish Date"), ("expiryDate", "Expiry Date"), ("status", "Status") }),
        ("upcoming_events", "Upcoming Events", new[] { ("title", "Title"), ("eventDate", "Event Date"), ("eventVenue", "Venue"), ("publishDate", "Publish Date"), ("status", "Status") }),
        ("documents", "Documents", new[] { ("title", "Title"), ("accessType", "Access Type"), ("publishDate", "Publish Date"), ("expiryDate", "Expiry Date") }),
        ("attendance", "Attendance", new[] { ("eventName", "Event"), ("eventDateTime", "Date"), ("membersPresent", "Present"), ("visitors", "Visitors"), ("totalMembers", "Total Active"), ("attendancePercent", "Attendance %") }),
        ("board_of_directors", "Board of Directors", new[] { ("designation", "Designation"), ("memberName", "Name"), ("mobile", "Mobile"), ("email", "Email") }),
        ("members", "Members", new[] { ("memberName", "Name"), ("mobile", "Mobile"), ("email", "Email"), ("rotaryId", "Rotary ID"), ("joinedDate", "Joined"), ("isActive", "Active") }),
        ("trf_contributions", "TRF Contributions", new[] { ("fund", "Fund"), ("amount", "Amount (USD)") }),
    };

    // The six project avenues, in the order the detailed Word section renders them. Keys match
    // module_master.ModuleKey; labels match OcvReportWordBuilder.ProjectModuleLabels.
    private static readonly (string ModuleKey, string Label)[] ProjectModuleCatalog =
    {
        ("community_service", "Community Service Projects"),
        ("vocational_service", "Vocational Service"),
        ("international_service", "International Service"),
        ("new_generation_service", "New Generation Service"),
        ("public_image_initiative", "Public Image Initiative"),
        ("club_service", "Club Service"),
    };

    // Loads every project of the year for one avenue, with all form fields (pre-formatted) and up
    // to 5 images each. Image paths are reconstructed exactly as ProjectService/CMR do (year-aware
    // Album folder for new rows, old_pk folder for migrated rows). Bytes are loaded later by the
    // controller (disk-first, then media host) so the service stays free of IO/config concerns.
    private async Task LoadProjectModuleAsync(MySqlConnection conn, YearTableInfo info, int clubId, string moduleKey, OcvWordProjectModule module)
    {
        var projects = (await conn.QueryAsync<dynamic>($@"
            SELECT p.pk_project_id AS projectId, p.title AS title, p.description AS description,
                   p.project_date AS projectDate, p.location AS location, p.project_type AS projectType,
                   p.is_joint_project AS isJointProject, p.co_host_name AS coHostName, p.club_role AS clubRole,
                   p.project_cost AS projectCost, p.Currency AS currency,
                   p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours,
                   p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved,
                   COALESCE(p.rcc_involved,0) AS rccInvolved,
                   p.meeting_type AS meetingType, p.attendance AS attendance, p.attendance_percentage AS attendancePercentage,
                   p.global_grant_number AS globalGrantNumber, p.amount_sanctioned AS amountSanctioned,
                   p.amount_received AS amountReceived, p.amount_spent AS amountSpent,
                   p.host_clubs_districts AS hostClubsDistricts, p.global_partner_clubs_districts AS globalPartnerClubsDistricts,
                   p.csr_company_name AS csrCompanyName, p.approval_status AS approvalStatus,
                   af.name AS areaOfFocus, p.other_area_of_focus AS otherAreaOfFocus,
                   cat.name AS categoryName, p.other_category AS otherCategory,
                   scat.name AS subCategoryName, p.other_sub_category AS otherSubCategory,
                   f.name AS fundingName
            FROM `{info.ProjectsTable}` p
            LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
            LEFT JOIN sub_category_master scat ON scat.pk_sub_category_id = p.fk_sub_category_id
            LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
            JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND mm.ModuleKey = @ModuleKey
            ORDER BY p.project_date DESC, p.pk_project_id DESC",
            new { ClubId = clubId, ModuleKey = moduleKey })).ToList();

        if (projects.Count == 0) return;

        // All photos for the module's projects in one query — grouped by project id below.
        var suffix = info.YearLabel.Replace("-", "_");
        var photos = (await conn.QueryAsync<dynamic>($@"
            SELECT pp.fk_project_id AS projectId,
                   CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                          CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                               ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                          '/', pp.image_path) AS imagePath,
                   pp.description AS description, pp.is_primary AS isPrimary, pp.sort_order AS sortOrder
            FROM `{info.PhotosTable}` pp
            JOIN `{info.ProjectsTable}` p ON p.pk_project_id = pp.fk_project_id
            JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND mm.ModuleKey = @ModuleKey
            ORDER BY pp.fk_project_id, pp.is_primary DESC, pp.sort_order",
            new { ClubId = clubId, ModuleKey = moduleKey })).ToList();

        var photosByProject = photos
            .Select(x => (IDictionary<string, object>)x)
            .GroupBy(x => Convert.ToInt32(x["projectId"]))
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var row in projects)
        {
            var f = (IDictionary<string, object>)row;
            var projectId = Convert.ToInt32(f["projectId"]);
            var project = new OcvWordProject
            {
                Title = FormatCell(f.TryGetValue("title", out var t) ? t : null),
                Description = FormatCell(f.TryGetValue("description", out var ds) ? ds : null),
            };

            void Add(string label, string key, string? suffixText = null)
            {
                var v = FormatCell(f.TryGetValue(key, out var val) ? val : null);
                if (!string.IsNullOrWhiteSpace(v))
                    project.Fields.Add((label, suffixText == null ? v : $"{v}{suffixText}"));
            }

            Add("Date", "projectDate");
            Add("Location", "location");
            // Area of Focus / Category / Sub Category — fall back to the free-text "Other …" value.
            AddWithFallback(project, f, "Area of Focus", "areaOfFocus", "otherAreaOfFocus");
            AddWithFallback(project, f, "Category", "categoryName", "otherCategory");
            AddWithFallback(project, f, "Sub Category", "subCategoryName", "otherSubCategory");
            Add("Project Type", "projectType");
            Add("Joint Project", "isJointProject");
            Add("Co-Host", "coHostName");
            Add("Club Role", "clubRole");
            // Project cost with its currency appended when present.
            {
                var cost = FormatCell(f.TryGetValue("projectCost", out var c) ? c : null);
                if (!string.IsNullOrWhiteSpace(cost))
                {
                    var cur = FormatCell(f.TryGetValue("currency", out var cc) ? cc : null);
                    project.Fields.Add(("Project Cost", string.IsNullOrWhiteSpace(cur) ? cost : $"{cur} {cost}"));
                }
            }
            Add("Funding", "fundingName");
            Add("Direct Beneficiaries", "directBeneficiaries");
            Add("Man Hours", "manHours");
            Add("Rotarians Involved", "rotariansInvolved");
            Add("Rotaractors Involved", "rotaractorsInvolved");
            Add("RCC Involved", "rccInvolved");
            Add("Meeting Type", "meetingType");
            Add("Attendance", "attendance");
            Add("Attendance %", "attendancePercentage");
            Add("Global Grant Number", "globalGrantNumber");
            Add("Amount Sanctioned", "amountSanctioned");
            Add("Amount Received", "amountReceived");
            Add("Amount Spent", "amountSpent");
            Add("Host Clubs / Districts", "hostClubsDistricts");
            Add("Global Partner Clubs / Districts", "globalPartnerClubsDistricts");
            Add("CSR Company", "csrCompanyName");
            Add("Approval Status", "approvalStatus");

            if (photosByProject.TryGetValue(projectId, out var imgs))
            {
                foreach (var pi in imgs.Take(5))
                {
                    var path = FormatCell(pi.TryGetValue("imagePath", out var ip) ? ip : null);
                    if (string.IsNullOrWhiteSpace(path)) continue;
                    project.Images.Add(new OcvWordProjectImage
                    {
                        ImagePath = path,
                        Extension = Path.GetExtension(path).TrimStart('.').ToLowerInvariant(),
                        Caption = FormatCell(pi.TryGetValue("description", out var pd) ? pd : null),
                    });
                }
            }

            module.Projects.Add(project);
        }
    }

    private static void AddWithFallback(OcvWordProject project, IDictionary<string, object> f, string label, string key, string fallbackKey)
    {
        var v = FormatCell(f.TryGetValue(key, out var val) ? val : null);
        if (string.IsNullOrWhiteSpace(v)) v = FormatCell(f.TryGetValue(fallbackKey, out var fb) ? fb : null);
        if (!string.IsNullOrWhiteSpace(v)) project.Fields.Add((label, v));
    }

    public async Task<OcvWordReportData> GetOcvWordReportDataAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var data = new OcvWordReportData
        {
            YearLabel = await connection.ExecuteScalarAsync<string>(
                "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId",
                new { YearId = yearId }) ?? "",
        };

        // Club identity + district/zone (single join). ClubRotaryId = the club's ROW id,
        // DistrictNumber is a VARCHAR ("5656" etc.), ZoneName from zone_master (no ZoneCode column).
        var identity = await connection.QueryFirstOrDefaultAsync<(string? ClubName, string? ClubRotaryId, string? DistrictNumber, string? ZoneName)>(
            @"SELECT c.ClubName, c.ClubRotaryId, d.DistrictNumber, z.ZoneName
              FROM club_master c
              LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
              LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
              WHERE c.pk_club_id = @ClubId",
            new { ClubId = clubId });
        data.ClubName = identity.ClubName ?? "";
        data.ClubRotaryId = identity.ClubRotaryId ?? "";
        data.DistrictNumber = identity.DistrictNumber ?? "";
        data.ZoneName = identity.ZoneName ?? "";

        // President — from the Board of Directors for this club + year.
        data.PresidentName = await connection.ExecuteScalarAsync<string>(
            @"SELECT m.MemberName FROM board_of_directors bod
              JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id AND m.isdeleted = 0
              JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
              WHERE bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0
                    AND dm.designation_name = 'Club President'
              ORDER BY bod.pk_board_director_id DESC LIMIT 1",
            new { ClubId = clubId, YearId = yearId }) ?? "";

        // Assistant Governor — one active AG per club/year (same resolution as the CMR reports).
        data.AssistantGovernorName = await connection.ExecuteScalarAsync<string>(
            @"SELECT mp.MemberName FROM district_ag da
              JOIN member_master_profile mp ON mp.pk_member_master_profile_id = da.fk_member_id AND COALESCE(mp.isdeleted, 0) = 0
              WHERE da.fk_club_id = @ClubId AND da.fk_year_id = @YearId
                    AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
              ORDER BY da.id DESC LIMIT 1",
            new { ClubId = clubId, YearId = yearId }) ?? "";

        var categories = await connection.QueryAsync<(string code, string name)>(
            @"SELECT CategoryCode, CategoryName
              FROM ocv_document_category
              WHERE IsActive = 1
              ORDER BY SortOrder, pk_category_id");
        data.Categories.AddRange(categories.Select(c => new OcvWordCategory(c.code, c.name)));

        // Static Documents are year-agnostic (same rule as GetDocumentsAsync/GetOcvReportAsync).
        var documents = await connection.QueryAsync<OcvWordDocument>(
            @"SELECT c.CategoryCode, c.CategoryName, t.TypeName, d.CustomTypeName, d.OriginalFileName,
                     CASE
                         WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                         WHEN d.FilePath LIKE '/%' THEN d.FilePath
                         ELSE CONCAT('/Documents/OCV/Group', d.fk_club_id, '/', d.FilePath)
                     END AS FilePath,
                     d.Amount, d.PaidOn, d.created_date AS CreatedDate
              FROM ocv_documents d
              INNER JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
              INNER JOIN ocv_document_type t ON t.pk_type_id = d.fk_type_id
              WHERE d.fk_club_id = @ClubId AND d.isdeleted = 0
                    AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)
              ORDER BY c.SortOrder, c.pk_category_id, t.SortOrder, d.created_date",
            new { ClubId = clubId, YearId = yearId });

        foreach (var d in documents)
        {
            d.Extension = Path.GetExtension(d.FilePath ?? d.OriginalFileName ?? "").TrimStart('.').ToLowerInvariant();
            data.Documents.Add(d);
        }

        foreach (var (module, label, columns) in LiveModules)
        {
            var table = new OcvWordModuleTable { Label = label, ModuleKey = module };
            table.Headers.Add("Sr");
            foreach (var (_, header) in columns) table.Headers.Add(header);

            int sr = 1;
            IEnumerable<dynamic> moduleRows;
            try { moduleRows = await QueryLiveModuleAsync(connection, clubId, yearId, module); }
            catch { moduleRows = Array.Empty<dynamic>(); }
            foreach (var row in moduleRows)
            {
                var fields = (IDictionary<string, object>)row;
                var cells = new List<string> { sr.ToString() };
                foreach (var (column, _) in columns)
                    cells.Add(FormatCell(fields.TryGetValue(column, out var value) ? value : null));
                table.Rows.Add(cells.ToArray());
                sr++;
            }
            data.LiveTables.Add(table);
        }

        // Full per-project detail (all form fields + up to 5 images each) for the six project
        // avenues, rendered in the detailed "Live Documents" section of the Word report. Best-effort:
        // a missing year table or a failing module simply yields no projects for that module.
        var projInfo = await _yearTables.ResolveByYearIdAsync(connection, yearId);
        if (projInfo is not null)
        {
            foreach (var (moduleKey, label) in ProjectModuleCatalog)
            {
                var pm = new OcvWordProjectModule { ModuleKey = moduleKey, Label = label };
                try { await LoadProjectModuleAsync(connection, projInfo, clubId, moduleKey, pm); }
                catch { /* leave module with no projects */ }
                data.ProjectModules.Add(pm);
            }
        }

        var newsletters = await connection.QueryAsync<OcvWordNewsletter>(
            $@"SELECT n.Title, n.PublishDateTime AS PublishDate, n.AttachmentType, n.LinkUrl,
                     CASE
                         WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                         WHEN n.FilePath LIKE '/%' THEN n.FilePath
                         WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                         WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                         WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                         ELSE NULL
                     END AS FilePath,
                     CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                          WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS Status
              FROM newsletters n
              JOIN rotary_year_master y ON y.pk_year_id = @YearId
              WHERE n.fk_club_id = @ClubId AND n.isdeleted = 0
                    AND {OcvLiveVisibility.Newsletters("n")}
                    AND n.PublishDateTime >= y.StartDate
                    AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
              ORDER BY n.PublishDateTime DESC",
            new { ClubId = clubId, YearId = yearId });
        data.Newsletters.AddRange(newsletters);

        return data;
    }

    private async Task<IEnumerable<dynamic>> QueryLiveModuleAsync(MySqlConnection conn, int clubId, int yearId, string module)
    {
        switch (module)
        {
            case "community_service":
            case "vocational_service":
            case "international_service":
            case "new_generation_service":
            case "public_image_initiative":
            case "club_service":
                {
                    // Projects live in the year-wise table, so the table itself scopes the year.
                    var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
                    if (info is null) return Array.Empty<dynamic>();
                    return await conn.QueryAsync<dynamic>($@"
                        SELECT p.title, p.project_date AS projectDate, p.location,
                               p.project_cost AS projectCost, p.direct_beneficiaries AS directBeneficiaries,
                               p.man_hours AS manHours, af.name AS areaOfFocus,
                               p.approval_status AS approvalStatus
                        FROM `{info.ProjectsTable}` p
                        LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                        JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                        WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND mm.ModuleKey = @ModuleKey
                        ORDER BY p.project_date DESC",
                        new { ClubId = clubId, ModuleKey = module });
                }

            case "announcements":
                return await conn.QueryAsync<dynamic>(@"
                    SELECT a.Title AS title, a.PublishDateTime AS publishDate, a.ExpiryDateTime AS expiryDate,
                           CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                                WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
                    FROM announcements a
                    JOIN rotary_year_master y ON y.pk_year_id = @YearId
                    WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
                      AND a.PublishDateTime >= y.StartDate
                      AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                    ORDER BY a.PublishDateTime DESC",
                    new { ClubId = clubId, YearId = yearId });

            case "upcoming_events":
                // Published + not expired only (see OcvLiveVisibility). EventDate is deliberately
                // NOT gated — the OCV report covers the whole Rotary year, including events that
                // have already taken place but whose listing is still live.
                return await conn.QueryAsync<dynamic>($@"
                    SELECT e.Title AS title, e.EventDate AS eventDate, e.EventVenue AS eventVenue,
                           e.PublishDate AS publishDate,
                           CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                                WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
                    FROM upcoming_events e
                    JOIN rotary_year_master y ON y.pk_year_id = @YearId
                    WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0
                      AND {OcvLiveVisibility.UpcomingEvents("e")}
                      AND e.PublishDate >= y.StartDate
                      AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                    ORDER BY e.EventDate DESC",
                    new { ClubId = clubId, YearId = yearId });

            case "documents":
                return await conn.QueryAsync<dynamic>($@"
                    SELECT cd.Title AS title, cd.AccessType AS accessType,
                           cd.PublishDateTime AS publishDate, cd.ExpiryDateTime AS expiryDate
                    FROM club_documents cd
                    JOIN rotary_year_master y ON y.pk_year_id = @YearId
                    WHERE cd.fk_club_id = @ClubId AND cd.isdeleted = 0
                      AND {OcvLiveVisibility.ClubDocuments("cd")}
                      AND cd.PublishDateTime >= y.StartDate
                      AND cd.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                    ORDER BY cd.PublishDateTime DESC",
                    new { ClubId = clubId, YearId = yearId });

            case "attendance":
                {
                    var total = await conn.ExecuteScalarAsync<int>(
                        "SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0",
                        new { C = clubId });
                    return await conn.QueryAsync<dynamic>(@"
                        SELECT a.EventName AS eventName, a.EventDateTime AS eventDateTime,
                               (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                               (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
                               @Total AS totalMembers,
                               ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 1) AS attendancePercent
                        FROM club_attendance a
                        WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0
                        ORDER BY a.EventDateTime DESC",
                        new { ClubId = clubId, YearId = yearId, Total = total });
                }

            case "board_of_directors":
                return await conn.QueryAsync<dynamic>(@"
                    SELECT dm.designation_name AS designation, m.MemberName AS memberName,
                           m.PrimaryMobileNumber AS mobile, m.EmailId AS email
                    FROM board_of_directors b
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                    JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                    WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
                    ORDER BY dm.sort_order",
                    new { ClubId = clubId, YearId = yearId });

            case "members":
                // Birth/anniversary dates are deliberately omitted — full dates are not exported.
                return await conn.QueryAsync<dynamic>(@"
                    SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                           m.RotaryId AS rotaryId, cm.JoinedDate AS joinedDate, cm.IsActive AS isActive
                    FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0
                    ORDER BY m.MemberName",
                    new { ClubId = clubId });

            case "trf_contributions":
                // TRF now reflects the club's GOAL SETTING TRF (the 4 fund YTD values), NOT the trf_contributions module.
                return await conn.QueryAsync<dynamic>(@"
                    SELECT CASE gf.FieldKey
                             WHEN 'club_annual_fund_ytd' THEN 'Annual Fund'
                             WHEN 'club_polioplus_ytd'   THEN 'Polio Plus'
                             WHEN 'club_endowment_ytd'   THEN 'Endowment'
                             WHEN 'club_other_funds_ytd' THEN 'Other Funds'
                           END AS fund,
                           COALESCE(e.NumericValue, 0) AS amount
                    FROM goal_fields gf
                    LEFT JOIN goal_entries e ON e.fk_field_id = gf.pk_field_id AND e.EntityType = 'Club'
                         AND e.fk_club_id = @ClubId AND e.fk_year_id = @YearId AND COALESCE(e.isdeleted, 0) = 0
                    WHERE gf.FieldKey IN ('club_annual_fund_ytd','club_polioplus_ytd','club_endowment_ytd','club_other_funds_ytd')
                      AND gf.isdeleted = 0
                    ORDER BY FIELD(gf.FieldKey,'club_annual_fund_ytd','club_polioplus_ytd','club_endowment_ytd','club_other_funds_ytd')",
                    new { ClubId = clubId, YearId = yearId });

            default:
                return Array.Empty<dynamic>();
        }
    }

    private static string FormatCell(object? value) => value switch
    {
        null => "",
        DateTime d => d.TimeOfDay == TimeSpan.Zero
            ? d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)
            : d.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture),
        bool b => b ? "Yes" : "No",
        decimal m => m.ToString("N2", CultureInfo.InvariantCulture),
        double db => db.ToString("N2", CultureInfo.InvariantCulture),
        float f => f.ToString("N2", CultureInfo.InvariantCulture),
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? "",
    };

    // ── File Helpers ────────────────────────────────────────────────────

    private static async Task<(string filePath, string fileName, string originalFileName, long fileSize)> SaveFileAsync(int clubId, IFormFile file, IWebHostEnvironment env)
    {
        var groupFolder = $"Group{clubId}";
        var uploadsPath = Path.Combine(env.WebRootPath, "Documents", "OCV", groupFolder);
        Directory.CreateDirectory(uploadsPath);

        var originalName = file.FileName;
        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var originalBaseName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(file.FileName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(originalBaseName)) originalBaseName = "file";
        var extension = Path.GetExtension(file.FileName);
        var now = DateTime.Now;
        var timestamp = now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{originalBaseName}_{Guid.NewGuid().ToString("N")[..8]}{timestamp}{extension}";
        var fullPath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(fullPath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return (fileName, fileName, originalName, file.Length);
    }

    private static void DeleteFileFromDisk(string relativePath, IWebHostEnvironment env)
    {
        if (string.IsNullOrEmpty(relativePath)) return;
        var fullPath = Path.Combine(env.WebRootPath, relativePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(fullPath))
            File.Delete(fullPath);
    }
}

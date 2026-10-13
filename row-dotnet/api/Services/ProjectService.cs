using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Year-wise tables: data lives in `rotary_projects_YYYY_YY` + `rotary_project_photos_YYYY_YY`
// per rotary year. A project's identity is the (yearId, pk_project_id) tuple — the PK alone
// is ambiguous because multiple year tables share the same auto-increment sequence starting at 1.
// Callers must pass yearId on every operation that targets a specific project.
public class ProjectService : IProjectService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ProjectService> _logger;
    private readonly IYearTableResolver _yearTables;
    private readonly ICitationRecalcTrigger _citationRecalc;

    public ProjectService(IConfiguration configuration, IWebHostEnvironment env,
        IServiceScopeFactory scopeFactory, ILogger<ProjectService> logger, IYearTableResolver yearTables,
        ICitationRecalcTrigger citationRecalc)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _scopeFactory = scopeFactory;
        _logger = logger;
        _yearTables = yearTables;
        _citationRecalc = citationRecalc;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Funding-conditional helpers ───────────────────────────────
    private static string ClassifyFunding(string? fundingName)
    {
        if (string.IsNullOrWhiteSpace(fundingName)) return "";
        var n = fundingName.Trim().ToLowerInvariant();
        if (n.Contains("global grant")) return "global_grant";
        if (n == "csr" || n.StartsWith("csr ") || n.Contains(" csr") || n.Contains("(csr)")) return "csr";
        return "other";
    }

    private async Task<string> GetFundingClassAsync(MySqlConnection conn, int? fundingId)
    {
        if (fundingId == null || fundingId.Value <= 0) return "";
        var name = await conn.ExecuteScalarAsync<string?>(
            "SELECT name FROM funding_master WHERE pk_funding_id = @id AND isdeleted = 0",
            new { id = fundingId.Value });
        return ClassifyFunding(name);
    }

    private static void ValidateAndNormalizeFundingFields(string fundingClass,
        ref string? globalGrantNumber, ref decimal? amountSanctioned, ref decimal? amountReceived, ref decimal? amountSpent,
        ref string? hostClubsDistricts, ref string? globalPartnerClubsDistricts, ref string? csrCompanyName)
    {
        if (fundingClass == "global_grant")
        {
            csrCompanyName = null;
            if (string.IsNullOrWhiteSpace(globalGrantNumber)) throw new InvalidOperationException("Global Grant Number is required for Global Grant funding.");
            if (amountSanctioned is null) throw new InvalidOperationException("Amount Sanctioned is required for Global Grant funding.");
            if (amountReceived is null) throw new InvalidOperationException("Amount Received is required for Global Grant funding.");
            if (amountSpent is null) throw new InvalidOperationException("Amount Spent Till Date is required for Global Grant funding.");
            if (string.IsNullOrWhiteSpace(hostClubsDistricts)) throw new InvalidOperationException("Host Clubs / Districts is required for Global Grant funding.");
            if (string.IsNullOrWhiteSpace(globalPartnerClubsDistricts)) throw new InvalidOperationException("Global Partner Clubs / Districts is required for Global Grant funding.");
        }
        else if (fundingClass == "csr")
        {
            globalGrantNumber = null;
            hostClubsDistricts = null;
            globalPartnerClubsDistricts = null;
            amountSpent = null;
            if (string.IsNullOrWhiteSpace(csrCompanyName)) throw new InvalidOperationException("CSR Company Name is required for CSR funding.");
            if (amountSanctioned is null) throw new InvalidOperationException("Amount Sanctioned is required for CSR funding.");
            if (amountReceived is null) throw new InvalidOperationException("Amount Received is required for CSR funding.");
        }
        else
        {
            globalGrantNumber = null;
            amountSanctioned = null;
            amountReceived = null;
            amountSpent = null;
            hostClubsDistricts = null;
            globalPartnerClubsDistricts = null;
            csrCompanyName = null;
        }
    }

    // ── Year-aware helpers ─────────────────────────────────────────
    // Find the (yearId, projectsTable, photosTable) for a project where we only know the id.
    // Scans existing year tables — used when a caller has just an id but no yearId.
    // Prefer callers to pass yearId directly when possible (most do, via URL routing).
    private async Task<(int yearId, string projectsTbl, string photosTbl)?> FindProjectYearAsync(MySqlConnection conn, int projectId)
    {
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        foreach (var t in tables)
        {
            var exists = await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{t.ProjectsTable}` WHERE pk_project_id = @Id AND isdeleted = 0",
                new { Id = projectId });
            if (exists > 0) return (t.YearId, t.ProjectsTable, t.PhotosTable);
        }
        return null;
    }

    // ── List by club + module + year ───────────────────────────────
    public async Task<PagedResult<ProjectListDto>> GetByClubAsync(int clubId, int moduleId, int yearId, int page, int pageSize, string? search, string? projectType = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var offset = (page - 1) * pageSize;
        var searchParam = string.IsNullOrEmpty(search) ? null : search;
        // projectType filter — when set, only return rows matching that type (e.g. 'ongoing_repeat' or 'one_time').
        // Treat null/empty as "all types". When filtering to ongoing_repeat we also want to return ONLY parent rows
        // (the row that represents the group, not the sub-projects under it) — children are loaded on expand.
        var typeParam = string.IsNullOrEmpty(projectType) || projectType == "all" ? null : projectType;

        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null)
            return new PagedResult<ProjectListDto> { Items = new List<ProjectListDto>(), TotalCount = 0, Page = page, PageSize = pageSize };

        // image_path in the DB now stores ONLY the filename. We reconstruct the full URL
        // at read time. Two layouts: migrated rows (old_pk IS NOT NULL) → no year segment
        // in path; new rows → year segment included. The CASE expression handles both.
        var suffix = info.YearLabel.Replace("-", "_");

        // Note: parent_project_id JOIN dropped — parent may live in a different year table.
        // Frontend can fetch parent separately via GET by (parentYearId, parentId) when needed.
        //
        // eff_parent (user 2026-10-07, "project count showing 7 but listing shows 6"): an entry whose
        // ongoing parent is in an EARLIER year table has no parent row here, so it was never listed
        // (144 entries / 68 clubs in 2026-27) while the counts included it. The earliest such entry
        // per old parent now acts as the top row (eff_parent 0); later ones nest under it.
        // Same rule as ClubAdminDashboardService.LoadAvenueProjectsAsync (web dashboard + mobile).
        var grp = $@"base AS (
                       SELECT b.pk_project_id, b.parent_project_id, b.project_date, b.project_type, b.title, b.location,
                              CASE WHEN COALESCE(b.parent_project_id, 0) = 0 THEN 0
                                   WHEN EXISTS (SELECT 1 FROM `{info.ProjectsTable}` x
                                                WHERE x.pk_project_id = b.parent_project_id AND x.fk_club_id = b.fk_club_id
                                                  AND x.isdeleted = 0) THEN 0
                                   ELSE 1 END AS orphan
                       FROM `{info.ProjectsTable}` b
                       WHERE b.fk_club_id = @ClubId AND b.fk_module_id = @ModuleId AND b.isdeleted = 0),
                     k AS (
                       SELECT base.*,
                              CASE WHEN orphan = 0 THEN COALESCE(parent_project_id, 0)
                                   ELSE NULLIF(FIRST_VALUE(pk_project_id) OVER (PARTITION BY orphan, parent_project_id
                                                 ORDER BY project_date, pk_project_id), pk_project_id) END AS eff_parent
                       FROM base),
                     page AS (
                       SELECT pk_project_id AS pid FROM k
                       WHERE COALESCE(eff_parent, 0) = 0
                         AND (@ProjectType IS NULL
                              OR project_type = @ProjectType
                              OR (@ProjectType = 'ongoing_repeat' AND project_type = 'ongoing')
                              OR (@ProjectType = 'ongoing' AND project_type = 'ongoing_repeat'))
                         AND (@Search IS NULL OR title LIKE CONCAT('%', @Search, '%') OR location LIKE CONCAT('%', @Search, '%'))";
        using var multi = await conn.QueryMultipleAsync(
            $@"WITH {grp}
                       ORDER BY project_date DESC, pk_project_id DESC
                       LIMIT @Offset, @PageSize)
               SELECT p.pk_project_id AS Id,
                      p.fk_club_id AS ClubId,
                      p.fk_module_id AS ModuleId,
                      p.fk_year_id AS YearId,
                      y.YearLabel,
                      -- Legacy rows store ongoing; new rows store ongoing_repeat. Normalise on the wire.
                      CASE WHEN p.project_type = 'ongoing' THEN 'ongoing_repeat' ELSE p.project_type END AS ProjectType,
                      NULLIF(COALESCE(k.eff_parent, 0), 0) AS ParentProjectId,
                      p.ongoing_group_title AS OngoingGroupTitle,
                      p.is_joint_project AS IsJointProject,
                      p.co_host_name AS CoHostName,
                      p.club_role AS ClubRole,
                      p.title AS Title,
                      p.location AS Location,
                      aof.name AS AreaOfFocusName,
                      p.other_area_of_focus AS OtherAreaOfFocus,
                      cat.name AS CategoryName,
                      p.other_category AS OtherCategory,
                      scat.name AS SubCategoryName,
                      p.other_sub_category AS OtherSubCategory,
                      p.project_date AS ProjectDate,
                      p.project_cost AS ProjectCost,
                      p.Currency AS Currency,
                      f.name AS FundingName,
                      p.direct_beneficiaries AS DirectBeneficiaries,
                      p.meeting_type AS MeetingType,
                      p.attendance AS Attendance,
                      p.attendance_percentage AS AttendancePercentage,
                      p.is_active AS IsActive,
                      p.approval_status AS ApprovalStatus,
                      -- Authoritative flag columns are send_whatsapp / send_email (create/update set
                      -- these). There is NO IsSendEmail column on the project table, so selecting it
                      -- threw the Unknown-column error; use send_email instead.
                      p.send_whatsapp AS IsSendWhatsapp, p.send_email AS IsSendEmail,
                      p.WhatsAppSentDate AS WhatsAppSentDate, p.WhatsAppSentCount AS WhatsAppSentCount, p.WhatsAppFailedCount AS WhatsAppFailedCount,
                      p.EmailSentDate AS EmailSentDate, p.EmailSentCount AS EmailSentCount, p.EmailFailedCount AS EmailFailedCount,
                      (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                CASE WHEN p.old_pk IS NOT NULL
                                     THEN CONCAT('Album', p.old_pk)
                                     ELSE CONCAT('{suffix}/Album', p.pk_project_id)
                                END,
                                '/', pp.image_path)
                       FROM `{info.PhotosTable}` pp
                       WHERE pp.fk_project_id = p.pk_project_id AND pp.is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
               /* Pagination applies to TOP rows only: `page` holds exactly @PageSize top-row ids;
                  this then fetches those rows PLUS everything nested under them (eff_parent). */
               FROM `{info.ProjectsTable}` p
               JOIN k ON k.pk_project_id = p.pk_project_id
               JOIN (SELECT DISTINCT pid FROM page) pg ON pg.pid = p.pk_project_id OR pg.pid = k.eff_parent
               LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
               LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
               LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
               LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
               LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
               WHERE p.fk_club_id = @ClubId
                 AND p.fk_module_id = @ModuleId
                 AND p.isdeleted = 0
               ORDER BY p.project_date DESC, p.pk_project_id DESC;

               /* Total count is TOP rows only so pagination reflects what the user sees as rows. */
               WITH {grp})
               SELECT COUNT(*) AS TotalCount FROM page;",
            new { ClubId = clubId, ModuleId = moduleId, Offset = offset, PageSize = pageSize, Search = searchParam, ProjectType = typeParam });

        var items = (await multi.ReadAsync<ProjectListDto>()).ToList();
        var totalCount = await multi.ReadFirstAsync<int>();

        return new PagedResult<ProjectListDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
        };
    }

    // ── Get one by (year, id) ──────────────────────────────────────
    // pk_project_id is only unique WITHIN a year table and is reused across years for
    // different clubs, so the correct year is essential. If the caller's yearId doesn't
    // hold the project (a stale/missing year param from a cross-flow link, e.g. the Monthly
    // Report meetings step), fall back to locating it by (id + club) — unique — so the
    // edit/view still resolves the right row instead of 404-ing "Project not found".
    public async Task<ProjectDetailDto?> GetByIdAsync(int id, int yearId, int clubId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        var project = info is null ? null : await FetchProjectAsync(conn, info, id, clubId);
        if (project is not null) return project;

        // Fallback: the requested year didn't contain this club's project — find the right year.
        var located = await _yearTables.FindByProjectAndClubAsync(conn, id, clubId);
        if (located is null || (info is not null && located.YearId == info.YearId)) return null;
        return await FetchProjectAsync(conn, located, id, clubId);
    }

    private async Task<ProjectDetailDto?> FetchProjectAsync(MySqlConnection conn, YearTableInfo info, int id, int clubId)
    {
        var suffix = info.YearLabel.Replace("-", "_");

        using var multi = await conn.QueryMultipleAsync(
            $@"SELECT p.pk_project_id AS Id,
                      p.fk_club_id AS ClubId,
                      p.fk_module_id AS ModuleId,
                      p.fk_year_id AS YearId,
                      y.YearLabel,
                      -- Legacy rows store ongoing; new rows store ongoing_repeat. Normalise on the wire.
                      CASE WHEN p.project_type = 'ongoing' THEN 'ongoing_repeat' ELSE p.project_type END AS ProjectType,
                      p.parent_project_id AS ParentProjectId,
                      p.ongoing_group_title AS OngoingGroupTitle,
                      p.is_joint_project AS IsJointProject,
                      p.co_host_name AS CoHostName,
                      p.club_role AS ClubRole,
                      p.title AS Title,
                      p.description AS Description,
                      p.location AS Location,
                      p.fk_area_of_focus_id AS AreaOfFocusId,
                      aof.name AS AreaOfFocusName,
                      p.other_area_of_focus AS OtherAreaOfFocus,
                      p.fk_category_id AS CategoryId,
                      cat.name AS CategoryName,
                      p.other_category AS OtherCategory,
                      p.fk_sub_category_id AS SubCategoryId,
                      scat.name AS SubCategoryName,
                      p.other_sub_category AS OtherSubCategory,
                      p.project_date AS ProjectDate,
                      p.project_cost AS ProjectCost,
                      p.Currency AS Currency,
                      p.fk_funding_id AS FundingId,
                      f.name AS FundingName,
                      p.direct_beneficiaries AS DirectBeneficiaries,
                      p.man_hours AS ManHours,
                      p.rotarians_involved AS RotariansInvolved,
                      p.rotaractors_involved AS RotaractorsInvolved,
                      COALESCE(p.rcc_involved,0) AS RccInvolved,
                      p.send_whatsapp AS SendWhatsapp,
                      p.send_email AS SendEmail,
                      p.meeting_type AS MeetingType,
                      p.agenda_document AS AgendaDocument,
                      p.minutes_document AS MinutesDocument,
                      p.attendance AS Attendance,
                      p.attendance_percentage AS AttendancePercentage,
                      p.global_grant_number AS GlobalGrantNumber,
                      p.amount_sanctioned AS AmountSanctioned,
                      p.amount_received AS AmountReceived,
                      p.amount_spent AS AmountSpent,
                      p.host_clubs_districts AS HostClubsDistricts,
                      p.global_partner_clubs_districts AS GlobalPartnerClubsDistricts,
                      p.csr_company_name AS CsrCompanyName,
                      p.is_active AS IsActive
               FROM `{info.ProjectsTable}` p
               LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
               LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
               LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
               LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
               LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
               WHERE p.pk_project_id = @Id AND p.fk_club_id = @ClubId AND p.isdeleted = 0;

               SELECT pp.pk_photo_id AS Id,
                      pp.fk_project_id AS ProjectId,
                      CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                             CASE WHEN p.old_pk IS NOT NULL
                                  THEN CONCAT('Album', p.old_pk)
                                  ELSE CONCAT('{suffix}/Album', p.pk_project_id)
                             END,
                             '/', pp.image_path) AS ImagePath,
                      pp.description AS Description,
                      pp.is_primary AS IsPrimary,
                      pp.sort_order AS SortOrder
               FROM `{info.PhotosTable}` pp
               JOIN `{info.ProjectsTable}` p ON p.pk_project_id = pp.fk_project_id
               WHERE pp.fk_project_id = @Id
               ORDER BY pp.sort_order;",
            new { Id = id, ClubId = clubId });

        var project = await multi.ReadFirstOrDefaultAsync<ProjectDetailDto>();
        if (project == null) return null;

        var photos = (await multi.ReadAsync<ProjectPhotoDto>()).ToList();
        project.Photos = photos;
        return project;
    }

    // ── Create (year is derived from project_date) ─────────────────
    // Attendance cap removed per 2026-06-12 product decision — admins may enter
    // any attendance count (including >100%). Method retained as a no-op for
    // call-site compatibility; remove if no longer referenced.
    private static Task ValidateAttendanceAgainstMeetingTypeAsync(
        MySqlConnection conn, int clubId, int yearId, string? meetingType, int? attendance)
    {
        return Task.CompletedTask;
    }

    public async Task<int> CreateAsync(int clubId, CreateProjectDto dto, int createdBy)
    {
        // project_date picks the year-partitioned table (and auto-creates the rotary year), so a
        // typo'd year spawns a junk year + junk tables that pollute the public year filter.
        // Shared rule lives in ProjectDateValidator — no future dates, nothing before 1985.
        ProjectDateValidator.ThrowIfInvalid(dto.ProjectDate);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Pre-check WhatsApp credits BEFORE insert
        int memberCountForCheck = 0;
        if (dto.SendWhatsapp && clubId > 0)
        {
            memberCountForCheck = await conn.ExecuteScalarAsync<int>(
                @"SELECT COUNT(*) FROM club_members cm
                  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                    AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''",
                new { Id = clubId });
            if (memberCountForCheck > 0)
            {
                using var preScope = _scopeFactory.CreateScope();
                var creditSvc = preScope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(clubId, "WhatsApp", memberCountForCheck))
                    throw new InvalidOperationException($"Insufficient WhatsApp credits. Need {memberCountForCheck} credit(s).");
            }
        }

        // Pre-check Email credits BEFORE insert (parity with WhatsApp; counts members with an email).
        if (dto.SendEmail && clubId > 0)
        {
            int emailMemberCount = await conn.ExecuteScalarAsync<int>(
                @"SELECT COUNT(*) FROM club_members cm
                  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                    AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                new { Id = clubId });
            if (emailMemberCount > 0)
            {
                using var preScope = _scopeFactory.CreateScope();
                var creditSvc = preScope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(clubId, "Email", emailMemberCount))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailMemberCount} credit(s).");
            }
        }

        // Determine year from project date (RotaryYearHelper auto-creates year row + year-wise tables if missing).
        var yearId = await RotaryYearHelper.EnsureRotaryYearAsync(conn, dto.ProjectDate);
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"Could not resolve year-wise tables for yearId {yearId}.");
        var suffix = info.YearLabel.Replace("-", "_");

        // Club Service rule — attendance cap depends on meeting type for the project's rotary year.
        await ValidateAttendanceAgainstMeetingTypeAsync(conn, clubId, yearId, dto.MeetingType, dto.Attendance);

        var fundingClass = await GetFundingClassAsync(conn, dto.FundingId);
        var ggNumber = dto.GlobalGrantNumber;
        var amtSanc = dto.AmountSanctioned;
        var amtRecv = dto.AmountReceived;
        var amtSpent = dto.AmountSpent;
        var hostCD = dto.HostClubsDistricts;
        var gpCD = dto.GlobalPartnerClubsDistricts;
        var csrCo = dto.CsrCompanyName;
        ValidateAndNormalizeFundingFields(fundingClass,
            ref ggNumber, ref amtSanc, ref amtRecv, ref amtSpent, ref hostCD, ref gpCD, ref csrCo);

        var projectId = await conn.ExecuteScalarAsync<int>(
            $@"INSERT INTO `{info.ProjectsTable}` (
                fk_club_id, fk_module_id, fk_year_id, project_type, parent_project_id,
                ongoing_group_title, is_joint_project, co_host_name, club_role,
                title, description, location,
                fk_area_of_focus_id, other_area_of_focus,
                fk_category_id, other_category,
                fk_sub_category_id, other_sub_category,
                project_date, project_cost, Currency, fk_funding_id,
                direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved, rcc_involved,
                send_whatsapp, send_email, meeting_type, agenda_document, minutes_document,
                attendance, attendance_percentage,
                global_grant_number, amount_sanctioned, amount_received, amount_spent,
                host_clubs_districts, global_partner_clubs_districts, csr_company_name,
                created_by
              ) VALUES (
                @ClubId, @ModuleId, @YearId, @ProjectType, @ParentProjectId,
                @OngoingGroupTitle, @IsJointProject, @CoHostName, @ClubRole,
                @Title, @Description, @Location,
                @AreaOfFocusId, @OtherAreaOfFocus,
                @CategoryId, @OtherCategory,
                @SubCategoryId, @OtherSubCategory,
                @ProjectDate, @ProjectCost, @Currency, @FundingId,
                @DirectBeneficiaries, @ManHours, @RotariansInvolved, @RotaractorsInvolved, @RccInvolved,
                @SendWhatsapp, @SendEmail, @MeetingType, @AgendaDocument, @MinutesDocument,
                @Attendance, @AttendancePercentage,
                @GlobalGrantNumber, @AmountSanctioned, @AmountReceived, @AmountSpent,
                @HostClubsDistricts, @GlobalPartnerClubsDistricts, @CsrCompanyName,
                @CreatedBy
              );
              SELECT LAST_INSERT_ID()",
            new
            {
                ClubId = clubId, ModuleId = dto.ModuleId, YearId = yearId,
                ProjectType = dto.ProjectType, ParentProjectId = dto.ParentProjectId,
                OngoingGroupTitle = dto.OngoingGroupTitle, IsJointProject = dto.IsJointProject,
                CoHostName = dto.CoHostName, ClubRole = dto.ClubRole,
                Title = dto.Title, Description = dto.Description, Location = dto.Location,
                AreaOfFocusId = dto.AreaOfFocusId, OtherAreaOfFocus = dto.OtherAreaOfFocus,
                CategoryId = dto.CategoryId, OtherCategory = dto.OtherCategory,
                SubCategoryId = dto.SubCategoryId, OtherSubCategory = dto.OtherSubCategory,
                ProjectDate = dto.ProjectDate, ProjectCost = dto.ProjectCost,
                Currency = CurrencyHelper.Normalize(dto.Currency), FundingId = dto.FundingId,
                DirectBeneficiaries = dto.DirectBeneficiaries, ManHours = dto.ManHours,
                RotariansInvolved = dto.RotariansInvolved, RotaractorsInvolved = dto.RotaractorsInvolved,
                RccInvolved = dto.RccInvolved ?? 0,
                SendWhatsapp = dto.SendWhatsapp, SendEmail = dto.SendEmail, MeetingType = dto.MeetingType,
                AgendaDocument = dto.AgendaDocument, MinutesDocument = dto.MinutesDocument,
                Attendance = dto.Attendance, AttendancePercentage = dto.AttendancePercentage,
                GlobalGrantNumber = ggNumber, AmountSanctioned = amtSanc,
                AmountReceived = amtRecv, AmountSpent = amtSpent,
                HostClubsDistricts = hostCD, GlobalPartnerClubsDistricts = gpCD,
                CsrCompanyName = csrCo, CreatedBy = createdBy
            });

        // Photos — move from temp to the year-aware Album folder, store ONLY the filename in DB.
        // Full path is reconstructed on read via CONCAT. Album folder includes year suffix so
        // new uploads don't collide with migrated old-data folders (which lack the year segment).
        if (dto.Photos != null)
        {
            var albumPath = Path.Combine(_env.WebRootPath, "Documents", "gallery", $"Group{clubId}", suffix, $"Album{projectId}");
            Directory.CreateDirectory(albumPath);

            foreach (var photo in dto.Photos)
            {
                // Extract just the filename from whatever the client sent (could be /tempdocument/X.jpg
                // or a relative path the client constructed — we don't trust the dir part).
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);

                if (!string.IsNullOrEmpty(photo.ImagePath) && photo.ImagePath.Contains("/tempdocument/"))
                {
                    var sourcePath = Path.Combine(_env.WebRootPath, "tempdocument", fileName);
                    var destPath = Path.Combine(albumPath, fileName);
                    if (File.Exists(sourcePath))
                    {
                        File.Move(sourcePath, destPath, true);
                    }
                }

                if (photo.IsPrimary)
                {
                    await conn.ExecuteAsync(
                        $"UPDATE `{info.PhotosTable}` SET is_primary = 0 WHERE fk_project_id = @ProjectId",
                        new { ProjectId = projectId });
                }
                await conn.ExecuteAsync(
                    $@"INSERT INTO `{info.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order)
                       VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder)",
                    new
                    {
                        ProjectId = projectId, ImagePath = fileName,
                        Description = photo.Description, IsPrimary = photo.IsPrimary, SortOrder = photo.SortOrder
                    });
            }
        }

        // Moderator approval — pass yearId so approval flow can locate the project
        // without doing a cross-year FindByProjectIdAsync scan (which races against
        // the pooled connection's visibility of the just-INSERTed row).
        try
        {
            using var approvalScope = _scopeFactory.CreateScope();
            var approvalService = approvalScope.ServiceProvider.GetRequiredService<IProjectApprovalService>();
            await approvalService.SetPendingApprovalAsync(projectId, clubId, dto.ModuleId, createdBy, yearId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check/set moderator approval for project {ProjectId}", projectId);
        }

        // Refresh District Awards auto-count: projects power the Club/Community
        // /Vocational/International/NewGen/PublicImage service-module counts.
        _citationRecalc.TriggerForClub(clubId);

        return projectId;
    }

    // ── Update one (caller passes yearId; date-change-across-years not handled this version) ──
    public async Task UpdateAsync(int id, int yearId, UpdateProjectDto dto, int modifiedBy)
    {
        // Same guard as CreateAsync — an edited project_date re-derives the year and can create
        // a junk rotary year / year table from a typo. See ProjectDateValidator.
        ProjectDateValidator.ThrowIfInvalid(dto.ProjectDate);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"Could not resolve year-wise tables for yearId {yearId}.");

        // Year-move guard: if the admin changed project_date to a date in a DIFFERENT rotary year,
        // the row must be relocated to that year's tables (its PK changes). We signal the controller
        // with a typed exception so the frontend can confirm the move, then call MoveProjectAsync.
        if (dto.ProjectDate.HasValue)
        {
            var dateYearId = await RotaryYearHelper.EnsureRotaryYearAsync(conn, dto.ProjectDate.Value);
            if (dateYearId != yearId)
            {
                var toInfo = await _yearTables.ResolveByYearIdAsync(conn, dateYearId);
                throw new CrossYearMoveRequiredException(
                    yearId, dateYearId, info.YearLabel, toInfo?.YearLabel ?? dateYearId.ToString());
            }
        }

        var prior = await conn.QueryFirstOrDefaultAsync<dynamic>(
            $@"SELECT fk_club_id, send_whatsapp FROM `{info.ProjectsTable}` WHERE pk_project_id = @Id AND isdeleted = 0",
            new { Id = id });
        int clubIdForCheck = prior != null ? (int)prior.fk_club_id : 0;
        bool shouldSend = dto.SendWhatsapp;
        if (shouldSend && clubIdForCheck > 0)
        {
            int memberCountForCheck = await conn.ExecuteScalarAsync<int>(
                @"SELECT COUNT(*) FROM club_members cm
                  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                    AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''",
                new { Id = clubIdForCheck });
            if (memberCountForCheck > 0)
            {
                using var preScope = _scopeFactory.CreateScope();
                var creditSvc = preScope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(clubIdForCheck, "WhatsApp", memberCountForCheck))
                    throw new InvalidOperationException($"Insufficient WhatsApp credits. Need {memberCountForCheck} credit(s). Please uncheck 'Send through WhatsApp' to save without WhatsApp notification, or purchase more credits.");
            }
        }

        // Pre-check Email credits BEFORE update (parity with WhatsApp; counts members with an email).
        if (dto.SendEmail && clubIdForCheck > 0)
        {
            int emailMemberCount = await conn.ExecuteScalarAsync<int>(
                @"SELECT COUNT(*) FROM club_members cm
                  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                    AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                new { Id = clubIdForCheck });
            if (emailMemberCount > 0)
            {
                using var preScope = _scopeFactory.CreateScope();
                var creditSvc = preScope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(clubIdForCheck, "Email", emailMemberCount))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailMemberCount} credit(s). Please uncheck 'Send through Email' to save without email notification, or purchase more credits.");
            }
        }

        var fundingClass = await GetFundingClassAsync(conn, dto.FundingId);
        var ggNumber = dto.GlobalGrantNumber;
        var amtSanc = dto.AmountSanctioned;
        var amtRecv = dto.AmountReceived;
        var amtSpent = dto.AmountSpent;
        var hostCD = dto.HostClubsDistricts;
        var gpCD = dto.GlobalPartnerClubsDistricts;
        var csrCo = dto.CsrCompanyName;
        ValidateAndNormalizeFundingFields(fundingClass,
            ref ggNumber, ref amtSanc, ref amtRecv, ref amtSpent, ref hostCD, ref gpCD, ref csrCo);

        // Club Service rule — attendance cap depends on meeting type for the project's rotary year.
        if (clubIdForCheck > 0)
            await ValidateAttendanceAgainstMeetingTypeAsync(conn, clubIdForCheck, yearId, dto.MeetingType, dto.Attendance);

        // Currency: only v2 edit pages send this. When absent (v1 edit pages, or any other caller),
        // COALESCE below in the SQL leaves the project's existing currency untouched rather than
        // silently resetting it to INR.
        string? currencyToSet = string.IsNullOrWhiteSpace(dto.Currency) ? null : CurrencyHelper.Normalize(dto.Currency);

        await conn.ExecuteAsync(
            $@"UPDATE `{info.ProjectsTable}` SET
                project_type = @ProjectType,
                parent_project_id = @ParentProjectId,
                ongoing_group_title = @OngoingGroupTitle,
                is_joint_project = @IsJointProject,
                co_host_name = @CoHostName,
                club_role = @ClubRole,
                title = @Title,
                description = @Description,
                location = @Location,
                fk_area_of_focus_id = @AreaOfFocusId,
                other_area_of_focus = @OtherAreaOfFocus,
                fk_category_id = @CategoryId,
                other_category = @OtherCategory,
                fk_sub_category_id = @SubCategoryId,
                other_sub_category = @OtherSubCategory,
                project_date = @ProjectDate,
                project_cost = @ProjectCost,
                Currency = COALESCE(@Currency, Currency),
                fk_funding_id = @FundingId,
                direct_beneficiaries = @DirectBeneficiaries,
                man_hours = @ManHours,
                rotarians_involved = @RotariansInvolved,
                rotaractors_involved = @RotaractorsInvolved,
                rcc_involved = @RccInvolved,
                send_whatsapp = @SendWhatsapp,
                send_email = @SendEmail,
                meeting_type = @MeetingType,
                agenda_document = @AgendaDocument,
                minutes_document = @MinutesDocument,
                attendance = @Attendance,
                attendance_percentage = @AttendancePercentage,
                global_grant_number = @GlobalGrantNumber,
                amount_sanctioned = @AmountSanctioned,
                amount_received = @AmountReceived,
                amount_spent = @AmountSpent,
                host_clubs_districts = @HostClubsDistricts,
                global_partner_clubs_districts = @GlobalPartnerClubsDistricts,
                csr_company_name = @CsrCompanyName,
                modified_by = @ModifiedBy
              WHERE pk_project_id = @Id AND isdeleted = 0",
            new
            {
                Id = id,
                ProjectType = dto.ProjectType, ParentProjectId = dto.ParentProjectId,
                OngoingGroupTitle = dto.OngoingGroupTitle, IsJointProject = dto.IsJointProject,
                CoHostName = dto.CoHostName, ClubRole = dto.ClubRole,
                Title = dto.Title, Description = dto.Description, Location = dto.Location,
                AreaOfFocusId = dto.AreaOfFocusId, OtherAreaOfFocus = dto.OtherAreaOfFocus,
                CategoryId = dto.CategoryId, OtherCategory = dto.OtherCategory,
                SubCategoryId = dto.SubCategoryId, OtherSubCategory = dto.OtherSubCategory,
                ProjectDate = dto.ProjectDate, ProjectCost = dto.ProjectCost,
                Currency = currencyToSet, FundingId = dto.FundingId,
                DirectBeneficiaries = dto.DirectBeneficiaries, ManHours = dto.ManHours,
                RotariansInvolved = dto.RotariansInvolved, RotaractorsInvolved = dto.RotaractorsInvolved,
                RccInvolved = dto.RccInvolved ?? 0,
                SendWhatsapp = dto.SendWhatsapp, SendEmail = dto.SendEmail, MeetingType = dto.MeetingType,
                AgendaDocument = dto.AgendaDocument, MinutesDocument = dto.MinutesDocument,
                Attendance = dto.Attendance, AttendancePercentage = dto.AttendancePercentage,
                GlobalGrantNumber = ggNumber, AmountSanctioned = amtSanc,
                AmountReceived = amtRecv, AmountSpent = amtSpent,
                HostClubsDistricts = hostCD, GlobalPartnerClubsDistricts = gpCD,
                CsrCompanyName = csrCo, ModifiedBy = modifiedBy
            });

        // Send-after-edit: the existing "Send through WhatsApp / Email" checkboxes are the control.
        // If a box is (still) checked on save, clear its sent-stamp so the scheduler re-notifies with
        // the updated project. Leaving a box UNchecked sends nothing (flag=0) — that already worked.
        // Projects have no publish date, so a checked edit re-sends on the next scheduler run (WhatsApp
        // still respects approval). Credits were pre-checked above and are deducted at send time.
        if (dto.SendWhatsapp)
            await conn.ExecuteAsync(
                $"UPDATE `{info.ProjectsTable}` SET WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0 WHERE pk_project_id = @Id AND isdeleted = 0",
                new { Id = id });
        if (dto.SendEmail)
            await conn.ExecuteAsync(
                $"UPDATE `{info.ProjectsTable}` SET EmailSentDate = NULL, EmailSentCount = 0, EmailFailedCount = 0 WHERE pk_project_id = @Id AND isdeleted = 0",
                new { Id = id });

        // Replace photos if provided — direct SQL on year-wise photo table. Store filename only.
        if (dto.Photos != null)
        {
            await conn.ExecuteAsync(
                $"DELETE FROM `{info.PhotosTable}` WHERE fk_project_id = @ProjectId",
                new { ProjectId = id });

            foreach (var photo in dto.Photos)
            {
                var fileName = string.IsNullOrEmpty(photo.ImagePath) ? "" : Path.GetFileName(photo.ImagePath);
                if (photo.IsPrimary)
                {
                    await conn.ExecuteAsync(
                        $"UPDATE `{info.PhotosTable}` SET is_primary = 0 WHERE fk_project_id = @ProjectId",
                        new { ProjectId = id });
                }
                await conn.ExecuteAsync(
                    $@"INSERT INTO `{info.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order)
                       VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder)",
                    new
                    {
                        ProjectId = id, ImagePath = fileName,
                        Description = photo.Description, IsPrimary = photo.IsPrimary, SortOrder = photo.SortOrder
                    });
            }
        }

        try
        {
            var projectInfo = await conn.QueryFirstOrDefaultAsync<dynamic>(
                $"SELECT fk_club_id, fk_module_id FROM `{info.ProjectsTable}` WHERE pk_project_id = @Id",
                new { Id = id });
            if (projectInfo != null)
            {
                using var approvalScope = _scopeFactory.CreateScope();
                var approvalService = approvalScope.ServiceProvider.GetRequiredService<IProjectApprovalService>();
                // Pass yearId so SetPendingApprovalAsync skips the cross-year scan
                // (same hardening as CreateAsync — see IProjectApprovalService.cs).
                await approvalService.SetPendingApprovalAsync(id, (int)projectInfo.fk_club_id, (int)projectInfo.fk_module_id, modifiedBy, yearId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to re-check moderator approval on project update {ProjectId}", id);
        }

        // Refresh District Awards count for the project's club after update.
        try
        {
            int updClubFk = await conn.ExecuteScalarAsync<int>(
                $"SELECT fk_club_id FROM `{info.ProjectsTable}` WHERE pk_project_id = @Id",
                new { Id = id });
            if (updClubFk > 0) _citationRecalc.TriggerForClub(updClubFk);
        }
        catch { /* recalc is best-effort */ }
    }

    // ── Cross-year move ────────────────────────────────────────────
    // Relocates a project (and its photos) from fromYearId's tables to the year implied by
    // dto.ProjectDate. Copies first, VERIFIES the copy (project row + photo counts match),
    // and only then removes the source — so a failed move never destroys data.
    // The project gets a NEW pk in the target year (auto-increment).
    public async Task<(int NewYearId, int NewProjectId, string NewYearLabel)> MoveProjectAsync(int id, int fromYearId, UpdateProjectDto dto, int modifiedBy)
    {
        if (!dto.ProjectDate.HasValue)
            throw new InvalidOperationException("Project date is required to move a project.");

        // The move target year is derived from this date too — same guard. See ProjectDateValidator.
        ProjectDateValidator.ThrowIfInvalid(dto.ProjectDate);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var srcInfo = await _yearTables.ResolveByYearIdAsync(conn, fromYearId)
            ?? throw new InvalidOperationException($"Could not resolve source year tables for yearId {fromYearId}.");

        var toYearId = await RotaryYearHelper.EnsureRotaryYearAsync(conn, dto.ProjectDate.Value);
        if (toYearId == fromYearId)
            throw new InvalidOperationException("Project date is in the same rotary year — use the normal update, not move.");

        var tgtInfo = await _yearTables.ResolveByYearIdAsync(conn, toYearId)
            ?? throw new InvalidOperationException($"Could not resolve target year tables for yearId {toYearId}.");

        var srcSuffix = srcInfo.YearLabel.Replace("-", "_");
        var tgtSuffix = tgtInfo.YearLabel.Replace("-", "_");

        // Source row must exist and be live.
        var src = await conn.QueryFirstOrDefaultAsync<dynamic>(
            $"SELECT fk_club_id, old_pk FROM `{srcInfo.ProjectsTable}` WHERE pk_project_id = @Id AND isdeleted = 0",
            new { Id = id })
            ?? throw new InvalidOperationException("Project not found in the source year (or already deleted).");
        int clubId = (int)src.fk_club_id;
        int? oldPk = src.old_pk == null ? (int?)null : (int)src.old_pk;

        // Validate funding the same way UpdateAsync does.
        var fundingClass = await GetFundingClassAsync(conn, dto.FundingId);
        var ggNumber = dto.GlobalGrantNumber; var amtSanc = dto.AmountSanctioned;
        var amtRecv = dto.AmountReceived; var amtSpent = dto.AmountSpent;
        var hostCD = dto.HostClubsDistricts; var gpCD = dto.GlobalPartnerClubsDistricts;
        var csrCo = dto.CsrCompanyName;
        ValidateAndNormalizeFundingFields(fundingClass,
            ref ggNumber, ref amtSanc, ref amtRecv, ref amtSpent, ref hostCD, ref gpCD, ref csrCo);

        using var tx = await conn.BeginTransactionAsync();
        try
        {
            // 1) Insert into target year — editable fields from dto, system fields preserved from source.
            var newId = await conn.ExecuteScalarAsync<int>($@"
                INSERT INTO `{tgtInfo.ProjectsTable}` (
                    fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType,
                    project_type, parent_project_id, ongoing_group_title, is_joint_project,
                    co_host_name, club_role, title, description, location,
                    fk_area_of_focus_id, other_area_of_focus, fk_category_id, other_category,
                    fk_sub_category_id, other_sub_category, project_date, project_cost, Currency, fk_funding_id,
                    direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved, rcc_involved,
                    send_whatsapp, send_email, meeting_type, agenda_document, minutes_document,
                    attendance, attendance_percentage, global_grant_number,
                    amount_sanctioned, amount_received, amount_spent,
                    host_clubs_districts, global_partner_clubs_districts, csr_company_name,
                    IsSendWhatsapp, WhatsAppSentDate, WhatsAppSentCount, WhatsAppFailedCount,
                    EmailSentDate, EmailSentCount, EmailFailedCount,
                    PushNotificationSent, PushNotificationSentAt,
                    approval_status, approval_remark, approved_by, approval_date, approval_token,
                    is_active, created_by, created_date, modified_by, old_pk)
                SELECT
                    fk_club_id, fk_district_id, fk_module_id, @ToYearId, DistrictProjectType,
                    @ProjectType, @ParentProjectId, @OngoingGroupTitle, @IsJointProject,
                    @CoHostName, @ClubRole, @Title, @Description, @Location,
                    @AreaOfFocusId, @OtherAreaOfFocus, @CategoryId, @OtherCategory,
                    @SubCategoryId, @OtherSubCategory, @ProjectDate, @ProjectCost, Currency, @FundingId,
                    @DirectBeneficiaries, @ManHours, @RotariansInvolved, @RotaractorsInvolved, @RccInvolved,
                    @SendWhatsapp, @SendEmail, @MeetingType, @AgendaDocument, @MinutesDocument,
                    @Attendance, @AttendancePercentage, @GlobalGrantNumber,
                    @AmountSanctioned, @AmountReceived, @AmountSpent,
                    @HostClubsDistricts, @GlobalPartnerClubsDistricts, @CsrCompanyName,
                    IsSendWhatsapp, WhatsAppSentDate, WhatsAppSentCount, WhatsAppFailedCount,
                    EmailSentDate, EmailSentCount, EmailFailedCount,
                    PushNotificationSent, PushNotificationSentAt,
                    approval_status, approval_remark, approved_by, approval_date, approval_token,
                    is_active, created_by, created_date, @ModifiedBy, old_pk
                FROM `{srcInfo.ProjectsTable}` WHERE pk_project_id = @Id AND isdeleted = 0;
                SELECT LAST_INSERT_ID();",
                new
                {
                    ToYearId = toYearId, Id = id, ModifiedBy = modifiedBy,
                    ProjectType = dto.ProjectType, ParentProjectId = dto.ParentProjectId,
                    OngoingGroupTitle = dto.OngoingGroupTitle, IsJointProject = dto.IsJointProject,
                    CoHostName = dto.CoHostName, ClubRole = dto.ClubRole,
                    Title = dto.Title, Description = dto.Description, Location = dto.Location,
                    AreaOfFocusId = dto.AreaOfFocusId, OtherAreaOfFocus = dto.OtherAreaOfFocus,
                    CategoryId = dto.CategoryId, OtherCategory = dto.OtherCategory,
                    SubCategoryId = dto.SubCategoryId, OtherSubCategory = dto.OtherSubCategory,
                    ProjectDate = dto.ProjectDate, ProjectCost = dto.ProjectCost, FundingId = dto.FundingId,
                    DirectBeneficiaries = dto.DirectBeneficiaries, ManHours = dto.ManHours,
                    RotariansInvolved = dto.RotariansInvolved, RotaractorsInvolved = dto.RotaractorsInvolved,
                    RccInvolved = dto.RccInvolved ?? 0,
                    SendWhatsapp = dto.SendWhatsapp, SendEmail = dto.SendEmail, MeetingType = dto.MeetingType,
                    AgendaDocument = dto.AgendaDocument, MinutesDocument = dto.MinutesDocument,
                    Attendance = dto.Attendance, AttendancePercentage = dto.AttendancePercentage,
                    GlobalGrantNumber = ggNumber, AmountSanctioned = amtSanc,
                    AmountReceived = amtRecv, AmountSpent = amtSpent,
                    HostClubsDistricts = hostCD, GlobalPartnerClubsDistricts = gpCD, CsrCompanyName = csrCo
                }, tx);

            // 2) Copy photos to target, pointing at the new project id (filename-only image_path preserved).
            await conn.ExecuteAsync($@"
                INSERT INTO `{tgtInfo.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
                SELECT @NewId, image_path, description, is_primary, sort_order, created_date
                FROM `{srcInfo.PhotosTable}` WHERE fk_project_id = @Id",
                new { NewId = newId, Id = id }, tx);

            // 3) VERIFY before deleting anything.
            var srcPhotos = await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{srcInfo.PhotosTable}` WHERE fk_project_id = @Id", new { Id = id }, tx);
            var tgtPhotos = await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{tgtInfo.PhotosTable}` WHERE fk_project_id = @NewId", new { NewId = newId }, tx);
            var tgtExists = await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{tgtInfo.ProjectsTable}` WHERE pk_project_id = @NewId", new { NewId = newId }, tx);

            if (tgtExists != 1 || srcPhotos != tgtPhotos)
            {
                await tx.RollbackAsync();
                throw new InvalidOperationException(
                    $"Move verification failed (target project rows={tgtExists}, photos src={srcPhotos}/tgt={tgtPhotos}). Nothing was deleted.");
            }

            // 4) Verified — remove source. Photos hard-deleted (now in target); project soft-deleted (audit trail).
            await conn.ExecuteAsync(
                $"DELETE FROM `{srcInfo.PhotosTable}` WHERE fk_project_id = @Id", new { Id = id }, tx);
            await conn.ExecuteAsync(
                $@"UPDATE `{srcInfo.ProjectsTable}` SET isdeleted = 1, deleted_by = @ModifiedBy, deleted_date = NOW()
                   WHERE pk_project_id = @Id", new { Id = id, ModifiedBy = modifiedBy }, tx);

            await tx.CommitAsync();

            // 5) Disk folder: only NEW (non-migrated) projects keep their files on this server under a
            //    year-aware Album folder. Migrated projects (old_pk set) resolve via old_pk to the legacy
            //    server folder, so they need no disk move. Best-effort; logged on failure.
            if (oldPk == null)
            {
                try
                {
                    var srcFolder = Path.Combine(_env.WebRootPath, "Documents", "gallery", $"Group{clubId}", srcSuffix, $"Album{id}");
                    var tgtFolder = Path.Combine(_env.WebRootPath, "Documents", "gallery", $"Group{clubId}", tgtSuffix, $"Album{newId}");
                    if (Directory.Exists(srcFolder))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(tgtFolder)!);
                        if (Directory.Exists(tgtFolder)) Directory.Delete(tgtFolder, true);
                        Directory.Move(srcFolder, tgtFolder);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Project {Id} moved in DB ({From}->{To}) but disk folder move failed; photos may 404 until folder is relocated manually.", id, fromYearId, toYearId);
                }
            }

            return (toYearId, newId, tgtInfo.YearLabel);
        }
        catch
        {
            try { await tx.RollbackAsync(); } catch { /* already rolled back / committed */ }
            throw;
        }
    }

    // ── Soft-delete one ────────────────────────────────────────────
    public async Task DeleteAsync(int id, int yearId, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"Could not resolve year-wise tables for yearId {yearId}.");

        // Capture the club ID before the soft-delete so we can recalc.
        int clubFk = await conn.ExecuteScalarAsync<int>(
            $"SELECT fk_club_id FROM `{info.ProjectsTable}` WHERE pk_project_id = @Id",
            new { Id = id });

        await conn.ExecuteAsync(
            $@"UPDATE `{info.ProjectsTable}`
               SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
               WHERE pk_project_id = @Id AND isdeleted = 0",
            new { Id = id, DeletedBy = deletedBy });

        if (clubFk > 0) _citationRecalc.TriggerForClub(clubFk);
    }

    // ── Ongoing project picker (for "select parent" on a new ongoing repeat) ──
    // Builds UNION ALL across every existing year table — admins should be able to
    // pick a parent from any year, not just the current one.
    public async Task<List<OngoingProjectDto>> GetOngoingAsync(int clubId, int moduleId, string? search, int? yearId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // When yearId is given, scope to that single year's table — admins linking a sub-project
        // to an existing parent want the CURRENT year's parents only, not the same name repeated
        // across every year table in the UNION. When yearId is null, fall back to the original
        // multi-year UNION behaviour for callers that need it.
        List<YearTableInfo> tables;
        if (yearId.HasValue)
        {
            var info = await _yearTables.ResolveByYearIdAsync(conn, yearId.Value);
            tables = info != null ? new List<YearTableInfo> { info } : new List<YearTableInfo>();
        }
        else
        {
            tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        }
        if (tables.Count == 0) return new List<OngoingProjectDto>();

        // CONVERT to a single collation per leg — year tables were created at different times
        // with different default collations; without this MySQL throws
        // "Illegal mix of collations for operation 'UNION'" on the merged Title column.
        // ONGOING only (accept both legacy 'ongoing' and current 'ongoing_repeat'),
        // PARENT only (parent_project_id is NULL or 0 — child rows excluded),
        // not deleted (COALESCE handles legacy NULL isdeleted).
        // CONVERT forces a single collation so UNION across year tables doesn't error.
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT pk_project_id AS Id,
                      CONVERT(COALESCE(ongoing_group_title, title) USING utf8mb4) COLLATE utf8mb4_general_ci AS Title
               FROM `{t.ProjectsTable}`
               WHERE fk_club_id = @ClubId AND fk_module_id = @ModuleId
                 AND project_type IN ('ongoing_repeat', 'ongoing')
                 AND (parent_project_id IS NULL OR parent_project_id = 0)
                 AND COALESCE(isdeleted, 0) = 0
                 AND (@Search IS NULL OR ongoing_group_title LIKE CONCAT('%', @Search, '%') OR title LIKE CONCAT('%', @Search, '%'))"));

        var sql = $@"SELECT * FROM ({unionLegs}) u ORDER BY Title LIMIT 20";
        return (await conn.QueryAsync<OngoingProjectDto>(sql,
            new { ClubId = clubId, ModuleId = moduleId, Search = string.IsNullOrEmpty(search) ? null : search })).ToList();
    }

    // ── Photo: add one ─────────────────────────────────────────────
    public async Task<int> AddPhotoAsync(int projectId, int yearId, string imagePath, string? description, bool isPrimary, int sortOrder)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"Could not resolve year-wise tables for yearId {yearId}.");

        if (isPrimary)
        {
            await conn.ExecuteAsync(
                $"UPDATE `{info.PhotosTable}` SET is_primary = 0 WHERE fk_project_id = @ProjectId",
                new { ProjectId = projectId });
        }
        var fileName = string.IsNullOrEmpty(imagePath) ? "" : Path.GetFileName(imagePath);
        return await conn.ExecuteScalarAsync<int>(
            $@"INSERT INTO `{info.PhotosTable}` (fk_project_id, image_path, description, is_primary, sort_order)
               VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder);
               SELECT LAST_INSERT_ID();",
            new { ProjectId = projectId, ImagePath = fileName, Description = description, IsPrimary = isPrimary, SortOrder = sortOrder });
    }

    // ── Photo: delete one ──────────────────────────────────────────
    public async Task DeletePhotoAsync(int photoId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"Could not resolve year-wise tables for yearId {yearId}.");
        await conn.ExecuteAsync(
            $"DELETE FROM `{info.PhotosTable}` WHERE pk_photo_id = @Id",
            new { Id = photoId });
    }

    // ── Photo: set primary ─────────────────────────────────────────
    public async Task SetPrimaryPhotoAsync(int projectId, int photoId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId)
            ?? throw new InvalidOperationException($"Could not resolve year-wise tables for yearId {yearId}.");
        await conn.ExecuteAsync(
            $@"UPDATE `{info.PhotosTable}` SET is_primary = 0 WHERE fk_project_id = @ProjectId;
               UPDATE `{info.PhotosTable}` SET is_primary = 1 WHERE pk_photo_id = @PhotoId;",
            new { ProjectId = projectId, PhotoId = photoId });
    }

    // ── Upload: image ──────────────────────────────────────────────
    // For new (Add mode) projects we don't know yearId yet — files land in /tempdocument/
    // and CreateAsync moves them into the final year-aware Album folder.
    // For edits, caller passes projectId AND yearId so we know the destination folder.
    public async Task<string> UploadImageAsync(IFormFile file, int clubId, int? projectId = null, int? yearId = null)
    {
        if (projectId.HasValue && projectId.Value > 0 && yearId.HasValue && yearId.Value > 0)
        {
            using var conn = CreateConnection();
            await conn.OpenAsync();
            var info = await _yearTables.ResolveByYearIdAsync(conn, yearId.Value);
            if (info is not null)
            {
                var suffix = info.YearLabel.Replace("-", "_");
                var subFolder = Path.Combine("Documents", "gallery", $"Group{clubId}", suffix, $"Album{projectId.Value}");
                var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
                var uploadsPath = Path.Combine(_env.WebRootPath, subFolder);
                Directory.CreateDirectory(uploadsPath);
                using var stream = new FileStream(Path.Combine(uploadsPath, fileName), FileMode.Create);
                await file.CopyToAsync(stream);
                return $"/Documents/gallery/Group{clubId}/{suffix}/Album{projectId.Value}/{fileName}";
            }
        }

        // Add mode (no projectId yet) — save to tempdocument; CreateAsync moves it.
        var tempName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var tempPath = Path.Combine(_env.WebRootPath, "tempdocument");
        Directory.CreateDirectory(tempPath);
        using var s = new FileStream(Path.Combine(tempPath, tempName), FileMode.Create);
        await file.CopyToAsync(s);
        return $"/tempdocument/{tempName}";
    }

    public async Task<string> UploadDocumentAsync(IFormFile file, int clubId)
    {
        // Project rule (2026-06-10): club-service Agenda + Minutes of Meeting
        // documents save under /Documents/ClubMonthlyReport/Group{clubId}/.
        // Matches the existing per-club partition scheme used for photos
        // (Documents/gallery/Group{clubId}/...). The folder name "Group{clubId}"
        // is intentional — we tracked clubs by Group + ID in the legacy system
        // and we're aligning new uploads to the same shape.
        //
        // Used by both the web frontend (Club Service Add/Edit) AND the mobile
        // API — same controller endpoint (/api/clubs/{clubId}/projects/upload-document)
        // serves both. Existing rows pointing at the old /Documents/club-documents/...
        // path are left as-is; file migration will happen later (manual move from
        // old project folder).
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var subFolder = Path.Combine("Documents", "ClubMonthlyReport", $"Group{clubId}");
        var uploadsPath = Path.Combine(_env.WebRootPath, subFolder);
        Directory.CreateDirectory(uploadsPath);
        using var stream = new FileStream(Path.Combine(uploadsPath, fileName), FileMode.Create);
        await file.CopyToAsync(stream);
        return $"/Documents/ClubMonthlyReport/Group{clubId}/{fileName}";
    }

    // ── Public list (anonymous club website endpoint) ──────────────
    public async Task<PagedResult<ProjectPublicDto>> GetPublicAsync(int clubId, int moduleId, int yearId, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null)
            return new PagedResult<ProjectPublicDto> { Items = new List<ProjectPublicDto>(), TotalCount = 0, Page = page, PageSize = pageSize };

        var offset = (page - 1) * pageSize;
        var suffix = info.YearLabel.Replace("-", "_");

        using var multi = await conn.QueryMultipleAsync(
            $@"SELECT p.pk_project_id AS Id,
                      p.title AS Title,
                      p.description AS Description,
                      p.location AS Location,
                      p.project_date AS ProjectDate,
                      aof.name AS AreaOfFocusName,
                      cat.name AS CategoryName,
                      p.direct_beneficiaries AS DirectBeneficiaries,
                      (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                CASE WHEN p.old_pk IS NOT NULL
                                     THEN CONCAT('Album', p.old_pk)
                                     ELSE CONCAT('{suffix}/Album', p.pk_project_id)
                                END,
                                '/', pp.image_path)
                       FROM `{info.PhotosTable}` pp
                       WHERE pp.fk_project_id = p.pk_project_id AND pp.is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
               FROM `{info.ProjectsTable}` p
               LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
               LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
               WHERE p.fk_club_id = @ClubId AND p.fk_module_id = @ModuleId AND p.isdeleted = 0
               ORDER BY p.project_date DESC, p.pk_project_id DESC
               LIMIT @Offset, @PageSize;

               SELECT COUNT(*) FROM `{info.ProjectsTable}`
               WHERE fk_club_id = @ClubId AND fk_module_id = @ModuleId AND isdeleted = 0;",
            new { ClubId = clubId, ModuleId = moduleId, Offset = offset, PageSize = pageSize });

        var items = (await multi.ReadAsync<ProjectPublicDto>()).ToList();
        var totalCount = await multi.ReadFirstAsync<int>();

        return new PagedResult<ProjectPublicDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
        };
    }

    // ── Years with data ────────────────────────────────────────────
    // Returns the list of rotary years that have at least one non-deleted project for this
    // club + module. Builds a UNION ALL across every existing year-wise project table.
    // Column aliases MUST match ProjectYearDto (Id, YearLabel, IsCurrent, StartDate, EndDate)
    // for Dapper to map them — otherwise frontend gets id=0 everywhere and can't select a year.
    public async Task<List<ProjectYearDto>> GetYearsAsync(int clubId, int moduleId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return new List<ProjectYearDto>();

        // Each UNION leg is wrapped in parens — MySQL rejects `LIMIT 1 UNION ALL` without them.
        // The leg returns at most one row per year (LIMIT 1 inside the parens) — that row only
        // exists if data is present for this club + module in that year-wise table.
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"(SELECT {t.YearId} AS Id,
                       '{t.YearLabel}' AS YearLabel,
                       (SELECT StartDate FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS StartDate,
                       (SELECT EndDate FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS EndDate,
                       (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS IsCurrent
                FROM `{t.ProjectsTable}`
                WHERE fk_club_id = @ClubId AND fk_module_id = @ModuleId AND isdeleted = 0
                LIMIT 1)"));

        return (await conn.QueryAsync<ProjectYearDto>(
            $"SELECT * FROM ({unionLegs}) u ORDER BY u.IsCurrent DESC, u.StartDate DESC",
            new { ClubId = clubId, ModuleId = moduleId })).ToList();
    }
}

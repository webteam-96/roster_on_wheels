using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public class ProjectApprovalService : IProjectApprovalService
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ProjectApprovalService> _logger;
    private readonly IYearTableResolver _yearTables;
    private readonly Push.IFirebasePushService _push;

    // Module keys that require moderator approval
    private static readonly HashSet<string> ApprovalModuleKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "community_service", "vocational_service", "international_service",
        "new_generation_service", "public_image_initiative"
    };

    public ProjectApprovalService(IConfiguration configuration, IEmailService emailService, ILogger<ProjectApprovalService> logger, IYearTableResolver yearTables, Push.IFirebasePushService push)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _configuration = configuration;
        _logger = logger;
        _yearTables = yearTables;
        _push = push;
    }

    // Helper: every approval operation works on a single project by id. Resolve its
    // year-wise table once. Returns null if the project doesn't exist anywhere.
    private async Task<YearTableInfo?> ResolveAsync(MySqlConnection conn, int projectId)
        => await _yearTables.FindByProjectIdAsync(conn, projectId);

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<(bool hasModerator, string? moderatorName)> GetModeratorInfoAsync(int clubId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var moderator = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.MemberName
            FROM district_club_moderator dcm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id
            WHERE dcm.fk_club_id = @ClubId AND dcm.isdeleted = 0 AND dcm.is_active = 1 AND m.isdeleted = 0",
            new { ClubId = clubId });

        return moderator != null ? (true, (string?)moderator.MemberName) : (false, null);
    }

    public async Task SetPendingApprovalAsync(int projectId, int clubId, int moduleId, int createdBy, int? yearId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: locate the projects table that holds this row.
        //  - When the caller already knows yearId (CreateAsync / UpdateAsync
        //    both do — they computed it from the project_date), prefer
        //    ResolveByYearIdAsync: it's a 1-row lookup against
        //    rotary_year_master, fully deterministic, no cross-table scan,
        //    and immune to the post-INSERT pooled-connection-visibility
        //    race that silently swallowed the approval status + moderator
        //    email in Wave 17.
        //  - Fall back to FindByProjectIdAsync only when the caller has no
        //    yearId (legacy / background callers).
        var info = yearId.HasValue
            ? await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)
            : await ResolveAsync(conn, projectId);
        if (info is null) return;

        // Check if this module requires approval
        var moduleKey = await conn.ExecuteScalarAsync<string?>(@"
            SELECT ModuleKey FROM module_master WHERE pk_module_id = @Id AND isdeleted = 0",
            new { Id = moduleId });

        if (string.IsNullOrEmpty(moduleKey) || !ApprovalModuleKeys.Contains(moduleKey))
            return;

        // Check if club has a moderator
        var moderator = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT dcm.fk_member_id AS moderatorId, m.MemberName AS moderatorName, m.EmailId AS moderatorEmail
            FROM district_club_moderator dcm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id
            WHERE dcm.fk_club_id = @ClubId AND dcm.isdeleted = 0 AND dcm.is_active = 1 AND m.isdeleted = 0",
            new { ClubId = clubId });

        if (moderator == null)
        {
            // No moderator — clear any stale pending state so scheduler can process
            await conn.ExecuteAsync(
                $"UPDATE `{info.ProjectsTable}` SET approval_status = NULL, approval_token = NULL WHERE pk_project_id = @ProjectId AND approval_status = 'pending'",
                new { ProjectId = projectId });
            return;
        }

        // Generate token and set pending
        var token = Guid.NewGuid().ToString("N");
        await conn.ExecuteAsync($@"
            UPDATE `{info.ProjectsTable}` SET approval_status = 'pending', approval_token = @Token
            WHERE pk_project_id = @ProjectId",
            new { ProjectId = projectId, Token = token });

        // Get project details for email
        var project = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.title, p.description, p.project_date, p.project_cost,
                   p.direct_beneficiaries, p.man_hours, p.rotarians_involved, p.rotaractors_involved,
                   COALESCE(p.rcc_involved,0) AS rcc_involved,
                   p.location, mm.ModuleName,
                   c.ClubName, d.DistrictNumber,
                   admin.MemberName AS adminName, admin.EmailId AS adminEmail, admin.PrimaryMobileNumber AS adminMobile
            FROM `{info.ProjectsTable}` p
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
            WHERE p.pk_project_id = @ProjectId",
            new { ProjectId = projectId });

        // Get project photos (filename-only in DB; reconstruct full URL via CONCAT).
        var suffix = info.YearLabel.Replace("-", "_");
        var photos = await conn.QueryAsync<dynamic>($@"
            SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                          CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                               ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                          '/', ph.image_path) AS image_path
            FROM `{info.PhotosTable}` ph
            JOIN `{info.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
            WHERE ph.fk_project_id = @ProjectId ORDER BY ph.sort_order",
            new { ProjectId = projectId });

        // Send email to moderator
        try
        {
            var backendUrl = _configuration["BackendUrl"] ?? "http://localhost:5000";
            var approveUrl = $"{backendUrl}/api/project-approval/{token}/approve";
            var rejectUrl = $"{backendUrl}/api/project-approval/{token}/reject";

            var photoHtml = "";
            foreach (var photo in photos)
            {
                var imgUrl = $"{backendUrl}{(string)photo.image_path}";
                photoHtml += $"<img src='{imgUrl}' alt='Project Photo' style='width: 120px; height: 90px; object-fit: cover; border-radius: 4px; margin: 4px;' />";
            }

            var body = $@"{EmailService.EMAIL_HEADER}
                <h2 style='color: #1a365d; margin-top: 0;'>Project Approval Required</h2>
                <p>Dear {(string?)moderator.moderatorName},</p>
                <p>A new project has been submitted and requires your approval.</p>

                <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <h3 style='color: #2d3748; margin-top: 0;'>Project Details</h3>
                    <table style='width: 100%; border-collapse: collapse; font-size: 14px;'>
                        <tr><td style='padding: 6px 0; color: #718096; width: 40%;'>Module</td><td style='padding: 6px 0; font-weight: 600;'>{(string?)project?.ModuleName ?? "—"}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Title</td><td style='padding: 6px 0; font-weight: 600;'>{(string?)project?.title ?? "—"}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Club</td><td style='padding: 6px 0;'>{(string?)project?.ClubName ?? "—"}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>District</td><td style='padding: 6px 0;'>{(string?)project?.DistrictNumber ?? "—"}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Date</td><td style='padding: 6px 0;'>{(project?.project_date != null ? ((DateTime)project.project_date).ToString("dd MMM yyyy") : "—")}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Cost</td><td style='padding: 6px 0;'>{(project?.project_cost != null ? $"₹{project.project_cost:N2}" : "—")}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Direct Beneficiaries</td><td style='padding: 6px 0;'>{project?.direct_beneficiaries ?? "—"}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Man Hours</td><td style='padding: 6px 0;'>{project?.man_hours ?? "—"}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Location</td><td style='padding: 6px 0;'>{(string?)project?.location ?? "—"}</td></tr>
                    </table>
                    {(string.IsNullOrEmpty((string?)project?.description) ? "" : $"<p style='margin-top: 12px; color: #4a5568;'><strong>Description:</strong> {(string)project.description}</p>")}
                </div>

                {(string.IsNullOrEmpty(photoHtml) ? "" : $"<div style='margin: 16px 0;'><strong>Photos:</strong><br/><div style='margin-top: 8px;'>{photoHtml}</div></div>")}

                <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <h3 style='color: #2d3748; margin-top: 0;'>Submitted By</h3>
                    <table style='width: 100%; border-collapse: collapse; font-size: 14px;'>
                        <tr><td style='padding: 4px 0; color: #718096; width: 40%;'>Name</td><td style='padding: 4px 0;'>{(string?)project?.adminName ?? "—"}</td></tr>
                        <tr><td style='padding: 4px 0; color: #718096;'>Email</td><td style='padding: 4px 0;'>{(string?)project?.adminEmail ?? "—"}</td></tr>
                        <tr><td style='padding: 4px 0; color: #718096;'>Mobile</td><td style='padding: 4px 0;'>{(string?)project?.adminMobile ?? "—"}</td></tr>
                    </table>
                </div>

                <div style='text-align: center; margin: 24px 0;'>
                    <a href='{approveUrl}' style='background-color: #38a169; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 12px;'>Approve</a>
                    <a href='{rejectUrl}' style='background-color: #e53e3e; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold;'>Reject</a>
                </div>

                <p style='font-size: 12px; color: #a0aec0; text-align: center;'>You can also login to the web portal to approve or reject this project.</p>
            {EmailService.EMAIL_FOOTER}";

            var moderatorEmail = (string?)moderator.moderatorEmail;
            if (!string.IsNullOrWhiteSpace(moderatorEmail))
            {
                await _emailService.SendGenericEmailAsync(
                    moderatorEmail,
                    $"Project Approval Required - {(string?)project?.ClubName} - {(string?)project?.title}",
                    body);
                _logger.LogInformation("Moderator approval email sent for project {ProjectId} to {Email}", projectId, moderatorEmail);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send moderator approval email for project {ProjectId}", projectId);
        }
    }

    // Strongly-typed result row — Dapper maps SQL columns to these properties
    // using CASE-INSENSITIVE matching, which sidesteps the dynamic-property
    // case-mismatch bug that was leaving district / rotarians / rotaractors /
    // submitted-by fields null on the wire even though the DB had values.
    private sealed class ModeratorProjectDetailRow
    {
        public int ProjectId { get; set; }
        public string? Title { get; set; }
        public string? Description { get; set; }
        public DateTime? ProjectDate { get; set; }
        public decimal? ProjectCost { get; set; }
        public string? Currency { get; set; }
        public int? DirectBeneficiaries { get; set; }
        public int? ManHours { get; set; }
        public int? RotariansInvolved { get; set; }
        public int? RotaractorsInvolved { get; set; }
        // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
        // next to RotaractorsInvolved (user 2026-10-05).
        public int? RccInvolved { get; set; }
        public string? Location { get; set; }
        public string? ProjectType { get; set; }
        public bool? IsJointProject { get; set; }
        public string? CoHostName { get; set; }
        public string? ClubRole { get; set; }
        public string? ApprovalStatus { get; set; }
        public string? ApprovalRemark { get; set; }
        public DateTime? ApprovalDate { get; set; }
        public DateTime? CreatedDate { get; set; }
        public string? ModuleName { get; set; }
        public string? ClubName { get; set; }
        public string? DistrictNumber { get; set; }
        public string? AreaOfFocusName { get; set; }
        public string? CategoryName { get; set; }
        public string? SubCategoryName { get; set; }
        public string? FundingName { get; set; }
        public string? AdminName { get; set; }
        public string? AdminEmail { get; set; }
        public string? AdminMobile { get; set; }
        public string? AdminPhoto { get; set; }
    }

    public async Task<object?> GetProjectDetailForModeratorAsync(int projectId, int memberId, int? yearId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: prefer the caller-supplied yearId. pk_project_id is
        // auto-increment per year-wise table, so the same id can exist in
        // multiple year tables as different projects — FindByProjectIdAsync
        // (legacy fallback) would return the earliest match, whose club may
        // not be moderated by the caller, producing a spurious 404.
        var info = yearId.HasValue
            ? await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)
            : await ResolveAsync(conn, projectId);
        if (info is null) return null;

        // Verify moderator is assigned to this project's club
        var project = await conn.QueryFirstOrDefaultAsync<ModeratorProjectDetailRow>($@"
            SELECT p.pk_project_id AS ProjectId, p.title AS Title, p.description AS Description, p.project_date AS ProjectDate,
                   p.project_cost AS ProjectCost, COALESCE(p.Currency, 'INR') AS Currency, p.direct_beneficiaries AS DirectBeneficiaries,
                   p.man_hours AS ManHours, p.rotarians_involved AS RotariansInvolved,
                   p.rotaractors_involved AS RotaractorsInvolved,
                   COALESCE(p.rcc_involved,0) AS RccInvolved,
                   p.location AS Location, p.project_type AS ProjectType,
                   p.is_joint_project AS IsJointProject, p.co_host_name AS CoHostName, p.club_role AS ClubRole,
                   p.approval_status AS ApprovalStatus, p.approval_remark AS ApprovalRemark,
                   p.approval_date AS ApprovalDate, p.created_date AS CreatedDate,
                   mm.ModuleName AS ModuleName, c.ClubName AS ClubName, d.DistrictNumber AS DistrictNumber,
                   aof.name AS AreaOfFocusName, cat.name AS CategoryName, scat.name AS SubCategoryName,
                   f.name AS FundingName,
                   admin.MemberName AS AdminName, admin.EmailId AS AdminEmail, admin.PrimaryMobileNumber AS AdminMobile,
                   CASE
                       WHEN admin.ProfilePhotoPath IS NULL OR admin.ProfilePhotoPath = '' THEN NULL
                       WHEN admin.ProfilePhotoPath LIKE '/Documents/directory/%' THEN admin.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(admin.ProfilePhotoPath, '/', -1))
                   END AS AdminPhoto
            FROM `{info.ProjectsTable}` p
            JOIN district_club_moderator dcm ON dcm.fk_club_id = p.fk_club_id
                AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0 AND dcm.is_active = 1
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
            LEFT JOIN sub_category_master scat ON scat.pk_sub_category_id = p.fk_sub_category_id
            LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
            LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
            WHERE p.pk_project_id = @ProjectId AND p.isdeleted = 0",
            new { ProjectId = projectId, MemberId = memberId });

        if (project == null) return null;

        // Photos: reconstruct full URL via CONCAT (filename-only in DB).
        var suffix = info.YearLabel.Replace("-", "_");
        var photos = (await conn.QueryAsync<dynamic>($@"
            SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                          CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                               ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                          '/', ph.image_path) AS imagePath,
                   ph.description
            FROM `{info.PhotosTable}` ph
            JOIN `{info.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
            WHERE ph.fk_project_id = @ProjectId ORDER BY ph.sort_order",
            new { ProjectId = projectId })).ToList();

        // Return the typed row alongside the photos list. ASP.NET Core's
        // default System.Text.Json camelCase policy will lowercase the first
        // letter on the wire (`projectId`, `districtNumber`, `adminName`, …),
        // which matches what the frontend reads.
        return new
        {
            project.ProjectId, project.Title, project.Description, project.ProjectDate,
            project.ProjectCost, project.DirectBeneficiaries, project.ManHours,
            project.RotariansInvolved, project.RotaractorsInvolved, project.RccInvolved,
            project.Location, project.ProjectType, project.IsJointProject,
            project.CoHostName, project.ClubRole,
            project.ApprovalStatus, project.ApprovalRemark, project.ApprovalDate, project.CreatedDate,
            project.ModuleName, project.ClubName, project.DistrictNumber,
            project.AreaOfFocusName, project.CategoryName, project.SubCategoryName, project.FundingName,
            project.AdminName, project.AdminEmail, project.AdminMobile, project.AdminPhoto,
            Photos = photos.Select(ph => new { ImagePath = (string)ph.imagePath, Description = (string?)ph.description }).ToList()
        };
    }

    public async Task<object?> GetByTokenAsync(string token)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: scan every existing year-wise table looking for the matching token.
        foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
        {
            var hit = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
                SELECT p.pk_project_id AS projectId, p.title, p.description, p.project_date AS projectDate,
                       p.project_cost AS projectCost, COALESCE(p.Currency, 'INR') AS currency, p.direct_beneficiaries AS directBeneficiaries,
                       p.man_hours AS manHours, p.location, p.approval_status AS approvalStatus,
                       p.approval_remark AS approvalRemark,
                       mm.ModuleName AS moduleName, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       admin.MemberName AS submittedByName
                FROM `{t.ProjectsTable}` p
                LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
                WHERE p.approval_token = @Token AND p.isdeleted = 0
                LIMIT 1",
                new { Token = token });
            if (hit != null) return hit;
        }
        return null;
    }

    // Helper: scan year tables looking for the project with this approval token.
    private async Task<(YearTableInfo info, dynamic project)?> FindByTokenAsync(MySqlConnection conn, string token)
    {
        foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
        {
            var hit = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
                SELECT p.pk_project_id, p.approval_status, p.title, p.fk_club_id,
                       c.ClubName, admin.MemberName AS adminName, admin.EmailId AS adminEmail
                FROM `{t.ProjectsTable}` p
                LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
                LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
                WHERE p.approval_token = @Token AND p.isdeleted = 0
                LIMIT 1",
                new { Token = token });
            if (hit != null) return (t, hit);
        }
        return null;
    }

    public async Task<(bool success, string message)> ApproveByTokenAsync(string token, string? remark)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var found = await FindByTokenAsync(conn, token);
        if (found == null) return (false, "Project not found.");
        var (info, project) = found.Value;
        if ((string?)project.approval_status != "pending") return (false, $"Project has already been {(string?)project.approval_status}.");

        // Get moderator from club
        var moderatorId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_member_id FROM district_club_moderator
            WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1",
            new { ClubId = (int)project.fk_club_id });

        var affected = await conn.ExecuteAsync($@"
            UPDATE `{info.ProjectsTable}` SET approval_status = 'approved', approval_remark = @Remark,
                   approved_by = @ApprovedBy, approval_date = NOW()
            WHERE approval_token = @Token AND approval_status = 'pending'",
            new { Token = token, Remark = remark, ApprovedBy = moderatorId });

        await NotifyAdminAsync(conn, project, "approved", remark);
        if (affected > 0) await PushProjectApprovedAsync(conn, info, (int)project.pk_project_id, (int)project.fk_club_id);
        return (true, "Project approved successfully.");
    }

    public async Task<(bool success, string message)> RejectByTokenAsync(string token, string remark)
    {
        if (string.IsNullOrWhiteSpace(remark)) return (false, "Remark is required for rejection.");

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var found = await FindByTokenAsync(conn, token);
        if (found == null) return (false, "Project not found.");
        var (info, project) = found.Value;
        if ((string?)project.approval_status != "pending") return (false, $"Project has already been {(string?)project.approval_status}.");

        var moderatorId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_member_id FROM district_club_moderator
            WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1",
            new { ClubId = (int)project.fk_club_id });

        await conn.ExecuteAsync($@"
            UPDATE `{info.ProjectsTable}` SET approval_status = 'rejected', approval_remark = @Remark,
                   approved_by = @ApprovedBy, approval_date = NOW()
            WHERE approval_token = @Token AND approval_status = 'pending'",
            new { Token = token, Remark = remark, ApprovedBy = moderatorId });

        await NotifyAdminAsync(conn, project, "rejected", remark);
        return (true, "Project rejected.");
    }

    public async Task<(bool success, string message)> ModeratorApproveAsync(int projectId, int memberId, string? remark, int? yearId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-scope when caller supplied it — avoids the cross-year
        // pk_project_id collision that caused "You are not the moderator
        // for this club." for projects that exist in multiple year tables.
        var info = yearId.HasValue
            ? await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)
            : await ResolveAsync(conn, projectId);
        if (info is null) return (false, "Project not found.");

        // Verify this moderator is assigned to the project's club
        var project = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.pk_project_id, p.approval_status, p.title, p.fk_club_id,
                   c.ClubName, admin.MemberName AS adminName, admin.EmailId AS adminEmail
            FROM `{info.ProjectsTable}` p
            LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
            LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
            WHERE p.pk_project_id = @ProjectId AND p.isdeleted = 0",
            new { ProjectId = projectId });

        if (project == null) return (false, "Project not found.");
        if ((string?)project.approval_status != "pending") return (false, $"Project has already been {(string?)project.approval_status}.");

        var isAssigned = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM district_club_moderator
            WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0 AND is_active = 1",
            new { ClubId = (int)project.fk_club_id, MemberId = memberId });

        if (isAssigned == 0) return (false, "You are not the moderator for this club.");

        var affected = await conn.ExecuteAsync($@"
            UPDATE `{info.ProjectsTable}` SET approval_status = 'approved', approval_remark = @Remark,
                   approved_by = @ApprovedBy, approval_date = NOW()
            WHERE pk_project_id = @ProjectId AND approval_status = 'pending'",
            new { ProjectId = projectId, Remark = remark, ApprovedBy = memberId });

        await NotifyAdminAsync(conn, project, "approved", remark);
        if (affected > 0) await PushProjectApprovedAsync(conn, info, projectId, (int)project.fk_club_id);
        return (true, "Project approved successfully.");
    }

    public async Task<(bool success, string message)> ModeratorRejectAsync(int projectId, int memberId, string remark, int? yearId = null)
    {
        if (string.IsNullOrWhiteSpace(remark)) return (false, "Remark is required for rejection.");

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var info = yearId.HasValue
            ? await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)
            : await ResolveAsync(conn, projectId);
        if (info is null) return (false, "Project not found.");

        var project = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.pk_project_id, p.approval_status, p.title, p.fk_club_id,
                   c.ClubName, admin.MemberName AS adminName, admin.EmailId AS adminEmail
            FROM `{info.ProjectsTable}` p
            LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
            LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
            WHERE p.pk_project_id = @ProjectId AND p.isdeleted = 0",
            new { ProjectId = projectId });

        if (project == null) return (false, "Project not found.");
        if ((string?)project.approval_status != "pending") return (false, $"Project has already been {(string?)project.approval_status}.");

        var isAssigned = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM district_club_moderator
            WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0 AND is_active = 1",
            new { ClubId = (int)project.fk_club_id, MemberId = memberId });

        if (isAssigned == 0) return (false, "You are not the moderator for this club.");

        await conn.ExecuteAsync($@"
            UPDATE `{info.ProjectsTable}` SET approval_status = 'rejected', approval_remark = @Remark,
                   approved_by = @ApprovedBy, approval_date = NOW()
            WHERE pk_project_id = @ProjectId AND approval_status = 'pending'",
            new { ProjectId = projectId, Remark = remark, ApprovedBy = memberId });

        await NotifyAdminAsync(conn, project, "rejected", remark);
        return (true, "Project rejected.");
    }

    public async Task<List<object>> GetYearSummaryAsync(int memberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: UNION ALL across every existing year-wise table for project counts.
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return new List<object>();

        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT {t.YearId} AS yearId, '{t.YearLabel}' AS yearLabel,
                      (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS isCurrent,
                      SUM(CASE WHEN p.approval_status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
                      SUM(CASE WHEN p.approval_status = 'approved' THEN 1 ELSE 0 END) AS approvedCount,
                      SUM(CASE WHEN p.approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejectedCount,
                      COUNT(*) AS totalCount
               FROM `{t.ProjectsTable}` p
               JOIN district_club_moderator dcm ON dcm.fk_club_id = p.fk_club_id
                   AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0 AND dcm.is_active = 1
               WHERE p.approval_status IS NOT NULL AND p.isdeleted = 0
               HAVING COUNT(*) > 0"));

        var results = await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({unionLegs}) u ORDER BY u.yearId DESC",
            new { MemberId = memberId });

        var summaries = results.Select(r => new
        {
            yearId = (int)r.yearId,
            yearLabel = (string)r.yearLabel,
            isCurrent = Convert.ToBoolean((object)r.isCurrent),
            pendingCount = (int)(long)r.pendingCount,
            approvedCount = (int)(long)r.approvedCount,
            rejectedCount = (int)(long)r.rejectedCount,
            totalCount = (int)(long)r.totalCount
        }).ToList();

        // Always surface the current rotary year, even before this moderator's assigned
        // clubs have routed any project through moderation yet — the HAVING filter above
        // otherwise drops it entirely, leaving the year dropdown (and everything gated on
        // it, e.g. the projects list) empty. Same class of fix as
        // ClubWebsitePublicDataController.GetYears.
        if (!summaries.Any(s => s.isCurrent))
        {
            var current = await conn.QueryFirstOrDefaultAsync<(int yearId, string yearLabel)?>(
                "SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
            if (current != null && tables.Any(t => t.YearId == current.Value.yearId))
            {
                summaries.Add(new
                {
                    yearId = current.Value.yearId,
                    yearLabel = current.Value.yearLabel,
                    isCurrent = true,
                    pendingCount = 0,
                    approvedCount = 0,
                    rejectedCount = 0,
                    totalCount = 0
                });
            }
        }

        return summaries.OrderByDescending(s => s.yearId).Select(s => (object)s).ToList();
    }

    public async Task<(List<object> items, int totalCount)> GetProjectsForModeratorAsync(int memberId, int yearId, string? status, int page, int pageSize, string? moduleKey = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: resolve to one year-wise projects table.
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null) return (new List<object>(), 0);

        var statusFilter = status switch
        {
            "pending" => "AND p.approval_status = 'pending'",
            "approved" => "AND p.approval_status = 'approved'",
            "rejected" => "AND p.approval_status = 'rejected'",
            _ => ""
        };

        var moduleFilter = string.IsNullOrEmpty(moduleKey) ? "" : "AND mm.ModuleKey = @ModuleKey";

        var totalCount = await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*)
            FROM `{info.ProjectsTable}` p
            JOIN district_club_moderator dcm ON dcm.fk_club_id = p.fk_club_id
                AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0 AND dcm.is_active = 1
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            WHERE p.approval_status IS NOT NULL AND p.isdeleted = 0
            {statusFilter} {moduleFilter}",
            new { MemberId = memberId, ModuleKey = moduleKey });

        var offset = (page - 1) * pageSize;
        var items = await conn.QueryAsync<dynamic>($@"
            SELECT p.pk_project_id AS projectId, p.title, p.description, p.project_date AS projectDate,
                   p.project_cost AS projectCost, p.direct_beneficiaries AS directBeneficiaries,
                   p.man_hours AS manHours, p.location,
                   p.approval_status AS approvalStatus, p.approval_remark AS approvalRemark,
                   p.approval_date AS approvalDate, p.created_date AS createdDate,
                   mm.ModuleName AS moduleName, c.ClubName AS clubName,
                   admin.MemberName AS createdByName
            FROM `{info.ProjectsTable}` p
            JOIN district_club_moderator dcm ON dcm.fk_club_id = p.fk_club_id
                AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0 AND dcm.is_active = 1
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
            LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
            WHERE p.approval_status IS NOT NULL AND p.isdeleted = 0
            {statusFilter} {moduleFilter}
            ORDER BY FIELD(p.approval_status, 'pending', 'approved', 'rejected'), p.created_date DESC
            LIMIT @Offset, @PageSize",
            new { MemberId = memberId, Offset = offset, PageSize = pageSize, ModuleKey = moduleKey });

        return (items.Select(r => (object)r).ToList(), totalCount);
    }

    // Push "<Type> approved · <club>" to EVERY member of the project's club when a project is
    // approved. Fires only on the real pending→approved transition (caller gates on rows-affected,
    // and the transition happens once), so no dedicated sent-flag is needed. Best-effort: no-ops when
    // Firebase is unavailable and swallows its own errors — it must never fail/block the approval.
    private async Task PushProjectApprovedAsync(MySqlConnection conn, YearTableInfo info, int projectId, int clubId)
    {
        try
        {
            if (!_push.IsAvailable) return;

            var meta = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
                SELECT p.title AS Title, p.fk_district_id AS DistrictId,
                       COALESCE(md.ModuleKey, '') AS ModuleKey, COALESCE(md.ModuleName, '') AS ModuleName
                FROM `{info.ProjectsTable}` p
                LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                WHERE p.pk_project_id = @Id",
                new { Id = projectId });
            if (meta == null) return;

            int? districtId = meta.DistrictId == null ? null : (int?)meta.DistrictId;
            string moduleKey = (string)(meta.ModuleKey ?? "");
            string moduleName = (string)(meta.ModuleName ?? "");
            string title = (string)(meta.Title ?? "");

            var tokens = await Push.PushDispatcher.ResolveClubDistrictTokensAsync(conn, clubId, districtId);
            if (tokens.Count == 0) return;

            var sourceName = await Push.PushDispatcher.ResolveSourceNameAsync(conn, clubId, districtId);
            var typeLabel = string.IsNullOrWhiteSpace(moduleName) ? "Project" : moduleName;
            var pushTitle = $"{typeLabel} approved · {sourceName}";
            var pushBody = string.IsNullOrWhiteSpace(title) ? "A project has been approved." : title;

            // Same deep-link contract as the creation push: type club_project_<avenue>, opens the project.
            var avenue = string.IsNullOrWhiteSpace(moduleKey) ? "community_service" : moduleKey;
            var data = new Dictionary<string, string>
            {
                ["type"] = $"club_project_{avenue}",
                ["clubId"] = clubId.ToString(),
                ["projectId"] = projectId.ToString(),
                ["yearId"] = info.YearId.ToString(),
            };

            var (sent, failed) = await Push.PushDispatcher.SendLogCleanupAsync(
                conn, _push, tokens, pushTitle, pushBody, data,
                "project_push_log", new[] { ("fk_project_id", projectId), ("fk_year_id", info.YearId) }, default);
            _logger.LogInformation("Project {Id} APPROVED push: sent={Sent} failed={Failed} tokens={Total}",
                projectId, sent, failed, tokens.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed approval push for project {Id}", projectId);
        }
    }

    private async Task NotifyAdminAsync(MySqlConnection conn, dynamic project, string decision, string? remark)
    {
        try
        {
            int clubId = (int)project.fk_club_id;

            var moderatorName = await conn.ExecuteScalarAsync<string?>(@"
                SELECT m.MemberName FROM district_club_moderator dcm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id
                WHERE dcm.fk_club_id = @ClubId AND dcm.isdeleted = 0 AND dcm.is_active = 1",
                new { ClubId = clubId }) ?? "Club Moderator";

            // Collect all recipient emails: submitting admin + club admins + president + secretary
            var recipientEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // 1. Submitting admin
            var adminEmail = (string?)project.adminEmail;
            if (!string.IsNullOrWhiteSpace(adminEmail)) recipientEmails.Add(adminEmail);

            // 2. Club Admins (role_id = 2, scoped to this club)
            var clubAdminEmails = await conn.QueryAsync<string>(@"
                SELECT DISTINCT m.EmailId
                FROM member_roles mr
                JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                WHERE mr.fk_club_id = @ClubId AND mr.fk_role_id = 2
                  AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
                  AND m.EmailId IS NOT NULL AND m.EmailId != ''",
                new { ClubId = clubId });
            foreach (var e in clubAdminEmails) recipientEmails.Add(e);

            // 3. President & Secretary from board_of_directors (current rotary year)
            var boardEmails = await conn.QueryAsync<string>(@"
                SELECT DISTINCT m.EmailId
                FROM board_of_directors bod
                JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
                JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
                WHERE bod.fk_club_id = @ClubId AND bod.isdeleted = 0
                  AND dm.designation_name IN ('President', 'Secretary')
                  AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId != ''",
                new { ClubId = clubId });
            foreach (var e in boardEmails) recipientEmails.Add(e);

            if (recipientEmails.Count == 0) return;

            var statusColor = decision == "approved" ? "#38a169" : "#e53e3e";
            var statusText = decision == "approved" ? "Approved" : "Rejected";

            var body = $@"{EmailService.EMAIL_HEADER}
                <h2 style='color: #1a365d; margin-top: 0;'>Project {statusText}</h2>
                <p>A project has been <strong style='color: {statusColor};'>{statusText}</strong> by the Club Moderator.</p>

                <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <table style='width: 100%; border-collapse: collapse; font-size: 14px;'>
                        <tr><td style='padding: 6px 0; color: #718096; width: 40%;'>Project</td><td style='padding: 6px 0; font-weight: 600;'>{(string?)project.title}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Club</td><td style='padding: 6px 0;'>{(string?)project.ClubName}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Status</td><td style='padding: 6px 0; color: {statusColor}; font-weight: 600;'>{statusText}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Reviewed By</td><td style='padding: 6px 0;'>{moderatorName}</td></tr>
                        <tr><td style='padding: 6px 0; color: #718096;'>Submitted By</td><td style='padding: 6px 0;'>{(string?)project.adminName}</td></tr>
                        {(string.IsNullOrWhiteSpace(remark) ? "" : $"<tr><td style='padding: 6px 0; color: #718096;'>Remark</td><td style='padding: 6px 0;'>{remark}</td></tr>")}
                    </table>
                </div>
            {EmailService.EMAIL_FOOTER}";

            var subject = $"Project {statusText} - {(string?)project.title}";

            // Send to all recipients
            foreach (var email in recipientEmails)
            {
                try
                {
                    await _emailService.SendGenericEmailAsync(email, subject, body);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to send project decision email to {Email}", email);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send notification emails for project decision");
        }
    }
}

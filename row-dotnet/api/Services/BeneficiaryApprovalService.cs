using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class BeneficiaryApprovalService : IBeneficiaryApprovalService
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly IYearTableResolver _yearTables;
    private readonly ILogger<BeneficiaryApprovalService> _logger;

    public BeneficiaryApprovalService(IConfiguration configuration, IEmailService emailService, IYearTableResolver yearTables, ILogger<BeneficiaryApprovalService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _configuration = configuration;
        _yearTables = yearTables;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<int> CreateApprovalRequestAsync(int projectId, int clubId, int requestedBeneficiaries, int currentLimit, int requestedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // If clubId not passed, find which year-wise table holds this project, then get fk_club_id.
        if (clubId == 0)
        {
            var info = await _yearTables.FindByProjectIdAsync(connection, projectId);
            if (info != null)
            {
                clubId = await connection.ExecuteScalarAsync<int>(
                    $"SELECT fk_club_id FROM `{info.ProjectsTable}` WHERE pk_project_id = @Id AND isdeleted = 0",
                    new { Id = projectId });
            }
        }

        // If limit not passed, get from system settings
        if (currentLimit == 0)
        {
            var limitStr = await connection.ExecuteScalarAsync<string?>(
                "SELECT SettingValue FROM system_settings WHERE SettingKey = 'direct_beneficiaries_limit'");
            currentLimit = int.TryParse(limitStr, out var l) ? l : 0;
        }

        // Get zone_id from club → district → zone chain
        var zoneId = await connection.ExecuteScalarAsync<int?>(
            @"SELECT d.fk_zone_id FROM club_master c
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0 AND d.isdeleted = 0",
            new { ClubId = clubId });

        if (zoneId == null || zoneId == 0)
            throw new InvalidOperationException("Could not determine zone for this club.");

        // Check if a pending approval already exists for this project.
        // Scope by club too: pk_project_id is reused across year tables for different
        // clubs, so a bare fk_project_id match could collide with another club's request.
        var existing = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_approval_id AS Id, approval_token AS Token
              FROM beneficiary_approval_requests
              WHERE fk_project_id = @ProjectId AND fk_club_id = @ClubId AND status = 'pending'
              LIMIT 1",
            new { ProjectId = projectId, ClubId = clubId });

        string token;
        int id;

        if (existing != null)
        {
            // Update existing pending record with new requested beneficiaries
            id = (int)existing.Id;
            token = (string)existing.Token;
            await connection.ExecuteAsync(
                @"UPDATE beneficiary_approval_requests
                  SET requested_beneficiaries = @Requested, current_limit = @Limit, requested_by = @RequestedBy, created_date = NOW()
                  WHERE pk_approval_id = @Id",
                new { Requested = requestedBeneficiaries, Limit = currentLimit, RequestedBy = requestedBy, Id = id });
        }
        else
        {
            // Create new approval record
            token = Guid.NewGuid().ToString("N");
            id = await connection.ExecuteScalarAsync<int>(
                @"INSERT INTO beneficiary_approval_requests
                    (fk_project_id, fk_zone_id, fk_club_id, requested_beneficiaries, current_limit, approval_token, status, requested_by)
                  VALUES
                    (@ProjectId, @ZoneId, @ClubId, @Requested, @Limit, @Token, 'pending', @RequestedBy);
                  SELECT LAST_INSERT_ID()",
                new { ProjectId = projectId, ZoneId = zoneId.Value, ClubId = clubId, Requested = requestedBeneficiaries, Limit = currentLimit, Token = token, RequestedBy = requestedBy });
        }

        // Get full details for email
        var detail = await GetByTokenAsync(token);
        if (detail != null)
        {
            // Emails are best-effort — the approval row is already committed above, so a
            // missing ZC / CP / CS or an SMTP failure must NOT fail the request.
            // Only the ZC gets the Approve/Reject links; CP, CS and the submitter get an
            // information copy without them (the token links need no login).
            var recipients = await GetRecipientsAsync(connection, detail);
            var zcEmail = recipients.FirstOrDefault(r => r.Role == "Zonal Coordinator").Email;
            if (zcEmail == null)
                _logger.LogWarning(
                    "Beneficiary approval {ApprovalId} for zone {ZoneId}: no active Zonal Coordinator with an email — approval links not emailed.",
                    id, zoneId.Value);

            var backendUrl = _configuration["BackendUrl"]?.TrimEnd('/') ?? "http://localhost:5189";
            foreach (var (name, email, role) in recipients)
            {
                var isZc = role == "Zonal Coordinator";
                try
                {
                    await _emailService.SendBeneficiaryApprovalEmailAsync(
                        email, name, detail,
                        isZc ? $"{backendUrl}/api/beneficiary-approval/{token}/approve" : null,
                        isZc ? $"{backendUrl}/api/beneficiary-approval/{token}/reject" : null);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex,
                        "Failed to send beneficiary approval email to {Role} {Email} for approval {ApprovalId} (row was still created).",
                        role, email, id);
                }
            }
        }

        return id;
    }

    // Beneficiary emails go to: the zone's Zonal Coordinator, the club's Club President and
    // Club Secretary (BOD of the project's Rotary year; current year if the year is unknown)
    // and the member who submitted the project. One email per address even when a person
    // holds two of these roles; anyone without an email is skipped and logged.
    private async Task<List<(string Name, string Email, string Role)>> GetRecipientsAsync(
        MySqlConnection conn, BeneficiaryApprovalDetailDto d)
    {
        var list = new List<(string Name, string Email, string Role)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string? name, string? email, string role)
        {
            if (string.IsNullOrWhiteSpace(email))
            {
                _logger.LogWarning("Beneficiary approval {ApprovalId}: {Role} {Name} has no email — skipped.", d.Id, role, name);
                return;
            }
            var e = email.Trim();
            if (seen.Add(e)) list.Add((name ?? role, e, role));
        }

        var zc = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT m.MemberName AS Name, m.EmailId AS Email
              FROM member_roles mr
              JOIN roles r ON r.pk_role_id = mr.fk_role_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
              WHERE mr.fk_zone_id = @ZoneId AND r.RoleName = 'ZonalCoordinator'
                AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
              LIMIT 1",
            new { ZoneId = d.ZoneId });
        if (zc != null) Add((string?)zc.Name, (string?)zc.Email, "Zonal Coordinator");

        var bod = (await conn.QueryAsync<dynamic>(
            @"SELECT m.MemberName AS Name, m.EmailId AS Email, dm.designation_name AS Role
              FROM board_of_directors bod
              JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
              JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
              JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
              WHERE bod.fk_club_id = @ClubId AND COALESCE(bod.isdeleted, 0) = 0 AND m.isdeleted = 0
                AND dm.designation_name IN ('Club President', 'Club Secretary')
                AND (y.pk_year_id = @YearId OR (@YearId IS NULL AND y.IsCurrent = 1))",
            new { ClubId = d.ClubId, YearId = d.YearId })).ToList();
        foreach (var role in new[] { "Club President", "Club Secretary" })
        {
            var holder = bod.FirstOrDefault(b => (string)b.Role == role);
            if (holder == null)
                _logger.LogWarning("Beneficiary approval {ApprovalId}: no {Role} in BOD for club {ClubId} year {YearId} — skipped.", d.Id, role, d.ClubId, d.YearId);
            else
                Add((string?)holder.Name, (string?)holder.Email, role);
        }

        Add(d.RequestedByName, d.RequestedByEmail, "Submitter");
        return list;
    }

    public async Task CancelPendingApprovalAsync(int projectId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            @"UPDATE beneficiary_approval_requests
              SET status = 'cancelled'
              WHERE fk_project_id = @ProjectId AND status = 'pending'",
            new { ProjectId = projectId });
    }

    public async Task<BeneficiaryApprovalDetailDto?> GetByTokenAsync(string token)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inline SQL instead of sp_beneficiary_approval_get_by_token: that SP inner-joins the
        // legacy monolithic `rotary_projects` table, but projects are now year-wise, so the SP
        // returns zero rows for any current project — which silently skipped the ZC email and
        // broke the approve/reject pages + dashboard detail. Read the approval + club/zone/
        // requester here, then pull the project fields from the correct year table below.
        var detail = await connection.QueryFirstOrDefaultAsync<BeneficiaryApprovalDetailDto>(
            @"SELECT bar.pk_approval_id AS Id, bar.fk_project_id AS ProjectId, bar.fk_zone_id AS ZoneId,
                     bar.fk_club_id AS ClubId, bar.requested_beneficiaries AS RequestedBeneficiaries,
                     bar.approved_beneficiaries AS ApprovedBeneficiaries,
                     bar.current_limit AS CurrentLimit, bar.approval_token AS ApprovalToken,
                     bar.status AS Status, bar.remark AS Remark, bar.requested_by AS RequestedBy,
                     bar.responded_date AS RespondedDate, bar.created_date AS CreatedDate,
                     c.ClubName, d.DistrictNumber, z.ZoneName,
                     m.MemberName AS RequestedByName, m.EmailId AS RequestedByEmail,
                     m.PrimaryMobileNumber AS RequestedByMobile
              FROM beneficiary_approval_requests bar
              JOIN club_master c ON c.pk_club_id = bar.fk_club_id
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              JOIN zone_master z ON z.pk_zone_id = bar.fk_zone_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = bar.requested_by
              WHERE bar.approval_token = @Token",
            new { Token = token });

        if (detail != null)
        {
            var backendUrl = _configuration["BackendUrl"]?.TrimEnd('/') ?? "http://localhost:5000";
            // Year-wise: find project's year table, reconstruct full URL via CONCAT.
            // Disambiguate by club — pk_project_id is reused across year tables, so id
            // alone can resolve to a different club's project in an earlier year.
            var info = await _yearTables.FindByProjectAndClubAsync(connection, detail.ProjectId, detail.ClubId);
            if (info != null)
            {
                detail.YearId = info.YearId;
                // Project fields come from the year-wise table (the legacy SP read the wrong one).
                var proj = await connection.QueryFirstOrDefaultAsync<dynamic>($@"
                    SELECT title AS ProjectTitle, description AS ProjectDescription,
                           project_date AS ProjectDate, project_cost AS ProjectCost,
                           direct_beneficiaries AS CurrentBeneficiaries, man_hours AS ManHours,
                           rotarians_involved AS RotariansInvolved, rotaractors_involved AS RotaractorsInvolved,
                           COALESCE(rcc_involved,0) AS RccInvolved
                    FROM `{info.ProjectsTable}` WHERE pk_project_id = @ProjectId AND isdeleted = 0",
                    new { ProjectId = detail.ProjectId });
                if (proj != null)
                {
                    detail.ProjectTitle = (string?)proj.ProjectTitle ?? "";
                    detail.ProjectDescription = (string?)proj.ProjectDescription;
                    detail.ProjectDate = (DateTime?)proj.ProjectDate;
                    detail.ProjectCost = (decimal?)proj.ProjectCost;
                    detail.CurrentBeneficiaries = (int?)proj.CurrentBeneficiaries;
                    detail.ManHours = (int?)proj.ManHours;
                    detail.RotariansInvolved = (int?)proj.RotariansInvolved;
                    detail.RotaractorsInvolved = (int?)proj.RotaractorsInvolved;
                    detail.RccInvolved = (int?)proj.RccInvolved;
                }

                var suffix = info.YearLabel.Replace("-", "_");
                var photos = await connection.QueryAsync<string>($@"
                    SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                  CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                       ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                  '/', ph.image_path)
                    FROM `{info.PhotosTable}` ph
                    JOIN `{info.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
                    WHERE ph.fk_project_id = @ProjectId
                    ORDER BY ph.sort_order",
                    new { ProjectId = detail.ProjectId });
                detail.PhotoUrls = photos.Select(p => $"{backendUrl}{p}").ToList();
            }
        }

        return detail;
    }

    public async Task<(string status, string result)> ApproveAsync(string token, string? remark)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inline SQL (not sp_beneficiary_approval_approve): that SP bumped the legacy monolithic
        // rotary_projects table, which no longer holds the project, so the approved count never
        // applied. Apply it to the correct year-wise table instead.
        var appr = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_project_id AS ProjectId, fk_club_id AS ClubId,
                     requested_beneficiaries AS Requested, status AS Status
              FROM beneficiary_approval_requests WHERE approval_token = @Token",
            new { Token = token });

        if (appr == null) return ("not_found", "error");
        var curStatus = (string)appr.Status;
        if (curStatus != "pending") return (curStatus, "already_processed");

        await connection.ExecuteAsync(
            @"UPDATE beneficiary_approval_requests
              SET status = 'approved', remark = @Remark, responded_date = NOW()
              WHERE approval_token = @Token AND status = 'pending'",
            new { Remark = remark ?? "", Token = token });

        await ApplyApprovedBeneficiariesAsync(connection, (int)appr.ProjectId, (int)appr.ClubId, (int)appr.Requested);

        await NotifyClubAdminsAsync(token, "approved", remark);
        return ("approved", "success");
    }

    // Apply the approved beneficiary count to the project's YEAR-WISE table. The legacy approve
    // SPs updated the old monolithic rotary_projects table (which no longer holds the project),
    // so approvals never took effect. Locate the correct year table by (projectId, clubId).
    private async Task ApplyApprovedBeneficiariesAsync(MySqlConnection conn, int projectId, int clubId, int requested)
    {
        var info = await _yearTables.FindByProjectAndClubAsync(conn, projectId, clubId);
        if (info == null)
        {
            _logger.LogWarning("Approved beneficiaries NOT applied — project {ProjectId}/club {ClubId} not found in any year table.", projectId, clubId);
            return;
        }
        await conn.ExecuteAsync(
            $"UPDATE `{info.ProjectsTable}` SET direct_beneficiaries = @Requested, modified_date = NOW() WHERE pk_project_id = @ProjectId AND isdeleted = 0",
            new { Requested = requested, ProjectId = projectId });
    }

    public async Task<(string status, string result)> RejectAsync(string token, string remark)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_beneficiary_approval_reject",
            new { p_Token = token, p_Remark = remark },
            commandType: CommandType.StoredProcedure);

        var status = (string)row.Status;
        var result = (string)row.Result;

        if (result == "success")
            await NotifyClubAdminsAsync(token, "rejected", remark);

        return (status, result);
    }

    public async Task<ZonalDashboardInfoDto?> GetZoneForMemberAsync(int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Using inline SQL instead of SP to avoid stale SP issue (SYSTEM_USER privilege prevents SP update)
        return await connection.QueryFirstOrDefaultAsync<ZonalDashboardInfoDto>(
            @"SELECT mr.fk_zone_id AS ZoneId, z.ZoneName, z.ZoneName AS ZoneCode
              FROM member_roles mr
              JOIN roles r ON r.pk_role_id = mr.fk_role_id
              JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
              WHERE mr.fk_member_master_profile_id = @Id
                AND r.RoleName = 'ZonalCoordinator'
                AND mr.IsActive = 1 AND mr.isdeleted = 0
                AND z.isdeleted = 0
              LIMIT 1",
            new { Id = memberId });
    }

    // SuperAdmin: resolve a zone's info directly by id (not via a ZC assignment).
    public async Task<ZonalDashboardInfoDto?> GetZoneInfoByIdAsync(int zoneId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ZonalDashboardInfoDto>(
            @"SELECT z.pk_zone_id AS ZoneId, z.ZoneName, z.ZoneName AS ZoneCode
              FROM zone_master z
              WHERE z.pk_zone_id = @Id AND z.isdeleted = 0
              LIMIT 1",
            new { Id = zoneId });
    }

    public async Task<(List<ApprovalListItemDto> items, int totalCount)> GetApprovalRequestsByZoneAsync(int zoneId, int districtId, int yearId, string? status, int page, int pageSize)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var offset = (page - 1) * pageSize;
        var statusFilter = string.IsNullOrEmpty(status) ? null : status;

        // Year-wise: join to a UNION ALL of every existing year table so the project's title +
        // date can be resolved regardless of which year it lives in. Each row is tagged with its
        // year_id so approvals can be filtered by rotary year.
        var pTables = await _yearTables.GetAllExistingYearTablesAsync(connection);
        // CONVERT(title …) normalises the collation — year tables can have mixed collations
        // (old utf8mb4_unicode_ci vs new utf8mb4_0900_ai_ci), which otherwise breaks the UNION.
        var pUnion = pTables.Count == 0 ? "SELECT NULL AS pk_project_id, NULL AS title, NULL AS project_date, NULL AS year_id WHERE 1=0" :
            string.Join(" UNION ALL ", pTables.Select(t =>
                $"SELECT pk_project_id, CONVERT(title USING utf8mb4) AS title, project_date, {t.YearId} AS year_id FROM `{t.ProjectsTable}` WHERE isdeleted = 0"));

        var items = (await connection.QueryAsync<ApprovalListItemDto>(
            $@"SELECT
                bar.pk_approval_id AS Id,
                bar.fk_project_id AS ProjectId,
                bar.requested_beneficiaries AS RequestedBeneficiaries,
                bar.current_limit AS CurrentLimit,
                bar.approval_token AS ApprovalToken,
                bar.status AS Status,
                bar.remark AS Remark,
                bar.responded_date AS RespondedDate,
                bar.created_date AS CreatedDate,
                p.title AS ProjectTitle,
                p.project_date AS ProjectDate,
                c.ClubName,
                d.DistrictNumber,
                m.MemberName AS RequestedByName
              FROM beneficiary_approval_requests bar
              LEFT JOIN ({pUnion}) p ON p.pk_project_id = bar.fk_project_id
                   -- pk_project_id collides across year-wise tables, so match ONLY the
                   -- latest-year project for this request. Without this, one request fans
                   -- out into one phantom row per year table that shares the pk.
                   AND p.year_id = (SELECT MAX(pp.year_id) FROM ({pUnion}) pp WHERE pp.pk_project_id = bar.fk_project_id)
              JOIN club_master c ON c.pk_club_id = bar.fk_club_id
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bar.requested_by
              WHERE bar.fk_zone_id = @ZoneId
                -- One row per project: keep only the LATEST attempt (a project may be
                -- submitted for approval multiple times; earlier attempts live in history).
                AND bar.pk_approval_id IN (
                    SELECT MAX(b2.pk_approval_id) FROM beneficiary_approval_requests b2
                    WHERE b2.fk_zone_id = @ZoneId GROUP BY b2.fk_project_id, b2.fk_club_id)
                AND (@DistrictId = 0 OR d.pk_district_id = @DistrictId)
                AND (@YearId = 0 OR p.year_id = @YearId)
                AND (@Status IS NULL OR bar.status = @Status)
              ORDER BY
                CASE bar.status WHEN 'pending' THEN 0 ELSE 1 END,
                bar.created_date DESC
              LIMIT @Offset, @PageSize",
            new { ZoneId = zoneId, DistrictId = districtId, YearId = yearId, Status = statusFilter, Offset = offset, PageSize = pageSize })).ToList();

        var totalCount = await connection.ExecuteScalarAsync<int>(
            $@"SELECT COUNT(*)
              FROM beneficiary_approval_requests bar
              LEFT JOIN ({pUnion}) p ON p.pk_project_id = bar.fk_project_id
                   AND p.year_id = (SELECT MAX(pp.year_id) FROM ({pUnion}) pp WHERE pp.pk_project_id = bar.fk_project_id)
              JOIN club_master c ON c.pk_club_id = bar.fk_club_id
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              WHERE bar.fk_zone_id = @ZoneId
                AND bar.pk_approval_id IN (
                    SELECT MAX(b2.pk_approval_id) FROM beneficiary_approval_requests b2
                    WHERE b2.fk_zone_id = @ZoneId GROUP BY b2.fk_project_id, b2.fk_club_id)
                AND (@DistrictId = 0 OR d.pk_district_id = @DistrictId)
                AND (@YearId = 0 OR p.year_id = @YearId)
                AND (@Status IS NULL OR bar.status = @Status)",
            new { ZoneId = zoneId, DistrictId = districtId, YearId = yearId, Status = statusFilter });

        return (items, totalCount);
    }

    // Data-only filter options for a zone's approvals: distinct rotary years (that have a project
    // which came for approval) + distinct districts (that have approval requests). Never padded.
    public async Task<ZonalApprovalFiltersDto> GetZoneApprovalFiltersAsync(int zoneId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var pTables = await _yearTables.GetAllExistingYearTablesAsync(connection);
        var yearUnion = pTables.Count == 0 ? "SELECT NULL AS pk_project_id, NULL AS year_id, NULL AS year_label WHERE 1=0" :
            string.Join(" UNION ALL ", pTables.Select(t =>
                $"SELECT pk_project_id, {t.YearId} AS year_id, '{t.YearLabel}' AS year_label FROM `{t.ProjectsTable}` WHERE isdeleted = 0"));

        var years = (await connection.QueryAsync<ZonalFilterYearDto>(
            $@"SELECT DISTINCT p.year_id AS Id, p.year_label AS Label,
                      COALESCE((SELECT ry.IsCurrent FROM rotary_year_master ry WHERE ry.pk_year_id = p.year_id), 0) AS IsCurrent
               FROM beneficiary_approval_requests bar
               JOIN ({yearUnion}) p ON p.pk_project_id = bar.fk_project_id
               WHERE bar.fk_zone_id = @ZoneId AND p.year_id IS NOT NULL
               ORDER BY p.year_label DESC",
            new { ZoneId = zoneId })).ToList();

        var districts = (await connection.QueryAsync<ZonalFilterDistrictDto>(
            @"SELECT DISTINCT d.pk_district_id AS Id, d.DistrictNumber AS Number
              FROM beneficiary_approval_requests bar
              JOIN club_master c ON c.pk_club_id = bar.fk_club_id
              JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
              WHERE bar.fk_zone_id = @ZoneId
              ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { ZoneId = zoneId })).ToList();

        // Zone-wide status counts (across ALL years + ALL districts) for the summary tiles.
        // Counts DISTINCT projects by their LATEST attempt's status — matches the deduped list.
        var counts = await connection.QueryFirstOrDefaultAsync<ApprovalStatusCountsDto>(
            @"SELECT
                CAST(SUM(status = 'pending')  AS SIGNED) AS Pending,
                CAST(SUM(status = 'approved') AS SIGNED) AS Approved,
                CAST(SUM(status = 'rejected') AS SIGNED) AS Rejected
              FROM beneficiary_approval_requests
              WHERE fk_zone_id = @ZoneId
                AND pk_approval_id IN (
                    SELECT MAX(b2.pk_approval_id) FROM beneficiary_approval_requests b2
                    WHERE b2.fk_zone_id = @ZoneId GROUP BY b2.fk_project_id, b2.fk_club_id)",
            new { ZoneId = zoneId }) ?? new ApprovalStatusCountsDto();

        return new ZonalApprovalFiltersDto { Years = years, Districts = districts, Counts = counts };
    }

    // All approval attempts for the project behind a given approval id (same project + club + zone),
    // newest first — the ZC's history timeline for that project.
    public async Task<List<ApprovalHistoryItemDto>> GetApprovalHistoryAsync(int approvalId, int zoneId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var key = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_project_id AS ProjectId, fk_club_id AS ClubId
              FROM beneficiary_approval_requests
              WHERE pk_approval_id = @Id AND fk_zone_id = @ZoneId",
            new { Id = approvalId, ZoneId = zoneId });
        if (key == null) return new List<ApprovalHistoryItemDto>();

        return (await connection.QueryAsync<ApprovalHistoryItemDto>(
            @"SELECT bar.pk_approval_id AS ApprovalId,
                     bar.requested_beneficiaries AS RequestedBeneficiaries,
                     bar.approved_beneficiaries AS ApprovedBeneficiaries,
                     bar.status AS Status, bar.remark AS Remark,
                     bar.created_date AS CreatedDate, bar.responded_date AS RespondedDate,
                     resp.MemberName AS RespondedByName
              FROM beneficiary_approval_requests bar
              LEFT JOIN member_master_profile resp ON resp.pk_member_master_profile_id = bar.responded_by
              WHERE bar.fk_zone_id = @ZoneId AND bar.fk_project_id = @ProjectId AND bar.fk_club_id = @ClubId
              ORDER BY bar.created_date DESC, bar.pk_approval_id DESC",
            new { ZoneId = zoneId, ProjectId = (int)key.ProjectId, ClubId = (int)key.ClubId })).ToList();
    }

    public async Task<List<ZonalDistrictDto>> GetZoneDistrictsAsync(int zoneId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ZonalDistrictDto>(
            @"SELECT d.pk_district_id AS Id, d.DistrictNumber, d.DistrictNumber AS DistrictName,
                (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS TotalClubs,
                (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                 JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                 WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS TotalMembers
              FROM district_master d
              WHERE d.fk_zone_id = @ZoneId AND d.isdeleted = 0 AND d.IsActive = 1
              ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { ZoneId = zoneId })).ToList();
    }

    public async Task<List<ZonalClubDto>> GetDistrictClubsAsync(int districtId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ZonalClubDto>(
            @"SELECT pk_club_id AS Id, ClubName, ClubCode
              FROM club_master
              WHERE fk_district_id = @DistrictId AND isdeleted = 0
              ORDER BY ClubName",
            new { DistrictId = districtId })).ToList();
    }

    // approvedBeneficiaries: the number the ZC actually approves (editable in the dialog,
    // pre-filled with the requested amount). When null we fall back to the requested amount.
    public async Task<(string status, string result)> ZonalApproveAsync(int approvalId, int zoneId, int memberId, string? remark, int? approvedBeneficiaries = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inline SQL (not sp_zonal_approve_request): that SP bumped the legacy rotary_projects
        // table. Apply the approved count to the correct year-wise table instead.
        var appr = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_project_id AS ProjectId, fk_club_id AS ClubId,
                     requested_beneficiaries AS Requested, status AS Status, approval_token AS Token
              FROM beneficiary_approval_requests
              WHERE pk_approval_id = @Id AND fk_zone_id = @ZoneId",
            new { Id = approvalId, ZoneId = zoneId });

        if (appr == null) return ("not_found", "error");
        var curStatus = (string)appr.Status;
        if (curStatus != "pending") return (curStatus, "already_processed");

        // The ZC-entered approved count (any non-negative number); default to the requested amount.
        var applied = approvedBeneficiaries.HasValue && approvedBeneficiaries.Value >= 0
            ? approvedBeneficiaries.Value
            : (int)appr.Requested;

        await connection.ExecuteAsync(
            @"UPDATE beneficiary_approval_requests
              SET status = 'approved', approved_beneficiaries = @Applied, remark = @Remark,
                  responded_by = @MemberId, responded_date = NOW()
              WHERE pk_approval_id = @Id AND status = 'pending'",
            new { Applied = applied, Remark = remark ?? "", MemberId = memberId, Id = approvalId });

        await ApplyApprovedBeneficiariesAsync(connection, (int)appr.ProjectId, (int)appr.ClubId, applied);

        await NotifyClubAdminsAsync((string)appr.Token, "approved", remark);
        return ("approved", "success");
    }

    public async Task<(string status, string result)> ZonalRejectAsync(int approvalId, int zoneId, int memberId, string remark)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_zonal_reject_request",
            new { p_ApprovalId = approvalId, p_ZoneId = zoneId, p_MemberId = memberId, p_Remark = remark },
            commandType: CommandType.StoredProcedure);

        var status = (string)row.Status;
        var result = (string)row.Result;

        if (result == "success")
        {
            string token = (string)row.Token;
            await NotifyClubAdminsAsync(token, "rejected", remark);
        }

        return (status, result);
    }

    // Approve/reject result → ZC, Club President, Club Secretary and the submitter
    // (no longer every Club Admin). Failures are logged but never block the decision.
    private async Task NotifyClubAdminsAsync(string token, string decision, string? remark)
    {
        try
        {
            var detail = await GetByTokenAsync(token);
            if (detail == null)
            {
                _logger.LogWarning("Beneficiary {Decision} email not sent — approval token {Token} not found.", decision, token);
                return;
            }

            using var connection = CreateConnection();
            await connection.OpenAsync();

            foreach (var (name, email, role) in await GetRecipientsAsync(connection, detail))
            {
                try
                {
                    await _emailService.SendBeneficiaryDecisionEmailAsync(email, name, detail, decision, remark);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex,
                        "Failed to send beneficiary {Decision} email to {Role} {Email} for approval {ApprovalId}.",
                        decision, role, email, detail.Id);
                }
            }
        }
        catch (Exception ex)
        {
            // Email notification failures should not block the approval/rejection
            _logger.LogError(ex, "Beneficiary {Decision} emails failed for approval token {Token}.", decision, token);
        }
    }
}

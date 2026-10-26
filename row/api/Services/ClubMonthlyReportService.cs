using System.Data;
using System.Globalization;
using System.Text.Json;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubMonthlyReportService : IClubMonthlyReportService
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly ILogger<ClubMonthlyReportService> _logger;
    private readonly IYearTableResolver _yearTables;
    private readonly ICitationRecalcTrigger _citationRecalc;

    public ClubMonthlyReportService(IConfiguration configuration, IEmailService emailService, ILogger<ClubMonthlyReportService> logger, IYearTableResolver yearTables, ICitationRecalcTrigger citationRecalc)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _logger = logger;
        _yearTables = yearTables;
        _citationRecalc = citationRecalc;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<ReportYearDto>> GetYearsAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Union pattern (same as the district-level club-monthly-report/years
        // endpoint): years that HAVE a report for this club + the current
        // rotary year always, deduped. Guarantees admins can submit CMR for
        // the current year even before any report exists for it.
        var rows = await connection.QueryAsync<ReportYearDto>(
            @"SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
              FROM club_monthly_reports r
              INNER JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
              WHERE r.fk_club_id = @ClubId AND r.isdeleted = 0
              UNION
              SELECT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
              FROM rotary_year_master y WHERE y.IsCurrent = 1
              ORDER BY Id DESC",
            new { ClubId = clubId });
        return rows.ToList();
    }

    public async Task<List<MonthlyReportListDto>> GetMonthsAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var year = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate, EndDate, IsCurrent FROM rotary_year_master WHERE pk_year_id = @YearId",
            new { YearId = yearId });
        if (year == null) return new();

        DateTime startDate = year.StartDate;
        DateTime endDate = year.EndDate;
        bool isCurrent = Convert.ToBoolean(year.IsCurrent);

        var reports = (await connection.QueryAsync<dynamic>(
            @"SELECT pk_report_id, ReportMonth, IsUploadedToDistrict, created_date, modified_date
              FROM club_monthly_reports
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
            new { ClubId = clubId, YearId = yearId })).ToList();

        var result = new List<MonthlyReportListDto>();
        var current = new DateTime(startDate.Year, startDate.Month, 1);
        var end = isCurrent
            ? new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1)
            : new DateTime(endDate.Year, endDate.Month, 1);

        while (current <= end)
        {
            int m = current.Month;
            var existing = reports.FirstOrDefault(r => (int)r.ReportMonth == m);

            result.Add(new MonthlyReportListDto
            {
                ReportId = existing != null ? (int)existing.pk_report_id : null,
                Month = m,
                MonthName = $"{current:MMMM yyyy}",
                IsCreated = existing != null,
                CreatedDate = existing != null ? (DateTime?)existing.created_date : null,
                ModifiedDate = existing != null ? (DateTime?)existing.modified_date : null,
                IsUploadedToDistrict = existing != null && Convert.ToBoolean(existing.IsUploadedToDistrict)
            });

            current = current.AddMonths(1);
        }

        return result;
    }

    public async Task<MonthlyReportDetailDto?> GetReportAsync(int clubId, int yearId, int month)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var report = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_report_id, fk_club_id, fk_year_id, ReportMonth,
                     MemberCountLastMonth, MembersDeleted, MembersAdded, CurrentMemberCount,
                     AdditionalRemarks, IsUploadedToDistrict, created_date, modified_date,
                     -- AG resolved LIVE (current AG for this club + year), not the creation snapshot.
                     (SELECT mp.MemberName FROM district_ag da
                        JOIN member_master_profile mp ON mp.pk_member_master_profile_id = da.fk_member_id
                                                     AND COALESCE(mp.isdeleted, 0) = 0
                      WHERE da.fk_club_id = club_monthly_reports.fk_club_id
                        AND da.fk_year_id = club_monthly_reports.fk_year_id
                        AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
                      ORDER BY da.id DESC LIMIT 1) AS AssistantGovernorName
              FROM club_monthly_reports
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND ReportMonth = @Month AND isdeleted = 0",
            new { ClubId = clubId, YearId = yearId, Month = month });

        if (report == null) return null;

        int reportId = (int)report.pk_report_id;
        // TRF entries now managed via standalone trf_contributions table
        string agName = report.AssistantGovernorName as string ?? "";

        return new MonthlyReportDetailDto
        {
            ReportId = reportId,
            ClubId = (int)report.fk_club_id,
            YearId = (int)report.fk_year_id,
            ReportMonth = (int)report.ReportMonth,
            MemberCountLastMonth = (int)report.MemberCountLastMonth,
            MembersDeleted = (int)report.MembersDeleted,
            MembersAdded = (int)report.MembersAdded,
            CurrentMemberCount = (int)report.CurrentMemberCount,
            AdditionalRemarks = report.AdditionalRemarks as string,
            IsUploadedToDistrict = Convert.ToBoolean(report.IsUploadedToDistrict),
            AssistantGovernor = string.IsNullOrWhiteSpace(agName) ? "N/A" : agName,
            CreatedDate = report.created_date as DateTime?,
            ModifiedDate = report.modified_date as DateTime?,
            TrfEntries = new List<TrfEntryDto>()
        };
    }

    public async Task<int> CreateOrGetReportAsync(int clubId, int yearId, int month, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var existing = await connection.QueryFirstOrDefaultAsync<int?>(
            @"SELECT pk_report_id FROM club_monthly_reports
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND ReportMonth = @Month AND isdeleted = 0",
            new { ClubId = clubId, YearId = yearId, Month = month });

        if (existing.HasValue) return existing.Value;

        // Capture the club's Assistant Governor AT CREATION (locked — never updated later).
        // Sourced from district_ag (one active AG per club/year). NULL if the club has no AG.
        var id = await connection.QuerySingleAsync<int>(
            @"INSERT INTO club_monthly_reports (fk_club_id, fk_year_id, ReportMonth, fk_ag_member_id, created_by, created_date)
              VALUES (@ClubId, @YearId, @Month,
                      (SELECT da.fk_member_id FROM district_ag da
                       WHERE da.fk_club_id = @ClubId AND da.fk_year_id = @YearId
                         AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
                       ORDER BY da.id DESC LIMIT 1),
                      @CreatedBy, NOW());
              SELECT LAST_INSERT_ID()",
            new { ClubId = clubId, YearId = yearId, Month = month, CreatedBy = createdBy });

        return id;
    }

    public async Task SaveMemberInfoAsync(int reportId, SaveMemberInfoDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        int currentCount = dto.MemberCountLastMonth - dto.MembersDeleted + dto.MembersAdded;

        await connection.ExecuteAsync(
            @"UPDATE club_monthly_reports SET
                MemberCountLastMonth = @MemberCountLastMonth,
                MembersDeleted = @MembersDeleted,
                MembersAdded = @MembersAdded,
                CurrentMemberCount = @CurrentMemberCount,
                AdditionalRemarks = @AdditionalRemarks,
                modified_by = @ModifiedBy,
                modified_date = NOW()
              WHERE pk_report_id = @ReportId",
            new
            {
                ReportId = reportId,
                dto.MemberCountLastMonth,
                dto.MembersDeleted,
                dto.MembersAdded,
                CurrentMemberCount = currentCount,
                dto.AdditionalRemarks,
                ModifiedBy = modifiedBy
            });
    }

    // Live member stats for a CMR month, derived from club_members. Example (July report):
    //   MemberCountLastMonth = members active as at 01-Jul 00:00 (joined before Jul, not
    //     yet terminated by then)
    //   MembersDeleted       = terminations/soft-deletes dated WITHIN July
    //   MembersAdded         = JoinedDate WITHIN July
    //   CurrentMemberCount   = lastMonth - deleted + added
    // HONORARY members are EXCLUDED (tracked separately, like the club dashboard count).
    // Counts are DISTINCT by member profile (duplicate club_members rows for the same
    // person collapse to one). A membership's "removal date" is set ONLY when the row is
    // actually removed (isdeleted=1 or IsActive=0) — an active row with a stale legacy
    // TerminationDate is NOT treated as removed.
    public async Task<ComputedMemberInfoDto> ComputeMemberInfoAsync(int clubId, int yearId, int month)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var year = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1",
            new { YearId = yearId });
        if (year == null) return new ComputedMemberInfoDto();

        DateTime startDate = year.StartDate;
        // Rotary year runs from StartDate (typically 1-Jul) through the next June. Months
        // >= the start month belong to the start calendar year; earlier months roll over.
        int calYear = month >= startDate.Month ? startDate.Year : startDate.Year + 1;
        var monthStart = new DateTime(calYear, month, 1);
        var monthEnd = monthStart.AddMonths(1);

        // Removal date expression (reused for last-month + deleted). IMPORTANT: only a
        // membership that is ACTUALLY removed (isdeleted=1 or IsActive=0) has a removal
        // date. Some active rows carry a STALE TerminationDate from years ago (bad legacy
        // data) — those members are still in the club, so an active row must never count
        // as removed regardless of any leftover TerminationDate.
        const string removed =
            "CASE WHEN (cm.isdeleted = 1 OR cm.IsActive = 0) THEN COALESCE(cm.TerminationDate, cm.deleted_date, cm.modified_date) ELSE NULL END";

        var row = await connection.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT
              COUNT(DISTINCT CASE
                WHEN cm.JoinedDate IS NOT NULL AND cm.JoinedDate < @MonthStart
                 AND ({removed} IS NULL OR {removed} >= @MonthStart)
                THEN cm.fk_member_master_profile_id END) AS lastMonth,
              COUNT(DISTINCT CASE
                WHEN {removed} >= @MonthStart AND {removed} < @MonthEnd
                THEN cm.fk_member_master_profile_id END) AS deleted,
              COUNT(DISTINCT CASE
                WHEN cm.JoinedDate >= @MonthStart AND cm.JoinedDate < @MonthEnd
                THEN cm.fk_member_master_profile_id END) AS added
            FROM club_members cm
            JOIN member_master_profile m
              ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId
              -- Honorary members are NOT part of the reported member count (they are tracked
              -- separately, same as the club dashboard's headline count). Exclude them.
              AND COALESCE(cm.IsHonoraryMember, 0) = 0",
            new { ClubId = clubId, MonthStart = monthStart, MonthEnd = monthEnd });

        int lastMonth = (int)(long)(row?.lastMonth ?? 0L);
        int deleted   = (int)(long)(row?.deleted ?? 0L);
        int added     = (int)(long)(row?.added ?? 0L);

        return new ComputedMemberInfoDto
        {
            MemberCountLastMonth = lastMonth,
            MembersDeleted = deleted,
            MembersAdded = added,
            CurrentMemberCount = lastMonth - deleted + added
        };
    }

    public async Task<List<ReportMeetingDto>> GetMeetingsForMonthAsync(int clubId, int yearId, int month)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Year-wise: resolve to one year-wise projects table.
        var info = await _yearTables.ResolveByYearIdAsync(connection, yearId);
        if (info is null) return new List<ReportMeetingDto>();

        var meetings = await connection.QueryAsync<ReportMeetingDto>(
            $@"SELECT p.pk_project_id AS ProjectId, p.title AS Title, p.meeting_type AS MeetingType,
                     DATE_FORMAT(p.project_date, '%Y-%m-%d') AS ProjectDate,
                     p.attendance AS Attendance, p.attendance_percentage AS AttendancePercentage
              FROM `{info.ProjectsTable}` p
              INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
              WHERE p.fk_club_id = @ClubId
                AND m.ModuleKey = 'club_service'
                AND MONTH(p.project_date) = @Month
                AND p.isdeleted = 0
              ORDER BY p.project_date",
            new { ClubId = clubId, Month = month });

        return meetings.ToList();
    }

    public async Task<Dictionary<string, List<ReportProjectDto>>> GetProjectsForMonthAsync(int clubId, int yearId, int month)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Year-wise: resolve to one year-wise projects table.
        var info = await _yearTables.ResolveByYearIdAsync(connection, yearId);

        var moduleKeys = new[] { "community_service", "vocational_service", "international_service", "new_generation_service", "public_image_initiative" };
        var result = new Dictionary<string, List<ReportProjectDto>>();

        if (info is null)
        {
            foreach (var k in moduleKeys) result[k] = new List<ReportProjectDto>();
            return result;
        }

        foreach (var key in moduleKeys)
        {
            var projects = await connection.QueryAsync<ReportProjectDto>(
                $@"SELECT p.pk_project_id AS ProjectId, p.title AS Title,
                         p.project_type AS ProjectType,
                         p.parent_project_id AS ParentProjectId,
                         DATE_FORMAT(p.project_date, '%Y-%m-%d') AS ProjectDate,
                         aof.name AS AreaOfFocusName,
                         p.project_cost AS ProjectCost,
                         p.direct_beneficiaries AS DirectBeneficiaries,
                         p.man_hours AS ManHours,
                         p.rotarians_involved AS RotariansInvolved,
                         p.rotaractors_involved AS RotaractorsInvolved,
                         COALESCE(p.rcc_involved,0) AS RccInvolved
                  FROM `{info.ProjectsTable}` p
                  INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
                  LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                  WHERE p.fk_club_id = @ClubId
                    AND m.ModuleKey = @ModuleKey
                    AND MONTH(p.project_date) = @Month
                    AND p.isdeleted = 0
                  ORDER BY p.project_date",
                new { ClubId = clubId, ModuleKey = key, Month = month });

            result[key] = projects.ToList();
        }

        return result;
    }

    private static readonly string[] CmrModuleKeys =
    {
        "club_service", "community_service", "vocational_service",
        "international_service", "new_generation_service", "public_image_initiative"
    };

    // Detailed rows for the Word export: full project fields for meetings + all 5 avenues,
    // each with its photos (resolved /Documents/gallery paths — the controller loads bytes).
    // Freeze-on-upload (mirrors GetPreviewAsync): an uploaded report's Word detail comes from the
    // snapshot; a draft is live; a legacy uploaded report is captured lazily on first read.
    public async Task<List<CmrWordProjectDto>> GetWordProjectsForMonthAsync(int clubId, int yearId, int month)
    {
        var (uploaded, snapshotJson, reportId) = await GetSnapshotStateAsync(clubId, yearId, month);
        if (uploaded)
        {
            var snap = DeserializeSnapshot(snapshotJson);
            if (snap?.WordProjects != null) return snap.WordProjects;       // frozen copy
            return (await CaptureAndSaveSnapshotAsync(clubId, yearId, month, reportId, 0)).WordProjects;  // lazy backfill
        }
        return await GetWordProjectsCoreAsync(clubId, yearId, month);
    }

    // Year-scoped variant (whole rotary year) — used by the Annual Report.
    public Task<List<CmrWordProjectDto>> GetWordProjectsForYearAsync(int clubId, int yearId)
        => GetWordProjectsCoreAsync(clubId, yearId, null);

    private async Task<List<CmrWordProjectDto>> GetWordProjectsCoreAsync(int clubId, int yearId, int? month)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var info = await _yearTables.ResolveByYearIdAsync(connection, yearId);
        if (info is null) return new List<CmrWordProjectDto>();
        var suffix = info.YearLabel.Replace("-", "_");
        var monthClause = month.HasValue ? "AND MONTH(p.project_date) = @Month" : "";

        var projects = (await connection.QueryAsync<CmrWordProjectDto>(
            $@"SELECT p.pk_project_id AS ProjectId, m.ModuleKey AS ModuleKey,
                     p.title AS Title, p.description AS Description, p.location AS Location,
                     DATE_FORMAT(p.project_date, '%Y-%m-%d') AS ProjectDate, p.meeting_type AS MeetingType,
                     aof.name AS AreaOfFocusName, p.other_area_of_focus AS OtherAreaOfFocus,
                     p.project_cost AS ProjectCost, f.name AS FundingName,
                     p.direct_beneficiaries AS DirectBeneficiaries, p.man_hours AS ManHours,
                     p.rotarians_involved AS RotariansInvolved, p.rotaractors_involved AS RotaractorsInvolved,
                     COALESCE(p.rcc_involved,0) AS RccInvolved,
                     p.attendance AS Attendance, p.attendance_percentage AS AttendancePercentage,
                     p.is_joint_project AS IsJointProject, p.co_host_name AS CoHostName,
                     p.agenda_document AS AgendaDocument, p.minutes_document AS MinutesDocument
              FROM `{info.ProjectsTable}` p
              INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
              LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
              LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
              WHERE p.fk_club_id = @ClubId AND m.ModuleKey IN @Keys
                {monthClause} AND p.isdeleted = 0
              ORDER BY FIELD(m.ModuleKey, 'club_service','community_service','vocational_service','international_service','new_generation_service','public_image_initiative'),
                       p.project_date, p.pk_project_id",
            new { ClubId = clubId, Keys = CmrModuleKeys, Month = month ?? 0 })).ToList();

        if (projects.Count == 0) return projects;

        var photos = (await connection.QueryAsync<CmrWordPhotoDto>(
            $@"SELECT pp.fk_project_id AS ProjectId,
                     CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                            CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                 ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                            '/', pp.image_path) AS ImagePath,
                     pp.description AS Description, pp.is_primary AS IsPrimary, pp.sort_order AS SortOrder
              FROM `{info.PhotosTable}` pp
              INNER JOIN `{info.ProjectsTable}` p ON p.pk_project_id = pp.fk_project_id
              INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
              WHERE p.fk_club_id = @ClubId AND m.ModuleKey IN @Keys
                {monthClause} AND p.isdeleted = 0
              ORDER BY pp.fk_project_id, pp.is_primary DESC, pp.sort_order",
            new { ClubId = clubId, Keys = CmrModuleKeys, Month = month ?? 0 })).ToList();

        var byProject = photos.GroupBy(x => x.ProjectId).ToDictionary(g => g.Key, g => g.ToList());
        foreach (var pr in projects)
            if (byProject.TryGetValue(pr.ProjectId, out var list)) pr.Photos = list;

        return projects;
    }

    // Freeze-on-upload: an uploaded CMR renders from the snapshot taken at upload time, so every
    // PDF/Word download (club/district/AG, web + mobile) shows the LAST-UPLOADED data — not live.
    // A draft (not yet uploaded) renders live. A report uploaded before this feature has no stored
    // snapshot, so it is captured lazily on first read and frozen from then on.
    public async Task<MonthlyReportPreviewDto> GetPreviewAsync(int clubId, int yearId, int month, int requestedBy)
    {
        var (uploaded, snapshotJson, reportId) = await GetSnapshotStateAsync(clubId, yearId, month);
        if (uploaded)
        {
            var snap = DeserializeSnapshot(snapshotJson);
            if (snap?.Preview != null) return snap.Preview;                 // frozen copy
            return (await CaptureAndSaveSnapshotAsync(clubId, yearId, month, reportId, requestedBy)).Preview;  // lazy backfill
        }
        return await BuildPreviewLiveAsync(clubId, yearId, month, requestedBy);
    }

    // Live builder (the actual queries). Public wrapper GetPreviewAsync decides live-vs-frozen.
    private async Task<MonthlyReportPreviewDto> BuildPreviewLiveAsync(int clubId, int yearId, int month, int requestedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Step 1: Get report
        dynamic report;
        try
        {
            report = await connection.QueryFirstOrDefaultAsync<dynamic>(
                @"SELECT r.pk_report_id, r.MemberCountLastMonth, r.MembersDeleted, r.MembersAdded,
                         r.CurrentMemberCount, r.AdditionalRemarks, r.IsUploadedToDistrict,
                         r.uploaded_to_district_date, r.created_date, r.modified_date, r.created_by, r.modified_by,
                         cm.ClubName, cm.ClubRotaryId AS ClubCode,
                         y.YearLabel, y.pk_year_id,
                         -- AG resolved LIVE (current Assistant Governor for this club + year), so an
                         -- AG change since the report was created is reflected on the report/email.
                         (SELECT mp.MemberName FROM district_ag da
                            JOIN member_master_profile mp ON mp.pk_member_master_profile_id = da.fk_member_id
                                                          AND COALESCE(mp.isdeleted, 0) = 0
                          WHERE da.fk_club_id = r.fk_club_id AND da.fk_year_id = r.fk_year_id
                            AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
                          ORDER BY da.id DESC LIMIT 1) AS AssistantGovernorName
                  FROM club_monthly_reports r
                  INNER JOIN club_master cm ON cm.pk_club_id = r.fk_club_id
                  INNER JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
                  WHERE r.fk_club_id = @ClubId AND r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0",
                new { ClubId = clubId, YearId = yearId, Month = month });
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step1-QueryReport] {ex.Message}", ex);
        }

        if (report == null) throw new InvalidOperationException($"Report not found for club={clubId}, year={yearId}, month={month}");

        int reportId;
        try { reportId = (int)report.pk_report_id; }
        catch (Exception ex) { throw new Exception($"[Step1-CastReportId] {ex.Message}", ex); }

        // Step 2: Prepared By = the club admin who last UPDATED / UPLOADED the report — NOT the
        // original creator and NOT the person downloading it. modified_by is stamped by every save
        // AND by upload-to-district, so it holds whoever actually submitted (a different admin can
        // create the report but another updates + uploads it). Falls back to created_by (report
        // created but never modified) then to the requester. Designation = THAT person's BOD
        // designation for THIS club + the report's year, else "Rotarian".
        string preparedBy = "";
        string designation = "Rotarian";
        try
        {
            int uploaderId = report.modified_by != null ? Convert.ToInt32(report.modified_by)
                           : report.created_by != null ? Convert.ToInt32(report.created_by)
                           : requestedBy;
            var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
                @"SELECT m.MemberName AS MemberName,
                         (SELECT d.designation_name FROM board_of_directors bod
                            JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
                           WHERE bod.fk_member_master_profile_id = m.pk_member_master_profile_id
                             AND bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0
                           ORDER BY d.pk_designation_id LIMIT 1) AS BodDesignation
                  FROM member_master_profile m
                  WHERE m.pk_member_master_profile_id = @Id",
                new { Id = uploaderId, ClubId = clubId, YearId = yearId });
            if (member != null)
            {
                preparedBy = (string)(member.MemberName ?? "");
                var des = member.BodDesignation as string;
                if (!string.IsNullOrWhiteSpace(des)) designation = des!.Trim();
                // else: uploader not on the Board for this club/year → stays "Rotarian".
            }
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step2-PreparedBy] {ex.Message}", ex);
        }

        // Step 3: Get meetings
        List<ReportMeetingDto> meetings;
        try
        {
            meetings = await GetMeetingsForMonthAsync(clubId, yearId, month);
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step3-Meetings] {ex.Message}", ex);
        }

        // Step 4: Average attendance
        decimal avgAttendance = 0;
        try
        {
            if (meetings.Count > 0 && meetings.Any(m => m.AttendancePercentage.HasValue))
            {
                avgAttendance = meetings.Where(m => m.AttendancePercentage.HasValue)
                    .Average(m => m.AttendancePercentage!.Value);
            }
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step4-AvgAttendance] {ex.Message}", ex);
        }

        // Step 5: TRF entries (from standalone trf_contributions table)
        List<TrfEntryDto> trfEntries;
        try
        {
            trfEntries = (await connection.QueryAsync<TrfEntryDto>(
                @"SELECT pk_trf_id AS TrfId, TrfDate, DonorName, AmountUSD, FundType, OtherFundName
                  FROM trf_contributions
                  WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND MONTH(TrfDate) = @Month AND isdeleted = 0
                  ORDER BY TrfDate",
                new { ClubId = clubId, YearId = yearId, Month = month })).ToList();
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step5-TrfEntries] {ex.Message}", ex);
        }

        // Step 6: TRF year total (from standalone trf_contributions table)
        decimal trfYearTotal;
        try
        {
            trfYearTotal = await connection.QueryFirstOrDefaultAsync<decimal?>(
                @"SELECT SUM(AmountUSD)
                  FROM trf_contributions
                  WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
                new { ClubId = clubId, YearId = yearId }) ?? 0;
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step6-TrfYearTotal] {ex.Message}", ex);
        }

        decimal trfCurrentMonth = trfEntries.Sum(e => e.AmountUSD);

        // Step 7: Projects
        Dictionary<string, List<ReportProjectDto>> projects;
        try
        {
            projects = await GetProjectsForMonthAsync(clubId, yearId, month);
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step7-Projects] {ex.Message}", ex);
        }

        // Step 8: Build result
        try
        {
            string monthName = new DateTime(2000, month, 1).ToString("MMMM");
            DateTime? reportDate = report.modified_date != null ? (DateTime?)report.modified_date : (DateTime?)report.created_date;

            return new MonthlyReportPreviewDto
            {
                ReportId = reportId,
                ClubId = clubId,
                ClubName = report.ClubName?.ToString() ?? "",
                ClubCode = report.ClubCode?.ToString(),
                YearId = yearId,
                YearLabel = report.YearLabel?.ToString() ?? "",
                ReportMonth = month,
                MonthName = monthName,
                ReportDate = reportDate,
                PreparedBy = preparedBy,
                Designation = designation,
                AssistantGovernor = string.IsNullOrWhiteSpace(report.AssistantGovernorName as string)
                    ? "N/A" : (string)report.AssistantGovernorName,
                MemberCountLastMonth = Convert.ToInt32(report.MemberCountLastMonth),
                MembersDeleted = Convert.ToInt32(report.MembersDeleted),
                MembersAdded = Convert.ToInt32(report.MembersAdded),
                CurrentMemberCount = Convert.ToInt32(report.CurrentMemberCount),
                TotalMeetings = meetings.Count,
                AverageAttendance = Math.Round(avgAttendance, 2),
                TrfCurrentMonth = trfCurrentMonth,
                TrfThisYear = trfYearTotal,
                AdditionalRemarks = report.AdditionalRemarks?.ToString(),
                IsUploadedToDistrict = Convert.ToBoolean(report.IsUploadedToDistrict),
                UploadedToDistrictDate = report.uploaded_to_district_date != null ? (DateTime?)report.uploaded_to_district_date : null,
                Meetings = meetings,
                TrfEntries = trfEntries,
                Projects = projects
            };
        }
        catch (Exception ex)
        {
            throw new Exception($"[Step8-BuildResult] {ex.Message}", ex);
        }
    }

    public async Task UploadToDistrictAsync(int reportId, int modifiedBy)
    {
        int clubFk, yearFk, month;
        using (var connection = CreateConnection())
        {
            await connection.OpenAsync();
            await connection.ExecuteAsync(
                @"UPDATE club_monthly_reports SET
                    IsUploadedToDistrict = 1,
                    uploaded_to_district_date = NOW(),
                    modified_by = @ModifiedBy,
                    modified_date = NOW()
                  WHERE pk_report_id = @ReportId",
                new { ReportId = reportId, ModifiedBy = modifiedBy });

            var meta = await connection.QueryFirstOrDefaultAsync<(int ClubId, int YearId, int Month)>(
                "SELECT fk_club_id AS ClubId, fk_year_id AS YearId, ReportMonth AS Month FROM club_monthly_reports WHERE pk_report_id = @Id",
                new { Id = reportId });
            clubFk = meta.ClubId; yearFk = meta.YearId; month = meta.Month;
        }

        // Freeze the report at the moment of upload — capture (overwrite) the snapshot so every
        // later PDF/Word download reflects exactly this state, until the next upload re-captures.
        // modified_by was just set above, so PreparedBy resolves to the uploader. Best-effort: a
        // capture failure must not block the upload itself.
        if (clubFk > 0)
        {
            try { await CaptureAndSaveSnapshotAsync(clubFk, yearFk, month, reportId, modifiedBy); }
            catch (Exception ex) { _logger.LogError(ex, "CMR freeze-snapshot capture failed for report {ReportId}", reportId); }
        }

        // Refresh District Awards "Club Monthly Report" count — that auto
        // activity only counts reports with IsUploadedToDistrict = 1, so
        // we recalc on this transition specifically.
        if (clubFk > 0) _citationRecalc.TriggerForClub(clubFk);
    }

    // ─── Freeze-on-upload snapshot helpers ──────────────────────────────────

    // Report state for the month: is it uploaded, and does it already have a frozen snapshot?
    private async Task<(bool Uploaded, string? SnapshotJson, int ReportId)> GetSnapshotStateAsync(int clubId, int yearId, int month)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<(int ReportId, int Uploaded, string? Json)?>(
            @"SELECT pk_report_id AS ReportId,
                     COALESCE(IsUploadedToDistrict, 0) AS Uploaded,
                     report_snapshot_json AS Json
              FROM club_monthly_reports
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND ReportMonth = @Month AND isdeleted = 0",
            new { ClubId = clubId, YearId = yearId, Month = month });
        if (row == null) return (false, null, 0);
        return (row.Value.Uploaded == 1, row.Value.Json, row.Value.ReportId);
    }

    // Build the live preview + Word detail and persist them as the frozen snapshot (overwrite).
    private async Task<CmrSnapshotDto> CaptureAndSaveSnapshotAsync(int clubId, int yearId, int month, int reportId, int requestedBy)
    {
        var preview = await BuildPreviewLiveAsync(clubId, yearId, month, requestedBy);
        var words = await GetWordProjectsCoreAsync(clubId, yearId, month);
        var snap = new CmrSnapshotDto { Preview = preview, WordProjects = words };
        var json = JsonSerializer.Serialize(snap);
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(
            @"UPDATE club_monthly_reports
              SET report_snapshot_json = @Json, snapshot_captured_date = NOW()
              WHERE pk_report_id = @Id",
            new { Json = json, Id = reportId });
        return snap;
    }

    private static CmrSnapshotDto? DeserializeSnapshot(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<CmrSnapshotDto>(json); }
        catch { return null; }   // corrupt/legacy JSON → treat as "no snapshot" (falls back to live/recapture)
    }


    public async Task<SendReportEmailResultDto> SendReportEmailAsync(int clubId, SendReportEmailDto dto)
    {
        var result = new SendReportEmailResultDto();
        var pdfBytes = Convert.FromBase64String(dto.PdfBase64);
        var fileName = $"{dto.ClubName}_Monthly_Report_{dto.MonthName}_{dto.YearLabel}.pdf".Replace(" ", "_");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get Club President and Club Secretary from BOD for this year
        var bodMembers = (await connection.QueryAsync<dynamic>(
            @"SELECT m.MemberName, m.EmailId, d.designation_name AS DesignationName
              FROM board_of_directors bod
              INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
              INNER JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
              WHERE bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0
                AND d.designation_name IN ('Club President', 'Club Secretary')",
            new { ClubId = clubId, YearId = dto.YearId })).ToList();

        var president = bodMembers.FirstOrDefault(b => (string)b.DesignationName == "Club President");
        var secretary = bodMembers.FirstOrDefault(b => (string)b.DesignationName == "Club Secretary");

        if (president == null)
            result.Warnings.Add("Club President not found in Board of Directors for this year.");
        if (secretary == null)
            result.Warnings.Add("Club Secretary not found in Board of Directors for this year.");

        // DG and AG - placeholder for future district module
        result.Warnings.Add("District Governor and Assistant Governor emails not configured yet.");

        // Build email body
        var subject = $"Club monthly report Submitted successfully - {dto.ClubName} - {dto.MonthName} {dto.YearLabel}";
        var htmlBody = $@"
            {EmailService.EMAIL_HEADER}
                        <p style='font-style: italic; font-size: 15px; margin-bottom: 20px;'><strong>Dear Rtn,</strong></p>
                        <p style='font-size: 14px; line-height: 1.8;'>
                            The club monthly report for <strong>{dto.ClubName}</strong> for the month of <strong>{dto.MonthName} {dto.YearLabel}</strong> is uploaded successfully.
                        </p>
                        <p style='font-size: 14px; line-height: 1.8; font-style: italic;'>
                            The copy of the report is attached.
                        </p>
                        <p style='font-size: 14px; line-height: 1.8; font-style: italic;'>
                            This is an autogenerated Email from ROW.
                        </p>
            {EmailService.EMAIL_FOOTER}";

        // Send to all found recipients
        var recipients = new List<(string Name, string Email, string Role)>();

        if (president != null && !string.IsNullOrWhiteSpace((string?)president.EmailId))
            recipients.Add(((string)president.MemberName, (string)president.EmailId, "Club President"));
        else if (president != null)
            result.Warnings.Add("Club President does not have an email address.");

        if (secretary != null && !string.IsNullOrWhiteSpace((string?)secretary.EmailId))
            recipients.Add(((string)secretary.MemberName, (string)secretary.EmailId, "Club Secretary"));
        else if (secretary != null)
            result.Warnings.Add("Club Secretary does not have an email address.");

        foreach (var (name, email, role) in recipients)
        {
            try
            {
                await _emailService.SendEmailWithAttachmentAsync(email, subject, htmlBody, pdfBytes, fileName);
                result.SentTo.Add($"{role}: {name} ({email})");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send report email to {Role}: {Email}", role, LogMask.Email(email));
                result.Warnings.Add($"Failed to send email to {role}: {name} ({email})");
            }
        }

        if (recipients.Count == 0 && bodMembers.Count == 0)
            result.Warnings.Add("No recipients found. Email not sent.");

        return result;
    }
}

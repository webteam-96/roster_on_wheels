using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubService : IClubService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly IEmailService _emailService;
    private readonly ILogger<ClubService> _logger;
    private readonly IDcAutoGroupService _dcAutoGroups;

    public ClubService(IConfiguration configuration, IWebHostEnvironment env, IEmailService emailService, ILogger<ClubService> logger, IDcAutoGroupService dcAutoGroups)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _emailService = emailService;
        _logger = logger;
        _dcAutoGroups = dcAutoGroups;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<PagedResult<ClubListDto>> GetAllAsync(int page, int pageSize, string? search, int? districtId, string? city, string? meetingDay, int? isActive, int? zoneId = null, bool excludeRotaract = false)
    {
        // Inline SQL (was sp_club_get_all_paginated / sp_club_get_all_count).
        // Switched 2026-07-03 to add IsSyncedFromRotaryOrg to the listing —
        // the old SPs are owned by a SYSTEM_USER MySQL account and can't be
        // replaced with the current admin_mysql_db user (per the
        // "SYSTEM_USER Privilege Issue" note in project memory), so the
        // whole method moves to inline SQL to add the new column.
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var searchParam = string.IsNullOrWhiteSpace(search) ? null : search;
        var cityParam = string.IsNullOrWhiteSpace(city) ? null : city;
        var meetingDayParam = string.IsNullOrWhiteSpace(meetingDay) ? null : meetingDay;

        var whereSql = @"
            c.isdeleted = 0
              AND (@Search IS NULL
                   OR c.ClubName    LIKE CONCAT('%', @Search, '%')
                   OR c.ClubRotaryId LIKE CONCAT('%', @Search, '%')
                   OR c.City        LIKE CONCAT('%', @Search, '%')
                   OR c.State       LIKE CONCAT('%', @Search, '%'))
              AND (@DistrictId IS NULL OR c.fk_district_id = @DistrictId)
              AND (@City IS NULL OR c.City = @City)
              AND (@MeetingDay IS NULL OR c.MeetingDay = @MeetingDay)
              AND (@IsActive IS NULL OR c.IsActive = @IsActive)
              AND (@ZoneId IS NULL OR d.fk_zone_id = @ZoneId)";
        // user 2026-10-08: Rotaract clubs hidden from everyone except SuperAdmin.
        if (excludeRotaract) whereSql += " AND " + ClubScopeSql.NotRotaract("c");

        var countSql = $@"
            SELECT COUNT(*)
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE {whereSql}";

        var totalCount = await connection.ExecuteScalarAsync<int>(countSql,
            new {
                Search = searchParam,
                DistrictId = districtId,
                City = cityParam,
                MeetingDay = meetingDayParam,
                IsActive = isActive,
                ZoneId = zoneId
            });

        var offset = (page - 1) * pageSize;

        var dataSql = $@"
            SELECT c.pk_club_id AS Id, c.fk_district_id AS FkDistrictId,
                   d.DistrictNumber AS DistrictNumber,
                   c.ClubRotaryId AS ClubRotaryId, c.ClubName AS ClubName,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS ClubLogoPath,
                   c.MeetingDay AS MeetingDay,
                   c.MeetingFromTime AS MeetingFromTime,
                   c.MeetingToTime AS MeetingToTime,
                   c.City AS City, c.State AS State,
                   c.IsActive AS IsActive,
                   c.created_date AS CreatedDate,
                   COALESCE(c.IsSyncedFromRotaryOrg, 0) AS IsSyncedFromRotaryOrg,
                   -- Club website: latest active row (per fk_club_id) is
                   -- attached below. If none, all cw.* fields come back
                   -- NULL and the frontend renders 'No'.
                   cw.Subdomain      AS WebsiteSubdomain,
                   cw.ClientDomain   AS WebsiteClientDomain,
                   cw.EndDate        AS WebsiteEndDate,
                   cw.Status         AS WebsiteStatus,
                   (SELECT COUNT(*) FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                      AND cm.IsHonoraryMember = 0) AS TotalMembers,
                   (SELECT COUNT(*) FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                      AND cm.IsHonoraryMember = 1) AS HonoraryMembers
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN club_websites cw
                ON cw.fk_club_id = c.pk_club_id
               AND cw.isdeleted = 0
               AND cw.pk_id = (
                   SELECT MAX(cw2.pk_id) FROM club_websites cw2
                   WHERE cw2.fk_club_id = c.pk_club_id AND cw2.isdeleted = 0
               )
            WHERE {whereSql}
            ORDER BY c.ClubName
            LIMIT @PageSize OFFSET @Offset";

        var items = (await connection.QueryAsync<ClubListDto>(dataSql,
            new {
                Search = searchParam,
                DistrictId = districtId,
                City = cityParam,
                MeetingDay = meetingDayParam,
                IsActive = isActive,
                ZoneId = zoneId,
                PageSize = pageSize,
                Offset = offset
            })).ToList();

        return new PagedResult<ClubListDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<ClubDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inline SQL so new columns (Latitude/Longitude) are returned without needing to update the SP.
        return await connection.QueryFirstOrDefaultAsync<ClubDetailDto>(@"
            SELECT c.pk_club_id AS Id, c.fk_district_id AS FkDistrictId,
                   d.DistrictNumber AS DistrictNumber, d.Country AS DistrictCountry, d.DefaultCurrency AS DistrictDefaultCurrency,
                   c.ClubRotaryId AS ClubRotaryId, c.ClubName AS ClubName,
                   c.Timezone AS Timezone, c.ClubCharterDate AS ClubCharterDate,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS ClubLogoPath, c.ClubWebsite AS ClubWebsite,
                   c.MeetingDay AS MeetingDay, c.MeetingFromTime AS MeetingFromTime,
                   c.MeetingToTime AS MeetingToTime, c.MeetingAddress AS MeetingAddress,
                   c.Country AS Country, c.State AS State, c.City AS City, c.Pincode AS Pincode,
                   c.Latitude AS Latitude, c.Longitude AS Longitude,
                   c.ActiveFromDate AS ActiveFromDate, c.ActiveToDate AS ActiveToDate,
                   c.IsAutomaticMeetingReminder AS IsAutomaticMeetingReminder,
                   c.IsFamilyLogin AS IsFamilyLogin, c.IsActive AS IsActive,
                   c.created_by AS CreatedBy, c.created_date AS CreatedDate,
                   c.modified_by AS ModifiedBy, c.modified_date AS ModifiedDate,
                   (SELECT COUNT(*) FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                      AND cm.IsHonoraryMember = 0) AS TotalMembers,
                   (SELECT COUNT(*) FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                      AND cm.IsHonoraryMember = 1) AS HonoraryMembers
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateAsync(CreateClubDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check duplicate
        var dup = await connection.QueryFirstAsync<dynamic>(
            "sp_club_check_duplicate",
            new { p_ClubName = dto.ClubName.Trim(), p_ClubRotaryId = dto.ClubRotaryId.Trim(), p_ExcludeId = (int?)null },
            commandType: CommandType.StoredProcedure);

        if ((int)dup.NameDuplicate > 0)
            throw new InvalidOperationException("A club with this name already exists.");
        if ((int)dup.RotaryIdDuplicate > 0)
            throw new InvalidOperationException("A club with this Rotary ID already exists.");

        // Inline SQL (bypassing sp_club_create) so new columns Latitude/Longitude persist without SP update.
        var clubId = await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO club_master (
                fk_district_id, ClubRotaryId, ClubName, Timezone, ClubCharterDate,
                ClubLogoPath, ClubWebsite, MeetingDay, MeetingFromTime, MeetingToTime,
                MeetingAddress, Country, State, City, Pincode,
                Latitude, Longitude,
                ActiveFromDate, ActiveToDate, IsAutomaticMeetingReminder, IsFamilyLogin,
                IsActive, created_by, created_date
            ) VALUES (
                @FkDistrictId, @ClubRotaryId, @ClubName, @Timezone, @ClubCharterDate,
                @ClubLogoPath, @ClubWebsite, @MeetingDay, @MeetingFromTime, @MeetingToTime,
                @MeetingAddress, @Country, @State, @City, @Pincode,
                @Latitude, @Longitude,
                @ActiveFromDate, @ActiveToDate, @IsAutomaticMeetingReminder, @IsFamilyLogin,
                @IsActive, @CreatedBy, NOW()
            );
            SELECT LAST_INSERT_ID();",
            new {
                FkDistrictId = dto.FkDistrictId,
                ClubRotaryId = dto.ClubRotaryId.Trim(),
                ClubName = dto.ClubName.Trim(),
                Timezone = dto.Timezone,
                ClubCharterDate = dto.ClubCharterDate,
                ClubLogoPath = dto.ClubLogoPath,
                ClubWebsite = dto.ClubWebsite,
                MeetingDay = dto.MeetingDay,
                MeetingFromTime = dto.MeetingFromTime,
                MeetingToTime = dto.MeetingToTime,
                MeetingAddress = dto.MeetingAddress,
                Country = dto.Country,
                State = dto.State,
                City = dto.City,
                Pincode = dto.Pincode,
                Latitude = dto.Latitude,
                Longitude = dto.Longitude,
                ActiveFromDate = dto.ActiveFromDate,
                ActiveToDate = dto.ActiveToDate,
                IsAutomaticMeetingReminder = dto.IsAutomaticMeetingReminder ? 1 : 0,
                IsFamilyLogin = dto.IsFamilyLogin ? 1 : 0,
                IsActive = dto.IsActive ? 1 : 0,
                CreatedBy = createdBy
            });

        // Auto-assign default modules to new club
        await connection.ExecuteAsync(
            "sp_club_modules_assign_defaults",
            new { p_ClubId = clubId, p_AssignedBy = createdBy },
            commandType: CommandType.StoredProcedure);

        return clubId;
    }

    public async Task UpdateAsync(int id, UpdateClubDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check duplicate
        var dup = await connection.QueryFirstAsync<dynamic>(
            "sp_club_check_duplicate",
            new { p_ClubName = dto.ClubName.Trim(), p_ClubRotaryId = dto.ClubRotaryId.Trim(), p_ExcludeId = id },
            commandType: CommandType.StoredProcedure);

        if ((int)dup.NameDuplicate > 0)
            throw new InvalidOperationException("A club with this name already exists.");
        if ((int)dup.RotaryIdDuplicate > 0)
            throw new InvalidOperationException("A club with this Rotary ID already exists.");

        var previousDistrictId = await connection.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", new { Id = id });

        // Inline SQL (bypassing sp_club_update) so new columns Latitude/Longitude persist without SP update.
        await connection.ExecuteAsync(@"
            UPDATE club_master SET
                fk_district_id = @FkDistrictId,
                ClubRotaryId = @ClubRotaryId,
                ClubName = @ClubName,
                Timezone = @Timezone,
                ClubCharterDate = @ClubCharterDate,
                ClubLogoPath = @ClubLogoPath,
                ClubWebsite = @ClubWebsite,
                MeetingDay = @MeetingDay,
                MeetingFromTime = @MeetingFromTime,
                MeetingToTime = @MeetingToTime,
                MeetingAddress = @MeetingAddress,
                Country = @Country,
                State = @State,
                City = @City,
                Pincode = @Pincode,
                Latitude = @Latitude,
                Longitude = @Longitude,
                ActiveFromDate = @ActiveFromDate,
                ActiveToDate = @ActiveToDate,
                IsAutomaticMeetingReminder = @IsAutomaticMeetingReminder,
                IsFamilyLogin = @IsFamilyLogin,
                IsActive = @IsActive,
                modified_by = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_club_id = @Id AND isdeleted = 0",
            new {
                Id = id,
                FkDistrictId = dto.FkDistrictId,
                ClubRotaryId = dto.ClubRotaryId.Trim(),
                ClubName = dto.ClubName.Trim(),
                Timezone = dto.Timezone,
                ClubCharterDate = dto.ClubCharterDate,
                ClubLogoPath = dto.ClubLogoPath,
                ClubWebsite = dto.ClubWebsite,
                MeetingDay = dto.MeetingDay,
                MeetingFromTime = dto.MeetingFromTime,
                MeetingToTime = dto.MeetingToTime,
                MeetingAddress = dto.MeetingAddress,
                Country = dto.Country,
                State = dto.State,
                City = dto.City,
                Pincode = dto.Pincode,
                Latitude = dto.Latitude,
                Longitude = dto.Longitude,
                ActiveFromDate = dto.ActiveFromDate,
                ActiveToDate = dto.ActiveToDate,
                IsAutomaticMeetingReminder = dto.IsAutomaticMeetingReminder ? 1 : 0,
                IsFamilyLogin = dto.IsFamilyLogin ? 1 : 0,
                IsActive = dto.IsActive ? 1 : 0,
                ModifiedBy = modifiedBy
            });

        // Club moved to another district: its Club Presidents / Secretaries (every year) leave the old
        // district's DC auto-groups and join the new district's. Manual DC groups are untouched.
        if (previousDistrictId.HasValue && previousDistrictId.Value != dto.FkDistrictId)
        {
            try
            {
                await connection.ExecuteAsync(@"
                    UPDATE district_committee_group_member m
                    JOIN district_committee_group g ON g.id = m.fk_group_id
                    SET m.isdeleted = 1, m.modified_by = @By, m.modified_date = NOW()
                    WHERE m.fk_club_id = @Id AND m.isdeleted = 0 AND g.fk_district_id <> @NewDistrictId
                      AND g.isdeleted = 0
                      AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
                        OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')",
                    new { Id = id, By = modifiedBy, NewDistrictId = dto.FkDistrictId });

                var holders = await connection.QueryAsync<(int memberId, int designationId, int yearId)>(@"
                    SELECT b.fk_member_master_profile_id, b.fk_designation_id, b.fk_year_id
                    FROM board_of_directors b
                    JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                    WHERE b.fk_club_id = @Id AND b.isdeleted = 0 AND b.fk_member_master_profile_id IS NOT NULL
                      AND d.designation_name IN ('Club President', 'Club Secretary')",
                    new { Id = id });
                foreach (var h in holders)
                    await _dcAutoGroups.OnBodAddedOrUpdatedAsync(connection, null, id, h.memberId, h.designationId, h.yearId, modifiedBy);
            }
            catch (Exception ex)
            {
                // The nightly --dc-cpcs-reconcile fixes anything left over.
                _logger.LogError(ex, "DC CP/CS move failed for club {ClubId} (district {Old} -> {New})", id, previousDistrictId, dto.FkDistrictId);
            }
        }

        // Auto-assign any new default modules
        await connection.ExecuteAsync(
            "sp_club_modules_assign_defaults",
            new { p_ClubId = id, p_AssignedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            "sp_club_soft_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);

        // A deleted club can't have a Club President / Secretary in the DC auto-groups (every year).
        // Manual DC groups are untouched.
        await connection.ExecuteAsync(@"
            UPDATE district_committee_group_member m
            JOIN district_committee_group g ON g.id = m.fk_group_id
            SET m.isdeleted = 1, m.modified_by = @By, m.modified_date = NOW()
            WHERE m.fk_club_id = @Id AND m.isdeleted = 0 AND g.isdeleted = 0
              AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
                OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')",
            new { Id = id, By = deletedBy });

        // Hard-delete club_modules for this club (table has no isdeleted column).
        // Module assignments are derivable from module_master.IsDefaultForClub flags — no audit value lost.
        // If the club is later reinstated, default modules are re-assigned via sp_club_modules_assign_defaults.
        await connection.ExecuteAsync(
            "DELETE FROM club_modules WHERE fk_club_id = @Id",
            new { Id = id });
    }

    public async Task<PagedResult<ClubMemberDto>> GetMembersAsync(int clubId, int page, int pageSize, string? search, int? year = null,
        string? email = null, string? rotaryId = null, string? districtNumber = null, string? designation = null,
        string? classification = null, string? familyMemberName = null, int? viewerMemberId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Single-club scope: the viewer is a "MyClub" peer only if they hold an active
        // membership in THIS club; anyone else falls under the AllClubs flags.
        var viewerSharesClub = await MemberPrivacyHelper.ViewerSharesClubAsync(connection, viewerMemberId, clubId);

        var offset = (page - 1) * pageSize;

        // Trim whitespace — the mobile app was sending `test+` which decodes to
        // `test ` (trailing space) and never matched anything in the DB. Treat
        // empty-after-trim as "no search".
        var searchParam = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        var emailParam = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        var rotaryIdParam = string.IsNullOrWhiteSpace(rotaryId) ? null : rotaryId.Trim();
        var districtNumberParam = string.IsNullOrWhiteSpace(districtNumber) ? null : districtNumber.Trim();
        var designationParam = string.IsNullOrWhiteSpace(designation) ? null : designation.Trim();
        var classificationParam = string.IsNullOrWhiteSpace(classification) ? null : classification.Trim();
        var familyMemberNameParam = string.IsNullOrWhiteSpace(familyMemberName) ? null : familyMemberName.Trim();

        // First query the TRUE total for pagination — without it, TotalCount
        // was being set to items.Count (max = pageSize), so the frontend
        // always thought there was a single page and Pagination hid itself.
        // Filter matches the SELECT below: active, non-soft-deleted memberships
        // joined to a non-soft-deleted profile.
        //
        // The free-text @Search box matches Name + Mobile only — deliberately
        // narrow (see COG note below). Everything else (Email, RotaryId,
        // DistrictNumber, Designation, Classification, FamilyMemberName) is its
        // own dedicated parameter so each targets an exact field instead of a
        // fuzzy multi-column OR.
        //
        // COG (club 31598) special case: cm.Designation there is a free-text label like
        // "3142 Dg 2018 - 19" (district + year a member served as District Governor).
        // The old design folded Email/RotaryId/DistrictNumber/Designation/Classification/
        // FamilyName into the same @Search box as Name+Mobile, which repeatedly caused
        // false positives for COG — e.g. searching district "3142" matched a member whose
        // RotaryId ("314258") or mobile number happened to CONTAIN the digits "3142", even
        // though their actual designation was for a totally different district (3261).
        // Narrowing @Search to Name+Mobile (which rarely collide with a 4-digit district
        // guess) and moving the rest to explicit parameters removes the collision risk
        // entirely — each parameter now targets one specific column. DistrictNumber also
        // matches the leading digits of cm.Designation (COG's actual per-member district),
        // not just the club's own district_master row.
        //
        // YEAR EXTRACTION (fixed 2026-08): the old expression was
        // REGEXP_SUBSTR(cm.Designation, '[0-9]{4}'), whose FIRST 4-digit run in
        // "3292 Dg 2025 - 26" is the DISTRICT ("3292"), not the year — so the Year
        // filter/sort/dropdown were silently operating on district numbers. Correct
        // form strips the leading district token first, then takes the first 4-digit
        // run of the remainder ("2025"). Same expression is used by the filter, the
        // ORDER BY, the years dropdown and the CogYear projection.
        // The COG year filter compares numbers: a CHAR cast takes the connection's collation, which can clash with the
        // column's (MySQL 8 servers default to utf8mb4_0900_ai_ci; ROW tables are utf8mb4_unicode_ci) and fail the query.
        var totalCount = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1
              AND cm.isdeleted = 0
              AND m.isdeleted = 0
              AND (@Search IS NULL
                   OR m.MemberName LIKE CONCAT('%', @Search, '%')
                   OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%'))
              AND (@Email IS NULL OR m.EmailId LIKE CONCAT('%', @Email, '%'))
              AND (@RotaryId IS NULL OR m.RotaryId LIKE CONCAT('%', @RotaryId, '%'))
              AND (@DistrictNumber IS NULL
                   OR d.DistrictNumber LIKE CONCAT('%', @DistrictNumber, '%')
                   OR cm.Designation LIKE CONCAT(@DistrictNumber, ' %'))
              AND (@Designation IS NULL OR cm.Designation LIKE CONCAT('%', @Designation, '%'))
              AND (@Classification IS NULL OR cm.ClassificationProfession LIKE CONCAT('%', @Classification, '%'))
              AND (@FamilyMemberName IS NULL OR EXISTS (
                       SELECT 1 FROM member_family_details fd
                       WHERE fd.fk_member_master_profile_id = m.pk_member_master_profile_id
                         AND fd.isdeleted = 0
                         AND fd.Name LIKE CONCAT('%', @FamilyMemberName, '%')
                   ))
              AND (@Year IS NULL OR @ClubId <> " + CogDesignationHelper.CogClubId + @"
                   OR CAST(" + CogDesignationHelper.YearStartSql("cm") + @" AS SIGNED) = @Year)",
            new
            {
                ClubId = clubId, Search = searchParam, Year = year,
                Email = emailParam, RotaryId = rotaryIdParam, DistrictNumber = districtNumberParam,
                Designation = designationParam, Classification = classificationParam, FamilyMemberName = familyMemberNameParam
            });

        var rawItems = await connection.QueryAsync<dynamic>(@"
            SELECT
                m.pk_member_master_profile_id AS Id,
                m.MemberName,
                CASE
                    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                END AS ProfilePhotoPath,
                m.EmailId,
                m.PrimaryMobileNumber,
                m.ShowPhoneInMyClub,
                m.ShowPhoneInAllClubs,
                m.ShowEmailInMyClub,
                m.ShowEmailInAllClubs,
                m.RotaryId,
                cm.JoinedDate,
                cm.pk_club_member_id AS ClubMemberId,
                cm.IsActive AS MembershipActive,
                cm.IsHonoraryMember AS IsHonorary,
                GROUP_CONCAT(DISTINCT
                    CASE
                        WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                        WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin'
                        ELSE r.RoleName
                    END
                    ORDER BY 1 SEPARATOR ',') AS RoleNames,
                MAX(CASE WHEN r.RoleName = 'Admin' AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 THEN 1 ELSE 0 END) AS HasAdminRole,
                /* COG (club 31598) only: surface each member's designation (past-DG label held in
                   club_members.Designation). Gated on @ClubId, so every other club returns NULL as before. */
                MAX(CASE WHEN @ClubId = " + CogDesignationHelper.CogClubId + @" THEN cm.Designation END) AS Designation,
                /* COG only: the same label split into its two structured parts so the mobile app
                   can render 'District 3292' + '2025-26' instead of the raw free-text string. */
                MAX(CASE WHEN @ClubId = " + CogDesignationHelper.CogClubId + @" THEN " + CogDesignationHelper.DistrictSql("cm") + @" END) AS CogDistrictNumber,
                MAX(CASE WHEN @ClubId = " + CogDesignationHelper.CogClubId + @" THEN " + CogDesignationHelper.YearStartSql("cm") + @" END) AS CogYearStart
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN member_roles mr
                ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND mr.IsActive = 1
                AND mr.isdeleted = 0
                AND (
                    /* Club Admin tied to THIS club */
                    (mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId)
                    /* District Admin of THIS clubs parent district — DB stores fk_club_id=0 (not NULL) */
                    OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                        AND mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId))
                    /* Any non-Admin role (Member, AG, SuperAdmin) */
                    OR mr.fk_role_id != 2
                )
            LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1
              AND cm.isdeleted = 0
              AND m.isdeleted = 0
              AND (@Search IS NULL
                   OR m.MemberName LIKE CONCAT('%', @Search, '%')
                   OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%'))
              AND (@Email IS NULL OR m.EmailId LIKE CONCAT('%', @Email, '%'))
              AND (@RotaryId IS NULL OR m.RotaryId LIKE CONCAT('%', @RotaryId, '%'))
              AND (@DistrictNumber IS NULL
                   OR d.DistrictNumber LIKE CONCAT('%', @DistrictNumber, '%')
                   OR cm.Designation LIKE CONCAT(@DistrictNumber, ' %'))
              AND (@Designation IS NULL OR cm.Designation LIKE CONCAT('%', @Designation, '%'))
              AND (@Classification IS NULL OR cm.ClassificationProfession LIKE CONCAT('%', @Classification, '%'))
              AND (@FamilyMemberName IS NULL OR EXISTS (
                       SELECT 1 FROM member_family_details fd
                       WHERE fd.fk_member_master_profile_id = m.pk_member_master_profile_id
                         AND fd.isdeleted = 0
                         AND fd.Name LIKE CONCAT('%', @FamilyMemberName, '%')
                   ))
              AND (@Year IS NULL OR @ClubId <> " + CogDesignationHelper.CogClubId + @"
                   OR CAST(" + CogDesignationHelper.YearStartSql("cm") + @" AS SIGNED) = @Year)
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath,
                     m.EmailId, m.PrimaryMobileNumber, m.RotaryId,
                     m.ShowPhoneInMyClub, m.ShowPhoneInAllClubs,
                     m.ShowEmailInMyClub, m.ShowEmailInAllClubs,
                     cm.JoinedDate, cm.pk_club_member_id, cm.IsActive, cm.IsHonoraryMember
            ORDER BY
                CASE
                    WHEN @ClubId = " + CogDesignationHelper.CogClubId + @" THEN 0
                    WHEN MAX(CASE WHEN r.RoleName = 'Admin' THEN 1 ELSE 0 END) = 1 THEN 0
                    WHEN m.PrimaryMobileNumber IS NULL OR m.PrimaryMobileNumber = '' THEN 1
                    ELSE 2
                END,
                -- COG (club 31598): most recent designation year first (e.g. 3142 Dg 2018 - 19
                -- extracts 2018). Extracted from the free-text label since there's no structured
                -- year column; NULL/unparseable designations sort last, not first.
                CASE WHEN @ClubId = " + CogDesignationHelper.CogClubId + @"
                     THEN COALESCE(-CAST(MAX(" + CogDesignationHelper.YearStartSql("cm") + @") AS SIGNED), 999999)
                     ELSE 0
                END,
                m.MemberName
            LIMIT @PageSize OFFSET @Offset",
            new
            {
                ClubId = clubId, Search = searchParam, Year = year, PageSize = pageSize, Offset = offset,
                Email = emailParam, RotaryId = rotaryIdParam, DistrictNumber = districtNumberParam,
                Designation = designationParam, Classification = classificationParam, FamilyMemberName = familyMemberNameParam
            });

        var items = rawItems.Select(row =>
        {
            var dict = (IDictionary<string, object>)row;
            int rowMemberId = Convert.ToInt32(row.Id);
            bool showPhone = MemberPrivacyHelper.ShouldShowPhone(viewerMemberId, rowMemberId, viewerSharesClub,
                (object?)row.ShowPhoneInMyClub, (object?)row.ShowPhoneInAllClubs);
            bool showEmail = MemberPrivacyHelper.ShouldShowEmail(viewerMemberId, rowMemberId, viewerSharesClub,
                (object?)row.ShowEmailInMyClub, (object?)row.ShowEmailInAllClubs);
            return new ClubMemberDto
            {
                Id = rowMemberId,
                MemberName = row.MemberName ?? "",
                ProfilePhotoPath = (string?)row.ProfilePhotoPath,
                EmailId = showEmail ? (string?)row.EmailId : null,
                PrimaryMobileNumber = showPhone ? (string?)row.PrimaryMobileNumber : null,
                RotaryId = (string?)row.RotaryId,
                // COG (club 31598) has no meaningful admission/joining date — it's a
                // roster of past District Governors, not a club anyone "joins", and
                // only 1,433 of its 1,816 rows even carry a JoinedDate. Suppressed
                // from the response so neither the web listing nor the mobile app
                // shows it; the DB column is untouched (every other club, and every
                // report that reads cm.JoinedDate directly, is unaffected).
                JoinedDate = CogDesignationHelper.IsCog(clubId) ? null : (DateTime?)row.JoinedDate,
                ClubMemberId = Convert.ToInt32(row.ClubMemberId),
                MembershipActive = Convert.ToBoolean(row.MembershipActive),
                IsHonorary = row.IsHonorary != null && Convert.ToBoolean(row.IsHonorary),
                Roles = dict.ContainsKey("RoleNames") && !string.IsNullOrEmpty((string?)row.RoleNames)
                    ? ((string)row.RoleNames).Split(',').ToList()
                    : new List<string>(),
                HasAdminRole = dict.ContainsKey("HasAdminRole") && Convert.ToInt64(row.HasAdminRole ?? 0) == 1,
                Designation = dict.ContainsKey("Designation") ? (string?)row.Designation : null,
                CogDistrictNumber = dict.ContainsKey("CogDistrictNumber") ? (string?)row.CogDistrictNumber : null,
                CogYear = CogDesignationHelper.ToRotaryYearLabel(dict.ContainsKey("CogYearStart") ? (string?)row.CogYearStart : null)
            };
        }).ToList();

        // Club-level roster split (whole club, independent of search/pagination):
        // regular (non-honorary) vs honorary. memberCount = activeRoster - honorary.
        var honoraryCount = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
              AND COALESCE(cm.IsHonoraryMember, 0) = 1",
            new { ClubId = clubId });
        var activeRoster = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0",
            new { ClubId = clubId });

        return new PagedResult<ClubMemberDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            HonoraryCount = honoraryCount,
            MemberCount = activeRoster - honoraryCount
        };
    }

    // Distinct years available for the Year filter on GetMembersAsync — pulled
    // from the free-text designation label (e.g. "3142 Dg 2018 - 19" -> 2018).
    // Only meaningful for COG (club 31598); other clubs simply return an empty
    // list since their Designation isn't year-structured.
    // Fixed 2026-08: the leading district token is stripped before the 4-digit
    // match, otherwise this returned the DISTRICT NUMBERS (3292, 3291, …) as
    // "years" — see the YEAR EXTRACTION note in GetMembersAsync.
    public async Task<List<int>> GetMemberDesignationYearsAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var years = await connection.QueryAsync<int>(@"
            SELECT DISTINCT CAST(" + CogDesignationHelper.YearStartSql("cm") + @" AS SIGNED) AS Year
            FROM club_members cm
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1
              AND cm.isdeleted = 0
              AND cm.Designation IS NOT NULL
              AND " + CogDesignationHelper.YearStartSql("cm") + @" IS NOT NULL
            ORDER BY Year DESC",
            new { ClubId = clubId });
        return years.ToList();
    }


    // Read one member's COG designation already split into district + Rotary year.
    // Scoped to the COG membership row so a member who ALSO belongs to a real club
    // never picks up that club's designation (the member-level MAX(Designation) that
    // MemberService uses would).
    public async Task<(string? DistrictNumber, string? YearLabel)> GetCogDesignationAsync(int clubId, int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT " + CogDesignationHelper.DistrictSql("cm") + @" AS DistrictNumber,
                   " + CogDesignationHelper.YearStartSql("cm") + @" AS YearStart
            FROM club_members cm
            WHERE cm.fk_club_id = @ClubId
              AND cm.fk_member_master_profile_id = @MemberId
              AND COALESCE(cm.isdeleted, 0) = 0
            LIMIT 1",
            new { ClubId = clubId, MemberId = memberId });
        if (row == null) return (null, null);
        return ((string?)row.DistrictNumber, CogDesignationHelper.ToRotaryYearLabel((string?)row.YearStart));
    }

    // SuperAdmin-only, COG-only: rewrite one member's COG designation from a
    // district number + a Rotary-year label. Scoped to the single club_members
    // row for @ClubId — deliberately NOT the member-wide
    // MemberService.UpdateMemberDesignationAcrossClubsAsync path, because 840 of
    // COG's 1,108 active members also belong to a real club whose own
    // Designation must not be overwritten with a past-DG label.
    // Stored in the canonical "NNNN Dg YYYY - YY" shape already used by 793 of
    // the 1,097 populated COG rows, so no new column (and no prod DDL) is needed
    // and every existing filter/sort keeps working.
    public async Task<bool> UpdateCogDesignationAsync(int clubId, int memberId, string districtNumber, string yearLabel, int modifiedBy)
    {
        var designation = CogDesignationHelper.Compose(districtNumber, yearLabel);

        using var connection = CreateConnection();
        await connection.OpenAsync();
        var rows = await connection.ExecuteAsync(@"
            UPDATE club_members
            SET Designation = @Designation, modified_by = @ModifiedBy, modified_date = NOW()
            WHERE fk_club_id = @ClubId
              AND fk_member_master_profile_id = @MemberId
              AND COALESCE(isdeleted, 0) = 0",
            new { ClubId = clubId, MemberId = memberId, Designation = designation, ModifiedBy = modifiedBy });
        return rows > 0;
    }

    public async Task<int> AddMemberAsync(int clubId, AddClubMemberDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        using var tx = await connection.BeginTransactionAsync();

        // Inline SQL replaces sp_club_add_member. Handles three cases:
        //   1. Active row exists → already in club, throw.
        //   2. Soft-deleted row exists → re-activate (UPDATE isdeleted=0). Avoids unique-key duplicate
        //      since the (fk_club_id, fk_member_master_profile_id) row is already there.
        //   3. No row exists → INSERT.
        // Also re-activates member_master_profile if it was soft-deleted (e.g., this was their last club
        // before, now they're re-joining — need to re-enable login).

        var existing = await connection.QueryFirstOrDefaultAsync<(int pk_id, int isdeleted)>(@"
            SELECT pk_club_member_id AS pk_id, isdeleted
            FROM club_members
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
            ORDER BY pk_club_member_id DESC LIMIT 1",
            new { ClubId = clubId, MemberId = dto.MemberId }, transaction: tx);

        int clubMemberId;
        if (existing.pk_id == 0)
        {
            // No row at all — fresh INSERT
            clubMemberId = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_by, created_date, isdeleted)
                VALUES (@ClubId, @MemberId, @JoinedDate, 1, @CreatedBy, NOW(), 0);
                SELECT LAST_INSERT_ID();",
                new { ClubId = clubId, MemberId = dto.MemberId, JoinedDate = dto.JoinedDate, CreatedBy = createdBy }, transaction: tx);
        }
        else if (existing.isdeleted == 0)
        {
            await tx.RollbackAsync();
            throw new InvalidOperationException("Member is already in this club.");
        }
        else
        {
            // Re-activate soft-deleted membership
            await connection.ExecuteAsync(@"
                UPDATE club_members
                SET isdeleted = 0, IsActive = 1, JoinedDate = @JoinedDate,
                    deleted_by = NULL, deleted_date = NULL,
                    modified_by = @CreatedBy, modified_date = NOW()
                WHERE pk_club_member_id = @Id",
                new { Id = existing.pk_id, JoinedDate = dto.JoinedDate, CreatedBy = createdBy }, transaction: tx);
            clubMemberId = existing.pk_id;
        }

        // Re-activate the member's profile if it was previously soft-deleted (e.g., re-joining after full removal)
        await connection.ExecuteAsync(@"
            UPDATE member_master_profile
            SET isdeleted = 0, deleted_by = NULL, deleted_date = NULL,
                modified_by = @CreatedBy, modified_date = NOW()
            WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 1",
            new { MemberId = dto.MemberId, CreatedBy = createdBy }, transaction: tx);

        // Re-joining member: restore the address + family rows soft-deleted at their last-club removal
        // (they were soft-deleted on removal; the person is the same, so bring their data back).
        await connection.ExecuteAsync(@"
            UPDATE member_address_details SET isdeleted = 0, modified_date = NOW()
            WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 1",
            new { MemberId = dto.MemberId }, transaction: tx);
        // Restore ONLY the batch soft-deleted at the last removal (one UPDATE, so one modified_date),
        // and only when the member has no live family rows. Restoring every isdeleted=1 row brought
        // back each old copy left by past saves and people the admin had removed - one member
        // reached 215 rows for 16 people (2026-10-06).
        await connection.ExecuteAsync(@"
            UPDATE member_family_details f
            JOIN (SELECT MAX(modified_date) AS last_del FROM member_family_details
                  WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 1) b
              ON f.modified_date = b.last_del
            SET f.isdeleted = 0, f.modified_date = NOW()
            WHERE f.fk_member_master_profile_id = @MemberId AND f.isdeleted = 1
              AND NOT EXISTS (SELECT 1 FROM (SELECT fk_member_master_profile_id FROM member_family_details
                              WHERE fk_member_master_profile_id = @MemberId AND COALESCE(isdeleted, 0) = 0) live)",
            new { MemberId = dto.MemberId }, transaction: tx);

        await tx.CommitAsync();

        // Send welcome email (fire-and-forget). Includes club + district + zone + CC to club admin / president / secretary.
        _ = Task.Run(async () => await SendClubMembershipEmailAsync(clubId, dto.MemberId, isRemove: false));

        return clubMemberId;
    }

    public async Task RemoveMemberAsync(int clubId, int memberId, int deletedBy, string? terminationReason = null, string? terminationReasonCode = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        using var tx = await connection.BeginTransactionAsync();

        // Check if this is the member's only active club (BEFORE soft-deleting club_members)
        var otherActiveClubs = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_club_id <> @ClubId
              AND isdeleted = 0",
            new { MemberId = memberId, ClubId = clubId }, transaction: tx);

        bool isLastClub = otherActiveClubs == 0;

        // 1. Soft-delete club_members for THIS club — also stamp TerminationDate/TerminationReason
        // (previously only the Rotary.org sync path did this; a manual club-admin removal left both
        // blank, so the Rotary Network "Terminated Members" list showed no reason for manual removals).
        var reason = string.IsNullOrWhiteSpace(terminationReason) ? "Removed by club admin" : terminationReason.Trim();
        await connection.ExecuteAsync(@"
            UPDATE club_members
            SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW(),
                TerminationDate = CURDATE(), TerminationReason = @Reason, termination_reason_code = NULLIF(@Code, '')
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { ClubId = clubId, MemberId = memberId, DeletedBy = deletedBy, Reason = reason, Code = terminationReasonCode }, transaction: tx);

        // 2. Soft-delete member_roles for THIS club (Admin, AG, Member etc. that are tied to this club)
        await connection.ExecuteAsync(@"
            UPDATE member_roles
            SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), RevokedBy = @DeletedBy, modified_by = @DeletedBy, modified_date = NOW()
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { ClubId = clubId, MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

        // 3. Soft-delete board_of_directors for THIS club
        await connection.ExecuteAsync(@"
            UPDATE board_of_directors
            SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { ClubId = clubId, MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

        // 3b. Soft-delete District Committee (level-1) entries that reference THIS club. Group and
        // sub-group rows were already removed here; level-1 was missed, so a removed member stayed
        // on the District Committee list.
        await connection.ExecuteAsync(@"
            UPDATE district_committee_member
            SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
            WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
            new { ClubId = clubId, MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

        // 4. Soft-delete district_committee_group_member entries that reference THIS club
        await connection.ExecuteAsync(@"
            UPDATE district_committee_group_member
            SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
            WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
            new { ClubId = clubId, MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

        // 5. Soft-delete district_committee_sub_group_member entries that reference THIS club
        await connection.ExecuteAsync(@"
            UPDATE district_committee_sub_group_member
            SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
            WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
            new { ClubId = clubId, MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

        // 5a. Soft-delete legacy district_ag (AG assignments) for THIS club.
        // RoleService.CheckRoleConflict reads this table, so leftover active rows block future role assignments.
        await connection.ExecuteAsync(@"
            UPDATE district_ag
            SET isdeleted = 1, is_active = 0, modified_by = @DeletedBy, modified_date = NOW()
            WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
            new { ClubId = clubId, MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

        if (isLastClub)
        {
            // NOTE: member_master_profile is intentionally NOT soft-deleted on member removal.
            // The person record (and its UNIQUE RotaryId) must survive so Family Login keeps working
            // and the member can be re-added / re-synced later. "Not accessible after removal" is
            // enforced by login guards, not by disabling the profile:
            //   • Web  (AuthService): login requires an active Admin/SuperAdmin/AG
            //     role — all of which are revoked below, so a removed member is denied.
            //   • Mobile (MobileAuthService): NonSyncLoginGuardHelper denies login when the member has
            //     no active club_members row.
            // The removed member stays resurfaceable only in District Committee ("Add as non-member").

            // 7. Soft-delete remaining member_roles.
            //    Keep SuperAdmin (role_id=3) — it is portal-level and independent of club membership.
            await connection.ExecuteAsync(@"
                UPDATE member_roles
                SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), RevokedBy = @DeletedBy, modified_by = @DeletedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0
                  AND fk_role_id <> 3",
                new { MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

            // 8. Soft-delete any remaining BOD entries (other clubs — should be none since we checked for last club, but defensive)
            await connection.ExecuteAsync(@"
                UPDATE board_of_directors
                SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

            // 9a. Last club: no District Committee (level-1) membership survives either.
            await connection.ExecuteAsync(@"
                UPDATE district_committee_member
                SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
                WHERE fk_member_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

            // 9. Soft-delete any remaining DC group / sub-group memberships (defensive)
            await connection.ExecuteAsync(@"
                UPDATE district_committee_group_member
                SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
                WHERE fk_member_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

            await connection.ExecuteAsync(@"
                UPDATE district_committee_sub_group_member
                SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
                WHERE fk_member_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

            // 10. Soft-delete legacy district_ag for ALL clubs (defensive — last-club case)
            await connection.ExecuteAsync(@"
                UPDATE district_ag
                SET isdeleted = 1, is_active = 0, modified_by = @DeletedBy, modified_date = NOW()
                WHERE fk_member_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);

            // 12. Person-scoped cleanup (LAST club only): free the PRIMARY mobile (Primary -> Secondary)
            //     so the same person re-joining under a NEW RotaryId can claim it, and soft-delete
            //     address + family (un-deleted again on re-add). Profile row itself is NOT deleted.
            await connection.ExecuteAsync(@"
                UPDATE member_master_profile
                SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                                 THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                    PrimaryMobileNumber = NULL,
                    modified_by = @DeletedBy, modified_date = NOW()
                WHERE pk_member_master_profile_id = @MemberId
                  AND PrimaryMobileNumber IS NOT NULL",
                new { MemberId = memberId, DeletedBy = deletedBy }, transaction: tx);
            await connection.ExecuteAsync(@"
                UPDATE member_address_details SET isdeleted = 1, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId }, transaction: tx);
            await connection.ExecuteAsync(@"
                UPDATE member_family_details SET isdeleted = 1, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId }, transaction: tx);

            // member_credentials are intentionally NOT deleted on member removal.
            // Same member ID is reused on re-activation (FindSoftDeletedMatchAsync), so keeping the
            // credential row means the member can log in with their existing password as soon as
            // they're re-added — no need to set a new temporary password and re-distribute it.
            // Login is already blocked while removed (no active admin role for web, no active club for mobile).
        }

        await tx.CommitAsync();

        // Notify the removed member + CC club admin / president / secretary.
        _ = Task.Run(async () => await SendClubMembershipEmailAsync(clubId, memberId, isRemove: true));
    }

    public async Task<MemberRemovalPreviewDto?> GetMemberRemovalPreviewAsync(int clubId, int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_member_master_profile_id AS Id, MemberName, EmailId
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = memberId });
        if (member == null) return null;

        var clubName = await connection.ExecuteScalarAsync<string?>(@"
            SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0",
            new { Id = clubId }) ?? "";

        var otherClubs = (await connection.QueryAsync<OtherClubInfo>(@"
            SELECT cm.pk_club_id AS ClubId, cm.ClubName
            FROM club_members m
            JOIN club_master cm ON cm.pk_club_id = m.fk_club_id AND cm.isdeleted = 0
            WHERE m.fk_member_master_profile_id = @MemberId
              AND m.fk_club_id <> @ClubId
              AND m.IsActive = 1
              AND m.isdeleted = 0
            ORDER BY cm.ClubName",
            new { MemberId = memberId, ClubId = clubId })).ToList();

        var rolesInThisClub = (await connection.QueryAsync<string>(@"
            SELECT DISTINCT r.RoleName
            FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_club_id = @ClubId
              AND mr.isdeleted = 0
            ORDER BY r.RoleName",
            new { MemberId = memberId, ClubId = clubId })).ToList();

        var allRoles = (await connection.QueryAsync<string>(@"
            SELECT DISTINCT r.RoleName
            FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.isdeleted = 0
            ORDER BY r.RoleName",
            new { MemberId = memberId })).ToList();

        var bodEntries = (await connection.QueryAsync<BodEntry>(@"
            SELECT d.designation_name AS DesignationName,
                   y.YearLabel AS YearLabel
            FROM board_of_directors bod
            JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            WHERE bod.fk_club_id = @ClubId
              AND bod.fk_member_master_profile_id = @MemberId
              AND bod.isdeleted = 0
            ORDER BY y.YearLabel DESC, d.pk_designation_id",
            new { ClubId = clubId, MemberId = memberId })).ToList();

        var dcCommittee = (await connection.QueryAsync<DcCommitteeEntry>(@"
            SELECT IFNULL(dcm.district_designation, '') AS Designation,
                   IFNULL(y.YearLabel, '') AS YearLabel,
                   IFNULL(d.DistrictNumber, '') AS DistrictNumber
            FROM district_committee_member dcm
            LEFT JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
            LEFT JOIN district_master d ON d.pk_district_id = dcm.fk_district_id
            WHERE dcm.fk_club_id = @ClubId
              AND dcm.fk_member_id = @MemberId
              AND dcm.isdeleted = 0
            ORDER BY dcm.fk_year_id DESC",
            new { ClubId = clubId, MemberId = memberId })).ToList();

        var dcGroups = (await connection.QueryAsync<DcGroupEntry>(@"
            SELECT g.group_name AS GroupName,
                   IFNULL(d.DistrictNumber, '') AS DistrictNumber
            FROM district_committee_group_member gm
            JOIN district_committee_group g ON g.id = gm.fk_group_id
            LEFT JOIN district_master d ON d.pk_district_id = g.fk_district_id
            WHERE gm.fk_club_id = @ClubId
              AND gm.fk_member_id = @MemberId
              AND gm.isdeleted = 0
            ORDER BY g.group_name",
            new { ClubId = clubId, MemberId = memberId })).ToList();

        var subGroups = (await connection.QueryAsync<DcSubGroupEntry>(@"
            SELECT sg.sub_group_name AS SubGroupName,
                   IFNULL(d.DistrictNumber, '') AS DistrictNumber
            FROM district_committee_sub_group_member sgm
            JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id
            LEFT JOIN district_committee_group g ON g.id = sg.fk_group_id
            LEFT JOIN district_master d ON d.pk_district_id = g.fk_district_id
            WHERE sgm.fk_club_id = @ClubId
              AND sgm.fk_member_id = @MemberId
              AND sgm.isdeleted = 0
            ORDER BY sg.sub_group_name",
            new { ClubId = clubId, MemberId = memberId })).ToList();

        return new MemberRemovalPreviewDto
        {
            MemberId = memberId,
            MemberName = (string)(member.MemberName ?? ""),
            EmailId = (string?)member.EmailId,
            ClubId = clubId,
            ClubName = clubName,
            IsLastClub = otherClubs.Count == 0,
            OtherClubs = otherClubs,
            RolesInThisClub = rolesInThisClub,
            AllRoleNames = allRoles,
            BodEntries = bodEntries,
            DcCommitteeMemberships = dcCommittee,
            DcGroupMemberships = dcGroups,
            SubGroupMemberships = subGroups,
        };
    }

    // Shared helper — fires either the welcome (isRemove=false) or removed (isRemove=true) email.
    // Fetches club + district + zone + CC list (club admin role_id=2 + president designation_id=1 + secretary designation_id=4) in one call each.
    private async Task SendClubMembershipEmailAsync(int clubId, int memberId, bool isRemove)
    {
        try
        {
            using var conn = CreateConnection();
            await conn.OpenAsync();

            var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
                new { Id = memberId });
            if (member == null) return;
            var memberEmail = (string?)member.EmailId;
            if (string.IsNullOrWhiteSpace(memberEmail)) return;

            var club = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
                FROM club_master c
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
                new { Id = clubId });
            var clubName = (string?)club?.clubName ?? "Rotary Club";
            var districtNumber = (string?)club?.districtNumber;
            var zoneName = (string?)club?.zoneName;

            // CC list: current-year Club President (BOD designation=1) + Secretary (designation=4) only
            var ccRows = await conn.QueryAsync<string>(@"
                SELECT DISTINCT m.EmailId
                FROM board_of_directors bod
                JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
                WHERE bod.fk_club_id = @ClubId AND bod.fk_designation_id IN (1, 4) AND bod.isdeleted = 0
                  AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                new { ClubId = clubId });
            var ccList = ccRows.Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            if (isRemove)
            {
                var contextLine = BuildClubContext(clubName, districtNumber, zoneName);
                await _emailService.SendRoleOrMembershipRemovedEmailAsync(
                    memberEmail,
                    (string)member.MemberName,
                    $"membership of {clubName}",
                    contextLine,
                    ccList);
            }
            else
            {
                await _emailService.SendNewMemberWelcomeEmailAsync(
                    memberEmail,
                    (string)member.MemberName,
                    clubName,
                    districtNumber,
                    zoneName,
                    ccList);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send club membership email (isRemove={IsRemove}) for member {MemberId} club {ClubId}", isRemove, memberId, clubId);
        }
    }

    private static string BuildClubContext(string clubName, string? districtNumber, string? zoneName)
    {
        var parts = new List<string> { clubName };
        if (!string.IsNullOrWhiteSpace(districtNumber)) parts.Add($"District {districtNumber}");
        if (!string.IsNullOrWhiteSpace(zoneName)) parts.Add($"Zone {zoneName}");
        return string.Join(" — ", parts);
    }

    // Returns (clubLogoPath, rotaryLogoPath) raw filenames as stored on club_master.
    // RotaryLogoPath column added 2026-06-25 via manual ALTER — wraps SELECT in a
    // try/catch so older DBs that haven't run the migration still work (returns
    // null for the missing column).
    public async Task<(string? ClubLogo, string? RotaryLogo)> GetLogosAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        try
        {
            return await connection.QueryFirstOrDefaultAsync<(string?, string?)>(@"
                SELECT ClubLogoPath, RotaryLogoPath
                FROM club_master
                WHERE pk_club_id = @Id AND isdeleted = 0",
                new { Id = clubId });
        }
        catch (MySqlException)
        {
            // RotaryLogoPath column missing — fall back to club logo only
            var clubLogo = await connection.ExecuteScalarAsync<string?>(
                "SELECT ClubLogoPath FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0",
                new { Id = clubId });
            return (clubLogo, null);
        }
    }

    // Partial update — only writes the columns whose param is non-null. Pass an
    // empty string to CLEAR a logo. Audit columns updated alongside.
    public async Task SetLogosAsync(int clubId, string? clubLogoPath, string? rotaryLogoPath, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var setParts = new List<string>();
        var p = new DynamicParameters();
        p.Add("Id", clubId);
        p.Add("UserId", modifiedBy);

        if (clubLogoPath != null)
        {
            setParts.Add("ClubLogoPath = @ClubLogoPath");
            p.Add("ClubLogoPath", clubLogoPath);
        }
        if (rotaryLogoPath != null)
        {
            setParts.Add("RotaryLogoPath = @RotaryLogoPath");
            p.Add("RotaryLogoPath", rotaryLogoPath);
        }
        if (setParts.Count == 0) return;
        setParts.Add("modified_by = @UserId");
        setParts.Add("modified_date = NOW()");

        var sql = $"UPDATE club_master SET {string.Join(", ", setParts)} WHERE pk_club_id = @Id";
        await connection.ExecuteAsync(sql, p);
    }

    public async Task<string> UploadLogoAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "club");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed on SELECT via CONCAT('/uploads/club/', ClubLogoPath)
        return fileName;
    }

    // ── Website-data Logos (2026-06-25 per user) ──────────────────────────
    // Two different folder conventions to match the user's existing layout:
    //   • Club Logo   → shared    /Documents/group/<filename>
    //                   (matches legacy "club_logo113072018052617PM.png" path)
    //   • Rotary Logo → per-club  /Documents/WebsiteData/Group{clubId}/LOGO/<filename>
    //                   (matches the menu-document Group{clubId}/MENU/ pattern)
    // Both endpoints store filename only in club_master; URL gets reconstructed
    // via prefix lookup in ClubsController.BuildLogoUrl + the public /about endpoint.

    public async Task<string> UploadClubLogoToGroupAsync(IFormFile file)
    {
        // Shared "group" folder — same place legacy club logos live.
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "group");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"club_logo_{Guid.NewGuid():N}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return fileName;     // stored as-is in club_master.ClubLogoPath
    }

    public async Task<string> UploadRotaryLogoToGroupAsync(int clubId, IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "WebsiteData", $"Group{clubId}", "LOGO");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"UpperLogo_{Guid.NewGuid():N}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return fileName;     // stored as-is in club_master.RotaryLogoPath
    }

    public async Task<PagedResult<TerminatedMemberDto>> GetTerminatedMembersAsync(int clubId, int page, int pageSize, string? search)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var offset = (page - 1) * pageSize;

        using var multi = await connection.QueryMultipleAsync(
            "sp_club_terminated_members",
            new { p_ClubId = clubId, p_Search = string.IsNullOrWhiteSpace(search) ? null : search, p_PageSize = pageSize, p_Offset = offset },
            commandType: CommandType.StoredProcedure);

        var items = (await multi.ReadAsync<TerminatedMemberDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();

        return new PagedResult<TerminatedMemberDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }
}

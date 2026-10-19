using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class AttendanceService : IAttendanceService
{
    private readonly string _connectionString;
    private readonly ICitationRecalcTrigger _citationRecalc;

    public AttendanceService(IConfiguration configuration, ICitationRecalcTrigger citationRecalc)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _citationRecalc = citationRecalc;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Auto-creates the Rotary year row if missing — see RotaryYearHelper for details.
    private static Task<int> GetRotaryYearIdAsync(MySqlConnection connection, DateTime eventDate)
        => RotaryYearHelper.EnsureRotaryYearAsync(connection, eventDate);

    public async Task<(List<AttendanceListDto> Items, int TotalCount)> GetAllAsync(int clubId, int yearId, string search, int page, int pageSize)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var offset = (page - 1) * pageSize;
        var searchParam = $"%{search ?? ""}%";

        var sql = @"
            SELECT
                a.pk_attendance_id AS Id,
                a.fk_club_id AS ClubId,
                a.fk_year_id AS YearId,
                a.EventName,
                a.EventDateTime,
                a.MeetingMode,
                a.MeetingLink,
                (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS MembersCount,
                (SELECT COUNT(*) FROM club_attendance_anns n WHERE n.fk_attendance_id = a.pk_attendance_id) AS AnnsCount,
                (SELECT COUNT(*) FROM club_attendance_annets t WHERE t.fk_attendance_id = a.pk_attendance_id) AS AnnetsCount,
                (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS VisitorsCount,
                (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS RotariansCount,
                (SELECT COUNT(*) FROM club_attendance_delegates d WHERE d.fk_attendance_id = a.pk_attendance_id) AS DelegatesCount
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId
              AND a.isdeleted = 0
              AND (@YearId = 0 OR a.fk_year_id = @YearId)
              AND (@Search = '%%' OR a.EventName LIKE @Search)
            ORDER BY a.EventDateTime DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*)
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId
              AND a.isdeleted = 0
              AND (@YearId = 0 OR a.fk_year_id = @YearId)
              AND (@Search = '%%' OR a.EventName LIKE @Search);";

        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            ClubId = clubId,
            YearId = yearId,
            Search = searchParam,
            PageSize = pageSize,
            Offset = offset
        });

        var items = (await multi.ReadAsync<AttendanceListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<AttendanceDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var detail = await connection.QueryFirstOrDefaultAsync<AttendanceDetailDto>(
            @"SELECT
                pk_attendance_id AS Id,
                fk_club_id AS ClubId,
                fk_year_id AS YearId,
                EventName,
                Description,
                EventDateTime,
                MeetingMode,
                MeetingLink
              FROM club_attendance
              WHERE pk_attendance_id = @Id AND isdeleted = 0",
            new { Id = id });

        if (detail == null) return null;

        detail.Members = (await connection.QueryAsync<AttendanceMemberDto>(
            @"SELECT am.pk_id AS Id, am.fk_member_id AS MemberId, m.MemberName
              FROM club_attendance_members am
              INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = am.fk_member_id
              WHERE am.fk_attendance_id = @Id",
            new { Id = id })).ToList();

        detail.Anns = (await connection.QueryAsync<AttendanceAnnDto>(
            @"SELECT pk_id AS Id, AnnName FROM club_attendance_anns WHERE fk_attendance_id = @Id",
            new { Id = id })).ToList();

        detail.Annets = (await connection.QueryAsync<AttendanceAnnetDto>(
            @"SELECT pk_id AS Id, AnnetName FROM club_attendance_annets WHERE fk_attendance_id = @Id",
            new { Id = id })).ToList();

        detail.Visitors = (await connection.QueryAsync<AttendanceVisitorDto>(
            @"SELECT pk_id AS Id, VisitorName, InvitedBy FROM club_attendance_visitors WHERE fk_attendance_id = @Id",
            new { Id = id })).ToList();

        detail.Rotarians = (await connection.QueryAsync<AttendanceRotarianDto>(
            @"SELECT pk_id AS Id, RotarianName, ClubName FROM club_attendance_rotarians WHERE fk_attendance_id = @Id",
            new { Id = id })).ToList();

        detail.Delegates = (await connection.QueryAsync<AttendanceDelegateDto>(
            @"SELECT pk_id AS Id, RotarianName, DistrictDesignation, ClubName FROM club_attendance_delegates WHERE fk_attendance_id = @Id",
            new { Id = id })).ToList();

        return detail;
    }

    public async Task<int> CreateAsync(int clubId, CreateAttendanceDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Compute yearId BEFORE BeginTransactionAsync — once a transaction is active on the connection,
        // every subsequent command must explicitly pass that transaction. GetRotaryYearIdAsync doesn't,
        // and MySqlConnector throws "The transaction associated with this command is not the
        // connection's active transaction" when it sees a command without the txn parameter.
        var (mode, link) = NormalizeMeeting(dto.MeetingMode, dto.MeetingLink);
        var yearId = await GetRotaryYearIdAsync(connection, dto.EventDateTime);

        using var transaction = await connection.BeginTransactionAsync();

        try
        {
            // Insert main attendance record
            var attendanceId = await connection.ExecuteScalarAsync<int>(
                @"INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, Description, EventDateTime, MeetingMode, MeetingLink, created_by, created_date)
                  VALUES (@ClubId, @YearId, @EventName, @Description, @EventDateTime, @MeetingMode, @MeetingLink, @CreatedBy, NOW());
                  SELECT LAST_INSERT_ID();",
                new
                {
                    ClubId = clubId,
                    YearId = yearId,
                    dto.EventName,
                    dto.Description,
                    dto.EventDateTime,
                    MeetingMode = mode,
                    MeetingLink = link,
                    CreatedBy = createdBy
                },
                transaction);

            // Insert sub-records
            await InsertSubRecordsAsync(connection, transaction, attendanceId, dto.MemberIds, dto.Anns, dto.Annets, dto.Visitors, dto.Rotarians, dto.Delegates);

            await transaction.CommitAsync();
            _citationRecalc.TriggerForClub(clubId);
            return attendanceId;
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    public async Task<bool> UpdateAsync(int clubId, int id, UpdateAttendanceDto dto, int modifiedBy)
    {
        var (mode, link) = NormalizeMeeting(dto.MeetingMode, dto.MeetingLink);
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var owned = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_attendance WHERE pk_attendance_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
            new { Id = id, ClubId = clubId });
        if (owned == 0) return false;

        using var transaction = await connection.BeginTransactionAsync();

        try
        {
            // Update main attendance record
            await connection.ExecuteAsync(
                @"UPDATE club_attendance SET
                    EventName = @EventName,
                    Description = @Description,
                    EventDateTime = @EventDateTime,
                    MeetingMode = @MeetingMode,
                    MeetingLink = @MeetingLink,
                    modified_by = @ModifiedBy,
                    modified_date = NOW()
                  WHERE pk_attendance_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
                new
                {
                    Id = id,
                    ClubId = clubId,
                    MeetingMode = mode,
                    MeetingLink = link,
                    dto.EventName,
                    dto.Description,
                    dto.EventDateTime,
                    ModifiedBy = modifiedBy
                },
                transaction);

            // Delete all existing sub-records
            await connection.ExecuteAsync("DELETE FROM club_attendance_members WHERE fk_attendance_id = @Id", new { Id = id }, transaction);
            await connection.ExecuteAsync("DELETE FROM club_attendance_anns WHERE fk_attendance_id = @Id", new { Id = id }, transaction);
            await connection.ExecuteAsync("DELETE FROM club_attendance_annets WHERE fk_attendance_id = @Id", new { Id = id }, transaction);
            await connection.ExecuteAsync("DELETE FROM club_attendance_visitors WHERE fk_attendance_id = @Id", new { Id = id }, transaction);
            await connection.ExecuteAsync("DELETE FROM club_attendance_rotarians WHERE fk_attendance_id = @Id", new { Id = id }, transaction);
            await connection.ExecuteAsync("DELETE FROM club_attendance_delegates WHERE fk_attendance_id = @Id", new { Id = id }, transaction);

            // Re-insert sub-records
            await InsertSubRecordsAsync(connection, transaction, id, dto.MemberIds, dto.Anns, dto.Annets, dto.Visitors, dto.Rotarians, dto.Delegates);

            await transaction.CommitAsync();
            return true;
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    public async Task<bool> DeleteAsync(int clubId, int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Capture the club ID before soft-delete so we can recalc citation
        // points for that club.
        int clubFk = await connection.ExecuteScalarAsync<int>(
            "SELECT fk_club_id FROM club_attendance WHERE pk_attendance_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
            new { Id = id, ClubId = clubId });
        if (clubFk == 0) return false;
        await connection.ExecuteAsync(
            @"UPDATE club_attendance SET
                isdeleted = 1,
                deleted_by = @DeletedBy,
                deleted_date = NOW()
              WHERE pk_attendance_id = @Id AND fk_club_id = @ClubId",
            new { Id = id, ClubId = clubId, DeletedBy = deletedBy });
        _citationRecalc.TriggerForClub(clubFk);
        return true;
    }

    private static readonly string[] MeetingModes = { "in_person", "online", "hybrid" };

    /// Validates meeting mode and link (ROW Wave 1): unknown modes and non-https links are refused;
    /// an in-person meeting keeps no link.
    internal static (string Mode, string? Link) NormalizeMeeting(string? mode, string? link)
    {
        var m = string.IsNullOrWhiteSpace(mode) ? "in_person" : mode.Trim().ToLowerInvariant();
        if (!MeetingModes.Contains(m)) throw new ArgumentException("Meeting mode must be in_person, online or hybrid.");
        var l = string.IsNullOrWhiteSpace(link) || m == "in_person" ? null : link.Trim();
        if (l != null && (l.Length > 1000 || !Uri.TryCreate(l, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps))
            throw new ArgumentException("The meeting link must be an https:// address.");
        return (m, l);
    }

    public async Task<List<object>> GetYearsAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var result = await connection.QueryAsync(
            @"SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
              FROM rotary_year_master y
              INNER JOIN club_attendance a ON a.fk_year_id = y.pk_year_id
              WHERE a.fk_club_id = @ClubId
                AND a.isdeleted = 0

              UNION

              SELECT y2.pk_year_id AS id, y2.YearLabel AS yearLabel, y2.IsCurrent AS isCurrent
              FROM rotary_year_master y2
              WHERE y2.IsCurrent = 1

              ORDER BY id DESC",
            new { ClubId = clubId });
        return result.Select(r => (object)r).ToList();
    }

    public async Task<List<ClubMemberSimpleDto>> GetClubMembersAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Honorary members are never counted as part of "Total Members" (business rule
        // 2026-08-25) — an honorary member is not an active member of the club, so they
        // don't appear in this roster either.
        var result = await connection.QueryAsync<ClubMemberSimpleDto>(
            @"SELECT m.pk_member_master_profile_id AS Id, m.MemberName
              FROM member_master_profile m
              INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
              WHERE cm.fk_club_id = @ClubId
                AND m.isdeleted = 0
                AND cm.isdeleted = 0
                AND cm.IsActive = 1
                AND cm.IsHonoraryMember = 0
              ORDER BY m.MemberName",
            new { ClubId = clubId });
        return result.ToList();
    }

    private async Task InsertSubRecordsAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        int attendanceId,
        List<int>? memberIds,
        List<CreateAttendanceAnnDto>? anns,
        List<CreateAttendanceAnnetDto>? annets,
        List<CreateAttendanceVisitorDto>? visitors,
        List<CreateAttendanceRotarianDto>? rotarians,
        List<CreateAttendanceDelegateDto>? delegates)
    {
        if (memberIds?.Any() == true)
        {
            foreach (var memberId in memberIds)
            {
                await connection.ExecuteAsync(
                    "INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id) VALUES (@AttendanceId, @MemberId)",
                    new { AttendanceId = attendanceId, MemberId = memberId },
                    transaction);
            }
        }

        if (anns?.Any() == true)
        {
            foreach (var ann in anns)
            {
                await connection.ExecuteAsync(
                    "INSERT INTO club_attendance_anns (fk_attendance_id, AnnName) VALUES (@AttendanceId, @AnnName)",
                    new { AttendanceId = attendanceId, ann.AnnName },
                    transaction);
            }
        }

        if (annets?.Any() == true)
        {
            foreach (var annet in annets)
            {
                await connection.ExecuteAsync(
                    "INSERT INTO club_attendance_annets (fk_attendance_id, AnnetName) VALUES (@AttendanceId, @AnnetName)",
                    new { AttendanceId = attendanceId, annet.AnnetName },
                    transaction);
            }
        }

        if (visitors?.Any() == true)
        {
            foreach (var visitor in visitors)
            {
                await connection.ExecuteAsync(
                    "INSERT INTO club_attendance_visitors (fk_attendance_id, VisitorName, InvitedBy) VALUES (@AttendanceId, @VisitorName, @InvitedBy)",
                    new { AttendanceId = attendanceId, visitor.VisitorName, visitor.InvitedBy },
                    transaction);
            }
        }

        if (rotarians?.Any() == true)
        {
            foreach (var rotarian in rotarians)
            {
                await connection.ExecuteAsync(
                    "INSERT INTO club_attendance_rotarians (fk_attendance_id, RotarianName, ClubName) VALUES (@AttendanceId, @RotarianName, @ClubName)",
                    new { AttendanceId = attendanceId, rotarian.RotarianName, rotarian.ClubName },
                    transaction);
            }
        }

        if (delegates?.Any() == true)
        {
            foreach (var del in delegates)
            {
                await connection.ExecuteAsync(
                    "INSERT INTO club_attendance_delegates (fk_attendance_id, RotarianName, DistrictDesignation, ClubName) VALUES (@AttendanceId, @RotarianName, @DistrictDesignation, @ClubName)",
                    new { AttendanceId = attendanceId, del.RotarianName, del.DistrictDesignation, del.ClubName },
                    transaction);
            }
        }
    }
}

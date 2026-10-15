using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class BoardDirectorService : IBoardDirectorService
{
    private readonly string _connectionString;
    private readonly IDcAutoGroupService _dcAutoGroups;
    private readonly IBodSubGroupAutoService _bodSubGroups;

    public BoardDirectorService(IConfiguration configuration, IDcAutoGroupService dcAutoGroups, IBodSubGroupAutoService bodSubGroups)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _dcAutoGroups = dcAutoGroups;
        _bodSubGroups = bodSubGroups;
    }

    // Fire-and-forget sub-group sync — never blocks BOD save if it fails.
    private void FireBodSubGroupHook(int clubId, int designationId, int yearId)
    {
        _ = Task.Run(async () => { try { await _bodSubGroups.OnBodChangedAsync(clubId, designationId, yearId); } catch { } });
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Columns shared by the list + by-id reads. LEFT JOIN member so non-member rows surface;
    // the WHERE guard `(fk IS NULL OR member exists)` keeps orphan rows (member hard-deleted)
    // hidden while still including non-member rows (fk NULL by design).
    private const string SelectColumns = @"
                bd.pk_board_director_id AS Id,
                bd.fk_club_id AS ClubId,
                bd.fk_member_master_profile_id AS MemberId,
                CASE WHEN bd.fk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END AS IsMember,
                COALESCE(m.MemberName, bd.non_member_name, '') AS MemberName,
                bd.non_member_name AS NonMemberName,
                bd.non_member_mobile AS NonMemberMobile,
                bd.non_member_email AS NonMemberEmail,
                CASE
                    WHEN bd.fk_member_master_profile_id IS NULL THEN NULL
                    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                END AS ProfilePhotoPath,
                bd.fk_designation_id AS DesignationId,
                COALESCE(NULLIF(bd.custom_designation, ''), d.designation_name) AS DesignationName,
                bd.custom_designation AS CustomDesignation,
                bd.fk_year_id AS YearId,
                y.YearLabel
            FROM board_of_directors bd
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
            INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
            INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id";

    public async Task<List<BoardDirectorDto>> GetByClubAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<BoardDirectorDto>($@"
            SELECT {SelectColumns}
            WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId AND bd.isdeleted = 0
              AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
            ORDER BY
                CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                COALESCE(bd.sort_order, 9999),
                d.sort_order,
                bd.pk_board_director_id",
            new { ClubId = clubId, YearId = yearId })).ToList();
    }

    public async Task ReorderAsync(int clubId, int yearId, List<int> orderedIds, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        using var tx = await connection.BeginTransactionAsync();
        for (int i = 0; i < orderedIds.Count; i++)
        {
            await connection.ExecuteAsync(@"
                UPDATE board_of_directors
                SET sort_order = @SortOrder, modified_by = @ModifiedBy, modified_date = NOW()
                WHERE pk_board_director_id = @Id AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
                new { Id = orderedIds[i], SortOrder = i, ClubId = clubId, YearId = yearId, ModifiedBy = modifiedBy }, tx);
        }
        await tx.CommitAsync();
    }

    public async Task<List<BoardYearDto>> GetYearsByClubAsync(int clubId)
    {
        // DISTINCT rotary years that have AT LEAST ONE renderable BOD row (member exists OR
        // non-member entry) so the year dropdown never lists a year that would show an empty table.
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<BoardYearDto>(@"
            SELECT DISTINCT
                   y.pk_year_id AS Id,
                   y.YearLabel,
                   y.StartDate,
                   y.EndDate,
                   y.IsCurrent
            FROM board_of_directors bd
            INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
            INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
            WHERE bd.fk_club_id = @ClubId AND bd.isdeleted = 0
              AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
            ORDER BY y.StartDate DESC",
            new { ClubId = clubId })).ToList();
    }

    public async Task<BoardDirectorDto?> GetByIdAsync(int id)
    {
        // Inline (replaces sp_board_director_get_by_id) so non-member rows + fields are returned.
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<BoardDirectorDto>($@"
            SELECT {SelectColumns}
            WHERE bd.pk_board_director_id = @Id AND bd.isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateAsync(int clubId, CreateBoardDirectorDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var (memberId, nonMemberName) = NormalizeMemberInput(dto.MemberId, dto.NonMemberName);
        var nonMemberMobile = Trim(dto.NonMemberMobile);
        var nonMemberEmail = Trim(dto.NonMemberEmail);
        ValidateExactlyOneOfMemberOrNonMember(memberId, nonMemberName);
        if (memberId == null)
        {
            // Non-member: Name + Mobile + Email all required, and only for PAST years.
            if (string.IsNullOrWhiteSpace(nonMemberName) || string.IsNullOrWhiteSpace(nonMemberMobile) || string.IsNullOrWhiteSpace(nonMemberEmail))
                throw new InvalidOperationException("A non-member board member requires Name, Mobile, and Email.");
            await EnsureYearIsPastAsync(connection, dto.YearId);
        }

        var desName = await connection.ExecuteScalarAsync<string?>(
            "SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0",
            new { Id = dto.DesignationId });
        if (string.IsNullOrEmpty(desName))
            throw new InvalidOperationException("Selected designation is invalid.");

        // "Other" designation carries a free-text name; every other designation ignores it.
        var customDesignation = ResolveCustomDesignation(desName, dto.CustomDesignation);

        if (desName == "Club President" || desName == "Club Secretary")
        {
            // Only one CP / CS per club per year — counted across member AND non-member rows,
            // excluding orphaned member rows (member hard-deleted).
            var sameRoleExists = await connection.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM board_of_directors bd
                INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId
                  AND d.designation_name = @DesName AND bd.isdeleted = 0
                  AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)",
                new { ClubId = clubId, YearId = dto.YearId, DesName = desName });
            if (sameRoleExists > 0)
                throw new InvalidOperationException($"Only one {desName} is allowed per club per year.");

            // Same MEMBER cannot be both CP and CS in the same club+year (member-only check).
            if (memberId.HasValue)
            {
                var otherRole = desName == "Club President" ? "Club Secretary" : "Club President";
                var samePersonOtherRole = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM board_of_directors bd
                    INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                    WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId
                      AND bd.fk_member_master_profile_id = @MemberId
                      AND d.designation_name = @OtherRole AND bd.isdeleted = 0",
                    new { ClubId = clubId, YearId = dto.YearId, MemberId = memberId.Value, OtherRole = otherRole });
                if (samePersonOtherRole > 0)
                    throw new InvalidOperationException("Same member cannot be both Club President and Club Secretary for the same year.");
            }
        }

        var newId = await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO board_of_directors
                (fk_club_id, fk_member_master_profile_id, non_member_name, non_member_mobile, non_member_email,
                 fk_designation_id, custom_designation, fk_year_id, SyncSource, created_by)
            VALUES (@ClubId, @MemberId, @NonMemberName, @NonMemberMobile, @NonMemberEmail,
                 @DesignationId, @CustomDesignation, @YearId, 'Manual', @CreatedBy);
            SELECT LAST_INSERT_ID();",
            new { ClubId = clubId, MemberId = memberId, NonMemberName = nonMemberName, NonMemberMobile = nonMemberMobile,
                  NonMemberEmail = nonMemberEmail, DesignationId = dto.DesignationId, CustomDesignation = customDesignation, YearId = dto.YearId, CreatedBy = createdBy });

        // DC auto-group + sub-group hooks only apply to REAL members.
        if (memberId.HasValue)
        {
            try
            {
                await _dcAutoGroups.OnBodAddedOrUpdatedAsync(connection, null, clubId, memberId.Value, dto.DesignationId, dto.YearId, createdBy);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[DcAutoGroup hook FAILED in BOD Create] {ex.Message}");
            }
            FireBodSubGroupHook(clubId, dto.DesignationId, dto.YearId);
        }
        return newId;
    }

    public async Task UpdateAsync(int id, UpdateBoardDirectorDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Capture previous (member is nullable now) BEFORE updating, for DC cleanup.
        var prev = await connection.QueryFirstOrDefaultAsync<PrevBod>(@"
            SELECT fk_club_id AS ClubId, fk_member_master_profile_id AS MemberId,
                   fk_designation_id AS DesignationId, fk_year_id AS YearId
            FROM board_of_directors WHERE pk_board_director_id = @Id",
            new { Id = id });

        var (memberId, nonMemberName) = NormalizeMemberInput(dto.MemberId, dto.NonMemberName);
        var nonMemberMobile = Trim(dto.NonMemberMobile);
        var nonMemberEmail = Trim(dto.NonMemberEmail);
        ValidateExactlyOneOfMemberOrNonMember(memberId, nonMemberName);
        if (memberId == null)
        {
            if (string.IsNullOrWhiteSpace(nonMemberName) || string.IsNullOrWhiteSpace(nonMemberMobile) || string.IsNullOrWhiteSpace(nonMemberEmail))
                throw new InvalidOperationException("A non-member board member requires Name, Mobile, and Email.");
            await EnsureYearIsPastAsync(connection, dto.YearId);
        }

        var desName = await connection.ExecuteScalarAsync<string?>(
            "SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0",
            new { Id = dto.DesignationId });
        if (string.IsNullOrEmpty(desName))
            throw new InvalidOperationException("Selected designation is invalid.");

        var customDesignation = ResolveCustomDesignation(desName, dto.CustomDesignation);

        int clubId = prev?.ClubId ?? 0;
        if (desName == "Club President" || desName == "Club Secretary")
        {
            var sameRoleExists = await connection.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM board_of_directors bd
                INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId
                  AND d.designation_name = @DesName AND bd.isdeleted = 0
                  AND bd.pk_board_director_id <> @Id
                  AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)",
                new { ClubId = clubId, YearId = dto.YearId, DesName = desName, Id = id });
            if (sameRoleExists > 0)
                throw new InvalidOperationException($"Only one {desName} is allowed per club per year.");

            if (memberId.HasValue)
            {
                var otherRole = desName == "Club President" ? "Club Secretary" : "Club President";
                var samePersonOtherRole = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM board_of_directors bd
                    INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                    WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId
                      AND bd.fk_member_master_profile_id = @MemberId
                      AND d.designation_name = @OtherRole AND bd.isdeleted = 0
                      AND bd.pk_board_director_id <> @Id",
                    new { ClubId = clubId, YearId = dto.YearId, MemberId = memberId.Value, OtherRole = otherRole, Id = id });
                if (samePersonOtherRole > 0)
                    throw new InvalidOperationException("Same member cannot be both Club President and Club Secretary for the same year.");
            }
        }

        var bodRowsUpdated = await connection.ExecuteAsync(@"
            UPDATE board_of_directors
            SET fk_member_master_profile_id = @MemberId,
                non_member_name = @NonMemberName,
                non_member_mobile = @NonMemberMobile,
                non_member_email = @NonMemberEmail,
                fk_designation_id = @DesignationId,
                custom_designation = @CustomDesignation,
                fk_year_id = @YearId,
                SyncSource = 'Manual',
                modified_by = @ModifiedBy
            WHERE pk_board_director_id = @Id AND isdeleted = 0",
            new { Id = id, MemberId = memberId, NonMemberName = nonMemberName, NonMemberMobile = nonMemberMobile,
                  NonMemberEmail = nonMemberEmail, DesignationId = dto.DesignationId, CustomDesignation = customDesignation, YearId = dto.YearId, ModifiedBy = modifiedBy });

        // DC hooks operate on real members only — and only when the BOD row was really updated (the UPDATE
        // skips a soft-deleted row; mirroring it anyway would put a deleted CP/CS back into the DC group).
        if (bodRowsUpdated > 0)
        try
        {
            if (prev != null && prev.ClubId > 0 && prev.MemberId.HasValue &&
                (prev.MemberId != memberId || prev.DesignationId != dto.DesignationId || prev.YearId != dto.YearId))
            {
                await _dcAutoGroups.OnBodRemovedAsync(connection, null, prev.ClubId, prev.MemberId.Value, prev.DesignationId, prev.YearId, modifiedBy);
            }
            if (memberId.HasValue)
            {
                await _dcAutoGroups.OnBodAddedOrUpdatedAsync(connection, null, clubId, memberId.Value, dto.DesignationId, dto.YearId, modifiedBy);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[DcAutoGroup hook FAILED in BOD Update] {ex.Message}");
        }

        // Sub-group sync (fire-and-forget) — only when a real member is involved.
        if (prev != null && prev.ClubId > 0 && prev.MemberId.HasValue &&
            (prev.MemberId != memberId || prev.DesignationId != dto.DesignationId || prev.YearId != dto.YearId))
            FireBodSubGroupHook(prev.ClubId, prev.DesignationId, prev.YearId);
        if (memberId.HasValue && clubId > 0)
            FireBodSubGroupHook(clubId, dto.DesignationId, dto.YearId);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var row = await connection.QueryFirstOrDefaultAsync<PrevBod>(@"
            SELECT fk_club_id AS ClubId, fk_member_master_profile_id AS MemberId,
                   fk_designation_id AS DesignationId, fk_year_id AS YearId
            FROM board_of_directors WHERE pk_board_director_id = @Id",
            new { Id = id });

        await connection.ExecuteAsync(
            "sp_board_director_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);

        if (row != null && row.ClubId > 0 && row.MemberId.HasValue)
        {
            try
            {
                await _dcAutoGroups.OnBodRemovedAsync(connection, null, row.ClubId, row.MemberId.Value, row.DesignationId, row.YearId, deletedBy);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[DcAutoGroup hook FAILED in BOD Delete] {ex.Message}");
            }
            FireBodSubGroupHook(row.ClubId, row.DesignationId, row.YearId);
        }
    }

    public async Task<List<ClubMemberSearchDto>> SearchClubMembersAsync(int clubId, string? search)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ClubMemberSearchDto>(
            "sp_past_president_search_club_members",
            new { p_ClubId = clubId, p_Search = search ?? "" },
            commandType: CommandType.StoredProcedure)).ToList();
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private sealed class PrevBod
    {
        public int ClubId { get; set; }
        public int? MemberId { get; set; }
        public int DesignationId { get; set; }
        public int YearId { get; set; }
    }

    private static string? Trim(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // The "Other" designation requires a free-text name; it's stored in custom_designation.
    // Every other designation ignores any supplied custom text (stored as NULL).
    private static string? ResolveCustomDesignation(string designationName, string? customDesignation)
    {
        if (!string.Equals(designationName, "Other", StringComparison.OrdinalIgnoreCase))
            return null;
        var text = Trim(customDesignation);
        if (text == null)
            throw new InvalidOperationException("Please enter the designation name for the \"Other\" designation.");
        return text.Length > 150 ? text[..150] : text;
    }

    private static (int? memberId, string? nonMemberName) NormalizeMemberInput(int? rawMemberId, string? rawNonMemberName)
    {
        int? memberId = (rawMemberId.HasValue && rawMemberId.Value > 0) ? rawMemberId : null;
        string? nonMemberName = string.IsNullOrWhiteSpace(rawNonMemberName) ? null : rawNonMemberName.Trim();
        return (memberId, nonMemberName);
    }

    private static void ValidateExactlyOneOfMemberOrNonMember(int? memberId, string? nonMemberName)
    {
        bool hasMember = memberId.HasValue;
        bool hasNonMember = !string.IsNullOrWhiteSpace(nonMemberName);
        if (hasMember == hasNonMember)
            throw new InvalidOperationException("A board member must have either an existing member selected or a non-member's details, not both and not neither.");
    }

    private static async Task EnsureYearIsPastAsync(MySqlConnection connection, int yearId)
    {
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
            throw new InvalidOperationException("Non-member board members can only be added for past rotary years, not the current or future year.");
    }
}

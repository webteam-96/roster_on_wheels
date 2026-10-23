using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Prospects ("potential members"). N3 (2026-10-23): stage, owner, notes, conversion to a member, public sources.
// Inline SQL scoped to the club in the URL (the old stored procedures read and wrote any club's rows by id).
public class PotentialMemberService : IPotentialMemberService
{
    private readonly string _connectionString;
    private readonly IMemberService _members;

    public PotentialMemberService(IConfiguration configuration, IMemberService members)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _members = members;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private const string Select = @"
        SELECT pm.pk_potential_member_id AS Id, pm.fk_club_id AS ClubId, pm.name AS Name, pm.email AS Email,
               pm.mobile_number AS MobileNumber, pm.reference_details AS ReferenceDetails, pm.stage AS Stage,
               pm.fk_owner_member_id AS OwnerMemberId, o.MemberName AS OwnerName, pm.notes AS Notes, pm.source AS Source,
               NULLIF(pm.fk_converted_member_id, 0) AS ConvertedMemberId, pm.created_date AS CreatedDate
        FROM potential_members pm
        LEFT JOIN member_master_profile o ON o.pk_member_master_profile_id = pm.fk_owner_member_id";

    public async Task<PagedResult<PotentialMemberDto>> GetByClubAsync(int clubId, int page, int pageSize, string? search, string? stage = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 1000);
        var where = "pm.fk_club_id = @ClubId AND pm.isdeleted = 0"
            + (string.IsNullOrWhiteSpace(search) ? "" : " AND (pm.name LIKE @Like OR pm.email LIKE @Like OR pm.mobile_number LIKE @Like)")
            + (string.IsNullOrWhiteSpace(stage) ? "" : " AND pm.stage = @Stage");
        var args = new { ClubId = clubId, Like = $"%{search?.Trim()}%", Stage = stage?.Trim().ToLowerInvariant(), Take = pageSize, Skip = (page - 1) * pageSize };

        using var connection = CreateConnection();
        using var multi = await connection.QueryMultipleAsync(
            $"{Select} WHERE {where} ORDER BY pm.created_date DESC, pm.pk_potential_member_id DESC LIMIT @Take OFFSET @Skip; " +
            $"SELECT COUNT(*) FROM potential_members pm WHERE {where};", args);
        var items = (await multi.ReadAsync<PotentialMemberDto>()).ToList();
        return new PagedResult<PotentialMemberDto> { Items = items, TotalCount = await multi.ReadSingleAsync<int>(), Page = page, PageSize = pageSize };
    }

    public async Task<PotentialMemberDto?> GetByIdAsync(int clubId, int id)
    {
        using var connection = CreateConnection();
        return await connection.QueryFirstOrDefaultAsync<PotentialMemberDto>(
            $"{Select} WHERE pm.pk_potential_member_id = @Id AND pm.fk_club_id = @ClubId AND pm.isdeleted = 0",
            new { Id = id, ClubId = clubId });
    }

    /// <summary>Validated column values; a newly chosen owner must be an active member of the club (an owner already
    /// on the record stays valid after leaving, so the record can still be edited).</summary>
    private static async Task<(string Name, string? Email, string? Mobile, string? Reference, string? Stage, string? Notes)> CleanAsync(
        MySqlConnection connection, int clubId, string name, string? email, string? mobile, string? reference, string? stage, int? owner, string? notes,
        int? currentOwner = null)
    {
        var v = (ContactRules.Name(name), ContactRules.Email(email), ContactRules.Phone(mobile, 20),
            ContactRules.Clean(reference, 500, "Reference"), stage == null ? null : ContactRules.Stage(stage),
            ContactRules.Clean(notes, 2000, "Notes"));
        if (owner is > 0 && owner != currentOwner && await connection.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @Owner AND IsActive = 1 AND isdeleted = 0",
                new { ClubId = clubId, Owner = owner }) == 0)
            throw new ArgumentException("The owner must be an active member of this club.");
        return v;
    }

    public async Task<int> CreateAsync(int clubId, CreatePotentialMemberDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var v = await CleanAsync(connection, clubId, dto.Name, dto.Email, dto.MobileNumber, dto.ReferenceDetails, dto.Stage, dto.OwnerMemberId, dto.Notes);
        // fk_member_master_profile_id_as_referrer = the logged-in member who added this potential member.
        return await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO potential_members
                (fk_club_id, name, email, mobile_number, reference_details, stage, fk_owner_member_id, notes,
                 created_by, fk_member_master_profile_id_as_referrer)
            VALUES (@ClubId, @Name, @Email, @Mobile, @Reference, @Stage, @Owner, @Notes, @CreatedBy, @CreatedBy);
            SELECT LAST_INSERT_ID();",
            new { ClubId = clubId, v.Name, v.Email, v.Mobile, v.Reference, Stage = v.Stage ?? "inquiry",
                  Owner = dto.OwnerMemberId is > 0 ? dto.OwnerMemberId : null, v.Notes, CreatedBy = createdBy });
    }

    public async Task<bool> UpdateAsync(int clubId, int id, UpdatePotentialMemberDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var currentOwner = await connection.ExecuteScalarAsync<int?>(
            "SELECT fk_owner_member_id FROM potential_members WHERE pk_potential_member_id = @Id AND fk_club_id = @ClubId",
            new { Id = id, ClubId = clubId });
        var v = await CleanAsync(connection, clubId, dto.Name, dto.Email, dto.MobileNumber, dto.ReferenceDetails, dto.Stage, dto.OwnerMemberId, dto.Notes, currentOwner);
        // Pipeline fields: null keeps the stored value (older clients do not send them); owner 0 clears it.
        return await connection.ExecuteAsync(@"
            UPDATE potential_members
            SET name = @Name, email = @Email, mobile_number = @Mobile, reference_details = @Reference,
                stage = COALESCE(@Stage, stage),
                fk_owner_member_id = IF(@KeepOwner, fk_owner_member_id, @Owner),
                notes = IF(@KeepNotes, notes, @Notes),
                modified_by = @By
            WHERE pk_potential_member_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
            new { v.Name, v.Email, v.Mobile, v.Reference, v.Stage, KeepOwner = dto.OwnerMemberId == null,
                  Owner = dto.OwnerMemberId is > 0 ? dto.OwnerMemberId : null, KeepNotes = dto.Notes == null, v.Notes,
                  By = modifiedBy, Id = id, ClubId = clubId }) > 0;
    }

    public async Task<bool> DeleteAsync(int clubId, int id, int deletedBy)
    {
        using var connection = CreateConnection();
        return await connection.ExecuteAsync(@"
            UPDATE potential_members SET isdeleted = 1, deleted_by = @By, deleted_date = NOW()
            WHERE pk_potential_member_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
            new { Id = id, ClubId = clubId, By = deletedBy }) > 0;
    }

    public async Task<int> ConvertAsync(int clubId, int id, int convertedBy)
    {
        var p = await GetByIdAsync(clubId, id) ?? throw new KeyNotFoundException("Potential member not found.");
        if (string.IsNullOrWhiteSpace(p.Email) && string.IsNullOrWhiteSpace(p.MobileNumber))
            throw new InvalidOperationException("Add an email or mobile number before converting: the member needs one to sign in.");

        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Claim the row (0 = conversion running) so two clicks cannot create two members.
        var claimed = await connection.ExecuteAsync(@"
            UPDATE potential_members SET fk_converted_member_id = 0
            WHERE pk_potential_member_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0 AND fk_converted_member_id IS NULL",
            new { Id = id, ClubId = clubId });
        if (claimed == 0) throw new InvalidOperationException("This prospect has already been converted to a member.");

        try
        {
            // The member add path: duplicate check on mobile and email, soft-deleted profile re-activation,
            // club link, default role and welcome email.
            var memberId = await _members.CreateAsync(new CreateMemberDto
            {
                MemberName = p.Name,
                EmailId = string.IsNullOrWhiteSpace(p.Email) ? null : p.Email,
                PrimaryMobileNumber = string.IsNullOrWhiteSpace(p.MobileNumber) ? null : p.MobileNumber,
                ClubId = clubId,
                JoinedDate = DateTime.Today,
            });
            await connection.ExecuteAsync(@"
                UPDATE potential_members SET stage = 'inducted', fk_converted_member_id = @MemberId, converted_date = NOW(), modified_by = @By
                WHERE pk_potential_member_id = @Id",
                new { MemberId = memberId, By = convertedBy, Id = id });
            return memberId;
        }
        catch
        {
            await connection.ExecuteAsync(
                "UPDATE potential_members SET fk_converted_member_id = NULL WHERE pk_potential_member_id = @Id AND fk_converted_member_id = 0",
                new { Id = id });
            throw;
        }
    }

    public async Task<bool> CreateFromPublicAsync(int clubId, string name, string? email, string? phone, string? notes, string source, string stage, int? referrerMemberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        if (email != null && await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM potential_members WHERE fk_club_id = @ClubId AND email = @Email AND isdeleted = 0",
                new { ClubId = clubId, Email = email }) > 0)
            return false;
        await connection.ExecuteAsync(@"
            INSERT INTO potential_members
                (fk_club_id, name, email, mobile_number, notes, stage, source, consent_date,
                 fk_member_master_profile_id_as_referrer, fk_owner_member_id)
            VALUES (@ClubId, @Name, @Email, @Phone, @Notes, @Stage, @Source, NOW(), @Referrer, @Referrer)",
            new { ClubId = clubId, Name = name, Email = email, Phone = phone, Notes = notes, Stage = stage, Source = source, Referrer = referrerMemberId });
        return true;
    }
}

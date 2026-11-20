using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>A person as Rotary International lists them, already read (from the live API or the stored cache).</summary>
public sealed record RiPerson(long RotaryMemberId, string Name, string? Email, string? Phone, DateTime? BirthDate,
    string? Gender, string? Language, int IsYouth, string? MemberType, DateTime? AdmissionDate);

/// <summary>
/// Creates or re-activates a ROW member from RI data and puts them in a club. Shared by the Super Admin manual sync
/// (live RI calls) and the club's transfer-in wizard (stored cache only), so both write members the same way.
/// </summary>
public static class RiMemberImport
{
    /// <summary>Frees a mobile number held by soft-deleted rows so an insert or update does not hit UNIQUE(PrimaryMobileNumber).</summary>
    public static async Task ReleaseSoftDeletedMobileAsync(MySqlConnection conn, string? mobile, int excludeId = 0)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return;
        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                             THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                PrimaryMobileNumber = NULL,
                modified_date = NOW()
            WHERE TRIM(PrimaryMobileNumber) = TRIM(@Mobile)
              AND isdeleted = 1
              AND pk_member_master_profile_id <> @ExcludeId",
            new { Mobile = mobile.Trim(), ExcludeId = excludeId });
    }

    /// <summary>
    /// Inserts the person, or re-activates a soft-deleted profile with the same RI id, email or mobile. Throws
    /// <see cref="DuplicateMemberException"/> when an ACTIVE member already holds the RI id, email or mobile.
    /// </summary>
    public static async Task<int> CreateProfileAsync(MySqlConnection conn, RiPerson p)
    {
        var rid = p.RotaryMemberId.ToString();
        // A Rotary ID, email or mobile that another ACTIVE member holds is refused with that member's name (build spec 3.12).
        await MemberService.CheckDuplicatesAsync(conn, p.Phone, p.Email, rid);

        var existingId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_member_master_profile_id FROM member_master_profile
            WHERE isdeleted = 1 AND (RotaryId = @Rid
                OR (@Email IS NOT NULL AND @Email <> '' AND EmailId = @Email)
                OR (@Phone IS NOT NULL AND @Phone <> '' AND PrimaryMobileNumber = @Phone))
            ORDER BY pk_member_master_profile_id DESC LIMIT 1",
            new { Rid = rid, Email = p.Email ?? "", Phone = p.Phone ?? "" });

        if (existingId is > 0)
        {
            await ReleaseSoftDeletedMobileAsync(conn, p.Phone, excludeId: existingId.Value);
            await conn.ExecuteAsync(@"
                UPDATE member_master_profile SET
                    isdeleted = 0, deleted_by = NULL, deleted_date = NULL,
                    RotaryId = @Rid, MemberName = @Name,
                    EmailId = COALESCE(@Email, EmailId),
                    PrimaryMobileNumber = COALESCE(@Phone, PrimaryMobileNumber),
                    BirthDate = COALESCE(@Dob, BirthDate),
                    Gender = COALESCE(@Gender, Gender),
                    PrimaryLanguage = COALESCE(@Lang, PrimaryLanguage),
                    IsYouth = @IsYouth, modified_date = NOW()
                WHERE pk_member_master_profile_id = @Id",
                new { Id = existingId.Value, Rid = rid, p.Name, p.Email, p.Phone, Dob = p.BirthDate, p.Gender, Lang = p.Language, p.IsYouth });
            return existingId.Value;
        }

        await ReleaseSoftDeletedMobileAsync(conn, p.Phone, excludeId: 0);
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO member_master_profile
                (MemberName, RotaryId, EmailId, PrimaryMobileNumber, BirthDate, Gender, PrimaryLanguage, IsYouth, IsPersonalDetailsVisible, created_date, isdeleted, ShowPhoneInAllClubs, ShowEmailInAllClubs)
            VALUES (@Name, @Rid, @Email, @Phone, @Dob, @Gender, @Lang, @IsYouth, 1, NOW(), 0, 0, 0);
            SELECT LAST_INSERT_ID();",
            new { p.Name, Rid = rid, p.Email, p.Phone, Dob = p.BirthDate, p.Gender, Lang = p.Language, p.IsYouth });
    }

    /// <summary>Adds (or re-activates) the member's club_members row and gives them the default Member role.</summary>
    public static async Task JoinClubAsync(MySqlConnection conn, int clubId, int memberId, string? memberType, DateTime? admissionDate)
    {
        // Honorary status lives on club_members (2026-06-26), per club.
        var isHon = string.Equals(memberType, "Honorary Member", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        var existingCm = await conn.QueryFirstOrDefaultAsync<(int pk_id, int isdeleted)>(@"
            SELECT pk_club_member_id AS pk_id, isdeleted
            FROM club_members
            WHERE fk_club_id = @C AND fk_member_master_profile_id = @M
            ORDER BY pk_club_member_id DESC LIMIT 1",
            new { C = clubId, M = memberId });

        var joined = admissionDate ?? DateTime.UtcNow.Date;
        if (existingCm.pk_id == 0)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, IsHonoraryMember, created_date, isdeleted)
                VALUES (@C, @M, @J, 1, @IsHon, NOW(), 0)",
                new { C = clubId, M = memberId, J = joined, IsHon = isHon });
        }
        else if (existingCm.isdeleted == 1)
        {
            await conn.ExecuteAsync(@"
                UPDATE club_members SET isdeleted = 0, IsActive = 1, JoinedDate = @J,
                    IsHonoraryMember = @IsHon,
                    TerminationDate = NULL, TerminationReason = NULL,
                    deleted_by = NULL, deleted_date = NULL, modified_date = NOW()
                WHERE pk_club_member_id = @Id",
                new { Id = existingCm.pk_id, J = joined, IsHon = isHon });
        }
        else
        {
            // Active row: refresh honorary status; backfill a blank Joining Date, never overwrite one.
            await conn.ExecuteAsync(@"
                UPDATE club_members SET IsHonoraryMember = @IsHon,
                    JoinedDate = COALESCE(JoinedDate, @J),
                    modified_date = NOW()
                WHERE pk_club_member_id = @Id",
                new { Id = existingCm.pk_id, IsHon = isHon, J = joined });
        }

        await conn.ExecuteAsync(@"
            INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy, IsActive, isdeleted, AssignedDate)
            SELECT @M, 1, @M, 1, 0, NOW() FROM DUAL
            WHERE NOT EXISTS (
                SELECT 1 FROM member_roles
                WHERE fk_member_master_profile_id = @M AND fk_role_id = 1 AND IsActive = 1 AND isdeleted = 0)",
            new { M = memberId });
    }

    /// <summary>Youth flag as the manual sync sets it: RI's flag, else age 18 to 40 from the birth date.</summary>
    public static int YouthFlag(bool? riYouth, DateTime? dob, DateTime today)
    {
        if (riYouth == true) return 1;
        if (!dob.HasValue) return 0;
        var age = today.Year - dob.Value.Year;
        if (dob.Value.Date > today.AddYears(-age)) age--;
        return age is >= 18 and <= 40 ? 1 : 0;
    }
}

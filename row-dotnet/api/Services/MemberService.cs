using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class MemberService : IMemberService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly IRoleService _roleService;
    private readonly IEmailService _emailService;
    private readonly ILogger<MemberService> _logger;
    private readonly ICitationRecalcTrigger _citationRecalc;

    public MemberService(IConfiguration configuration, IWebHostEnvironment env, IRoleService roleService, IEmailService emailService, ILogger<MemberService> logger, ICitationRecalcTrigger citationRecalc)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _roleService = roleService;
        _emailService = emailService;
        _logger = logger;
        _citationRecalc = citationRecalc;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Project rule: birthday + anniversary store year=1900 (placeholder) in the
    // DB. The frontend never asks the user for a year; all incoming DateTimes
    // here have year=1900 already from the new DayMonthPicker, but legacy
    // callers (older mobile builds, older Excel imports) may send real years.
    // Normalizing on every write guarantees the column converges to 1900 over
    // time regardless of the caller.
    private static DateTime? NormalizeBirthAnnivYear(DateTime? d)
    {
        if (d == null) return null;
        var v = d.Value;
        // Defensive: any sentinel-style year (SQL Server's 1753 minimum, .NET's
        // 0001, or anything else pre-1900) is NOT a real date — coerce to NULL
        // so it never lands in the DB. Real birthdays/anniversaries store year
        // 1900 as a placeholder (day+month is what matters); anything older
        // than that is garbage from a legacy import or a buggy caller.
        if (v.Year < 1900) return null;
        // 1900 is not a leap year, so Feb 29 is un-representable there — clamp
        // to Feb 28 rather than throw; day/month is what matters for display.
        var day = (v.Month == 2 && v.Day == 29) ? 28 : v.Day;
        return new DateTime(1900, v.Month, day);
    }

    private async Task CheckDuplicatesAsync(MySqlConnection connection, string? mobile, string? email, string? rotaryId, int? excludeId = null)
    {
        // Inline SQL — looks at ACTIVE profiles only. Soft-deleted profiles with same mobile/email
        // are handled separately in CreateAsync via FindSoftDeletedMatchAsync (re-activation flow).
        var sql = @"
            SELECT
                SUM(CASE WHEN PrimaryMobileNumber = @Mobile AND @Mobile <> '' THEN 1 ELSE 0 END) AS MobileDuplicate,
                SUM(CASE WHEN EmailId = @Email AND @Email <> '' THEN 1 ELSE 0 END) AS EmailDuplicate,
                SUM(CASE WHEN RotaryId = @RotaryId AND @RotaryId <> '' THEN 1 ELSE 0 END) AS RotaryIdDuplicate
            FROM member_master_profile
            WHERE isdeleted = 0
              AND (@ExcludeId IS NULL OR pk_member_master_profile_id <> @ExcludeId)";

        var result = await connection.QueryFirstAsync<(long? MobileDuplicate, long? EmailDuplicate, long? RotaryIdDuplicate)>(sql,
            new { Mobile = mobile ?? "", Email = email ?? "", RotaryId = rotaryId ?? "", ExcludeId = excludeId });

        var errors = new List<string>();
        if ((result.MobileDuplicate ?? 0) > 0) errors.Add("This mobile number already exists");
        if ((result.EmailDuplicate ?? 0) > 0) errors.Add("This email ID already exists");
        if ((result.RotaryIdDuplicate ?? 0) > 0) errors.Add("This Rotary ID already exists");

        if (errors.Count > 0)
            throw new InvalidOperationException(string.Join(", ", errors));
    }

    // A member has one spouse. Every save re-inserts the whole family list, so a second "Spouse" card
    // became a second spouse row - and the Club Directory and the Directory Data Collection form then
    // each showed a different one. The form stops picking Spouse twice; this is the API-side guard.
    private static void CheckSingleSpouse(IEnumerable<FamilyMemberDto>? family)
    {
        if (family == null) return;
        var spouses = family.Count(f => string.Equals(f.Relation?.Trim(), "Spouse", StringComparison.OrdinalIgnoreCase));
        if (spouses > 1)
            throw new InvalidOperationException("Only one family member can be the Spouse.");

    }

    // The same person (name + relation) sent more than once in one save - the mobile app does this
    // (21 of 24 such saves since 2026-09-08) - is kept ONCE: the last copy, carrying the id of any
    // copy that already exists so it updates in place. The web form blocks this before saving.
    private static List<FamilyMemberDto> MergeDuplicateFamily(List<FamilyMemberDto> family)
    {
        var result = new List<FamilyMemberDto>();
        var index = new Dictionary<(string, string), int>();
        foreach (var f in family)
        {
            if (string.IsNullOrWhiteSpace(f.Name)) { result.Add(f); continue; }
            var key = (f.Name.Trim().ToLowerInvariant(), (f.Relation ?? "").Trim().ToLowerInvariant());
            if (index.TryGetValue(key, out var at))
            {
                if (f.Id <= 0 && result[at].Id > 0) f.Id = result[at].Id;
                result[at] = f;
            }
            else
            {
                index[key] = result.Count;
                result.Add(f);
            }
        }
        return result;
    }

    // Family details are UPDATE-in-place / INSERT-new / soft-delete-removed - never "delete all and
    // re-insert". The old way wrote a fresh copy of the whole list on every save (one member reached
    // 1,075 rows), and while the soft-delete step was broken on the server (until 2026-10-05) every
    // save ADDED the list again, so the same people showed many times.
    // A row is updated only when its id belongs to THIS member and is still active; anything else
    // (id 0 - a new card, or a client that sends no ids) is inserted. Active rows whose id is not in
    // the submitted list were removed on the form, so they are soft-deleted.
    private static async Task UpsertFamilyMembersAsync(MySqlConnection connection, int memberId,
        List<FamilyMemberDto> family, MySqlTransaction transaction)
    {
        var existing = (await connection.QueryAsync<int>(@"
            SELECT pk_member_family_details_id FROM member_family_details
            WHERE fk_member_master_profile_id = @MemberId AND COALESCE(isdeleted, 0) = 0",
            new { MemberId = memberId }, transaction)).ToHashSet();

        var kept = new HashSet<int>();
        foreach (var fm in MergeDuplicateFamily(family))
        {
            fm.FkMemberMasterProfileId = memberId;
            if (fm.Id > 0 && existing.Contains(fm.Id) && kept.Add(fm.Id))
            {
                await connection.ExecuteAsync(@"
                    UPDATE member_family_details
                    SET Name = @Name, Relation = @Relation, BloodGroup = @BloodGroup, fk_country_id = @FkCountryId,
                        PhoneNumber = @PhoneNumber, EmailId = @EmailId, BirthDate = @BirthDate,
                        AnniversaryDate = @AnniversaryDate, PhotoPath = @PhotoPath, modified_date = NOW()
                    WHERE pk_member_family_details_id = @Id AND fk_member_master_profile_id = @MemberId",
                    new
                    {
                        fm.Id, MemberId = memberId, fm.Name, fm.Relation, fm.BloodGroup, fm.FkCountryId,
                        fm.PhoneNumber, fm.EmailId,
                        BirthDate = NormalizeBirthAnnivYear(fm.BirthDate),
                        AnniversaryDate = NormalizeBirthAnnivYear(fm.AnniversaryDate),
                        fm.PhotoPath,
                    }, transaction);
            }
            else
            {
                await InsertFamilyMember(connection, fm, transaction);
            }
        }

        var removed = existing.Where(x => !kept.Contains(x)).ToList();
        if (removed.Count > 0)
            await connection.ExecuteAsync(@"
                UPDATE member_family_details SET isdeleted = 1, modified_date = NOW()
                WHERE pk_member_family_details_id IN @Ids AND fk_member_master_profile_id = @MemberId",
                new { Ids = removed, MemberId = memberId }, transaction);
    }

    // Returns the pk_id of a soft-deleted profile that matches by mobile, email, or rotaryId — if any.
    // Used to re-activate previously deleted members instead of failing on the UNIQUE constraint.
    private async Task<int?> FindSoftDeletedMatchAsync(MySqlConnection connection, string? mobile, string? email, string? rotaryId)
    {
        if (string.IsNullOrWhiteSpace(mobile) && string.IsNullOrWhiteSpace(email) && string.IsNullOrWhiteSpace(rotaryId))
            return null;

        var sql = @"
            SELECT pk_member_master_profile_id
            FROM member_master_profile
            WHERE isdeleted = 1
              AND ((PrimaryMobileNumber = @Mobile AND @Mobile <> '')
                OR (EmailId = @Email AND @Email <> '')
                OR (RotaryId = @RotaryId AND @RotaryId <> ''))
            ORDER BY pk_member_master_profile_id DESC
            LIMIT 1";

        return await connection.QueryFirstOrDefaultAsync<int?>(sql,
            new { Mobile = mobile ?? "", Email = email ?? "", RotaryId = rotaryId ?? "" });
    }

    // Free `mobile` from any SOFT-DELETED profile (other than excludeId) that still owns it, so a
    // reused number doesn't trip UNIQUE(PrimaryMobileNumber). Moves that deleted row's Primary ->
    // Secondary (only when Secondary is empty, so nothing is lost) and nulls its Primary. ACTIVE
    // rows are never touched — a live duplicate still fails, as it should.
    internal static async Task ReleaseSoftDeletedMobileAsync(MySqlConnection conn, string? mobile, int excludeId, MySqlTransaction? tx = null)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return;
        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                             THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                PrimaryMobileNumber = NULL,
                modified_date = NOW()
            WHERE PrimaryMobileNumber = @Mobile
              AND isdeleted = 1
              AND pk_member_master_profile_id <> @ExcludeId",
            new { Mobile = mobile.Trim(), ExcludeId = excludeId }, tx);
    }

    public async Task<PagedResult<MemberListDto>> GetAllAsync(int page, int pageSize, string? search, string? bloodGroup, string? gender)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var totalCount = await connection.ExecuteScalarAsync<int>(
            "sp_member_get_all_count",
            new { p_Search = string.IsNullOrWhiteSpace(search) ? null : search, p_BloodGroup = string.IsNullOrWhiteSpace(bloodGroup) ? null : bloodGroup, p_Gender = string.IsNullOrWhiteSpace(gender) ? null : gender },
            commandType: CommandType.StoredProcedure);

        var offset = (page - 1) * pageSize;

        // Inline SQL — sp_member_get_all_paginated cannot be recreated by current DB user (SYSTEM_USER privilege).
        // Designation now sourced from club_members via JOIN (Step 11B 2026-06-18).
        var items = (await connection.QueryAsync<MemberListDto>(@"
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
                pc.PhoneCode AS PrimaryCountryPhoneCode,
                m.BloodGroup,
                m.Gender,
                m.RotaryId,
                ba.BusinessName,
                cmd.Designation,
                ra.City AS ResCity,
                ra.State AS ResState
            FROM member_master_profile m
            JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
            LEFT JOIN member_address_details ba
                ON ba.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND ba.AddressType = 'Business'
                AND ba.isdeleted = 0
            LEFT JOIN member_address_details ra
                ON ra.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND ra.AddressType IN ('Residential','Residence')
                AND ra.isdeleted = 0
            LEFT JOIN (
                SELECT fk_member_master_profile_id,
                       MAX(Designation) AS Designation
                FROM club_members
                WHERE COALESCE(isdeleted, 0) = 0
                GROUP BY fk_member_master_profile_id
            ) cmd ON cmd.fk_member_master_profile_id = m.pk_member_master_profile_id
            WHERE m.isdeleted = 0
              AND (@Search IS NULL
                   OR m.MemberName LIKE CONCAT('%', @Search, '%')
                   OR m.EmailId LIKE CONCAT('%', @Search, '%')
                   OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%')
                   OR m.RotaryId LIKE CONCAT('%', @Search, '%'))
              AND (@BloodGroup IS NULL OR m.BloodGroup = @BloodGroup)
              AND (@Gender IS NULL OR m.Gender = @Gender)
            ORDER BY m.pk_member_master_profile_id DESC
            LIMIT @PageSize OFFSET @Offset",
            new {
                Search = string.IsNullOrWhiteSpace(search) ? null : search,
                BloodGroup = string.IsNullOrWhiteSpace(bloodGroup) ? null : bloodGroup,
                Gender = string.IsNullOrWhiteSpace(gender) ? null : gender,
                PageSize = pageSize,
                Offset = offset
            })).ToList();

        return new PagedResult<MemberListDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<MemberDetailDto?> GetByIdAsync(int id, int? clubId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inline SQL instead of sp_member_get_by_id so we can wrap FamilyPhotoPath in a CASE/CONCAT
        // that emits a /Documents/directory/<filename> URL (rewritten via Media:RedirectBaseUrl
        // to example.org when the API can't serve the file locally). SP can't be modified —
        // owned by a higher-privilege MySQL user.
        var member = await connection.QueryFirstOrDefaultAsync<MemberDetailDto>(@"
            SELECT
                m.pk_member_master_profile_id AS Id,
                m.MemberName,
                CASE
                    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                END AS ProfilePhotoPath,
                m.fk_primary_country_id AS FkPrimaryCountryId,
                pc.CountryName AS PrimaryCountry,
                pc.PhoneCode AS PrimaryCountryPhoneCode,
                m.PrimaryMobileNumber,
                m.EmailId,
                m.BirthDate,
                m.AnniversaryDate,
                m.BloodGroup,
                m.fk_secondary_country_id AS FkSecondaryCountryId,
                sc.CountryName AS SecondaryCountry,
                sc.PhoneCode AS SecondaryCountryPhoneCode,
                m.SecondaryMobileNumber,
                m.IsPersonalDetailsVisible,
                m.Gender,
                m.PrimaryLanguage,
                m.IsYouth,
                m.MemberIntroduction,
                m.Facebook,
                m.Instagram,
                m.LinkedIn,
                m.Twitter,
                m.Youtube,
                m.Website,
                m.RotaryId,
                m.DonorRecognition,
                CASE
                    WHEN m.FamilyPhotoPath IS NULL OR m.FamilyPhotoPath = '' THEN NULL
                    WHEN m.FamilyPhotoPath LIKE '/Documents/directory/%' THEN m.FamilyPhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.FamilyPhotoPath, '/', -1))
                END AS FamilyPhotoPath,
                m.IsFamilyDetailsVisible,
                m.created_by AS CreatedBy,
                m.created_date AS CreatedDate,
                m.modified_by AS ModifiedBy,
                m.modified_date AS ModifiedDate
            FROM member_master_profile m
            LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
            LEFT JOIN country_master sc ON sc.pk_country_id = m.fk_secondary_country_id
            WHERE m.pk_member_master_profile_id = @Id
              AND m.isdeleted = 0",
            new { Id = id });

        if (member == null) return null;

        // Inline SQL — sp_member_address_get_by_member_id cannot be recreated by current DB user (SYSTEM_USER privilege).
        var addresses = (await connection.QueryAsync<MemberAddressDto>(@"
            SELECT
                a.pk_member_address_details_id AS Id,
                a.fk_member_master_profile_id AS FkMemberMasterProfileId,
                a.AddressType,
                a.fk_country_id AS FkCountryId,
                c.CountryName AS Country,
                c.PhoneCode AS CountryPhoneCode,
                a.PhoneNumber,
                a.Address,
                a.State,
                a.City,
                a.PinCode,
                a.BusinessName,
                a.BusinessEmailId,
                a.Keywords
            FROM member_address_details a
            LEFT JOIN country_master c ON c.pk_country_id = a.fk_country_id
            WHERE a.fk_member_master_profile_id = @Id
              AND a.isdeleted = 0",
            new { Id = id })).ToList();
        member.Addresses = addresses;

        // Designation + ClassificationProfession now live ONLY on club_members (Step 11B 2026-06-18).
        // Member-level — same value across all active memberships, so MAX() picks the populated one.
        var clubDesig = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MAX(Designation) AS Designation,
                   MAX(ClassificationProfession) AS ClassificationProfession
            FROM club_members
            WHERE fk_member_master_profile_id = @Id
              AND COALESCE(isdeleted, 0) = 0",
            new { Id = id });
        if (clubDesig != null)
        {
            member.Designation = clubDesig.Designation;
            member.ClassificationProfession = clubDesig.ClassificationProfession;
        }

        // Inline SQL instead of sp_member_family_get_by_member_id so family-member PhotoPath gets
        // the /Documents/FaimilyMembersPhoto/ URL prefix (intentional legacy typo "Faimily").
        var familyMembers = (await connection.QueryAsync<FamilyMemberDto>(@"
            SELECT
                f.pk_member_family_details_id AS Id,
                f.fk_member_master_profile_id AS FkMemberMasterProfileId,
                f.Name,
                f.Relation,
                f.BloodGroup,
                f.fk_country_id AS FkCountryId,
                c.CountryName AS Country,
                c.PhoneCode AS CountryPhoneCode,
                f.PhoneNumber,
                f.EmailId,
                f.BirthDate,
                f.AnniversaryDate,
                CASE
                    WHEN f.PhotoPath IS NULL OR f.PhotoPath = '' THEN NULL
                    WHEN f.PhotoPath LIKE '/%' THEN f.PhotoPath
                    ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(f.PhotoPath, '/', -1))
                END AS PhotoPath
            FROM member_family_details f
            LEFT JOIN country_master c ON c.pk_country_id = f.fk_country_id
            WHERE f.fk_member_master_profile_id = @MemberId
              AND f.isdeleted = 0",
            new { MemberId = id })).ToList();
        member.FamilyMembers = familyMembers;

        // Active club membership for edit-form prefill. A member can hold multiple active
        // club_members rows (each a different club), and the join date is per-club. When the
        // edit form is opened in a club's context (clubId passed), use THAT club's JoinedDate.
        // Fallback (no clubId): pick a row that actually has a date — `(JoinedDate IS NULL)`
        // pushes null-date rows last, since MySQL otherwise sorts NULLs first on "JoinedDate ASC"
        // and would blank the form even when another club row has the real date.
        var clubMembership = await connection.QueryFirstOrDefaultAsync<(int clubId, DateTime? joinedDate)>(@"
            SELECT fk_club_id AS clubId, JoinedDate AS joinedDate
            FROM club_members
            WHERE fk_member_master_profile_id = @Id AND isdeleted = 0
              AND (@ClubId IS NULL OR fk_club_id = @ClubId)
            ORDER BY (JoinedDate IS NULL), JoinedDate ASC, pk_club_member_id ASC
            LIMIT 1",
            new { Id = id, ClubId = clubId });
        if (clubMembership.clubId > 0)
        {
            member.ClubId = clubMembership.clubId;
            member.JoinedDate = clubMembership.joinedDate;
        }

        return member;
    }

    public async Task<int> CreateAsync(CreateMemberDto dto)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // 1. Block if duplicate on an ACTIVE profile (data integrity)
        await CheckDuplicatesAsync(connection, dto.PrimaryMobileNumber, dto.EmailId, dto.RotaryId);
        CheckSingleSpouse(dto.FamilyMembers);

        // 2. If a SOFT-DELETED profile matches, re-activate it instead of inserting new.
        //    This handles the "delete then re-add" workflow without hitting UNIQUE-constraint errors
        //    on PrimaryMobileNumber / EmailId / RotaryId.
        var softDeletedId = await FindSoftDeletedMatchAsync(connection, dto.PrimaryMobileNumber, dto.EmailId, dto.RotaryId);
        if (softDeletedId.HasValue)
        {
            using var reactivateTx = await connection.BeginTransactionAsync();
            try
            {
                // A DIFFERENT soft-deleted row may still hold this mobile (matched here by email/rotaryId).
                // Release it so the re-activation UPDATE doesn't hit UNIQUE(PrimaryMobileNumber).
                await ReleaseSoftDeletedMobileAsync(connection, dto.PrimaryMobileNumber, excludeId: softDeletedId.Value, reactivateTx);

                await connection.ExecuteAsync(@"
                    UPDATE member_master_profile SET
                        MemberName = @MemberName,
                        ProfilePhotoPath = @ProfilePhotoPath,
                        fk_primary_country_id = @FkPrimaryCountryId,
                        PrimaryMobileNumber = @PrimaryMobileNumber,
                        EmailId = @EmailId,
                        BirthDate = @BirthDate,
                        AnniversaryDate = @AnniversaryDate,
                        BloodGroup = @BloodGroup,
                        fk_secondary_country_id = @FkSecondaryCountryId,
                        SecondaryMobileNumber = @SecondaryMobileNumber,
                        IsPersonalDetailsVisible = @IsPersonalDetailsVisible,
                        Gender = @Gender,
                        PrimaryLanguage = @PrimaryLanguage,
                        IsYouth = @IsYouth,
                        MemberIntroduction = @MemberIntroduction,
                        Facebook = @Facebook,
                        Instagram = @Instagram,
                        LinkedIn = @LinkedIn,
                        Twitter = @Twitter,
                        Youtube = @Youtube,
                        Website = @Website,
                        RotaryId = @RotaryId,
                        DonorRecognition = @DonorRecognition,
                        FamilyPhotoPath = @FamilyPhotoPath,
                        IsFamilyDetailsVisible = @IsFamilyDetailsVisible,
                        isdeleted = 0,
                        deleted_by = NULL,
                        deleted_date = NULL,
                        modified_date = NOW()
                    WHERE pk_member_master_profile_id = @Id",
                    new
                    {
                        Id = softDeletedId.Value,
                        dto.MemberName,
                        dto.ProfilePhotoPath,
                        dto.FkPrimaryCountryId,
                        dto.PrimaryMobileNumber,
                        dto.EmailId,
                        BirthDate = NormalizeBirthAnnivYear(dto.BirthDate),
                        AnniversaryDate = NormalizeBirthAnnivYear(dto.AnniversaryDate),
                        dto.BloodGroup,
                        dto.FkSecondaryCountryId,
                        dto.SecondaryMobileNumber,
                        dto.IsPersonalDetailsVisible,
                        dto.Gender,
                        dto.PrimaryLanguage,
                        dto.IsYouth,
                        dto.MemberIntroduction,
                        dto.Facebook,
                        dto.Instagram,
                        dto.LinkedIn,
                        dto.Twitter,
                        dto.Youtube,
                        dto.Website,
                        dto.RotaryId,
                        dto.DonorRecognition,
                        dto.FamilyPhotoPath,
                        dto.IsFamilyDetailsVisible,
                    }, reactivateTx);

                // Ensure default Member role is active.
                // Order matters: check active first → re-activate soft-deleted second → insert fresh last.
                // Without this, calling AssignDefaultMemberRoleAsync after re-activating produces duplicate
                // active Member rows (shows up as "Member, Member" in search results).
                var hasActiveMemberRole = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM member_roles
                    WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 1 AND isdeleted = 0",
                    new { MemberId = softDeletedId.Value }, reactivateTx);

                if (hasActiveMemberRole == 0)
                {
                    var reactivatedCount = await connection.ExecuteAsync(@"
                        UPDATE member_roles
                        SET isdeleted = 0, IsActive = 1, RevokedDate = NULL, RevokedBy = NULL, modified_date = NOW()
                        WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 1 AND isdeleted = 1",
                        new { MemberId = softDeletedId.Value }, reactivateTx);

                    if (reactivatedCount == 0)
                    {
                        // No Member role exists at all — assign fresh
                        await _roleService.AssignDefaultMemberRoleAsync(softDeletedId.Value, connection, reactivateTx);
                    }
                }

                if (dto.ClubId.HasValue && dto.ClubId.Value > 0)
                {
                    // Re-add to the chosen club using the soft-delete-aware logic (re-activates if row exists)
                    var existingCm = await connection.QueryFirstOrDefaultAsync<(int pk_id, int isdeleted)>(@"
                        SELECT pk_club_member_id AS pk_id, isdeleted
                        FROM club_members
                        WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
                        ORDER BY pk_club_member_id DESC LIMIT 1",
                        new { ClubId = dto.ClubId.Value, MemberId = softDeletedId.Value }, reactivateTx);

                    var joinedDate = dto.JoinedDate ?? DateTime.Today;
                    if (existingCm.pk_id == 0)
                    {
                        await connection.ExecuteAsync(@"
                            INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_by, created_date, isdeleted)
                            VALUES (@ClubId, @MemberId, @JoinedDate, 1, 0, NOW(), 0)",
                            new { ClubId = dto.ClubId.Value, MemberId = softDeletedId.Value, JoinedDate = joinedDate }, reactivateTx);
                    }
                    else if (existingCm.isdeleted == 1)
                    {
                        await connection.ExecuteAsync(@"
                            UPDATE club_members
                            SET isdeleted = 0, IsActive = 1, JoinedDate = @JoinedDate,
                                TerminationDate = NULL, TerminationReason = NULL,
                                deleted_by = NULL, deleted_date = NULL, modified_date = NOW()
                            WHERE pk_club_member_id = @Id",
                            new { Id = existingCm.pk_id, JoinedDate = joinedDate }, reactivateTx);
                    }
                    // else: already active in this club — no-op
                }

                await reactivateTx.CommitAsync();
                _logger.LogInformation("Re-activated soft-deleted member profile {MemberId} on create", softDeletedId.Value);

                // Refresh District Awards "Member Addition" counts for the club.
                if (dto.ClubId.HasValue && dto.ClubId.Value > 0)
                    _citationRecalc.TriggerForClub(dto.ClubId.Value);

                // Send welcome email (fire-and-forget) for re-activated members too — they're rejoining a club
                if (!string.IsNullOrWhiteSpace(dto.EmailId) && dto.ClubId.HasValue && dto.ClubId.Value > 0)
                {
                    var clubId = dto.ClubId.Value;
                    var memberId = softDeletedId.Value;
                    var emailToSend = dto.EmailId!;
                    var memberNameToSend = dto.MemberName ?? "Member";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            using var conn2 = CreateConnection();
                            var clubName = await conn2.ExecuteScalarAsync<string>(
                                "SELECT ClubName FROM club_master WHERE pk_club_id=@Id AND isdeleted=0", new { Id = clubId }) ?? "Rotary Club";

                            var ctx = await conn2.QueryFirstOrDefaultAsync<dynamic>(@"
                                SELECT d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
                                FROM club_master c
                                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                                WHERE c.pk_club_id = @Id", new { Id = clubId });

                            var ccRows = await conn2.QueryAsync<string>(@"
                                SELECT DISTINCT m.EmailId
                                FROM board_of_directors bod
                                JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
                                JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
                                WHERE bod.fk_club_id = @ClubId AND bod.fk_designation_id IN (1, 4) AND bod.isdeleted = 0
                                  AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                                new { ClubId = clubId });

                            await _emailService.SendNewMemberWelcomeEmailAsync(
                                emailToSend,
                                memberNameToSend,
                                clubName,
                                (string?)ctx?.districtNumber,
                                (string?)ctx?.zoneName,
                                ccRows.Distinct(StringComparer.OrdinalIgnoreCase).ToList());
                        }
                        catch (Exception ex) { _logger.LogError(ex, "Failed to send welcome email for re-activated member {Id}", memberId); }
                    });
                }

                return softDeletedId.Value;
            }
            catch
            {
                try { await reactivateTx.RollbackAsync(); } catch { }
                throw;
            }
        }

        // 3. No matches → INSERT new (existing flow)
        using var transaction = await connection.BeginTransactionAsync();

        try
        {
            // Free the number from any soft-deleted row so the INSERT doesn't hit UNIQUE(PrimaryMobileNumber).
            await ReleaseSoftDeletedMobileAsync(connection, dto.PrimaryMobileNumber, excludeId: 0, transaction);

            // Inline SQL — sp_member_create cannot be recreated (SYSTEM_USER privilege)
            // and member_master_profile.IsHonoraryMember was dropped 2026-06-26 (moved
            // to club_members.IsHonoraryMember for per-club scope). New members default
            // to non-honorary in every club; SuperAdmin toggles per-club later.
            var memberId = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO member_master_profile (
                    MemberName, ProfilePhotoPath, fk_primary_country_id, PrimaryMobileNumber,
                    EmailId, BirthDate, AnniversaryDate, BloodGroup,
                    fk_secondary_country_id, SecondaryMobileNumber,
                    IsPersonalDetailsVisible, Gender, PrimaryLanguage,
                    IsYouth, MemberIntroduction,
                    Facebook, Instagram, LinkedIn, Twitter, Youtube, Website,
                    RotaryId, DonorRecognition, FamilyPhotoPath, IsFamilyDetailsVisible,
                    created_by, created_date, isdeleted
                ) VALUES (
                    @MemberName, @ProfilePhotoPath, @FkPrimaryCountryId, @PrimaryMobileNumber,
                    @EmailId, @BirthDate, @AnniversaryDate, @BloodGroup,
                    @FkSecondaryCountryId, @SecondaryMobileNumber,
                    @IsPersonalDetailsVisible, @Gender, @PrimaryLanguage,
                    @IsYouth, @MemberIntroduction,
                    @Facebook, @Instagram, @LinkedIn, @Twitter, @Youtube, @Website,
                    @RotaryId, @DonorRecognition, @FamilyPhotoPath, @IsFamilyDetailsVisible,
                    0, NOW(), 0
                );
                SELECT LAST_INSERT_ID();",
                new {
                    dto.MemberName, dto.ProfilePhotoPath, dto.FkPrimaryCountryId, dto.PrimaryMobileNumber,
                    dto.EmailId,
                    BirthDate       = NormalizeBirthAnnivYear(dto.BirthDate),
                    AnniversaryDate = NormalizeBirthAnnivYear(dto.AnniversaryDate),
                    dto.BloodGroup,
                    dto.FkSecondaryCountryId, dto.SecondaryMobileNumber,
                    IsPersonalDetailsVisible = dto.IsPersonalDetailsVisible ? 1 : 0,
                    dto.Gender, dto.PrimaryLanguage,
                    IsYouth = dto.IsYouth ? 1 : 0,
                    dto.MemberIntroduction,
                    dto.Facebook, dto.Instagram, dto.LinkedIn, dto.Twitter, dto.Youtube, dto.Website,
                    dto.RotaryId, dto.DonorRecognition, dto.FamilyPhotoPath,
                    IsFamilyDetailsVisible = dto.IsFamilyDetailsVisible ? 1 : 0,
                }, transaction);

            if (dto.Addresses != null)
            {
                foreach (var addr in dto.Addresses)
                {
                    addr.FkMemberMasterProfileId = memberId;
                    await InsertAddress(connection, addr, transaction);
                }
            }

            if (dto.FamilyMembers != null)
            {
                foreach (var fm in MergeDuplicateFamily(dto.FamilyMembers))
                {
                    fm.FkMemberMasterProfileId = memberId;
                    await InsertFamilyMember(connection, fm, transaction);
                }
            }

            await _roleService.AssignDefaultMemberRoleAsync(memberId, connection, transaction);

            if (dto.ClubId.HasValue && dto.ClubId.Value > 0)
            {
                await connection.ExecuteAsync(
                    "sp_club_add_member",
                    new { p_ClubId = dto.ClubId.Value, p_MemberId = memberId, p_JoinedDate = dto.JoinedDate ?? DateTime.Today, p_CreatedBy = 0 },
                    transaction, commandType: CommandType.StoredProcedure);

                // Stamp the per-club honorary flag on the just-created club_members row.
                // sp_club_add_member can't be updated (SYSTEM_USER), so do it as a
                // follow-up UPDATE on the same (clubId, memberId) pair. Default is 0
                // so omitting this UPDATE leaves the row at "regular" — but we run
                // it unconditionally so re-activations of soft-deleted memberships
                // also pick up the value (sp may have flipped isdeleted back).
                await connection.ExecuteAsync(@"
                    UPDATE club_members
                    SET IsHonoraryMember = @IsHon, modified_date = NOW()
                    WHERE fk_club_id = @ClubId
                      AND fk_member_master_profile_id = @MemberId
                      AND COALESCE(isdeleted, 0) = 0",
                    new { ClubId = dto.ClubId.Value, MemberId = memberId, IsHon = dto.IsHonoraryMember ? 1 : 0 },
                    transaction);
            }

            await UpdateMemberDesignationAcrossClubsAsync(connection, memberId, dto.Designation, dto.ClassificationProfession, transaction);

            await transaction.CommitAsync();

            // Send welcome email (fire-and-forget) if member has email and was added to a club
            if (!string.IsNullOrWhiteSpace(dto.EmailId) && dto.ClubId.HasValue && dto.ClubId.Value > 0)
            {
                var clubId = dto.ClubId.Value;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        using var conn2 = CreateConnection();
                        var clubName = await conn2.ExecuteScalarAsync<string>(
                            "SELECT ClubName FROM club_master WHERE pk_club_id=@Id AND isdeleted=0", new { Id = clubId }) ?? "Rotary Club";

                        // District + Zone for the welcome email context line
                        var ctx = await conn2.QueryFirstOrDefaultAsync<dynamic>(@"
                            SELECT d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
                            FROM club_master c
                            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                            WHERE c.pk_club_id = @Id", new { Id = clubId });

                        // CC list: current-year Club President (designation=1) + Secretary (designation=4) only
                        var ccRows = await conn2.QueryAsync<string>(@"
                            SELECT DISTINCT m.EmailId
                            FROM board_of_directors bod
                            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
                            JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
                            WHERE bod.fk_club_id = @ClubId AND bod.fk_designation_id IN (1, 4) AND bod.isdeleted = 0
                              AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                            new { ClubId = clubId });

                        await _emailService.SendNewMemberWelcomeEmailAsync(
                            dto.EmailId!,
                            dto.MemberName ?? "Member",
                            clubName,
                            (string?)ctx?.districtNumber,
                            (string?)ctx?.zoneName,
                            ccRows.Distinct(StringComparer.OrdinalIgnoreCase).ToList());
                    }
                    catch (Exception ex) { _logger.LogError(ex, "Failed to send welcome email for member {Id}", memberId); }
                });
            }

            // Refresh District Awards "Member Addition" counts for the club.
            if (dto.ClubId.HasValue && dto.ClubId.Value > 0)
                _citationRecalc.TriggerForClub(dto.ClubId.Value);

            return memberId;
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    public async Task UpdateAsync(int id, UpdateMemberDto dto)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check duplicates before starting transaction (avoids transaction-command mismatch)
        await CheckDuplicatesAsync(connection, dto.PrimaryMobileNumber, dto.EmailId, dto.RotaryId, excludeId: id);
        CheckSingleSpouse(dto.FamilyMembers);

        using var transaction = await connection.BeginTransactionAsync();

        try
        {
            // Free the number from any soft-deleted row so reusing it doesn't hit UNIQUE(PrimaryMobileNumber).
            await ReleaseSoftDeletedMobileAsync(connection, dto.PrimaryMobileNumber, excludeId: id, transaction);

            // Inline SQL — sp_member_update can't be recreated (SYSTEM_USER privilege)
            // and IsHonoraryMember was dropped from this table 2026-06-26 (moved to
            // club_members for per-club scope). UI manages honorary per-club elsewhere.
            await connection.ExecuteAsync(@"
                UPDATE member_master_profile SET
                    MemberName = @MemberName,
                    ProfilePhotoPath = @ProfilePhotoPath,
                    fk_primary_country_id = @FkPrimaryCountryId,
                    PrimaryMobileNumber = @PrimaryMobileNumber,
                    EmailId = @EmailId,
                    BirthDate = @BirthDate,
                    AnniversaryDate = @AnniversaryDate,
                    BloodGroup = @BloodGroup,
                    fk_secondary_country_id = @FkSecondaryCountryId,
                    SecondaryMobileNumber = @SecondaryMobileNumber,
                    IsPersonalDetailsVisible = @IsPersonalDetailsVisible,
                    Gender = @Gender,
                    PrimaryLanguage = @PrimaryLanguage,
                    IsYouth = @IsYouth,
                    MemberIntroduction = @MemberIntroduction,
                    Facebook = @Facebook,
                    Instagram = @Instagram,
                    LinkedIn = @LinkedIn,
                    Twitter = @Twitter,
                    Youtube = @Youtube,
                    Website = @Website,
                    RotaryId = @RotaryId,
                    DonorRecognition = @DonorRecognition,
                    FamilyPhotoPath = @FamilyPhotoPath,
                    IsFamilyDetailsVisible = @IsFamilyDetailsVisible,
                    modified_by = 0,
                    modified_date = NOW()
                WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
                new {
                    Id = id,
                    dto.MemberName, dto.ProfilePhotoPath, dto.FkPrimaryCountryId, dto.PrimaryMobileNumber,
                    dto.EmailId,
                    BirthDate       = NormalizeBirthAnnivYear(dto.BirthDate),
                    AnniversaryDate = NormalizeBirthAnnivYear(dto.AnniversaryDate),
                    dto.BloodGroup,
                    dto.FkSecondaryCountryId, dto.SecondaryMobileNumber,
                    IsPersonalDetailsVisible = dto.IsPersonalDetailsVisible ? 1 : 0,
                    dto.Gender, dto.PrimaryLanguage,
                    IsYouth = dto.IsYouth ? 1 : 0,
                    dto.MemberIntroduction,
                    dto.Facebook, dto.Instagram, dto.LinkedIn, dto.Twitter, dto.Youtube, dto.Website,
                    dto.RotaryId, dto.DonorRecognition, dto.FamilyPhotoPath,
                    IsFamilyDetailsVisible = dto.IsFamilyDetailsVisible ? 1 : 0,
                }, transaction);

            if (dto.Addresses != null)
            {
                await connection.ExecuteAsync(
                    "sp_member_address_soft_delete_by_member",
                    new { p_MemberId = id }, transaction, commandType: CommandType.StoredProcedure);

                foreach (var addr in dto.Addresses)
                {
                    addr.FkMemberMasterProfileId = id;
                    await InsertAddress(connection, addr, transaction);
                }
            }

            if (dto.FamilyMembers != null)
                await UpsertFamilyMembersAsync(connection, id, dto.FamilyMembers, transaction);

            if (dto.ClubId.HasValue && dto.ClubId.Value > 0 && dto.JoinedDate.HasValue)
            {
                await connection.ExecuteAsync(@"
                    UPDATE club_members
                    SET JoinedDate = @JoinedDate, modified_date = NOW()
                    WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
                      AND isdeleted = 0",
                    new { ClubId = dto.ClubId.Value, MemberId = id, JoinedDate = dto.JoinedDate.Value },
                    transaction);
            }

            await UpdateMemberDesignationAcrossClubsAsync(connection, id, dto.Designation, dto.ClassificationProfession, transaction);

            await transaction.CommitAsync();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    public async Task DeleteAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            "sp_member_soft_delete",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);

        // A deleted profile can't be a Club President / Secretary in the DC auto-groups (every year).
        // Manual DC groups are untouched.
        await connection.ExecuteAsync(@"
            UPDATE district_committee_group_member m
            JOIN district_committee_group g ON g.id = m.fk_group_id
            SET m.isdeleted = 1, m.modified_date = NOW()
            WHERE m.fk_member_id = @Id AND m.isdeleted = 0 AND g.isdeleted = 0
              AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
                OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')",
            new { Id = id });
    }

    public async Task<string> UploadPhotoAsync(IFormFile file, string type)
    {
        // Folder layout matches legacy example.org so new uploads land next
        // to the migrated photos (single source of truth):
        //   profile      → /Documents/directory/{file}
        //   family       → /Documents/directory/{file}
        //   familymember → /Documents/FaimilyMembersPhoto/{file}
        // Filename stays GUID — that part of the convention is unchanged.
        var subFolder = type.ToLower() switch
        {
            "familymember" => Path.Combine("Documents", "FaimilyMembersPhoto"),
            _              => Path.Combine("Documents", "directory"), // profile + family
        };

        var uploadsDir = Path.Combine(_env.WebRootPath, subFolder);
        Directory.CreateDirectory(uploadsDir);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsDir, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Always return the full relative URL with a leading slash. The
        // MemberService read SQL's `WHEN ProfilePhotoPath LIKE '/%' THEN
        // ProfilePhotoPath` branch returns it as-is, so the new path resolves
        // correctly. Existing DB rows that stored a bare filename still hit
        // the ELSE branch and get the legacy `/uploads/profile/` CONCAT — no
        // break for migrated data.
        return "/" + subFolder.Replace(Path.DirectorySeparatorChar, '/') + "/" + fileName;
    }

    private static async Task InsertAddress(MySqlConnection connection, MemberAddressDto addr, MySqlTransaction transaction)
    {
        // Inline SQL instead of sp_member_address_create — SP can't be dropped/recreated by current DB user
        // (SYSTEM_USER privilege issue), so the old param signature lingers in the DB after Step 11B
        // dropped Designation/ClassificationProfession from the schema.
        await connection.ExecuteAsync(@"
            INSERT INTO member_address_details
                (fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber,
                 Address, State, City, PinCode,
                 BusinessName, BusinessEmailId, Keywords,
                 created_date)
            VALUES
                (@FkMemberMasterProfileId, @AddressType, @FkCountryId, @PhoneNumber,
                 @Address, @State, @City, @PinCode,
                 @BusinessName, @BusinessEmailId, @Keywords,
                 NOW())",
            new {
                addr.FkMemberMasterProfileId,
                addr.AddressType,
                addr.FkCountryId,
                addr.PhoneNumber,
                addr.Address,
                addr.State,
                addr.City,
                addr.PinCode,
                addr.BusinessName,
                addr.BusinessEmailId,
                addr.Keywords
            }, transaction);
    }

    // Designation + ClassificationProfession live on club_members (Step 11B 2026-06-18).
    // Treated as member-level: same value written to every active club_members row for the member.
    // Values come from the TOP-LEVEL dto fields (frontend sends member.designation, not nested under addresses).
    private static async Task UpdateMemberDesignationAcrossClubsAsync(
        MySqlConnection connection,
        int memberId,
        string? designation,
        string? classification,
        MySqlTransaction transaction)
    {
        var d = string.IsNullOrWhiteSpace(designation) ? null : designation.Trim();
        var c = string.IsNullOrWhiteSpace(classification) ? null : classification.Trim();

        await connection.ExecuteAsync(@"
            UPDATE club_members
            SET Designation = @Designation,
                ClassificationProfession = @Classification,
                modified_date = NOW()
            WHERE fk_member_master_profile_id = @MemberId
              AND COALESCE(isdeleted, 0) = 0",
            new { Designation = d, Classification = c, MemberId = memberId },
            transaction);
    }

    private static async Task InsertFamilyMember(MySqlConnection connection, FamilyMemberDto fm, MySqlTransaction transaction)
    {
        await connection.ExecuteAsync(
            "sp_member_family_create",
            new {
                p_FkMemberMasterProfileId = fm.FkMemberMasterProfileId,
                p_Name = fm.Name,
                p_Relation = fm.Relation,
                p_BloodGroup = fm.BloodGroup,
                p_FkCountryId = fm.FkCountryId,
                p_PhoneNumber = fm.PhoneNumber,
                p_EmailId = fm.EmailId,
                p_BirthDate = NormalizeBirthAnnivYear(fm.BirthDate),
                p_AnniversaryDate = NormalizeBirthAnnivYear(fm.AnniversaryDate),
                p_PhotoPath = fm.PhotoPath
            }, transaction, commandType: CommandType.StoredProcedure);
    }
}

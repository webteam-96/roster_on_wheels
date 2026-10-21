using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    private static async Task CreateOrReplaceProcedure(MySqlConnection connection, string procedureName, string createSql)
    {
        try
        {
            await connection.ExecuteAsync($"DROP PROCEDURE IF EXISTS `{procedureName}`");
        }
        catch (MySqlException)
        {
            // DROP failed due to SYSTEM_USER privilege — SP was created by a higher-privilege user.
            // If SP exists, we can't drop it, so skip — but the SP may be stale.
            var exists = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = @Name AND ROUTINE_TYPE = 'PROCEDURE'",
                new { Name = procedureName });
            if (exists > 0) return; // Can't update — SP owned by SYSTEM_USER
        }
        try
        {
            await connection.ExecuteAsync(createSql);
        }
        catch (MySqlException ex) when (ex.Message.Contains("SUPER privilege", StringComparison.OrdinalIgnoreCase)
                                     || ex.Message.Contains("log_bin_trust_function_creators", StringComparison.OrdinalIgnoreCase))
        {
            // MySQL user lacks SUPER privilege on a binlog-enabled server.
            // Non-fatal — existing SPs continue to work; new SPs simply won't be created.
        }
    }

    private static async Task CreateStoredProceduresAsync(MySqlConnection connection)
    {
        // ========== MEMBER STORED PROCEDURES (13) ==========

        // 1. sp_member_check_duplicates
        await CreateOrReplaceProcedure(connection, "sp_member_check_duplicates", @"
            CREATE PROCEDURE sp_member_check_duplicates(
                IN p_Mobile VARCHAR(20),
                IN p_Email VARCHAR(200),
                IN p_RotaryId VARCHAR(50),
                IN p_ExcludeId INT
            )
            BEGIN
                SELECT
                    (SELECT COUNT(*) FROM member_master_profile
                     WHERE isdeleted = 0
                       AND (p_ExcludeId IS NULL OR pk_member_master_profile_id != p_ExcludeId)
                       AND p_Mobile != ''
                       AND PrimaryMobileNumber = p_Mobile) AS MobileDuplicate,
                    (SELECT COUNT(*) FROM member_master_profile
                     WHERE isdeleted = 0
                       AND (p_ExcludeId IS NULL OR pk_member_master_profile_id != p_ExcludeId)
                       AND p_Email != ''
                       AND EmailId = p_Email) AS EmailDuplicate,
                    (SELECT COUNT(*) FROM member_master_profile
                     WHERE isdeleted = 0
                       AND (p_ExcludeId IS NULL OR pk_member_master_profile_id != p_ExcludeId)
                       AND p_RotaryId != ''
                       AND RotaryId = p_RotaryId) AS RotaryIdDuplicate;
            END");

        // 2. sp_member_get_all_count
        await CreateOrReplaceProcedure(connection, "sp_member_get_all_count", @"
            CREATE PROCEDURE sp_member_get_all_count(
                IN p_Search VARCHAR(200),
                IN p_BloodGroup VARCHAR(10),
                IN p_Gender VARCHAR(20)
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_master_profile
                WHERE isdeleted = 0
                  AND (p_Search IS NULL
                       OR MemberName LIKE CONCAT('%', p_Search, '%')
                       OR EmailId LIKE CONCAT('%', p_Search, '%')
                       OR PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%')
                       OR RotaryId LIKE CONCAT('%', p_Search, '%'))
                  AND (p_BloodGroup IS NULL OR BloodGroup = p_BloodGroup)
                  AND (p_Gender IS NULL OR Gender = p_Gender);
            END");

        // 3. sp_member_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_member_get_all_paginated", @"
            CREATE PROCEDURE sp_member_get_all_paginated(
                IN p_Search VARCHAR(200),
                IN p_BloodGroup VARCHAR(10),
                IN p_Gender VARCHAR(20),
                IN p_PageSize INT,
                IN p_Offset INT
            )
            BEGIN
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
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%')
                       OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                  AND (p_BloodGroup IS NULL OR m.BloodGroup = p_BloodGroup)
                  AND (p_Gender IS NULL OR m.Gender = p_Gender)
                ORDER BY m.pk_member_master_profile_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END");

        // 4. sp_member_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_member_get_by_id", @"
            CREATE PROCEDURE sp_member_get_by_id(
                IN p_Id INT
            )
            BEGIN
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
                    m.FamilyPhotoPath,
                    m.IsFamilyDetailsVisible,
                    m.created_by AS CreatedBy,
                    m.created_date AS CreatedDate,
                    m.modified_by AS ModifiedBy,
                    m.modified_date AS ModifiedDate
                FROM member_master_profile m
                LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
                LEFT JOIN country_master sc ON sc.pk_country_id = m.fk_secondary_country_id
                WHERE m.pk_member_master_profile_id = p_Id
                  AND m.isdeleted = 0;
            END");

        // 5. sp_member_address_get_by_member_id
        await CreateOrReplaceProcedure(connection, "sp_member_address_get_by_member_id", @"
            CREATE PROCEDURE sp_member_address_get_by_member_id(
                IN p_MemberId INT
            )
            BEGIN
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
                    cmd.Designation AS Designation,
                    cmd.ClassificationProfession AS ClassificationProfession,
                    a.Keywords
                FROM member_address_details a
                LEFT JOIN country_master c ON c.pk_country_id = a.fk_country_id
                LEFT JOIN (
                    SELECT fk_member_master_profile_id,
                           MAX(Designation) AS Designation,
                           MAX(ClassificationProfession) AS ClassificationProfession
                    FROM club_members
                    WHERE COALESCE(isdeleted, 0) = 0
                    GROUP BY fk_member_master_profile_id
                ) cmd ON cmd.fk_member_master_profile_id = a.fk_member_master_profile_id
                WHERE a.fk_member_master_profile_id = p_MemberId
                  AND a.isdeleted = 0;
            END");

        // 6. sp_member_family_get_by_member_id
        await CreateOrReplaceProcedure(connection, "sp_member_family_get_by_member_id", @"
            CREATE PROCEDURE sp_member_family_get_by_member_id(
                IN p_MemberId INT
            )
            BEGIN
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
                    f.PhotoPath
                FROM member_family_details f
                LEFT JOIN country_master c ON c.pk_country_id = f.fk_country_id
                WHERE f.fk_member_master_profile_id = p_MemberId
                  AND f.isdeleted = 0;
            END");

        // 7. sp_member_create
        await CreateOrReplaceProcedure(connection, "sp_member_create", @"
            CREATE PROCEDURE sp_member_create(
                IN p_MemberName VARCHAR(200),
                IN p_ProfilePhotoPath VARCHAR(500),
                IN p_FkPrimaryCountryId INT,
                IN p_PrimaryMobileNumber VARCHAR(20),
                IN p_EmailId VARCHAR(200),
                IN p_BirthDate DATE,
                IN p_AnniversaryDate DATE,
                IN p_BloodGroup VARCHAR(10),
                IN p_FkSecondaryCountryId INT,
                IN p_SecondaryMobileNumber VARCHAR(20),
                IN p_IsPersonalDetailsVisible BIT,
                IN p_Gender VARCHAR(20),
                IN p_PrimaryLanguage VARCHAR(50),
                IN p_IsYouth BIT,
                IN p_MemberIntroduction TEXT,
                IN p_Facebook VARCHAR(300),
                IN p_Instagram VARCHAR(300),
                IN p_LinkedIn VARCHAR(300),
                IN p_Twitter VARCHAR(300),
                IN p_Youtube VARCHAR(300),
                IN p_Website VARCHAR(300),
                IN p_RotaryId VARCHAR(50),
                IN p_DonorRecognition VARCHAR(200),
                IN p_FamilyPhotoPath VARCHAR(500),
                IN p_IsFamilyDetailsVisible BIT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO member_master_profile (
                    MemberName, ProfilePhotoPath, fk_primary_country_id, PrimaryMobileNumber,
                    EmailId, BirthDate, AnniversaryDate, BloodGroup,
                    fk_secondary_country_id, SecondaryMobileNumber,
                    IsPersonalDetailsVisible, Gender, PrimaryLanguage,
                    IsYouth, MemberIntroduction,
                    Facebook, Instagram, LinkedIn, Twitter, Youtube, Website,
                    RotaryId, DonorRecognition, FamilyPhotoPath, IsFamilyDetailsVisible,
                    created_by, created_date
                ) VALUES (
                    p_MemberName, p_ProfilePhotoPath, p_FkPrimaryCountryId, p_PrimaryMobileNumber,
                    p_EmailId, p_BirthDate, p_AnniversaryDate, p_BloodGroup,
                    p_FkSecondaryCountryId, p_SecondaryMobileNumber,
                    p_IsPersonalDetailsVisible, p_Gender, p_PrimaryLanguage,
                    p_IsYouth, p_MemberIntroduction,
                    p_Facebook, p_Instagram, p_LinkedIn, p_Twitter, p_Youtube, p_Website,
                    p_RotaryId, p_DonorRecognition, p_FamilyPhotoPath, p_IsFamilyDetailsVisible,
                    p_CreatedBy, NOW()
                );
                SELECT LAST_INSERT_ID();
            END");

        // 8. sp_member_update
        await CreateOrReplaceProcedure(connection, "sp_member_update", @"
            CREATE PROCEDURE sp_member_update(
                IN p_Id INT,
                IN p_MemberName VARCHAR(200),
                IN p_ProfilePhotoPath VARCHAR(500),
                IN p_FkPrimaryCountryId INT,
                IN p_PrimaryMobileNumber VARCHAR(20),
                IN p_EmailId VARCHAR(200),
                IN p_BirthDate DATE,
                IN p_AnniversaryDate DATE,
                IN p_BloodGroup VARCHAR(10),
                IN p_FkSecondaryCountryId INT,
                IN p_SecondaryMobileNumber VARCHAR(20),
                IN p_IsPersonalDetailsVisible BIT,
                IN p_Gender VARCHAR(20),
                IN p_PrimaryLanguage VARCHAR(50),
                IN p_IsYouth BIT,
                IN p_MemberIntroduction TEXT,
                IN p_Facebook VARCHAR(300),
                IN p_Instagram VARCHAR(300),
                IN p_LinkedIn VARCHAR(300),
                IN p_Twitter VARCHAR(300),
                IN p_Youtube VARCHAR(300),
                IN p_Website VARCHAR(300),
                IN p_RotaryId VARCHAR(50),
                IN p_DonorRecognition VARCHAR(200),
                IN p_FamilyPhotoPath VARCHAR(500),
                IN p_IsFamilyDetailsVisible BIT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE member_master_profile SET
                    MemberName = p_MemberName,
                    ProfilePhotoPath = p_ProfilePhotoPath,
                    fk_primary_country_id = p_FkPrimaryCountryId,
                    PrimaryMobileNumber = p_PrimaryMobileNumber,
                    EmailId = p_EmailId,
                    BirthDate = p_BirthDate,
                    AnniversaryDate = p_AnniversaryDate,
                    BloodGroup = p_BloodGroup,
                    fk_secondary_country_id = p_FkSecondaryCountryId,
                    SecondaryMobileNumber = p_SecondaryMobileNumber,
                    IsPersonalDetailsVisible = p_IsPersonalDetailsVisible,
                    Gender = p_Gender,
                    PrimaryLanguage = p_PrimaryLanguage,
                    IsYouth = p_IsYouth,
                    MemberIntroduction = p_MemberIntroduction,
                    Facebook = p_Facebook,
                    Instagram = p_Instagram,
                    LinkedIn = p_LinkedIn,
                    Twitter = p_Twitter,
                    Youtube = p_Youtube,
                    Website = p_Website,
                    RotaryId = p_RotaryId,
                    DonorRecognition = p_DonorRecognition,
                    FamilyPhotoPath = p_FamilyPhotoPath,
                    IsFamilyDetailsVisible = p_IsFamilyDetailsVisible,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_member_master_profile_id = p_Id
                  AND isdeleted = 0;
            END");

        // 9. sp_member_address_create
        // Designation + ClassificationProfession moved to club_members (Step 11B 2026-06-18).
        // Those values are now written via MemberService UpdateMemberDesignationAcrossClubsAsync after addresses persist.
        await CreateOrReplaceProcedure(connection, "sp_member_address_create", @"
            CREATE PROCEDURE sp_member_address_create(
                IN p_FkMemberMasterProfileId INT,
                IN p_AddressType VARCHAR(20),
                IN p_FkCountryId INT,
                IN p_PhoneNumber VARCHAR(20),
                IN p_Address TEXT,
                IN p_State VARCHAR(100),
                IN p_City VARCHAR(100),
                IN p_PinCode VARCHAR(100),
                IN p_BusinessName VARCHAR(300),
                IN p_BusinessEmailId VARCHAR(200),
                IN p_Keywords VARCHAR(500)
            )
            BEGIN
                INSERT INTO member_address_details (
                    fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber,
                    Address, State, City, PinCode,
                    BusinessName, BusinessEmailId, Keywords,
                    created_date
                ) VALUES (
                    p_FkMemberMasterProfileId, p_AddressType, p_FkCountryId, p_PhoneNumber,
                    p_Address, p_State, p_City, p_PinCode,
                    p_BusinessName, p_BusinessEmailId, p_Keywords,
                    NOW()
                );
            END");

        // 10. sp_member_family_create
        await CreateOrReplaceProcedure(connection, "sp_member_family_create", @"
            CREATE PROCEDURE sp_member_family_create(
                IN p_FkMemberMasterProfileId INT,
                IN p_Name VARCHAR(200),
                IN p_Relation VARCHAR(100),
                IN p_BloodGroup VARCHAR(10),
                IN p_FkCountryId INT,
                IN p_PhoneNumber VARCHAR(20),
                IN p_EmailId VARCHAR(200),
                IN p_BirthDate DATE,
                IN p_AnniversaryDate DATE,
                IN p_PhotoPath VARCHAR(500)
            )
            BEGIN
                INSERT INTO member_family_details (
                    fk_member_master_profile_id, Name, Relation, BloodGroup,
                    fk_country_id, PhoneNumber, EmailId,
                    BirthDate, AnniversaryDate, PhotoPath,
                    created_date
                ) VALUES (
                    p_FkMemberMasterProfileId, p_Name, p_Relation, p_BloodGroup,
                    p_FkCountryId, p_PhoneNumber, p_EmailId,
                    p_BirthDate, p_AnniversaryDate, p_PhotoPath,
                    NOW()
                );
            END");

        // 11. sp_member_address_soft_delete_by_member
        await CreateOrReplaceProcedure(connection, "sp_member_address_soft_delete_by_member", @"
            CREATE PROCEDURE sp_member_address_soft_delete_by_member(
                IN p_MemberId INT
            )
            BEGIN
                UPDATE member_address_details
                SET isdeleted = 1
                WHERE fk_member_master_profile_id = p_MemberId;
            END");

        // 12. sp_member_family_soft_delete_by_member
        await CreateOrReplaceProcedure(connection, "sp_member_family_soft_delete_by_member", @"
            CREATE PROCEDURE sp_member_family_soft_delete_by_member(
                IN p_MemberId INT
            )
            BEGIN
                UPDATE member_family_details
                SET isdeleted = 1
                WHERE fk_member_master_profile_id = p_MemberId;
            END");

        // 13. sp_member_soft_delete
        await CreateOrReplaceProcedure(connection, "sp_member_soft_delete", @"
            CREATE PROCEDURE sp_member_soft_delete(
                IN p_Id INT
            )
            BEGIN
                UPDATE member_master_profile
                SET isdeleted = 1, deleted_date = NOW(), deleted_by = p_Id
                WHERE pk_member_master_profile_id = p_Id;

                UPDATE member_address_details
                SET isdeleted = 1, deleted_date = NOW()
                WHERE fk_member_master_profile_id = p_Id;

                UPDATE member_family_details
                SET isdeleted = 1, deleted_date = NOW()
                WHERE fk_member_master_profile_id = p_Id;
            END");

        // ========== COUNTRY STORED PROCEDURES (1) ==========

        // 14. sp_country_get_all
        await CreateOrReplaceProcedure(connection, "sp_country_get_all", @"
            CREATE PROCEDURE sp_country_get_all()
            BEGIN
                SELECT
                    pk_country_id AS Id,
                    CountryName,
                    CountryCode,
                    PhoneCode,
                    GmtOpt,
                    GmtTime,
                    Ordering
                FROM country_master
                WHERE isdeleted = 0
                ORDER BY Ordering;
            END");

        // ========== AUTH STORED PROCEDURES (13) ==========

        // 15. sp_auth_get_member_by_email
        await CreateOrReplaceProcedure(connection, "sp_auth_get_member_by_email", @"
            CREATE PROCEDURE sp_auth_get_member_by_email(
                IN p_Email VARCHAR(200)
            )
            BEGIN
                SELECT
                    pk_member_master_profile_id AS Id,
                    MemberName,
                    EmailId
                FROM member_master_profile
                WHERE EmailId = p_Email
                  AND isdeleted = 0;
            END");

        // 16. sp_auth_get_member_by_mobile
        await CreateOrReplaceProcedure(connection, "sp_auth_get_member_by_mobile", @"
            CREATE PROCEDURE sp_auth_get_member_by_mobile(
                IN p_CountryCode VARCHAR(10),
                IN p_MobileNumber VARCHAR(20)
            )
            BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    m.EmailId
                FROM member_master_profile m
                JOIN country_master c ON c.pk_country_id = m.fk_primary_country_id
                WHERE c.PhoneCode = p_CountryCode
                  AND m.PrimaryMobileNumber = p_MobileNumber
                  AND m.isdeleted = 0;
            END");

        // 17. sp_auth_get_admin_roles
        await CreateOrReplaceProcedure(connection, "sp_auth_get_admin_roles", @"
            CREATE PROCEDURE sp_auth_get_admin_roles(
                IN p_MemberId INT
            )
            BEGIN
                SELECT r.RoleName
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0
                  AND r.RoleName IN ('Admin', 'SuperAdmin', 'ZonalCoordinator');
            END");

        // 18. sp_auth_get_credentials
        await CreateOrReplaceProcedure(connection, "sp_auth_get_credentials", @"
            CREATE PROCEDURE sp_auth_get_credentials(
                IN p_MemberId INT
            )
            BEGIN
                SELECT
                    pk_member_credential_id AS Id,
                    PasswordHash,
                    IsTemporaryPassword,
                    FailedLoginAttempts,
                    LockoutEndTime
                FROM member_credentials
                WHERE fk_member_master_profile_id = p_MemberId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END");

        // 19. sp_auth_update_failed_login
        await CreateOrReplaceProcedure(connection, "sp_auth_update_failed_login", @"
            CREATE PROCEDURE sp_auth_update_failed_login(
                IN p_CredId INT,
                IN p_Attempts INT,
                IN p_Lockout DATETIME
            )
            BEGIN
                UPDATE member_credentials
                SET FailedLoginAttempts = p_Attempts,
                    LockoutEndTime = p_Lockout
                WHERE pk_member_credential_id = p_CredId;
            END");

        // 20. sp_auth_update_success_login
        await CreateOrReplaceProcedure(connection, "sp_auth_update_success_login", @"
            CREATE PROCEDURE sp_auth_update_success_login(
                IN p_CredId INT
            )
            BEGIN
                UPDATE member_credentials
                SET FailedLoginAttempts = 0,
                    LockoutEndTime = NULL,
                    LastLoginDate = NOW()
                WHERE pk_member_credential_id = p_CredId;
            END");

        // 21. sp_auth_check_admin_access
        await CreateOrReplaceProcedure(connection, "sp_auth_check_admin_access", @"
            CREATE PROCEDURE sp_auth_check_admin_access(
                IN p_MemberId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0
                  AND r.RoleName IN ('Admin', 'SuperAdmin', 'ZonalCoordinator');
            END");

        // 22. sp_auth_create_reset_token
        await CreateOrReplaceProcedure(connection, "sp_auth_create_reset_token", @"
            CREATE PROCEDURE sp_auth_create_reset_token(
                IN p_MemberId INT,
                IN p_Token VARCHAR(500),
                IN p_Expiry DATETIME
            )
            BEGIN
                INSERT INTO password_reset_tokens (
                    fk_member_master_profile_id, Token, ExpiryDate
                ) VALUES (
                    p_MemberId, p_Token, p_Expiry
                );
            END");

        // 23. sp_auth_get_valid_reset_token
        await CreateOrReplaceProcedure(connection, "sp_auth_get_valid_reset_token", @"
            CREATE PROCEDURE sp_auth_get_valid_reset_token(
                IN p_Token VARCHAR(500)
            )
            BEGIN
                SELECT
                    pk_password_reset_token_id AS Id,
                    fk_member_master_profile_id AS MemberId
                FROM password_reset_tokens
                WHERE Token = p_Token
                  AND IsUsed = 0
                  AND ExpiryDate > NOW();
            END");

        // 24. sp_auth_reset_password
        await CreateOrReplaceProcedure(connection, "sp_auth_reset_password", @"
            CREATE PROCEDURE sp_auth_reset_password(
                IN p_MemberId INT,
                IN p_Hash VARCHAR(500)
            )
            BEGIN
                UPDATE member_credentials
                SET PasswordHash = p_Hash,
                    IsTemporaryPassword = 0,
                    LastPasswordChangeDate = NOW(),
                    FailedLoginAttempts = 0,
                    LockoutEndTime = NULL
                WHERE fk_member_master_profile_id = p_MemberId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END");

        // 25. sp_auth_mark_token_used
        await CreateOrReplaceProcedure(connection, "sp_auth_mark_token_used", @"
            CREATE PROCEDURE sp_auth_mark_token_used(
                IN p_TokenId INT
            )
            BEGIN
                UPDATE password_reset_tokens
                SET IsUsed = 1,
                    UsedDate = NOW()
                WHERE pk_password_reset_token_id = p_TokenId;
            END");

        // 26. sp_auth_get_credentials_for_change
        await CreateOrReplaceProcedure(connection, "sp_auth_get_credentials_for_change", @"
            CREATE PROCEDURE sp_auth_get_credentials_for_change(
                IN p_MemberId INT
            )
            BEGIN
                SELECT
                    pk_member_credential_id AS Id,
                    PasswordHash
                FROM member_credentials
                WHERE fk_member_master_profile_id = p_MemberId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END");

        // 27. sp_auth_change_password
        await CreateOrReplaceProcedure(connection, "sp_auth_change_password", @"
            CREATE PROCEDURE sp_auth_change_password(
                IN p_CredId INT,
                IN p_Hash VARCHAR(500)
            )
            BEGIN
                UPDATE member_credentials
                SET PasswordHash = p_Hash,
                    IsTemporaryPassword = 0,
                    LastPasswordChangeDate = NOW()
                WHERE pk_member_credential_id = p_CredId;
            END");

        // ========== ROLE STORED PROCEDURES (13) ==========

        // 28. sp_role_assign_default
        await CreateOrReplaceProcedure(connection, "sp_role_assign_default", @"
            CREATE PROCEDURE sp_role_assign_default(
                IN p_MemberId INT
            )
            BEGIN
                INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy)
                SELECT p_MemberId, 1, p_MemberId FROM DUAL
                WHERE NOT EXISTS (
                    SELECT 1 FROM member_roles
                    WHERE fk_member_master_profile_id = p_MemberId
                      AND fk_role_id = 1
                      AND IsActive = 1
                      AND isdeleted = 0
                );
            END");

        // 29. sp_role_check_member_exists
        await CreateOrReplaceProcedure(connection, "sp_role_check_member_exists", @"
            CREATE PROCEDURE sp_role_check_member_exists(
                IN p_MemberId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_master_profile
                WHERE pk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END");

        // 30. sp_role_check_has_admin (club-specific)
        await CreateOrReplaceProcedure(connection, "sp_role_check_has_admin", @"
            CREATE PROCEDURE sp_role_check_has_admin(
                IN p_MemberId INT,
                IN p_ClubId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_roles
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 2
                  AND fk_club_id = p_ClubId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END");

        // 31. sp_role_assign_admin (club-specific)
        // Validates member does not have ZonalCoordinator or SuperAdmin role before assigning
        await CreateOrReplaceProcedure(connection, "sp_role_assign_admin", @"
            CREATE PROCEDURE sp_role_assign_admin(
                IN p_MemberId INT,
                IN p_ClubId INT,
                IN p_AssignedBy INT
            )
            BEGIN
                DECLARE v_HasConflict INT DEFAULT 0;

                -- Check if member has ZonalCoordinator or SuperAdmin role
                SELECT COUNT(*) INTO v_HasConflict
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1 AND mr.isdeleted = 0
                  AND r.RoleName IN ('SuperAdmin', 'ZonalCoordinator');

                IF v_HasConflict > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member already has SuperAdmin or Zonal Coordinator role. Cannot assign as Admin.';
                END IF;

                INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, AssignedBy)
                SELECT p_MemberId, 2, p_ClubId, p_AssignedBy FROM DUAL
                WHERE NOT EXISTS (
                    SELECT 1 FROM member_roles
                    WHERE fk_member_master_profile_id = p_MemberId
                      AND fk_role_id = 2
                      AND fk_club_id = p_ClubId
                      AND IsActive = 1
                      AND isdeleted = 0
                );
            END");

        // 32. sp_role_check_credentials_exist
        await CreateOrReplaceProcedure(connection, "sp_role_check_credentials_exist", @"
            CREATE PROCEDURE sp_role_check_credentials_exist(
                IN p_MemberId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_credentials
                WHERE fk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END");

        // 33. sp_role_update_credentials_for_admin
        await CreateOrReplaceProcedure(connection, "sp_role_update_credentials_for_admin", @"
            CREATE PROCEDURE sp_role_update_credentials_for_admin(
                IN p_MemberId INT,
                IN p_Hash VARCHAR(500),
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE member_credentials
                SET PasswordHash = p_Hash,
                    IsTemporaryPassword = 1,
                    IsActive = 1,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE fk_member_master_profile_id = p_MemberId;
            END");

        // 34. sp_role_create_credentials
        await CreateOrReplaceProcedure(connection, "sp_role_create_credentials", @"
            CREATE PROCEDURE sp_role_create_credentials(
                IN p_MemberId INT,
                IN p_Hash VARCHAR(500),
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO member_credentials (
                    fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by
                ) VALUES (
                    p_MemberId, p_Hash, 1, 1, p_CreatedBy
                );
            END");

        // 35. sp_role_get_member_email
        await CreateOrReplaceProcedure(connection, "sp_role_get_member_email", @"
            CREATE PROCEDURE sp_role_get_member_email(
                IN p_MemberId INT
            )
            BEGIN
                SELECT EmailId, MemberName, PrimaryMobileNumber
                FROM member_master_profile
                WHERE pk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END");

        // 36. sp_role_deactivate_admin (club-specific)
        await CreateOrReplaceProcedure(connection, "sp_role_deactivate_admin", @"
            CREATE PROCEDURE sp_role_deactivate_admin(
                IN p_MemberId INT,
                IN p_ClubId INT,
                IN p_RevokedBy INT
            )
            BEGIN
                UPDATE member_roles
                SET IsActive = 0,
                    RevokedDate = NOW(),
                    RevokedBy = p_RevokedBy
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 2
                  AND fk_club_id = p_ClubId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END");

        // 37. sp_role_deactivate_credentials
        await CreateOrReplaceProcedure(connection, "sp_role_deactivate_credentials", @"
            CREATE PROCEDURE sp_role_deactivate_credentials(
                IN p_MemberId INT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE member_credentials
                SET IsActive = 0,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE fk_member_master_profile_id = p_MemberId;
            END");

        // 38. sp_role_get_active_roles
        await CreateOrReplaceProcedure(connection, "sp_role_get_active_roles", @"
            CREATE PROCEDURE sp_role_get_active_roles(
                IN p_MemberId INT
            )
            BEGIN
                SELECT r.RoleName
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0;
            END");

        // 38b. sp_role_check_has_any_admin – check if member has Admin in ANY club
        await CreateOrReplaceProcedure(connection, "sp_role_check_has_any_admin", @"
            CREATE PROCEDURE sp_role_check_has_any_admin(
                IN p_MemberId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_roles
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 2
                  AND IsActive = 1
                  AND isdeleted = 0;
            END");

        // 38c. sp_role_check_has_superadmin – check if member has active SuperAdmin role
        await CreateOrReplaceProcedure(connection, "sp_role_check_has_superadmin", @"
            CREATE PROCEDURE sp_role_check_has_superadmin(
                IN p_MemberId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_roles
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 3
                  AND IsActive = 1
                  AND isdeleted = 0;
            END");

        // 39. sp_role_get_members_count
        await CreateOrReplaceProcedure(connection, "sp_role_get_members_count", @"
            CREATE PROCEDURE sp_role_get_members_count(
                IN p_Search VARCHAR(200)
            )
            BEGIN
                SELECT COUNT(*)
                FROM member_master_profile
                WHERE isdeleted = 0
                  AND (p_Search IS NULL
                       OR MemberName LIKE CONCAT('%', p_Search, '%')
                       OR EmailId LIKE CONCAT('%', p_Search, '%')
                       OR PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%'));
            END");

        // 40. sp_role_get_members_paginated
        await CreateOrReplaceProcedure(connection, "sp_role_get_members_paginated", @"
            CREATE PROCEDURE sp_role_get_members_paginated(
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
            BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    IFNULL(m.EmailId, '') AS EmailId,
                    IFNULL(m.PrimaryMobileNumber, '') AS PrimaryMobileNumber,
                    GROUP_CONCAT(DISTINCT r.RoleName) AS RoleNames,
                    MAX(CASE WHEN r.RoleName = 'Admin' AND mr.IsActive = 1 THEN 1 ELSE 0 END) AS HasAdminRole,
                    (SELECT COUNT(*) FROM member_credentials mc
                     WHERE mc.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND mc.IsActive = 1
                       AND mc.isdeleted = 0) AS HasCredentials
                FROM member_master_profile m
                LEFT JOIN member_roles mr
                    ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND mr.IsActive = 1
                    AND mr.isdeleted = 0
                LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE m.isdeleted = 0
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%'))
                GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber
                ORDER BY m.pk_member_master_profile_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END");

        // ========== DISTRICT STORED PROCEDURES (8) ==========

        // ========== ZONE STORED PROCEDURES (7) ==========

        // 58. sp_zone_get_all_count
        await CreateOrReplaceProcedure(connection, "sp_zone_get_all_count", @"
            CREATE PROCEDURE sp_zone_get_all_count(
                IN p_Search VARCHAR(200),
                IN p_IsActive INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM zone_master
                WHERE isdeleted = 0
                  AND (p_Search IS NULL OR ZoneName LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR IsActive = p_IsActive);
            END");

        // 59. sp_zone_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_zone_get_all_paginated", @"
            CREATE PROCEDURE sp_zone_get_all_paginated(
                IN p_Search VARCHAR(200),
                IN p_IsActive INT,
                IN p_PageSize INT,
                IN p_Offset INT
            )
            BEGIN
                SELECT
                    z.pk_zone_id AS Id,
                    z.ZoneName,
                    z.IsActive,
                    z.created_date AS CreatedDate,
                    (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS TotalDistricts,
                    (SELECT COUNT(*) FROM club_master c
                     JOIN district_master d2 ON d2.pk_district_id = c.fk_district_id AND d2.isdeleted = 0
                     WHERE d2.fk_zone_id = z.pk_zone_id AND c.isdeleted = 0) AS TotalClubs,
                    (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                     FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                     JOIN district_master d3 ON d3.pk_district_id = c2.fk_district_id AND d3.isdeleted = 0
                     WHERE d3.fk_zone_id = z.pk_zone_id AND cm.isdeleted = 0) AS TotalMembers,
                    coord.MemberName AS CoordinatorName,
                    coord.EmailId AS CoordinatorEmail
                FROM zone_master z
                LEFT JOIN (
                    SELECT mr.fk_zone_id, m.MemberName, m.EmailId
                    FROM member_roles mr
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                    WHERE mr.fk_role_id = 4 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
                ) coord ON coord.fk_zone_id = z.pk_zone_id
                WHERE z.isdeleted = 0
                  AND (p_Search IS NULL OR z.ZoneName LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR z.IsActive = p_IsActive)
                ORDER BY z.pk_zone_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END");

        // 60. sp_zone_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_zone_get_by_id", @"
            CREATE PROCEDURE sp_zone_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT
                    z.pk_zone_id AS Id,
                    z.ZoneName,
                    z.IsActive,
                    z.created_by AS CreatedBy,
                    z.created_date AS CreatedDate,
                    z.modified_by AS ModifiedBy,
                    z.modified_date AS ModifiedDate,
                    (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS TotalDistricts,
                    (SELECT COUNT(*) FROM club_master c
                     JOIN district_master d2 ON d2.pk_district_id = c.fk_district_id AND d2.isdeleted = 0
                     WHERE d2.fk_zone_id = z.pk_zone_id AND c.isdeleted = 0) AS TotalClubs,
                    (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                     FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                     JOIN district_master d3 ON d3.pk_district_id = c2.fk_district_id AND d3.isdeleted = 0
                     WHERE d3.fk_zone_id = z.pk_zone_id AND cm.isdeleted = 0) AS TotalMembers
                FROM zone_master z
                WHERE z.pk_zone_id = p_Id
                  AND z.isdeleted = 0;
            END");

        // 61. sp_zone_create
        await CreateOrReplaceProcedure(connection, "sp_zone_create", @"
            CREATE PROCEDURE sp_zone_create(
                IN p_ZoneName VARCHAR(100),
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO zone_master (ZoneName, IsActive, created_by, created_date)
                VALUES (p_ZoneName, p_IsActive, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID();
            END");

        // 62. sp_zone_update
        await CreateOrReplaceProcedure(connection, "sp_zone_update", @"
            CREATE PROCEDURE sp_zone_update(
                IN p_Id INT,
                IN p_ZoneName VARCHAR(100),
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE zone_master SET
                    ZoneName = p_ZoneName,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_zone_id = p_Id
                  AND isdeleted = 0;
            END");

        // 63. sp_zone_soft_delete
        await CreateOrReplaceProcedure(connection, "sp_zone_soft_delete", @"
            CREATE PROCEDURE sp_zone_soft_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE zone_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_zone_id = p_Id;
            END");

        // 64. sp_zone_check_duplicate
        await CreateOrReplaceProcedure(connection, "sp_zone_check_duplicate", @"
            CREATE PROCEDURE sp_zone_check_duplicate(
                IN p_ZoneName VARCHAR(100),
                IN p_ExcludeId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM zone_master
                WHERE isdeleted = 0
                  AND ZoneName = p_ZoneName
                  AND (p_ExcludeId IS NULL OR pk_zone_id != p_ExcludeId);
            END");

        // 65. sp_district_check_duplicate
        await CreateOrReplaceProcedure(connection, "sp_district_check_duplicate", @"
            CREATE PROCEDURE sp_district_check_duplicate(
                IN p_DistrictNumber VARCHAR(50),
                IN p_ExcludeId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM district_master
                WHERE isdeleted = 0
                  AND DistrictNumber = p_DistrictNumber
                  AND (p_ExcludeId IS NULL OR pk_district_id != p_ExcludeId);
            END");

        // 66. sp_club_check_duplicate
        await CreateOrReplaceProcedure(connection, "sp_club_check_duplicate", @"
            CREATE PROCEDURE sp_club_check_duplicate(
                IN p_ClubName VARCHAR(300),
                IN p_ClubRotaryId VARCHAR(50),
                IN p_ExcludeId INT
            )
            BEGIN
                SELECT
                    (SELECT COUNT(*) FROM club_master
                     WHERE isdeleted = 0
                       AND ClubName = p_ClubName
                       AND (p_ExcludeId IS NULL OR pk_club_id != p_ExcludeId)) AS NameDuplicate,
                    (SELECT COUNT(*) FROM club_master
                     WHERE isdeleted = 0
                       AND ClubRotaryId = p_ClubRotaryId
                       AND (p_ExcludeId IS NULL OR pk_club_id != p_ExcludeId)) AS RotaryIdDuplicate;
            END");

        // 41. sp_district_get_all_count
        await CreateOrReplaceProcedure(connection, "sp_district_get_all_count", @"
            CREATE PROCEDURE sp_district_get_all_count(
                IN p_Search VARCHAR(200),
                IN p_IsActive INT,
                IN p_ZoneId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM district_master d
                WHERE d.isdeleted = 0
                  AND (p_Search IS NULL OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR d.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId);
            END");

        // 42. sp_district_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_district_get_all_paginated", @"
            CREATE PROCEDURE sp_district_get_all_paginated(
                IN p_Search VARCHAR(200),
                IN p_IsActive INT,
                IN p_PageSize INT,
                IN p_Offset INT,
                IN p_ZoneId INT
            )
            BEGIN
                SELECT
                    d.pk_district_id AS Id,
                    d.DistrictNumber,
                    CASE
                        WHEN d.DistrictLogoPath IS NULL OR d.DistrictLogoPath = '' THEN NULL
                        WHEN d.DistrictLogoPath LIKE '/%' THEN d.DistrictLogoPath
                        ELSE CONCAT('/uploads/district/', d.DistrictLogoPath)
                    END AS DistrictLogoPath,
                    d.IsActive,
                    d.created_date AS CreatedDate,
                    d.fk_zone_id AS FkZoneId,
                    z.ZoneName,
                    (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS TotalClubs,
                    (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                     FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                     WHERE c2.fk_district_id = d.pk_district_id AND cm.isdeleted = 0) AS TotalMembers
                FROM district_master d
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
                WHERE d.isdeleted = 0
                  AND (p_Search IS NULL OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR d.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId)
                ORDER BY d.pk_district_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END");

        // 43. sp_district_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_district_get_by_id", @"
            CREATE PROCEDURE sp_district_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT
                    d.pk_district_id AS Id,
                    d.DistrictNumber,
                    CASE
                        WHEN d.DistrictLogoPath IS NULL OR d.DistrictLogoPath = '' THEN NULL
                        WHEN d.DistrictLogoPath LIKE '/%' THEN d.DistrictLogoPath
                        ELSE CONCAT('/uploads/district/', d.DistrictLogoPath)
                    END AS DistrictLogoPath,
                    d.IsActive,
                    d.created_by AS CreatedBy,
                    d.created_date AS CreatedDate,
                    d.modified_by AS ModifiedBy,
                    d.modified_date AS ModifiedDate,
                    d.fk_zone_id AS FkZoneId,
                    z.ZoneName,
                    (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS TotalClubs,
                    (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                     FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                     WHERE c2.fk_district_id = d.pk_district_id AND cm.isdeleted = 0) AS TotalMembers
                FROM district_master d
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
                WHERE d.pk_district_id = p_Id
                  AND d.isdeleted = 0;
            END");

        // 44. sp_district_create
        await CreateOrReplaceProcedure(connection, "sp_district_create", @"
            CREATE PROCEDURE sp_district_create(
                IN p_DistrictNumber VARCHAR(50),
                IN p_DistrictLogoPath VARCHAR(500),
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT,
                IN p_FkZoneId INT
            )
            BEGIN
                INSERT INTO district_master (DistrictNumber, DistrictLogoPath, IsActive, fk_zone_id, created_by, created_date)
                VALUES (p_DistrictNumber, p_DistrictLogoPath, p_IsActive, p_FkZoneId, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID();
            END");

        // 45. sp_district_update
        await CreateOrReplaceProcedure(connection, "sp_district_update", @"
            CREATE PROCEDURE sp_district_update(
                IN p_Id INT,
                IN p_DistrictNumber VARCHAR(50),
                IN p_DistrictLogoPath VARCHAR(500),
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT,
                IN p_FkZoneId INT
            )
            BEGIN
                UPDATE district_master SET
                    DistrictNumber = p_DistrictNumber,
                    DistrictLogoPath = p_DistrictLogoPath,
                    IsActive = p_IsActive,
                    fk_zone_id = p_FkZoneId,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_district_id = p_Id
                  AND isdeleted = 0;
            END");

        // 46. sp_district_soft_delete
        await CreateOrReplaceProcedure(connection, "sp_district_soft_delete", @"
            CREATE PROCEDURE sp_district_soft_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE district_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_district_id = p_Id;

                UPDATE club_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE fk_district_id = p_Id AND isdeleted = 0;

                UPDATE club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                SET cm.isdeleted = 1, cm.deleted_by = p_DeletedBy, cm.deleted_date = NOW()
                WHERE c.fk_district_id = p_Id AND cm.isdeleted = 0;
            END");

        // 47. sp_district_get_clubs
        await CreateOrReplaceProcedure(connection, "sp_district_get_clubs", @"
            CREATE PROCEDURE sp_district_get_clubs(
                IN p_DistrictId INT
            )
            BEGIN
                SELECT
                    c.pk_club_id AS Id,
                    c.fk_district_id AS FkDistrictId,
                    c.ClubRotaryId,
                    c.ClubName,
                    CASE
                        WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                        WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                        ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                    END AS ClubLogoPath,
                    c.MeetingDay,
                    c.City,
                    c.State,
                    c.IsActive,
                    (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS TotalMembers
                FROM club_master c
                WHERE c.fk_district_id = p_DistrictId
                  AND c.isdeleted = 0
                ORDER BY c.ClubName;
            END");

        // 48. sp_district_get_members
        await CreateOrReplaceProcedure(connection, "sp_district_get_members", @"
            CREATE PROCEDURE sp_district_get_members(
                IN p_DistrictId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
            BEGIN
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
                    m.RotaryId,
                    GROUP_CONCAT(DISTINCT c.ClubName ORDER BY c.ClubName SEPARATOR ', ') AS ClubNames
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE c.fk_district_id = p_DistrictId
                  AND m.isdeleted = 0
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath, m.EmailId, m.PrimaryMobileNumber, m.RotaryId
                ORDER BY m.MemberName
                LIMIT p_PageSize OFFSET p_Offset;
            END");

        // ========== CLUB STORED PROCEDURES (9) ==========

        // 49. sp_club_get_all_count
        await CreateOrReplaceProcedure(connection, "sp_club_get_all_count", @"
            CREATE PROCEDURE sp_club_get_all_count(
                IN p_Search VARCHAR(200),
                IN p_DistrictId INT,
                IN p_City VARCHAR(100),
                IN p_MeetingDay VARCHAR(20),
                IN p_IsActive INT,
                IN p_ZoneId INT
            )
            BEGIN
                SELECT COUNT(*)
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.isdeleted = 0
                  AND (p_Search IS NULL
                       OR c.ClubName LIKE CONCAT('%', p_Search, '%')
                       OR c.ClubRotaryId LIKE CONCAT('%', p_Search, '%')
                       OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_DistrictId IS NULL OR c.fk_district_id = p_DistrictId)
                  AND (p_City IS NULL OR c.City = p_City)
                  AND (p_MeetingDay IS NULL OR c.MeetingDay = p_MeetingDay)
                  AND (p_IsActive IS NULL OR c.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId);
            END");

        // 50. sp_club_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_club_get_all_paginated", @"
            CREATE PROCEDURE sp_club_get_all_paginated(
                IN p_Search VARCHAR(200),
                IN p_DistrictId INT,
                IN p_City VARCHAR(100),
                IN p_MeetingDay VARCHAR(20),
                IN p_IsActive INT,
                IN p_PageSize INT,
                IN p_Offset INT,
                IN p_ZoneId INT
            )
            BEGIN
                SELECT
                    c.pk_club_id AS Id,
                    c.fk_district_id AS FkDistrictId,
                    d.DistrictNumber,
                    c.ClubRotaryId,
                    c.ClubName,
                    CASE
                        WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                        WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                        ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                    END AS ClubLogoPath,
                    c.MeetingDay,
                    c.MeetingFromTime,
                    c.MeetingToTime,
                    c.City,
                    c.State,
                    c.IsActive,
                    c.created_date AS CreatedDate,
                    (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS TotalMembers
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.isdeleted = 0
                  AND (p_Search IS NULL
                       OR c.ClubName LIKE CONCAT('%', p_Search, '%')
                       OR c.ClubRotaryId LIKE CONCAT('%', p_Search, '%')
                       OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_DistrictId IS NULL OR c.fk_district_id = p_DistrictId)
                  AND (p_City IS NULL OR c.City = p_City)
                  AND (p_MeetingDay IS NULL OR c.MeetingDay = p_MeetingDay)
                  AND (p_IsActive IS NULL OR c.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId)
                ORDER BY c.pk_club_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END");

        // 51. sp_club_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_get_by_id", @"
            CREATE PROCEDURE sp_club_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT
                    c.pk_club_id AS Id,
                    c.fk_district_id AS FkDistrictId,
                    d.DistrictNumber,
                    c.ClubRotaryId,
                    c.ClubName,
                    c.Timezone,
                    c.ClubCharterDate,
                    CASE
                        WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                        WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                        ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                    END AS ClubLogoPath,
                    c.ClubWebsite,
                    c.MeetingDay,
                    c.MeetingFromTime,
                    c.MeetingToTime,
                    c.MeetingAddress,
                    c.Country,
                    c.State,
                    c.City,
                    c.Pincode,
                    c.ActiveFromDate,
                    c.ActiveToDate,
                    c.IsAutomaticMeetingReminder,
                    c.IsFamilyLogin,
                    c.IsActive,
                    c.created_by AS CreatedBy,
                    c.created_date AS CreatedDate,
                    c.modified_by AS ModifiedBy,
                    c.modified_date AS ModifiedDate,
                    (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS TotalMembers
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id = p_Id
                  AND c.isdeleted = 0;
            END");

        // 52. sp_club_create
        await CreateOrReplaceProcedure(connection, "sp_club_create", @"
            CREATE PROCEDURE sp_club_create(
                IN p_FkDistrictId INT,
                IN p_ClubRotaryId VARCHAR(50),
                IN p_ClubName VARCHAR(300),
                IN p_Timezone VARCHAR(100),
                IN p_ClubCharterDate DATE,
                IN p_ClubLogoPath VARCHAR(500),
                IN p_ClubWebsite VARCHAR(500),
                IN p_MeetingDay VARCHAR(20),
                IN p_MeetingFromTime TIME,
                IN p_MeetingToTime TIME,
                IN p_MeetingAddress TEXT,
                IN p_Country VARCHAR(100),
                IN p_State VARCHAR(100),
                IN p_City VARCHAR(100),
                IN p_Pincode VARCHAR(20),
                IN p_ActiveFromDate DATE,
                IN p_ActiveToDate DATE,
                IN p_IsAutomaticMeetingReminder TINYINT,
                IN p_IsFamilyLogin TINYINT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_master (
                    fk_district_id, ClubRotaryId, ClubName, Timezone, ClubCharterDate,
                    ClubLogoPath, ClubWebsite, MeetingDay, MeetingFromTime, MeetingToTime,
                    MeetingAddress, Country, State, City, Pincode,
                    ActiveFromDate, ActiveToDate, IsAutomaticMeetingReminder, IsFamilyLogin,
                    IsActive, created_by, created_date
                ) VALUES (
                    p_FkDistrictId, p_ClubRotaryId, p_ClubName, p_Timezone, p_ClubCharterDate,
                    p_ClubLogoPath, p_ClubWebsite, p_MeetingDay, p_MeetingFromTime, p_MeetingToTime,
                    p_MeetingAddress, p_Country, p_State, p_City, p_Pincode,
                    p_ActiveFromDate, p_ActiveToDate, p_IsAutomaticMeetingReminder, p_IsFamilyLogin,
                    p_IsActive, p_CreatedBy, NOW()
                );
                SELECT LAST_INSERT_ID();
            END");

        // 53. sp_club_update
        await CreateOrReplaceProcedure(connection, "sp_club_update", @"
            CREATE PROCEDURE sp_club_update(
                IN p_Id INT,
                IN p_FkDistrictId INT,
                IN p_ClubRotaryId VARCHAR(50),
                IN p_ClubName VARCHAR(300),
                IN p_Timezone VARCHAR(100),
                IN p_ClubCharterDate DATE,
                IN p_ClubLogoPath VARCHAR(500),
                IN p_ClubWebsite VARCHAR(500),
                IN p_MeetingDay VARCHAR(20),
                IN p_MeetingFromTime TIME,
                IN p_MeetingToTime TIME,
                IN p_MeetingAddress TEXT,
                IN p_Country VARCHAR(100),
                IN p_State VARCHAR(100),
                IN p_City VARCHAR(100),
                IN p_Pincode VARCHAR(20),
                IN p_ActiveFromDate DATE,
                IN p_ActiveToDate DATE,
                IN p_IsAutomaticMeetingReminder TINYINT,
                IN p_IsFamilyLogin TINYINT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_master SET
                    fk_district_id = p_FkDistrictId,
                    ClubRotaryId = p_ClubRotaryId,
                    ClubName = p_ClubName,
                    Timezone = p_Timezone,
                    ClubCharterDate = p_ClubCharterDate,
                    ClubLogoPath = p_ClubLogoPath,
                    ClubWebsite = p_ClubWebsite,
                    MeetingDay = p_MeetingDay,
                    MeetingFromTime = p_MeetingFromTime,
                    MeetingToTime = p_MeetingToTime,
                    MeetingAddress = p_MeetingAddress,
                    Country = p_Country,
                    State = p_State,
                    City = p_City,
                    Pincode = p_Pincode,
                    ActiveFromDate = p_ActiveFromDate,
                    ActiveToDate = p_ActiveToDate,
                    IsAutomaticMeetingReminder = p_IsAutomaticMeetingReminder,
                    IsFamilyLogin = p_IsFamilyLogin,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_club_id = p_Id
                  AND isdeleted = 0;
            END");

        // 54. sp_club_soft_delete
        await CreateOrReplaceProcedure(connection, "sp_club_soft_delete", @"
            CREATE PROCEDURE sp_club_soft_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_club_id = p_Id;

                UPDATE club_members
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE fk_club_id = p_Id AND isdeleted = 0;
            END");

        // 55. sp_club_get_members (Admin role filtered by club_id)
        await CreateOrReplaceProcedure(connection, "sp_club_get_members", @"
            CREATE PROCEDURE sp_club_get_members(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
            BEGIN
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
                    m.RotaryId,
                    cm.JoinedDate,
                    cm.pk_club_member_id AS ClubMemberId,
                    cm.IsActive AS MembershipActive,
                    GROUP_CONCAT(DISTINCT r.RoleName ORDER BY r.RoleName SEPARATOR ',') AS RoleNames,
                    MAX(CASE WHEN r.RoleName = 'Admin' AND mr.IsActive = 1 THEN 1 ELSE 0 END) AS HasAdminRole
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                LEFT JOIN member_roles mr
                    ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND mr.IsActive = 1
                    AND mr.isdeleted = 0
                    AND (
                        (mr.fk_role_id = 2 AND mr.fk_club_id = p_ClubId)
                        OR mr.fk_role_id != 2
                    )
                LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 0
                  AND m.isdeleted = 0
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath,
                         m.EmailId, m.PrimaryMobileNumber, m.RotaryId,
                         cm.JoinedDate, cm.pk_club_member_id, cm.IsActive
                ORDER BY m.MemberName
                LIMIT p_PageSize OFFSET p_Offset;
            END");

        // 56. sp_club_add_member
        await CreateOrReplaceProcedure(connection, "sp_club_add_member", @"
            CREATE PROCEDURE sp_club_add_member(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_JoinedDate DATE,
                IN p_CreatedBy INT
            )
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM club_members
                    WHERE fk_club_id = p_ClubId
                      AND fk_member_master_profile_id = p_MemberId
                      AND isdeleted = 0
                ) THEN
                    INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_by, created_date)
                    VALUES (p_ClubId, p_MemberId, p_JoinedDate, 1, p_CreatedBy, NOW());
                    SELECT LAST_INSERT_ID() AS Id;
                ELSE
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member is already in this club.';
                END IF;
            END");

        // 57. sp_club_remove_member
        await CreateOrReplaceProcedure(connection, "sp_club_remove_member", @"
            CREATE PROCEDURE sp_club_remove_member(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_members
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE fk_club_id = p_ClubId
                  AND fk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END");

        // ========== MODULE MANAGEMENT STORED PROCEDURES ==========

        // 58. sp_module_category_get_all
        await CreateOrReplaceProcedure(connection, "sp_module_category_get_all", @"
            CREATE PROCEDURE sp_module_category_get_all()
            BEGIN
                SELECT pk_category_id AS Id, CategoryName, SortOrder, IsActive
                FROM module_categories
                WHERE isdeleted = 0
                ORDER BY SortOrder;
            END");

        // 59. sp_module_category_create
        await CreateOrReplaceProcedure(connection, "sp_module_category_create", @"
            CREATE PROCEDURE sp_module_category_create(
                IN p_CategoryName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO module_categories (CategoryName, SortOrder, IsActive, created_by, created_date)
                VALUES (p_CategoryName, p_SortOrder, 1, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID() AS Id;
            END");

        // 60. sp_module_category_update
        await CreateOrReplaceProcedure(connection, "sp_module_category_update", @"
            CREATE PROCEDURE sp_module_category_update(
                IN p_Id INT,
                IN p_CategoryName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE module_categories
                SET CategoryName = p_CategoryName,
                    SortOrder = p_SortOrder,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END");

        // 61. sp_module_category_delete
        await CreateOrReplaceProcedure(connection, "sp_module_category_delete", @"
            CREATE PROCEDURE sp_module_category_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE module_categories
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END");

        // 62. sp_module_get_all
        await CreateOrReplaceProcedure(connection, "sp_module_get_all", @"
            CREATE PROCEDURE sp_module_get_all()
            BEGIN
                SELECT m.pk_module_id AS Id, m.ModuleName, m.ModuleKey,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       m.ModuleLevel, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.IsDefaultForDistrict, m.IsDefaultForClub,
                       m.SortOrder, m.IsActive
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id
                WHERE m.isdeleted = 0
                ORDER BY c.SortOrder, m.SortOrder;
            END");

        // 63. sp_module_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_module_get_by_id", @"
            CREATE PROCEDURE sp_module_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT m.pk_module_id AS Id, m.ModuleName, m.ModuleKey,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       m.ModuleLevel, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.IsDefaultForDistrict, m.IsDefaultForClub,
                       m.SortOrder, m.IsActive
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id
                WHERE m.pk_module_id = p_Id AND m.isdeleted = 0;
            END");

        // 64. sp_module_create
        await CreateOrReplaceProcedure(connection, "sp_module_create", @"
            CREATE PROCEDURE sp_module_create(
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(100),
                IN p_CategoryId INT,
                IN p_ModuleLevel ENUM('District','Club','Both'),
                IN p_IconClass VARCHAR(100),
                IN p_IconPath VARCHAR(200),
                IN p_Description VARCHAR(500),
                IN p_RouteUrl VARCHAR(200),
                IN p_IsDefaultForDistrict TINYINT,
                IN p_IsDefaultForClub TINYINT,
                IN p_SortOrder INT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO module_master (ModuleName, ModuleKey, fk_category_id, ModuleLevel, IconClass, IconPath, Description, RouteUrl, IsDefaultForDistrict, IsDefaultForClub, SortOrder, IsActive, created_by, created_date)
                VALUES (p_ModuleName, p_ModuleKey, p_CategoryId, p_ModuleLevel, p_IconClass, p_IconPath, p_Description, p_RouteUrl, p_IsDefaultForDistrict, p_IsDefaultForClub, p_SortOrder, 1, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID() AS Id;
            END");

        // 65. sp_module_update
        await CreateOrReplaceProcedure(connection, "sp_module_update", @"
            CREATE PROCEDURE sp_module_update(
                IN p_Id INT,
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(100),
                IN p_CategoryId INT,
                IN p_ModuleLevel ENUM('District','Club','Both'),
                IN p_IconClass VARCHAR(100),
                IN p_IconPath VARCHAR(200),
                IN p_Description VARCHAR(500),
                IN p_RouteUrl VARCHAR(200),
                IN p_IsDefaultForDistrict TINYINT,
                IN p_IsDefaultForClub TINYINT,
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE module_master
                SET ModuleName = p_ModuleName,
                    ModuleKey = p_ModuleKey,
                    fk_category_id = p_CategoryId,
                    ModuleLevel = p_ModuleLevel,
                    IconClass = p_IconClass,
                    IconPath = p_IconPath,
                    Description = p_Description,
                    RouteUrl = p_RouteUrl,
                    IsDefaultForDistrict = p_IsDefaultForDistrict,
                    IsDefaultForClub = p_IsDefaultForClub,
                    SortOrder = p_SortOrder,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_module_id = p_Id AND isdeleted = 0;
            END");

        // 66. sp_module_delete
        await CreateOrReplaceProcedure(connection, "sp_module_delete", @"
            CREATE PROCEDURE sp_module_delete(
                IN p_Id INT
            )
            BEGIN
                DELETE FROM module_master WHERE pk_module_id = p_Id AND isdeleted = 0;
            END");

        // 67. sp_module_get_usage_count
        await CreateOrReplaceProcedure(connection, "sp_module_get_usage_count", @"
            CREATE PROCEDURE sp_module_get_usage_count(
                IN p_ModuleId INT
            )
            BEGIN
                SELECT
                    (SELECT COUNT(*) FROM district_modules WHERE fk_module_id = p_ModuleId) AS DistrictCount,
                    (SELECT COUNT(*) FROM club_modules WHERE fk_module_id = p_ModuleId) AS ClubCount;
            END");

        // 68. sp_district_modules_get
        await CreateOrReplaceProcedure(connection, "sp_district_modules_get", @"
            CREATE PROCEDURE sp_district_modules_get(
                IN p_DistrictId INT
            )
            BEGIN
                SELECT dm.pk_district_module_id AS Id, dm.fk_module_id AS ModuleId,
                       m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       dm.IsEnabled
                FROM district_modules dm
                JOIN module_master m ON m.pk_module_id = dm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                WHERE dm.fk_district_id = p_DistrictId
                ORDER BY c.SortOrder, m.SortOrder;
            END");

        // 69. sp_district_modules_assign
        await CreateOrReplaceProcedure(connection, "sp_district_modules_assign", @"
            CREATE PROCEDURE sp_district_modules_assign(
                IN p_DistrictId INT,
                IN p_ModuleId INT,
                IN p_AssignedBy INT
            )
            BEGIN
                INSERT IGNORE INTO district_modules (fk_district_id, fk_module_id, IsEnabled, AssignedBy)
                VALUES (p_DistrictId, p_ModuleId, 1, p_AssignedBy);
            END");

        // 70. sp_district_modules_unassign
        await CreateOrReplaceProcedure(connection, "sp_district_modules_unassign", @"
            CREATE PROCEDURE sp_district_modules_unassign(
                IN p_DistrictId INT,
                IN p_ModuleId INT
            )
            BEGIN
                DELETE FROM district_modules
                WHERE fk_district_id = p_DistrictId AND fk_module_id = p_ModuleId;
            END");

        // 71. sp_district_modules_get_available
        await CreateOrReplaceProcedure(connection, "sp_district_modules_get_available", @"
            CREATE PROCEDURE sp_district_modules_get_available(
                IN p_DistrictId INT
            )
            BEGIN
                SELECT m.pk_module_id AS ModuleId, m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       IF(dm.pk_district_module_id IS NOT NULL, 1, 0) AS IsAssigned
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                LEFT JOIN district_modules dm ON dm.fk_module_id = m.pk_module_id AND dm.fk_district_id = p_DistrictId
                WHERE m.isdeleted = 0 AND m.IsActive = 1 AND m.ModuleLevel IN ('District', 'Both')
                ORDER BY c.SortOrder, m.SortOrder;
            END");

        // 72. sp_club_modules_get
        await CreateOrReplaceProcedure(connection, "sp_club_modules_get", @"
            CREATE PROCEDURE sp_club_modules_get(
                IN p_ClubId INT
            )
            BEGIN
                SELECT cm.pk_club_module_id AS Id, cm.fk_module_id AS ModuleId,
                       m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       cm.IsEnabled
                FROM club_modules cm
                JOIN module_master m ON m.pk_module_id = cm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                WHERE cm.fk_club_id = p_ClubId
                ORDER BY c.SortOrder, m.SortOrder;
            END");

        // 73. sp_club_modules_assign
        await CreateOrReplaceProcedure(connection, "sp_club_modules_assign", @"
            CREATE PROCEDURE sp_club_modules_assign(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_AssignedBy INT
            )
            BEGIN
                INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
                VALUES (p_ClubId, p_ModuleId, 1, p_AssignedBy);
            END");

        // 74. sp_club_modules_unassign
        await CreateOrReplaceProcedure(connection, "sp_club_modules_unassign", @"
            CREATE PROCEDURE sp_club_modules_unassign(
                IN p_ClubId INT,
                IN p_ModuleId INT
            )
            BEGIN
                DELETE FROM club_modules
                WHERE fk_club_id = p_ClubId AND fk_module_id = p_ModuleId;
            END");

        // 75. sp_club_modules_get_available
        await CreateOrReplaceProcedure(connection, "sp_club_modules_get_available", @"
            CREATE PROCEDURE sp_club_modules_get_available(
                IN p_ClubId INT
            )
            BEGIN
                SELECT m.pk_module_id AS ModuleId, m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       IF(cm.pk_club_module_id IS NOT NULL, 1, 0) AS IsAssigned
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                LEFT JOIN club_modules cm ON cm.fk_module_id = m.pk_module_id AND cm.fk_club_id = p_ClubId
                WHERE m.isdeleted = 0 AND m.IsActive = 1 AND m.ModuleLevel IN ('Club', 'Both')
                ORDER BY c.SortOrder, m.SortOrder;
            END");

        // 76. sp_district_dashboard_get
        await CreateOrReplaceProcedure(connection, "sp_district_dashboard_get", @"
            CREATE PROCEDURE sp_district_dashboard_get(
                IN p_DistrictId INT
            )
            BEGIN
                SELECT pk_district_id AS Id, DistrictNumber,
                       CASE
                           WHEN DistrictLogoPath IS NULL OR DistrictLogoPath = '' THEN NULL
                           WHEN DistrictLogoPath LIKE '/%' THEN DistrictLogoPath
                           ELSE CONCAT('/uploads/district/', DistrictLogoPath)
                       END AS DistrictLogoPath,
                       IsActive
                FROM district_master
                WHERE pk_district_id = p_DistrictId AND isdeleted = 0;
            END");

        // 77. sp_club_dashboard_get
        await CreateOrReplaceProcedure(connection, "sp_club_dashboard_get", @"
            CREATE PROCEDURE sp_club_dashboard_get(
                IN p_ClubId INT
            )
            BEGIN
                SELECT c.pk_club_id AS Id, c.ClubName,
                       CASE
                           WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                           WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                           ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                       END AS ClubLogoPath,
                       c.IsActive,
                       d.DistrictNumber
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id = p_ClubId AND c.isdeleted = 0;
            END");

        // 78. sp_district_modules_assign_defaults
        await CreateOrReplaceProcedure(connection, "sp_district_modules_assign_defaults", @"
            CREATE PROCEDURE sp_district_modules_assign_defaults(
                IN p_DistrictId INT,
                IN p_AssignedBy INT
            )
            BEGIN
                INSERT IGNORE INTO district_modules (fk_district_id, fk_module_id, IsEnabled, AssignedBy)
                SELECT p_DistrictId, pk_module_id, 1, p_AssignedBy
                FROM module_master
                WHERE IsDefaultForDistrict = 1 AND ModuleLevel IN ('District', 'Both') AND IsActive = 1 AND isdeleted = 0;
            END");

        // 79. sp_club_modules_assign_defaults
        await CreateOrReplaceProcedure(connection, "sp_club_modules_assign_defaults", @"
            CREATE PROCEDURE sp_club_modules_assign_defaults(
                IN p_ClubId INT,
                IN p_AssignedBy INT
            )
            BEGIN
                INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
                SELECT p_ClubId, pk_module_id, 1, p_AssignedBy
                FROM module_master
                WHERE IsDefaultForClub = 1 AND ModuleLevel IN ('Club', 'Both') AND IsActive = 1 AND isdeleted = 0;
            END");

        // ========== ROTARY YEAR STORED PROCEDURES ==========

        // 80. sp_rotary_year_get_all
        await CreateOrReplaceProcedure(connection, "sp_rotary_year_get_all", @"
            CREATE PROCEDURE sp_rotary_year_get_all()
            BEGIN
                SELECT pk_year_id AS Id, YearLabel, StartDate, EndDate, IsCurrent
                FROM rotary_year_master
                WHERE isdeleted = 0
                ORDER BY StartDate DESC;
            END");

        // 81. sp_rotary_year_get_current
        await CreateOrReplaceProcedure(connection, "sp_rotary_year_get_current", @"
            CREATE PROCEDURE sp_rotary_year_get_current()
            BEGIN
                SELECT pk_year_id AS Id, YearLabel, StartDate, EndDate, IsCurrent
                FROM rotary_year_master
                WHERE IsCurrent = 1 AND isdeleted = 0
                LIMIT 1;
            END");

        // ========== PAST PRESIDENT STORED PROCEDURES ==========

        // 82. sp_past_president_get_by_club
        await CreateOrReplaceProcedure(connection, "sp_past_president_get_by_club", @"
            CREATE PROCEDURE sp_past_president_get_by_club(
                IN p_ClubId INT
            )
            BEGIN
                SELECT
                    pp.pk_past_president_id AS Id,
                    pp.fk_club_id AS ClubId,
                    pp.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    pp.fk_year_id AS YearId,
                    y.YearLabel
                FROM past_presidents pp
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
                WHERE pp.fk_club_id = p_ClubId AND pp.isdeleted = 0
                ORDER BY y.StartDate DESC;
            END");

        // 83. sp_past_president_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_past_president_get_by_id", @"
            CREATE PROCEDURE sp_past_president_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT
                    pp.pk_past_president_id AS Id,
                    pp.fk_club_id AS ClubId,
                    pp.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    pp.fk_year_id AS YearId,
                    y.YearLabel
                FROM past_presidents pp
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
                WHERE pp.pk_past_president_id = p_Id AND pp.isdeleted = 0;
            END");

        // 84. sp_past_president_create
        await CreateOrReplaceProcedure(connection, "sp_past_president_create", @"
            CREATE PROCEDURE sp_past_president_create(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_YearId INT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO past_presidents (fk_club_id, fk_member_master_profile_id, fk_year_id, created_by)
                VALUES (p_ClubId, p_MemberId, p_YearId, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 85. sp_past_president_update
        await CreateOrReplaceProcedure(connection, "sp_past_president_update", @"
            CREATE PROCEDURE sp_past_president_update(
                IN p_Id INT,
                IN p_MemberId INT,
                IN p_YearId INT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE past_presidents
                SET fk_member_master_profile_id = p_MemberId,
                    fk_year_id = p_YearId,
                    modified_by = p_ModifiedBy
                WHERE pk_past_president_id = p_Id AND isdeleted = 0;
            END");

        // 86. sp_past_president_delete
        await CreateOrReplaceProcedure(connection, "sp_past_president_delete", @"
            CREATE PROCEDURE sp_past_president_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE past_presidents
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_past_president_id = p_Id;
            END");

        // 87. sp_past_president_search_club_members
        await CreateOrReplaceProcedure(connection, "sp_past_president_search_club_members", @"
            CREATE PROCEDURE sp_past_president_search_club_members(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200)
            )
            BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath
                FROM club_members cm
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 0
                  AND m.isdeleted = 0
                  AND (p_Search = '' OR m.MemberName LIKE CONCAT('%', p_Search, '%'))
                ORDER BY m.MemberName
                LIMIT 20;
            END");

        // ========== DESIGNATION MASTER STORED PROCEDURES ==========

        // 88. sp_designation_get_all
        await CreateOrReplaceProcedure(connection, "sp_designation_get_all", @"
            CREATE PROCEDURE sp_designation_get_all()
            BEGIN
                SELECT
                    pk_designation_id AS Id,
                    designation_name AS DesignationName,
                    sort_order AS SortOrder
                FROM designation_master
                WHERE isdeleted = 0
                ORDER BY sort_order;
            END");

        // 89. sp_designation_create
        await CreateOrReplaceProcedure(connection, "sp_designation_create", @"
            CREATE PROCEDURE sp_designation_create(
                IN p_DesignationName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO designation_master (designation_name, sort_order, created_by)
                VALUES (p_DesignationName, p_SortOrder, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 90. sp_designation_update
        await CreateOrReplaceProcedure(connection, "sp_designation_update", @"
            CREATE PROCEDURE sp_designation_update(
                IN p_Id INT,
                IN p_DesignationName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE designation_master
                SET designation_name = p_DesignationName,
                    sort_order = p_SortOrder,
                    modified_by = p_ModifiedBy
                WHERE pk_designation_id = p_Id AND isdeleted = 0;
            END");

        // 91. sp_designation_delete
        await CreateOrReplaceProcedure(connection, "sp_designation_delete", @"
            CREATE PROCEDURE sp_designation_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE designation_master
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_designation_id = p_Id;
            END");

        // ========== BOARD OF DIRECTORS STORED PROCEDURES ==========

        // 92. sp_board_director_get_by_club (filtered by year)
        await CreateOrReplaceProcedure(connection, "sp_board_director_get_by_club", @"
            CREATE PROCEDURE sp_board_director_get_by_club(
                IN p_ClubId INT,
                IN p_YearId INT
            )
            BEGIN
                SELECT
                    bd.pk_board_director_id AS Id,
                    bd.fk_club_id AS ClubId,
                    bd.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    bd.fk_designation_id AS DesignationId,
                    d.designation_name AS DesignationName,
                    bd.fk_year_id AS YearId,
                    y.YearLabel
                FROM board_of_directors bd
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
                WHERE bd.fk_club_id = p_ClubId AND bd.fk_year_id = p_YearId AND bd.isdeleted = 0
                ORDER BY d.sort_order;
            END");

        // 93. sp_board_director_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_board_director_get_by_id", @"
            CREATE PROCEDURE sp_board_director_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT
                    bd.pk_board_director_id AS Id,
                    bd.fk_club_id AS ClubId,
                    bd.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    bd.fk_designation_id AS DesignationId,
                    d.designation_name AS DesignationName,
                    bd.fk_year_id AS YearId,
                    y.YearLabel
                FROM board_of_directors bd
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
                WHERE bd.pk_board_director_id = p_Id AND bd.isdeleted = 0;
            END");

        // 94. sp_board_director_create
        await CreateOrReplaceProcedure(connection, "sp_board_director_create", @"
            CREATE PROCEDURE sp_board_director_create(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_DesignationId INT,
                IN p_YearId INT,
                IN p_CreatedBy INT
            )
            BEGIN
                DECLARE v_DesName VARCHAR(100);
                DECLARE v_OtherRole VARCHAR(100);
                DECLARE v_ErrMsg VARCHAR(200);
                SELECT designation_name INTO v_DesName FROM designation_master WHERE pk_designation_id = p_DesignationId AND isdeleted = 0;

                IF v_DesName IN ('Club President', 'Club Secretary') THEN
                    -- Only one President / one Secretary per club per year
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = p_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND d.designation_name = v_DesName
                        AND bd.isdeleted = 0
                    ) THEN
                        SET v_ErrMsg = CONCAT('Only one ', v_DesName, ' is allowed per club per year.');
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_ErrMsg;
                    END IF;

                    -- Same member cannot be both President and Secretary for same club+year
                    SET v_OtherRole = IF(v_DesName = 'Club President', 'Club Secretary', 'Club President');
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = p_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND bd.fk_member_master_profile_id = p_MemberId
                        AND d.designation_name = v_OtherRole
                        AND bd.isdeleted = 0
                    ) THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Same member cannot be both Club President and Club Secretary for the same year.';
                    END IF;
                END IF;

                INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, fk_designation_id, fk_year_id, created_by)
                VALUES (p_ClubId, p_MemberId, p_DesignationId, p_YearId, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 95. sp_board_director_update
        await CreateOrReplaceProcedure(connection, "sp_board_director_update", @"
            CREATE PROCEDURE sp_board_director_update(
                IN p_Id INT,
                IN p_MemberId INT,
                IN p_DesignationId INT,
                IN p_YearId INT,
                IN p_ModifiedBy INT
            )
            BEGIN
                DECLARE v_DesName VARCHAR(100);
                DECLARE v_OtherRole VARCHAR(100);
                DECLARE v_ErrMsg VARCHAR(200);
                DECLARE v_ClubId INT;
                SELECT fk_club_id INTO v_ClubId FROM board_of_directors WHERE pk_board_director_id = p_Id AND isdeleted = 0;
                SELECT designation_name INTO v_DesName FROM designation_master WHERE pk_designation_id = p_DesignationId AND isdeleted = 0;

                IF v_DesName IN ('Club President', 'Club Secretary') THEN
                    -- Only one President / one Secretary per club per year
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = v_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND d.designation_name = v_DesName
                        AND bd.isdeleted = 0
                        AND bd.pk_board_director_id != p_Id
                    ) THEN
                        SET v_ErrMsg = CONCAT('Only one ', v_DesName, ' is allowed per club per year.');
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_ErrMsg;
                    END IF;

                    -- Same member cannot be both President and Secretary for same club+year
                    SET v_OtherRole = IF(v_DesName = 'Club President', 'Club Secretary', 'Club President');
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = v_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND bd.fk_member_master_profile_id = p_MemberId
                        AND d.designation_name = v_OtherRole
                        AND bd.isdeleted = 0
                        AND bd.pk_board_director_id != p_Id
                    ) THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Same member cannot be both Club President and Club Secretary for the same year.';
                    END IF;
                END IF;

                UPDATE board_of_directors
                SET fk_member_master_profile_id = p_MemberId,
                    fk_designation_id = p_DesignationId,
                    fk_year_id = p_YearId,
                    modified_by = p_ModifiedBy
                WHERE pk_board_director_id = p_Id AND isdeleted = 0;
            END");

        // 96. sp_board_director_delete
        await CreateOrReplaceProcedure(connection, "sp_board_director_delete", @"
            CREATE PROCEDURE sp_board_director_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE board_of_directors
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_board_director_id = p_Id;
            END");

        // 97. sp_designation_swap_order
        await CreateOrReplaceProcedure(connection, "sp_designation_swap_order", @"
            CREATE PROCEDURE sp_designation_swap_order(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
            BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM designation_master WHERE pk_designation_id = p_Id1 AND isdeleted = 0;
                SELECT sort_order INTO v_Order2 FROM designation_master WHERE pk_designation_id = p_Id2 AND isdeleted = 0;
                UPDATE designation_master SET sort_order = v_Order2 WHERE pk_designation_id = p_Id1;
                UPDATE designation_master SET sort_order = v_Order1 WHERE pk_designation_id = p_Id2;
            END");

        // 98. sp_board_director_get_years_by_club — distinct years that have board data
        await CreateOrReplaceProcedure(connection, "sp_board_director_get_years_by_club", @"
            CREATE PROCEDURE sp_board_director_get_years_by_club(
                IN p_ClubId INT
            )
            BEGIN
                SELECT DISTINCT
                    y.pk_year_id AS Id,
                    y.YearLabel,
                    y.StartDate,
                    y.EndDate,
                    y.IsCurrent
                FROM board_of_directors bd
                INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
                WHERE bd.fk_club_id = p_ClubId AND bd.isdeleted = 0
                ORDER BY y.StartDate DESC;
            END");

        // ========== WEBSITE DATA MODULE MASTER STORED PROCEDURES ==========

        // 99. sp_website_data_module_get_all
        await CreateOrReplaceProcedure(connection, "sp_website_data_module_get_all", @"
            CREATE PROCEDURE sp_website_data_module_get_all()
            BEGIN
                SELECT
                    pk_website_data_module_id AS Id,
                    module_name AS ModuleName,
                    module_key AS ModuleKey,
                    icon_class AS IconClass,
                    sort_order AS SortOrder
                FROM website_data_module_master
                WHERE isdeleted = 0
                ORDER BY sort_order;
            END");

        // 100. sp_website_data_module_create
        await CreateOrReplaceProcedure(connection, "sp_website_data_module_create", @"
            CREATE PROCEDURE sp_website_data_module_create(
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(50),
                IN p_IconClass VARCHAR(50),
                IN p_CreatedBy INT
            )
            BEGIN
                DECLARE v_MaxSort INT;
                SELECT COALESCE(MAX(sort_order), 0) INTO v_MaxSort FROM website_data_module_master WHERE isdeleted = 0;
                INSERT INTO website_data_module_master (module_name, module_key, icon_class, sort_order, created_by)
                VALUES (p_ModuleName, p_ModuleKey, p_IconClass, v_MaxSort + 1, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 101. sp_website_data_module_update
        await CreateOrReplaceProcedure(connection, "sp_website_data_module_update", @"
            CREATE PROCEDURE sp_website_data_module_update(
                IN p_Id INT,
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(50),
                IN p_IconClass VARCHAR(50),
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE website_data_module_master
                SET module_name = p_ModuleName,
                    module_key = p_ModuleKey,
                    icon_class = p_IconClass,
                    modified_by = p_ModifiedBy
                WHERE pk_website_data_module_id = p_Id AND isdeleted = 0;
            END");

        // 102. sp_website_data_module_delete
        await CreateOrReplaceProcedure(connection, "sp_website_data_module_delete", @"
            CREATE PROCEDURE sp_website_data_module_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE website_data_module_master
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_website_data_module_id = p_Id;
            END");

        // 103. sp_website_data_module_swap_order
        await CreateOrReplaceProcedure(connection, "sp_website_data_module_swap_order", @"
            CREATE PROCEDURE sp_website_data_module_swap_order(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
            BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM website_data_module_master WHERE pk_website_data_module_id = p_Id1 AND isdeleted = 0;
                SELECT sort_order INTO v_Order2 FROM website_data_module_master WHERE pk_website_data_module_id = p_Id2 AND isdeleted = 0;
                UPDATE website_data_module_master SET sort_order = v_Order2 WHERE pk_website_data_module_id = p_Id1;
                UPDATE website_data_module_master SET sort_order = v_Order1 WHERE pk_website_data_module_id = p_Id2;
            END");

        // 104. sp_theme_get_all
        await CreateOrReplaceProcedure(connection, "sp_theme_get_all", @"
            CREATE PROCEDURE sp_theme_get_all()
            BEGIN
                SELECT pk_theme_id AS Id,
                       theme_name AS ThemeName,
                       CASE
                           WHEN theme_image_path IS NULL OR theme_image_path = '' THEN NULL
                           WHEN theme_image_path LIKE '/%' THEN theme_image_path
                           ELSE CONCAT('/uploads/theme/', theme_image_path)
                       END AS ThemeImagePath
                FROM theme_master
                WHERE isdeleted = 0
                ORDER BY theme_name;
            END");

        // 105. sp_theme_create
        await CreateOrReplaceProcedure(connection, "sp_theme_create", @"
            CREATE PROCEDURE sp_theme_create(
                IN p_ThemeName VARCHAR(100),
                IN p_ThemeImagePath VARCHAR(500),
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO theme_master (theme_name, theme_image_path, created_by)
                VALUES (p_ThemeName, p_ThemeImagePath, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 106. sp_theme_update
        await CreateOrReplaceProcedure(connection, "sp_theme_update", @"
            CREATE PROCEDURE sp_theme_update(
                IN p_Id INT,
                IN p_ThemeName VARCHAR(100),
                IN p_ThemeImagePath VARCHAR(500),
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE theme_master
                SET theme_name = p_ThemeName,
                    theme_image_path = p_ThemeImagePath,
                    modified_by = p_ModifiedBy
                WHERE pk_theme_id = p_Id;
            END");

        // 107. sp_theme_delete
        await CreateOrReplaceProcedure(connection, "sp_theme_delete", @"
            CREATE PROCEDURE sp_theme_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE theme_master
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_theme_id = p_Id;
            END");

        // 108. sp_club_theme_get
        await CreateOrReplaceProcedure(connection, "sp_club_theme_get", @"
            CREATE PROCEDURE sp_club_theme_get(
                IN p_ClubId INT,
                IN p_YearId INT
            )
            BEGIN
                SELECT cwt.pk_club_website_theme_id AS Id,
                       cwt.fk_club_id AS ClubId,
                       cwt.fk_year_id AS YearId,
                       y.YearLabel,
                       cwt.fk_theme_id AS ThemeId,
                       t.theme_name AS ThemeName,
                       CASE
                           WHEN t.theme_image_path IS NULL OR t.theme_image_path = '' THEN NULL
                           WHEN t.theme_image_path LIKE '/%' THEN t.theme_image_path
                           ELSE CONCAT('/uploads/theme/', t.theme_image_path)
                       END AS ThemeImagePath
                FROM club_website_theme cwt
                JOIN theme_master t ON t.pk_theme_id = cwt.fk_theme_id
                JOIN rotary_year_master y ON y.pk_year_id = cwt.fk_year_id
                WHERE cwt.fk_club_id = p_ClubId AND cwt.fk_year_id = p_YearId
                LIMIT 1;
            END");

        // 109. sp_club_theme_save
        await CreateOrReplaceProcedure(connection, "sp_club_theme_save", @"
            CREATE PROCEDURE sp_club_theme_save(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_ThemeId INT,
                IN p_UserId INT
            )
            BEGIN
                INSERT INTO club_website_theme (fk_club_id, fk_year_id, fk_theme_id, created_by)
                VALUES (p_ClubId, p_YearId, p_ThemeId, p_UserId)
                ON DUPLICATE KEY UPDATE fk_theme_id = p_ThemeId, modified_by = p_UserId, modified_date = NOW();
            END");

        // 110. sp_club_banner_get_by_club
        await CreateOrReplaceProcedure(connection, "sp_club_banner_get_by_club", @"
            CREATE PROCEDURE sp_club_banner_get_by_club(
                IN p_ClubId INT,
                IN p_YearId INT
            )
            BEGIN
                SELECT b.pk_club_website_banner_id AS Id,
                       b.fk_club_id AS ClubId,
                       b.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN b.banner_image_path IS NULL OR b.banner_image_path = '' THEN NULL
                           WHEN b.banner_image_path LIKE '/%' THEN b.banner_image_path
                           ELSE CONCAT('/uploads/banner/', b.banner_image_path)
                       END AS BannerImagePath,
                       b.description AS Description,
                       b.sort_order AS SortOrder,
                       b.is_active AS IsActive
                FROM club_website_banner b
                JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
                WHERE b.fk_club_id = p_ClubId AND b.fk_year_id = p_YearId AND b.isdeleted = 0
                ORDER BY b.sort_order ASC;
            END");

        // 111. sp_club_banner_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_banner_get_by_id", @"
            CREATE PROCEDURE sp_club_banner_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT b.pk_club_website_banner_id AS Id,
                       b.fk_club_id AS ClubId,
                       b.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN b.banner_image_path IS NULL OR b.banner_image_path = '' THEN NULL
                           WHEN b.banner_image_path LIKE '/%' THEN b.banner_image_path
                           ELSE CONCAT('/uploads/banner/', b.banner_image_path)
                       END AS BannerImagePath,
                       b.description AS Description,
                       b.sort_order AS SortOrder,
                       b.is_active AS IsActive
                FROM club_website_banner b
                JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
                WHERE b.pk_club_website_banner_id = p_Id AND b.isdeleted = 0
                LIMIT 1;
            END");

        // 112. sp_club_banner_create
        await CreateOrReplaceProcedure(connection, "sp_club_banner_create", @"
            CREATE PROCEDURE sp_club_banner_create(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_BannerImagePath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_website_banner (fk_club_id, fk_year_id, banner_image_path, description, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_YearId, p_BannerImagePath, p_Description, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 113. sp_club_banner_update
        await CreateOrReplaceProcedure(connection, "sp_club_banner_update", @"
            CREATE PROCEDURE sp_club_banner_update(
                IN p_Id INT,
                IN p_BannerImagePath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_website_banner
                SET banner_image_path = p_BannerImagePath,
                    description = p_Description,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_banner_id = p_Id AND isdeleted = 0;
            END");

        // 114. sp_club_banner_delete
        await CreateOrReplaceProcedure(connection, "sp_club_banner_delete", @"
            CREATE PROCEDURE sp_club_banner_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_website_banner
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_banner_id = p_Id;
            END");

        // 115. sp_club_banner_reorder
        await CreateOrReplaceProcedure(connection, "sp_club_banner_reorder", @"
            CREATE PROCEDURE sp_club_banner_reorder(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
            BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_banner WHERE pk_club_website_banner_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_banner WHERE pk_club_website_banner_id = p_Id2;
                UPDATE club_website_banner SET sort_order = v_Order2 WHERE pk_club_website_banner_id = p_Id1;
                UPDATE club_website_banner SET sort_order = v_Order1 WHERE pk_club_website_banner_id = p_Id2;
            END");

        // 116. sp_club_advertisement_get_by_club
        await CreateOrReplaceProcedure(connection, "sp_club_advertisement_get_by_club", @"
            CREATE PROCEDURE sp_club_advertisement_get_by_club(
                IN p_ClubId INT,
                IN p_YearId INT
            )
            BEGIN
                SELECT a.pk_club_website_advertisement_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN a.advertisement_image_path IS NULL OR a.advertisement_image_path = '' THEN NULL
                           WHEN a.advertisement_image_path LIKE '/%' THEN a.advertisement_image_path
                           ELSE CONCAT('/uploads/advertisement/', a.advertisement_image_path)
                       END AS AdvertisementImagePath,
                       CASE
                           WHEN a.document_path IS NULL OR a.document_path = '' THEN NULL
                           WHEN a.document_path LIKE '/%' THEN a.document_path
                           ELSE CONCAT('/uploads/advertisement/', a.document_path)
                       END AS DocumentPath,
                       a.description AS Description,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM club_website_advertisement a
                JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
                WHERE a.fk_club_id = p_ClubId AND a.fk_year_id = p_YearId AND a.isdeleted = 0
                ORDER BY a.sort_order ASC;
            END");

        // 117. sp_club_advertisement_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_advertisement_get_by_id", @"
            CREATE PROCEDURE sp_club_advertisement_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT a.pk_club_website_advertisement_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN a.advertisement_image_path IS NULL OR a.advertisement_image_path = '' THEN NULL
                           WHEN a.advertisement_image_path LIKE '/%' THEN a.advertisement_image_path
                           ELSE CONCAT('/uploads/advertisement/', a.advertisement_image_path)
                       END AS AdvertisementImagePath,
                       CASE
                           WHEN a.document_path IS NULL OR a.document_path = '' THEN NULL
                           WHEN a.document_path LIKE '/%' THEN a.document_path
                           ELSE CONCAT('/uploads/advertisement/', a.document_path)
                       END AS DocumentPath,
                       a.description AS Description,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM club_website_advertisement a
                JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
                WHERE a.pk_club_website_advertisement_id = p_Id AND a.isdeleted = 0
                LIMIT 1;
            END");

        // 118. sp_club_advertisement_create
        await CreateOrReplaceProcedure(connection, "sp_club_advertisement_create", @"
            CREATE PROCEDURE sp_club_advertisement_create(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_AdvertisementImagePath VARCHAR(500),
                IN p_DocumentPath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_website_advertisement (fk_club_id, fk_year_id, advertisement_image_path, document_path, description, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_YearId, p_AdvertisementImagePath, p_DocumentPath, p_Description, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 119. sp_club_advertisement_update
        await CreateOrReplaceProcedure(connection, "sp_club_advertisement_update", @"
            CREATE PROCEDURE sp_club_advertisement_update(
                IN p_Id INT,
                IN p_AdvertisementImagePath VARCHAR(500),
                IN p_DocumentPath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_website_advertisement
                SET advertisement_image_path = p_AdvertisementImagePath,
                    document_path = p_DocumentPath,
                    description = p_Description,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_advertisement_id = p_Id AND isdeleted = 0;
            END");

        // 120. sp_club_advertisement_delete
        await CreateOrReplaceProcedure(connection, "sp_club_advertisement_delete", @"
            CREATE PROCEDURE sp_club_advertisement_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_website_advertisement
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_advertisement_id = p_Id;
            END");

        // 121. sp_club_advertisement_reorder
        await CreateOrReplaceProcedure(connection, "sp_club_advertisement_reorder", @"
            CREATE PROCEDURE sp_club_advertisement_reorder(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
            BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_advertisement WHERE pk_club_website_advertisement_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_advertisement WHERE pk_club_website_advertisement_id = p_Id2;
                UPDATE club_website_advertisement SET sort_order = v_Order2 WHERE pk_club_website_advertisement_id = p_Id1;
                UPDATE club_website_advertisement SET sort_order = v_Order1 WHERE pk_club_website_advertisement_id = p_Id2;
            END");

        // 122. sp_club_social_link_get_by_club
        // NOTE: social links are NOT year-wise (fk_year_id dropped). The app uses inline SQL in
        // ClubSocialLinkService; these procedures are retained but unused.
        await CreateOrReplaceProcedure(connection, "sp_club_social_link_get_by_club", @"
            CREATE PROCEDURE sp_club_social_link_get_by_club(
                IN p_ClubId INT
            )
            BEGIN
                SELECT s.pk_club_website_social_link_id AS Id,
                       s.fk_club_id AS ClubId,
                       s.platform AS Platform,
                       s.link_url AS LinkUrl,
                       s.sort_order AS SortOrder,
                       s.is_active AS IsActive
                FROM club_website_social_link s
                WHERE s.fk_club_id = p_ClubId AND s.isdeleted = 0
                ORDER BY s.sort_order ASC;
            END");

        // 123. sp_club_social_link_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_social_link_get_by_id", @"
            CREATE PROCEDURE sp_club_social_link_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT s.pk_club_website_social_link_id AS Id,
                       s.fk_club_id AS ClubId,
                       s.platform AS Platform,
                       s.link_url AS LinkUrl,
                       s.sort_order AS SortOrder,
                       s.is_active AS IsActive
                FROM club_website_social_link s
                WHERE s.pk_club_website_social_link_id = p_Id AND s.isdeleted = 0
                LIMIT 1;
            END");

        // 124. sp_club_social_link_create
        await CreateOrReplaceProcedure(connection, "sp_club_social_link_create", @"
            CREATE PROCEDURE sp_club_social_link_create(
                IN p_ClubId INT,
                IN p_Platform VARCHAR(50),
                IN p_LinkUrl VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_website_social_link (fk_club_id, platform, link_url, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_Platform, p_LinkUrl, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 125. sp_club_social_link_update
        await CreateOrReplaceProcedure(connection, "sp_club_social_link_update", @"
            CREATE PROCEDURE sp_club_social_link_update(
                IN p_Id INT,
                IN p_Platform VARCHAR(50),
                IN p_LinkUrl VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_website_social_link
                SET platform = p_Platform,
                    link_url = p_LinkUrl,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_social_link_id = p_Id AND isdeleted = 0;
            END");

        // 126. sp_club_social_link_delete
        await CreateOrReplaceProcedure(connection, "sp_club_social_link_delete", @"
            CREATE PROCEDURE sp_club_social_link_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_website_social_link
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_social_link_id = p_Id;
            END");

        // ========== CLUB WEBSITE MENU STORED PROCEDURES (12) ==========

        // 127. sp_club_menu_get_by_club
        await CreateOrReplaceProcedure(connection, "sp_club_menu_get_by_club", @"
            CREATE PROCEDURE sp_club_menu_get_by_club(
                IN p_ClubId INT
            )
            BEGIN
                SELECT m.pk_club_website_menu_id AS Id,
                       m.fk_club_id AS ClubId,
                       m.menu_name AS MenuName,
                       m.link_type AS LinkType,
                       CASE
                           WHEN m.link_value IS NULL OR m.link_value = '' THEN m.link_value
                           WHEN m.link_type = 'document'
                                AND m.link_value NOT LIKE '/%'
                                AND m.link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', m.link_value)
                           ELSE m.link_value
                       END AS LinkValue,
                       m.sort_order AS SortOrder,
                       m.is_active AS IsActive,
                       (SELECT COUNT(*) FROM club_website_submenu s
                        WHERE s.fk_menu_id = m.pk_club_website_menu_id AND s.isdeleted = 0) AS SubMenuCount
                FROM club_website_menu m
                WHERE m.fk_club_id = p_ClubId AND m.isdeleted = 0
                ORDER BY m.sort_order ASC;
            END");

        // 128. sp_club_menu_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_menu_get_by_id", @"
            CREATE PROCEDURE sp_club_menu_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT m.pk_club_website_menu_id AS Id,
                       m.fk_club_id AS ClubId,
                       m.menu_name AS MenuName,
                       m.link_type AS LinkType,
                       CASE
                           WHEN m.link_value IS NULL OR m.link_value = '' THEN m.link_value
                           WHEN m.link_type = 'document'
                                AND m.link_value NOT LIKE '/%'
                                AND m.link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', m.link_value)
                           ELSE m.link_value
                       END AS LinkValue,
                       m.sort_order AS SortOrder,
                       m.is_active AS IsActive,
                       (SELECT COUNT(*) FROM club_website_submenu s
                        WHERE s.fk_menu_id = m.pk_club_website_menu_id AND s.isdeleted = 0) AS SubMenuCount
                FROM club_website_menu m
                WHERE m.pk_club_website_menu_id = p_Id AND m.isdeleted = 0
                LIMIT 1;
            END");

        // 129. sp_club_menu_create
        await CreateOrReplaceProcedure(connection, "sp_club_menu_create", @"
            CREATE PROCEDURE sp_club_menu_create(
                IN p_ClubId INT,
                IN p_MenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_website_menu (fk_club_id, menu_name, link_type, link_value, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_MenuName, p_LinkType, p_LinkValue, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 130. sp_club_menu_update
        await CreateOrReplaceProcedure(connection, "sp_club_menu_update", @"
            CREATE PROCEDURE sp_club_menu_update(
                IN p_Id INT,
                IN p_MenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_website_menu
                SET menu_name = p_MenuName,
                    link_type = p_LinkType,
                    link_value = p_LinkValue,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_menu_id = p_Id AND isdeleted = 0;
            END");

        // 131. sp_club_menu_delete (cascade soft-delete sub-menus)
        await CreateOrReplaceProcedure(connection, "sp_club_menu_delete", @"
            CREATE PROCEDURE sp_club_menu_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_website_submenu
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE fk_menu_id = p_Id AND isdeleted = 0;

                UPDATE club_website_menu
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_menu_id = p_Id;
            END");

        // 132. sp_club_menu_reorder
        await CreateOrReplaceProcedure(connection, "sp_club_menu_reorder", @"
            CREATE PROCEDURE sp_club_menu_reorder(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
            BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_menu WHERE pk_club_website_menu_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_menu WHERE pk_club_website_menu_id = p_Id2;
                UPDATE club_website_menu SET sort_order = v_Order2 WHERE pk_club_website_menu_id = p_Id1;
                UPDATE club_website_menu SET sort_order = v_Order1 WHERE pk_club_website_menu_id = p_Id2;
            END");

        // 133. sp_club_submenu_get_by_menu
        await CreateOrReplaceProcedure(connection, "sp_club_submenu_get_by_menu", @"
            CREATE PROCEDURE sp_club_submenu_get_by_menu(
                IN p_MenuId INT
            )
            BEGIN
                SELECT pk_club_website_submenu_id AS Id,
                       fk_menu_id AS MenuId,
                       submenu_name AS SubMenuName,
                       link_type AS LinkType,
                       CASE
                           WHEN link_value IS NULL OR link_value = '' THEN link_value
                           WHEN link_type = 'document'
                                AND link_value NOT LIKE '/%'
                                AND link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', link_value)
                           ELSE link_value
                       END AS LinkValue,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM club_website_submenu
                WHERE fk_menu_id = p_MenuId AND isdeleted = 0
                ORDER BY sort_order ASC;
            END");

        // 134. sp_club_submenu_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_submenu_get_by_id", @"
            CREATE PROCEDURE sp_club_submenu_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT pk_club_website_submenu_id AS Id,
                       fk_menu_id AS MenuId,
                       submenu_name AS SubMenuName,
                       link_type AS LinkType,
                       CASE
                           WHEN link_value IS NULL OR link_value = '' THEN link_value
                           WHEN link_type = 'document'
                                AND link_value NOT LIKE '/%'
                                AND link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', link_value)
                           ELSE link_value
                       END AS LinkValue,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM club_website_submenu
                WHERE pk_club_website_submenu_id = p_Id AND isdeleted = 0
                LIMIT 1;
            END");

        // 135. sp_club_submenu_create
        await CreateOrReplaceProcedure(connection, "sp_club_submenu_create", @"
            CREATE PROCEDURE sp_club_submenu_create(
                IN p_MenuId INT,
                IN p_SubMenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value, sort_order, is_active, created_by)
                VALUES (p_MenuId, p_SubMenuName, p_LinkType, p_LinkValue, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 136. sp_club_submenu_update
        await CreateOrReplaceProcedure(connection, "sp_club_submenu_update", @"
            CREATE PROCEDURE sp_club_submenu_update(
                IN p_Id INT,
                IN p_SubMenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_website_submenu
                SET submenu_name = p_SubMenuName,
                    link_type = p_LinkType,
                    link_value = p_LinkValue,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_submenu_id = p_Id AND isdeleted = 0;
            END");

        // 137. sp_club_submenu_delete
        await CreateOrReplaceProcedure(connection, "sp_club_submenu_delete", @"
            CREATE PROCEDURE sp_club_submenu_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_website_submenu
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_submenu_id = p_Id;
            END");

        // 138. sp_club_submenu_reorder
        await CreateOrReplaceProcedure(connection, "sp_club_submenu_reorder", @"
            CREATE PROCEDURE sp_club_submenu_reorder(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
            BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_submenu WHERE pk_club_website_submenu_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_submenu WHERE pk_club_website_submenu_id = p_Id2;
                UPDATE club_website_submenu SET sort_order = v_Order2 WHERE pk_club_website_submenu_id = p_Id1;
                UPDATE club_website_submenu SET sort_order = v_Order1 WHERE pk_club_website_submenu_id = p_Id2;
            END");

        // ========== CLUB WEBSITE CONTACT DETAIL STORED PROCEDURES (5) ==========

        // 139. sp_club_contact_detail_get_by_club
        await CreateOrReplaceProcedure(connection, "sp_club_contact_detail_get_by_club", @"
            CREATE PROCEDURE sp_club_contact_detail_get_by_club(
                IN p_ClubId INT,
                IN p_YearId INT
            )
            BEGIN
                SELECT c.pk_club_website_contact_detail_id AS Id,
                       c.fk_club_id AS ClubId,
                       c.fk_year_id AS YearId,
                       y.YearLabel,
                       c.email AS Email,
                       c.phone AS Phone,
                       c.is_active AS IsActive
                FROM club_website_contact_detail c
                JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
                WHERE c.fk_club_id = p_ClubId AND c.fk_year_id = p_YearId AND c.isdeleted = 0
                LIMIT 1;
            END");

        // 140. sp_club_contact_detail_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_contact_detail_get_by_id", @"
            CREATE PROCEDURE sp_club_contact_detail_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT c.pk_club_website_contact_detail_id AS Id,
                       c.fk_club_id AS ClubId,
                       c.fk_year_id AS YearId,
                       y.YearLabel,
                       c.email AS Email,
                       c.phone AS Phone,
                       c.is_active AS IsActive
                FROM club_website_contact_detail c
                JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
                WHERE c.pk_club_website_contact_detail_id = p_Id AND c.isdeleted = 0
                LIMIT 1;
            END");

        // 141. sp_club_contact_detail_create (only one per club per year)
        await CreateOrReplaceProcedure(connection, "sp_club_contact_detail_create", @"
            CREATE PROCEDURE sp_club_contact_detail_create(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Email VARCHAR(200),
                IN p_Phone VARCHAR(20),
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                DECLARE v_Existing INT DEFAULT 0;
                SELECT COUNT(*) INTO v_Existing
                FROM club_website_contact_detail
                WHERE fk_club_id = p_ClubId AND fk_year_id = p_YearId AND isdeleted = 0;

                IF v_Existing > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Contact detail already exists for this club and year.';
                END IF;

                INSERT INTO club_website_contact_detail (fk_club_id, fk_year_id, email, phone, is_active, created_by)
                VALUES (p_ClubId, p_YearId, p_Email, p_Phone, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 142. sp_club_contact_detail_update
        await CreateOrReplaceProcedure(connection, "sp_club_contact_detail_update", @"
            CREATE PROCEDURE sp_club_contact_detail_update(
                IN p_Id INT,
                IN p_Email VARCHAR(200),
                IN p_Phone VARCHAR(20),
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_website_contact_detail
                SET email = p_Email,
                    phone = p_Phone,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_contact_detail_id = p_Id AND isdeleted = 0;
            END");

        // 143. sp_club_contact_detail_delete
        await CreateOrReplaceProcedure(connection, "sp_club_contact_detail_delete", @"
            CREATE PROCEDURE sp_club_contact_detail_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_website_contact_detail
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_contact_detail_id = p_Id;
            END");

        // ========== CLUB WEBSITE ABOUT STORED PROCEDURES (5) ==========

        // 144. sp_club_about_get_by_club
        // NOTE: About is NOT year-wise (fk_year_id dropped). The app uses inline SQL in
        // ClubAboutService; these procedures are retained but unused.
        await CreateOrReplaceProcedure(connection, "sp_club_about_get_by_club", @"
            CREATE PROCEDURE sp_club_about_get_by_club(
                IN p_ClubId INT
            )
            BEGIN
                SELECT a.pk_club_website_about_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.content AS Content,
                       a.is_active AS IsActive
                FROM club_website_about a
                WHERE a.fk_club_id = p_ClubId AND a.isdeleted = 0
                ORDER BY a.modified_date DESC, a.created_date DESC, a.pk_club_website_about_id DESC
                LIMIT 1;
            END");

        // 145. sp_club_about_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_club_about_get_by_id", @"
            CREATE PROCEDURE sp_club_about_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT a.pk_club_website_about_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.content AS Content,
                       a.is_active AS IsActive
                FROM club_website_about a
                WHERE a.pk_club_website_about_id = p_Id AND a.isdeleted = 0
                LIMIT 1;
            END");

        // 146. sp_club_about_create (only one per club)
        await CreateOrReplaceProcedure(connection, "sp_club_about_create", @"
            CREATE PROCEDURE sp_club_about_create(
                IN p_ClubId INT,
                IN p_Content LONGTEXT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                DECLARE v_Existing INT DEFAULT 0;
                SELECT COUNT(*) INTO v_Existing
                FROM club_website_about
                WHERE fk_club_id = p_ClubId AND isdeleted = 0;

                IF v_Existing > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'About content already exists for this club.';
                END IF;

                INSERT INTO club_website_about (fk_club_id, content, is_active, created_by)
                VALUES (p_ClubId, p_Content, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 147. sp_club_about_update
        await CreateOrReplaceProcedure(connection, "sp_club_about_update", @"
            CREATE PROCEDURE sp_club_about_update(
                IN p_Id INT,
                IN p_Content LONGTEXT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_website_about
                SET content = p_Content,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_about_id = p_Id AND isdeleted = 0;
            END");

        // 148. sp_club_about_delete
        await CreateOrReplaceProcedure(connection, "sp_club_about_delete", @"
            CREATE PROCEDURE sp_club_about_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_website_about
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_about_id = p_Id;
            END");

        // ========== ROTARY NETWORK STORED PROCEDURES ==========

        // 149. sp_club_terminated_members
        await CreateOrReplaceProcedure(connection, "sp_club_terminated_members", @"
            CREATE PROCEDURE sp_club_terminated_members(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
            BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.RotaryId,
                    m.MemberName,
                    cm.JoinedDate,
                    cm.TerminationDate,
                    cm.TerminationReason
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 1
                  AND cm.TerminationDate IS NOT NULL
                  AND (p_Search IS NULL OR p_Search = '' OR m.MemberName LIKE CONCAT('%', p_Search, '%') OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                ORDER BY cm.TerminationDate DESC
                LIMIT p_PageSize OFFSET p_Offset;

                SELECT COUNT(*) AS TotalCount
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 1
                  AND cm.TerminationDate IS NOT NULL
                  AND (p_Search IS NULL OR p_Search = '' OR m.MemberName LIKE CONCAT('%', p_Search, '%') OR m.RotaryId LIKE CONCAT('%', p_Search, '%'));
            END");

        // ========== POTENTIAL MEMBERS STORED PROCEDURES (5) ==========

        // 150. sp_potential_member_get_by_club
        await CreateOrReplaceProcedure(connection, "sp_potential_member_get_by_club", @"
            CREATE PROCEDURE sp_potential_member_get_by_club(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
            BEGIN
                SELECT pk_potential_member_id AS Id,
                       fk_club_id AS ClubId,
                       name AS Name,
                       email AS Email,
                       mobile_number AS MobileNumber,
                       reference_details AS ReferenceDetails
                FROM potential_members
                WHERE fk_club_id = p_ClubId AND isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = '' OR name LIKE CONCAT('%', p_Search, '%') OR email LIKE CONCAT('%', p_Search, '%') OR mobile_number LIKE CONCAT('%', p_Search, '%'))
                ORDER BY created_date DESC
                LIMIT p_PageSize OFFSET p_Offset;

                SELECT COUNT(*) AS TotalCount
                FROM potential_members
                WHERE fk_club_id = p_ClubId AND isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = '' OR name LIKE CONCAT('%', p_Search, '%') OR email LIKE CONCAT('%', p_Search, '%') OR mobile_number LIKE CONCAT('%', p_Search, '%'));
            END");

        // 151. sp_potential_member_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_potential_member_get_by_id", @"
            CREATE PROCEDURE sp_potential_member_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT pk_potential_member_id AS Id,
                       fk_club_id AS ClubId,
                       name AS Name,
                       email AS Email,
                       mobile_number AS MobileNumber,
                       reference_details AS ReferenceDetails
                FROM potential_members
                WHERE pk_potential_member_id = p_Id AND isdeleted = 0
                LIMIT 1;
            END");

        // 152. sp_potential_member_create
        await CreateOrReplaceProcedure(connection, "sp_potential_member_create", @"
            CREATE PROCEDURE sp_potential_member_create(
                IN p_ClubId INT,
                IN p_Name VARCHAR(200),
                IN p_Email VARCHAR(200),
                IN p_MobileNumber VARCHAR(20),
                IN p_ReferenceDetails VARCHAR(500),
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO potential_members (fk_club_id, name, email, mobile_number, reference_details, created_by)
                VALUES (p_ClubId, p_Name, p_Email, p_MobileNumber, p_ReferenceDetails, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 153. sp_potential_member_update
        await CreateOrReplaceProcedure(connection, "sp_potential_member_update", @"
            CREATE PROCEDURE sp_potential_member_update(
                IN p_Id INT,
                IN p_Name VARCHAR(200),
                IN p_Email VARCHAR(200),
                IN p_MobileNumber VARCHAR(20),
                IN p_ReferenceDetails VARCHAR(500),
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE potential_members
                SET name = p_Name,
                    email = p_Email,
                    mobile_number = p_MobileNumber,
                    reference_details = p_ReferenceDetails,
                    modified_by = p_ModifiedBy
                WHERE pk_potential_member_id = p_Id AND isdeleted = 0;
            END");

        // 154. sp_potential_member_delete
        await CreateOrReplaceProcedure(connection, "sp_potential_member_delete", @"
            CREATE PROCEDURE sp_potential_member_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE potential_members
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_potential_member_id = p_Id;
            END");

        // ══════════════════════════════════════════════════════
        // AREA OF FOCUS MASTER
        // ══════════════════════════════════════════════════════

        // 155. sp_area_of_focus_get_all (now filters by moduleId)
        await CreateOrReplaceProcedure(connection, "sp_area_of_focus_get_all", @"
            CREATE PROCEDURE sp_area_of_focus_get_all(IN p_ModuleId INT)
            BEGIN
                SELECT a.pk_area_of_focus_id AS Id,
                       a.fk_module_id AS ModuleId,
                       m.ModuleName AS ModuleName,
                       a.name AS Name,
                       CASE
                           WHEN a.image_path IS NULL OR a.image_path = '' THEN NULL
                           WHEN a.image_path LIKE '/%' THEN a.image_path
                           ELSE CONCAT('/uploads/area-of-focus/', a.image_path)
                       END AS ImagePath,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM area_of_focus_master a
                LEFT JOIN module_master m ON m.pk_module_id = a.fk_module_id
                WHERE a.isdeleted = 0
                  AND (p_ModuleId IS NULL OR a.fk_module_id = p_ModuleId)
                ORDER BY a.sort_order, a.name;
            END");

        // 156. sp_area_of_focus_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_area_of_focus_get_by_id", @"
            CREATE PROCEDURE sp_area_of_focus_get_by_id(IN p_Id INT)
            BEGIN
                SELECT a.pk_area_of_focus_id AS Id,
                       a.fk_module_id AS ModuleId,
                       m.ModuleName AS ModuleName,
                       a.name AS Name,
                       CASE
                           WHEN a.image_path IS NULL OR a.image_path = '' THEN NULL
                           WHEN a.image_path LIKE '/%' THEN a.image_path
                           ELSE CONCAT('/uploads/area-of-focus/', a.image_path)
                       END AS ImagePath,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM area_of_focus_master a
                LEFT JOIN module_master m ON m.pk_module_id = a.fk_module_id
                WHERE a.pk_area_of_focus_id = p_Id AND a.isdeleted = 0;
            END");

        // 157. sp_area_of_focus_create (now includes moduleId + imagePath)
        await CreateOrReplaceProcedure(connection, "sp_area_of_focus_create", @"
            CREATE PROCEDURE sp_area_of_focus_create(
                IN p_ModuleId INT,
                IN p_Name VARCHAR(200),
                IN p_ImagePath VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO area_of_focus_master (fk_module_id, name, image_path, sort_order, is_active, created_by)
                VALUES (p_ModuleId, p_Name, p_ImagePath, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 158. sp_area_of_focus_update (now includes moduleId + imagePath)
        await CreateOrReplaceProcedure(connection, "sp_area_of_focus_update", @"
            CREATE PROCEDURE sp_area_of_focus_update(
                IN p_Id INT,
                IN p_ModuleId INT,
                IN p_Name VARCHAR(200),
                IN p_ImagePath VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE area_of_focus_master
                SET fk_module_id = p_ModuleId,
                    name = p_Name,
                    image_path = p_ImagePath,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_area_of_focus_id = p_Id AND isdeleted = 0;
            END");

        // 159. sp_area_of_focus_delete
        await CreateOrReplaceProcedure(connection, "sp_area_of_focus_delete", @"
            CREATE PROCEDURE sp_area_of_focus_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE area_of_focus_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_area_of_focus_id = p_Id;
            END");

        // ══════════════════════════════════════════════════════
        // CATEGORY MASTER
        // ══════════════════════════════════════════════════════

        // 160. sp_category_get_by_area_of_focus
        await CreateOrReplaceProcedure(connection, "sp_category_get_by_area_of_focus", @"
            CREATE PROCEDURE sp_category_get_by_area_of_focus(IN p_AreaOfFocusId INT)
            BEGIN
                SELECT pk_category_id AS Id,
                       fk_area_of_focus_id AS AreaOfFocusId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM category_master
                WHERE fk_area_of_focus_id = p_AreaOfFocusId AND isdeleted = 0
                ORDER BY sort_order, name;
            END");

        // 161. sp_category_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_category_get_by_id", @"
            CREATE PROCEDURE sp_category_get_by_id(IN p_Id INT)
            BEGIN
                SELECT pk_category_id AS Id,
                       fk_area_of_focus_id AS AreaOfFocusId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM category_master
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END");

        // 162. sp_category_create
        await CreateOrReplaceProcedure(connection, "sp_category_create", @"
            CREATE PROCEDURE sp_category_create(
                IN p_AreaOfFocusId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO category_master (fk_area_of_focus_id, name, sort_order, is_active, created_by)
                VALUES (p_AreaOfFocusId, p_Name, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 163. sp_category_update
        await CreateOrReplaceProcedure(connection, "sp_category_update", @"
            CREATE PROCEDURE sp_category_update(
                IN p_Id INT,
                IN p_AreaOfFocusId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE category_master
                SET fk_area_of_focus_id = p_AreaOfFocusId,
                    name = p_Name,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END");

        // 164. sp_category_delete
        await CreateOrReplaceProcedure(connection, "sp_category_delete", @"
            CREATE PROCEDURE sp_category_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE category_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_category_id = p_Id;
            END");

        // ══════════════════════════════════════════════════════
        // SUB CATEGORY MASTER
        // ══════════════════════════════════════════════════════

        // 165. sp_sub_category_get_by_category
        await CreateOrReplaceProcedure(connection, "sp_sub_category_get_by_category", @"
            CREATE PROCEDURE sp_sub_category_get_by_category(IN p_CategoryId INT)
            BEGIN
                SELECT pk_sub_category_id AS Id,
                       fk_category_id AS CategoryId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM sub_category_master
                WHERE fk_category_id = p_CategoryId AND isdeleted = 0
                ORDER BY sort_order, name;
            END");

        // 166. sp_sub_category_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_sub_category_get_by_id", @"
            CREATE PROCEDURE sp_sub_category_get_by_id(IN p_Id INT)
            BEGIN
                SELECT pk_sub_category_id AS Id,
                       fk_category_id AS CategoryId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM sub_category_master
                WHERE pk_sub_category_id = p_Id AND isdeleted = 0;
            END");

        // 167. sp_sub_category_create
        await CreateOrReplaceProcedure(connection, "sp_sub_category_create", @"
            CREATE PROCEDURE sp_sub_category_create(
                IN p_CategoryId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO sub_category_master (fk_category_id, name, sort_order, is_active, created_by)
                VALUES (p_CategoryId, p_Name, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 168. sp_sub_category_update
        await CreateOrReplaceProcedure(connection, "sp_sub_category_update", @"
            CREATE PROCEDURE sp_sub_category_update(
                IN p_Id INT,
                IN p_CategoryId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE sub_category_master
                SET fk_category_id = p_CategoryId,
                    name = p_Name,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_sub_category_id = p_Id AND isdeleted = 0;
            END");

        // 169. sp_sub_category_delete
        await CreateOrReplaceProcedure(connection, "sp_sub_category_delete", @"
            CREATE PROCEDURE sp_sub_category_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE sub_category_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_sub_category_id = p_Id;
            END");

        // ══════════════════════════════════════════════════════
        // FUNDING MASTER
        // ══════════════════════════════════════════════════════

        // 170. sp_funding_get_all
        await CreateOrReplaceProcedure(connection, "sp_funding_get_all", @"
            CREATE PROCEDURE sp_funding_get_all()
            BEGIN
                SELECT pk_funding_id AS Id,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM funding_master
                WHERE isdeleted = 0
                ORDER BY sort_order, name;
            END");

        // 171. sp_funding_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_funding_get_by_id", @"
            CREATE PROCEDURE sp_funding_get_by_id(IN p_Id INT)
            BEGIN
                SELECT pk_funding_id AS Id,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM funding_master
                WHERE pk_funding_id = p_Id AND isdeleted = 0;
            END");

        // 172. sp_funding_create
        await CreateOrReplaceProcedure(connection, "sp_funding_create", @"
            CREATE PROCEDURE sp_funding_create(
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO funding_master (name, sort_order, is_active, created_by)
                VALUES (p_Name, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END");

        // 173. sp_funding_update
        await CreateOrReplaceProcedure(connection, "sp_funding_update", @"
            CREATE PROCEDURE sp_funding_update(
                IN p_Id INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE funding_master
                SET name = p_Name,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_funding_id = p_Id AND isdeleted = 0;
            END");

        // 174. sp_funding_delete
        await CreateOrReplaceProcedure(connection, "sp_funding_delete", @"
            CREATE PROCEDURE sp_funding_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE funding_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_funding_id = p_Id;
            END");

        // ══════════════════════════════════════════════════════
        // ROTARY PROJECTS
        // ══════════════════════════════════════════════════════

        // 175. sp_project_get_by_club (paginated)
        await CreateOrReplaceProcedure(connection, "sp_project_get_by_club", @"
            CREATE PROCEDURE sp_project_get_by_club(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_YearId INT,
                IN p_Page INT,
                IN p_PageSize INT,
                IN p_Search VARCHAR(100)
            )
            BEGIN
                DECLARE v_Offset INT DEFAULT (p_Page - 1) * p_PageSize;

                SELECT p.pk_project_id AS Id,
                       p.fk_club_id AS ClubId,
                       p.fk_module_id AS ModuleId,
                       p.fk_year_id AS YearId,
                       y.YearLabel,
                       p.project_type AS ProjectType,
                       p.parent_project_id AS ParentProjectId,
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
                       f.name AS FundingName,
                       p.direct_beneficiaries AS DirectBeneficiaries,
                       p.is_active AS IsActive,
                       (SELECT image_path FROM rotary_project_photos
                        WHERE fk_project_id = p.pk_project_id AND is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
                FROM rotary_projects p
                LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
                LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
                LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
                LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
                LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
                WHERE p.fk_club_id = p_ClubId
                  AND p.fk_module_id = p_ModuleId
                  AND p.fk_year_id = p_YearId
                  AND p.isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = '' OR p.title LIKE CONCAT('%', p_Search, '%')
                       OR p.location LIKE CONCAT('%', p_Search, '%'))
                ORDER BY p.project_date DESC, p.pk_project_id DESC
                LIMIT v_Offset, p_PageSize;

                SELECT COUNT(*) AS TotalCount
                FROM rotary_projects p
                WHERE p.fk_club_id = p_ClubId
                  AND p.fk_module_id = p_ModuleId
                  AND p.fk_year_id = p_YearId
                  AND p.isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = '' OR p.title LIKE CONCAT('%', p_Search, '%')
                       OR p.location LIKE CONCAT('%', p_Search, '%'));
            END");

        // 176. sp_project_get_by_id (with photos)
        await CreateOrReplaceProcedure(connection, "sp_project_get_by_id", @"
            CREATE PROCEDURE sp_project_get_by_id(IN p_Id INT)
            BEGIN
                SELECT p.pk_project_id AS Id,
                       p.fk_club_id AS ClubId,
                       p.fk_module_id AS ModuleId,
                       p.fk_year_id AS YearId,
                       y.YearLabel,
                       p.project_type AS ProjectType,
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
                       p.fk_funding_id AS FundingId,
                       f.name AS FundingName,
                       p.direct_beneficiaries AS DirectBeneficiaries,
                       p.man_hours AS ManHours,
                       p.rotarians_involved AS RotariansInvolved,
                       p.rotaractors_involved AS RotaractorsInvolved,
                       p.send_whatsapp AS SendWhatsapp,
                       p.is_active AS IsActive
                FROM rotary_projects p
                LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
                LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
                LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
                LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
                LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
                WHERE p.pk_project_id = p_Id AND p.isdeleted = 0;

                SELECT pk_photo_id AS Id,
                       fk_project_id AS ProjectId,
                       image_path AS ImagePath,
                       description AS Description,
                       is_primary AS IsPrimary,
                       sort_order AS SortOrder
                FROM rotary_project_photos
                WHERE fk_project_id = p_Id
                ORDER BY sort_order;
            END");

        // 177. sp_project_create
        await CreateOrReplaceProcedure(connection, "sp_project_create", @"
            CREATE PROCEDURE sp_project_create(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_YearId INT,
                IN p_ProjectType VARCHAR(20),
                IN p_ParentProjectId INT,
                IN p_OngoingGroupTitle VARCHAR(200),
                IN p_IsJointProject TINYINT,
                IN p_CoHostName VARCHAR(200),
                IN p_ClubRole VARCHAR(10),
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_Location VARCHAR(200),
                IN p_AreaOfFocusId INT,
                IN p_OtherAreaOfFocus VARCHAR(100),
                IN p_CategoryId INT,
                IN p_OtherCategory VARCHAR(100),
                IN p_SubCategoryId INT,
                IN p_OtherSubCategory VARCHAR(100),
                IN p_ProjectDate DATE,
                IN p_ProjectCost DECIMAL(15,2),
                IN p_FundingId INT,
                IN p_DirectBeneficiaries INT,
                IN p_ManHours INT,
                IN p_RotariansInvolved INT,
                IN p_RotaractorsInvolved INT,
                IN p_SendWhatsapp TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO rotary_projects (
                    fk_club_id, fk_module_id, fk_year_id, project_type, parent_project_id,
                    ongoing_group_title, is_joint_project, co_host_name, club_role,
                    title, description, location,
                    fk_area_of_focus_id, other_area_of_focus,
                    fk_category_id, other_category,
                    fk_sub_category_id, other_sub_category,
                    project_date, project_cost, fk_funding_id,
                    direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved,
                    send_whatsapp, created_by
                ) VALUES (
                    p_ClubId, p_ModuleId, p_YearId, p_ProjectType, p_ParentProjectId,
                    p_OngoingGroupTitle, p_IsJointProject, p_CoHostName, p_ClubRole,
                    p_Title, p_Description, p_Location,
                    p_AreaOfFocusId, p_OtherAreaOfFocus,
                    p_CategoryId, p_OtherCategory,
                    p_SubCategoryId, p_OtherSubCategory,
                    p_ProjectDate, p_ProjectCost, p_FundingId,
                    p_DirectBeneficiaries, p_ManHours, p_RotariansInvolved, p_RotaractorsInvolved,
                    p_SendWhatsapp, p_CreatedBy
                );
                SELECT LAST_INSERT_ID();
            END");

        // 178. sp_project_update
        await CreateOrReplaceProcedure(connection, "sp_project_update", @"
            CREATE PROCEDURE sp_project_update(
                IN p_Id INT,
                IN p_ProjectType VARCHAR(20),
                IN p_ParentProjectId INT,
                IN p_OngoingGroupTitle VARCHAR(200),
                IN p_IsJointProject TINYINT,
                IN p_CoHostName VARCHAR(200),
                IN p_ClubRole VARCHAR(10),
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_Location VARCHAR(200),
                IN p_AreaOfFocusId INT,
                IN p_OtherAreaOfFocus VARCHAR(100),
                IN p_CategoryId INT,
                IN p_OtherCategory VARCHAR(100),
                IN p_SubCategoryId INT,
                IN p_OtherSubCategory VARCHAR(100),
                IN p_ProjectDate DATE,
                IN p_ProjectCost DECIMAL(15,2),
                IN p_FundingId INT,
                IN p_DirectBeneficiaries INT,
                IN p_ManHours INT,
                IN p_RotariansInvolved INT,
                IN p_RotaractorsInvolved INT,
                IN p_SendWhatsapp TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE rotary_projects
                SET project_type = p_ProjectType,
                    parent_project_id = p_ParentProjectId,
                    ongoing_group_title = p_OngoingGroupTitle,
                    is_joint_project = p_IsJointProject,
                    co_host_name = p_CoHostName,
                    club_role = p_ClubRole,
                    title = p_Title,
                    description = p_Description,
                    location = p_Location,
                    fk_area_of_focus_id = p_AreaOfFocusId,
                    other_area_of_focus = p_OtherAreaOfFocus,
                    fk_category_id = p_CategoryId,
                    other_category = p_OtherCategory,
                    fk_sub_category_id = p_SubCategoryId,
                    other_sub_category = p_OtherSubCategory,
                    project_date = p_ProjectDate,
                    project_cost = p_ProjectCost,
                    fk_funding_id = p_FundingId,
                    direct_beneficiaries = p_DirectBeneficiaries,
                    man_hours = p_ManHours,
                    rotarians_involved = p_RotariansInvolved,
                    rotaractors_involved = p_RotaractorsInvolved,
                    send_whatsapp = p_SendWhatsapp,
                    modified_by = p_ModifiedBy
                WHERE pk_project_id = p_Id AND isdeleted = 0;
            END");

        // 179. sp_project_delete
        await CreateOrReplaceProcedure(connection, "sp_project_delete", @"
            CREATE PROCEDURE sp_project_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE rotary_projects
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_project_id = p_Id;
            END");

        // 180. sp_project_get_ongoing (for Select Existing dropdown)
        await CreateOrReplaceProcedure(connection, "sp_project_get_ongoing", @"
            CREATE PROCEDURE sp_project_get_ongoing(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_Search VARCHAR(100)
            )
            BEGIN
                SELECT DISTINCT
                    COALESCE(p.parent_project_id, p.pk_project_id) AS Id,
                    COALESCE(p.ongoing_group_title, p.title) AS Title
                FROM rotary_projects p
                WHERE p.fk_club_id = p_ClubId
                  AND p.fk_module_id = p_ModuleId
                  AND p.project_type = 'ongoing_repeat'
                  AND p.isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = ''
                       OR p.ongoing_group_title LIKE CONCAT('%', p_Search, '%')
                       OR p.title LIKE CONCAT('%', p_Search, '%'))
                ORDER BY Title
                LIMIT 50;
            END");

        // 181. sp_project_photo_add
        // NOTE: production C# code uses inline SQL because the SYSTEM_USER privilege issue
        // prevents updating this SP on the live DB. This definition is kept for fresh installs.
        await CreateOrReplaceProcedure(connection, "sp_project_photo_add", @"
            CREATE PROCEDURE sp_project_photo_add(
                IN p_ProjectId INT,
                IN p_ImagePath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_IsPrimary TINYINT,
                IN p_SortOrder INT
            )
            BEGIN
                IF p_IsPrimary = 1 THEN
                    UPDATE rotary_project_photos SET is_primary = 0 WHERE fk_project_id = p_ProjectId;
                END IF;
                INSERT INTO rotary_project_photos (fk_project_id, image_path, description, is_primary, sort_order)
                VALUES (p_ProjectId, p_ImagePath, p_Description, p_IsPrimary, p_SortOrder);
                SELECT LAST_INSERT_ID();
            END");

        // 182. sp_project_photo_delete
        await CreateOrReplaceProcedure(connection, "sp_project_photo_delete", @"
            CREATE PROCEDURE sp_project_photo_delete(IN p_PhotoId INT)
            BEGIN
                DELETE FROM rotary_project_photos WHERE pk_photo_id = p_PhotoId;
            END");

        // 183. sp_project_photo_set_primary
        await CreateOrReplaceProcedure(connection, "sp_project_photo_set_primary", @"
            CREATE PROCEDURE sp_project_photo_set_primary(
                IN p_ProjectId INT,
                IN p_PhotoId INT
            )
            BEGIN
                UPDATE rotary_project_photos SET is_primary = 0 WHERE fk_project_id = p_ProjectId;
                UPDATE rotary_project_photos SET is_primary = 1 WHERE pk_photo_id = p_PhotoId;
            END");

        // 184. sp_project_get_public (cached public endpoint)
        await CreateOrReplaceProcedure(connection, "sp_project_get_public", @"
            CREATE PROCEDURE sp_project_get_public(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_YearId INT,
                IN p_Page INT,
                IN p_PageSize INT
            )
            BEGIN
                DECLARE v_Offset INT DEFAULT (p_Page - 1) * p_PageSize;

                SELECT p.pk_project_id AS Id,
                       p.title AS Title,
                       p.description AS Description,
                       p.location AS Location,
                       aof.name AS AreaOfFocusName,
                       p.other_area_of_focus AS OtherAreaOfFocus,
                       p.project_date AS ProjectDate,
                       p.project_cost AS ProjectCost,
                       p.direct_beneficiaries AS DirectBeneficiaries,
                       (SELECT image_path FROM rotary_project_photos
                        WHERE fk_project_id = p.pk_project_id AND is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
                FROM rotary_projects p
                LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
                WHERE p.fk_club_id = p_ClubId
                  AND p.fk_module_id = p_ModuleId
                  AND p.fk_year_id = p_YearId
                  AND p.isdeleted = 0
                  AND p.is_active = 1
                ORDER BY p.project_date DESC
                LIMIT v_Offset, p_PageSize;

                SELECT COUNT(*) AS TotalCount
                FROM rotary_projects
                WHERE fk_club_id = p_ClubId
                  AND fk_module_id = p_ModuleId
                  AND fk_year_id = p_YearId
                  AND isdeleted = 0
                  AND is_active = 1;
            END");

        // 185. sp_project_get_years (years with data + current year)
        await CreateOrReplaceProcedure(connection, "sp_project_get_years", @"
            CREATE PROCEDURE sp_project_get_years(
                IN p_ClubId INT,
                IN p_ModuleId INT
            )
            BEGIN
                SELECT DISTINCT y.pk_year_id AS Id,
                       y.YearLabel,
                       y.StartDate,
                       y.EndDate,
                       y.IsCurrent
                FROM rotary_year_master y
                WHERE y.isdeleted = 0
                  AND (
                    y.IsCurrent = 1
                    OR y.pk_year_id IN (
                      SELECT DISTINCT fk_year_id FROM rotary_projects
                      WHERE fk_club_id = p_ClubId AND fk_module_id = p_ModuleId AND isdeleted = 0
                    )
                  )
                ORDER BY y.StartDate DESC;
            END");

        // ========== ZONAL COORDINATOR STORED PROCEDURES (4) ==========

        // 186. sp_zonal_coordinator_get_by_zone
        await CreateOrReplaceProcedure(connection, "sp_zonal_coordinator_get_by_zone", @"
            CREATE PROCEDURE sp_zonal_coordinator_get_by_zone(
                IN p_ZoneId INT
            )
            BEGIN
                SELECT
                    mr.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    m.EmailId AS Email,
                    mr.AssignedDate
                FROM member_roles mr
                JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                WHERE mr.fk_role_id = 4
                  AND mr.fk_zone_id = p_ZoneId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0
                  AND m.isdeleted = 0
                LIMIT 1;
            END");

        // 187. sp_zonal_coordinator_assign
        // Validates member does not have SuperAdmin or Admin role before assigning
        await CreateOrReplaceProcedure(connection, "sp_zonal_coordinator_assign", @"
            CREATE PROCEDURE sp_zonal_coordinator_assign(
                IN p_MemberId INT,
                IN p_ZoneId INT,
                IN p_AssignedBy INT
            )
            BEGIN
                DECLARE v_HasConflict INT DEFAULT 0;

                -- Check if member has SuperAdmin or Admin role
                SELECT COUNT(*) INTO v_HasConflict
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1 AND mr.isdeleted = 0
                  AND r.RoleName IN ('SuperAdmin', 'Admin');

                IF v_HasConflict > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member already has SuperAdmin or Admin role. Cannot assign as Zonal Coordinator.';
                END IF;

                -- Deactivate any existing coordinator for this zone
                UPDATE member_roles
                SET IsActive = 0, RevokedDate = NOW(), RevokedBy = p_AssignedBy
                WHERE fk_role_id = 4 AND fk_zone_id = p_ZoneId AND IsActive = 1 AND isdeleted = 0;

                -- Insert new coordinator role
                INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_zone_id, AssignedBy, AssignedDate, IsActive, isdeleted)
                VALUES (p_MemberId, 4, p_ZoneId, p_AssignedBy, NOW(), 1, 0);
            END");

        // 188. sp_zonal_coordinator_remove
        await CreateOrReplaceProcedure(connection, "sp_zonal_coordinator_remove", @"
            CREATE PROCEDURE sp_zonal_coordinator_remove(
                IN p_ZoneId INT,
                IN p_RevokedBy INT
            )
            BEGIN
                UPDATE member_roles
                SET IsActive = 0, RevokedDate = NOW(), RevokedBy = p_RevokedBy
                WHERE fk_role_id = 4 AND fk_zone_id = p_ZoneId AND IsActive = 1 AND isdeleted = 0;
            END");

        // 189. sp_zonal_coordinator_search_members
        // Excludes members who already have SuperAdmin or Admin roles
        await CreateOrReplaceProcedure(connection, "sp_zonal_coordinator_search_members", @"
            CREATE PROCEDURE sp_zonal_coordinator_search_members(
                IN p_ZoneId INT,
                IN p_Search VARCHAR(200)
            )
            BEGIN
                SELECT DISTINCT
                    m.pk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    m.EmailId AS Email,
                    cl.ClubName,
                    d.DistrictNumber
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
                JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND cl.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = cl.fk_district_id AND d.isdeleted = 0
                WHERE d.fk_zone_id = p_ZoneId
                  AND m.isdeleted = 0
                  AND (m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%'))
                  AND m.pk_member_master_profile_id NOT IN (
                      SELECT mr2.fk_member_master_profile_id FROM member_roles mr2
                      JOIN roles r2 ON r2.pk_role_id = mr2.fk_role_id
                      WHERE mr2.IsActive = 1 AND mr2.isdeleted = 0
                        AND r2.RoleName IN ('SuperAdmin', 'Admin')
                  )
                ORDER BY m.MemberName
                LIMIT 20;
            END");

        // ========== SYSTEM SETTINGS STORED PROCEDURES (3) ==========

        // 190. sp_setting_get_by_key
        await CreateOrReplaceProcedure(connection, "sp_setting_get_by_key", @"
            CREATE PROCEDURE sp_setting_get_by_key(
                IN p_Key VARCHAR(100)
            )
            BEGIN
                SELECT pk_setting_id AS Id, SettingKey, SettingValue, Description, modified_by AS ModifiedBy, modified_date AS ModifiedDate
                FROM system_settings
                WHERE SettingKey = p_Key;
            END");

        // 191. sp_setting_upsert
        await CreateOrReplaceProcedure(connection, "sp_setting_upsert", @"
            CREATE PROCEDURE sp_setting_upsert(
                IN p_Key VARCHAR(100),
                IN p_Value VARCHAR(500),
                IN p_Description VARCHAR(200),
                IN p_ModifiedBy INT
            )
            BEGIN
                INSERT INTO system_settings (SettingKey, SettingValue, Description, modified_by, modified_date)
                VALUES (p_Key, p_Value, p_Description, p_ModifiedBy, NOW())
                ON DUPLICATE KEY UPDATE
                    SettingValue = p_Value,
                    Description = p_Description,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW();
            END");

        // 192. sp_setting_get_all
        await CreateOrReplaceProcedure(connection, "sp_setting_get_all", @"
            CREATE PROCEDURE sp_setting_get_all()
            BEGIN
                SELECT pk_setting_id AS Id, SettingKey, SettingValue, Description, modified_by AS ModifiedBy, modified_date AS ModifiedDate
                FROM system_settings
                ORDER BY SettingKey;
            END");

        // ========== BENEFICIARY APPROVAL STORED PROCEDURES (4) ==========

        // 193. sp_beneficiary_approval_create
        await CreateOrReplaceProcedure(connection, "sp_beneficiary_approval_create", @"
            CREATE PROCEDURE sp_beneficiary_approval_create(
                IN p_ProjectId INT,
                IN p_ZoneId INT,
                IN p_ClubId INT,
                IN p_RequestedBeneficiaries INT,
                IN p_CurrentLimit INT,
                IN p_Token VARCHAR(100),
                IN p_RequestedBy INT
            )
            BEGIN
                INSERT INTO beneficiary_approval_requests
                    (fk_project_id, fk_zone_id, fk_club_id, requested_beneficiaries, current_limit, approval_token, status, requested_by)
                VALUES
                    (p_ProjectId, p_ZoneId, p_ClubId, p_RequestedBeneficiaries, p_CurrentLimit, p_Token, 'pending', p_RequestedBy);
                SELECT LAST_INSERT_ID() AS Id;
            END");

        // 194. sp_beneficiary_approval_get_by_token
        await CreateOrReplaceProcedure(connection, "sp_beneficiary_approval_get_by_token", @"
            CREATE PROCEDURE sp_beneficiary_approval_get_by_token(
                IN p_Token VARCHAR(100)
            )
            BEGIN
                SELECT
                    bar.pk_approval_id AS Id,
                    bar.fk_project_id AS ProjectId,
                    bar.fk_zone_id AS ZoneId,
                    bar.fk_club_id AS ClubId,
                    bar.requested_beneficiaries AS RequestedBeneficiaries,
                    bar.current_limit AS CurrentLimit,
                    bar.approval_token AS ApprovalToken,
                    bar.status AS Status,
                    bar.remark AS Remark,
                    bar.requested_by AS RequestedBy,
                    bar.responded_date AS RespondedDate,
                    bar.created_date AS CreatedDate,
                    p.title AS ProjectTitle,
                    p.description AS ProjectDescription,
                    p.project_date AS ProjectDate,
                    p.project_cost AS ProjectCost,
                    p.direct_beneficiaries AS CurrentBeneficiaries,
                    p.man_hours AS ManHours,
                    p.rotarians_involved AS RotariansInvolved,
                    p.rotaractors_involved AS RotaractorsInvolved,
                    c.ClubName,
                    d.DistrictNumber,
                    z.ZoneName,
                    m.MemberName AS RequestedByName,
                    m.EmailId AS RequestedByEmail,
                    m.PrimaryMobileNumber AS RequestedByMobile
                FROM beneficiary_approval_requests bar
                JOIN rotary_projects p ON p.pk_project_id = bar.fk_project_id
                JOIN club_master c ON c.pk_club_id = bar.fk_club_id
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                JOIN zone_master z ON z.pk_zone_id = bar.fk_zone_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bar.requested_by
                WHERE bar.approval_token = p_Token;
            END");

        // 195. sp_beneficiary_approval_approve
        await CreateOrReplaceProcedure(connection, "sp_beneficiary_approval_approve", @"
            CREATE PROCEDURE sp_beneficiary_approval_approve(
                IN p_Token VARCHAR(100),
                IN p_Remark VARCHAR(1000)
            )
            BEGIN
                DECLARE v_ProjectId INT;
                DECLARE v_Requested INT;
                DECLARE v_Status VARCHAR(20);

                SELECT fk_project_id, requested_beneficiaries, status
                INTO v_ProjectId, v_Requested, v_Status
                FROM beneficiary_approval_requests
                WHERE approval_token = p_Token;

                IF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'approved', remark = p_Remark, responded_date = NOW()
                    WHERE approval_token = p_Token;

                    UPDATE rotary_projects
                    SET direct_beneficiaries = v_Requested, modified_date = NOW()
                    WHERE pk_project_id = v_ProjectId;

                    SELECT 'approved' AS Status, 'success' AS Result;
                END IF;
            END");

        // 196. sp_beneficiary_approval_reject
        await CreateOrReplaceProcedure(connection, "sp_beneficiary_approval_reject", @"
            CREATE PROCEDURE sp_beneficiary_approval_reject(
                IN p_Token VARCHAR(100),
                IN p_Remark VARCHAR(1000)
            )
            BEGIN
                DECLARE v_Status VARCHAR(20);

                SELECT status INTO v_Status
                FROM beneficiary_approval_requests
                WHERE approval_token = p_Token;

                IF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'rejected', remark = p_Remark, responded_date = NOW()
                    WHERE approval_token = p_Token;

                    SELECT 'rejected' AS Status, 'success' AS Result;
                END IF;
            END");

        // 197. sp_zonal_get_zone_for_member — get the zone assigned to a zonal coordinator
        await CreateOrReplaceProcedure(connection, "sp_zonal_get_zone_for_member", @"
            CREATE PROCEDURE sp_zonal_get_zone_for_member(
                IN p_MemberId INT
            )
            BEGIN
                SELECT mr.fk_zone_id AS ZoneId, z.ZoneName, z.ZoneCode
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
                WHERE mr.fk_member_id = p_MemberId
                  AND r.RoleName = 'ZonalCoordinator'
                  AND mr.is_active = 1
                  AND z.isdeleted = 0
                LIMIT 1;
            END");

        // 198. sp_zonal_get_approval_requests — get approval requests for a zone, optionally filtered by district
        await CreateOrReplaceProcedure(connection, "sp_zonal_get_approval_requests", @"
            CREATE PROCEDURE sp_zonal_get_approval_requests(
                IN p_ZoneId INT,
                IN p_DistrictId INT,
                IN p_Status VARCHAR(20),
                IN p_Page INT,
                IN p_PageSize INT
            )
            BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT SQL_CALC_FOUND_ROWS
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
                JOIN rotary_projects p ON p.pk_project_id = bar.fk_project_id
                JOIN club_master c ON c.pk_club_id = bar.fk_club_id
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN member_master m ON m.pk_member_id = bar.requested_by
                WHERE bar.fk_zone_id = p_ZoneId
                  AND (p_DistrictId = 0 OR d.pk_district_id = p_DistrictId)
                  AND (p_Status IS NULL OR p_Status = '' OR bar.status = p_Status)
                ORDER BY
                    CASE bar.status WHEN 'pending' THEN 0 ELSE 1 END,
                    bar.created_date DESC
                LIMIT v_Offset, p_PageSize;

                SELECT FOUND_ROWS() AS TotalCount;
            END");

        // 199. sp_zonal_get_zone_districts — get districts in a zone
        await CreateOrReplaceProcedure(connection, "sp_zonal_get_zone_districts", @"
            CREATE PROCEDURE sp_zonal_get_zone_districts(
                IN p_ZoneId INT
            )
            BEGIN
                SELECT pk_district_id AS Id, DistrictNumber, DistrictName
                FROM district_master
                WHERE fk_zone_id = p_ZoneId AND isdeleted = 0
                ORDER BY CAST(DistrictNumber AS UNSIGNED), DistrictNumber;
            END");

        // 200. sp_zonal_get_district_clubs — get clubs in a district
        await CreateOrReplaceProcedure(connection, "sp_zonal_get_district_clubs", @"
            CREATE PROCEDURE sp_zonal_get_district_clubs(
                IN p_DistrictId INT
            )
            BEGIN
                SELECT pk_club_id AS Id, ClubName, ClubCode
                FROM club_master
                WHERE fk_district_id = p_DistrictId AND isdeleted = 0
                ORDER BY ClubName;
            END");

        // 201. sp_zonal_approve_request — approve from authenticated zonal coordinator
        await CreateOrReplaceProcedure(connection, "sp_zonal_approve_request", @"
            CREATE PROCEDURE sp_zonal_approve_request(
                IN p_ApprovalId INT,
                IN p_ZoneId INT,
                IN p_MemberId INT,
                IN p_Remark VARCHAR(1000)
            )
            BEGIN
                DECLARE v_ProjectId INT;
                DECLARE v_Requested INT;
                DECLARE v_Status VARCHAR(20);
                DECLARE v_Token VARCHAR(100);

                SELECT fk_project_id, requested_beneficiaries, status, approval_token
                INTO v_ProjectId, v_Requested, v_Status, v_Token
                FROM beneficiary_approval_requests
                WHERE pk_approval_id = p_ApprovalId AND fk_zone_id = p_ZoneId;

                IF v_Status IS NULL THEN
                    SELECT 'not_found' AS Status, 'error' AS Result;
                ELSEIF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'approved', remark = p_Remark, responded_by = p_MemberId, responded_date = NOW()
                    WHERE pk_approval_id = p_ApprovalId;

                    UPDATE rotary_projects
                    SET direct_beneficiaries = v_Requested, modified_date = NOW()
                    WHERE pk_project_id = v_ProjectId;

                    SELECT 'approved' AS Status, 'success' AS Result, v_Token AS Token;
                END IF;
            END");

        // 202. sp_zonal_reject_request — reject from authenticated zonal coordinator
        await CreateOrReplaceProcedure(connection, "sp_zonal_reject_request", @"
            CREATE PROCEDURE sp_zonal_reject_request(
                IN p_ApprovalId INT,
                IN p_ZoneId INT,
                IN p_MemberId INT,
                IN p_Remark VARCHAR(1000)
            )
            BEGIN
                DECLARE v_Status VARCHAR(20);
                DECLARE v_Token VARCHAR(100);

                SELECT status, approval_token INTO v_Status, v_Token
                FROM beneficiary_approval_requests
                WHERE pk_approval_id = p_ApprovalId AND fk_zone_id = p_ZoneId;

                IF v_Status IS NULL THEN
                    SELECT 'not_found' AS Status, 'error' AS Result;
                ELSEIF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'rejected', remark = p_Remark, responded_by = p_MemberId, responded_date = NOW()
                    WHERE pk_approval_id = p_ApprovalId;

                    SELECT 'rejected' AS Status, 'success' AS Result, v_Token AS Token;
                END IF;
            END");

        // 203. sp_login_audit_create — insert login audit log
        await CreateOrReplaceProcedure(connection, "sp_login_audit_create", @"
            CREATE PROCEDURE sp_login_audit_create(
                IN p_MemberId INT,
                IN p_MemberName VARCHAR(200),
                IN p_EmailOrMobile VARCHAR(200),
                IN p_IpAddress VARCHAR(50),
                IN p_UserAgent VARCHAR(500),
                IN p_Status VARCHAR(20),
                IN p_FailureReason VARCHAR(200)
            )
            BEGIN
                INSERT INTO login_audit_logs (fk_member_id, member_name, email_or_mobile, ip_address, user_agent, login_status, failure_reason)
                VALUES (p_MemberId, p_MemberName, p_EmailOrMobile, p_IpAddress, p_UserAgent, p_Status, p_FailureReason);
            END");

        // 204. sp_login_audit_get_last_login — get last successful login time for a member
        await CreateOrReplaceProcedure(connection, "sp_login_audit_get_last_login", @"
            CREATE PROCEDURE sp_login_audit_get_last_login(
                IN p_MemberId INT
            )
            BEGIN
                SELECT login_time AS LastLoginTime
                FROM login_audit_logs
                WHERE fk_member_id = p_MemberId AND login_status = 'success'
                ORDER BY login_time DESC
                LIMIT 1 OFFSET 1;
            END");

        // 205. sp_login_audit_get_logs — paginated login audit logs (SuperAdmin)
        await CreateOrReplaceProcedure(connection, "sp_login_audit_get_logs", @"
            CREATE PROCEDURE sp_login_audit_get_logs(
                IN p_Search VARCHAR(200),
                IN p_Status VARCHAR(20),
                IN p_Page INT,
                IN p_PageSize INT
            )
            BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT pk_log_id AS Id, fk_member_id AS MemberId, member_name AS MemberName,
                       email_or_mobile AS EmailOrMobile, login_time AS LoginTime,
                       ip_address AS IpAddress, user_agent AS UserAgent,
                       login_status AS LoginStatus, failure_reason AS FailureReason
                FROM login_audit_logs
                WHERE (p_Search = '' OR member_name LIKE CONCAT('%', p_Search, '%') OR email_or_mobile LIKE CONCAT('%', p_Search, '%'))
                  AND (p_Status = '' OR login_status = p_Status)
                ORDER BY login_time DESC
                LIMIT p_PageSize OFFSET v_Offset;

                SELECT COUNT(*)
                FROM login_audit_logs
                WHERE (p_Search = '' OR member_name LIKE CONCAT('%', p_Search, '%') OR email_or_mobile LIKE CONCAT('%', p_Search, '%'))
                  AND (p_Status = '' OR login_status = p_Status);
            END");

        // ========== UPCOMING EVENT STORED PROCEDURES ==========

        // 206. sp_upcoming_event_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_get_all_paginated", @"
            CREATE PROCEDURE sp_upcoming_event_get_all_paginated(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Status VARCHAR(20),
                IN p_Search VARCHAR(200),
                IN p_Page INT,
                IN p_PageSize INT
            )
            BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT e.pk_upcoming_event_id AS Id,
                       e.fk_club_id AS ClubId,
                       e.Title,
                       e.Description,
                       e.ImagePath,
                       e.EventDate,
                       e.PublishDate,
                       e.ExpiryDate,
                       e.EventVenue,
                       e.RegistrationLink,
                       e.IsSendWhatsapp,
                       e.IsRepeatNotification,
                       CASE
                           WHEN e.ExpiryDate < NOW() THEN 'Expired'
                           WHEN e.PublishDate <= NOW() AND e.ExpiryDate >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status,
                       (SELECT COUNT(*) FROM upcoming_event_reminders r WHERE r.fk_upcoming_event_id = e.pk_upcoming_event_id AND r.IsActive = 1) AS ReminderCount
                FROM upcoming_events e
                JOIN rotary_year_master y ON y.pk_year_id = p_YearId
                WHERE e.fk_club_id = p_ClubId
                  AND e.PublishDate >= y.StartDate
                  AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                  AND e.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND e.PublishDate <= NOW() AND e.ExpiryDate >= NOW()) OR
                       (p_Status = 'Expired' AND e.ExpiryDate < NOW()) OR
                       (p_Status = 'Unpublished' AND e.PublishDate > NOW()))
                  AND (p_Search = '' OR e.Title LIKE CONCAT('%', p_Search, '%') OR e.EventVenue LIKE CONCAT('%', p_Search, '%'))
                ORDER BY e.EventDate DESC
                LIMIT p_PageSize OFFSET v_Offset;

                SELECT COUNT(*)
                FROM upcoming_events e
                JOIN rotary_year_master y ON y.pk_year_id = p_YearId
                WHERE e.fk_club_id = p_ClubId
                  AND e.PublishDate >= y.StartDate
                  AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                  AND e.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND e.PublishDate <= NOW() AND e.ExpiryDate >= NOW()) OR
                       (p_Status = 'Expired' AND e.ExpiryDate < NOW()) OR
                       (p_Status = 'Unpublished' AND e.PublishDate > NOW()))
                  AND (p_Search = '' OR e.Title LIKE CONCAT('%', p_Search, '%') OR e.EventVenue LIKE CONCAT('%', p_Search, '%'));
            END");

        // 207. sp_upcoming_event_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_get_by_id", @"
            CREATE PROCEDURE sp_upcoming_event_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT e.pk_upcoming_event_id AS Id,
                       e.fk_club_id AS ClubId,
                       e.Title,
                       e.Description,
                       e.ImagePath,
                       e.EventDate,
                       e.PublishDate,
                       e.ExpiryDate,
                       e.EventVenue,
                       e.RegistrationLink,
                       e.IsSendWhatsapp,
                       e.IsRepeatNotification,
                       CASE
                           WHEN e.ExpiryDate < NOW() THEN 'Expired'
                           WHEN e.PublishDate <= NOW() AND e.ExpiryDate >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status
                FROM upcoming_events e
                WHERE e.pk_upcoming_event_id = p_Id
                  AND e.isdeleted = 0;

                SELECT r.pk_reminder_id AS Id,
                       r.ReminderDateTime
                FROM upcoming_event_reminders r
                WHERE r.fk_upcoming_event_id = p_Id
                  AND r.IsActive = 1
                ORDER BY r.ReminderDateTime;
            END");

        // 208. sp_upcoming_event_create
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_create", @"
            CREATE PROCEDURE sp_upcoming_event_create(
                IN p_ClubId INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_EventDate DATE,
                IN p_PublishDate DATE,
                IN p_ExpiryDate DATE,
                IN p_EventVenue VARCHAR(255),
                IN p_RegistrationLink VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
                IN p_IsRepeatNotification TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO upcoming_events (fk_club_id, Title, Description, ImagePath, EventDate, PublishDate, ExpiryDate, EventVenue, RegistrationLink, IsSendWhatsapp, IsRepeatNotification, created_by)
                VALUES (p_ClubId, p_Title, p_Description, p_ImagePath, p_EventDate, p_PublishDate, p_ExpiryDate, p_EventVenue, p_RegistrationLink, p_IsSendWhatsapp, p_IsRepeatNotification, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END");

        // 209. sp_upcoming_event_update
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_update", @"
            CREATE PROCEDURE sp_upcoming_event_update(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_EventDate DATE,
                IN p_PublishDate DATE,
                IN p_ExpiryDate DATE,
                IN p_EventVenue VARCHAR(255),
                IN p_RegistrationLink VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
                IN p_IsRepeatNotification TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE upcoming_events
                SET Title = p_Title,
                    Description = p_Description,
                    ImagePath = p_ImagePath,
                    EventDate = p_EventDate,
                    PublishDate = p_PublishDate,
                    ExpiryDate = p_ExpiryDate,
                    EventVenue = p_EventVenue,
                    RegistrationLink = p_RegistrationLink,
                    IsSendWhatsapp = p_IsSendWhatsapp,
                    IsRepeatNotification = p_IsRepeatNotification,
                    modified_by = p_ModifiedBy
                WHERE pk_upcoming_event_id = p_Id
                  AND isdeleted = 0;
            END");

        // 210. sp_upcoming_event_delete
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_delete", @"
            CREATE PROCEDURE sp_upcoming_event_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE upcoming_events
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_upcoming_event_id = p_Id;
            END");

        // 211. sp_upcoming_event_reminder_add
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_reminder_add", @"
            CREATE PROCEDURE sp_upcoming_event_reminder_add(
                IN p_EventId INT,
                IN p_ReminderDateTime DATETIME,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, created_by)
                VALUES (p_EventId, p_ReminderDateTime, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END");

        // 212. sp_upcoming_event_reminder_delete
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_reminder_delete", @"
            CREATE PROCEDURE sp_upcoming_event_reminder_delete(
                IN p_Id INT
            )
            BEGIN
                DELETE FROM upcoming_event_reminders
                WHERE pk_reminder_id = p_Id;
            END");

        // 213. sp_upcoming_event_get_years
        await CreateOrReplaceProcedure(connection, "sp_upcoming_event_get_years", @"
            CREATE PROCEDURE sp_upcoming_event_get_years(
                IN p_ClubId INT
            )
            BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN upcoming_events e
                  ON e.PublishDate >= y.StartDate
                 AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE e.fk_club_id = p_ClubId
                  AND e.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END");

        // 214. sp_announcement_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_announcement_get_all_paginated", @"
            CREATE PROCEDURE sp_announcement_get_all_paginated(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Status VARCHAR(20),
                IN p_Search VARCHAR(200),
                IN p_Page INT,
                IN p_PageSize INT
            )
            BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT a.pk_announcement_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.Title,
                       a.Description,
                       a.ImagePath,
                       a.PublishDateTime,
                       a.ExpiryDateTime,
                       a.IsDisplayOnBanner,
                       a.IsSendWhatsapp,
                       a.IsRepeatNotification,
                       CASE
                           WHEN a.ExpiryDateTime < NOW() THEN 'Expired'
                           WHEN a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status,
                       (SELECT COUNT(*) FROM announcement_reminders r WHERE r.fk_announcement_id = a.pk_announcement_id AND r.IsActive = 1) AS ReminderCount
                FROM announcements a
                JOIN rotary_year_master y ON y.pk_year_id = p_YearId
                WHERE a.fk_club_id = p_ClubId
                  AND a.PublishDateTime >= y.StartDate
                  AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                  AND a.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW()) OR
                       (p_Status = 'Expired' AND a.ExpiryDateTime < NOW()) OR
                       (p_Status = 'Unpublished' AND a.PublishDateTime > NOW()))
                  AND (p_Search = '' OR a.Title LIKE CONCAT('%', p_Search, '%'))
                ORDER BY a.PublishDateTime DESC
                LIMIT p_PageSize OFFSET v_Offset;

                SELECT COUNT(*)
                FROM announcements a
                JOIN rotary_year_master y ON y.pk_year_id = p_YearId
                WHERE a.fk_club_id = p_ClubId
                  AND a.PublishDateTime >= y.StartDate
                  AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                  AND a.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW()) OR
                       (p_Status = 'Expired' AND a.ExpiryDateTime < NOW()) OR
                       (p_Status = 'Unpublished' AND a.PublishDateTime > NOW()))
                  AND (p_Search = '' OR a.Title LIKE CONCAT('%', p_Search, '%'));
            END");

        // 215. sp_announcement_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_announcement_get_by_id", @"
            CREATE PROCEDURE sp_announcement_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT a.pk_announcement_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.Title,
                       a.Description,
                       a.ImagePath,
                       a.PublishDateTime,
                       a.ExpiryDateTime,
                       a.IsDisplayOnBanner,
                       a.IsSendWhatsapp,
                       a.IsRepeatNotification,
                       CASE
                           WHEN a.ExpiryDateTime < NOW() THEN 'Expired'
                           WHEN a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status
                FROM announcements a
                WHERE a.pk_announcement_id = p_Id
                  AND a.isdeleted = 0;

                SELECT r.pk_reminder_id AS Id,
                       r.ReminderDateTime
                FROM announcement_reminders r
                WHERE r.fk_announcement_id = p_Id
                  AND r.IsActive = 1
                ORDER BY r.ReminderDateTime;
            END");

        // 216. sp_announcement_create
        await CreateOrReplaceProcedure(connection, "sp_announcement_create", @"
            CREATE PROCEDURE sp_announcement_create(
                IN p_ClubId INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_IsDisplayOnBanner TINYINT,
                IN p_IsSendWhatsapp TINYINT,
                IN p_IsRepeatNotification TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO announcements (fk_club_id, Title, Description, ImagePath, PublishDateTime, ExpiryDateTime, IsDisplayOnBanner, IsSendWhatsapp, IsRepeatNotification, created_by)
                VALUES (p_ClubId, p_Title, p_Description, p_ImagePath, p_PublishDateTime, p_ExpiryDateTime, p_IsDisplayOnBanner, p_IsSendWhatsapp, p_IsRepeatNotification, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END");

        // 217. sp_announcement_update
        await CreateOrReplaceProcedure(connection, "sp_announcement_update", @"
            CREATE PROCEDURE sp_announcement_update(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_IsDisplayOnBanner TINYINT,
                IN p_IsSendWhatsapp TINYINT,
                IN p_IsRepeatNotification TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE announcements
                SET Title = p_Title,
                    Description = p_Description,
                    ImagePath = p_ImagePath,
                    PublishDateTime = p_PublishDateTime,
                    ExpiryDateTime = p_ExpiryDateTime,
                    IsDisplayOnBanner = p_IsDisplayOnBanner,
                    IsSendWhatsapp = p_IsSendWhatsapp,
                    IsRepeatNotification = p_IsRepeatNotification,
                    modified_by = p_ModifiedBy
                WHERE pk_announcement_id = p_Id
                  AND isdeleted = 0;
            END");

        // 218. sp_announcement_delete
        await CreateOrReplaceProcedure(connection, "sp_announcement_delete", @"
            CREATE PROCEDURE sp_announcement_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE announcements
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_announcement_id = p_Id;
            END");

        // 219. sp_announcement_reminder_add
        await CreateOrReplaceProcedure(connection, "sp_announcement_reminder_add", @"
            CREATE PROCEDURE sp_announcement_reminder_add(
                IN p_AnnouncementId INT,
                IN p_ReminderDateTime DATETIME,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO announcement_reminders (fk_announcement_id, ReminderDateTime, created_by)
                VALUES (p_AnnouncementId, p_ReminderDateTime, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END");

        // 220. sp_announcement_reminder_delete
        await CreateOrReplaceProcedure(connection, "sp_announcement_reminder_delete", @"
            CREATE PROCEDURE sp_announcement_reminder_delete(
                IN p_Id INT
            )
            BEGIN
                DELETE FROM announcement_reminders
                WHERE pk_reminder_id = p_Id;
            END");

        // 221. sp_announcement_get_years
        await CreateOrReplaceProcedure(connection, "sp_announcement_get_years", @"
            CREATE PROCEDURE sp_announcement_get_years(
                IN p_ClubId INT
            )
            BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN announcements a
                  ON a.PublishDateTime >= y.StartDate
                 AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE a.fk_club_id = p_ClubId
                  AND a.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END");

        // ========== NEWSLETTER STORED PROCEDURES ==========

        // 222. sp_newsletter_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_newsletter_get_all_paginated", @"
            CREATE PROCEDURE sp_newsletter_get_all_paginated(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Status VARCHAR(20),
                IN p_Search VARCHAR(200),
                IN p_Page INT,
                IN p_PageSize INT
            )
            BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT n.pk_newsletter_id AS Id,
                       n.fk_club_id AS ClubId,
                       n.Title,
                       n.PublishDateTime,
                       n.ExpiryDateTime,
                       n.AttachmentType,
                       n.LinkUrl,
                       n.FilePath,
                       n.IsSendWhatsapp,
                       CASE
                           WHEN n.ExpiryDateTime < NOW() THEN 'Expired'
                           WHEN n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status
                FROM newsletters n
                JOIN rotary_year_master y ON y.pk_year_id = p_YearId
                WHERE n.fk_club_id = p_ClubId
                  AND n.PublishDateTime >= y.StartDate
                  AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                  AND n.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW()) OR
                       (p_Status = 'Expired' AND n.ExpiryDateTime < NOW()) OR
                       (p_Status = 'Unpublished' AND n.PublishDateTime > NOW()))
                  AND (p_Search = '' OR n.Title LIKE CONCAT('%', p_Search, '%'))
                ORDER BY n.PublishDateTime DESC
                LIMIT p_PageSize OFFSET v_Offset;

                SELECT COUNT(*)
                FROM newsletters n
                JOIN rotary_year_master y ON y.pk_year_id = p_YearId
                WHERE n.fk_club_id = p_ClubId
                  AND n.PublishDateTime >= y.StartDate
                  AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                  AND n.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW()) OR
                       (p_Status = 'Expired' AND n.ExpiryDateTime < NOW()) OR
                       (p_Status = 'Unpublished' AND n.PublishDateTime > NOW()))
                  AND (p_Search = '' OR n.Title LIKE CONCAT('%', p_Search, '%'));
            END");

        // 223. sp_newsletter_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_newsletter_get_by_id", @"
            CREATE PROCEDURE sp_newsletter_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT n.pk_newsletter_id AS Id,
                       n.fk_club_id AS ClubId,
                       n.Title,
                       n.PublishDateTime,
                       n.ExpiryDateTime,
                       n.AttachmentType,
                       n.LinkUrl,
                       n.FilePath,
                       n.IsSendWhatsapp,
                       CASE
                           WHEN n.ExpiryDateTime < NOW() THEN 'Expired'
                           WHEN n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status
                FROM newsletters n
                WHERE n.pk_newsletter_id = p_Id
                  AND n.isdeleted = 0;
            END");

        // 224. sp_newsletter_create
        await CreateOrReplaceProcedure(connection, "sp_newsletter_create", @"
            CREATE PROCEDURE sp_newsletter_create(
                IN p_ClubId INT,
                IN p_Title VARCHAR(50),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_AttachmentType VARCHAR(10),
                IN p_LinkUrl VARCHAR(500),
                IN p_FilePath VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO newsletters (fk_club_id, Title, PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl, FilePath, IsSendWhatsapp, created_by)
                VALUES (p_ClubId, p_Title, p_PublishDateTime, p_ExpiryDateTime, p_AttachmentType, p_LinkUrl, p_FilePath, p_IsSendWhatsapp, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END");

        // 225. sp_newsletter_update
        await CreateOrReplaceProcedure(connection, "sp_newsletter_update", @"
            CREATE PROCEDURE sp_newsletter_update(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_AttachmentType VARCHAR(10),
                IN p_LinkUrl VARCHAR(500),
                IN p_FilePath VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE newsletters
                SET Title = p_Title,
                    PublishDateTime = p_PublishDateTime,
                    ExpiryDateTime = p_ExpiryDateTime,
                    AttachmentType = p_AttachmentType,
                    LinkUrl = p_LinkUrl,
                    FilePath = p_FilePath,
                    IsSendWhatsapp = p_IsSendWhatsapp,
                    modified_by = p_ModifiedBy
                WHERE pk_newsletter_id = p_Id;
            END");

        // 226. sp_newsletter_delete
        await CreateOrReplaceProcedure(connection, "sp_newsletter_delete", @"
            CREATE PROCEDURE sp_newsletter_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE newsletters
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_newsletter_id = p_Id;
            END");

        // 227. sp_newsletter_get_years
        await CreateOrReplaceProcedure(connection, "sp_newsletter_get_years", @"
            CREATE PROCEDURE sp_newsletter_get_years(
                IN p_ClubId INT
            )
            BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN newsletters n
                  ON n.PublishDateTime >= y.StartDate
                 AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE n.fk_club_id = p_ClubId
                  AND n.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END");

        // ========== DOCUMENT STORED PROCEDURES ==========

        // 228. sp_document_get_all_paginated
        await CreateOrReplaceProcedure(connection, "sp_document_get_all_paginated", @"
            CREATE PROCEDURE sp_document_get_all_paginated(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Status VARCHAR(20),
                IN p_Search VARCHAR(200),
                IN p_Page INT,
                IN p_PageSize INT
            )
            BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT d.pk_document_id AS Id,
                       d.fk_club_id AS ClubId,
                       d.fk_year_id AS YearId,
                       d.Title,
                       d.AccessType,
                       CASE
                           WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                           WHEN d.FilePath LIKE '/%' THEN d.FilePath
                           WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                           WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                           ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                       END AS FilePath,
                       d.OriginalFileName,
                       d.PublishDateTime,
                       d.ExpiryDateTime,
                       CASE
                           WHEN d.ExpiryDateTime < NOW() THEN 'Expired'
                           WHEN d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status
                FROM club_documents d
                WHERE d.fk_club_id = p_ClubId
                  AND d.fk_year_id = p_YearId
                  AND d.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW()) OR
                       (p_Status = 'Expired' AND d.ExpiryDateTime < NOW()) OR
                       (p_Status = 'Unpublished' AND d.PublishDateTime > NOW()))
                  AND (p_Search = '' OR d.Title LIKE CONCAT('%', p_Search, '%'))
                ORDER BY d.PublishDateTime DESC
                LIMIT p_PageSize OFFSET v_Offset;

                SELECT COUNT(*)
                FROM club_documents d
                WHERE d.fk_club_id = p_ClubId
                  AND d.fk_year_id = p_YearId
                  AND d.isdeleted = 0
                  AND (p_Status = '' OR
                       (p_Status = 'Published' AND d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW()) OR
                       (p_Status = 'Expired' AND d.ExpiryDateTime < NOW()) OR
                       (p_Status = 'Unpublished' AND d.PublishDateTime > NOW()))
                  AND (p_Search = '' OR d.Title LIKE CONCAT('%', p_Search, '%'));
            END");

        // 229. sp_document_get_by_id
        await CreateOrReplaceProcedure(connection, "sp_document_get_by_id", @"
            CREATE PROCEDURE sp_document_get_by_id(
                IN p_Id INT
            )
            BEGIN
                SELECT d.pk_document_id AS Id,
                       d.fk_club_id AS ClubId,
                       d.fk_year_id AS YearId,
                       d.Title,
                       d.AccessType,
                       CASE
                           WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                           WHEN d.FilePath LIKE '/%' THEN d.FilePath
                           WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                           WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                           ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                       END AS FilePath,
                       d.OriginalFileName,
                       d.PublishDateTime,
                       d.ExpiryDateTime,
                       CASE
                           WHEN d.ExpiryDateTime < NOW() THEN 'Expired'
                           WHEN d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status
                FROM club_documents d
                WHERE d.pk_document_id = p_Id
                  AND d.isdeleted = 0;
            END");

        // 230. sp_document_create
        await CreateOrReplaceProcedure(connection, "sp_document_create", @"
            CREATE PROCEDURE sp_document_create(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Title VARCHAR(50),
                IN p_AccessType VARCHAR(20),
                IN p_FilePath VARCHAR(500),
                IN p_OriginalFileName VARCHAR(255),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_documents (fk_club_id, fk_year_id, Title, AccessType, FilePath, OriginalFileName, PublishDateTime, ExpiryDateTime, created_by)
                VALUES (p_ClubId, p_YearId, p_Title, p_AccessType, p_FilePath, p_OriginalFileName, p_PublishDateTime, p_ExpiryDateTime, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END");

        // 231. sp_document_update
        await CreateOrReplaceProcedure(connection, "sp_document_update", @"
            CREATE PROCEDURE sp_document_update(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_AccessType VARCHAR(20),
                IN p_FilePath VARCHAR(500),
                IN p_OriginalFileName VARCHAR(255),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_documents
                SET Title = p_Title,
                    AccessType = p_AccessType,
                    FilePath = p_FilePath,
                    OriginalFileName = p_OriginalFileName,
                    PublishDateTime = p_PublishDateTime,
                    ExpiryDateTime = p_ExpiryDateTime,
                    modified_by = p_ModifiedBy
                WHERE pk_document_id = p_Id;
            END");

        // 232. sp_document_delete
        await CreateOrReplaceProcedure(connection, "sp_document_delete", @"
            CREATE PROCEDURE sp_document_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_documents
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_document_id = p_Id;
            END");

        // 233. sp_document_get_years
        await CreateOrReplaceProcedure(connection, "sp_document_get_years", @"
            CREATE PROCEDURE sp_document_get_years(
                IN p_ClubId INT
            )
            BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN club_documents d ON d.fk_year_id = y.pk_year_id
                WHERE d.fk_club_id = p_ClubId
                  AND d.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END");

        // 234. sp_greeting_get_settings
        await CreateOrReplaceProcedure(connection, "sp_greeting_get_settings", @"
            CREATE PROCEDURE sp_greeting_get_settings(IN p_ClubId INT)
            BEGIN
                SELECT
                    BirthdayGreeting, IsEnableBirthdayNotification,
                    AnniversaryGreeting, IsEnableAnniversaryNotification,
                    IsGreetingSendWhatsapp, IsGreetingSendEmail,
                    IsEnableBirthdayEmail, BirthdayEmailFrom, BirthdayEmailSubject, BirthdayEmailMessage,
                    IsEnableAnniversaryEmail, AnniversaryEmailFrom, AnniversaryEmailSubject, AnniversaryEmailMessage
                FROM club_master
                WHERE pk_club_id = p_ClubId AND isdeleted = 0;
            END");

        // 235. sp_greeting_update_settings
        await CreateOrReplaceProcedure(connection, "sp_greeting_update_settings", @"
            CREATE PROCEDURE sp_greeting_update_settings(
                IN p_ClubId INT,
                IN p_BirthdayGreeting VARCHAR(700),
                IN p_IsEnableBirthdayNotification TINYINT,
                IN p_AnniversaryGreeting VARCHAR(700),
                IN p_IsEnableAnniversaryNotification TINYINT,
                IN p_IsGreetingSendWhatsapp TINYINT,
                IN p_IsGreetingSendEmail TINYINT,
                IN p_IsEnableBirthdayEmail TINYINT,
                IN p_BirthdayEmailFrom VARCHAR(200),
                IN p_BirthdayEmailSubject VARCHAR(200),
                IN p_BirthdayEmailMessage TEXT,
                IN p_IsEnableAnniversaryEmail TINYINT,
                IN p_AnniversaryEmailFrom VARCHAR(200),
                IN p_AnniversaryEmailSubject VARCHAR(200),
                IN p_AnniversaryEmailMessage TEXT,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_master SET
                    BirthdayGreeting = p_BirthdayGreeting,
                    IsEnableBirthdayNotification = p_IsEnableBirthdayNotification,
                    AnniversaryGreeting = p_AnniversaryGreeting,
                    IsEnableAnniversaryNotification = p_IsEnableAnniversaryNotification,
                    IsGreetingSendWhatsapp = p_IsGreetingSendWhatsapp,
                    IsGreetingSendEmail = p_IsGreetingSendEmail,
                    IsEnableBirthdayEmail = p_IsEnableBirthdayEmail,
                    BirthdayEmailFrom = p_BirthdayEmailFrom,
                    BirthdayEmailSubject = p_BirthdayEmailSubject,
                    BirthdayEmailMessage = p_BirthdayEmailMessage,
                    IsEnableAnniversaryEmail = p_IsEnableAnniversaryEmail,
                    AnniversaryEmailFrom = p_AnniversaryEmailFrom,
                    AnniversaryEmailSubject = p_AnniversaryEmailSubject,
                    AnniversaryEmailMessage = p_AnniversaryEmailMessage,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_club_id = p_ClubId AND isdeleted = 0;
            END");

        // ========== ATTENDANCE STORED PROCEDURES ==========

        // 236. sp_attendance_create
        await CreateOrReplaceProcedure(connection, "sp_attendance_create", @"
            CREATE PROCEDURE sp_attendance_create(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_EventName VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_EventDateTime DATETIME,
                IN p_CreatedBy INT
            )
            BEGIN
                INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, Description, EventDateTime, created_by, created_date)
                VALUES (p_ClubId, p_YearId, p_EventName, p_Description, p_EventDateTime, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID();
            END");

        // 237. sp_attendance_update
        await CreateOrReplaceProcedure(connection, "sp_attendance_update", @"
            CREATE PROCEDURE sp_attendance_update(
                IN p_Id INT,
                IN p_EventName VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_EventDateTime DATETIME,
                IN p_ModifiedBy INT
            )
            BEGIN
                UPDATE club_attendance SET
                    EventName = p_EventName,
                    Description = p_Description,
                    EventDateTime = p_EventDateTime,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_attendance_id = p_Id AND isdeleted = 0;
            END");

        // 238. sp_attendance_delete
        await CreateOrReplaceProcedure(connection, "sp_attendance_delete", @"
            CREATE PROCEDURE sp_attendance_delete(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
            BEGIN
                UPDATE club_attendance SET
                    isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_attendance_id = p_Id;
            END");
    }
}

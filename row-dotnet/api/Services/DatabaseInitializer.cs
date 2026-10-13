using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    private readonly string _connectionString;
    private readonly ILogger<DatabaseInitializer> _logger;
    private readonly IConfiguration _configuration;

    public DatabaseInitializer(IConfiguration configuration, ILogger<DatabaseInitializer> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _logger = logger;
        _configuration = configuration;
    }

    public async Task InitializeAsync()
    {
        try
        {
            var builder = new MySqlConnectionStringBuilder(_connectionString);
            var databaseName = builder.Database;
            builder.Database = "";

            using (var connection = new MySqlConnection(builder.ConnectionString))
            {
                await connection.OpenAsync();
                await connection.ExecuteAsync($"CREATE DATABASE IF NOT EXISTS `{databaseName}`");
                _logger.LogInformation("Database '{Database}' ensured.", databaseName);
            }

            using (var connection = new MySqlConnection(_connectionString))
            {
                await connection.OpenAsync();

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS member_master_profile (
                        pk_member_master_profile_id INT PRIMARY KEY AUTO_INCREMENT,
                        MemberName VARCHAR(200) NOT NULL,
                        ProfilePhotoPath VARCHAR(500),
                        fk_primary_country_id INT DEFAULT 1,
                        PrimaryMobileNumber VARCHAR(20) UNIQUE,
                        EmailId VARCHAR(200) UNIQUE,
                        BirthDate DATE NULL,
                        AnniversaryDate DATE NULL,
                        BloodGroup VARCHAR(10),
                        fk_secondary_country_id INT DEFAULT 1,
                        SecondaryMobileNumber VARCHAR(20),
                        IsPersonalDetailsVisible BIT DEFAULT 1,
                        Gender VARCHAR(20),
                        PrimaryLanguage VARCHAR(50) DEFAULT 'English',
                        IsYouth BIT DEFAULT 0,
                        MemberIntroduction TEXT,
                        Facebook VARCHAR(300),
                        Instagram VARCHAR(300),
                        LinkedIn VARCHAR(300),
                        Twitter VARCHAR(300),
                        Youtube VARCHAR(300),
                        Website VARCHAR(300),
                        RotaryId VARCHAR(50) UNIQUE,
                        DonorRecognition VARCHAR(200),
                        FamilyPhotoPath VARCHAR(500),
                        IsFamilyDetailsVisible BIT DEFAULT 1,
                        ShowPhoneInMyClub TINYINT(1) NOT NULL DEFAULT 1,
                        ShowPhoneInAllClubs TINYINT(1) NOT NULL DEFAULT 1,
                        ShowEmailInMyClub TINYINT(1) NOT NULL DEFAULT 1,
                        ShowEmailInAllClubs TINYINT(1) NOT NULL DEFAULT 1,
                        NotifyUpcomingEvents TINYINT(1) NOT NULL DEFAULT 1,
                        NotifyAnnouncements TINYINT(1) NOT NULL DEFAULT 1,
                        NotifyNewsletters TINYINT(1) NOT NULL DEFAULT 1,
                        NotifyDocuments TINYINT(1) NOT NULL DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                // Per-member privacy + notification flags (mobile Settings screen, 2026-06-26).
                // Settings live on member_master_profile as GLOBAL flags (one set per member,
                // not per-club) — user's design call vs the per-club tables in the original spec.
                // Idempotent ALTER for existing prod DBs that pre-date this column set.
                foreach (var (col, ddl) in new (string col, string ddl)[] {
                    ("ShowPhoneInMyClub",   "ALTER TABLE member_master_profile ADD COLUMN ShowPhoneInMyClub TINYINT(1) NOT NULL DEFAULT 1 AFTER IsFamilyDetailsVisible"),
                    ("ShowPhoneInAllClubs", "ALTER TABLE member_master_profile ADD COLUMN ShowPhoneInAllClubs TINYINT(1) NOT NULL DEFAULT 1 AFTER ShowPhoneInMyClub"),
                    ("ShowEmailInMyClub",   "ALTER TABLE member_master_profile ADD COLUMN ShowEmailInMyClub TINYINT(1) NOT NULL DEFAULT 1 AFTER ShowPhoneInAllClubs"),
                    ("ShowEmailInAllClubs", "ALTER TABLE member_master_profile ADD COLUMN ShowEmailInAllClubs TINYINT(1) NOT NULL DEFAULT 1 AFTER ShowEmailInMyClub"),
                    ("NotifyUpcomingEvents","ALTER TABLE member_master_profile ADD COLUMN NotifyUpcomingEvents TINYINT(1) NOT NULL DEFAULT 1 AFTER ShowEmailInAllClubs"),
                    ("NotifyAnnouncements", "ALTER TABLE member_master_profile ADD COLUMN NotifyAnnouncements TINYINT(1) NOT NULL DEFAULT 1 AFTER NotifyUpcomingEvents"),
                    ("NotifyNewsletters",   "ALTER TABLE member_master_profile ADD COLUMN NotifyNewsletters TINYINT(1) NOT NULL DEFAULT 1 AFTER NotifyAnnouncements"),
                    ("NotifyDocuments",     "ALTER TABLE member_master_profile ADD COLUMN NotifyDocuments TINYINT(1) NOT NULL DEFAULT 1 AFTER NotifyNewsletters"),
                })
                {
                    var exists = await connection.ExecuteScalarAsync<int>(@"
                        SELECT COUNT(*) FROM information_schema.COLUMNS
                        WHERE TABLE_SCHEMA = DATABASE()
                          AND TABLE_NAME = 'member_master_profile'
                          AND COLUMN_NAME = @Col", new { Col = col });
                    if (exists == 0)
                    {
                        await connection.ExecuteAsync(ddl);
                        _logger.LogInformation("Added {Col} column to member_master_profile.", col);
                    }
                }

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS member_address_details (
                        pk_member_address_details_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_member_master_profile_id INT NOT NULL,
                        AddressType VARCHAR(20) NOT NULL,
                        fk_country_id INT DEFAULT 1,
                        PhoneNumber VARCHAR(20),
                        Address TEXT,
                        State VARCHAR(100),
                        City VARCHAR(100),
                        PinCode VARCHAR(10),
                        BusinessName VARCHAR(300) NULL,
                        BusinessEmailId VARCHAR(200) NULL,
                        Keywords VARCHAR(500) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id) ON DELETE CASCADE
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS member_family_details (
                        pk_member_family_details_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_member_master_profile_id INT NOT NULL,
                        Name VARCHAR(200) NOT NULL,
                        Relation VARCHAR(100),
                        BloodGroup VARCHAR(10),
                        fk_country_id INT DEFAULT 1,
                        PhoneNumber VARCHAR(20),
                        EmailId VARCHAR(200),
                        BirthDate DATE NULL,
                        AnniversaryDate DATE NULL,
                        PhotoPath VARCHAR(500),
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id) ON DELETE CASCADE
                    )");

                // Old audit_log table removed — new schema created later in this file
                // (middleware-based audit logging replaces trigger-based approach)

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS country_master (
                        pk_country_id INT AUTO_INCREMENT PRIMARY KEY,
                        CountryName VARCHAR(100) NOT NULL,
                        CountryCode VARCHAR(10) NOT NULL,
                        PhoneCode VARCHAR(10) DEFAULT '',
                        GmtOpt VARCHAR(10) DEFAULT '',
                        GmtTime VARCHAR(50) DEFAULT '',
                        Ordering INT DEFAULT 999,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
                    )");

                // Add PhoneCode column if it doesn't exist (for existing databases)
                var phoneCodeColumnExists = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'country_master' AND COLUMN_NAME = 'PhoneCode'");
                if (phoneCodeColumnExists == 0)
                {
                    await connection.ExecuteAsync("ALTER TABLE country_master ADD COLUMN PhoneCode VARCHAR(10) DEFAULT '' AFTER CountryCode");
                    _logger.LogInformation("Added PhoneCode column to country_master.");
                }

                // Seed country_master if empty
                var countryCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM country_master");
                if (countryCount == 0)
                {
                    await SeedCountriesAsync(connection);
                    _logger.LogInformation("Country master data seeded.");
                }

                // Update phone codes for all countries (idempotent)
                await UpdateCountryPhoneCodesAsync(connection);

                // Auth tables
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS roles (
                        pk_role_id INT AUTO_INCREMENT PRIMARY KEY,
                        RoleName VARCHAR(50) NOT NULL UNIQUE,
                        Description VARCHAR(200) DEFAULT '',
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS member_roles (
                        pk_member_role_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_master_profile_id INT NOT NULL,
                        fk_role_id INT NOT NULL,
                        AssignedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                        AssignedBy INT NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        RevokedDate DATETIME NULL,
                        RevokedBy INT NULL,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id) ON DELETE CASCADE,
                        FOREIGN KEY (fk_role_id) REFERENCES roles(pk_role_id) ON DELETE CASCADE
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS member_credentials (
                        pk_member_credential_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_master_profile_id INT NOT NULL UNIQUE,
                        PasswordHash VARCHAR(500) NOT NULL,
                        IsTemporaryPassword TINYINT(1) DEFAULT 1,
                        IsActive TINYINT(1) DEFAULT 1,
                        LastPasswordChangeDate DATETIME NULL,
                        FailedLoginAttempts INT DEFAULT 0,
                        LockoutEndTime DATETIME NULL,
                        LastLoginDate DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id) ON DELETE CASCADE
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS password_reset_tokens (
                        pk_password_reset_token_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_master_profile_id INT NOT NULL,
                        Token VARCHAR(500) NOT NULL,
                        ExpiryDate DATETIME NOT NULL,
                        IsUsed TINYINT(1) DEFAULT 0,
                        UsedDate DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id) ON DELETE CASCADE
                    )");

                // Zone table (top-level hierarchy: Zone -> District -> Club -> Member)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS zone_master (
                        pk_zone_id INT AUTO_INCREMENT PRIMARY KEY,
                        ZoneName VARCHAR(100) NOT NULL UNIQUE,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                // District and Club tables
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_master (
                        pk_district_id INT AUTO_INCREMENT PRIMARY KEY,
                        DistrictNumber VARCHAR(50) NOT NULL,
                        DistrictLogoPath VARCHAR(500),
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                // Migration: Add fk_zone_id to district_master
                await AddColumnIfNotExists(connection, "district_master", "fk_zone_id", "INT NULL AFTER DistrictLogoPath");

                // Add FK constraint if not exists
                var zoneFkExists = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'district_master' AND CONSTRAINT_NAME = 'fk_district_zone'");
                if (zoneFkExists == 0)
                {
                    try
                    {
                        await connection.ExecuteAsync(@"ALTER TABLE district_master ADD CONSTRAINT fk_district_zone FOREIGN KEY (fk_zone_id) REFERENCES zone_master(pk_zone_id)");
                        _logger.LogInformation("Added FK constraint fk_district_zone to district_master.");
                    }
                    catch (MySqlException ex)
                    {
                        _logger.LogWarning("Could not add FK fk_district_zone: {Message}", ex.Message);
                    }
                }

                // Migration: drop ALL uniqueness on DistrictNumber so duplicate district numbers can be imported
                // (Rotary.org sometimes returns the same district number multiple times for the same country/zone.)
                // Member sync remains scoped to target countries only — foreign duplicate districts will have no members.
                var oldUniqueExists = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'district_master'
                      AND INDEX_NAME = 'DistrictNumber' AND NON_UNIQUE = 0");
                if (oldUniqueExists > 0)
                {
                    try
                    {
                        await connection.ExecuteAsync("ALTER TABLE district_master DROP INDEX DistrictNumber");
                        _logger.LogInformation("Dropped old global UNIQUE on district_master.DistrictNumber.");
                    }
                    catch (MySqlException ex)
                    {
                        _logger.LogWarning("Could not drop old UNIQUE on DistrictNumber: {Message}", ex.Message);
                    }
                }

                var compositeUniqueExists = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'district_master'
                      AND INDEX_NAME = 'uk_district_zone_number'");
                if (compositeUniqueExists > 0)
                {
                    try
                    {
                        await connection.ExecuteAsync("ALTER TABLE district_master DROP INDEX uk_district_zone_number");
                        _logger.LogInformation("Dropped composite UNIQUE uk_district_zone_number on district_master.");
                    }
                    catch (MySqlException ex)
                    {
                        _logger.LogWarning("Could not drop composite UNIQUE uk_district_zone_number: {Message}", ex.Message);
                    }
                }

                // Migration: add denormalized Country column to district_master.
                // World-sync looks up districts by (Country, DistrictNumber) directly — simpler than joining zone_master.
                await AddColumnIfNotExists(connection, "district_master", "Country", "VARCHAR(100) NULL AFTER fk_zone_id");

                // SuperAdmin-set default currency for project-add forms (replaces guessing from the
                // freeform Country text above, which is unreliable — see CurrencyHelper.cs). NULL means
                // "not yet configured" — frontend falls back to the old country-based guess for these.
                await AddColumnIfNotExists(connection, "district_master", "DefaultCurrency", "VARCHAR(5) NULL AFTER Country");

                // Default every district to the brand's currency (the SuperAdmin manages exceptions
                // from Settings → Currency). Idempotent: only touches NULLs, so a
                // district a SuperAdmin already set explicitly is never overwritten.
                try
                {
                    var currencyBackfilled = await connection.ExecuteAsync(
                        "UPDATE district_master SET DefaultCurrency = @C WHERE DefaultCurrency IS NULL", new { C = Brand.SqlCurrency });
                    if (currencyBackfilled > 0)
                        _logger.LogInformation("Backfilled district_master.DefaultCurrency to {Currency} for {Count} rows.", Brand.SqlCurrency, currencyBackfilled);
                }
                catch (MySqlException ex)
                {
                    _logger.LogWarning("Could not backfill district_master.DefaultCurrency: {Message}", ex.Message);
                }

                // Backfill Country from zone_master.ZoneName for any rows where Country is NULL.
                // Idempotent — only updates NULL values, won't overwrite manually-set ones.
                try
                {
                    var backfilled = await connection.ExecuteAsync(@"
                        UPDATE district_master dm
                        JOIN zone_master zm ON zm.pk_zone_id = dm.fk_zone_id
                        SET dm.Country = zm.ZoneName
                        WHERE dm.Country IS NULL
                          AND dm.fk_zone_id IS NOT NULL
                          AND zm.isdeleted = 0");
                    if (backfilled > 0)
                        _logger.LogInformation("Backfilled district_master.Country for {Count} rows from zone_master.", backfilled);
                }
                catch (MySqlException ex)
                {
                    _logger.LogWarning("Could not backfill district_master.Country: {Message}", ex.Message);
                }

                // Index for faster (Country, DistrictNumber) lookups during sync
                var countryIdxExists = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'district_master'
                      AND INDEX_NAME = 'idx_district_country_number'");
                if (countryIdxExists == 0)
                {
                    try
                    {
                        await connection.ExecuteAsync(@"ALTER TABLE district_master
                            ADD INDEX idx_district_country_number (Country, DistrictNumber)");
                        _logger.LogInformation("Added index idx_district_country_number on district_master.");
                    }
                    catch (MySqlException ex)
                    {
                        _logger.LogWarning("Could not add idx_district_country_number: {Message}", ex.Message);
                    }
                }

                // (Removed for ROW: the original platform consolidated every zone outside its own Zones 4-8 /
                // India / Nepal / Sri Lanka / Taiwan list into "Other Zones" on each start-up, soft-deleting the rest.
                // On ROW that would wipe out the real zone structure every time the API restarts.)

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_master (
                        pk_club_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        ClubRotaryId VARCHAR(50) NOT NULL UNIQUE,
                        ClubName VARCHAR(300) NOT NULL,
                        Timezone VARCHAR(100) DEFAULT 'UTC',
                        ClubCharterDate DATE NULL,
                        ClubLogoPath VARCHAR(500),
                        ClubWebsite VARCHAR(500),
                        MeetingDay VARCHAR(20),
                        MeetingFromTime TIME NULL,
                        MeetingToTime TIME NULL,
                        MeetingAddress TEXT,
                        Country VARCHAR(100) DEFAULT 'India',
                        State VARCHAR(100),
                        City VARCHAR(100),
                        Pincode VARCHAR(10),
                        ActiveFromDate DATE NULL,
                        ActiveToDate DATE NULL,
                        IsAutomaticMeetingReminder TINYINT(1) DEFAULT 1,
                        IsFamilyLogin TINYINT(1) DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_district_id) REFERENCES district_master(pk_district_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_members (
                        pk_club_member_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        JoinedDate DATE NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        Designation VARCHAR(200) NULL,
                        ClassificationProfession VARCHAR(200) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id),
                        UNIQUE KEY uk_club_member (fk_club_id, fk_member_master_profile_id)
                    )");

                _logger.LogInformation("Auth tables ensured.");

                // Add missing columns to member_roles if they don't exist (for existing databases)
                await AddColumnIfNotExists(connection, "member_roles", "IsActive", "TINYINT(1) DEFAULT 1 AFTER AssignedBy");
                await AddColumnIfNotExists(connection, "member_roles", "RevokedDate", "DATETIME NULL AFTER IsActive");
                await AddColumnIfNotExists(connection, "member_roles", "RevokedBy", "INT NULL AFTER RevokedDate");
                await AddColumnIfNotExists(connection, "member_roles", "fk_club_id", "INT NULL AFTER fk_role_id");
                await AddColumnIfNotExists(connection, "member_roles", "fk_zone_id", "INT NULL AFTER fk_club_id");
                await AddColumnIfNotExists(connection, "member_roles", "fk_district_id", "INT NULL AFTER fk_zone_id");
                // District-Admin "all clubs access" flag. Only meaningful on a District-Admin row
                // (fk_role_id=2, fk_district_id>0, fk_club_id NULL/0). When 1, that district admin
                // may act as Club Admin for EVERY club in their district. Set ONLY by SuperAdmin.
                // Default 0 — no existing district admin gets club access implicitly.
                await AddColumnIfNotExists(connection, "member_roles", "AllClubsAccess", "TINYINT(1) NOT NULL DEFAULT 0 AFTER fk_district_id");

                // Add termination columns to club_members for Rotary Network module
                await AddColumnIfNotExists(connection, "club_members", "TerminationDate", "DATE NULL AFTER IsActive");
                await AddColumnIfNotExists(connection, "club_members", "TerminationReason", "VARCHAR(500) NULL AFTER TerminationDate");

                // Designation + ClassificationProfession moved from member_address_details (Step 11B 2026-06-18).
                // Stored per club-membership; same value typically across all clubs for a given member.
                await AddColumnIfNotExists(connection, "club_members", "Designation", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "club_members", "ClassificationProfession", "VARCHAR(200) NULL");

                // Honorary status is PER-CLUB (a member can be honorary in club A but
                // regular in club B). Moved from member_master_profile to club_members
                // 2026-06-26. Default 0 — data backfill from OLD DB done separately.
                await AddColumnIfNotExists(connection, "club_members", "IsHonoraryMember", "TINYINT(1) NOT NULL DEFAULT 0 AFTER ClassificationProfession");

                // Drop the legacy member-level honorary flag now that the per-club
                // column exists. Idempotent: only fires if the column is still there.
                var hasOldHonoraryCol = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'member_master_profile'
                      AND COLUMN_NAME = 'IsHonoraryMember'");
                if (hasOldHonoraryCol > 0)
                {
                    await connection.ExecuteAsync("ALTER TABLE member_master_profile DROP COLUMN IsHonoraryMember");
                    _logger.LogInformation("Dropped IsHonoraryMember from member_master_profile — moved to club_members (per-club).");
                }

                // BOD source tracking — 'Auto' if synced from Rotary.org, 'Manual' if entered via web portal.
                // Default 'Manual' so existing rows are treated as manual entries (safer assumption).
                await AddColumnIfNotExists(connection, "board_of_directors", "SyncSource", "VARCHAR(10) NULL DEFAULT 'Manual' AFTER fk_year_id");

                // Per-row sort order for drag-and-drop reorder within a club+year.
                // NULL falls back to designation_master.sort_order (legacy/default ordering).
                await AddColumnIfNotExists(connection, "board_of_directors", "sort_order", "INT NULL AFTER fk_year_id");

                // Rotary.org cache tables — populated by SuperAdmin manual-sync refresh button
                // (and optionally by daily delta worker). Compare UI reads from these tables for speed.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_org_clubs_cache (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        RotaryClubId INT NOT NULL,
                        ClubName VARCHAR(300),
                        ClubType VARCHAR(50),
                        DistrictNumber VARCHAR(20),
                        Country VARCHAR(100),
                        CharterDate DATE NULL,
                        NumberOfActiveMembers INT,
                        Latitude DOUBLE NULL,
                        Longitude DOUBLE NULL,
                        Website VARCHAR(500),
                        Email VARCHAR(200),
                        AddressLine1 VARCHAR(500),
                        City VARCHAR(200),
                        State VARCHAR(200),
                        PostalCode VARCHAR(20),
                        LastFetchedUtc DATETIME NOT NULL,
                        UNIQUE KEY uk_rotary_club_id (RotaryClubId),
                        INDEX idx_district (DistrictNumber)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_org_club_members_cache (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_rotary_club_id INT NOT NULL,
                        RotaryMemberId BIGINT NOT NULL,
                        LocalizedName VARCHAR(500),
                        Prefix VARCHAR(50),
                        FirstName VARCHAR(100),
                        MiddleName VARCHAR(100),
                        LastName VARCHAR(100),
                        Suffix VARCHAR(50),
                        AdmissionDate DATE NULL,
                        TerminationDate DATE NULL,
                        BirthYear VARCHAR(10),
                        MemberType VARCHAR(50),
                        LastFetchedUtc DATETIME NOT NULL,
                        UNIQUE KEY uk_club_member (fk_rotary_club_id, RotaryMemberId),
                        INDEX idx_club (fk_rotary_club_id)
                    )");

                // Persistent cache of Rotary.org's live terminated-members data, written through
                // whenever the club-level or district-level Rotary Network page does a live fetch.
                // Kept as its OWN table (not folded into rotary_org_club_members_cache) because that
                // table's refresh flow does DELETE-then-reinsert-active+honorary-only for a club —
                // sharing storage would wipe terminated rows on every unrelated active/honorary refresh.
                // No unique key on (club, member) — the same person can have more than one
                // termination event for the same club over the years.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_org_terminated_cache (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_rotary_club_id INT NOT NULL,
                        RotaryMemberId BIGINT NOT NULL,
                        LocalizedName VARCHAR(500),
                        Prefix VARCHAR(50),
                        FirstName VARCHAR(100),
                        MiddleName VARCHAR(100),
                        LastName VARCHAR(100),
                        Suffix VARCHAR(50),
                        AdmissionDate DATE NULL,
                        TerminationDate DATE NULL,
                        TerminationReason VARCHAR(500),
                        MemberType VARCHAR(50),
                        LastFetchedUtc DATETIME NOT NULL,
                        INDEX idx_club (fk_rotary_club_id)
                    )");

                // Tracks the server-side background job that warms rotary_org_terminated_cache for
                // a whole district — this is what lets the "Refresh from Rotary.org" action survive
                // the admin navigating away or closing the tab (see DistrictRotaryRefreshJobRunner),
                // and lets any tab/session poll the SAME job's progress rather than each browser
                // tab running its own client-side loop.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_rotary_refresh_jobs (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        Status VARCHAR(20) NOT NULL DEFAULT 'Running',
                        TotalLinkedClubs INT NOT NULL DEFAULT 0,
                        ClubsDone INT NOT NULL DEFAULT 0,
                        StartedByMemberId INT NULL,
                        StartedUtc DATETIME NOT NULL,
                        UpdatedUtc DATETIME NOT NULL,
                        FinishedUtc DATETIME NULL,
                        Warning VARCHAR(2000) NULL,
                        INDEX idx_district (fk_district_id)
                    )");

                // Extra profile fields cached when SuperAdmin clicks Refresh — populated per-member from /profile
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "Email", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "Mobile", "VARCHAR(50) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "DateOfBirth", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "Gender", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "PrimaryLanguage", "VARCHAR(50) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "AddressLine", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "City", "VARCHAR(100) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "State", "VARCHAR(100) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "Country", "VARCHAR(100) NULL");
                await AddColumnIfNotExists(connection, "rotary_org_club_members_cache", "PostalCode", "VARCHAR(20) NULL");

                // Add missing IsActive column to member_credentials if it doesn't exist
                await AddColumnIfNotExists(connection, "member_credentials", "IsActive", "TINYINT(1) DEFAULT 1 AFTER IsTemporaryPassword");

                // Cleanup: soft-delete duplicate role rows. A duplicate must share *all* scope
                // identifiers (club, district, zone) — otherwise Club Admin (role 2 + fk_club_id)
                // and District Admin (role 2 + fk_district_id) would be wrongly collapsed.
                // Use `<=>` (NULL-safe equality) so NULL == NULL on scope columns. Soft-delete
                // (isdeleted=1) instead of hard DELETE per project rule (CLAUDE.md: no hard deletes).
                await connection.ExecuteAsync(@"
                    UPDATE member_roles r1
                    INNER JOIN member_roles r2
                    ON r1.fk_member_master_profile_id = r2.fk_member_master_profile_id
                       AND r1.fk_role_id = r2.fk_role_id
                       AND r1.IsActive = r2.IsActive
                       AND r1.fk_club_id     <=> r2.fk_club_id
                       AND r1.fk_district_id <=> r2.fk_district_id
                       AND r1.fk_zone_id     <=> r2.fk_zone_id
                       AND r1.pk_member_role_id > r2.pk_member_role_id
                    SET r1.isdeleted = 1, r1.IsActive = 0, r1.modified_date = NOW()
                    WHERE r1.isdeleted = 0 AND r2.isdeleted = 0");
                _logger.LogInformation("Duplicate member_roles rows cleaned up (soft-delete, scope-aware).");

                // === Migration: Replace VARCHAR country columns with FK references ===
                // Step 1: Add FK columns if they don't exist
                await AddColumnIfNotExists(connection, "member_master_profile", "fk_primary_country_id", "INT DEFAULT 1 AFTER ProfilePhotoPath");
                await AddColumnIfNotExists(connection, "member_master_profile", "fk_secondary_country_id", "INT DEFAULT 1 AFTER BloodGroup");
                await AddColumnIfNotExists(connection, "member_address_details", "fk_country_id", "INT DEFAULT 1 AFTER AddressType");
                await AddColumnIfNotExists(connection, "member_family_details", "fk_country_id", "INT DEFAULT 1 AFTER BloodGroup");

                // Step 2: Populate FK values from existing country name columns (if old columns still exist)
                var hasPrimaryCountryCol = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_master_profile' AND COLUMN_NAME = 'PrimaryCountry'");
                if (hasPrimaryCountryCol > 0)
                {
                    await connection.ExecuteAsync(@"
                        UPDATE member_master_profile m
                        JOIN country_master c ON c.CountryName = m.PrimaryCountry
                        SET m.fk_primary_country_id = c.pk_country_id
                        WHERE m.fk_primary_country_id = 1 OR m.fk_primary_country_id IS NULL");

                    await connection.ExecuteAsync(@"
                        UPDATE member_master_profile m
                        JOIN country_master c ON c.CountryName = m.SecondaryCountry
                        SET m.fk_secondary_country_id = c.pk_country_id
                        WHERE m.fk_secondary_country_id = 1 OR m.fk_secondary_country_id IS NULL");

                    // Default remaining NULLs to India (pk_country_id=1)
                    await connection.ExecuteAsync("UPDATE member_master_profile SET fk_primary_country_id = 1 WHERE fk_primary_country_id IS NULL");
                    await connection.ExecuteAsync("UPDATE member_master_profile SET fk_secondary_country_id = 1 WHERE fk_secondary_country_id IS NULL");
                }

                var hasAddressCountryCol = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_address_details' AND COLUMN_NAME = 'Country'");
                if (hasAddressCountryCol > 0)
                {
                    await connection.ExecuteAsync(@"
                        UPDATE member_address_details a
                        JOIN country_master c ON c.CountryName = a.Country
                        SET a.fk_country_id = c.pk_country_id
                        WHERE a.fk_country_id = 1 OR a.fk_country_id IS NULL");
                    await connection.ExecuteAsync("UPDATE member_address_details SET fk_country_id = 1 WHERE fk_country_id IS NULL");
                }

                var hasFamilyCountryCol = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_family_details' AND COLUMN_NAME = 'Country'");
                if (hasFamilyCountryCol > 0)
                {
                    await connection.ExecuteAsync(@"
                        UPDATE member_family_details f
                        JOIN country_master c ON c.CountryName = f.Country
                        SET f.fk_country_id = c.pk_country_id
                        WHERE f.fk_country_id = 1 OR f.fk_country_id IS NULL");
                    await connection.ExecuteAsync("UPDATE member_family_details SET fk_country_id = 1 WHERE fk_country_id IS NULL");
                }

                // Step 3: Strip country codes from phone numbers
                await connection.ExecuteAsync(@"
                    UPDATE member_master_profile SET PrimaryMobileNumber = SUBSTRING_INDEX(PrimaryMobileNumber, '-', -1)
                    WHERE PrimaryMobileNumber LIKE '+%-%'");
                await connection.ExecuteAsync(@"
                    UPDATE member_master_profile SET SecondaryMobileNumber = SUBSTRING_INDEX(SecondaryMobileNumber, '-', -1)
                    WHERE SecondaryMobileNumber LIKE '+%-%'");
                await connection.ExecuteAsync(@"
                    UPDATE member_address_details SET PhoneNumber = SUBSTRING_INDEX(PhoneNumber, '-', -1)
                    WHERE PhoneNumber LIKE '+%-%'");
                await connection.ExecuteAsync(@"
                    UPDATE member_family_details SET PhoneNumber = SUBSTRING_INDEX(PhoneNumber, '-', -1)
                    WHERE PhoneNumber LIKE '+%-%'");

                // Step 4: Add FK constraints (check before add)
                await AddForeignKeyIfNotExists(connection, "member_master_profile", "fk_member_primary_country", "fk_primary_country_id", "country_master", "pk_country_id");
                await AddForeignKeyIfNotExists(connection, "member_master_profile", "fk_member_secondary_country", "fk_secondary_country_id", "country_master", "pk_country_id");
                await AddForeignKeyIfNotExists(connection, "member_address_details", "fk_address_country", "fk_country_id", "country_master", "pk_country_id");
                await AddForeignKeyIfNotExists(connection, "member_family_details", "fk_family_country", "fk_country_id", "country_master", "pk_country_id");

                // Step 5: Drop old VARCHAR country columns (check before drop)
                await DropColumnIfExists(connection, "member_master_profile", "PrimaryCountry");
                await DropColumnIfExists(connection, "member_master_profile", "SecondaryCountry");
                await DropColumnIfExists(connection, "member_address_details", "Country");
                await DropColumnIfExists(connection, "member_family_details", "Country");

                _logger.LogInformation("Country FK migration completed.");

                // Performance indexes
                await CreateIndexIfNotExists(connection, "member_master_profile", "idx_member_active", "CREATE INDEX idx_member_active ON member_master_profile (isdeleted, MemberName)");
                await CreateIndexIfNotExists(connection, "member_master_profile", "idx_member_blood_group", "CREATE INDEX idx_member_blood_group ON member_master_profile (isdeleted, BloodGroup)");
                await CreateIndexIfNotExists(connection, "member_master_profile", "idx_member_gender", "CREATE INDEX idx_member_gender ON member_master_profile (isdeleted, Gender)");
                await CreateIndexIfNotExists(connection, "member_master_profile", "idx_member_rotary_id", "CREATE INDEX idx_member_rotary_id ON member_master_profile (isdeleted, RotaryId)");
                await CreateIndexIfNotExists(connection, "member_master_profile", "idx_member_email", "CREATE INDEX idx_member_email ON member_master_profile (isdeleted, EmailId)");
                await CreateIndexIfNotExists(connection, "member_address_details", "idx_address_member_active", "CREATE INDEX idx_address_member_active ON member_address_details (fk_member_master_profile_id, isdeleted, AddressType)");
                await CreateIndexIfNotExists(connection, "member_family_details", "idx_family_member_active", "CREATE INDEX idx_family_member_active ON member_family_details (fk_member_master_profile_id, isdeleted)");
                // Old audit index removed — new indexes created with new audit_log schema later
                await CreateIndexIfNotExists(connection, "member_roles", "idx_member_roles_member", "CREATE INDEX idx_member_roles_member ON member_roles (fk_member_master_profile_id, isdeleted)");
                await CreateIndexIfNotExists(connection, "member_roles", "idx_member_roles_role", "CREATE INDEX idx_member_roles_role ON member_roles (fk_role_id, isdeleted)");
                await CreateIndexIfNotExists(connection, "member_credentials", "idx_credentials_member", "CREATE INDEX idx_credentials_member ON member_credentials (fk_member_master_profile_id, isdeleted)");
                await CreateIndexIfNotExists(connection, "password_reset_tokens", "idx_reset_token", "CREATE INDEX idx_reset_token ON password_reset_tokens (Token, IsUsed, ExpiryDate)");
                await CreateIndexIfNotExists(connection, "password_reset_tokens", "idx_reset_member", "CREATE INDEX idx_reset_member ON password_reset_tokens (fk_member_master_profile_id, IsUsed)");

                // Zone indexes
                await CreateIndexIfNotExists(connection, "zone_master", "idx_zone_active", "CREATE INDEX idx_zone_active ON zone_master (isdeleted, IsActive)");

                // District/Club indexes
                await CreateIndexIfNotExists(connection, "district_master", "idx_district_zone", "CREATE INDEX idx_district_zone ON district_master (fk_zone_id, isdeleted)");
                await CreateIndexIfNotExists(connection, "district_master", "idx_district_active", "CREATE INDEX idx_district_active ON district_master (isdeleted, IsActive)");
                await CreateIndexIfNotExists(connection, "club_master", "idx_club_active", "CREATE INDEX idx_club_active ON club_master (isdeleted, IsActive)");
                await CreateIndexIfNotExists(connection, "club_master", "idx_club_district", "CREATE INDEX idx_club_district ON club_master (fk_district_id, isdeleted)");
                await CreateIndexIfNotExists(connection, "club_members", "idx_club_members_club", "CREATE INDEX idx_club_members_club ON club_members (fk_club_id, isdeleted)");
                await CreateIndexIfNotExists(connection, "club_members", "idx_club_members_member", "CREATE INDEX idx_club_members_member ON club_members (fk_member_master_profile_id, isdeleted)");

                // BEFORE DELETE triggers (prevent hard deletes)
                await CreateTriggerIfNotExists(connection, "trg_prevent_hard_delete_member", @"
                    CREATE TRIGGER trg_prevent_hard_delete_member BEFORE DELETE ON member_master_profile
                    FOR EACH ROW
                    BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END");

                await CreateTriggerIfNotExists(connection, "trg_prevent_hard_delete_address", @"
                    CREATE TRIGGER trg_prevent_hard_delete_address BEFORE DELETE ON member_address_details
                    FOR EACH ROW
                    BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END");

                await CreateTriggerIfNotExists(connection, "trg_prevent_hard_delete_family", @"
                    CREATE TRIGGER trg_prevent_hard_delete_family BEFORE DELETE ON member_family_details
                    FOR EACH ROW
                    BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END");

                await CreateTriggerIfNotExists(connection, "trg_prevent_hard_delete_district", @"
                    CREATE TRIGGER trg_prevent_hard_delete_district BEFORE DELETE ON district_master
                    FOR EACH ROW
                    BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END");

                await CreateTriggerIfNotExists(connection, "trg_prevent_hard_delete_club", @"
                    CREATE TRIGGER trg_prevent_hard_delete_club BEFORE DELETE ON club_master
                    FOR EACH ROW
                    BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END");

                await CreateTriggerIfNotExists(connection, "trg_prevent_hard_delete_club_member", @"
                    CREATE TRIGGER trg_prevent_hard_delete_club_member BEFORE DELETE ON club_members
                    FOR EACH ROW
                    BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END");

                // Drop and recreate audit triggers with new column names
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_member");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_address");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_family");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_member");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_address");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_family");

                // Audit triggers removed — middleware-based audit logging handles all CRUD operations now.
                // Drop ALL old audit triggers (member + district + club)
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_district");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_club");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_club_member");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_district");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_club");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_club_member");

                /* OLD TRIGGER CODE REMOVED — START
                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_insert_member AFTER INSERT ON member_master_profile
                    FOR EACH ROW
                    BEGIN
                        INSERT INTO audit_log (table_name, record_id, action_type, new_values, action_by, action_date)
                        VALUES ('member_master_profile', NEW.pk_member_master_profile_id, 'INSERT',
                            JSON_OBJECT(
                                'MemberName', NEW.MemberName, 'ProfilePhotoPath', NEW.ProfilePhotoPath,
                                'fk_primary_country_id', NEW.fk_primary_country_id, 'PrimaryMobileNumber', NEW.PrimaryMobileNumber,
                                'EmailId', NEW.EmailId, 'BirthDate', NEW.BirthDate, 'AnniversaryDate', NEW.AnniversaryDate,
                                'BloodGroup', NEW.BloodGroup, 'Gender', NEW.Gender, 'PrimaryLanguage', NEW.PrimaryLanguage,
                                'RotaryId', NEW.RotaryId, 'DonorRecognition', NEW.DonorRecognition
                            ),
                            NEW.created_by, NOW());
                    END");

                // Designation + ClassificationProfession dropped from member_address_details
                // 2026-06-22 — they live on club_members now. Trigger no longer references them.
                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_insert_address AFTER INSERT ON member_address_details
                    FOR EACH ROW
                    BEGIN
                        INSERT INTO audit_log (table_name, record_id, action_type, new_values, action_by, action_date)
                        VALUES ('member_address_details', NEW.pk_member_address_details_id, 'INSERT',
                            JSON_OBJECT(
                                'fk_member_master_profile_id', NEW.fk_member_master_profile_id, 'AddressType', NEW.AddressType,
                                'fk_country_id', NEW.fk_country_id, 'PhoneNumber', NEW.PhoneNumber, 'Address', NEW.Address,
                                'State', NEW.State, 'City', NEW.City, 'PinCode', NEW.PinCode,
                                'BusinessName', NEW.BusinessName, 'BusinessEmailId', NEW.BusinessEmailId,
                                'Keywords', NEW.Keywords
                            ),
                            NEW.created_by, NOW());
                    END");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_insert_family AFTER INSERT ON member_family_details
                    FOR EACH ROW
                    BEGIN
                        INSERT INTO audit_log (table_name, record_id, action_type, new_values, action_by, action_date)
                        VALUES ('member_family_details', NEW.pk_member_family_details_id, 'INSERT',
                            JSON_OBJECT(
                                'fk_member_master_profile_id', NEW.fk_member_master_profile_id, 'Name', NEW.Name, 'Relation', NEW.Relation,
                                'BloodGroup', NEW.BloodGroup, 'fk_country_id', NEW.fk_country_id, 'PhoneNumber', NEW.PhoneNumber,
                                'EmailId', NEW.EmailId, 'BirthDate', NEW.BirthDate, 'AnniversaryDate', NEW.AnniversaryDate,
                                'PhotoPath', NEW.PhotoPath
                            ),
                            NEW.created_by, NOW());
                    END");

                // AFTER UPDATE triggers (full record on SOFT_DELETE for recovery)
                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_update_member AFTER UPDATE ON member_master_profile
                    FOR EACH ROW
                    BEGIN
                        IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, action_by, action_date)
                            VALUES ('member_master_profile', OLD.pk_member_master_profile_id, 'SOFT_DELETE',
                                JSON_OBJECT(
                                    'MemberName', OLD.MemberName, 'ProfilePhotoPath', OLD.ProfilePhotoPath,
                                    'fk_primary_country_id', OLD.fk_primary_country_id, 'PrimaryMobileNumber', OLD.PrimaryMobileNumber,
                                    'EmailId', OLD.EmailId, 'BirthDate', OLD.BirthDate, 'AnniversaryDate', OLD.AnniversaryDate,
                                    'BloodGroup', OLD.BloodGroup, 'fk_secondary_country_id', OLD.fk_secondary_country_id,
                                    'SecondaryMobileNumber', OLD.SecondaryMobileNumber,
                                    'IsPersonalDetailsVisible', OLD.IsPersonalDetailsVisible,
                                    'Gender', OLD.Gender,
                                    'PrimaryLanguage', OLD.PrimaryLanguage, 'IsYouth', OLD.IsYouth,
                                    'MemberIntroduction', OLD.MemberIntroduction,
                                    'Facebook', OLD.Facebook, 'Instagram', OLD.Instagram, 'LinkedIn', OLD.LinkedIn,
                                    'Twitter', OLD.Twitter, 'Youtube', OLD.Youtube, 'Website', OLD.Website,
                                    'RotaryId', OLD.RotaryId, 'DonorRecognition', OLD.DonorRecognition,
                                    'FamilyPhotoPath', OLD.FamilyPhotoPath, 'IsFamilyDetailsVisible', OLD.IsFamilyDetailsVisible
                                ),
                                NEW.deleted_by, NOW());
                        ELSE
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, new_values, action_by, action_date)
                            VALUES ('member_master_profile', OLD.pk_member_master_profile_id, 'UPDATE',
                                JSON_OBJECT(
                                    'MemberName', OLD.MemberName, 'PrimaryMobileNumber', OLD.PrimaryMobileNumber,
                                    'EmailId', OLD.EmailId, 'BloodGroup', OLD.BloodGroup, 'Gender', OLD.Gender,
                                    'RotaryId', OLD.RotaryId, 'DonorRecognition', OLD.DonorRecognition
                                ),
                                JSON_OBJECT(
                                    'MemberName', NEW.MemberName, 'PrimaryMobileNumber', NEW.PrimaryMobileNumber,
                                    'EmailId', NEW.EmailId, 'BloodGroup', NEW.BloodGroup, 'Gender', NEW.Gender,
                                    'RotaryId', NEW.RotaryId, 'DonorRecognition', NEW.DonorRecognition
                                ),
                                NEW.modified_by, NOW());
                        END IF;
                    END");

                // Designation + ClassificationProfession dropped from member_address_details
                // 2026-06-22 — they live on club_members now. Trigger no longer references them.
                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_update_address AFTER UPDATE ON member_address_details
                    FOR EACH ROW
                    BEGIN
                        IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, action_by, action_date)
                            VALUES ('member_address_details', OLD.pk_member_address_details_id, 'SOFT_DELETE',
                                JSON_OBJECT(
                                    'fk_member_master_profile_id', OLD.fk_member_master_profile_id, 'AddressType', OLD.AddressType,
                                    'fk_country_id', OLD.fk_country_id, 'PhoneNumber', OLD.PhoneNumber, 'Address', OLD.Address,
                                    'State', OLD.State, 'City', OLD.City, 'PinCode', OLD.PinCode,
                                    'BusinessName', OLD.BusinessName, 'BusinessEmailId', OLD.BusinessEmailId,
                                    'Keywords', OLD.Keywords
                                ),
                                NEW.deleted_by, NOW());
                        ELSE
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, new_values, action_by, action_date)
                            VALUES ('member_address_details', OLD.pk_member_address_details_id, 'UPDATE',
                                JSON_OBJECT(
                                    'fk_member_master_profile_id', OLD.fk_member_master_profile_id, 'AddressType', OLD.AddressType,
                                    'fk_country_id', OLD.fk_country_id, 'PhoneNumber', OLD.PhoneNumber, 'Address', OLD.Address,
                                    'State', OLD.State, 'City', OLD.City, 'PinCode', OLD.PinCode,
                                    'BusinessName', OLD.BusinessName
                                ),
                                JSON_OBJECT(
                                    'fk_member_master_profile_id', NEW.fk_member_master_profile_id, 'AddressType', NEW.AddressType,
                                    'fk_country_id', NEW.fk_country_id, 'PhoneNumber', NEW.PhoneNumber, 'Address', NEW.Address,
                                    'State', NEW.State, 'City', NEW.City, 'PinCode', NEW.PinCode,
                                    'BusinessName', NEW.BusinessName
                                ),
                                NEW.modified_by, NOW());
                        END IF;
                    END");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_update_family AFTER UPDATE ON member_family_details
                    FOR EACH ROW
                    BEGIN
                        IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, action_by, action_date)
                            VALUES ('member_family_details', OLD.pk_member_family_details_id, 'SOFT_DELETE',
                                JSON_OBJECT(
                                    'fk_member_master_profile_id', OLD.fk_member_master_profile_id, 'Name', OLD.Name, 'Relation', OLD.Relation,
                                    'BloodGroup', OLD.BloodGroup, 'fk_country_id', OLD.fk_country_id, 'PhoneNumber', OLD.PhoneNumber,
                                    'EmailId', OLD.EmailId, 'BirthDate', OLD.BirthDate, 'AnniversaryDate', OLD.AnniversaryDate,
                                    'PhotoPath', OLD.PhotoPath
                                ),
                                NEW.deleted_by, NOW());
                        ELSE
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, new_values, action_by, action_date)
                            VALUES ('member_family_details', OLD.pk_member_family_details_id, 'UPDATE',
                                JSON_OBJECT(
                                    'fk_member_master_profile_id', OLD.fk_member_master_profile_id, 'Name', OLD.Name, 'Relation', OLD.Relation,
                                    'BloodGroup', OLD.BloodGroup, 'fk_country_id', OLD.fk_country_id, 'PhoneNumber', OLD.PhoneNumber,
                                    'EmailId', OLD.EmailId, 'BirthDate', OLD.BirthDate, 'AnniversaryDate', OLD.AnniversaryDate,
                                    'PhotoPath', OLD.PhotoPath
                                ),
                                JSON_OBJECT(
                                    'fk_member_master_profile_id', NEW.fk_member_master_profile_id, 'Name', NEW.Name, 'Relation', NEW.Relation,
                                    'BloodGroup', NEW.BloodGroup, 'fk_country_id', NEW.fk_country_id, 'PhoneNumber', NEW.PhoneNumber,
                                    'EmailId', NEW.EmailId, 'BirthDate', NEW.BirthDate, 'AnniversaryDate', NEW.AnniversaryDate,
                                    'PhotoPath', NEW.PhotoPath
                                ),
                                NEW.modified_by, NOW());
                        END IF;
                    END");

                // District/Club audit triggers
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_district");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_club");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_insert_club_member");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_district");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_club");
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_audit_update_club_member");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_insert_district AFTER INSERT ON district_master
                    FOR EACH ROW
                    BEGIN
                        INSERT INTO audit_log (table_name, record_id, action_type, new_values, action_by, action_date)
                        VALUES ('district_master', NEW.pk_district_id, 'INSERT',
                            JSON_OBJECT('DistrictNumber', NEW.DistrictNumber, 'IsActive', NEW.IsActive),
                            NEW.created_by, NOW());
                    END");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_insert_club AFTER INSERT ON club_master
                    FOR EACH ROW
                    BEGIN
                        INSERT INTO audit_log (table_name, record_id, action_type, new_values, action_by, action_date)
                        VALUES ('club_master', NEW.pk_club_id, 'INSERT',
                            JSON_OBJECT('ClubName', NEW.ClubName, 'ClubRotaryId', NEW.ClubRotaryId,
                                'fk_district_id', NEW.fk_district_id, 'IsActive', NEW.IsActive),
                            NEW.created_by, NOW());
                    END");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_insert_club_member AFTER INSERT ON club_members
                    FOR EACH ROW
                    BEGIN
                        INSERT INTO audit_log (table_name, record_id, action_type, new_values, action_by, action_date)
                        VALUES ('club_members', NEW.pk_club_member_id, 'INSERT',
                            JSON_OBJECT('fk_club_id', NEW.fk_club_id,
                                'fk_member_master_profile_id', NEW.fk_member_master_profile_id,
                                'JoinedDate', NEW.JoinedDate),
                            NEW.created_by, NOW());
                    END");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_update_district AFTER UPDATE ON district_master
                    FOR EACH ROW
                    BEGIN
                        IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, action_by, action_date)
                            VALUES ('district_master', OLD.pk_district_id, 'SOFT_DELETE',
                                JSON_OBJECT('DistrictNumber', OLD.DistrictNumber, 'IsActive', OLD.IsActive),
                                NEW.deleted_by, NOW());
                        ELSE
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, new_values, action_by, action_date)
                            VALUES ('district_master', OLD.pk_district_id, 'UPDATE',
                                JSON_OBJECT('DistrictNumber', OLD.DistrictNumber, 'IsActive', OLD.IsActive),
                                JSON_OBJECT('DistrictNumber', NEW.DistrictNumber, 'IsActive', NEW.IsActive),
                                NEW.modified_by, NOW());
                        END IF;
                    END");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_update_club AFTER UPDATE ON club_master
                    FOR EACH ROW
                    BEGIN
                        IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, action_by, action_date)
                            VALUES ('club_master', OLD.pk_club_id, 'SOFT_DELETE',
                                JSON_OBJECT('ClubName', OLD.ClubName, 'ClubRotaryId', OLD.ClubRotaryId, 'fk_district_id', OLD.fk_district_id),
                                NEW.deleted_by, NOW());
                        ELSE
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, new_values, action_by, action_date)
                            VALUES ('club_master', OLD.pk_club_id, 'UPDATE',
                                JSON_OBJECT('ClubName', OLD.ClubName, 'ClubRotaryId', OLD.ClubRotaryId, 'IsActive', OLD.IsActive),
                                JSON_OBJECT('ClubName', NEW.ClubName, 'ClubRotaryId', NEW.ClubRotaryId, 'IsActive', NEW.IsActive),
                                NEW.modified_by, NOW());
                        END IF;
                    END");

                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_audit_update_club_member AFTER UPDATE ON club_members
                    FOR EACH ROW
                    BEGIN
                        IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, action_by, action_date)
                            VALUES ('club_members', OLD.pk_club_member_id, 'SOFT_DELETE',
                                JSON_OBJECT('fk_club_id', OLD.fk_club_id, 'fk_member_master_profile_id', OLD.fk_member_master_profile_id),
                                NEW.deleted_by, NOW());
                        ELSE
                            INSERT INTO audit_log (table_name, record_id, action_type, old_values, new_values, action_by, action_date)
                            VALUES ('club_members', OLD.pk_club_member_id, 'UPDATE',
                                JSON_OBJECT('fk_club_id', OLD.fk_club_id, 'fk_member_master_profile_id', OLD.fk_member_master_profile_id, 'IsActive', OLD.IsActive),
                                JSON_OBJECT('fk_club_id', NEW.fk_club_id, 'fk_member_master_profile_id', NEW.fk_member_master_profile_id, 'IsActive', NEW.IsActive),
                                NEW.modified_by, NOW());
                        END IF;
                    END");
                OLD TRIGGER CODE REMOVED — END */

                // Module management tables
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS module_categories (
                        pk_category_id INT AUTO_INCREMENT PRIMARY KEY,
                        CategoryName VARCHAR(100) NOT NULL,
                        SortOrder INT NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS module_master (
                        pk_module_id INT AUTO_INCREMENT PRIMARY KEY,
                        ModuleName VARCHAR(100) NOT NULL,
                        ModuleKey VARCHAR(50) NOT NULL UNIQUE,
                        fk_category_id INT NOT NULL,
                        ModuleLevel ENUM('District','Club','Both') NOT NULL DEFAULT 'Both',
                        IconClass VARCHAR(100),
                        IconPath VARCHAR(200),
                        Description VARCHAR(255),
                        RouteUrl VARCHAR(200),
                        IsDefaultForDistrict TINYINT(1) DEFAULT 0,
                        IsDefaultForClub TINYINT(1) DEFAULT 0,
                        SortOrder INT NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_category_id) REFERENCES module_categories(pk_category_id)
                    )");

                // Migration: Add IconPath to module_master
                await AddColumnIfNotExists(connection, "module_master", "IconPath", "VARCHAR(200) AFTER IconClass");

                // Migration: Add IsDefaultForMember to module_master — controls
                // whether a Club-level module is auto-pushed to the member's
                // mobile app dashboard on login.
                await AddColumnIfNotExists(connection, "module_master", "IsDefaultForMember", "TINYINT(1) DEFAULT 0 AFTER IsDefaultForClub");

                // Migration: Move Club Monthly Report from E-Governance to Master Modules (after Clubs)
                var masterCatId = await connection.ExecuteScalarAsync<int?>(
                    "SELECT pk_category_id FROM module_categories WHERE CategoryName = 'Master Modules' AND isdeleted = 0");
                if (masterCatId.HasValue)
                {
                    await connection.ExecuteAsync(@"
                        UPDATE module_master SET fk_category_id = @CatId, SortOrder = 9
                        WHERE ModuleKey = 'club_monthly_report' AND isdeleted = 0",
                        new { CatId = masterCatId.Value });
                }

                // Rename District Citation to District Awards
                await connection.ExecuteAsync(@"
                    UPDATE module_master SET ModuleName = 'District Awards'
                    WHERE ModuleKey = 'district_citation' AND isdeleted = 0");

                // Soft-delete duplicate "Club Reports" module — the "Reports" tile (ModuleKey='reports')
                // points at the same /club-report page, so the duplicate "club_report" tile was redundant.
                await connection.ExecuteAsync(@"
                    UPDATE module_master SET isdeleted = 1
                    WHERE ModuleKey = 'club_report' AND isdeleted = 0");

                // Market Place — no external marketplace site for this instance: no route.
                await connection.ExecuteAsync(@"
                    UPDATE module_master
                    SET RouteUrl = ''
                    WHERE ModuleKey = 'market_place' AND isdeleted = 0");

                // Zonal Awards — district only, remove from all clubs
                await connection.ExecuteAsync(@"
                    UPDATE module_master SET ModuleLevel = 'District', IsDefaultForClub = 0
                    WHERE ModuleKey = 'zonal_awards' AND isdeleted = 0");
                await connection.ExecuteAsync(@"
                    DELETE FROM club_modules WHERE fk_module_id IN (
                        SELECT pk_module_id FROM module_master WHERE ModuleKey = 'zonal_awards'
                    )");

                // Add IsZonalAwardsEnabled column to zone_master
                await AddColumnIfNotExists(connection, "zone_master", "IsZonalAwardsEnabled", "TINYINT(1) DEFAULT 0 AFTER IsActive");

                // Add Is_healthy_club column to club_master (for Zonal Awards Q5 auto calculation)
                await AddColumnIfNotExists(connection, "club_master", "Is_healthy_club", "VARCHAR(10) NULL");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_modules (
                        pk_district_module_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_module_id INT NOT NULL,
                        IsEnabled TINYINT(1) DEFAULT 1,
                        AssignedBy INT NULL,
                        AssignedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_district_id) REFERENCES district_master(pk_district_id),
                        FOREIGN KEY (fk_module_id) REFERENCES module_master(pk_module_id) ON DELETE CASCADE,
                        UNIQUE KEY uk_district_module (fk_district_id, fk_module_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_modules (
                        pk_club_module_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_module_id INT NOT NULL,
                        IsEnabled TINYINT(1) DEFAULT 1,
                        AssignedBy INT NULL,
                        AssignedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_module_id) REFERENCES module_master(pk_module_id) ON DELETE CASCADE,
                        UNIQUE KEY uk_club_module (fk_club_id, fk_module_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_year_master (
                        pk_year_id INT AUTO_INCREMENT PRIMARY KEY,
                        YearLabel VARCHAR(10) NOT NULL UNIQUE,
                        StartDate DATE NOT NULL,
                        EndDate DATE NOT NULL,
                        IsCurrent TINYINT(1) DEFAULT 0,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS past_presidents (
                        pk_past_president_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id),
                        UNIQUE KEY uk_club_year (fk_club_id, fk_year_id)
                    )");

                // Past Presidents — Member / Non-Member support (idempotent migration):
                //   1. fk_member_master_profile_id → NULLable (so non-member rows have no FK)
                //   2. non_member_name VARCHAR(200) NULL (display name for non-member entries)
                // Both columns must remain backward-compatible with existing member-only rows.
                var ppMemberFkNullable = await connection.ExecuteScalarAsync<string?>(@"
                    SELECT IS_NULLABLE FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'past_presidents'
                      AND COLUMN_NAME = 'fk_member_master_profile_id'");
                if (ppMemberFkNullable != null && !string.Equals(ppMemberFkNullable, "YES", StringComparison.OrdinalIgnoreCase))
                {
                    await connection.ExecuteAsync(@"
                        ALTER TABLE past_presidents
                        MODIFY COLUMN fk_member_master_profile_id INT NULL");
                }
                await AddColumnIfNotExists(connection, "past_presidents", "non_member_name", "VARCHAR(200) NULL AFTER fk_member_master_profile_id");
                //   3. non_member_photo VARCHAR(255) NULL — profile photo FILENAME (only) for non-member entries.
                //      URL rebuilt on read as /Documents/pastpresidents/Group{clubId}/{filename}. Members keep
                //      using member_master_profile.ProfilePhotoPath — this column is non-member only.
                await AddColumnIfNotExists(connection, "past_presidents", "non_member_photo", "VARCHAR(255) NULL AFTER non_member_name");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS designation_master (
                        pk_designation_id INT AUTO_INCREMENT PRIMARY KEY,
                        designation_name VARCHAR(100) NOT NULL,
                        sort_order INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS board_of_directors (
                        pk_board_director_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        fk_designation_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id),
                        FOREIGN KEY (fk_designation_id) REFERENCES designation_master(pk_designation_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                // Board of Directors — Non-Member support for PAST years (idempotent migration):
                //   1. fk_member_master_profile_id → NULLable (non-member rows carry no member FK)
                //   2. non_member_name / _mobile / _email — captured for non-member BOD entries.
                // Backward-compatible: existing member rows keep their FK and leave these NULL.
                var bodMemberFkNullable = await connection.ExecuteScalarAsync<string?>(@"
                    SELECT IS_NULLABLE FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'board_of_directors'
                      AND COLUMN_NAME = 'fk_member_master_profile_id'");
                if (bodMemberFkNullable != null && !string.Equals(bodMemberFkNullable, "YES", StringComparison.OrdinalIgnoreCase))
                {
                    await connection.ExecuteAsync(@"
                        ALTER TABLE board_of_directors
                        MODIFY COLUMN fk_member_master_profile_id INT NULL");
                }
                await AddColumnIfNotExists(connection, "board_of_directors", "non_member_name", "VARCHAR(200) NULL AFTER fk_member_master_profile_id");
                await AddColumnIfNotExists(connection, "board_of_directors", "non_member_mobile", "VARCHAR(20) NULL AFTER non_member_name");
                await AddColumnIfNotExists(connection, "board_of_directors", "non_member_email", "VARCHAR(200) NULL AFTER non_member_mobile");
                // Free-text designation name used when fk_designation_id points to the "Other" designation.
                await AddColumnIfNotExists(connection, "board_of_directors", "custom_designation", "VARCHAR(150) NULL AFTER fk_designation_id");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS website_data_module_master (
                        pk_website_data_module_id INT AUTO_INCREMENT PRIMARY KEY,
                        module_name VARCHAR(100) NOT NULL,
                        module_key VARCHAR(50) NOT NULL,
                        icon_class VARCHAR(50) DEFAULT 'Globe',
                        sort_order INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS theme_master (
                        pk_theme_id INT AUTO_INCREMENT PRIMARY KEY,
                        theme_name VARCHAR(100) NOT NULL,
                        theme_image_path VARCHAR(500) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_theme (
                        pk_club_website_theme_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_theme_id INT NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY uk_club_year (fk_club_id, fk_year_id),
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id),
                        FOREIGN KEY (fk_theme_id) REFERENCES theme_master(pk_theme_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_banner (
                        pk_club_website_banner_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        banner_image_path VARCHAR(500) NOT NULL,
                        description VARCHAR(500) NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_advertisement (
                        pk_club_website_advertisement_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        advertisement_image_path VARCHAR(500) NOT NULL,
                        document_path VARCHAR(500) NULL,
                        description VARCHAR(500) NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_social_link (
                        pk_club_website_social_link_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        platform VARCHAR(50) NOT NULL,
                        link_url VARCHAR(500) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_contact_detail (
                        pk_club_website_contact_detail_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        email VARCHAR(200) NOT NULL DEFAULT '',
                        phone VARCHAR(20) NOT NULL DEFAULT '',
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_about (
                        pk_club_website_about_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        content LONGTEXT NOT NULL,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                // ── District Committee Tables ──────────────────────────────
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_committee_member (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_member_id INT NULL,
                        is_member TINYINT(1) DEFAULT 1,
                        name VARCHAR(200) NOT NULL,
                        mobile VARCHAR(20) NULL,
                        email VARCHAR(200) NULL,
                        district_designation VARCHAR(300) NULL,
                        fk_club_id INT NULL,
                        club_name VARCHAR(300) NULL,
                        district_remark TEXT NULL,
                        profile_photo VARCHAR(500) NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_committee_group (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        group_name VARCHAR(300) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_committee_group_member (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_group_id INT NOT NULL,
                        fk_member_id INT NULL,
                        is_member TINYINT(1) DEFAULT 1,
                        name VARCHAR(200) NOT NULL,
                        mobile VARCHAR(20) NULL,
                        email VARCHAR(200) NULL,
                        district_designation VARCHAR(300) NULL,
                        fk_club_id INT NULL,
                        club_name VARCHAR(300) NULL,
                        district_remark TEXT NULL,
                        profile_photo VARCHAR(500) NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_committee_sub_group (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_group_id INT NOT NULL,
                        sub_group_name VARCHAR(300) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_committee_sub_group_member (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_sub_group_id INT NOT NULL,
                        fk_member_id INT NULL,
                        is_member TINYINT(1) DEFAULT 1,
                        name VARCHAR(200) NOT NULL,
                        mobile VARCHAR(20) NULL,
                        email VARCHAR(200) NULL,
                        district_designation VARCHAR(300) NULL,
                        fk_club_id INT NULL,
                        club_name VARCHAR(300) NULL,
                        district_remark TEXT NULL,
                        profile_photo VARCHAR(500) NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0
                    )");

                // Migration for older deploys: free-text club name for NON-member committee entries
                // (members get their club via fk_club_id -> club_master; non-members store the typed club name here).
                await AddColumnIfNotExists(connection, "district_committee_member", "club_name", "VARCHAR(300) NULL AFTER fk_club_id");
                await AddColumnIfNotExists(connection, "district_committee_group_member", "club_name", "VARCHAR(300) NULL AFTER fk_club_id");
                await AddColumnIfNotExists(connection, "district_committee_sub_group_member", "club_name", "VARCHAR(300) NULL AFTER fk_club_id");

                // District AG (Assistant Governor) — year-scoped: same club can have different
                // AG in different rotary years. UNIQUE constraint enforces one AG per club per year.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_ag (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NULL,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        UNIQUE KEY uk_ag_club_year (fk_club_id, fk_year_id)
                    )");

                // Migration for older deploys: add fk_year_id if missing, swap unique key,
                // and backfill existing rows to the current rotary year so they remain visible
                // under year-filtered AG views. Each step is wrapped in try/catch so partial
                // migrations don't crash startup.
                await AddColumnIfNotExists(connection, "district_ag", "fk_year_id", "INT NULL AFTER fk_club_id");
                try
                {
                    await connection.ExecuteAsync("ALTER TABLE district_ag DROP INDEX uk_ag_club");
                }
                catch { /* index already gone — first time we ran the new schema */ }
                try
                {
                    await connection.ExecuteAsync("ALTER TABLE district_ag ADD UNIQUE KEY uk_ag_club_year (fk_club_id, fk_year_id)");
                }
                catch { /* already added */ }
                // Backfill: any row still missing fk_year_id gets the current rotary year.
                try
                {
                    await connection.ExecuteAsync(@"
                        UPDATE district_ag
                        SET fk_year_id = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1)
                        WHERE fk_year_id IS NULL AND isdeleted = 0");
                }
                catch { /* no current year yet — skip */ }

                // SuperAdmin audit log — records every promote/remove action from Super Admin Role Config
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS superadmin_audit (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_target_member_id INT NOT NULL,
                        fk_by_member_id INT NOT NULL,
                        Action VARCHAR(20) NOT NULL,
                        OtpSentTo VARCHAR(200) NULL,
                        IpAddress VARCHAR(64) NULL,
                        TimestampUtc DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        INDEX idx_sa_audit_target (fk_target_member_id),
                        INDEX idx_sa_audit_by (fk_by_member_id)
                    )");

                // District Club Moderator
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_club_moderator (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        UNIQUE KEY uk_club_moderator (fk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_menu (
                        pk_club_website_menu_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        menu_name VARCHAR(200) NOT NULL,
                        link_type VARCHAR(20) NOT NULL DEFAULT 'page',
                        link_value VARCHAR(500) NOT NULL DEFAULT '',
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_submenu (
                        pk_club_website_submenu_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_menu_id INT NOT NULL,
                        submenu_name VARCHAR(200) NOT NULL,
                        link_type VARCHAR(20) NOT NULL DEFAULT 'page',
                        link_value VARCHAR(500) NOT NULL DEFAULT '',
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        is_system_managed TINYINT(1) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_menu_id) REFERENCES club_website_menu(pk_club_website_menu_id)
                    )");

                // Add is_system_managed for clubs created before this migration.
                // Avenue sub-menus are locked rows that admin cannot delete or edit.
                try
                {
                    await connection.ExecuteAsync(@"
                        ALTER TABLE club_website_submenu
                        ADD COLUMN is_system_managed TINYINT(1) DEFAULT 0 AFTER is_active");
                }
                catch { /* column already exists — older deploys */ }

                // One-time backfill: every existing club website's Projects menu gets the
                // 6 avenue sub-menus. Idempotent — skips any name already present so admins
                // who manually added their own customs (or who already have these) aren't
                // disturbed. Runs every startup but only inserts missing rows.
                await BackfillProjectsSubMenusAsync(connection);

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS potential_members (
                        pk_potential_member_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        name VARCHAR(200) NOT NULL,
                        email VARCHAR(200) NULL,
                        mobile_number VARCHAR(20) NULL,
                        reference_details VARCHAR(500) NULL,
                        fk_member_master_profile_id_as_referrer INT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_member_master_profile_id_as_referrer) REFERENCES member_master_profile(pk_member_master_profile_id)
                    )");

                // ── Foundation Collection Goals (Phase C) ──
                // One ACTIVE row per (club, year). Past years are read-only
                // (enforced server-side by checking EndDate < CURDATE()).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_foundation_collection_goals (
                        pk_goal_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        apf_goal_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
                        polio_plus_goal_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
                        endowment_fund_goal_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
                        other_goal_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
                        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                        remarks VARCHAR(500) NULL,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        UNIQUE KEY uk_fgoal_club_year_active (fk_club_id, fk_year_id, isdeleted),
                        INDEX idx_fgoal_club_year (fk_club_id, fk_year_id, isdeleted),
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                // ── Master tables for service projects ──
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS area_of_focus_master (
                        pk_area_of_focus_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_module_id INT NULL,
                        name VARCHAR(200) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                // Add fk_module_id column if not exists (migration)
                await AddColumnIfNotExists(connection, "area_of_focus_master", "fk_module_id", "INT NULL AFTER pk_area_of_focus_id");
                await AddColumnIfNotExists(connection, "area_of_focus_master", "image_path", "VARCHAR(500) NULL AFTER name");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS category_master (
                        pk_category_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_area_of_focus_id INT NOT NULL,
                        name VARCHAR(200) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_area_of_focus_id) REFERENCES area_of_focus_master(pk_area_of_focus_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS sub_category_master (
                        pk_sub_category_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_category_id INT NOT NULL,
                        name VARCHAR(200) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_category_id) REFERENCES category_master(pk_category_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS funding_master (
                        pk_funding_id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(200) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                // ── Main projects table (all 6 service modules) ──
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_projects (
                        pk_project_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_module_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        project_type VARCHAR(20) NOT NULL DEFAULT 'one_time',
                        parent_project_id INT NULL,
                        ongoing_group_title VARCHAR(200) NULL,
                        is_joint_project TINYINT(1) DEFAULT 0,
                        co_host_name VARCHAR(200) NULL,
                        club_role VARCHAR(10) NULL,
                        title VARCHAR(50) NOT NULL,
                        description VARCHAR(1000) NULL,
                        location VARCHAR(200) NULL,
                        fk_area_of_focus_id INT NULL,
                        other_area_of_focus VARCHAR(100) NULL,
                        fk_category_id INT NULL,
                        other_category VARCHAR(100) NULL,
                        fk_sub_category_id INT NULL,
                        other_sub_category VARCHAR(100) NULL,
                        project_date DATE NULL,
                        project_cost DECIMAL(15,2) NULL,
                        fk_funding_id INT NULL,
                        direct_beneficiaries INT NULL,
                        man_hours INT NULL,
                        rotarians_involved INT NULL,
                        rotaractors_involved INT NULL,
                        rcc_involved INT NULL DEFAULT 0,
                        send_whatsapp TINYINT(1) DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_module_id) REFERENCES module_master(pk_module_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id),
                        FOREIGN KEY (parent_project_id) REFERENCES rotary_projects(pk_project_id),
                        FOREIGN KEY (fk_area_of_focus_id) REFERENCES area_of_focus_master(pk_area_of_focus_id),
                        FOREIGN KEY (fk_category_id) REFERENCES category_master(pk_category_id),
                        FOREIGN KEY (fk_sub_category_id) REFERENCES sub_category_master(pk_sub_category_id),
                        FOREIGN KEY (fk_funding_id) REFERENCES funding_master(pk_funding_id),
                        INDEX idx_projects_club_year_module (fk_club_id, fk_year_id, fk_module_id, isdeleted),
                        INDEX idx_projects_parent (parent_project_id),
                        INDEX idx_projects_date (project_date)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_project_photos (
                        pk_photo_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_project_id INT NOT NULL,
                        image_path VARCHAR(500) NOT NULL,
                        description VARCHAR(500) NULL,
                        is_primary TINYINT(1) DEFAULT 0,
                        sort_order INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_project_id) REFERENCES rotary_projects(pk_project_id),
                        INDEX idx_photos_project (fk_project_id)
                    )");

                // Increase photo description from 200 to 500 chars
                await connection.ExecuteAsync(
                    "ALTER TABLE rotary_project_photos MODIFY COLUMN description VARCHAR(500) NULL");

                // Club Service fields
                await AddColumnIfNotExists(connection, "rotary_projects", "meeting_type", "VARCHAR(20) NULL AFTER send_whatsapp");
                await AddColumnIfNotExists(connection, "rotary_projects", "agenda_document", "VARCHAR(500) NULL AFTER meeting_type");
                await AddColumnIfNotExists(connection, "rotary_projects", "minutes_document", "VARCHAR(500) NULL AFTER agenda_document");
                await AddColumnIfNotExists(connection, "rotary_projects", "attendance", "INT NULL AFTER minutes_document");
                await AddColumnIfNotExists(connection, "rotary_projects", "attendance_percentage", "DECIMAL(5,2) NULL AFTER attendance");

                // Funding-conditional fields (Community/Vocational/International/New-Gen/Public-Image services)
                //   Global Grant:  global_grant_number, amount_sanctioned, amount_received, amount_spent,
                //                  host_clubs_districts, global_partner_clubs_districts
                //   CSR:           csr_company_name, amount_sanctioned, amount_received
                //   amount_sanctioned + amount_received are SHARED between Global Grant and CSR
                //   (only one funding type per project, so one set of columns is sufficient).
                await AddColumnIfNotExists(connection, "rotary_projects", "global_grant_number", "VARCHAR(50) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "amount_sanctioned", "DECIMAL(15,2) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "amount_received", "DECIMAL(15,2) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "amount_spent", "DECIMAL(15,2) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "host_clubs_districts", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "global_partner_clubs_districts", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "csr_company_name", "VARCHAR(200) NULL");

                // Older DBs predate the ClubType column being part of the CREATE TABLE;
                // retro-add it so the Rotary.org terminated-members proxy can read it.
                await AddColumnIfNotExists(connection, "club_master", "ClubType", "VARCHAR(50) NULL");

                // Greetings module columns in club_master
                await AddColumnIfNotExists(connection, "club_master", "BirthdayGreeting", "VARCHAR(700) NULL");
                await AddColumnIfNotExists(connection, "club_master", "IsEnableBirthdayNotification", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_master", "AnniversaryGreeting", "VARCHAR(700) NULL");
                await AddColumnIfNotExists(connection, "club_master", "IsEnableAnniversaryNotification", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_master", "IsGreetingSendWhatsapp", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_master", "IsGreetingSendEmail", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_master", "IsEnableBirthdayEmail", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_master", "BirthdayEmailFrom", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "club_master", "BirthdayEmailSubject", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "club_master", "BirthdayEmailMessage", "TEXT NULL");
                await AddColumnIfNotExists(connection, "club_master", "IsEnableAnniversaryEmail", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_master", "AnniversaryEmailFrom", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "club_master", "AnniversaryEmailSubject", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "club_master", "AnniversaryEmailMessage", "TEXT NULL");
                await AddGreetingReviewedYearColumnAsync(connection, "club_master");

                // Club location for "Near me" finder (mobile) — admin sets via map picker in Club edit form
                await AddColumnIfNotExists(connection, "club_master", "Latitude", "DECIMAL(10,7) NULL");
                await AddColumnIfNotExists(connection, "club_master", "Longitude", "DECIMAL(10,7) NULL");

                // Legacy flag carried over from old DB — 1 if ROW is the selected vendor for this club
                await AddColumnIfNotExists(connection, "club_master", "ROW_as_vendor_selected", "TINYINT(1) DEFAULT 0");

                // Rotary.org nightly sync tracking columns
                await AddColumnIfNotExists(connection, "club_master", "IsSyncedFromRotaryOrg", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_master", "LastSyncedFromRotaryOrg", "DATETIME NULL");
                // Rotary.org's own Address.LastUpdated timestamp for the meeting-info snapshot we've
                // applied — lets the nightly country sync tell whether Rotary.org has something newer
                // than what we already stored (distinct from LastSyncedFromRotaryOrg, which is OUR clock).
                // Stored in server-local time like every other timestamp in this table (created_date/
                // modified_date/LastSyncedFromRotaryOrg via MySQL NOW()). The "Ist" in the column name is
                // historical (the original servers ran on India time); the schema keeps the name.
                await AddColumnIfNotExists(connection, "club_master", "RotaryOrgAddressLastUpdatedIst", "DATETIME NULL");
                // Club-level contact info from Rotary.org's country-sync search results (ClubWebsite
                // already existed for manual admin edits; country-sync now also populates both for
                // clubs it manages — AddedByCountrySync=1 — since Rotary.org is authoritative for those).
                await AddColumnIfNotExists(connection, "club_master", "ClubEmail", "VARCHAR(200) NULL");

                // Rotary.org sync run log — one row per sync invocation
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_org_sync_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        SyncType VARCHAR(30) NOT NULL,
                        StartedAtUtc DATETIME NOT NULL,
                        FinishedAtUtc DATETIME NULL,
                        TotalFetched INT DEFAULT 0,
                        InsertedCount INT DEFAULT 0,
                        UpdatedCount INT DEFAULT 0,
                        DisabledCount INT DEFAULT 0,
                        SkippedDistrictMissing INT DEFAULT 0,
                        ErrorCount INT DEFAULT 0,
                        Status VARCHAR(20) DEFAULT 'Running',
                        ErrorDetail TEXT NULL,
                        TriggeredBy INT NULL,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_ros_log_started (StartedAtUtc)
                    )");

                // International President per rotary year (shown on club + district websites later)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS international_president (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_year_id INT NOT NULL,
                        Name VARCHAR(300) NOT NULL,
                        Designation VARCHAR(300) NULL,
                        ProfilePhotoPath VARCHAR(500) NULL,
                        Description MEDIUMTEXT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        UNIQUE KEY uk_ip_year (fk_year_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                // Directory Data Collection — SuperAdmin configures per-district+year which fields each of the 3 groups (DC/BOD/Member) must fill; members update via public URL + OTP
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_directory_config (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        UrlHash VARCHAR(64) NOT NULL UNIQUE,
                        FirstContactName VARCHAR(200) NULL,
                        FirstContactMobile VARCHAR(20) NULL,
                        FirstContactPasswordHash VARCHAR(255) NULL,
                        SecondContactName VARCHAR(200) NULL,
                        SecondContactMobile VARCHAR(20) NULL,
                        SecondContactPasswordHash VARCHAR(255) NULL,
                        DcFieldsJson MEDIUMTEXT NULL,
                        BodFieldsJson MEDIUMTEXT NULL,
                        MemberFieldsJson MEDIUMTEXT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        INDEX idx_ddc_district_year (fk_district_id, fk_year_id),
                        INDEX idx_ddc_urlhash (UrlHash),
                        FOREIGN KEY (fk_district_id) REFERENCES district_master(pk_district_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                // Directory Data Collection — public-form submission log (audit for anonymous updates)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_directory_submission_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_config_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        GroupType VARCHAR(20) NOT NULL,
                        FieldsSubmittedJson MEDIUMTEXT NULL,
                        CompletedCount INT DEFAULT 0,
                        TotalCount INT DEFAULT 0,
                        IpAddress VARCHAR(50) NULL,
                        UserAgent VARCHAR(500) NULL,
                        SubmittedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FilledByAdminMobile VARCHAR(20) NULL,
                        INDEX idx_ddsl_config (fk_config_id),
                        INDEX idx_ddsl_member (fk_member_id),
                        INDEX idx_ddsl_date (SubmittedAt)
                    )");

                // Public directory admin-proxy login (2026-06-19): the 2 contact persons can fill the
                // form on behalf of a member using mobile + password (no member OTP). Hashes only.
                await AddColumnIfNotExists(connection, "district_directory_config", "FirstContactPasswordHash", "VARCHAR(255) NULL AFTER FirstContactMobile");
                await AddColumnIfNotExists(connection, "district_directory_config", "SecondContactPasswordHash", "VARCHAR(255) NULL AFTER SecondContactMobile");
                // Per-district notification toggles (2026-07-24): gate reminder + post-submit confirmation
                // Email/WhatsApp per config. OTP is NOT affected. Default 1 = send (preserves prior behaviour).
                await AddColumnIfNotExists(connection, "district_directory_config", "SendEmail", "TINYINT(1) NOT NULL DEFAULT 1");
                await AddColumnIfNotExists(connection, "district_directory_config", "SendWhatsapp", "TINYINT(1) NOT NULL DEFAULT 1");
                // Enable/disable the public collection link (2026-08-04). 1 = open (form works),
                // 0 = closed (public link shows "Link is closed"; all public actions blocked).
                await AddColumnIfNotExists(connection, "district_directory_config", "IsActive", "TINYINT(1) NOT NULL DEFAULT 1");
                await AddColumnIfNotExists(connection, "district_directory_submission_log", "FilledByAdminMobile", "VARCHAR(20) NULL");

                // Directory Data Collection — per (config, member) status flags. Spouse-not-applicable
                // lets a member who has no spouse skip the Family fields without dragging their
                // completion % down. Adds nothing to existing tables; member_family_details rows are
                // never touched by this flag (data preserved in case the flag is unticked later).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS directory_data_member_status (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_config_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        SpouseNotApplicable TINYINT(1) NOT NULL DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY uk_ddms_config_member (fk_config_id, fk_member_id),
                        INDEX idx_ddms_member (fk_member_id),
                        FOREIGN KEY (fk_config_id) REFERENCES district_directory_config(pk_id)
                    )");

                // Project audit log table
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_project_audit_log (
                        pk_audit_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_project_id INT NOT NULL,
                        fk_club_id INT NULL,
                        action_type VARCHAR(10) NOT NULL,
                        field_name VARCHAR(100) NULL,
                        old_value TEXT NULL,
                        new_value TEXT NULL,
                        action_by INT NULL,
                        action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_audit_project (fk_project_id),
                        INDEX idx_audit_club (fk_club_id),
                        INDEX idx_audit_date (action_date)
                    )");

                // Trigger: after INSERT on rotary_projects
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_project_after_insert");
                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_project_after_insert
                    AFTER INSERT ON rotary_projects
                    FOR EACH ROW
                    BEGIN
                        INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                        VALUES (NEW.pk_project_id, NEW.fk_club_id, 'INSERT', 'title', NULL, NEW.title, NEW.created_by, NOW());
                    END");

                // Trigger: after UPDATE on rotary_projects
                await TryExecuteTriggerSqlAsync(connection, "DROP TRIGGER IF EXISTS trg_project_after_update");
                await TryExecuteTriggerSqlAsync(connection, @"
                    CREATE TRIGGER trg_project_after_update
                    AFTER UPDATE ON rotary_projects
                    FOR EACH ROW
                    BEGIN
                        -- Check if this is a soft delete
                        IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
                            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'DELETE', 'title', OLD.title, NULL, NEW.deleted_by, NOW());
                        ELSE
                            -- Log each changed field
                            IF OLD.title != NEW.title OR (OLD.title IS NULL AND NEW.title IS NOT NULL) OR (OLD.title IS NOT NULL AND NEW.title IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'title', OLD.title, NEW.title, NEW.modified_by, NOW());
                            END IF;
                            IF OLD.description != NEW.description OR (OLD.description IS NULL AND NEW.description IS NOT NULL) OR (OLD.description IS NOT NULL AND NEW.description IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'description', OLD.description, NEW.description, NEW.modified_by, NOW());
                            END IF;
                            IF OLD.location != NEW.location OR (OLD.location IS NULL AND NEW.location IS NOT NULL) OR (OLD.location IS NOT NULL AND NEW.location IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'location', OLD.location, NEW.location, NEW.modified_by, NOW());
                            END IF;
                            IF OLD.project_type != NEW.project_type THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'project_type', OLD.project_type, NEW.project_type, NEW.modified_by, NOW());
                            END IF;
                            IF OLD.project_date != NEW.project_date OR (OLD.project_date IS NULL AND NEW.project_date IS NOT NULL) OR (OLD.project_date IS NOT NULL AND NEW.project_date IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'project_date', CAST(OLD.project_date AS CHAR), CAST(NEW.project_date AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.project_cost != NEW.project_cost OR (OLD.project_cost IS NULL AND NEW.project_cost IS NOT NULL) OR (OLD.project_cost IS NOT NULL AND NEW.project_cost IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'project_cost', CAST(OLD.project_cost AS CHAR), CAST(NEW.project_cost AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.fk_area_of_focus_id != NEW.fk_area_of_focus_id OR (OLD.fk_area_of_focus_id IS NULL AND NEW.fk_area_of_focus_id IS NOT NULL) OR (OLD.fk_area_of_focus_id IS NOT NULL AND NEW.fk_area_of_focus_id IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'area_of_focus', CAST(OLD.fk_area_of_focus_id AS CHAR), CAST(NEW.fk_area_of_focus_id AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.fk_category_id != NEW.fk_category_id OR (OLD.fk_category_id IS NULL AND NEW.fk_category_id IS NOT NULL) OR (OLD.fk_category_id IS NOT NULL AND NEW.fk_category_id IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'category', CAST(OLD.fk_category_id AS CHAR), CAST(NEW.fk_category_id AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.fk_sub_category_id != NEW.fk_sub_category_id OR (OLD.fk_sub_category_id IS NULL AND NEW.fk_sub_category_id IS NOT NULL) OR (OLD.fk_sub_category_id IS NOT NULL AND NEW.fk_sub_category_id IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'sub_category', CAST(OLD.fk_sub_category_id AS CHAR), CAST(NEW.fk_sub_category_id AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.fk_funding_id != NEW.fk_funding_id OR (OLD.fk_funding_id IS NULL AND NEW.fk_funding_id IS NOT NULL) OR (OLD.fk_funding_id IS NOT NULL AND NEW.fk_funding_id IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'funding', CAST(OLD.fk_funding_id AS CHAR), CAST(NEW.fk_funding_id AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.direct_beneficiaries != NEW.direct_beneficiaries OR (OLD.direct_beneficiaries IS NULL AND NEW.direct_beneficiaries IS NOT NULL) OR (OLD.direct_beneficiaries IS NOT NULL AND NEW.direct_beneficiaries IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'direct_beneficiaries', CAST(OLD.direct_beneficiaries AS CHAR), CAST(NEW.direct_beneficiaries AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.man_hours != NEW.man_hours OR (OLD.man_hours IS NULL AND NEW.man_hours IS NOT NULL) OR (OLD.man_hours IS NOT NULL AND NEW.man_hours IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'man_hours', CAST(OLD.man_hours AS CHAR), CAST(NEW.man_hours AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.rotarians_involved != NEW.rotarians_involved OR (OLD.rotarians_involved IS NULL AND NEW.rotarians_involved IS NOT NULL) OR (OLD.rotarians_involved IS NOT NULL AND NEW.rotarians_involved IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'rotarians_involved', CAST(OLD.rotarians_involved AS CHAR), CAST(NEW.rotarians_involved AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.rotaractors_involved != NEW.rotaractors_involved OR (OLD.rotaractors_involved IS NULL AND NEW.rotaractors_involved IS NOT NULL) OR (OLD.rotaractors_involved IS NOT NULL AND NEW.rotaractors_involved IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'rotaractors_involved', CAST(OLD.rotaractors_involved AS CHAR), CAST(NEW.rotaractors_involved AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.rcc_involved != NEW.rcc_involved OR (OLD.rcc_involved IS NULL AND NEW.rcc_involved IS NOT NULL) OR (OLD.rcc_involved IS NOT NULL AND NEW.rcc_involved IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'rcc_involved', CAST(OLD.rcc_involved AS CHAR), CAST(NEW.rcc_involved AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.is_joint_project != NEW.is_joint_project THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'is_joint_project', CAST(OLD.is_joint_project AS CHAR), CAST(NEW.is_joint_project AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.co_host_name != NEW.co_host_name OR (OLD.co_host_name IS NULL AND NEW.co_host_name IS NOT NULL) OR (OLD.co_host_name IS NOT NULL AND NEW.co_host_name IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'co_host_name', OLD.co_host_name, NEW.co_host_name, NEW.modified_by, NOW());
                            END IF;
                            IF OLD.is_active != NEW.is_active THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'is_active', CAST(OLD.is_active AS CHAR), CAST(NEW.is_active AS CHAR), NEW.modified_by, NOW());
                            END IF;
                        END IF;
                    END");

                // System settings table (key-value config)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS system_settings (
                        pk_setting_id INT AUTO_INCREMENT PRIMARY KEY,
                        SettingKey VARCHAR(100) NOT NULL UNIQUE,
                        SettingValue VARCHAR(500) NOT NULL,
                        Description VARCHAR(200) NULL,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
                    )");

                // Beneficiary approval requests table
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS beneficiary_approval_requests (
                        pk_approval_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_project_id INT NOT NULL,
                        fk_zone_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        requested_beneficiaries INT NOT NULL,
                        approved_beneficiaries INT NULL,
                        current_limit INT NOT NULL,
                        approval_token VARCHAR(100) NOT NULL UNIQUE,
                        status VARCHAR(20) DEFAULT 'pending',
                        remark VARCHAR(1000) NULL,
                        requested_by INT NOT NULL,
                        responded_by INT NULL,
                        responded_date DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        -- NOTE: no FK on fk_project_id. Projects live in year-wise tables
                        -- (rotary_projects_YYYY_YY), not the legacy monolithic rotary_projects,
                        -- so a single FK can't be satisfied. Integrity is enforced in code.
                        FOREIGN KEY (fk_zone_id) REFERENCES zone_master(pk_zone_id),
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        INDEX idx_approval_token (approval_token),
                        INDEX idx_approval_project (fk_project_id),
                        INDEX idx_approval_status (status)
                    )");

                // Migration: record the ZC-approved beneficiary count per attempt (for history).
                await AddColumnIfNotExists(connection, "beneficiary_approval_requests", "approved_beneficiaries", "INT NULL AFTER requested_beneficiaries");

                // Migration: drop the stale fk_project_id FK on existing DBs. It pointed at
                // the legacy rotary_projects table, but projects are now year-wise, so any
                // over-limit approval insert failed the constraint. Find it by reference and drop.
                var staleProjFks = (await connection.QueryAsync<string>(@"
                    SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'beneficiary_approval_requests'
                      AND COLUMN_NAME = 'fk_project_id'
                      AND REFERENCED_TABLE_NAME = 'rotary_projects'")).ToList();
                foreach (var fk in staleProjFks)
                {
                    try
                    {
                        await connection.ExecuteAsync($"ALTER TABLE beneficiary_approval_requests DROP FOREIGN KEY `{fk}`");
                        _logger.LogInformation("Dropped stale FK {Fk} on beneficiary_approval_requests.fk_project_id.", fk);
                    }
                    catch (MySqlException ex)
                    {
                        _logger.LogWarning(ex, "Could not drop stale FK {Fk} on beneficiary_approval_requests.", fk);
                    }
                }

                // Drop the old unique key if it exists (President/Secretary validated in SP instead)
                // Must drop foreign keys that rely on the index first, then re-add them
                var ukExists = await connection.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_of_directors' AND CONSTRAINT_NAME = 'uk_club_year_designation'");
                if (ukExists > 0)
                {
                    // Find and drop all foreign keys on board_of_directors
                    var fkNames = (await connection.QueryAsync<string>(
                        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_of_directors' AND CONSTRAINT_TYPE = 'FOREIGN KEY'")).ToList();
                    foreach (var fk in fkNames)
                    {
                        await connection.ExecuteAsync($"ALTER TABLE board_of_directors DROP FOREIGN KEY `{fk}`");
                    }
                    // Now drop the unique index
                    await connection.ExecuteAsync("ALTER TABLE board_of_directors DROP INDEX uk_club_year_designation");
                    // Re-add foreign keys
                    await connection.ExecuteAsync(@"
                        ALTER TABLE board_of_directors
                            ADD CONSTRAINT fk_bod_club FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                            ADD CONSTRAINT fk_bod_member FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id),
                            ADD CONSTRAINT fk_bod_designation FOREIGN KEY (fk_designation_id) REFERENCES designation_master(pk_designation_id),
                            ADD CONSTRAINT fk_bod_year FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)");
                }

                // Login audit log table
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS login_audit_logs (
                        pk_log_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_id INT NULL,
                        member_name VARCHAR(200) NULL,
                        email_or_mobile VARCHAR(200) NULL,
                        login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                        ip_address VARCHAR(50) NULL,
                        user_agent VARCHAR(500) NULL,
                        login_status VARCHAR(20) NOT NULL DEFAULT 'success',
                        failure_reason VARCHAR(200) NULL,
                        INDEX idx_audit_member (fk_member_id),
                        INDEX idx_audit_time (login_time),
                        INDEX idx_audit_status (login_status)
                    )");

                // Upcoming Events tables
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS upcoming_events (
                        pk_upcoming_event_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_club_id INT NOT NULL,
                        Title VARCHAR(50) NOT NULL,
                        Description VARCHAR(1000),
                        ImagePath VARCHAR(500),
                        EventDate DATETIME NOT NULL,
                        PublishDate DATETIME NOT NULL,
                        ExpiryDate DATETIME NOT NULL,
                        EventVenue VARCHAR(255),
                        RegistrationLink VARCHAR(500),
                        IsSendWhatsapp TINYINT(1) DEFAULT 0,
                        IsRepeatNotification TINYINT(1) DEFAULT 0,
                        Status VARCHAR(20) DEFAULT 'Unpublished',
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                // Alter existing columns from DATE to DATETIME for existing databases
                try
                {
                    await connection.ExecuteAsync(@"
                        ALTER TABLE upcoming_events
                        MODIFY COLUMN EventDate DATETIME NOT NULL,
                        MODIFY COLUMN PublishDate DATETIME NOT NULL,
                        MODIFY COLUMN ExpiryDate DATETIME NOT NULL");
                }
                catch { /* Ignore if already correct */ }

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS upcoming_event_reminders (
                        pk_reminder_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_upcoming_event_id INT NOT NULL,
                        ReminderDateTime DATETIME NOT NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_upcoming_event_id) REFERENCES upcoming_events(pk_upcoming_event_id) ON DELETE CASCADE
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS announcements (
                        pk_announcement_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_club_id INT NOT NULL,
                        Title VARCHAR(50) NOT NULL,
                        Description VARCHAR(1000),
                        ImagePath VARCHAR(500),
                        PublishDateTime DATETIME NOT NULL,
                        ExpiryDateTime DATETIME NOT NULL,
                        IsDisplayOnBanner TINYINT(1) DEFAULT 0,
                        IsSendWhatsapp TINYINT(1) DEFAULT 0,
                        IsRepeatNotification TINYINT(1) DEFAULT 0,
                        Status VARCHAR(20) DEFAULT 'Unpublished',
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS announcement_reminders (
                        pk_reminder_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_announcement_id INT NOT NULL,
                        ReminderDateTime DATETIME NOT NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_announcement_id) REFERENCES announcements(pk_announcement_id) ON DELETE CASCADE
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS newsletters (
                        pk_newsletter_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_club_id INT NOT NULL,
                        Title VARCHAR(50) NOT NULL,
                        PublishDateTime DATETIME NOT NULL,
                        ExpiryDateTime DATETIME NOT NULL,
                        AttachmentType VARCHAR(10) DEFAULT 'link',
                        LinkUrl VARCHAR(500),
                        FilePath VARCHAR(500),
                        IsSendWhatsapp TINYINT(1) DEFAULT 0,
                        Status VARCHAR(20) DEFAULT 'Unpublished',
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_documents (
                        pk_document_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_club_id INT NOT NULL,
                        Title VARCHAR(50) NOT NULL,
                        AccessType VARCHAR(20) DEFAULT 'downloadable',
                        FilePath VARCHAR(500) NOT NULL,
                        OriginalFileName VARCHAR(255),
                        PublishDateTime DATETIME NOT NULL,
                        ExpiryDateTime DATETIME NOT NULL,
                        Status VARCHAR(20) DEFAULT 'Unpublished',
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_attendance (
                        pk_attendance_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        EventName VARCHAR(500) NOT NULL,
                        Description VARCHAR(10000),
                        EventDateTime DATETIME NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted INT DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_attendance_members (
                        pk_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_attendance_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        FOREIGN KEY (fk_attendance_id) REFERENCES club_attendance(pk_attendance_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_attendance_anns (
                        pk_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_attendance_id INT NOT NULL,
                        AnnName VARCHAR(200) NOT NULL,
                        FOREIGN KEY (fk_attendance_id) REFERENCES club_attendance(pk_attendance_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_attendance_annets (
                        pk_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_attendance_id INT NOT NULL,
                        AnnetName VARCHAR(200) NOT NULL,
                        FOREIGN KEY (fk_attendance_id) REFERENCES club_attendance(pk_attendance_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_attendance_visitors (
                        pk_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_attendance_id INT NOT NULL,
                        VisitorName VARCHAR(200) NOT NULL,
                        InvitedBy VARCHAR(200),
                        FOREIGN KEY (fk_attendance_id) REFERENCES club_attendance(pk_attendance_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_attendance_rotarians (
                        pk_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_attendance_id INT NOT NULL,
                        RotarianName VARCHAR(200) NOT NULL,
                        ClubName VARCHAR(200),
                        FOREIGN KEY (fk_attendance_id) REFERENCES club_attendance(pk_attendance_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_attendance_delegates (
                        pk_id INT PRIMARY KEY AUTO_INCREMENT,
                        fk_attendance_id INT NOT NULL,
                        RotarianName VARCHAR(200) NOT NULL,
                        DistrictDesignation VARCHAR(200),
                        ClubName VARCHAR(200),
                        FOREIGN KEY (fk_attendance_id) REFERENCES club_attendance(pk_attendance_id)
                    )");

                // ── Club Monthly Report tables ──
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_monthly_reports (
                        pk_report_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        ReportMonth INT NOT NULL,
                        MemberCountLastMonth INT DEFAULT 0,
                        MembersDeleted INT DEFAULT 0,
                        MembersAdded INT DEFAULT 0,
                        CurrentMemberCount INT DEFAULT 0,
                        AdditionalRemarks VARCHAR(1000) NULL,
                        IsUploadedToDistrict TINYINT(1) DEFAULT 0,
                        fk_ag_member_id INT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id),
                        UNIQUE KEY uk_club_year_month (fk_club_id, fk_year_id, ReportMonth)
                    )");

                await AddColumnIfNotExists(connection, "club_monthly_reports", "uploaded_to_district_date", "DATETIME NULL AFTER IsUploadedToDistrict");
                // AG (Assistant Governor) captured at report creation, locked. district_ag has no
                // history (one AG per club/year), so each report snapshots its AG when first created.
                await AddColumnIfNotExists(connection, "club_monthly_reports", "fk_ag_member_id", "INT NULL");

                // NOTE: club_monthly_report_trf table is legacy — TRF contributions now use trf_contributions table

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_report_reminder_log (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        report_month INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        member_name VARCHAR(200) NULL,
                        designation VARCHAR(100) NULL,
                        email_status VARCHAR(20) DEFAULT 'not_sent',
                        whatsapp_status VARCHAR(20) DEFAULT 'not_sent',
                        sent_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        sent_by INT NULL
                    )");

                // OCV Document Categories
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS ocv_document_category (
                        pk_category_id INT AUTO_INCREMENT PRIMARY KEY,
                        CategoryName VARCHAR(100) NOT NULL,
                        CategoryCode VARCHAR(50) NOT NULL,
                        IconClass VARCHAR(100) NULL,
                        SortOrder INT DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY uk_category_code (CategoryCode)
                    )");

                // OCV Document Types
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS ocv_document_type (
                        pk_type_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_category_id INT NOT NULL,
                        TypeName VARCHAR(300) NOT NULL,
                        AllowMultiple TINYINT(1) DEFAULT 0,
                        SortOrder INT DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL,
                        FOREIGN KEY (fk_category_id) REFERENCES ocv_document_category(pk_category_id)
                    )");

                // OCV Documents (actual uploads)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS ocv_documents (
                        pk_document_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_category_id INT NOT NULL,
                        fk_type_id INT NOT NULL,
                        FileName VARCHAR(500) NOT NULL,
                        OriginalFileName VARCHAR(500) NOT NULL,
                        FilePath VARCHAR(1000) NOT NULL,
                        FileSize BIGINT DEFAULT 0,
                        CustomTypeName VARCHAR(300) NULL,
                        Amount DECIMAL(15,2) NULL,
                        PaidOn DATE NULL,
                        UploadedBy INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id),
                        FOREIGN KEY (fk_category_id) REFERENCES ocv_document_category(pk_category_id),
                        FOREIGN KEY (fk_type_id) REFERENCES ocv_document_type(pk_type_id)
                    )");

                await AddColumnIfNotExists(connection, "ocv_documents", "CustomTypeName", "VARCHAR(300) NULL AFTER fk_type_id");

                // TRF Fund Master
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS trf_fund_master (
                        pk_fund_id INT AUTO_INCREMENT PRIMARY KEY,
                        FundName VARCHAR(200) NOT NULL,
                        SortOrder INT DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
                    )");

                // TRF Contributions
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS trf_contributions (
                        pk_trf_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        TrfDate DATETIME NOT NULL,
                        DonorName VARCHAR(200) NOT NULL,
                        AmountUSD DECIMAL(15,2) NOT NULL,
                        fk_fund_id INT NOT NULL,
                        FundType VARCHAR(50) NOT NULL,
                        OtherFundName VARCHAR(200) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id),
                        FOREIGN KEY (fk_fund_id) REFERENCES trf_fund_master(pk_fund_id)
                    )");

                // PPH Camps tables
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS pph_camps (
                        pk_camp_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        Title VARCHAR(300) NOT NULL,
                        Description TEXT NULL,
                        Address TEXT NULL,
                        CampDate DATE NOT NULL,
                        CampLogoPath VARCHAR(500) NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS pph_camp_attendance (
                        pk_attendance_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_camp_id INT NOT NULL,
                        RegistrationNo VARCHAR(20) NULL,
                        Age INT NULL,
                        BPSystolic INT NULL,
                        BPDiastolic INT NULL,
                        BloodSugarType VARCHAR(10) NULL,
                        BloodSugarValue DECIMAL(10,2) NULL,
                        HeightCm DECIMAL(10,2) NULL,
                        WeightKg DECIMAL(10,2) NULL,
                        BMI DECIMAL(10,2) NULL,
                        DiabetesStatus VARCHAR(50) NULL,
                        BPStatus VARCHAR(50) NULL,
                        IsOverweight TINYINT(1) DEFAULT 0,
                        IsObese TINYINT(1) DEFAULT 0,
                        IsConsentedForMessages TINYINT(1) DEFAULT 0,
                        Remarks TEXT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_camp_id) REFERENCES pph_camps(pk_camp_id)
                    )");

                // PPH camp attendee (the person) — mobile is unique per camp (enforced in app via find-or-create).
                // Each attendee has MANY readings in pph_camp_attendance (fk_attendee_id). Person fields live here;
                // medical readings live in pph_camp_attendance. Sex/Address/Age nullable in DB to tolerate legacy
                // backfilled rows; mandatory for new entries is enforced by DTO validation in the API.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS pph_camp_attendies (
                        pk_attendee_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_camp_id INT NOT NULL,
                        Name VARCHAR(200) NOT NULL,
                        MobileNo VARCHAR(20) NOT NULL,
                        Sex VARCHAR(10) NULL,
                        Address TEXT NULL,
                        IsConsentedForMessages TINYINT(1) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        INDEX idx_pph_attendee_camp_mobile (fk_camp_id, MobileNo),
                        FOREIGN KEY (fk_camp_id) REFERENCES pph_camps(pk_camp_id)
                    )");

                // ── Cashfree KYC tables ───────────────────────────────────────
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS cashfree_kyc (
                        pk_kyc_id INT AUTO_INCREMENT PRIMARY KEY,
                        vendor_id VARCHAR(100) NOT NULL UNIQUE,
                        email VARCHAR(200) NOT NULL,
                        phone VARCHAR(20) NOT NULL,
                        account_holder VARCHAR(200) NOT NULL,
                        account_number VARCHAR(50) NOT NULL,
                        ifsc VARCHAR(20) NOT NULL,
                        name VARCHAR(200) NOT NULL,
                        pan VARCHAR(20) NOT NULL,
                        status VARCHAR(100) DEFAULT 'PENDING',
                        verify_account VARCHAR(10) DEFAULT 'true',
                        dashboard_access VARCHAR(10) DEFAULT 'true',
                        schedule_option INT DEFAULT 2,
                        account_type VARCHAR(50) DEFAULT 'Current',
                        business_type VARCHAR(100) DEFAULT 'Non Profit/NGO',
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS cashfree_otp (
                        pk_otp_id INT AUTO_INCREMENT PRIMARY KEY,
                        otp_code VARCHAR(10) NOT NULL,
                        purpose VARCHAR(50) DEFAULT 'CASHFREE_KYC',
                        is_used TINYINT(1) DEFAULT 0,
                        expiry_date DATETIME NOT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS weblinks (
                        pk_weblink_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_parent_id INT NULL,
                        Level INT NOT NULL DEFAULT 1,
                        Title VARCHAR(300) NOT NULL,
                        Writeup TEXT NULL,
                        LogoPath VARCHAR(500) NULL,
                        BannerPath VARCHAR(500) NULL,
                        LinkType VARCHAR(20) DEFAULT 'None',
                        LinkUrl VARCHAR(1000) NULL,
                        PdfPath VARCHAR(500) NULL,
                        YoutubeUrl VARCHAR(1000) NULL,
                        ButtonText VARCHAR(100) NULL,
                        SortOrder INT DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_parent_id) REFERENCES weblinks(pk_weblink_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS sub_groups (
                        pk_sub_group_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        GroupName VARCHAR(300) NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        deleted_by INT NULL,
                        deleted_date DATETIME NULL,
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS sub_group_members (
                        pk_sub_group_member_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_sub_group_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        FOREIGN KEY (fk_sub_group_id) REFERENCES sub_groups(pk_sub_group_id),
                        FOREIGN KEY (fk_member_master_profile_id) REFERENCES member_master_profile(pk_member_master_profile_id)
                    )");

                // ── Add district support to modules that need both club and district level ──
                await AddColumnIfNotExists(connection, "upcoming_events", "fk_district_id", "INT NULL AFTER pk_upcoming_event_id");
                await AddColumnIfNotExists(connection, "announcements", "fk_district_id", "INT NULL AFTER pk_announcement_id");
                await AddColumnIfNotExists(connection, "newsletters", "fk_district_id", "INT NULL AFTER pk_newsletter_id");
                await AddColumnIfNotExists(connection, "club_documents", "fk_district_id", "INT NULL AFTER pk_document_id");
                await AddColumnIfNotExists(connection, "weblinks", "fk_district_id", "INT NULL AFTER pk_weblink_id");
                await AddColumnIfNotExists(connection, "sub_groups", "fk_district_id", "INT NULL AFTER pk_sub_group_id");

                // Widen club_attendance EventName (50→500) and Description (1000→10000). Guarded so the
                // table rebuild only runs once (skips after it's already widened).
                var attNameLen = await connection.ExecuteScalarAsync<long?>(
                    @"SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'club_attendance' AND COLUMN_NAME = 'EventName'");
                if (attNameLen.HasValue && attNameLen.Value < 500)
                {
                    await connection.ExecuteAsync(
                        "ALTER TABLE club_attendance MODIFY EventName VARCHAR(500) NOT NULL, MODIFY Description VARCHAR(10000)");
                }

                // ── Country sync (weekly Rotary.org country search) — marks rows added via /Clubs/search ──
                await AddColumnIfNotExists(connection, "club_master", "AddedByCountrySync", "TINYINT(1) DEFAULT 0");

                // ── Member sync (Rotary.org /individuals/updates) — termination tracking
                // Termination data lives on club_members (per-club: TerminationDate + TerminationReason).
                // member_master_profile.RITerminationDate/RITerminationReason were unused and have been removed.

                // ── Push notification (FCM) support ──
                await AddColumnIfNotExists(connection, "announcements", "PushNotificationSent", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcements", "PushNotificationSentAt", "DATETIME NULL");
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS member_fcm_tokens (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NOT NULL,
                        DeviceType VARCHAR(20) NULL,
                        DeviceId VARCHAR(200) NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        isdeleted TINYINT(1) DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_used_date DATETIME NULL,
                        UNIQUE KEY uq_fcm_token (FcmToken),
                        KEY idx_member_active (fk_member_master_profile_id, IsActive, isdeleted)
                    )");
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS announcement_push_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_announcement_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NULL,
                        Status VARCHAR(20) NOT NULL,
                        FirebaseMessageId VARCHAR(200) NULL,
                        ErrorMessage VARCHAR(1000) NULL,
                        SentAt DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        KEY idx_announcement (fk_announcement_id),
                        KEY idx_member_status (fk_member_master_profile_id, Status)
                    )");

                // ── Push notification support for events + documents (mirrors announcements) ──
                await AddColumnIfNotExists(connection, "upcoming_events", "PushNotificationSent", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_events", "PushNotificationSentAt", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "club_documents", "PushNotificationSent", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "club_documents", "PushNotificationSentAt", "DATETIME NULL");

                // ── Reminder push tracking — fires once per reminder row when its date is reached ──
                await AddColumnIfNotExists(connection, "announcement_reminders", "PushSentAt", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "upcoming_event_reminders", "PushSentAt", "DATETIME NULL");

                // ── Push log tables for new push types (mirror announcement_push_log) ──
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_push_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_upcoming_event_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NULL,
                        Status VARCHAR(20) NOT NULL,
                        FirebaseMessageId VARCHAR(200) NULL,
                        ErrorMessage VARCHAR(1000) NULL,
                        SentAt DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        KEY idx_event (fk_upcoming_event_id),
                        KEY idx_member_status (fk_member_master_profile_id, Status)
                    )");
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS document_push_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_document_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NULL,
                        Status VARCHAR(20) NOT NULL,
                        FirebaseMessageId VARCHAR(200) NULL,
                        ErrorMessage VARCHAR(1000) NULL,
                        SentAt DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        KEY idx_document (fk_document_id),
                        KEY idx_member_status (fk_member_master_profile_id, Status)
                    )");
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS announcement_reminder_push_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_reminder_id INT NOT NULL,
                        fk_announcement_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NULL,
                        Status VARCHAR(20) NOT NULL,
                        FirebaseMessageId VARCHAR(200) NULL,
                        ErrorMessage VARCHAR(1000) NULL,
                        SentAt DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        KEY idx_reminder (fk_reminder_id),
                        KEY idx_member_status (fk_member_master_profile_id, Status)
                    )");
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_reminder_push_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_reminder_id INT NOT NULL,
                        fk_upcoming_event_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NULL,
                        Status VARCHAR(20) NOT NULL,
                        FirebaseMessageId VARCHAR(200) NULL,
                        ErrorMessage VARCHAR(1000) NULL,
                        SentAt DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        KEY idx_reminder (fk_reminder_id),
                        KEY idx_member_status (fk_member_master_profile_id, Status)
                    )");

                // ── Newsletter push (mirror announcements). NOTE: on an EXISTING db the prod migration
                //    (SQL/newsletter_push.sql) backfills PushNotificationSent=1 so historical newsletters
                //    never mass-blast; a fresh env has no rows so no backfill is needed here. ──
                await AddColumnIfNotExists(connection, "newsletters", "PushNotificationSent", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "newsletters", "PushNotificationSentAt", "DATETIME NULL");
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS newsletter_push_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_newsletter_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NULL,
                        Status VARCHAR(20) NOT NULL,
                        FirebaseMessageId VARCHAR(200) NULL,
                        ErrorMessage VARCHAR(1000) NULL,
                        SentAt DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        KEY idx_newsletter (fk_newsletter_id),
                        KEY idx_member_status (fk_member_master_profile_id, Status)
                    )");

                // ── Project push (year-wise). fk_year_id disambiguates pk_project_id (reused per year).
                //    Year-table columns + backfill are applied by add-project-push-columns.js (SkipInit). ──
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS project_push_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_project_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_member_master_profile_id INT NOT NULL,
                        FcmToken VARCHAR(500) NULL,
                        Status VARCHAR(20) NOT NULL,
                        FirebaseMessageId VARCHAR(200) NULL,
                        ErrorMessage VARCHAR(1000) NULL,
                        SentAt DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        KEY idx_project (fk_project_id, fk_year_id),
                        KEY idx_member_status (fk_member_master_profile_id, Status)
                    )");

                // ── RI Director scope support (Scope='district' default, 'ri' for RI-level records) ──
                await AddColumnIfNotExists(connection, "announcements", "Scope", "VARCHAR(10) NOT NULL DEFAULT 'district'");
                await AddColumnIfNotExists(connection, "upcoming_events", "Scope", "VARCHAR(10) NOT NULL DEFAULT 'district'");
                await AddColumnIfNotExists(connection, "newsletters", "Scope", "VARCHAR(10) NOT NULL DEFAULT 'district'");
                await AddColumnIfNotExists(connection, "club_documents", "Scope", "VARCHAR(10) NOT NULL DEFAULT 'district'");
                await AddColumnIfNotExists(connection, "weblinks", "Scope", "VARCHAR(10) NOT NULL DEFAULT 'district'");
                await AddColumnIfNotExists(connection, "sub_groups", "Scope", "VARCHAR(10) NOT NULL DEFAULT 'district'");
                await AddColumnIfNotExists(connection, "club_mass_emails", "Scope", "VARCHAR(10) NOT NULL DEFAULT 'district'");

                // ── Mobile App Version Management — single version applies to both iOS + Android ──
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS mobile_app_versions (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        Version VARCHAR(20) NOT NULL,
                        Message VARCHAR(500) NULL,
                        PlayStoreUrl VARCHAR(500) NULL,
                        AppStoreUrl VARCHAR(500) NULL,
                        Url VARCHAR(500) DEFAULT '',
                        IsForceUpdate TINYINT(1) DEFAULT 1,
                        IsActive TINYINT(1) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                // RI Director recipient targeting columns (reused across modules for RI-scoped records)
                await AddColumnIfNotExists(connection, "announcements", "RecipientTarget", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "announcements", "RecipientZoneIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "announcements", "RecipientDistrictIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "upcoming_events", "RecipientTarget", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "upcoming_events", "RecipientZoneIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "upcoming_events", "RecipientDistrictIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "newsletters", "RecipientTarget", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "newsletters", "RecipientZoneIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "newsletters", "RecipientDistrictIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "club_documents", "RecipientTarget", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "club_documents", "RecipientZoneIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "club_documents", "RecipientDistrictIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "weblinks", "RecipientTarget", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "weblinks", "RecipientZoneIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "weblinks", "RecipientDistrictIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "club_mass_emails", "RecipientTarget", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "club_mass_emails", "RecipientZoneIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "club_mass_emails", "RecipientDistrictIds", "TEXT NULL");
                await AddColumnIfNotExists(connection, "announcements", "RecipientSubgroupIds", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "upcoming_events", "RecipientSubgroupIds", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "newsletters", "RecipientSubgroupIds", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "club_mass_emails", "RecipientSubgroupIds", "VARCHAR(500) NULL");

                // ── WhatsApp scheduled send tracking ──
                await AddColumnIfNotExists(connection, "announcements", "WhatsAppSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "announcements", "WhatsAppSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcements", "WhatsAppFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_events", "WhatsAppSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "upcoming_events", "WhatsAppSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_events", "WhatsAppFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "newsletters", "WhatsAppSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "newsletters", "WhatsAppSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "newsletters", "WhatsAppFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "rotary_projects", "IsSendWhatsapp", "TINYINT(1) NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "rotary_projects", "WhatsAppSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "WhatsAppSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "rotary_projects", "WhatsAppFailedCount", "INT NOT NULL DEFAULT 0");

                // Per-reminder WhatsApp tracking (repeat notifications)
                await AddColumnIfNotExists(connection, "upcoming_event_reminders", "WhatsAppSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "upcoming_event_reminders", "WhatsAppSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_event_reminders", "WhatsAppFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcement_reminders", "WhatsAppSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "announcement_reminders", "WhatsAppSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcement_reminders", "WhatsAppFailedCount", "INT NOT NULL DEFAULT 0");

                // Indexes to speed up the scheduler pending-query
                await CreateIndexIfNotExists(connection, "announcements", "idx_ann_wa_pending",
                    "CREATE INDEX idx_ann_wa_pending ON announcements (IsSendWhatsapp, WhatsAppSentDate, PublishDateTime)");
                await CreateIndexIfNotExists(connection, "upcoming_events", "idx_evt_wa_pending",
                    "CREATE INDEX idx_evt_wa_pending ON upcoming_events (IsSendWhatsapp, WhatsAppSentDate, PublishDate)");
                await CreateIndexIfNotExists(connection, "newsletters", "idx_nl_wa_pending",
                    "CREATE INDEX idx_nl_wa_pending ON newsletters (IsSendWhatsapp, WhatsAppSentDate, PublishDateTime)");
                await CreateIndexIfNotExists(connection, "rotary_projects", "idx_proj_wa_pending",
                    "CREATE INDEX idx_proj_wa_pending ON rotary_projects (IsSendWhatsapp, WhatsAppSentDate)");

                // ── Email scheduled send tracking (mirrors WhatsApp; separate IsSendEmail toggle) ──
                await AddColumnIfNotExists(connection, "announcements", "IsSendEmail", "TINYINT(1) NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcements", "EmailSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "announcements", "EmailSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcements", "EmailFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_events", "IsSendEmail", "TINYINT(1) NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_events", "EmailSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "upcoming_events", "EmailSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_events", "EmailFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "newsletters", "IsSendEmail", "TINYINT(1) NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "newsletters", "EmailSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "newsletters", "EmailSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "newsletters", "EmailFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "rotary_projects", "IsSendEmail", "TINYINT(1) NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "rotary_projects", "EmailSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "EmailSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "rotary_projects", "EmailFailedCount", "INT NOT NULL DEFAULT 0");

                // Per-reminder Email tracking (repeat notifications)
                await AddColumnIfNotExists(connection, "upcoming_event_reminders", "EmailSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "upcoming_event_reminders", "EmailSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "upcoming_event_reminders", "EmailFailedCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcement_reminders", "EmailSentDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "announcement_reminders", "EmailSentCount", "INT NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "announcement_reminders", "EmailFailedCount", "INT NOT NULL DEFAULT 0");

                // Indexes to speed up the email scheduler pending-query
                await CreateIndexIfNotExists(connection, "announcements", "idx_ann_email_pending",
                    "CREATE INDEX idx_ann_email_pending ON announcements (IsSendEmail, EmailSentDate, PublishDateTime)");
                await CreateIndexIfNotExists(connection, "upcoming_events", "idx_evt_email_pending",
                    "CREATE INDEX idx_evt_email_pending ON upcoming_events (IsSendEmail, EmailSentDate, PublishDate)");
                await CreateIndexIfNotExists(connection, "newsletters", "idx_nl_email_pending",
                    "CREATE INDEX idx_nl_email_pending ON newsletters (IsSendEmail, EmailSentDate, PublishDateTime)");

                // RI Director credits (singleton-ish: one active row per credit type)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS ri_director_credits (
                        pk_credit_id INT AUTO_INCREMENT PRIMARY KEY,
                        CreditType VARCHAR(20) NOT NULL,
                        CreditCount INT NOT NULL DEFAULT 0,
                        UsedCount INT NOT NULL DEFAULT 0,
                        PreviousCount INT DEFAULT 0,
                        FromDate DATE NOT NULL,
                        ToDate DATE NOT NULL,
                        TransactionId VARCHAR(200) NULL,
                        PaymentDate DATE NULL,
                        ProofDocumentPath VARCHAR(500) NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS ri_director_credit_usage_history (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        CreditType VARCHAR(20) NOT NULL,
                        DeductedCount INT NOT NULL DEFAULT 0,
                        Source VARCHAR(100) NOT NULL,
                        SourceId INT NULL,
                        SourceDetail VARCHAR(500) NULL,
                        BalanceBefore INT NOT NULL DEFAULT 0,
                        BalanceAfter INT NOT NULL DEFAULT 0,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
                    )");

                // Add district support to website data tables
                await AddColumnIfNotExists(connection, "club_website_banner", "fk_district_id", "INT NULL");
                await AddColumnIfNotExists(connection, "club_website_advertisement", "fk_district_id", "INT NULL");
                await AddColumnIfNotExists(connection, "club_website_social_link", "fk_district_id", "INT NULL");
                await AddColumnIfNotExists(connection, "club_website_about", "fk_district_id", "INT NULL");
                await AddColumnIfNotExists(connection, "club_website_contact_detail", "fk_district_id", "INT NULL");
                await AddColumnIfNotExists(connection, "club_website_menu", "fk_district_id", "INT NULL");
                await AddColumnIfNotExists(connection, "club_website_menu", "is_default", "TINYINT(1) NOT NULL DEFAULT 0");
                // One-time backfill: any district menu with the standard default name should be flagged is_default=1
                // so it cannot be edited/deleted via the API/UI. Idempotent — safe to run on every startup.
                await connection.ExecuteAsync(@"
                    UPDATE club_website_menu
                    SET is_default = 1
                    WHERE fk_district_id IS NOT NULL AND fk_district_id > 0
                      AND fk_club_id = 0
                      AND isdeleted = 0
                      AND is_default = 0
                      AND menu_name IN ('Home','About','Directors','Directory','Calendar','Projects','Meetings','Past Presidents')");
                // One-time cleanup: the default CLUB menu set is now 8 (Home, About, Directory,
                // Directors, Calendar, Events, Projects, Past Presidents) + 1 custom slot. Retire the
                // legacy 9th default top-level "Club Service" tab (link_value='club-service') from
                // every club so all sites show 8 defaults. The Club Service *avenue* sub-menu under
                // Projects (link_value='club_service', underscore) is separate and untouched.
                // Idempotent: only soft-deletes rows still active; custom (is_default=0) menus untouched.
                await connection.ExecuteAsync(@"
                    UPDATE club_website_menu
                    SET isdeleted = 1
                    WHERE is_default = 1
                      AND link_value = 'club-service'
                      AND COALESCE(fk_club_id, 0) > 0
                      AND isdeleted = 0");

                // Phase 6: rich-text content for custom (non-default) menus when linkType='html'.
                // LONGTEXT matches club_website_about.content for consistency.
                await AddColumnIfNotExists(connection, "club_website_menu", "content_html", "LONGTEXT NULL");

                // Settings → Themes: optional description shown in admin add/edit dialog.
                await AddColumnIfNotExists(connection, "theme_master", "description", "TEXT NULL AFTER theme_image_path");

                // CMR freeze-on-upload: snapshot of the report captured at "upload to district" so
                // every later PDF/Word download shows the last-uploaded data (never live).
                await AddColumnIfNotExists(connection, "club_monthly_reports", "report_snapshot_json", "MEDIUMTEXT NULL");
                await AddColumnIfNotExists(connection, "club_monthly_reports", "snapshot_captured_date", "DATETIME NULL");

                // Potential Members: referrer = the logged-in member who added this potential member.
                await AddColumnIfNotExists(connection, "potential_members", "fk_member_master_profile_id_as_referrer", "INT NULL");

                // Drop foreign key constraints on fk_club_id for district-shared tables (fk_club_id=0 for district records)
                // Club Moderator project approval columns
                await AddColumnIfNotExists(connection, "rotary_projects", "approval_status", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "approval_remark", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "approved_by", "INT NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "approval_date", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "rotary_projects", "approval_token", "VARCHAR(64) NULL");
                await CreateIndexIfNotExists(connection, "rotary_projects", "idx_projects_approval_token", "CREATE INDEX idx_projects_approval_token ON rotary_projects (approval_token)");
                await CreateIndexIfNotExists(connection, "rotary_projects", "idx_projects_approval_status", "CREATE INDEX idx_projects_approval_status ON rotary_projects (approval_status)");

                // District projects/events support
                await AddColumnIfNotExists(connection, "rotary_projects", "fk_district_id", "INT NULL AFTER fk_club_id");
                await AddColumnIfNotExists(connection, "rotary_projects", "DistrictProjectType", "VARCHAR(20) NULL");

                // Also drop fk_module_id FK on rotary_projects for district records
                try
                {
                    var fkModName = await connection.ExecuteScalarAsync<string?>(
                        @"SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
                          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_projects'
                            AND COLUMN_NAME = 'fk_module_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1");
                    if (!string.IsNullOrEmpty(fkModName))
                        await connection.ExecuteAsync($"ALTER TABLE `rotary_projects` DROP FOREIGN KEY `{fkModName}`");
                }
                catch { }

                var fkDropTables = new[] { "upcoming_events", "announcements", "newsletters", "club_documents", "weblinks", "sub_groups", "rotary_projects", "club_website_banner", "club_website_advertisement", "club_website_social_link", "club_website_about", "club_website_menu", "club_website_contact_detail" };
                foreach (var tbl in fkDropTables)
                {
                    try
                    {
                        var fkName = await connection.ExecuteScalarAsync<string?>(
                            @"SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
                              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @Tbl
                                AND COLUMN_NAME = 'fk_club_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1",
                            new { Tbl = tbl });
                        if (!string.IsNullOrEmpty(fkName))
                            await connection.ExecuteAsync($"ALTER TABLE `{tbl}` DROP FOREIGN KEY `{fkName}`");
                    }
                    catch { /* FK may already be dropped */ }
                }

                // Greetings: add columns to district_master
                await AddColumnIfNotExists(connection, "district_master", "BirthdayGreeting", "VARCHAR(700) NULL");
                await AddColumnIfNotExists(connection, "district_master", "IsEnableBirthdayNotification", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "district_master", "AnniversaryGreeting", "VARCHAR(700) NULL");
                await AddColumnIfNotExists(connection, "district_master", "IsEnableAnniversaryNotification", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "district_master", "IsGreetingSendWhatsapp", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "district_master", "IsGreetingSendEmail", "TINYINT(1) DEFAULT 0");
                // Defaults ON (unlike the other Is*Send* toggles above) — clubs get push/digest
                // unconditionally with no admin toggle at all, so districts should behave the same
                // out of the box rather than silently sitting disabled until someone finds the setting.
                await AddColumnIfNotExists(connection, "district_master", "IsGreetingSendPush", "TINYINT(1) DEFAULT 1");
                await AddColumnIfNotExists(connection, "district_master", "IsEnableBirthdayEmail", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "district_master", "BirthdayEmailFrom", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "district_master", "BirthdayEmailSubject", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "district_master", "BirthdayEmailMessage", "TEXT NULL");
                await AddColumnIfNotExists(connection, "district_master", "IsEnableAnniversaryEmail", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "district_master", "AnniversaryEmailFrom", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "district_master", "AnniversaryEmailSubject", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "district_master", "AnniversaryEmailMessage", "TEXT NULL");
                await AddGreetingReviewedYearColumnAsync(connection, "district_master");

                // ── Event Payment Link tables ──────────────────────────
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_tshirt_sizes (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        SizeName VARCHAR(100) NOT NULL,
                        SortOrder INT DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_by INT NULL,
                        updated_date DATETIME NULL
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_food_preferences (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        FoodType VARCHAR(100) NOT NULL,
                        SortOrder INT DEFAULT 0,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_by INT NULL,
                        updated_date DATETIME NULL
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_payment_links (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        FormType INT NOT NULL DEFAULT 1,
                        AmountType INT NOT NULL DEFAULT 1,
                        fk_district_master_id INT NULL,
                        fk_club_id INT NULL,
                        IsForAllDistricts TINYINT(1) DEFAULT 0,
                        DistrictIdsList TEXT NULL,
                        RecipientType INT NOT NULL DEFAULT 1,
                        SubgroupIds TEXT NULL,
                        SubgroupYear VARCHAR(20) NULL,
                        Title VARCHAR(500) NULL,
                        Description TEXT NULL,
                        PurposeLogo VARCHAR(500) NULL,
                        PurposeEventImage VARCHAR(500) NULL,
                        BackgroundImage VARCHAR(500) NULL,
                        WeblinkUrl VARCHAR(500) NULL,
                        IsHideCharges TINYINT(1) DEFAULT 0,
                        IsForm TINYINT(1) DEFAULT 0,
                        IsTshirtSize TINYINT(1) DEFAULT 0,
                        IsFood TINYINT(1) DEFAULT 0,
                        FoodPreferenceIds VARCHAR(200) NULL,
                        IsPartner TINYINT(1) DEFAULT 0,
                        IsPartnerName TINYINT(1) DEFAULT 0,
                        IsPartnerMobile TINYINT(1) DEFAULT 0,
                        IsPartnerEmail TINYINT(1) DEFAULT 0,
                        IsPartnerGender TINYINT(1) DEFAULT 0,
                        IsRemark1 TINYINT(1) DEFAULT 0,
                        Remark1Title VARCHAR(200) NULL,
                        IsRemark2 TINYINT(1) DEFAULT 0,
                        Remark2Title VARCHAR(200) NULL,
                        IsRemark3 TINYINT(1) DEFAULT 0,
                        Remark3Title VARCHAR(200) NULL,
                        IsDesignation TINYINT(1) DEFAULT 0,
                        DesignationLabel VARCHAR(200) NULL,
                        IsPersonal TINYINT(1) DEFAULT 0,
                        IsPersonalName TINYINT(1) DEFAULT 0,
                        IsPersonalMobile TINYINT(1) DEFAULT 0,
                        IsPersonalEmail TINYINT(1) DEFAULT 0,
                        IsPersonalDistrict TINYINT(1) DEFAULT 0,
                        IsPersonalClub TINYINT(1) DEFAULT 0,
                        EmailHeaderLogo VARCHAR(500) NULL,
                        EmailCc VARCHAR(500) NULL,
                        EmailSubject VARCHAR(500) NULL,
                        EmailBody TEXT NULL,
                        EmailReminderSubject VARCHAR(500) NULL,
                        EmailReminderBody TEXT NULL,
                        GoogleSheetUrl VARCHAR(500) NULL,
                        GoogleSheetName VARCHAR(200) NULL,
                        fk_weblink_id INT NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_by INT NULL,
                        updated_date DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_payment_registrations (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_payment_link_id INT NOT NULL,
                        RegistrationName VARCHAR(200) NOT NULL,
                        Amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        FOREIGN KEY (fk_payment_link_id) REFERENCES event_payment_links(pk_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_payment_vendor_splits (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_payment_link_id INT NOT NULL,
                        fk_registration_id INT NOT NULL,
                        fk_kyc_id INT NOT NULL,
                        SplitAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        FOREIGN KEY (fk_payment_link_id) REFERENCES event_payment_links(pk_id),
                        FOREIGN KEY (fk_registration_id) REFERENCES event_payment_registrations(pk_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_payment_designations (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_payment_link_id INT NOT NULL,
                        DesignationName VARCHAR(200) NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        FOREIGN KEY (fk_payment_link_id) REFERENCES event_payment_links(pk_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_payment_members (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_payment_link_id INT NOT NULL,
                        fk_member_profile_id INT NULL,
                        fk_registration_id INT NULL,
                        MemberName VARCHAR(200) NULL,
                        Mobile VARCHAR(20) NULL,
                        Email VARCHAR(200) NULL,
                        fk_country_code_id INT NULL,
                        DistrictNumber VARCHAR(50) NULL,
                        ClubName VARCHAR(200) NULL,
                        Amount DECIMAL(12,2) NULL,
                        IsPaid TINYINT(1) DEFAULT 0,
                        IsOnline TINYINT(1) DEFAULT 0,
                        PaymentDate DATETIME NULL,
                        TransactionId VARCHAR(200) NULL,
                        CfOrderId VARCHAR(200) NULL,
                        OfflineTransactionType VARCHAR(50) NULL,
                        OfflineGivenTo VARCHAR(200) NULL,
                        OfflineBankName VARCHAR(200) NULL,
                        OfflineChequeNumber VARCHAR(100) NULL,
                        OfflineRemark VARCHAR(500) NULL,
                        Attachment VARCHAR(500) NULL,
                        fk_tshirt_size_id INT NULL,
                        fk_food_preference_id INT NULL,
                        PartnerName VARCHAR(200) NULL,
                        PartnerMobile VARCHAR(20) NULL,
                        PartnerEmail VARCHAR(200) NULL,
                        PartnerGender VARCHAR(20) NULL,
                        Remark1 VARCHAR(500) NULL,
                        Remark2 VARCHAR(500) NULL,
                        Remark3 VARCHAR(500) NULL,
                        fk_designation_id INT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_by INT NULL,
                        updated_date DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0,
                        FOREIGN KEY (fk_payment_link_id) REFERENCES event_payment_links(pk_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_payment_otp (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_payment_link_id INT NOT NULL,
                        Email VARCHAR(200) NULL,
                        Mobile VARCHAR(20) NULL,
                        OtpCode VARCHAR(10) NOT NULL,
                        IsVerified TINYINT(1) DEFAULT 0,
                        ExpiresAt DATETIME NOT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX ix_event_payment_otp_link (fk_payment_link_id)
                    )");
                // The original schema had a FK to event_payment_links.pk_id, but the column is
                // intentionally reused by membership dues OTPs (MembershipDuesService stores duesId
                // here). Drop the FK on existing DBs so dues OTPs can be inserted. Safe to re-run.
                try { await connection.ExecuteAsync("ALTER TABLE event_payment_otp DROP FOREIGN KEY event_payment_otp_ibfk_1"); } catch { /* already dropped */ }

                // Add extra columns to event_payment_members
                await AddColumnIfNotExists(connection, "event_payment_members", "PaymentStatus", "VARCHAR(50) NULL");
                await AddColumnIfNotExists(connection, "event_payment_members", "PaymentSessionId", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "event_payment_members", "PaidSource", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "event_payment_members", "IsReceiptSent", "TINYINT(1) DEFAULT 0");

                // Google Sheets integration columns
                await AddColumnIfNotExists(connection, "event_payment_links", "GoogleSheetId", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "event_payment_links", "GoogleSheetEmail", "VARCHAR(200) NULL");

                // ===== Membership Dues Tables =====
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS membership_dues (
                        pk_membership_dues_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        RotaryYear VARCHAR(20) NOT NULL,
                        Purpose VARCHAR(500) NULL,
                        PurposeDescription TEXT NULL,
                        PurposeLogo VARCHAR(500) NULL,
                        BackgroundImage VARCHAR(500) NULL,
                        ModeOfPayment INT DEFAULT 3,
                        IsShowBankInReceipt TINYINT(1) DEFAULT 0,
                        IsFees1 TINYINT(1) DEFAULT 1,
                        IsFees2 TINYINT(1) DEFAULT 0,
                        IsFees3 TINYINT(1) DEFAULT 0,
                        Fees1Text VARCHAR(100) DEFAULT 'Annual',
                        Fees2Text VARCHAR(100) DEFAULT 'Semi Annual 1',
                        Fees3Text VARCHAR(100) DEFAULT 'Semi Annual 2',
                        DefaultCategoryType VARCHAR(100) DEFAULT 'Standard',
                        DefaultAnnualAmount DECIMAL(12,2) DEFAULT 0,
                        DefaultOfflineAnnualAmount DECIMAL(12,2) DEFAULT 0,
                        DefaultSemi1Amount DECIMAL(12,2) DEFAULT 0,
                        DefaultOfflineSemi1Amount DECIMAL(12,2) DEFAULT 0,
                        DefaultSemi2Amount DECIMAL(12,2) DEFAULT 0,
                        DefaultOfflineSemi2Amount DECIMAL(12,2) DEFAULT 0,
                        AmountType INT DEFAULT 1,
                        DefaultPercentage DECIMAL(5,2) DEFAULT 2.95,
                        OfflineBankName VARCHAR(200) NULL,
                        OfflineAccountNumber VARCHAR(100) NULL,
                        OfflineIfscCode VARCHAR(50) NULL,
                        EmailHeaderLogo VARCHAR(500) NULL,
                        EmailCC VARCHAR(500) NULL,
                        EmailSubject VARCHAR(500) NULL,
                        EmailBody TEXT NULL,
                        EmailReminderSubject VARCHAR(500) NULL,
                        EmailReminderBody TEXT NULL,
                        GoogleSheetId VARCHAR(200) NULL,
                        GoogleSheetUrl VARCHAR(500) NULL,
                        GoogleSheetEmail VARCHAR(200) NULL,
                        WeblinkUrl VARCHAR(500) NULL,
                        fk_weblink_id INT NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS membership_dues_vendors (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_membership_dues_id INT NOT NULL,
                        fk_kyc_id INT NOT NULL,
                        VendorId VARCHAR(100) NOT NULL,
                        AnnualAmount DECIMAL(12,2) DEFAULT 0,
                        Semi1Amount DECIMAL(12,2) DEFAULT 0,
                        Semi2Amount DECIMAL(12,2) DEFAULT 0,
                        IsDefault TINYINT(1) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS membership_dues_member_fees (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_membership_dues_id INT NOT NULL,
                        fk_member_profile_id INT NOT NULL,
                        CategoryType VARCHAR(100) DEFAULT 'Standard',
                        AnnualAmount DECIMAL(12,2) DEFAULT 0,
                        OfflineAnnualAmount DECIMAL(12,2) DEFAULT 0,
                        Semi1Amount DECIMAL(12,2) DEFAULT 0,
                        OfflineSemi1Amount DECIMAL(12,2) DEFAULT 0,
                        Semi2Amount DECIMAL(12,2) DEFAULT 0,
                        OfflineSemi2Amount DECIMAL(12,2) DEFAULT 0,
                        IsNewMember TINYINT(1) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS membership_dues_member_vendors (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_membership_dues_id INT NOT NULL,
                        fk_member_profile_id INT NOT NULL,
                        fk_kyc_id INT NOT NULL,
                        VendorId VARCHAR(100) NOT NULL,
                        AnnualAmount DECIMAL(12,2) DEFAULT 0,
                        Semi1Amount DECIMAL(12,2) DEFAULT 0,
                        Semi2Amount DECIMAL(12,2) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS membership_dues_payments (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_membership_dues_id INT NOT NULL,
                        fk_member_profile_id INT NOT NULL,
                        fk_member_fee_id INT NOT NULL,
                        FeeType INT NOT NULL,
                        Amount DECIMAL(12,2) NOT NULL,
                        IsPaid TINYINT(1) DEFAULT 0,
                        IsOnline TINYINT(1) DEFAULT 0,
                        PaymentStatus VARCHAR(50) DEFAULT 'Pending',
                        PaidSource VARCHAR(20) NULL,
                        PaymentDate DATETIME NULL,
                        TransactionId VARCHAR(200) NULL,
                        CfOrderId VARCHAR(200) NULL,
                        PaymentSessionId VARCHAR(500) NULL,
                        OfflineTransactionType VARCHAR(50) NULL,
                        OfflineTransactionId VARCHAR(200) NULL,
                        OfflineGivenTo VARCHAR(200) NULL,
                        OfflineBankName VARCHAR(200) NULL,
                        OfflineChequeNumber VARCHAR(100) NULL,
                        OfflineRemark VARCHAR(500) NULL,
                        Attachment VARCHAR(500) NULL,
                        OfflineStatus VARCHAR(20) NULL,
                        RejectionReason VARCHAR(500) NULL,
                        ApprovedBy INT NULL,
                        ApprovedDate DATETIME NULL,
                        RejectedBy INT NULL,
                        RejectedDate DATETIME NULL,
                        IsReceiptSent TINYINT(1) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                // Membership dues - Google Sheets integration columns
                await AddColumnIfNotExists(connection, "membership_dues", "GoogleSheetId", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "membership_dues", "GoogleSheetEmail", "VARCHAR(200) NULL");

                // Online surcharge % — replaces the separate Default*/DefaultOffline* amount pair
                // with ONE true (offline) amount plus a single admin-configured surcharge applied
                // for online payments only (mirrors club_dues.OnlineSurchargePercent). The
                // DefaultOffline*Amount columns and per-member Offline*Amount columns are left in
                // place but no longer read/written — see SQL/membership_dues_online_surcharge.sql
                // for the one-time backfill applied on prod (Database:SkipInit=true there).
                await AddColumnIfNotExists(connection, "membership_dues", "OnlineSurchargePercent", "DECIMAL(5,2) NOT NULL DEFAULT 2.95");

                // Membership dues vendors - IsSelf column
                await AddColumnIfNotExists(connection, "membership_dues_vendors", "IsSelf", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "membership_dues_member_vendors", "IsSelf", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "membership_dues_member_vendors", "fk_member_fee_id", "INT NULL AFTER fk_member_profile_id");

                // Webhook tracking columns
                await AddColumnIfNotExists(connection, "membership_dues_payments", "IsWebhookReceived", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "membership_dues_payments", "WebhookReceivedDate", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "event_payment_members", "IsWebhookReceived", "TINYINT(1) DEFAULT 0");
                await AddColumnIfNotExists(connection, "event_payment_members", "WebhookReceivedDate", "DATETIME NULL");

                // Order splits tracking columns
                await AddColumnIfNotExists(connection, "membership_dues_payments", "OrderSplitsJson", "TEXT NULL");
                await AddColumnIfNotExists(connection, "event_payment_members", "OrderSplitsJson", "TEXT NULL");

                // Optional admin remark captured at approval time (mirrors RejectionReason).
                // Surfaced on receipt email when present. Added 2026-06-14.
                await AddColumnIfNotExists(connection, "membership_dues_payments", "ApprovalRemark", "VARCHAR(500) NULL");

                // Audit who acted and HOW. ApprovedBy / RejectedBy already store an int —
                // we keep that semantic and add ApprovalSource / RejectionSource to
                // distinguish admin portal clicks from email-link clicks (President /
                // Secretary who don't have an admin login but click from inbox).
                // Values: 'admin-portal' | 'email-link'. Added 2026-06-14.
                await AddColumnIfNotExists(connection, "membership_dues_payments", "ApprovalSource", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "membership_dues_payments", "RejectionSource", "VARCHAR(20) NULL");

                // Cashfree KYC - Default vendor percentage column
                await AddColumnIfNotExists(connection, "cashfree_kyc", "Defualt_per", "DECIMAL(5,2) DEFAULT 0");

                // Membership dues settlements table
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS membership_dues_settlements (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_membership_dues_id INT NOT NULL,
                        fk_payment_id INT NOT NULL,
                        CfOrderId VARCHAR(200),
                        VendorId VARCHAR(100),
                        Amount DECIMAL(12,2) DEFAULT 0,
                        SettlementStatus VARCHAR(50),
                        SettlementId VARCHAR(200),
                        SettlementUtr VARCHAR(200),
                        SettlementTime DATETIME NULL,
                        ServiceCharge DECIMAL(12,2) DEFAULT 0,
                        ServiceTax DECIMAL(12,2) DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
                    )");

                // Event payment settlements table
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS event_payment_settlements (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_payment_link_id INT NOT NULL,
                        fk_member_payment_id INT NOT NULL,
                        CfOrderId VARCHAR(200),
                        VendorId VARCHAR(100),
                        Amount DECIMAL(12,2) DEFAULT 0,
                        SettlementStatus VARCHAR(50),
                        SettlementId VARCHAR(200),
                        SettlementUtr VARCHAR(200),
                        SettlementTime DATETIME NULL,
                        ServiceCharge DECIMAL(12,2) DEFAULT 0,
                        ServiceTax DECIMAL(12,2) DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
                    )");

                // Credit management table
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_credits (
                        pk_credit_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        CreditType VARCHAR(20) NOT NULL,
                        CreditCount INT NOT NULL DEFAULT 0,
                        UsedCount INT NOT NULL DEFAULT 0,
                        FromDate DATE NOT NULL,
                        ToDate DATE NOT NULL,
                        IsActive TINYINT(1) DEFAULT 1,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                // Credit management extra columns
                await AddColumnIfNotExists(connection, "club_credits", "TransactionId", "VARCHAR(200) NULL");
                await AddColumnIfNotExists(connection, "club_credits", "PaymentDate", "DATE NULL");
                await AddColumnIfNotExists(connection, "club_credits", "ProofDocumentPath", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "club_credits", "PreviousCount", "INT DEFAULT 0");

                // Credit usage history table
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_credit_usage_history (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_district_id INT NULL,
                        CreditType VARCHAR(20) NOT NULL,
                        DeductedCount INT NOT NULL DEFAULT 0,
                        Source VARCHAR(100) NOT NULL,
                        SourceId INT NULL,
                        SourceDetail VARCHAR(500) NULL,
                        BalanceBefore INT NOT NULL DEFAULT 0,
                        BalanceAfter INT NOT NULL DEFAULT 0,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
                    )");

                // Wallet credit top-up orders (Razorpay). Prod (SkipInit=true) applies SQL/wallet_topup_orders.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS wallet_topup_orders (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_club_id INT NOT NULL DEFAULT 0,
                        ScopeType VARCHAR(20) NOT NULL,
                        CreditType VARCHAR(20) NOT NULL,
                        BaseAmount DECIMAL(12,2) NOT NULL,
                        GstAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
                        TotalAmount DECIMAL(12,2) NOT NULL,
                        CreditCount INT NOT NULL,
                        RatePaise INT NOT NULL,
                        Currency VARCHAR(10) NOT NULL DEFAULT 'INR',
                        RazorpayOrderId VARCHAR(100) NULL,
                        RazorpayPaymentId VARCHAR(100) NULL,
                        RazorpaySignature VARCHAR(255) NULL,
                        PaymentStatus VARCHAR(30) NOT NULL DEFAULT 'CREATED',
                        IsCredited TINYINT(1) NOT NULL DEFAULT 0,
                        CreditedDate DATETIME NULL,
                        FromDate DATE NULL,
                        ToDate DATE NULL,
                        IsWebhookReceived TINYINT(1) NOT NULL DEFAULT 0,
                        WebhookReceivedDate DATETIME NULL,
                        fk_credit_id INT NULL,
                        created_by INT NOT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY ux_wallet_topup_rzp_order (RazorpayOrderId),
                        KEY ix_wallet_topup_scope (fk_district_id, fk_club_id, CreditType)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                foreach (var col in new[] { "ADD COLUMN FromDate DATE NULL", "ADD COLUMN ToDate DATE NULL" })
                {
                    try { await connection.ExecuteAsync($"ALTER TABLE wallet_topup_orders {col}"); }
                    catch { /* column already exists */ }
                }

                // Offline credit entries log (2026-09-23) — Wallet's combined Offline/Online list. SQL/club_credit_offline_log.sql also backfills earlier entries.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_credit_offline_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_credit_id INT NOT NULL,
                        fk_district_id INT NOT NULL,
                        fk_club_id INT NOT NULL DEFAULT 0,
                        CreditType VARCHAR(20) NOT NULL,
                        EntryType VARCHAR(20) NOT NULL,
                        CreditCount INT NULL,
                        CountBefore INT NULL,
                        CountAfter INT NULL,
                        ToDate DATE NULL,
                        TransactionId VARCHAR(200) NULL,
                        PaymentDate DATE NULL,
                        ProofDocumentPath VARCHAR(500) NULL,
                        Note VARCHAR(300) NULL,
                        created_by INT NOT NULL DEFAULT 0,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        KEY ix_ccol_scope (fk_district_id, fk_club_id, CreditType),
                        KEY ix_ccol_credit (fk_credit_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // District Performance Report run log (2026-09-17) — one row per send / skip / failure, so the
                // 15-day DG schedule can't double-send after a restart. Also SQL/district_performance_report_log.sql.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_performance_report_log (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL DEFAULT 0,
                        RunType VARCHAR(20) NOT NULL,
                        ToEmail VARCHAR(255) NULL,
                        CcEmails VARCHAR(1000) NULL,
                        Status VARCHAR(20) NOT NULL,
                        Message VARCHAR(1000) NULL,
                        RunDate DATE NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        KEY ix_dpr_log_district_day (fk_district_id, RunDate, RunType)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // Club website purchase/renewal orders (Razorpay). Prod (SkipInit=true) applies SQL/club_website_orders.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_orders (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_district_id INT NOT NULL DEFAULT 0,
                        OrderType VARCHAR(20) NOT NULL,
                        Subdomain VARCHAR(100) NOT NULL,
                        fk_theme_id INT NULL,
                        ReminderDays INT NULL,
                        ValidityMonths INT NOT NULL DEFAULT 12,
                        BaseAmount DECIMAL(12,2) NOT NULL,
                        GstAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
                        TotalAmount DECIMAL(12,2) NOT NULL,
                        Currency VARCHAR(10) NOT NULL DEFAULT 'INR',
                        GatewayType VARCHAR(20) NULL,
                        fk_route_account_id INT NULL,
                        StartDate DATE NULL,
                        EndDate DATE NULL,
                        RazorpayOrderId VARCHAR(100) NULL,
                        RazorpayPaymentId VARCHAR(100) NULL,
                        RazorpaySignature VARCHAR(255) NULL,
                        PaymentStatus VARCHAR(30) NOT NULL DEFAULT 'CREATED',
                        IsProvisioned TINYINT(1) NOT NULL DEFAULT 0,
                        ProvisionedDate DATETIME NULL,
                        ProvisionStatus VARCHAR(30) NULL,
                        IsWebhookReceived TINYINT(1) NOT NULL DEFAULT 0,
                        WebhookReceivedDate DATETIME NULL,
                        fk_website_id INT NULL,
                        created_by INT NOT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY ux_cwo_rzp_order (RazorpayOrderId),
                        KEY ix_cwo_club (fk_club_id),
                        KEY ix_cwo_subdomain (Subdomain, IsProvisioned)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                foreach (var col in new[] {
                    "ADD COLUMN GatewayType VARCHAR(20) NULL",
                    "ADD COLUMN fk_route_account_id INT NULL",
                    "ADD COLUMN StartDate DATE NULL",
                    "ADD COLUMN EndDate DATE NULL" })
                {
                    try { await connection.ExecuteAsync($"ALTER TABLE club_website_orders {col}"); }
                    catch { /* column already exists */ }
                }

                // Razorpay Route (marketplace) linked accounts. Prod (SkipInit=true) applies SQL/razorpay_route_accounts.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS razorpay_route_accounts (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        AccountId VARCHAR(50) NOT NULL,
                        Name VARCHAR(150) NOT NULL,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        Notes VARCHAR(500) NULL,
                        Status VARCHAR(50) NULL,
                        StakeholderId VARCHAR(80) NULL,
                        ProductConfigId VARCHAR(80) NULL,
                        RazorpayJson LONGTEXT NULL,
                        StatusRefreshedDate DATETIME NULL,
                        BankAccountLast4 VARCHAR(10) NULL,
                        BankIfsc VARCHAR(15) NULL,
                        created_by INT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        KEY ix_rra_active (IsActive, isdeleted)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                // Add onboarding-state columns to pre-existing tables (no ADD COLUMN IF NOT EXISTS on MySQL < 8.0.29).
                foreach (var col in new[] {
                    "ADD COLUMN Status VARCHAR(50) NULL",
                    "ADD COLUMN StakeholderId VARCHAR(80) NULL",
                    "ADD COLUMN ProductConfigId VARCHAR(80) NULL",
                    "ADD COLUMN RazorpayJson LONGTEXT NULL",
                    "ADD COLUMN StatusRefreshedDate DATETIME NULL",
                    "ADD COLUMN BankAccountLast4 VARCHAR(10) NULL",
                    "ADD COLUMN BankIfsc VARCHAR(15) NULL" })
                {
                    try { await connection.ExecuteAsync($"ALTER TABLE razorpay_route_accounts {col}"); }
                    catch { /* column already exists */ }
                }

                // Razorpay settlement reconciliation, one row per payment (pull-based via
                // RazorpaySettlementSyncBackgroundService — no settlement.processed webhook exists).
                // Prod (SkipInit=true) applies SQL/razorpay_settlements.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS razorpay_settlements (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        RazorpayPaymentId VARCHAR(100) NOT NULL,
                        RazorpayOrderId VARCHAR(100) NULL,
                        SettlementId VARCHAR(100) NULL,
                        SettlementUtr VARCHAR(100) NULL,
                        SettlementAmount DECIMAL(12,2) NULL,
                        SettlementStatus VARCHAR(30) NULL,
                        SettlementDate DATETIME NULL,
                        LinkedAccountId VARCHAR(50) NULL,
                        RawJson LONGTEXT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL,
                        UNIQUE KEY ux_rs_payment (RazorpayPaymentId)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // Per-club rotary.org login (username/password) used by the RI Flow-Bot browser
                // extension to sign in and submit projects to spc.rotary.org on the club's
                // behalf. Encrypted at rest via ASP.NET Core Data Protection (see Program.cs);
                // the two *Encrypted columns hold opaque ciphertext, never plaintext.
                // Prod (SkipInit=true) applies SQL/club_rotary_org_credentials.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_rotary_org_credentials (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        RotaryOrgUsernameEncrypted TEXT NOT NULL,
                        RotaryOrgPasswordEncrypted TEXT NOT NULL,
                        created_by INT NOT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY ux_crc_club (fk_club_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // Per-club, per-Rotary-year club-website price + gateway. Prod (SkipInit=true) applies SQL/club_website_pricing.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_pricing (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        BaseAmount DECIMAL(12,2) NOT NULL,
                        RenewalAmount DECIMAL(12,2) NULL,
                        GstPercent DECIMAL(5,2) NOT NULL DEFAULT 18.00,
                        GatewayType VARCHAR(20) NOT NULL DEFAULT 'normal',
                        fk_route_account_id INT NULL,
                        modified_by INT NULL,
                        modified_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY ux_cwp_club_year (fk_club_id, fk_year_id),
                        KEY ix_cwp_year (fk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                // Renewal price per (club, year) — separate from the New/purchase BaseAmount.
                // NULL → falls back to Razorpay:WebsiteRenewalPrice. (Prod SkipInit: apply the ALTER by hand.)
                await AddColumnIfNotExists(connection, "club_website_pricing", "RenewalAmount", "DECIMAL(12,2) NULL AFTER BaseAmount");

                // Website training appointments (Calendly-style booking + Zoom). Prod (SkipInit=true) applies SQL/website_training_appointments.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS website_training_appointments (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_district_id INT NOT NULL DEFAULT 0,
                        SlotStart DATETIME NOT NULL,
                        DurationMinutes INT NOT NULL DEFAULT 30,
                        Status VARCHAR(20) NOT NULL DEFAULT 'Scheduled',
                        ZoomMeetingId VARCHAR(100) NULL,
                        ZoomJoinUrl VARCHAR(1000) NULL,
                        ZoomStartUrl VARCHAR(1000) NULL,
                        fk_booker_member_id INT NOT NULL,
                        RescheduleCount INT NOT NULL DEFAULT 0,
                        Notes VARCHAR(1000) NULL,
                        created_by INT NOT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        KEY ix_wta_slot (SlotStart, isdeleted),
                        KEY ix_wta_club (fk_club_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // Training availability (user 2026-09-29) - the training team's working hours and the
                // days/times they are NOT available. Until now the hours were hardcoded in appsettings
                // (Training:Slots), so nothing could be changed without a redeploy.
                //   training_weekly_hours   : the repeating pattern. A weekday with no row = closed.
                //   training_date_overrides : one date. AllDay row = closed that day; otherwise the
                //                             rows ARE the free hours for that date and replace the
                //                             weekly pattern (same rule as the Cal.com screen).
                // Prod (SkipInit=true) applies SQL/training_availability.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS training_weekly_hours (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        DayOfWeek TINYINT NOT NULL,            -- 0=Sunday .. 6=Saturday
                        StartTime TIME NOT NULL,
                        EndTime TIME NOT NULL,
                        created_by INT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        KEY ix_twh_day (DayOfWeek, isdeleted)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS training_date_overrides (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        OverrideDate DATE NOT NULL,
                        IsUnavailableAllDay TINYINT(1) NOT NULL DEFAULT 0,
                        StartTime TIME NULL,
                        EndTime TIME NULL,
                        Reason VARCHAR(200) NULL,
                        created_by INT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        KEY ix_tdo_date (OverrideDate, isdeleted)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // Which MONTHS the Foundation / TRF imports cover (user 2026-10-01). The TRF
                // "Achieved (as on ...)" heading names the latest month the IMPORT carried - not the
                // upload date, and not whichever month happens to hold a row (a goal-form save writes
                // one for the current month, which is what wrongly moved the heading to 30 Sep).
                // District and Club are separate uploads and move independently.
                // Prod (SkipInit=true) applies SQL/goal_foundation_import_months.sql manually.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_foundation_import_months (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_year_id INT NOT NULL,
                        Scope VARCHAR(10) NOT NULL,          -- 'District' | 'Club'
                        PeriodMonth TINYINT NOT NULL,        -- 1-12, the DATA month of the file
                        created_by INT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY uk_gfim (fk_year_id, Scope, PeriodMonth)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                // First run only: seed the pattern that was hardcoded until now (Mon-Fri 11:30-12:30
                // and 14:30-17:30 in the brand time zone), so the screens open with today's behaviour, not an empty week.
                var hasWeekly = await connection.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM training_weekly_hours");
                if (hasWeekly == 0)
                    await connection.ExecuteAsync(@"
                        INSERT INTO training_weekly_hours (DayOfWeek, StartTime, EndTime, created_date)
                        VALUES (1,'11:30:00','12:30:00',NOW()), (1,'14:30:00','17:30:00',NOW()),
                               (2,'11:30:00','12:30:00',NOW()), (2,'14:30:00','17:30:00',NOW()),
                               (3,'11:30:00','12:30:00',NOW()), (3,'14:30:00','17:30:00',NOW()),
                               (4,'11:30:00','12:30:00',NOW()), (4,'14:30:00','17:30:00',NOW()),
                               (5,'11:30:00','12:30:00',NOW()), (5,'14:30:00','17:30:00',NOW())");

                // Mass email tables
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_mass_emails (
                        pk_mass_email_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        RecipientType INT NOT NULL DEFAULT 1,
                        fk_subgroup_id INT NULL,
                        FromName VARCHAR(200) NOT NULL,
                        ReplyName VARCHAR(200) NULL,
                        ReplyEmail VARCHAR(200) NULL,
                        Subject VARCHAR(500) NOT NULL,
                        EmailBody MEDIUMTEXT NULL,
                        Status VARCHAR(20) NOT NULL DEFAULT 'Draft',
                        TotalRecipients INT DEFAULT 0,
                        SentCount INT DEFAULT 0,
                        FailedCount INT DEFAULT 0,
                        SentDate DATETIME NULL,
                        created_by INT DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_mass_email_recipients (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_mass_email_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        MemberName VARCHAR(200) NULL,
                        Email VARCHAR(200) NULL,
                        Status VARCHAR(20) DEFAULT 'Pending',
                        SentDate DATETIME NULL,
                        ErrorMessage TEXT NULL,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                // Mass email district support
                await AddColumnIfNotExists(connection, "club_mass_emails", "fk_district_id", "INT NULL AFTER fk_club_id");

                // Widen EmailBody: TEXT (64 KB) overflows once the rich-text body carries
                // an inline base64 image ("Data too long for column 'EmailBody'"). MEDIUMTEXT
                // gives 16 MB. MODIFY is idempotent, so it's safe to run every startup.
                try { await connection.ExecuteAsync("ALTER TABLE club_mass_emails MODIFY COLUMN EmailBody MEDIUMTEXT NULL"); } catch { /* already widened */ }

                // PPH Camps district support
                await AddColumnIfNotExists(connection, "pph_camps", "fk_district_id", "INT NULL AFTER fk_club_id");
                // Make fk_club_id nullable for district-level camps (drop FK first)
                try
                {
                    await connection.ExecuteAsync("ALTER TABLE pph_camps DROP FOREIGN KEY pph_camps_ibfk_1");
                }
                catch { /* FK may not exist or different name */ }
                try
                {
                    await connection.ExecuteAsync("ALTER TABLE pph_camps MODIFY fk_club_id INT NULL");
                }
                catch { /* already nullable */ }

                // ── PPH 3-level model: link each medical reading to an attendee (person) ──
                await AddColumnIfNotExists(connection, "pph_camp_attendance", "fk_attendee_id", "INT NULL AFTER fk_camp_id");
                // One-time backfill: existing flat attendance rows have no attendee yet. Group them by
                // (fk_camp_id, MobileNo) into one attendee each, then link fk_attendee_id. Rows with a blank
                // mobile get their own attendee (can't be grouped). Runs only while NULL fk_attendee_id rows exist.
                var pphRowsToBackfill = await connection.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM pph_camp_attendance WHERE fk_attendee_id IS NULL AND isdeleted = 0");
                if (pphRowsToBackfill > 0)
                {
                    var legacyRows = (await connection.QueryAsync<dynamic>(
                        @"SELECT pk_attendance_id, fk_camp_id, Name, MobileNo, Sex, Address, Age, IsConsentedForMessages
                          FROM pph_camp_attendance
                          WHERE fk_attendee_id IS NULL AND isdeleted = 0
                          ORDER BY pk_attendance_id")).ToList();

                    var attendeeByCampMobile = new Dictionary<string, int>();
                    foreach (var row in legacyRows)
                    {
                        int rowCampId = (int)row.fk_camp_id;
                        string mobile = ((string?)row.MobileNo ?? "").Trim();
                        string cacheKey = rowCampId + "|" + mobile;

                        int attendeeId;
                        if (mobile.Length > 0 && attendeeByCampMobile.TryGetValue(cacheKey, out var existingAttendeeId))
                        {
                            attendeeId = existingAttendeeId;
                        }
                        else
                        {
                            attendeeId = await connection.ExecuteScalarAsync<int>(
                                @"INSERT INTO pph_camp_attendies
                                      (fk_camp_id, Name, MobileNo, Sex, Address, IsConsentedForMessages, created_date, isdeleted)
                                  VALUES (@CampId, @Name, @Mobile, @Sex, @Address, @Consent, NOW(), 0);
                                  SELECT LAST_INSERT_ID();",
                                new
                                {
                                    CampId = rowCampId,
                                    Name = (string?)row.Name ?? "",
                                    Mobile = mobile,
                                    Sex = (string?)row.Sex,
                                    Address = (string?)row.Address,
                                    // Age stays on the reading (pph_camp_attendance), not the attendee — it can change per visit.
                                    // TINYINT(1) comes back as bool (MySqlConnector default) — Convert handles bool or numeric.
                                    Consent = Convert.ToInt32(row.IsConsentedForMessages ?? false)
                                });
                            if (mobile.Length > 0) attendeeByCampMobile[cacheKey] = attendeeId;
                        }

                        await connection.ExecuteAsync(
                            "UPDATE pph_camp_attendance SET fk_attendee_id = @Aid WHERE pk_attendance_id = @Pid",
                            new { Aid = attendeeId, Pid = (int)row.pk_attendance_id });
                    }
                }

                // ── PPH per-reading global registration number (PPH-0001, PPH-0002, …) ──
                await AddColumnIfNotExists(connection, "pph_camp_attendance", "RegistrationNo", "VARCHAR(20) NULL AFTER fk_camp_id");
                // Backfill any reading without a number, continuing from the global max (includes deleted rows
                // so numbers never repeat). Ordered by pk so assignment is stable.
                var maxRegNo = await connection.ExecuteScalarAsync<long?>(
                    "SELECT MAX(CAST(SUBSTRING(RegistrationNo, 5) AS UNSIGNED)) FROM pph_camp_attendance WHERE RegistrationNo IS NOT NULL");
                long nextRegNo = maxRegNo ?? 0;
                var rowsWithoutReg = (await connection.QueryAsync<int>(
                    "SELECT pk_attendance_id FROM pph_camp_attendance WHERE RegistrationNo IS NULL ORDER BY pk_attendance_id")).ToList();
                foreach (var pk in rowsWithoutReg)
                {
                    nextRegNo++;
                    await connection.ExecuteAsync(
                        "UPDATE pph_camp_attendance SET RegistrationNo = @Reg WHERE pk_attendance_id = @Pk",
                        new { Reg = "PPH-" + nextRegNo.ToString("D4"), Pk = pk });
                }

                // Normalize: drop the duplicated person columns from readings. Authoritative person data
                // lives on pph_camp_attendies (joined via fk_attendee_id). Runs AFTER the attendee backfill
                // above so legacy flat rows were still migrated using these columns. Guarded per column.
                foreach (var dupCol in new[] { "Name", "MobileNo", "Sex", "Address" })
                {
                    var dupExists = await connection.ExecuteScalarAsync<long?>(
                        @"SELECT COUNT(*) FROM information_schema.COLUMNS
                          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pph_camp_attendance' AND COLUMN_NAME = @c",
                        new { c = dupCol });
                    if (dupExists.HasValue && dupExists.Value > 0)
                        await connection.ExecuteAsync($"ALTER TABLE pph_camp_attendance DROP COLUMN {dupCol}");
                }

                // ── District Citation tables ──────────────────────────────────
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_activity_master (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        activity_name VARCHAR(200) NOT NULL,
                        sub_type INT DEFAULT 0,
                        sort_order INT DEFAULT 0
                    )");

                // Seed citation activity master
                var citationActivityCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_citation_activity_master");
                if (citationActivityCount == 0)
                {
                    await connection.ExecuteAsync(@"
                        INSERT INTO district_citation_activity_master (activity_name, sub_type, sort_order) VALUES
                        ('Club Website', 0, 1),
                        ('Member Addition', 0, 2),
                        ('Newsletter', 0, 3),
                        ('Club Service', 1, 4),
                        ('Community Service', 1, 5),
                        ('Vocational Service', 1, 6),
                        ('International Service', 1, 7),
                        ('New Generation Service', 1, 8),
                        ('Public Image Initiative', 1, 9),
                        ('Club Monthly Report', 0, 10),
                        ('Attendance', 0, 11),
                        ('PPH Camp', 0, 12),
                        ('Club Dues', 0, 13),
                        ('Member Addition(Lady)', 0, 14),
                        ('Member Addition(Youth)', 0, 15)");
                }

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_category (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        category_name VARCHAR(300) NOT NULL,
                        sort_order INT DEFAULT 0,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_description (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        description_html LONGTEXT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        UNIQUE KEY uk_district_year_desc (fk_district_id, fk_year_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_auto_question (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_category_id INT NOT NULL,
                        fk_activity_id INT NOT NULL,
                        points DECIMAL(10,2) DEFAULT 0,
                        is_bonus TINYINT(1) DEFAULT 0,
                        bonus_points DECIMAL(10,2) DEFAULT 0,
                        min_bonus INT DEFAULT 0,
                        max_bonus INT DEFAULT 0,
                        sort_order INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_auto_question_sub (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_auto_question_id INT NOT NULL,
                        sub_item_type VARCHAR(50) NOT NULL,
                        sub_item_id INT NULL,
                        sub_item_name VARCHAR(300) NULL,
                        points DECIMAL(10,2) DEFAULT 0,
                        is_bonus TINYINT(1) DEFAULT 0,
                        bonus_points DECIMAL(10,2) DEFAULT 0,
                        min_bonus INT DEFAULT 0,
                        max_bonus INT DEFAULT 0,
                        sort_order INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_manual_criteria (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_category_id INT NOT NULL,
                        criteria_name VARCHAR(500) NOT NULL,
                        sort_order INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_manual_sub_criteria (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_criteria_id INT NOT NULL,
                        sub_criteria_title VARCHAR(500) NULL,
                        answer_type VARCHAR(20) NOT NULL DEFAULT 'number',
                        points DECIMAL(10,2) DEFAULT 0,
                        is_bonus TINYINT(1) DEFAULT 0,
                        bonus_points DECIMAL(10,2) DEFAULT 0,
                        min_bonus INT DEFAULT 0,
                        max_bonus INT DEFAULT 0,
                        remark TEXT NULL,
                        sort_order INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_manual_sub_criteria_option (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_sub_criteria_id INT NOT NULL,
                        option_text VARCHAR(500) NOT NULL,
                        option_points DECIMAL(10,2) DEFAULT 0,
                        sort_order INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_club_entry (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        entry_type VARCHAR(10) NOT NULL,
                        fk_question_id INT NOT NULL,
                        fk_sub_question_id INT NULL,
                        answer_value VARCHAR(500) NULL,
                        points_earned DECIMAL(10,2) DEFAULT 0,
                        bonus_earned DECIMAL(10,2) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                // Backup of cleared club entries (SuperAdmin "Clear all clubs points"). Each clear snapshots
                // the district+year's live entries into a batch here BEFORE soft-deleting them, so a one-click
                // Restore can bring the exact points back. restored=1 marks a batch that has been restored.
                // Prod runs with SkipInit=true → apply SQL/district_citation_club_entry_backup.sql by hand.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_citation_club_entry_backup (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        batch_id VARCHAR(48) NOT NULL,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        entry_type VARCHAR(10) NOT NULL,
                        fk_question_id INT NOT NULL,
                        fk_sub_question_id INT NULL,
                        answer_value VARCHAR(500) NULL,
                        points_earned DECIMAL(10,2) DEFAULT 0,
                        bonus_earned DECIMAL(10,2) DEFAULT 0,
                        orig_created_by INT NULL,
                        orig_created_date DATETIME NULL,
                        cleared_by INT NULL,
                        cleared_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        restored TINYINT(1) DEFAULT 0,
                        restored_date DATETIME NULL,
                        KEY idx_batch (fk_district_id, fk_year_id, batch_id),
                        KEY idx_lookup (fk_district_id, fk_year_id, restored)
                    )");

                // Goal-oversight "message seen" marker: last time a viewer (RI Director) opened the messages
                // popup for a zone+year. Drives the red "new message" dot. Prod SkipInit → apply SQL/goal_message_seen.sql.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_message_seen (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_id INT NOT NULL,
                        fk_zone_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        last_seen_date DATETIME NOT NULL,
                        UNIQUE KEY uq_seen (fk_member_id, fk_zone_id, fk_year_id)
                    )");

                // PER-THREAD "message seen" marker (user 2026-09-25). The zone-wide row above answers
                // only "has anyone written in this zone", and opening ANY box stamped the whole zone as
                // read — so an RI Director with a dozen boxes saw one dot, had to open every box to find
                // the new message, and the moment he opened one the signal for the others was gone.
                // This row is per conversation, so each box carries its own unread count and clears on
                // its own. Prod SkipInit → apply SQL/goal_message_thread_seen.sql.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_message_thread_seen (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_id INT NOT NULL,
                        ThreadOwnerMemberId INT NOT NULL,
                        fk_category_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        last_seen_date DATETIME NOT NULL,
                        UNIQUE KEY uq_thread_seen (fk_member_id, ThreadOwnerMemberId, fk_category_id, fk_year_id)
                    )");

                // Per-SuperAdmin "Goal Setting enabled" flag — toggled on settings/super-admin-role-config.
                // A SuperAdmin sees the Goal Setting oversight tile + observer view-as ONLY when IsEnabled=1.
                // Default (no row) = disabled. Prod SkipInit → apply SQL/goal_oversight_access.sql.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_oversight_access (
                        fk_member_id INT NOT NULL PRIMARY KEY,
                        IsEnabled TINYINT(1) NOT NULL DEFAULT 0,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL,
                        modified_by INT NULL
                    )");

                // District Awards activation flag (per district + year) — SuperAdmin toggles it.
                // Missing row = ENABLED by default (see DistrictAwardsConfigHelper).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_awards_config (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        is_enabled TINYINT(1) NOT NULL DEFAULT 1,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY uq_district_awards_cfg (fk_district_id, fk_year_id)
                    )");

                // Citation sub-question filter columns
                await AddColumnIfNotExists(connection, "district_citation_auto_question_sub", "filter_aof_id", "INT NULL AFTER sub_item_name");
                await AddColumnIfNotExists(connection, "district_citation_auto_question_sub", "filter_cat_id", "INT NULL AFTER filter_aof_id");

                // Note: member_master_profile.RiAdmissionDate was removed. Admission dates now live on
                // club_members.JoinedDate (per-club). Zonal Awards / Citation queries filter on cm.JoinedDate.

                // ── Zonal Awards Tables ──
                // NOTE: Tables are created with CREATE TABLE IF NOT EXISTS below.
                // NEVER drop or delete anything — only UPDATE or UPSERT. Dropping wipes district data.

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS zonal_awards_goal (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_year_id INT NOT NULL,
                        title VARCHAR(200) NOT NULL,
                        max_points INT NULL,
                        max_remark VARCHAR(500) NULL,
                        sort_order INT DEFAULT 0,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS zonal_awards_question (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_goal_id INT NOT NULL,
                        auto_or_manual VARCHAR(10) NOT NULL DEFAULT 'Auto',
                        sr_no VARCHAR(20) NULL,
                        sub_title VARCHAR(200) NULL,
                        category VARCHAR(200) NULL,
                        sort_order INT DEFAULT 0,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS zonal_awards_question_option (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_question_id INT NOT NULL,
                        goal_requirement_label VARCHAR(500) NULL,
                        points_label VARCHAR(500) NULL,
                        mini INT DEFAULT 0,
                        maxi INT DEFAULT 0,
                        points INT DEFAULT 0,
                        atleast INT DEFAULT 0,
                        subtype INT NULL,
                        input_type VARCHAR(20) NULL,
                        question_type_for_import VARCHAR(500) NULL,
                        report_use_title VARCHAR(200) NULL,
                        sort_order INT DEFAULT 0,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS zonal_awards_district_entry (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_option_id INT NOT NULL,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        month INT NOT NULL DEFAULT 0,
                        entered_counts DECIMAL(10,2) DEFAULT 0,
                        received_points DECIMAL(10,2) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        UNIQUE KEY uk_za_entry (fk_option_id, fk_district_id, fk_year_id, month)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS zonal_awards_import_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_year_id INT NOT NULL,
                        month INT NOT NULL,
                        file_name VARCHAR(500) NULL,
                        total_districts INT DEFAULT 0,
                        total_questions INT DEFAULT 0,
                        uploaded_by INT NULL,
                        uploaded_date DATETIME DEFAULT CURRENT_TIMESTAMP
                    )");

                // Seed event masters if empty
                var tshirtCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM event_tshirt_sizes");
                if (tshirtCount == 0)
                {
                    await connection.ExecuteAsync(@"
                        INSERT INTO event_tshirt_sizes (SizeName, SortOrder) VALUES
                        ('XS', 1), ('S', 2), ('M', 3), ('L', 4), ('XL', 5), ('XXL', 6), ('XXXL', 7)");
                }

                var foodCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM event_food_preferences");
                if (foodCount == 0)
                {
                    await connection.ExecuteAsync(@"
                        INSERT INTO event_food_preferences (FoodType, SortOrder) VALUES
                        ('Vegetarian', 1), ('Non-Vegetarian', 2), ('Jain', 3), ('Vegan', 4)");
                }

                _logger.LogInformation("Database tables and triggers ensured.");

                // Create/recreate all stored procedures
                await CreateStoredProceduresAsync(connection);
                _logger.LogInformation("Stored procedures ensured.");

                // Projects live in one table per Rotary year, otherwise created when the year's first
                // project is saved. Create the current year's tables up front so a new database can list
                // projects (club websites, analytics) before anyone has added one.
                var currentYearLabel = await connection.ExecuteScalarAsync<string?>(
                    "SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted, 0) = 0 ORDER BY StartDate DESC LIMIT 1");
                if (!string.IsNullOrWhiteSpace(currentYearLabel))
                {
                    await YearTableResolver.EnsureTablesExistStaticAsync(connection, currentYearLabel, null);
                    _logger.LogInformation("Project tables ensured for Rotary year {Year}.", currentYearLabel);
                }

                var memberCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM member_master_profile WHERE isdeleted = 0");
                // Demo members only on request (Database:SeedDemoData=true); a real instance starts empty.
                if (memberCount == 0 && string.Equals(_configuration["Database:SeedDemoData"], "true", StringComparison.OrdinalIgnoreCase))
                {
                    await SeedDataAsync(connection);
                    _logger.LogInformation("Seed data inserted.");
                }

                // Seed roles if empty
                var roleCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM roles");
                if (roleCount == 0)
                {
                    await SeedRolesAsync(connection);
                    _logger.LogInformation("Roles seeded.");
                }

                // Ensure ZonalCoordinator role exists (for existing databases)
                await connection.ExecuteAsync(@"
                    INSERT IGNORE INTO roles (pk_role_id, RoleName, Description)
                    VALUES (4, 'ZonalCoordinator', 'Zonal coordinator with zone-level access')");

                // Ensure ClubModerator role exists (for existing databases)
                await connection.ExecuteAsync(@"
                    INSERT IGNORE INTO roles (pk_role_id, RoleName, Description)
                    VALUES (5, 'ClubModerator', 'Club moderator with club-level access')");

                // Ensure AG role exists (for existing databases)
                await connection.ExecuteAsync(@"
                    INSERT IGNORE INTO roles (pk_role_id, RoleName, Description)
                    VALUES (6, 'AG', 'Assistant Governor with club-level access')");

                // Ensure RIDirector role exists (for existing databases)
                await connection.ExecuteAsync(@"
                    INSERT IGNORE INTO roles (pk_role_id, RoleName, Description)
                    VALUES (7, 'RIDirector', 'RI Director with read-only org structure access and full module CRUD')");

                // Audit log table — tracks every CRUD action by every user (including SuperAdmin).
                // NEVER drop it: the "who did what" history MUST survive every restart/deploy. Previously
                // this DROP+recreate wiped the whole audit trail on every startup. Created once with
                // IF NOT EXISTS; any future schema change goes through AddColumnIfNotExists, never a re-drop.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS audit_log (
                        pk_audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_master_profile_id INT NULL,
                        member_name VARCHAR(200) NULL,
                        role_name VARCHAR(50) NULL,
                        action VARCHAR(30) NOT NULL,
                        entity_type VARCHAR(50) NOT NULL,
                        entity_id INT NULL,
                        entity_name VARCHAR(500) NULL,
                        details TEXT NULL,
                        ip_address VARCHAR(50) NULL,
                        user_agent VARCHAR(500) NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_audit_member (fk_member_master_profile_id),
                        INDEX idx_audit_entity (entity_type, entity_id),
                        INDEX idx_audit_date (created_date),
                        INDEX idx_audit_action (action),
                        INDEX idx_audit_entity_type (entity_type)
                    )");

                // Sync exception log — every collision/parse error/duplicate during member sync
                // gets written here so admin can review + resolve. No DROP — additive only,
                // history preserved across deploys.
                //
                // Two message columns by design:
                //   admin_message:    human-friendly remark for non-technical admin to read in the UI
                //                     (never mentions table/column names or internal exception text).
                //   error_message:    raw technical message (exception text, conflict pk, etc.) for
                //                     developer triage when the admin escalates an issue.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS sync_exception_log (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        exception_type VARCHAR(50) NOT NULL,
                        rotary_id VARCHAR(50) NULL,
                        rotary_org_name VARCHAR(200) NULL,
                        field_name VARCHAR(50) NULL,
                        conflict_value VARCHAR(500) NULL,
                        conflict_with_member_pk INT NULL,
                        conflict_with_member_name VARCHAR(200) NULL,
                        admin_message TEXT NULL,
                        error_message TEXT NULL,
                        raw_payload TEXT NULL,
                        fk_club_id INT NULL,
                        fk_member_master_profile_id INT NULL,
                        is_resolved TINYINT(1) NOT NULL DEFAULT 0,
                        resolved_by INT NULL,
                        resolved_date DATETIME NULL,
                        resolution_notes TEXT NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_sync_unresolved (is_resolved, created_date),
                        INDEX idx_sync_rotary_id (rotary_id),
                        INDEX idx_sync_type (exception_type),
                        INDEX idx_sync_club (fk_club_id)
                    )");

                // Idempotent ALTER for environments where sync_exception_log already exists
                // from the first 2026-06-30 schema push without admin_message.
                await AddColumnIfNotExists(connection, "sync_exception_log", "admin_message",
                    "TEXT NULL AFTER conflict_with_member_name");

                // The member-sweep worker records whether the member still landed (1) or not (0), and the
                // sync-exceptions screen filters on it; no migration ever created the column.
                await AddColumnIfNotExists(connection, "sync_exception_log", "inserted",
                    "TINYINT(1) NOT NULL DEFAULT 0 AFTER fk_member_master_profile_id");

                // PinCode widened from VARCHAR(10) -> VARCHAR(100) to absorb rotary.org
                // dirty values like 'chennai-12345' / 'chennai/123456' that we now keep
                // (alphabetic city prefix preserved, special chars stripped).
                var pincodeColLen = await connection.ExecuteScalarAsync<long?>(@"
                    SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'member_address_details'
                      AND COLUMN_NAME = 'PinCode'");
                if (pincodeColLen.HasValue && pincodeColLen.Value < 100)
                {
                    await connection.ExecuteAsync(
                        "ALTER TABLE member_address_details MODIFY COLUMN PinCode VARCHAR(100) NULL");
                    _logger.LogInformation("Widened member_address_details.PinCode from VARCHAR({Old}) to VARCHAR(100).", pincodeColLen.Value);
                }

                // District Governors
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_governors (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_member_id INT NULL,
                        member_name VARCHAR(200) NOT NULL,
                        description TEXT NULL,
                        profile_photo VARCHAR(500) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        UNIQUE KEY uk_district_year (fk_district_id, fk_year_id),
                        FOREIGN KEY (fk_district_id) REFERENCES district_master(pk_district_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    )");
                // Contacts for a DG who is NOT a member of any club: such a row has no fk_member_id,
                // so email / mobile cannot come from member_master_profile and are typed on the form.
                // Member-linked rows leave these NULL and keep reading the member's own contacts.
                // Prod SkipInit → SQL/district_governor_non_member.sql.
                await AddColumnIfNotExists(connection, "district_governors", "email", "VARCHAR(150) NULL");
                await AddColumnIfNotExists(connection, "district_governors", "mobile_number", "VARCHAR(20) NULL");

                // Login Announcements
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS login_announcements (
                        pk_announcement_id INT AUTO_INCREMENT PRIMARY KEY,
                        content MEDIUMTEXT NOT NULL,
                        is_active TINYINT(1) DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");
                // Widen content TEXT(64KB) -> MEDIUMTEXT(16MB) so inline (base64) images fit.
                // Idempotent; table is tiny so the MODIFY is instant. Guarded so an already-wide
                // column (or a rare privilege issue) can't abort the rest of the initializer.
                try { await connection.ExecuteAsync("ALTER TABLE login_announcements MODIFY content MEDIUMTEXT NOT NULL"); } catch { /* already MEDIUMTEXT or not permitted */ }
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS login_announcement_reads (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_announcement_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY uk_ann_member (fk_announcement_id, fk_member_id),
                        FOREIGN KEY (fk_announcement_id) REFERENCES login_announcements(pk_announcement_id) ON DELETE CASCADE
                    )");
                // "Show to" roles (comma list of LoginAnnouncementAudience.RoleKeys); NULL = ALL, so existing
                // announcements keep showing to everyone. Prod SkipInit → SQL/login_announcement_target_roles.sql.
                await AddColumnIfNotExists(connection, "login_announcements", "target_roles", "VARCHAR(1000) NULL");
                // Purchase filters (JSON {filterKey: value}, see LoginAnnouncementAudience.FilterDefs); NULL = no filter.
                // Prod SkipInit → SQL/login_announcement_target_filters.sql.
                await AddColumnIfNotExists(connection, "login_announcements", "target_filters", "VARCHAR(500) NULL");
                // Zone / district / club selection (JSON {ZoneIds, DistrictIds, ClubIds}); NULL = no location filter.
                // Prod SkipInit → SQL/login_announcement_target_locations.sql.
                await AddColumnIfNotExists(connection, "login_announcements", "target_locations", "TEXT NULL");

                // Club Websites subscription tracking (Phase 1)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_websites (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        Subdomain VARCHAR(100) NOT NULL,
                        ClientDomain VARCHAR(200) NULL,
                        fk_theme_id INT NULL,
                        StartDate DATE NOT NULL,
                        EndDate DATE NOT NULL,
                        Status VARCHAR(20) DEFAULT 'Inactive',
                        IsPurchased TINYINT(1) NOT NULL DEFAULT 0,
                        ReminderDays INT NULL,
                        AmountPaid DECIMAL(15,2) NULL,
                        TransactionId VARCHAR(200) NULL,
                        PaymentDate DATE NULL,
                        PaymentMode VARCHAR(50) NULL,
                        PaymentProofPath VARCHAR(500) NULL,
                        LastReminderSent DATETIME NULL,
                        Notes VARCHAR(1000) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        UNIQUE KEY uk_subdomain (Subdomain),
                        FOREIGN KEY (fk_club_id) REFERENCES club_master(pk_club_id)
                    )");

                // Explicit plan-mode flag (Purchased vs Trial) — Amount/TransactionId alone can't
                // represent "Purchased with no payment data yet" (e.g. free/comped or manual offline
                // sale entered before the receipt). Backfill is monotonic (0→1 only) so it never
                // overwrites an admin's explicit "Purchased" choice on a blank-payment row.
                await AddColumnIfNotExists(connection, "club_websites", "IsPurchased", "TINYINT(1) NOT NULL DEFAULT 0");
                await connection.ExecuteAsync(@"
                    UPDATE club_websites
                    SET IsPurchased = 1
                    WHERE IsPurchased = 0
                      AND ((AmountPaid IS NOT NULL AND AmountPaid > 0) OR (TransactionId IS NOT NULL AND TransactionId <> ''))");

                // Third-party (custom) domain DNS-pointing + Plesk provisioning state.
                // Prod (SkipInit=true) applies SQL/club_websites_domain_verify.sql manually.
                await AddColumnIfNotExists(connection, "club_websites", "ClientDomainVerifiedDate", "DATETIME NULL AFTER ClientDomain");
                await AddColumnIfNotExists(connection, "club_websites", "ClientDomainProvisioned", "TINYINT(1) NOT NULL DEFAULT 0 AFTER ClientDomainVerifiedDate");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_website_logs (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_website_id INT NOT NULL,
                        Action VARCHAR(50) NOT NULL,
                        Details VARCHAR(1000) NULL,
                        PerformedBy INT NULL,
                        PerformedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_website_id) REFERENCES club_websites(pk_id) ON DELETE CASCADE
                    )");

                // Generic system settings (key-value)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS system_settings (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        SettingKey VARCHAR(100) NOT NULL UNIQUE,
                        SettingValue VARCHAR(500) NULL,
                        Description VARCHAR(500) NULL,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
                    )");
                await connection.ExecuteAsync(@"
                    INSERT IGNORE INTO system_settings (SettingKey, SettingValue, Description)
                    VALUES ('ClubWebsiteDefaultReminderDays', '15', 'Days before website expiry to start sending renewal reminders')");
                await connection.ExecuteAsync(@"
                    INSERT IGNORE INTO system_settings (SettingKey, SettingValue, Description)
                    VALUES ('ClubWebsiteParentDomain', '', 'Parent domain under which club subdomains are created')");

                // One-time cleanup: rename any existing soft-deleted subdomains so their original names are freed
                await connection.ExecuteAsync(@"
                    UPDATE club_websites
                    SET Subdomain = CONCAT(Subdomain, '__del_', UNIX_TIMESTAMP(), '_', pk_id)
                    WHERE isdeleted = 1 AND Subdomain NOT LIKE '%__del_%'");

                // District Websites — minimal (no expiry, no template, no payment, no reminders)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_websites (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        Subdomain VARCHAR(100) NOT NULL,
                        ClientDomain VARCHAR(200) NULL,
                        Status VARCHAR(20) DEFAULT 'Inactive',
                        Notes VARCHAR(1000) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0,
                        UNIQUE KEY uk_district_subdomain (Subdomain),
                        FOREIGN KEY (fk_district_id) REFERENCES district_master(pk_district_id)
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_website_logs (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_website_id INT NOT NULL,
                        Action VARCHAR(50) NOT NULL,
                        Details VARCHAR(1000) NULL,
                        PerformedBy INT NULL,
                        PerformedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_district_website_id) REFERENCES district_websites(pk_id) ON DELETE CASCADE
                    )");

                await connection.ExecuteAsync(@"
                    UPDATE district_websites
                    SET Subdomain = CONCAT(Subdomain, '__del_', UNIX_TIMESTAMP(), '_', pk_id)
                    WHERE isdeleted = 1 AND Subdomain NOT LIKE '%__del_%'");

                // Club Leadership (President/Secretary bulk setup) email scheduling
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_leadership_email_schedule (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        ScheduleDateTime DATETIME NOT NULL,
                        Status VARCHAR(20) DEFAULT 'Pending',
                        TotalRecipients INT DEFAULT 0,
                        SentCount INT DEFAULT 0,
                        FailedCount INT DEFAULT 0,
                        ProcessedDate DATETIME NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) DEFAULT 0
                    )");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_leadership_email_log (
                        pk_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_schedule_id INT NOT NULL,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        fk_member_id INT NOT NULL,
                        DesignationName VARCHAR(100) NOT NULL,
                        Email VARCHAR(200) NOT NULL,
                        Status VARCHAR(20) DEFAULT 'Pending',
                        SentDate DATETIME NULL,
                        ErrorMessage VARCHAR(500) NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (fk_schedule_id) REFERENCES club_leadership_email_schedule(pk_id) ON DELETE CASCADE
                    )");

                // Global audit log of every email sent via IEmailService (Brevo).
                // Populated by BrevoEmailLog helper in EmailService. Never auto-purged.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS email_log (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        recipient_email VARCHAR(255) NOT NULL,
                        cc_emails VARCHAR(2000) NULL,
                        subject VARCHAR(500) NULL,
                        body_html MEDIUMTEXT NULL,
                        email_type VARCHAR(60) NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'Pending',
                        brevo_message_id VARCHAR(200) NULL,
                        error_message VARCHAR(1000) NULL,
                        fk_club_id INT NULL,
                        fk_district_id INT NULL,
                        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        INDEX ix_email_log_sent (sent_at),
                        INDEX ix_email_log_recipient (recipient_email),
                        INDEX ix_email_log_status (status),
                        INDEX ix_email_log_club (fk_club_id),
                        INDEX ix_email_log_district (fk_district_id)
                    )");
                // Scope columns for the Club/District Admin email log (added post-launch).
                await AddColumnIfNotExists(connection, "email_log", "fk_club_id", "INT NULL AFTER error_message");
                await AddColumnIfNotExists(connection, "email_log", "fk_district_id", "INT NULL AFTER fk_club_id");

                // Per-recipient WhatsApp send/delivery log (mirrors email_log). One row per
                // recipient per broadcast: submit status (Sent/Failed) written at send time,
                // upgraded to Delivered/Read/Failed by a delivery webhook (column name kept from the original schema).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS whatsapp_log (
                        pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        recipient_mobile VARCHAR(30) NOT NULL,
                        recipient_name VARCHAR(255) NULL,
                        template_name VARCHAR(120) NULL,
                        whatsapp_type VARCHAR(60) NULL,
                        source_id BIGINT NULL,
                        title VARCHAR(500) NULL,
                        fk_club_id INT NULL,
                        fk_district_id INT NULL,
                        fk_member_profile_id INT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'Sent',
                        interakt_message_id VARCHAR(200) NULL,
                        http_status INT NULL,
                        error_message VARCHAR(1000) NULL,
                        body_preview VARCHAR(2000) NULL,
                        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        delivered_at DATETIME NULL,
                        modified_at DATETIME NULL,
                        INDEX ix_wa_log_sent (sent_at),
                        INDEX ix_wa_log_mobile (recipient_mobile),
                        INDEX ix_wa_log_status (status),
                        INDEX ix_wa_log_source (whatsapp_type, source_id),
                        INDEX ix_wa_log_msgid (interakt_message_id),
                        INDEX ix_wa_log_club (fk_club_id),
                        INDEX ix_wa_log_district (fk_district_id)
                    )");

                // Seed SuperAdmin if not exists
                await SeedSuperAdminAsync(connection);

                // Sample zones, districts, clubs and zonal-award questions are the original platform's demo
                // data (Indian districts and clubs). A real ROW instance starts empty, so they are inserted only
                // with Database:SeedDemoData=true, like the demo members.
                var seedDemoData = string.Equals(_configuration["Database:SeedDemoData"], "true", StringComparison.OrdinalIgnoreCase);

                // Seed zones if empty
                var zoneCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM zone_master WHERE isdeleted = 0");
                if (seedDemoData && zoneCount == 0)
                {
                    await SeedZonesAsync(connection);
                    _logger.LogInformation("Zone seed data inserted.");
                }

                // Assign unlinked districts to zones
                var unlinkedDistricts = await connection.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM district_master WHERE fk_zone_id IS NULL AND isdeleted = 0");
                if (unlinkedDistricts > 0)
                {
                    var zones = (await connection.QueryAsync<dynamic>(
                        "SELECT pk_zone_id AS Id, ZoneName FROM zone_master WHERE isdeleted = 0 ORDER BY pk_zone_id")).ToList();
                    if (zones.Count > 0)
                    {
                        var districts = (await connection.QueryAsync<dynamic>(
                            "SELECT pk_district_id AS Id, DistrictNumber FROM district_master WHERE fk_zone_id IS NULL AND isdeleted = 0")).ToList();
                        for (int i = 0; i < districts.Count; i++)
                        {
                            var zoneId = (int)zones[i % zones.Count].Id;
                            await connection.ExecuteAsync(
                                "UPDATE district_master SET fk_zone_id = @ZoneId WHERE pk_district_id = @Id",
                                new { ZoneId = zoneId, Id = (int)districts[i].Id });
                        }
                        _logger.LogInformation("{Count} unlinked districts assigned to zones.", districts.Count);
                    }
                }

                // Seed districts and clubs if empty
                var districtCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM district_master WHERE isdeleted = 0");
                if (seedDemoData && districtCount == 0)
                {
                    await SeedDistrictsAndClubsAsync(connection);
                    _logger.LogInformation("District and club seed data inserted.");
                }

                // Seed module categories if empty
                var categoryCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM module_categories WHERE isdeleted = 0");
                if (categoryCount == 0)
                {
                    await SeedModuleCategoriesAndModulesAsync(connection);
                    _logger.LogInformation("Module categories and modules seeded.");
                }

                // Seed rotary years if empty
                var yearCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM rotary_year_master");
                if (yearCount == 0)
                {
                    await SeedRotaryYearsAsync(connection);
                    _logger.LogInformation("Rotary years seeded.");
                }

                // Always: ensure current year exists and IsCurrent flag is correct
                await UpdateRotaryYearCurrentFlagAsync(connection);

                // Seed Zonal Awards data from old production
                var zaGoalCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM zonal_awards_goal");
                if (seedDemoData && zaGoalCount == 0)
                {
                    var curYear = await connection.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
                    if (curYear.HasValue)
                    {
                        var yId = curYear.Value;
                        await SeedZonalAwardsAsync(connection, yId);
                        _logger.LogInformation("Zonal Awards data seeded.");
                    }
                }

                // Idempotent migration: add question_level column + seed Q23 Cricket Match (zone-level)
                // Never deletes — only adds column if missing and inserts Q23 if not present
                await AddColumnIfNotExists(connection, "zonal_awards_question", "question_level", "VARCHAR(20) DEFAULT 'District' AFTER auto_or_manual");
                await EnsureZoneCricketMatchAsync(connection);

                // ── Mobile Auth & Device Tracking ──
                // New tables + columns for mobile app login (OTP based). Never touches web portal auth.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS mobile_login_otp (
                        pk_otp_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_master_profile_id INT NULL,
                        fk_family_member_id INT NULL,
                        login_type VARCHAR(20) NOT NULL,
                        identifier VARCHAR(200) NOT NULL,
                        country_id INT NULL,
                        otp_code VARCHAR(10) NOT NULL,
                        attempts INT DEFAULT 0,
                        max_attempts INT DEFAULT 5,
                        expires_at DATETIME NOT NULL,
                        is_used TINYINT(1) DEFAULT 0,
                        sent_email TINYINT(1) DEFAULT 0,
                        sent_sms TINYINT(1) DEFAULT 0,
                        sent_whatsapp TINYINT(1) NOT NULL DEFAULT 0,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_otp_lookup (identifier, is_used, expires_at)
                    )");

                // Non-India members get their OTP over WhatsApp (the SMS gateway is India-only).
                await AddColumnIfNotExists(connection, "mobile_login_otp", "sent_whatsapp", "TINYINT(1) NOT NULL DEFAULT 0 AFTER sent_sms");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS member_device_sessions (
                        pk_session_id INT AUTO_INCREMENT PRIMARY KEY,
                        fk_member_master_profile_id INT NOT NULL,
                        fk_family_member_id INT NULL,
                        imei VARCHAR(100) NULL,
                        device_token VARCHAR(500) NULL,
                        device_name VARCHAR(20) NULL,
                        app_version VARCHAR(20) NULL,
                        login_count INT DEFAULT 1,
                        first_visit DATETIME NOT NULL,
                        last_visit DATETIME NOT NULL,
                        last_logout DATETIME NULL,
                        is_active TINYINT(1) DEFAULT 1,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY uk_member_imei (fk_member_master_profile_id, imei)
                    )");

                // Summary columns on member_master_profile (per user requirement)
                await AddColumnIfNotExists(connection, "member_master_profile", "MobileLoginCount", "INT DEFAULT 0");
                await AddColumnIfNotExists(connection, "member_master_profile", "LastImei", "VARCHAR(100) NULL");
                await AddColumnIfNotExists(connection, "member_master_profile", "LastDeviceToken", "VARCHAR(500) NULL");
                await AddColumnIfNotExists(connection, "member_master_profile", "LastDeviceName", "VARCHAR(20) NULL");
                await AddColumnIfNotExists(connection, "member_master_profile", "FirstMobileVisit", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "member_master_profile", "LastMobileVisit", "DATETIME NULL");
                await AddColumnIfNotExists(connection, "member_master_profile", "LastMobileLogout", "DATETIME NULL");

                // Set to UTC_TIMESTAMP() whenever the member's primary mobile changes (or
                // when a SuperAdmin wants to force a mobile re-login). MobileJwtRefreshMiddleware
                // compares this against the JWT iat claim and rejects (401) any mobile JWT
                // issued before this moment. NULL means no forced relogin pending — token is valid.
                await AddColumnIfNotExists(connection, "member_master_profile", "mobile_force_relogin_at", "DATETIME NULL");

                // Module Master — Coming Soon flag (per-module placeholder for non-SuperAdmin during phased data migration)
                await AddColumnIfNotExists(connection, "module_master", "IsComingSoon", "TINYINT(1) NOT NULL DEFAULT 0");
                await AddColumnIfNotExists(connection, "module_master", "ComingSoonDate", "DATETIME NULL");

                // Seed designations if empty
                var designationCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM designation_master WHERE isdeleted = 0");
                if (designationCount == 0)
                {
                    await SeedDesignationsAsync(connection);
                    _logger.LogInformation("Designations seeded.");
                }

                // Seed website data modules if empty
                var websiteModuleCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM website_data_module_master WHERE isdeleted = 0");
                if (websiteModuleCount == 0)
                {
                    await SeedWebsiteDataModulesAsync(connection);
                    _logger.LogInformation("Website data modules seeded.");
                }

                // theme_master is NOT auto-seeded — themes are added manually from the Theme screen only.

                // Seed OCV document categories and types if empty
                var ocvCategoryCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ocv_document_category");
                if (ocvCategoryCount == 0)
                {
                    await SeedOcvDocumentDataAsync(connection);
                    _logger.LogInformation("OCV document categories and types seeded.");
                }

                // Seed TRF fund types if empty
                var trfFundCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM trf_fund_master WHERE isdeleted = 0");
                if (trfFundCount == 0)
                {
                    await connection.ExecuteAsync(@"
                        INSERT INTO trf_fund_master (FundName, SortOrder, IsActive, isdeleted, created_date) VALUES
                        ('Annual (Unrestricted)', 1, 1, 0, NOW()),
                        ('Endowment', 2, 1, 0, NOW()),
                        ('Global Grant (Restricted)', 3, 1, 0, NOW()),
                        ('Polio', 4, 1, 0, NOW()),
                        ('Others', 5, 1, 0, NOW())");
                    _logger.LogInformation("TRF fund types seeded.");
                }

                // Phase 9: indexes for Club Website public path. The public Next.js app
                // serves 2000+ subdomains from a single deploy, so every read goes through
                // these tables — covering composite indexes keep response time flat as the
                // dataset grows.

                // 1. Tenant resolver — match by ClientDomain (subdomain is already UNIQUE so indexed).
                await CreateIndexIfNotExists(connection, "club_websites", "idx_cw_client_domain",
                    "CREATE INDEX idx_cw_client_domain ON club_websites (ClientDomain, isdeleted)");
                // 2. Active-theme / IsClubServiceable / settings lookups by club.
                await CreateIndexIfNotExists(connection, "club_websites", "idx_cw_club_active",
                    "CREATE INDEX idx_cw_club_active ON club_websites (fk_club_id, isdeleted, Status)");

                // 3. Banners / advertisements / about / contact / social — all keyed by
                //    (fk_club_id, fk_year_id) with active+not-deleted filters in WHERE.
                await CreateIndexIfNotExists(connection, "club_website_banner", "idx_banner_club_year",
                    "CREATE INDEX idx_banner_club_year ON club_website_banner (fk_club_id, fk_year_id, isdeleted, is_active, sort_order)");
                await CreateIndexIfNotExists(connection, "club_website_advertisement", "idx_ad_club_year",
                    "CREATE INDEX idx_ad_club_year ON club_website_advertisement (fk_club_id, fk_year_id, isdeleted, is_active, sort_order)");
                // About is NOT year-wise (fk_year_id dropped) — index by club/district scope.
                await CreateIndexIfNotExists(connection, "club_website_about", "idx_about_club",
                    "CREATE INDEX idx_about_club ON club_website_about (fk_club_id, fk_district_id, isdeleted, is_active)");
                await CreateIndexIfNotExists(connection, "club_website_contact_detail", "idx_contact_club_year",
                    "CREATE INDEX idx_contact_club_year ON club_website_contact_detail (fk_club_id, fk_year_id, isdeleted, is_active, sort_order)");
                // Social media links are NOT year-wise (fk_year_id dropped) — index by club/district scope.
                await CreateIndexIfNotExists(connection, "club_website_social_link", "idx_social_club",
                    "CREATE INDEX idx_social_club ON club_website_social_link (fk_club_id, fk_district_id, isdeleted, is_active, sort_order)");

                // 4. Menus + sub-menus — public Menu endpoint.
                await CreateIndexIfNotExists(connection, "club_website_menu", "idx_menu_club_active",
                    "CREATE INDEX idx_menu_club_active ON club_website_menu (fk_club_id, isdeleted, is_active, sort_order)");
                await CreateIndexIfNotExists(connection, "club_website_submenu", "idx_submenu_menu_active",
                    "CREATE INDEX idx_submenu_menu_active ON club_website_submenu (fk_menu_id, isdeleted, is_active, sort_order)");

                // 5. BOD — Directors page (year-filtered, sorted by drag-order + designation).
                await CreateIndexIfNotExists(connection, "board_of_directors", "idx_bod_club_year_active",
                    "CREATE INDEX idx_bod_club_year_active ON board_of_directors (fk_club_id, fk_year_id, isdeleted, sort_order)");

                // 6. Past presidents — straight (club, year) lookup.
                await CreateIndexIfNotExists(connection, "past_presidents", "idx_pp_club",
                    "CREATE INDEX idx_pp_club ON past_presidents (fk_club_id, isdeleted, fk_year_id)");

                // 7. Calendar events — by date for today's-events query.
                await CreateIndexIfNotExists(connection, "upcoming_events", "idx_events_club_active_date",
                    "CREATE INDEX idx_events_club_active_date ON upcoming_events (fk_club_id, IsActive, isdeleted, Status, EventDate)");

                // ─── Wave 13A3 — DG goal-setting + AG-feeding tables ───────────────
                // Five new (district|club, year)-scoped tables that back the District Admin
                // dashboard "set goal" forms and the AG dashboard read-only displays.
                // All use CREATE IF NOT EXISTS so startup is idempotent.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_membership_goal (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        target_total INT DEFAULT 0,
                        target_new_members INT DEFAULT 0,
                        target_retention_percent DECIMAL(5,2) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        UNIQUE KEY uk_district_year (fk_district_id, fk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_foundation_goal (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        target_annual_fund_usd DECIMAL(15,2) DEFAULT 0,
                        target_polio_fund_usd DECIMAL(15,2) DEFAULT 0,
                        target_endowment_fund_usd DECIMAL(15,2) DEFAULT 0,
                        target_other_fund_usd DECIMAL(15,2) DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        UNIQUE KEY uk_district_year (fk_district_id, fk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // Per-avenue (module) row, e.g. Community / Vocational / International /
                // NewGen / Public Image. Uniqueness across (district, year, module).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS district_project_target (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        fk_module_id INT NOT NULL,
                        target_count INT DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        UNIQUE KEY uk_district_year_module (fk_district_id, fk_year_id, fk_module_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // ─── Goal Setting module (club + district + zone-level oversight) ──
                // Replaces two standalone district-only apps (Disha Zone 5&6 / Zone 4&7) with
                // one system spanning Club, District and Zone level across 4 categories
                // (Membership, Foundation, Youth, Public Image — Club Service Projects excluded).
                // fk_club_id/fk_district_id/fk_zone_id use the SAME 0-as-"not applicable" sentinel
                // member_roles already uses (not NULL) — a real FK constraint would reject 0 since
                // no club/district/zone has pk=0, and NULL would break the UNIQUE KEY (two NULLs
                // are never considered equal), so these columns are intentionally NOT NULL DEFAULT 0
                // with no hard FK constraint, exactly like member_roles's scoping columns.
                // Prod runs with SkipInit=true → apply the same CREATE/seed statements by hand.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_categories (
                        pk_category_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        Name VARCHAR(50) NOT NULL,
                        SortOrder INT NOT NULL DEFAULT 0,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY uk_goal_category_name (Name)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // One row per subcategory line-item (~90 total across the 4 categories) — a
                // generic field-definition table, same shape Disha itself uses, since hardcoding
                // one column per metric across ~90 heterogeneous subcategories (counts,
                // percentages, currency, booleans, free text, computed) isn't tenable. The SAME
                // field set is used for both Club and District entry (they track identical
                // subcategories with independently-entered numbers), so no per-field
                // club/district-applicability flag is needed.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_fields (
                        pk_field_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_category_id INT NOT NULL,
                        GroupName VARCHAR(100) NOT NULL,
                        FieldKey VARCHAR(100) NOT NULL,
                        FieldLabel VARCHAR(200) NOT NULL,
                        DataType VARCHAR(20) NOT NULL,
                        Unit VARCHAR(20) NULL,
                        FieldRole VARCHAR(20) NOT NULL,
                        ComputeExpression VARCHAR(200) NULL,
                        AppliesTo VARCHAR(20) NOT NULL DEFAULT 'Both',
                        SortOrder INT NOT NULL DEFAULT 0,
                        IsHidden TINYINT(1) NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY uk_goal_field_key (FieldKey),
                        INDEX idx_goal_field_category (fk_category_id, SortOrder),
                        FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // The actual entered values — one row per (field, year, club-or-district).
                // Only one of NumericValue/TextValue/BoolValue is populated, matching FieldKey's
                // DataType. ON DUPLICATE KEY UPDATE upsert, same pattern as
                // club_foundation_collection_goals / district_foundation_goal.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_entries (
                        pk_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_field_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        EntityType VARCHAR(10) NOT NULL,
                        fk_club_id INT NOT NULL DEFAULT 0,
                        fk_district_id INT NOT NULL DEFAULT 0,
                        NumericValue DECIMAL(18,2) NULL,
                        TextValue TEXT NULL,
                        BoolValue TINYINT(1) NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY uk_goal_entry (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id),
                        INDEX idx_goal_entry_club (fk_club_id, fk_year_id),
                        INDEX idx_goal_entry_district (fk_district_id, fk_year_id),
                        FOREIGN KEY (fk_field_id) REFERENCES goal_fields(pk_field_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // Lock granularity is (entity, category, year) — a club's Membership goals can be
                // locked while its Foundation goals stay open. A bulk "lock everything" action
                // (Role 5 / SuperAdmin) fans out to one concrete row per category rather than
                // using a wildcard/NULL category, so lock checks never need to test two cases.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_locks (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        EntityType VARCHAR(10) NOT NULL,
                        fk_club_id INT NOT NULL DEFAULT 0,
                        fk_district_id INT NOT NULL DEFAULT 0,
                        fk_category_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        IsLocked TINYINT(1) NOT NULL DEFAULT 0,
                        LockedBy INT NULL,
                        LockedDate DATETIME NULL,
                        UnlockedBy INT NULL,
                        UnlockedDate DATETIME NULL,
                        UNIQUE KEY uk_goal_lock (EntityType, fk_club_id, fk_district_id, fk_category_id, fk_year_id),
                        FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // Scoped per (district, category, year) — comments are about a district's
                // goal-setting oversight, not per-club. PostedByTier drives visibility:
                // 1=District Admin, 2=Few-Districts-One-Category-One-Zone,
                // 3=All-Districts-One-Category-One-Zone, 4=All-Category-All-Districts-Few-Zones
                // (SuperAdmin reads everything regardless of tier). A viewer sees every comment
                // with PostedByTier <= their own tier.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_comments (
                        pk_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_category_id INT NOT NULL,
                        fk_district_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        CommentText TEXT NOT NULL,
                        PostedByMemberId INT NOT NULL,
                        PostedByTier TINYINT NOT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        INDEX idx_goal_comment_thread (fk_district_id, fk_category_id, fk_year_id, PostedByTier),
                        FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id),
                        FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // The 3 specialized oversight roles — Club Admin and District Admin reuse the
                // EXISTING member_roles table (fk_role_id=2, scoped by fk_club_id/fk_district_id),
                // no new table needed for those two. AssignmentName is the free-text label a
                // SuperAdmin types in at assignment time (e.g. "Membership Reviewer — Districts
                // 3140,3141 — Zone 5") — there is no precedent for a per-assignment custom name
                // anywhere else in this codebase, so this is a new field, not a reused one.
                // fk_category_id is NULL only for AllCategoryAllDistrictsFewZones (spans all 4).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_role_assignments (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_member_id INT NOT NULL,
                        RoleType VARCHAR(50) NOT NULL,
                        AssignmentName VARCHAR(200) NOT NULL,
                        fk_category_id INT NULL,
                        fk_zone_id INT NULL,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        AssignedBy INT NULL,
                        AssignedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                        RevokedBy INT NULL,
                        RevokedDate DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        INDEX idx_goal_role_member (fk_member_id, IsActive),
                        FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // District subset for FewDistrictsOneCategoryOneZone assignments only.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_role_assignment_districts (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_assignment_id INT NOT NULL,
                        fk_district_id INT NOT NULL,
                        UNIQUE KEY uk_goal_role_assignment_district (fk_assignment_id, fk_district_id),
                        FOREIGN KEY (fk_assignment_id) REFERENCES goal_role_assignments(pk_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // Zone subset for AllCategoryAllDistrictsFewZones assignments only.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_role_assignment_zones (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_assignment_id INT NOT NULL,
                        fk_zone_id INT NOT NULL,
                        UNIQUE KEY uk_goal_role_assignment_zone (fk_assignment_id, fk_zone_id),
                        FOREIGN KEY (fk_assignment_id) REFERENCES goal_role_assignments(pk_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // ── Zonal-leadership hierarchy overlay (2026-08) ───────────────────────
                // The notepad org-chart (RMC / ARC / RPIC / RRFC / E-MGA / EPNC / Plan Leads /
                // Zonal Action Plan Champion …) is captured as human-friendly METADATA on top
                // of the proven 3-RoleType tier engine — the named title drives which RoleType +
                // category the assignment resolves to, but visibility/locking still runs on the
                // existing tier logic. All columns are additive & nullable so pre-existing
                // assignments (which had none of this) keep working untouched.
                await AddColumnIfNotExists(connection, "goal_role_assignments", "RoleTitle", "VARCHAR(150) NULL AFTER AssignmentName");
                await AddColumnIfNotExists(connection, "goal_role_assignments", "Avenue", "VARCHAR(100) NULL AFTER RoleTitle");
                await AddColumnIfNotExists(connection, "goal_role_assignments", "HomeDistrictId", "INT NULL AFTER fk_zone_id");
                await AddColumnIfNotExists(connection, "goal_role_assignments", "DgYear", "VARCHAR(40) NULL AFTER HomeDistrictId");
                await AddColumnIfNotExists(connection, "goal_role_assignments", "SupportingText", "VARCHAR(255) NULL AFTER DgYear");
                // When this holder was last sent their role email (2026-09-16). Informational only — the
                // "Send role emails" button always mails everyone in the filtered zone; this just lets the
                // listing show who was emailed and when.
                await AddColumnIfNotExists(connection, "goal_role_assignments", "RoleEmailSentDate", "DATETIME NULL AFTER AssignedDate");
                // Free-text member name fallback: some notepad leaders aren't matchable to a
                // real member_master_profile row. When picked from the member list, fk_member_id
                // holds the id and this stays NULL; when typed free-hand, fk_member_id = 0 and
                // this carries the display name.
                await AddColumnIfNotExists(connection, "goal_role_assignments", "MemberNameText", "VARCHAR(200) NULL AFTER fk_member_id");

                // Extensible catalog of leadership designations (titles). Seeded with the
                // standard RI set; SuperAdmin can add more from the UI. Each title fixes the
                // RoleType (tier) it resolves to and the goal category its messages attach to
                // (DefaultCategoryName NULL = spans all categories, e.g. Zonal Action Plan).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS goal_leadership_designations (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        Title VARCHAR(150) NOT NULL,
                        Avenue VARCHAR(100) NOT NULL,
                        RoleType VARCHAR(50) NOT NULL,
                        DefaultCategoryName VARCHAR(50) NULL,
                        SortOrder INT NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        UNIQUE KEY uk_goal_designation_title (Title)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
                await SeedGoalLeadershipDesignationsAsync(connection);

                // Club↔District message thread support: fk_club_id = 0 is the district thread
                // (District Admin ↔ coordinators above); fk_club_id > 0 is a club thread
                // (Club Admin ↔ its District Admin only). Additive; existing rows default to 0
                // (district threads), preserving every current comment.
                await AddColumnIfNotExists(connection, "goal_comments", "fk_club_id", "INT NOT NULL DEFAULT 0 AFTER fk_district_id");

                // ThreadOwnerMemberId — the DA / ZC member who OWNS a pairwise oversight thread. Goal
                // messages are now private 1-to-1 conversations UP the hierarchy: each District
                // Assistant and each Zone Co-ordinator has its own thread with the RI Director over its
                // zone, isolated per (category, district, year). Owner = that DA/ZC's member id; the RI
                // Director is the counterparty. 0 = legacy shared row (admin messaging, now retired).
                await AddColumnIfNotExists(connection, "goal_comments", "ThreadOwnerMemberId", "INT NOT NULL DEFAULT 0 AFTER fk_club_id");

                // Goal messages follow the ROLE SEAT, not the person: fk_assignment_id = the
                // goal_role_assignments row the message was posted under, fk_zone_id = its zone. A person
                // leaving / being replaced no longer hides their messages. Backfill only fills rows still 0
                // (same statements as SQL/goal_comments_seat_zone.sql).
                await AddColumnIfNotExists(connection, "goal_comments", "fk_assignment_id", "INT NOT NULL DEFAULT 0 AFTER ThreadOwnerMemberId");
                await AddColumnIfNotExists(connection, "goal_comments", "fk_zone_id", "INT NOT NULL DEFAULT 0 AFTER fk_assignment_id");
                await CreateIndexIfNotExists(connection, "goal_comments", "idx_goal_comment_zone",
                    "CREATE INDEX idx_goal_comment_zone ON goal_comments (fk_zone_id, fk_year_id)");
                await CreateIndexIfNotExists(connection, "goal_comments", "idx_goal_comment_seat",
                    "CREATE INDEX idx_goal_comment_seat ON goal_comments (fk_assignment_id)");
                await connection.ExecuteAsync(@"
                    UPDATE goal_comments c
                    SET c.fk_assignment_id = COALESCE((
                        SELECT a.pk_id FROM goal_role_assignments a
                        WHERE a.fk_member_id = c.ThreadOwnerMemberId AND a.fk_category_id = c.fk_category_id
                          AND a.RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
                        ORDER BY ((c.PostedByTier = 3 AND a.RoleType = 'AllDistrictsOneCategoryOneZone')
                               OR (c.PostedByTier = 2 AND a.RoleType = 'FewDistrictsOneCategoryOneZone')) DESC,
                                 (c.fk_district_id > 0 AND EXISTS (SELECT 1 FROM goal_role_assignment_districts d
                                      WHERE d.fk_assignment_id = a.pk_id AND d.fk_district_id = c.fk_district_id)) DESC,
                                 (c.created_date >= a.AssignedDate AND (a.RevokedDate IS NULL OR c.created_date <= a.RevokedDate)) DESC,
                                 a.pk_id DESC
                        LIMIT 1), 0)
                    WHERE c.fk_assignment_id = 0 AND c.ThreadOwnerMemberId > 0");
                await connection.ExecuteAsync(@"
                    UPDATE goal_comments c
                    LEFT JOIN goal_role_assignments a ON a.pk_id = c.fk_assignment_id
                    LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
                    SET c.fk_zone_id = COALESCE(a.fk_zone_id, dm.fk_zone_id, 0)
                    WHERE c.fk_zone_id = 0");

                // Field scoping — each goal field applies to Club, District, or Both (default).
                // A club shouldn't see district-level rows (Total No of Clubs, RAG analysis, etc.),
                // and vice-versa. Idempotent add for DBs seeded before this column existed; the
                // seeder below backfills the actual Club/District/Both value for every field.
                await AddColumnIfNotExists(connection, "goal_fields", "AppliesTo", "VARCHAR(20) NOT NULL DEFAULT 'Both' AFTER ComputeExpression");
                // Hidden fields are seeded + imported into but never rendered on a tab — e.g. the raw
                // yearly TRF figures that feed the "Average / Highest (Last 5 Years)" read-only values.
                await AddColumnIfNotExists(connection, "goal_fields", "IsHidden", "TINYINT(1) NOT NULL DEFAULT 0 AFTER SortOrder");

                // Runs every startup, inserts only missing rows (categories by unique Name,
                // fields by unique FieldKey) — safe to re-run, including against the already-live
                // production DB where SkipInit means this whole file doesn't fire automatically.
                await SeedGoalSettingFieldsAsync(connection);

                // Goal Setting module row — added post-launch (no INSERT-if-missing precedent
                // exists elsewhere in this file for a brand-new module; every other module was
                // seeded once in SeedModuleCategoriesAndModulesAsync, which only fires on an
                // empty DB). Grouped under "E-Governance / Reporting" alongside Attendance/TRF
                // Contribution/Reports/Zonal Awards — same "track and report progress" family.
                var goalModuleExists = await connection.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM module_master WHERE ModuleKey = 'goal_setting' AND isdeleted = 0");
                if (goalModuleExists == 0)
                {
                    var egovCatId = await connection.ExecuteScalarAsync<int?>(
                        "SELECT pk_category_id FROM module_categories WHERE CategoryName = 'E-Governance / Reporting' AND isdeleted = 0");
                    if (egovCatId.HasValue)
                    {
                        await connection.ExecuteAsync(@"
                            INSERT INTO module_master (ModuleName, ModuleKey, fk_category_id, ModuleLevel, IconClass, IsDefaultForDistrict, IsDefaultForClub, SortOrder)
                            VALUES ('Goal Setting', 'goal_setting', @CatId, 'Both', 'Target', 1, 1, 7)",
                            new { CatId = egovCatId.Value });
                    }
                }

                // Per-club award status. status fields are short strings —
                // 'pending' | 'on_track' | 'achieved' | 'behind' (no DB enum so
                // parallel UI/AG code can evolve the vocabulary without ALTERs).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_award_status (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        on_track TINYINT(1) DEFAULT 0,
                        achieved TINYINT(1) DEFAULT 0,
                        presidential_citation_status VARCHAR(20) DEFAULT 'pending',
                        district_citation_status VARCHAR(20) DEFAULT 'pending',
                        membership_excellence_status VARCHAR(20) DEFAULT 'pending',
                        notes TEXT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        UNIQUE KEY uk_club_year (fk_club_id, fk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // Per-club MyRotary registration count snapshot. last_synced is when
                // the admin last hit Save (or when an automated sync writes the row).
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS club_myrotary_tracking (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NOT NULL,
                        registered_members INT DEFAULT 0,
                        total_members INT DEFAULT 0,
                        registration_percentage DECIMAL(5,2) DEFAULT 0,
                        last_synced DATETIME NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                        IsActive TINYINT(1) NOT NULL DEFAULT 1,
                        UNIQUE KEY uk_club_year (fk_club_id, fk_year_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // Wave 13A3 — ensure `man_hours INT DEFAULT 0` column on every existing
                // year-bound rotary_projects_YYYY_YY table. New table creates already
                // include `man_hours INT NULL` (see YearTableResolver.EnsureTablesExistStaticAsync);
                // this loop backfills older tables and migrates any NULL default to 0.
                var projectsYearTables = await connection.QueryAsync<string>(@"
                    SELECT TABLE_NAME FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME LIKE 'rotary_projects\\_%' ESCAPE '\\'");
                foreach (var tbl in projectsYearTables)
                {
                    await AddColumnIfNotExists(connection, tbl, "man_hours", "INT DEFAULT 0");
                }

                // RI Flow-Bot SPC sync status — set once the extension confirms a project was published
                // into Rotary International's Service Project Center, so the club-admin listing can hide
                // its "Sync" button. New year tables already include these (YearTableResolver); this loop
                // backfills existing ones. (Prod runs with SkipInit=true → apply the same ALTERs by hand.)
                foreach (var tbl in projectsYearTables)
                {
                    await AddColumnIfNotExists(connection, tbl, "synced_to_org", "TINYINT(1) NOT NULL DEFAULT 0");
                    await AddColumnIfNotExists(connection, tbl, "synced_to_org_date", "DATETIME NULL");
                }

                // Rotary.org project sync log — one row per event (Sync clicked / Published / Reset) so
                // SuperAdmin → Settings → Project Sync can show who started a sync that never got
                // published. synced_to_org stays the source of truth for the current state.
                // (Prod runs with SkipInit=true → SQL/rotary_org_project_sync_log.sql.)
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS rotary_org_project_sync_log (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_project_id INT NOT NULL,
                        fk_club_id INT NOT NULL,
                        fk_year_id INT NULL,
                        projects_table VARCHAR(64) NULL,
                        action VARCHAR(20) NOT NULL,
                        fk_member_id INT NULL,
                        client_ip VARCHAR(64) NULL,
                        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        KEY ix_club_project (fk_club_id, fk_project_id),
                        KEY ix_created (created_date)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                // RCC Involved — the count of Rotary Community Corps members on a project, filed next to
                // Rotaractors Involved on every project form (user 2026-10-05). Optional, defaults to 0,
                // so every existing project reads 0 rather than blank. New year tables already include it
                // (YearTableResolver); this loop backfills the existing ones.
                foreach (var tbl in projectsYearTables)
                {
                    await AddColumnIfNotExists(connection, tbl, "rcc_involved", "INT NULL DEFAULT 0");
                }

                // Multi-currency Project Cost — every year-wise rotary_projects table gets a
                // Currency column. New table creates already include it (YearTableResolver);
                // this loop backfills existing tables. Existing rows default to the brand's currency.
                foreach (var tbl in projectsYearTables)
                {
                    await AddColumnIfNotExists(connection, tbl, "Currency", $"VARCHAR(5) NOT NULL DEFAULT '{Brand.SqlCurrency}'");
                }

                // App Route Maintenance — SuperAdmin switchboard for the mobile
                // Flutter app's per-route blocklist. The mobile app reads only
                // rows where IsUnderMaintenance=1; admin web reads ALL rows.
                // Seed is INSERT IGNORE so re-runs preserve admin toggles.
                await connection.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS route_maintenance (
                        pk_route_maintenance_id INT AUTO_INCREMENT PRIMARY KEY,
                        RouteKey            VARCHAR(200) NOT NULL UNIQUE,
                        Label               VARCHAR(200) NULL,
                        IsUnderMaintenance  TINYINT(1) NOT NULL DEFAULT 0,
                        Message             VARCHAR(500) NULL,
                        MaintenanceUntil    DATETIME NULL,
                        created_date        DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_date       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                        modified_by         INT NULL,
                        INDEX idx_under_maintenance (IsUnderMaintenance)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

                await SeedRouteMaintenanceAsync(connection);

                // Never reset any user's password on boot: passwords change only through
                // explicit SuperAdmin reset flows.
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error initializing database. Make sure MySQL is running.");
        }
    }

    // App Route Maintenance seed. INSERT IGNORE so live admin toggles are
    // preserved on every startup. Tuples are (RouteKey, Label). Labels are
    // human-readable for the SuperAdmin UI; RouteKeys are verbatim mobile-app
    // routes — DO NOT alter the strings, the Flutter app matches on them.
    private async Task SeedRouteMaintenanceAsync(MySqlConnection connection)
    {
        try
        {
            var seed = new (string RouteKey, string Label)[]
            {
                // Group 12: Global switch (rendered at top of admin UI).
                ("*", "GLOBAL APP MAINTENANCE"),

                // Group 1: Auth & system (rendered locked in UI).
                ("/splash", "Splash"),
                ("/login", "Login"),
                ("/otp-verify", "OTP Verify"),
                ("/welcome", "Welcome"),
                ("/terms", "Terms"),
                ("/admin-login", "Admin Login"),
                ("/forgot-password", "Forgot Password"),
                ("/reset-password", "Reset Password"),
                ("/home", "Home"),
                ("/app-lock", "App Lock"),
                ("/settings/security", "Settings - Security"),
                ("/profile", "Profile"),
                ("/profile/edit", "Profile Edit"),
                ("/notifications", "Notifications"),
                ("/settings", "Settings"),
                ("/settings/color-theme", "Settings - Color Theme"),
                ("/settings/text-size", "Settings - Text Size"),
                ("/settings/font-family", "Settings - Font Family"),
                ("/settings/rotary-years", "Settings - Rotary Years"),
                ("/settings/designations", "Settings - Designations"),
                ("/settings/categories", "Settings - Categories"),
                ("/settings/area-of-focus", "Settings - Area of Focus"),

                // Group 2: Zones.
                ("/zones", "Zones - List"),
                ("/zones/new", "Zones - New"),
                ("/zones/:id/edit", "Zones - Edit"),
                ("/zones/:id/districts", "Zones - Districts"),

                // Group 3: Districts.
                ("/districts", "Districts - List"),
                ("/districts/new", "Districts - New"),
                ("/districts/:id/edit", "Districts - Edit"),
                ("/districts/:id/dashboard", "District Dashboard"),
                ("/districts/:id/overview", "District Overview"),
                ("/districts/:id/members", "District Members"),
                ("/directory/:memberId", "Directory - Member Detail"),
                ("/districts/:id/announcements", "District Announcements"),
                ("/districts/:id/newsletters", "District Newsletters"),
                ("/districts/:id/documents", "District Documents"),
                ("/districts/:id/upcoming-events", "District Upcoming Events"),
                ("/districts/:id/projects", "District Projects"),
                ("/districts/:id/mass-emails", "District Mass Emails"),
                ("/districts/:id/clubs", "District Clubs"),
                ("/districts/:id/greetings", "District Greetings"),
                ("/districts/:id/sub-groups", "District Sub-Groups"),
                ("/districts/:id/website-data", "District Website Data"),
                ("/districts/:id/website-data/contact-details", "District Website - Contact Details"),
                ("/districts/:id/website-data/social-media-links", "District Website - Social Links"),
                ("/districts/:id/website-data/about", "District Website - About"),
                ("/districts/:id/website-data/banners", "District Website - Banners"),
                ("/districts/:id/website-data/advertisements", "District Website - Advertisements"),
                ("/districts/:id/website-data/menu-list", "District Website - Menu List"),
                ("/districts/:id/weblinks", "District Weblinks"),
                ("/districts/:id/club-monthly-report", "District Club Monthly Report"),
                ("/districts/:id/club-monthly-report/:yearId/:month", "District Club Monthly Report - Month"),
                ("/districts/:id/district-committee", "District Committee"),
                ("/districts/:id/district-committee/members", "District Committee - Members"),
                ("/districts/:id/district-committee/groups", "District Committee - Groups"),
                ("/districts/:id/district-committee/groups/:groupId", "District Committee - Group Detail"),
                ("/districts/:id/district-committee/groups/:groupId/sub-groups", "District Committee - Sub-Groups"),
                ("/districts/:id/district-committee/groups/:groupId/sub-groups/:subGroupId", "District Committee - Sub-Group Detail"),
                ("/districts/:id/district-events", "District Events"),
                ("/districts/:id/club-moderator", "District Club Moderator"),
                ("/districts/:id/district-citation", "District Awards"),
                ("/districts/:id/rni-camp", "District RNI Camp"),
                ("/districts/:id/rni-camp/:campId/attendance", "District RNI Camp - Attendance"),
                ("/districts/:id/reports", "District Reports"),
                ("/districts/:id/zonal-awards", "District Zonal Awards"),
                ("/districts/:id/online-event-link", "District Online Event Link"),
                ("/districts/:id/event-payment-links/:linkId/members", "District Event Payment Links - Members"),
                ("/districts/:id/club-dues", "District Club Dues"),
                ("/districts/:id/ag", "District AG"),

                // Group 4: AG.
                ("/agdashboard", "AG Dashboard"),
                ("/agdashboard/clubs/:id", "AG Dashboard - Club"),

                // Group 5: Clubs.
                ("/clubs", "Clubs - List"),
                ("/clubs/new", "Clubs - New"),
                ("/clubs/:id/edit", "Clubs - Edit"),
                ("/clubs/:id/dashboard", "Club Dashboard"),
                ("/clubs/:id/overview", "Club Overview"),
                ("/clubs/:id/members", "Club Members"),
                ("/clubs/:id/announcements", "Club Announcements"),
                ("/clubs/:id/newsletters", "Club Newsletters"),
                ("/clubs/:id/documents", "Club Documents"),
                ("/clubs/:id/upcoming-events", "Club Upcoming Events"),
                ("/clubs/:id/attendance", "Club Attendance"),
                ("/clubs/:id/club-monthly-report", "Club Monthly Report"),
                ("/clubs/:id/projects", "Club Projects"),
                ("/clubs/:id/club-service", "Club Service"),
                ("/clubs/:id/vocational-service", "Club Vocational Service"),
                ("/clubs/:id/international-service", "Club International Service"),
                ("/clubs/:id/public-image-initiative", "Club Public Image Initiative"),
                ("/clubs/:id/new-generation-service", "Club New Generation Service"),
                ("/clubs/:id/board-of-directors", "Club Board of Directors"),
                ("/clubs/:id/past-presidents", "Club Past Presidents"),
                ("/clubs/:id/greetings", "Club Greetings"),
                ("/clubs/:id/sub-groups", "Club Sub-Groups"),
                ("/clubs/:id/mass-emails", "Club Mass Emails"),
                ("/clubs/:id/membership-dues", "Club Dues"),
                ("/clubs/:id/event-payment-links", "Club Event Payment Links"),
                ("/clubs/:id/trf", "Club TRF"),
                ("/clubs/:id/ocv-gov", "Club OCV-Gov"),
                ("/clubs/:id/ocv-gov/live-documents", "Club OCV-Gov - Live Documents"),
                ("/clubs/:id/pph-camps", "Club PPH Camps"),
                ("/clubs/:id/weblinks", "Club Weblinks"),
                ("/clubs/:id/website-data", "Club Website Data"),
                ("/clubs/:id/website-data/theme", "Club Website - Theme"),
                ("/clubs/:id/website-data/banners", "Club Website - Banners"),
                ("/clubs/:id/website-data/advertisements", "Club Website - Advertisements"),
                ("/clubs/:id/website-data/social-media-links", "Club Website - Social Links"),
                ("/clubs/:id/website-data/contact-details", "Club Website - Contact Details"),
                ("/clubs/:id/website-data/menu-list", "Club Website - Menu List"),
                ("/clubs/:id/website-data/about", "Club Website - About"),
                ("/clubs/:id/rotary-network", "Club Rotary Network"),
                ("/clubs/:id/rotary-network/potential-members", "Club Rotary Network - Potential Members"),
                ("/clubs/:id/rotary-network/terminated-members", "Club Rotary Network - Terminated Members"),
                ("/clubs/:id/citation", "Club Citation"),
                ("/clubs/:id/reports", "Club Reports"),

                // Group 6: Members.
                ("/members", "Members - List"),
                ("/members/new", "Members - New"),
                ("/members/:id/edit", "Members - Edit"),

                // Group 7: Admin.
                ("/admin/login-logs", "Admin - Login Logs"),
                ("/admin/role-management", "Admin - Role Management"),

                // Group 8: Zonal / Websites / RI Director.
                ("/zonal-dashboard", "Zonal Dashboard"),
                ("/club-moderator", "Club Moderator"),
                ("/my-club-websites", "My Club Websites"),
                ("/my-district-websites", "My District Websites"),
                ("/ag-reports", "AG Reports"),
                ("/ri-director", "RI Director"),
                ("/ri-director/announcements", "RI Director - Announcements"),
                ("/ri-director/announcements/add", "RI Director - Announcements Add"),
                ("/ri-director/announcements/:id", "RI Director - Announcement Detail"),
                ("/ri-director/announcements/:id/edit", "RI Director - Announcement Edit"),
                ("/ri-director/upcoming-events", "RI Director - Upcoming Events"),
                ("/ri-director/upcoming-events/add", "RI Director - Upcoming Events Add"),
                ("/ri-director/upcoming-events/:id", "RI Director - Upcoming Event Detail"),
                ("/ri-director/upcoming-events/:id/edit", "RI Director - Upcoming Event Edit"),
                ("/ri-director/mass-emails", "RI Director - Mass Emails"),
                ("/ri-director/mass-emails/compose", "RI Director - Mass Email Compose"),
                ("/ri-director/mass-emails/:id", "RI Director - Mass Email Detail"),
                ("/ri-director/mass-emails/:id/edit", "RI Director - Mass Email Edit"),
                ("/ri-director/weblinks", "RI Director - Weblinks"),
                ("/ri-director/weblinks/add", "RI Director - Weblinks Add"),
                ("/ri-director/weblinks/:id/edit", "RI Director - Weblink Edit"),
                ("/ri-director/sub-groups", "RI Director - Sub-Groups"),
                ("/ri-director/sub-groups/add", "RI Director - Sub-Groups Add"),
                ("/ri-director/sub-groups/:id", "RI Director - Sub-Group Detail"),
                ("/ri-director/sub-groups/:id/edit", "RI Director - Sub-Group Edit"),
                ("/ri-director/documents", "RI Director - Documents"),
                ("/ri-director/documents/add", "RI Director - Documents Add"),
                ("/ri-director/documents/:id/edit", "RI Director - Document Edit"),
                ("/ri-director/newsletters", "RI Director - Newsletters"),
                ("/ri-director/newsletters/add", "RI Director - Newsletters Add"),
                ("/ri-director/newsletters/:id", "RI Director - Newsletter Detail"),
                ("/ri-director/newsletters/:id/edit", "RI Director - Newsletter Edit"),
                ("/ri-director/reports", "RI Director - Reports"),

                // Group 9: Unified Dashboard.
                ("/unified/:districtId", "Unified Dashboard"),
                ("/unified/:districtId/module/:moduleKey", "Unified Dashboard - Module"),
                ("/module-detail/:moduleKey", "Module Detail"),

                // Group 10: Tools / Misc.
                ("/webview", "WebView"),
                ("/club-finder", "Club Finder"),
                ("/club-finder/:clubId", "Club Finder - Club Detail"),
                ("/find-rotarian", "Find Rotarian"),
                ("/find-rotarian/:memberId", "Find Rotarian - Member Detail"),
                ("/club-calendar", "Club Calendar"),
                ("/district-calendar", "District Calendar"),
                ("/my-dues", "My Dues"),

                // Group 11: Dashboard tab rows (per-tab maintenance).
                // Club /clubs/:id/overview tabs (9).
                ("/clubs/:id/overview#dashboard", "Club > Dashboard Tab"),
                ("/clubs/:id/overview#foundation", "Club > Foundation Tab"),
                ("/clubs/:id/overview#membership", "Club > Membership Tab"),
                ("/clubs/:id/overview#service-projects", "Club > Service Projects Tab"),
                ("/clubs/:id/overview#e-governance", "Club > E-Governance Tab"),
                ("/clubs/:id/overview#communication", "Club > Communication Tab"),
                ("/clubs/:id/overview#my-club-website", "Club > My Club Website Tab"),
                ("/clubs/:id/overview#membership-dues", "Club > Dues Tab"),
                ("/clubs/:id/overview#payment-links", "Club > Payment Links Tab"),

                // District /districts/:id/overview tabs (5).
                ("/districts/:id/overview#overview", "District > Overview Tab"),
                ("/districts/:id/overview#membership", "District > Membership Tab"),
                ("/districts/:id/overview#foundation", "District > Foundation Tab"),
                ("/districts/:id/overview#communication", "District > Communication Tab"),
                ("/districts/:id/overview#e-governance", "District > E-Governance Tab"),

                // AG /agdashboard tabs (7).
                ("/agdashboard#my-clubs", "AG > My Clubs Tab"),
                ("/agdashboard#membership", "AG > Membership Tab"),
                ("/agdashboard#foundation-trf", "AG > Foundation TRF Tab"),
                ("/agdashboard#goals", "AG > Goals Tab"),
                ("/agdashboard#youth-services", "AG > Youth Services Tab"),
                ("/agdashboard#service-projects", "AG > Service Projects Tab"),
                ("/agdashboard#district-view", "AG > District View Tab"),
            };

            const string insertSql = @"
                INSERT IGNORE INTO route_maintenance (RouteKey, Label)
                VALUES (@RouteKey, @Label)";

            foreach (var (routeKey, label) in seed)
            {
                await connection.ExecuteAsync(insertSql, new { RouteKey = routeKey, Label = label });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error seeding route_maintenance table.");
        }
    }

    private static async Task SeedRotaryYearsAsync(MySqlConnection connection)
    {
        // Determine current rotary year start: if today >= Jul 1, starts this calendar year; else last year
        var today = DateTime.Today;
        var currentRotaryStartYear = today.Month >= 7 ? today.Year : today.Year - 1;

        for (int startYear = 1980; startYear <= currentRotaryStartYear; startYear++)
        {
            var endYear = startYear + 1;
            var label = $"{startYear}-{(endYear % 100):D2}";
            var startDate = new DateTime(startYear, 7, 1);
            var endDate = new DateTime(endYear, 6, 30);
            var isCurrent = startYear == currentRotaryStartYear ? 1 : 0;

            await connection.ExecuteAsync(
                @"INSERT INTO rotary_year_master (YearLabel, StartDate, EndDate, IsCurrent)
                  VALUES (@Label, @Start, @End, @IsCurrent)",
                new { Label = label, Start = startDate, End = endDate, IsCurrent = isCurrent });
        }
    }

    private static async Task UpdateRotaryYearCurrentFlagAsync(MySqlConnection connection)
    {
        var today = DateTime.Today;
        var currentRotaryStartYear = today.Month >= 7 ? today.Year : today.Year - 1;
        var endYear = currentRotaryStartYear + 1;
        var label = $"{currentRotaryStartYear}-{(endYear % 100):D2}";
        var startDate = new DateTime(currentRotaryStartYear, 7, 1);
        var endDate = new DateTime(endYear, 6, 30);

        // Insert current year row if it doesn't exist yet (e.g. new July)
        await connection.ExecuteAsync(
            @"INSERT IGNORE INTO rotary_year_master (YearLabel, StartDate, EndDate, IsCurrent)
              VALUES (@Label, @Start, @End, 1)",
            new { Label = label, Start = startDate, End = endDate });

        // Reset all IsCurrent flags, then set the correct one
        await connection.ExecuteAsync("UPDATE rotary_year_master SET IsCurrent = 0 WHERE IsCurrent = 1");
        await connection.ExecuteAsync(
            "UPDATE rotary_year_master SET IsCurrent = 1 WHERE YearLabel = @Label",
            new { Label = label });
    }

    private static async Task SeedDesignationsAsync(MySqlConnection connection)
    {
        var designations = new[]
        {
            ("Club President", 1),
            ("Immediate Past President", 2),
            ("Vice President", 3),
            ("Club Secretary", 4),
            ("Joint Secretary", 5),
            ("Club Treasurer", 6),
            ("Sergeant at Arms", 7),
            ("Club Trainer", 8),
        };

        foreach (var (name, sort) in designations)
        {
            await connection.ExecuteAsync(
                "INSERT INTO designation_master (designation_name, sort_order) VALUES (@Name, @Sort)",
                new { Name = name, Sort = sort });
        }
    }

    private static async Task SeedWebsiteDataModulesAsync(MySqlConnection connection)
    {
        var modules = new[]
        {
            ("Banners", "banners", "Image", 1),
            ("Advertisements", "advertisements", "Megaphone", 2),
            ("Social Media Links", "social_media_links", "Share2", 3),
            ("Menu List", "menu_list", "List", 4),
            ("Theme", "theme", "Palette", 5),
            ("Contact Details", "contact_details", "Phone", 6),
            ("About", "about", "Info", 7),
            ("Logos", "logos", "ImagePlus", 8),
        };

        // INSERT IGNORE on the unique module_key so this is safe to re-run after
        // adding new modules later — existing rows stay untouched.
        foreach (var (name, key, icon, sort) in modules)
        {
            await connection.ExecuteAsync(@"
                INSERT INTO website_data_module_master (module_name, module_key, icon_class, sort_order)
                VALUES (@Name, @Key, @Icon, @Sort)
                ON DUPLICATE KEY UPDATE module_name = VALUES(module_name),
                                        icon_class  = VALUES(icon_class),
                                        sort_order  = VALUES(sort_order)",
                new { Name = name, Key = key, Icon = icon, Sort = sort });
        }
    }

    // Backfills the 6 avenue sub-menus under every existing club website's
    // "Projects" parent menu. Idempotent: only inserts rows whose name doesn't
    // already exist under that parent, so admins' custom sub-menus and any
    // earlier seed runs are preserved. Marks them is_system_managed=1 so the
    // delete/edit endpoints can reject changes.
    private static async Task BackfillProjectsSubMenusAsync(MySqlConnection connection)
    {
        var subMenus = RotaryApi.Controllers.ClubWebsitesController.ProjectsSubMenus;

        // Find every "Projects" parent menu across all clubs that have a club_website
        // record. link_value = 'projects' identifies the parent reliably regardless of
        // case/whitespace variations in menu_name across older seeds.
        var projectsMenus = await connection.QueryAsync<(int MenuId, int ClubId)>(@"
            SELECT m.pk_club_website_menu_id AS MenuId, m.fk_club_id AS ClubId
            FROM club_website_menu m
            JOIN club_websites w ON w.fk_club_id = m.fk_club_id AND w.isdeleted = 0
            WHERE LOWER(m.link_value) = 'projects'
              AND m.isdeleted = 0");

        foreach (var (menuId, _) in projectsMenus)
        {
            for (int i = 0; i < subMenus.Length; i++)
            {
                var (name, key) = subMenus[i];
                // Keyed on the stable avenue link_value (not name) and counting regardless of
                // isdeleted, so an admin's rename doesn't duplicate and a delete isn't resurrected.
                var existing = await connection.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM club_website_submenu
                    WHERE fk_menu_id = @MenuId AND link_value = @Key",
                    new { MenuId = menuId, Key = key });
                if (existing > 0) continue;

                await connection.ExecuteAsync(@"
                    INSERT INTO club_website_submenu
                        (fk_menu_id, submenu_name, link_type, link_value, sort_order,
                         is_active, is_system_managed, isdeleted)
                    VALUES (@MenuId, @Name, 'page', @Key, @Sort, 1, 1, 0)",
                    new { MenuId = menuId, Name = name, Key = key, Sort = i + 1 });
            }
        }
    }

    private async Task SeedDataAsync(MySqlConnection connection)
    {
        var insertMemberSql = @"INSERT INTO member_master_profile (
            MemberName, PrimaryMobileNumber, EmailId, BirthDate, AnniversaryDate,
            BloodGroup, Gender, PrimaryLanguage, MemberIntroduction, RotaryId, DonorRecognition
        ) VALUES (
            @MemberName, @PrimaryMobileNumber, @EmailId, @BirthDate, @AnniversaryDate,
            @BloodGroup, @Gender, @PrimaryLanguage, @MemberIntroduction, @RotaryId, @DonorRecognition
        ); SELECT LAST_INSERT_ID();";

        var members = GetSeedMembers();
        var memberIds = new Dictionary<int, int>();
        for (int i = 0; i < members.Count; i++)
        {
            var id = await connection.ExecuteScalarAsync<int>(insertMemberSql, members[i]);
            memberIds[i] = id;
        }

        // Insert addresses
        // NOTE: Designation + ClassificationProfession are NOT inserted here — they live on
        // club_members (Step 11B 2026-06-18, columns dropped from member_address_details
        // 2026-06-22). The seed tuples still carry those props for readability but they are
        // intentionally not bound; @Designation/@ClassificationProfession are absent from
        // the parameter list so Dapper just ignores the extra fields.
        var insertAddressSql = @"INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, PhoneNumber, Address, State, City, PinCode,
                                  BusinessName, BusinessEmailId, Keywords)
                                  VALUES (@fk_member_master_profile_id, @AddressType, @PhoneNumber, @Address, @State, @City, @PinCode,
                                  @BusinessName, @BusinessEmailId, @Keywords)";

        var addresses = GetSeedAddresses(memberIds);
        foreach (var addr in addresses)
        {
            await connection.ExecuteAsync(insertAddressSql, addr);
        }

        // Insert family members
        var insertFamilySql = @"INSERT INTO member_family_details (fk_member_master_profile_id, Name, Relation, BloodGroup, PhoneNumber, EmailId, BirthDate, AnniversaryDate)
                                VALUES (@fk_member_master_profile_id, @Name, @Relation, @BloodGroup, @PhoneNumber, @EmailId, @BirthDate, @AnniversaryDate)";

        var seedFamilies = GetSeedFamilyMembers(memberIds);
        foreach (var fm in seedFamilies)
        {
            await connection.ExecuteAsync(insertFamilySql, fm);
        }
    }

    private static List<object> GetSeedMembers() =>
    [
        new { MemberName = "Rajesh Kumar Sharma", PrimaryMobileNumber = "9876543210", EmailId = "rajesh.sharma@email.com", BirthDate = new DateTime(1975, 3, 15), AnniversaryDate = new DateTime(2002, 11, 20), BloodGroup = "A+", Gender = "Male", PrimaryLanguage = "Hindi", MemberIntroduction = "Chartered Accountant with 25 years of experience.", RotaryId = "ROT-MH-001", DonorRecognition = "Paul Harris Fellow" },
        new { MemberName = "Priya Mehta", PrimaryMobileNumber = "9876543211", EmailId = "priya.mehta@email.com", BirthDate = new DateTime(1982, 7, 22), AnniversaryDate = new DateTime(2008, 2, 14), BloodGroup = "B+", Gender = "Female", PrimaryLanguage = "Gujarati", MemberIntroduction = "Entrepreneur running organic food stores.", RotaryId = "ROT-GJ-002", DonorRecognition = "Major Donor" },
        new { MemberName = "Dr. Venkatesh Iyer", PrimaryMobileNumber = "9876543212", EmailId = "venkatesh.iyer@email.com", BirthDate = new DateTime(1968, 12, 5), AnniversaryDate = new DateTime(1998, 5, 10), BloodGroup = "O+", Gender = "Male", PrimaryLanguage = "Tamil", MemberIntroduction = "Cardiologist at Apollo Hospital.", RotaryId = "ROT-TN-003", DonorRecognition = "Paul Harris Fellow" },
        new { MemberName = "Sunita Devi Agarwal", PrimaryMobileNumber = "9876543213", EmailId = "sunita.agarwal@email.com", BirthDate = new DateTime(1979, 9, 30), AnniversaryDate = new DateTime(2004, 12, 1), BloodGroup = "AB+", Gender = "Female", PrimaryLanguage = "Hindi", MemberIntroduction = "Social worker dedicated to women empowerment.", RotaryId = "ROT-UP-004", DonorRecognition = (string?)null },
        new { MemberName = "Amit Singh Rathore", PrimaryMobileNumber = "9876543214", EmailId = "amit.rathore@email.com", BirthDate = new DateTime(1985, 1, 18), AnniversaryDate = (DateTime?)null, BloodGroup = "B-", Gender = "Male", PrimaryLanguage = "Hindi", MemberIntroduction = "Software architect building enterprise solutions.", RotaryId = "ROT-KA-005", DonorRecognition = (string?)null },
        new { MemberName = "Kavitha Nair", PrimaryMobileNumber = "9876543215", EmailId = "kavitha.nair@email.com", BirthDate = new DateTime(1990, 4, 12), AnniversaryDate = new DateTime(2018, 6, 15), BloodGroup = "A-", Gender = "Female", PrimaryLanguage = "Malayalam", MemberIntroduction = "Attorney specializing in environmental law.", RotaryId = "ROT-KL-006", DonorRecognition = (string?)null },
        new { MemberName = "Manish Gupta", PrimaryMobileNumber = "9876543216", EmailId = "manish.gupta@email.com", BirthDate = new DateTime(1972, 8, 25), AnniversaryDate = new DateTime(2000, 1, 15), BloodGroup = "O-", Gender = "Male", PrimaryLanguage = "Hindi", MemberIntroduction = "Real estate developer.", RotaryId = "ROT-DL-007", DonorRecognition = "Paul Harris Fellow" },
        new { MemberName = "Dr. Ananya Banerjee", PrimaryMobileNumber = "9876543217", EmailId = "ananya.banerjee@email.com", BirthDate = new DateTime(1988, 11, 8), AnniversaryDate = new DateTime(2015, 3, 22), BloodGroup = "A+", Gender = "Female", PrimaryLanguage = "Bengali", MemberIntroduction = "Pediatrician committed to child healthcare.", RotaryId = "ROT-WB-008", DonorRecognition = (string?)null },
        new { MemberName = "Sanjay Patil", PrimaryMobileNumber = "9876543218", EmailId = "sanjay.patil@email.com", BirthDate = new DateTime(1980, 6, 14), AnniversaryDate = new DateTime(2007, 9, 5), BloodGroup = "B+", Gender = "Male", PrimaryLanguage = "Marathi", MemberIntroduction = "Agribusiness entrepreneur.", RotaryId = "ROT-MH-009", DonorRecognition = "Major Donor" },
        new { MemberName = "Deepa Reddy", PrimaryMobileNumber = "9876543219", EmailId = "deepa.reddy@email.com", BirthDate = new DateTime(1983, 2, 28), AnniversaryDate = new DateTime(2010, 4, 18), BloodGroup = "AB-", Gender = "Female", PrimaryLanguage = "Telugu", MemberIntroduction = "Educationist running progressive schools.", RotaryId = "ROT-TS-010", DonorRecognition = (string?)null },
        new { MemberName = "Harpreet Singh Gill", PrimaryMobileNumber = "9876543220", EmailId = "harpreet.gill@email.com", BirthDate = new DateTime(1976, 10, 20), AnniversaryDate = new DateTime(2003, 7, 12), BloodGroup = "O+", Gender = "Male", PrimaryLanguage = "Punjabi", MemberIntroduction = "Industrialist in textile manufacturing.", RotaryId = "ROT-PB-011", DonorRecognition = "Paul Harris Fellow" },
        new { MemberName = "Meena Joshi", PrimaryMobileNumber = "9876543221", EmailId = "meena.joshi@email.com", BirthDate = new DateTime(1992, 5, 3), AnniversaryDate = (DateTime?)null, BloodGroup = "A+", Gender = "Female", PrimaryLanguage = "Hindi", MemberIntroduction = "Architect designing sustainable buildings.", RotaryId = "ROT-RJ-012", DonorRecognition = (string?)null },
        new { MemberName = "Suresh Menon", PrimaryMobileNumber = "9876543222", EmailId = "suresh.menon@email.com", BirthDate = new DateTime(1970, 4, 8), AnniversaryDate = new DateTime(1999, 8, 20), BloodGroup = "B+", Gender = "Male", PrimaryLanguage = "Malayalam", MemberIntroduction = "Hotelier with heritage hotels.", RotaryId = "ROT-KL-013", DonorRecognition = "Major Donor" },
        new { MemberName = "Neha Saxena", PrimaryMobileNumber = "9876543223", EmailId = "neha.saxena@email.com", BirthDate = new DateTime(1987, 12, 15), AnniversaryDate = new DateTime(2013, 11, 30), BloodGroup = "O+", Gender = "Female", PrimaryLanguage = "Hindi", MemberIntroduction = "Pharmaceutical professional.", RotaryId = "ROT-MP-014", DonorRecognition = (string?)null },
        new { MemberName = "Vikram Choudhary", PrimaryMobileNumber = "9876543224", EmailId = "vikram.choudhary@email.com", BirthDate = new DateTime(1974, 7, 2), AnniversaryDate = new DateTime(2001, 10, 25), BloodGroup = "AB+", Gender = "Male", PrimaryLanguage = "Hindi", MemberIntroduction = "Engineer specializing in infrastructure.", RotaryId = "ROT-GJ-015", DonorRecognition = "Paul Harris Fellow" },
        new { MemberName = "Ravi Shankar Dubey", PrimaryMobileNumber = "9876543225", EmailId = "ravi.dubey@email.com", BirthDate = new DateTime(1981, 3, 22), AnniversaryDate = new DateTime(2009, 6, 10), BloodGroup = "A+", Gender = "Male", PrimaryLanguage = "Hindi", MemberIntroduction = "Banking professional with 20 years experience.", RotaryId = "ROT-BR-016", DonorRecognition = (string?)null },
        new { MemberName = "Lakshmi Venkataraman", PrimaryMobileNumber = "9876543226", EmailId = "lakshmi.v@email.com", BirthDate = new DateTime(1977, 9, 14), AnniversaryDate = new DateTime(2005, 12, 8), BloodGroup = "O+", Gender = "Female", PrimaryLanguage = "Tamil", MemberIntroduction = "IT consultant and women in tech advocate.", RotaryId = "ROT-TN-017", DonorRecognition = "Paul Harris Fellow" },
        new { MemberName = "Farhan Ahmed Khan", PrimaryMobileNumber = "9876543227", EmailId = "farhan.khan@email.com", BirthDate = new DateTime(1984, 11, 5), AnniversaryDate = new DateTime(2012, 4, 20), BloodGroup = "B+", Gender = "Male", PrimaryLanguage = "Hindi", MemberIntroduction = "Export business in textiles and handicrafts.", RotaryId = "ROT-UP-018", DonorRecognition = (string?)null },
        new { MemberName = "Anjali Deshmukh", PrimaryMobileNumber = "9876543228", EmailId = "anjali.deshmukh@email.com", BirthDate = new DateTime(1989, 7, 30), AnniversaryDate = (DateTime?)null, BloodGroup = "AB+", Gender = "Female", PrimaryLanguage = "Marathi", MemberIntroduction = "Chartered accountant and financial advisor.", RotaryId = "ROT-MH-019", DonorRecognition = (string?)null },
        new { MemberName = "Gopal Krishna Rao", PrimaryMobileNumber = "9876543229", EmailId = "gopal.rao@email.com", BirthDate = new DateTime(1973, 1, 16), AnniversaryDate = new DateTime(2001, 3, 5), BloodGroup = "O-", Gender = "Male", PrimaryLanguage = "Kannada", MemberIntroduction = "Philanthropist and retired judge.", RotaryId = "ROT-KA-020", DonorRecognition = "Major Donor" }
    ];

    private static List<object> GetSeedAddresses(Dictionary<int, int> memberIds) =>
    [
        // Residential addresses
        new { fk_member_master_profile_id = memberIds[0], AddressType = "Residential", PhoneNumber = "9876543210", Address = "12, Shivaji Nagar", State = "Maharashtra", City = "Mumbai", PinCode = "400001", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[1], AddressType = "Residential", PhoneNumber = "9876543211", Address = "34, Navrangpura", State = "Gujarat", City = "Ahmedabad", PinCode = "380009", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[2], AddressType = "Residential", PhoneNumber = "9876543212", Address = "56, Adyar", State = "Tamil Nadu", City = "Chennai", PinCode = "600020", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[3], AddressType = "Residential", PhoneNumber = "9876543213", Address = "89, Civil Lines", State = "Uttar Pradesh", City = "Lucknow", PinCode = "226001", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[4], AddressType = "Residential", PhoneNumber = "9876543214", Address = "45, Koramangala", State = "Karnataka", City = "Bengaluru", PinCode = "560034", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[5], AddressType = "Residential", PhoneNumber = "9876543215", Address = "67, Panampilly Nagar", State = "Kerala", City = "Kochi", PinCode = "682036", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[6], AddressType = "Residential", PhoneNumber = "9876543216", Address = "12, Greater Kailash", State = "Delhi", City = "New Delhi", PinCode = "110048", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[7], AddressType = "Residential", PhoneNumber = "9876543217", Address = "90, Salt Lake City", State = "West Bengal", City = "Kolkata", PinCode = "700091", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[8], AddressType = "Residential", PhoneNumber = "9876543218", Address = "23, Deccan Gymkhana", State = "Maharashtra", City = "Pune", PinCode = "411004", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[9], AddressType = "Residential", PhoneNumber = "9876543219", Address = "45, Banjara Hills", State = "Telangana", City = "Hyderabad", PinCode = "500034", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[10], AddressType = "Residential", PhoneNumber = "9876543220", Address = "34, Model Town", State = "Punjab", City = "Ludhiana", PinCode = "141002", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[11], AddressType = "Residential", PhoneNumber = "9876543221", Address = "78, Malviya Nagar", State = "Rajasthan", City = "Jaipur", PinCode = "302017", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[12], AddressType = "Residential", PhoneNumber = "9876543222", Address = "56, Fort Kochi", State = "Kerala", City = "Kochi", PinCode = "682001", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[13], AddressType = "Residential", PhoneNumber = "9876543223", Address = "12, Arera Colony", State = "Madhya Pradesh", City = "Bhopal", PinCode = "462016", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        new { fk_member_master_profile_id = memberIds[14], AddressType = "Residential", PhoneNumber = "9876543224", Address = "67, Satellite Road", State = "Gujarat", City = "Ahmedabad", PinCode = "380015", BusinessName = (string?)null, BusinessEmailId = (string?)null, Designation = (string?)null, ClassificationProfession = (string?)null, Keywords = (string?)null },
        // Business addresses
        new { fk_member_master_profile_id = memberIds[0], AddressType = "Business", PhoneNumber = "2222345678", Address = "45, Nariman Point", State = "Maharashtra", City = "Mumbai", PinCode = "400021", BusinessName = "Sharma & Associates CA", BusinessEmailId = "rajesh@sharmaca.com", Designation = "Senior Partner", ClassificationProfession = "Chartered Accountant", Keywords = "CA, Finance, Taxation" },
        new { fk_member_master_profile_id = memberIds[1], AddressType = "Business", PhoneNumber = "7922345678", Address = "78, CG Road", State = "Gujarat", City = "Ahmedabad", PinCode = "380006", BusinessName = "Green Basket Organics", BusinessEmailId = "priya@greenbasket.in", Designation = "Founder & CEO", ClassificationProfession = "Retail Business", Keywords = "Organic, Health, Retail" },
        new { fk_member_master_profile_id = memberIds[2], AddressType = "Business", PhoneNumber = "4422345678", Address = "21, Greams Road", State = "Tamil Nadu", City = "Chennai", PinCode = "600006", BusinessName = "Apollo Hospitals", BusinessEmailId = "venkatesh@apollohospitals.com", Designation = "Head of Cardiology", ClassificationProfession = "Medical - Cardiology", Keywords = "Doctor, Cardiology, Healthcare" },
        new { fk_member_master_profile_id = memberIds[3], AddressType = "Business", PhoneNumber = "5222345678", Address = "23, Hazratganj", State = "Uttar Pradesh", City = "Lucknow", PinCode = "226001", BusinessName = "Shakti Foundation", BusinessEmailId = "sunita@shaktifoundation.org", Designation = "Director", ClassificationProfession = "NGO - Social Work", Keywords = "NGO, Women Empowerment, Education" },
        new { fk_member_master_profile_id = memberIds[4], AddressType = "Business", PhoneNumber = "8022345678", Address = "12, Electronic City", State = "Karnataka", City = "Bengaluru", PinCode = "560100", BusinessName = "TechSolutions India Pvt Ltd", BusinessEmailId = "amit@techsolutions.in", Designation = "CTO", ClassificationProfession = "Information Technology", Keywords = "IT, Software, Architecture" },
        new { fk_member_master_profile_id = memberIds[5], AddressType = "Business", PhoneNumber = "4842345678", Address = "34, MG Road", State = "Kerala", City = "Kochi", PinCode = "682011", BusinessName = "Nair & Partners Law Firm", BusinessEmailId = "kavitha@nairlaw.in", Designation = "Partner", ClassificationProfession = "Legal - Environmental Law", Keywords = "Law, Environment, Sustainability" },
        new { fk_member_master_profile_id = memberIds[6], AddressType = "Business", PhoneNumber = "1122345678", Address = "56, Connaught Place", State = "Delhi", City = "New Delhi", PinCode = "110001", BusinessName = "Gupta Builders & Developers", BusinessEmailId = "manish@guptabuilders.com", Designation = "Managing Director", ClassificationProfession = "Real Estate", Keywords = "Construction, Real Estate, Housing" },
        new { fk_member_master_profile_id = memberIds[7], AddressType = "Business", PhoneNumber = "3322345678", Address = "45, EM Bypass", State = "West Bengal", City = "Kolkata", PinCode = "700107", BusinessName = "AMRI Hospital", BusinessEmailId = "ananya@amrihospital.in", Designation = "Senior Pediatrician", ClassificationProfession = "Medical - Pediatrics", Keywords = "Doctor, Pediatrics, Child Health" },
        new { fk_member_master_profile_id = memberIds[8], AddressType = "Business", PhoneNumber = "2022345678", Address = "78, Hinjewadi", State = "Maharashtra", City = "Pune", PinCode = "411057", BusinessName = "Patil AgriFarms", BusinessEmailId = "sanjay@patilagri.com", Designation = "Chairman", ClassificationProfession = "Agriculture", Keywords = "Farming, Organic, Agribusiness" },
        new { fk_member_master_profile_id = memberIds[9], AddressType = "Business", PhoneNumber = "4022345678", Address = "12, HITEC City", State = "Telangana", City = "Hyderabad", PinCode = "500081", BusinessName = "Vidya International Schools", BusinessEmailId = "deepa@vidyaschools.edu.in", Designation = "Founder Principal", ClassificationProfession = "Education", Keywords = "Schools, Education, Teaching" },
        new { fk_member_master_profile_id = memberIds[10], AddressType = "Business", PhoneNumber = "1612345678", Address = "56, Industrial Area", State = "Punjab", City = "Ludhiana", PinCode = "141003", BusinessName = "Gill Textiles Ltd", BusinessEmailId = "harpreet@gilltextiles.com", Designation = "Director", ClassificationProfession = "Textile Manufacturing", Keywords = "Textiles, Manufacturing, Export" },
        new { fk_member_master_profile_id = memberIds[11], AddressType = "Business", PhoneNumber = "1412345678", Address = "23, MI Road", State = "Rajasthan", City = "Jaipur", PinCode = "302001", BusinessName = "Joshi Design Studio", BusinessEmailId = "meena@joshidesign.in", Designation = "Principal Architect", ClassificationProfession = "Architecture", Keywords = "Architecture, Design, Green Building" },
        new { fk_member_master_profile_id = memberIds[12], AddressType = "Business", PhoneNumber = "4842345679", Address = "89, Marine Drive", State = "Kerala", City = "Kochi", PinCode = "682031", BusinessName = "Menon Heritage Hotels", BusinessEmailId = "suresh@menonhotels.com", Designation = "Founder & MD", ClassificationProfession = "Hospitality", Keywords = "Hotels, Tourism, Heritage" },
        new { fk_member_master_profile_id = memberIds[13], AddressType = "Business", PhoneNumber = "7552345678", Address = "45, BHEL Area", State = "Madhya Pradesh", City = "Bhopal", PinCode = "462024", BusinessName = "PharmaCure Research Labs", BusinessEmailId = "neha@pharmacure.in", Designation = "Research Director", ClassificationProfession = "Pharmaceutical", Keywords = "Pharma, Research, Healthcare" },
        new { fk_member_master_profile_id = memberIds[14], AddressType = "Business", PhoneNumber = "7922345679", Address = "90, SG Highway", State = "Gujarat", City = "Ahmedabad", PinCode = "380054", BusinessName = "Choudhary Infrastructure Pvt Ltd", BusinessEmailId = "vikram@choudharyinfra.com", Designation = "CEO", ClassificationProfession = "Civil Engineering", Keywords = "Infrastructure, Engineering, Construction" }
    ];

    private static List<object> GetSeedFamilyMembers(Dictionary<int, int> memberIds) =>
    [
        new { fk_member_master_profile_id = memberIds[0], Name = "Anita Sharma", Relation = "Spouse", BloodGroup = "B+", PhoneNumber = "9876543230", EmailId = "anita.sharma@email.com", BirthDate = new DateTime(1978, 6, 20), AnniversaryDate = new DateTime(2002, 11, 20) },
        new { fk_member_master_profile_id = memberIds[0], Name = "Rohan Sharma", Relation = "Son", BloodGroup = "A+", PhoneNumber = "9876543231", EmailId = (string?)null, BirthDate = new DateTime(2005, 3, 10), AnniversaryDate = (DateTime?)null },
        new { fk_member_master_profile_id = memberIds[1], Name = "Nikhil Mehta", Relation = "Spouse", BloodGroup = "A+", PhoneNumber = "9876543232", EmailId = "nikhil.mehta@email.com", BirthDate = new DateTime(1980, 5, 18), AnniversaryDate = new DateTime(2008, 2, 14) },
        new { fk_member_master_profile_id = memberIds[2], Name = "Lakshmi Iyer", Relation = "Spouse", BloodGroup = "A-", PhoneNumber = "9876543233", EmailId = "lakshmi.iyer@email.com", BirthDate = new DateTime(1972, 3, 14), AnniversaryDate = new DateTime(1998, 5, 10) },
        new { fk_member_master_profile_id = memberIds[4], Name = "Pooja Rathore", Relation = "Spouse", BloodGroup = "A+", PhoneNumber = "9876543235", EmailId = "pooja.rathore@email.com", BirthDate = new DateTime(1987, 8, 5), AnniversaryDate = (DateTime?)null },
        new { fk_member_master_profile_id = memberIds[6], Name = "Rekha Gupta", Relation = "Spouse", BloodGroup = "B+", PhoneNumber = "9876543236", EmailId = "rekha.gupta@email.com", BirthDate = new DateTime(1975, 4, 30), AnniversaryDate = new DateTime(2000, 1, 15) },
        new { fk_member_master_profile_id = memberIds[6], Name = "Arjun Gupta", Relation = "Son", BloodGroup = "O-", PhoneNumber = "9876543237", EmailId = (string?)null, BirthDate = new DateTime(2002, 12, 8), AnniversaryDate = (DateTime?)null },
        new { fk_member_master_profile_id = memberIds[8], Name = "Asha Patil", Relation = "Spouse", BloodGroup = "A+", PhoneNumber = "9876543238", EmailId = "asha.patil@email.com", BirthDate = new DateTime(1982, 1, 25), AnniversaryDate = new DateTime(2007, 9, 5) },
        new { fk_member_master_profile_id = memberIds[10], Name = "Gurpreet Kaur", Relation = "Spouse", BloodGroup = "B+", PhoneNumber = "9876543239", EmailId = "gurpreet.gill@email.com", BirthDate = new DateTime(1979, 9, 12), AnniversaryDate = new DateTime(2003, 7, 12) },
        new { fk_member_master_profile_id = memberIds[12], Name = "Kavita Menon", Relation = "Spouse", BloodGroup = "A+", PhoneNumber = "9876543241", EmailId = "kavita.menon@email.com", BirthDate = new DateTime(1974, 6, 15), AnniversaryDate = new DateTime(1999, 8, 20) },
        new { fk_member_master_profile_id = memberIds[14], Name = "Nisha Choudhary", Relation = "Spouse", BloodGroup = "A-", PhoneNumber = "9876543243", EmailId = "nisha.choudhary@email.com", BirthDate = new DateTime(1977, 11, 8), AnniversaryDate = new DateTime(2001, 10, 25) }
    ];

    private static async Task SeedCountriesAsync(MySqlConnection connection)
    {
        // 196 countries: India first, then 195 sovereign nations alphabetically
        // Insert in batches to avoid max_allowed_packet issues
        var batch1 = @"INSERT INTO country_master (CountryName, CountryCode, GmtOpt, GmtTime, Ordering) VALUES
            ('India', 'IN', '+', '05:30', 1),
            ('Afghanistan', 'AF', '+', '04:30', 2),
            ('Albania', 'AL', '+', '01:00', 3),
            ('Algeria', 'DZ', '+', '01:00', 4),
            ('Andorra', 'AD', '+', '01:00', 5),
            ('Angola', 'AO', '+', '01:00', 6),
            ('Antigua and Barbuda', 'AG', '-', '04:00', 7),
            ('Argentina', 'AR', '-', '03:00', 8),
            ('Armenia', 'AM', '+', '04:00', 9),
            ('Australia', 'AU', '+', '10:00', 10),
            ('Austria', 'AT', '+', '01:00', 11),
            ('Azerbaijan', 'AZ', '+', '04:00', 12),
            ('Bahamas', 'BS', '-', '05:00', 13),
            ('Bahrain', 'BH', '+', '03:00', 14),
            ('Bangladesh', 'BD', '+', '06:00', 15),
            ('Barbados', 'BB', '-', '04:00', 16),
            ('Belarus', 'BY', '+', '03:00', 17),
            ('Belgium', 'BE', '+', '01:00', 18),
            ('Belize', 'BZ', '-', '06:00', 19),
            ('Benin', 'BJ', '+', '01:00', 20),
            ('Bhutan', 'BT', '+', '06:00', 21),
            ('Bolivia', 'BO', '-', '04:00', 22),
            ('Bosnia and Herzegovina', 'BA', '+', '01:00', 23),
            ('Botswana', 'BW', '+', '02:00', 24),
            ('Brazil', 'BR', '-', '03:00', 25),
            ('Brunei', 'BN', '+', '08:00', 26),
            ('Bulgaria', 'BG', '+', '02:00', 27),
            ('Burkina Faso', 'BF', '+', '00:00', 28),
            ('Burundi', 'BI', '+', '02:00', 29),
            ('Cabo Verde', 'CV', '-', '01:00', 30),
            ('Cambodia', 'KH', '+', '07:00', 31),
            ('Cameroon', 'CM', '+', '01:00', 32),
            ('Canada', 'CA', '-', '05:00', 33),
            ('Central African Republic', 'CF', '+', '01:00', 34),
            ('Chad', 'TD', '+', '01:00', 35),
            ('Chile', 'CL', '-', '04:00', 36),
            ('China', 'CN', '+', '08:00', 37),
            ('Colombia', 'CO', '-', '05:00', 38),
            ('Comoros', 'KM', '+', '03:00', 39),
            ('Congo (DRC)', 'CD', '+', '01:00', 40),
            ('Congo (Republic)', 'CG', '+', '01:00', 41),
            ('Costa Rica', 'CR', '-', '06:00', 42),
            ('Croatia', 'HR', '+', '01:00', 43),
            ('Cuba', 'CU', '-', '05:00', 44),
            ('Cyprus', 'CY', '+', '02:00', 45),
            ('Czech Republic', 'CZ', '+', '01:00', 46),
            ('Denmark', 'DK', '+', '01:00', 47),
            ('Djibouti', 'DJ', '+', '03:00', 48),
            ('Dominica', 'DM', '-', '04:00', 49),
            ('Dominican Republic', 'DO', '-', '04:00', 50)";

        var batch2 = @"INSERT INTO country_master (CountryName, CountryCode, GmtOpt, GmtTime, Ordering) VALUES
            ('Ecuador', 'EC', '-', '05:00', 51),
            ('Egypt', 'EG', '+', '02:00', 52),
            ('El Salvador', 'SV', '-', '06:00', 53),
            ('Equatorial Guinea', 'GQ', '+', '01:00', 54),
            ('Eritrea', 'ER', '+', '03:00', 55),
            ('Estonia', 'EE', '+', '02:00', 56),
            ('Eswatini', 'SZ', '+', '02:00', 57),
            ('Ethiopia', 'ET', '+', '03:00', 58),
            ('Fiji', 'FJ', '+', '12:00', 59),
            ('Finland', 'FI', '+', '02:00', 60),
            ('France', 'FR', '+', '01:00', 61),
            ('Gabon', 'GA', '+', '01:00', 62),
            ('Gambia', 'GM', '+', '00:00', 63),
            ('Georgia', 'GE', '+', '04:00', 64),
            ('Germany', 'DE', '+', '01:00', 65),
            ('Ghana', 'GH', '+', '00:00', 66),
            ('Greece', 'GR', '+', '02:00', 67),
            ('Grenada', 'GD', '-', '04:00', 68),
            ('Guatemala', 'GT', '-', '06:00', 69),
            ('Guinea', 'GN', '+', '00:00', 70),
            ('Guinea-Bissau', 'GW', '+', '00:00', 71),
            ('Guyana', 'GY', '-', '04:00', 72),
            ('Haiti', 'HT', '-', '05:00', 73),
            ('Honduras', 'HN', '-', '06:00', 74),
            ('Hungary', 'HU', '+', '01:00', 75),
            ('Iceland', 'IS', '+', '00:00', 76),
            ('Indonesia', 'ID', '+', '07:00', 77),
            ('Iran', 'IR', '+', '03:30', 78),
            ('Iraq', 'IQ', '+', '03:00', 79),
            ('Ireland', 'IE', '+', '00:00', 80),
            ('Israel', 'IL', '+', '02:00', 81),
            ('Italy', 'IT', '+', '01:00', 82),
            ('Ivory Coast', 'CI', '+', '00:00', 83),
            ('Jamaica', 'JM', '-', '05:00', 84),
            ('Japan', 'JP', '+', '09:00', 85),
            ('Jordan', 'JO', '+', '02:00', 86),
            ('Kazakhstan', 'KZ', '+', '06:00', 87),
            ('Kenya', 'KE', '+', '03:00', 88),
            ('Kiribati', 'KI', '+', '12:00', 89),
            ('Kuwait', 'KW', '+', '03:00', 90),
            ('Kyrgyzstan', 'KG', '+', '06:00', 91),
            ('Laos', 'LA', '+', '07:00', 92),
            ('Latvia', 'LV', '+', '02:00', 93),
            ('Lebanon', 'LB', '+', '02:00', 94),
            ('Lesotho', 'LS', '+', '02:00', 95),
            ('Liberia', 'LR', '+', '00:00', 96),
            ('Libya', 'LY', '+', '02:00', 97),
            ('Liechtenstein', 'LI', '+', '01:00', 98),
            ('Lithuania', 'LT', '+', '02:00', 99),
            ('Luxembourg', 'LU', '+', '01:00', 100)";

        var batch3 = @"INSERT INTO country_master (CountryName, CountryCode, GmtOpt, GmtTime, Ordering) VALUES
            ('Madagascar', 'MG', '+', '03:00', 101),
            ('Malawi', 'MW', '+', '02:00', 102),
            ('Malaysia', 'MY', '+', '08:00', 103),
            ('Maldives', 'MV', '+', '05:00', 104),
            ('Mali', 'ML', '+', '00:00', 105),
            ('Malta', 'MT', '+', '01:00', 106),
            ('Marshall Islands', 'MH', '+', '12:00', 107),
            ('Mauritania', 'MR', '+', '00:00', 108),
            ('Mauritius', 'MU', '+', '04:00', 109),
            ('Mexico', 'MX', '-', '06:00', 110),
            ('Micronesia', 'FM', '+', '10:00', 111),
            ('Moldova', 'MD', '+', '02:00', 112),
            ('Monaco', 'MC', '+', '01:00', 113),
            ('Mongolia', 'MN', '+', '08:00', 114),
            ('Montenegro', 'ME', '+', '01:00', 115),
            ('Morocco', 'MA', '+', '01:00', 116),
            ('Mozambique', 'MZ', '+', '02:00', 117),
            ('Myanmar', 'MM', '+', '06:30', 118),
            ('Namibia', 'NA', '+', '02:00', 119),
            ('Nauru', 'NR', '+', '12:00', 120),
            ('Nepal', 'NP', '+', '05:45', 121),
            ('Netherlands', 'NL', '+', '01:00', 122),
            ('New Zealand', 'NZ', '+', '12:00', 123),
            ('Nicaragua', 'NI', '-', '06:00', 124),
            ('Niger', 'NE', '+', '01:00', 125),
            ('Nigeria', 'NG', '+', '01:00', 126),
            ('North Korea', 'KP', '+', '09:00', 127),
            ('North Macedonia', 'MK', '+', '01:00', 128),
            ('Norway', 'NO', '+', '01:00', 129),
            ('Oman', 'OM', '+', '04:00', 130),
            ('Pakistan', 'PK', '+', '05:00', 131),
            ('Palau', 'PW', '+', '09:00', 132),
            ('Palestine', 'PS', '+', '02:00', 133),
            ('Panama', 'PA', '-', '05:00', 134),
            ('Papua New Guinea', 'PG', '+', '10:00', 135),
            ('Paraguay', 'PY', '-', '04:00', 136),
            ('Peru', 'PE', '-', '05:00', 137),
            ('Philippines', 'PH', '+', '08:00', 138),
            ('Poland', 'PL', '+', '01:00', 139),
            ('Portugal', 'PT', '+', '00:00', 140),
            ('Qatar', 'QA', '+', '03:00', 141),
            ('Romania', 'RO', '+', '02:00', 142),
            ('Russia', 'RU', '+', '03:00', 143),
            ('Rwanda', 'RW', '+', '02:00', 144),
            ('Saint Kitts and Nevis', 'KN', '-', '04:00', 145),
            ('Saint Lucia', 'LC', '-', '04:00', 146),
            ('Saint Vincent and the Grenadines', 'VC', '-', '04:00', 147),
            ('Samoa', 'WS', '+', '13:00', 148),
            ('San Marino', 'SM', '+', '01:00', 149),
            ('Sao Tome and Principe', 'ST', '+', '00:00', 150)";

        var batch4 = @"INSERT INTO country_master (CountryName, CountryCode, GmtOpt, GmtTime, Ordering) VALUES
            ('Saudi Arabia', 'SA', '+', '03:00', 151),
            ('Senegal', 'SN', '+', '00:00', 152),
            ('Serbia', 'RS', '+', '01:00', 153),
            ('Seychelles', 'SC', '+', '04:00', 154),
            ('Sierra Leone', 'SL', '+', '00:00', 155),
            ('Singapore', 'SG', '+', '08:00', 156),
            ('Slovakia', 'SK', '+', '01:00', 157),
            ('Slovenia', 'SI', '+', '01:00', 158),
            ('Solomon Islands', 'SB', '+', '11:00', 159),
            ('Somalia', 'SO', '+', '03:00', 160),
            ('South Africa', 'ZA', '+', '02:00', 161),
            ('South Korea', 'KR', '+', '09:00', 162),
            ('South Sudan', 'SS', '+', '02:00', 163),
            ('Spain', 'ES', '+', '01:00', 164),
            ('Sri Lanka', 'LK', '+', '05:30', 165),
            ('Sudan', 'SD', '+', '02:00', 166),
            ('Suriname', 'SR', '-', '03:00', 167),
            ('Sweden', 'SE', '+', '01:00', 168),
            ('Switzerland', 'CH', '+', '01:00', 169),
            ('Syria', 'SY', '+', '02:00', 170),
            ('Taiwan', 'TW', '+', '08:00', 171),
            ('Tajikistan', 'TJ', '+', '05:00', 172),
            ('Tanzania', 'TZ', '+', '03:00', 173),
            ('Thailand', 'TH', '+', '07:00', 174),
            ('Timor-Leste', 'TL', '+', '09:00', 175),
            ('Togo', 'TG', '+', '00:00', 176),
            ('Tonga', 'TO', '+', '13:00', 177),
            ('Trinidad and Tobago', 'TT', '-', '04:00', 178),
            ('Tunisia', 'TN', '+', '01:00', 179),
            ('Turkey', 'TR', '+', '03:00', 180),
            ('Turkmenistan', 'TM', '+', '05:00', 181),
            ('Tuvalu', 'TV', '+', '12:00', 182),
            ('Uganda', 'UG', '+', '03:00', 183),
            ('Ukraine', 'UA', '+', '02:00', 184),
            ('United Arab Emirates', 'AE', '+', '04:00', 185),
            ('United Kingdom', 'GB', '+', '00:00', 186),
            ('United States', 'US', '-', '05:00', 187),
            ('Uruguay', 'UY', '-', '03:00', 188),
            ('Uzbekistan', 'UZ', '+', '05:00', 189),
            ('Vanuatu', 'VU', '+', '11:00', 190),
            ('Vatican City', 'VA', '+', '01:00', 191),
            ('Venezuela', 'VE', '-', '04:00', 192),
            ('Vietnam', 'VN', '+', '07:00', 193),
            ('Yemen', 'YE', '+', '03:00', 194),
            ('Zambia', 'ZM', '+', '02:00', 195),
            ('Zimbabwe', 'ZW', '+', '02:00', 196)";

        await connection.ExecuteAsync(batch1);
        await connection.ExecuteAsync(batch2);
        await connection.ExecuteAsync(batch3);
        await connection.ExecuteAsync(batch4);
    }

    private static async Task UpdateCountryPhoneCodesAsync(MySqlConnection connection)
    {
        // Check if phone codes are already populated
        var emptyPhoneCodes = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM country_master WHERE PhoneCode = '' OR PhoneCode IS NULL");
        if (emptyPhoneCodes == 0) return;

        var phoneCodeUpdates = new Dictionary<string, string>
        {
            {"India", "+91"}, {"Afghanistan", "+93"}, {"Albania", "+355"}, {"Algeria", "+213"},
            {"Andorra", "+376"}, {"Angola", "+244"}, {"Antigua and Barbuda", "+1-268"}, {"Argentina", "+54"},
            {"Armenia", "+374"}, {"Australia", "+61"}, {"Austria", "+43"}, {"Azerbaijan", "+994"},
            {"Bahamas", "+1-242"}, {"Bahrain", "+973"}, {"Bangladesh", "+880"}, {"Barbados", "+1-246"},
            {"Belarus", "+375"}, {"Belgium", "+32"}, {"Belize", "+501"}, {"Benin", "+229"},
            {"Bhutan", "+975"}, {"Bolivia", "+591"}, {"Bosnia and Herzegovina", "+387"}, {"Botswana", "+267"},
            {"Brazil", "+55"}, {"Brunei", "+673"}, {"Bulgaria", "+359"}, {"Burkina Faso", "+226"},
            {"Burundi", "+257"}, {"Cabo Verde", "+238"}, {"Cambodia", "+855"}, {"Cameroon", "+237"},
            {"Canada", "+1"}, {"Central African Republic", "+236"}, {"Chad", "+235"}, {"Chile", "+56"},
            {"China", "+86"}, {"Colombia", "+57"}, {"Comoros", "+269"}, {"Congo (DRC)", "+243"},
            {"Congo (Republic)", "+242"}, {"Costa Rica", "+506"}, {"Croatia", "+385"}, {"Cuba", "+53"},
            {"Cyprus", "+357"}, {"Czech Republic", "+420"}, {"Denmark", "+45"}, {"Djibouti", "+253"},
            {"Dominica", "+1-767"}, {"Dominican Republic", "+1-809"}, {"Ecuador", "+593"}, {"Egypt", "+20"},
            {"El Salvador", "+503"}, {"Equatorial Guinea", "+240"}, {"Eritrea", "+291"}, {"Estonia", "+372"},
            {"Eswatini", "+268"}, {"Ethiopia", "+251"}, {"Fiji", "+679"}, {"Finland", "+358"},
            {"France", "+33"}, {"Gabon", "+241"}, {"Gambia", "+220"}, {"Georgia", "+995"},
            {"Germany", "+49"}, {"Ghana", "+233"}, {"Greece", "+30"}, {"Grenada", "+1-473"},
            {"Guatemala", "+502"}, {"Guinea", "+224"}, {"Guinea-Bissau", "+245"}, {"Guyana", "+592"},
            {"Haiti", "+509"}, {"Honduras", "+504"}, {"Hungary", "+36"}, {"Iceland", "+354"},
            {"Indonesia", "+62"}, {"Iran", "+98"}, {"Iraq", "+964"}, {"Ireland", "+353"},
            {"Israel", "+972"}, {"Italy", "+39"}, {"Ivory Coast", "+225"}, {"Jamaica", "+1-876"},
            {"Japan", "+81"}, {"Jordan", "+962"}, {"Kazakhstan", "+7"}, {"Kenya", "+254"},
            {"Kiribati", "+686"}, {"Kuwait", "+965"}, {"Kyrgyzstan", "+996"}, {"Laos", "+856"},
            {"Latvia", "+371"}, {"Lebanon", "+961"}, {"Lesotho", "+266"}, {"Liberia", "+231"},
            {"Libya", "+218"}, {"Liechtenstein", "+423"}, {"Lithuania", "+370"}, {"Luxembourg", "+352"},
            {"Madagascar", "+261"}, {"Malawi", "+265"}, {"Malaysia", "+60"}, {"Maldives", "+960"},
            {"Mali", "+223"}, {"Malta", "+356"}, {"Marshall Islands", "+692"}, {"Mauritania", "+222"},
            {"Mauritius", "+230"}, {"Mexico", "+52"}, {"Micronesia", "+691"}, {"Moldova", "+373"},
            {"Monaco", "+377"}, {"Mongolia", "+976"}, {"Montenegro", "+382"}, {"Morocco", "+212"},
            {"Mozambique", "+258"}, {"Myanmar", "+95"}, {"Namibia", "+264"}, {"Nauru", "+674"},
            {"Nepal", "+977"}, {"Netherlands", "+31"}, {"New Zealand", "+64"}, {"Nicaragua", "+505"},
            {"Niger", "+227"}, {"Nigeria", "+234"}, {"North Korea", "+850"}, {"North Macedonia", "+389"},
            {"Norway", "+47"}, {"Oman", "+968"}, {"Pakistan", "+92"}, {"Palau", "+680"},
            {"Palestine", "+970"}, {"Panama", "+507"}, {"Papua New Guinea", "+675"}, {"Paraguay", "+595"},
            {"Peru", "+51"}, {"Philippines", "+63"}, {"Poland", "+48"}, {"Portugal", "+351"},
            {"Qatar", "+974"}, {"Romania", "+40"}, {"Russia", "+7"}, {"Rwanda", "+250"},
            {"Saint Kitts and Nevis", "+1-869"}, {"Saint Lucia", "+1-758"},
            {"Saint Vincent and the Grenadines", "+1-784"}, {"Samoa", "+685"}, {"San Marino", "+378"},
            {"Sao Tome and Principe", "+239"}, {"Saudi Arabia", "+966"}, {"Senegal", "+221"},
            {"Serbia", "+381"}, {"Seychelles", "+248"}, {"Sierra Leone", "+232"}, {"Singapore", "+65"},
            {"Slovakia", "+421"}, {"Slovenia", "+386"}, {"Solomon Islands", "+677"}, {"Somalia", "+252"},
            {"South Africa", "+27"}, {"South Korea", "+82"}, {"South Sudan", "+211"}, {"Spain", "+34"},
            {"Sri Lanka", "+94"}, {"Sudan", "+249"}, {"Suriname", "+597"}, {"Sweden", "+46"},
            {"Switzerland", "+41"}, {"Syria", "+963"}, {"Taiwan", "+886"}, {"Tajikistan", "+992"},
            {"Tanzania", "+255"}, {"Thailand", "+66"}, {"Timor-Leste", "+670"}, {"Togo", "+228"},
            {"Tonga", "+676"}, {"Trinidad and Tobago", "+1-868"}, {"Tunisia", "+216"}, {"Turkey", "+90"},
            {"Turkmenistan", "+993"}, {"Tuvalu", "+688"}, {"Uganda", "+256"}, {"Ukraine", "+380"},
            {"United Arab Emirates", "+971"}, {"United Kingdom", "+44"}, {"United States", "+1"},
            {"Uruguay", "+598"}, {"Uzbekistan", "+998"}, {"Vanuatu", "+678"}, {"Vatican City", "+379"},
            {"Venezuela", "+58"}, {"Vietnam", "+84"}, {"Yemen", "+967"}, {"Zambia", "+260"},
            {"Zimbabwe", "+263"}
        };

        foreach (var (countryName, phoneCode) in phoneCodeUpdates)
        {
            await connection.ExecuteAsync(
                "UPDATE country_master SET PhoneCode = @PhoneCode WHERE CountryName = @CountryName AND (PhoneCode = '' OR PhoneCode IS NULL)",
                new { PhoneCode = phoneCode, CountryName = countryName });
        }
    }

    private static async Task SeedRolesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            INSERT INTO roles (pk_role_id, RoleName, Description) VALUES
            (1, 'Member', 'Regular member with basic access'),
            (2, 'Admin', 'Administrator with management access'),
            (3, 'SuperAdmin', 'Super administrator with full system access'),
            (4, 'ZonalCoordinator', 'Zonal coordinator with zone-level access'),
            (5, 'ClubModerator', 'Club moderator with club-level access'),
            (6, 'AG', 'Assistant Governor with club-level access')");
    }

    private async Task SeedSuperAdminAsync(MySqlConnection connection)
    {
        // Ensure the configured bootstrap SuperAdmin (Brand:SuperAdminEmail) has the role and credentials.
        var realSuperAdminId = string.IsNullOrWhiteSpace(Brand.SuperAdminEmail) ? null : await connection.ExecuteScalarAsync<int?>(
            "SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId = @Email AND isdeleted = 0",
            new { Email = Brand.SuperAdminEmail });

        if (realSuperAdminId != null && realSuperAdminId > 0)
        {
            await EnsureRolesAndCredentials(connection, realSuperAdminId.Value, superAdmin: true);
            _logger.LogInformation("SuperAdmin ensured for the configured bootstrap member (ID: {Id}).", realSuperAdminId.Value);
        }

        // Demote the seeded +91-9999999999 account to Member-only (remove SuperAdmin/Admin roles)
        var seededAdminId = await connection.ExecuteScalarAsync<int?>(
            "SELECT pk_member_master_profile_id FROM member_master_profile WHERE PrimaryMobileNumber = '9999999999' AND isdeleted = 0");

        if (seededAdminId != null && seededAdminId > 0)
        {
            // Deactivate SuperAdmin role (id=3) if exists
            await connection.ExecuteAsync(
                "UPDATE member_roles SET IsActive = 0, RevokedDate = NOW() WHERE fk_member_master_profile_id = @Id AND fk_role_id = 3 AND IsActive = 1",
                new { Id = seededAdminId.Value });
            // Deactivate Admin role (id=2) if exists
            await connection.ExecuteAsync(
                "UPDATE member_roles SET IsActive = 0, RevokedDate = NOW() WHERE fk_member_master_profile_id = @Id AND fk_role_id = 2 AND IsActive = 1",
                new { Id = seededAdminId.Value });
            // Deactivate credentials (no longer needs login)
            await connection.ExecuteAsync(
                "UPDATE member_credentials SET IsActive = 0 WHERE fk_member_master_profile_id = @Id",
                new { Id = seededAdminId.Value });
            // Ensure Member role (id=1) is active
            await EnsureRolesAndCredentials(connection, seededAdminId.Value, superAdmin: false);
            _logger.LogInformation("Seeded admin (9999999999) demoted to Member role.");
        }
    }

    private static async Task SeedZonesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            INSERT INTO zone_master (ZoneName, IsActive, created_date) VALUES
            ('Zone West', 1, NOW()),
            ('Zone South', 1, NOW()),
            ('Zone North', 1, NOW())");
    }

    private static async Task SeedDistrictsAndClubsAsync(MySqlConnection connection)
    {
        // Get zone IDs
        var zWest = await connection.ExecuteScalarAsync<int?>("SELECT pk_zone_id FROM zone_master WHERE ZoneName = 'Zone West' AND isdeleted = 0");
        var zSouth = await connection.ExecuteScalarAsync<int?>("SELECT pk_zone_id FROM zone_master WHERE ZoneName = 'Zone South' AND isdeleted = 0");
        var zNorth = await connection.ExecuteScalarAsync<int?>("SELECT pk_zone_id FROM zone_master WHERE ZoneName = 'Zone North' AND isdeleted = 0");

        // Seed 3 districts linked to zones
        await connection.ExecuteAsync(@"
            INSERT INTO district_master (DistrictNumber, IsActive, fk_zone_id, created_date) VALUES
            ('3131', 1, @ZWest, NOW()),
            ('3132', 1, @ZWest, NOW()),
            ('3141', 1, @ZSouth, NOW())",
            new { ZWest = zWest, ZSouth = zSouth });

        // Get district IDs
        var d1 = await connection.ExecuteScalarAsync<int>("SELECT pk_district_id FROM district_master WHERE DistrictNumber = '3131'");
        var d2 = await connection.ExecuteScalarAsync<int>("SELECT pk_district_id FROM district_master WHERE DistrictNumber = '3132'");
        var d3 = await connection.ExecuteScalarAsync<int>("SELECT pk_district_id FROM district_master WHERE DistrictNumber = '3141'");

        // Seed 7 clubs
        var clubSql = @"INSERT INTO club_master (fk_district_id, ClubRotaryId, ClubName, MeetingDay, MeetingFromTime, MeetingToTime, State, City, Pincode, ClubCharterDate, ActiveFromDate, created_date)
            VALUES (@DistrictId, @RotaryId, @Name, @Day, @FromTime, @ToTime, @State, @City, @Pincode, @CharterDate, @ActiveFrom, NOW())";

        await connection.ExecuteAsync(clubSql, new { DistrictId = d1, RotaryId = "RC-MUM-001", Name = "Rotary Club of Mumbai West", Day = "Wednesday", FromTime = "19:00", ToTime = "21:00", State = "Maharashtra", City = "Mumbai", Pincode = "400001", CharterDate = new DateTime(1990, 6, 15), ActiveFrom = new DateTime(1990, 6, 15) });
        await connection.ExecuteAsync(clubSql, new { DistrictId = d1, RotaryId = "RC-MUM-002", Name = "Rotary Club of Mumbai Central", Day = "Thursday", FromTime = "18:30", ToTime = "20:30", State = "Maharashtra", City = "Mumbai", Pincode = "400008", CharterDate = new DateTime(1995, 3, 10), ActiveFrom = new DateTime(1995, 3, 10) });
        await connection.ExecuteAsync(clubSql, new { DistrictId = d1, RotaryId = "RC-PUN-003", Name = "Rotary Club of Pune Metro", Day = "Friday", FromTime = "19:00", ToTime = "21:00", State = "Maharashtra", City = "Pune", Pincode = "411001", CharterDate = new DateTime(2000, 1, 20), ActiveFrom = new DateTime(2000, 1, 20) });
        await connection.ExecuteAsync(clubSql, new { DistrictId = d2, RotaryId = "RC-AHM-004", Name = "Rotary Club of Ahmedabad Heritage", Day = "Tuesday", FromTime = "18:00", ToTime = "20:00", State = "Gujarat", City = "Ahmedabad", Pincode = "380009", CharterDate = new DateTime(1988, 9, 5), ActiveFrom = new DateTime(1988, 9, 5) });
        await connection.ExecuteAsync(clubSql, new { DistrictId = d2, RotaryId = "RC-AHM-005", Name = "Rotary Club of Ahmedabad Riverside", Day = "Monday", FromTime = "19:30", ToTime = "21:00", State = "Gujarat", City = "Ahmedabad", Pincode = "380015", CharterDate = new DateTime(2005, 7, 12), ActiveFrom = new DateTime(2005, 7, 12) });
        await connection.ExecuteAsync(clubSql, new { DistrictId = d3, RotaryId = "RC-CHN-006", Name = "Rotary Club of Chennai Towers", Day = "Saturday", FromTime = "10:00", ToTime = "12:00", State = "Tamil Nadu", City = "Chennai", Pincode = "600006", CharterDate = new DateTime(1992, 11, 8), ActiveFrom = new DateTime(1992, 11, 8) });
        await connection.ExecuteAsync(clubSql, new { DistrictId = d3, RotaryId = "RC-BLR-007", Name = "Rotary Club of Bengaluru Tech City", Day = "Wednesday", FromTime = "18:30", ToTime = "20:30", State = "Karnataka", City = "Bengaluru", Pincode = "560034", CharterDate = new DateTime(2010, 4, 22), ActiveFrom = new DateTime(2010, 4, 22) });

        // Get club IDs
        var clubs = (await connection.QueryAsync<dynamic>("SELECT pk_club_id, ClubRotaryId FROM club_master WHERE isdeleted = 0")).ToList();
        var clubIds = clubs.ToDictionary(c => (string)c.ClubRotaryId, c => (int)c.pk_club_id);

        // Get member IDs (first 20 members)
        var memberIds = (await connection.QueryAsync<int>("SELECT pk_member_master_profile_id FROM member_master_profile WHERE isdeleted = 0 ORDER BY pk_member_master_profile_id LIMIT 20")).ToList();

        if (memberIds.Count >= 15)
        {
            // Seed 23 club_member mappings
            var cmSql = @"INSERT IGNORE INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_date)
                VALUES (@ClubId, @MemberId, @JoinedDate, 1, NOW())";

            // Club 1 (Mumbai West): members 0,1,2,8 (4 members)
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-MUM-001"], MemberId = memberIds[0], JoinedDate = new DateTime(2015, 1, 10) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-MUM-001"], MemberId = memberIds[1], JoinedDate = new DateTime(2016, 3, 15) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-MUM-001"], MemberId = memberIds[2], JoinedDate = new DateTime(2017, 5, 20) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-MUM-001"], MemberId = memberIds[8], JoinedDate = new DateTime(2018, 7, 1) });

            // Club 2 (Mumbai Central): members 0,3,6 (3 members, member 0 overlaps with Club 1)
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-MUM-002"], MemberId = memberIds[0], JoinedDate = new DateTime(2019, 2, 14) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-MUM-002"], MemberId = memberIds[3], JoinedDate = new DateTime(2016, 8, 22) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-MUM-002"], MemberId = memberIds[6], JoinedDate = new DateTime(2017, 11, 5) });

            // Club 3 (Pune Metro): members 8,9,13 (3 members)
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-PUN-003"], MemberId = memberIds[8], JoinedDate = new DateTime(2018, 4, 10) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-PUN-003"], MemberId = memberIds[9], JoinedDate = new DateTime(2019, 6, 18) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-PUN-003"], MemberId = memberIds[13], JoinedDate = new DateTime(2020, 1, 25) });

            // Club 4 (Ahmedabad Heritage): members 1,14 (2 members)
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-AHM-004"], MemberId = memberIds[1], JoinedDate = new DateTime(2015, 9, 12) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-AHM-004"], MemberId = memberIds[14], JoinedDate = new DateTime(2016, 12, 3) });

            // Club 5 (Ahmedabad Riverside): members 1,14,11 (3 members)
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-AHM-005"], MemberId = memberIds[1], JoinedDate = new DateTime(2020, 3, 8) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-AHM-005"], MemberId = memberIds[14], JoinedDate = new DateTime(2020, 5, 15) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-AHM-005"], MemberId = memberIds[11], JoinedDate = new DateTime(2021, 1, 20) });

            // Club 6 (Chennai Towers): members 2,5,12 (3 members)
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-CHN-006"], MemberId = memberIds[2], JoinedDate = new DateTime(2016, 7, 14) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-CHN-006"], MemberId = memberIds[5], JoinedDate = new DateTime(2017, 10, 22) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-CHN-006"], MemberId = memberIds[12], JoinedDate = new DateTime(2018, 12, 5) });

            // Club 7 (Bengaluru Tech City): members 4,7,10,9 (4 members)
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-BLR-007"], MemberId = memberIds[4], JoinedDate = new DateTime(2019, 8, 30) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-BLR-007"], MemberId = memberIds[7], JoinedDate = new DateTime(2020, 2, 18) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-BLR-007"], MemberId = memberIds[10], JoinedDate = new DateTime(2020, 6, 25) });
            await connection.ExecuteAsync(cmSql, new { ClubId = clubIds["RC-BLR-007"], MemberId = memberIds[9], JoinedDate = new DateTime(2021, 4, 12) });
        }
    }

    private async Task EnsureRolesAndCredentials(MySqlConnection connection, int memberId, bool superAdmin)
    {
        if (superAdmin)
        {
            // Ensure SuperAdmin role (id=3) exists and is active
            var superAdminRoleExists = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @Id AND fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0",
                new { Id = memberId });
            if (superAdminRoleExists == 0)
            {
                var updated = await connection.ExecuteAsync(
                    "UPDATE member_roles SET IsActive = 1, isdeleted = 0, RevokedDate = NULL, RevokedBy = NULL WHERE fk_member_master_profile_id = @Id AND fk_role_id = 3",
                    new { Id = memberId });
                if (updated == 0)
                {
                    await connection.ExecuteAsync(
                        "INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy) VALUES (@Id, 3, @Id)",
                        new { Id = memberId });
                }
            }
        }

        // Ensure Member role (id=1) exists and is active
        var memberRoleExists = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @Id AND fk_role_id = 1 AND IsActive = 1 AND isdeleted = 0",
            new { Id = memberId });
        if (memberRoleExists == 0)
        {
            var updated = await connection.ExecuteAsync(
                "UPDATE member_roles SET IsActive = 1, isdeleted = 0 WHERE fk_member_master_profile_id = @Id AND fk_role_id = 1",
                new { Id = memberId });
            if (updated == 0)
            {
                await connection.ExecuteAsync(
                    "INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy) VALUES (@Id, 1, @Id)",
                    new { Id = memberId });
            }
        }

        if (superAdmin)
        {
            // Ensure credentials exist and are active
            var credExists = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0",
                new { Id = memberId });
            if (credExists == 0)
            {
                var passwordHash = BCrypt.Net.BCrypt.HashPassword("Admin@123");
                var updated = await connection.ExecuteAsync(
                    "UPDATE member_credentials SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1 WHERE fk_member_master_profile_id = @Id",
                    new { Id = memberId, Hash = passwordHash });
                if (updated == 0)
                {
                    await connection.ExecuteAsync(
                        "INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES (@Id, @Hash, 1)",
                        new { Id = memberId, Hash = passwordHash });
                }
                _logger.LogInformation("SuperAdmin credentials set for member {Id}.", memberId);
            }
        }
    }

    // Standalone, idempotent goal-setting schema + seed. Runs on EVERY startup (even when
    // Database:SkipInit=true), so the metadata-driven goal tabs/fields — and the IsHidden / AppliesTo
    // columns they need — are always current without a full ~900-op initializer run. Cheap: two
    // ALTER-if-missing checks + ~90 field upserts. Assumes the goal_* tables already exist (created
    // by InitializeAsync); on a brand-new DB the caller's try/catch logs and InitializeAsync creates them.
    public async Task EnsureGoalSettingSchemaAndSeedAsync()
    {
        using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();
        await AddColumnIfNotExists(connection, "goal_fields", "AppliesTo", "VARCHAR(20) NOT NULL DEFAULT 'Both' AFTER ComputeExpression");
        await AddColumnIfNotExists(connection, "goal_fields", "IsHidden", "TINYINT(1) NOT NULL DEFAULT 0 AFTER SortOrder");

        // Month-wise "collected" goal values — a SEPARATE, additive store; the annual goal_entries
        // flow is untouched. One row per (field, year, entity, PeriodMonth) so re-saving a month
        // overwrites it. PeriodMonth is the calendar month number (7=Jul … 6=Jun for a Rotary year).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_entries_monthly (
                pk_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                fk_field_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                EntityType VARCHAR(10) NOT NULL,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_district_id INT NOT NULL DEFAULT 0,
                PeriodMonth TINYINT NOT NULL,
                NumericValue DECIMAL(18,2) NULL,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                UNIQUE KEY uk_goal_entry_month (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth),
                INDEX idx_gem_club (fk_club_id, fk_year_id),
                INDEX idx_gem_district (fk_district_id, fk_year_id)
            )");

        // Quarterly / month-wise TARGETS (user 2026-09-25). The YEARLY target is untouched - it stays
        // the single figure in goal_entries and remains the thing the club types first. This column
        // holds that year split across the 12 months; a QUARTER is never stored, it is the sum of its
        // three months, so month, quarter and year can never disagree. The 12 monthly targets must
        // add up to the yearly target exactly - validated when Save is pressed.
        // Prod SkipInit → apply SQL/goal_monthly_target.sql.
        await AddColumnIfNotExists(connection, "goal_entries_monthly", "TargetValue",
            "DECIMAL(18,2) NULL AFTER NumericValue");

        await SeedGoalSettingFieldsAsync(connection);
    }

    // Greetings pause rule (see SQL/greeting_reviewed_year.sql). Backfills ONLY when the column is
    // created here, never on later startups — otherwise never-re-saved rows would be re-stamped with
    // the current year every restart and the 1-July pause would never happen.
    private static async Task AddGreetingReviewedYearColumnAsync(MySqlConnection connection, string tableName)
    {
        var exists = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @TableName AND COLUMN_NAME = 'GreetingReviewedYearId'",
            new { TableName = tableName });
        if (exists > 0) return;

        await connection.ExecuteAsync($"ALTER TABLE `{tableName}` ADD COLUMN `GreetingReviewedYearId` INT NULL");
        await connection.ExecuteAsync($@"
            UPDATE `{tableName}`
            SET GreetingReviewedYearId = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1),
                modified_date = modified_date
            WHERE GreetingReviewedYearId IS NULL
              AND (NULLIF(TRIM(BirthdayGreeting), '') IS NOT NULL OR NULLIF(TRIM(AnniversaryGreeting), '') IS NOT NULL
                   OR NULLIF(TRIM(BirthdayEmailMessage), '') IS NOT NULL OR NULLIF(TRIM(AnniversaryEmailMessage), '') IS NOT NULL)");
    }

    private static async Task AddColumnIfNotExists(MySqlConnection connection, string tableName, string columnName, string columnDefinition)
    {
        var exists = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @TableName AND COLUMN_NAME = @ColumnName",
            new { TableName = tableName, ColumnName = columnName });

        if (exists == 0)
        {
            await connection.ExecuteAsync($"ALTER TABLE `{tableName}` ADD COLUMN `{columnName}` {columnDefinition}");
        }
    }

    private static async Task CreateIndexIfNotExists(MySqlConnection connection, string tableName, string indexName, string createSql)
    {
        var exists = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @TableName AND INDEX_NAME = @IndexName",
            new { TableName = tableName, IndexName = indexName });

        if (exists == 0)
        {
            await connection.ExecuteAsync(createSql);
        }
    }

    private static async Task CreateTriggerIfNotExists(MySqlConnection connection, string triggerName, string createSql)
    {
        var exists = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_NAME = @Name AND TRIGGER_SCHEMA = DATABASE()",
            new { Name = triggerName });

        if (exists == 0)
        {
            try
            {
                await connection.ExecuteAsync(createSql);
            }
            catch (MySqlException ex) when (ex.Message.Contains("SUPER privilege", StringComparison.OrdinalIgnoreCase)
                                         || ex.Message.Contains("log_bin_trust_function_creators", StringComparison.OrdinalIgnoreCase))
            {
                // MySQL user lacks SUPER privilege on a binlog-enabled server.
                // Triggers are non-critical (audit/safety) — skip and continue startup.
            }
        }
    }

    // Run a trigger DROP/CREATE statement and swallow the SUPER privilege error.
    // Used for trigger blocks that don't fit the IF-NOT-EXISTS pattern (eg. drop+create rotation).
    private static async Task TryExecuteTriggerSqlAsync(MySqlConnection connection, string sql)
    {
        try { await connection.ExecuteAsync(sql); }
        catch (MySqlException ex) when (ex.Message.Contains("SUPER privilege", StringComparison.OrdinalIgnoreCase)
                                     || ex.Message.Contains("log_bin_trust_function_creators", StringComparison.OrdinalIgnoreCase))
        {
            // Skip silently — same reason as CreateTriggerIfNotExists.
        }
    }

    private static async Task AddForeignKeyIfNotExists(MySqlConnection connection, string tableName, string constraintName, string columnName, string refTable, string refColumn)
    {
        var exists = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @TableName AND CONSTRAINT_NAME = @ConstraintName",
            new { TableName = tableName, ConstraintName = constraintName });

        if (exists == 0)
        {
            await connection.ExecuteAsync($"ALTER TABLE `{tableName}` ADD CONSTRAINT `{constraintName}` FOREIGN KEY (`{columnName}`) REFERENCES `{refTable}`(`{refColumn}`)");
        }
    }

    private static async Task DropColumnIfExists(MySqlConnection connection, string tableName, string columnName)
    {
        var exists = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @TableName AND COLUMN_NAME = @ColumnName",
            new { TableName = tableName, ColumnName = columnName });

        if (exists > 0)
        {
            await connection.ExecuteAsync($"ALTER TABLE `{tableName}` DROP COLUMN `{columnName}`");
        }
    }

    private static async Task SeedModuleCategoriesAndModulesAsync(MySqlConnection connection)
    {
        // Seed module categories
        await connection.ExecuteAsync(@"
            INSERT INTO module_categories (CategoryName, SortOrder, IsActive, created_date) VALUES
            ('Master Modules', 1, 1, NOW()),
            ('Avenue of Service and Public Image Initiative', 2, 1, NOW()),
            ('Communication', 3, 1, NOW()),
            ('E-Governance / Reporting', 4, 1, NOW()),
            ('Payments', 5, 1, NOW()),
            ('Quick Links', 6, 1, NOW()),
            ('District Events & District Projects', 7, 1, NOW())");

        // Get category IDs
        var cat1 = await connection.ExecuteScalarAsync<int>("SELECT pk_category_id FROM module_categories WHERE CategoryName = 'Master Modules' AND isdeleted = 0");
        var cat2 = await connection.ExecuteScalarAsync<int>("SELECT pk_category_id FROM module_categories WHERE CategoryName = 'Avenue of Service and Public Image Initiative' AND isdeleted = 0");
        var cat3 = await connection.ExecuteScalarAsync<int>("SELECT pk_category_id FROM module_categories WHERE CategoryName = 'Communication' AND isdeleted = 0");
        var cat4 = await connection.ExecuteScalarAsync<int>("SELECT pk_category_id FROM module_categories WHERE CategoryName = 'E-Governance / Reporting' AND isdeleted = 0");
        var cat5 = await connection.ExecuteScalarAsync<int>("SELECT pk_category_id FROM module_categories WHERE CategoryName = 'Payments' AND isdeleted = 0");
        var cat6 = await connection.ExecuteScalarAsync<int>("SELECT pk_category_id FROM module_categories WHERE CategoryName = 'Quick Links' AND isdeleted = 0");
        var cat7 = await connection.ExecuteScalarAsync<int>("SELECT pk_category_id FROM module_categories WHERE CategoryName = 'District Events & District Projects' AND isdeleted = 0");

        var moduleSql = @"
            INSERT INTO module_master (ModuleName, ModuleKey, fk_category_id, ModuleLevel, IconClass, IsDefaultForDistrict, IsDefaultForClub, SortOrder)
            VALUES (@Name, @Key, @CatId, @Level, @Icon, @DefDist, @DefClub, @Sort)";

        // Category 1 - Master Modules
        await connection.ExecuteAsync(moduleSql, new { Name = "Directory", Key = "directory", CatId = cat1, Level = "Both", Icon = "BookUser", DefDist = 1, DefClub = 1, Sort = 1 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Market Place", Key = "market_place", CatId = cat1, Level = "Club", Icon = "Store", DefDist = 0, DefClub = 1, Sort = 2 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Past Presidents", Key = "past_presidents", CatId = cat1, Level = "Club", Icon = "Crown", DefDist = 0, DefClub = 1, Sort = 3 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Board of Directors", Key = "board_of_directors", CatId = cat1, Level = "Club", Icon = "Users", DefDist = 0, DefClub = 1, Sort = 4 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Website Data", Key = "website_data", CatId = cat1, Level = "Both", Icon = "Globe", DefDist = 1, DefClub = 1, Sort = 5 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Rotary Network", Key = "rotary_network", CatId = cat1, Level = "Club", Icon = "Network", DefDist = 0, DefClub = 1, Sort = 6 });
        await connection.ExecuteAsync(moduleSql, new { Name = "District Committee", Key = "district_committee", CatId = cat1, Level = "District", Icon = "UsersRound", DefDist = 1, DefClub = 0, Sort = 7 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Clubs", Key = "clubs", CatId = cat1, Level = "District", Icon = "Building2", DefDist = 1, DefClub = 0, Sort = 8 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Club Monthly Report", Key = "club_monthly_report", CatId = cat1, Level = "Both", Icon = "BarChart3", DefDist = 1, DefClub = 1, Sort = 9 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Club Moderator", Key = "club_moderator", CatId = cat1, Level = "District", Icon = "Shield", DefDist = 1, DefClub = 0, Sort = 10 });
        await connection.ExecuteAsync(moduleSql, new { Name = "AG", Key = "ag", CatId = cat1, Level = "District", Icon = "UserCog", DefDist = 1, DefClub = 0, Sort = 11 });

        // Category 2 - Avenue of Service and Public Image Initiative
        await connection.ExecuteAsync(moduleSql, new { Name = "Club Service", Key = "club_service", CatId = cat2, Level = "Club", Icon = "Heart", DefDist = 0, DefClub = 1, Sort = 1 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Community Service", Key = "community_service", CatId = cat2, Level = "Club", Icon = "HandHeart", DefDist = 0, DefClub = 1, Sort = 2 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Vocational Service", Key = "vocational_service", CatId = cat2, Level = "Club", Icon = "Briefcase", DefDist = 0, DefClub = 1, Sort = 3 });
        await connection.ExecuteAsync(moduleSql, new { Name = "International Service", Key = "international_service", CatId = cat2, Level = "Club", Icon = "Globe2", DefDist = 0, DefClub = 1, Sort = 4 });
        await connection.ExecuteAsync(moduleSql, new { Name = "New Generation Service", Key = "new_generation_service", CatId = cat2, Level = "Club", Icon = "GraduationCap", DefDist = 0, DefClub = 1, Sort = 5 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Public Image Initiative", Key = "public_image_initiative", CatId = cat2, Level = "Club", Icon = "Megaphone", DefDist = 0, DefClub = 1, Sort = 6 });

        // Category 3 - Communication
        await connection.ExecuteAsync(moduleSql, new { Name = "Upcoming Events", Key = "upcoming_events", CatId = cat3, Level = "Both", Icon = "CalendarDays", DefDist = 1, DefClub = 1, Sort = 1 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Announcements", Key = "announcements", CatId = cat3, Level = "Both", Icon = "Bell", DefDist = 1, DefClub = 1, Sort = 2 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Newsletters", Key = "newsletters", CatId = cat3, Level = "Both", Icon = "Newspaper", DefDist = 1, DefClub = 1, Sort = 3 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Documents", Key = "documents", CatId = cat3, Level = "Both", Icon = "FileText", DefDist = 1, DefClub = 1, Sort = 4 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Greetings", Key = "greetings", CatId = cat3, Level = "Both", Icon = "PartyPopper", DefDist = 1, DefClub = 1, Sort = 5 });

        // Category 4 - E-Governance / Reporting
        await connection.ExecuteAsync(moduleSql, new { Name = "Attendance", Key = "attendance", CatId = cat4, Level = "Club", Icon = "ClipboardCheck", DefDist = 0, DefClub = 1, Sort = 1 });
        await connection.ExecuteAsync(moduleSql, new { Name = "District Awards", Key = "district_citation", CatId = cat4, Level = "Both", Icon = "Award", DefDist = 1, DefClub = 1, Sort = 2 });
        await connection.ExecuteAsync(moduleSql, new { Name = "OCV/GOV", Key = "ocv_gov", CatId = cat4, Level = "Club", Icon = "Vote", DefDist = 0, DefClub = 1, Sort = 3 });
        await connection.ExecuteAsync(moduleSql, new { Name = "PPH Camp", Key = "pph_camp", CatId = cat4, Level = "Both", Icon = "Tent", DefDist = 1, DefClub = 1, Sort = 4 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Reports", Key = "reports", CatId = cat4, Level = "Both", Icon = "FileBarChart", DefDist = 1, DefClub = 1, Sort = 5 });
        await connection.ExecuteAsync(moduleSql, new { Name = "TRF Contribution", Key = "trf_contribution", CatId = cat4, Level = "Club", Icon = "DollarSign", DefDist = 0, DefClub = 1, Sort = 6 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Zonal Awards", Key = "zonal_awards", CatId = cat4, Level = "District", Icon = "Trophy", DefDist = 1, DefClub = 0, Sort = 8 });

        // Category 5 - Payments
        await connection.ExecuteAsync(moduleSql, new { Name = "Online Event Link", Key = "online_event_link", CatId = cat5, Level = "Both", Icon = "Link", DefDist = 1, DefClub = 1, Sort = 1 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Club Dues", Key = "membership_dues", CatId = cat5, Level = "Club", Icon = "CreditCard", DefDist = 0, DefClub = 1, Sort = 2 });
        await connection.ExecuteAsync(moduleSql, new { Name = "District Dues", Key = "club_dues", CatId = cat5, Level = "District", Icon = "Wallet", DefDist = 1, DefClub = 0, Sort = 3 });

        // Category 6 - Quick Links
        await connection.ExecuteAsync(moduleSql, new { Name = "Web Links", Key = "web_links", CatId = cat6, Level = "Both", Icon = "ExternalLink", DefDist = 1, DefClub = 1, Sort = 1 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Sub Groups", Key = "sub_groups", CatId = cat6, Level = "Both", Icon = "FolderTree", DefDist = 1, DefClub = 1, Sort = 2 });
        await connection.ExecuteAsync(moduleSql, new { Name = "Mass Email", Key = "mass_email", CatId = cat6, Level = "Both", Icon = "MailPlus", DefDist = 1, DefClub = 1, Sort = 3 });

        // Category 7 - District Events & District Projects
        await connection.ExecuteAsync(moduleSql, new { Name = "District Projects", Key = "district_projects", CatId = cat7, Level = "District", Icon = "FolderKanban", DefDist = 1, DefClub = 0, Sort = 1 });
        await connection.ExecuteAsync(moduleSql, new { Name = "District Events", Key = "district_events", CatId = cat7, Level = "District", Icon = "Calendar", DefDist = 1, DefClub = 0, Sort = 2 });
    }

    // Field list transcribed verbatim from the approved unified subcategory list —
    // D:\Raj\Project\ROW\Disha_Goal_Setting_Subcategory_Comparison.md, "Unified
    // Subcategory List" section (all 7 decisions already applied there; this is not a place
    // to re-derive or tweak the list — change the source document first, then this).
    // Tuple shape: (GroupName, FieldKey, FieldLabel, DataType, Unit, FieldRole, ComputeExpression, SortOrder)
    // Membership tab — rebuilt 2026-09-02 to exactly mirror the DISHA 5&6 reference (groups:
    // New Clubs, Women Membership, RAG Analysis, Total, Summary). RED/AMBER/GREEN + the baselines
    // are read-only live values (injected in GoalSettingService). The extra fields we used to carry
    // (achieved columns, Avg Member/Club, Women %, Super Green count, Demographics) were removed to
    // match the reference — their goal_entries rows are retained but filtered out (see retire pass).
    private static readonly (string Group, string Key, string Label, string DataType, string? Unit, string Role, string? Compute, int Sort)[] MembershipFields =
    {
        // New Clubs — Total as-on-July-1st (live: clubs chartered before the year start), Target for the
        // current year (admin enters), Achieved (live: clubs chartered within the viewed Rotary year), and
        // Percentage Achievement (live: Achieved ÷ Target × 100).
        ("New Clubs", "total_clubs", "Total No of Clubs as on July 1st", "Integer", "nos", "Reference", null, 1),
        ("New Clubs", "new_clubs", "Target for the Current year", "Integer", "nos", "Target", null, 2),
        ("New Clubs", "new_clubs_achieved", "Achieved", "Integer", "nos", "Reference", null, 3),
        ("New Clubs", "clubs_percentage_achievement", "Percentage Achieved", "Percentage", "%", "Computed", null, 4),
        // Total Members — Total as-on-July-1st (live: members who joined before the year start), Target
        // for the current year (admin enters), Achieved (live: members of any gender who JOINED in the
        // viewed year), and Percentage Achievement (live: Achieved ÷ Target × 100).
        ("Total Members", "total_members", "Total Members as on July 1st", "Integer", "nos", "Reference", null, 5),
        ("Total Members", "new_members", "Target for the Current year", "Integer", "nos", "Target", null, 6),
        ("Total Members", "new_members_achieved", "Achieved", "Integer", "nos", "Reference", null, 7),
        ("Total Members", "percentage_increase", "Percentage Achieved", "Percentage", "%", "Computed", null, 8),
        // Women Membership — Existing as-on-July-1st (live), Target for the current year (admin enters),
        // Achieved (live: women who JOINED in the viewed Rotary year, by club_members.JoinedDate + Female),
        // and Percentage Achievement (live: Achieved ÷ Target × 100).
        ("Women Membership", "existing_women_members", "Existing Women Members as on July 1st", "Integer", "nos", "Reference", null, 9),
        ("Women Membership", "new_women_members", "Target for the Current year", "Integer", "nos", "Target", null, 10),
        ("Women Membership", "new_women_members_achieved", "Achieved", "Integer", "nos", "Reference", null, 11),
        ("Women Membership", "women_percentage_achievement", "Percentage Achieved", "Percentage", "%", "Computed", null, 12),
        // RAG Analysis — RED/AMBER/GREEN read-only live counts (Healthy-Clubs bands). Sits just before Summary.
        ("RAG Analysis", "rag_red", "RED", "Integer", "nos", "Reference", null, 13),
        ("RAG Analysis", "rag_amber", "AMBER", "Integer", "nos", "Reference", null, 14),
        ("RAG Analysis", "rag_green", "GREEN", "Integer", "nos", "Reference", null, 15),
        // Summary — all computed (injected live in GoalSettingService; the compute engine can't subtract):
        //   Total New Clubs           = Clubs Achieved − Total Clubs as on July 1st (new clubs added so far)
        //   Total Membership Net Growth = Members Achieved − Total Members as on July 1st (net growth so far)
        //   Total New women members   = Women Achieved − Existing Women Members as on July 1st (added so far)
        //   (Total Nos is hidden — see hiddenFieldKeys.)
        // NOTE: "new_club_members_computed" is a legacy field KEY — it is now the "Total New women members"
        // metric (label + calculation changed). Kept as-is because it's computed-only (no stored user data).
        // Order (2026-09-23): Total New Clubs, Total Membership Net Growth, Total New women members.
        ("Summary", "total_new_clubs", "Total New Clubs", "Integer", "nos", "Computed", null, 16),
        ("Summary", "total_membership_net_growth", "Total Membership Net Growth", "Integer", "nos", "Computed", null, 17),
        ("Summary", "new_club_members_computed", "Total New women members", "Integer", "nos", "Computed", null, 18),
        ("Summary", "total_nos_computed", "Total Nos", "Integer", "nos", "Computed", null, 19),
    };

    // TRF tab (District) — 5 items (Annual Fund, Polio Plus, Endowment, CSR, Total Giving), each with
    // a Target (uploaded by SuperAdmin, district admin can adjust) + an Achieved (uploaded/imported).
    // Total Giving Target = sum of the 4 fund targets; Achieved = live sum of the 4 fund achieveds.
    // Each fund also shows a Percentage Achievement (Achieved ÷ Target × 100). Special Remarks removed
    // (2026-09-04). All District-scoped (club TRF = the club fields below).
    private static readonly (string Group, string Key, string Label, string DataType, string? Unit, string Role, string? Compute, int Sort)[] FoundationFields =
    {
        // Each fund: Highest + Target + Achieved + Percentage Achievement (live: Achieved ÷ Target × 100).
        // "Highest" (2026-09-16) = the district's highest giving to date, a REFERENCE figure shown ABOVE
        // the Target. It is its own field — the Target keeps its own name and its own value. Role
        // "Reference" (not Target) so every grid/report renders the fund as
        //   Highest · Target for the Current year · Achieved · Achievement(%)
        // and so Percentage Achievement keeps dividing by the TARGET, not by Highest.
        // These 5 *_highest fields MUST stay listed here: this seeder soft-deletes any goal field it does
        // not know about, which is exactly how they vanished from the district page after a restart.
        ("Annual Fund", "annual_fund_highest", "Highest", "Currency", "$", "Reference", null, 1),
        ("Annual Fund", "annual_fund_target", "Target for the Current year", "Currency", "$", "Target", null, 2),
        ("Annual Fund", "annual_fund_achieved", "Achieved", "Currency", "$", "Reference", null, 3),
        ("Annual Fund", "annual_fund_pct", "Percentage Achieved", "Percentage", "%", "Computed", null, 4),
        // Polio Plus Fund
        ("Polio Plus Fund", "polio_plus_highest", "Highest", "Currency", "$", "Reference", null, 5),
        ("Polio Plus Fund", "polio_plus_target", "Target for the Current year", "Currency", "$", "Target", null, 6),
        ("Polio Plus Fund", "polio_plus_achieved", "Achieved", "Currency", "$", "Reference", null, 7),
        ("Polio Plus Fund", "polio_plus_pct", "Percentage Achieved", "Percentage", "%", "Computed", null, 8),
        // Endowment Fund
        ("Endowment Fund", "endowment_highest", "Highest", "Currency", "$", "Reference", null, 9),
        ("Endowment Fund", "endowment_target", "Target for the Current year", "Currency", "$", "Target", null, 10),
        ("Endowment Fund", "endowment_achieved", "Achieved", "Currency", "$", "Reference", null, 11),
        ("Endowment Fund", "endowment_pct", "Percentage Achieved", "Percentage", "%", "Computed", null, 12),
        // CSR
        ("CSR", "csr_highest", "Highest", "Currency", "$", "Reference", null, 13),
        ("CSR", "csr_target", "Target for the Current year", "Currency", "$", "Target", null, 14),
        ("CSR", "csr_achieved", "Achieved", "Currency", "$", "Reference", null, 15),
        ("CSR", "csr_pct", "Percentage Achieved", "Percentage", "%", "Computed", null, 16),
        // Total Giving — all 3 fields are now MANUAL/editable (2026-09-09): the official TRF goal sheet
        // gives an independent Total Giving target that is NOT the sum of the 4 funds, so Target is imported
        // as-is (SuperAdmin SQL) and the district admin can edit Target, Achieved and % by hand. Roles:
        // Target = editable input; Reference (not in SYSTEM_FILLED_REFERENCE) = editable input. No compute.
        ("Total Giving", "total_contributions_highest", "Highest", "Currency", "$", "Reference", null, 17),
        ("Total Giving", "total_contributions_target", "Target for the Current year", "Currency", "$", "Target", null, 18),
        ("Total Giving", "total_giving_achieved", "Achieved", "Currency", "$", "Reference", null, 19),
        ("Total Giving", "total_giving_pct", "Percentage Achieved", "Percentage", "%", "Reference", null, 20),
    };

    // TRF tab (Club) — same design as the district TRF: 6 items (AF Per Capita, Annual Fund YTD,
    // PolioPlus Fund YTD, Other Funds YTD, Endowment Fund YTD, Total), each with a Target (uploaded)
    // + an Achieved (imported from the Rotary MCR report). Total = sum of the 4 fund YTDs (per-capita
    // excluded). All Club-scoped.
    private static readonly (string Group, string Key, string Label, string DataType, string? Unit, string Role, string? Compute, int Sort)[] FoundationClubFields =
    {
        // Each fund: Target + Achieved + Percentage Achievement (live: Achieved ÷ Target × 100).
        ("AF Per Capita",       "club_af_per_capita_target",   "Target for the Current year",   "Currency", "$", "Target",    null, 1),
        ("AF Per Capita",       "club_af_per_capita",          "Achieved", "Currency", "$", "Reference", null, 2),
        ("AF Per Capita",       "club_af_per_capita_pct",      "Percentage Achieved", "Percentage", "%", "Computed", null, 3),
        // Annual Fund YTD
        ("Annual Fund YTD",     "club_annual_fund_ytd_target", "Target for the Current year",   "Currency", "$", "Target",    null, 4),
        ("Annual Fund YTD",     "club_annual_fund_ytd",        "Achieved", "Currency", "$", "Reference", null, 5),
        ("Annual Fund YTD",     "club_annual_fund_ytd_pct",    "Percentage Achieved", "Percentage", "%", "Computed", null, 6),
        // PolioPlus Fund YTD
        ("PolioPlus Fund YTD",  "club_polioplus_ytd_target",   "Target for the Current year",   "Currency", "$", "Target",    null, 7),
        ("PolioPlus Fund YTD",  "club_polioplus_ytd",          "Achieved", "Currency", "$", "Reference", null, 8),
        ("PolioPlus Fund YTD",  "club_polioplus_ytd_pct",      "Percentage Achieved", "Percentage", "%", "Computed", null, 9),
        // Other Funds YTD
        ("Other Funds YTD",     "club_other_funds_ytd_target", "Target for the Current year",   "Currency", "$", "Target",    null, 10),
        ("Other Funds YTD",     "club_other_funds_ytd",        "Achieved", "Currency", "$", "Reference", null, 11),
        ("Other Funds YTD",     "club_other_funds_ytd_pct",    "Percentage Achieved", "Percentage", "%", "Computed", null, 12),
        // Endowment Fund YTD
        ("Endowment Fund YTD",  "club_endowment_ytd_target",   "Target for the Current year",   "Currency", "$", "Target",    null, 13),
        ("Endowment Fund YTD",  "club_endowment_ytd",          "Achieved", "Currency", "$", "Reference", null, 14),
        ("Endowment Fund YTD",  "club_endowment_ytd_pct",      "Percentage Achieved", "Percentage", "%", "Computed", null, 15),
        // Total — Target (computed sum of the 4 fund targets) + Achieved (imported MCR total) + %
        ("Total", "club_total_target", "Target for the Current year", "Currency", "$", "Computed",
            "club_annual_fund_ytd_target + club_polioplus_ytd_target + club_other_funds_ytd_target + club_endowment_ytd_target", 16),
        ("Total", "club_total_ytd", "Achieved", "Currency", "$", "Reference", null, 17),
        // "Reference" (not Computed) so the club admin can EDIT it — the sum is auto-filled only while
        // the box is empty (2026-09-16 request: Total's Achieved and % both editable).
        ("Total", "club_total_pct", "Percentage Achieved", "Percentage", "%", "Reference", null, 18),
    };

    // Youth Service tab (own tab again 2026-09-02, was merged into Membership) — labels match the
    // DISHA 5&6 reference exactly. Rotaract/Interact/RCC are Both-scoped (a club sponsors them);
    // "Yet to Sponsor" counts Rotary clubs district-wide → District-only.
    private static readonly (string Group, string Key, string Label, string DataType, string? Unit, string Role, string? Compute, int Sort)[] YouthFields =
    {
        // Order (user 2026-10-09): each part reads start -> plan -> result - clubs (existing, proposed,
        // achieved, %), then Rotaractors (as on July 1st, proposed, achieved, %).
        ("Rotaract", "rotaract_existing_clubs", "Existing Rotaract Clubs as on July 1st", "Integer", "nos", "Reference", null, 1),
        ("Rotaract", "rotaract_existing_members", "No. of Rotaractors as on July 1st", "Integer", "nos", "Reference", null, 6),
        ("Rotaract", "rotaract_new_clubs_target", "Proposed New Rotaract Clubs", "Integer", "nos", "Target", null, 2),
        ("Rotaract", "rotaract_new_members_target", "Proposed New Rotaractors", "Integer", "nos", "Target", null, 7),
        // The computed "Total …" rows are the CLUB page's view (existing + proposed). The DISTRICT page
        // instead gets a typed "Achieved" + an auto "Percentage Achieved", mirroring Membership
        // (user request 2026-09-16) — hence the separate District-only keys below. Scope is set in
        // districtOnlyFieldKeys / clubOnlyFieldKeys, so neither page sees the other's rows.
        ("Rotaract", "rotaract_total_clubs", "Total Clubs", "Integer", "nos", "Computed", "rotaract_existing_clubs + rotaract_new_clubs_target", 3),
        ("Rotaract", "rotaract_clubs_achieved", "Clubs Achieved", "Integer", "nos", "Target", null, 4),
        ("Rotaract", "rotaract_clubs_pct", "Percentage Achieved", "Percentage", "%", "Computed", null, 5),
        ("Rotaract", "rotaract_total_members", "Total Rotaractors", "Integer", "nos", "Computed", "rotaract_existing_members + rotaract_new_members_target", 8),
        ("Rotaract", "rotaract_members_achieved", "Rotaractors Achieved", "Integer", "nos", "Target", null, 9),
        ("Rotaract", "rotaract_members_pct", "Rotaractors Percentage Achieved", "Percentage", "%", "Computed", null, 10),
        ("Interact", "interact_existing_clubs", "Existing Interact Clubs as on July 1st", "Integer", "nos", "Reference", null, 11),
        ("Interact", "interact_new_clubs_target", "Proposed New Interact Clubs", "Integer", "nos", "Target", null, 12),
        ("Interact", "interact_total_clubs", "Total Clubs", "Integer", "nos", "Computed", "interact_existing_clubs + interact_new_clubs_target", 13),
        ("Interact", "interact_clubs_achieved", "Clubs Achieved", "Integer", "nos", "Target", null, 14),
        ("Interact", "interact_clubs_pct", "Percentage Achieved", "Percentage", "%", "Computed", null, 15),
        ("RCC", "rcc_existing_clubs", "Existing RCC as on July 1st", "Integer", "nos", "Reference", null, 16),
        ("RCC", "rcc_new_clubs_target", "Proposed New RCC Clubs", "Integer", "nos", "Target", null, 17),
        ("RCC", "rcc_total_clubs", "Total Clubs", "Integer", "nos", "Computed", "rcc_existing_clubs + rcc_new_clubs_target", 18),
        ("RCC", "rcc_clubs_achieved", "Clubs Achieved", "Integer", "nos", "Target", null, 19),
        ("RCC", "rcc_clubs_pct", "Percentage Achieved", "Percentage", "%", "Computed", null, 20),
    };

    // Public Image tab — rebuilt 2026-09-02 to mirror the DISHA 5&6 reference: 3 groups only
    // (Activities counts, Other Points Yes/No + %-of-clubs, Suggestions text). Removed the extras
    // we carried (Electronic Media, Learning Sessions, Monthly Report, Total PI Projects).
    private static readonly (string Group, string Key, string Label, string DataType, string? Unit, string Role, string? Compute, int Sort)[] PublicImageFields =
    {
        // Activities
        ("Activities", "district_polio_awareness_programme", "District Polio Awareness Programme", "Integer", "nos", "Target", null, 1),
        ("Activities", "inter_district_pi_programme", "Inter District Public Image Programme", "Integer", "nos", "Target", null, 2),
        ("Activities", "bulletin_newsletter", "Bulletin / Monthly Newsletter", "Integer", "nos", "Target", null, 3),
        ("Activities", "mega_pi_activities", "No of Mega Public Image Activities", "Integer", "nos", "Target", null, 4),
        ("Activities", "adoption_garden_park_road", "No of Adoption - Garden / Park / Road", "Integer", "nos", "Target", null, 5),
        ("Activities", "display_items", "Display (Bus / Rail / Airport / Highways)", "Integer", "nos", "Target", null, 6),
        ("Activities", "press_media_coverage", "No of Press Meet", "Integer", "nos", "Target", null, 7),
        ("Activities", "public_rally", "Public Rally / Marathon / Human Chain / Car Rally", "Integer", "nos", "Target", null, 8),
        // Other Points — Yes/No, plus the two %-of-clubs figures (District-only)
        ("Other Points", "district_website", "District Website", "Boolean", null, "Target", null, 9),
        ("Other Points", "club_website", "Club Website", "Boolean", null, "Target", null, 10),
        ("Other Points", "club_website_percent", "Club Website %", "Percentage", "%", "Target", null, 11),
        ("Other Points", "district_social_media", "District Social Media", "Boolean", null, "Target", null, 12),
        ("Other Points", "club_social_media", "Club Social Media", "Boolean", null, "Target", null, 13),
        ("Other Points", "club_social_media_percent", "Club Social Media %", "Percentage", "%", "Target", null, 14),
        ("Other Points", "district_pi_seminar", "District Public Image Seminar", "Boolean", null, "Target", null, 15),
        // "Involving Rotaract, Interact & RCC" was retired on 2026-09-21 (user: remove it everywhere).
        // Leaving it out of this catalog makes RetireStaleAsync soft-delete the row on startup; the
        // answers already saved stay in goal_entries, so re-adding the line brings them back.
        ("Other Points", "specific_pi_session_training", "Specific Public Image Session in all Training Events", "Boolean", null, "Target", null, 17),
        // Suggestions — a dynamic Add/Delete list (max 10). The frontend shows one row per non-empty
        // entry with Add/Delete controls; these 10 slots back that list. Label is generic per slot.
        ("Suggestions", "pi_suggestion_1",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 18),
        ("Suggestions", "pi_suggestion_2",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 19),
        ("Suggestions", "pi_suggestion_3",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 20),
        ("Suggestions", "pi_suggestion_4",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 21),
        ("Suggestions", "pi_suggestion_5",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 22),
        ("Suggestions", "pi_suggestion_6",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 23),
        ("Suggestions", "pi_suggestion_7",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 24),
        ("Suggestions", "pi_suggestion_8",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 25),
        ("Suggestions", "pi_suggestion_9",  "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 26),
        ("Suggestions", "pi_suggestion_10", "Any Other Public Image Activity you would like to suggest", "Text", null, "Target", null, 27),
    };

    private static async Task SeedGoalSettingFieldsAsync(MySqlConnection connection)
    {
        // 4 tabs matching the DISHA 5&6 reference (2026-09-02): Membership, TRF, Youth Service,
        // Public Image. "Foundation" was renamed to "TRF"; "Youth Service" is split back out of
        // Membership into its own tab. The field upsert re-points each field's fk_category_id, so
        // the fields move to the new categories automatically.
        // Display sequence (user request 2026-09-09): Membership → Youth Service → TRF → Public
        // Image. SortOrder drives category order everywhere (forms + till-date & month-wise reports);
        // the ON DUPLICATE KEY UPDATE below re-applies it to existing rows on startup.
        var categories = new (string Name, int Sort)[]
        {
            ("Membership", 1), ("Youth Service", 2), ("TRF", 3), ("Public Image", 4),
        };
        foreach (var c in categories)
        {
            await connection.ExecuteAsync(@"
                INSERT INTO goal_categories (Name, SortOrder) VALUES (@Name, @Sort)
                ON DUPLICATE KEY UPDATE SortOrder = VALUES(SortOrder), isdeleted = 0",
                new { c.Name, c.Sort });
        }
        // Retire the old category names (their fields are re-pointed to the new categories below).
        await connection.ExecuteAsync(
            "UPDATE goal_categories SET isdeleted = 1 WHERE Name IN ('Youth', 'Foundation')");

        var categoryIds = new Dictionary<string, int>();
        foreach (var c in categories)
        {
            categoryIds[c.Name] = await connection.ExecuteScalarAsync<int>(
                "SELECT pk_category_id FROM goal_categories WHERE Name = @Name AND isdeleted = 0",
                new { c.Name });
        }

        // ── Field scope (Club / District / Both) ─────────────────────────────
        // A club shouldn't see district-level rows and vice-versa. Fields NOT listed
        // in either set default to "Both". This runs on every startup via the upsert
        // below, so it also backfills the scope on already-seeded DBs.
        var districtOnlyFieldKeys = new HashSet<string>
        {
            // Membership — counting / chartering CLUBS, or district-wide roll-ups (the club page
            // must NOT show any "club count" field). clubs_percentage_achievement is the New-Clubs %.
            "total_clubs", "new_clubs", "new_clubs_achieved", "clubs_percentage_achievement",
            "rag_red", "rag_amber", "rag_green",
            "rag_red_to_amber_target", "rag_amber_to_green_target", "rag_green_to_super_green_target",
            // "Total New women members" (key new_club_members_computed) is NOT district-only (2026-09-23):
            // the club page has Women Membership too, so its Summary shows it; Total New Clubs stays district.
            "total_new_clubs", "total_nos_computed",
            // TRF — the whole District TRF set is District-scoped (club TRF = the MCR club fields).
            // 4 funds: each fund's Achieved (imported) + Target + Percentage Achievement, plus Total Giving.
            "annual_fund_highest", "annual_fund_achieved", "annual_fund_target", "annual_fund_pct",
            "polio_plus_highest", "polio_plus_achieved", "polio_plus_target", "polio_plus_pct",
            "endowment_highest", "endowment_achieved", "endowment_target", "endowment_pct",
            "csr_highest", "csr_achieved", "csr_target", "csr_pct",
            "total_contributions_highest", "total_giving_achieved", "total_contributions_target", "total_giving_pct",
            // Public Image — district programmes/seminars + %-of-clubs metrics.
            "district_pi_seminar", "specific_pi_session_training",
            "district_website", "club_website_percent",
            "district_social_media", "club_social_media_percent",
            "inter_district_pi_programme",
            // Youth Service — the DISTRICT page's typed "Achieved" + auto "Percentage Achieved"
            // (the club page keeps its computed "Total …" rows instead).
            "rotaract_clubs_achieved", "rotaract_clubs_pct",
            "rotaract_members_achieved", "rotaract_members_pct",
            "interact_clubs_achieved", "interact_clubs_pct",
            "rcc_clubs_achieved", "rcc_clubs_pct",
        };
        // "Total Nos" is hidden from the Summary (kept in the schema/compute but not shown). IsHidden is
        // re-applied on every startup via the upsert below, so this also hides it on already-seeded DBs.
        var hiddenFieldKeys = new HashSet<string> { "total_nos_computed" };
        var clubOnlyFieldKeys = new HashSet<string>
        {
            // A single club's own web presence (district tracks the %-of-clubs versions above).
            "club_website", "club_social_media",
            // Youth Service — the computed "Total …" rows stay on the CLUB page only; the district page
            // shows its typed "Achieved" + "Percentage Achieved" rows instead.
            "rotaract_total_clubs", "rotaract_total_members", "interact_total_clubs", "rcc_total_clubs",
            // Club TRF — each item's Achieved (imported from the MCR report) + Target (uploaded) + %.
            "club_af_per_capita", "club_af_per_capita_target", "club_af_per_capita_pct",
            "club_annual_fund_ytd", "club_annual_fund_ytd_target", "club_annual_fund_ytd_pct",
            "club_polioplus_ytd", "club_polioplus_ytd_target", "club_polioplus_ytd_pct",
            "club_other_funds_ytd", "club_other_funds_ytd_target", "club_other_funds_ytd_pct",
            "club_endowment_ytd", "club_endowment_ytd_target", "club_endowment_ytd_pct",
            "club_total_ytd", "club_total_target", "club_total_pct",
        };
        string ScopeFor(string key) =>
            districtOnlyFieldKeys.Contains(key) ? "District"
            : clubOnlyFieldKeys.Contains(key) ? "Club"
            : "Both";

        bool HiddenFor(string key) => hiddenFieldKeys.Contains(key);

        // fk_category_id IS updated on re-seed so a field can be MOVED to another category
        // (e.g. relocating the Youth fields from Membership to the Youth Service tab, or the
        // Foundation fields to TRF).
        var fieldSql = @"
            INSERT INTO goal_fields (fk_category_id, GroupName, FieldKey, FieldLabel, DataType, Unit, FieldRole, ComputeExpression, AppliesTo, SortOrder, IsHidden)
            VALUES (@CatId, @Group, @Key, @Label, @DataType, @Unit, @Role, @Compute, @AppliesTo, @Sort, @Hidden)
            ON DUPLICATE KEY UPDATE
                fk_category_id = VALUES(fk_category_id),
                GroupName = VALUES(GroupName), FieldLabel = VALUES(FieldLabel), DataType = VALUES(DataType),
                Unit = VALUES(Unit), FieldRole = VALUES(FieldRole), ComputeExpression = VALUES(ComputeExpression),
                AppliesTo = VALUES(AppliesTo), SortOrder = VALUES(SortOrder), IsHidden = VALUES(IsHidden),
                isdeleted = 0";

        // sortOffset shifts a block of fields to sit AFTER an earlier block in the same category
        // (the club MCR block gets +100 so it renders below the district TRF block).
        async Task SeedOneAsync(string categoryName, (string Group, string Key, string Label, string DataType, string? Unit, string Role, string? Compute, int Sort)[] fields, int sortOffset = 0)
        {
            var catId = categoryIds[categoryName];
            foreach (var f in fields)
            {
                await connection.ExecuteAsync(fieldSql, new
                {
                    CatId = catId, Group = f.Group, Key = f.Key, Label = f.Label,
                    DataType = f.DataType, Unit = f.Unit, Role = f.Role, Compute = f.Compute,
                    AppliesTo = ScopeFor(f.Key), Sort = f.Sort + sortOffset, Hidden = HiddenFor(f.Key) ? 1 : 0,
                });
            }
        }

        await SeedOneAsync("Membership", MembershipFields);
        await SeedOneAsync("TRF", FoundationFields);
        await SeedOneAsync("TRF", FoundationClubFields, sortOffset: 100); // club MCR block, after the district TRF block
        await SeedOneAsync("Youth Service", YouthFields);
        await SeedOneAsync("Public Image", PublicImageFields);

        // Retire any field no longer in a category's catalog (soft-delete — data is retained but
        // filtered out on read). Reactivate any catalog field that had been retired. Runs every
        // startup, so it also cleans up the fields removed in the 2026-09-02 DISHA-match rebuild.
        async Task RetireStaleAsync(string categoryName, string[] keepKeys)
        {
            var catId = categoryIds[categoryName];
            await connection.ExecuteAsync(
                "UPDATE goal_fields SET isdeleted = 1 WHERE fk_category_id = @Cat AND FieldKey NOT IN @Keep AND isdeleted = 0",
                new { Cat = catId, Keep = keepKeys });
            await connection.ExecuteAsync(
                "UPDATE goal_fields SET isdeleted = 0 WHERE fk_category_id = @Cat AND FieldKey IN @Keep AND isdeleted = 1",
                new { Cat = catId, Keep = keepKeys });
        }
        await RetireStaleAsync("Membership", MembershipFields.Select(f => f.Key).ToArray());
        await RetireStaleAsync("TRF", FoundationFields.Select(f => f.Key).Concat(FoundationClubFields.Select(f => f.Key)).ToArray());
        await RetireStaleAsync("Youth Service", YouthFields.Select(f => f.Key).ToArray());
        await RetireStaleAsync("Public Image", PublicImageFields.Select(f => f.Key).ToArray());
    }

    // Standard RI zonal-leadership designations. (Title, Avenue, RoleType, DefaultCategoryName, Sort).
    // RoleType decides the tier/scope: assistants support a FEW districts in one avenue+zone;
    // regional co-ordinators & Plan Leads cover ALL districts of one avenue in a zone; the Zonal
    // Action Plan roles span ALL categories across their zone(s). DefaultCategoryName maps the
    // avenue to a goal tab for messaging (E-MGA / EPNC / Polio → Foundation; NULL = all tabs).
    // The 6 current leadership roles (2026-08): 3 avenues × 2 levels. Zone-level roles use
    // RoleType AllDistrictsOneCategoryOneZone ("only for zones" — whole zone); district-level
    // Assistants use FewDistrictsOneCategoryOneZone ("only for districts" — pick districts).
    // The earlier extra roles (E/MGA, EPNC, Polio, Plan Leads, Zonal Action Plan) are deactivated
    // by SeedGoalLeadershipDesignationsAsync (kept in the table, IsActive=0, so re-enableable).
    private static readonly (string Title, string Avenue, string RoleType, string? Category, int Sort)[] LeadershipDesignations =
    {
        // Goal Setting RI Director — top of the hierarchy, covers a FEW ZONES across ALL avenues
        // (its own thing, unrelated to the member_roles RIDirector role). Scope = the selected
        // zones; a director never sees another director's zones.
        ("RI Director",                                                 "RI Director",           "AllCategoryAllDistrictsFewZones", null,          1),
        ("Rotary Membership Co-Ordinator (RMC)",                        "Membership",            "AllDistrictsOneCategoryOneZone", "Membership",   10),
        ("Assistant Rotary Co-Ordinator (ARC)",                        "Membership",            "FewDistrictsOneCategoryOneZone", "Membership",   11),
        // Youth Service had NO designation at all (user 2026-09-25), so the Role Assign screen never
        // offered a Youth Service tab — its Category tabs come from the distinct Avenue values here,
        // not from goal_categories. With no designation nobody could be appointed, which is why the
        // category had 0 Zone Co-ordinators and 0 District Assistants and never appeared in a ZC or
        // DA login or their reports. Sorted 15/16 so the tab sits after Membership, matching the
        // category order (Membership -> Youth Service -> TRF -> Public Image).
        ("Youth Service Co-Ordinator",                                  "Youth Service",         "AllDistrictsOneCategoryOneZone", "Youth Service", 15),
        ("Assistant Youth Service Co-Ordinator",                        "Youth Service",         "FewDistrictsOneCategoryOneZone", "Youth Service", 16),
        ("Regional Public Image Co-Ordinator (RPIC)",                   "Public Image",          "AllDistrictsOneCategoryOneZone", "Public Image", 20),
        ("Assistant Regional Public Image Co-Ordinator (ARPIC)",        "Public Image",          "FewDistrictsOneCategoryOneZone", "Public Image", 21),
        ("Regional Rotary Foundation Co-Ordinator (RRFC)",             "Foundation",            "AllDistrictsOneCategoryOneZone", "TRF",          30),
        ("Assistant Regional Rotary Foundation Co-Ordinator (ARRFC)",  "Foundation",            "FewDistrictsOneCategoryOneZone", "TRF",          31),
    };

    private static async Task SeedGoalLeadershipDesignationsAsync(MySqlConnection connection)
    {
        // Upsert the 6 current roles (force-active, so they're always available).
        foreach (var d in LeadershipDesignations)
        {
            await connection.ExecuteAsync(@"
                INSERT INTO goal_leadership_designations (Title, Avenue, RoleType, DefaultCategoryName, SortOrder, IsActive, isdeleted)
                VALUES (@Title, @Avenue, @RoleType, @Category, @Sort, 1, 0)
                ON DUPLICATE KEY UPDATE
                    Avenue = VALUES(Avenue), RoleType = VALUES(RoleType),
                    DefaultCategoryName = VALUES(DefaultCategoryName), SortOrder = VALUES(SortOrder),
                    IsActive = 1, isdeleted = 0",
                new { d.Title, d.Avenue, d.RoleType, d.Category, d.Sort });
        }

        // Deactivate every OTHER designation (the retired extras + any leftover) so only the 6
        // current roles surface in the picker. Kept in the table (not deleted) for easy revival.
        var keep = LeadershipDesignations.Select(x => x.Title).ToArray();
        await connection.ExecuteAsync(
            "UPDATE goal_leadership_designations SET IsActive = 0 WHERE Title NOT IN @Keep",
            new { Keep = keep });
    }

    private static async Task SeedOcvDocumentDataAsync(MySqlConnection connection)
    {
        // Seed categories
        await connection.ExecuteAsync(@"
            INSERT IGNORE INTO ocv_document_category (CategoryName, CategoryCode, SortOrder) VALUES
            ('Static Documents', 'static_documents', 1),
            ('Financial Documents', 'financial_documents', 2),
            ('Trust Documents', 'trust_documents', 3),
            ('Grants', 'grants', 4),
            ('Additional Documents', 'additional_documents', 5),
            ('Dues', 'dues', 6)");

        // Fetch the auto-generated category IDs
        var catStatic = await connection.ExecuteScalarAsync<int>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'static_documents'");
        var catFinancial = await connection.ExecuteScalarAsync<int>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'financial_documents'");
        var catTrust = await connection.ExecuteScalarAsync<int>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'trust_documents'");
        var catGrants = await connection.ExecuteScalarAsync<int>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'grants'");
        var catAdditional = await connection.ExecuteScalarAsync<int>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'additional_documents'");
        var catDues = await connection.ExecuteScalarAsync<int>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'dues'");

        var typeSql = @"INSERT INTO ocv_document_type (fk_category_id, TypeName, AllowMultiple, SortOrder, IsActive, isdeleted, created_date)
                        VALUES (@CatId, @Name, @AllowMultiple, @Sort, 1, 0, NOW())";

        // Static Documents
        await connection.ExecuteAsync(typeSql, new { CatId = catStatic, Name = "Club Constitution", AllowMultiple = 0, Sort = 1 });
        await connection.ExecuteAsync(typeSql, new { CatId = catStatic, Name = "Club Bylaws", AllowMultiple = 0, Sort = 2 });
        await connection.ExecuteAsync(typeSql, new { CatId = catStatic, Name = "Others", AllowMultiple = 1, Sort = 3 });
        await connection.ExecuteAsync(typeSql, new { CatId = catStatic, Name = "Manual of Procedure (MOP)", AllowMultiple = 0, Sort = 4 });

        // Financial Documents
        await connection.ExecuteAsync(typeSql, new { CatId = catFinancial, Name = "Audited Financials of Clubs- Earlier Year", AllowMultiple = 0, Sort = 1 });
        await connection.ExecuteAsync(typeSql, new { CatId = catFinancial, Name = "Club Budget", AllowMultiple = 0, Sort = 2 });
        await connection.ExecuteAsync(typeSql, new { CatId = catFinancial, Name = "Current Year's Club Accounts", AllowMultiple = 0, Sort = 3 });
        await connection.ExecuteAsync(typeSql, new { CatId = catFinancial, Name = "Others", AllowMultiple = 1, Sort = 4 });
        await connection.ExecuteAsync(typeSql, new { CatId = catFinancial, Name = "Club Plans and Objectives", AllowMultiple = 0, Sort = 5 });

        // Trust Documents
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "Audited Account", AllowMultiple = 0, Sort = 1 });
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "Trust Meetings minutes", AllowMultiple = 0, Sort = 2 });
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "Trust Budget", AllowMultiple = 0, Sort = 3 });
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "Copy Of IT Returns", AllowMultiple = 0, Sort = 4 });
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "80 G Certificate", AllowMultiple = 0, Sort = 5 });
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "FCRA Documents", AllowMultiple = 0, Sort = 6 });
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "Fixed Deposit/InvestMents", AllowMultiple = 0, Sort = 7 });
        await connection.ExecuteAsync(typeSql, new { CatId = catTrust, Name = "Others", AllowMultiple = 1, Sort = 8 });

        // Grants
        await connection.ExecuteAsync(typeSql, new { CatId = catGrants, Name = "District", AllowMultiple = 0, Sort = 1 });
        await connection.ExecuteAsync(typeSql, new { CatId = catGrants, Name = "Global", AllowMultiple = 0, Sort = 2 });
        await connection.ExecuteAsync(typeSql, new { CatId = catGrants, Name = "Others", AllowMultiple = 1, Sort = 3 });

        // Additional Documents
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Classification List(Filled and Unfilled)", AllowMultiple = 0, Sort = 1 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Existing and Probable Contributors To TRF", AllowMultiple = 0, Sort = 2 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Others", AllowMultiple = 1, Sort = 3 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Club goals list ( updated in Rotary.org)", AllowMultiple = 0, Sort = 4 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Club's \"My Rotary Data\" to be synchronized with \"ROW\"", AllowMultiple = 0, Sort = 5 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Updated Classification Roster of the club", AllowMultiple = 0, Sort = 6 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "List of Honorary members, if any", AllowMultiple = 0, Sort = 7 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "List of Major Donors/PHS/PHF with updated position of balances and potential contribution to Rotary Foundation", AllowMultiple = 0, Sort = 8 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "List of directors/Chairmen of various club committees and club committee plans", AllowMultiple = 0, Sort = 9 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Information on continued Project", AllowMultiple = 0, Sort = 10 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Important Files & Registers", AllowMultiple = 0, Sort = 11 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "List of Club's district officers of the club", AllowMultiple = 0, Sort = 12 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Major community projects in last 3 years", AllowMultiple = 0, Sort = 13 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Member's attendance list in District Events", AllowMultiple = 0, Sort = 14 });
        await connection.ExecuteAsync(typeSql, new { CatId = catAdditional, Name = "Planning for Service Projects (Global Grant, CSR or other)", AllowMultiple = 0, Sort = 15 });

        // Dues
        await connection.ExecuteAsync(typeSql, new { CatId = catDues, Name = "District", AllowMultiple = 0, Sort = 1 });
        await connection.ExecuteAsync(typeSql, new { CatId = catDues, Name = "Rotary News Trust", AllowMultiple = 0, Sort = 2 });
        await connection.ExecuteAsync(typeSql, new { CatId = catDues, Name = "RI Semi Annual1", AllowMultiple = 0, Sort = 3 });
        await connection.ExecuteAsync(typeSql, new { CatId = catDues, Name = "RI Semi Annual2", AllowMultiple = 0, Sort = 4 });
        await connection.ExecuteAsync(typeSql, new { CatId = catDues, Name = "Others", AllowMultiple = 1, Sort = 5 });
    }

    // Idempotent: ensures Q23 "Inter District Cricket Match" (zone-level) exists for every rotary year that has zonal awards goals.
    // Runs on every startup. If the question already exists for a year, it is left alone (no delete, no re-insert).
    // If the question_level column is missing, existing Q23 rows are updated to 'Zone'.
    private static async Task EnsureZoneCricketMatchAsync(MySqlConnection connection)
    {
        // Find all years that have a "C. OTHERS" or "EVENTS - GOALS & RECOGNITIONS" goal (means that year was seeded)
        var years = (await connection.QueryAsync<int>(
            "SELECT DISTINCT fk_year_id FROM zonal_awards_goal WHERE isdeleted = 0")).ToList();

        foreach (var yearId in years)
        {
            // Find the Events goal for this year (sort_order = 6)
            var eventsGoalId = await connection.ExecuteScalarAsync<int?>(
                "SELECT pk_id FROM zonal_awards_goal WHERE fk_year_id = @Y AND sort_order = 6 AND isdeleted = 0",
                new { Y = yearId });
            if (!eventsGoalId.HasValue) continue;

            // Check if Cricket Match question already exists for this year
            var existingQId = await connection.ExecuteScalarAsync<int?>(@"
                SELECT q.pk_id FROM zonal_awards_question q
                JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
                WHERE g.fk_year_id = @Y AND q.category LIKE '%Cricket%' AND q.isdeleted = 0
                LIMIT 1", new { Y = yearId });

            int qId;
            if (existingQId.HasValue)
            {
                qId = existingQId.Value;
                // Make sure it's marked as Zone level
                await connection.ExecuteAsync(
                    "UPDATE zonal_awards_question SET question_level = 'Zone' WHERE pk_id = @Id",
                    new { Id = qId });
            }
            else
            {
                // Insert once (idempotent because of the existence check above)
                qId = await connection.ExecuteScalarAsync<int>(@"
                    INSERT INTO zonal_awards_question (fk_goal_id, auto_or_manual, question_level, sr_no, sub_title, category, sort_order)
                    VALUES (@G, 'Auto', 'Zone', '1', 'Events', 'Inter District Cricket Match', 23);
                    SELECT LAST_INSERT_ID();", new { G = eventsGoalId.Value });
            }

            // Ensure the 3 options exist — one per tournament stage. Never delete or re-insert; only add if missing.
            var optionsToEnsure = new[] {
                new { Label = "Hosting Quarter Finals", PLabel = "400", Pts = 400, Sort = 1 },
                new { Label = "Hosting Semi Finals",    PLabel = "800", Pts = 800, Sort = 2 },
                new { Label = "Hosting Finals",         PLabel = "1000", Pts = 1000, Sort = 3 },
            };

            foreach (var o in optionsToEnsure)
            {
                var existingOptId = await connection.ExecuteScalarAsync<int?>(@"
                    SELECT pk_id FROM zonal_awards_question_option
                    WHERE fk_question_id = @Q AND goal_requirement_label = @L AND isdeleted = 0 LIMIT 1",
                    new { Q = qId, L = o.Label });
                if (existingOptId.HasValue) continue;

                await connection.ExecuteAsync(@"
                    INSERT INTO zonal_awards_question_option
                    (fk_question_id, goal_requirement_label, points_label, mini, maxi, points, atleast, subtype, input_type, question_type_for_import, report_use_title, sort_order)
                    VALUES (@Q, @L, @PL, 0, 0, @Pts, 0, NULL, NULL, NULL, NULL, @Sort)",
                    new { Q = qId, L = o.Label, PL = o.PLabel, Pts = o.Pts, Sort = o.Sort });
            }
        }
    }

    private static async Task SeedZonalAwardsAsync(MySqlConnection connection, int yearId)
    {
        // ── Goals (12) ──
        await connection.ExecuteAsync(@"
            INSERT INTO zonal_awards_goal (fk_year_id, title, max_points, max_remark, sort_order) VALUES
            (@Y,'A. NEW CLUBS IN THE DISTRICT',2000,'Points not exceeding 2000 points for Monthly Awards in this A Category',1),
            (@Y,'B. MEMBERSHIP STATUS IN THE DISTRICT',3000,'Points not exceeding 3000 points for Monthly Awards in this B Category',2),
            (@Y,'C. OTHERS',3000,'Points not exceeding 3000 for Monthly Award in this C category',3),
            (@Y,'PROJECTS - GOALS & RECOGNITIONS',NULL,NULL,4),
            (@Y,'RYLA',3000,'Total Score not to exceed 3000 points for monthly award under this category',5),
            (@Y,'EVENTS - GOALS & RECOGNITIONS',3000,'Total Score not to exceed 3000 points for monthly award under this category',6),
            (@Y,'A. Awareness and Training',3000,'Total Score not to exceed 3000 points for monthly award',7),
            (@Y,'B. Public Image through Digital Media',NULL,NULL,8),
            (@Y,'C. Public Image through Projects',NULL,NULL,9),
            (@Y,'D. Display',NULL,NULL,10),
            (@Y,'E. Print Media',NULL,NULL,11),
            (@Y,'FOUNDATION GOALS',6000,'Total Score not to exceed 6000 points for monthly award',12)", new { Y = yearId });

        // Get goal IDs
        var goals = (await connection.QueryAsync<dynamic>("SELECT pk_id, sort_order FROM zonal_awards_goal WHERE fk_year_id=@Y ORDER BY sort_order", new { Y = yearId })).ToList();
        int g1=goals[0].pk_id, g2=goals[1].pk_id, g3=goals[2].pk_id, g4=goals[3].pk_id, g5=goals[4].pk_id, g6=goals[5].pk_id;
        int g7=goals[6].pk_id, g8=goals[7].pk_id, g9=goals[8].pk_id, g10=goals[9].pk_id, g11=goals[10].pk_id, g12=goals[11].pk_id;

        // ── Questions (52) ──
        var qSql = @"INSERT INTO zonal_awards_question (fk_goal_id, auto_or_manual, sr_no, sub_title, category, sort_order) VALUES (@G,@AM,@Sr,@Sub,@Cat,@Sort)";
        // Goal 1: New Clubs
        await connection.ExecuteAsync(qSql, new { G=g1, AM="Auto",   Sr="A1", Sub="Membership", Cat="Number of New Rotary Clubs", Sort=1 });
        await connection.ExecuteAsync(qSql, new { G=g1, AM="Manual", Sr="A2", Sub="Membership", Cat="Special Category New Clubs", Sort=2 });
        await connection.ExecuteAsync(qSql, new { G=g1, AM="Manual", Sr="A3", Sub="Membership", Cat="Bonus Points", Sort=3 });
        // Goal 2: Membership Status
        await connection.ExecuteAsync(qSql, new { G=g2, AM="Auto",   Sr="B1", Sub="Membership", Cat="Average Members per Club in District", Sort=4 });
        await connection.ExecuteAsync(qSql, new { G=g2, AM="Auto",   Sr="B2", Sub="Membership", Cat="Healthy Clubs - Red(10-25)/Amber(26-40)/Green(41+)", Sort=5 });
        await connection.ExecuteAsync(qSql, new { G=g2, AM="Manual", Sr="B3", Sub="Membership", Cat="Average Age of Members in District (My Rotary Registration Min 70%)", Sort=6 });
        await connection.ExecuteAsync(qSql, new { G=g2, AM="Auto",   Sr="B4", Sub="Membership", Cat="Women In Rotary", Sort=7 });
        await connection.ExecuteAsync(qSql, new { G=g2, AM="Auto",   Sr="B5", Sub="Membership", Cat="Percentage of Women In Rotary", Sort=8 });
        // Goal 3: Others
        await connection.ExecuteAsync(qSql, new { G=g3, AM="Manual", Sr="C1", Sub="Others", Cat="Club Constitution & By-Laws", Sort=9 });
        await connection.ExecuteAsync(qSql, new { G=g3, AM="Manual", Sr="C2", Sub="Others", Cat="Clubs having their own registered Trust", Sort=10 });
        await connection.ExecuteAsync(qSql, new { G=g3, AM="Manual", Sr="C3", Sub="Others", Cat="Registering in My Rotary", Sort=11 });
        await connection.ExecuteAsync(qSql, new { G=g3, AM="Manual", Sr="C4", Sub="Others", Cat="District Directory", Sort=12 });
        await connection.ExecuteAsync(qSql, new { G=g3, AM="Manual", Sr="C5.a", Sub="Others", Cat="Creating Record", Sort=13 });
        // Goal 4: Projects
        await connection.ExecuteAsync(qSql, new { G=g4, AM="Manual", Sr="A1", Sub="Projects", Cat="Jnana sethu - 1 million refurbished/New computers distribution", Sort=14 });
        await connection.ExecuteAsync(qSql, new { G=g4, AM="Auto",   Sr="A2", Sub="Projects", Cat="Bosch Skill Center (Each)", Sort=15 });
        await connection.ExecuteAsync(qSql, new { G=g4, AM="Manual", Sr="A3", Sub="Projects", Cat="Kotinati (Tree Plantation)", Sort=16 });
        await connection.ExecuteAsync(qSql, new { G=g4, AM="Auto",   Sr="A4", Sub="Projects", Cat="Lake Rejuvenation (Each)", Sort=17 });
        await connection.ExecuteAsync(qSql, new { G=g4, AM="Manual", Sr="A5", Sub="Projects", Cat="Blood Donation Drive", Sort=18 });
        await connection.ExecuteAsync(qSql, new { G=g4, AM="Auto",   Sr="A6", Sub="Projects", Cat="Medical Mission (Each)", Sort=19 });
        // Goal 5: RYLA
        await connection.ExecuteAsync(qSql, new { G=g5, AM="Auto", Sr="B1", Sub="RYLA", Cat="Local - Each (Min 40 Students)", Sort=20 });
        await connection.ExecuteAsync(qSql, new { G=g5, AM="Auto", Sr="B2", Sub="RYLA", Cat="National - Each (Min 60 Students)", Sort=21 });
        await connection.ExecuteAsync(qSql, new { G=g5, AM="Auto", Sr="B3", Sub="RYLA", Cat="International - Each (Min 100 Students)", Sort=22 });
        // Goal 6: Events
        // Q23 (Cricket Match) removed — zone-level only, will add later
        await connection.ExecuteAsync(qSql, new { G=g6, AM="Auto",   Sr="2",  Sub="Events", Cat="Marathon at least 250 members participation (Each)", Sort=24 });
        await connection.ExecuteAsync(qSql, new { G=g2, AM="Manual", Sr="B6",  Sub="Membership", Cat="Intercity General Forum (ICGF) - Each (Min gathering of 300 participants)", Sort=25 });
        await connection.ExecuteAsync(qSql, new { G=g6, AM="Auto",   Sr="4",  Sub="Events", Cat="Trade Fair in association with Local/National Trade bodies (Each)", Sort=26 });
        await connection.ExecuteAsync(qSql, new { G=g6, AM="Auto",   Sr="5",  Sub="Events", Cat="Rotary Friendship Exchange (Min 3 Families) Within Zone - (Each)", Sort=27 });
        await connection.ExecuteAsync(qSql, new { G=g6, AM="Auto",   Sr="6",  Sub="Events", Cat="Rotary Friendship Exchange (Min 3 Families) National - (Each)", Sort=28 });
        await connection.ExecuteAsync(qSql, new { G=g6, AM="Auto",   Sr="7",  Sub="Events", Cat="Rotary Friendship Exchange (Min 3 Families) International - (Each)", Sort=29 });
        // Goal 7: Awareness
        await connection.ExecuteAsync(qSql, new { G=g7, AM="Manual", Sr="A1", Sub="Awareness and training", Cat="Inter District Public Image Seminar (Min 100 Participants)", Sort=30 });
        await connection.ExecuteAsync(qSql, new { G=g7, AM="Manual", Sr="A2", Sub="Awareness and training", Cat="District Public Image Seminar (Min 100 Participants)", Sort=31 });
        // Goal 8: Digital Media
        await connection.ExecuteAsync(qSql, new { G=g8, AM="Manual", Sr="B1", Sub="Public Image through Digital Media", Cat="Maintaining and uploading in social media minimum 5 posts per month", Sort=32 });
        await connection.ExecuteAsync(qSql, new { G=g8, AM="Manual", Sr="B2", Sub="Public Image through Digital Media", Cat="Clubs having live websites", Sort=33 });
        await connection.ExecuteAsync(qSql, new { G=g8, AM="Manual", Sr="B3", Sub="Public Image through Digital Media", Cat="Broadcasting Rotary events on TV/Radio at least 5 programs", Sort=34 });
        // Goal 9: Public Image Projects
        await connection.ExecuteAsync(qSql, new { G=g9, AM="Auto", Sr="C1", Sub="Public Image", Cat="Adopt a Road/Garden/Park with display board", Sort=35 });
        await connection.ExecuteAsync(qSql, new { G=g9, AM="Auto", Sr="C2", Sub="Public Image", Cat="Organising public rallies/marathons/human chains (Min 100+ Participants)", Sort=36 });
        // Goal 10: Display
        await connection.ExecuteAsync(qSql, new { G=g10, AM="Auto", Sr="D1", Sub="Public Image", Cat="City Bus/Auto/Metro Stations/Airports Hoardings/Wall painting", Sort=37 });
        // Goal 11: Print Media
        await connection.ExecuteAsync(qSql, new { G=g11, AM="Manual", Sr="E1", Sub="Print Media", Cat="Releasing Bulletin/Newsletter every month", Sort=38 });
        await connection.ExecuteAsync(qSql, new { G=g11, AM="Manual", Sr="E2", Sub="Print Media", Cat="Executing Rotary events in public print media", Sort=39 });
        // Goal 12: Foundation (Q40-Q52)
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="1",  Sub="Foundation Goals", Cat="Arch Klump Society", Sort=40 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="2",  Sub="Foundation Goals", Cat="Endowment", Sort=41 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="3",  Sub="Foundation Goals", Cat="Bequest Society", Sort=42 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="4",  Sub="Foundation Goals", Cat="Directed Gift", Sort=43 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="5",  Sub="Foundation Goals", Cat="DDF (Pledge to polio)", Sort=44 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="6",  Sub="Foundation Goals", Cat="EPF", Sort=45 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="7",  Sub="Foundation Goals", Cat="Polio Plus Society", Sort=46 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="8",  Sub="Foundation Goals", Cat="Annual Fund", Sort=47 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="9",  Sub="Foundation Goals", Cat="PHF", Sort=48 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="10", Sub="Foundation Goals", Cat="Hall of Honor Club (Min 25 Members club)", Sort=49 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="11", Sub="Foundation Goals", Cat="PHSM", Sort=50 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="12", Sub="Foundation Goals", Cat="Major Donors", Sort=51 });
        await connection.ExecuteAsync(qSql, new { G=g12, AM="Auto", Sr="13", Sub="Foundation Goals", Cat="CSR project with RFI", Sort=52 });

        // Get all question IDs
        var qs = (await connection.QueryAsync<dynamic>("SELECT pk_id, sort_order FROM zonal_awards_question ORDER BY sort_order")).ToList();
        // Map sort_order to pk_id: q[0]=sort1, q[1]=sort2, etc.
        var qMap = qs.ToDictionary(q => (int)q.sort_order, q => (int)q.pk_id);

        // ── Options (194) ──
        var oSql = @"INSERT INTO zonal_awards_question_option (fk_question_id, goal_requirement_label, points_label, mini, maxi, points, atleast, subtype, input_type, question_type_for_import, report_use_title, sort_order)
                     VALUES (@Q,@Label,@PLabel,@Min,@Max,@Pts,@At,@Sub,@Inp,@Imp,@Rep,@Sort)";

        // Q1 (sort=1): Number of New Rotary Clubs - 4 range options
        int q1=qMap[1];
        await connection.ExecuteAsync(oSql, new { Q=q1, Label="Upto 10",     PLabel="100 Per Club",  Min=1,  Max=10,     Pts=100, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q1, Label="11-15",       PLabel="150 per club",  Min=10, Max=15,     Pts=150, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q1, Label="16-20",       PLabel="250 per club",  Min=15, Max=20,     Pts=250, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q1, Label="21 & Above",  PLabel="400 per club",  Min=20, Max=100000, Pts=400, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        // Q2 (sort=2): Special Category New Clubs - 5 sub-items
        int q2=qMap[2];
        await connection.ExecuteAsync(oSql, new { Q=q2, Label="Nextgen club",               PLabel="200 per club", Min=0, Max=0, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp="Nextgen club",               Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q2, Label="Majority women member club",  PLabel="200 per club", Min=0, Max=0, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp="Majority women member club",  Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q2, Label="Cause Based Club",            PLabel="200 per club", Min=0, Max=0, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp="Cause Based Club",            Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q2, Label="Fellowship Based Club",       PLabel="200 per club", Min=0, Max=0, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp="Fellowship Based Club",       Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q2, Label="All couple club",             PLabel="200 per club", Min=0, Max=0, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp="All couple club",             Rep=(string?)null, Sort=5 });

        // Q3 (sort=3): Bonus Points - 1 option
        int q3=qMap[3];
        await connection.ExecuteAsync(oSql, new { Q=q3, Label="Implementing 10:20:30 formula", PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=(int?)null, Inp=(string?)null, Imp="Implementing 10:20:30 formula", Rep=(string?)null, Sort=1 });

        // Q4 (sort=4): Average Members per Club - 3 range options
        int q4=qMap[4];
        await connection.ExecuteAsync(oSql, new { Q=q4, Label="Average Members per club 40+",  PLabel="100", Min=40, Max=44,     Pts=100, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q4, Label="Average Members per club 45+",  PLabel="300", Min=44, Max=49,     Pts=300, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q4, Label="Average Members per club 50+",  PLabel="750", Min=49, Max=100000, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        // Q5 (sort=5): Healthy Clubs - 3 range options
        int q5=qMap[5];
        await connection.ExecuteAsync(oSql, new { Q=q5, Label="District with Less than 30% Red Clubs",    PLabel="500", Min=0,  Max=30,  Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q5, Label="District with 40%+ Amber Clubs",           PLabel="500", Min=40, Max=100, Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q5, Label="District with more than 30%+ Green Clubs", PLabel="750", Min=30, Max=100, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        // Q6 (sort=6): Average Age - radio/choose one
        int q6=qMap[6];
        await connection.ExecuteAsync(oSql, new { Q=q6, Label="Less than 60", PLabel="200", Min=0, Max=0, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q6, Label="Less than 55", PLabel="400", Min=0, Max=0, Pts=400, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q6, Label="Less than 50", PLabel="600", Min=0, Max=0, Pts=600, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q6, Label="None",         PLabel="0",   Min=0, Max=0, Pts=0,   At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        // Q7 (sort=7): Women In Rotary - 3 range options
        int q7=qMap[7];
        await connection.ExecuteAsync(oSql, new { Q=q7, Label="33%+ clubs with at least 4 women members", PLabel="200",  Min=33, Max=65,  Pts=200,  At=4, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q7, Label="66%+ clubs with at least 4 women members", PLabel="600",  Min=65, Max=89,  Pts=600,  At=4, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q7, Label="90%+ clubs with at least 4 women members", PLabel="1000", Min=89, Max=100, Pts=1000, At=4, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        // Q8 (sort=8): Percentage of Women - 4 range options
        int q8=qMap[8];
        await connection.ExecuteAsync(oSql, new { Q=q8, Label="15%+ Women Member",          PLabel="250",  Min=15, Max=19,  Pts=250,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q8, Label="20%+ Women Member",          PLabel="500",  Min=19, Max=24,  Pts=500,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q8, Label="25%+ Women Member",          PLabel="750",  Min=24, Max=29,  Pts=750,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q8, Label="30% and above Women Member", PLabel="1000", Min=29, Max=100, Pts=1000, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        // Q9-Q13 (sort=9-13): Others - Manual questions with radio options
        int q9=qMap[9];
        await connection.ExecuteAsync(oSql, new { Q=q9, Label="33% & above Members in the District", PLabel="100", Min=0, Max=0, Pts=100, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q9, Label="66% & above Members in the District", PLabel="300", Min=0, Max=0, Pts=300, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q9, Label="90% & above Members in the District", PLabel="750", Min=0, Max=0, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q9, Label="None", PLabel="0", Min=0, Max=0, Pts=0, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        int q10=qMap[10];
        await connection.ExecuteAsync(oSql, new { Q=q10, Label="10%+ Clubs",        PLabel="200", Min=0, Max=0, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q10, Label="20%+ Clubs",        PLabel="400", Min=0, Max=0, Pts=400, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q10, Label="30% & Above Clubs", PLabel="750", Min=0, Max=0, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q10, Label="None",              PLabel="0",   Min=0, Max=0, Pts=0,   At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        int q11=qMap[11];
        await connection.ExecuteAsync(oSql, new { Q=q11, Label="33%+ Members in the District", PLabel="100", Min=0, Max=0, Pts=100, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q11, Label="66%+ Members in the District", PLabel="300", Min=0, Max=0, Pts=300, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q11, Label="90%+ Members in the District", PLabel="750", Min=0, Max=0, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q11, Label="None",                         PLabel="0",   Min=0, Max=0, Pts=0,   At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        int q12=qMap[12]; // District Directory - radio
        await connection.ExecuteAsync(oSql, new { Q=q12, Label="Release of District Directory on or before 30th June 2025", PLabel="500",  Min=0, Max=0, Pts=500,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q12, Label="Release of District Directory on or before 31st May 2025",  PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q12, Label="Released on 1st July or later",                             PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        int q13=qMap[13]; // Creating Record - complex multi-subtype
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="Breaking previous district record of highest membership",      PLabel="500",        Min=0, Max=0, Pts=500,  At=0, Sub=1, Inp=(string?)null,  Imp="Breaking previous district record of highest membership in the district(Yes/No)", Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="No",                                                           PLabel="0",          Min=0, Max=0, Pts=0,    At=0, Sub=1, Inp=(string?)null,  Imp="Breaking previous district record of highest membership in the district(Yes/No)", Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="a. By 30th Sept 2025",                                         PLabel="1000 Bonus", Min=0, Max=0, Pts=1000, At=0, Sub=2, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="b. By 31st Dec 2025",                                          PLabel="750 Bonus",  Min=0, Max=0, Pts=750,  At=0, Sub=2, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="c. None",                                                      PLabel="0",          Min=0, Max=0, Pts=0,    At=0, Sub=2, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=5 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="Breaking the record highest new club in a year in the district",PLabel="500",        Min=0, Max=0, Pts=500,  At=0, Sub=3, Inp=(string?)null,  Imp="Breaking the record highest new club in a year in the district(Yes/No)", Rep=(string?)null, Sort=6 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="No",                                                           PLabel="0",          Min=0, Max=0, Pts=0,    At=0, Sub=3, Inp=(string?)null,  Imp="Breaking the record highest new club in a year in the district(Yes/No)", Rep=(string?)null, Sort=7 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="a. By 30th Sept 2025",                                         PLabel="1000 Bonus", Min=0, Max=0, Pts=1000, At=0, Sub=4, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=8 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="b. By 31st Dec 2025",                                          PLabel="750 Bonus",  Min=0, Max=0, Pts=750,  At=0, Sub=4, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=9 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="c. None",                                                      PLabel="0",          Min=0, Max=0, Pts=0,    At=0, Sub=4, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=10 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="Breaking the record of adding highest number of women members", PLabel="750",        Min=0, Max=0, Pts=750,  At=0, Sub=5, Inp=(string?)null,  Imp="Breaking the record of adding highest number of women members in the district(Yes/No)", Rep=(string?)null, Sort=11 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="No",                                                           PLabel="0",          Min=0, Max=0, Pts=0,    At=0, Sub=5, Inp=(string?)null,  Imp="Breaking the record of adding highest number of women members in the district(Yes/No)", Rep=(string?)null, Sort=12 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="a. By 30th Sept 2025",                                         PLabel="1000 Bonus", Min=0, Max=0, Pts=1000, At=0, Sub=6, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=13 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="b. By 31st Dec 2025",                                          PLabel="750 Bonus",  Min=0, Max=0, Pts=750,  At=0, Sub=6, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=14 });
        await connection.ExecuteAsync(oSql, new { Q=q13, Label="c. None",                                                      PLabel="0",          Min=0, Max=0, Pts=0,    At=0, Sub=6, Inp=(string?)null,  Imp="By 30th Sept 2025 / By 31st Dec 2025", Rep=(string?)null, Sort=15 });

        // Q14-Q19 (sort=14-19): Projects
        int q14=qMap[14]; // Jnana sethu - range
        await connection.ExecuteAsync(oSql, new { Q=q14, Label="100 to 500",   PLabel="300",  Min=0, Max=0, Pts=300,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q14, Label="501-2000",     PLabel="600",  Min=0, Max=0, Pts=600,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q14, Label="2001-4000",    PLabel="900",  Min=0, Max=0, Pts=900,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q14, Label="Above 4000",   PLabel="1200", Min=0, Max=0, Pts=1200, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q14, Label="None",         PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });

        int q15=qMap[15]; // Bosch Skill Center
        await connection.ExecuteAsync(oSql, new { Q=q15, Label="1",          PLabel="500", Min=0, Max=1,      Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q15, Label="2 & Above",  PLabel="750", Min=2, Max=100000, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q16=qMap[16]; // Kotinati Tree Plantation - range
        await connection.ExecuteAsync(oSql, new { Q=q16, Label="500+",        PLabel="200",  Min=0, Max=0, Pts=200,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q16, Label="1000 - 2500", PLabel="400",  Min=0, Max=0, Pts=400,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q16, Label="2501 - 5000", PLabel="800",  Min=0, Max=0, Pts=800,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q16, Label="Above 5000",  PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q16, Label="None",        PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });

        int q17=qMap[17]; // Lake Rejuvenation
        await connection.ExecuteAsync(oSql, new { Q=q17, Label="1",          PLabel="500", Min=0, Max=1,   Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q17, Label="2 & Above",  PLabel="750", Min=2, Max=100, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q18=qMap[18]; // Blood Donation Drive - range
        await connection.ExecuteAsync(oSql, new { Q=q18, Label="100 to 500 Units",  PLabel="200",  Min=0, Max=0, Pts=200,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q18, Label="501 - 1000 Units",  PLabel="400",  Min=0, Max=0, Pts=400,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q18, Label="1001 - 2000 Units", PLabel="800",  Min=0, Max=0, Pts=800,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q18, Label="2000+ Units",       PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q18, Label="None",              PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });

        int q19=qMap[19]; // Medical Mission
        await connection.ExecuteAsync(oSql, new { Q=q19, Label="India",  PLabel="750",  Min=0, Max=0, Pts=750,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q19, Label="Abroad", PLabel="1500", Min=0, Max=0, Pts=1500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        // Q20-Q22 (sort=20-22): RYLA
        int q20=qMap[20]; // Local
        await connection.ExecuteAsync(oSql, new { Q=q20, Label="upto 5",     PLabel="200",  Min=0,  Max=5,      Pts=200,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q20, Label="6 to 10",    PLabel="600",  Min=6,  Max=10,     Pts=600,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q20, Label="10 & above", PLabel="1000", Min=10, Max=100000, Pts=1000, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        int q21=qMap[21]; // National
        await connection.ExecuteAsync(oSql, new { Q=q21, Label="1",    PLabel="500", Min=0, Max=1,      Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q21, Label="2+",   PLabel="750", Min=2, Max=100000, Pts=750, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q22=qMap[22]; // International
        await connection.ExecuteAsync(oSql, new { Q=q22, Label="First",  PLabel="750",  Min=0, Max=1,     Pts=750,  At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q22, Label="Second", PLabel="1000", Min=2, Max=10000, Pts=1000, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        // Q23-Q29 (sort=23-29): Events
        // Q23 (Cricket Match) removed — zone-level only

        int q24=qMap[24]; // Marathon
        await connection.ExecuteAsync(oSql, new { Q=q24, Label="1",          PLabel="400", Min=0, Max=1,      Pts=400, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q24, Label="2 & above",  PLabel="600", Min=2, Max=100000, Pts=600, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q25=qMap[25]; // ICGF
        await connection.ExecuteAsync(oSql, new { Q=q25, Label="1 & 2",      PLabel="400", Min=0, Max=2,     Pts=400, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q25, Label="3 & Above",  PLabel="600", Min=3, Max=10000, Pts=600, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q26=qMap[26]; // Trade Fair
        await connection.ExecuteAsync(oSql, new { Q=q26, Label="1",          PLabel="400", Min=0, Max=1,      Pts=400, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q26, Label="2 & Above",  PLabel="800", Min=2, Max=100000, Pts=800, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q27=qMap[27]; // Friendship Exchange Within Zone
        await connection.ExecuteAsync(oSql, new { Q=q27, Label="upto 2",     PLabel="300", Min=0, Max=2,      Pts=300, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q27, Label="3 & Above",  PLabel="500", Min=3, Max=100000, Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q28=qMap[28]; // Friendship Exchange National
        await connection.ExecuteAsync(oSql, new { Q=q28, Label="upto 2",     PLabel="400", Min=0, Max=2,      Pts=400, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q28, Label="3 & Above",  PLabel="600", Min=3, Max=100000, Pts=600, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q29=qMap[29]; // Friendship Exchange International
        await connection.ExecuteAsync(oSql, new { Q=q29, Label="upto 2",     PLabel="600", Min=0, Max=2,      Pts=600, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q29, Label="3 & Above",  PLabel="800", Min=3, Max=100000, Pts=800, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        // Q30-Q31 (sort=30-31): Awareness - radio
        int q30=qMap[30];
        await connection.ExecuteAsync(oSql, new { Q=q30, Label="1",    PLabel="250", Min=0, Max=0, Pts=250, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q30, Label="2",    PLabel="500", Min=0, Max=0, Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q30, Label="None", PLabel="0",   Min=0, Max=0, Pts=0,   At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        int q31=qMap[31];
        await connection.ExecuteAsync(oSql, new { Q=q31, Label="1",    PLabel="250", Min=0, Max=0, Pts=250, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q31, Label="2",    PLabel="500", Min=0, Max=0, Pts=500, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q31, Label="None", PLabel="0",   Min=0, Max=0, Pts=0,   At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        // Q32-Q34 (sort=32-34): Digital Media - multi-subtype (District Yes/No + % clubs)
        int q32=qMap[32];
        await connection.ExecuteAsync(oSql, new { Q=q32, Label="District",               PLabel="500",  Min=0, Max=0, Pts=500,  At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q32, Label="District - No",          PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q32, Label="33%+ clubs in District", PLabel="200",  Min=0, Max=0, Pts=200,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q32, Label="66%+ clubs in District", PLabel="750",  Min=0, Max=0, Pts=750,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q32, Label="90%+ Clubs in District", PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });
        await connection.ExecuteAsync(oSql, new { Q=q32, Label="None",                   PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=6 });

        int q33=qMap[33];
        await connection.ExecuteAsync(oSql, new { Q=q33, Label="District",               PLabel="500",  Min=0, Max=0, Pts=500,  At=0, Sub=1, Inp="District Yes / No", Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q33, Label="District - No",          PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=1, Inp="District Yes / No", Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q33, Label="33%+ clubs in District", PLabel="200",  Min=0, Max=0, Pts=200,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q33, Label="66%+ clubs in District", PLabel="750",  Min=0, Max=0, Pts=750,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q33, Label="90%+ Clubs in District", PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });
        await connection.ExecuteAsync(oSql, new { Q=q33, Label="None",                   PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=6 });

        int q34=qMap[34];
        await connection.ExecuteAsync(oSql, new { Q=q34, Label="District",               PLabel="500",  Min=0, Max=0, Pts=500,  At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q34, Label="District - No",          PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q34, Label="33%+ clubs in District", PLabel="200",  Min=0, Max=0, Pts=200,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q34, Label="66%+ clubs in District", PLabel="750",  Min=0, Max=0, Pts=750,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q34, Label="90%+ Clubs in District", PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });
        await connection.ExecuteAsync(oSql, new { Q=q34, Label="None",                   PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=6 });

        // Q35-Q37 (sort=35-37): Public Image Projects & Display
        int q35=qMap[35]; // Adopt a Road
        await connection.ExecuteAsync(oSql, new { Q=q35, Label="upto 5",      PLabel="100 per Project", Min=0, Max=5,      Pts=100, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q35, Label="6 and above", PLabel="200 per Project", Min=6, Max=100000, Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q36=qMap[36]; // Public rallies
        await connection.ExecuteAsync(oSql, new { Q=q36, Label="upto 5",       PLabel="200 per event", Min=0, Max=5,      Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q36, Label="6 and above",  PLabel="300 per event", Min=6, Max=100000, Pts=300, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        int q37=qMap[37]; // City Bus/Hoardings
        await connection.ExecuteAsync(oSql, new { Q=q37, Label="upto 5",      PLabel="200", Min=0, Max=5,      Pts=200, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q37, Label="6 & above",   PLabel="300", Min=6, Max=100000, Pts=300, At=0, Sub=(int?)null, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });

        // Q38-Q39 (sort=38-39): Print Media - multi-subtype
        int q38=qMap[38];
        await connection.ExecuteAsync(oSql, new { Q=q38, Label="District",               PLabel="500",  Min=0, Max=0, Pts=500,  At=0, Sub=1, Inp="District Yes / No", Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q38, Label="District - No",          PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=1, Inp="District Yes / No", Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q38, Label="33%+ clubs in District", PLabel="200",  Min=0, Max=0, Pts=200,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q38, Label="66%+ clubs in District", PLabel="750",  Min=0, Max=0, Pts=750,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q38, Label="90%+ Clubs in District", PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });
        await connection.ExecuteAsync(oSql, new { Q=q38, Label="None",                   PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=6 });

        int q39=qMap[39];
        await connection.ExecuteAsync(oSql, new { Q=q39, Label="District",               PLabel="500",  Min=0, Max=0, Pts=500,  At=0, Sub=1, Inp="District Yes / No", Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q39, Label="District - No",          PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=1, Inp="District Yes / No", Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q39, Label="33%+ clubs in District", PLabel="200",  Min=0, Max=0, Pts=200,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q39, Label="66%+ clubs in District", PLabel="750",  Min=0, Max=0, Pts=750,  At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q39, Label="90%+ Clubs in District", PLabel="1000", Min=0, Max=0, Pts=1000, At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=5 });
        await connection.ExecuteAsync(oSql, new { Q=q39, Label="None",                   PLabel="0",    Min=0, Max=0, Pts=0,    At=0, Sub=2, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=6 });

        // Q40-Q52 (sort=40-52): Foundation Goals - multi-subtype with Number + Yes/No
        int q40=qMap[40]; // AKS
        await connection.ExecuteAsync(oSql, new { Q=q40, Label="First AKS for the year",              PLabel="500 per AKS",  Min=0, Max=1,      Pts=500,  At=0, Sub=1, Inp="Option1", Imp=(string?)null,                   Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q40, Label="Second AKS for the year",             PLabel="750 per AKS",  Min=1, Max=2,      Pts=750,  At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q40, Label="Third AKS & Above for the year",      PLabel="1000 per AKS", Min=2, Max=100000, Pts=1000, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q40, Label="First time district entering AKS club",PLabel="1000 Bonus",  Min=0, Max=0,      Pts=1000, At=0, Sub=2, Inp="Yes/No",     Imp="First time district entering AKS club", Rep=(string?)null, Sort=4 });

        int q41=qMap[41]; // Endowment
        await connection.ExecuteAsync(oSql, new { Q=q41, Label="First for the year",           PLabel="500",        Min=0, Max=1,      Pts=500, At=0, Sub=1, Inp="Option1",    Imp=(string?)null,                          Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q41, Label="Second for the year",          PLabel="600",        Min=1, Max=2,      Pts=600, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                          Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q41, Label="Third & Above for the year",   PLabel="800",        Min=2, Max=100000, Pts=800, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                          Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q41, Label="$100,000 & above for the year",PLabel="750 Bonus",  Min=0, Max=0,      Pts=750, At=0, Sub=2, Inp="Yes/No",     Imp="$100,000 & above for the year",        Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q41, Label="First time by District",       PLabel="750 Bonus",  Min=0, Max=0,      Pts=750, At=0, Sub=3, Inp="Yes/No",     Imp="First time by District",               Rep=(string?)null, Sort=5 });

        int q42=qMap[42]; // Bequest Society
        await connection.ExecuteAsync(oSql, new { Q=q42, Label="upto 5 for the year",          PLabel="100 per BS", Min=0,  Max=5,      Pts=100, At=0, Sub=1, Inp="Option1",    Imp=(string?)null,                          Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q42, Label="6 to 10 for the year",         PLabel="200 per BS", Min=6,  Max=10,     Pts=200, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                          Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q42, Label="10 & above for the year",      PLabel="300 per BS", Min=10, Max=100000, Pts=300, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                          Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q42, Label="$100,000 & above for the year",PLabel="750 Bonus",  Min=0,  Max=0,      Pts=750, At=0, Sub=2, Inp="Yes/No",     Imp="$100,000 & above for the year",        Rep=(string?)null, Sort=4 });

        int q43=qMap[43]; // Directed Gift
        await connection.ExecuteAsync(oSql, new { Q=q43, Label="First Directed Gift for the year",  PLabel="100 per Gift", Min=0, Max=1,      Pts=100, At=0, Sub=1, Inp="Option1",    Imp=(string?)null,                          Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q43, Label="Second Directed Gift for the year", PLabel="200 per Gift", Min=1, Max=2,      Pts=200, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                          Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q43, Label="Third DG & Above for the year",     PLabel="300 per Gift", Min=2, Max=100000, Pts=300, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                          Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q43, Label="$100,000 & above for the year",     PLabel="750 Bonus",   Min=0, Max=0,      Pts=750, At=0, Sub=2, Inp="Yes/No",     Imp="$100,000 & above for the year",        Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q43, Label="First time by District",            PLabel="750 Bonus",   Min=0, Max=0,      Pts=750, At=0, Sub=3, Inp="Yes/No",     Imp="First time by District",               Rep=(string?)null, Sort=5 });

        int q44=qMap[44]; // DDF
        await connection.ExecuteAsync(oSql, new { Q=q44, Label="20%+",            PLabel="400", Min=20, Max=100, Pts=400, At=0, Sub=1, Inp="Option1",    Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q44, Label="25%+",            PLabel="600", Min=25, Max=100, Pts=600, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q44, Label="30% and above",   PLabel="800", Min=30, Max=100, Pts=800, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        int q45=qMap[45]; // EPF
        await connection.ExecuteAsync(oSql, new { Q=q45, Label="upto 10",     PLabel="50 per EPF",  Min=0,  Max=10,     Pts=50,  At=0, Sub=1, Inp="Option1",    Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q45, Label="11 to 20",    PLabel="100 per EPF", Min=11, Max=20,     Pts=100, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q45, Label="21 & above",  PLabel="150 per EPF", Min=21, Max=100000, Pts=150, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        int q46=qMap[46]; // Polio Plus Society
        await connection.ExecuteAsync(oSql, new { Q=q46, Label="Atleast 2 members per club", PLabel="100 per club", Min=2, Max=100000, Pts=100, At=0, Sub=1, Inp="Option1", Imp=(string?)null, Rep=(string?)null, Sort=1 });

        int q47=qMap[47]; // Annual Fund - 4 subtypes
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="100000",                                PLabel="750",        Min=0,      Max=100000,  Pts=750,  At=0, Sub=1, Inp="Option1",    Imp=(string?)null,                                       Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="200000",                                PLabel="1000",       Min=100000, Max=200000,  Pts=1000, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                                       Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="$300,000+",                             PLabel="1500",       Min=200000, Max=10000000,Pts=1500, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                                       Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="Per capita contribution $25+",          PLabel="200",        Min=25,     Max=50,      Pts=200,  At=0, Sub=2, Inp="Option2",    Imp="Per capita",                                        Rep=(string?)null, Sort=4 });
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="Per capita contribution $50+",          PLabel="500",        Min=50,     Max=75,      Pts=500,  At=0, Sub=2, Inp=(string?)null, Imp="Per capita",                                        Rep=(string?)null, Sort=5 });
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="Per capita contribution $75+",          PLabel="1000",       Min=75,     Max=100000,  Pts=1000, At=0, Sub=2, Inp=(string?)null, Imp="Per capita",                                        Rep=(string?)null, Sort=6 });
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="100% Clubs contributing minimum $250",  PLabel="750 Bonus",  Min=0,      Max=0,       Pts=750,  At=0, Sub=3, Inp="Yes/No",     Imp="100% Clubs contributing minimum $250",              Rep=(string?)null, Sort=7 });
        await connection.ExecuteAsync(oSql, new { Q=q47, Label="100% Rotarians contributing minimum $10",PLabel="1000 Bonus",Min=0,      Max=0,       Pts=1000, At=0, Sub=4, Inp="Yes/No",     Imp="100% Rotarians contributing minimum $10",           Rep=(string?)null, Sort=8 });

        int q48=qMap[48]; // PHF
        await connection.ExecuteAsync(oSql, new { Q=q48, Label="Upto 50",  PLabel="10 per PHF", Min=0,   Max=50,     Pts=10, At=0, Sub=1, Inp="Option1",    Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q48, Label="51 - 100", PLabel="20 per PHF", Min=51,  Max=100,    Pts=20, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q48, Label="101+",     PLabel="30 per PHF", Min=101, Max=100000, Pts=30, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        int q49=qMap[49]; // Hall of Honor Club
        await connection.ExecuteAsync(oSql, new { Q=q49, Label="First Club",            PLabel="400", Min=0, Max=1,     Pts=400, At=0, Sub=1, Inp="Option1",    Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q49, Label="Second Club",           PLabel="600", Min=1, Max=2,     Pts=600, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q49, Label="Third club & Above",    PLabel="800", Min=2, Max=10000, Pts=800, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });

        int q50=qMap[50]; // PHSM
        await connection.ExecuteAsync(oSql, new { Q=q50, Label="upto 10",    PLabel="20 per PHSM", Min=0,  Max=10,     Pts=20, At=0, Sub=1, Inp="Option1",    Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q50, Label="11 to 20",   PLabel="40 per PHSM", Min=11, Max=20,     Pts=40, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q50, Label="20 to 30",   PLabel="60 per PHSM", Min=20, Max=30,     Pts=60, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q50, Label="30 & above", PLabel="80 per PHSM", Min=30, Max=100000, Pts=80, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        int q51=qMap[51]; // Major Donors
        await connection.ExecuteAsync(oSql, new { Q=q51, Label="upto 5",     PLabel="100 per MD", Min=0,  Max=5,      Pts=100, At=0, Sub=1, Inp="Option1",    Imp=(string?)null, Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q51, Label="06 to 10",   PLabel="200 per MD", Min=6,  Max=10,     Pts=200, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q51, Label="11 to 15",   PLabel="300 per MD", Min=11, Max=15,     Pts=300, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q51, Label="15 & above", PLabel="400 per MD", Min=15, Max=100000, Pts=400, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null, Rep=(string?)null, Sort=4 });

        int q52=qMap[52]; // CSR project with RFI
        await connection.ExecuteAsync(oSql, new { Q=q52, Label="upto 3 projects",                   PLabel="200 per project", Min=0, Max=3,      Pts=200, At=0, Sub=1, Inp="Option1",    Imp=(string?)null,                              Rep=(string?)null, Sort=1 });
        await connection.ExecuteAsync(oSql, new { Q=q52, Label="4 projects & above",                PLabel="300 per project", Min=4, Max=100000, Pts=300, At=0, Sub=1, Inp=(string?)null, Imp=(string?)null,                              Rep=(string?)null, Sort=2 });
        await connection.ExecuteAsync(oSql, new { Q=q52, Label="CSR Projects with $100,000 or above",PLabel="500 Bonus",      Min=0, Max=0,      Pts=500, At=0, Sub=2, Inp="Yes/No",     Imp="CSR Projects with $100,000 or above",     Rep=(string?)null, Sort=3 });
        await connection.ExecuteAsync(oSql, new { Q=q52, Label="First time by District",            PLabel="750 Bonus",       Min=0, Max=0,      Pts=750, At=0, Sub=3, Inp="Yes/No",     Imp="First time by District",                  Rep=(string?)null, Sort=4 });
    }
}

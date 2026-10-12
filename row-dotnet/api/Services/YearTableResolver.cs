using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Resolves which year-wise table (rotary_projects_YYYY_YY / rotary_project_photos_YYYY_YY)
// owns a project, given either its project_date OR its fk_year_id.
//
// Year-wise table naming: YearLabel "2024-25" -> table suffix "2024_25"
// e.g. "rotary_projects_2024_25" and "rotary_project_photos_2024_25"
public record YearTableInfo(int YearId, string YearLabel, string ProjectsTable, string PhotosTable);

public interface IYearTableResolver
{
    // Pure naming helpers — no DB call required.
    string GetProjectsTableName(string yearLabel);
    string GetPhotosTableName(string yearLabel);

    // Resolve year + table names from a project_date (joins rotary_year_master).
    // Returns null if the date doesn't fall within any rotary year.
    Task<YearTableInfo?> ResolveByDateAsync(MySqlConnection conn, DateTime projectDate);

    // Resolve year + table names from an fk_year_id (faster — single lookup).
    Task<YearTableInfo?> ResolveByYearIdAsync(MySqlConnection conn, int yearId);

    // Return all year-wise table pairs that EXIST in the DB schema.
    // Used for "All Years" report queries (we UNION ALL across these).
    Task<List<YearTableInfo>> GetAllExistingYearTablesAsync(MySqlConnection conn);

    // Find which year-wise table contains a given project (or photo's project).
    // Scans every existing year table — O(N tables). Used when a caller has only a
    // project_id and no yearId (e.g. background services, public share-link URLs).
    Task<YearTableInfo?> FindByProjectIdAsync(MySqlConnection conn, int projectId);

    // Club-scoped variant: find the year table that holds (projectId AND clubId).
    // pk_project_id is only unique WITHIN a year table and is reused across years for
    // different clubs, so scanning by id alone is ambiguous — pairing it with clubId is
    // unique and safe. Used as a fallback when a caller's yearId is wrong/missing.
    Task<YearTableInfo?> FindByProjectAndClubAsync(MySqlConnection conn, int projectId, int clubId);

    // Create the year-wise tables for a given year label if missing.
    // Called when admin adds a new row to rotary_year_master.
    Task EnsureTablesExistAsync(MySqlConnection conn, string yearLabel);
}

public class YearTableResolver : IYearTableResolver
{
    // YearLabel comes in as "2024-25"; the table suffix is "2024_25".
    private static string SuffixFromLabel(string yearLabel) => yearLabel.Replace("-", "_");

    public string GetProjectsTableName(string yearLabel) => $"rotary_projects_{SuffixFromLabel(yearLabel)}";
    public string GetPhotosTableName(string yearLabel) => $"rotary_project_photos_{SuffixFromLabel(yearLabel)}";

    public async Task<YearTableInfo?> ResolveByDateAsync(MySqlConnection conn, DateTime projectDate)
    {
        var row = await conn.QueryFirstOrDefaultAsync<(int yearId, string yearLabel)?>(@"
            SELECT pk_year_id, YearLabel
            FROM rotary_year_master
            WHERE @D BETWEEN StartDate AND EndDate
              AND isdeleted = 0
            LIMIT 1",
            new { D = projectDate });
        if (row == null) return null;
        var (yearId, label) = row.Value;
        return new YearTableInfo(yearId, label, GetProjectsTableName(label), GetPhotosTableName(label));
    }

    public async Task<YearTableInfo?> ResolveByYearIdAsync(MySqlConnection conn, int yearId)
    {
        var label = await conn.ExecuteScalarAsync<string?>(@"
            SELECT YearLabel FROM rotary_year_master
            WHERE pk_year_id = @Id AND isdeleted = 0 LIMIT 1",
            new { Id = yearId });
        if (string.IsNullOrEmpty(label)) return null;
        return new YearTableInfo(yearId, label, GetProjectsTableName(label), GetPhotosTableName(label));
    }

    public async Task<List<YearTableInfo>> GetAllExistingYearTablesAsync(MySqlConnection conn)
    {
        // Cross-check rotary_year_master against information_schema so we only return
        // pairs where BOTH the projects and photos tables physically exist.
        var rows = await conn.QueryAsync<(int yearId, string yearLabel)>(@"
            SELECT y.pk_year_id, y.YearLabel
            FROM rotary_year_master y
            WHERE y.isdeleted = 0
              AND EXISTS (
                  SELECT 1 FROM information_schema.tables t
                  WHERE t.table_schema = DATABASE()
                    AND t.table_name = CONCAT('rotary_projects_', REPLACE(y.YearLabel, '-', '_'))
              )
              AND EXISTS (
                  SELECT 1 FROM information_schema.tables t
                  WHERE t.table_schema = DATABASE()
                    AND t.table_name = CONCAT('rotary_project_photos_', REPLACE(y.YearLabel, '-', '_'))
              )
            ORDER BY y.StartDate");
        return rows.Select(r =>
            new YearTableInfo(r.yearId, r.yearLabel, GetProjectsTableName(r.yearLabel), GetPhotosTableName(r.yearLabel))
        ).ToList();
    }

    public async Task<YearTableInfo?> FindByProjectIdAsync(MySqlConnection conn, int projectId)
    {
        foreach (var t in await GetAllExistingYearTablesAsync(conn))
        {
            var exists = await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{t.ProjectsTable}` WHERE pk_project_id = @Id",
                new { Id = projectId });
            if (exists > 0) return t;
        }
        return null;
    }

    public async Task<YearTableInfo?> FindByProjectAndClubAsync(MySqlConnection conn, int projectId, int clubId)
    {
        foreach (var t in await GetAllExistingYearTablesAsync(conn))
        {
            var exists = await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{t.ProjectsTable}` WHERE pk_project_id = @Id AND fk_club_id = @Club AND isdeleted = 0",
                new { Id = projectId, Club = clubId });
            if (exists > 0) return t;
        }
        return null;
    }

    public Task EnsureTablesExistAsync(MySqlConnection conn, string yearLabel)
        => EnsureTablesExistStaticAsync(conn, yearLabel, null);

    // Static entry point so non-DI callers (e.g. the static RotaryYearHelper) can
    // create the year-wise tables whenever a new rotary year row is inserted.
    public static async Task EnsureTablesExistStaticAsync(MySqlConnection conn, string yearLabel, MySqlTransaction? tx)
    {
        var suffix = yearLabel.Replace("-", "_");
        var projTbl = $"rotary_projects_{suffix}";
        var photoTbl = $"rotary_project_photos_{suffix}";
        var fkName = $"fk_photo_project_{suffix}";

        await conn.ExecuteAsync($@"
            CREATE TABLE IF NOT EXISTS `{projTbl}` (
                pk_project_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_district_id INT NULL,
                fk_module_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                DistrictProjectType VARCHAR(20) NULL,
                project_type VARCHAR(20) NOT NULL DEFAULT 'one_time',
                parent_project_id INT NULL,
                ongoing_group_title VARCHAR(200) NULL,
                is_joint_project TINYINT(1) DEFAULT 0,
                co_host_name VARCHAR(200) NULL,
                club_role VARCHAR(10) NULL,
                title VARCHAR(500) NOT NULL,
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
                Currency VARCHAR(5) NOT NULL DEFAULT 'INR',
                fk_funding_id INT NULL,
                direct_beneficiaries INT NULL,
                man_hours INT NULL,
                rotarians_involved INT NULL,
                rotaractors_involved INT NULL,
                rcc_involved INT NULL DEFAULT 0,
                send_whatsapp TINYINT(1) DEFAULT 0,
                meeting_type VARCHAR(20) NULL,
                agenda_document VARCHAR(500) NULL,
                minutes_document VARCHAR(500) NULL,
                attendance INT NULL,
                attendance_percentage DECIMAL(5,2) NULL,
                global_grant_number VARCHAR(50) NULL,
                amount_sanctioned DECIMAL(15,2) NULL,
                amount_received DECIMAL(15,2) NULL,
                amount_spent DECIMAL(15,2) NULL,
                host_clubs_districts VARCHAR(500) NULL,
                global_partner_clubs_districts VARCHAR(500) NULL,
                csr_company_name VARCHAR(200) NULL,
                IsSendWhatsapp TINYINT(1) NOT NULL DEFAULT 0,
                WhatsAppSentDate DATETIME NULL,
                WhatsAppSentCount INT NOT NULL DEFAULT 0,
                WhatsAppFailedCount INT NOT NULL DEFAULT 0,
                send_email TINYINT(1) DEFAULT 0,
                EmailSentDate DATETIME NULL,
                EmailSentCount INT NOT NULL DEFAULT 0,
                EmailFailedCount INT NOT NULL DEFAULT 0,
                PushNotificationSent TINYINT(1) DEFAULT 0,
                PushNotificationSentAt DATETIME NULL,
                synced_to_org TINYINT(1) NOT NULL DEFAULT 0,
                synced_to_org_date DATETIME NULL,
                approval_status VARCHAR(20) NULL,
                approval_remark VARCHAR(500) NULL,
                approved_by INT NULL,
                approval_date DATETIME NULL,
                approval_token VARCHAR(64) NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                isdeleted INT DEFAULT 0,
                deleted_by INT NULL,
                deleted_date DATETIME NULL,
                old_pk INT NULL,
                INDEX idx_club_module (fk_club_id, fk_module_id, isdeleted),
                INDEX idx_year (fk_year_id),
                INDEX idx_parent (parent_project_id),
                INDEX idx_date (project_date),
                INDEX idx_old_pk (old_pk)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", transaction: tx);

        await conn.ExecuteAsync($@"
            CREATE TABLE IF NOT EXISTS `{photoTbl}` (
                pk_photo_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_project_id INT NOT NULL,
                image_path VARCHAR(500) NOT NULL,
                description VARCHAR(500) NULL,
                is_primary TINYINT(1) DEFAULT 0,
                sort_order INT DEFAULT 0,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_photos_project (fk_project_id),
                CONSTRAINT `{fkName}` FOREIGN KEY (fk_project_id) REFERENCES `{projTbl}`(pk_project_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", transaction: tx);
    }
}

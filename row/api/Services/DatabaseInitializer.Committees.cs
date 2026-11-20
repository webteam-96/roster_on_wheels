using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Enhanced committees (CommitteeService): any-depth subcommittees for club committees (sub_groups) and district
    /// committees (district_committee_group), committee-private documents and the committee message archive.
    /// Additive only: two nullable parent columns and two new tables; nothing is dropped or rewritten.
    /// Undo: drop the two tables and the two parent columns.
    /// </summary>
    private static async Task EnsureCommitteeTablesAsync(MySqlConnection connection)
    {
        await AddColumnIfNotExists(connection, "sub_groups", "fk_parent_sub_group_id", "INT NULL");
        await AddColumnIfNotExists(connection, "district_committee_group", "fk_parent_group_id", "INT NULL");

        // committee_kind: 'club' = sub_groups.pk_sub_group_id, 'district' = district_committee_group.id.
        // Files live under App_Data/committee-files (outside wwwroot) and are served only by CommitteesController.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS committee_documents (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                committee_kind VARCHAR(10) NOT NULL,
                fk_committee_id INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                stored_name VARCHAR(64) NOT NULL,
                size_bytes INT NOT NULL,
                uploaded_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                deleted_by INT NULL,
                deleted_date DATETIME NULL,
                KEY ix_committee_documents (committee_kind, fk_committee_id, isdeleted)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // One row per committee message; the send itself is a club_mass_emails campaign (fk_mass_email_id).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS committee_messages (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                committee_kind VARCHAR(10) NOT NULL,
                fk_committee_id INT NOT NULL,
                fk_mass_email_id INT NOT NULL,
                sent_by INT NOT NULL,
                subject VARCHAR(200) NOT NULL,
                body TEXT NOT NULL,
                created_date DATETIME NOT NULL,
                KEY ix_committee_messages (committee_kind, fk_committee_id, created_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}

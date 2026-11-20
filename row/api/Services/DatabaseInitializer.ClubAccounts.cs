using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Club accounts (gap agent 2026-11-19, Services/ClubAccountsService.cs). Additive only. Journal entries and their
    /// lines are never updated or deleted by the app: a mistake is cancelled with a reversing entry
    /// (reverses_entry_id, unique so an entry is reversed at most once). uk_acct_source makes automatic postings
    /// (dues payments, invoices) idempotent.
    /// </summary>
    private static async Task EnsureClubAccountsTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS acct_accounts (
                pk_account_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                code VARCHAR(10) NOT NULL,
                name VARCHAR(120) NOT NULL,
                account_type VARCHAR(10) NOT NULL,
                system_key VARCHAR(30) NULL,
                is_bank TINYINT(1) NOT NULL DEFAULT 0,
                bank_name VARCHAR(120) NULL,
                account_last4 VARCHAR(4) NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_acct_code (fk_club_id, code),
                UNIQUE KEY uk_acct_key (fk_club_id, system_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS acct_journal_entries (
                pk_entry_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                entry_date DATE NOT NULL,
                memo VARCHAR(255) NOT NULL,
                source_type VARCHAR(40) NULL,
                source_id VARCHAR(64) NULL,
                reverses_entry_id INT NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL,
                UNIQUE KEY uk_acct_source (fk_club_id, source_type, source_id),
                UNIQUE KEY uk_acct_reverses (reverses_entry_id),
                INDEX idx_acct_entry_date (fk_club_id, entry_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS acct_journal_lines (
                pk_line_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_entry_id INT NOT NULL,
                fk_account_id INT NOT NULL,
                debit DECIMAL(14,2) NOT NULL DEFAULT 0,
                credit DECIMAL(14,2) NOT NULL DEFAULT 0,
                description VARCHAR(255) NULL,
                INDEX idx_acct_line_entry (fk_entry_id),
                INDEX idx_acct_line_account (fk_account_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS acct_budgets (
                fk_club_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                fk_account_id INT NOT NULL,
                amount DECIMAL(14,2) NOT NULL DEFAULT 0,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                PRIMARY KEY (fk_club_id, fk_year_id, fk_account_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Vendors / payees a money-out entry is paid to (switched off, never deleted, once used).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS acct_vendors (
                pk_vendor_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                name VARCHAR(150) NOT NULL,
                email VARCHAR(150) NULL,
                phone VARCHAR(40) NULL,
                address VARCHAR(300) NULL,
                notes VARCHAR(500) NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_acct_vendor_club (fk_club_id, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Bank statement lines for reconciliation. amount is signed: money into the bank positive, out negative.
        // fk_journal_line_id is unique, so a journal line is matched to at most one statement line.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS acct_statement_lines (
                pk_statement_line_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_account_id INT NOT NULL,
                line_date DATE NOT NULL,
                description VARCHAR(255) NOT NULL,
                amount DECIMAL(14,2) NOT NULL,
                fk_journal_line_id INT NULL,
                reconciled_by INT NULL,
                reconciled_at DATETIME NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL,
                UNIQUE KEY uk_acct_stmt_match (fk_journal_line_id),
                INDEX idx_acct_stmt_account (fk_club_id, fk_account_id, line_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Payee and cheque / transfer reference of an entry (additive columns on the first table).
        foreach (var (column, ddl) in new[] { ("fk_vendor_id", "INT NULL"), ("reference", "VARCHAR(40) NULL") })
        {
            var exists = await connection.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'acct_journal_entries' AND COLUMN_NAME = @column", new { column });
            if (exists == 0) await connection.ExecuteAsync($"ALTER TABLE acct_journal_entries ADD COLUMN {column} {ddl}");
        }
    }
}

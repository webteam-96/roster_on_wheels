using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Website donations (gap #13, Services/DonationService.cs). A campaign belongs to a club or a district
    /// (scope_type + scope_id); a donation is 'pending' until the payment seam settles it, once. Times are UTC.
    /// </summary>
    private static async Task EnsureDonationTablesAsync(MySqlConnection connection)
    {
        // tiers: suggested amounts, comma separated ("25,50,100"); allow_custom lets a donor type any amount >= min_amount.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS donation_campaigns (
                pk_campaign_id INT AUTO_INCREMENT PRIMARY KEY,
                scope_type VARCHAR(10) NOT NULL,
                scope_id INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT NULL,
                image_url VARCHAR(500) NULL,
                goal_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                currency CHAR(3) NOT NULL,
                tiers VARCHAR(200) NULL,
                allow_custom TINYINT(1) NOT NULL DEFAULT 1,
                min_amount DECIMAL(12,2) NOT NULL DEFAULT 1,
                start_date DATE NULL,
                end_date DATE NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                modified_by INT NULL,
                modified_date DATETIME NULL,
                INDEX idx_donation_campaign_scope (scope_type, scope_id, isdeleted)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // status moves pending -> paid only through one conditional UPDATE (DonationService.SettleOnlineAsync).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS donations (
                pk_donation_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_campaign_id INT NOT NULL,
                donor_name VARCHAR(150) NOT NULL,
                donor_email VARCHAR(254) NOT NULL,
                message VARCHAR(500) NULL,
                is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
                hide_amount TINYINT(1) NOT NULL DEFAULT 0,
                fk_member_id INT NULL,
                amount DECIMAL(12,2) NOT NULL,
                currency CHAR(3) NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                merchant_order_id VARCHAR(40) NOT NULL,
                gateway_payment_id VARCHAR(100) NULL,
                created_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                paid_date DATETIME NULL,
                UNIQUE KEY uk_donation_order (merchant_order_id),
                INDEX idx_donation_campaign_status (fk_campaign_id, status),
                CONSTRAINT fk_donation_campaign FOREIGN KEY (fk_campaign_id) REFERENCES donation_campaigns (pk_campaign_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One editable receipt letter per club or district (DonationReceiptTemplate); no row = the default letter.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS donation_receipt_templates (
                pk_template_id INT AUTO_INCREMENT PRIMARY KEY,
                scope_type VARCHAR(10) NOT NULL,
                scope_id INT NOT NULL,
                legal_name VARCHAR(200) NULL,
                tax_statement VARCHAR(1000) NULL,
                body TEXT NULL,
                signatory_name VARCHAR(150) NULL,
                signatory_title VARCHAR(150) NULL,
                modified_by INT NOT NULL,
                modified_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                UNIQUE KEY uk_donation_receipt_scope (scope_type, scope_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}

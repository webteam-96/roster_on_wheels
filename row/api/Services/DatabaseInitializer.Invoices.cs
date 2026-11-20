using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Invoices and statements (gap #7, Services/DuesInvoiceService.cs). An invoice is either raised on a membership
    /// dues fee (fk_member_fee_id + fee_type set) or built from the club's products list (both NULL). Additive only.
    /// Times in UTC; issue, due and receipt dates are calendar dates.
    /// </summary>
    private static async Task EnsureDuesInvoiceTablesAsync(MySqlConnection connection)
    {
        // One row per club: the last invoice number used. Locked FOR UPDATE while numbers are taken, so numbers
        // never repeat or skip under concurrent generation.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS dues_invoice_counters (
                fk_club_id INT NOT NULL PRIMARY KEY,
                last_seq INT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // status: open, part_paid, paid, void. paid_amount is rebuilt from payments (see DuesInvoiceService.Sync*).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS dues_invoices (
                pk_invoice_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_membership_dues_id INT NULL,
                fk_member_fee_id INT NULL,
                fk_member_profile_id INT NOT NULL,
                fee_type INT NULL,
                invoice_seq INT NOT NULL,
                invoice_no VARCHAR(30) NOT NULL,
                issue_date DATE NOT NULL,
                due_date DATE NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                status VARCHAR(10) NOT NULL DEFAULT 'open',
                notes VARCHAR(500) NULL,
                void_reason VARCHAR(500) NULL,
                voided_by INT NULL,
                voided_at DATETIME NULL,
                email_count INT NOT NULL DEFAULT 0,
                emailed_at DATETIME NULL,
                created_by INT NOT NULL,
                created_at DATETIME NOT NULL,
                UNIQUE KEY uk_dues_invoice_seq (fk_club_id, invoice_seq),
                INDEX idx_dues_invoice_member (fk_member_profile_id),
                INDEX idx_dues_invoice_fee (fk_member_fee_id, fee_type),
                INDEX idx_dues_invoice_dues (fk_membership_dues_id),
                INDEX idx_dues_invoice_issue (fk_club_id, issue_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS dues_invoice_lines (
                pk_line_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_invoice_id INT NOT NULL,
                fk_product_id INT NULL,
                description VARCHAR(300) NOT NULL,
                quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
                unit_amount DECIMAL(12,2) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                INDEX idx_dues_invoice_line (fk_invoice_id),
                CONSTRAINT fk_dues_invoice_line FOREIGN KEY (fk_invoice_id) REFERENCES dues_invoices (pk_invoice_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Which membership_dues_payments row paid how much of which dues invoice. Rebuilt by SyncMemberFeeAsync.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS dues_invoice_payments (
                fk_invoice_id INT NOT NULL,
                fk_payment_id INT NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                PRIMARY KEY (fk_invoice_id, fk_payment_id),
                INDEX idx_dues_invoice_payment (fk_payment_id),
                CONSTRAINT fk_dues_invoice_payment FOREIGN KEY (fk_invoice_id) REFERENCES dues_invoices (pk_invoice_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // The club's price list for invoice line items. Never deleted (old invoices name them); is_active hides one.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS invoice_products (
                pk_product_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                name VARCHAR(150) NOT NULL,
                description VARCHAR(300) NULL,
                unit_amount DECIMAL(12,2) NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by INT NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NULL,
                INDEX idx_invoice_products_club (fk_club_id, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // A cash / cheque / bank payment the club recorded, and how it was split across the member's invoices.
        // Whatever is not applied stays as the member's credit.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS invoice_receipts (
                pk_receipt_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_member_profile_id INT NOT NULL,
                receipt_date DATE NOT NULL,
                method VARCHAR(10) NOT NULL,
                reference VARCHAR(100) NULL,
                amount DECIMAL(12,2) NOT NULL,
                notes VARCHAR(500) NULL,
                created_by INT NOT NULL,
                created_at DATETIME NOT NULL,
                INDEX idx_invoice_receipts_member (fk_club_id, fk_member_profile_id),
                INDEX idx_invoice_receipts_date (fk_club_id, receipt_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // fk_dues_payment_id: for a dues invoice the receipt also writes a paid membership_dues_payments row, so the
        // dues module shows the fee as paid; that row then pays the invoice through dues_invoice_payments.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS invoice_receipt_allocations (
                fk_receipt_id INT NOT NULL,
                fk_invoice_id INT NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                fk_dues_payment_id INT NULL,
                PRIMARY KEY (fk_receipt_id, fk_invoice_id),
                INDEX idx_invoice_receipt_alloc_invoice (fk_invoice_id),
                CONSTRAINT fk_invoice_receipt_alloc FOREIGN KEY (fk_receipt_id) REFERENCES invoice_receipts (pk_receipt_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Meal price per meeting (club_attendance); fk_attendance_id 0 = the club's default price.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS meal_prices (
                fk_club_id INT NOT NULL,
                fk_attendance_id INT NOT NULL,
                price DECIMAL(12,2) NOT NULL,
                updated_by INT NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (fk_club_id, fk_attendance_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Who ate at a meeting: one row per member, plus one per guest on the host member (guest_name '' = the
        // member). fk_invoice_id is set once the charge is billed; voiding that invoice releases the charge.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS meal_charges (
                pk_meal_charge_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_attendance_id INT NOT NULL,
                fk_member_profile_id INT NOT NULL,
                guest_name VARCHAR(150) NOT NULL DEFAULT '',
                meal_date DATE NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                fk_invoice_id INT NULL,
                created_by INT NOT NULL,
                created_at DATETIME NOT NULL,
                UNIQUE KEY uk_meal_charge (fk_attendance_id, fk_member_profile_id, guest_name),
                INDEX idx_meal_charges_member (fk_club_id, fk_member_profile_id, meal_date),
                INDEX idx_meal_charges_invoice (fk_invoice_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}

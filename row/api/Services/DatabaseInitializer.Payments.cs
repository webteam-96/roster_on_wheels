using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Hosted checkout sessions and connected payment accounts (Services/Payments, Controllers/PaymentAccountsController).
    /// Additive only; same SQL in database/schema.sql and database/maintenance/2026-11-04-payment-checkout.sql.
    /// Undo: database/maintenance/2026-11-04-payment-checkout-down.sql.
    /// </summary>
    private static async Task EnsurePaymentCheckoutTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS payment_checkout_sessions (
                pk_id BIGINT NOT NULL AUTO_INCREMENT,
                session_token CHAR(64) NOT NULL,
                gateway VARCHAR(30) NOT NULL,
                flow VARCHAR(30) NOT NULL,
                flow_ref BIGINT NOT NULL,
                merchant_order_id VARCHAR(100) NOT NULL,
                amount DECIMAL(14,2) NOT NULL,
                currency VARCHAR(10) NOT NULL,
                description VARCHAR(300) NOT NULL,
                return_url VARCHAR(1000) NULL,
                cancel_url VARCHAR(1000) NULL,
                status VARCHAR(20) NOT NULL,
                gateway_payment_id VARCHAR(100) NULL,
                expires_at DATETIME NOT NULL,
                created_date DATETIME NOT NULL,
                completed_date DATETIME NULL,
                PRIMARY KEY (pk_id),
                UNIQUE KEY uq_payment_checkout_token (session_token),
                UNIQUE KEY uq_payment_checkout_order (merchant_order_id),
                KEY ix_payment_checkout_flow (flow, flow_ref)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS payment_accounts (
                pk_id INT NOT NULL AUTO_INCREMENT,
                owner_type VARCHAR(10) NOT NULL,
                owner_id INT NOT NULL,
                gateway VARCHAR(30) NOT NULL,
                display_name VARCHAR(100) NOT NULL,
                currency VARCHAR(10) NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                verified_at DATETIME NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                PRIMARY KEY (pk_id),
                UNIQUE KEY uq_payment_account_owner (owner_type, owner_id, gateway)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}

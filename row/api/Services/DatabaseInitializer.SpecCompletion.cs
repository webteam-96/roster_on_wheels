using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Build spec completion (docs/superpowers/plans/2026-10-28-build-spec-completion.md). Additive only; same SQL in
    /// database/schema-drift.sql, undone by database/maintenance/2026-10-28-build-spec-completion-down.sql.
    /// </summary>
    private static async Task EnsureSpecCompletionAsync(MySqlConnection connection)
    {
        // S7 (3.14): a district tenant's retention rule; terminated members are anonymised this many months after
        // their last termination date. NULL or 0 = off.
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "anonymise_after_months", "SMALLINT NULL");

        // S8 (3.12): RI fields. The RI officer title a designation maps to (one of RiCodes.OfficerTitles); the
        // six designations PlanningService mapped by name start mapped.
        await AddColumnIfNotExists(connection, "designation_master", "ri_title", "VARCHAR(30) NULL");
        await connection.ExecuteAsync(RiCodes.SeedOfficerTitlesSql);
        // RI member types and join / termination reason codes, kept by Super Admin from RI's lists. Only the two
        // member types the spec names start in the list.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS ri_codes (
                pk_ri_code_id INT AUTO_INCREMENT PRIMARY KEY,
                kind VARCHAR(20) NOT NULL,
                code VARCHAR(40) NOT NULL,
                label VARCHAR(150) NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                modified_by INT NULL,
                modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_ri_code (kind, code)
            )");
        await connection.ExecuteAsync(RiCodes.SeedMemberTypesSql);
        // Per membership: the RI member type, and the reason codes for joining and leaving.
        await AddColumnIfNotExists(connection, "club_members", "ri_member_type", "VARCHAR(40) NULL");
        await AddColumnIfNotExists(connection, "club_members", "join_reason_code", "VARCHAR(40) NULL");
        await AddColumnIfNotExists(connection, "club_members", "termination_reason_code", "VARCHAR(40) NULL");

        // S10 (B.29): district target setting. The district proposes a target per club, year and metric; the club
        // accepts it or counters with its own value. No locking (Goal Lock is removed on the module sheet).
        await connection.ExecuteAsync(TargetProposals.TableSql);

        // S11 (3.5): renewal reminders (TenantRenewalService). auto_renew drives the 60-day notice's wording; the
        // other three remember what was sent for which term end.
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "auto_renew", "TINYINT(1) NOT NULL DEFAULT 1");
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "renewal_notice_for", "DATE NULL");
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "dunning_for", "DATE NULL");
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "dunning_stage", "TINYINT NOT NULL DEFAULT 0");

        // S12 (3.1): DGE sign-ups at the booth (BoothSignupController).
        await connection.ExecuteAsync(RotaryApi.Controllers.BoothSignupController.TableSql);

        // S5 (3.3, 3.16): machine translations of the server's fixed texts (ServerStrings). language '' = a text
        // known to need translating.
        await connection.ExecuteAsync(RotaryApi.Services.Localization.ServerStrings.TableSql);
    }
}

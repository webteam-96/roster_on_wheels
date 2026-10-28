namespace RotaryApi.Services;

/// <summary>
/// District target setting (build spec B.29): the district proposes a target per club, Rotary year and metric, the
/// club accepts it or counters with its own value, and both see the status. No locking: Goal Lock is removed on the
/// module sheet (decision 2026-10-28). Behind the target_dashboard switch (routes under .../targets).
/// </summary>
public static class TargetProposals
{
    /// <summary>The five areas the spec names.</summary>
    public static readonly string[] Metrics =
        { "membership_growth", "meetings", "dues_collection", "service_projects", "foundation_giving" };

    public static readonly string[] Statuses = { "proposed", "accepted", "countered" };

    public const string TableSql = @"
        CREATE TABLE IF NOT EXISTS district_target_proposals (
            pk_proposal_id INT AUTO_INCREMENT PRIMARY KEY,
            fk_district_id INT NOT NULL,
            fk_club_id INT NOT NULL,
            fk_year_id INT NOT NULL,
            metric VARCHAR(30) NOT NULL,
            proposed_value DECIMAL(18,2) NOT NULL,
            status VARCHAR(10) NOT NULL DEFAULT 'proposed',
            counter_value DECIMAL(18,2) NULL,
            club_note VARCHAR(500) NULL,
            proposed_by INT NOT NULL,
            proposed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            responded_by INT NULL,
            responded_at DATETIME NULL,
            UNIQUE KEY uk_target_proposal (fk_club_id, fk_year_id, metric),
            KEY ix_target_proposal_district (fk_district_id, fk_year_id)
        )";
}

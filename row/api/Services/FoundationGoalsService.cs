using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class FoundationGoalsService : IFoundationGoalsService
{
    private readonly string _cs;

    public FoundationGoalsService(IConfiguration configuration)
    {
        _cs = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_cs);

    // Editable when the rotary year hasn't ended yet — current and future
    // years can be edited or deleted; past years are read-only.
    private const string EditableSubquery =
        "(SELECT (EndDate >= CURDATE()) FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1)";

    // Returns the club_master.pk_club_id this member is acting on.
    //
    // - When `requestedClubId` is provided, validate the caller has an active
    //   Club Admin (role 2) OR Club Moderator (role 5) assignment at that club.
    //   Throws `UnauthorizedAccessException` if not (controllers translate to 403).
    // - When null, fall back to the legacy LIMIT 1 lookup (Club Admin first,
    //   then Club Moderator) so existing callers continue to work.
    private async Task<int> ResolveClubIdAsync(MySqlConnection conn, int memberId, int? requestedClubId = null)
    {
        if (memberId <= 0) return 0;

        if (requestedClubId.HasValue && requestedClubId.Value > 0)
        {
            var isAuthorised = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId
                  AND fk_role_id IN (2, 5)
                  AND fk_club_id = @ClubId
                  AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId, ClubId = requestedClubId.Value });

            // Scope override: SuperAdmin (any club) or District Admin with all-clubs access.
            if (isAuthorised == 0 && await ClubAdminAccessHelper.CanOverrideClubAdminAsync(conn, memberId, requestedClubId.Value))
                isAuthorised = 1;

            if (isAuthorised == 0)
                throw new UnauthorizedAccessException("You are not an active admin for this club.");

            return requestedClubId.Value;
        }

        // Active Club Admin role (role_id = 2) — same convention as the
        // existing ClubAdminDashboardService.ResolveClubIdAsync.
        var clubId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT mr.fk_club_id
            FROM member_roles mr
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND mr.IsActive = 1
              AND mr.isdeleted = 0
            ORDER BY mr.pk_member_role_id DESC
            LIMIT 1",
            new { MemberId = memberId });
        if (clubId.HasValue && clubId.Value > 0) return clubId.Value;

        // Fall back to ClubModerator (role_id = 5) — same fall-through
        // behavior as the dashboard service.
        clubId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT mr.fk_club_id
            FROM member_roles mr
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 5
              AND mr.IsActive = 1
              AND mr.isdeleted = 0
            ORDER BY mr.pk_member_role_id DESC
            LIMIT 1",
            new { MemberId = memberId });
        return clubId ?? 0;
    }

    public async Task<FoundationGoalListResponse?> GetListAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;

        var clubName = await conn.ExecuteScalarAsync<string>(@"
            SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0",
            new { ClubId = clubId }) ?? "";

        // Determine the selected year — caller's request, else current.
        int selectedYearId = yearId ?? 0;
        if (selectedYearId <= 0)
        {
            selectedYearId = await conn.ExecuteScalarAsync<int>(@"
                SELECT pk_year_id FROM rotary_year_master
                WHERE isdeleted = 0 AND IsCurrent = 1
                ORDER BY pk_year_id DESC LIMIT 1");
        }

        // Year dropdown is data-only: show (years where this club has a goal)
        // ∪ (current year) ∪ (future years). Past years without a saved goal
        // are hidden — there's nothing to view or edit there.
        var yearRows = (await conn.QueryAsync<dynamic>(@"
            SELECT y.pk_year_id AS yearId,
                   y.YearLabel  AS yearLabel,
                   COALESCE(y.IsCurrent, 0) AS isCurrent,
                   (y.EndDate >= CURDATE()) AS isEditable,
                   (SELECT COUNT(*) FROM club_foundation_collection_goals g
                     WHERE g.fk_club_id = @ClubId
                       AND g.fk_year_id = y.pk_year_id
                       AND g.isdeleted  = 0) AS hasGoal,
                   COALESCE((SELECT g.apf_goal_amount + g.polio_plus_goal_amount
                                  + g.endowment_fund_goal_amount + g.other_goal_amount
                              FROM club_foundation_collection_goals g
                             WHERE g.fk_club_id = @ClubId
                               AND g.fk_year_id = y.pk_year_id
                               AND g.isdeleted  = 0
                             LIMIT 1), 0) AS totalGoal
            FROM rotary_year_master y
            WHERE y.isdeleted = 0
              AND (
                    y.EndDate >= CURDATE()                                   -- current + future
                 OR EXISTS (SELECT 1 FROM club_foundation_collection_goals g  -- past with saved goal
                              WHERE g.fk_club_id = @ClubId
                                AND g.fk_year_id = y.pk_year_id
                                AND g.isdeleted  = 0)
                  )
            ORDER BY y.pk_year_id DESC",
            new { ClubId = clubId })).ToList();

        var years = yearRows.Select(r => new FoundationGoalYearRow
        {
            YearId     = Convert.ToInt32(r.yearId),
            YearLabel  = (r.yearLabel as string) ?? "",
            IsCurrent  = Convert.ToBoolean(r.isCurrent ?? 0L),
            IsEditable = Convert.ToBoolean(r.isEditable ?? 0L),
            HasGoal    = Convert.ToInt32(r.hasGoal ?? 0L) > 0,
            TotalGoal  = r.totalGoal is decimal dd ? dd : Convert.ToDecimal(r.totalGoal ?? 0),
        }).ToList();

        var selection = await GetGoalAsync(conn, clubId, selectedYearId);

        // Past goals: rows for every year where a goal exists AND is past
        // (read-only). Sorted by yearId desc so the most recent past year
        // shows first.
        var pastGoals = new List<FoundationGoalDto>();
        foreach (var y in years.Where(y => y.HasGoal && !y.IsEditable))
        {
            var g = await GetGoalAsync(conn, clubId, y.YearId);
            if (g != null) pastGoals.Add(g);
        }

        return new FoundationGoalListResponse
        {
            ClubId = clubId,
            ClubName = clubName,
            CurrentSelection = selection,
            Years = years,
            PastGoals = pastGoals,
        };
    }

    private async Task<FoundationGoalDto?> GetGoalAsync(MySqlConnection conn, int clubId, int yearId)
    {
        if (yearId <= 0) return null;
        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_year_id AS yearId, YearLabel AS yearLabel,
                   COALESCE(IsCurrent, 0) AS isCurrent,
                   (EndDate >= CURDATE()) AS isEditable
            FROM rotary_year_master
            WHERE pk_year_id = @YearId AND isdeleted = 0",
            new { YearId = yearId });
        if (yr == null) return null;

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT g.pk_goal_id AS goalId,
                   g.apf_goal_amount AS apf,
                   g.polio_plus_goal_amount AS polio,
                   g.endowment_fund_goal_amount AS endowment,
                   g.other_goal_amount AS other,
                   COALESCE(g.currency, 'USD') AS currency,
                   g.remarks AS remarks,
                   DATE_FORMAT(COALESCE(g.modified_date, g.created_date), '%Y-%m-%d %H:%i') AS updatedDate,
                   (SELECT m.MemberName FROM member_master_profile m
                     WHERE m.pk_member_master_profile_id = COALESCE(g.modified_by, g.created_by)) AS updatedBy
            FROM club_foundation_collection_goals g
            WHERE g.fk_club_id = @ClubId AND g.fk_year_id = @YearId AND g.isdeleted = 0
            LIMIT 1",
            new { ClubId = clubId, YearId = yearId });

        return new FoundationGoalDto
        {
            GoalId = row == null ? null : (int?)Convert.ToInt32(row.goalId),
            ClubId = clubId,
            YearId = yearId,
            YearLabel = (yr.yearLabel as string) ?? "",
            ApfGoal = row == null ? 0 : (row.apf is decimal a ? a : Convert.ToDecimal(row.apf ?? 0)),
            PolioPlusGoal = row == null ? 0 : (row.polio is decimal p ? p : Convert.ToDecimal(row.polio ?? 0)),
            EndowmentFundGoal = row == null ? 0 : (row.endowment is decimal e ? e : Convert.ToDecimal(row.endowment ?? 0)),
            OtherGoal = row == null ? 0 : (row.other is decimal o ? o : Convert.ToDecimal(row.other ?? 0)),
            Currency = row == null ? "USD" : ((row.currency as string) ?? "USD"),
            Remarks = row == null ? null : (row.remarks as string),
            IsEditable = Convert.ToBoolean(yr.isEditable ?? 0L),
            IsCurrent = Convert.ToBoolean(yr.isCurrent ?? 0L),
            UpdatedDate = row == null ? null : (row.updatedDate as string),
            UpdatedBy = row == null ? null : (row.updatedBy as string),
        };
    }

    public async Task<FoundationGoalDto?> SaveAsync(int memberId, FoundationGoalSaveRequest request, int? requestedClubId = null)
    {
        if (request.YearId <= 0) throw new InvalidOperationException("yearId required");

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;

        // Server-side enforcement of the past-year read-only rule.
        var editable = await conn.ExecuteScalarAsync<int>(@"
            SELECT COALESCE((EndDate >= CURDATE()), 0)
            FROM rotary_year_master WHERE pk_year_id = @YearId AND isdeleted = 0",
            new { YearId = request.YearId });
        if (editable != 1)
            throw new InvalidOperationException("Past years are read-only and cannot be edited.");

        // Sanity-check amounts. Negative goals make no sense.
        if (request.ApfGoal < 0 || request.PolioPlusGoal < 0
            || request.EndowmentFundGoal < 0 || request.OtherGoal < 0)
            throw new InvalidOperationException("Goal amounts must be zero or positive.");

        var currency = string.IsNullOrWhiteSpace(request.Currency) ? "USD" : request.Currency.Trim();

        // UPSERT — ON DUPLICATE KEY (fk_club_id, fk_year_id, isdeleted=0)
        // updates the existing active row instead of inserting a duplicate.
        await conn.ExecuteAsync(@"
            INSERT INTO club_foundation_collection_goals
                (fk_club_id, fk_year_id,
                 apf_goal_amount, polio_plus_goal_amount,
                 endowment_fund_goal_amount, other_goal_amount,
                 currency, remarks,
                 created_by, created_date, isdeleted)
            VALUES
                (@ClubId, @YearId,
                 @Apf, @Polio,
                 @Endowment, @Other,
                 @Currency, @Remarks,
                 @MemberId, NOW(), 0)
            ON DUPLICATE KEY UPDATE
                apf_goal_amount            = @Apf,
                polio_plus_goal_amount     = @Polio,
                endowment_fund_goal_amount = @Endowment,
                other_goal_amount          = @Other,
                currency                   = @Currency,
                remarks                    = @Remarks,
                modified_by                = @MemberId,
                modified_date              = NOW()",
            new
            {
                ClubId = clubId,
                YearId = request.YearId,
                Apf = request.ApfGoal,
                Polio = request.PolioPlusGoal,
                Endowment = request.EndowmentFundGoal,
                Other = request.OtherGoal,
                Currency = currency,
                Remarks = request.Remarks,
                MemberId = memberId,
            });

        return await GetGoalAsync(conn, clubId, request.YearId);
    }

    public async Task<bool> DeleteAsync(int memberId, int yearId, int? requestedClubId = null)
    {
        if (yearId <= 0) return false;
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return false;

        var editable = await conn.ExecuteScalarAsync<int>(@"
            SELECT COALESCE((EndDate >= CURDATE()), 0)
            FROM rotary_year_master WHERE pk_year_id = @YearId AND isdeleted = 0",
            new { YearId = yearId });
        if (editable != 1)
            throw new InvalidOperationException("Past years are read-only and cannot be deleted.");

        // Soft delete — per the project-wide "no hard deletes" rule.
        var rows = await conn.ExecuteAsync(@"
            UPDATE club_foundation_collection_goals
            SET isdeleted = 1,
                deleted_by = @MemberId,
                deleted_date = NOW(),
                modified_by = @MemberId,
                modified_date = NOW()
            WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
            new { ClubId = clubId, YearId = yearId, MemberId = memberId });
        return rows > 0;
    }
}

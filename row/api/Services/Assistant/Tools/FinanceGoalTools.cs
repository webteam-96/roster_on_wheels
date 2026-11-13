using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Assistant.Tools;

// Money and recognition: membership dues, district (club) dues, Rotary Foundation giving, zonal
// awards / district citation, and goal-setting progress. Totals only - never member or donor names.
public static partial class FinanceGoalTools
{
    private static readonly string[] DistrictOrClub = { "district", "club" };
    private static readonly string[] TrfLevels = { "zone", "district", "club", "all" };
    private static readonly string[] GoalLevels = { "zone", "district", "club" };
    private static readonly string[] GoalCategories = { "membership", "youth_service", "foundation", "public_image" };

    public static IEnumerable<AssistantTool> All() => new[]
    {
        new AssistantTool(new ToolSpec("membership_dues_status",
            "Membership dues a club bills its own members for a rotary year: members billed, paid, fully paid and unpaid, " +
            "and amounts billed / collected / still pending in INR (online surcharge removed). District level adds a per-club breakdown.",
            Schema.Object(Schema.Level(DistrictOrClub), Schema.Id(), Schema.Year(), Schema.LimitArg())),
            DataArea.General, MembershipDuesStatusAsync),

        new AssistantTool(new ToolSpec("club_dues_status",
            "District dues the district bills each club (per-member rate x non-honorary members) for a rotary year: clubs fully paid, " +
            "partly paid or unpaid, and amounts billed / collected / pending in INR, per club.",
            Schema.Object(
                ("district_id", Schema.Int("District id from resolve_entity."), true),
                Schema.Year(), Schema.LimitArg())),
            DataArea.General, ClubDuesStatusAsync),

        new AssistantTool(new ToolSpec("trf_stats",
            "The Rotary Foundation contributions clubs recorded for a rotary year: number of contributions, contributing clubs, " +
            "distinct donors and total amount in USD. Optional breakdown by club or by fund. Never returns donor names.",
            Schema.Object(Schema.Level(TrfLevels), Schema.Id(false), Schema.Year(),
                ("breakdown", Schema.Enum("Extra rows to return. Default none.", "none", "club", "fund"), false),
                Schema.LimitArg())),
            DataArea.General, TrfStatsAsync),

        new AssistantTool(new ToolSpec("awards_status",
            "Recognition scores for a rotary year: the district's Zonal Awards points per goal (district level only) and District " +
            "Citation points per club (auto + manual criteria, bonus included), ranked highest first.",
            Schema.Object(Schema.Level(DistrictOrClub), Schema.Id(), Schema.Year(), Schema.LimitArg())),
            DataArea.General, AwardsStatusAsync),

        new AssistantTool(new ToolSpec("goal_progress",
            "Goal Setting targets vs achieved for a club, district or zone (sum of its districts) in a rotary year: membership, " +
            "youth service and foundation goals with as-on-1-July baseline, target, achieved and % achieved, plus public image commitments.",
            Schema.Object(Schema.Level(GoalLevels), Schema.Id(), Schema.Year(),
                ("category", Schema.Enum("Only this goal category. Omit for all.", GoalCategories), false))),
            DataArea.Goals, GoalProgressAsync),
    };

    private static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    private static decimal? R(decimal? v) => v.HasValue ? R(v.Value) : null;

    // ─── membership_dues_status ────────────────────────────────────────────────────────────

    private sealed class DuesCampaignRow
    {
        public int DuesId { get; set; }
        public int ClubId { get; set; }
        public string Club { get; set; } = "";
        public string? Purpose { get; set; }
        public bool IsActive { get; set; }
        public long MembersBilled { get; set; }
        public decimal MembersPaid { get; set; }
        public decimal MembersFullyPaid { get; set; }
        public decimal AmountBilled { get; set; }
        public decimal AmountCollected { get; set; }
        public decimal AmountPending { get; set; }
    }

    private static async Task<object> MembershipDuesStatusAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", DistrictOrClub);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);

        var where = $"{ToolSql.ClubCounts()} AND {ToolSql.Level(level)}";
        await using var conn = await ctx.OpenReadOnlyAsync();

        // Billed = active, non-honorary members on the campaign (MembershipDuesService.GetListAsync). A member's
        // due is Annual when enabled and non-zero, else Semi 1 + Semi 2 (ClubAdminDashboardService.GetPaymentsAsync),
        // from their own fee row. Paid = the LATEST paid, live payment per fee + fee type (ROW_NUMBER rule of
        // MembershipDuesService.GetPublicReportAsync), online amounts backed out to the base by the campaign's surcharge.
        var rows = (await conn.QueryAsync<DuesCampaignRow>($@"
            WITH fees AS (
                SELECT md.pk_membership_dues_id AS duesId, f.pk_id AS feeId, md.OnlineSurchargePercent AS surcharge,
                       CASE WHEN md.IsFees1 = 1 AND f.AnnualAmount > 0 THEN f.AnnualAmount
                            ELSE IF(md.IsFees2 = 1, f.Semi1Amount, 0) + IF(md.IsFees3 = 1, f.Semi2Amount, 0) END AS billed
                FROM membership_dues md
                JOIN club_master c ON c.pk_club_id = md.fk_club_id
                {ToolSql.ClubJoins()}
                JOIN membership_dues_member_fees f ON f.fk_membership_dues_id = md.pk_membership_dues_id AND f.isdeleted = 0
                JOIN club_members cm ON cm.fk_member_master_profile_id = f.fk_member_profile_id
                     AND cm.fk_club_id = md.fk_club_id AND cm.IsActive = 1
                     AND COALESCE(cm.isdeleted, 0) = 0 AND COALESCE(cm.IsHonoraryMember, 0) = 0
                WHERE md.isdeleted = 0 AND md.RotaryYear = @YearLabel AND {where}
            ),
            latest AS (
                SELECT p.fk_member_fee_id AS feeId, p.IsOnline, p.Amount,
                       ROW_NUMBER() OVER (PARTITION BY p.fk_member_fee_id, p.FeeType ORDER BY p.PaymentDate DESC, p.pk_id DESC) AS rn
                FROM membership_dues_payments p
                JOIN fees fe ON fe.feeId = p.fk_member_fee_id
                WHERE p.IsPaid = 1 AND p.isdeleted = 0
            ),
            paid AS (
                SELECT l.feeId,
                       SUM(CASE WHEN l.IsOnline = 1 THEN ROUND(l.Amount / (1 + fe.surcharge / 100), 2) ELSE l.Amount END) AS paidNet
                FROM latest l JOIN fees fe ON fe.feeId = l.feeId
                WHERE l.rn = 1
                GROUP BY l.feeId
            )
            SELECT md.pk_membership_dues_id AS DuesId, c.pk_club_id AS ClubId, c.ClubName AS Club, md.Purpose,
                   COALESCE(md.IsActive, 0) = 1 AS IsActive,
                   COUNT(fe.feeId) AS MembersBilled,
                   COALESCE(SUM(pd.feeId IS NOT NULL), 0) AS MembersPaid,
                   COALESCE(SUM(fe.billed > 0 AND COALESCE(pd.paidNet, 0) >= fe.billed - 0.01), 0) AS MembersFullyPaid,
                   COALESCE(SUM(fe.billed), 0) AS AmountBilled,
                   COALESCE(SUM(pd.paidNet), 0) AS AmountCollected,
                   COALESCE(SUM(GREATEST(fe.billed - COALESCE(pd.paidNet, 0), 0)), 0) AS AmountPending
            FROM membership_dues md
            JOIN club_master c ON c.pk_club_id = md.fk_club_id
            {ToolSql.ClubJoins()}
            LEFT JOIN fees fe ON fe.duesId = md.pk_membership_dues_id
            LEFT JOIN paid pd ON pd.feeId = fe.feeId
            WHERE md.isdeleted = 0 AND md.RotaryYear = @YearLabel AND {where}
            GROUP BY md.pk_membership_dues_id, c.pk_club_id, c.ClubName, md.Purpose, md.IsActive",
            new { Id = unit.ClubId ?? unit.DistrictId ?? 0, YearLabel = year.Label })).ToList();

        if (rows.Count == 0)
            return new { unit = unit.Label, year = year.Label, campaigns = 0, note = "No membership dues campaign for this year." };

        long billed = rows.Sum(r => r.MembersBilled);
        long paidCount = (long)rows.Sum(r => r.MembersPaid);
        var totals = new
        {
            campaigns = rows.Count,
            membersBilled = billed,
            membersPaid = paidCount,
            membersFullyPaid = (long)rows.Sum(r => r.MembersFullyPaid),
            membersUnpaid = billed - paidCount,
            amountBilled = R(rows.Sum(r => r.AmountBilled)),
            amountCollected = R(rows.Sum(r => r.AmountCollected)),
            amountPending = R(rows.Sum(r => r.AmountPending)),
        };
        const string definitions =
            "membersBilled = active non-honorary members on a dues list; membersPaid = at least one payment recorded; " +
            "membersFullyPaid = paid at least their full due; amounts in INR, online payments net of the gateway surcharge; " +
            "amountPending = dues not yet paid.";

        if (level == "club")
        {
            var campaigns = rows.Select(r => new
            {
                purpose = r.Purpose, active = r.IsActive, membersBilled = r.MembersBilled, membersPaid = (long)r.MembersPaid,
                membersFullyPaid = (long)r.MembersFullyPaid, amountBilled = R(r.AmountBilled),
                amountCollected = R(r.AmountCollected), amountPending = R(r.AmountPending),
            });
            return new { unit = unit.Label, year = year.Label, currency = "INR", definitions, totals, campaigns };
        }

        var clubs = rows.GroupBy(r => (r.ClubId, r.Club))
            .Select(g => new
            {
                clubId = g.Key.ClubId, club = g.Key.Club, campaigns = g.Count(),
                membersBilled = g.Sum(r => r.MembersBilled), membersPaid = (long)g.Sum(r => r.MembersPaid),
                amountBilled = R(g.Sum(r => r.AmountBilled)), amountCollected = R(g.Sum(r => r.AmountCollected)),
                amountPending = R(g.Sum(r => r.AmountPending)),
            })
            .OrderByDescending(c => c.amountPending).ThenBy(c => c.club).ToList();
        return new
        {
            unit = unit.Label, year = year.Label, currency = "INR", definitions, totals,
            clubsWithCampaign = clubs.Count, clubs = clubs.Take(args.Limit()),
        };
    }

    // ─── club_dues_status ──────────────────────────────────────────────────────────────────

    private sealed class ClubDuesCampaign
    {
        public int Id { get; set; }
        public string? Purpose { get; set; }
        public bool IsActive { get; set; }
        public bool Independent { get; set; }
        public decimal OnlineSurchargePercent { get; set; }
    }

    private sealed class ClubDuesClubRow
    {
        public int ClubId { get; set; }
        public string Club { get; set; } = "";
        public decimal PerMemberRate { get; set; }
        public decimal OfflinePerMemberRate { get; set; }
        public long Members { get; set; }
        public long PaidMembers { get; set; }
        public decimal OfflinePaid { get; set; }
        public decimal OnlinePaid { get; set; }
        public long PendingApprovals { get; set; }
    }

    private static async Task<object> ClubDuesStatusAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var unit = await ctx.Hierarchy.ResolveAsync("district", args.RequiredInt("district_id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);

        await using var conn = await ctx.OpenReadOnlyAsync();
        // One campaign per district + rotary year (uk_club_dues_district_year); RotaryYear is the year label.
        var campaign = await conn.QueryFirstOrDefaultAsync<ClubDuesCampaign>(@"
            SELECT pk_club_dues_id AS Id, Purpose, COALESCE(IsActive, 0) = 1 AS IsActive,
                   COALESCE(RateModel, 0) = 1 AS Independent, COALESCE(OnlineSurchargePercent, 0) AS OnlineSurchargePercent
            FROM club_dues
            WHERE fk_district_id = @Id AND RotaryYear = @YearLabel AND isdeleted = 0
            ORDER BY pk_club_dues_id DESC LIMIT 1",
            new { Id = unit.DistrictId, YearLabel = year.Label });
        if (campaign == null)
            return new { unit = unit.Label, year = year.Label, found = false, note = "No district dues campaign for this year." };

        // ClubDuesService.GetClubsAsync, read-only (it first re-syncs club_dues_members; we read as stored).
        var rows = (await conn.QueryAsync<ClubDuesClubRow>($@"
            SELECT c.pk_club_id AS ClubId, c.ClubName AS Club, cc.PerMemberRate, cc.OfflinePerMemberRate,
                   (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id = cc.fk_club_dues_id AND m.fk_club_id = cc.fk_club_id
                      AND m.isdeleted = 0 AND m.IsHonorary = 0) AS Members,
                   (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id = cc.fk_club_dues_id AND m.fk_club_id = cc.fk_club_id
                      AND m.isdeleted = 0 AND m.IsHonorary = 0 AND m.IsPaid = 1) AS PaidMembers,
                   (SELECT COALESCE(SUM(p.Amount), 0) FROM club_dues_payments p WHERE p.fk_club_dues_id = cc.fk_club_dues_id
                      AND p.fk_club_id = cc.fk_club_id AND p.IsPaid = 1 AND p.IsOnline = 0 AND p.isdeleted = 0) AS OfflinePaid,
                   (SELECT COALESCE(SUM(p.Amount), 0) FROM club_dues_payments p WHERE p.fk_club_dues_id = cc.fk_club_dues_id
                      AND p.fk_club_id = cc.fk_club_id AND p.IsPaid = 1 AND p.IsOnline = 1 AND p.isdeleted = 0) AS OnlinePaid,
                   (SELECT COUNT(*) FROM club_dues_payments p WHERE p.fk_club_dues_id = cc.fk_club_dues_id
                      AND p.fk_club_id = cc.fk_club_id AND p.OfflineStatus = 'Pending' AND p.isdeleted = 0) AS PendingApprovals
            FROM club_dues_clubs cc
            JOIN club_master c ON c.pk_club_id = cc.fk_club_id
            {ToolSql.ClubJoins()}
            WHERE cc.fk_club_dues_id = @DuesId AND cc.isdeleted = 0 AND c.fk_district_id = @Id AND {ToolSql.ClubCounts()}",
            new { DuesId = campaign.Id, Id = unit.DistrictId })).ToList();

        var s = campaign.OnlineSurchargePercent;
        var clubs = rows.Select(r =>
        {
            // Effective base rate and online back-out exactly as GetClubsAsync / GetClubRatesAsync.
            decimal rate = campaign.Independent ? r.OfflinePerMemberRate : r.PerMemberRate;
            decimal online = campaign.Independent || r.OnlinePaid <= 0 ? r.OnlinePaid
                : Math.Round(s > 0 ? r.OnlinePaid / (1 + s / 100m) : r.OnlinePaid, 0, MidpointRounding.AwayFromZero);
            long unpaid = r.Members - r.PaidMembers;
            string status = r.Members == 0 ? "no_members" : unpaid == 0 ? "fully_paid" : r.PaidMembers == 0 ? "unpaid" : "partial";
            return new
            {
                clubId = r.ClubId, club = r.Club, status, members = r.Members, paidMembers = r.PaidMembers,
                ratePerMember = R(rate), amountBilled = R(r.Members * rate), amountCollected = R(r.OfflinePaid + online),
                amountPending = R(unpaid * rate), offlineAwaitingApproval = r.PendingApprovals > 0 ? r.PendingApprovals : (long?)null,
            };
        }).OrderByDescending(c => c.amountPending).ThenBy(c => c.club).ToList();

        return new
        {
            unit = unit.Label, year = year.Label, campaign = campaign.Purpose, active = campaign.IsActive, currency = "INR",
            definitions = "Each club owes its non-honorary members on the district dues list x its per-member (offline/base) rate. " +
                          "paidMembers = covered by an approved payment; amountPending = unpaid members x rate; amountCollected = " +
                          "approved payments, online ones net of the surcharge. Member lists refresh when the dues screen is opened.",
            totals = new
            {
                clubs = clubs.Count,
                fullyPaid = clubs.Count(c => c.status == "fully_paid"),
                partial = clubs.Count(c => c.status == "partial"),
                unpaid = clubs.Count(c => c.status == "unpaid"),
                noMembers = clubs.Count(c => c.status == "no_members"),
                members = clubs.Sum(c => c.members),
                paidMembers = clubs.Sum(c => c.paidMembers),
                amountBilled = R(clubs.Sum(c => c.amountBilled)),
                amountCollected = R(clubs.Sum(c => c.amountCollected)),
                amountPending = R(clubs.Sum(c => c.amountPending)),
                offlineAwaitingApproval = clubs.Sum(c => c.offlineAwaitingApproval ?? 0),
            },
            clubs = clubs.Take(args.Limit()),
        };
    }

    // ─── trf_stats ─────────────────────────────────────────────────────────────────────────

    private static async Task<object> TrfStatsAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", TrfLevels);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);
        var breakdown = args.Enum("breakdown", new[] { "none", "club", "fund" }, "none");

        // ReportsController.TrfContributions without DonorName (and without any per-contribution rows).
        var where = $"t.isdeleted = 0 AND t.fk_year_id = @Year AND {ToolSql.ClubCounts()} AND {ToolSql.Level(level)}" +
                    (level is "zone" or "all" ? $" AND {ctx.ExcludedZonesSql("d.fk_zone_id")}" : "");
        var from = $"FROM trf_contributions t JOIN club_master c ON c.pk_club_id = t.fk_club_id {ToolSql.ClubJoins()}";
        var p = new { Id = unit.ClubId ?? unit.DistrictId ?? unit.ZoneId ?? 0, Year = year.Id };
        await using var conn = await ctx.OpenReadOnlyAsync();

        var totals = await conn.QuerySingleAsync<dynamic>($@"
            SELECT COUNT(*) AS contributions, COUNT(DISTINCT t.fk_club_id) AS clubsGiving,
                   COUNT(DISTINCT t.DonorName) AS donors, ROUND(COALESCE(SUM(t.AmountUSD), 0), 2) AS amountUsd
            {from} WHERE {where}", p);

        object? rows = null;
        if (breakdown == "club" && level != "club")
        {
            rows = await conn.QueryAsync($@"
                SELECT c.pk_club_id AS clubId, c.ClubName AS club, COUNT(*) AS contributions,
                       ROUND(SUM(t.AmountUSD), 2) AS amountUsd
                {from} WHERE {where}
                GROUP BY c.pk_club_id, c.ClubName
                ORDER BY amountUsd DESC LIMIT {args.Limit()}", p);
        }
        else if (breakdown == "fund")
        {
            rows = await conn.QueryAsync($@"
                SELECT COALESCE(f.FundName, NULLIF(t.FundType, ''), 'Unspecified') AS fund, COUNT(*) AS contributions,
                       ROUND(SUM(t.AmountUSD), 2) AS amountUsd
                {from} LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
                WHERE {where}
                GROUP BY fund
                ORDER BY amountUsd DESC LIMIT {args.Limit()}", p);
        }

        return new
        {
            unit = unit.Label, year = year.Label, currency = "USD",
            definitions = "Contributions clubs entered in the TRF module for this rotary year, in USD as entered (no INR figure " +
                          "is stored). donors = distinct donor names, counted only.",
            totals, rows,
        };
    }

    // ─── awards_status ─────────────────────────────────────────────────────────────────────

    private sealed class ZonalGoalRow
    {
        public string Goal { get; set; } = "";
        public int? MaxPoints { get; set; }
        public decimal Points { get; set; }
    }

    private sealed class CitationClubRow
    {
        public int ClubId { get; set; }
        public string Club { get; set; } = "";
        public decimal AutoPoints { get; set; }
        public decimal ManualPoints { get; set; }
        public long Entries { get; set; }
    }

    private static async Task<object> AwardsStatusAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", DistrictOrClub);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);
        var districtId = unit.DistrictId ?? 0;

        await using var conn = await ctx.OpenReadOnlyAsync();

        // District Citation: DistrictModulesController.GetCitationClubPoints - auto + manual entries, counted only
        // while their question / sub-criteria still exists for this district + year. Missing config row = disabled
        // (DistrictAwardsConfigHelper).
        var citationEnabled = await conn.ExecuteScalarAsync<int?>(
            "SELECT is_enabled FROM district_awards_config WHERE fk_district_id = @D AND fk_year_id = @Y LIMIT 1",
            new { D = districtId, Y = year.Id }) == 1;
        var clubs = (await conn.QueryAsync<CitationClubRow>($@"
            SELECT c.pk_club_id AS ClubId, c.ClubName AS Club, COALESCE(t.autoPts, 0) AS AutoPoints,
                   COALESCE(t.manualPts, 0) AS ManualPoints, COALESCE(t.entries, 0) AS Entries
            FROM club_master c
            {ToolSql.ClubJoins()}
            LEFT JOIN (
                SELECT x.clubId, SUM(IF(x.kind = 'auto', x.score, 0)) AS autoPts,
                       SUM(IF(x.kind = 'manual', x.score, 0)) AS manualPts, COUNT(*) AS entries
                FROM (
                    SELECT e.fk_club_id AS clubId, 'auto' AS kind, COALESCE(e.points_earned, 0) + COALESCE(e.bonus_earned, 0) AS score
                    FROM district_citation_club_entry e
                    JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
                         AND q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0
                    WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.entry_type = 'auto' AND e.isdeleted = 0
                    UNION ALL
                    SELECT e.fk_club_id, 'manual', COALESCE(e.points_earned, 0) + COALESCE(e.bonus_earned, 0)
                    FROM district_citation_club_entry e
                    JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
                    JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
                         AND mc.fk_district_id = @D AND mc.fk_year_id = @Y AND mc.isdeleted = 0
                    WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.entry_type = 'manual' AND e.isdeleted = 0
                ) x
                GROUP BY x.clubId
            ) t ON t.clubId = c.pk_club_id
            WHERE {ToolSql.ClubCounts()} AND {ToolSql.Level(level)}",
            new { Id = unit.ClubId ?? districtId, D = districtId, Y = year.Id })).ToList();

        const string citationDef = "District Citation points a club earned this year (auto-scored activities + manually scored " +
                                   "criteria, bonus included). enabled = the district has opened point entry for this year.";

        if (level == "club")
        {
            var c = clubs.FirstOrDefault();
            return new
            {
                unit = unit.Label, year = year.Label,
                citation = new
                {
                    enabled = citationEnabled, definition = citationDef,
                    points = R((c?.AutoPoints ?? 0) + (c?.ManualPoints ?? 0)),
                    autoPoints = R(c?.AutoPoints ?? 0), manualPoints = R(c?.ManualPoints ?? 0), entries = c?.Entries ?? 0,
                },
                zonalAwards = "Zonal Awards are scored per district, not per club - ask at district level.",
            };
        }

        // Zonal Awards: per goal points from the year-wise rows (month = 0 holds the year total; months 1-12 are
        // the same points month by month - GetZonalAwardsYearlyReport reads month = 0 only).
        var zonalEnabled = await conn.ExecuteScalarAsync<int?>(@"
            SELECT CAST(COALESCE(z.IsZonalAwardsEnabled, 0) AS SIGNED) FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.pk_district_id = @D", new { D = districtId }) == 1;
        var goals = (await conn.QueryAsync<ZonalGoalRow>(@"
            SELECT g.title AS Goal, MAX(g.max_points) AS MaxPoints, COALESCE(SUM(e.received_points), 0) AS Points
            FROM zonal_awards_goal g
            JOIN zonal_awards_question q ON q.fk_goal_id = g.pk_id AND COALESCE(q.isdeleted, 0) = 0
            JOIN zonal_awards_question_option o ON o.fk_question_id = q.pk_id AND COALESCE(o.isdeleted, 0) = 0
            LEFT JOIN zonal_awards_district_entry e ON e.fk_option_id = o.pk_id AND e.fk_district_id = @D
                 AND e.fk_year_id = @Y AND e.month = 0 AND COALESCE(e.isdeleted, 0) = 0
            WHERE g.fk_year_id = @Y AND COALESCE(g.isdeleted, 0) = 0
            GROUP BY g.pk_id, g.title, g.sort_order
            ORDER BY g.sort_order, g.pk_id", new { D = districtId, Y = year.Id })).ToList();

        var ranked = clubs.Select(c => new { clubId = c.ClubId, club = c.Club, points = R(c.AutoPoints + c.ManualPoints), entries = c.Entries })
            .OrderByDescending(c => c.points).ThenBy(c => c.club).ToList();
        return new
        {
            unit = unit.Label, year = year.Label,
            zonalAwards = new
            {
                enabledForZone = zonalEnabled,
                definition = "Points the district earned toward the Zonal Awards this year, per goal (maxPoints = goal cap, when set).",
                totalPoints = R(goals.Sum(g => g.Points)),
                goals = goals.Select(g => new
                {
                    goal = g.Goal, points = R(g.Points), maxPoints = g.MaxPoints,
                    pctOfMax = g.MaxPoints is > 0 ? R(g.Points / g.MaxPoints.Value * 100m) : (decimal?)null,
                }),
            },
            citation = new
            {
                enabled = citationEnabled, definition = citationDef,
                clubs = ranked.Count,
                clubsWithPoints = ranked.Count(c => c.points > 0),
                totalPoints = R(ranked.Sum(c => c.points)),
                averagePoints = ranked.Count == 0 ? 0 : R(ranked.Sum(c => c.points) / ranked.Count),
                ranking = ranked.Take(args.Limit()),
            },
        };
    }

    // ─── goal_progress ─────────────────────────────────────────────────────────────────────

    // One target-vs-achieved line of the Goal Setting forms. Growth metrics (BaseKey set) carry an "as on
    // 1 July" count and an achieved CURRENT TOTAL; TargetIsAdditions = the target field holds only the planned
    // additions (Youth "Proposed New ..."), so the total target is base + it. Amount metrics are Foundation USD.
    // Pairings and % rules from GoalSettingService.LoadFieldsWithValuesAsync (pctMap / youthPct).
    private sealed record GoalMetric(string Category, string Label, string Unit, string AppliesTo,
        string? BaseKey, string TargetKey, string AchievedKey, string? HighestKey = null, bool TargetIsAdditions = false);

    private static readonly GoalMetric[] GoalMetrics =
    {
        new("membership", "New clubs", "clubs", "District", "total_clubs", "new_clubs", "new_clubs_achieved"),
        new("membership", "Total members", "members", "Both", "total_members", "new_members", "new_members_achieved"),
        new("membership", "Women members", "members", "Both", "existing_women_members", "new_women_members", "new_women_members_achieved"),
        new("youth_service", "Rotaract clubs", "clubs", "Both", "rotaract_existing_clubs", "rotaract_new_clubs_target", "rotaract_clubs_achieved", TargetIsAdditions: true),
        new("youth_service", "Rotaractors", "members", "Both", "rotaract_existing_members", "rotaract_new_members_target", "rotaract_members_achieved", TargetIsAdditions: true),
        new("youth_service", "Interact clubs", "clubs", "Both", "interact_existing_clubs", "interact_new_clubs_target", "interact_clubs_achieved", TargetIsAdditions: true),
        new("youth_service", "Rotary Community Corps", "corps", "Both", "rcc_existing_clubs", "rcc_new_clubs_target", "rcc_clubs_achieved", TargetIsAdditions: true),
        new("foundation", "Annual Fund", "USD", "District", null, "annual_fund_target", "annual_fund_achieved", "annual_fund_highest"),
        new("foundation", "PolioPlus Fund", "USD", "District", null, "polio_plus_target", "polio_plus_achieved", "polio_plus_highest"),
        new("foundation", "Endowment Fund", "USD", "District", null, "endowment_target", "endowment_achieved", "endowment_highest"),
        new("foundation", "CSR with RFI", "USD", "District", null, "csr_target", "csr_achieved", "csr_highest"),
        new("foundation", "Total Giving", "USD", "District", null, "total_contributions_target", "total_giving_achieved", "total_contributions_highest"),
        new("foundation", "Annual Fund per capita", "USD", "Club", null, "club_af_per_capita_target", "club_af_per_capita"),
        new("foundation", "Annual Fund YTD", "USD", "Club", null, "club_annual_fund_ytd_target", "club_annual_fund_ytd"),
        new("foundation", "PolioPlus Fund YTD", "USD", "Club", null, "club_polioplus_ytd_target", "club_polioplus_ytd"),
        new("foundation", "Other Funds YTD", "USD", "Club", null, "club_other_funds_ytd_target", "club_other_funds_ytd"),
        new("foundation", "Endowment Fund YTD", "USD", "Club", null, "club_endowment_ytd_target", "club_endowment_ytd"),
        new("foundation", "Total giving YTD", "USD", "Club", null, "club_total_target", "club_total_ytd"),
    };

    private static readonly (string Key, string Label)[] GoalCategoryLabels =
    {
        ("membership", "Membership"), ("youth_service", "Youth Service"), ("foundation", "Foundation (TRF)"), ("public_image", "Public Image"),
    };

    // From 2026-27 a district's membership baseline + achieved come from the Rotary.org import (stored);
    // clubs, and districts before that, are counted live (GoalSettingService.IsDistrictMembershipImported).
    private static readonly DateTime MembershipImportFrom = new(2026, 7, 1);

    private sealed class GoalEntryRow
    {
        public int DistrictId { get; set; }
        public string FieldKey { get; set; } = "";
        public decimal? Num { get; set; }
        public bool? Flag { get; set; }
    }

    private sealed class GoalVals
    {
        public Dictionary<string, decimal?> Num { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, bool?> Flag { get; } = new(StringComparer.Ordinal);
        public decimal? N(string? key) => key != null && Num.TryGetValue(key, out var v) ? v : null;
    }

    private sealed class LiveMembership
    {
        public int DistrictId { get; set; }
        public long Members { get; set; }
        public long Women { get; set; }
        public long NewMembers { get; set; }
        public long NewWomen { get; set; }
    }

    private sealed class LiveClubs
    {
        public int DistrictId { get; set; }
        public decimal Clubs { get; set; }
        public decimal NewClubs { get; set; }
    }

    private sealed record GoalRow(string Metric, string Unit, decimal? AsOnJul1, decimal? Highest, decimal? Target,
        decimal? PlannedNew, decimal? Achieved, decimal? Gained, decimal? Pct, int? Districts);

    private sealed record GoalValueRow(string Item, object Value);

    private static async Task<object> GoalProgressAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", GoalLevels);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.Goals, year.Id, unit.Label);
        var only = args.String("category") == null ? null : args.Enum("category", GoalCategories);
        bool Want(string cat) => only == null || only == cat;

        var entity = level == "club" ? "Club" : "District";
        await using var conn = await ctx.OpenReadOnlyAsync();

        var districtIds = level switch
        {
            "club" => new List<int>(),
            "district" => new List<int> { unit.DistrictId!.Value },
            _ => (await conn.QueryAsync<int>($@"
                SELECT d.pk_district_id FROM district_master d
                WHERE d.fk_zone_id = @Zone AND d.isdeleted = 0 AND {HierarchyScopeSql.DistrictLive("d")}
                  AND {ctx.ExcludedZonesSql("d.fk_zone_id")}", new { Zone = unit.ZoneId })).ToList(),
        };
        if (level == "zone" && districtIds.Count == 0)
            return new { unit = unit.Label, year = year.Label, note = "No active districts in this zone." };

        // Saved annual goal values (goal_entries; 0 = not applicable for the other id column). These are the
        // figures the Goal Setting forms show; imports write the till-date achieved here too.
        var entityFilter = level == "club"
            ? "e.fk_club_id = @ClubId AND e.fk_district_id = 0"
            : "e.fk_club_id = 0 AND e.fk_district_id IN @Ds";
        var entries = await conn.QueryAsync<GoalEntryRow>($@"
            SELECT e.fk_district_id AS DistrictId, f.FieldKey, e.NumericValue AS Num, e.BoolValue AS Flag
            FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0 AND f.IsActive = 1
            WHERE e.fk_year_id = @Year AND e.EntityType = @Entity AND e.isdeleted = 0 AND {entityFilter}",
            new { Year = year.Id, Entity = entity, ClubId = unit.ClubId ?? 0, Ds = districtIds });

        var vals = new Dictionary<int, GoalVals>();
        foreach (var k in level == "club" ? new List<int> { 0 } : districtIds) vals[k] = new GoalVals();
        foreach (var e in entries)
        {
            if (!vals.TryGetValue(e.DistrictId, out var v)) continue;
            v.Num[e.FieldKey] = e.Num;
            v.Flag[e.FieldKey] = e.Flag;
        }

        if (Want("membership"))
            await ApplyLiveMembershipAsync(conn, level, unit, year, districtIds, vals);
        foreach (var v in vals.Values) ApplyDerivedGoalValues(v, entity);

        var categories = new List<object>();
        foreach (var (cat, label) in GoalCategoryLabels.Where(c => Want(c.Key)))
        {
            if (cat == "public_image")
            {
                var pi = await PublicImageValuesAsync(conn, entity, vals);
                if (pi.Count > 0) categories.Add(new { category = label, values = pi });
                continue;
            }
            var metrics = GoalMetrics.Where(m => m.Category == cat && (m.AppliesTo == "Both" || m.AppliesTo == entity))
                .Select(m => level == "zone" ? ZoneGoalRow(m, vals.Values) : EntityGoalRow(m, vals.Values.Single()))
                .Where(r => r != null).ToList();
            if (metrics.Count > 0) categories.Add(new { category = label, metrics });
        }

        return new
        {
            unit = unit.Label, year = year.Label,
            figures = level == "zone" ? $"sum of the zone's {districtIds.Count} districts' own goal figures" : $"the {entity.ToLowerInvariant()}'s own goal figures",
            definitions = "Membership / Youth Service: asOnJul1 = count on 1 July; target = total aimed for by 30 June; plannedNew = " +
                          "target - asOnJul1; achieved = current total; gained = achieved - asOnJul1; pct = gained / plannedNew x 100 " +
                          "(can exceed 100). Foundation: USD till date; highest = best past giving (reference only); pct = achieved / " +
                          "target x 100. No pct = no target set. Public Image values are the planned activity counts and yes/no commitments." +
                          (level == "zone" ? " Zone rows add up only the districts that set a target (districts = how many)." : ""),
            categories,
        };
    }

    // Membership baseline + achieved, counted live from the roster the way GoalSettingService does
    // (LiveClubMemberCountAsync / AchievedNewMembersClubAsync etc.): honorary excluded, baseline = joined before
    // 1 July (or no join date), achieved = baseline + joined within the year. District counts use synced clubs only
    // for members; club counts include every live club.
    private static async Task ApplyLiveMembershipAsync(MySqlConnection conn, string level, HierarchyRef unit, RotaryYear year,
        List<int> districtIds, Dictionary<int, GoalVals> vals)
    {
        var p = new { S = year.Start, E = year.End, ClubId = unit.ClubId ?? 0, Ds = districtIds };
        const string counts = @"
            COUNT(DISTINCT CASE WHEN cm.JoinedDate IS NULL OR cm.JoinedDate < @S THEN m.pk_member_master_profile_id END) AS Members,
            COUNT(DISTINCT CASE WHEN m.Gender = 'Female' AND (cm.JoinedDate IS NULL OR cm.JoinedDate < @S) THEN m.pk_member_master_profile_id END) AS Women,
            COUNT(DISTINCT CASE WHEN cm.JoinedDate >= @S AND cm.JoinedDate <= @E THEN m.pk_member_master_profile_id END) AS NewMembers,
            COUNT(DISTINCT CASE WHEN m.Gender = 'Female' AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E THEN m.pk_member_master_profile_id END) AS NewWomen";

        if (level == "club")
        {
            var live = await conn.QuerySingleAsync<LiveMembership>($@"
                SELECT 0 AS DistrictId, {counts}
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = @ClubId AND {HierarchyScopeSql.ClubIdLive("cm.fk_club_id")}
                  AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0 AND m.isdeleted = 0", p);
            SetMembership(vals[0], live, null);
            return;
        }

        if (year.Start >= MembershipImportFrom) return;   // district figures are the stored import
        var members = (await conn.QueryAsync<LiveMembership>($@"
            SELECT c.fk_district_id AS DistrictId, {counts}
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE c.fk_district_id IN @Ds
              AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
              AND c.IsActive = 1 AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1 AND {HierarchyScopeSql.ClubLive("c")}
              AND m.isdeleted = 0
            GROUP BY c.fk_district_id", p)).ToDictionary(r => r.DistrictId);
        var clubs = (await conn.QueryAsync<LiveClubs>($@"
            SELECT c.fk_district_id AS DistrictId,
                   COALESCE(SUM(c.ClubCharterDate IS NULL OR c.ClubCharterDate < @S), 0) AS Clubs,
                   COALESCE(SUM(c.ClubCharterDate IS NOT NULL AND c.ClubCharterDate >= @S AND c.ClubCharterDate <= @E), 0) AS NewClubs
            FROM club_master c
            WHERE c.fk_district_id IN @Ds AND c.IsActive = 1 AND c.isdeleted = 0 AND {HierarchyScopeSql.ClubLive("c")}
            GROUP BY c.fk_district_id", p)).ToDictionary(r => r.DistrictId);
        foreach (var d in districtIds)
        {
            SetMembership(vals[d], members.GetValueOrDefault(d) ?? new LiveMembership(),
                clubs.GetValueOrDefault(d) ?? new LiveClubs());
        }
    }

    private static void SetMembership(GoalVals v, LiveMembership m, LiveClubs? c)
    {
        v.Num["total_members"] = m.Members;
        v.Num["existing_women_members"] = m.Women;
        v.Num["new_members_achieved"] = m.Members + m.NewMembers;
        v.Num["new_women_members_achieved"] = m.Women + m.NewWomen;
        if (c == null) return;
        v.Num["total_clubs"] = c.Clubs;
        v.Num["new_clubs_achieved"] = c.Clubs + c.NewClubs;
    }

    // Values the Goal Setting forms always work out instead of reading (LoadFieldsWithValuesAsync).
    private static void ApplyDerivedGoalValues(GoalVals v, string entity)
    {
        decimal? Sum(params string[] keys) =>
            keys.Any(k => v.N(k) != null) ? keys.Sum(k => v.N(k) ?? 0m) : null;
        if (entity == "District")
        {
            // Total Giving achieved = the four funds' achieved, always (locked on the form).
            v.Num["total_giving_achieved"] = Sum("annual_fund_achieved", "polio_plus_achieved", "endowment_achieved", "csr_achieved");
            return;
        }
        // Club Total: target is computed from the four fund targets; achieved is auto-filled only when blank.
        v.Num["club_total_target"] = v.N("club_total_target")
            ?? Sum("club_annual_fund_ytd_target", "club_polioplus_ytd_target", "club_other_funds_ytd_target", "club_endowment_ytd_target");
        v.Num["club_total_ytd"] = v.N("club_total_ytd")
            ?? Sum("club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd");
    }

    private static (decimal? Base, decimal? Target, decimal? Achieved, decimal? Highest) GoalValues(GoalMetric m, GoalVals v)
    {
        var b = v.N(m.BaseKey);
        var t = v.N(m.TargetKey);
        if (m.TargetIsAdditions && t != null) t = (b ?? 0m) + t;
        return (b, t, v.N(m.AchievedKey), v.N(m.HighestKey));
    }

    private static decimal? GoalPct(GoalMetric m, decimal? b, decimal? t, decimal? a)
    {
        if (a == null || t is not > 0m) return null;
        if (m.BaseKey == null) return R(a.Value / t.Value * 100m);
        var planned = t.Value - (b ?? 0m);
        if (planned <= 0m) return m.TargetIsAdditions ? null : (a >= t ? 100m : 0m);
        return Math.Round(Math.Max(0m, (a.Value - (b ?? 0m)) / planned * 100m), 0, MidpointRounding.AwayFromZero);
    }

    private static GoalRow? BuildGoalRow(GoalMetric m, decimal? b, decimal? t, decimal? a, decimal? h, int? districts)
    {
        if (t == null && a == null) return null;
        bool growth = m.BaseKey != null;
        return new GoalRow(m.Label, m.Unit, growth ? R(b) : null, h is > 0m ? R(h) : null, R(t),
            growth && t != null ? R(t - (b ?? 0m)) : null, R(a),
            growth && a != null ? R(a - (b ?? 0m)) : null, GoalPct(m, b, t, a), districts);
    }

    private static GoalRow? EntityGoalRow(GoalMetric m, GoalVals v)
    {
        var (b, t, a, h) = GoalValues(m, v);
        return BuildGoalRow(m, b, t, a, h, null);
    }

    // Zone: add up the districts that set a target, so the % compares like with like; when none did, the
    // baseline / achieved totals of every district are still shown, without a %.
    private static GoalRow? ZoneGoalRow(GoalMetric m, IEnumerable<GoalVals> districts)
    {
        var per = districts.Select(v => GoalValues(m, v)).ToList();
        var withTarget = per.Where(x => x.Target is > 0m).ToList();
        var use = withTarget.Count > 0 ? withTarget : per;
        decimal? Total(Func<(decimal? Base, decimal? Target, decimal? Achieved, decimal? Highest), decimal?> f) =>
            use.Any(x => f(x) != null) ? use.Sum(x => f(x) ?? 0m) : null;
        return BuildGoalRow(m, Total(x => x.Base), Total(x => x.Target), Total(x => x.Achieved), null, use.Count);
    }

    // Public Image has no target/achieved pair: each field is the figure the club / district committed to.
    // Text suggestions are left out. Zone: counts add up, yes/no becomes "n of N districts".
    private static async Task<List<GoalValueRow>> PublicImageValuesAsync(MySqlConnection conn, string entity, Dictionary<int, GoalVals> vals)
    {
        var fields = await conn.QueryAsync<(string Key, string Label, string DataType)>(@"
            SELECT f.FieldKey, f.FieldLabel, f.DataType
            FROM goal_fields f
            JOIN goal_categories gc ON gc.pk_category_id = f.fk_category_id AND gc.isdeleted = 0
            WHERE gc.Name = 'Public Image' AND f.isdeleted = 0 AND f.IsActive = 1 AND f.IsHidden = 0
              AND f.DataType IN ('Integer', 'Boolean', 'Percentage')
              AND (f.AppliesTo = 'Both' OR f.AppliesTo = @Entity)
            ORDER BY f.SortOrder, f.pk_field_id", new { Entity = entity });

        var list = new List<GoalValueRow>();
        foreach (var f in fields)
        {
            if (f.DataType == "Boolean")
            {
                var answers = vals.Values.Select(v => v.Flag.TryGetValue(f.Key, out var b) ? b : null).Where(b => b != null).ToList();
                if (answers.Count == 0) continue;
                list.Add(new GoalValueRow(f.Label, vals.Count == 1
                    ? (answers[0] == true ? "Yes" : "No")
                    : $"Yes in {answers.Count(b => b == true)} of {vals.Count} districts"));
                continue;
            }
            var nums = vals.Values.Select(v => v.N(f.Key)).Where(n => n != null).Select(n => n!.Value).ToList();
            if (nums.Count == 0 || (f.DataType == "Percentage" && vals.Count > 1)) continue;
            list.Add(new GoalValueRow(f.Label + (f.DataType == "Percentage" ? " (%)" : ""), R(nums.Sum())));
        }
        return list;
    }
}

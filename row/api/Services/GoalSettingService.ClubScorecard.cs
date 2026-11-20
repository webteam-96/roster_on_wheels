using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>"Club Goals at a glance" (OCV, user 2026-11-12): one row per goal + the Yes/No checklist.</summary>
public sealed class ClubGoalScorecard
{
    public List<ClubGoalScorecardRow> Rows { get; } = new();
    public List<(string Label, bool? Yes)> Checklist { get; } = new();
    public List<string> AsOn { get; } = new();
}
public sealed record ClubGoalScorecardRow(string Goal, decimal? Target, decimal? Achieved, decimal? Pct, bool Money);

public partial class GoalSettingService
{
    // Same rows / figures as the web scorecard (components/goal-rotary/ClubGoalScorecard.tsx) - keep the
    // two in step. Membership / Foundation = the Club Goals form figures (same loader, same %); the rest =
    // the club's Rotary.org goals. READ-ONLY system call for the OCV report; no caller scope.
    private static readonly (string Goal, string Item)[] ScorecardRotaryRows =
    {
        ("Rotaract clubs", "Rotaract clubs"), ("Interact clubs", "Interact clubs"), ("Service projects", "Service projects"),
        ("Media stories", "Media stories about club projects"), ("New member sponsorship", "New member sponsorship"),
    };
    private static readonly (string Label, string Item)[] ScorecardChecklist =
    {
        ("Strategic plan", "Strategic plan"), ("Online presence", "Online presence"),
        ("Bylaws reviewed", "Review and consider updating your club bylaws"),
        ("Rotary promotional materials", "Use of official Rotary promotional materials"),
    };

    public async Task<ClubGoalScorecard> GetClubGoalScorecardAsync(int clubId, int yearId)
    {
        var sc = new ClubGoalScorecard();
        if (clubId <= 0 || yearId <= 0) return sc;
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var (y, _, isEditable) = await ResolveYearAsync(conn, yearId);
        if (y == 0) return sc;

        var mem = await LiveValuesByKeyAsync(conn, 1, y, "Club", clubId, 0, isEditable);
        decimal? M(string k) => mem.TryGetValue(k, out var v) ? v : null;
        if (mem.Count > 0)
        {
            sc.Rows.Add(new("Members", M("new_members"), M("new_members_achieved"), M("percentage_increase"), false));
            sc.Rows.Add(new("Women members", M("new_women_members"), M("new_women_members_achieved"), M("women_percentage_achievement"), false));
            sc.AsOn.Add($"Membership as on {await AchievedAsOnAsync(conn, 1, y, "Club", clubId, 0) ?? "1 July"}");
        }

        var fnd = await LiveValuesByKeyAsync(conn, 210, y, "Club", clubId, 0, isEditable);
        decimal? F(string k) => fnd.TryGetValue(k, out var v) ? v : null;
        foreach (var (goal, k) in new[] { ("Annual Fund", "club_annual_fund_ytd"), ("PolioPlus Fund", "club_polioplus_ytd"),
                     ("Endowment Fund", "club_endowment_ytd"), ("Other funds", "club_other_funds_ytd"), ("Total giving", "club_total") })
        {
            var ach = k == "club_total" ? "club_total_ytd" : k;
            if (!fnd.ContainsKey(ach)) continue;
            sc.Rows.Add(new(goal, F($"{k}_target"), F(ach), F($"{k}_pct"), true));
        }
        if (fnd.Count > 0 && await AchievedAsOnAsync(conn, 210, y, "Club", clubId, 0) is { } fAsOn) sc.AsOn.Add($"Foundation as on {fAsOn}");

        // Latest Rotary.org figure per goal + kind for this club.
        var ro = (await conn.QueryAsync<(string Item, string Kind, decimal? V, DateTime At)>(@"
            SELECT ItemName, Kind, NumericValue, COALESCE(modified_date, created_date)
            FROM goal_rotary_org_values
            WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_club_id = @C AND isdeleted = 0
            ORDER BY COALESCE(modified_date, created_date) DESC", new { Y = y, C = clubId }))
            .GroupBy(r => (r.Item, r.Kind)).ToDictionary(g => g.Key, g => g.First());
        decimal? R(string item, string kind) => ro.TryGetValue((item, kind), out var r) ? r.V : null;
        static decimal? Nz(decimal? v) => v is null or 0 ? null : v;
        foreach (var (goal, item) in ScorecardRotaryRows)
        {
            decimal? t = R(item, "Target"), a = R(item, "Achieved");
            if (Nz(t) == null && Nz(a) == null) continue;
            sc.Rows.Add(new(goal, t, a, Nz(t) != null && a != null ? Math.Round(a.Value / t!.Value * 100, 0, MidpointRounding.AwayFromZero) : null, false));
        }
        foreach (var (label, item) in ScorecardChecklist)
        {
            if (!ro.ContainsKey((item, "Target")) && !ro.ContainsKey((item, "Achieved"))) continue;
            var a = R(item, "Achieved");
            sc.Checklist.Add((label, a == null ? null : a > 0));
        }
        if (ro.Count > 0) sc.AsOn.Add($"Rotary.org as on {ro.Values.Max(r => r.At):dd MMM yyyy}");
        return sc;
    }

    /// <summary>"—" for 0 / blank, else the figure ($ for money, % for Pct) - shared by the OCV Word / Excel.</summary>
    public static string ScorecardCell(decimal? v, bool money = false, bool pct = false) =>
        v is null or 0 ? "—"
            : $"{(money ? "$" : "")}{v.Value.ToString("#,##0.##", System.Globalization.CultureInfo.InvariantCulture)}{(pct ? "%" : "")}";
}

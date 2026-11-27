using RotaryApi.Controllers;
using RotaryApi.Services;

namespace RotaryApi.Tests;

// New goal flow (ported from RIZones 2026-11-27): District Set Goals batch save, RCC Set Points scoring, Disha off switch.
public class GoalFlowTests
{
    private static GoalFlowController.GoalValueDto G(string t, int line, int club, decimal? v) =>
        new() { LineType = t, LineId = line, ClubId = club, GoalValue = v };

    [Fact]
    public void Save_keeps_only_lines_of_the_district_live_clubs_and_unlocked_sections_last_value_wins()
    {
        var valid = new HashSet<(string, int)> { ("auto", 1), ("rcc", 2) };
        var clubs = new HashSet<int> { 10, 11 };
        var sectionOf = new Dictionary<(string, int), string> { [("auto", 1)] = "other", [("rcc", 2)] = "reach" };
        var locks = new Dictionary<int, HashSet<string>> { [11] = new() { "reach" } };
        var sent = new[]
        {
            G("auto", 1, 10, 5), G("auto", 1, 10, 7),   // sent twice: last wins
            G("auto", 99, 10, 1),                        // not a line of this district + year
            G("auto", 1, 12, 1),                         // not a live club of the district
            G("rcc", 2, 11, 3),                          // club 11 has "reach" locked
            G("rcc", 2, 10, null),                       // cleared goal is still written (as NULL)
            G("auto", 1, 11, 4),
        };
        var saved = GoalFlowController.GoalsToSave(sent, valid, clubs, locks, sectionOf);
        Assert.Equal(3, saved.Count);
        Assert.Equal(7, saved.Single(g => g.LineType == "auto" && g.ClubId == 10).GoalValue);
        Assert.Contains(saved, g => g.LineType == "rcc" && g.ClubId == 10 && g.GoalValue == null);
        Assert.Contains(saved, g => g.LineType == "auto" && g.ClubId == 11);
        Assert.DoesNotContain(saved, g => g.LineType == "rcc" && g.ClubId == 11);
    }

    [Fact]
    public void Save_writes_300_goals_per_statement()
    {
        var goals = Enumerable.Range(1, 650).Select(i => G("auto", i, 10, i)).ToList();
        var batches = GoalFlowController.GoalBatches(goals, districtId: 5, yearId: 7, memberId: 9).ToList();
        Assert.Equal(new[] { 300, 300, 50 }, batches.Select(b => b.Params.ParameterNames.Count(n => n.StartsWith("l"))));
        Assert.All(batches, b => Assert.Contains("ON DUPLICATE KEY UPDATE goal_value = VALUES(goal_value)", b.Sql));
        Assert.Equal(650m, batches[2].Params.Get<decimal?>("g49"));   // values go in as parameters
        Assert.Empty(GoalFlowController.GoalBatches(new List<GoalFlowController.GoalValueDto>(), 5, 7, 9));
    }

    private static GoalFlowController.GoalLine Rule(decimal pts, int per = 1, bool bonus = false, decimal bonusPts = 0, int min = 0, int max = 0) =>
        new() { IsRcc = true, Points = pts, PerUnit = per, IsBonus = bonus, BonusPoints = bonusPts, MinBonus = min, MaxBonus = max };

    [Fact]
    public void Rcc_points_follow_the_district_awards_auto_formula()
    {
        Assert.Equal(0, GoalFlowController.RccPointsOf(Rule(5), null));            // no Rotary.org figure
        Assert.Equal(0, GoalFlowController.RccPointsOf(Rule(5), 0));
        Assert.Equal(0, GoalFlowController.RccPointsOf(Rule(0), 12));              // no rule set
        Assert.Equal(60, GoalFlowController.RccPointsOf(Rule(5), 12.7m));          // whole units: 12 x 5
        Assert.Equal(20, GoalFlowController.RccPointsOf(Rule(5, per: 3), 12));     // every 3: 4 x 5
        Assert.Equal(70, GoalFlowController.RccPointsOf(Rule(5, bonus: true, bonusPts: 10), 12));             // bonus, no min / max
        Assert.Equal(60, GoalFlowController.RccPointsOf(Rule(5, bonus: true, bonusPts: 10, min: 20), 12));    // below the minimum
        Assert.Equal(50, GoalFlowController.RccPointsOf(Rule(5, bonus: true, bonusPts: 10, min: 15, max: 10), 12)); // capped at 10 x 5, below min: no bonus
        Assert.Equal(60, GoalFlowController.RccPointsOf(Rule(5, bonus: true, bonusPts: 10, min: 12, max: 10), 12));      // capped 10 x 5 + bonus 10
    }

    [Fact]
    public void Disha_goals_sit_behind_a_flagged_switch_and_district_set_goals_do_not()
    {
        var disha = FeatureGate.All.Single(f => f.Key == "disha_goals");
        Assert.Equal(FeatureGate.Kind.Flagged, disha.Kind);   // off until a Super Admin turns it on
        Assert.Equal("disha_goals", FeatureGate.Match("/api/disha-awards/categories", "GET")?.Key);
        Assert.Equal("disha_goals", FeatureGate.Match("/api/disha-awards/district/5/answers", "POST")?.Key);
        Assert.Equal("disha_goals", FeatureGate.Match("/api/goal-flow/disha/5", "GET")?.Key);
        Assert.Null(FeatureGate.Match("/api/goal-flow/district-set-goals/district/5", "GET"));
        Assert.Null(FeatureGate.Match("/api/goal-flow/district-set-goals/district/5/rcc-points", "PUT"));
        Assert.Contains(disha.Admin, a => System.Text.RegularExpressions.Regex.IsMatch("/district-admin-dashboard/disha-goals", a));
    }
}

using RotaryApi.Services.Assistant;

namespace RotaryApi.Tests;

// Zone 5 holds district 10 (clubs 100, 101); zone 6 holds district 20 (club 200); zone 99 is a placeholder zone.
public class ScopeGuardTests
{
    private static readonly ScopeTarget Club100 = new(5, 10, 100);
    private static readonly ScopeTarget Club101 = new(5, 10, 101);
    private static readonly ScopeTarget Club200 = new(6, 20, 200);
    private static readonly ScopeTarget District10 = new(5, 10, null);
    private static readonly ScopeTarget District20 = new(6, 20, null);
    private static readonly ScopeTarget Zone5 = new(5, null, null);
    private static readonly ScopeTarget Placeholder = new(99, 990, null);
    private const int Year = 7;

    private static bool Agg(AssistantScope s, ScopeTarget t, DataArea area = DataArea.General, int? year = Year) =>
        ScopeGuard.CanSee(s, t, ScopeDepth.Aggregate, area, year);
    private static bool Detail(AssistantScope s, ScopeTarget t, DataArea area = DataArea.General, int? year = Year) =>
        ScopeGuard.CanSee(s, t, ScopeDepth.Detail, area, year);

    [Fact]
    public void SuperAdmin_sees_everything()
    {
        var s = new AssistantScope { IsSuperAdmin = true };
        Assert.True(Agg(s, ScopeTarget.Global));
        Assert.True(Detail(s, Club200));
        Assert.True(Agg(s, Placeholder));
    }

    [Fact]
    public void RiDirector_sees_everything_but_placeholder_zones()
    {
        var s = new AssistantScope { IsRiDirector = true, ExcludedZones = { 99 } };
        Assert.True(Agg(s, ScopeTarget.Global));
        Assert.True(Detail(s, Club200));
        Assert.False(Agg(s, Placeholder));
    }

    [Fact]
    public void ZonalCoordinator_gets_totals_for_the_zone_only()
    {
        var s = new AssistantScope { CoordinatorZones = { 5 } };
        Assert.True(Agg(s, Zone5));
        Assert.True(Agg(s, District10));
        Assert.True(Agg(s, Club100));
        Assert.False(Detail(s, Club100));
        Assert.False(Detail(s, District10));
        Assert.False(Agg(s, District20));
        Assert.False(Agg(s, Club200));
        Assert.False(Agg(s, ScopeTarget.Global));
    }

    [Fact]
    public void DistrictAdmin_without_all_clubs_access_gets_totals_only()
    {
        var s = new AssistantScope { AdminDistricts = { 10 } };
        Assert.True(Agg(s, District10));
        Assert.True(Agg(s, Club100));
        Assert.False(Detail(s, Club100));
        Assert.False(Agg(s, Zone5));
        Assert.False(Agg(s, Club200));
        Assert.False(Agg(s, District20));
    }

    [Fact]
    public void DistrictAdmin_with_all_clubs_access_gets_club_detail()
    {
        var s = new AssistantScope { AdminDistricts = { 10 }, AllClubsDistricts = { 10 } };
        Assert.True(Detail(s, Club100));
        Assert.True(Detail(s, District10));
        Assert.False(Detail(s, Club200));
    }

    [Fact]
    public void ClubAdmin_sees_only_their_club()
    {
        var s = new AssistantScope { AdminClubs = { 100 } };
        Assert.True(Agg(s, Club100));
        Assert.True(Detail(s, Club100));
        Assert.False(Agg(s, Club101));
        Assert.False(Agg(s, District10));   // their club does NOT open up the whole district
        Assert.False(Agg(s, Zone5));
    }

    [Fact]
    public void AG_is_bound_to_the_years_they_held_the_club()
    {
        var s = new AssistantScope { AgClubYears = { [100] = new HashSet<int> { Year } } };
        Assert.True(Agg(s, Club100, year: Year));
        Assert.True(Detail(s, Club100, year: Year));
        Assert.False(Agg(s, Club100, year: Year + 1));
        Assert.False(Agg(s, Club100, year: null));
        Assert.False(Agg(s, Club101, year: Year));
        Assert.False(Agg(s, District10, year: Year));
    }

    [Fact]
    public void ClubModerator_sees_projects_only()
    {
        var s = new AssistantScope { ModeratorClubs = { 100 } };
        Assert.True(Agg(s, Club100, DataArea.Projects));
        Assert.False(Agg(s, Club100, DataArea.General));
        Assert.False(Agg(s, Club100, DataArea.Goals));
    }

    [Fact]
    public void GoalRole_sees_goal_data_only()
    {
        var s = new AssistantScope { GoalZones = { 5 } };
        Assert.True(Agg(s, District10, DataArea.Goals));
        Assert.True(Agg(s, Club100, DataArea.Goals));
        Assert.False(Agg(s, District10, DataArea.General));
        Assert.False(Agg(s, District20, DataArea.Goals));
        Assert.False(Agg(s, ScopeTarget.Global, DataArea.Goals));
    }

    [Fact]
    public void Member_with_no_roles_has_no_reach()
    {
        var s = new AssistantScope();
        Assert.False(s.HasAnyReach);
        Assert.False(Agg(s, Club100));
        Assert.False(Agg(s, ScopeTarget.Global));
    }

    [Fact]
    public void Fingerprint_changes_with_reach()
    {
        var a = new AssistantScope { AgClubYears = { [100] = new HashSet<int> { 7 } } };
        var b = new AssistantScope { AgClubYears = { [100] = new HashSet<int> { 8 } } };
        var a2 = new AssistantScope { AgClubYears = { [100] = new HashSet<int> { 7 } } };
        Assert.NotEqual(a.Fingerprint(), b.Fingerprint());
        Assert.Equal(a.Fingerprint(), a2.Fingerprint());
    }
}

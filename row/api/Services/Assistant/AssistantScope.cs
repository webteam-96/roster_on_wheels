using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services.Assistant;

// What the signed-in member may see through the assistant. Built from the DB on every request
// (AssistantScopeBuilder) - never from the token's roles claim or anything the client sends.
//
// Two depths:
//   Aggregate  - counts and totals (members joined, projects, dues collected, reports submitted).
//   Detail     - rows about people or money (member lists, contact details, dues lines).
//
// Reach per role mirrors the existing dashboards:
//   SuperAdmin            everything
//   RI Director (role 7)  everything except the two placeholder zones ('Other Zones', 'Zone 0')
//   Zonal Coordinator     aggregate for every district and club in the zone
//   District Admin        aggregate for the district; detail only with AllClubsAccess
//   Club Admin            aggregate + detail for the club
//   AG                    aggregate + detail for the (club, year) pairs in district_ag
//   Club Moderator        projects of the moderated clubs only
//   Goal roles            goal data only, for the assigned zones / districts
public sealed class AssistantScope
{
    public int MemberId { get; init; }
    public string MemberName { get; init; } = "";

    public bool IsSuperAdmin { get; init; }
    public bool IsRiDirector { get; init; }
    public HashSet<int> ExcludedZones { get; init; } = new();   // RI Director placeholder zones

    public HashSet<int> CoordinatorZones { get; init; } = new();
    public HashSet<int> AdminDistricts { get; init; } = new();
    public HashSet<int> AllClubsDistricts { get; init; } = new();
    public HashSet<int> AdminClubs { get; init; } = new();
    public Dictionary<int, HashSet<int>> AgClubYears { get; init; } = new();
    public HashSet<int> ModeratorClubs { get; init; } = new();

    public HashSet<int> GoalZones { get; init; } = new();
    public HashSet<int> GoalDistricts { get; init; } = new();

    public bool IsGlobal => IsSuperAdmin || IsRiDirector;

    public bool HasAnyReach =>
        IsGlobal || CoordinatorZones.Count > 0 || AdminDistricts.Count > 0 || AdminClubs.Count > 0 ||
        AgClubYears.Count > 0 || ModeratorClubs.Count > 0 || GoalZones.Count > 0 ||
        GoalDistricts.Count > 0;

    // One line for the model, so it knows what it can and cannot be asked about.
    public string Describe()
    {
        if (IsSuperAdmin) return "Super Admin - may see every zone, district and club.";
        var parts = new List<string>();
        if (IsRiDirector) parts.Add("RI Director - every zone except the placeholder zones");
        if (CoordinatorZones.Count > 0) parts.Add($"Zonal Coordinator for zone ids {Ids(CoordinatorZones)}");
        if (AdminDistricts.Count > 0) parts.Add($"District Admin for district ids {Ids(AdminDistricts)}" +
            (AllClubsDistricts.Count > 0 ? $" (club-level detail for {Ids(AllClubsDistricts)})" : ""));
        if (AdminClubs.Count > 0) parts.Add($"Club Admin for club ids {Ids(AdminClubs)}");
        if (AgClubYears.Count > 0) parts.Add($"Assistant Governor for club ids {Ids(AgClubYears.Keys)} (only the years assigned)");
        if (ModeratorClubs.Count > 0) parts.Add($"Club Moderator (projects only) for club ids {Ids(ModeratorClubs)}");
        if (GoalZones.Count > 0 || GoalDistricts.Count > 0)
            parts.Add($"Goal Setting role for zone ids {Ids(GoalZones)} district ids {Ids(GoalDistricts)} (goal data only)");
        return string.Join("; ", parts) + ".";
    }

    // Stable hash of everything that decides what this member can see. Part of every cache key, so
    // two members share a cached answer only when they can see exactly the same data.
    public string Fingerprint()
    {
        var sb = new StringBuilder();
        sb.Append(IsSuperAdmin ? "SA|" : "").Append(IsRiDirector ? "RI|" : "");
        sb.Append("x").Append(Ids(ExcludedZones)).Append("|zc").Append(Ids(CoordinatorZones))
          .Append("|da").Append(Ids(AdminDistricts)).Append("|dac").Append(Ids(AllClubsDistricts))
          .Append("|ca").Append(Ids(AdminClubs)).Append("|mod").Append(Ids(ModeratorClubs))
          .Append("|ag");
        foreach (var kv in AgClubYears.OrderBy(k => k.Key)) sb.Append(kv.Key).Append(':').Append(Ids(kv.Value)).Append(';');
        sb.Append("|gz").Append(Ids(GoalZones)).Append("|gd").Append(Ids(GoalDistricts));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())))[..32];
    }

    private static string Ids(IEnumerable<int> ids) => string.Join(",", ids.OrderBy(i => i));
}

// Where a piece of data lives in the hierarchy. A club target carries its district and zone; a
// district target carries its zone. Tools look these up (HierarchyLookup) before asking the guard.
public sealed record ScopeTarget(int? ZoneId, int? DistrictId, int? ClubId)
{
    public static ScopeTarget Global { get; } = new(null, null, null);
    public bool IsGlobal => ZoneId == null && DistrictId == null && ClubId == null;
}

public enum ScopeDepth { Aggregate, Detail }

// Which family of data a tool reads - moderators may only touch projects, goal roles only goals.
public enum DataArea { General, Projects, Goals }

// Pure permission logic (no DB) so every rule is unit-tested in RotaryApi.Tests.
public static class ScopeGuard
{
    public static bool CanSee(AssistantScope s, ScopeTarget t, ScopeDepth depth, DataArea area, int? yearId)
    {
        if (s.IsSuperAdmin) return true;
        if (t.ZoneId is int z0 && s.ExcludedZones.Contains(z0) && !HasNonGlobalReach(s, t, depth, area, yearId)) return false;
        if (s.IsRiDirector) return true;
        return HasNonGlobalReach(s, t, depth, area, yearId);
    }

    private static bool HasNonGlobalReach(AssistantScope s, ScopeTarget t, ScopeDepth depth, DataArea area, int? yearId)
    {
        // Goal data: goal assignments add reach on top of the admin roles.
        if (area == DataArea.Goals && GoalReach(s, t)) return true;

        // Everything below is admin reach. A goal-only member has none, so they get goal data only.
        if (t.IsGlobal) return false;

        if (t.ClubId is int club)
        {
            if (s.AdminClubs.Contains(club)) return true;
            if (AgCovers(s, club, yearId)) return true;
            if (area == DataArea.Projects && s.ModeratorClubs.Contains(club)) return true;
            if (t.DistrictId is int cd && s.AllClubsDistricts.Contains(cd)) return true;
            if (depth == ScopeDepth.Detail) return false;
            if (t.DistrictId is int d && s.AdminDistricts.Contains(d)) return true;
            if (t.ZoneId is int z && s.CoordinatorZones.Contains(z)) return true;
            return false;
        }

        if (t.DistrictId is int district)
        {
            if (depth == ScopeDepth.Detail) return s.AllClubsDistricts.Contains(district);
            if (s.AdminDistricts.Contains(district)) return true;
            return t.ZoneId is int z && s.CoordinatorZones.Contains(z);
        }

        // Zone level: Zonal Coordinators only, and only for totals.
        return depth == ScopeDepth.Aggregate && t.ZoneId is int zone && s.CoordinatorZones.Contains(zone);
    }

    private static bool GoalReach(AssistantScope s, ScopeTarget t)
    {
        if (t.DistrictId is int d && s.GoalDistricts.Contains(d)) return true;
        return t.ZoneId is int z && s.GoalZones.Contains(z);
    }

    // An AG sees a club only for the years they were its AG. No year given = not covered, so tools
    // always resolve a year before checking.
    private static bool AgCovers(AssistantScope s, int club, int? yearId) =>
        yearId is int y && s.AgClubYears.TryGetValue(club, out var years) && years.Contains(y);
}

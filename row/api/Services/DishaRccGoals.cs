namespace RotaryApi.Services;

// Disha Goals (user 2026-11-18): the Goal Setting / RCC boxes shown in the Disha Overview get their OWN Disha goal
// (table disha_rcc_goal) - set only by the RI Director / Super Admin / DG, never by a Rotary.org sync or RISAO import.
// Goals lock per district + section (disha_goal_lock), like Goal Overview: a locked section is read only for everyone
// (RI Director / SA / DG) until the RI Director / SA unlock it. Same list as rotary-frontend/src/lib/dishaRccGoals.ts.
public static class DishaRccGoals
{
    public static readonly string[] Sections = { "reach", "impact", "adapt", "engage", "other" };

    static string R(string name) => "rotary_" + System.Text.RegularExpressions.Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "_") + "_target";

    // The goal box of each card -> its Rotary.org section (goalRotaryLayout.ts).
    public static readonly Dictionary<string, string> GoalKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        ["new_clubs"] = "reach", ["new_members"] = "reach", ["new_women_members"] = "reach",
        ["rotaract_new_clubs_target"] = "reach", ["interact_new_clubs_target"] = "reach",
        [R("New member sponsorship")] = "reach", [R("RYLA participation")] = "reach", [R("Media stories about club projects")] = "reach",
        ["annual_fund_target"] = "impact", ["polio_plus_target"] = "impact",
        [R("Major gifts")] = "impact", [R("Bequest Society members")] = "impact", [R("Benefactors")] = "impact",
        [R("Inbound Youth Exchange students")] = "impact", [R("Outbound Youth Exchange students")] = "impact", [R("Service projects")] = "impact",
        [R("Strategic plan")] = "adapt", [R("Club bylaws review")] = "adapt", [R("Online presence")] = "adapt", [R("Update website and social media")] = "adapt",
        [R("Leadership development participation")] = "engage", [R("District conference attendance")] = "engage",
        [R("District training participation")] = "engage", [R("Rotary Action Group participation")] = "engage",
        [R("Rotary Fellowship participation")] = "engage", [R("Service participation")] = "engage",
        [R("Social activities")] = "engage", [R("Use of official Rotary promotional materials")] = "engage",
    };

    static string Norm(string s) => new string((s ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    // A Disha category -> its section (the 4 default categories carry the Rotary.org section names).
    public static string SectionOfCategory(string? category) => Norm(category ?? "") switch
    {
        "expandourreach" => "reach",
        "increaseourimpact" => "impact",
        "increaseourabilitytoadapt" => "adapt",
        "enhanceparticipantengagement" => "engage",
        _ => "other",
    };
}

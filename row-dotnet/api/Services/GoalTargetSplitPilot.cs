namespace RotaryApi.Services;

/// <summary>
/// Quarterly / month-wise TARGET SPLIT pilot (user 2026-09-25): while the split is tested live, only
/// these clubs / districts get the Quarterly and Month-wise buttons on their Goal Setting screen, and
/// only they may save a split. Everyone else sees Goal Setting exactly as before — the yearly target
/// is untouched for every club and district either way.
///
/// The web page uses the same list (rotary-frontend/src/utils/goalSplitPilot.ts) — change BOTH.
///
/// To open it to everyone: set <see cref="Enabled"/> to false here and in the web helper. Nothing
/// else needs to change, and splits already saved by the pilot stay exactly as they are.
/// </summary>
public static class GoalTargetSplitPilot
{
    public static readonly bool Enabled = true;

    /// <summary>Thane City View (pk_club_id 2765).</summary>
    public static readonly int[] ClubIds = { 2765 };

    /// <summary>District 5656 (pk_district_id 2).</summary>
    public static readonly int[] DistrictIds = { 2 };

    public static bool AllowsClub(int clubId) => !Enabled || ClubIds.Contains(clubId);

    public static bool AllowsDistrict(int districtId) => !Enabled || DistrictIds.Contains(districtId);

    /// <summary>Message shown when someone outside the pilot reaches a split endpoint.</summary>
    public const string NotInPilotMessage =
        "The quarterly / month-wise target split is still being tested and is not open for this club or district yet.";
}

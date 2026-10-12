namespace RotaryApi.Services;

/// <summary>
/// Which clubs / districts the scheduled WhatsApp send picks up, per module.
///
/// It started as a single pilot list (2026-09-17: Thane City View + District 5656) while the new
/// templates were tested live. On 2026-09-30 the user opened it up:
///
///   • CLUBS — Upcoming Events, Announcements and Newsletters are open to EVERY club.
///   • DISTRICTS — Upcoming Events are open to EVERY district. District Announcements and the
///     district GML stay on the pilot list, because the district GML has no approved template of its
///     own yet (it still runs on the old text one) and the district no-image announcement template
///     still carries the clickable header the user wants removed.
///
/// RI-scope items (no club, no district) were never gated and still are not.
/// The web page checkbox follows the same rules — rotary-frontend/src/utils/whatsappPilot.ts.
///
/// ⚠ Opening a module SENDS WHAT IS ALREADY QUEUED: any item of a newly-opened club/district whose
/// publish (or reminder) time has passed goes out on the next 5-second poll, and deducts credits.
/// Review the backlog before flipping a module open.
/// </summary>
public static class WhatsAppPilot
{
    public enum Module { Event, Announcement, Newsletter }

    /// <summary>Every club may send, in every module (2026-09-30).</summary>
    public const bool AllClubsOpen = true;

    /// <summary>Districts still limited to the list below, except where <see cref="DistrictOpen"/> says otherwise.</summary>
    public static readonly int[] DistrictIds = { 2 };   // District 5656

    /// <summary>Kept for callers that still reference the old pilot club list.</summary>
    public static readonly int[] ClubIds = { 2765 };    // Thane City View

    /// <summary>True when every district may send in this module.</summary>
    public static bool DistrictOpen(Module module) => module == Module.Event;

    /// <summary>
    /// SQL condition for the item table alias ("" = no alias). Empty string when nothing is filtered.
    /// Needs <see cref="Params"/> (@PilotClubIds, @PilotDistrictIds).
    /// </summary>
    public static string SqlFilter(Module module, string alias = "")
    {
        var p = string.IsNullOrEmpty(alias) ? "" : alias + ".";

        // Everyone is open in this module - no filter at all.
        if (AllClubsOpen && DistrictOpen(module)) return "";

        if (AllClubsOpen)
            // Every club and every RI row passes; a DISTRICT row only when it is on the pilot list.
            return $" AND (COALESCE({p}fk_district_id, 0) = 0 OR {p}fk_district_id IN @PilotDistrictIds)";

        // Original pilot shape: RI rows, or a pilot club / district.
        return $" AND ((COALESCE({p}fk_club_id, 0) = 0 AND COALESCE({p}fk_district_id, 0) = 0)" +
               $" OR {p}fk_club_id IN @PilotClubIds OR {p}fk_district_id IN @PilotDistrictIds)";
    }

    public static object Params => new { PilotClubIds = ClubIds, PilotDistrictIds = DistrictIds };
}

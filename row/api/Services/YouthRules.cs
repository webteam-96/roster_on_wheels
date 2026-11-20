namespace RotaryApi.Services;

/// <summary>Pure rules of the youth programs (gap #12), kept apart from SQL so they are unit-tested.</summary>
public static class YouthRules
{
    public static readonly string[] Programs = { "ryla", "rli" };
    public static readonly string[] Statuses = { "applied", "approved", "declined", "attended", "completed", "withdrawn" };
    public const int ExpiringDays = 60;

    /// <summary>
    /// Participant status flow. The district youth chair decides: applied -> approved | declined, approved -> attended |
    /// declined, attended -> completed. The sponsoring club's youth officer may only withdraw an applied or approved
    /// participant. Anything else is refused.
    /// </summary>
    public static bool MayMove(string from, string to, bool chair) => (from, to) switch
    {
        ("applied" or "approved", "withdrawn") => true,
        _ when !chair => false,
        ("applied", "approved" or "declined") => true,
        ("approved", "attended" or "declined") => true,
        ("attended", "completed") => true,
        _ => false,
    };

    /// <summary>incomplete (a date missing) | expired | expiring (within 60 days) | cleared.</summary>
    public static string ClearanceState(DateTime? training, DateTime? check, DateTime? expiry, DateTime today)
    {
        if (training == null || check == null || expiry is not { } e) return "incomplete";
        if (e.Date < today.Date) return "expired";
        return e.Date <= today.Date.AddDays(ExpiringDays) ? "expiring" : "cleared";
    }

    /// <summary>The first problem with a clearance record, or null. Training and check are past events; expiry follows the check.</summary>
    public static string? ClearanceError(DateTime? training, DateTime? check, DateTime? expiry, DateTime today)
    {
        if (training?.Date > today.Date) return "The training date cannot be in the future.";
        if (check?.Date > today.Date) return "The background check date cannot be in the future.";
        if (expiry != null && check == null) return "Enter the background check date before its expiry.";
        if (expiry != null && expiry.Value.Date <= check!.Value.Date) return "The expiry date must be after the background check date.";
        if (expiry?.Date > today.Date.AddYears(10)) return "The expiry date is too far ahead.";
        return null;
    }

    /// <summary>The first problem with a participant, or null.</summary>
    public static string? ParticipantError(string? program, string? fullName, string? contactEmail)
    {
        if (program == null || !Programs.Contains(program)) return "Choose RYLA or RLI.";
        if (string.IsNullOrWhiteSpace(fullName) || fullName.Trim().Length > 150) return "Enter the participant's name (150 characters at most).";
        if (!string.IsNullOrWhiteSpace(contactEmail))
        {
            try { VolunteerService.CleanEmail(contactEmail); }
            catch (InvalidOperationException) { return "Enter a valid contact email, or leave it empty."; }
        }
        return null;
    }
}

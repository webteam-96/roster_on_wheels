namespace RotaryApi.Services;

/// <summary>
/// Single source of truth for "is this project date sane?".
///
/// WHY this exists: projects live in year-partitioned tables (rotary_projects_YYYY_YY) and the
/// destination table — plus the rotary_year_master row — is DERIVED from project_date
/// (see RotaryYearHelper.EnsureRotaryYearAsync). So a typo'd year does not just store a wrong
/// date, it AUTO-CREATES a junk rotary year and a junk pair of year tables that then show up
/// forever in the public year filter. Real examples that got through: `0026-01-22` produced a
/// "25-26" year, `0225-07-15` produced "225-26", and `2028-09-09` produced "2028-29".
/// Rejecting the date at the API is what stops this at the source.
///
/// Two bounds, deliberately in ONE place so every write path enforces the same rule:
///   • not later than today (server date) — same-day is allowed
///   • not before <see cref="MinYear"/> — the 0026-…/0225-… typos are *past* dates, so a
///     future-only check would miss them entirely
/// </summary>
public static class ProjectDateValidator
{
    /// <summary>Earliest plausible project year. Anything below this is a typo, not history.</summary>
    public const int MinYear = 1985;

    public const string FutureMessage = "Project date cannot be in the future.";
    public static readonly string OutOfRangeMessage =
        $"Project date is not valid — please check the year (it must be {MinYear} or later).";

    /// <summary>
    /// Returns null when the date is acceptable, otherwise the user-facing message to send back
    /// with HTTP 400. A null date is treated as acceptable here — callers that allow a missing
    /// date keep their existing behaviour (the year then falls back to the current rotary year).
    /// </summary>
    public static string? Validate(DateTime? date)
    {
        if (!date.HasValue) return null;

        var value = date.Value.Date;
        if (value > DateTime.Today) return FutureMessage;
        if (value.Year < MinYear) return OutOfRangeMessage;
        return null;
    }

    /// <summary>
    /// Same rule for callers whose DTO carries the date as text (district modules).
    /// Blank or unparseable text is left alone — those cases are already handled by the
    /// existing call sites and this validator must not change their behaviour.
    /// </summary>
    public static string? ValidateText(string? date)
    {
        if (string.IsNullOrWhiteSpace(date)) return null;
        if (!DateTime.TryParse(date, out var parsed)) return null;
        return Validate(parsed);
    }

    /// <summary>
    /// Service-layer form. Throws InvalidOperationException — the exception type the project
    /// endpoints already translate into <c>BadRequest(new { message = ex.Message })</c>.
    /// </summary>
    public static void ThrowIfInvalid(DateTime? date)
    {
        var error = Validate(date);
        if (error is not null) throw new InvalidOperationException(error);
    }
}

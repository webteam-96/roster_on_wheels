namespace RotaryApi.Services;

/// <summary>
/// Single source of truth for the "COG" club treatment.
///
/// COG (club 31598) is a roster of past District Governors rather than a real club.
/// Its club_members rows carry a free-text past-DG label in Designation
/// ("3292 Dg 2025 - 26" = district number + Rotary year) and have no meaningful
/// admission/joining date — only 1,433 of 1,816 rows even have one, and the date is a
/// legacy artifact. So anywhere a COG row is surfaced we suppress JoinedDate and expose
/// the district + Rotary year instead.
///
/// EVERY report, export and mobile endpoint uses the fragments below — the Designation
/// parsing is deliberately NOT repeated inline anywhere else.
///
/// Keying rule: always test the CLUB ID OF THE ROW BEING RENDERED (cm.fk_club_id), never
/// the member's other memberships. 840 of COG's 1,108 active members also belong to a
/// real club; those rows must keep their normal joining date.
/// </summary>
public static class CogDesignationHelper
{
    public const int CogClubId = 31598;

    public static bool IsCog(int clubId) => clubId == CogClubId;

    // ── SQL fragments ────────────────────────────────────────────────────────
    // `cm` is the club_members alias in the caller's query.

    /// Leading digit run of the label: "3292 Dg 2025 - 26" -> "3292".
    public static string DistrictSql(string cm = "cm") =>
        $"NULLIF(REGEXP_SUBSTR({cm}.Designation, '^[0-9]+'), '')";

    /// First 4-digit run AFTER the district token: "3292 Dg 2025 - 26" -> "2025".
    /// The leading token must be stripped first — a plain '[0-9]{4}' match returns the
    /// DISTRICT number, which is exactly the bug this replaced.
    public static string YearStartSql(string cm = "cm") =>
        $"NULLIF(REGEXP_SUBSTR(TRIM(SUBSTRING({cm}.Designation, LENGTH(REGEXP_SUBSTR({cm}.Designation, '^[0-9]+')) + 1)), '[0-9]{{4}}'), '')";

    /// "2025" -> "2025-26", as a SQL expression (NULL when unparseable).
    public static string YearLabelSql(string cm = "cm")
    {
        var y = YearStartSql(cm);
        return $"CASE WHEN {y} IS NULL THEN NULL ELSE CONCAT({y}, '-', LPAD((CAST({y} AS SIGNED) + 1) % 100, 2, '0')) END";
    }

    /// District number column, NULL on every non-COG row.
    public static string DistrictColumn(string cm = "cm") =>
        $"CASE WHEN {cm}.fk_club_id = {CogClubId} THEN {DistrictSql(cm)} END";

    /// Rotary-year label column, NULL on every non-COG row.
    public static string YearColumn(string cm = "cm") =>
        $"CASE WHEN {cm}.fk_club_id = {CogClubId} THEN {YearLabelSql(cm)} END";

    /// Wraps a JoinedDate so COG rows return NULL and every other club is untouched.
    public static string JoinedDateExpr(string cm = "cm") =>
        $"CASE WHEN {cm}.fk_club_id = {CogClubId} THEN NULL ELSE {cm}.JoinedDate END";

    /// The two extra columns, ready to append to a member SELECT list.
    /// Caller supplies the trailing comma placement.
    public static string SelectColumns(string cm = "cm") =>
        $"{DistrictColumn(cm)} AS cogDistrictNumber,\n                   {YearColumn(cm)} AS cogYear";

    // ── C#-side equivalents ──────────────────────────────────────────────────

    /// "2025" -> "2025-26". Null for blank/unparseable input, so callers can simply hide
    /// the field on rows whose designation isn't year-structured (COG has a handful of
    /// free-text labels like "Director" / "Partner").
    public static string? ToRotaryYearLabel(string? startYear)
    {
        if (string.IsNullOrWhiteSpace(startYear) || !int.TryParse(startYear, out var y)) return null;
        return $"{y}-{(y + 1) % 100:D2}";
    }

    /// Split a raw Designation label into (district, Rotary-year label) in memory —
    /// for callers that already hold the string and don't want a second query.
    public static (string? DistrictNumber, string? YearLabel) Parse(string? designation)
    {
        if (string.IsNullOrWhiteSpace(designation)) return (null, null);
        var s = designation.Trim();

        var i = 0;
        while (i < s.Length && char.IsDigit(s[i])) i++;
        var district = i > 0 ? s.Substring(0, i) : null;

        // First 4-digit run in what's left after the district token.
        var rest = s.Substring(i);
        string? yearStart = null;
        for (var j = 0; j + 4 <= rest.Length; j++)
        {
            if (char.IsDigit(rest[j]) && char.IsDigit(rest[j + 1]) && char.IsDigit(rest[j + 2]) && char.IsDigit(rest[j + 3]))
            {
                yearStart = rest.Substring(j, 4);
                break;
            }
        }
        return (district, ToRotaryYearLabel(yearStart));
    }

    /// Recombine into the canonical stored shape — "3292 Dg 2025 - 26".
    /// 793 of the 1,097 populated COG rows already use exactly this format.
    public static string Compose(string districtNumber, string yearLabel)
    {
        var start = int.Parse(yearLabel.Substring(0, 4));
        return $"{districtNumber.Trim()} Dg {start} - {(start + 1) % 100:D2}";
    }
}

namespace RotaryApi.Services;

/// <summary>
/// The time zone of the person making the request. The admin sends its browser zone (<c>X-Time-Zone</c>, an IANA id
/// such as "Europe/Paris"); the app sends its current UTC offset in minutes (<c>X-Time-Zone-Offset</c>). A time typed
/// into a form without a zone ("2026-11-20T18:00") is that person's wall-clock time and is stored as UTC.
/// Falls back to the brand zone when a request names none (background jobs, old clients).
/// </summary>
public static class ViewerZone
{
    private const int MaxOffsetMinutes = 14 * 60;

    /// <summary>Set once at startup from Program.cs.</summary>
    public static IHttpContextAccessor? Accessor { get; set; }

    public static TimeZoneInfo Current => FromHeaders(Accessor?.HttpContext?.Request.Headers);

    public static TimeZoneInfo FromHeaders(IHeaderDictionary? headers)
    {
        var id = headers?["X-Time-Zone"].ToString().Trim();
        if (!string.IsNullOrEmpty(id) && ZoneTime.IsValidId(id))
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        if (int.TryParse(headers?["X-Time-Zone-Offset"].ToString(), out var minutes) && Math.Abs(minutes) <= MaxOffsetMinutes)
            return minutes == 0 ? TimeZoneInfo.Utc
                : TimeZoneInfo.CreateCustomTimeZone($"UTC{minutes:+0;-0}m", TimeSpan.FromMinutes(minutes), null, null);
        return Brand.TimeZone;
    }

    /// <summary>
    /// A date-time typed by this viewer, as it is stored: with an offset ("Z", "+01:00") the instant in UTC; zone-less
    /// with a time of day the viewer's wall-clock in UTC; a date or midnight unchanged. The same rule as
    /// UtcDateTimeConverter.Read, for values that arrive in forms and query strings.
    /// </summary>
    public static bool TryParseIncoming(string text, System.Globalization.CultureInfo? culture, out DateTime value)
    {
        text = text.Trim();
        var styles = System.Globalization.DateTimeStyles.AllowWhiteSpaces;
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        bool HasOffset(string t) => t.EndsWith('Z') || t.EndsWith('z')
            || System.Text.RegularExpressions.Regex.IsMatch(t, @"T.*[+-]\d{2}:?\d{2}$");
        if (HasOffset(text) && DateTimeOffset.TryParse(text, ci, styles, out var withOffset))
        {
            value = withOffset.UtcDateTime;
            return true;
        }
        if (!DateTime.TryParse(text, ci, styles, out value) && !(culture != null && DateTime.TryParse(text, culture, styles, out value)))
            return false;
        value = DateTime.SpecifyKind(value, DateTimeKind.Unspecified);
        if (ZoneTime.StoredUtc && value.TimeOfDay != TimeSpan.Zero) value = ToUtc(value);
        return true;
    }

    /// <summary>A zone-less wall-clock time from this viewer, as UTC.</summary>
    public static DateTime ToUtc(DateTime wallClock) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(wallClock, DateTimeKind.Unspecified), Current);
}

namespace RotaryApi.Services;

// Character limits for the four communication content types (Upcoming Events, Announcements,
// Newsletters, Documents) — enforced server-side on BOTH club and district create/update, so a
// too-long body can never reach the WhatsApp template (whose ~650-char ceiling would fail the
// send). MUST match the frontend rotary-frontend/src/lib/commsLimits.ts values.
public static class CommsLimits
{
    public const int EventTitle = 50;
    public const int EventVenue = 70;
    public const int EventDescription = 450;

    public const int AnnouncementTitle = 50;
    public const int AnnouncementDescription = 520;

    public const int NewsletterTitle = 50;
    public const int DocumentTitle = 50;

    // Trims to <= max (never throws). Use for defensive server-side clamping of an incoming value.
    public static string? Clamp(string? value, int max)
    {
        if (string.IsNullOrEmpty(value)) return value;
        var v = value.Trim();
        return v.Length <= max ? v : v.Substring(0, max);
    }

    // Throws InvalidOperationException when the value exceeds max — use to reject over-limit input.
    public static void Require(string? value, int max, string fieldName)
    {
        if (!string.IsNullOrEmpty(value) && value.Trim().Length > max)
            throw new InvalidOperationException($"{fieldName} must be {max} characters or fewer.");
    }
}

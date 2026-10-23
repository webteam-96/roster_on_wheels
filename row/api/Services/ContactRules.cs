using System.Net.Mail;
using System.Text.RegularExpressions;

namespace RotaryApi.Services;

/// <summary>Input rules shared by contacts, prospects and the public join/RSVP forms (N3, 2026-10-23).
/// Validation failures throw <see cref="ArgumentException"/>, which the controllers answer with 400.</summary>
public static class ContactRules
{
    public static readonly string[] ContactTypes = { "guest", "speaker", "sponsor", "partner", "volunteer" };
    public static readonly string[] Stages = { "inquiry", "contacted", "invited", "attended", "proposed", "approved", "inducted" };

    private static readonly Regex PhoneChars = new(@"^\+?[0-9 ()\-.]{4,}$", RegexOptions.Compiled);

    /// <summary>Trimmed value, or null when blank.</summary>
    public static string? Clean(string? value, int max, string field)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        if (v.Length > max) throw new ArgumentException($"{field} must be {max} characters or fewer.");
        return v;
    }

    public static string Name(string? value)
        => Clean(value, 200, "Name") ?? throw new ArgumentException("Name is required.");

    public static string? Email(string? value)
    {
        var v = Clean(value, 200, "Email");
        if (v == null) return null;
        var at = v.LastIndexOf('@');
        if (!MailAddress.TryCreate(v, out var a) || a.Address != v || at < 1 || !v[(at + 1)..].Contains('.'))
            throw new ArgumentException("Email is not valid.");
        return v.ToLowerInvariant();
    }

    public static string? Phone(string? value, int max = 30)
    {
        var v = Clean(value, max, "Phone");
        if (v != null && !PhoneChars.IsMatch(v)) throw new ArgumentException("Phone number is not valid.");
        return v;
    }

    /// <summary>Digits only, for comparing phone numbers typed in different formats.</summary>
    public static string Digits(string? phone) => new((phone ?? "").Where(char.IsDigit).ToArray());

    public static string ContactType(string? value)
    {
        var v = (value ?? "").Trim().ToLowerInvariant();
        if (v.Length == 0) return "guest";
        return ContactTypes.Contains(v) ? v : throw new ArgumentException($"Type must be one of: {string.Join(", ", ContactTypes)}.");
    }

    public static string Stage(string value)
    {
        var v = value.Trim().ToLowerInvariant();
        return Stages.Contains(v) ? v : throw new ArgumentException($"Stage must be one of: {string.Join(", ", Stages)}.");
    }
}

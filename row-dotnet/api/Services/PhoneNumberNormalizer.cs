using System.Text.RegularExpressions;

namespace RotaryApi.Services;

/// <summary>
/// Removes a leading country code from a mobile number. The country code is stored separately
/// (fk_primary_country_id / fk_secondary_country_id → country_master.PhoneCode), so the number
/// column must hold only the local part. The Flutter app prepends the code before saving
/// ("+91 7700900123"); callers on the mobile write path run the DTO through this first.
/// </summary>
public static class PhoneNumberNormalizer
{
    // "+<1-4 digits>" followed by at least one space / dash / dot, e.g. "+91 7700900123", "+94-771234567".
    private static readonly Regex SeparatedCode = new(@"^\+\d{1,4}[\s\-.]+", RegexOptions.Compiled);

    /// <param name="number">Raw number as received.</param>
    /// <param name="phoneCode">The chosen country's PhoneCode (e.g. "+91"). Needed to strip a code with no
    /// separator ("+917700900123") — without it we can't tell a 1-digit code from a 3-digit one.</param>
    /// <returns>The number without the code, or the trimmed input unchanged when no code is present.</returns>
    public static string? StripCountryCode(string? number, string? phoneCode)
    {
        if (string.IsNullOrWhiteSpace(number)) return number;
        var n = number.Trim();
        // A few legacy rows carry the code twice ("+91 +91 77009 00124") — peel up to 3 layers.
        for (var i = 0; i < 3 && n.StartsWith('+'); i++)
        {
            var next = StripOnce(n, phoneCode);
            if (next == n) break;
            n = next;
        }
        return n;
    }

    private static string StripOnce(string n, string? phoneCode)
    {
        var codeDigits = new string((phoneCode ?? "").Where(char.IsDigit).ToArray());
        var afterPlus = n[1..].TrimStart();

        // 1) Known country code — handles both "+91 7700…" and "+917700…".
        if (codeDigits.Length > 0 && afterPlus.StartsWith(codeDigits, StringComparison.Ordinal))
        {
            var rest = afterPlus[codeDigits.Length..].TrimStart(' ', '-', '.');
            if (rest.Any(char.IsDigit)) return rest.Trim();
        }

        // 2) Code for another country but clearly separated — "+44 7700900123" while the country says India.
        var m = SeparatedCode.Match(n);
        if (m.Success)
        {
            var rest = n[m.Length..].Trim();
            if (rest.Any(char.IsDigit)) return rest;
        }

        // 3) Ambiguous ("+447700900123" with a different country selected) — leave as-is rather than guess.
        return n;
    }
}

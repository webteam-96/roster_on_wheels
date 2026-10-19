using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Phone-number helpers. ROW sends no SMS or WhatsApp (decided 2026-10-19): all communication is in-app or email,
/// so the Twilio / Meta senders that used to live here were removed.
/// </summary>
public static class RowPhone
{
    /// <summary>"+1" + "416 555 0100" → "+14165550100". A national number's trunk "0" is dropped. Null when unusable.</summary>
    public static string? ToE164(string? nationalNumber, string? dialCode)
    {
        var raw = (nationalNumber ?? "").Trim();
        if (raw.Length == 0) return null;
        static string Digits(string s) => new(s.Where(char.IsDigit).ToArray());
        if (raw.StartsWith('+'))
        {
            var d = Digits(raw);
            return d.Length is >= 8 and <= 15 ? "+" + d : null;
        }
        var code = Digits(dialCode ?? "");
        if (code.Length == 0) return null;
        var digits = Digits(raw).TrimStart('0');
        if (digits.StartsWith(code) && digits.Length > code.Length + 6) digits = digits[code.Length..];
        var full = code + digits;
        return full.Length is >= 8 and <= 15 ? "+" + full : null;
    }

    /// <summary>
    /// E.164 for a number held without its country: "+..." as written; otherwise the given dial code, else the
    /// country of the member who has this mobile, else the brand's default country (<c>Brand:Locale:DefaultCountryId</c>).
    /// The original platform assumed India (+91) here. Null when no country can be established.
    /// </summary>
    public static async Task<string?> ResolveE164Async(string? connectionString, string? mobile, string? dialCode = null)
    {
        var raw = (mobile ?? "").Trim();
        if (raw.Length == 0) return null;
        if (raw.StartsWith('+')) return ToE164(raw, null);
        if (!string.IsNullOrWhiteSpace(dialCode)) return ToE164(raw, dialCode);
        if (string.IsNullOrWhiteSpace(connectionString)) return null;
        try
        {
            await using var conn = new MySqlConnection(connectionString);
            await conn.OpenAsync();
            var code = await conn.ExecuteScalarAsync<string?>(@"
                SELECT c.PhoneCode FROM member_master_profile m
                JOIN country_master c ON c.pk_country_id = CASE WHEN m.PrimaryMobileNumber = @M THEN m.fk_primary_country_id ELSE m.fk_secondary_country_id END
                WHERE m.PrimaryMobileNumber = @M OR m.SecondaryMobileNumber = @M
                LIMIT 1", new { M = raw });
            code ??= await DialCodeAsync(conn, Brand.DefaultCountryId);
            return ToE164(raw, code);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>The dial code ("+44") of a country_master row, or null.</summary>
    public static async Task<string?> DialCodeAsync(MySqlConnection conn, int? countryId) =>
        countryId is > 0
            ? await conn.ExecuteScalarAsync<string?>("SELECT PhoneCode FROM country_master WHERE pk_country_id = @Id", new { Id = countryId })
            : null;
}

using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Which channels a one-time code goes out on (master plan WS6M, same rule as the NestJS edition):
/// <c>Brand:Providers:OtpPolicy</c> maps an ISO country code (or "*") to channels in order of preference —
/// ROW: <c>{"*": ["email", "whatsapp", "sms"]}</c>. The original platform's rule (India = SMS, elsewhere = email) is the
/// policy <c>{"IN": ["sms"], "*": ["email"]}</c>. SMS goes through Twilio and WhatsApp through Meta (RowMessaging.cs)
/// when <c>Brand:Providers:Sms</c> / <c>:WhatsApp</c> are "twilio" / "meta". A provider without credentials reports
/// "not sent", so the next channel is tried.
/// </summary>
public static class OtpChannelPolicy
{
    /// <summary>The policy's channels for the member's country, keeping only those this edition can send.</summary>
    public static async Task<IReadOnlyList<string>> ChannelsForAsync(MySqlConnection conn, int? countryId)
    {
        string? iso = null;
        if (countryId is > 0)
            iso = await conn.ExecuteScalarAsync<string?>(
                "SELECT CountryCode FROM country_master WHERE pk_country_id = @Id AND isdeleted = 0", new { Id = countryId });
        var policy = Brand.OtpPolicy;
        var channels = (iso != null && policy.TryGetValue(iso.Trim().ToUpperInvariant(), out var forCountry) ? forCountry
                        : policy.TryGetValue("*", out var any) ? any : new[] { "email" })
            .Select(c => c.Trim().ToLowerInvariant());
        return channels.Where(Available).Distinct().ToList();
    }

    private static bool Available(string channel) => channel switch
    {
        "email" => true,
        "sms" => Brand.SmsProvider.Equals("twilio", StringComparison.OrdinalIgnoreCase),
        "whatsapp" => Brand.WhatsAppProvider.Equals("meta", StringComparison.OrdinalIgnoreCase),
        _ => false,
    };
}

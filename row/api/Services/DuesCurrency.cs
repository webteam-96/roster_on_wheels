using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Club Dues / District Dues currency (RIZones 2026-11-09, ROW form): Super Admin picks the currency per dues.
// ROW is international, so this is a real currency code from the instance list (Brand.Currencies), shown with
// Brand.Money; RIZones' INR/USD "sign only" flag does not apply. No WhatsApp in ROW, so only the email switch.
public static class DuesCurrency
{
    public static string Normalize(string? code)
    {
        var c = code?.Trim().ToUpperInvariant();
        return !string.IsNullOrEmpty(c) && Brand.Currencies.Contains(c) ? c : Brand.DefaultCurrency;
    }

    public static string Money(decimal value, string? code) => Brand.Money(value, Normalize(code));

    // Defaults for a NEW dues when Super Admin sent no flags: email on, the district's default currency.
    public static async Task<(bool? email, string? currency)> CreateDefaultsAsync(
        MySqlConnection conn, int districtId, bool? email, string? currency, System.Data.IDbTransaction? tx = null)
    {
        if (email != null && currency != null) return (email, Normalize(currency));
        var districtCurrency = await conn.ExecuteScalarAsync<string?>(
            "SELECT DefaultCurrency FROM district_master WHERE pk_district_id=@Id", new { Id = districtId }, tx);
        return (email ?? true, Normalize(currency ?? districtCurrency));
    }
}

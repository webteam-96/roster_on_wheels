using System.Globalization;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// System-wide default club-website pricing (New amount / Renewal amount / GST%).
// SuperAdmin edits these from settings/wallet, OTP-gated; they are stored in system_settings.
// This is the LAST tier of the price-resolution chain used by both the club-admin self-service
// flow and the SuperAdmin reminder links:
//     per-club override row  →  per-district override row  →  THIS global default  →  appsettings seed.
// When a key has never been set, we fall back to appsettings (Razorpay:WebsitePrice /
// WebsiteRenewalPrice / GstPercent), so the system always has a price even before anyone edits it.
public static class WebsiteDefaultPricing
{
    public const string KeyNew = "ClubWebsiteDefaultNewAmount";
    public const string KeyRenewal = "ClubWebsiteDefaultRenewalAmount";
    public const string KeyGst = "ClubWebsiteDefaultGstPercent";

    // IsCustom => at least one value has been saved from the UI (i.e. it's not a pure appsettings fallback).
    public sealed record Defaults(decimal NewAmount, decimal RenewalAmount, decimal GstPercent, bool IsCustom);

    public static async Task<Defaults> ResolveAsync(MySqlConnection conn, IConfiguration config)
    {
        decimal cfgNew = config.GetValue("Razorpay:WebsitePrice", 14999m);
        decimal cfgRenewal = config.GetValue("Razorpay:WebsiteRenewalPrice", cfgNew);
        decimal cfgGst = config.GetValue("Razorpay:GstPercent", 18m);

        var rows = (await conn.QueryAsync<dynamic>(
            "SELECT SettingKey AS settingKey, SettingValue AS settingValue FROM system_settings WHERE SettingKey IN (@A, @B, @C)",
            new { A = KeyNew, B = KeyRenewal, C = KeyGst })).ToList();

        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            string key = (string)r.settingKey;
            string? val = (string?)r.settingValue;
            if (!string.IsNullOrWhiteSpace(val)) map[key] = val;
        }

        decimal Pick(string key, decimal fallback) =>
            map.TryGetValue(key, out var raw) &&
            decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var v) && v >= 0
                ? v : fallback;

        decimal gst = Pick(KeyGst, cfgGst);
        if (gst > 100m) gst = cfgGst;

        return new Defaults(
            Pick(KeyNew, cfgNew),
            Pick(KeyRenewal, cfgRenewal),
            gst,
            map.Count > 0);
    }
}

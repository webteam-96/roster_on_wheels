using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// N5 Communication: language resolution, per-language templates, the Governor note and the send filter.
/// Also compiled into the GreetingsWorker (linked file, like Brand.cs), so it uses only Dapper and MySqlConnector.
/// A tenant is a club (clubId, 0) or a district (0, districtId); (0, 0) is the platform.
/// shortcut: greetings, the meeting reminder and mass emails use templates; other reminders (dues, website renewal)
/// keep their English text until they move to templates.
/// </summary>
public static class CommsTemplates
{
    public const string FeatureKey = "communication";

    public static readonly Regex LanguageCode = new(@"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$", RegexOptions.Compiled);
    private static readonly Regex Placeholder = new(@"\{\{\s*([a-z_]+)\s*\}\}", RegexOptions.Compiled);

    private static readonly Lazy<Dictionary<string, string>> NameToCode = new(() =>
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in CultureInfo.GetCultures(CultureTypes.NeutralCultures))
            if (c.Name.Length > 0) map.TryAdd(c.EnglishName, c.Name);
        return map;
    });

    /// <summary>
    /// The language code of a member record's PrimaryLanguage: a code as the member set it ("es", "pt-BR"), or an
    /// English name from the profile form or the Rotary.org sync ("Spanish"). Null when unknown ("Other", blank).
    /// </summary>
    public static string? LanguageOf(string? value)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        if (LanguageCode.IsMatch(v)) return v;
        return NameToCode.Value.TryGetValue(v, out var code) ? code : null;
    }

    /// <summary>Whether the flagged module is on (platform_features), for code outside the API's FeatureGate cache.</summary>
    public static async Task<bool> IsOnAsync(MySqlConnection conn)
    {
        try
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM platform_features WHERE feature_key = @K AND enabled = 1", new { K = FeatureKey }) > 0;
        }
        catch (MySqlException)
        {
            return false; // table not created yet: the module is off
        }
    }

    /// <summary>The tenant's language: the club's setting, else its district's, else the platform's.</summary>
    public static async Task<string> DefaultLanguageAsync(MySqlConnection conn, int clubId, int districtId)
    {
        var lang = await conn.ExecuteScalarAsync<string?>(@"
            SELECT COALESCE(
                (SELECT default_language FROM comm_settings WHERE fk_club_id = @C AND fk_district_id = 0 AND @C > 0),
                (SELECT default_language FROM comm_settings WHERE fk_club_id = 0
                    AND fk_district_id = IF(@C > 0, (SELECT fk_district_id FROM club_master WHERE pk_club_id = @C), @D)))",
            new { C = clubId, D = districtId });
        return string.IsNullOrWhiteSpace(lang) ? Brand.DefaultLanguage : lang;
    }

    public sealed record Template(string Language, string Subject, string BodyHtml);

    /// <summary>Every language version of one template key for a tenant.</summary>
    public static async Task<Dictionary<string, Template>> LoadAsync(MySqlConnection conn, int clubId, int districtId, string key)
        => (await conn.QueryAsync<Template>(@"
                SELECT language AS Language, subject AS Subject, body_html AS BodyHtml FROM comm_templates
                WHERE fk_club_id = @C AND fk_district_id = @D AND template_key = @K",
                new { C = clubId, D = districtId, K = key }))
            .ToDictionary(t => t.Language, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The version in the member's language (or its base language: "pt-BR", then "pt"), else in the tenant language;
    /// null when the tenant has neither, so the caller keeps its own text.
    /// </summary>
    public static Template? Pick(IReadOnlyDictionary<string, Template> versions, string? memberLanguage, string tenantLanguage)
    {
        if (versions.Count == 0) return null;
        foreach (var lang in new[] { LanguageOf(memberLanguage), tenantLanguage })
        {
            if (string.IsNullOrEmpty(lang)) continue;
            if (versions.TryGetValue(lang, out var t)) return t;
            var dash = lang.IndexOf('-');
            if (dash > 0 && versions.TryGetValue(lang[..dash], out t)) return t;
        }
        return null;
    }

    /// <summary>Replaces {{name}} placeholders. Values are HTML-encoded for a body; unknown placeholders stay as typed.</summary>
    public static string Fill(string text, IReadOnlyDictionary<string, string?> values, bool html)
        => Placeholder.Replace(text, m => values.TryGetValue(m.Groups[1].Value, out var v)
            ? (html ? WebUtility.HtmlEncode(v ?? "") : (v ?? "").Replace("\r", " ").Replace("\n", " "))
            : m.Value);

    /// <summary>The district's Governor note as an email block, or null when the district has not switched it on.</summary>
    public static async Task<string?> GovernorNoteHtmlAsync(MySqlConnection conn, int districtId)
    {
        var n = await conn.QueryFirstOrDefaultAsync<(string? Name, string? Photo, string? Message)>(@"
            SELECT governor_name, governor_photo_url, governor_message FROM comm_settings
            WHERE fk_club_id = 0 AND fk_district_id = @D AND governor_note_enabled = 1", new { D = districtId });
        return string.IsNullOrWhiteSpace(n.Name) || string.IsNullOrWhiteSpace(n.Message) ? null : GovernorNoteHtml(n.Name, n.Photo, n.Message);
    }

    // shortcut: the "District Governor" label is English; translate it with the template frame when a tenant needs it.
    public static string GovernorNoteHtml(string name, string? photoUrl, string message)
    {
        static string E(string s) => WebUtility.HtmlEncode(s);
        var photo = string.IsNullOrWhiteSpace(photoUrl) ? ""
            : $"<img src=\"{E(photoUrl)}\" alt=\"{E(name)}\" width=\"64\" height=\"64\" style=\"width:64px;height:64px;border-radius:32px;object-fit:cover;float:left;margin:0 12px 6px 0\" />";
        var text = E(message).Replace("\r\n", "\n").Replace("\n", "<br>");
        return $@"<div style=""margin:20px 0 0 0;padding:16px 0 0 0;border-top:1px solid #e2e8f0;overflow:hidden"">{photo}<p style=""margin:0;font-style:italic"">{text}</p><p style=""margin:8px 0 0 0;font-weight:bold"">{E(name)}</p><p style=""margin:0;color:#64748b;font-size:13px"">District Governor</p></div>";
    }

    /// <summary>
    /// SQL (a boolean expression) that is true when this member must not get bulk email: they withdrew email consent,
    /// or the address is suppressed for the sending tenant or the platform. clubExpr / districtExpr are SQL values for
    /// the sending tenant (columns or parameters, never user input).
    /// </summary>
    public static string EmailBlockedSql(string memberIdCol, string emailCol, string clubExpr, string districtExpr) => $@"(
        EXISTS (SELECT 1 FROM member_channel_consents k WHERE k.fk_member_id = {memberIdCol} AND k.channel = 'email' AND k.consented = 0)
        OR EXISTS (SELECT 1 FROM comm_suppressions s WHERE s.email = LOWER(TRIM({emailCol}))
                   AND ((s.fk_club_id = {clubExpr} AND s.fk_district_id = {districtExpr}) OR (s.fk_club_id = 0 AND s.fk_district_id = 0))))";

    /// <summary>SQL true when the member switched push messages off.</summary>
    public static string PushBlockedSql(string memberIdCol)
        => $"EXISTS (SELECT 1 FROM member_channel_consents k WHERE k.fk_member_id = {memberIdCol} AND k.channel = 'push' AND k.consented = 0)";
}

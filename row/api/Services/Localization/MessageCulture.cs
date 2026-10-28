using System.Globalization;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Localization;

/// <summary>
/// S5: the culture a message is written in. <see cref="Use"/> sets CurrentUICulture (which text IStringLocalizer
/// returns) and CurrentCulture (how dates and numbers format) for one recipient, and restores both on Dispose. Both
/// flow across await.
/// Call Use in the method that writes the text: a culture set inside an awaited async method is undone when that
/// method returns, so a helper returns the language and the caller calls Use.
/// Keep URLs, amounts in links and other machine-read values out of the scope, or format them with
/// CultureInfo.InvariantCulture: inside it, 12.5 prints as "12,5" in many languages.
/// </summary>
public static class MessageCulture
{
    public static IDisposable Use(string? language)
    {
        var (ui, fmt) = (CultureInfo.CurrentUICulture, CultureInfo.CurrentCulture);
        var culture = Resolve(language);
        if (culture != null) CultureInfo.CurrentUICulture = CultureInfo.CurrentCulture = culture;
        return new Restore(ui, fmt);
    }

    private static CultureInfo? Resolve(string? language)
    {
        var code = CommsTemplates.LanguageOf(language);
        if (code == null) return null;
        try { return CultureInfo.GetCultureInfo(code); }
        catch (CultureNotFoundException) { return null; }
    }

    private sealed class Restore(CultureInfo ui, CultureInfo fmt) : IDisposable
    {
        public void Dispose() { CultureInfo.CurrentUICulture = ui; CultureInfo.CurrentCulture = fmt; }
    }

    /// <summary>
    /// A member's language: their own PrimaryLanguage, else their first active club's language (club, then district,
    /// then the platform default). Null for an unknown member.
    /// </summary>
    public static async Task<string?> ForMemberAsync(MySqlConnection conn, int memberId)
    {
        var m = await conn.QueryFirstOrDefaultAsync<(string? Language, int ClubId)>(@"
            SELECT p.PrimaryLanguage,
                   COALESCE((SELECT cm.fk_club_id FROM club_members cm WHERE cm.fk_member_master_profile_id = p.pk_member_master_profile_id
                             AND cm.IsActive = 1 AND cm.isdeleted = 0 ORDER BY cm.fk_club_id LIMIT 1), 0)
            FROM member_master_profile p WHERE p.pk_member_master_profile_id = @Id", new { Id = memberId });
        return m == default ? null : await PickAsync(conn, m.Language, m.ClubId);
    }

    /// <summary>The language for an email address: the member with that address, else null (the caller's default).</summary>
    public static async Task<string?> ForEmailAsync(MySqlConnection conn, string email)
    {
        var id = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId = @E LIMIT 1", new { E = email.Trim() });
        return id is int m ? await ForMemberAsync(conn, m) : null;
    }

    // shortcut: PrimaryLanguage defaults to 'English' in the schema, so English cannot be told from "never chosen"
    // and the tenant's language wins over it; add an explicit "message language" field if members need to opt out.
    private static async Task<string> PickAsync(MySqlConnection conn, string? memberLanguage, int clubId)
    {
        var own = CommsTemplates.LanguageOf(memberLanguage);
        return own != null && !ServerStrings.IsEnglish(own) ? own : await CommsTemplates.DefaultLanguageAsync(conn, clubId, 0);
    }
}

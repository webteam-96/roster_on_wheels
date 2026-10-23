using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;
using RotaryApi.Controllers;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Multilingual club and district websites (build spec 3.11). A site has a default language and up to ten more.
/// The default language's titles and bodies stay where they are edited today (club_website_about,
/// club_website_menu / club_website_submenu); a website_translations row overrides them for one language, field by
/// field, and carries that language's SEO title and description. Pages are the custom menu pages, the story is the
/// About page (there is no separate stories table).
/// </summary>
public class WebsiteLanguageService : IWebsiteLanguageService
{
    // Same shape as I18nController's locale check: "fr", "pt-BR", "zh-Hant".
    private static readonly Regex Language = new(@"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$", RegexOptions.Compiled);
    private const int MaxLanguages = 10;
    private readonly string _connectionString;

    public WebsiteLanguageService(IConfiguration config) => _connectionString = config.GetConnectionString("DefaultConnection")!;

    private sealed record TextRow(string Type, int Id, string Language, string? Title, string? Body, string? SeoTitle, string? SeoDescription);

    private sealed class MenuRow
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public string LinkType { get; set; } = "";
        public string? Html { get; set; }
        public bool IsDefault { get; set; }
        // Built-in pages and links have no body of their own; only custom pages do.
        public bool HasBody => !IsDefault && LinkType is not ("url" or "external" or "document");
    }

    // District rows of the shared website tables carry fk_club_id = 0 (as in DistrictWebsitePublicDataController).
    private static string MenuOwner(string scope) => scope == "club"
        ? "m.fk_club_id = @O AND (m.fk_district_id IS NULL OR m.fk_district_id = 0)"
        : "m.fk_district_id = @O AND m.fk_club_id = 0";

    private static string AboutOwner(string scope) => scope == "club" ? "fk_club_id = @O" : "fk_district_id = @O AND fk_club_id = 0";

    public async Task<WebsiteLanguageSettingsDto> GetSettingsAsync(string scope, int ownerId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        return await SettingsAsync(conn, scope, ownerId);
    }

    // No row yet: the brand's default language only.
    private static async Task<WebsiteLanguageSettingsDto> SettingsAsync(MySqlConnection conn, string scope, int ownerId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<WebsiteLanguageSettingsRow>(
            "SELECT default_language AS DefaultLanguage, languages AS Languages FROM website_languages WHERE scope = @scope AND owner_id = @ownerId",
            new { scope, ownerId });
        return row == null
            ? new(Brand.DefaultLanguage, new List<string> { Brand.DefaultLanguage })
            : new(row.DefaultLanguage, row.Languages.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList());
    }

    private sealed class WebsiteLanguageSettingsRow
    {
        public string DefaultLanguage { get; set; } = "";
        public string Languages { get; set; } = "";
    }

    public async Task<string?> SaveSettingsAsync(string scope, int ownerId, WebsiteLanguageSettingsDto dto, int memberId)
    {
        var def = dto.DefaultLanguage?.Trim() ?? "";
        // The default always comes first and is always one of the languages.
        var languages = (dto.Languages ?? new()).Select(l => l?.Trim() ?? "").Prepend(def)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (languages.Any(l => !Language.IsMatch(l))) return "Use language codes such as en, fr or pt-BR.";
        if (languages.Count > MaxLanguages) return $"A website can have {MaxLanguages} languages at most.";

        await using var conn = new MySqlConnection(_connectionString);
        await conn.ExecuteAsync(@"
            INSERT INTO website_languages (scope, owner_id, default_language, languages, updated_by)
            VALUES (@scope, @ownerId, @def, @languages, @memberId)
            ON DUPLICATE KEY UPDATE default_language = VALUES(default_language), languages = VALUES(languages),
                                    updated_by = VALUES(updated_by)",
            new { scope, ownerId, def, languages = string.Join(',', languages), memberId });
        return null;
    }

    public async Task<List<WebsiteTranslationItemDto>?> GetItemsAsync(string scope, int ownerId, string language)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var settings = await SettingsAsync(conn, scope, ownerId);
        if (!settings.Languages.Contains(language, StringComparer.OrdinalIgnoreCase)) return null;

        var p = new { scope, O = ownerId, language, def = settings.DefaultLanguage };
        var about = await conn.ExecuteScalarAsync<string?>($@"
            SELECT content FROM club_website_about
            WHERE {AboutOwner(scope)} AND is_active = 1 AND COALESCE(isdeleted, 0) = 0
            ORDER BY modified_date DESC, created_date DESC LIMIT 1", p);
        var menus = await conn.QueryAsync<MenuRow>($@"
            SELECT m.pk_club_website_menu_id AS Id, m.menu_name AS Name, m.link_type AS LinkType,
                   m.content_html AS Html, COALESCE(m.is_default, 0) AS IsDefault
            FROM club_website_menu m
            WHERE {MenuOwner(scope)} AND m.isdeleted = 0 AND m.is_active = 1
            ORDER BY m.sort_order, m.pk_club_website_menu_id", p);
        var subMenus = await conn.QueryAsync<MenuRow>($@"
            SELECT s.pk_club_website_submenu_id AS Id, s.submenu_name AS Name, s.link_type AS LinkType
            FROM club_website_submenu s
            JOIN club_website_menu m ON m.pk_club_website_menu_id = s.fk_menu_id
            WHERE {MenuOwner(scope)} AND m.isdeleted = 0 AND m.is_active = 1 AND s.isdeleted = 0 AND s.is_active = 1
            ORDER BY m.sort_order, m.pk_club_website_menu_id, s.sort_order, s.pk_club_website_submenu_id", p);
        var rows = (await conn.QueryAsync<TextRow>(@"
            SELECT item_type AS Type, item_id AS Id, language AS Language, title AS Title, body AS Body,
                   seo_title AS SeoTitle, seo_description AS SeoDescription
            FROM website_translations
            WHERE scope = @scope AND owner_id = @O AND language IN (@language, @def)", p)).ToList();

        TextRow? Find(string type, int id, string lang) => rows.FirstOrDefault(r =>
            r.Type == type && r.Id == id && r.Language.Equals(lang, StringComparison.OrdinalIgnoreCase));
        WebsiteTranslationItemDto Item(string type, int id, string? title, string? body, bool hasBody)
        {
            var t = Find(type, id, language);
            var d = Find(type, id, settings.DefaultLanguage);
            return new(type, id, title, PublicHtml.Clean(body), hasBody, d?.SeoTitle, d?.SeoDescription,
                t?.Title, PublicHtml.Clean(t?.Body), t?.SeoTitle, t?.SeoDescription);
        }

        var items = new List<WebsiteTranslationItemDto> { Item("site", 0, null, null, false), Item("about", 0, null, about, true) };
        items.AddRange(menus.Select(m => Item("page", m.Id, m.Name, m.HasBody ? m.Html : null, m.HasBody)));
        items.AddRange(subMenus.Select(s => Item("submenu", s.Id, s.Name, null, false)));
        return items;
    }

    public async Task<string?> SaveItemAsync(string scope, int ownerId, string language, string type, int itemId,
        SaveWebsiteTranslationDto dto, int memberId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var settings = await SettingsAsync(conn, scope, ownerId);
        var lang = settings.Languages.FirstOrDefault(l => l.Equals(language, StringComparison.OrdinalIgnoreCase));
        if (lang == null) return "Add this language to the website first.";

        static string? Clip(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        string? title = Clip(dto.Title), body = Clip(dto.Body), seoTitle = Clip(dto.SeoTitle), seoDescription = Clip(dto.SeoDescription);
        if (title?.Length > 200 || seoTitle?.Length > 200) return "Titles can be 200 characters at most.";
        if (seoDescription?.Length > 500) return "The description can be 500 characters at most.";
        if (body?.Length > 1_000_000) return "The page is too long.";

        // What each kind of item can carry; the default language's title and body are edited in the existing editors.
        var isDefault = lang.Equals(settings.DefaultLanguage, StringComparison.OrdinalIgnoreCase);
        switch (type)
        {
            case "site":
                if (itemId != 0) return "Unknown item.";
                title = body = null;
                break;
            case "about":
                if (itemId != 0) return "Unknown item.";
                break;
            case "page":
                var menu = await conn.QueryFirstOrDefaultAsync<MenuRow>($@"
                    SELECT m.pk_club_website_menu_id AS Id, m.link_type AS LinkType, COALESCE(m.is_default, 0) AS IsDefault
                    FROM club_website_menu m WHERE m.pk_club_website_menu_id = @Id AND {MenuOwner(scope)} AND m.isdeleted = 0",
                    new { Id = itemId, O = ownerId });
                if (menu == null) return "This page is not on this website.";
                if (!menu.HasBody) body = null;
                break;
            case "submenu":
                var found = await conn.ExecuteScalarAsync<int>($@"
                    SELECT COUNT(*) FROM club_website_submenu s
                    JOIN club_website_menu m ON m.pk_club_website_menu_id = s.fk_menu_id
                    WHERE s.pk_club_website_submenu_id = @Id AND {MenuOwner(scope)} AND s.isdeleted = 0 AND m.isdeleted = 0",
                    new { Id = itemId, O = ownerId });
                if (found == 0) return "This menu item is not on this website.";
                body = seoTitle = seoDescription = null;
                break;
            default:
                return "Unknown item.";
        }
        if (isDefault) title = body = null;

        var key = new { scope, ownerId, type, itemId, lang };
        if (title == null && body == null && seoTitle == null && seoDescription == null)
        {
            // Nothing left to say in this language: the site falls back to the default text.
            await conn.ExecuteAsync(@"DELETE FROM website_translations WHERE scope = @scope AND owner_id = @ownerId
                AND item_type = @type AND item_id = @itemId AND language = @lang", key);
            return null;
        }
        await conn.ExecuteAsync(@"
            INSERT INTO website_translations (scope, owner_id, item_type, item_id, language, title, body, seo_title, seo_description, updated_by)
            VALUES (@scope, @ownerId, @type, @itemId, @lang, @title, @body, @seoTitle, @seoDescription, @memberId)
            ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), seo_title = VALUES(seo_title),
                                    seo_description = VALUES(seo_description), updated_by = VALUES(updated_by)",
            new { scope, ownerId, type, itemId, lang, title, body, seoTitle, seoDescription, memberId });
        return null;
    }

    public async Task<bool> DeleteItemAsync(string scope, int ownerId, string language, string type, int itemId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        return await conn.ExecuteAsync(@"DELETE FROM website_translations WHERE scope = @scope AND owner_id = @ownerId
            AND item_type = @type AND item_id = @itemId AND language = @language",
            new { scope, ownerId, type, itemId, language }) > 0;
    }

    public async Task<PublicWebsiteLanguagesDto?> GetPublicAsync(string scope, int ownerId, string? language)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var live = scope == "club"
            ? await ClubWebsitePublicDataController.IsClubServiceableAsync(conn, ownerId)
            : await DistrictWebsitePublicDataController.IsDistrictServiceableAsync(conn, ownerId);
        if (!live) return null;

        var settings = await SettingsAsync(conn, scope, ownerId);
        // A language the site does not offer shows the default.
        var shown = settings.Languages.FirstOrDefault(l => l.Equals(language, StringComparison.OrdinalIgnoreCase)) ?? settings.DefaultLanguage;
        var items = (await conn.QueryAsync<WebsiteTextDto>(@"
            SELECT item_type AS Type, item_id AS Id, title AS Title, body AS Body, seo_title AS SeoTitle, seo_description AS SeoDescription
            FROM website_translations WHERE scope = @scope AND owner_id = @ownerId AND language = @shown",
            new { scope, ownerId, shown }))
            .Select(i => i with { Body = PublicHtml.Clean(i.Body) })
            .ToList();
        return new(settings.DefaultLanguage, settings.Languages, shown, items);
    }
}

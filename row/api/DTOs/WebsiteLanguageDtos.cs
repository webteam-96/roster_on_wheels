namespace RotaryApi.DTOs;

// Multilingual club and district websites (build spec 3.11), see Services/WebsiteLanguageService.cs.

public record WebsiteLanguageSettingsDto(string DefaultLanguage, List<string> Languages);

/// <summary>
/// One translatable thing on a site: "site" (home page SEO), "about", "page" (a menu and its custom page) or
/// "submenu" (a label). Source* is the default language's text; the rest is the translation being edited.
/// </summary>
public record WebsiteTranslationItemDto(
    string Type, int Id, string? SourceTitle, string? SourceBody, bool HasBody,
    string? SourceSeoTitle, string? SourceSeoDescription,
    string? Title, string? Body, string? SeoTitle, string? SeoDescription);

public record SaveWebsiteTranslationDto(string? Title, string? Body, string? SeoTitle, string? SeoDescription);

public record WebsiteTextDto(string Type, int Id, string? Title, string? Body, string? SeoTitle, string? SeoDescription);

/// <summary>What a public site needs for one request: its languages and the texts in the language it shows.</summary>
public record PublicWebsiteLanguagesDto(string DefaultLanguage, List<string> Languages, string Language, List<WebsiteTextDto> Items);

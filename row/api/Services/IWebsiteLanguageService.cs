using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>Languages and per-language texts of club and district websites. scope is "club" or "district".</summary>
public interface IWebsiteLanguageService
{
    Task<WebsiteLanguageSettingsDto> GetSettingsAsync(string scope, int ownerId);

    /// <returns>an error message, or null when saved</returns>
    Task<string?> SaveSettingsAsync(string scope, int ownerId, WebsiteLanguageSettingsDto dto, int memberId);

    /// <returns>null when the language is not one of the site's languages</returns>
    Task<List<WebsiteTranslationItemDto>?> GetItemsAsync(string scope, int ownerId, string language);

    /// <returns>an error message, or null when saved</returns>
    Task<string?> SaveItemAsync(string scope, int ownerId, string language, string type, int itemId, SaveWebsiteTranslationDto dto, int memberId);

    Task<bool> DeleteItemAsync(string scope, int ownerId, string language, string type, int itemId);

    /// <returns>null when the site is not live</returns>
    Task<PublicWebsiteLanguagesDto?> GetPublicAsync(string scope, int ownerId, string? language);
}

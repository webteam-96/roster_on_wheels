using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Website languages editor (build spec 3.11, flag website_languages). The path is under api/clubs/{id} or
/// api/districts/{id}, so ScopeWriteGuardMiddleware lets only that club's or district's managers write and its
/// members read; AuditMiddleware records every write.
/// </summary>
[ApiController]
[Authorize]
[Route("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-languages")]
public class WebsiteLanguagesController : ControllerBase
{
    private readonly IWebsiteLanguageService _languages;

    public WebsiteLanguagesController(IWebsiteLanguageService languages) => _languages = languages;

    private static string Owner(string scope) => scope == "clubs" ? "club" : "district";
    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    [HttpGet]
    public async Task<IActionResult> GetSettings(string scope, int ownerId)
        => Ok(await _languages.GetSettingsAsync(Owner(scope), ownerId));

    [HttpPut]
    public async Task<IActionResult> SaveSettings(string scope, int ownerId, [FromBody] WebsiteLanguageSettingsDto dto)
    {
        var error = await _languages.SaveSettingsAsync(Owner(scope), ownerId, dto, MemberId);
        return error == null ? Ok(await _languages.GetSettingsAsync(Owner(scope), ownerId)) : BadRequest(new { message = error });
    }

    [HttpGet("{language}")]
    public async Task<IActionResult> GetItems(string scope, int ownerId, string language)
    {
        var items = await _languages.GetItemsAsync(Owner(scope), ownerId, language);
        return items == null ? BadRequest(new { message = "This language is not on the website." }) : Ok(items);
    }

    [HttpPut("{language}/{type}/{itemId:int}")]
    public async Task<IActionResult> SaveItem(string scope, int ownerId, string language, string type, int itemId,
        [FromBody] SaveWebsiteTranslationDto dto)
    {
        var error = await _languages.SaveItemAsync(Owner(scope), ownerId, language, type, itemId, dto, MemberId);
        return error == null ? NoContent() : BadRequest(new { message = error });
    }

    [HttpDelete("{language}/{type}/{itemId:int}")]
    public async Task<IActionResult> DeleteItem(string scope, int ownerId, string language, string type, int itemId)
        => await _languages.DeleteItemAsync(Owner(scope), ownerId, language, type, itemId)
            ? NoContent()
            : NotFound(new { message = "No translation to remove." });
}

/// <summary>
/// What a public club or district site shows in the visitor's language: its languages and the texts for the
/// language it resolves to (the asked one when the site offers it, else the default). 404 when the site is off.
/// </summary>
[ApiController]
[AllowAnonymous]
[EnableRateLimiting("public-read")]
[Route("api/public/website-languages")]
public class PublicWebsiteLanguagesController : ControllerBase
{
    private readonly IWebsiteLanguageService _languages;

    public PublicWebsiteLanguagesController(IWebsiteLanguageService languages) => _languages = languages;

    [HttpGet("{scope:regex(^(club|district)$)}/{ownerId:int}")]
    public async Task<IActionResult> Get(string scope, int ownerId, [FromQuery] string? lang)
    {
        var result = await _languages.GetPublicAsync(scope, ownerId, lang);
        return result == null ? NotFound() : Ok(result);
    }
}

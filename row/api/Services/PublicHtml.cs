using Ganss.Xss;

namespace RotaryApi.Services;

/// <summary>
/// Cleans admin-written rich text (About pages, custom menu pages, profiles) before a public website renders it,
/// so a script or event handler typed into the editor cannot run for visitors (stored XSS).
/// shortcut: iframes are dropped too (no YouTube / map embeds); allow-list their hosts when an embed is needed.
/// </summary>
public static class PublicHtml
{
    private static readonly HtmlSanitizer Sanitizer = new();

    public static string? Clean(string? html) => string.IsNullOrEmpty(html) ? html : Sanitizer.Sanitize(html);
}

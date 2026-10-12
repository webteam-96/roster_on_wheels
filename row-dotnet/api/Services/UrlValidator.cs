using System.Text.RegularExpressions;

namespace RotaryApi.Services;

// Shared URL validation for weblinks (club / district / RI). A valid web URL must start with
// http:// or https:// and end with a recognised TLD (e.g. https://example.com, https://x.in).
// To allow more endings, add them to the (?:com|net|...) group below. Keep in sync with the
// frontend copy in rotary-frontend/src/lib/urlValidation.ts.
public static class UrlValidator
{
    private static readonly Regex WebUrl = new(
        @"^https?:\/\/(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|edu|gov|mil|int|info|biz|name|pro|online|site|store|tech|cloud|page|club|live|news|blog|asia|app|dev|xyz|mobi|io|ai|me|tv|us|uk|au|ca|sg|ae|np|lk|bd|pk|eu|be|ly|gl|cc|ws|gg|fm|to|sh|im|in|co)(?::\d{1,5})?(?:\/[^\s]*)?$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static bool IsValidWebUrl(string? url)
        => !string.IsNullOrWhiteSpace(url) && WebUrl.IsMatch(url.Trim());

    // Enforces weblink URL rules. Throws InvalidOperationException (controllers map this to 400).
    // linkUrl is required + validated when linkType is "URL"; youtubeUrl is validated when present.
    public static void ValidateWeblinkUrls(string? linkType, string? linkUrl, string? youtubeUrl)
    {
        if (string.Equals(linkType, "URL", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(linkUrl))
                throw new InvalidOperationException("Link URL is required.");
            if (!IsValidWebUrl(linkUrl))
                throw new InvalidOperationException("Enter a valid URL with http:// or https:// and a real domain ending such as .com or .in (e.g. https://example.com).");
        }

        if (!string.IsNullOrWhiteSpace(youtubeUrl) && !IsValidWebUrl(youtubeUrl))
            throw new InvalidOperationException("Enter a valid YouTube URL starting with http:// or https:// (e.g. https://youtube.com/watch?v=...).");
    }
}

using System.Text.RegularExpressions;
using Ganss.Xss;

namespace RotaryApi.Services;

/// <summary>One block of a website page (website builder). Which fields count depends on Type.</summary>
public sealed class WebsiteSection
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";
    public string? Title { get; set; }
    /// <summary>richtext: the HTML, cleaned on save and again on the public read.</summary>
    public string? Html { get; set; }
    /// <summary>image: picture URL; embed: the normalised player / map URL.</summary>
    public string? Url { get; set; }
    public string? Caption { get; set; }
    /// <summary>image: optional click-through link (http/https or a site path).</summary>
    public string? LinkUrl { get; set; }
    /// <summary>Data widgets: how many items to show.</summary>
    public int? Limit { get; set; }
}

/// <summary>
/// Validation and cleaning for website builder pages (club and district sites). Pure functions so they are unit-tested.
/// Every string a visitor's browser will render passes through here on save AND on the public read (stored XSS).
/// </summary>
public static partial class WebsitePageRules
{
    public const int MaxSections = 40;
    public const int MaxHtmlChars = 200_000;
    public const string HomeSlug = "home";

    /// <summary>Section types the public renderers know. Data widgets read live ROW data at render time.</summary>
    public static readonly string[] SectionTypes =
        { "richtext", "image", "embed", "file", "events", "officers", "news", "projects", "gallery", "sponsors", "contact" };

    /// <summary>A media library item referenced by id ("media:12"); members-only items are only ever referenced this way.</summary>
    [GeneratedRegex("^media:([0-9]{1,9})$")] private static partial Regex MediaRefRx();

    /// <summary>The media id of a "media:&lt;id&gt;" reference, else null.</summary>
    public static int? MediaRef(string? url)
    {
        var m = MediaRefRx().Match(url ?? "");
        return m.Success ? int.Parse(m.Groups[1].Value) : null;
    }

    private static readonly HtmlSanitizer Html = new();

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")] private static partial Regex SlugRx();
    [GeneratedRegex("^[A-Za-z0-9_-]{11}$")] private static partial Regex YouTubeIdRx();
    [GeneratedRegex("^[0-9]{1,12}$")] private static partial Regex VimeoIdRx();
    [GeneratedRegex("^[A-Za-z0-9_-]{1,40}$")] private static partial Regex SectionIdRx();

    public static string Slug(string? raw)
    {
        var s = (raw ?? "").Trim().ToLowerInvariant();
        if (s.Length is 0 or > 60 || !SlugRx().IsMatch(s))
            throw new ArgumentException("Page address: use 1-60 lower-case letters, digits and single hyphens (for example: our-history).");
        return s;
    }

    public static string Title(string? raw)
    {
        var t = (raw ?? "").Trim();
        if (t.Length == 0) throw new ArgumentException("Page title is required.");
        if (t.Length > 200) throw new ArgumentException("Page title: at most 200 characters.");
        return t;
    }

    public static string? CleanHtml(string? html) => string.IsNullOrWhiteSpace(html) ? null : Html.Sanitize(html);

    /// <summary>A picture is a site path (/uploads/...) or an https URL. Anything else (javascript:, data:) is refused.</summary>
    public static string? SafeUrl(string? raw, bool allowHttp = false)
    {
        var v = (raw ?? "").Trim();
        if (v.Length == 0) return null;
        if (v.Length > 1000) return null;
        if (v.StartsWith('/') && !v.StartsWith("//") && !v.Contains('\\')) return v;
        return Uri.TryCreate(v, UriKind.Absolute, out var u)
               && (u.Scheme == Uri.UriSchemeHttps || (allowHttp && u.Scheme == Uri.UriSchemeHttp))
            ? u.AbsoluteUri : null;
    }

    /// <summary>
    /// YouTube, Vimeo and Google Maps share links become their embed URL; any other host returns null, so a page can
    /// never frame an arbitrary site.
    /// </summary>
    public static string? EmbedUrl(string? raw)
    {
        if (!Uri.TryCreate((raw ?? "").Trim(), UriKind.Absolute, out var u)) return null;
        if (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp) return null;
        var host = u.Host.ToLowerInvariant();
        var parts = u.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        string? yt = null;
        if (host is "youtu.be" && parts.Length >= 1) yt = parts[0];
        else if (host is "youtube.com" or "www.youtube.com" or "m.youtube.com" or "www.youtube-nocookie.com")
        {
            if (parts.Length == 1 && parts[0] == "watch")
                yt = System.Web.HttpUtility.ParseQueryString(u.Query)["v"];
            else if (parts.Length >= 2 && parts[0] is "embed" or "shorts" or "live") yt = parts[1];
        }
        if (yt != null) return YouTubeIdRx().IsMatch(yt) ? $"https://www.youtube-nocookie.com/embed/{yt}" : null;

        if (host is "vimeo.com" or "www.vimeo.com" && parts.Length >= 1 && VimeoIdRx().IsMatch(parts[^1]))
            return $"https://player.vimeo.com/video/{parts[^1]}";
        if (host == "player.vimeo.com" && parts.Length == 2 && parts[0] == "video" && VimeoIdRx().IsMatch(parts[1]))
            return $"https://player.vimeo.com/video/{parts[1]}";

        // Google Maps "Embed a map" code gives https://www.google.com/maps/embed?pb=...
        if (host == "www.google.com" && u.AbsolutePath.StartsWith("/maps/embed", StringComparison.Ordinal))
            return "https://www.google.com" + u.PathAndQuery;
        return null;
    }

    /// <summary>Validates and cleans a page's sections. Throws ArgumentException with a message for the editor.</summary>
    public static List<WebsiteSection> Sections(IEnumerable<WebsiteSection>? input)
    {
        var list = (input ?? Enumerable.Empty<WebsiteSection>()).ToList();
        if (list.Count > MaxSections) throw new ArgumentException($"A page can hold at most {MaxSections} sections.");
        var outList = new List<WebsiteSection>(list.Count);
        var seen = new HashSet<string>();
        for (var i = 0; i < list.Count; i++)
        {
            var s = list[i] ?? throw new ArgumentException($"Section {i + 1} is empty.");
            var type = (s.Type ?? "").Trim().ToLowerInvariant();
            if (Array.IndexOf(SectionTypes, type) < 0) throw new ArgumentException($"Section {i + 1}: unknown type.");
            var id = (s.Id ?? "").Trim();
            if (!SectionIdRx().IsMatch(id) || !seen.Add(id)) id = Guid.NewGuid().ToString("N")[..12];
            var title = (s.Title ?? "").Trim();
            if (title.Length > 120) throw new ArgumentException($"Section {i + 1}: heading at most 120 characters.");
            var clean = new WebsiteSection { Id = id, Type = type, Title = title.Length == 0 ? null : title };
            switch (type)
            {
                case "richtext":
                    if ((s.Html?.Length ?? 0) > MaxHtmlChars) throw new ArgumentException($"Section {i + 1}: the text is too long.");
                    clean.Html = CleanHtml(s.Html);
                    break;
                case "file":
                    clean.Url = (MediaRef(s.Url) != null ? s.Url!.Trim() : SafeUrl(s.Url))
                        ?? throw new ArgumentException($"Section {i + 1}: pick a file from the media library.");
                    var label = (s.Caption ?? "").Trim();
                    if (label.Length > 300) throw new ArgumentException($"Section {i + 1}: link text at most 300 characters.");
                    clean.Caption = label.Length == 0 ? null : label;
                    break;
                case "image":
                    clean.Url = (MediaRef(s.Url) != null ? s.Url!.Trim() : SafeUrl(s.Url))
                        ?? throw new ArgumentException($"Section {i + 1}: pick a picture.");
                    var cap = (s.Caption ?? "").Trim();
                    if (cap.Length > 300) throw new ArgumentException($"Section {i + 1}: caption at most 300 characters.");
                    clean.Caption = cap.Length == 0 ? null : cap;
                    if (!string.IsNullOrWhiteSpace(s.LinkUrl))
                        clean.LinkUrl = SafeUrl(s.LinkUrl, allowHttp: true) ?? throw new ArgumentException($"Section {i + 1}: the link must start with https:// or /.");
                    break;
                case "embed":
                    clean.Url = EmbedUrl(s.Url) ?? throw new ArgumentException($"Section {i + 1}: paste a YouTube, Vimeo or Google Maps embed link.");
                    break;
                case "contact":
                    break;
                default: // data widgets
                    clean.Limit = Math.Clamp(s.Limit ?? 6, 1, 24);
                    break;
            }
            outList.Add(clean);
        }
        return outList;
    }

    /// <summary>For the public read: sections stored earlier pass the same rules; a section that no longer passes is dropped.</summary>
    public static List<WebsiteSection> PublicSections(IEnumerable<WebsiteSection>? stored)
    {
        var result = new List<WebsiteSection>();
        foreach (var s in stored ?? Enumerable.Empty<WebsiteSection>())
        {
            try { result.AddRange(Sections(new[] { s })); }
            catch (ArgumentException) { /* invalid now: leave it off the public page */ }
        }
        return result;
    }
}

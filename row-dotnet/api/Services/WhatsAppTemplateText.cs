using System.Text.RegularExpressions;

namespace RotaryApi.Services;

/// <summary>
/// Shared text-fitting rules for WhatsApp (Interakt / Meta) template body parameters.
///
/// WHY: a rendered template body has a hard character budget (600 for this project). That budget
/// covers the WHOLE rendered message — the template's own static text PLUS every substituted
/// {{n}} parameter — not the free-text field alone. A club/district announcement description is
/// free text up to 1000 chars (see Announcements.txt), so it routinely blows the budget and the
/// send is rejected. The only field we may shorten is the free text, so its budget has to be
/// COMPUTED from what is left after everything else is substituted.
///
/// Meta rules this encodes:
///   • A body PARAMETER may not contain newlines, tabs, or 4+ consecutive spaces — Interakt
///     rejects the whole send. (Same rule the GreetingsWorker follows.) Everything here is
///     collapsed to single spaces BEFORE it is measured or cut, so the measured length is the
///     length that actually goes on the wire.
///   • The template's OWN static text may contain newlines; those characters still count toward
///     the 600, which is why <see cref="StaticChars"/> keeps them.
///
/// Counting: lengths are .NET <c>string.Length</c>, i.e. UTF-16 code units. Announcement text is
/// heavily non-ASCII (4195 of 4514 prod rows) and 27 rows carry astral-plane emoji, which count as
/// 2 units each here versus 1 codepoint at Meta. That over-counts, i.e. errs on the safe side, and
/// <see cref="Truncate"/> never splits a surrogate pair.
/// </summary>
public static class WhatsAppTemplateText
{
    /// <summary>Total characters the fully rendered template body may occupy.</summary>
    public const int MaxBodyChars = 600;

    /// <summary>
    /// Floor: if the computed budget for the free-text field falls below this, the field is
    /// dropped entirely (InteraktService substitutes "-") rather than emitting a useless
    /// few-word stub or busting <see cref="MaxBodyChars"/>. Only reachable when the fixed
    /// fields (name + club + title + image URLs) already eat almost the whole budget.
    /// </summary>
    public const int MinFreeTextChars = 40;

    private static readonly Regex HtmlTag = new("<[^>]+>", RegexOptions.Compiled);
    private static readonly Regex WhitespaceRun = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex Placeholder = new(@"\{\{\s*\d+\s*\}\}", RegexOptions.Compiled);

    /// <summary>
    /// Collapse stored free text (newlines, stray HTML, entities, runs of whitespace) into one
    /// clean line. Same rules as the project share card so both surfaces read identically.
    /// </summary>
    public static string Normalise(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var s = HtmlTag.Replace(raw, " ");
        s = System.Net.WebUtility.HtmlDecode(s);
        s = s.Replace("\\n", " ").Replace("\\r", " ");   // some legacy rows store literal "\n"
        s = WhitespaceRun.Replace(s, " ");
        return s.Trim();
    }

    /// <summary>
    /// Whitespace-collapse only — no HTML stripping. This mirrors exactly what
    /// <see cref="InteraktService.SendWhatsAppWithBodyValuesAsync"/> does to every value it is
    /// handed, so it is the right measure for parameters we do NOT own (member name, club name,
    /// title, image URL).
    /// </summary>
    public static string CollapseWhitespace(string? raw)
        => string.IsNullOrWhiteSpace(raw) ? "" : WhitespaceRun.Replace(raw, " ").Trim();

    /// <summary>
    /// Cut on a word boundary and append the single-character ellipsis "…" (the convention already
    /// used by PublicProjectShareController and MobileNotificationFeedService for user-facing text;
    /// three dots are reserved for log/diagnostic truncation).
    /// </summary>
    /// <param name="max">Hard ceiling for the RESULT, ellipsis included.</param>
    public static string Truncate(string? s, int max)
    {
        if (string.IsNullOrEmpty(s) || max <= 0) return "";
        if (s!.Length <= max) return s;

        var cut = s[..(max - 1)];                       // reserve one unit for the "…"
        var lastSpace = cut.LastIndexOf(' ');
        if (lastSpace > max / 2)
            cut = cut[..lastSpace];                     // word boundary, never mid-word
        else if (cut.Length > 0 && char.IsHighSurrogate(cut[^1]))
            cut = cut[..^1];                            // no space to fall back to: don't split an emoji

        cut = cut.TrimEnd(' ', ',', ';', ':', '-', '.');
        return cut.Length == 0 ? "" : cut + "…";
    }

    /// <summary>
    /// Characters the template contributes by itself: its approved body with every {{n}}
    /// placeholder removed. Newlines inside the static text are kept — they count at Meta — but
    /// CRLF is folded to LF first so the figure does not silently change with the source file's
    /// line endings (git autocrlf) when the body is held as a C# raw string literal.
    /// </summary>
    public static int StaticChars(string? templateBody)
        => string.IsNullOrEmpty(templateBody)
            ? 0
            : Placeholder.Replace(templateBody!.Replace("\r\n", "\n"), "").Length;

    /// <summary>
    /// 600 − the template's static text − every OTHER substituted parameter, each measured the way
    /// InteraktService will actually put it on the wire (whitespace collapsed; a blank value is
    /// sent as "-", so it still costs 1 character). Can return ≤ 0 when the fixed fields alone
    /// already fill the body.
    /// </summary>
    public static int RemainingBudget(int staticBodyChars, params string?[] otherValues)
    {
        var used = staticBodyChars;
        foreach (var v in otherValues ?? Array.Empty<string?>())
        {
            var len = CollapseWhitespace(v).Length;
            used += len == 0 ? 1 : len;                 // blank → "-"
        }
        return MaxBodyChars - used;
    }

    /// <summary>
    /// Fit one free-text parameter into whatever the other parameters leave of the 600.
    /// Normalises first (newlines/HTML/entities), then truncates on a word boundary.
    /// </summary>
    public static string FitFreeText(string? text, int staticBodyChars, params string?[] otherValues)
        => FitNormalisedText(Normalise(text), staticBodyChars, otherValues);

    /// <summary>
    /// Same as <see cref="FitFreeText"/> for callers that already ran <see cref="Normalise"/> once
    /// (e.g. a scheduler fanning one announcement out to thousands of recipients, where only the
    /// recipient's name changes the budget). Returns "" when the budget is below
    /// <see cref="MinFreeTextChars"/>.
    /// </summary>
    public static string FitNormalisedText(string? normalisedText, int staticBodyChars, params string?[] otherValues)
    {
        if (string.IsNullOrEmpty(normalisedText)) return "";
        var budget = RemainingBudget(staticBodyChars, otherValues);
        if (budget >= normalisedText!.Length) return normalisedText;
        if (budget < MinFreeTextChars) return "";       // floor — drop it rather than emit a stub
        return Truncate(normalisedText, budget);
    }
}

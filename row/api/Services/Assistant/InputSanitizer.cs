using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace RotaryApi.Services.Assistant;

// First, cheapest line of defence: clean the text and catch the well-known injection phrasings
// before any model sees it. The Gemini guard call (GuardRouter) catches what regexes can't.
public static partial class InputSanitizer
{
    public sealed record Result(string Text, string? Problem, string? InjectionPattern);

    public static Result Clean(string? raw, int maxChars)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new("", "Please type a question.", null);

        // NFKC folds look-alike characters (full-width letters, ligatures) onto plain ones so the
        // patterns below can't be dodged with Unicode tricks.
        var text = raw.Normalize(NormalizationForm.FormKC);

        var sb = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (ch is '\n' or '\t') { sb.Append(ch == '\t' ? ' ' : '\n'); continue; }
            // ZWNJ / ZWJ shape Indic conjuncts (Devanagari, Malayalam...) - keep them.
            if (ch is '‌' or '‍') { sb.Append(ch); continue; }
            // Control chars, zero-width / bidi-override "format" chars, private-use and
            // unassigned code points: invisible to the user, useful only for hiding instructions.
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (cat is UnicodeCategory.Control or UnicodeCategory.Format
                or UnicodeCategory.OtherNotAssigned or UnicodeCategory.PrivateUse) continue;
            sb.Append(ch);
        }
        text = MultiSpace().Replace(sb.ToString(), " ");
        text = MultiNewline().Replace(text, "\n\n").Trim();

        if (text.Length == 0) return new("", "Please type a question.", null);
        if (text.Length > maxChars)
            return new(text, $"Please keep questions under {maxChars} characters.", null);

        var match = InjectionPatterns().Match(text);
        return new(text, null, match.Success ? match.Value : null);
    }

    // Lower-cased, punctuation-light form used for the exact answer cache key, so "How many
    // members in D3141?" and "how many members in d3141" share one entry.
    public static string NormaliseForCache(string text)
    {
        var lower = text.ToLowerInvariant();
        lower = CachePunctuation().Replace(lower, " ");
        return MultiSpace().Replace(lower, " ").Trim();
    }

    [GeneratedRegex(@"[  ]{2,}")]
    private static partial Regex MultiSpace();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex MultiNewline();

    [GeneratedRegex(@"[?!.,;:'""`()\[\]{}]")]
    private static partial Regex CachePunctuation();

    // Known jailbreak / injection phrasings in English and Hindi / Hinglish. Kept narrow on
    // purpose: a hit is logged as a flagged attempt, so false positives must be rare.
    [GeneratedRegex(
        @"\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|your|system|safety)\b.{0,20}\b(instruction|instructions|prompt|prompts|rules|guidelines|messages?)\b" +
        @"|\b(reveal|show|print|repeat|output|leak|dump)\b.{0,30}\b(system\s+prompt|hidden\s+prompt|initial\s+instructions|developer\s+message|your\s+instructions)\b" +
        @"|\byou\s+are\s+now\b.{0,40}\b(dan|jailbroken|unrestricted|developer\s+mode|evil)\b" +
        @"|\b(developer|god|jailbreak|dan)\s+mode\b" +
        @"|\bact\s+as\s+(an?\s+)?(unrestricted|unfiltered|jailbroken)\b" +
        @"|<\s*/?\s*(system|assistant|instructions?|tool_result|function_results)\s*>" +
        @"|\[\s*(system|inst)\s*\]" +
        @"|\b(pichhle|pichle|purane|sabhi|saare)\s+(nirdesh|instructions?|niyam)\s+(bhool|bhul|ignore|nazarandaz)" +
        @"|(पिछले|सभी|पुराने)\s+(निर्देश|निर्देशों|नियम|नियमों)\s+(को\s+)?(भूल|अनदेखा|नज़रअंदाज़|नजरअंदाज)" +
        @"|(सिस्टम\s+प्रॉम्प्ट|system\s+prompt)\s+(दिखाओ|बताओ|dikhao|batao)" +
        @"|\b(drop\s+(table|database)|truncate\s+table|delete\s+from|insert\s+into|update\s+\w+\s+set|alter\s+table|grant\s+all)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex InjectionPatterns();
}

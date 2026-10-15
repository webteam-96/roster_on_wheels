namespace RotaryApi.Services;

// Shared sanitiser for every Word (.docx) report builder. Imported project/document/member text can
// carry NUL (0x00) and other control characters that are NOT valid in XML 1.0 — when OpenXML serialises
// the document (SaveAs), it throws "hexadecimal value 0x00, is an invalid character" and the whole
// report 500s. Strip those characters from all text BEFORE it is written into the document.
public static class WordXmlHelper
{
    /// <summary>Remove characters OpenXML/Word XML cannot serialise (keeps tab/newline/CR).</summary>
    public static string Clean(string? s)
    {
        if (string.IsNullOrEmpty(s)) return s ?? "";
        var sb = new System.Text.StringBuilder(s!.Length);
        foreach (var ch in s!)
            if (System.Xml.XmlConvert.IsXmlChar(ch)) sb.Append(ch);
        return sb.ToString();
    }

    /// <summary>Clean every read/write string property on a DTO in place (never touches byte[]/collections).</summary>
    public static void SanitizeStrings(object? obj)
    {
        if (obj == null) return;
        foreach (var p in obj.GetType().GetProperties())
            if (p.PropertyType == typeof(string) && p.CanRead && p.CanWrite)
                p.SetValue(obj, Clean((string?)p.GetValue(obj)));
    }
}

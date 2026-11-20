using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace RotaryApi.Services;

// Excel downloads: a figure that was pre-formatted as text ("1,234", "₹ 12,500", "45.5%") goes into the
// cell as a real number (Sum on selection, right-aligned) with a number format that shows exactly the same
// text. Anything else (blank, "—", "N/A", Yes/No, names, dates, year labels) stays text.
// Callers must NOT pass ids / phones / district numbers / pincodes / years — use IsIdLike(header) to skip them.
public static class ExcelFigure
{
    // prefix (currency sign) · sign · digits (with or without grouping) · decimals · optional %
    private static readonly Regex Pattern = new(
        @"^(?<pre>(₹|Rs\.?|INR|USD|US\$|R\$|\$|€|£|¥|₩|EUR|GBP|CAD|AUD)\s*)?(?<sign>[+-])?(?<int>\d{1,3}(,\d{2,3})+|\d+)(\.(?<dec>\d+))?\s*(?<pct>%)?$",
        RegexOptions.Compiled);

    // Headers / labels whose values only look numeric.
    private static readonly Regex IdLike = new(
        @"(\bid\b|\bids\b|mobile|phone|whatsapp|^district$|\b(district|club|grant|receipt|order|member|rotary|serial|contact|registration|reference|transaction|payment|cheque|account|invoice)\s*(no\.?|number|#)|pin\s*code|pincode|\bpin\b|\byear\b|\botp\b|receipt|serial|sr\.?\s*no|^#$|transaction|\bzip\b)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static bool IsIdLike(string? headerOrLabel) => !string.IsNullOrWhiteSpace(headerOrLabel) && IdLike.IsMatch(headerOrLabel.Trim());

    // Writes the figure as a number when it is one; returns false (cell untouched) otherwise.
    public static bool TrySet(IXLCell cell, string? text)
    {
        if (!TryParse(text, out var value, out var format)) return false;
        cell.Value = value;
        cell.Style.NumberFormat.Format = format;
        return true;
    }

    // Number when it is one, else the text as given.
    public static void Set(IXLCell cell, string? text)
    {
        if (!TrySet(cell, text)) cell.Value = text ?? "";
    }

    public static bool TryParse(string? text, out decimal value, out string format)
    {
        value = 0m; format = "General";
        if (string.IsNullOrWhiteSpace(text)) return false;
        var m = Pattern.Match(text.Trim());
        if (!m.Success) return false;
        string intPart = m.Groups["int"].Value;
        bool grouped = intPart.Contains(',');
        string digits = intPart.Replace(",", "");
        // Leading zeros (codes, pincodes) and long ungrouped digit runs (phones, ids) are not figures.
        if (digits.Length > 1 && digits[0] == '0') return false;
        if (!grouped && digits.Length > 9) return false;
        string dec = m.Groups["dec"].Value;
        if (!decimal.TryParse(digits + (dec.Length > 0 ? "." + dec : ""), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value))
            return false;
        bool pct = m.Groups["pct"].Success;
        if (pct) value /= 100m;
        string fmt = (grouped ? "#,##0" : "0") + (dec.Length > 0 ? "." + new string('0', dec.Length) : "") + (pct ? "%" : "");
        string pre = m.Groups["pre"].Value;
        if (pre.Length > 0) fmt = "\"" + pre.Replace("\"", "") + "\"" + fmt;
        if (m.Groups["sign"].Value == "-") value = -value;
        else if (m.Groups["sign"].Value == "+") fmt = "+" + fmt + ";-" + fmt + ";" + fmt;
        format = fmt;
        return true;
    }
}

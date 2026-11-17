using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;

namespace RotaryApi.Services;

// Server-built .xlsx for the Settings → Reports downloads (user 2026-10-29: all-India member
// reports ~2 lakh rows timed out when the browser built the file). Streams rows with
// OpenXmlWriter so memory stays flat. Same look as the web export (utils/csvExport.ts
// exportToCSV): title, portal line, subtitle, "Generated … | Total Records …", blue header,
// zebra rows, "Total: n record(s)" footer.
public static class ReportExcelWriter
{
    public sealed class Column
    {
        public string Key { get; set; } = "";
        public string Label { get; set; } = "";
        public double? Width { get; set; }
        public bool Hyperlink { get; set; }
        public string? LinkText { get; set; }
    }

    // Birthdays / anniversaries show day + month only (project rule).
    private static readonly HashSet<string> DayMonthKeys = new(StringComparer.OrdinalIgnoreCase)
        { "birthDate", "anniversaryDate", "familyBirthDate", "familyAnniversaryDate" };

    // Style indexes in the stylesheet below.
    private const uint STitle = 1, SSubtitle = 2, SInfo = 3, SHeader = 4, SOdd = 5, SEven = 6, SFooter = 7, SLinkOdd = 8, SLinkEven = 9;

    public static void Write(Stream output, IReadOnlyList<Column> columns, IEnumerable<IDictionary<string, object?>> rows,
        int rowCount, string title, string? subtitle, string linkBase)
    {
        using var doc = SpreadsheetDocument.Create(output, SpreadsheetDocumentType.Workbook);
        var wbPart = doc.AddWorkbookPart();
        wbPart.Workbook = new Workbook();
        var styles = wbPart.AddNewPart<WorkbookStylesPart>();
        styles.Stylesheet = BuildStylesheet();
        styles.Stylesheet.Save();
        var wsPart = wbPart.AddNewPart<WorksheetPart>();

        int colCount = Math.Max(1, columns.Count);
        string lastCol = ColName(colCount - 1);
        var merges = new List<string>();
        var ist = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "India Standard Time" : "Asia/Kolkata");
        var now = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, ist);

        using (var w = OpenXmlWriter.Create(wsPart))
        {
            w.WriteStartElement(new Worksheet());
            w.WriteStartElement(new Columns());
            for (int i = 0; i < columns.Count; i++)
            {
                var c = columns[i];
                double width = c.Width ?? Math.Max(c.Label.Length + 4, 15);
                w.WriteElement(new DocumentFormat.OpenXml.Spreadsheet.Column { Min = (uint)(i + 1), Max = (uint)(i + 1), Width = width + 0.7, CustomWidth = true });
            }
            w.WriteEndElement();
            w.WriteStartElement(new SheetData());

            uint r = 1;
            void Banner(string text, uint style, double? height = null)
            {
                var attrs = new List<OpenXmlAttribute> { new("r", "", r.ToString()) };
                if (height != null) { attrs.Add(new("ht", "", height.Value.ToString(System.Globalization.CultureInfo.InvariantCulture))); attrs.Add(new("customHeight", "", "1")); }
                w.WriteStartElement(new Row(), attrs);
                WriteText(w, $"A{r}", text, style);
                w.WriteEndElement();
                if (colCount > 1) merges.Add($"A{r}:{lastCol}{r}");
                r++;
            }

            Banner(title, STitle, 28);
            Banner("Rotary Zones 4, 5, 6, 7 & 8 Admin Portal", SSubtitle);
            if (!string.IsNullOrWhiteSpace(subtitle)) Banner(subtitle!, SSubtitle);
            Banner($"Generated: {now:dd MMM yyyy}, {now.ToString("hh:mm tt").ToLowerInvariant()}  |  Total Records: {rowCount}", SInfo);
            r++; // blank separator

            w.WriteStartElement(new Row(), new[] { new OpenXmlAttribute("r", "", r.ToString()), new OpenXmlAttribute("ht", "", "22"), new OpenXmlAttribute("customHeight", "", "1") });
            for (int i = 0; i < columns.Count; i++) WriteText(w, $"{ColName(i)}{r}", columns[i].Label, SHeader);
            w.WriteEndElement();
            r++;

            int idx = 0;
            foreach (var row in rows)
            {
                bool odd = idx % 2 == 0;
                w.WriteStartElement(new Row(), new[] { new OpenXmlAttribute("r", "", r.ToString()) });
                for (int i = 0; i < columns.Count; i++)
                {
                    var col = columns[i];
                    row.TryGetValue(col.Key, out var raw);
                    string cellRef = $"{ColName(i)}{r}";
                    if (col.Hyperlink && raw is string path && !string.IsNullOrWhiteSpace(path))
                    {
                        string target = path.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? path : $"{linkBase.TrimEnd('/')}/{path.TrimStart('/')}";
                        string text = col.LinkText ?? "View";
                        w.WriteStartElement(new Cell(), new[] { new OpenXmlAttribute("r", "", cellRef), new OpenXmlAttribute("s", "", (odd ? SLinkOdd : SLinkEven).ToString()), new OpenXmlAttribute("t", "", "str") });
                        w.WriteElement(new CellFormula($"HYPERLINK(\"{target.Replace("\"", "\"\"")}\",\"{text.Replace("\"", "\"\"")}\")"));
                        w.WriteElement(new CellValue(text));
                        w.WriteEndElement();
                    }
                    else
                    {
                        WriteText(w, cellRef, FormatValue(col.Key, raw), odd ? SOdd : SEven);
                    }
                }
                w.WriteEndElement();
                r++; idx++;
            }

            r++; // blank
            w.WriteStartElement(new Row(), new[] { new OpenXmlAttribute("r", "", r.ToString()) });
            WriteText(w, $"A{r}", $"Total: {rowCount} record(s)", SFooter);
            for (int i = 1; i < colCount; i++) WriteText(w, $"{ColName(i)}{r}", "", SFooter);
            w.WriteEndElement();
            if (colCount > 1) merges.Add($"A{r}:{lastCol}{r}");

            w.WriteEndElement(); // SheetData
            if (merges.Count > 0)
            {
                w.WriteStartElement(new MergeCells(), new[] { new OpenXmlAttribute("count", "", merges.Count.ToString()) });
                foreach (var m in merges) w.WriteElement(new MergeCell { Reference = m });
                w.WriteEndElement();
            }
            w.WriteEndElement(); // Worksheet
        }

        var sheets = wbPart.Workbook.AppendChild(new Sheets());
        sheets.Append(new Sheet { Id = wbPart.GetIdOfPart(wsPart), SheetId = 1, Name = "Report" });
        wbPart.Workbook.Save();
    }

    // Mirrors formatValue() in utils/csvExport.ts + the day-month rule for birthdays.
    private static string FormatValue(string key, object? v)
    {
        if (v == null || v is DBNull) return "";
        if (v is bool b) return b ? "Yes" : "No";
        if (v is DateOnly dOnly) v = dOnly.ToDateTime(TimeOnly.MinValue);
        if (DayMonthKeys.Contains(key))
        {
            if (v is DateTime bd) return bd.ToString("dd MMM", System.Globalization.CultureInfo.InvariantCulture);
            var s = v.ToString()!.Trim();
            if (s == "") return "";
            var dm = System.Text.RegularExpressions.Regex.Match(s, @"^(\d{1,2})-(\d{1,2})$");
            if (dm.Success)
            {
                int mm = int.Parse(dm.Groups[2].Value);
                return mm is >= 1 and <= 12
                    ? $"{int.Parse(dm.Groups[1].Value):D2} {System.Globalization.CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(mm)}"
                    : s;
            }
            if (DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var p))
                return p.ToString("dd MMM", System.Globalization.CultureInfo.InvariantCulture);
            return s;
        }
        // Rows that came through JSON (service results) carry dates as ISO strings.
        if (v is string iso && System.Text.RegularExpressions.Regex.IsMatch(iso, @"^\d{4}-\d{2}-\d{2}T")
            && DateTime.TryParse(iso, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var isoDate)
            && isoDate.Year > 2000)
            v = isoDate;
        if (v is DateTime d)
        {
            if (d.Year > 2000)
                return ZoneTime.Print(d, "dd MMM yyyy, hh:mm tt");
            return d.ToString("yyyy-MM-ddTHH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
        }
        if (v is IFormattable f) return f.ToString(null, System.Globalization.CultureInfo.InvariantCulture);
        return v.ToString() ?? "";
    }

    private static void WriteText(OpenXmlWriter w, string cellRef, string text, uint style)
    {
        w.WriteStartElement(new Cell(), new[] { new OpenXmlAttribute("r", "", cellRef), new OpenXmlAttribute("s", "", style.ToString()), new OpenXmlAttribute("t", "", "inlineStr") });
        w.WriteStartElement(new InlineString());
        w.WriteElement(new Text(Clean(text)) { Space = SpaceProcessingModeValues.Preserve });
        w.WriteEndElement();
        w.WriteEndElement();
    }

    // XML cannot carry control characters; Excel also caps a cell at 32,767 characters.
    private static string Clean(string s)
    {
        if (s.Length > 32767) s = s[..32767];
        foreach (var ch in s)
            if (ch < 0x20 && ch != '\t' && ch != '\n' && ch != '\r')
                return new string(s.Where(c => c >= 0x20 || c == '\t' || c == '\n' || c == '\r').ToArray());
        return s;
    }

    private static string ColName(int i)
    {
        string s = "";
        for (i++; i > 0; i = (i - 1) / 26) s = (char)('A' + (i - 1) % 26) + s;
        return s;
    }

    private static Stylesheet BuildStylesheet()
    {
        static Font F(double sz, string? rgb = null, bool bold = false, bool italic = false, bool underline = false)
        {
            var f = new Font();
            if (bold) f.Append(new Bold());
            if (italic) f.Append(new Italic());
            if (underline) f.Append(new Underline());
            f.Append(new FontSize { Val = sz });
            if (rgb != null) f.Append(new Color { Rgb = "FF" + rgb });
            f.Append(new FontName { Val = "Calibri" });
            return f;
        }
        static Fill Solid(string rgb) => new(new PatternFill(new ForegroundColor { Rgb = "FF" + rgb }) { PatternType = PatternValues.Solid });
        static Border B(string rgb, BorderStyleValues style, string? topRgb = null, BorderStyleValues? topStyle = null) => new(
            new LeftBorder(new Color { Rgb = "FF" + rgb }) { Style = style },
            new RightBorder(new Color { Rgb = "FF" + rgb }) { Style = style },
            new TopBorder(new Color { Rgb = "FF" + (topRgb ?? rgb) }) { Style = topStyle ?? style },
            new BottomBorder(new Color { Rgb = "FF" + rgb }) { Style = style },
            new DiagonalBorder());

        var fonts = new Fonts(
            F(11),                                   // 0 default
            F(16, "1F4E79", bold: true),             // 1 title
            F(10, "555555", italic: true),           // 2 subtitle
            F(10, "666666"),                         // 3 info
            F(11, "FFFFFF", bold: true),             // 4 header
            F(10),                                   // 5 data
            F(10, "1F4E79", bold: true),             // 6 footer
            F(10, "0563C1", underline: true));       // 7 link
        var fills = new Fills(
            new Fill(new PatternFill { PatternType = PatternValues.None }),
            new Fill(new PatternFill { PatternType = PatternValues.Gray125 }),
            Solid("1F4E79"),                         // 2 header
            Solid("FFFFFF"),                         // 3 odd
            Solid("F2F7FB"),                         // 4 even
            Solid("E8EEF4"));                        // 5 footer
        var borders = new Borders(
            new Border(new LeftBorder(), new RightBorder(), new TopBorder(), new BottomBorder(), new DiagonalBorder()),
            B("000000", BorderStyleValues.Thin),     // 1 header
            B("D0D0D0", BorderStyleValues.Thin),     // 2 data
            B("D0D0D0", BorderStyleValues.Thin, "1F4E79", BorderStyleValues.Medium)); // 3 footer

        static CellFormat X(uint font, uint fill, uint border, HorizontalAlignmentValues? h = null, bool vCenter = false)
        {
            var x = new CellFormat { FontId = font, FillId = fill, BorderId = border, ApplyFont = true, ApplyFill = fill > 0, ApplyBorder = border > 0 };
            if (h != null || vCenter)
            {
                var a = new Alignment();
                if (h != null) a.Horizontal = h;
                if (vCenter) a.Vertical = VerticalAlignmentValues.Center;
                x.Append(a); x.ApplyAlignment = true;
            }
            return x;
        }
        var xfs = new CellFormats(
            new CellFormat(),                                              // 0
            X(1, 0, 0, HorizontalAlignmentValues.Left),                    // 1 title
            X(2, 0, 0, HorizontalAlignmentValues.Left),                    // 2 subtitle
            X(3, 0, 0, HorizontalAlignmentValues.Left),                    // 3 info
            X(4, 2, 1, HorizontalAlignmentValues.Center, true),            // 4 header
            X(5, 3, 2),                                                    // 5 odd
            X(5, 4, 2),                                                    // 6 even
            X(6, 5, 3),                                                    // 7 footer
            X(7, 3, 2),                                                    // 8 link odd
            X(7, 4, 2));                                                   // 9 link even
        return new Stylesheet(fonts, fills, borders,
            new CellStyleFormats(new CellFormat { FontId = 0, FillId = 0, BorderId = 0 }),
            xfs,
            new CellStyles(new CellStyle { Name = "Normal", FormatId = 0, BuiltinId = 0 }));
    }
}

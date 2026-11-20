using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace RotaryApi.Services;

// The new report look (user 2026-11-13, first used by the new CMR Word): Calibri, menu navy + gold, real tables
// (fixed widths, header row, right-aligned figures), group rows with coloured "Updated from …" notes, bookmarks +
// in-document links. Element ORDER follows the Word schema (checked with OpenXmlValidator) - keep it when editing.
internal static class WordKit
{
    public const string Navy = "1E3A5F", Gold = "F7A81B", Ink = "1E293B", Muted = "64748B", Line = "E2E8F0",
        HeadFill = "F1F5F9", GroupFill = "F8FAFC", Green = "047857", Blue = "1D4ED8", Amber = "92400E", Red = "B91C1C", NavyTint = "EEF2F7";
    public const int PageDxa = 9746;   // A4 width minus 1080 margins on both sides

    public static void ApplyDefaults(MainDocumentPart main)
    {
        var stylePart = main.AddNewPart<StyleDefinitionsPart>();
        stylePart.Styles = new Styles(new DocDefaults(
            new RunPropertiesDefault(new RunPropertiesBaseStyle(
                new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri", ComplexScript = "Calibri" },
                new NoProof(),   // no spell-check squiggles
                new Color { Val = Ink }, new FontSize { Val = "20" }, new FontSizeComplexScript { Val = "20" })),
            new ParagraphPropertiesDefault(new ParagraphPropertiesBaseStyle(
                new SpacingBetweenLines { After = "80", Line = "264", LineRule = LineSpacingRuleValues.Auto }))));
        stylePart.Styles.Save();
    }

    public static Run R(string? text, int size, bool bold = false, string? color = null, bool italic = false, int spacing = 0)
    {
        var rp = new RunProperties();
        if (bold) rp.Append(new Bold());
        if (italic) rp.Append(new Italic());
        if (color != null) rp.Append(new Color { Val = color });
        if (spacing != 0) rp.Append(new Spacing { Val = spacing });
        rp.Append(new FontSize { Val = size.ToString() });
        return new Run(rp, new Text(text ?? "") { Space = SpaceProcessingModeValues.Preserve });
    }

    public static Paragraph P(int after, params OpenXmlElement[] content) => P(after, null, content);
    public static Paragraph P(int after, JustificationValues? align, params OpenXmlElement[] content)
    {
        var pp = new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = after.ToString() });
        if (align != null) pp.Append(new Justification { Val = align.Value });
        var p = new Paragraph(pp);
        foreach (var c in content) p.Append(c);
        return p;
    }

    public static Paragraph MutedPara(string text) => P(80, R(text, 19, italic: true, color: Muted));
    public static Paragraph BodyText(string text) =>
        new(new ParagraphProperties(new SpacingBetweenLines { Before = "60", After = "80" }, new Justification { Val = JustificationValues.Both }), R(text, 20));

    public static void Gap(Body body, int after) => body.Append(new Paragraph(
        new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = after.ToString(), Line = "120", LineRule = LineSpacingRuleValues.Exact },
            new ParagraphMarkRunProperties(new FontSize { Val = "4" }))));

    /// <summary>Section heading: navy upper-case, gold rule, optional note, optional bookmark.</summary>
    public static void Heading(Body body, string title, string? note = null, string? anchor = null, int markId = 0, bool upper = true)
    {
        var p = new Paragraph(new ParagraphProperties(new KeepNext(),
                new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Size = 12, Color = Gold, Space = 4 }),
                new SpacingBetweenLines { Before = "360", After = "120" }),
            R(upper ? title.ToUpperInvariant() : title, upper ? 26 : 24, bold: true, color: Navy, spacing: upper ? 20 : 0));
        if (!string.IsNullOrWhiteSpace(note)) p.Append(R("     " + note, 18, italic: true, color: WordKit.Muted));
        if (anchor != null) Mark(p, anchor, markId);
        body.Append(p);
    }

    public static void SubHeading(Body body, string title, string? anchor = null, int markId = 0)
    {
        var p = new Paragraph(new ParagraphProperties(new KeepNext(), new SpacingBetweenLines { Before = "280", After = "60" }),
            R(title.ToUpperInvariant(), 19, bold: true, color: WordKit.Muted, spacing: 20));
        if (anchor != null) Mark(p, anchor, markId);
        body.Append(p);
    }

    /// <summary>Card title with the gold bar (a meeting / project / document) + its bookmark.</summary>
    public static void CardTitle(Body body, string title, string? anchor, int markId)
    {
        var p = new Paragraph(new ParagraphProperties(new KeepNext(),
                new ParagraphBorders(new LeftBorder { Val = BorderValues.Single, Size = 24, Color = Gold, Space = 6 }),
                new SpacingBetweenLines { Before = "240", After = "40" }),
            R(title, 23, bold: true, color: Navy));
        if (anchor != null) Mark(p, anchor, markId);
        body.Append(p);
    }

    public static void BackToTop(Body body, string topAnchor) => body.Append(
        new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "60", After = "120" }, new Justification { Val = JustificationValues.Right }),
            Link("↑ Back to top", topAnchor, 16)));

    public static TableProperties TableProps(bool borders = true)
    {
        var tp = new TableProperties(new TableWidth { Width = PageDxa.ToString(), Type = TableWidthUnitValues.Dxa });
        tp.Append(borders
            ? new TableBorders(
                new TopBorder { Val = BorderValues.Single, Size = 4, Color = Line }, new LeftBorder { Val = BorderValues.Single, Size = 4, Color = Line },
                new BottomBorder { Val = BorderValues.Single, Size = 4, Color = Line }, new RightBorder { Val = BorderValues.Single, Size = 4, Color = Line },
                new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4, Color = Line }, new InsideVerticalBorder { Val = BorderValues.Nil })
            : new TableBorders(new TopBorder { Val = BorderValues.Nil }, new LeftBorder { Val = BorderValues.Nil }, new BottomBorder { Val = BorderValues.Nil },
                new RightBorder { Val = BorderValues.Nil }, new InsideHorizontalBorder { Val = BorderValues.Nil }, new InsideVerticalBorder { Val = BorderValues.Nil }));
        tp.Append(new TableLayout { Type = TableLayoutValues.Fixed },
            new TableCellMarginDefault(new TopMargin { Width = "70", Type = TableWidthUnitValues.Dxa },
                new TableCellLeftMargin { Width = 110, Type = TableWidthValues.Dxa },
                new BottomMargin { Width = "70", Type = TableWidthUnitValues.Dxa },
                new TableCellRightMargin { Width = 110, Type = TableWidthValues.Dxa }));
        return tp;
    }

    public static Table NewTable(params int[] widths)
    {
        var g = new TableGrid();
        foreach (var w in widths) g.Append(new GridColumn { Width = w.ToString() });
        return new Table(TableProps(), g);
    }
    public static Table NewBareTable(params int[] widths)
    {
        var g = new TableGrid();
        foreach (var w in widths) g.Append(new GridColumn { Width = w.ToString() });
        return new Table(TableProps(borders: false), g);
    }

    /// <summary>Equal column widths across the page (for live module tables of any width).</summary>
    public static int[] Even(int n) { var w = new int[n]; for (int i = 0; i < n; i++) w[i] = PageDxa / n; return w; }

    public static TableCellProperties CellProps(int width, string? fill, bool vCenter = false, int span = 1, int pad = 0)
    {
        var cp = new TableCellProperties(new TableCellWidth { Width = width.ToString(), Type = TableWidthUnitValues.Dxa });
        if (span > 1) cp.Append(new GridSpan { Val = span });
        if (fill != null) cp.Append(new Shading { Val = ShadingPatternValues.Clear, Color = "auto", Fill = fill });
        if (pad > 0) cp.Append(new TableCellMargin(new TopMargin { Width = pad.ToString(), Type = TableWidthUnitValues.Dxa },
            new LeftMargin { Width = pad.ToString(), Type = TableWidthUnitValues.Dxa },
            new BottomMargin { Width = pad.ToString(), Type = TableWidthUnitValues.Dxa },
            new RightMargin { Width = pad.ToString(), Type = TableWidthUnitValues.Dxa }));
        if (vCenter) cp.Append(new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center });
        return cp;
    }

    public static TableCell Cell(int width, string? fill, Paragraph[] paras, int pad = 0, bool vCenter = false)
    {
        var c = new TableCell(CellProps(width, fill, vCenter, pad: pad));
        foreach (var p in paras) c.Append(p);
        return c;
    }

    public static TableCell Text(int width, string? text, bool right = false, bool bold = false, string? color = null, string? fill = null, bool center = false) =>
        new(CellProps(width, fill, vCenter: true),
            P(0, right ? JustificationValues.Right : center ? JustificationValues.Center : null, R(text ?? "", 19, bold: bold, color: color)));

    public static TableCell Label(int width, string text) => Text(width, text, bold: true, color: Muted, fill: HeadFill);
    public static TableCell Value(int width, string text) => Text(width, text, bold: true);

    public static TableCell LinkCell(int width, string text, string anchor, bool right = false, bool center = false) =>
        new(CellProps(width, null, vCenter: true), P(0, right ? JustificationValues.Right : center ? JustificationValues.Center : null, Link(text, anchor, 19)));

    public static TableCell Figure(int width, string value, string label, string sub) => Cell(width, null, new[]
    {
        P(0, R(value, 34, bold: true, color: Navy)),
        P(0, R(label, 15, bold: true, color: Ink, spacing: 30)),
        P(0, R(sub, 15, color: Muted)),
    }, pad: 120);

    public static TableRow HeaderRow(params (int Width, string Text, bool Right)[] cols)
    {
        var row = new TableRow(new TableRowProperties(new TableHeader()));
        foreach (var (wd, text, right) in cols)
            row.Append(new TableCell(CellProps(wd, HeadFill, vCenter: true),
                P(0, right ? JustificationValues.Right : null, R(text.ToUpperInvariant(), 15, bold: true, color: Muted, spacing: 20))));
        return row;
    }

    /// <summary>Group row across the table: navy label + coloured note.</summary>
    public static TableRow GroupRow(int span, string label, string? note, string noteColor)
    {
        var p = P(0, R(label, 16, bold: true, color: Navy, spacing: 20), R(string.IsNullOrEmpty(note) ? "" : "     " + note, 16, bold: true, color: noteColor));
        return new TableRow(new TableRowProperties(new CantSplit()), new TableCell(CellProps(PageDxa, GroupFill, vCenter: true, span: span), p));
    }

    /// <summary>Label / value pairs, two pairs per row.</summary>
    public static Table Facts(IReadOnlyList<(string Label, string Value)> facts)
    {
        var t = NewTable(1800, 3073, 1800, 3073);
        for (int i = 0; i < facts.Count; i += 2)
        {
            var (l1, v1) = facts[i];
            var row = new TableRow(new TableRowProperties(new CantSplit()), Label(1800, l1), Value(3073, v1));
            if (i + 1 < facts.Count) { var (l2, v2) = facts[i + 1]; row.Append(Label(1800, l2), Value(3073, v2)); }
            else row.Append(Text(1800, "", fill: HeadFill), Text(3073, ""));
            t.Append(row);
        }
        return t;
    }

    public static void Mark(Paragraph p, string name, int id)
    {
        var start = new BookmarkStart { Name = name, Id = id.ToString() };
        if (p.ParagraphProperties != null) p.InsertAfter(start, p.ParagraphProperties); else p.PrependChild(start);
        p.Append(new BookmarkEnd { Id = id.ToString() });
    }

    public static Hyperlink Link(string text, string anchor, int size, bool bold = false)
    {
        var rp = new RunProperties();
        if (bold) rp.Append(new Bold());
        rp.Append(new Color { Val = Navy }, new FontSize { Val = size.ToString() }, new Underline { Val = UnderlineValues.Single });
        return new Hyperlink(new Run(rp, new Text(text ?? "") { Space = SpaceProcessingModeValues.Preserve })) { Anchor = anchor, History = true };
    }

    /// <summary>A web link (opens the file / page in the browser).</summary>
    public static OpenXmlElement WebLink(MainDocumentPart main, string url, string text, int size)
    {
        try
        {
            var relId = main.AddHyperlinkRelationship(new Uri(url), true).Id;
            return new Hyperlink(new Run(new RunProperties(new Color { Val = "0563C1" }, new FontSize { Val = size.ToString() }, new Underline { Val = UnderlineValues.Single }),
                new Text(text) { Space = SpaceProcessingModeValues.Preserve })) { Id = relId };
        }
        catch { return R(text, size); }
    }

    public static SectionProperties Page() => new(
        new PageSize { Width = 11906, Height = 16838 },
        new PageMargin { Top = 1080, Bottom = 1080, Left = 1080, Right = 1080, Header = 0, Footer = 0, Gutter = 0 });
}

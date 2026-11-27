using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// NEW CMR Word (user 2026-11-13) - follows the Design B PDF, same order as the CMR tabs:
//   basic details -> key figures -> Meetings -> Foundation -> Projects -> Membership -> Additional achievement.
// Foundation + Membership tables come from the browser (CmrWordV2Request) - the very figures the CMR screen
// and the PDF show, with their "Updated from Rotary.org / RISAO on …" notes. Everything else is the saved report.
// Real Word tables (fixed widths, header row, right-aligned figures), not a pasted grid. The old BuildReport
// (old CMR) is not changed.
public static partial class ClubMonthlyReportWordBuilder
{
    private const string Navy = "1E3A5F", Gold = "F7A81B", Ink = "1E293B", Muted = "64748B", Line = "E2E8F0",
        HeadFill = "F1F5F9", GroupFill = "F8FAFC", Green = "047857", Blue = "1D4ED8", Amber = "92400E", NavyTint = "EEF2F7";
    private const int PageDxa = 9746;   // A4 width minus the 1080 margins on each side

    private static readonly (string Key, string Label)[] MeetingTypes =
        { ("regular", "Regular"), ("fellowship", "Fellowship"), ("bod", "BOD"), ("assembly", "Assembly"), ("trust", "Trust") };

    public static byte[] BuildReportV2(MonthlyReportPreviewDto s, IReadOnlyList<CmrWordProjectDto> items, string mediaBase,
        CmrWordV2Request extra, int? calendarYear)
    {
        SanitizeStrings(s);
        foreach (var it in items) { SanitizeStrings(it); foreach (var ph in it.Photos) SanitizeStrings(ph); }

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            ApplyModernDefaults(main);
            var body = new Body();
            uint imgId = 1;

            int membersNow = s.MemberCountLastMonth + s.MembersAdded - s.MembersDeleted;
            var meetings = s.Meetings ?? new List<ReportMeetingDto>();
            var projectGroups = Avenues.Select(a => (a.Key, a.Label, List: s.Projects.TryGetValue(a.Key, out var l) ? l : new List<ReportProjectDto>()))
                .Where(g => g.List.Count > 0).ToList();
            int projectCount = projectGroups.Sum(g => g.List.Count);
            var carded = items.Select(i => i.ProjectId).ToHashSet();   // items that get a details card (link targets)
            var meetPct = meetings.Where(m => m.AttendancePercentage != null).Select(m => m.AttendancePercentage!.Value).ToList();
            decimal? avgAtt = meetPct.Count > 0 ? Math.Round(meetPct.Average(), 0) : null;

            // ── Masthead: navy band with the month and the upload status ──
            var title = new Table(TableProps(withBorders: false), Grid(6600, 3146));
            title.Append(new TableRow(
                Cell(6600, Navy, new[]
                {
                    Para(After: 40, runs: R("CLUB MONTHLY REPORT", 16, bold: true, color: Gold, spacing: 40)),
                    Para(After: 40, runs: new[] { R(s.MonthName + " ", 44, bold: true, color: "FFFFFF"), R(calendarYear?.ToString() ?? "", 44, bold: true, color: Gold) }),
                    Para(After: 20, runs: R(s.ClubName, 24, bold: true, color: "FFFFFF")),
                    Para(After: 0, runs: R($"Rotary Year {s.YearLabel}  ·  Assistant Governor {Dash(s.AssistantGovernor)}", 18, color: "C9D6EE")),
                }, pad: 220),
                Cell(3146, Navy, new[]
                {
                    Para(After: 20, align: JustificationValues.Right, runs: R(s.IsUploadedToDistrict ? "UPLOADED TO DISTRICT" : "NOT UPLOADED YET", 16, bold: true, color: s.IsUploadedToDistrict ? "6EE7B7" : "FCD34D", spacing: 30)),
                    Para(After: 0, align: JustificationValues.Right, runs: R(s.UploadedToDistrictDate.HasValue ? FormatDateTime(s.UploadedToDistrictDate.Value) : "Draft", 18, color: "FFFFFF")),
                }, pad: 220, vCenter: true)));
            // "top" bookmark (every "Back to top" jumps here) - user 2026-11-13: clickable index
            var top = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = "0", Line = "20", LineRule = LineSpacingRuleValues.Exact }));
            Mark(top, "cmr_top", 1);
            body.Append(top);
            body.Append(title);
            // Contents: click a name to jump to that section
            var contents = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "120", After = "60" }),
                R("CONTENTS     ", 16, bold: true, color: Muted, spacing: 30));
            var secs = new[] { ("Meetings", "sec_meetings"), ("Foundation", "sec_foundation"), ("Projects", "sec_projects"),
                ("Membership", "sec_membership"), ("Additional achievement", "sec_additional") };
            for (int k = 0; k < secs.Length; k++)
            {
                if (k > 0) contents.Append(R("   ·   ", 18, color: Muted));
                contents.Append(Link(secs[k].Item1, secs[k].Item2, 18, bold: true));
            }
            body.Append(contents);
            Gap(body, 120);

            // ── Basic details ──
            var info = new Table(TableProps(), Grid(2200, 2673, 2200, 2673));
            void Info(string l1, string v1, string l2, string v2) =>
                info.Append(new TableRow(LabelCellV2(2200, l1), ValueCellV2(2673, v1), LabelCellV2(2200, l2), ValueCellV2(2673, v2)));
            Info("Club Name", s.ClubName, "Rotary Club ID", Dash(s.ClubCode));
            Info("Prepared By", Dash(s.PreparedBy), "Designation", Dash(s.Designation));
            Info("Assistant Governor", Dash(s.AssistantGovernor), "Rotary Year", s.YearLabel);
            body.Append(info);
            Gap(body, 120);

            // ── Key figures (same four as the PDF) ──
            var kf = new Table(TableProps(), Grid(2436, 2437, 2436, 2437));
            var fTotal = extra.Foundation?.Total?.Month;
            kf.Append(new TableRow(
                Figure(2436, meetings.Count.ToString(), "MEETINGS", avgAtt != null ? $"{avgAtt}% avg attendance" : "none held"),
                Figure(2437, Usd(fTotal), "FOUNDATION", extra.Foundation?.Synced == true ? "from Rotary.org" : "CMR entries"),
                Figure(2436, projectCount.ToString(), "PROJECTS", $"{projectGroups.Count} service type{(projectGroups.Count == 1 ? "" : "s")}"),
                Figure(2437, membersNow.ToString(), "MEMBERS", $"+{s.MembersAdded} / −{s.MembersDeleted} this month")));
            body.Append(kf);

            // ── Meetings ──
            Heading(body, "Meetings", $"{meetings.Count} this month", anchor: "sec_meetings", markId: 2);
            if (meetings.Count == 0) body.Append(MutedPara("No meetings this month."));
            else
            {
                var t = new Table(TableProps(), Grid(600, 1500, 4646, 1500, 1500));
                t.Append(HeaderRow(new[] { (600, "#", false), (1500, "Date", false), (4646, "Title", false), (1500, "Attendance", true), (1500, "Attendance %", true) }));
                var order = MeetingTypes.Select(x => x.Key).ToList();
                var groups = meetings.GroupBy(m => string.IsNullOrWhiteSpace(m.MeetingType) ? "other" : m.MeetingType!.ToLowerInvariant())
                    .OrderBy(g => order.IndexOf(g.Key) is var i && i >= 0 ? i : 99).ToList();
                foreach (var g in groups)
                {
                    var label = MeetingTypes.FirstOrDefault(x => x.Key == g.Key).Label ?? (g.Key == "other" ? "Other" : g.Key);
                    var p = g.Where(m => m.AttendancePercentage != null).Select(m => m.AttendancePercentage!.Value).ToList();
                    t.Append(GroupRow(5, label.ToUpperInvariant(), $"{g.Count()} meeting{(g.Count() == 1 ? "" : "s")}" + (p.Count > 0 ? $"  ·  Avg attendance {Math.Round(p.Average(), 0)}%" : ""), Muted));
                    int i = 1;
                    foreach (var m in g)
                        t.Append(new TableRow(
                            TextCell(600, (i++).ToString(), color: Muted), TextCell(1500, Day(m.ProjectDate)), carded.Contains(m.ProjectId) ? LinkCell(4646, m.Title, ItemAnchor(m.ProjectId)) : TextCell(4646, m.Title),
                            TextCell(1500, m.Attendance?.ToString() ?? "—", right: true),
                            TextCell(1500, m.AttendancePercentage != null ? $"{m.AttendancePercentage:0.##}%" : "—", right: true)));
                }
                body.Append(t);
                var mDetails = items.Where(i => i.ModuleKey == "club_service").ToList();
                if (mDetails.Count > 0)
                {
                    SubHeadingV2(body, "Meeting details");
                    int n = 1;
                    foreach (var m in mDetails) ItemCard(main, body, mediaBase, m, isMeeting: true, index: n++, ref imgId);
                }
            }

            // ── Foundation (the CMR screen's table) ──
            var f = extra.Foundation;
            Heading(body, "Foundation", null, anchor: "sec_foundation", markId: 3);
            if (f == null || f.Rows.Count == 0) body.Append(MutedPara("No Foundation figures for this month."));
            else if (!f.Synced)
            {
                body.Append(NotePara("Not synced from Rotary.org yet - this month's CMR Foundation entries, totalled by fund type.", Amber));
                var t = new Table(TableProps(), Grid(6246, 3500));
                t.Append(HeaderRow(new[] { (6246, "Fund type", false), (3500, "This month", true) }));
                foreach (var r in f.Rows) t.Append(new TableRow(TextCell(6246, r.Name), TextCell(3500, Usd(r.Month), right: true, bold: true)));
                t.Append(new TableRow(TextCell(6246, "Total", bold: true, fill: NavyTint), TextCell(3500, Usd(f.Total?.Month), right: true, bold: true, fill: NavyTint)));
                body.Append(t);
            }
            else
            {
                var w = new[] { 3146, 1650, 1650, 1650, 1650 };
                var t = new Table(TableProps(), Grid(w));
                t.Append(HeaderRow(new[] { (w[0], "Fund", false), (w[1], "This month", true), (w[2], "Month target", true), (w[3], "Year till date", true), (w[4], "Year target", true) }));
                void Fund(CmrWordFundRow r) => t.Append(new TableRow(
                    TextCell(w[0], r.Name), TextCell(w[1], Usd(r.Month), right: true, bold: true), TextCell(w[2], Usd(r.MonthTarget), right: true, color: Muted),
                    TextCell(w[3], Usd(r.Ytd), right: true), TextCell(w[4], Usd(r.YearTarget), right: true, color: Muted)));
                var sync = f.Rows.Where(r => r.Source == "sync").ToList();
                var imp = f.Rows.Where(r => r.Source != "sync").ToList();
                if (sync.Count > 0)
                {
                    t.Append(GroupRow(5, "FROM ROTARY.ORG", extra.RotaryOrgDate != null ? $"Updated from Rotary.org on {extra.RotaryOrgDate}" : "Updated from Rotary.org", Green));
                    sync.ForEach(Fund);
                }
                if (imp.Count > 0)
                {
                    t.Append(GroupRow(5, "FROM IMPORT (RISAO)", extra.ImportDate != null ? $"Updated from RISAO on {extra.ImportDate}" : "Updated from RISAO", Blue));
                    imp.ForEach(Fund);
                }
                var tot = f.Total ?? new CmrWordFundRow();
                t.Append(new TableRow(
                    TextCell(w[0], "Total", bold: true, fill: NavyTint), TextCell(w[1], Usd(tot.Month), right: true, bold: true, fill: NavyTint),
                    TextCell(w[2], Usd(tot.MonthTarget), right: true, bold: true, fill: NavyTint), TextCell(w[3], Usd(tot.Ytd), right: true, bold: true, fill: NavyTint),
                    TextCell(w[4], Usd(tot.YearTarget), right: true, bold: true, fill: NavyTint)));
                body.Append(t);
            }

            // ── Projects ──
            Heading(body, "Projects", $"{projectCount} this month", anchor: "sec_projects", markId: 4);
            if (projectCount == 0) body.Append(MutedPara("No projects this month."));
            else
            {
                var w = new[] { 500, 1300, 3346, 2100, 1200, 1300 };
                var t = new Table(TableProps(), Grid(w));
                t.Append(HeaderRow(new[] { (w[0], "#", false), (w[1], "Date", false), (w[2], "Project", false), (w[3], "Area of focus", false), (w[4], "Beneficiaries", true), (w[5], "Cost", true) }));
                foreach (var g in projectGroups)
                {
                    t.Append(GroupRow(6, g.Label.ToUpperInvariant(), $"{g.List.Count} project{(g.List.Count == 1 ? "" : "s")}", Muted));
                    int i = 1;
                    foreach (var p in g.List)
                        t.Append(new TableRow(
                            TextCell(w[0], (i++).ToString(), color: Muted), TextCell(w[1], Day(p.ProjectDate)), carded.Contains(p.ProjectId) ? LinkCell(w[2], p.Title, ItemAnchor(p.ProjectId)) : TextCell(w[2], p.Title),
                            TextCell(w[3], Dash(p.AreaOfFocusName)), TextCell(w[4], p.DirectBeneficiaries?.ToString() ?? "—", right: true),
                            TextCell(w[5], p.ProjectCost is > 0 ? Brand.Money(p.ProjectCost.Value, p.Currency, 0) : "—", right: true)));
                }
                body.Append(t);
                // Every project, all its details and photos (user 2026-11-13: keep everything, new design only).
                foreach (var (key, label) in Avenues)
                {
                    var list = items.Where(i => i.ModuleKey == key).ToList();
                    if (list.Count == 0) continue;
                    SubHeadingV2(body, $"{label} - project details");
                    int n = 1;
                    foreach (var p in list) ItemCard(main, body, mediaBase, p, isMeeting: false, index: n++, ref imgId);
                }
            }

            // ── Membership (the CMR screen's table) ──
            Heading(body, "Membership", null, anchor: "sec_membership", markId: 5);
            {
                var w = new[] { 3546, 1550, 1550, 1550, 1550 };
                var t = new Table(TableProps(), Grid(w));
                t.Append(HeaderRow(new[] { (w[0], "Membership", false), (w[1], "This month", true), (w[2], "Month target", true), (w[3], "Year till date", true), (w[4], "Year target", true) }));
                t.Append(GroupRow(5, "FROM ROTARY.ORG", extra.MemberDate != null ? $"Updated from Rotary.org on {extra.MemberDate}" : "Updated from Rotary.org", Green));
                var rows = extra.Membership.Count > 0 ? extra.Membership : new List<CmrWordMembershipRow>
                {
                    new() { Label = "Members at start", Month = s.MemberCountLastMonth.ToString() },
                    new() { Label = "Members added", Month = s.MembersAdded.ToString() },
                    new() { Label = "Members terminated", Month = s.MembersDeleted.ToString() },
                    new() { Label = "Members now", Month = membersNow.ToString(), Strong = true },
                };
                bool womenShown = false;
                foreach (var r in rows)
                {
                    if (r.Group == "women" && !womenShown) { t.Append(GroupRow(5, "WOMEN MEMBERS", "", Muted)); womenShown = true; }
                    var fill = r.Strong ? NavyTint : null;
                    t.Append(new TableRow(
                        LabelSubCell(w[0], r.Label, r.Sub, r.Strong, fill),
                        TextCell(w[1], Blank(r.Month), right: true, bold: true, fill: fill, color: r.Strong ? Navy : Ink),
                        TextCell(w[2], Blank(r.MonthTarget), right: true, color: Muted, fill: fill),
                        TextCell(w[3], Blank(r.Ytd), right: true, bold: r.Strong, fill: fill),
                        TextCell(w[4], Blank(r.YearTarget), right: true, color: Muted, fill: fill)));
                }
                body.Append(t);
            }

            // ── Additional achievement (saved text) ──
            Heading(body, "Additional achievement / participation / hosting of events / projects above club level", null, upper: false, anchor: "sec_additional", markId: 6);
            body.Append(string.IsNullOrWhiteSpace(s.AdditionalRemarks)
                ? MutedPara("No additional achievement, participation or hosting above club level this month.")
                : new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "60", After = "80" }, new Justification { Val = JustificationValues.Both }),
                    R(s.AdditionalRemarks!, 20)));

            body.Append(SectionProps());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    // One meeting / project in the new design (same content as the old Word: title, date + type, every fact,
    // description, Agenda / MoM links, all photos): navy title, facts in a 2-pair table, then text and photos.
    private static void ItemCard(MainDocumentPart main, Body body, string mediaBase, CmrWordProjectDto p, bool isMeeting, int index, ref uint imgId)
    {
        var head = new Paragraph(new ParagraphProperties(new KeepNext(),
                new ParagraphBorders(new LeftBorder { Val = BorderValues.Single, Size = 24, Color = Gold, Space = 6 }),
                new SpacingBetweenLines { Before = "240", After = "20" }),
            R($"{index}.  {(string.IsNullOrWhiteSpace(p.Title) ? "(untitled)" : p.Title)}", 23, bold: true, color: Navy));
        Mark(head, ItemAnchor(p.ProjectId), 1000 + p.ProjectId);   // the summary table's title links here
        body.Append(head);

        var meta = new List<string>();
        if (!string.IsNullOrWhiteSpace(p.ProjectDate)) meta.Add(Day(p.ProjectDate));
        if (isMeeting && !string.IsNullOrWhiteSpace(p.MeetingType))
            meta.Add((MeetingTypeLabels.TryGetValue(p.MeetingType!.ToLowerInvariant(), out var lbl) ? lbl : p.MeetingType!) + " meeting");
        if (meta.Count > 0) body.Append(new Paragraph(new ParagraphProperties(new KeepNext(), new SpacingBetweenLines { Before = "0", After = "80" }),
            R(string.Join("   ·   ", meta), 18, italic: true, color: Muted)));

        var facts = new List<(string, string)>();
        if (isMeeting)
        {
            if (p.Attendance is > 0) facts.Add(("Attendance", p.Attendance + (p.AttendancePercentage is > 0 ? $" ({p.AttendancePercentage:0.##}%)" : "")));
            if (!string.IsNullOrWhiteSpace(p.Location)) facts.Add(("Location", p.Location!));
        }
        else
        {
            var focus = FirstNonEmpty(p.AreaOfFocusName, p.OtherAreaOfFocus);
            if (focus != null) facts.Add(("Area of Focus", focus));
            if (!string.IsNullOrWhiteSpace(p.Location)) facts.Add(("Location", p.Location!));
            if (p.ProjectCost is > 0) facts.Add(("Cost", Brand.Money(p.ProjectCost!.Value, p.Currency, 0)));
            if (!string.IsNullOrWhiteSpace(p.FundingName)) facts.Add(("Funding", p.FundingName!));
            if (p.DirectBeneficiaries is > 0) facts.Add(("Beneficiaries", p.DirectBeneficiaries!.Value.ToString()));
            if (p.ManHours is > 0) facts.Add(("Man-hours", p.ManHours!.Value.ToString()));
            if (p.RotariansInvolved is > 0) facts.Add(("Rotarians", p.RotariansInvolved!.Value.ToString()));
            if (p.RotaractorsInvolved is > 0) facts.Add(("Rotaractors", p.RotaractorsInvolved!.Value.ToString()));
            if (p.RccInvolved is > 0) facts.Add(("RCC", p.RccInvolved!.Value.ToString()));
            if (p.IsJointProject) facts.Add(("Joint Project", string.IsNullOrWhiteSpace(p.CoHostName) ? "Yes" : $"with {p.CoHostName}"));
        }
        if (facts.Count > 0)
        {
            var t = new Table(TableProps(), Grid(1800, 3073, 1800, 3073));
            for (int i = 0; i < facts.Count; i += 2)
            {
                var (l1, v1) = facts[i];
                var row = new TableRow(new TableRowProperties(new CantSplit()), LabelCellV2(1800, l1), ValueCellV2(3073, v1));
                if (i + 1 < facts.Count) { var (l2, v2) = facts[i + 1]; row.Append(LabelCellV2(1800, l2), ValueCellV2(3073, v2)); }
                else row.Append(TextCell(1800, "", fill: HeadFill), TextCell(3073, ""));
                t.Append(row);
            }
            body.Append(t);
        }

        if (!string.IsNullOrWhiteSpace(p.Description))
            body.Append(new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "100", After = "80" }, new Justification { Val = JustificationValues.Both }),
                R(p.Description!, 20)));

        DocsLine(main, body, mediaBase, ("Agenda", p.AgendaDocument), ("Minutes of Meeting", p.MinutesDocument));

        foreach (var ph in p.Photos)
        {
            if (ph.ImageBytes == null || ph.ImageBytes.Length == 0) continue;
            AppendImage(main, body, ph, ref imgId);
        }
        body.Append(new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "60", After = "120" }, new Justification { Val = JustificationValues.Right }),
            Link("↑ Back to top", "cmr_top", 16)));
    }

    private static void SubHeadingV2(Body body, string title) => body.Append(new Paragraph(
        new ParagraphProperties(new KeepNext(), new SpacingBetweenLines { Before = "280", After = "60" }),
        R(title.ToUpperInvariant(), 19, bold: true, color: Muted, spacing: 20)));

    // ── Helpers (new design) ──────────────────────────────────────────────────────────────────────────
    private static void ApplyModernDefaults(MainDocumentPart main)
    {
        var stylePart = main.AddNewPart<StyleDefinitionsPart>();
        stylePart.Styles = new Styles(new DocDefaults(
            new RunPropertiesDefault(new RunPropertiesBaseStyle(
                new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri", ComplexScript = "Calibri" },
                new NoProof(),   // no red / blue spell-check lines under "1 meeting · Avg attendance" etc. (user 2026-11-13)
                new Color { Val = Ink }, new FontSize { Val = "20" }, new FontSizeComplexScript { Val = "20" })),
            new ParagraphPropertiesDefault(new ParagraphPropertiesBaseStyle(
                new SpacingBetweenLines { After = "80", Line = "264", LineRule = LineSpacingRuleValues.Auto }))));
        stylePart.Styles.Save();
    }

    private static Run R(string text, int size, bool bold = false, string? color = null, bool italic = false, int spacing = 0)
    {
        var rp = new RunProperties();
        if (bold) rp.Append(new Bold());
        if (italic) rp.Append(new Italic());
        if (color != null) rp.Append(new Color { Val = color });
        if (spacing != 0) rp.Append(new Spacing { Val = spacing });
        rp.Append(new FontSize { Val = size.ToString() });
        return new Run(rp, new Text(text ?? "") { Space = SpaceProcessingModeValues.Preserve });
    }

    private static Paragraph Para(int After, Run runs, JustificationValues? align = null) => Para(After, new[] { runs }, align);
    private static Paragraph Para(int After, Run[] runs, JustificationValues? align = null)
    {
        var pp = new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = After.ToString() });
        if (align != null) pp.Append(new Justification { Val = align.Value });
        var p = new Paragraph(pp);
        foreach (var r in runs) p.Append(r);
        return p;
    }

    private static Paragraph MutedPara(string text) => Para(80, R(text, 19, italic: true, color: Muted));
    private static Paragraph NotePara(string text, string color) => Para(80, R(text, 18, bold: true, color: color));

    // Section heading: navy, upper-case (except long sentence headings), gold rule underneath, optional note.
    private static void Heading(Body body, string title, string? note, bool upper = true, string? anchor = null, int markId = 0)
    {
        var pp = new ParagraphProperties(new KeepNext(),
            new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Size = 12, Color = Gold, Space = 4 }),
            new SpacingBetweenLines { Before = "360", After = "120" });
        var p = new Paragraph(pp, R(upper ? title.ToUpperInvariant() : title, upper ? 26 : 24, bold: true, color: Navy, spacing: upper ? 20 : 0));
        if (!string.IsNullOrWhiteSpace(note)) p.Append(R("     " + note, 18, italic: true, color: Muted));
        if (anchor != null) Mark(p, anchor, markId);
        body.Append(p);
    }

    // ── Index links (user 2026-11-13) ──
    private static string ItemAnchor(int projectId) => $"cmr_item_{projectId}";

    /// <summary>Bookmark around a paragraph's content (a jump target).</summary>
    private static void Mark(Paragraph p, string name, int id)
    {
        var start = new BookmarkStart { Name = name, Id = id.ToString() };
        if (p.ParagraphProperties != null) p.InsertAfter(start, p.ParagraphProperties); else p.PrependChild(start);
        p.Append(new BookmarkEnd { Id = id.ToString() });
    }

    /// <summary>A link inside the document (Ctrl + click in Word) - navy, underlined.</summary>
    private static Hyperlink Link(string text, string anchor, int size, bool bold = false)
    {
        var rp = new RunProperties();
        if (bold) rp.Append(new Bold());
        rp.Append(new Color { Val = Navy }, new FontSize { Val = size.ToString() }, new Underline { Val = UnderlineValues.Single });
        return new Hyperlink(new Run(rp, new Text(text ?? "") { Space = SpaceProcessingModeValues.Preserve })) { Anchor = anchor, History = true };
    }

    private static TableCell LinkCell(int width, string text, string anchor) =>
        new(CellProps(width, null, vCenter: true), new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = "0" }),
            Link(string.IsNullOrEmpty(text) ? "(untitled)" : text, anchor, 19)));

    private static void Gap(Body body, int after) => body.Append(new Paragraph(
        new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = after.ToString(), Line = "120", LineRule = LineSpacingRuleValues.Exact },
            new ParagraphMarkRunProperties(new FontSize { Val = "4" }))));

    private static TableProperties TableProps(bool withBorders = true)
    {
        var tp = new TableProperties(new TableWidth { Width = PageDxa.ToString(), Type = TableWidthUnitValues.Dxa });
        tp.Append(withBorders
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

    private static TableGrid Grid(params int[] widths)
    {
        var g = new TableGrid();
        foreach (var w in widths) g.Append(new GridColumn { Width = w.ToString() });
        return g;
    }

    private static TableCellProperties CellProps(int width, string? fill, bool vCenter = false, int span = 1, int pad = 0)
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

    private static TableCell Cell(int width, string? fill, Paragraph[] paras, int pad = 0, bool vCenter = false)
    {
        var cp = CellProps(width, fill, vCenter, pad: pad);
        var c = new TableCell(cp);
        foreach (var p in paras) c.Append(p);
        return c;
    }

    private static TableCell TextCell(int width, string text, bool right = false, bool bold = false, string? color = null, string? fill = null) =>
        new(CellProps(width, fill, vCenter: true),
            Para(0, R(string.IsNullOrEmpty(text) ? "" : text, 19, bold: bold, color: color), right ? JustificationValues.Right : null));

    private static TableCell LabelCellV2(int width, string text) => TextCell(width, text, bold: true, color: Muted, fill: HeadFill);
    private static TableCell ValueCellV2(int width, string text) => TextCell(width, text, bold: true);

    private static TableCell LabelSubCell(int width, string label, string? sub, bool strong, string? fill)
    {
        var paras = new List<Paragraph> { Para(0, R(label, 19, bold: true, color: strong ? Navy : Ink)) };
        if (!string.IsNullOrWhiteSpace(sub)) paras.Add(Para(0, R(sub!, 15, color: Muted)));
        return Cell(width, fill, paras.ToArray(), vCenter: true);
    }

    private static TableCell Figure(int width, string value, string label, string sub) => Cell(width, null, new[]
    {
        Para(0, R(value, 36, bold: true, color: Navy)),
        Para(0, R(label, 15, bold: true, color: Ink, spacing: 30)),
        Para(0, R(sub, 15, color: Muted)),
    }, pad: 120);

    private static TableRow HeaderRow((int Width, string Text, bool Right)[] cols)
    {
        var row = new TableRow(new TableRowProperties(new TableHeader()));
        foreach (var (wd, text, right) in cols)
            row.Append(new TableCell(CellProps(wd, HeadFill, vCenter: true),
                Para(0, R(text.ToUpperInvariant(), 15, bold: true, color: Muted, spacing: 20), right ? JustificationValues.Right : null)));
        return row;
    }

    // Group row across the table: navy label + coloured note ("Updated from Rotary.org on …" green, RISAO blue).
    private static TableRow GroupRow(int span, string label, string note, string noteColor)
    {
        var p = Para(0, new[] { R(label, 16, bold: true, color: Navy, spacing: 20), R(string.IsNullOrEmpty(note) ? "" : "     " + note, 16, bold: true, color: noteColor) });
        return new TableRow(new TableRowProperties(new CantSplit()), new TableCell(CellProps(PageDxa, GroupFill, vCenter: true, span: span), p));
    }

    private static string Usd(decimal? v) => v == null || v == 0 ? "—" : "$" + v.Value.ToString("N2", CultureInfo.InvariantCulture);
    private static string Blank(string? v) => string.IsNullOrWhiteSpace(v) ? "" : v!;
    private static string Day(string? ymd) =>
        string.IsNullOrWhiteSpace(ymd) ? "—"
        : DateTime.TryParse(ymd, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) : ymd!;
}

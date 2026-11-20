using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using RotaryApi.DTOs;
using static RotaryApi.Services.WordKit;

namespace RotaryApi.Services;

// NEW OCV Word (user 2026-11-13) - the CMR Word design (WordKit): navy masthead, clickable Contents, real tables,
// every summary row links to its details card, "Back to top" after each card. Same content as the old report
// (all uploaded documents with their images / PDF pages, every project with its fields and photos, the live
// tables, newsletters, Club Goals at a glance); "Module" is now "Particulars". The old BuildReport is kept.
public static partial class OcvReportWordBuilder
{
    private const string Top = "ocv_top";

    public static byte[] BuildReportV2(OcvWordReportData data, IEnumerable<OcvReportItemDto> reportItems, string mediaBase)
    {
        var items = (reportItems ?? Enumerable.Empty<OcvReportItemDto>()).ToList();
        // Not in the Word report (user 2026-11-13): TRF Contributions, Announcements, Upcoming Events, Documents;
        // Attendance only when it has records. (Excel / on-screen live documents are unchanged.)
        data.LiveTables.RemoveAll(t => t.ModuleKey is "trf_contributions" or "announcements" or "upcoming_events" or "documents"
            || (t.ModuleKey == "attendance" && t.Rows.Count == 0));
        WordXmlHelper.SanitizeStrings(data);
        foreach (var c in data.Categories) WordXmlHelper.SanitizeStrings(c);
        foreach (var d in data.Documents) WordXmlHelper.SanitizeStrings(d);
        foreach (var n in data.Newsletters) WordXmlHelper.SanitizeStrings(n);
        foreach (var t in data.LiveTables)
        {
            for (int i = 0; i < t.Headers.Count; i++) t.Headers[i] = WordXmlHelper.Clean(t.Headers[i]);
            foreach (var row in t.Rows) for (int j = 0; j < row.Length; j++) row[j] = WordXmlHelper.Clean(row[j]);
        }
        foreach (var pm in data.ProjectModules)
        {
            WordXmlHelper.SanitizeStrings(pm);
            foreach (var pr in pm.Projects)
            {
                WordXmlHelper.SanitizeStrings(pr);
                for (int k = 0; k < pr.Fields.Count; k++)
                    pr.Fields[k] = (WordXmlHelper.Clean(pr.Fields[k].Label), WordXmlHelper.Clean(pr.Fields[k].Value));
            }
        }
        foreach (var it in items) WordXmlHelper.SanitizeStrings(it);

        // Link targets: each uploaded document, each live module, each newsletter.
        var docAnchor = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < data.Documents.Count; i++)
            if (!string.IsNullOrWhiteSpace(data.Documents[i].FilePath)) docAnchor.TryAdd(data.Documents[i].FilePath!, $"ocv_doc_{i + 1}");
        var tableModules = data.LiveTables.Where(t => !ProjectModuleLabels.Contains(t.Label)).ToList();
        var live = data.ProjectModules.Select(m => (m.Label, Count: m.Projects.Count, Kind: "projects"))
            .Concat(tableModules.Select(t => (t.Label, Count: t.Rows.Count, Kind: "table"))).ToList();
        var goals = data.GoalScorecard is { } g0 && (g0.Rows.Count > 0 || g0.Checklist.Count > 0) ? g0 : null;

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            ApplyDefaults(main);
            var body = new Body();
            uint imgId = 1;

            // ── Masthead ──
            var top = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = "0", Line = "20", LineRule = LineSpacingRuleValues.Exact }));
            Mark(top, Top, 1);
            body.Append(top);
            var head = NewBareTable(6600, 3146);
            head.Append(new TableRow(
                Cell(6600, Navy, new[]
                {
                    P(40, R("GOVERNOR'S OFFICIAL VISIT (OCV) REPORT", 16, bold: true, color: Gold, spacing: 40)),
                    P(30, R($"Rotary Club of {data.ClubName}", 38, bold: true, color: "FFFFFF")),
                    P(0, R($"Rotary Year {data.YearLabel}  ·  {Dash(data.ZoneName)}  ·  District {Dash(data.DistrictNumber)}", 18, color: "C9D6EE")),
                }, pad: 220),
                Cell(3146, Navy, new[]
                {
                    P(20, DocumentFormat.OpenXml.Wordprocessing.JustificationValues.Right, R("REPORT GENERATED", 16, bold: true, color: Gold, spacing: 30)),
                    P(0, DocumentFormat.OpenXml.Wordprocessing.JustificationValues.Right, R(DateTime.UtcNow.ToString("dd MMM yyyy, hh:mm tt", CultureInfo.InvariantCulture), 18, color: "FFFFFF")),
                }, pad: 220, vCenter: true)));
            body.Append(head);

            // ── Contents (click to jump) ──
            var secs = new List<(string Name, string Anchor)>();
            if (goals != null) secs.Add(("Club Goals", "ocv_goals"));
            secs.AddRange(new[] { ("Documents", "ocv_documents"), ("Live Documents", "ocv_live"), ("Newsletters", "ocv_news"),
                ("Document details", "ocv_doc_details"), ("Live Document details", "ocv_live_details") });
            var contents = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "120", After = "60" }),
                R("CONTENTS     ", 16, bold: true, color: WordKit.Muted, spacing: 30));
            for (int k = 0; k < secs.Count; k++)
            {
                if (k > 0) contents.Append(R("   ·   ", 18, color: WordKit.Muted));
                contents.Append(Link(secs[k].Name, secs[k].Anchor, 18, bold: true));
            }
            body.Append(contents);
            Gap(body, 120);

            // ── Basic details ──
            var info = NewTable(2200, 2673, 2200, 2673);
            void Info(string l1, string v1, string l2, string v2) => info.Append(new TableRow(Label(2200, l1), Value(2673, v1), Label(2200, l2), Value(2673, v2)));
            Info("Club Name", Dash(data.ClubName), "Club ID", Dash(data.ClubRotaryId));
            Info("Zone", Dash(data.ZoneName), "District", Dash(data.DistrictNumber));
            Info("President", Dash(data.PresidentName), "Assistant Governor", Dash(data.AssistantGovernorName));
            body.Append(info);
            Gap(body, 120);

            // ── Key figures ──
            int typesTotal = items.Count, typesDone = items.Count(i => i.IsUploaded);
            var kf = NewTable(2436, 2437, 2436, 2437);
            kf.Append(new TableRow(
                Figure(2436, $"{typesDone} / {typesTotal}", "DOCUMENTS", "document types uploaded"),
                Figure(2437, data.Documents.Count.ToString(), "FILES", "uploaded files"),
                Figure(2436, live.Count.ToString(), "LIVE DOCUMENTS", $"{data.ProjectModules.Sum(m => m.Projects.Count)} projects"),
                Figure(2437, data.Newsletters.Count.ToString(), "NEWSLETTERS", "this year")));
            body.Append(kf);

            // ── Club Goals at a glance: one group per source, each with its own date ──
            if (goals != null)
            {
                Heading(body, "Club Goals at a glance", null, "ocv_goals", 2);
                string? AsOn(string prefix) => goals.AsOn.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    ?.Substring(prefix.Length).Trim().Replace("as on ", "", StringComparison.OrdinalIgnoreCase);
                var w = new[] { 4146, 1900, 1900, 1800 };
                var t = NewTable(w);
                t.Append(HeaderRow((w[0], "Goal", false), (w[1], "Target", true), (w[2], "Achieved", true), (w[3], "% Achieved", true)));
                void GoalRow(ClubGoalScorecardRow r) => t.Append(new TableRow(
                    Text(w[0], r.Goal), Text(w[1], GoalSettingService.ScorecardCell(r.Target, r.Money), right: true, color: WordKit.Muted),
                    Text(w[2], GoalSettingService.ScorecardCell(r.Achieved, r.Money), right: true, bold: true),
                    Text(w[3], GoalSettingService.ScorecardCell(r.Pct, pct: true), right: true, bold: true, color: Navy)));
                var mem = goals.Rows.Where(r => !r.Money && (r.Goal == "Members" || r.Goal == "Women members")).ToList();
                var fnd = goals.Rows.Where(r => r.Money).ToList();
                var rot = goals.Rows.Except(mem).Except(fnd).ToList();
                if (mem.Count > 0) { var d = AsOn("Rotary.org"); t.Append(GroupRow(4, "MEMBERSHIP", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", Green)); mem.ForEach(GoalRow); }
                // Foundation (user 2026-11-13): Annual Fund + PolioPlus come from Rotary.org; Endowment / Other / Total from the RISAO import.
                var fndRo = fnd.Where(x => x.Goal is "Annual Fund" or "PolioPlus Fund").ToList();
                var fndImp = fnd.Except(fndRo).ToList();
                if (fndRo.Count > 0) { var d = AsOn("Rotary.org"); t.Append(GroupRow(4, "FOUNDATION · FROM ROTARY.ORG", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", Green)); fndRo.ForEach(GoalRow); }
                if (fndImp.Count > 0) { var d = AsOn("Foundation"); t.Append(GroupRow(4, "FOUNDATION · FROM IMPORT (RISAO)", d != null ? $"Updated from RISAO on {d}" : null, Blue)); fndImp.ForEach(GoalRow); }
                if (rot.Count > 0 || goals.Checklist.Count > 0)
                {
                    var d = AsOn("Rotary.org");
                    t.Append(GroupRow(4, "ROTARY.ORG GOALS", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", Green));
                    rot.ForEach(GoalRow);
                    foreach (var (label, yes) in goals.Checklist)
                        t.Append(new TableRow(Text(w[0], label), Text(w[1], "—", right: true, color: WordKit.Muted),
                            Text(w[2], yes == null ? "—" : yes.Value ? "✓ Yes" : "No", right: true, bold: true, color: yes == true ? Green : WordKit.Muted),
                            Text(w[3], "—", right: true, color: WordKit.Muted)));
                }
                body.Append(t);
            }

            // ── Documents checklist: Particulars / Document type / Status / link to the document ──
            Heading(body, "Documents", $"{typesDone} of {typesTotal} uploaded", "ocv_documents", 3);
            if (items.Count == 0) body.Append(MutedPara("No document types configured."));
            else
            {
                var w = new[] { 600, 2500, 3846, 1400, 1400 };
                var t = NewTable(w);
                t.Append(HeaderRow((w[0], "#", false), (w[1], "Particulars", false), (w[2], "Document type", false), (w[3], "Status", false), (w[4], "Document", true)));
                int s = 1;
                foreach (var it in items)
                {
                    var anchor = it.IsUploaded && !string.IsNullOrWhiteSpace(it.FilePath) && docAnchor.TryGetValue(it.FilePath!, out var a) ? a : null;
                    t.Append(new TableRow(
                        Text(w[0], (s++).ToString(), color: WordKit.Muted), Text(w[1], it.CategoryName), Text(w[2], it.TypeName),
                        Text(w[3], it.IsUploaded ? "Uploaded" : "Pending", bold: true, color: it.IsUploaded ? Green : Red),
                        anchor != null ? LinkCell(w[4], "View ↓", anchor, right: true) : Text(w[4], "—", right: true, color: WordKit.Muted)));
                }
                body.Append(t);
            }

            // ── Live Documents (summary, each links to its details) ──
            Heading(body, "Live Documents", "read live from the club's records", "ocv_live", 4);
            if (live.Count == 0) body.Append(MutedPara("No live document modules."));
            else
            {
                var w = new[] { 600, 5546, 1800, 1800 };
                var t = NewTable(w);
                t.Append(HeaderRow((w[0], "#", false), (w[1], "Particulars", false), (w[2], "Records", true), (w[3], "Details", true)));
                for (int k = 0; k < live.Count; k++)
                    t.Append(new TableRow(Text(w[0], (k + 1).ToString(), color: WordKit.Muted), Text(w[1], live[k].Label),
                        Text(w[2], live[k].Count.ToString(), right: true, bold: true), LinkCell(w[3], "View ↓", $"ocv_live_{k + 1}", right: true)));
                body.Append(t);
            }

            // ── Newsletters ──
            Heading(body, "Newsletters", $"{data.Newsletters.Count} this year", "ocv_news", 5);
            if (data.Newsletters.Count == 0) body.Append(MutedPara("No newsletters published for this year."));
            else
            {
                var w = new[] { 600, 4746, 1600, 1400, 1400 };
                var t = NewTable(w);
                t.Append(HeaderRow((w[0], "#", false), (w[1], "Title", false), (w[2], "Published", false), (w[3], "Status", false), (w[4], "Open", true)));
                int s = 1;
                foreach (var nl in data.Newsletters)
                {
                    var target = !string.IsNullOrWhiteSpace(nl.FilePath) ? nl.FilePath : nl.LinkUrl;
                    var open = new TableCell(CellProps(w[4], null, vCenter: true), P(0, DocumentFormat.OpenXml.Wordprocessing.JustificationValues.Right,
                        string.IsNullOrWhiteSpace(target) ? R("—", 19, color: WordKit.Muted) : WebLink(main, DocUrl(mediaBase, target!), "Open", 19)));
                    t.Append(new TableRow(Text(w[0], (s++).ToString(), color: WordKit.Muted), Text(w[1], string.IsNullOrWhiteSpace(nl.Title) ? "(untitled)" : nl.Title),
                        Text(w[2], nl.PublishDate?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? "—"), Text(w[3], Dash(nl.Status)), open));
                }
                body.Append(t);
            }

            // ── Document details: every uploaded document (image / PDF pages / Office snapshot + download link) ──
            Heading(body, "Document details", $"{data.Documents.Count} files", "ocv_doc_details", 6);
            if (data.Documents.Count == 0) body.Append(MutedPara("No documents uploaded."));
            for (int i = 0; i < data.Documents.Count; i++)
            {
                var d = data.Documents[i];
                try { DocumentCard(main, body, mediaBase, d, i + 1, ref imgId); }
                catch { body.Append(MutedPara($"{i + 1}.  Could not be included in this report.")); }
            }

            // ── Live document details: every project in full (fields + photos), then each module's table ──
            Heading(body, "Live Document details", $"current data as on {DateTime.UtcNow:dd MMM yyyy}", "ocv_live_details", 7);
            int liveNo = 0, markNo = 5000;
            foreach (var pm in data.ProjectModules)
            {
                liveNo++;
                WordKit.SubHeading(body, $"{pm.Label} ({pm.Projects.Count})", $"ocv_live_{liveNo}", 1000 + liveNo);
                if (pm.Projects.Count == 0) { body.Append(MutedPara("No projects for this year.")); continue; }
                int pn = 1;
                foreach (var pr in pm.Projects)
                {
                    try { ProjectCard(main, body, pr, pn, markNo++, ref imgId); }
                    catch { body.Append(MutedPara($"{pn}.  This project could not be included.")); }
                    pn++;
                }
            }
            foreach (var tm in tableModules)
            {
                liveNo++;
                WordKit.SubHeading(body, $"{tm.Label} ({tm.Rows.Count})", $"ocv_live_{liveNo}", 1000 + liveNo);
                try
                {
                    if (tm.Rows.Count == 0 || tm.Headers.Count == 0) body.Append(MutedPara("No records."));
                    else
                    {
                        var w = Even(tm.Headers.Count);
                        var t = NewTable(w);
                        t.Append(HeaderRow(tm.Headers.Select((h, k) => (w[k], h, false)).ToArray()));
                        foreach (var row in tm.Rows)
                        {
                            var tr = new TableRow(new TableRowProperties(new CantSplit()));
                            for (int k = 0; k < w.Length; k++) tr.Append(Text(w[k], k < row.Length ? row[k] : ""));
                            t.Append(tr);
                        }
                        body.Append(t);
                    }
                }
                catch { body.Append(MutedPara("This section could not be included.")); }
                BackToTop(body, Top);
            }

            body.Append(Page());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    // One uploaded document: title (gold bar, link target), facts, the document itself as image(s), download link.
    private static void DocumentCard(MainDocumentPart main, Body body, string mediaBase, OcvWordDocument d, int index, ref uint imgId)
    {
        var label = string.IsNullOrWhiteSpace(d.CustomTypeName) ? d.TypeName : $"{d.TypeName} — {d.CustomTypeName}";
        CardTitle(body, $"{index}.  {(string.IsNullOrWhiteSpace(label) ? "(untitled)" : label)}", $"ocv_doc_{index}", 100 + index);
        var facts = new List<(string, string)> { ("Particulars", Dash(d.CategoryName)) };
        if (d.Amount is > 0) facts.Add(("Amount", Brand.Money(d.Amount!.Value)));
        if (d.PaidOn.HasValue) facts.Add(("Paid On", d.PaidOn.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)));
        body.Append(Facts(facts));

        if (string.IsNullOrWhiteSpace(d.FilePath)) { body.Append(MutedPara("File missing.")); BackToTop(body, Top); return; }
        bool shown = false;
        if (d.IsImage && d.ImageBytes is { Length: > 0 }) shown = AppendImage(main, body, d, ref imgId);
        else if (d.IsPdf && d.PdfBytes is { Length: > 0 }) shown = AppendPdfRender(main, body, d.PdfBytes!, MaxPdfPages, ref imgId);
        else if (d.OfficeSnapshotPdfBytes is { Length: > 0 }) shown = AppendPdfRender(main, body, d.OfficeSnapshotPdfBytes!, 1, ref imgId);
        if (!shown)
        {
            var ext = string.IsNullOrWhiteSpace(d.Extension) ? "file" : d.Extension!.ToUpperInvariant();
            body.Append(MutedPara($"[{ext}] {(string.IsNullOrWhiteSpace(d.OriginalFileName) ? "attachment" : d.OriginalFileName)} - open it with the link below."));
        }
        body.Append(P(60, R("Document:  ", 18, bold: true, color: WordKit.Muted), WebLink(main, DocUrl(mediaBase, d.FilePath!), "Download / open", 18)));
        BackToTop(body, Top);
    }

    // One project in full: title (gold bar), description, every form field, all its photos.
    private static void ProjectCard(MainDocumentPart main, Body body, OcvWordProject pr, int index, int markId, ref uint imgId)
    {
        CardTitle(body, $"{index}.  {(string.IsNullOrWhiteSpace(pr.Title) ? "(untitled)" : pr.Title)}", null, markId);
        if (pr.Fields.Count > 0) body.Append(Facts(pr.Fields));
        body.Append(string.IsNullOrWhiteSpace(pr.Description) ? MutedPara("No description.") : BodyText(pr.Description!));
        foreach (var img in pr.Images)
        {
            if (img.ImageBytes is not { Length: > 0 }) continue;
            var partType = ClubMonthlyReportWordBuilder.MapImageType(img.Extension);
            if (partType == null) continue;
            try { EmbedImageBytes(main, body, img.ImageBytes!, partType.Value, ref imgId); } catch { }
            if (!string.IsNullOrWhiteSpace(img.Caption)) body.Append(Caption(img.Caption!));
        }
        BackToTop(body, Top);
    }
}

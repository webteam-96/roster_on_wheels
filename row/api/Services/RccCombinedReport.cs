using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// "RCC & District Goals" combined report (user 2026-11-16, step 5). One workbook:
//   • RCC            - the district's (or club's) goals as the RCC tab shows them: Rotary.org goals locked to
//                      the Rotary.org figure ("Not set on Rotary.org" when missing), the kept ROW goals
//                      (Women Members, RAG, Summary, RISAO funds, Public Image) with their own figures.
//   • RCC - Clubs    - district report only: one row per club, the 26 Rotary.org goals across (Goal / Achieved).
//   • District Goals - District Awards answers + points: district = one row per club, questions across;
//                      club = one row per question.
// Layout rule (user): one entity = tabular; many = rows down, questions across, Total at the bottom.
// The old Goal Setting / New Goal Setting / District Awards reports are not changed.
public class RccCombinedReport
{
    private readonly IGoalSettingService _goals;
    private readonly string _cs;
    public RccCombinedReport(IGoalSettingService goals, string connectionString) { _goals = goals; _cs = connectionString; }

    private const string Reach = "Expand Our Reach", Impact = "Increase our Impact",
                         Adapt = "Increase Our Ability to Adapt", Engage = "Enhance Participant Engagement";

    // The 26 Rotary.org goals, in the RCC tab's order (section, Rotary.org item, Yes/No per club).
    private static readonly (string Section, string Item, bool YesNo)[] RotaryGoals =
    {
        (Reach, "Club membership", false), (Reach, "Rotaract clubs", false), (Reach, "Interact clubs", false),
        (Reach, "Media stories about club projects", false), (Reach, "New member sponsorship", false), (Reach, "RYLA participation", false),
        (Impact, "Annual Fund contributions", false), (Impact, "PolioPlus Fund contributions", false), (Impact, "Major gifts", false),
        (Impact, "Bequest Society members", false), (Impact, "Benefactors", false), (Impact, "Service projects", false),
        (Impact, "Inbound Youth Exchange students", false), (Impact, "Outbound Youth Exchange students", false),
        (Adapt, "Strategic plan", true), (Adapt, "Review and consider updating your club bylaws", true), (Adapt, "Online presence", true),
        (Adapt, "Update website and social media", false),
        (Engage, "Service participation", false), (Engage, "Social activities", false), (Engage, "Leadership development participation", false),
        (Engage, "District conference attendance", false), (Engage, "District training participation", false),
        (Engage, "Rotary Action Group participation", false), (Engage, "Rotary Fellowship participation", false),
        (Engage, "Use of official Rotary promotional materials", true),
    };

    private sealed class Row
    {
        public string Section = "", Goal = "", Source = "";
        public object? AsOn, Target, Achieved, Pct;
        public bool Missing;          // a Rotary.org goal Rotary.org has not set
        public bool IsMoney;
    }

    public async Task<byte[]> BuildAsync(int memberId, int? districtId, int? clubId, int? yearIdIn)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        bool isClub = (clubId ?? 0) > 0;
        int dId = districtId ?? 0;
        if (isClub) dId = await conn.ExecuteScalarAsync<int>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        var year = await conn.QueryFirstAsync<(int Id, string Label)>(
            "SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE " + (yearIdIn > 0 ? "pk_year_id = @Y" : "IsCurrent = 1") + " LIMIT 1",
            new { Y = yearIdIn ?? 0 });
        string districtNo = await conn.ExecuteScalarAsync<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", new { D = dId }) ?? "";
        string clubName = isClub ? await conn.ExecuteScalarAsync<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @C", new { C = clubId }) ?? "" : "";
        string who = isClub ? $"{clubName} · District {districtNo}" : $"District {districtNo}";

        // Our goal fields (same figures as the screen), the 4 categories.
        var f = new Dictionary<string, GoalFieldWithValueDto>();
        foreach (var cat in new[] { 1, 210, 4, 211 })
        {
            try
            {
                var form = isClub ? await _goals.GetClubGoalFormAsync(memberId, cat, year.Id, clubId)
                                  : await _goals.GetDistrictGoalFormAsync(memberId, cat, year.Id, dId);
                if (form != null) foreach (var x in form.Fields) f[x.FieldKey] = x;
            }
            catch { /* a category the caller cannot open is left out */ }
        }
        // Rotary.org figures of this district / club.
        var org = (await conn.QueryAsync<(string Item, string Kind, decimal? Value)>(isClub
            ? "SELECT ItemName, Kind, NumericValue FROM goal_rotary_org_values WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_club_id = @C AND isdeleted = 0"
            : "SELECT ItemName, Kind, NumericValue FROM goal_rotary_org_values WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_district_id = @D AND fk_club_id = 0 AND isdeleted = 0",
            new { Y = year.Id, C = clubId ?? 0, D = dId })).ToList();
        decimal? O(string item, string kind) => org.FirstOrDefault(o => o.Item == item && o.Kind == kind).Value;
        decimal? V(string k) => f.TryGetValue(k, out var x) ? x.NumericValue : null;
        string? B(string k) => f.TryGetValue(k, out var x) ? (x.BoolValue == true ? "Yes" : "No") : null;
        bool Has(string k) => f.ContainsKey(k);

        var rows = BuildRccRows(isClub, V, B, Has, O);

        using var wb = new XLWorkbook();
        WriteRcc(wb.Worksheets.Add("RCC"), rows, $"RCC — {who}", $"Rotary year {year.Label}");
        if (!isClub) await WriteRccClubsAsync(wb.Worksheets.Add("RCC - Clubs"), conn, dId, year.Id, $"RCC by club — District {districtNo}", year.Label);
        await WriteDistrictGoalsAsync(wb.Worksheets.Add("District Goals"), conn, dId, isClub ? clubId : null, year.Id,
            $"District Goals — {who}", year.Label);
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ── RCC rows: same goals, figures and % rules as the RCC tab (lib/rccGoals.ts + the panel's PCT_RULES) ──
    private static List<Row> BuildRccRows(bool isClub, Func<string, decimal?> V, Func<string, string?> B, Func<string, bool> Has,
                                          Func<string, string, decimal?> O)
    {
        var rows = new List<Row>();
        static decimal? Growth(decimal? goal, decimal? ach, decimal? baseV, int dp)
        {
            if (goal == null) return null;
            decimal g = goal.Value, a = ach ?? 0, b = baseV ?? 0, planned = g - b;
            var p = planned > 0 ? (a - b) / planned * 100 : (g > 0 && a >= g ? 100 : 0);
            return Math.Round(Math.Max(0, p), dp);
        }
        static decimal? Ratio(decimal? goal, decimal? ach) =>
            goal == null ? null : goal > 0 ? Math.Round((ach ?? 0) / goal.Value * 100, 2) : 0;

        void Ours(string sec, string goal, string? baseK, string? tgtK, string? achK, string? pctK, string src, bool money = false)
        {
            if (!(baseK != null && Has(baseK)) && !(tgtK != null && Has(tgtK)) && !(achK != null && Has(achK))) return;
            rows.Add(new Row { Section = sec, Goal = goal, Source = src, IsMoney = money,
                AsOn = baseK != null ? V(baseK) : null, Target = tgtK != null ? V(tgtK) : null,
                Achieved = achK != null ? V(achK) : null, Pct = pctK != null ? V(pctK) : null });
        }
        // A goal whose Goal comes from Rotary.org; our own As-on / Achieved boxes.
        void RotaryLocked(string sec, string goal, string item, string? baseK, string? achK, Func<decimal?, decimal?, decimal?, decimal?> pct, bool money = false)
        {
            var g = O(item, "Target");
            var a = achK != null ? V(achK) : null;
            var b = baseK != null ? V(baseK) : null;
            rows.Add(new Row { Section = sec, Goal = goal, Source = "Rotary.org", IsMoney = money, AsOn = b, Target = g, Achieved = a,
                Pct = g == null ? null : pct(g, a, b), Missing = g == null });
        }
        void RotaryOnly(string sec, string item, bool yesNo)
        {
            var g = O(item, "Target"); var a = O(item, "Achieved");
            if (isClub && yesNo)
                rows.Add(new Row { Section = sec, Goal = item, Source = "Rotary.org", Target = g == null ? null : g == 1 ? "Yes" : "No",
                    Achieved = a == null ? null : a == 1 ? "Yes" : "No", Missing = g == null });
            else
                rows.Add(new Row { Section = sec, Goal = item, Source = "Rotary.org", Target = g, Achieved = a, Pct = Ratio(g, a), Missing = g == null });
        }

        // 1. Expand Our Reach (Membership)
        if (!isClub) Ours(Reach, "Clubs", "total_clubs", "new_clubs", "new_clubs_achieved", null, "ROW");
        if (!isClub && rows.Count > 0 && rows[^1].Goal == "Clubs") rows[^1].Pct = Growth(V("new_clubs"), V("new_clubs_achieved"), V("total_clubs"), 2);
        RotaryLocked(Reach, "Club membership", "Club membership", "total_members", "new_members_achieved", (g, a, b) => Growth(g, a, b, 0));
        Ours(Reach, "Women Members", "existing_women_members", "new_women_members", "new_women_members_achieved", "women_percentage_achievement", "ROW");
        if (!isClub)
            foreach (var band in new[] { "Red 0-10", "Yellow 11-25", "Orange 26-50", "Blue 51-100", "Purple 101+" })
                rows.Add(new Row { Section = Reach, Goal = $"RAG Analysis - {band}", Source = "Rotary.org", Achieved = O(band, "Value") });
        RotaryLocked(Reach, "Rotaract clubs", "Rotaract clubs", "rotaract_existing_clubs", "rotaract_clubs_achieved", (g, a, _) => Ratio(g, a));
        RotaryLocked(Reach, "Interact clubs", "Interact clubs", "interact_existing_clubs", "interact_clubs_achieved", (g, a, _) => Ratio(g, a));
        RotaryOnly(Reach, "Media stories about club projects", false);
        Ours(Reach, "No of Press Meet", null, "press_media_coverage", null, null, "ROW");
        RotaryOnly(Reach, "New member sponsorship", false);
        RotaryOnly(Reach, "RYLA participation", false);
        foreach (var (k, n) in new[] { ("total_new_clubs", "Summary - Total New Clubs"), ("total_membership_net_growth", "Summary - Total Membership Net Growth"),
                                       ("new_club_members_computed", "Summary - Total New women members") })
            if (Has(k)) rows.Add(new Row { Section = Reach, Goal = n, Source = "ROW (auto)", Achieved = V(k) });

        // 2. Increase our Impact (Foundation)
        if (isClub)
        {
            RotaryLocked(Impact, "Annual Fund contributions", "Annual Fund contributions", null, "club_annual_fund_ytd", (g, a, _) => Ratio(g, a), true);
            RotaryLocked(Impact, "PolioPlus Fund contributions", "PolioPlus Fund contributions", null, "club_polioplus_ytd", (g, a, _) => Ratio(g, a), true);
            Ours(Impact, "AF Per Capita", null, "club_af_per_capita_target", "club_af_per_capita", "club_af_per_capita_pct", "RISAO", true);
            Ours(Impact, "Other Funds", null, "club_other_funds_ytd_target", "club_other_funds_ytd", "club_other_funds_ytd_pct", "RISAO", true);
            Ours(Impact, "Endowment Fund", null, "club_endowment_ytd_target", "club_endowment_ytd", "club_endowment_ytd_pct", "RISAO", true);
            Ours(Impact, "Total Giving", null, "club_total_target", "club_total_ytd", "club_total_pct", "RISAO", true);
        }
        else
        {
            RotaryLocked(Impact, "Annual Fund contributions", "Annual Fund contributions", "annual_fund_highest", "annual_fund_achieved", (g, a, _) => Ratio(g, a), true);
            RotaryLocked(Impact, "PolioPlus Fund contributions", "PolioPlus Fund contributions", "polio_plus_highest", "polio_plus_achieved", (g, a, _) => Ratio(g, a), true);
            Ours(Impact, "Endowment Fund", "endowment_highest", "endowment_target", "endowment_achieved", "endowment_pct", "RISAO", true);
            Ours(Impact, "CSR", "csr_highest", "csr_target", "csr_achieved", "csr_pct", "RISAO", true);
            Ours(Impact, "Total Giving", "total_contributions_highest", "total_contributions_target", "total_giving_achieved", "total_giving_pct", "RISAO", true);
        }
        foreach (var it in new[] { "Major gifts", "Bequest Society members", "Benefactors", "Service projects", "Inbound Youth Exchange students", "Outbound Youth Exchange students" })
            RotaryOnly(Impact, it, false);

        // 3. Increase Our Ability to Adapt (Public Image) - unchanged boxes, then the Rotary.org goals.
        foreach (var (k, n) in isClub
                     ? new[] { ("club_website", "Club Website"), ("club_social_media", "Club Social Media") }
                     : new[] { ("district_website", "District Website"), ("district_social_media", "District Social Media") })
            if (Has(k)) rows.Add(new Row { Section = Adapt, Goal = n, Source = "ROW", Target = B(k) });
        if (!isClub)
        {
            foreach (var (k, n) in new[] { ("club_website_percent", "Club Website %"), ("club_social_media_percent", "Club Social Media %"),
                                           ("inter_district_pi_programme", "Inter District Public Image Programme") })
                if (Has(k)) rows.Add(new Row { Section = Adapt, Goal = n, Source = "ROW", Target = V(k) });
            // District-only Yes/No points kept in RCC (user 2026-11-16).
            foreach (var (k, n) in new[] { ("district_pi_seminar", "District Public Image Seminar"),
                                           ("specific_pi_session_training", "Specific Public Image Session in all Training Events") })
                if (Has(k)) rows.Add(new Row { Section = Adapt, Goal = n, Source = "ROW", Target = B(k) });
        }
        RotaryOnly(Adapt, "Strategic plan", true);
        RotaryOnly(Adapt, "Review and consider updating your club bylaws", true);
        RotaryOnly(Adapt, "Online presence", true);
        RotaryOnly(Adapt, "Update website and social media", false);

        // 4. Enhance Participant Engagement
        foreach (var it in new[] { "Service participation", "Social activities", "Leadership development participation", "District conference attendance",
                                   "District training participation", "Rotary Action Group participation", "Rotary Fellowship participation" })
            RotaryOnly(Engage, it, false);
        RotaryOnly(Engage, "Use of official Rotary promotional materials", true);
        return rows;
    }

    private static readonly XLColor Navy = XLColor.FromHtml("#1E3A5F"), Gold = XLColor.FromHtml("#F7A81B"), Band = XLColor.FromHtml("#DCE6F2");

    private static void Title(IXLWorksheet ws, string title, string sub, int cols)
    {
        ws.Cell(1, 1).Value = title;
        ws.Range(1, 1, 1, cols).Merge().Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(XLColor.White).Fill.SetBackgroundColor(Navy);
        ws.Cell(2, 1).Value = sub;
        ws.Range(2, 1, 2, cols).Merge().Style.Font.SetItalic().Font.SetFontColor(XLColor.DarkGray);
    }

    private static void Head(IXLRange r) =>
        r.Style.Font.SetBold().Font.SetFontColor(XLColor.White).Fill.SetBackgroundColor(Navy)
         .Alignment.SetHorizontal(XLAlignmentHorizontalValues.Center).Alignment.SetVertical(XLAlignmentVerticalValues.Center).Alignment.SetWrapText(true)
         .Border.SetOutsideBorder(XLBorderStyleValues.Thin).Border.SetInsideBorder(XLBorderStyleValues.Thin);

    private static void Put(IXLCell c, object? v, bool money = false, bool pct = false)
    {
        switch (v)
        {
            case null: c.Value = ""; break;
            case decimal d:
                c.Value = d;
                // Whole numbers without a trailing "." (Excel shows "130." for #,##0.##).
                var whole = d == decimal.Truncate(d);
                c.Style.NumberFormat.Format = pct ? (whole ? "0\"%\"" : "0.##\"%\"")
                    : money ? (whole ? "\"$\"#,##0" : "\"$\"#,##0.##") : (whole ? "#,##0" : "#,##0.##");
                break;
            default: c.Value = v.ToString(); break;
        }
    }

    private static void WriteRcc(IXLWorksheet ws, List<Row> rows, string title, string sub)
    {
        string[] head = { "Section", "Goal", "As on July 1st / Highest", "Goal for the Current year", "Achieved", "% Achieved", "Comes from" };
        Title(ws, title, sub, head.Length);
        for (int i = 0; i < head.Length; i++) ws.Cell(4, i + 1).Value = head[i];
        Head(ws.Range(4, 1, 4, head.Length));
        int r = 5; string? last = null;
        foreach (var x in rows)
        {
            if (x.Section != last)
            {
                ws.Cell(r, 1).Value = x.Section;
                ws.Range(r, 1, r, head.Length).Merge().Style.Font.SetBold().Fill.SetBackgroundColor(Band).Border.SetLeftBorder(XLBorderStyleValues.Thick).Border.SetLeftBorderColor(Gold);
                last = x.Section; r++;
            }
            ws.Cell(r, 1).Value = x.Section;
            ws.Cell(r, 2).Value = x.Goal;
            Put(ws.Cell(r, 3), x.AsOn, x.IsMoney);
            if (x.Missing)
            {
                ws.Cell(r, 4).Value = "Not set on Rotary.org";
                ws.Cell(r, 4).Style.Font.SetFontColor(XLColor.Red).Border.SetOutsideBorder(XLBorderStyleValues.Thin).Border.SetOutsideBorderColor(XLColor.Red);
            }
            else Put(ws.Cell(r, 4), x.Target, x.IsMoney);
            Put(ws.Cell(r, 5), x.Achieved, x.IsMoney);
            Put(ws.Cell(r, 6), x.Pct, pct: true);
            ws.Cell(r, 7).Value = x.Source;
            ws.Range(r, 1, r, head.Length).Style.Border.SetOutsideBorder(XLBorderStyleValues.Thin).Border.SetInsideBorder(XLBorderStyleValues.Hair);
            r++;
        }
        ws.Column(1).Width = 30; ws.Column(2).Width = 44;
        for (int c = 3; c <= 6; c++) { ws.Column(c).Width = 18; ws.Column(c).Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Right); }
        ws.Column(7).Width = 16;
        ws.SheetView.FreezeRows(4);
    }

    // District report: one row per club, the 26 Rotary.org goals across (Goal / Achieved), Total at the bottom.
    private static async Task WriteRccClubsAsync(IXLWorksheet ws, MySqlConnection conn, int districtId, int yearId, string title, string yearLabel)
    {
        var clubs = (await conn.QueryAsync<(int Id, string Name, string? Rid)>(
            @"SELECT pk_club_id, ClubName, ClubRotaryId FROM club_master
              WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club' ORDER BY ClubName",
            new { D = districtId })).ToList();
        var vals = (await conn.QueryAsync<(int Club, string Item, string Kind, decimal? Value)>(
            @"SELECT v.fk_club_id, v.ItemName, v.Kind, v.NumericValue FROM goal_rotary_org_values v
              JOIN club_master c ON c.pk_club_id = v.fk_club_id AND c.fk_district_id = @D
              WHERE v.fk_year_id = @Y AND v.EntityType = 'Club' AND v.isdeleted = 0 AND v.Kind IN ('Target','Achieved')",
            new { D = districtId, Y = yearId })).ToList();
        var map = vals.GroupBy(v => (v.Club, v.Item, v.Kind)).ToDictionary(g => g.Key, g => g.First().Value);

        int cols = 2 + RotaryGoals.Length * 2;
        Title(ws, title, $"Rotary year {yearLabel} · Rotary.org goals per club (Yes/No goals: 1 = Yes)", cols);
        ws.Cell(4, 1).Value = "Club"; ws.Cell(4, 2).Value = "Club ID";
        ws.Range(4, 1, 5, 1).Merge(); ws.Range(4, 2, 5, 2).Merge();
        for (int i = 0; i < RotaryGoals.Length; i++)
        {
            int c = 3 + i * 2;
            ws.Cell(4, c).Value = RotaryGoals[i].Item;
            ws.Range(4, c, 4, c + 1).Merge();
            ws.Cell(5, c).Value = "Goal"; ws.Cell(5, c + 1).Value = "Achieved";
        }
        Head(ws.Range(4, 1, 5, cols));
        int r = 6;
        foreach (var club in clubs)
        {
            ws.Cell(r, 1).Value = club.Name; ws.Cell(r, 2).Value = club.Rid ?? "";
            for (int i = 0; i < RotaryGoals.Length; i++)
            {
                int c = 3 + i * 2;
                if (map.TryGetValue((club.Id, RotaryGoals[i].Item, "Target"), out var g) && g != null) Put(ws.Cell(r, c), g);
                else { ws.Cell(r, c).Value = "Not set"; ws.Cell(r, c).Style.Font.SetFontColor(XLColor.Red); }
                if (map.TryGetValue((club.Id, RotaryGoals[i].Item, "Achieved"), out var a)) Put(ws.Cell(r, c + 1), a);
            }
            r++;
        }
        if (clubs.Count > 0)
        {
            ws.Cell(r, 1).Value = "Total";
            for (int c = 3; c <= cols; c++)
                ws.Cell(r, c).FormulaA1 = $"SUM({ws.Cell(6, c).Address}:{ws.Cell(r - 1, c).Address})";
            ws.Range(r, 1, r, cols).Style.Font.SetBold().Fill.SetBackgroundColor(Band);
        }
        ws.Column(1).Width = 34; ws.Column(2).Width = 12;
        for (int c = 3; c <= cols; c++) ws.Column(c).Width = 11;
        ws.Row(4).Height = 48;
        ws.SheetView.Freeze(5, 2);
    }

    // District Goals (District Awards): answers + points.
    private static async Task WriteDistrictGoalsAsync(IXLWorksheet ws, MySqlConnection conn, int districtId, int? clubId, int yearId, string title, string yearLabel)
    {
        var auto = (await conn.QueryAsync<(int Id, string Cat, string Activity)>(@"
            SELECT q.pk_id, cc.category_name, a.activity_name FROM district_citation_auto_question q
            JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
            WHERE q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0 ORDER BY cc.sort_order, q.sort_order",
            new { D = districtId, Y = yearId })).ToList();
        var manual = (await conn.QueryAsync<(int Id, string Cat, string Title, string Type)>(@"
            SELECT sc.pk_id, cc.category_name, sc.sub_criteria_title, sc.answer_type FROM district_citation_manual_sub_criteria sc
            JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
            JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
            WHERE mc.fk_district_id = @D AND mc.fk_year_id = @Y AND mc.isdeleted = 0 AND sc.isdeleted = 0
            ORDER BY cc.sort_order, mc.sort_order, sc.sort_order", new { D = districtId, Y = yearId })).ToList();
        var options = manual.Count == 0 ? new Dictionary<int, string>() : (await conn.QueryAsync<(int Id, string Text)>(
            "SELECT pk_id, option_text FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted = 0",
            new { Ids = manual.Select(m => m.Id).ToList() })).ToDictionary(o => o.Id, o => o.Text);
        var entries = (await conn.QueryAsync<(int Club, string Type, int Q, string? Answer, decimal Pts, decimal Bonus)>(@"
            SELECT fk_club_id, entry_type, fk_question_id, answer_value, COALESCE(points_earned,0), COALESCE(bonus_earned,0)
            FROM district_citation_club_entry WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0"
            + (clubId > 0 ? " AND fk_club_id = @C" : ""), new { D = districtId, Y = yearId, C = clubId ?? 0 })).ToList();

        string ManualAnswer(int club, (int Id, string Cat, string Title, string Type) m)
        {
            var e = entries.FirstOrDefault(x => x.Club == club && x.Type == "manual" && x.Q == m.Id);
            var a = e.Answer ?? "";
            if (m.Type == "choose_one" && int.TryParse(a, out var oid) && options.TryGetValue(oid, out var t)) return t;
            if (m.Type == "yesno") return a.Equals("yes", StringComparison.OrdinalIgnoreCase) ? "Yes" : a.Equals("no", StringComparison.OrdinalIgnoreCase) ? "No" : "";
            return a;
        }
        decimal ManualPts(int club, int q) => entries.Where(x => x.Club == club && x.Type == "manual" && x.Q == q).Sum(x => x.Pts + x.Bonus);
        decimal AutoPts(int club, int q) => entries.Where(x => x.Club == club && x.Type == "auto" && x.Q == q).Sum(x => x.Pts + x.Bonus);
        decimal AutoCount(int club, int q) => entries.Where(x => x.Club == club && x.Type == "auto" && x.Q == q)
            .Sum(x => decimal.TryParse(x.Answer, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : 0);

        if (clubId > 0)
        {
            string[] head = { "Category", "Type", "Question", "Answer", "Points" };
            Title(ws, title, $"Rotary year {yearLabel}", head.Length);
            for (int i = 0; i < head.Length; i++) ws.Cell(4, i + 1).Value = head[i];
            Head(ws.Range(4, 1, 4, head.Length));
            int r = 5; int club = clubId.Value; decimal total = 0;
            foreach (var q in auto)
            {
                ws.Cell(r, 1).Value = q.Cat; ws.Cell(r, 2).Value = "Auto"; ws.Cell(r, 3).Value = q.Activity;
                Put(ws.Cell(r, 4), AutoCount(club, q.Id)); var p = AutoPts(club, q.Id); Put(ws.Cell(r, 5), p); total += p; r++;
            }
            foreach (var m in manual)
            {
                ws.Cell(r, 1).Value = m.Cat; ws.Cell(r, 2).Value = "Manual"; ws.Cell(r, 3).Value = m.Title;
                var ans = ManualAnswer(club, m);
                if (m.Type == "number" && decimal.TryParse(ans, out var num)) Put(ws.Cell(r, 4), num); else ExcelFigure.Set(ws.Cell(r, 4), ans);
                ws.Cell(r, 4).Style.Alignment.SetWrapText(true);
                var p = ManualPts(club, m.Id); Put(ws.Cell(r, 5), p); total += p; r++;
            }
            ws.Cell(r, 3).Value = "Total points"; Put(ws.Cell(r, 5), total);
            ws.Range(r, 1, r, 5).Style.Font.SetBold().Fill.SetBackgroundColor(Band);
            ws.Range(5, 1, Math.Max(5, r), 5).Style.Border.SetOutsideBorder(XLBorderStyleValues.Thin).Border.SetInsideBorder(XLBorderStyleValues.Hair);
            ws.Column(1).Width = 32; ws.Column(2).Width = 9; ws.Column(3).Width = 50; ws.Column(4).Width = 40; ws.Column(5).Width = 10;
            ws.SheetView.FreezeRows(4);
            return;
        }

        var clubs = (await conn.QueryAsync<(int Id, string Name, string? Rid)>(
            @"SELECT pk_club_id, ClubName, ClubRotaryId FROM club_master
              WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club' ORDER BY ClubName",
            new { D = districtId })).ToList();
        // Columns: auto = points; manual = the answer. Category over its columns, then the question.
        var colsDef = auto.Select(q => (q.Cat, Name: $"{q.Activity} (points)", Auto: true, Id: q.Id, Type: "number"))
            .Concat(manual.Select(m => (m.Cat, Name: m.Title, Auto: false, Id: m.Id, Type: m.Type))).ToList();
        int cols = 2 + colsDef.Count + 3;
        Title(ws, title, $"Rotary year {yearLabel} · Auto = points, Manual = the club's answer", cols);
        ws.Cell(4, 1).Value = "Club"; ws.Cell(4, 2).Value = "Club ID";
        ws.Range(4, 1, 5, 1).Merge(); ws.Range(4, 2, 5, 2).Merge();
        for (int i = 0; i < colsDef.Count; i++)
        {
            ws.Cell(4, 3 + i).Value = colsDef[i].Cat;
            ws.Cell(5, 3 + i).Value = colsDef[i].Name;
        }
        // merge equal neighbouring category cells
        for (int i = 0; i < colsDef.Count;)
        {
            int j = i; while (j + 1 < colsDef.Count && colsDef[j + 1].Cat == colsDef[i].Cat) j++;
            if (j > i) ws.Range(4, 3 + i, 4, 3 + j).Merge();
            i = j + 1;
        }
        int tc = 3 + colsDef.Count;
        ws.Cell(4, tc).Value = "Total Auto"; ws.Cell(4, tc + 1).Value = "Total Manual"; ws.Cell(4, tc + 2).Value = "Grand Total";
        for (int k = 0; k < 3; k++) ws.Range(4, tc + k, 5, tc + k).Merge();
        Head(ws.Range(4, 1, 5, cols));
        int r2 = 6;
        foreach (var club in clubs)
        {
            ws.Cell(r2, 1).Value = club.Name; ws.Cell(r2, 2).Value = club.Rid ?? "";
            decimal ta = 0, tm = 0;
            for (int i = 0; i < colsDef.Count; i++)
            {
                var c = colsDef[i];
                if (c.Auto) { var p = AutoPts(club.Id, c.Id); ta += p; Put(ws.Cell(r2, 3 + i), p); }
                else
                {
                    var m = manual.First(x => x.Id == c.Id);
                    var ans = ManualAnswer(club.Id, m);
                    if (m.Type == "number" && decimal.TryParse(ans, out var num)) Put(ws.Cell(r2, 3 + i), num); else ExcelFigure.Set(ws.Cell(r2, 3 + i), ans);
                    tm += ManualPts(club.Id, c.Id);
                }
            }
            Put(ws.Cell(r2, tc), ta); Put(ws.Cell(r2, tc + 1), tm); Put(ws.Cell(r2, tc + 2), ta + tm);
            ws.Range(r2, tc, r2, tc + 2).Style.Font.SetBold();
            r2++;
        }
        if (clubs.Count > 0)
        {
            ws.Cell(r2, 1).Value = "Total";
            for (int i = 0; i < colsDef.Count; i++)
                if (colsDef[i].Auto || colsDef[i].Type == "number")
                    ws.Cell(r2, 3 + i).FormulaA1 = $"SUM({ws.Cell(6, 3 + i).Address}:{ws.Cell(r2 - 1, 3 + i).Address})";
            for (int k = 0; k < 3; k++)
                ws.Cell(r2, tc + k).FormulaA1 = $"SUM({ws.Cell(6, tc + k).Address}:{ws.Cell(r2 - 1, tc + k).Address})";
            ws.Range(r2, 1, r2, cols).Style.Font.SetBold().Fill.SetBackgroundColor(Band);
        }
        ws.Column(1).Width = 34; ws.Column(2).Width = 12;
        for (int c = 3; c <= cols; c++) ws.Column(c).Width = 16;
        ws.Row(5).Height = 60;
        ws.SheetView.Freeze(5, 2);
    }
}

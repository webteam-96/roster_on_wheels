using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Club Analytics — an overall per-club COUNTS report (not goal-setting). One row per club with
// member / meeting / project (by avenue) / newsletter / OCV / announcement / event counts, plus the
// club's RI-sync flag and current-year President & Secretary contacts. Downloadable as .xlsx.
//   • District (all active clubs): /api/club-analytics/excel?districtId=&yearId=
//   • Single club:                 /api/club-analytics/excel?clubId=&yearId=
// yearId defaults to the current Rotary year. Admin / SuperAdmin only. Counts only — no detail rows.
[ApiController]
[Route("api/club-analytics")]
[Authorize]
public class ClubAnalyticsController : ControllerBase
{
    private readonly string _cs;
    private readonly IYearTableResolver _yearTables;

    public ClubAnalyticsController(IConfiguration config, IYearTableResolver yearTables)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    private MySqlConnection Conn() => new(_cs);
    private bool IsAuthorised()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("Admin") || roles.Contains("SuperAdmin");
    }
    private bool IsSuperAdmin() => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");

    // Three modes: clubId (single club) | districtId (all clubs of a district) | neither (ALL clubs,
    // all districts — SuperAdmin only). One row per club either way.
    [HttpGet("excel")]
    public async Task<ActionResult> Excel([FromQuery] int? districtId = null, [FromQuery] int? clubId = null, [FromQuery] int? yearId = null)
    {
        if (!IsAuthorised()) return Forbid();
        bool allClubs = !(clubId is > 0) && !(districtId is > 0);
        if (allClubs && !IsSuperAdmin())
            return Forbid();

        using var conn = Conn();
        await conn.OpenAsync();

        int yr = yearId ?? await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1") ?? 0;
        if (yr <= 0) return BadRequest(new { message = "No rotary year available." });
        string yearLabel = await conn.ExecuteScalarAsync<string?>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yr }) ?? "";

        // Year-wise projects table (rotary_projects_YYYY_YY). When absent, project counts are 0.
        var info = await _yearTables.ResolveByYearIdAsync(conn, yr);
        string projTable = info?.ProjectsTable ?? "";

        string totalProj = projTable == "" ? "0"
            : $"(SELECT COUNT(*) FROM `{projTable}` p WHERE p.fk_club_id = c.pk_club_id AND p.isdeleted = 0)";
        string Av(string key) => projTable == "" ? "0"
            : $"(SELECT COUNT(*) FROM `{projTable}` p JOIN module_master m ON m.pk_module_id = p.fk_module_id WHERE p.fk_club_id = c.pk_club_id AND p.isdeleted = 0 AND m.ModuleKey = '{key}')";
        string Bod(string desig, string col) =>
            $"(SELECT {col} FROM board_of_directors b JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @Y AND dm.designation_name = '{desig}' AND b.isdeleted = 0 LIMIT 1)";
        // Club TRF "Foundation" achieved value straight from Goal Setting (goal_entries, club-level TRF field).
        string Fnd(string key) =>
            $"(SELECT e.NumericValue FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id WHERE e.EntityType = 'Club' AND e.fk_club_id = c.pk_club_id AND e.fk_year_id = @Y AND COALESCE(e.isdeleted, 0) = 0 AND f.FieldKey = '{key}' ORDER BY e.pk_id DESC LIMIT 1)";

        string clubFilter = clubId is > 0 ? "c.pk_club_id = @Club"
            : districtId is > 0 ? "c.fk_district_id = @Dist"
            : "1 = 1";   // all clubs, all districts

        var sql = $@"
            SELECT c.pk_club_id AS clubId, d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   c.ClubRotaryId AS clubRotaryId, COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSynced,
                   (CASE WHEN EXISTS (SELECT 1 FROM club_websites w WHERE w.fk_club_id = c.pk_club_id AND COALESCE(w.isdeleted, 0) = 0 AND (COALESCE(w.IsPurchased, 0) = 1 OR w.Status = 'Active')) THEN 1 ELSE 0 END) AS hasWebsite,
                   (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS memberCount,
                   (SELECT COUNT(*) FROM board_of_directors b WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @Y AND b.isdeleted = 0) AS bodCount,
                   (SELECT COUNT(*) FROM club_attendance a WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @Y AND a.isdeleted = 0) AS meetingCount,
                   {totalProj} AS serviceProjectCount,
                   {Av("club_service")} AS clubService,
                   {Av("community_service")} AS communityService,
                   {Av("vocational_service")} AS vocationalService,
                   {Av("international_service")} AS internationalService,
                   {Av("new_generation_service")} AS newGenerationService,
                   {Av("public_image_initiative")} AS publicImageInitiative,
                   (SELECT COUNT(*) FROM newsletters n JOIN rotary_year_master y ON y.pk_year_id = @Y WHERE n.fk_club_id = c.pk_club_id AND n.isdeleted = 0 AND n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)) AS newsletterCount,
                   (SELECT COUNT(*) FROM ocv_documents o WHERE o.fk_club_id = c.pk_club_id AND o.fk_year_id = @Y AND o.isdeleted = 0) AS ocvCount,
                   (SELECT COUNT(*) FROM announcements a JOIN rotary_year_master y ON y.pk_year_id = @Y WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0 AND a.PublishDateTime >= y.StartDate AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)) AS announcementCount,
                   (SELECT COUNT(*) FROM upcoming_events e JOIN rotary_year_master y ON y.pk_year_id = @Y WHERE e.fk_club_id = c.pk_club_id AND e.isdeleted = 0 AND e.PublishDate >= y.StartDate AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)) AS eventCount,
                   (CASE WHEN EXISTS (SELECT 1 FROM membership_dues md WHERE md.fk_club_id = c.pk_club_id AND md.RotaryYear = @YearLabel AND COALESCE(md.isdeleted, 0) = 0) THEN 1 ELSE 0 END) AS hasClubDues,
                   {Fnd("club_annual_fund_ytd")} AS foundationAnnual,
                   {Fnd("club_polioplus_ytd")}   AS foundationPolio,
                   {Fnd("club_endowment_ytd")}   AS foundationEndowment,
                   {Fnd("club_other_funds_ytd")} AS foundationOther,
                   {Bod("Club President", "m.MemberName")} AS presidentName,
                   {Bod("Club President", "m.PrimaryMobileNumber")} AS presidentMobile,
                   {Bod("Club President", "m.EmailId")} AS presidentEmail,
                   {Bod("Club Secretary", "m.MemberName")} AS secretaryName,
                   {Bod("Club Secretary", "m.PrimaryMobileNumber")} AS secretaryMobile,
                   {Bod("Club Secretary", "m.EmailId")} AS secretaryEmail
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE {clubFilter} AND c.isdeleted = 0 AND COALESCE(c.IsActive, 1) = 1
            ORDER BY d.DistrictNumber, c.ClubName";

        var rows = (await conn.QueryAsync<dynamic>(sql,
            new { Y = yr, Club = clubId ?? 0, Dist = districtId ?? 0, YearLabel = yearLabel })).ToList();

        // OCV Dues (single club only) — one row per dues type: Name · Amount · Paid-on. Every active dues
        // type is listed (LEFT JOIN → amount 0 / no paid-on when nothing was uploaded).
        List<dynamic> ocvDues = new();
        if (clubId is > 0 && rows.Count > 0)
        {
            var duesCat = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'dues' LIMIT 1");
            if (duesCat is > 0)
                ocvDues = (await conn.QueryAsync<dynamic>(@"
                    SELECT COALESCE(t.TypeName, '') AS name, COALESCE(SUM(d.Amount), 0) AS amount,
                           MAX(d.PaidOn) AS paidOn
                    FROM ocv_document_type t
                    LEFT JOIN ocv_documents d ON d.fk_type_id = t.pk_type_id AND d.fk_club_id = @Club
                         AND d.fk_category_id = @Cat AND d.fk_year_id = @Y AND d.isdeleted = 0
                    WHERE t.fk_category_id = @Cat AND t.isdeleted = 0 AND t.IsActive = 1
                    GROUP BY t.pk_type_id, t.TypeName, t.SortOrder
                    ORDER BY t.SortOrder, t.TypeName",
                    new { Club = clubId, Cat = duesCat.Value, Y = yr })).ToList();
        }

        // Single club → an attractive, print-friendly one-page report (vertical, sectioned). District /
        // all-clubs modes keep the existing one-row-per-club table (untouched).
        var bytes = (clubId is > 0 && rows.Count > 0)
            ? BuildClubReportExcel(rows[0], yearLabel, ocvDues)
            : BuildExcel(rows);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"club-analytics-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    // Print-friendly single-club report — vertical label/value layout grouped into sections, styled and
    // fit-to-page for a clean printout (used only for the single-club download).
    private static byte[] BuildClubReportExcel(dynamic row, string yearLabel, List<dynamic> ocvDues)
    {
        static long N(object? v) => v == null ? 0 : Convert.ToInt64(v);
        static string S(object? v) => v?.ToString() ?? "";
        static string SD(object? v) { var s = v?.ToString(); return string.IsNullOrWhiteSpace(s) ? "—" : s!; }

        var navy = XLColor.FromHtml("#1a365d");
        var blue = XLColor.FromHtml("#2d7fc7");
        var labelBg = XLColor.FromHtml("#f1f5f9");
        var border = XLColor.FromHtml("#cbd5e1");

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Club Report");
        ws.Column(1).Width = 34;
        ws.Column(2).Width = 52;

        int r = 1;

        // ── Title band ──────────────────────────────────────────────────────
        ws.Range(r, 1, r, 2).Merge();
        var title = ws.Cell(r, 1);
        title.Value = S(row.clubName);
        title.Style.Font.Bold = true;
        title.Style.Font.FontSize = 18;
        title.Style.Font.FontColor = XLColor.White;
        title.Style.Fill.BackgroundColor = navy;
        title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        title.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(r).Height = 34; r++;

        ws.Range(r, 1, r, 2).Merge();
        var sub = ws.Cell(r, 1);
        sub.Value = $"District {S(row.districtNumber)}   ·   Rotary Year {yearLabel}   ·   Club ID {S(row.clubRotaryId)}";
        sub.Style.Font.FontSize = 10;
        sub.Style.Font.FontColor = XLColor.FromHtml("#475569");
        sub.Style.Fill.BackgroundColor = XLColor.FromHtml("#eef2f7");
        sub.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(r).Height = 20; r++;

        ws.Range(r, 1, r, 2).Merge();
        var gen = ws.Cell(r, 1);
        gen.Value = $"Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}";
        gen.Style.Font.FontSize = 8;
        gen.Style.Font.Italic = true;
        gen.Style.Font.FontColor = XLColor.FromHtml("#94a3b8");
        gen.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r++;
        r++; // spacer

        void Section(string label)
        {
            ws.Range(r, 1, r, 2).Merge();
            var c = ws.Cell(r, 1);
            c.Value = label;
            c.Style.Font.Bold = true;
            c.Style.Font.FontColor = XLColor.White;
            c.Style.Fill.BackgroundColor = blue;
            c.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(r).Height = 22; r++;
        }
        void KV(string key, object? val)
        {
            var k = ws.Cell(r, 1); k.Value = key;
            k.Style.Font.Bold = true;
            k.Style.Font.FontColor = XLColor.FromHtml("#334155");
            k.Style.Fill.BackgroundColor = labelBg;
            var v = ws.Cell(r, 2);
            if (val is string vs) v.Value = vs; else v.Value = N(val);
            var rng = ws.Range(r, 1, r, 2);
            rng.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            rng.Style.Border.OutsideBorderColor = border;
            rng.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            r++;
        }
        // Money rows (Foundation) — real number with 2 decimals, right-aligned.
        void KVamt(string key, object? val)
        {
            var k = ws.Cell(r, 1); k.Value = key;
            k.Style.Font.Bold = true; k.Style.Font.FontColor = XLColor.FromHtml("#334155");
            k.Style.Fill.BackgroundColor = labelBg;
            var v = ws.Cell(r, 2);
            v.Value = val == null ? 0d : (double)Convert.ToDecimal(val);
            v.Style.NumberFormat.Format = "#,##0.00";
            var rng = ws.Range(r, 1, r, 2);
            rng.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            rng.Style.Border.OutsideBorderColor = border;
            rng.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            r++;
        }

        Section("Membership & Governance");
        KV("Member Count", N(row.memberCount));
        KV("Board of Directors (BOD)", N(row.bodCount));
        r++;

        Section("Avenue of Service");
        KV("Total Service Projects", N(row.serviceProjectCount));
        KV("Club Service", N(row.clubService));
        KV("Community Service", N(row.communityService));
        KV("Vocational Service", N(row.vocationalService));
        KV("International Service", N(row.internationalService));
        KV("New Generation Service", N(row.newGenerationService));
        KV("Public Image Initiative", N(row.publicImageInitiative));
        r++;

        Section("Communications");
        KV("Newsletters", N(row.newsletterCount));
        KV("OCV Documents", N(row.ocvCount));
        KV("Announcements", N(row.announcementCount));
        KV("Upcoming Events", N(row.eventCount));
        r++;

        Section("Status");
        KV("Club Dues", N(row.hasClubDues) == 1 ? "Yes" : "No");
        KV("Club Website", N(row.hasWebsite) == 1 ? "Yes" : "No");
        KV("Sync", N(row.isSynced) == 1 ? "Yes" : "No");
        r++;

        Section("Foundation (TRF — till date, from Goal Setting)");
        KVamt("Annual Fund", row.foundationAnnual);
        KVamt("Polio Plus", row.foundationPolio);
        KVamt("Endowment", row.foundationEndowment);
        KVamt("Other Funds", row.foundationOther);
        r++;

        Section("Dues");
        if (ocvDues == null || ocvDues.Count == 0)
            KV("Dues", "No dues records");
        else
            foreach (var d in ocvDues)
                // Every dues type is listed; paid/uploaded → "Paid · <date>", otherwise just "—".
                KV(S(d.name), d.paidOn == null ? "—" : $"Paid · {Convert.ToDateTime(d.paidOn):dd MMM yyyy}");
        r++;

        Section("Leadership Contacts");
        KV("President", SD(row.presidentName));
        KV("President — Mobile", SD(row.presidentMobile));
        KV("President — Email", SD(row.presidentEmail));
        KV("Secretary", SD(row.secretaryName));
        KV("Secretary — Mobile", SD(row.secretaryMobile));
        KV("Secretary — Email", SD(row.secretaryEmail));

        // Print setup — one clean page, portrait, centered, with margins.
        ws.PageSetup.PageOrientation = XLPageOrientation.Portrait;
        ws.PageSetup.FitToPages(1, 1);
        ws.PageSetup.CenterHorizontally = true;
        ws.PageSetup.Margins.Top = 0.6;
        ws.PageSetup.Margins.Bottom = 0.6;
        ws.PageSetup.Margins.Left = 0.5;
        ws.PageSetup.Margins.Right = 0.5;
        ws.PageSetup.PrintAreas.Add($"A1:B{r - 1}");

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static byte[] BuildExcel(List<dynamic> rows)
    {
        // Column order = the reference file, with three extra COUNT columns (Club Service,
        // Community Service, Events) inserted next to their related columns.
        string[] headers =
        {
            "Sr.No.", "District Number", "Club Name", "Club ID", "RI Sync", "Club Website",
            "Member Count", "BOD Count", "Club Meeting Count", "Service Project Count",
            "Club Service", "Community Service", "Vocational Service", "International Service",
            "New Generation Service", "Public Image Initiative",
            "NewsLetters", "OCV", "Announcement", "Events",
            "President Name", "President Mobile Number", "President Email ID",
            "Secretary Name", "Secretary Mobile Number", "Secretary Email ID",
        };

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Club Analytics");
        for (int i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        ws.Row(1).Style.Font.SetBold();
        ws.Row(1).Style.Fill.SetBackgroundColor(XLColor.FromHtml("#2d7fc7"));
        ws.Row(1).Style.Font.SetFontColor(XLColor.White);

        static long N(object? v) => v == null ? 0 : Convert.ToInt64(v);
        static string S(object? v) => v?.ToString() ?? "";

        int r = 2, sr = 1;
        foreach (var row in rows)
        {
            int c = 1;
            ws.Cell(r, c++).Value = sr++;
            ws.Cell(r, c++).Value = S(row.districtNumber);
            ws.Cell(r, c++).Value = S(row.clubName);
            ws.Cell(r, c++).Value = S(row.clubRotaryId);
            ws.Cell(r, c++).Value = N(row.isSynced) == 1 ? "Yes" : "No";
            ws.Cell(r, c++).Value = N(row.hasWebsite) == 1 ? "Yes" : "No";
            ws.Cell(r, c++).Value = N(row.memberCount);
            ws.Cell(r, c++).Value = N(row.bodCount);
            ws.Cell(r, c++).Value = N(row.meetingCount);
            ws.Cell(r, c++).Value = N(row.serviceProjectCount);
            ws.Cell(r, c++).Value = N(row.clubService);
            ws.Cell(r, c++).Value = N(row.communityService);
            ws.Cell(r, c++).Value = N(row.vocationalService);
            ws.Cell(r, c++).Value = N(row.internationalService);
            ws.Cell(r, c++).Value = N(row.newGenerationService);
            ws.Cell(r, c++).Value = N(row.publicImageInitiative);
            ws.Cell(r, c++).Value = N(row.newsletterCount);
            ws.Cell(r, c++).Value = N(row.ocvCount);
            ws.Cell(r, c++).Value = N(row.announcementCount);
            ws.Cell(r, c++).Value = N(row.eventCount);
            ws.Cell(r, c++).Value = S(row.presidentName);
            ws.Cell(r, c++).Value = S(row.presidentMobile);
            ws.Cell(r, c++).Value = S(row.presidentEmail);
            ws.Cell(r, c++).Value = S(row.secretaryName);
            ws.Cell(r, c++).Value = S(row.secretaryMobile);
            ws.Cell(r, c++).Value = S(row.secretaryEmail);
            r++;
        }
        ws.Columns(1, headers.Length).AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}

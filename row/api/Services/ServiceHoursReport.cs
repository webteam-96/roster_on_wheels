using ClosedXML.Excel;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>Pure rules and report building for service hours (no database): input checks, the roll-up of hour and
/// money rows into project / member / club rows, and the Excel export. ServiceHoursService feeds it.</summary>
public static class ServiceHoursReport
{
    public const decimal MaxHoursPerDay = 24m;
    public const decimal MaxAmount = 1_000_000_000m;

    /// <summary>One group of hours: logged (approved) or recorded on a volunteer sheet. MemberId 0: a non-member
    /// volunteer, counted on the project but not as a member.</summary>
    public sealed record HourFact(int ClubId, int MemberId, string Name, int? ProjectId, decimal Hours, bool Volunteer, int Entries = 0);

    public sealed record MoneyFact(int ClubId, int ProjectId, string Kind, string? Currency, decimal Amount);

    private static string? Clean(string? s, int max, string what)
    {
        s = s?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (s.Length > max) throw new InvalidOperationException($"{what} is {max} characters at most.");
        return s;
    }

    /// <summary>Checks a member's entry and returns it trimmed. today is the UTC date; a day ahead is allowed for
    /// members east of UTC.</summary>
    public static SaveServiceHoursDto Validate(SaveServiceHoursDto d, DateTime today)
    {
        if (d.ClubId <= 0) throw new InvalidOperationException("Pick the club.");
        if (d.Hours <= 0 || d.Hours > MaxHoursPerDay) throw new InvalidOperationException("Hours must be more than 0 and at most 24.");
        if (decimal.Round(d.Hours, 2) != d.Hours) throw new InvalidOperationException("Hours take at most two decimals.");
        var date = d.ServiceDate.Date;
        if (date > today.Date.AddDays(1)) throw new InvalidOperationException("The service date cannot be in the future.");
        if (date < today.Date.AddYears(-2)) throw new InvalidOperationException("The service date is more than two years ago.");
        var other = Clean(d.OtherService, 200, "The service description");
        if (d.ProjectId is not > 0 && other == null) throw new InvalidOperationException("Pick a project or say what the service was.");
        return new SaveServiceHoursDto
        {
            ClubId = d.ClubId, ProjectId = d.ProjectId is > 0 ? d.ProjectId : null, OtherService = d.ProjectId is > 0 ? null : other,
            ServiceDate = date, Hours = d.Hours, Note = Clean(d.Note, 1000, "The note"),
        };
    }

    public static SaveContributionDto Validate(SaveContributionDto d, DateTime today)
    {
        if (d.ProjectId <= 0 || d.YearId <= 0) throw new InvalidOperationException("Pick the project.");
        var kind = d.Kind?.Trim().ToLowerInvariant();
        if (kind is not ("cash" or "in_kind")) throw new InvalidOperationException("A contribution is cash or in kind.");
        if (d.Amount <= 0 || d.Amount > MaxAmount) throw new InvalidOperationException("Enter an amount more than 0.");
        if (decimal.Round(d.Amount, 2) != d.Amount) throw new InvalidOperationException("The amount takes at most two decimals.");
        if (d.ContributionDate.Date > today.Date.AddDays(1)) throw new InvalidOperationException("The date cannot be in the future.");
        var description = Clean(d.Description, 300, "The description");
        if (kind == "in_kind" && description == null) throw new InvalidOperationException("Say what was given in kind.");
        return new SaveContributionDto
        {
            ProjectId = d.ProjectId, YearId = d.YearId, Kind = kind, Amount = d.Amount, ContributionDate = d.ContributionDate.Date,
            Contributor = Clean(d.Contributor, 150, "The contributor"), Description = description,
        };
    }

    public static List<MoneyDto> Money(IEnumerable<MoneyFact> facts, string kind) =>
        facts.Where(f => f.Kind == kind)
            .GroupBy(f => f.Currency ?? "")
            .Select(g => new MoneyDto { Currency = g.Key, Amount = g.Sum(f => f.Amount) })
            .OrderBy(m => m.Currency, StringComparer.Ordinal)
            .ToList();

    private static int MemberCount(IEnumerable<HourFact> facts) => facts.Where(f => f.MemberId > 0).Select(f => f.MemberId).Distinct().Count();

    /// <summary>Club report rows. titles: project id to (title, man_hours typed on the project).</summary>
    public static void FillClub(ServiceReportDto r, IReadOnlyList<HourFact> hours, IReadOnlyList<MoneyFact> money,
        IReadOnlyDictionary<int, (string Title, int? ManHours)> titles)
    {
        var keys = hours.Select(h => h.ProjectId).Concat(money.Select(m => (int?)m.ProjectId)).Distinct();
        r.ByProject = keys.Select(k =>
            {
                var h = hours.Where(x => x.ProjectId == k).ToList();
                var m = money.Where(x => x.ProjectId == k).ToList();
                var known = k is { } id && titles.TryGetValue(id, out var t) ? t : ((string Title, int? ManHours)?)null;
                return new ServiceProjectReportRowDto
                {
                    ProjectId = k,
                    Title = k == null ? "Other service" : known?.Title ?? $"Project {k}",
                    ProjectManHours = known?.ManHours,
                    Hours = h.Where(x => !x.Volunteer).Sum(x => x.Hours),
                    VolunteerHours = h.Where(x => x.Volunteer).Sum(x => x.Hours),
                    Members = MemberCount(h),
                    Cash = Money(m, "cash"),
                    InKind = Money(m, "in_kind"),
                };
            })
            .OrderBy(p => p.ProjectId == null).ThenByDescending(p => p.Hours + p.VolunteerHours).ThenBy(p => p.Title)
            .ToList();
        r.ByMember = hours.Where(h => h.MemberId > 0).GroupBy(h => h.MemberId)
            .Select(g => new ServiceMemberReportRowDto
            {
                MemberId = g.Key,
                Name = g.Select(x => x.Name).FirstOrDefault(n => n.Length > 0) ?? "",
                Hours = g.Where(x => !x.Volunteer).Sum(x => x.Hours),
                VolunteerHours = g.Where(x => x.Volunteer).Sum(x => x.Hours),
                Entries = g.Sum(x => x.Entries),
            })
            .OrderByDescending(m => m.Hours + m.VolunteerHours).ThenBy(m => m.Name)
            .ToList();
        FillTotals(r.Totals, hours, money);
    }

    public static void FillDistrict(ServiceReportDto r, IReadOnlyList<HourFact> hours, IReadOnlyList<MoneyFact> money,
        IReadOnlyDictionary<int, string> clubNames)
    {
        r.ByClub = hours.Select(h => h.ClubId).Concat(money.Select(m => m.ClubId)).Distinct()
            .Select(c =>
            {
                var h = hours.Where(x => x.ClubId == c).ToList();
                var m = money.Where(x => x.ClubId == c).ToList();
                return new ServiceClubReportRowDto
                {
                    ClubId = c,
                    ClubName = clubNames.TryGetValue(c, out var n) ? n : $"Club {c}",
                    Hours = h.Where(x => !x.Volunteer).Sum(x => x.Hours),
                    VolunteerHours = h.Where(x => x.Volunteer).Sum(x => x.Hours),
                    Members = MemberCount(h),
                    Cash = Money(m, "cash"),
                    InKind = Money(m, "in_kind"),
                };
            })
            .OrderByDescending(c => c.Hours + c.VolunteerHours).ThenBy(c => c.ClubName)
            .ToList();
        FillTotals(r.Totals, hours, money);
    }

    private static void FillTotals(ServiceTotalsDto t, IReadOnlyList<HourFact> hours, IReadOnlyList<MoneyFact> money)
    {
        t.Hours = hours.Where(x => !x.Volunteer).Sum(x => x.Hours);
        t.VolunteerHours = hours.Where(x => x.Volunteer).Sum(x => x.Hours);
        t.Members = MemberCount(hours);
        t.Cash = Money(money, "cash");
        t.InKind = Money(money, "in_kind");
    }

    public static string MoneyText(List<MoneyDto> m) =>
        string.Join("; ", m.Select(x => (x.Currency.Length > 0 ? x.Currency + " " : "") + x.Amount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)));

    private static void Sheet(XLWorkbook wb, string name, string title, string[] headers, IEnumerable<object[]> rows)
    {
        var ws = wb.Worksheets.Add(name);
        ws.Cell(1, 1).Value = title;
        ws.Cell(1, 1).Style.Font.Bold = true;
        for (var i = 0; i < headers.Length; i++)
        {
            var cell = ws.Cell(3, i + 1);
            cell.Value = headers[i];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#17458F");
            cell.Style.Font.FontColor = XLColor.White;
        }
        var r = 4;
        foreach (var row in rows)
        {
            for (var i = 0; i < row.Length; i++)
                ws.Cell(r, i + 1).Value = row[i] switch
                {
                    decimal d => d,
                    int n => n,
                    DateTime dt => dt.ToString("dd-MM-yyyy"),
                    null => "",
                    var o => o.ToString(),
                };
            r++;
        }
        ws.Columns().AdjustToContents(1, Math.Min(r, 200));
    }

    /// <summary>The report as an Excel workbook: by project, by member and contributions for a club; by club for a
    /// district. Text cells are typed as text, so nothing a member typed becomes a formula.</summary>
    public static byte[] BuildExcel(ServiceReportDto r, IReadOnlyList<ContributionDto>? contributions)
    {
        using var wb = new XLWorkbook();
        var title = $"{r.ScopeName}, service report {r.YearLabel}";
        if (r.ByClub.Count > 0 || contributions == null)
            Sheet(wb, "By club", title, new[] { "Club", "Logged hours", "Volunteer sheet hours", "Members", "Cash", "In kind" },
                r.ByClub.Select(c => new object[] { c.ClubName, c.Hours, c.VolunteerHours, c.Members, MoneyText(c.Cash), MoneyText(c.InKind) }));
        if (contributions != null)
        {
            Sheet(wb, "By project", title, new[] { "Project", "Logged hours", "Volunteer sheet hours", "Man-hours on project", "Members", "Cash", "In kind" },
                r.ByProject.Select(p => new object[] { p.Title, p.Hours, p.VolunteerHours, (object?)p.ProjectManHours ?? "", p.Members, MoneyText(p.Cash), MoneyText(p.InKind) }));
            Sheet(wb, "By member", title, new[] { "Member", "Logged hours", "Volunteer sheet hours", "Entries" },
                r.ByMember.Select(m => new object[] { m.Name, m.Hours, m.VolunteerHours, m.Entries }));
            Sheet(wb, "Contributions", title, new[] { "Date", "Project", "Kind", "Currency", "Amount", "Contributor", "Description" },
                contributions.Select(c => new object[] { c.ContributionDate, c.ProjectTitle ?? "", c.Kind == "cash" ? "Cash" : "In kind", c.Currency ?? "", c.Amount, c.Contributor ?? "", c.Description ?? "" }));
        }
        var totals = wb.Worksheets.Add("Totals");
        string[][] lines =
        {
            new[] { "Logged hours (approved)", r.Totals.Hours.ToString(System.Globalization.CultureInfo.InvariantCulture) },
            new[] { "Volunteer sheet hours", r.Totals.VolunteerHours.ToString(System.Globalization.CultureInfo.InvariantCulture) },
            new[] { "Members who served", r.Totals.Members.ToString() },
            new[] { "Cash", MoneyText(r.Totals.Cash) },
            new[] { "In kind", MoneyText(r.Totals.InKind) },
        };
        totals.Cell(1, 1).Value = title;
        totals.Cell(1, 1).Style.Font.Bold = true;
        for (var i = 0; i < lines.Length; i++)
        {
            totals.Cell(i + 3, 1).Value = lines[i][0];
            totals.Cell(i + 3, 2).Value = lines[i][1];
        }
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}

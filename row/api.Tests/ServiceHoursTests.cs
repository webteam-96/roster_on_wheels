using ClosedXML.Excel;
using RotaryApi.DTOs;
using RotaryApi.Services;
using static RotaryApi.Services.ServiceHoursReport;

namespace RotaryApi.Tests;

/// <summary>Service hours: input rules, the report roll-up and the Excel export (ServiceHoursReport).</summary>
public class ServiceHoursTests
{
    private static readonly DateTime Today = new(2026, 11, 20);

    private static SaveServiceHoursDto Entry(decimal hours = 2.5m, int? project = 7, string? other = null, int daysAgo = 1) =>
        new() { ClubId = 341, ProjectId = project, OtherService = other, Hours = hours, ServiceDate = Today.AddDays(-daysAgo), Note = "  helped  " };

    [Fact]
    public void Valid_entry_is_trimmed_and_keeps_the_project()
    {
        var d = Validate(Entry(other: "ignored"), Today);
        Assert.Equal(7, d.ProjectId);
        Assert.Null(d.OtherService);
        Assert.Equal("helped", d.Note);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(24.5)]
    [InlineData(1.255)]
    public void Hours_out_of_range_or_too_precise_are_refused(double hours) =>
        Assert.Throws<InvalidOperationException>(() => Validate(Entry((decimal)hours), Today));

    [Fact]
    public void Future_and_very_old_dates_are_refused()
    {
        Assert.Throws<InvalidOperationException>(() => Validate(Entry(daysAgo: -2), Today));
        Assert.Throws<InvalidOperationException>(() => Validate(Entry(daysAgo: 800), Today));
        Validate(Entry(daysAgo: -1), Today); // a day ahead: members east of UTC
    }

    [Fact]
    public void Other_service_needs_a_description()
    {
        Assert.Throws<InvalidOperationException>(() => Validate(Entry(project: null), Today));
        var d = Validate(Entry(project: null, other: " Beach clean-up "), Today);
        Assert.Null(d.ProjectId);
        Assert.Equal("Beach clean-up", d.OtherService);
    }

    [Fact]
    public void Contribution_rules()
    {
        var ok = new SaveContributionDto { ProjectId = 1, YearId = 47, Kind = "CASH", Amount = 100.5m, ContributionDate = Today };
        Assert.Equal("cash", Validate(ok, Today).Kind);
        Assert.Throws<InvalidOperationException>(() => Validate(new SaveContributionDto { ProjectId = 1, YearId = 47, Kind = "in_kind", Amount = 5, ContributionDate = Today }, Today));
        Assert.Throws<InvalidOperationException>(() => Validate(new SaveContributionDto { ProjectId = 1, YearId = 47, Kind = "gift", Amount = 5, ContributionDate = Today }, Today));
        Assert.Throws<InvalidOperationException>(() => Validate(new SaveContributionDto { ProjectId = 1, YearId = 47, Kind = "cash", Amount = 0, ContributionDate = Today }, Today));
    }

    private static List<HourFact> Hours() =>
    [
        new(341, 1, "Asha", 7, 3m, false, 2),
        new(341, 1, "Asha", null, 1m, false, 1),
        new(341, 2, "Ben", 7, 2m, true),
        new(341, 0, "Guest", 7, 4m, true),          // non-member volunteer: project hours, not a member
        new(342, 3, "Cara", 9, 5m, false, 1),
    ];

    private static List<MoneyFact> Money() =>
    [
        new(341, 7, "cash", "LKR", 1000m),
        new(341, 7, "cash", "LKR", 500m),
        new(341, 8, "in_kind", "LKR", 200m),
        new(342, 9, "cash", "USD", 50m),
    ];

    [Fact]
    public void Club_report_rolls_up_by_project_and_member()
    {
        var r = new ServiceReportDto();
        FillClub(r, Hours().Where(h => h.ClubId == 341).ToList(), Money().Where(m => m.ClubId == 341).ToList(),
            new Dictionary<int, (string, int?)> { [7] = ("Water", 40) });

        var water = r.ByProject.Single(p => p.ProjectId == 7);
        Assert.Equal(3m, water.Hours);
        Assert.Equal(6m, water.VolunteerHours);
        Assert.Equal(2, water.Members);
        Assert.Equal(40, water.ProjectManHours);
        Assert.Equal(1500m, water.Cash.Single().Amount);
        Assert.Equal("Project 8", r.ByProject.Single(p => p.ProjectId == 8).Title);  // money only, title unknown
        Assert.Equal("Other service", r.ByProject.Last().Title);                     // no project: last
        Assert.Equal(["Asha", "Ben"], r.ByMember.Select(m => m.Name));
        Assert.Equal(3, r.ByMember[0].Entries);
        Assert.Equal(4m, r.Totals.Hours);
        Assert.Equal(6m, r.Totals.VolunteerHours);
        Assert.Equal(2, r.Totals.Members);
        Assert.Equal(200m, r.Totals.InKind.Single().Amount);
    }

    [Fact]
    public void District_report_keeps_currencies_apart()
    {
        var r = new ServiceReportDto();
        FillDistrict(r, Hours(), Money(), new Dictionary<int, string> { [341] = "Colombo West" });
        Assert.Equal(2, r.ByClub.Count);
        Assert.Equal("Colombo West", r.ByClub[0].ClubName);
        Assert.Equal("Club 342", r.ByClub[1].ClubName);
        Assert.Equal(3, r.Totals.Members);
        Assert.Equal(["LKR", "USD"], r.Totals.Cash.Select(m => m.Currency));
        Assert.Equal("LKR 1500.00; USD 50.00", MoneyText(r.Totals.Cash));
    }

    [Fact]
    public void Excel_has_club_sheets_and_keeps_formula_text_as_text()
    {
        var r = new ServiceReportDto { ScopeName = "Colombo West", YearLabel = "2026-27" };
        FillClub(r, Hours().Where(h => h.ClubId == 341).ToList(), new List<MoneyFact>(), new Dictionary<int, (string, int?)> { [7] = ("=HYPERLINK(\"x\")", null) });
        var bytes = BuildExcel(r, new List<ContributionDto>());

        using var wb = new XLWorkbook(new MemoryStream(bytes));
        Assert.Equal(["By project", "By member", "Contributions", "Totals"], wb.Worksheets.Select(w => w.Name));
        var cell = wb.Worksheet("By project").Cell(4, 1);
        Assert.False(cell.HasFormula);
        Assert.Equal("=HYPERLINK(\"x\")", cell.GetString());
    }
}

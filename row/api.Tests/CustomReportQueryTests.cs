using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class CustomReportQueryTests
{
    private static CustomReportDefinition Members(params string[] cols) => new() { Source = "members", Columns = cols.ToList() };

    [Fact]
    public void Rejects_unknown_source_column_and_operator()
    {
        Assert.NotNull(CustomReportQuery.Validate(new CustomReportDefinition { Source = "users", Columns = { "name" } }));
        Assert.NotNull(CustomReportQuery.Validate(Members("name", "PasswordHash")));
        Assert.NotNull(CustomReportQuery.Validate(Members("name; DROP TABLE x")));
        var d = Members("name");
        d.Filters.Add(new CustomReportFilter { Field = "name", Op = "like", Value = "a" });
        Assert.NotNull(CustomReportQuery.Validate(d));
        Assert.Null(CustomReportQuery.Validate(Members("name", "email")));
    }

    [Fact]
    public void Checks_filter_values_against_field_types()
    {
        CustomReportDefinition With(string field, string op, string? value)
        {
            var d = Members("name");
            d.Filters.Add(new CustomReportFilter { Field = field, Op = op, Value = value });
            return d;
        }
        Assert.NotNull(CustomReportQuery.Validate(With("yearsInClub", "gt", "ten")));
        Assert.NotNull(CustomReportQuery.Validate(With("joinedDate", "lt", "01/02/2020")));
        Assert.NotNull(CustomReportQuery.Validate(With("yearsInClub", "contains", "1")));
        Assert.NotNull(CustomReportQuery.Validate(With("name", "gt", "a")));
        Assert.NotNull(CustomReportQuery.Validate(With("name", "eq", "")));
        Assert.Null(CustomReportQuery.Validate(With("joinedDate", "gte", "2020-07-01")));
        Assert.Null(CustomReportQuery.Validate(With("active", "eq", "true")));
        Assert.Null(CustomReportQuery.Validate(With("email", "empty", null)));
    }

    [Fact]
    public void Values_are_parameters_and_never_in_the_sql()
    {
        var d = Members("name");
        d.Filters.Add(new CustomReportFilter { Field = "name", Op = "contains", Value = "x' OR 1=1 -- 50%" });
        var (sql, args, _) = CustomReportQuery.Build(d, new[] { 341 }, 0, null);
        Assert.DoesNotContain("OR 1=1", sql);
        Assert.Contains("LIKE CONCAT('%', @f0, '%')", sql);
        Assert.Contains("cm.fk_club_id IN @Clubs", sql);
        Assert.Equal("x' OR 1=1 -- 50\\%", args.Get<object>("f0"));
        Assert.Equal(new[] { 341 }, args.Get<int[]>("Clubs"));
    }

    [Fact]
    public void Group_by_returns_count_and_sums()
    {
        var d = new CustomReportDefinition { Source = "projects", GroupBy = "type", SumFields = { "cost", "manHours" }, SortBy = "count", SortDesc = true };
        var (sql, _, cols) = CustomReportQuery.Build(d, new[] { 1 }, 0, "rotary_projects_2026_27");
        Assert.Equal(new[] { "type", "count", "sum_cost", "sum_manHours" }, cols.Select(c => c.Key));
        Assert.Contains("FROM `rotary_projects_2026_27` p", sql);
        Assert.Contains("GROUP BY c0 ORDER BY c1 DESC", sql);
        // only number fields can be summed
        Assert.NotNull(CustomReportQuery.Validate(new CustomReportDefinition { Source = "projects", GroupBy = "type", SumFields = { "title" } }));
    }

    [Fact]
    public void Projects_need_a_real_year_table_and_empty_scope_matches_nothing()
    {
        var d = new CustomReportDefinition { Source = "projects", Columns = { "title" } };
        Assert.Throws<ArgumentException>(() => CustomReportQuery.Build(d, new[] { 1 }, 0, "users; --"));
        var (_, args, _) = CustomReportQuery.Build(Members("name"), Array.Empty<int>(), 0, null);
        Assert.Equal(new[] { 0 }, args.Get<int[]>("Clubs"));
    }

    [Fact]
    public void Csv_escapes_quotes_and_neutralises_formulas()
    {
        var r = new CustomReportResult
        {
            Columns = { new("name", "Name", "text"), new("active", "Active", "bool"), new("n", "N", "number") },
            Rows = { new object?[] { "=HYPERLINK(\"x\")", 1L, -5m }, new object?[] { "A, B", 0L, null } },
        };
        var lines = CustomReportService.Csv(r).TrimEnd().Split(Environment.NewLine);
        Assert.Equal("Name,Active,N", lines[0]);
        Assert.Equal("\"'=HYPERLINK(\"\"x\"\")\",Yes,-5", lines[1]);
        Assert.Equal("\"A, B\",No,", lines[2]);
    }

    [Fact]
    public void Save_checks_name_day_and_format()
    {
        var ok = new SaveCustomReportDto { Name = "Members", Definition = Members("name"), ScheduleDay = 5, ScheduleFormat = "pdf" };
        Assert.Null(CustomReportService.ValidateSave(ok));
        Assert.NotNull(CustomReportService.ValidateSave(new SaveCustomReportDto { Name = " ", Definition = Members("name") }));
        Assert.NotNull(CustomReportService.ValidateSave(new SaveCustomReportDto { Name = "x", Definition = Members("name"), ScheduleDay = 31 }));
        Assert.NotNull(CustomReportService.ValidateSave(new SaveCustomReportDto { Name = "x", Definition = Members("name"), ScheduleFormat = "exe" }));
        Assert.Equal("club-members-2026", CustomReportService.FileName("Club members / 2026"));
    }
}

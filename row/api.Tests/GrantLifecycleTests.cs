using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

// Grants lifecycle (2026-11-19): budget total rules, report variance and the allowed transitions (GrantService).
public class GrantLifecycleTests
{
    private static GrantLineDto L(string kind, decimal? amount) => new() { Kind = kind, Description = "x", Amount = amount };

    private static readonly List<GrantLineDto> Budget = new()
    {
        L("expense", 3000m), L("expense", 1000.50m), L("income", 500m), L("partner", null),
    };

    [Fact]
    public void Budget_total_is_expenses_minus_other_income_and_ignores_partners()
    {
        Assert.Equal(3500.50m, GrantService.BudgetTotal(Budget));
        Assert.Equal(0m, GrantService.BudgetTotal(new List<GrantLineDto>()));
    }

    [Fact]
    public void First_submit_needs_the_request_to_equal_the_budget_total()
    {
        Assert.Null(GrantService.BudgetProblem(3500.50m, Budget, exact: true));
        Assert.Contains("must equal", GrantService.BudgetProblem(3500m, Budget, exact: true));
        Assert.Contains("must equal", GrantService.BudgetProblem(3600m, Budget, exact: true));
    }

    [Fact]
    public void Resubmit_after_adjustment_may_ask_for_less_but_never_more()
    {
        Assert.Null(GrantService.BudgetProblem(2000m, Budget, exact: false));
        Assert.Contains("cannot be more", GrantService.BudgetProblem(3600m, Budget, exact: false));
    }

    [Fact]
    public void A_budget_without_expenses_is_refused()
    {
        Assert.Contains("expenses", GrantService.BudgetProblem(0m, new List<GrantLineDto> { L("income", 100m) }, exact: true));
        Assert.Contains("expenses", GrantService.BudgetProblem(0m, new List<GrantLineDto> { L("expense", 0m) }, exact: true));
    }

    [Fact]
    public void Variance_is_actual_minus_budget_and_null_until_reported()
    {
        Assert.Equal(250m, GrantService.Variance(3000m, 3250m));
        Assert.Equal(-400.25m, GrantService.Variance(1000.50m, 600.25m));
        Assert.Equal(0m, GrantService.Variance(500m, 500m));
        Assert.Equal(75m, GrantService.Variance(null, 75m));
        Assert.Null(GrantService.Variance(3000m, null));
    }

    [Theory]
    [InlineData("club", "draft", "submit")]
    [InlineData("district", "submitted", "approve")]
    [InlineData("club", "paid", "submit_report")]
    [InlineData("district", "report_submitted", "accept_report")]
    [InlineData("district", "report_submitted", "return_report")]
    [InlineData("district", "report_accepted", "close")]
    [InlineData("district", "report_submitted", "close")] // grants from before the acceptance step
    public void Allowed_transitions(string side, string from, string action) =>
        Assert.True(GrantService.CanTransition(side, from, action));

    [Theory]
    [InlineData("club", "submitted", "approve")]          // a club cannot approve
    [InlineData("club", "report_submitted", "accept_report")]
    [InlineData("district", "paid", "close")]             // no close before the final report
    [InlineData("district", "approved", "accept_report")]
    [InlineData("district", "report_accepted", "return_report")]
    [InlineData("district", "closed", "approve")]
    [InlineData("club", "report_accepted", "submit_report")]
    public void Refused_transitions(string side, string from, string action) =>
        Assert.False(GrantService.CanTransition(side, from, action));

    [Fact]
    public void Club_file_kinds_follow_the_status()
    {
        Assert.Equal(new[] { "application" }, GrantService.AttachmentKinds("draft"));
        Assert.Equal(new[] { "interim", "receipt" }, GrantService.AttachmentKinds("approved"));
        Assert.Contains("report", GrantService.AttachmentKinds("paid"));
        Assert.Empty(GrantService.AttachmentKinds("closed"));
        Assert.Empty(GrantService.AttachmentKinds("report_accepted"));
    }

    [Fact]
    public void Reminder_stage_is_due_soon_within_seven_days_and_overdue_after()
    {
        var today = new DateTime(2026, 11, 19);
        Assert.Null(GrantService.ReminderStage(null, today));
        Assert.Null(GrantService.ReminderStage(today.AddDays(8), today));
        Assert.Equal("due_soon", GrantService.ReminderStage(today.AddDays(7), today));
        Assert.Equal("due_soon", GrantService.ReminderStage(today, today));
        Assert.Equal("overdue", GrantService.ReminderStage(today.AddDays(-1), today));
    }

    [Fact]
    public void Club_is_qualified_only_with_mou_and_training_and_not_expired()
    {
        var today = new DateTime(2026, 11, 20);
        Assert.Contains("MOU", GrantService.QualificationProblem(null, today, null, today));
        Assert.Contains("training", GrantService.QualificationProblem(today, null, null, today));
        Assert.Contains("expired", GrantService.QualificationProblem(today, today, today.AddDays(-1), today));
        Assert.Null(GrantService.QualificationProblem(today, today, today, today));
        Assert.Null(GrantService.QualificationProblem(today, today, null, today));
    }

    [Fact]
    public void Monthly_cash_flow_sorts_months_and_runs_the_balance()
    {
        var rows = GrantService.BuildMonths(
            new[] { ("2026-08", 2000m) },
            new[] { ("2026-09", 1500m), ("2026-10", 500m) },
            new[] { ("2026-07", 5000m), ("2026-10", 100m) });
        Assert.Equal(new[] { "2026-07", "2026-08", "2026-09", "2026-10" }, rows.Select(r => r.Month));
        Assert.Equal(new[] { 5000m, 5000m, 3500m, 3100m }, rows.Select(r => r.Balance));
        Assert.Equal(2000m, rows[1].Approved);
    }

    [Fact]
    public void Email_template_rejects_unknown_placeholders_and_encodes_values()
    {
        Assert.Null(GrantService.TemplateProblem("Hi {{recipient}}, {{ club }} {{link}}"));
        Assert.Contains("{{amount}}", GrantService.TemplateProblem("Pay {{amount}}"));
        var r = GrantService.RenderTemplate("Re: {{application}}\nx", "<b>{{club}}</b>\n{{details}}",
            new Dictionary<string, string?> { ["application"] = "Well", ["club"] = "A & B <x>", ["details"] = null });
        Assert.Equal("Re: Well x", r.Subject);
        Assert.Contains("&lt;b&gt;A &amp; B &lt;x&gt;&lt;/b&gt;<br>", r.Html);
    }

    [Fact]
    public void Qualification_blocks_only_when_the_district_requires_it()
    {
        Assert.Null(GrantService.QualificationBlock(required: false, problem: "Not qualified."));
        Assert.Null(GrantService.QualificationBlock(required: true, problem: null));
        Assert.StartsWith("Not qualified.", GrantService.QualificationBlock(required: true, problem: "Not qualified."));
    }
}

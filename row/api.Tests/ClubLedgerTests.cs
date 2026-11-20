using RotaryApi.Services;
using static RotaryApi.Services.ClubLedger;

namespace RotaryApi.Tests;

public class ClubLedgerTests
{
    private static AccountTotal T(int id, string type, decimal dr, decimal cr) => new(id, id.ToString(), "A" + id, type, dr, cr);

    [Fact]
    public void Balanced_entry_is_valid()
    {
        Assert.Null(Validate(new[] { new Line(1, 100.10m, 0), new Line(2, 0, 60.05m), new Line(3, 0, 40.05m) }));
    }

    [Theory]
    [InlineData(100, 0, 0, 99.99, "must be equal")]
    [InlineData(100, 100, 0, 0, "either a debit or a credit")]
    [InlineData(0, 0, 0, 0, "either a debit or a credit")]
    [InlineData(-5, 0, 0, -5, "negative")]
    [InlineData(10.001, 0, 0, 10.001, "two decimals")]
    public void Bad_entries_are_refused(double d1, double c1, double d2, double c2, string reason)
    {
        var err = Validate(new[] { new Line(1, (decimal)d1, (decimal)c1), new Line(2, (decimal)d2, (decimal)c2) });
        Assert.NotNull(err);
        Assert.Contains(reason, err);
    }

    [Fact]
    public void Needs_two_lines_and_two_accounts()
    {
        Assert.Contains("two lines", Validate(new[] { new Line(1, 5, 0) }));
        Assert.Contains("two accounts", Validate(new[] { new Line(1, 5, 0), new Line(1, 0, 5) }));
    }

    [Fact]
    public void Decimal_sums_do_not_drift()
    {
        // 0.1 + 0.2 in binary floating point is not 0.3; in decimal it is
        Assert.Null(Validate(new[] { new Line(1, 0.10m, 0), new Line(1, 0.20m, 0), new Line(2, 0, 0.30m) }));
    }

    [Fact]
    public void Reversal_swaps_sides_and_cancels_out()
    {
        var lines = new[] { new Line(1, 250m, 0, "x"), new Line(2, 0, 250m) };
        var rev = Reverse(lines);
        Assert.Null(Validate(rev));
        Assert.Equal(0m, lines.Concat(rev).Where(l => l.AccountId == 1).Sum(l => l.Debit - l.Credit));
        Assert.Equal("x", rev[0].Description);
        Assert.Equal(250m, rev[0].Credit);
    }

    [Fact]
    public void Quick_entry_money_in_debits_bank_money_out_credits_bank()
    {
        var inn = Simple(true, categoryAccountId: 40, bankAccountId: 10, 75.50m, null);
        Assert.Equal(75.50m, inn.Single(l => l.AccountId == 10).Debit);
        Assert.Equal(75.50m, inn.Single(l => l.AccountId == 40).Credit);
        var outt = Simple(false, 50, 10, 20m, null);
        Assert.Equal(20m, outt.Single(l => l.AccountId == 10).Credit);
        Assert.Equal(20m, outt.Single(l => l.AccountId == 50).Debit);
    }

    [Fact]
    public void Profit_and_loss_totals()
    {
        var pl = BuildProfitAndLoss(new[]
        {
            T(1, Asset, 1000, 300), T(4, Income, 0, 1000), T(41, Income, 10, 210.25m), T(5, Expense, 300, 0), T(6, Expense, 0, 0),
        });
        Assert.Equal(1200.25m, pl.TotalIncome);
        Assert.Equal(300m, pl.TotalExpenses);
        Assert.Equal(900.25m, pl.Net);
        Assert.Single(pl.Expenses); // zero-balance accounts are left out
    }

    [Fact]
    public void Balance_sheet_balances_with_earnings_to_date()
    {
        // opening funds 500 into bank; dues 1000 in; 300 spent; 200 owed to a supplier for a 200 expense
        var bs = BuildBalanceSheet(new[]
        {
            T(1, Asset, 1500, 300), T(2, Liability, 0, 200), T(3, Equity, 0, 500), T(4, Income, 0, 1000), T(5, Expense, 500, 0),
        });
        Assert.Equal(1200m, bs.TotalAssets);
        Assert.Equal(200m, bs.TotalLiabilities);
        Assert.Equal(500m, bs.CurrentEarnings);
        Assert.Equal(1000m, bs.TotalEquity);
        Assert.True(bs.Balanced);
    }

    [Fact]
    public void Budget_variance_is_positive_when_good()
    {
        var r = BuildBudgetVsActual(
            new[] { T(4, Income, 0, 1200), T(5, Expense, 900, 0), T(6, Expense, 0, 0), T(1, Asset, 50, 0) },
            new Dictionary<int, decimal> { [4] = 1000, [5] = 800, [6] = 0 });
        var inc = r.Lines.Single(l => l.AccountId == 4);
        var exp = r.Lines.Single(l => l.AccountId == 5);
        Assert.Equal(200m, inc.Variance);   // more income than planned
        Assert.Equal(-100m, exp.Variance);  // overspent
        Assert.Equal(112.5m, exp.PercentUsed);
        Assert.DoesNotContain(r.Lines, l => l.AccountId is 1 or 6); // assets and empty lines left out
        Assert.Equal(1000m, r.BudgetIncome);
        Assert.Equal(900m, r.ActualExpenses);
    }

    [Fact]
    public void Starter_chart_is_well_formed()
    {
        Assert.Equal(StarterChart.Length, StarterChart.Select(a => a.Code).Distinct().Count());
        Assert.All(StarterChart, a => Assert.Contains(a.Type, Types));
        Assert.Contains(StarterChart, a => a.Key == "bank" && a.IsBank && a.Type == Asset);
        Assert.Contains(StarterChart, a => a.Key == "dues_income" && a.Type == Income);
        var keys = StarterChart.Where(a => a.Key != null).Select(a => a.Key).ToList();
        Assert.Equal(keys.Count, keys.Distinct().Count());
    }

    [Fact]
    public void Csv_export_keeps_numbers_and_defuses_formulas()
    {
        var csv = ClubAccountsExport.Csv(new("t", "s", new[] { "A", "B" },
            new() { new object?[] { "=SUM(A1)", -12.5m }, new object?[] { "Total", null } }));
        Assert.Contains("\"'=SUM(A1)\",-12.50", csv);
        Assert.Contains("\"Total\",\r\n", csv);
    }
}

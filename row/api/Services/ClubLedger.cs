namespace RotaryApi.Services;

/// <summary>
/// Club accounts: the double-entry rules and report maths, with no database (ClubAccountsService does the SQL).
/// All money is decimal with two places. Asset and expense accounts carry a debit balance, the rest a credit balance.
/// </summary>
public static class ClubLedger
{
    public const string Asset = "asset", Liability = "liability", Equity = "equity", Income = "income", Expense = "expense";
    public static readonly string[] Types = { Asset, Liability, Equity, Income, Expense };
    public const decimal MaxAmount = 999_999_999_999.99m; // DECIMAL(14,2)

    public record Line(int AccountId, decimal Debit, decimal Credit, string? Description = null);

    /// <summary>Null when the lines make a valid entry, else the reason in plain words.</summary>
    public static string? Validate(IReadOnlyList<Line> lines)
    {
        if (lines.Count < 2) return "An entry needs at least two lines.";
        if (lines.Count > 200) return "An entry can have at most 200 lines.";
        foreach (var l in lines)
        {
            if (l.Debit < 0 || l.Credit < 0) return "Amounts cannot be negative.";
            if ((l.Debit > 0) == (l.Credit > 0)) return "Each line is either a debit or a credit, not both or neither.";
            if (decimal.Round(l.Debit, 2) != l.Debit || decimal.Round(l.Credit, 2) != l.Credit) return "Amounts can have at most two decimals.";
            if (l.Debit > MaxAmount || l.Credit > MaxAmount) return "An amount is too large.";
            if (l.Description?.Length > 255) return "A line description can be at most 255 characters.";
        }
        decimal debits = lines.Sum(l => l.Debit), credits = lines.Sum(l => l.Credit);
        if (debits != credits) return $"Debits ({debits:0.00}) and credits ({credits:0.00}) must be equal.";
        if (lines.Select(l => l.AccountId).Distinct().Count() < 2) return "An entry must use at least two accounts.";
        return null;
    }

    /// <summary>The lines that cancel an entry: every debit becomes a credit and the other way round.</summary>
    public static List<Line> Reverse(IEnumerable<Line> lines) =>
        lines.Select(l => l with { Debit = l.Credit, Credit = l.Debit }).ToList();

    /// <summary>A treasurer's quick entry: money in debits the bank and credits the income account; money out the reverse.</summary>
    public static List<Line> Simple(bool moneyIn, int categoryAccountId, int bankAccountId, decimal amount, string? memo) =>
        moneyIn
            ? new() { new(bankAccountId, amount, 0, memo), new(categoryAccountId, 0, amount, memo) }
            : new() { new(categoryAccountId, amount, 0, memo), new(bankAccountId, 0, amount, memo) };

    public static bool DebitNormal(string type) => type is Asset or Expense;

    public static decimal Balance(string type, decimal debits, decimal credits) =>
        DebitNormal(type) ? debits - credits : credits - debits;

    public record AccountTotal(int AccountId, string Code, string Name, string Type, decimal Debits, decimal Credits)
    {
        public decimal Balance => ClubLedger.Balance(Type, Debits, Credits);
    }

    public record ReportLine(int AccountId, string Code, string Name, decimal Amount);

    public record ProfitAndLoss(List<ReportLine> Income, List<ReportLine> Expenses, decimal TotalIncome, decimal TotalExpenses, decimal Net);

    public static ProfitAndLoss BuildProfitAndLoss(IEnumerable<AccountTotal> totals)
    {
        var list = totals.ToList();
        var income = Lines(list, Income);
        var expenses = Lines(list, Expense);
        decimal ti = income.Sum(l => l.Amount), te = expenses.Sum(l => l.Amount);
        return new(income, expenses, ti, te, ti - te);
    }

    /// <summary>Equity includes the earnings to date (income less expenses ever posted): the club has no year-end close.</summary>
    public record BalanceSheet(List<ReportLine> Assets, List<ReportLine> Liabilities, List<ReportLine> Equity,
        decimal TotalAssets, decimal TotalLiabilities, decimal CurrentEarnings, decimal TotalEquity, bool Balanced);

    public static BalanceSheet BuildBalanceSheet(IEnumerable<AccountTotal> totals)
    {
        var list = totals.ToList();
        var assets = Lines(list, Asset);
        var liabilities = Lines(list, Liability);
        var equity = Lines(list, Equity);
        var earnings = list.Where(t => t.Type == Income).Sum(t => t.Balance) - list.Where(t => t.Type == Expense).Sum(t => t.Balance);
        decimal ta = assets.Sum(l => l.Amount), tl = liabilities.Sum(l => l.Amount), teq = equity.Sum(l => l.Amount) + earnings;
        return new(assets, liabilities, equity, ta, tl, earnings, teq, ta == tl + teq);
    }

    /// <summary>Variance is positive when it is good for the club: income above budget, spending below it.</summary>
    public record BudgetLine(int AccountId, string Code, string Name, string Type, decimal Budget, decimal Actual, decimal Variance, decimal? PercentUsed);

    public record BudgetReport(List<BudgetLine> Lines, decimal BudgetIncome, decimal ActualIncome, decimal BudgetExpenses, decimal ActualExpenses);

    public static BudgetReport BuildBudgetVsActual(IEnumerable<AccountTotal> actuals, IReadOnlyDictionary<int, decimal> budgets)
    {
        var lines = actuals
            .Where(a => a.Type is Income or Expense)
            .Select(a =>
            {
                var budget = budgets.TryGetValue(a.AccountId, out var b) ? b : 0m;
                var actual = a.Balance;
                var variance = a.Type == Income ? actual - budget : budget - actual;
                decimal? pct = budget == 0 ? null : decimal.Round(actual / budget * 100m, 1);
                return new BudgetLine(a.AccountId, a.Code, a.Name, a.Type, budget, actual, variance, pct);
            })
            .Where(l => l.Budget != 0 || l.Actual != 0)
            .OrderBy(l => l.Type == Income ? 0 : 1).ThenBy(l => l.Code, StringComparer.Ordinal)
            .ToList();
        return new(lines,
            lines.Where(l => l.Type == Income).Sum(l => l.Budget), lines.Where(l => l.Type == Income).Sum(l => l.Actual),
            lines.Where(l => l.Type == Expense).Sum(l => l.Budget), lines.Where(l => l.Type == Expense).Sum(l => l.Actual));
    }

    private static List<ReportLine> Lines(List<AccountTotal> list, string type) =>
        list.Where(t => t.Type == type && t.Balance != 0)
            .OrderBy(t => t.Code, StringComparer.Ordinal)
            .Select(t => new ReportLine(t.AccountId, t.Code, t.Name, t.Balance))
            .ToList();

    /// <summary>The starter chart every club gets on first use. Key = how code finds the account (dues posting, default bank).</summary>
    public static readonly (string Code, string Name, string Type, string? Key, bool IsBank)[] StarterChart =
    {
        ("1000", "Bank account", Asset, "bank", true),
        ("1010", "Cash on hand", Asset, "cash", false),
        ("1200", "Money owed to the club", Asset, "receivable", false),
        ("2000", "Bills to pay", Liability, "payable", false),
        ("2100", "Dues paid in advance", Liability, null, false),
        ("3000", "Club funds", Equity, "funds", false),
        ("4000", "Membership dues", Income, "dues_income", false),
        ("4100", "Donations received", Income, "donations_income", false),
        ("4200", "Meals and event income", Income, "event_income", false),
        ("4300", "Fundraising income", Income, null, false),
        ("4900", "Other income", Income, "other_income", false),
        ("5000", "District and RI dues", Expense, null, false),
        ("5100", "Meals and meetings", Expense, null, false),
        ("5200", "Service projects", Expense, null, false),
        ("5300", "Rotary Foundation giving", Expense, null, false),
        ("5400", "Bank charges", Expense, null, false),
        ("5500", "Printing and supplies", Expense, null, false),
        ("5900", "Other expenses", Expense, null, false),
    };
}

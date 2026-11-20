using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Club accounts (gap agent 2026-11-19, Services/ClubAccountsService.cs). Every route, reads included, needs someone
/// who manages the club (club Admin, the district's all-clubs Admin, SuperAdmin): ScopeWriteGuardMiddleware lets any
/// member read club routes, and the club's books are for its officers only.
/// </summary>
[ApiController]
[Authorize]
[Route("api/clubs/{clubId:int}/accounts")]
public class ClubAccountsController : ControllerBase
{
    private readonly ClubAccountsService _accounts;
    private readonly string _connectionString;

    public ClubAccountsController(ClubAccountsService accounts, IConfiguration configuration)
    {
        _accounts = accounts;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int clubId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, true, clubId);

    private ObjectResult NotClubAdmin() => StatusCode(403, new { message = "Only the club's admins can see and keep its accounts." });

    /// <summary>Runs the action; input the club must fix becomes a 400 with the reason.</summary>
    private async Task<IActionResult> Run(int clubId, Func<Task<IActionResult>> action)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        try { return await action(); }
        catch (ClubAccountsService.AccountsException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("summary")]
    public Task<IActionResult> Summary(int clubId) => Run(clubId, async () => Ok(await _accounts.SummaryAsync(clubId)));

    [HttpGet]
    public Task<IActionResult> Accounts(int clubId, [FromQuery] DateTime? asOf) =>
        Run(clubId, async () => Ok(await _accounts.ListAccountsAsync(clubId, asOf)));

    [HttpPost("chart")]
    public Task<IActionResult> CreateAccount(int clubId, [FromBody] SaveClubAccountDto dto) =>
        Run(clubId, async () => Ok(await _accounts.SaveAccountAsync(clubId, null, dto, MemberId, HttpContext)));

    [HttpPut("chart/{accountId:int}")]
    public Task<IActionResult> UpdateAccount(int clubId, int accountId, [FromBody] SaveClubAccountDto dto) => Run(clubId, async () =>
    {
        var a = await _accounts.SaveAccountAsync(clubId, accountId, dto, MemberId, HttpContext);
        return a == null ? NotFound(new { message = "Account not found." }) : Ok(a);
    });

    [HttpGet("journal")]
    public Task<IActionResult> Journal(int clubId, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int? accountId) =>
        Run(clubId, async () => Ok(await _accounts.ListEntriesAsync(clubId, from, to, accountId)));

    [HttpGet("journal/{entryId:int}")]
    public Task<IActionResult> Entry(int clubId, int entryId) => Run(clubId, async () =>
    {
        var e = await _accounts.GetEntryAsync(clubId, entryId);
        return e == null ? NotFound(new { message = "Entry not found." }) : Ok(e);
    });

    [HttpPost("journal")]
    public Task<IActionResult> CreateEntry(int clubId, [FromBody] CreateJournalEntryDto dto) =>
        Run(clubId, async () => Ok(await _accounts.CreateEntryAsync(clubId, dto, MemberId, HttpContext)));

    [HttpPost("journal/quick")]
    public Task<IActionResult> QuickEntry(int clubId, [FromBody] QuickEntryDto dto) =>
        Run(clubId, async () => Ok(await _accounts.QuickEntryAsync(clubId, dto, MemberId, HttpContext)));

    [HttpPost("journal/{entryId:int}/reverse")]
    public Task<IActionResult> Reverse(int clubId, int entryId, [FromBody] ReverseEntryDto dto) => Run(clubId, async () =>
    {
        var e = await _accounts.ReverseEntryAsync(clubId, entryId, dto, MemberId, HttpContext);
        return e == null ? NotFound(new { message = "Entry not found." }) : Ok(e);
    });

    [HttpGet("reports/profit-loss")]
    public Task<IActionResult> ProfitLoss(int clubId, [FromQuery] DateTime from, [FromQuery] DateTime to) =>
        Run(clubId, async () => Ok(await _accounts.ProfitAndLossAsync(clubId, from, to)));

    [HttpGet("reports/balance-sheet")]
    public Task<IActionResult> BalanceSheet(int clubId, [FromQuery] DateTime? asOf) =>
        Run(clubId, async () => Ok(await _accounts.BalanceSheetAsync(clubId, asOf ?? DateTime.UtcNow)));

    [HttpGet("reports/budget")]
    public Task<IActionResult> Budget(int clubId, [FromQuery] int yearId) => Run(clubId, async () =>
    {
        var r = await _accounts.BudgetVsActualAsync(clubId, yearId);
        return r == null ? NotFound(new { message = "Rotary year not found." }) : Ok(new { year = r.Value.Year, report = r.Value.Report });
    });

    [HttpPut("budget/{yearId:int}")]
    public Task<IActionResult> SaveBudget(int clubId, int yearId, [FromBody] SaveBudgetDto dto) => Run(clubId, async () =>
        await _accounts.SaveBudgetAsync(clubId, yearId, dto, MemberId, HttpContext) ? NoContent() : NotFound(new { message = "Rotary year not found." }));

    // ===== Vendors / payees =====

    [HttpGet("vendors")]
    public Task<IActionResult> Vendors(int clubId) => Run(clubId, async () => Ok(await _accounts.ListVendorsAsync(clubId)));

    [HttpPost("vendors")]
    public Task<IActionResult> CreateVendor(int clubId, [FromBody] SaveVendorDto dto) =>
        Run(clubId, async () => Ok(await _accounts.SaveVendorAsync(clubId, null, dto, MemberId, HttpContext)));

    [HttpPut("vendors/{vendorId:int}")]
    public Task<IActionResult> UpdateVendor(int clubId, int vendorId, [FromBody] SaveVendorDto dto) => Run(clubId, async () =>
    {
        var v = await _accounts.SaveVendorAsync(clubId, vendorId, dto, MemberId, HttpContext);
        return v == null ? NotFound(new { message = "Payee not found." }) : Ok(v);
    });

    // ===== Bank reconciliation =====

    [HttpGet("reconciliation/{accountId:int}")]
    public Task<IActionResult> Reconciliation(int clubId, int accountId) =>
        Run(clubId, async () => Ok(await _accounts.ReconciliationAsync(clubId, accountId)));

    [HttpPost("reconciliation/{accountId:int}/lines")]
    public Task<IActionResult> AddStatementLines(int clubId, int accountId, [FromBody] AddStatementLinesDto dto) =>
        Run(clubId, async () => Ok(new ImportResultDto(await _accounts.AddStatementLinesAsync(clubId, accountId, dto.Lines ?? new(), MemberId, HttpContext), new())));

    /// <summary>CSV of date, description, amount (money in positive, out negative).</summary>
    [HttpPost("reconciliation/{accountId:int}/import")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public Task<IActionResult> ImportStatement(int clubId, int accountId, IFormFile file) => Run(clubId, async () =>
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "Choose a CSV file." });
        if (!Path.GetExtension(file.FileName).Equals(".csv", StringComparison.OrdinalIgnoreCase) && !Path.GetExtension(file.FileName).Equals(".txt", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "The statement must be a .csv file." });
        using var reader = new StreamReader(file.OpenReadStream());
        var r = await _accounts.ImportStatementCsvAsync(clubId, accountId, await reader.ReadToEndAsync(), MemberId, HttpContext);
        return r.Added == 0 ? BadRequest(new { message = "No line of the file could be read.", problems = r.Problems }) : Ok(r);
    });

    [HttpPost("reconciliation/{accountId:int}/auto-match")]
    public Task<IActionResult> AutoMatch(int clubId, int accountId) =>
        Run(clubId, async () => Ok(new { matched = await _accounts.AutoMatchAsync(clubId, accountId, MemberId) }));

    [HttpPost("statement-lines/{lineId:int}/match")]
    public Task<IActionResult> Match(int clubId, int lineId, [FromBody] MatchStatementDto dto) => Run(clubId, async () =>
        await _accounts.MatchAsync(clubId, lineId, dto.JournalLineId, MemberId) == null ? NotFound(new { message = "Statement line not found." }) : NoContent());

    [HttpPost("statement-lines/{lineId:int}/unmatch")]
    public Task<IActionResult> Unmatch(int clubId, int lineId) => Run(clubId, async () =>
        await _accounts.UnmatchAsync(clubId, lineId) ? NoContent() : NotFound(new { message = "Statement line not found." }));

    [HttpDelete("statement-lines/{lineId:int}")]
    public Task<IActionResult> DeleteStatementLine(int clubId, int lineId) => Run(clubId, async () =>
        await _accounts.DeleteStatementLineAsync(clubId, lineId) == null ? NotFound(new { message = "Statement line not found." }) : NoContent());

    // ===== Voucher, aged balances =====

    [HttpGet("journal/{entryId:int}/voucher")]
    public Task<IActionResult> Voucher(int clubId, int entryId) => Run(clubId, async () =>
    {
        var pdf = await _accounts.VoucherPdfAsync(clubId, entryId);
        return pdf == null ? NotFound(new { message = "Entry not found." }) : File(pdf, "application/pdf", $"voucher-PV-{entryId}.pdf");
    });

    [HttpGet("reports/aged")]
    public Task<IActionResult> Aged(int clubId, [FromQuery] DateTime? asOf) =>
        Run(clubId, async () => Ok(await _accounts.AgedBalancesAsync(clubId, (asOf ?? DateTime.UtcNow).Date)));

    /// <summary>report: profit-loss (from, to), balance-sheet (asOf), budget (yearId), journal (from, to), aged (asOf); format: csv, xlsx, pdf.</summary>
    [HttpGet("export/{report}")]
    public Task<IActionResult> Export(int clubId, string report, [FromQuery] string format, [FromQuery] DateTime? from,
        [FromQuery] DateTime? to, [FromQuery] DateTime? asOf, [FromQuery] int? yearId) => Run(clubId, async () =>
    {
        var table = await TableAsync(clubId, report, from, to, asOf, yearId);
        if (table == null) return NotFound(new { message = "Unknown report or Rotary year." });
        var (bytes, type, ext) = ClubAccountsExport.Render(table, (format ?? "").ToLowerInvariant());
        return File(bytes, type, $"club-{clubId}-{report}.{ext}");
    });

    private static string D(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private async Task<ClubAccountsExport.Table?> TableAsync(int clubId, string report, DateTime? from, DateTime? to, DateTime? asOf, int? yearId)
    {
        var rows = new List<object?[]>();
        switch (report)
        {
            case "profit-loss":
            {
                var f = from ?? DateTime.UtcNow.Date.AddYears(-1);
                var t = to ?? DateTime.UtcNow.Date;
                var pl = await _accounts.ProfitAndLossAsync(clubId, f, t);
                rows.AddRange(pl.Income.Select(l => new object?[] { "Income", l.Code, l.Name, l.Amount }));
                rows.Add(new object?[] { "Total income", null, null, pl.TotalIncome });
                rows.AddRange(pl.Expenses.Select(l => new object?[] { "Expenses", l.Code, l.Name, l.Amount }));
                rows.Add(new object?[] { "Total expenses", null, null, pl.TotalExpenses });
                rows.Add(new object?[] { "Total surplus (deficit)", null, null, pl.Net });
                return new("Profit and loss", $"{D(f)} to {D(t)}", new[] { "Section", "Code", "Account", "Amount" }, rows);
            }
            case "balance-sheet":
            {
                var a = (asOf ?? DateTime.UtcNow).Date;
                var bs = await _accounts.BalanceSheetAsync(clubId, a);
                rows.AddRange(bs.Assets.Select(l => new object?[] { "Assets", l.Code, l.Name, l.Amount }));
                rows.Add(new object?[] { "Total assets", null, null, bs.TotalAssets });
                rows.AddRange(bs.Liabilities.Select(l => new object?[] { "Liabilities", l.Code, l.Name, l.Amount }));
                rows.Add(new object?[] { "Total liabilities", null, null, bs.TotalLiabilities });
                rows.AddRange(bs.Equity.Select(l => new object?[] { "Club funds", l.Code, l.Name, l.Amount }));
                rows.Add(new object?[] { "Club funds", null, "Surplus to date", bs.CurrentEarnings });
                rows.Add(new object?[] { "Total club funds", null, null, bs.TotalEquity });
                return new("Balance sheet", $"As of {D(a)}", new[] { "Section", "Code", "Account", "Amount" }, rows);
            }
            case "budget":
            {
                if (yearId == null) return null;
                var r = await _accounts.BudgetVsActualAsync(clubId, yearId.Value);
                if (r == null) return null;
                rows.AddRange(r.Value.Report.Lines.Select(l => new object?[]
                    { l.Type == ClubLedger.Income ? "Income" : "Expense", l.Code, l.Name, l.Budget, l.Actual, l.Variance }));
                rows.Add(new object?[] { "Total income", null, null, r.Value.Report.BudgetIncome, r.Value.Report.ActualIncome, r.Value.Report.ActualIncome - r.Value.Report.BudgetIncome });
                rows.Add(new object?[] { "Total expenses", null, null, r.Value.Report.BudgetExpenses, r.Value.Report.ActualExpenses, r.Value.Report.BudgetExpenses - r.Value.Report.ActualExpenses });
                return new("Budget against actual", $"Rotary year {r.Value.Year.YearLabel}",
                    new[] { "Type", "Code", "Account", "Budget", "Actual", "Variance" }, rows);
            }
            case "journal":
            {
                var entries = await _accounts.ListEntriesAsync(clubId, from, to, null, 2000);
                foreach (var e in entries.OrderBy(e => e.EntryDate).ThenBy(e => e.Id))
                    foreach (var l in e.Lines)
                        rows.Add(new object?[] { e.Id, D(e.EntryDate), e.Memo, $"{l.Code} {l.Name}", l.Debit == 0 ? null : l.Debit, l.Credit == 0 ? null : l.Credit });
                return new("Journal", from == null && to == null ? "All entries" : $"{(from == null ? "start" : D(from.Value))} to {(to == null ? "today" : D(to.Value))}",
                    new[] { "Entry", "Date", "Description", "Account", "Debit", "Credit" }, rows);
            }
            case "aged":
            {
                var a = (asOf ?? DateTime.UtcNow).Date;
                var r = await _accounts.AgedBalancesAsync(clubId, a);
                rows.AddRange(r.Rows.Select(x => new object?[] { x.MemberName, x.NotDue, x.Days0To30, x.Days31To60, x.Days61To90, x.Over90, x.Total }));
                var t = r.Totals;
                rows.Add(new object?[] { "Total", t.NotDue, t.Days0To30, t.Days31To60, t.Days61To90, t.Over90, t.Total });
                return new("Aged balances: membership dues owed", $"As of {D(a)}",
                    new[] { "Member", "Not yet due", "0-30 days", "31-60 days", "61-90 days", "Over 90 days", "Total" }, rows);
            }
            default:
                return null;
        }
    }
}

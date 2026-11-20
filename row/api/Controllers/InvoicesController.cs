using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;
using static RotaryApi.Services.DuesInvoiceMath;

namespace RotaryApi.Controllers;

// Club invoices and statements (gap #7). Every route sits under api/clubs/{clubId}, so ScopeWriteGuardMiddleware
// already limits writes to the club's managers; reads are limited to managers here too (a plain member reads only
// their own invoices, through MyInvoicesController). Every invoice / member id is checked against the club.
[ApiController]
[Route("api/clubs/{clubId:int}/invoices")]
[Authorize]
public class InvoicesController : ControllerBase
{
    private readonly DuesInvoiceService _svc;
    private readonly string _cs;

    public InvoicesController(DuesInvoiceService svc, IConfiguration config)
    {
        _svc = svc;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var x) ? x : 0;
    private Task<bool> ManagesAsync(int clubId) => ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, UserId, true, clubId, members: false);
    private ObjectResult Denied() => StatusCode(403, new { message = "You do not manage this club." });

    // Maps the service's validation exceptions to 400 / 404 / 409 with their safe message.
    private async Task<IActionResult> Run(int clubId, Func<Task<IActionResult>> body)
    {
        if (UserId <= 0 || !await ManagesAsync(clubId)) return Denied();
        try { return await body(); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    private static (DateTime From, DateTime To) Range(DateTime? from, DateTime? to)
    {
        var t = (to ?? DateTime.UtcNow).Date;
        return ((from ?? t.AddYears(-1)).Date, t);
    }

    private static object Shape(DuesInvoiceService.InvoiceRow i) => new
    {
        i.Id, i.InvoiceNo, i.MemberId, i.MemberName, i.DuesId, i.MemberFeeId, i.FeeType, kind = i.MemberFeeId != null ? "dues" : "items",
        issueDate = i.IssueDate.ToString("yyyy-MM-dd"), dueDate = i.DueDate.ToString("yyyy-MM-dd"), i.Amount, i.PaidAmount,
        balance = i.Status == Voided ? 0 : i.Amount - i.PaidAmount, i.Status, i.Description, i.Notes, i.VoidReason, i.EmailCount, i.EmailedAt,
    };

    [HttpGet("")]
    public Task<IActionResult> List(int clubId, [FromQuery] int? duesId, [FromQuery] int? memberId, [FromQuery] string? status) => Run(clubId, async () =>
    {
        if (status != null && status is not (Open or PartPaid or Paid or Voided)) return BadRequest(new { message = "Unknown status." });
        return Ok((await _svc.ListForClubAsync(clubId, duesId, memberId, status)).Select(Shape));
    });

    [HttpGet("{id:int}")]
    public Task<IActionResult> Get(int clubId, int id) => Run(clubId, async () =>
    {
        var inv = await _svc.GetAsync(id);
        if (inv == null || inv.ClubId != clubId) return NotFound(new { message = "Invoice not found." });
        return Ok(new { invoice = Shape(inv), lines = await _svc.LinesAsync(id), payments = await _svc.PaymentsForAsync(id) });
    });

    [HttpGet("{id:int}/pdf")]
    public Task<IActionResult> Pdf(int clubId, int id) => Run(clubId, async () =>
    {
        var inv = await _svc.GetAsync(id);
        if (inv == null || inv.ClubId != clubId) return NotFound(new { message = "Invoice not found." });
        return File(DuesInvoicePdfBuilder.Invoice(inv, await _svc.LinesAsync(id), await _svc.ClubAsync(clubId)), "application/pdf", $"{inv.InvoiceNo}.pdf");
    });

    public sealed record GenerateDuesBody(int DuesId, int FeeType, DateTime IssueDate, DateTime DueDate, int? MemberFeeId);

    [HttpPost("generate-dues")]
    public Task<IActionResult> GenerateDues(int clubId, [FromBody] GenerateDuesBody b) => Run(clubId, async () =>
        Ok(await _svc.GenerateAsync(clubId, b.DuesId, b.FeeType, b.IssueDate, b.DueDate, b.MemberFeeId, UserId)));

    public sealed record CreateBody(List<int> MemberIds, DateTime IssueDate, DateTime DueDate, List<LineInput> Lines, string? Notes);

    [HttpPost("")]
    public Task<IActionResult> Create(int clubId, [FromBody] CreateBody b) => Run(clubId, async () =>
        Ok(await _svc.CreateAsync(clubId, b.MemberIds, b.IssueDate, b.DueDate, b.Lines, b.Notes, UserId)));

    public sealed record VoidBody(string? Reason);

    [HttpPost("{id:int}/void")]
    public Task<IActionResult> VoidInvoice(int clubId, int id, [FromBody] VoidBody b) => Run(clubId, async () =>
    {
        var reason = (b.Reason ?? "").Trim();
        if (reason.Length is 0 or > 500) return BadRequest(new { message = "Give a reason of up to 500 characters." });
        await _svc.VoidAsync(clubId, id, reason, UserId);
        return Ok(new { message = "Invoice voided." });
    });

    public sealed record EmailBody(List<int> InvoiceIds);

    [HttpPost("email")]
    public Task<IActionResult> Email(int clubId, [FromBody] EmailBody b) => Run(clubId, async () => Ok(await _svc.EmailAsync(clubId, b.InvoiceIds)));

    [HttpGet("balances")]
    public Task<IActionResult> Balances(int clubId) => Run(clubId, async () => Ok(await _svc.BalancesAsync(clubId)));

    [HttpGet("members/{memberId:int}/statement")]
    public Task<IActionResult> Statement(int clubId, int memberId, [FromQuery] DateTime? from, [FromQuery] DateTime? to) => Run(clubId, async () =>
    {
        var (f, t) = Range(from, to);
        var s = await _svc.StatementAsync(memberId, clubId, f, t);
        return Ok(new
        {
            from = f.ToString("yyyy-MM-dd"), to = t.ToString("yyyy-MM-dd"), s.Opening, s.Charges, s.Payments, s.Closing,
            rows = s.Rows.Select(r => new { date = r.Line.Date.ToString("yyyy-MM-dd"), r.Line.IsCharge, r.Line.Reference, r.Line.Description, r.Line.Amount, r.Balance }),
        });
    });

    [HttpGet("members/{memberId:int}/statement/pdf")]
    public Task<IActionResult> StatementPdf(int clubId, int memberId, [FromQuery] DateTime? from, [FromQuery] DateTime? to) => Run(clubId, async () =>
    {
        var (f, t) = Range(from, to);
        var s = await _svc.StatementAsync(memberId, clubId, f, t);
        return File(DuesInvoicePdfBuilder.Statement(await _svc.MemberNameAsync(memberId), await _svc.ClubAsync(clubId), f, t, s),
            "application/pdf", $"statement-{memberId}-{t:yyyyMMdd}.pdf");
    });

    [HttpGet("products")]
    public Task<IActionResult> Products(int clubId, [FromQuery] bool activeOnly = false) => Run(clubId, async () => Ok(await _svc.ProductsAsync(clubId, activeOnly)));

    public sealed record ProductBody(string? Name, string? Description, decimal UnitAmount, bool IsActive = true);

    [HttpPost("products")]
    public Task<IActionResult> AddProduct(int clubId, [FromBody] ProductBody b) => Run(clubId, async () =>
        Ok(new { id = await _svc.SaveProductAsync(clubId, null, b.Name, b.Description, b.UnitAmount, b.IsActive, UserId) }));

    [HttpPut("products/{productId:int}")]
    public Task<IActionResult> UpdateProduct(int clubId, int productId, [FromBody] ProductBody b) => Run(clubId, async () =>
        Ok(new { id = await _svc.SaveProductAsync(clubId, productId, b.Name, b.Description, b.UnitAmount, b.IsActive, UserId) }));

    [HttpGet("receipts")]
    public Task<IActionResult> Receipts(int clubId, [FromQuery] int? memberId) => Run(clubId, async () => Ok(await _svc.ReceiptsAsync(clubId, memberId)));

    public sealed record ReceiptBody(int MemberId, DateTime ReceiptDate, string Method, string? Reference, decimal Amount, string? Notes, List<Split>? Splits);

    [HttpPost("receipts")]
    public Task<IActionResult> RecordReceipt(int clubId, [FromBody] ReceiptBody b) => Run(clubId, async () =>
        Ok(new { id = await _svc.RecordReceiptAsync(clubId, new DuesInvoiceService.ReceiptInput(b.MemberId, b.ReceiptDate, b.Method, b.Reference, b.Amount, b.Notes, b.Splits), UserId) }));

    // ── Meal charges ──

    private static object MealShape(DuesInvoiceService.MealCharge c) => new
    {
        c.Id, c.AttendanceId, c.EventName, mealDate = c.MealDate.ToString("yyyy-MM-dd"), c.MemberId, c.MemberName, c.GuestName, c.Amount,
        invoiceId = c.InvoiceId is > 0 ? c.InvoiceId : null, c.InvoiceNo, billed = c.InvoiceId != null,
    };

    [HttpGet("meals/settings")]
    public Task<IActionResult> MealSettings(int clubId) => Run(clubId, async () => Ok(new { defaultPrice = await _svc.DefaultMealPriceAsync(clubId) }));

    public sealed record MealSettingsBody(decimal DefaultPrice);

    [HttpPut("meals/settings")]
    public Task<IActionResult> SaveMealSettings(int clubId, [FromBody] MealSettingsBody b) => Run(clubId, async () =>
    {
        await _svc.SetDefaultMealPriceAsync(clubId, b.DefaultPrice, UserId);
        return Ok(new { defaultPrice = b.DefaultPrice });
    });

    [HttpGet("meals/meetings")]
    public Task<IActionResult> MealMeetings(int clubId, [FromQuery] DateTime? from, [FromQuery] DateTime? to) => Run(clubId, async () =>
    {
        var (f, t) = Range(from, to);
        return Ok((await _svc.MealMeetingsAsync(clubId, f, t)).Select(m => new
        {
            m.AttendanceId, m.EventName, eventDate = m.EventDate.ToString("yyyy-MM-dd"), m.MeetingPrice, m.Diners, m.Billed,
        }));
    });

    [HttpGet("meals/meetings/{attendanceId:int}")]
    public Task<IActionResult> MealMeeting(int clubId, int attendanceId) => Run(clubId, async () =>
    {
        var (m, members, charges) = await _svc.MealMeetingAsync(clubId, attendanceId);
        return Ok(new
        {
            meeting = new { m.AttendanceId, m.EventName, eventDate = m.EventDate.ToString("yyyy-MM-dd"), m.MeetingPrice },
            defaultPrice = await _svc.DefaultMealPriceAsync(clubId), members, charges = charges.Select(MealShape),
        });
    });

    public sealed record MealDinersBody(decimal? Price, List<DinerInput>? Diners);

    [HttpPut("meals/meetings/{attendanceId:int}")]
    public Task<IActionResult> SaveMealDiners(int clubId, int attendanceId, [FromBody] MealDinersBody b) => Run(clubId, async () =>
        Ok(new { meals = await _svc.SaveMealDinersAsync(clubId, attendanceId, b.Price, b.Diners, UserId) }));

    [HttpGet("meals/charges")]
    public Task<IActionResult> MealCharges(int clubId, [FromQuery] int? memberId) => Run(clubId, async () =>
        Ok((await _svc.MealChargesForAsync(clubId, memberId)).Select(MealShape)));

    public sealed record MealBillBody(string Month, string Mode, DateTime IssueDate, DateTime DueDate);

    [HttpPost("meals/bill")]
    public Task<IActionResult> BillMeals(int clubId, [FromBody] MealBillBody b) => Run(clubId, async () =>
        Ok(await _svc.BillMealsAsync(clubId, b.Month, b.Mode, b.IssueDate, b.DueDate, UserId)));

    /// <summary>format: iif (QuickBooks Desktop), csv-invoices or csv-payments (QuickBooks Online).</summary>
    [HttpGet("export/quickbooks")]
    public Task<IActionResult> QuickBooks(int clubId, [FromQuery] string format, [FromQuery] DateTime? from, [FromQuery] DateTime? to) => Run(clubId, async () =>
    {
        var (f, t) = Range(from, to);
        var stamp = $"{f:yyyyMMdd}-{t:yyyyMMdd}";
        return format switch
        {
            "iif" => File(Encoding.UTF8.GetBytes(await _svc.QuickBooksIifAsync(clubId, f, t)), "application/octet-stream", $"quickbooks-{stamp}.iif"),
            "csv-invoices" => File(Encoding.UTF8.GetBytes(await _svc.QuickBooksInvoicesCsvAsync(clubId, f, t)), "text/csv", $"qbo-invoices-{stamp}.csv"),
            "csv-payments" => File(Encoding.UTF8.GetBytes(await _svc.QuickBooksPaymentsCsvAsync(clubId, f, t)), "text/csv", $"qbo-payments-{stamp}.csv"),
            _ => BadRequest(new { message = "Format must be iif, csv-invoices or csv-payments." }),
        };
    });
}

// The signed-in member's own invoices, balance and statement (the app). Only ever the caller's own rows.
[ApiController]
[Route("api/my/invoices")]
[Authorize]
public class MyInvoicesController : ControllerBase
{
    private readonly DuesInvoiceService _svc;
    public MyInvoicesController(DuesInvoiceService svc) => _svc = svc;

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var x) ? x : 0;

    [HttpGet("")]
    public async Task<IActionResult> List()
    {
        if (UserId <= 0) return Unauthorized();
        var rows = await _svc.ListForMemberAsync(UserId);
        var live = rows.Where(r => r.Status != Voided).ToList();
        return Ok(new
        {
            balance = live.Sum(r => r.Amount - r.PaidAmount),
            invoices = rows.Select(i => new
            {
                i.Id, i.InvoiceNo, i.Description, issueDate = i.IssueDate.ToString("yyyy-MM-dd"), dueDate = i.DueDate.ToString("yyyy-MM-dd"),
                i.Amount, i.PaidAmount, balance = i.Status == Voided ? 0 : i.Amount - i.PaidAmount, i.Status,
            }),
        });
    }

    [HttpGet("{id:int}/pdf")]
    public async Task<IActionResult> Pdf(int id)
    {
        var inv = await _svc.GetAsync(id);
        if (inv == null || UserId <= 0 || inv.MemberId != UserId) return NotFound(new { message = "Invoice not found." });
        return File(DuesInvoicePdfBuilder.Invoice(inv, await _svc.LinesAsync(id), await _svc.ClubAsync(inv.ClubId)), "application/pdf", $"{inv.InvoiceNo}.pdf");
    }

    [HttpGet("meals")]
    public async Task<IActionResult> Meals()
    {
        if (UserId <= 0) return Unauthorized();
        return Ok((await _svc.MealChargesForAsync(null, UserId)).Select(c => new
        {
            c.Id, c.EventName, mealDate = c.MealDate.ToString("yyyy-MM-dd"), c.GuestName, c.Amount, c.InvoiceNo, billed = c.InvoiceId != null,
        }));
    }

    [HttpGet("statement/pdf")]
    public async Task<IActionResult> StatementPdf([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (UserId <= 0) return Unauthorized();
        var t = (to ?? DateTime.UtcNow).Date;
        var f = (from ?? t.AddYears(-1)).Date;
        if (t < f) return BadRequest(new { message = "The end date is before the start date." });
        var s = await _svc.StatementAsync(UserId, null, f, t);
        return File(DuesInvoicePdfBuilder.Statement(await _svc.MemberNameAsync(UserId), null, f, t, s), "application/pdf", $"statement-{t:yyyyMMdd}.pdf");
    }
}

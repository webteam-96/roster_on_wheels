using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using QRCoder;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Donation campaigns (gap #13, Services/DonationService.cs). Manager routes serve a club ({scope} = clubs) or a
/// district ({scope} = districts) and need someone who manages it, reads included (donations hold names and emails).
/// The public routes serve the giving page and the club website; money moves only through the payment seam
/// (PaymentCheckoutService: the simulator today, Stripe later).
/// </summary>
[ApiController]
[Authorize]
public class DonationsController : ControllerBase
{
    private const string Scoped = "api/{scope:regex(^(clubs|districts)$)}/{scopeId:int}";
    private readonly DonationService _donations;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;

    public DonationsController(DonationService donations, IWebHostEnvironment env, IConfiguration configuration)
    {
        _donations = donations;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static bool IsClub(string scope) => scope == "clubs";

    private async Task<bool> ManagesAsync(string scope, int scopeId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, IsClub(scope), scopeId);

    private ObjectResult NotManager() => StatusCode(403, new { message = "Only this club's or district's admins can manage its donation campaigns." });
    private NotFoundObjectResult Missing() => NotFound(new { message = "Campaign not found." });

    // ===== Managers =====

    [HttpGet(Scoped + "/donation-campaigns")]
    public async Task<IActionResult> List(string scope, int scopeId)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        var rows = await _donations.ListAsync(IsClub(scope), scopeId, false);
        return Ok(new { currency = await _donations.ResolveCurrencyAsync(IsClub(scope), scopeId), campaigns = rows.Select(_donations.View) });
    }

    [HttpPost(Scoped + "/donation-campaigns")]
    public async Task<IActionResult> Create(string scope, int scopeId, [FromBody] SaveDonationCampaignDto dto)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (DonationRules.ValidateCampaign(dto) is { } error) return BadRequest(new { message = error });
        return Ok(new { id = await _donations.CreateAsync(IsClub(scope), scopeId, dto, MemberId) });
    }

    [HttpGet(Scoped + "/donation-campaigns/{id:int}")]
    public async Task<IActionResult> Get(string scope, int scopeId, int id)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (await _donations.GetInScopeAsync(IsClub(scope), scopeId, id) is not { } c) return Missing();
        return Ok(_donations.Report(c, await _donations.DonationsAsync(id, false)));
    }

    [HttpPut(Scoped + "/donation-campaigns/{id:int}")]
    public async Task<IActionResult> Update(string scope, int scopeId, int id, [FromBody] SaveDonationCampaignDto dto)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (await _donations.GetInScopeAsync(IsClub(scope), scopeId, id) is null) return Missing();
        if (DonationRules.ValidateCampaign(dto) is { } error) return BadRequest(new { message = error });
        await _donations.UpdateAsync(id, dto, MemberId);
        return NoContent();
    }

    [HttpDelete(Scoped + "/donation-campaigns/{id:int}")]
    public async Task<IActionResult> Delete(string scope, int scopeId, int id)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (await _donations.GetInScopeAsync(IsClub(scope), scopeId, id) is null) return Missing();
        await _donations.DeleteAsync(id);
        return NoContent();
    }

    [HttpGet(Scoped + "/donation-campaigns/{id:int}/export")]
    public async Task<IActionResult> Export(string scope, int scopeId, int id)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (await _donations.GetInScopeAsync(IsClub(scope), scopeId, id) is not { } c) return Missing();
        return File(DonationService.Excel(c, await _donations.DonationsAsync(id, true)),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"donors-campaign-{id}.xlsx");
    }

    /// <summary>PNG QR code of the campaign's giving page, for posters and slides.</summary>
    [HttpGet(Scoped + "/donation-campaigns/{id:int}/qr")]
    public async Task<IActionResult> Qr(string scope, int scopeId, int id)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (await _donations.GetInScopeAsync(IsClub(scope), scopeId, id) is null) return Missing();
        return File(QrPng(_donations.GivingUrl(id)!), "image/png", $"donate-campaign-{id}.png");
    }

    [NonAction]
    public static byte[] QrPng(string text)
    {
        using var gen = new QRCodeGenerator();
        using var data = gen.CreateQrCode(text, QRCodeGenerator.ECCLevel.M);
        return new PngByteQRCode(data).GetGraphic(12);
    }

    [HttpGet(Scoped + "/donation-campaigns/{id:int}/donations/{donationId:int}/receipt")]
    public async Task<IActionResult> Receipt(string scope, int scopeId, int id, int donationId)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (await _donations.GetInScopeAsync(IsClub(scope), scopeId, id) is null) return Missing();
        if (await _donations.DonationAsync(id, donationId) is not { Status: "paid" } d) return NotFound(new { message = "No paid donation with this number." });
        return File((await _donations.ReceiptAsync(d))!, "application/pdf", $"donation-receipt-{d.MerchantOrderId}.pdf");
    }

    [HttpPost(Scoped + "/donation-campaigns/image")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<IActionResult> UploadImage(string scope, int scopeId, IFormFile file)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });
        file = ImageCompressor.EnsureWithinLimit(file);
        var check = ImageQualityValidator.Validate(file, false);
        if (!check.Ok) return BadRequest(new { message = check.Error });
        var folder = Path.Combine(_env.WebRootPath, "Documents", "donations");
        Directory.CreateDirectory(folder);
        var fileName = $"{Guid.NewGuid():N}{Path.GetExtension(file.FileName).ToLowerInvariant()}";
        await using (var stream = new FileStream(Path.Combine(folder, fileName), FileMode.Create))
            await file.CopyToAsync(stream);
        return Ok(new { path = "/Documents/donations/" + fileName });
    }

    [HttpGet(Scoped + "/donation-receipt-template")]
    public async Task<IActionResult> Template(string scope, int scopeId)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        return Ok(new
        {
            template = await _donations.TemplateAsync(IsClub(scope), scopeId),
            defaultBody = DonationReceiptTemplate.DefaultBody,
            placeholders = DonationReceiptTemplate.Placeholders,
        });
    }

    [HttpPut(Scoped + "/donation-receipt-template")]
    public async Task<IActionResult> SaveTemplate(string scope, int scopeId, [FromBody] DonationReceiptTemplate dto)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (dto.Validate() is { } error) return BadRequest(new { message = error });
        await _donations.SaveTemplateAsync(IsClub(scope), scopeId, dto, MemberId);
        return NoContent();
    }

    /// <summary>A sample receipt of the template as typed (not yet saved), so the editor sees the letter first.</summary>
    [HttpPost(Scoped + "/donation-receipt-template/preview")]
    public async Task<IActionResult> PreviewTemplate(string scope, int scopeId, [FromBody] DonationReceiptTemplate dto)
    {
        if (!await ManagesAsync(scope, scopeId)) return NotManager();
        if (dto.Validate() is { } error) return BadRequest(new { message = error });
        return File(await _donations.SampleReceiptAsync(IsClub(scope), scopeId, dto), "application/pdf", "donation-receipt-sample.pdf");
    }

    // ===== The app: open campaigns of the member's clubs and districts =====

    [HttpGet("api/mobile/donations")]
    public async Task<IActionResult> MemberCampaigns() =>
        Ok((await _donations.ForMemberAsync(MemberId)).Select(_donations.View));

    // ===== Public: the giving page and the club website =====

    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    [HttpGet("api/public/donations/{id:int}")]
    public async Task<IActionResult> PublicCampaign(int id)
    {
        if (await _donations.GetAsync(id) is not { } c) return Missing();
        var recent = (await _donations.DonationsAsync(id, true)).Take(10).Select(DonationRules.ToPublic);
        return Ok(new { campaign = _donations.View(c), organisation = await _donations.OrganisationNameAsync(c), recentDonors = recent });
    }

    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    [HttpGet("api/public/club/{clubId:int}/donation-campaigns")]
    public async Task<IActionResult> ClubCampaigns(int clubId) =>
        Ok((await _donations.ListAsync(true, clubId, true)).Select(_donations.View));

    [AllowAnonymous]
    [EnableRateLimiting("public-form")]
    [HttpPost("api/public/donations/{id:int}/donate")]
    public async Task<IActionResult> Donate(int id, [FromBody] DonateDto dto)
    {
        // honeypot: only a bot fills the hidden field; it gets a refusal that says nothing and nothing is stored
        if (!string.IsNullOrEmpty(dto.Website)) return BadRequest(new { message = "This donation could not be started." });
        var result = await _donations.DonateAsync(id, dto, null);
        return result.Error != null ? BadRequest(new { message = result.Error }) : Ok(result.Checkout);
    }

    /// <summary>The donor's own donation after the checkout, keyed by its order id and the checkout session token.</summary>
    [AllowAnonymous]
    [EnableRateLimiting("payment-status")]
    [HttpGet("api/public/donations/{id:int}/order/{orderId}")]
    public async Task<IActionResult> Order(int id, string orderId, [FromQuery] string? token)
    {
        if (await _donations.ByCheckoutAsync(orderId, token) is not { } d || d.CampaignId != id) return NotFound(new { message = "Donation not found." });
        return Ok(new { d.Status, d.Amount, d.Currency, d.DonorName, d.PaidDate, d.MerchantOrderId });
    }

    [AllowAnonymous]
    [EnableRateLimiting("payment-status")]
    [HttpGet("api/public/donations/{id:int}/order/{orderId}/receipt")]
    public async Task<IActionResult> OrderReceipt(int id, string orderId, [FromQuery] string? token)
    {
        if (await _donations.ByCheckoutAsync(orderId, token) is not { Status: "paid" } d || d.CampaignId != id)
            return NotFound(new { message = "No paid donation found." });
        return File((await _donations.ReceiptAsync(d))!, "application/pdf", $"donation-receipt-{d.MerchantOrderId}.pdf");
    }
}

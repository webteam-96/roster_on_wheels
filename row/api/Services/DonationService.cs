using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.Controllers;
using RotaryApi.Services.Payments;

namespace RotaryApi.Services;

public sealed class SaveDonationCampaignDto
{
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? ImageUrl { get; set; }
    public decimal GoalAmount { get; set; }
    public List<decimal>? Tiers { get; set; }
    public bool AllowCustom { get; set; } = true;
    public decimal MinAmount { get; set; } = 1;
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class DonateDto
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Message { get; set; }
    public bool Anonymous { get; set; }
    public bool HideAmount { get; set; }
    public decimal Amount { get; set; }
    /// <summary>Honeypot: only a bot fills it.</summary>
    public string? Website { get; set; }
}

public sealed class DonationCampaignRow
{
    public int Id { get; set; }
    public string ScopeType { get; set; } = "";
    public int ScopeId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImageUrl { get; set; }
    public decimal GoalAmount { get; set; }
    public string Currency { get; set; } = "";
    public string? Tiers { get; set; }
    public bool AllowCustom { get; set; }
    public decimal MinAmount { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public bool IsActive { get; set; }
    public decimal Raised { get; set; }
    public int Donors { get; set; }
}

public sealed class DonationRow
{
    public int Id { get; set; }
    public int CampaignId { get; set; }
    public string DonorName { get; set; } = "";
    public string DonorEmail { get; set; } = "";
    public string? Message { get; set; }
    public bool IsAnonymous { get; set; }
    public bool HideAmount { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "";
    public string Status { get; set; } = "";
    public string MerchantOrderId { get; set; } = "";
    public string? GatewayPaymentId { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime? PaidDate { get; set; }
}

/// <summary>What a public page may show about one donor: never the email, never the full name.</summary>
public sealed record PublicDonorView(string Name, decimal? Amount, string? Message, DateTime? Date);

public sealed record DailyGiving(string Date, decimal Amount, int Count);

public sealed record CampaignProgress(decimal Raised, int Donors, decimal Percent);

/// <summary>Pure rules, unit tested in api.Tests (DonationRulesTests).</summary>
public static class DonationRules
{
    public const decimal MaxAmount = 1_000_000m;

    public static List<decimal> ParseTiers(string? tiers) =>
        (tiers ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(t => decimal.TryParse(t, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : 0m)
            .Where(d => d > 0).Distinct().OrderBy(d => d).ToList();

    public static string? FormatTiers(IEnumerable<decimal>? tiers)
    {
        var list = (tiers ?? Enumerable.Empty<decimal>()).Where(t => t > 0).Select(t => Math.Round(t, 2)).Distinct().OrderBy(t => t).ToList();
        return list.Count == 0 ? null : string.Join(",", list.Select(t => t.ToString("0.##", CultureInfo.InvariantCulture)));
    }

    /// <summary>Null when the amount is acceptable, else the message for the donor. The server is the only judge.</summary>
    public static string? ValidateAmount(decimal amount, string? tiers, bool allowCustom, decimal minAmount)
    {
        if (amount <= 0) return "Enter an amount above zero.";
        if (amount > MaxAmount) return "This amount is above the limit for one donation.";
        if (decimal.Round(amount, 2) != amount) return "Use at most two decimal places.";
        var tierList = ParseTiers(tiers);
        if (tierList.Contains(amount)) return null;
        if (!allowCustom) return "Choose one of the suggested amounts.";
        var min = minAmount > 0 ? minAmount : 1m;
        return amount < min ? $"The smallest donation is {min.ToString("0.##", CultureInfo.InvariantCulture)}." : null;
    }

    /// <summary>Percent of goal to one decimal; may pass 100. No goal = 0.</summary>
    public static CampaignProgress Progress(decimal goal, decimal raised, int donors) =>
        new(raised, donors, goal > 0 ? Math.Round(raised * 100m / goal, 1, MidpointRounding.AwayFromZero) : 0m);

    public static bool IsOpen(DonationCampaignRow c, DateTime todayUtc) =>
        c.IsActive && (c.StartDate == null || c.StartDate.Value.Date <= todayUtc.Date)
                   && (c.EndDate == null || c.EndDate.Value.Date >= todayUtc.Date);

    /// <summary>Paid totals per UTC day, oldest first: the campaign's giving chart.</summary>
    public static List<DailyGiving> Daily(IEnumerable<DonationRow> paid) => paid
        .Where(d => d.Status == "paid")
        .GroupBy(d => (d.PaidDate ?? d.CreatedDate).Date)
        .OrderBy(g => g.Key)
        .Select(g => new DailyGiving(g.Key.ToString("yyyy-MM-dd"), g.Sum(d => d.Amount), g.Count()))
        .ToList();

    public static string FirstName(string? name)
    {
        var first = (name ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return string.IsNullOrEmpty(first) ? "A supporter" : first;
    }

    /// <summary>Anonymous donors show as "Anonymous" with no message; the amount only when the donor allowed it.</summary>
    public static PublicDonorView ToPublic(DonationRow d) => new(
        d.IsAnonymous ? "Anonymous" : FirstName(d.DonorName),
        d.HideAmount ? null : d.Amount,
        d.IsAnonymous ? null : d.Message,
        d.PaidDate);

    /// <summary>Validates the editable fields of a campaign. Null when fine.</summary>
    public static string? ValidateCampaign(SaveDonationCampaignDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Title) || dto.Title.Trim().Length > 200) return "Enter a title of up to 200 characters.";
        if ((dto.Description?.Length ?? 0) > 5000) return "The description is too long.";
        if (dto.GoalAmount < 0 || dto.GoalAmount > 100_000_000m) return "Enter a goal between 0 and 100,000,000.";
        if (dto.MinAmount <= 0 || dto.MinAmount > MaxAmount) return "Enter a minimum amount above zero.";
        var tiers = dto.Tiers ?? new List<decimal>();
        if (tiers.Count > 6 || tiers.Any(t => t <= 0 || t > MaxAmount)) return "Use up to six suggested amounts above zero.";
        if (!dto.AllowCustom && tiers.Count == 0) return "Add suggested amounts or allow any amount.";
        if (dto.StartDate != null && dto.EndDate != null && dto.EndDate.Value.Date < dto.StartDate.Value.Date)
            return "The end date is before the start date.";
        if (dto.ImageUrl is { Length: > 0 } img && (img.Length > 500 || !img.StartsWith("/Documents/donations/", StringComparison.Ordinal)))
            return "Upload the image with the campaign's image button.";
        return null;
    }
}

/// <summary>
/// Donation campaigns of a club or a district, public donations through the payment seam
/// (PaymentSettlementService.FlowDonation), receipts and the managers' reports.
/// </summary>
public sealed class DonationService
{
    private readonly string _conn;
    private readonly PaymentCheckoutService _checkout;
    private readonly IEmailService _email;
    private readonly ILogger<DonationService> _logger;

    public DonationService(IConfiguration config, PaymentCheckoutService checkout, IEmailService email, ILogger<DonationService> logger)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
        _checkout = checkout;
        _email = email;
        _logger = logger;
    }

    private MySqlConnection Conn() => new(_conn);

    private const string CampaignSelect = @"
        SELECT c.pk_campaign_id AS Id, c.scope_type AS ScopeType, c.scope_id AS ScopeId, c.title AS Title,
               c.description AS Description, c.image_url AS ImageUrl, c.goal_amount AS GoalAmount, c.currency AS Currency,
               c.tiers AS Tiers, c.allow_custom AS AllowCustom, c.min_amount AS MinAmount, c.start_date AS StartDate,
               c.end_date AS EndDate, c.is_active AS IsActive,
               IFNULL((SELECT SUM(d.amount) FROM donations d WHERE d.fk_campaign_id = c.pk_campaign_id AND d.status = 'paid'), 0) AS Raised,
               (SELECT COUNT(*) FROM donations d WHERE d.fk_campaign_id = c.pk_campaign_id AND d.status = 'paid') AS Donors
        FROM donation_campaigns c";

    private const string DonationSelect = @"
        SELECT pk_donation_id AS Id, fk_campaign_id AS CampaignId, donor_name AS DonorName, donor_email AS DonorEmail,
               message AS Message, is_anonymous AS IsAnonymous, hide_amount AS HideAmount, amount AS Amount,
               currency AS Currency, status AS Status, merchant_order_id AS MerchantOrderId,
               gateway_payment_id AS GatewayPaymentId, created_date AS CreatedDate, paid_date AS PaidDate
        FROM donations";

    public static string Scope(bool isClub) => isClub ? "club" : "district";

    /// <summary>The public giving page (admin app, /public/donate/{id}); the QR code and the websites link here.</summary>
    public string? GivingUrl(int campaignId) => _checkout.LocalUrl($"/public/donate/{campaignId}");

    public object View(DonationCampaignRow c) => new
    {
        c.Id, c.ScopeType, c.ScopeId, c.Title, c.Description, c.ImageUrl, c.GoalAmount, c.Currency,
        Tiers = DonationRules.ParseTiers(c.Tiers), c.AllowCustom, c.MinAmount,
        StartDate = c.StartDate?.ToString("yyyy-MM-dd"), EndDate = c.EndDate?.ToString("yyyy-MM-dd"), c.IsActive,
        IsOpen = DonationRules.IsOpen(c, DateTime.UtcNow),
        Progress = DonationRules.Progress(c.GoalAmount, c.Raised, c.Donors),
        GivingUrl = GivingUrl(c.Id),
    };

    // ===== Managers =====

    public async Task<string> ResolveCurrencyAsync(bool isClub, int scopeId)
    {
        await using var conn = Conn();
        var row = await conn.QueryFirstOrDefaultAsync<(string? DefaultCurrency, string? Country)>(isClub
            ? "SELECT d.DefaultCurrency, d.Country FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @Id"
            : "SELECT DefaultCurrency, Country FROM district_master WHERE pk_district_id = @Id", new { Id = scopeId });
        return CurrencyHelper.ResolveDefaultCurrency(row.DefaultCurrency, row.Country);
    }

    public async Task<List<DonationCampaignRow>> ListAsync(bool isClub, int scopeId, bool openOnly)
    {
        await using var conn = Conn();
        var rows = (await conn.QueryAsync<DonationCampaignRow>(CampaignSelect +
            " WHERE c.scope_type = @Scope AND c.scope_id = @Id AND c.isdeleted = 0 ORDER BY c.pk_campaign_id DESC",
            new { Scope = Scope(isClub), Id = scopeId })).ToList();
        return openOnly ? rows.Where(r => DonationRules.IsOpen(r, DateTime.UtcNow)).ToList() : rows;
    }

    public async Task<DonationCampaignRow?> GetAsync(int id)
    {
        await using var conn = Conn();
        return await conn.QueryFirstOrDefaultAsync<DonationCampaignRow>(CampaignSelect +
            " WHERE c.pk_campaign_id = @Id AND c.isdeleted = 0", new { Id = id });
    }

    /// <summary>The campaign when it belongs to this club or district, else null (IDOR guard for manager routes).</summary>
    public async Task<DonationCampaignRow?> GetInScopeAsync(bool isClub, int scopeId, int id) =>
        await GetAsync(id) is { } c && c.ScopeType == Scope(isClub) && c.ScopeId == scopeId ? c : null;

    public async Task<int> CreateAsync(bool isClub, int scopeId, SaveDonationCampaignDto dto, int memberId)
    {
        var currency = await ResolveCurrencyAsync(isClub, scopeId);
        await using var conn = Conn();
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO donation_campaigns (scope_type, scope_id, title, description, image_url, goal_amount, currency, tiers,
                allow_custom, min_amount, start_date, end_date, is_active, created_by, created_date)
            VALUES (@Scope, @ScopeId, @Title, @Description, @ImageUrl, @GoalAmount, @Currency, @Tiers, @AllowCustom,
                @MinAmount, @StartDate, @EndDate, @IsActive, @MemberId, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();", Params(dto, new { Scope = Scope(isClub), ScopeId = scopeId, Currency = currency, MemberId = memberId }));
    }

    public async Task UpdateAsync(int id, SaveDonationCampaignDto dto, int memberId)
    {
        // Currency stays what it was at creation: donations already taken are in it.
        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            UPDATE donation_campaigns SET title = @Title, description = @Description, image_url = @ImageUrl,
                goal_amount = @GoalAmount, tiers = @Tiers, allow_custom = @AllowCustom, min_amount = @MinAmount,
                start_date = @StartDate, end_date = @EndDate, is_active = @IsActive, modified_by = @MemberId,
                modified_date = UTC_TIMESTAMP()
            WHERE pk_campaign_id = @Id", Params(dto, new { Id = id, MemberId = memberId }));
    }

    private static DynamicParameters Params(SaveDonationCampaignDto dto, object extra)
    {
        var p = new DynamicParameters(extra);
        p.Add("Title", dto.Title!.Trim());
        p.Add("Description", string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim());
        p.Add("ImageUrl", string.IsNullOrWhiteSpace(dto.ImageUrl) ? null : dto.ImageUrl);
        p.Add("GoalAmount", Math.Round(dto.GoalAmount, 2));
        p.Add("Tiers", DonationRules.FormatTiers(dto.Tiers));
        p.Add("AllowCustom", dto.AllowCustom);
        p.Add("MinAmount", Math.Round(dto.MinAmount, 2));
        p.Add("StartDate", dto.StartDate?.Date);
        p.Add("EndDate", dto.EndDate?.Date);
        p.Add("IsActive", dto.IsActive);
        return p;
    }

    public async Task DeleteAsync(int id)
    {
        // Soft delete: paid donations keep their campaign for receipts and reports.
        await using var conn = Conn();
        await conn.ExecuteAsync("UPDATE donation_campaigns SET isdeleted = 1, is_active = 0, modified_date = UTC_TIMESTAMP() WHERE pk_campaign_id = @Id", new { Id = id });
    }

    public async Task<List<DonationRow>> DonationsAsync(int campaignId, bool paidOnly)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<DonationRow>(DonationSelect + " WHERE fk_campaign_id = @Id" +
            (paidOnly ? " AND status = 'paid'" : "") + " ORDER BY pk_donation_id DESC", new { Id = campaignId })).ToList();
    }

    public object Report(DonationCampaignRow c, List<DonationRow> rows)
    {
        var paid = rows.Where(r => r.Status == "paid").ToList();
        var total = paid.Sum(r => r.Amount);
        return new
        {
            Campaign = View(c),
            Total = total,
            Count = paid.Count,
            Average = paid.Count == 0 ? 0m : Math.Round(total / paid.Count, 2, MidpointRounding.AwayFromZero),
            // Grouped by email: one donor giving twice is one top donor.
            TopDonors = paid.GroupBy(r => r.DonorEmail.Trim().ToLowerInvariant())
                .Select(g => new { Name = g.First().DonorName, Total = g.Sum(r => r.Amount), Gifts = g.Count() })
                .OrderByDescending(g => g.Total).Take(5),
            Pending = rows.Count(r => r.Status == "pending"),
            Daily = DonationRules.Daily(paid),
            Donations = rows.Select(r => new
            {
                r.Id, r.DonorName, r.DonorEmail, r.Message, r.IsAnonymous, r.HideAmount, r.Amount, r.Currency, r.Status,
                r.MerchantOrderId, r.CreatedDate, r.PaidDate,
            }),
        };
    }

    public static byte[] Excel(DonationCampaignRow c, List<DonationRow> rows)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Donations");
        string[] headers = { "Date (UTC)", "Donor", "Email", "Amount", "Currency", "Anonymous on page", "Message", "Order" };
        for (var i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        ws.Row(1).Style.Font.SetBold();
        var r = 2;
        foreach (var d in rows.Where(x => x.Status == "paid"))
        {
            ws.Cell(r, 1).Value = d.PaidDate?.ToString("yyyy-MM-dd HH:mm") ?? "";
            ws.Cell(r, 2).Value = d.DonorName;
            ws.Cell(r, 3).Value = d.DonorEmail;
            ws.Cell(r, 4).Value = d.Amount;
            ws.Cell(r, 5).Value = d.Currency;
            ws.Cell(r, 6).Value = d.IsAnonymous ? "Yes" : "No";
            ws.Cell(r, 7).Value = d.Message ?? "";
            ws.Cell(r, 8).Value = d.MerchantOrderId;
            r++;
        }
        ws.Cell(r + 1, 3).Value = "Total";
        ws.Cell(r + 1, 4).Value = rows.Where(x => x.Status == "paid").Sum(x => x.Amount);
        ws.Cell(r + 1, 3).Style.Font.SetBold();
        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ===== Public donations =====

    public sealed record DonateResult(string? Error, CheckoutSessionDto? Checkout = null);

    /// <summary>Creates a pending donation and its hosted checkout. Amount is checked against the campaign here.</summary>
    public async Task<DonateResult> DonateAsync(int campaignId, DonateDto dto, int? memberId)
    {
        if (!_checkout.Enabled) return new(LegacyGateways.NoGatewayMessage);
        var c = await GetAsync(campaignId);
        if (c == null || !DonationRules.IsOpen(c, DateTime.UtcNow)) return new("This campaign is not taking donations.");

        var name = (dto.Name ?? "").Trim();
        var email = (dto.Email ?? "").Trim();
        if (name.Length is < 2 or > 150) return new("Enter your name.");
        if (email.Length > 254 || !System.Net.Mail.MailAddress.TryCreate(email, out _)) return new("Enter a valid email address.");
        var message = string.IsNullOrWhiteSpace(dto.Message) ? null : dto.Message.Trim();
        if (message is { Length: > 500 }) return new("Keep the message under 500 characters.");
        if (DonationRules.ValidateAmount(dto.Amount, c.Tiers, c.AllowCustom, c.MinAmount) is { } amountError) return new(amountError);

        var orderId = $"DON{c.Id}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(10)).ToLowerInvariant()}";
        await using var conn = Conn();
        var donationId = await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO donations (fk_campaign_id, donor_name, donor_email, message, is_anonymous, hide_amount, fk_member_id,
                amount, currency, status, merchant_order_id, created_date)
            VALUES (@CampaignId, @Name, @Email, @Message, @Anonymous, @HideAmount, @MemberId, @Amount, @Currency, 'pending',
                @OrderId, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();",
            new { CampaignId = c.Id, Name = name, Email = email, Message = message, dto.Anonymous, dto.HideAmount, MemberId = memberId,
                  dto.Amount, c.Currency, OrderId = orderId });

        // The giving page shows the outcome; the checkout page adds the session token to this URL.
        var returnUrl = _checkout.LocalUrl($"/public/donate/{c.Id}?order={Uri.EscapeDataString(orderId)}");
        var session = await _checkout.CreateAsync(new CheckoutRequest(PaymentSettlementService.FlowDonation, donationId, orderId,
            dto.Amount, c.Currency, $"Donation: {c.Title}", returnUrl, returnUrl));
        return new(null, session);
    }

    /// <summary>Called by PaymentSettlementService once the gateway confirms. Only the first call counts the money.</summary>
    public async Task SettleOnlineAsync(long donationId, string gatewayPaymentId)
    {
        await using var conn = Conn();
        var claimed = await conn.ExecuteAsync(@"
            UPDATE donations SET status = 'paid', gateway_payment_id = @Pid, paid_date = UTC_TIMESTAMP()
            WHERE pk_donation_id = @Id AND status = 'pending'", new { Id = donationId, Pid = gatewayPaymentId });
        if (claimed == 0) return;
        _logger.LogInformation("Donation {Id} settled, gateway payment {GatewayPaymentId}.", donationId, gatewayPaymentId);
        try { await SendThankYouAsync(donationId); }
        catch (Exception ex) { _logger.LogError(ex, "Thank-you email failed for donation {Id}", donationId); }
    }

    /// <summary>The donation behind a checkout token, only when the token's session is that order's donation.</summary>
    public async Task<DonationRow?> ByCheckoutAsync(string orderId, string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length != 64) return null;
        var session = await _checkout.GetAsync(token);
        if (session == null || session.Flow != PaymentSettlementService.FlowDonation || session.MerchantOrderId != orderId) return null;
        await using var conn = Conn();
        return await conn.QueryFirstOrDefaultAsync<DonationRow>(DonationSelect + " WHERE pk_donation_id = @Id AND merchant_order_id = @OrderId",
            new { Id = session.FlowRef, OrderId = orderId });
    }

    public async Task<DonationRow?> DonationAsync(int campaignId, int donationId)
    {
        await using var conn = Conn();
        return await conn.QueryFirstOrDefaultAsync<DonationRow>(DonationSelect + " WHERE pk_donation_id = @Id AND fk_campaign_id = @C",
            new { Id = donationId, C = campaignId });
    }

    // ===== Receipt and email =====

    public async Task<string> OrganisationNameAsync(DonationCampaignRow c)
    {
        await using var conn = Conn();
        return c.ScopeType == "club"
            ? await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id", new { Id = c.ScopeId }) ?? Brand.ProductName
            : "District " + (await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = c.ScopeId }) ?? "");
    }

    public async Task<byte[]?> ReceiptAsync(DonationRow d)
    {
        if (d.Status != "paid") return null;
        var c = await GetAsync(d.CampaignId) ?? throw new InvalidOperationException("Campaign missing.");
        return DonationReceiptPdfBuilder.Build(new DonationReceipt(await OrganisationNameAsync(c), c.Title, d.DonorName, d.Amount, d.Currency,
            d.PaidDate ?? d.CreatedDate, d.MerchantOrderId, d.GatewayPaymentId, d.Message,
            await TemplateAsync(c.ScopeType == "club", c.ScopeId)));
    }

    /// <summary>A sample receipt with this scope's template, for the editor's preview.</summary>
    public async Task<byte[]> SampleReceiptAsync(bool isClub, int scopeId, DonationReceiptTemplate template) =>
        DonationReceiptPdfBuilder.Build(new DonationReceipt(
            await OrganisationNameAsync(new DonationCampaignRow { ScopeType = Scope(isClub), ScopeId = scopeId }),
            "Sample campaign", "Sample Donor", 100m, await ResolveCurrencyAsync(isClub, scopeId), DateTime.UtcNow,
            "DON0_sample", null, null, template));

    public async Task<DonationReceiptTemplate> TemplateAsync(bool isClub, int scopeId)
    {
        await using var conn = Conn();
        return await conn.QueryFirstOrDefaultAsync<DonationReceiptTemplate>(@"
            SELECT legal_name AS LegalName, tax_statement AS TaxStatement, body AS Body, signatory_name AS SignatoryName,
                   signatory_title AS SignatoryTitle
            FROM donation_receipt_templates WHERE scope_type = @Scope AND scope_id = @Id",
            new { Scope = Scope(isClub), Id = scopeId }) ?? new DonationReceiptTemplate();
    }

    public async Task SaveTemplateAsync(bool isClub, int scopeId, DonationReceiptTemplate t, int memberId)
    {
        static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            INSERT INTO donation_receipt_templates (scope_type, scope_id, legal_name, tax_statement, body, signatory_name,
                signatory_title, modified_by, modified_date)
            VALUES (@Scope, @Id, @LegalName, @TaxStatement, @Body, @SignatoryName, @SignatoryTitle, @MemberId, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE legal_name = VALUES(legal_name), tax_statement = VALUES(tax_statement), body = VALUES(body),
                signatory_name = VALUES(signatory_name), signatory_title = VALUES(signatory_title),
                modified_by = VALUES(modified_by), modified_date = UTC_TIMESTAMP()",
            new { Scope = Scope(isClub), Id = scopeId, LegalName = Clean(t.LegalName), TaxStatement = Clean(t.TaxStatement),
                  Body = Clean(t.Body), SignatoryName = Clean(t.SignatoryName), SignatoryTitle = Clean(t.SignatoryTitle), MemberId = memberId });
    }

    private async Task SendThankYouAsync(long donationId)
    {
        await using var conn = Conn();
        var d = await conn.QueryFirstOrDefaultAsync<DonationRow>(DonationSelect + " WHERE pk_donation_id = @Id", new { Id = donationId });
        if (d == null) return;
        var c = await GetAsync(d.CampaignId);
        if (c == null) return;
        var pdf = await ReceiptAsync(d);
        var org = WebUtility.HtmlEncode(await OrganisationNameAsync(c));
        var body = $@"<p>Dear {WebUtility.HtmlEncode(d.DonorName)},</p>
<p>Thank you for your donation of {d.Amount.ToString("0.00", CultureInfo.InvariantCulture)} {d.Currency} to
<strong>{WebUtility.HtmlEncode(c.Title)}</strong>. Your receipt is attached.</p>
<p>With thanks,<br>{org}</p>";
        await _email.SendScopedEmailWithAttachmentAsync(d.DonorEmail, $"Thank you for your donation to {c.Title}", body, pdf!,
            $"donation-receipt-{d.MerchantOrderId}.pdf", null,
            c.ScopeType == "club" ? c.ScopeId : null, c.ScopeType == "district" ? c.ScopeId : null, "donation_receipt");
    }

    // ===== The app =====

    /// <summary>Open campaigns of the member's active clubs and those clubs' districts.</summary>
    public async Task<List<DonationCampaignRow>> ForMemberAsync(int memberId)
    {
        await using var conn = Conn();
        var rows = (await conn.QueryAsync<DonationCampaignRow>(CampaignSelect + @"
            WHERE c.isdeleted = 0 AND (
                (c.scope_type = 'club' AND c.scope_id IN (SELECT cm.fk_club_id FROM club_members cm
                    WHERE cm.fk_member_master_profile_id = @M AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0))
             OR (c.scope_type = 'district' AND c.scope_id IN (SELECT cl.fk_district_id FROM club_members cm
                    JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id
                    WHERE cm.fk_member_master_profile_id = @M AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0)))
            ORDER BY c.pk_campaign_id DESC", new { M = memberId })).ToList();
        return rows.Where(r => DonationRules.IsOpen(r, DateTime.UtcNow)).ToList();
    }
}

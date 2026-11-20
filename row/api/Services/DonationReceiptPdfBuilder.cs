using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace RotaryApi.Services;

public sealed record DonationReceipt(string OrganisationName, string CampaignTitle, string DonorName, decimal Amount, string Currency,
    DateTime PaidUtc, string OrderId, string? GatewayPaymentId, string? Message, DonationReceiptTemplate? Template = null);

/// <summary>
/// The editable letter of a club's or district's donation receipts (table donation_receipt_templates). Body takes
/// placeholders such as {donor_name}; TaxStatement is the tax line the club's country needs (for example a charity
/// registration or deduction note). Empty fields fall back to the defaults below.
/// </summary>
public sealed class DonationReceiptTemplate
{
    public const string DefaultBody =
        "Dear {donor_name},\n\nOn behalf of {organisation}, thank you for your gift of {amount} {currency} to {campaign}, " +
        "received on {date}. Your generosity helps us serve our community.\n\nPlease keep this letter as the receipt for your donation.";

    public static readonly string[] Placeholders =
        { "donor_name", "amount", "currency", "campaign", "date", "receipt_number", "organisation" };

    public string? LegalName { get; set; }
    public string? TaxStatement { get; set; }
    public string? Body { get; set; }
    public string? SignatoryName { get; set; }
    public string? SignatoryTitle { get; set; }

    /// <summary>Null when fine, else the message for the editor.</summary>
    public string? Validate()
    {
        if ((LegalName?.Length ?? 0) > 200) return "The organisation name is too long.";
        if ((TaxStatement?.Length ?? 0) > 1000) return "The tax statement is too long.";
        if ((Body?.Length ?? 0) > 5000) return "The letter is too long.";
        if ((SignatoryName?.Length ?? 0) > 150 || (SignatoryTitle?.Length ?? 0) > 150) return "The signatory is too long.";
        return null;
    }

    /// <summary>Replaces the known {placeholders}; any other braces stay as typed.</summary>
    public static string Render(string? body, IReadOnlyDictionary<string, string> values)
    {
        var text = string.IsNullOrWhiteSpace(body) ? DefaultBody : body;
        foreach (var (k, v) in values) text = text.Replace("{" + k + "}", v, StringComparison.OrdinalIgnoreCase);
        return text;
    }
}

/// <summary>Donor receipt PDF; same look as DuesReceiptPdfBuilder (navy band, meta table, footer line).</summary>
public static class DonationReceiptPdfBuilder
{
    private const string Navy = "#17458F";
    private const string Ink = "#1B2C42";
    private const string Border = "#D5DEE8";
    private const string FootBg = "#F7F9FC";
    private const string Muted = "#64748B";

    public static byte[] Build(DonationReceipt r)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false; // same opt-out as the dues receipt

        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(1.4f, Unit.Centimetre);
            page.DefaultTextStyle(x => x.FontFamily("Arial", "Segoe UI", "Nirmala UI").FontSize(10).FontColor(Ink).LineHeight(1.35f));

            var t = r.Template ?? new DonationReceiptTemplate();
            var org = string.IsNullOrWhiteSpace(t.LegalName) ? r.OrganisationName : t.LegalName.Trim();
            var amount = r.Amount.ToString("N2", CultureInfo.InvariantCulture);
            var date = r.PaidUtc.ToString("dd-MMM-yyyy", CultureInfo.InvariantCulture);
            var letter = DonationReceiptTemplate.Render(t.Body, new Dictionary<string, string>
            {
                ["donor_name"] = r.DonorName, ["amount"] = amount, ["currency"] = r.Currency, ["campaign"] = r.CampaignTitle,
                ["date"] = date, ["receipt_number"] = r.OrderId, ["organisation"] = org,
            });
            var logo = BrandAssets.PdfLogoOnDark;
            page.Header().Background(Navy).PaddingVertical(12).PaddingHorizontal(20).Column(h =>
            {
                h.Spacing(6);
                if (logo != null) h.Item().AlignCenter().Height(48).Image(logo).FitHeight();
                h.Item().AlignCenter().Text(org).FontColor(Colors.White).Bold().FontSize(15);
            });

            page.Content().PaddingTop(16).Column(col =>
            {
                col.Spacing(6);
                col.Item().Text("Donation Receipt").Bold().FontSize(16).FontColor(Navy);
                foreach (var para in letter.Replace("\r", "").Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
                    col.Item().PaddingBottom(4).Text(para.Trim());
                col.Item().PaddingTop(8).Table(tb =>
                {
                    tb.ColumnsDefinition(c => { c.ConstantColumn(150); c.RelativeColumn(); });
                    void Row(string label, string? value)
                    {
                        if (string.IsNullOrWhiteSpace(value)) return;
                        tb.Cell().Border(0.7f).BorderColor(Border).Padding(6).Text(label).Bold();
                        tb.Cell().Border(0.7f).BorderColor(Border).Padding(6).Text(value);
                    }
                    Row("Donor Name", r.DonorName);
                    Row("Campaign", r.CampaignTitle);
                    Row("Amount", $"{amount} {r.Currency}");
                    Row("Date and Time (UTC)", r.PaidUtc.ToString("dd-MMM-yyyy hh:mm tt", CultureInfo.InvariantCulture));
                    Row("Receipt Number", r.OrderId);
                    Row("Transaction ID", r.GatewayPaymentId);
                    Row("Message", r.Message);
                });
                if (!string.IsNullOrWhiteSpace(t.TaxStatement))
                    col.Item().PaddingTop(10).Text(t.TaxStatement.Trim()).FontSize(9);
                if (!string.IsNullOrWhiteSpace(t.SignatoryName))
                {
                    col.Item().PaddingTop(24).Text(t.SignatoryName.Trim()).Bold();
                    if (!string.IsNullOrWhiteSpace(t.SignatoryTitle)) col.Item().Text(t.SignatoryTitle.Trim());
                    col.Item().Text(org).FontColor(Muted);
                }
                col.Item().PaddingTop(10).Text($"Generated on {DateTime.UtcNow.ToString("dd-MMM-yyyy", CultureInfo.InvariantCulture)}")
                    .FontSize(8).FontColor(Muted);
            });

            page.Footer().Background(FootBg).PaddingVertical(9).PaddingHorizontal(16).AlignCenter().Text(ft =>
            {
                ft.DefaultTextStyle(s => s.FontSize(8).FontColor(Muted).Italic());
                ft.Span("This is generated by ");
                ft.Span(org).Bold();
            });
        })).GeneratePdf();
    }
}

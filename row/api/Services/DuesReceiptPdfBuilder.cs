using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// PDF rendering of the membership-dues payment receipt for the mobile app.
// Mirrors the HTML receipt e-mail (MembershipDuesService.SendReceiptEmailAsync):
// same navy header band, same "Payment Receipt" heading, same meta rows, the
// same 7-column fee table and the same footer line. Nothing is added that the
// e-mail does not already show.
//
// The e-mail header pulls a REMOTE logo image (club logo, else the shared
// ROW brand logo). This builder uses the ROW logo built into the API
// (BrandAssets) instead — a PDF generated inside a request must not depend on
// an outbound HTTP fetch that can stall or fail. Colours/wording are unchanged.
public static class DuesReceiptPdfBuilder
{
    private static bool _licensed;

    // Same palette as the receipt e-mail markup.
    private const string Navy = "#1A365D";   // header band + headings
    private const string Ink = "#333333";    // body text
    private const string Border = "#DDDDDD"; // table borders
    private const string HeadBg = "#F3F4F6"; // table header fill
    private const string FootBg = "#F8F9FA"; // footer fill
    private const string Muted = "#666666";

    public static byte[] Build(DuesReceiptDto r)
    {
        if (!_licensed)
        {
            QuestPDF.Settings.License = LicenseType.Community;
            // The amounts carry the ₹ (U+20B9) sign, exactly as in the receipt
            // e-mail. QuestPDF's glyph check THROWS when the chosen font has no
            // glyph for a character, which would turn a missing rupee sign into
            // a 500 on a server whose Arial predates U+20B9. Same opt-out that
            // ProjectShareCardBuilder already uses.
            QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
            _licensed = true;
        }

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(1.4f, Unit.Centimetre);
                // Arial to match the e-mail's font stack. The fallback chain
                // exists for the ₹ (U+20B9) sign in the amount columns: older
                // Arial builds predate it, and Segoe UI / Nirmala UI both carry
                // it on any Windows host. Without a fallback a missing glyph
                // would print as a tofu box next to every amount.
                page.DefaultTextStyle(x => x
                    .FontFamily("Arial", "Segoe UI", "Nirmala UI")
                    .FontSize(10).FontColor(Ink).LineHeight(1.35f));

                // ── Header band (mirrors the e-mail's navy bar): ROW logo, then the organisation name ──
                var logo = BrandAssets.PdfLogoOnDark;
                page.Header().Background(Navy).PaddingVertical(12).PaddingHorizontal(20).Column(h =>
                {
                    h.Spacing(6);
                    if (logo != null)
                        h.Item().AlignCenter().Height(48).Image(logo).FitHeight();
                    h.Item().AlignCenter().Text(r.OrganisationName)
                        .FontColor(Colors.White).Bold().FontSize(15);
                });

                page.Content().PaddingTop(16).Column(col =>
                {
                    col.Spacing(6);

                    col.Item().Text(r.DocumentTitle).Bold().FontSize(16).FontColor(Navy);
                    col.Item().Text($"Dear {r.MemberName},");
                    col.Item().Text("Thank you for your payment. Here are the details:");

                    // ── Meta table — same rows/labels/order as the e-mail ──
                    col.Item().PaddingTop(8).Table(t =>
                    {
                        t.ColumnsDefinition(c => { c.ConstantColumn(150); c.RelativeColumn(); });

                        void Row(string label, string? value)
                        {
                            // The e-mail omits any meta row whose value is blank
                            // (AddRow skips empties) — do the same here.
                            if (string.IsNullOrWhiteSpace(value)) return;
                            t.Cell().Border(0.7f).BorderColor(Border).Padding(6).Text(label).Bold();
                            t.Cell().Border(0.7f).BorderColor(Border).Padding(6).Text(value);
                        }

                        Row("Member Name", r.MemberName);
                        Row("District Number", r.DistrictNumber);
                        Row("Club Name", r.ClubName);
                        Row("Purpose", r.Purpose);
                        Row("Status", r.Status);
                        Row("Date and Time", r.PaymentDateTime);
                        Row("Approver's Remark", r.ApproverRemark);
                    });

                    // ── Fees table — same 7 columns as the e-mail ──
                    col.Item().PaddingTop(10).Text("Fees").Bold().FontSize(12).FontColor(Navy);

                    col.Item().Table(t =>
                    {
                        t.ColumnsDefinition(c =>
                        {
                            c.ConstantColumn(34);   // Sr No
                            c.RelativeColumn(2.0f); // Fee Type
                            c.RelativeColumn(1.3f); // Amount
                            c.RelativeColumn(1.1f); // Mode
                            c.RelativeColumn(1.6f); // Gateway Charges
                            c.RelativeColumn(1.6f); // Payment Date
                            c.RelativeColumn(3.0f); // Transaction ID
                        });

                        void Head(string text, bool right = false)
                        {
                            var cell = t.Cell().Background(HeadBg).Border(0.7f).BorderColor(Border).Padding(5);
                            var span = right ? cell.AlignRight().Text(text) : cell.Text(text);
                            span.Bold().FontSize(8.5f);
                        }

                        Head("Sr No");
                        Head("Fee Type");
                        Head("Amount", right: true);
                        Head("Mode");
                        Head("Payment Gateway Charges", right: true);
                        Head("Payment Date");
                        Head("Transaction ID");

                        foreach (var f in r.Fees)
                        {
                            void Cell(string text, bool right = false)
                            {
                                var cell = t.Cell().Border(0.7f).BorderColor(Border).Padding(5);
                                var span = right ? cell.AlignRight().Text(text) : cell.Text(text);
                                span.FontSize(8.5f);
                            }

                            Cell(f.SrNo.ToString());
                            Cell(f.FeeTypeLabel);
                            Cell(f.AmountText, right: true);
                            Cell(f.Mode);
                            Cell(f.GatewayChargesText, right: true);
                            Cell(f.PaymentDate);
                            Cell(f.TransactionId);
                        }
                    });

                    if (r.Fees.Count == 0)
                        col.Item().PaddingTop(4).Text("No paid fees recorded for this dues allocation.")
                            .Italic().FontColor(Muted).FontSize(9);

                    col.Item().PaddingTop(10).Text($"Generated on {r.GeneratedOn}").FontSize(8).FontColor(Muted);
                });

                // ── Footer — same wording as the e-mail footer ──
                page.Footer().Background(FootBg).PaddingVertical(9).PaddingHorizontal(16)
                    .AlignCenter().Text(t =>
                    {
                        t.DefaultTextStyle(s => s.FontSize(8).FontColor(Muted).Italic());
                        t.Span("This is generated by ");
                        t.Span(r.OrganisationName).Bold();
                    });
            });
        }).GeneratePdf();
    }
}

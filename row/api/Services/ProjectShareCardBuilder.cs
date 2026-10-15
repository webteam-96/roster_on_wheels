using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace RotaryApi.Services;

// Data the share card needs. Everything is pre-truncated/normalised by the caller
// (PublicProjectShareController) so this file only lays pixels out.
public sealed class ProjectShareCardData
{
    public string Title { get; set; } = "";
    public string ClubDisplayName { get; set; } = "";   // "Rotary Club of Burhanpur"
    public string DistrictNumber { get; set; } = "";    // "3040"
    public string? AreaOfFocus { get; set; }            // eyebrow line ("Disease prevention and treatment")
    public string Summary { get; set; } = "";           // truncated description
    public string FooterHost { get; set; } = "";        // host of the share URL ("club.example.org")
    public byte[]? PhotoBytes { get; set; }             // primary project photo, or null
}

// Renders the 1200x630 social-preview ("Open Graph") card for a project share link.
//
// WHY QuestPDF: the repo already ships QuestPDF 2026.6.1 for the CMR PDF export, and that
// package bundles its own native Skia binaries (runtimes/{win,linux,osx}-*/native/QuestPdfSkia)
// plus the Lato font. GenerateImages() rasterises a page straight to PNG, so a share image
// needs NO new NuGet dependency — no SkiaSharp, no ImageSharp, no System.Drawing.
//
// 1200x630 at 72 DPI => a page sized 1200x630 points rasterises to exactly 1200x630 px, which
// is the standard OG/Twitter "summary_large_image" ratio (1.91:1) that WhatsApp, Facebook,
// LinkedIn and X all crop from.
public static class ProjectShareCardBuilder
{
    private const string Navy = "#0B2C5E";     // Rotary "Royal Blue" family — matches the public site
    private const string NavyDeep = "#08203F";
    private const string Gold = "#C8A64B";
    private const string Ink = "#1A1A1A";
    private const string Muted = "#5A6472";
    private const string Paper = "#FFFFFF";

    private const int CardWidth = 1200;
    private const int CardHeight = 630;
    private const int PhotoPanelWidth = 470;

    private static bool _init;

    private static void EnsureInit()
    {
        if (_init) return;
        QuestPDF.Settings.License = LicenseType.Community;
        // Club names / descriptions carry Devanagari, Gujarati, Tamil, Sinhala… Lato has no
        // glyphs for those, and with this check ON QuestPDF throws instead of rendering. A share
        // card must never 500 because of a script it can't draw — fall back to whatever the OS
        // font stack can supply (Settings.UseEnvironmentFonts stays at its default: true).
        // Relaxing a throw can't break the existing CMR PDF export, which never relied on it.
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
        _init = true;
    }

    public static byte[] Render(ProjectShareCardData d)
    {
        EnsureInit();

        var photo = LooksLikeImage(d.PhotoBytes) ? d.PhotoBytes : null;

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(new PageSize(CardWidth, CardHeight));
                page.Margin(0);
                page.PageColor(Paper);
                page.DefaultTextStyle(t => t.FontFamily("Lato").FontColor(Ink));

                page.Content().Column(outer =>
                {
                    outer.Item().Height(CardHeight - 12).Row(row =>
                    {
                        // ── Left: the project's primary photo on a navy mat ───────────
                        row.ConstantItem(PhotoPanelWidth).Background(Navy).Element(cell =>
                        {
                            if (photo != null)
                            {
                                // FitArea letterboxes onto the navy mat rather than distorting
                                // the photo — project photos arrive at every aspect ratio.
                                cell.AlignMiddle().AlignCenter().Image(photo).FitArea();
                            }
                            else
                            {
                                cell.Background(NavyDeep).AlignMiddle().AlignCenter().Padding(40).Column(c =>
                                {
                                    c.Item().AlignCenter().Text("ROTARY")
                                        .FontSize(58).Bold().FontColor("#FFFFFF").LetterSpacing(0.18f);
                                    c.Item().PaddingTop(14).AlignCenter().Width(150).Height(4).Background(Gold);
                                    c.Item().PaddingTop(16).AlignCenter().Text("SERVICE PROJECT")
                                        .FontSize(16).SemiBold().FontColor(Gold).LetterSpacing(0.26f);
                                });
                            }
                        });

                        // ── Right: the words ──────────────────────────────────────────
                        // AlignMiddle keeps a short headline optically centred against the photo
                        // panel instead of stranding it at the top of a 630px column.
                        row.RelativeItem().Background(Paper).PaddingVertical(44).PaddingHorizontal(52)
                           .AlignMiddle().Column(col =>
                        {
                            if (!string.IsNullOrWhiteSpace(d.AreaOfFocus))
                            {
                                col.Item().Text(d.AreaOfFocus!.ToUpperInvariant())
                                    .FontSize(15).SemiBold().FontColor(Gold).LetterSpacing(0.2f);
                                col.Item().PaddingTop(14);
                            }

                            col.Item().Text(d.Title)
                                .FontSize(TitleFontSize(d.Title)).Bold().FontColor(Navy).LineHeight(1.14f);

                            col.Item().PaddingTop(20).Width(96).Height(5).Background(Gold);

                            col.Item().PaddingTop(20).Text(d.ClubDisplayName)
                                .FontSize(22).SemiBold().FontColor(Ink);

                            if (!string.IsNullOrWhiteSpace(d.DistrictNumber))
                            {
                                col.Item().PaddingTop(5).Text($"Rotary International District {d.DistrictNumber}")
                                    .FontSize(17).FontColor(Muted);
                            }

                            if (!string.IsNullOrWhiteSpace(d.Summary))
                            {
                                col.Item().PaddingTop(20).Text(d.Summary)
                                    .FontSize(16.5f).FontColor(Muted).LineHeight(1.42f);
                            }

                            if (!string.IsNullOrWhiteSpace(d.FooterHost))
                            {
                                col.Item().PaddingTop(22).Text(d.FooterHost)
                                    .FontSize(14).SemiBold().FontColor(Navy).LetterSpacing(0.06f);
                            }
                        });
                    });

                    // Gold rule across the foot of the card.
                    outer.Item().Height(12).Background(Gold);
                });
            });
        });

        var settings = new ImageGenerationSettings
        {
            ImageFormat = QuestPDF.Infrastructure.ImageFormat.Png,
            RasterDpi = 72,                                   // 1 pt == 1 px => exactly 1200x630
            ImageCompressionQuality = ImageCompressionQuality.High,
        };

        // Content is pre-truncated to fit, but if a pathological string still overflows QuestPDF
        // paginates instead of throwing — take page 1, which is the 1200x630 card.
        return doc.GenerateImages(settings).First();
    }

    // Long titles step down so a 3-line headline still fits the right-hand column.
    private static float TitleFontSize(string title) => title.Length switch
    {
        <= 38 => 46f,
        <= 60 => 40f,
        <= 84 => 34f,
        _ => 29f,
    };

    private static bool LooksLikeImage(byte[]? b)
    {
        if (b == null || b.Length < 12) return false;
        if (b[0] == 0xFF && b[1] == 0xD8) return true;                                   // JPEG
        if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return true;   // PNG
        if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return true;                   // GIF
        if (b[0] == 0x42 && b[1] == 0x4D) return true;                                   // BMP
        if (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 &&              // RIFF....WEBP
            b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return true;
        return false;
    }
}

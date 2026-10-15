using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;

namespace RotaryApi.Services;

/// <summary>
/// The ROW logo as the first, centred paragraph of a Word report. Uses the logo built into the API
/// (<see cref="BrandAssets.PdfLogo"/>), so building a report never waits on a download.
/// </summary>
public static class WordBrandLogo
{
    // Drawing ids only need to be unique inside one document; photos count up from 1.
    private const uint LogoDrawingId = 9001;
    private const long LogoHeightEmu = 685800;   // 0.75 inch

    /// <summary>Adds the logo image to <paramref name="main"/> and returns its paragraph, or null when no logo is available.</summary>
    public static Paragraph? Paragraph(MainDocumentPart main)
    {
        var bytes = BrandAssets.PdfLogo;
        if (bytes == null || bytes.Length == 0) return null;

        var isPng = bytes.Length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
        string relId;
        try
        {
            var part = main.AddImagePart(isPng ? ImagePartType.Png : ImagePartType.Jpeg);
            using (var stream = new MemoryStream(bytes)) part.FeedData(stream);
            relId = main.GetIdOfPart(part);
        }
        catch { return null; }

        var (w, h) = ClubMonthlyReportWordBuilder.ReadImageSize(bytes);
        long cy = LogoHeightEmu;
        long cx = h > 0 ? (long)(cy * (double)w / h) : cy * 2;

        var drawing = new Drawing(
            new DW.Inline(
                new DW.Extent { Cx = cx, Cy = cy },
                new DW.EffectExtent { LeftEdge = 0L, TopEdge = 0L, RightEdge = 0L, BottomEdge = 0L },
                new DW.DocProperties { Id = LogoDrawingId, Name = "Logo" },
                new DW.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoChangeAspect = true }),
                new A.Graphic(new A.GraphicData(
                    new PIC.Picture(
                        new PIC.NonVisualPictureProperties(
                            new PIC.NonVisualDrawingProperties { Id = LogoDrawingId, Name = "Logo" },
                            new PIC.NonVisualPictureDrawingProperties()),
                        new PIC.BlipFill(new A.Blip { Embed = relId }, new A.Stretch(new A.FillRectangle())),
                        new PIC.ShapeProperties(
                            new A.Transform2D(new A.Offset { X = 0L, Y = 0L }, new A.Extents { Cx = cx, Cy = cy }),
                            new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle }))
                ) { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" })
            ) { DistanceFromTop = 0U, DistanceFromBottom = 0U, DistanceFromLeft = 0U, DistanceFromRight = 0U });

        return new Paragraph(
            new ParagraphProperties(new Justification { Val = JustificationValues.Center }, new SpacingBetweenLines { Before = "0", After = "160" }),
            new Run(drawing));
    }
}

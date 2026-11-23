using DocumentFormat.OpenXml.Packaging;
using RotaryApi.Services;
using SkiaSharp;
using Xunit;

namespace RotaryApi.Tests;

// Word reports embed print-size copies of photos (Club / OCV reports were ~16 MB, QA 2026-11-23).
public class WordImageShrinkTests
{
    private static byte[] Jpeg(int w, int h)
    {
        using var bmp = new SKBitmap(w, h);
        using (var canvas = new SKCanvas(bmp))
        {
            var rnd = new Random(1);
            for (var i = 0; i < 400; i++)  // noise, so the JPEG is photo-sized rather than one flat colour
                canvas.DrawRect(rnd.Next(w), rnd.Next(h), 80, 80, new SKPaint { Color = new SKColor((byte)rnd.Next(256), (byte)rnd.Next(256), (byte)rnd.Next(256)) });
        }
        using var img = SKImage.FromBitmap(bmp);
        return img.Encode(SKEncodedImageFormat.Jpeg, 95).ToArray();
    }

    [Fact]
    public void Large_photo_is_capped_at_1600px_and_gets_smaller()
    {
        var big = Jpeg(4000, 3000);
        var (bytes, type) = ClubMonthlyReportWordBuilder.ShrinkForWord(big, ImagePartType.Jpeg);
        var (w, h) = ClubMonthlyReportWordBuilder.ReadImageSize(bytes);
        Assert.True(Math.Max(w, h) <= 1600, $"{w}x{h}");
        Assert.True(bytes.Length < big.Length);
        Assert.Equal(ImagePartType.Jpeg.ContentType, type.ContentType);
    }

    [Fact]
    public void Small_or_unreadable_images_pass_through()
    {
        var garbage = new byte[] { 1, 2, 3, 4 };
        var (bytes, type) = ClubMonthlyReportWordBuilder.ShrinkForWord(garbage, ImagePartType.Png);
        Assert.Same(garbage, bytes);
        Assert.Equal(ImagePartType.Png.ContentType, type.ContentType);
    }
}

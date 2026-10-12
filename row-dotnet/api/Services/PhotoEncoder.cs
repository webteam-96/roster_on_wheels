using SkiaSharp;

namespace RotaryApi.Services;

// The photo re-encoding rules, with no ASP.NET dependency so the same file is also compiled into
// the PhotoCompressTool that shrinks photos already on disk (one set of rules, same quality):
//
//   * longest side capped at 2560 px (never enlarged) - sharper than a full-HD big screen
//   * saved as JPEG quality 88 - visually identical, no blur
//   * the phone's rotation (EXIF orientation) is applied before saving, so nothing turns sideways
//   * PNG/WEBP with real transparency (logos) stay in their own format, only resized if huge
//   * the new bytes are returned only if clearly smaller (or the photo had to be resized);
//     otherwise, and on ANY decode/encode failure, null = keep the original
public static class PhotoEncoder
{
    public const int MaxEdge = 2560;
    public const int JpegQuality = 88;

    public sealed record Encoded(byte[] Bytes, string Extension, string ContentType, int Width, int Height);

    public static Encoded? Encode(byte[] original, string extension, int quality = JpegQuality, int maxEdge = MaxEdge)
    {
        try
        {
            string ext = (extension ?? "").ToLowerInvariant();
            using var data = SKData.CreateCopy(original);
            using var codec = SKCodec.Create(data);
            if (codec == null) return null;

            var info = codec.Info;
            if (info.Width <= 0 || info.Height <= 0) return null;

            int longest = Math.Max(info.Width, info.Height);
            bool resize = longest > maxEdge;
            float scale = resize ? (float)maxEdge / longest : 1f;
            int targetW = Math.Max(1, (int)Math.Round(info.Width * scale));
            int targetH = Math.Max(1, (int)Math.Round(info.Height * scale));

            // Decode (for big JPEGs let the codec downsample while decoding - saves memory/CPU,
            // but only when the result is still at least the target size, so we never upscale).
            var alpha = info.AlphaType == SKAlphaType.Opaque ? SKAlphaType.Opaque : SKAlphaType.Premul;
            var decodeInfo = info.WithColorType(SKColorType.Rgba8888).WithAlphaType(alpha);
            if (resize)
            {
                var sz = codec.GetScaledDimensions(scale);
                if (sz.Width >= targetW && sz.Height >= targetH && sz.Width < info.Width)
                    decodeInfo = decodeInfo.WithSize(sz.Width, sz.Height);
            }

            using var decoded = new SKBitmap(decodeInfo);
            var rc = codec.GetPixels(decodeInfo, decoded.GetPixels());
            if (rc != SKCodecResult.Success && rc != SKCodecResult.IncompleteInput) return null;

            bool transparent = alpha != SKAlphaType.Opaque && HasRealTransparency(decoded);

            SKBitmap working = decoded;
            SKBitmap? scaled = null;
            SKBitmap? rotated = null;
            try
            {
                if (decoded.Width != targetW || decoded.Height != targetH)
                {
                    scaled = decoded.Resize(new SKImageInfo(targetW, targetH, decodeInfo.ColorType, decodeInfo.AlphaType, decodeInfo.ColorSpace),
                        new SKSamplingOptions(SKCubicResampler.Mitchell));
                    if (scaled == null) return null;
                    working = scaled;
                }

                rotated = ApplyOrigin(working, codec.EncodedOrigin);
                if (rotated != null) working = rotated;

                SKEncodedImageFormat format;
                string newExt, contentType;
                if (!transparent)
                {
                    format = SKEncodedImageFormat.Jpeg; newExt = ".jpg"; contentType = "image/jpeg";
                }
                else
                {
                    // Transparent logo: only worth re-saving if it had to be shrunk.
                    if (!resize) return null;
                    if (ext == ".webp") { format = SKEncodedImageFormat.Webp; newExt = ".webp"; contentType = "image/webp"; }
                    else                { format = SKEncodedImageFormat.Png;  newExt = ".png";  contentType = "image/png"; }
                }

                using var encoded = working.Encode(format, quality);
                if (encoded == null) return null;
                var bytes = encoded.ToArray();

                // Keep the new file only if it is clearly smaller, or it was shrunk to 2560 px.
                bool worthIt = bytes.Length < original.Length * 0.9 || (resize && bytes.Length < original.Length);
                if (!worthIt) return null;

                return new Encoded(bytes, newExt, contentType, working.Width, working.Height);
            }
            finally
            {
                rotated?.Dispose();
                scaled?.Dispose();
            }
        }
        catch
        {
            return null;   // never fail because of optimisation
        }
    }

    // A PNG/WEBP may carry an alpha channel that is fully opaque (screenshots, cropped photos);
    // only a pixel with alpha < 255 means the transparency must be preserved.
    private static bool HasRealTransparency(SKBitmap bmp)
    {
        var span = bmp.GetPixelSpan();
        for (int i = 3; i < span.Length; i += 4)
            if (span[i] != 255) return true;
        return false;
    }

    // Bakes the camera's EXIF orientation into the pixels (JPEG re-encode drops the EXIF tag,
    // so without this a portrait phone photo would be saved sideways). Returns null when no
    // rotation/flip is needed. w/h below are the OUTPUT dimensions.
    private static SKBitmap? ApplyOrigin(SKBitmap src, SKEncodedOrigin origin)
    {
        if (origin == SKEncodedOrigin.TopLeft) return null;

        bool swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
                           or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        int w = swap ? src.Height : src.Width;
        int h = swap ? src.Width : src.Height;

        var dst = new SKBitmap(new SKImageInfo(w, h, src.ColorType, src.AlphaType, src.ColorSpace));
        using var canvas = new SKCanvas(dst);
        switch (origin)
        {
            case SKEncodedOrigin.TopRight:    canvas.Translate(w, 0); canvas.Scale(-1, 1); break;                          // mirror
            case SKEncodedOrigin.BottomRight: canvas.Translate(w, h); canvas.RotateDegrees(180); break;                     // 180
            case SKEncodedOrigin.BottomLeft:  canvas.Translate(0, h); canvas.Scale(1, -1); break;                          // flip
            case SKEncodedOrigin.LeftTop:     canvas.RotateDegrees(90); canvas.Scale(1, -1); break;                        // transpose
            case SKEncodedOrigin.RightTop:    canvas.Translate(w, 0); canvas.RotateDegrees(90); break;                     // 90 CW
            case SKEncodedOrigin.RightBottom: canvas.Translate(w, h); canvas.RotateDegrees(90); canvas.Scale(-1, 1); break; // transverse
            case SKEncodedOrigin.LeftBottom:  canvas.Translate(0, h); canvas.RotateDegrees(270); break;                    // 90 CCW
            default: dst.Dispose(); return null;
        }
        canvas.DrawBitmap(src, 0, 0);
        canvas.Flush();
        return dst;
    }
}

using Microsoft.AspNetCore.Http;
using SkiaSharp;

namespace RotaryApi.Services;

// Server-side image compression for uploads that arrive UNCOMPRESSED — e.g. the
// mobile app, which (unlike the web frontend) does not shrink photos on the client
// before upload. Mirrors the web's client-side behaviour: a raster photo over the
// size / dimension budget is downscaled + re-encoded to JPEG at an iteratively
// lowered quality until it fits within the target, so it then passes
// ImageQualityValidator (5 MB max) instead of being rejected.
//
// A photo already within budget is returned UNCHANGED (no decode / re-encode), so
// the web upload path — which already sends ≤ 5 MB JPEGs — is byte-for-byte
// unaffected. Any decode/encode failure also falls back to the original file, so
// this can only ever help, never block, an upload (the validator has the final say).
public static class ImageCompressor
{
    private const long DefaultMaxBytes     = 5 * 1024 * 1024;   // must match ImageQualityValidator.MaxBytes
    private const int  DefaultMaxDimension = 2560;              // longest-side cap applied only to oversized photos

    // Raster types we can decode + re-encode. (GIF is intentionally excluded — it may
    // be animated; re-encoding to a single JPEG frame would silently drop the animation.)
    private static readonly string[] Compressible = { ".jpg", ".jpeg", ".png", ".webp" };

    public static IFormFile EnsureWithinLimit(
        IFormFile file, long maxBytes = DefaultMaxBytes, int maxDimension = DefaultMaxDimension)
    {
        if (file == null || file.Length == 0) return file;

        // Already small enough → leave untouched (keeps the web path identical).
        if (file.Length <= maxBytes) return file;

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!Compressible.Contains(ext)) return file;   // non-raster → let the validator reject it

        try
        {
            using var input = file.OpenReadStream();
            using var original = SKBitmap.Decode(input);
            if (original == null) return file;           // undecodable → validator decides

            // Downscale so the longest side ≤ maxDimension (skip if already smaller).
            SKBitmap working = original;
            SKBitmap? scaled = null;
            int longest = Math.Max(original.Width, original.Height);
            if (longest > maxDimension)
            {
                float ratio = (float)maxDimension / longest;
                int w = Math.Max(1, (int)Math.Round(original.Width * ratio));
                int h = Math.Max(1, (int)Math.Round(original.Height * ratio));
                scaled = original.Resize(new SKImageInfo(w, h),
                    new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
                if (scaled != null) working = scaled;
            }

            using var image = SKImage.FromBitmap(working);
            byte[]? best = null;
            for (int quality = 90; quality >= 35; quality -= 10)
            {
                using var data = image.Encode(SKEncodedImageFormat.Jpeg, quality);
                best = data.ToArray();
                if (best.Length <= maxBytes) break;      // fits → done
            }
            scaled?.Dispose();

            // If even the lowest quality couldn't get under the limit, still return the
            // smallest JPEG we produced — it's far smaller than the original, and the
            // dimension cap keeps it reasonable. (Only pathological images reach here.)
            if (best == null || best.Length >= file.Length) return file;

            var newName = Path.GetFileNameWithoutExtension(file.FileName) + ".jpg";
            var ms = new MemoryStream(best);
            return new FormFile(ms, 0, best.Length, "file", newName)
            {
                Headers = new HeaderDictionary(),
                ContentType = "image/jpeg",
            };
        }
        catch
        {
            return file;   // any Skia failure → original; the validator makes the final call
        }
    }
}

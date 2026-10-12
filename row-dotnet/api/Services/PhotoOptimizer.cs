using Microsoft.AspNetCore.Http;

namespace RotaryApi.Services;

// Re-saves EVERY uploaded photo at a size that looks the same on screen but takes far less
// disk (project rule 2026-09-24: D: drive was filling at ~2.4 GB/day because photos under
// 5 MB were stored exactly as uploaded - 4 MB PNGs, full-size phone JPEGs).
// The rules themselves (2560 px, JPEG 88, rotation, transparency) live in PhotoEncoder, which
// the PhotoCompressTool for photos already on disk compiles too. GIF (may be animated), SVG,
// HEIC, PDF and office files are never touched; on any failure the original upload is kept.
//
// Called for every upload by PhotoUploadOptimizeFilter; ImageCompressor.EnsureWithinLimit
// still runs afterwards in the controllers that had it and is then a no-op.
public static class PhotoOptimizer
{
    public const int MaxEdge = PhotoEncoder.MaxEdge;
    public const int JpegQuality = PhotoEncoder.JpegQuality;

    private static readonly string[] Optimizable = { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };

    public sealed record Result(IFormFile File, bool Changed, long OldBytes, long NewBytes, int Width, int Height);

    public static bool IsOptimizable(IFormFile? file) =>
        file != null && file.Length > 0 &&
        Optimizable.Contains(Path.GetExtension(file.FileName ?? "").ToLowerInvariant());

    public static Result Optimize(IFormFile file)
    {
        var unchanged = new Result(file, false, file?.Length ?? 0, file?.Length ?? 0, 0, 0);
        if (!IsOptimizable(file)) return unchanged;

        try
        {
            byte[] original;
            using (var ms = new MemoryStream())
            {
                file.CopyTo(ms);
                original = ms.ToArray();
            }

            var enc = PhotoEncoder.Encode(original, Path.GetExtension(file.FileName));
            if (enc == null) return unchanged;

            var baseName = Path.GetFileNameWithoutExtension(file.FileName);
            if (string.IsNullOrWhiteSpace(baseName)) baseName = "photo";
            var outFile = new FormFile(new MemoryStream(enc.Bytes), 0, enc.Bytes.Length, file.Name, baseName + enc.Extension)
            {
                Headers = new HeaderDictionary(),
                ContentType = enc.ContentType,
            };
            return new Result(outFile, true, original.Length, enc.Bytes.Length, enc.Width, enc.Height);
        }
        catch
        {
            return unchanged;   // never block an upload because of optimisation
        }
    }
}

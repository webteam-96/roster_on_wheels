using System.Text;

namespace RotaryApi.Services;

// Validates uploaded photos for format + max size before they hit disk.
//
// Project rule (2026-06-10): NO minimum file size or dimensions. Frontend
// auto-compresses large photos to ≤ 5 MB. Server still enforces a max-size
// guard against tampered clients. `strict` is kept as a parameter for
// callsite compatibility but no longer enforces minimums.
//
// Dimensions are still read + returned so the caller can include them in
// responses for display purposes (preview info, quality chips). No external
// image library — headers parsed inline for JPEG / PNG / GIF / WEBP.
public static class ImageQualityValidator
{
    // Kept for legacy callers reading the constants — not used in validation gates.
    public const int MinWidth  = 0;
    public const int MinHeight = 0;
    public const long MinBytes = 0;
    public const long MaxBytes = 5 * 1024 * 1024;   // 5 MB — must match PHOTO_MAX_MB on the frontend

    public static readonly string[] DefaultAllowedExtensions =
        new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };

    public class ValidationResult
    {
        public bool Ok { get; set; }
        public string? Error { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public long SizeBytes { get; set; }
    }

    public static ValidationResult Validate(
        IFormFile file,
        bool strict,
        string[]? allowedExtensions = null,
        long? maxBytes = null)
    {
        var exts  = allowedExtensions ?? DefaultAllowedExtensions;
        var maxB  = maxBytes ?? MaxBytes;

        if (file == null || file.Length == 0)
            return new ValidationResult { Ok = false, Error = "No file uploaded." };

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!exts.Contains(ext))
            return new ValidationResult
            {
                Ok = false,
                Error = $"Invalid file type. Allowed: {string.Join(", ", exts.Select(e => e.TrimStart('.')))}.",
                SizeBytes = file.Length,
            };

        if (file.Length > maxB)
            return new ValidationResult
            {
                Ok = false,
                Error = $"File too large ({Math.Round(file.Length / (1024.0 * 1024), 1)} MB). Maximum {maxB / (1024 * 1024)} MB.",
                SizeBytes = file.Length,
            };

        var (width, height) = ReadDimensions(file, ext);

        // `strict` no longer gates anything — the format + max-size checks above
        // are now the only enforcement. Frontend auto-compression handles the
        // upper bound; lower bound is intentionally removed.
        _ = strict;

        return new ValidationResult
        {
            Ok = true,
            Width = width,
            Height = height,
            SizeBytes = file.Length,
        };
    }

    private static (int width, int height) ReadDimensions(IFormFile file, string extension)
    {
        try
        {
            using var stream = file.OpenReadStream();
            return extension switch
            {
                ".png"            => ReadPng(stream),
                ".gif"            => ReadGif(stream),
                ".webp"           => ReadWebp(stream),
                ".jpg" or ".jpeg" => ReadJpeg(stream),
                _                 => (0, 0),
            };
        }
        catch
        {
            return (0, 0);
        }
    }

    // PNG header: 8-byte signature, then IHDR chunk = 4-byte length + "IHDR" + 4-byte width + 4-byte height (big-endian).
    private static (int w, int h) ReadPng(Stream s)
    {
        var b = new byte[24];
        if (Fill(s, b) < 24) return (0, 0);
        if (b[0] != 0x89 || b[1] != 0x50 || b[2] != 0x4E || b[3] != 0x47) return (0, 0);
        int w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
        int h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
        return (w, h);
    }

    // GIF: "GIF87a" / "GIF89a" (6 bytes) + 2-byte width + 2-byte height (little-endian).
    private static (int w, int h) ReadGif(Stream s)
    {
        var b = new byte[10];
        if (Fill(s, b) < 10) return (0, 0);
        if (b[0] != 'G' || b[1] != 'I' || b[2] != 'F') return (0, 0);
        int w = b[6] | (b[7] << 8);
        int h = b[8] | (b[9] << 8);
        return (w, h);
    }

    // WEBP: RIFF container with VP8 / VP8L / VP8X sub-chunks — each encodes dimensions differently.
    private static (int w, int h) ReadWebp(Stream s)
    {
        var b = new byte[30];
        if (Fill(s, b) < 30) return (0, 0);
        if (b[0] != 'R' || b[1] != 'I' || b[2] != 'F' || b[3] != 'F') return (0, 0);
        if (b[8] != 'W' || b[9] != 'E' || b[10] != 'B' || b[11] != 'P') return (0, 0);
        var chunk = Encoding.ASCII.GetString(b, 12, 4);
        if (chunk == "VP8 ")
        {
            // 14-bit width and height at offset 26 / 28
            int w = (b[26] | (b[27] << 8)) & 0x3FFF;
            int h = (b[28] | (b[29] << 8)) & 0x3FFF;
            return (w, h);
        }
        if (chunk == "VP8L")
        {
            // Signature byte 0x2F at offset 20, then 4 bytes packed dimensions (each is 14-bit + 1)
            int b1 = b[21], b2 = b[22], b3 = b[23], b4 = b[24];
            int w = (b1 | ((b2 & 0x3F) << 8)) + 1;
            int h = ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0F) << 10)) + 1;
            return (w, h);
        }
        if (chunk == "VP8X")
        {
            // 24-bit width-1 at offset 24, 24-bit height-1 at offset 27 (little-endian)
            int w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
            int h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
            return (w, h);
        }
        return (0, 0);
    }

    // JPEG: scan for SOF (Start of Frame) markers 0xFFC0-0xFFCF (except 0xFFC4/C8/CC).
    // Segment layout: marker (2) + length (2 BE) + precision (1) + height (2 BE) + width (2 BE).
    private static (int w, int h) ReadJpeg(Stream s)
    {
        try
        {
            int b1 = s.ReadByte(), b2 = s.ReadByte();
            if (b1 != 0xFF || b2 != 0xD8) return (0, 0);

            while (true)
            {
                int x;
                do { x = s.ReadByte(); if (x < 0) return (0, 0); } while (x != 0xFF);
                int marker;
                do { marker = s.ReadByte(); if (marker < 0) return (0, 0); } while (marker == 0xFF);

                if (marker == 0xD9 || marker == 0xDA) return (0, 0); // EOI / SOS — no SOF found

                if ((marker >= 0xC0 && marker <= 0xCF) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC)
                {
                    // skip 2-byte length + 1-byte precision
                    if (s.ReadByte() < 0 || s.ReadByte() < 0 || s.ReadByte() < 0) return (0, 0);
                    int hH = s.ReadByte(), hL = s.ReadByte();
                    int wH = s.ReadByte(), wL = s.ReadByte();
                    if (hH < 0 || hL < 0 || wH < 0 || wL < 0) return (0, 0);
                    return (w: (wH << 8) | wL, h: (hH << 8) | hL);
                }

                // Skip segment payload
                int lenHi = s.ReadByte(), lenLo = s.ReadByte();
                if (lenHi < 0 || lenLo < 0) return (0, 0);
                int len = (lenHi << 8) | lenLo;
                if (len < 2) return (0, 0);
                long skipped = 0, toSkip = len - 2;
                while (skipped < toSkip)
                {
                    int r = s.ReadByte();
                    if (r < 0) return (0, 0);
                    skipped++;
                }
            }
        }
        catch
        {
            return (0, 0);
        }
    }

    private static int Fill(Stream s, byte[] buf)
    {
        int total = 0;
        while (total < buf.Length)
        {
            int read = s.Read(buf, total, buf.Length - total);
            if (read <= 0) break;
            total += read;
        }
        return total;
    }
}

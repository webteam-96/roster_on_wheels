using System.Buffers.Binary;
using System.IO.Compression;
using Docnet.Core;
using Docnet.Core.Models;

namespace RotaryApi.Services;

// Renders PDF pages to PNG images using Docnet.Core (a self-contained PDFium wrapper — the
// native pdfium library ships inside the NuGet package's runtimes/ assets, so no external
// runtime like Ghostscript is needed). Used by the OCV Word report to embed PDF pages inline
// exactly like photos.
//
// PDFium is a single-threaded native library and DocLib.Instance is a process-wide singleton,
// so every render is serialised behind a lock. Every call is best-effort: a corrupt/encrypted
// PDF (or one bad page) yields fewer/zero pages rather than throwing, so one bad file can never
// sink the whole report.
public static class PdfRasterizer
{
    private static readonly object _gate = new();

    // Render at ~2x the PDF's native 72-dpi size (≈144 DPI). For a Letter/A4 page this is
    // ~1200-1250 px wide — sharp enough to read on screen, small enough to keep the .docx sane.
    private const double ScaleFactor = 2.0;

    /// <summary>
    /// Rasterises up to <paramref name="maxPages"/> pages to PNG bytes.
    /// Returns the rendered PNGs plus the document's TOTAL page count (so the caller can note
    /// "showing first N of M"). Returns an empty list (TotalPages 0) on any failure.
    /// </summary>
    public static (List<byte[]> Pages, int TotalPages) RenderToPngs(byte[] pdfBytes, int maxPages)
    {
        var pages = new List<byte[]>();
        if (pdfBytes == null || pdfBytes.Length == 0) return (pages, 0);

        lock (_gate)
        {
            int total = 0;
            try
            {
                var lib = DocLib.Instance; // singleton — do NOT dispose
                using var docReader = lib.GetDocReader(pdfBytes, new PageDimensions(ScaleFactor));
                total = docReader.GetPageCount();
                int count = Math.Min(total, Math.Max(0, maxPages));

                for (int i = 0; i < count; i++)
                {
                    try
                    {
                        using var pageReader = docReader.GetPageReader(i);
                        var raw = pageReader.GetImage(); // BGRA, top-down
                        int w = pageReader.GetPageWidth();
                        int h = pageReader.GetPageHeight();
                        if (raw == null || w <= 0 || h <= 0 || raw.Length < (long)w * h * 4) continue;
                        pages.Add(EncodePng(raw, w, h));
                    }
                    catch { /* skip one unrenderable page, keep the rest */ }
                }
            }
            catch (Exception ex)
            {
                // Corrupt / encrypted / not-a-PDF, or PDFium native lib unavailable — caller falls
                // back to the labelled entry. Diagnostic: the signature tells apart "not really a
                // PDF" (e.g. an HTML 404 body fetched from the media host) from a genuine PDFium
                // failure, and the message reveals a missing native lib vs. a bad document.
                var sig = pdfBytes.Length >= 5 ? System.Text.Encoding.ASCII.GetString(pdfBytes, 0, 5) : "?";
                Console.WriteLine($"[PdfRasterizer] render failed ({pdfBytes.Length} bytes, sig='{sig}'): {ex.GetType().Name}: {ex.Message}");
                return (new List<byte[]>(), 0);
            }

            if (pages.Count == 0 && total > 0)
                Console.WriteLine($"[PdfRasterizer] opened {total}-page PDF but rendered 0 pages ({pdfBytes.Length} bytes).");

            return (pages, total);
        }
    }

    // ── Minimal 24-bit-RGB PNG encoder ──
    // PDFium hands back BGRA with a transparent background; we composite each pixel over white
    // and emit opaque RGB. Self-contained: zlib IDAT via ZLibStream, hand-rolled CRC32.
    private static byte[] EncodePng(byte[] bgra, int w, int h)
    {
        // Raw image data: each scanline is [filter byte 0][R G B * w].
        var rawLen = h * (1 + w * 3);
        var raw = new byte[rawLen];
        int p = 0;
        for (int y = 0; y < h; y++)
        {
            raw[p++] = 0; // filter: none
            int rowBase = y * w * 4;
            for (int x = 0; x < w; x++)
            {
                int idx = rowBase + x * 4;
                int b = bgra[idx];
                int g = bgra[idx + 1];
                int r = bgra[idx + 2];
                int a = bgra[idx + 3];
                if (a != 255)
                {
                    // over white
                    r = (r * a + 255 * (255 - a)) / 255;
                    g = (g * a + 255 * (255 - a)) / 255;
                    b = (b * a + 255 * (255 - a)) / 255;
                }
                raw[p++] = (byte)r;
                raw[p++] = (byte)g;
                raw[p++] = (byte)b;
            }
        }

        // zlib-compressed IDAT payload.
        byte[] idat;
        using (var msZ = new MemoryStream())
        {
            using (var z = new ZLibStream(msZ, CompressionLevel.Optimal, leaveOpen: true))
                z.Write(raw, 0, raw.Length);
            idat = msZ.ToArray();
        }

        using var ms = new MemoryStream();
        ms.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, 0, 8); // signature

        // IHDR
        var ihdr = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(0, 4), w);
        BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4, 4), h);
        ihdr[8] = 8;  // bit depth
        ihdr[9] = 2;  // colour type: truecolour RGB
        ihdr[10] = 0; // compression
        ihdr[11] = 0; // filter
        ihdr[12] = 0; // interlace
        WriteChunk(ms, "IHDR", ihdr);
        WriteChunk(ms, "IDAT", idat);
        WriteChunk(ms, "IEND", Array.Empty<byte>());

        return ms.ToArray();
    }

    private static void WriteChunk(Stream s, string type, byte[] data)
    {
        Span<byte> len = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(len, data.Length);
        s.Write(len);

        var typeBytes = new[] { (byte)type[0], (byte)type[1], (byte)type[2], (byte)type[3] };
        s.Write(typeBytes, 0, 4);
        if (data.Length > 0) s.Write(data, 0, data.Length);

        uint crc = Crc32(typeBytes, data);
        Span<byte> crcb = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcb, crc);
        s.Write(crcb);
    }

    private static readonly uint[] _crcTable = BuildCrcTable();

    private static uint[] BuildCrcTable()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            uint c = n;
            for (int k = 0; k < 8; k++)
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }

    private static uint Crc32(byte[] a, byte[] b)
    {
        uint c = 0xFFFFFFFFu;
        foreach (var x in a) c = _crcTable[(c ^ x) & 0xFF] ^ (c >> 8);
        foreach (var x in b) c = _crcTable[(c ^ x) & 0xFF] ^ (c >> 8);
        return c ^ 0xFFFFFFFFu;
    }
}

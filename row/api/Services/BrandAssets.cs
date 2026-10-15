namespace RotaryApi.Services;

/// <summary>
/// The brand logo as image bytes for documents built on the server (PDF reports).
/// The ROW logo is embedded in the API (Resources/Brand), so a report never waits on a download.
/// <c>Brand:Look:PdfLogoPath</c> may point to another PNG/JPEG file on the server to replace it.
/// </summary>
public static class BrandAssets
{
    private static readonly Lazy<byte[]?> _logo = new(() => Load("Brand.row-logo.png"));
    private static readonly Lazy<byte[]?> _logoOnDark = new(() => Load("Brand.row-logo-badge.png"));

    /// <summary>Logo for a white background (transparent PNG). Null when no logo is available.</summary>
    public static byte[]? PdfLogo => Override() ?? _logo.Value;

    /// <summary>Logo for a dark background (the logo on a white card). Null when no logo is available.</summary>
    public static byte[]? PdfLogoOnDark => Override() ?? _logoOnDark.Value;

    private static byte[]? Override()
    {
        var path = Brand.PdfLogoPath;
        if (string.IsNullOrWhiteSpace(path)) return null;
        try { return File.Exists(path) ? File.ReadAllBytes(path) : null; }
        catch { return null; }
    }

    private static byte[]? Load(string resourceName)
    {
        using var stream = typeof(BrandAssets).Assembly.GetManifestResourceStream(resourceName);
        if (stream == null) return null;
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        return ms.ToArray();
    }
}

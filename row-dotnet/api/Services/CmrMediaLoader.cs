using Microsoft.AspNetCore.Hosting;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Resolves a project photo's bytes for embedding into the CMR Word/PDF exports.
// Disk-first (go-live layout, where files sit under the web root), then the configured
// media host (Media:RedirectBaseUrl — where /Documents/* is physically served).
// Best-effort: any failure leaves ImageBytes null so the caller simply omits the photo.
public static class CmrMediaLoader
{
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };

    public static async Task LoadAsync(IWebHostEnvironment env, string? redirectBase, CmrWordPhotoDto ph)
    {
        if (string.IsNullOrWhiteSpace(ph.ImagePath)) return;
        ph.ImageExtension = Path.GetExtension(ph.ImagePath).TrimStart('.').ToLowerInvariant();
        ph.ImageBytes = await LoadBytesAsync(env, redirectBase, ph.ImagePath);
    }

    // Same resolution for any web-root-relative media path (used by the OCV Word report).
    public static async Task<byte[]?> LoadBytesAsync(IWebHostEnvironment env, string? redirectBase, string? webPath)
    {
        if (string.IsNullOrWhiteSpace(webPath)) return null;
        try
        {
            var rel = webPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var root = env.WebRootPath;
            if (!string.IsNullOrEmpty(root))
            {
                var full = Path.Combine(root, rel);
                if (File.Exists(full)) return await File.ReadAllBytesAsync(full);
            }
            if (!string.IsNullOrWhiteSpace(redirectBase))
                return await _http.GetByteArrayAsync(redirectBase!.TrimEnd('/') + webPath);
        }
        catch { }
        return null;
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace RotaryApi.Controllers;

/// <summary>
/// Image host for the mass-email rich-text body (club + district both
/// share this). The editor used to inline pictures as base64 data-URIs, which email
/// clients (Gmail/Outlook/Yahoo) strip — so images never appeared in the received
/// mail and the body overflowed the column. Here the picture is saved to
/// /uploads/mass-email/ and the editor embeds the returned ABSOLUTE URL instead, so
/// mail clients load it like any hosted image.
/// </summary>
[ApiController]
[Route("api/mass-email")]
[Authorize]
public class MassEmailMediaController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    private static readonly string[] AllowedExt = { ".jpg", ".jpeg", ".png", ".gif", ".webp" };

    public MassEmailMediaController(IWebHostEnvironment env)
    {
        _env = env;
    }

    [HttpPost("image")]
    [RequestSizeLimit(15 * 1024 * 1024)] // 15 MB hard cap (client downscales first)
    public async Task<ActionResult> UploadImage(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No image supplied." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (Array.IndexOf(AllowedExt, ext) < 0)
            return BadRequest(new { message = "Only JPG, PNG, GIF or WEBP images are allowed." });

        var webRoot = _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
        var dir = Path.Combine(webRoot, "uploads", "mass-email");
        Directory.CreateDirectory(dir);

        var fileName = $"{Guid.NewGuid()}{ext}";
        var fullPath = Path.Combine(dir, fileName);
        using (var stream = new FileStream(fullPath, FileMode.Create))
            await file.CopyToAsync(stream);

        // Build the URL from the server that actually received (and stored) this
        // upload, so the picture loads immediately in the editor:
        //   - locally  -> http://localhost:5000/uploads/mass-email/<file>
        //   - on prod  -> https://portal.example.org/API/uploads/mass-email/<file>
        // (honour X-Forwarded-* when a reverse proxy sets them). Only a picture
        // uploaded on the deployed server has a publicly reachable URL — a
        // localhost URL won't load in a real recipient's inbox.
        var scheme = Request.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? Request.Scheme;
        var host = Request.Headers["X-Forwarded-Host"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(host)) host = Request.Host.Value;
        var baseUrl = $"{scheme}://{host}{Request.PathBase}";

        var url = $"{baseUrl}/uploads/mass-email/{fileName}";
        return Ok(new { url });
    }
}

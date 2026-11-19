using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RotaryApi.Services;

/// <summary>
/// Security #21, for every upload endpoint at once (global MVC filter, runs before PhotoUploadOptimizeFilter):
/// refuses script / executable file types no screen accepts, and refuses a file whose first bytes do not match
/// its extension for the types ROW stores (images, PDF, Word / Excel / PowerPoint). Other types pass to the
/// endpoint's own checks.
/// </summary>
public sealed class UploadContentFilter : IAsyncActionFilter
{
    // Never stored by ROW; served from /uploads they could run in a visitor's browser or on the server.
    private static readonly HashSet<string> Blocked = new(StringComparer.OrdinalIgnoreCase)
    {
        ".html", ".htm", ".xhtml", ".shtml", ".js", ".mjs", ".php", ".phtml", ".asp", ".aspx", ".ashx", ".asmx",
        ".cshtml", ".jsp", ".exe", ".dll", ".bat", ".cmd", ".com", ".ps1", ".vbs", ".sh", ".msi", ".jar",
        ".config", ".hta", ".scr",
    };

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var req = context.HttpContext.Request;
        if (req.HasFormContentType)
        {
            var form = await req.ReadFormAsync();
            foreach (var file in form.Files)
            {
                var error = Check(file);
                if (error != null)
                {
                    context.Result = new BadRequestObjectResult(new { message = error });
                    return;
                }
            }
        }
        await next();
    }

    /// <summary>Null when the file may continue, else the message for the user.</summary>
    public static string? Check(IFormFile file)
    {
        var ext = Path.GetExtension(file.FileName ?? "");
        if (Blocked.Contains(ext)) return $"Files of type {ext} cannot be uploaded.";
        if (file.Length > 0 && !FileSignature.Matches(file, ext))
            return $"The file's content does not match its type ({ext}). Upload the original file.";
        return null;
    }
}

/// <summary>Magic-number check: does the start of the file match what its extension claims?</summary>
public static class FileSignature
{
    private static readonly byte[] Ole = { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 }; // .doc .xls .ppt
    private static readonly byte[] Zip = { 0x50, 0x4B, 0x03, 0x04 };                           // .docx .xlsx .pptx

    /// <summary>True for a matching start, or for an extension this check does not know.</summary>
    public static bool Matches(IFormFile file, string extension)
    {
        var head = new byte[12];
        int n;
        try
        {
            using var s = file.OpenReadStream();
            n = s.Read(head, 0, head.Length);
        }
        catch (IOException) { return false; }
        bool Starts(byte[] sig) => n >= sig.Length && head.AsSpan(0, sig.Length).SequenceEqual(sig);
        return extension.ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => Starts(new byte[] { 0xFF, 0xD8, 0xFF }),
            ".png" => Starts(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }),
            ".gif" => Starts("GIF8"u8.ToArray()),
            ".webp" => n >= 12 && Starts("RIFF"u8.ToArray()) && head.AsSpan(8, 4).SequenceEqual("WEBP"u8),
            ".bmp" => Starts("BM"u8.ToArray()),
            ".pdf" => Starts("%PDF-"u8.ToArray()),
            ".docx" or ".xlsx" or ".pptx" => Starts(Zip),
            ".doc" or ".xls" or ".ppt" => Starts(Ole),
            _ => true,
        };
    }
}

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RotaryApi.Services;

// Put on an action (or controller) whose uploaded photos must be stored byte-for-byte as sent.
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class KeepOriginalUploadAttribute : Attribute { }

// Global MVC filter (registered in Program.cs): before ANY action runs, every uploaded photo
// in its arguments — a direct IFormFile parameter, or an IFormFile property of a [FromForm]
// DTO — is replaced by PhotoOptimizer's 2560 px / JPEG-88 version. One place covers web V1,
// web V2 and the mobile app, including photos sent through "upload document" endpoints.
// Non-photos (PDF, Word, Excel, GIF, SVG...) pass through untouched.
public sealed class PhotoUploadOptimizeFilter : IAsyncActionFilter
{
    private readonly ILogger<PhotoUploadOptimizeFilter> _log;

    public PhotoUploadOptimizeFilter(ILogger<PhotoUploadOptimizeFilter> log) => _log = log;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.HttpContext.Request.HasFormContentType &&
            !context.ActionDescriptor.EndpointMetadata.OfType<KeepOriginalUploadAttribute>().Any())
        {
            foreach (var key in context.ActionArguments.Keys.ToList())
            {
                var value = context.ActionArguments[key];
                if (value is IFormFile f)
                {
                    context.ActionArguments[key] = Optimize(f, context);
                }
                else if (value != null && value is not string && value.GetType().IsClass)
                {
                    foreach (var p in value.GetType().GetProperties())
                    {
                        if (p.PropertyType != typeof(IFormFile) || !p.CanRead || !p.CanWrite) continue;
                        if (p.GetValue(value) is IFormFile pf) p.SetValue(value, Optimize(pf, context));
                    }
                }
            }
        }

        await next();
    }

    private IFormFile Optimize(IFormFile file, ActionExecutingContext context)
    {
        if (!PhotoOptimizer.IsOptimizable(file)) return file;
        var r = PhotoOptimizer.Optimize(file);
        if (r.Changed)
            _log.LogInformation("Photo optimised on {Path}: {Old} -> {New} ({OldKb:N0} KB -> {NewKb:N0} KB, {W}x{H})",
                context.HttpContext.Request.Path, file.FileName, r.File.FileName,
                r.OldBytes / 1024, r.NewBytes / 1024, r.Width, r.Height);
        return r.File;
    }
}

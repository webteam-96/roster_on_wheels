using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace RotaryApi.Services;

/// <summary>
/// Binds DateTime / DateTime? from forms (multipart uploads), query strings and routes with the same rule as JSON
/// bodies (ViewerZone.TryParseIncoming): a time typed without a zone is the viewer's wall-clock, stored as UTC.
/// </summary>
public sealed class ViewerZoneDateTimeBinder : IModelBinder
{
    public Task BindModelAsync(ModelBindingContext ctx)
    {
        var result = ctx.ValueProvider.GetValue(ctx.ModelName);
        if (result == ValueProviderResult.None) return Task.CompletedTask;
        ctx.ModelState.SetModelValue(ctx.ModelName, result);

        var text = result.FirstValue;
        if (string.IsNullOrWhiteSpace(text))
        {
            if (Nullable.GetUnderlyingType(ctx.ModelType) != null) ctx.Result = ModelBindingResult.Success(null);
            return Task.CompletedTask;
        }
        if (ViewerZone.TryParseIncoming(text, result.Culture, out var value))
            ctx.Result = ModelBindingResult.Success(value);
        else
            ctx.ModelState.TryAddModelError(ctx.ModelName, $"The value '{text}' is not a valid date.");
        return Task.CompletedTask;
    }
}

public sealed class ViewerZoneDateTimeBinderProvider : IModelBinderProvider
{
    private static readonly ViewerZoneDateTimeBinder Binder = new();

    public IModelBinder? GetBinder(ModelBinderProviderContext context) =>
        context.Metadata.UnderlyingOrModelType == typeof(DateTime) ? Binder : null;
}

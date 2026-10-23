using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RotaryApi.Services;

/// <summary>
/// ROW timestamps (master plan WS4, flag <c>time.emitOffset</c>; the NestJS edition sends "…Z"): when the server
/// clock — and so MySQL's NOW() and DateTime.Now — is UTC, date-times are written with "Z" so browsers and the app
/// show them in the viewer's own zone. Midnight values are written without a zone ("2026-07-01T00:00:00"), as the
/// NestJS edition writes DATE columns, so a birthday or a Rotary-year boundary never moves by a day.
/// On a server whose local zone is not UTC (the original platform: India time) nothing changes: values are written as before.
/// </summary>
public sealed class UtcDateTimeConverter : JsonConverter<DateTime>
{
    private static bool Emit => ZoneTime.StoredUtc;

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.GetDateTime();

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        if (!Emit || value.Kind == DateTimeKind.Local)
        {
            writer.WriteStringValue(value);   // the default ISO 8601 form, unchanged
            return;
        }
        if (value.TimeOfDay == TimeSpan.Zero)
        {
            writer.WriteStringValue(value.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture));
            return;
        }
        var utc = DateTime.SpecifyKind(value, DateTimeKind.Utc);
        writer.WriteStringValue(utc.ToString(value.Millisecond == 0 ? "yyyy-MM-dd'T'HH:mm:ss'Z'" : "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", CultureInfo.InvariantCulture));
    }
}

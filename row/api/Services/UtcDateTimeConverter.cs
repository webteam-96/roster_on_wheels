using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RotaryApi.Services;

/// <summary>
/// ROW timestamps (master plan WS4, flag <c>time.emitOffset</c>): stored times are UTC (RowDb sessions and DateTime.UtcNow,
/// since 2026-11-17), so date-times are written with "Z" and browsers and the app
/// show them in the viewer's own zone. Midnight values are written without a zone ("2026-07-01T00:00:00"), as the
/// NestJS edition writes DATE columns, so a birthday or a Rotary-year boundary never moves by a day.
/// With the flag off, values are written without a zone.
/// </summary>
public sealed class UtcDateTimeConverter : JsonConverter<DateTime>
{
    private static bool Emit => ZoneTime.StoredUtc;

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (!Emit) return reader.GetDateTime();
        var text = reader.GetString() ?? "";
        if (HasOffset(text)) return reader.GetDateTimeOffset().UtcDateTime;   // "…Z" / "…+01:00": an instant
        var value = reader.GetDateTime();
        // Zone-less midnight is a date (date pickers send "2026-07-01T00:00:00"), as Write treats it; never shift it.
        if (value.TimeOfDay == TimeSpan.Zero) return value;
        return ViewerZone.ToUtc(value);                                       // typed wall-clock: the viewer's zone
    }

    private static bool HasOffset(string text) =>
        text.EndsWith('Z') || text.EndsWith('z')
        || (text.Length > 6 && text[^6] is '+' or '-' && text[^3] == ':' && text.IndexOf('T') > 0);

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

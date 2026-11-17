using System.Text.Json;
using Microsoft.AspNetCore.Http;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class ViewerZoneTests
{
    private static readonly JsonSerializerOptions Json = new() { Converters = { new UtcDateTimeConverter() } };

    private static DateTime ReadAs(string json, string zoneHeader, string value)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers[zoneHeader] = value;
        ViewerZone.Accessor = new HttpContextAccessor { HttpContext = ctx };
        try { return JsonSerializer.Deserialize<DateTime>(json, Json); }
        finally { ViewerZone.Accessor = null; }
    }

    [Fact]
    public void ZonelessTime_IsTheViewersWallClock_StoredAsUtc()
    {
        // 18:00 in Paris in November (UTC+1) is 17:00 UTC.
        var v = ReadAs("\"2026-11-20T18:00\"", "X-Time-Zone", "Europe/Paris");
        Assert.Equal(new DateTime(2026, 11, 20, 17, 0, 0), v);
        Assert.Equal(DateTimeKind.Utc, v.Kind);
    }

    [Fact]
    public void ZonelessTime_FromTheApp_UsesTheOffsetHeader()
    {
        var v = ReadAs("\"2026-11-20T18:00:00\"", "X-Time-Zone-Offset", "-300"); // UTC-5
        Assert.Equal(new DateTime(2026, 11, 20, 23, 0, 0), v);
    }

    [Fact]
    public void TimeWithOffset_IsKeptAsTheSameInstant()
    {
        var v = ReadAs("\"2026-11-20T18:00:00+09:00\"", "X-Time-Zone", "Europe/Paris");
        Assert.Equal(new DateTime(2026, 11, 20, 9, 0, 0), v);
        Assert.Equal(DateTimeKind.Utc, v.Kind);
    }

    [Theory]
    [InlineData("2026-11-20T18:00", "Europe/Paris", "2026-11-20T17:00:00")]   // form / query value, zone-less
    [InlineData("2026-11-20T18:00:00Z", "Europe/Paris", "2026-11-20T18:00:00")]
    [InlineData("2026-11-20", "Asia/Tokyo", "2026-11-20T00:00:00")]          // a date never moves
    public void FormAndQueryValues_FollowTheSameRule(string text, string zone, string expected)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-Time-Zone"] = zone;
        ViewerZone.Accessor = new HttpContextAccessor { HttpContext = ctx };
        try
        {
            Assert.True(ViewerZone.TryParseIncoming(text, null, out var v));
            Assert.Equal(DateTime.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), v);
        }
        finally { ViewerZone.Accessor = null; }
    }

    [Fact]
    public void DateOnlyAndMidnight_NeverShift()
    {
        Assert.Equal(new DateTime(2026, 7, 1), ReadAs("\"2026-07-01\"", "X-Time-Zone", "Asia/Tokyo"));
        Assert.Equal(new DateTime(2026, 7, 1), ReadAs("\"2026-07-01T00:00:00\"", "X-Time-Zone", "Asia/Tokyo"));
    }
}

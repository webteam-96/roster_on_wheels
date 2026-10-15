namespace RotaryApi.Services;

// Creates/updates Zoom meetings via Server-to-Server OAuth for website-training appointments.
// Returns null when Zoom isn't configured (PLACEHOLDER creds) so a booking still records — the
// meeting link can be added later — mirroring the RazorpayGatewayProxy "not configured" behaviour.
public interface IZoomMeetingService
{
    bool IsConfigured { get; }
    Task<ZoomMeetingResult?> CreateMeetingAsync(string topic, DateTime startIst, int durationMinutes);
    Task<bool> UpdateMeetingTimeAsync(string meetingId, DateTime startIst, int durationMinutes);
}

public record ZoomMeetingResult(string MeetingId, string JoinUrl, string StartUrl);

using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Which channels a one-time code goes out on. ROW has no SMS or WhatsApp (decided 2026-10-19): communication is
/// in-app or email, so codes go by email only. The signature is kept for the existing callers.
/// </summary>
public static class OtpChannelPolicy
{
    public static Task<IReadOnlyList<string>> ChannelsForAsync(MySqlConnection conn, int? countryId) =>
        Task.FromResult<IReadOnlyList<string>>(new[] { "email" });
}

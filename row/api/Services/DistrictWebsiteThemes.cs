namespace RotaryApi.Services;

/// <summary>
/// The district website themes a district can pick (district_websites.theme_key). Each builds to
/// row/district-website/&lt;key&gt;/. NULL, empty or an unknown key means the default.
/// </summary>
public static class DistrictWebsiteThemes
{
    public const string Default = "ether";

    public static readonly string[] Keys = { "ether", "prism", "orbit", "tide", "transit", "cascade", "kinetic" };

    public static bool IsValid(string? key) => key != null && Keys.Contains(key.Trim().ToLowerInvariant());

    public static string Normalize(string? key) => IsValid(key) ? key!.Trim().ToLowerInvariant() : Default;
}

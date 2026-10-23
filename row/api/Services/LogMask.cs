namespace RotaryApi.Services;

/// <summary>
/// Email addresses for log lines (no personal data in logs): "jane@example.org" becomes "j***@example.org"; a list
/// ("a@x.org, b@y.org" or "a@x.org;b@y.org") is masked address by address. Only log text uses this: email_log rows
/// keep the full address. The workers link this file.
/// </summary>
public static class LogMask
{
    public static string Email(string? value) => string.Join(", ",
        (value ?? "").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(e => e.IndexOf('@') is var at && at > 0 ? e[0] + "***" + e[at..] : "***"));

    public static string Emails(IEnumerable<string?>? values) => Email(string.Join(",", values ?? Array.Empty<string?>()));
}

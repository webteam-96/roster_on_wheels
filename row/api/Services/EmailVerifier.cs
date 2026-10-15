using System.Net.Mail;
using System.Net.Sockets;
using System.Text;
using DnsClient;

namespace RotaryApi.Services;

public static class EmailVerifier
{
    public record VerifyResult(bool IsValid, string? Reason);

    // Multi-step: format check → MX lookup → SMTP RCPT TO probe
    public static async Task<VerifyResult> VerifyAsync(string email, string fromEmail, CancellationToken ct = default, int timeoutMs = 8000)
    {
        if (string.IsNullOrWhiteSpace(email))
            return new(false, "Email is empty.");

        // 1. Format
        try { _ = new MailAddress(email); }
        catch { return new(false, "Invalid email format."); }

        var atIdx = email.LastIndexOf('@');
        var domain = email[(atIdx + 1)..];

        // 2. MX lookup
        List<string> mxHosts;
        try
        {
            var lookup = new LookupClient();
            var mxResult = await lookup.QueryAsync(domain, QueryType.MX, cancellationToken: ct);
            mxHosts = mxResult.Answers.MxRecords()
                .OrderBy(r => r.Preference)
                .Select(r => r.Exchange.Value.TrimEnd('.'))
                .ToList();
            if (mxHosts.Count == 0) return new(false, $"No MX records for domain '{domain}'.");
        }
        catch (Exception ex) { return new(true, $"MX lookup inconclusive: {ex.Message}"); } // accept-all on DNS failure

        // 3. Detect accept-all: probe with a guaranteed-fake mailbox first
        var fakeEmail = $"__nope_{Guid.NewGuid():N}@{domain}";
        foreach (var mx in mxHosts.Take(2))
        {
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(timeoutMs);
                var fakeResult = await ProbeSmtpAsync(mx, fakeEmail, fromEmail, cts.Token);
                // If the server accepts a fake address, it's accept-all — can't verify real one
                if (fakeResult.IsValid && fakeResult.Reason == null)
                    return new(true, "ACCEPT_ALL: Server accepts all recipients — cannot verify mailbox.");

                // Server rejects fakes → now probe the real email
                using var cts2 = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts2.CancelAfter(timeoutMs);
                var realResult = await ProbeSmtpAsync(mx, email, fromEmail, cts2.Token);
                if (realResult.IsValid && realResult.Reason == null) return new(true, null); // verified
                if (realResult.Reason?.StartsWith("5") == true) return realResult; // hard reject
                // 4xx / ambiguous — try next MX
            }
            catch (OperationCanceledException) { /* try next */ }
            catch { /* try next */ }
        }
        return new(true, "MX probe inconclusive (unreachable or timed out).");
    }

    private static async Task<VerifyResult> ProbeSmtpAsync(string mxHost, string toEmail, string fromEmail, CancellationToken ct)
    {
        using var tcp = new TcpClient();
        await tcp.ConnectAsync(mxHost, 25, ct);
        using var stream = tcp.GetStream();
        using var reader = new StreamReader(stream, Encoding.ASCII);
        using var writer = new StreamWriter(stream, Encoding.ASCII) { AutoFlush = true, NewLine = "\r\n" };

        var banner = await ReadLineAsync(reader, ct);
        if (!banner.StartsWith("220")) return new(true, $"Probe unclear banner: {banner}");

        await writer.WriteLineAsync($"HELO verify.{Guid.NewGuid():N}.local");
        var helo = await ReadLineAsync(reader, ct);
        if (!helo.StartsWith("250")) return new(true, $"Probe HELO refused: {helo}");

        await writer.WriteLineAsync($"MAIL FROM:<{fromEmail}>");
        var mailFrom = await ReadLineAsync(reader, ct);
        if (!mailFrom.StartsWith("250")) return new(true, $"Probe MAIL FROM refused: {mailFrom}");

        await writer.WriteLineAsync($"RCPT TO:<{toEmail}>");
        var rcpt = await ReadLineAsync(reader, ct);

        try { await writer.WriteLineAsync("QUIT"); } catch { }

        if (rcpt.StartsWith("250") || rcpt.StartsWith("251")) return new(true, null);
        if (rcpt.StartsWith("550") || rcpt.StartsWith("551") || rcpt.StartsWith("553"))
            return new(false, $"Mailbox rejected: {rcpt}");
        // 4xx = soft fail (greylisting, rate limit) → treat as inconclusive
        return new(true, $"Probe inconclusive: {rcpt}");
    }

    private static async Task<string> ReadLineAsync(StreamReader reader, CancellationToken ct)
    {
        // Skip multi-line continuation responses (e.g., 250-...\r\n250 ...)
        string? line;
        while (true)
        {
            line = await reader.ReadLineAsync(ct);
            if (line == null) return "";
            if (line.Length < 4 || line[3] == ' ') return line;
            // line[3] == '-' means continuation; keep reading
        }
    }
}

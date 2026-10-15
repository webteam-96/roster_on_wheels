using System.Collections.Concurrent;

namespace RotaryApi.Services;

// Resolves the "Visit Website" URL shown on club/district dashboards.
// A site may have a custom domain (ClientDomain) whose DNS/SSL isn't live yet, while the
// platform subdomain always works. We only surface the custom domain when it actually
// responds; otherwise we fall back to the platform subdomain so the dashboard never links
// to a broken URL. Probe results are cached so we don't hit the network on every load.
public static class WebsiteReachability
{
    private static readonly HttpClient _http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = true,
        ConnectTimeout = TimeSpan.FromSeconds(3),
    })
    {
        Timeout = TimeSpan.FromSeconds(4),
    };

    private static readonly ConcurrentDictionary<string, (bool ok, DateTime at)> _cache = new();
    private static readonly TimeSpan _ttl = TimeSpan.FromMinutes(15);

    // Stored domain/subdomain values sometimes include a scheme ("https://x"), a malformed
    // scheme ("https//x") or a trailing path. Reduce to a bare host so we don't double-prefix.
    // Also rejects obvious placeholders ("NA", "N/A", "-", "none") and strings that don't
    // look like a hostname at all (no dots and not a usable subdomain label).
    private static string? NormalizeHost(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var h = raw.Trim();
        var idx = h.IndexOf("//", StringComparison.Ordinal); // covers https://, http://, https//, http//
        if (idx >= 0 && idx <= 8) h = h[(idx + 2)..];
        var slash = h.IndexOf('/'); // drop any path/query
        if (slash >= 0) h = h[..slash];
        h = h.Trim().Trim('.').ToLowerInvariant();
        if (h.Length == 0) return null;
        // Reject obvious placeholder values that users sometimes type instead of leaving the field blank.
        if (h is "na" or "n/a" or "none" or "null" or "-" or "tbd" or "tba") return null;
        // Reject any string that contains characters that can't be in a host.
        if (h.IndexOfAny(new[] { ' ', '\\', '@', ':', '?', '#', '"', '\'' }) >= 0) return null;
        return h;
    }

    // Is this normalized host valid as a CUSTOM client domain (must contain at least one dot — a TLD)?
    // Bare labels like "rcamaarathane" without a dot are NOT real domains; they need to be combined
    // with the platform parent domain via BuildSubdomainUrl instead.
    private static bool IsLikelyCustomDomain(string normalizedHost)
        => normalizedHost.Contains('.', StringComparison.Ordinal);

    // Platform subdomain URL (trusted as live — served by our multi-tenant host).
    private static string? BuildSubdomainUrl(string? subdomain, string? parentDomain, bool useHttps)
    {
        var sub = NormalizeHost(subdomain);
        if (sub == null) return null;
        var scheme = useHttps ? "https" : "http";
        var parent = NormalizeHost(parentDomain);
        var host = sub.Contains('.') || parent == null ? sub : $"{sub}.{parent}";
        return $"{scheme}://{host}";
    }

    // Returns a URL guaranteed to be reachable: the custom domain if it responds, else the subdomain.
    // Priority: ClientDomain (if a real domain) → Subdomain (built against parent). Never throws.
    public static async Task<string?> ResolveAsync(string? clientDomain, string? subdomain, string? parentDomain, bool useHttps)
    {
        var subUrl = BuildSubdomainUrl(subdomain, parentDomain, useHttps);

        var host = NormalizeHost(clientDomain);
        // Only probe the custom domain if it actually looks like one (has a TLD). "NA", "demo", etc. are ignored.
        if (host != null && IsLikelyCustomDomain(host))
        {
            // Custom domain may be served over either scheme — use whichever actually responds.
            foreach (var scheme in new[] { "https", "http" })
            {
                var candidate = $"{scheme}://{host}";
                try { if (await IsReachableAsync(candidate)) return candidate; }
                catch { /* probe must never bubble — caller relies on the subdomain fallback */ }
            }
        }

        return subUrl; // no custom domain, or it's not reachable → platform subdomain
    }

    private static async Task<bool> IsReachableAsync(string url)
    {
        if (_cache.TryGetValue(url, out var c) && DateTime.UtcNow - c.at < _ttl)
            return c.ok;

        var ok = await ProbeAsync(url);
        _cache[url] = (ok, DateTime.UtcNow);
        return ok;
    }

    private static async Task<bool> ProbeAsync(string url)
    {
        try
        {
            using var head = new HttpRequestMessage(HttpMethod.Head, url);
            using var resp = await _http.SendAsync(head, HttpCompletionOption.ResponseHeadersRead);
            if ((int)resp.StatusCode < 400) return true;
            if (resp.StatusCode != System.Net.HttpStatusCode.MethodNotAllowed) return false;

            // Some servers reject HEAD — retry with GET.
            using var get = new HttpRequestMessage(HttpMethod.Get, url);
            using var gresp = await _http.SendAsync(get, HttpCompletionOption.ResponseHeadersRead);
            return (int)gresp.StatusCode < 400;
        }
        catch
        {
            return false; // DNS failure, refused, timeout, TLS error → treat as not live
        }
    }
}

namespace RotaryApi.Services;

// Helpers for the host fields on club/district website records (Subdomain, third-party ClientDomain).
//
// PRODUCT DECISION (2026-06-29): these fields accept ANY characters — including ':' and '/' — and are
// stored VERBATIM (no normalization, no stripping, no character validation). We only check
// presence/length. Consequence the owner accepted: activating a subdomain that contains ':' or '/'
// will fail in Plesk (error 1019 "Wrong value of property"), because a Plesk subdomain name can't
// contain those. The Plesk label is derived from the stored value as-is at activation time.
//
// NormalizeSubdomain remains ONLY for rename-detection (comparing "is the new subdomain effectively
// the same label as the stored one?") so that editing other fields on an activated row whose stored
// subdomain is a legacy full-URL value isn't mis-read as a rename. It is NOT used for storage or for
// the value sent to Plesk.
public static class WebsiteDomainHelper
{
    // Strip scheme ("https://"), path/query/fragment, a trailing :port and stray surrounding
    // slashes/dots → a bare host. Used only by NormalizeSubdomain (rename detection).
    private static string StripToHost(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var v = raw.Trim().ToLowerInvariant();
        v = System.Text.RegularExpressions.Regex.Replace(v, @"^[a-z][a-z0-9+.\-]*://", "");
        v = v.TrimStart('/');
        var cut = v.IndexOfAny(new[] { '/', '?', '#' });
        if (cut >= 0) v = v[..cut];
        var colon = v.IndexOf(':');
        if (colon >= 0) v = v[..colon];
        return v.Trim().Trim('.');
    }

    // Reduce any input to a single label (text before the first dot) for rename-detection only.
    public static string NormalizeSubdomain(string? raw)
    {
        var host = StripToHost(raw);
        if (host.Length == 0) return "";
        var dot = host.IndexOf('.');
        return dot >= 0 ? host[..dot] : host;
    }

    // The bare subdomain LABEL to hand back to clients. A stored club_websites.Subdomain value may
    // be a full host ("club.example.org") or already just a label ("rcmumbai").
    // Web AND mobile clients append the parent domain themselves (`${subdomain}.${parentDomain}`),
    // so the API must return ONLY the label — otherwise a full-host value double-appends the parent
    // domain (…club.example.org). Strips scheme/slashes/port then removes a known
    // club/district parent-domain suffix. Idempotent: a clean label passes through unchanged.
    public static string BareSubdomain(string? raw)
    {
        var host = StripToHost(raw);
        if (host.Length == 0) return "";
        foreach (var suffix in Brand.ClubSiteDotSuffixes)
            if (host.EndsWith(suffix, System.StringComparison.OrdinalIgnoreCase))
                return host[..^suffix.Length];
        return host;
    }

    // Bare hostname for the optional Parent Domain setting (not the per-club fields). null when blank.
    public static string? NormalizeClientDomain(string? raw)
    {
        var host = StripToHost(raw);
        return host.Length == 0 ? null : host;
    }

    // Presence + length only — ':' and '/' are allowed and stored verbatim (product decision above).
    public static string? ValidateSubdomain(string? value, string fieldName = "Subdomain")
    {
        if (string.IsNullOrWhiteSpace(value)) return $"{fieldName} is required.";
        if (value.Length > 253) return $"{fieldName} is too long (max 253 characters).";
        return null;
    }

    // Optional; length only.
    public static string? ValidateClientDomain(string? value, string fieldName = "Client Domain")
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (value.Length > 253) return $"{fieldName} is too long (max 253 characters).";
        return null;
    }

    // ── Self-service purchase subdomain (rc<input>.example.org) ──────────────────────────
    // Unlike ValidateSubdomain (presence/length only, for verbatim SuperAdmin entry), the
    // self-service purchase flow constrains the club's input to a clean DNS label so it always
    // provisions cleanly in Plesk. The stored label is "rc" + input.
    public static string? ValidatePurchaseSubdomainInput(string? input)
    {
        var v = (input ?? "").Trim().ToLowerInvariant();
        if (v.Length < 3 || v.Length > 30) return "Subdomain must be 3–30 characters.";
        if (!System.Text.RegularExpressions.Regex.IsMatch(v, "^[a-z0-9]+$"))
            return "Only lowercase letters a–z and digits 0–9 are allowed.";
        return null;
    }

    public static string BuildPurchaseLabel(string? input) => "rc" + (input ?? "").Trim().ToLowerInvariant();
}

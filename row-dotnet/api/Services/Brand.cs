using Microsoft.Extensions.Configuration;

namespace RotaryApi.Services;

/// <summary>
/// ROW instance brand: product name, domains, contacts and recipients. Everything that
/// identifies the deployment comes from the "Brand" configuration section, never from
/// code literals. Bound once at start-up (Program.cs: Brand.Init); read anywhere via the
/// static properties. Empty values mean "not configured" and the feature that needs them
/// skips or falls back.
/// </summary>
public static class Brand
{
    /// <summary>Full product name, e.g. in email footers.</summary>
    public static string ProductName { get; private set; } = "Roster On Wheels";

    /// <summary>Short product name, e.g. in subjects and file names.</summary>
    public static string ShortName { get; private set; } = "ROW";

    /// <summary>Host of the admin portal, e.g. "portal.example.org" (no scheme).</summary>
    public static string PortalDomain { get; private set; } = "";

    /// <summary>Parent domain under which club websites get a subdomain.</summary>
    public static string ClubSiteParentDomain { get; private set; } = "";

    /// <summary>Extra parent domains whose subdomains are club websites (older or alias domains).</summary>
    public static string[] ClubSiteSuffixes { get; private set; } = Array.Empty<string>();

    /// <summary>Browser origins (host or parent domain) allowed by the main CORS policy.</summary>
    public static string[] AllowedOriginDomains { get; private set; } = Array.Empty<string>();

    public static string SupportEmail { get; private set; } = "";
    public static string SupportPhone { get; private set; } = "";
    public static string NoReplyEmail { get; private set; } = "";

    /// <summary>Sender for mass emails (must be a verified sender at the email provider).</summary>
    public static string CommunicationEmail { get; private set; } = "";

    /// <summary>Internal team mailbox copied on website activation / billing emails.</summary>
    public static string InternalCc { get; private set; } = "";

    /// <summary>Recipients of internal reports (daily statistics, test sends).</summary>
    public static string[] ReportRecipients { get; private set; } = Array.Empty<string>();

    /// <summary>Member who is made SuperAdmin at start-up if present (bootstrap); empty = none.</summary>
    public static string SuperAdminEmail { get; private set; } = "";

    /// <summary>Prefix of the WhatsApp template names registered for this instance.</summary>
    public static string WhatsAppTemplatePrefix { get; private set; } = "row";

    /// <summary>Logo used in emails and generated documents (absolute URL).</summary>
    public static string LogoUrl { get; private set; } = "";

    /// <summary>Portal origin with scheme, e.g. "https://portal.example.org"; empty when not configured.</summary>
    public static string PortalOrigin => PortalDomain.Length == 0 ? "" : "https://" + PortalDomain;

    /// <summary>Public API origin, served under the portal at /API (as the IIS site is laid out); empty when not configured.</summary>
    public static string ApiOrigin => PortalOrigin.Length == 0 ? "" : PortalOrigin + "/API";

    public static void Init(IConfiguration config)
    {
        var s = config.GetSection("Brand");
        ProductName = Value(s, "ProductName", ProductName);
        ShortName = Value(s, "ShortName", ShortName);
        PortalDomain = Value(s, "PortalDomain", "").ToLowerInvariant();
        ClubSiteParentDomain = Value(s, "ClubSiteParentDomain", "").Trim('.').ToLowerInvariant();
        ClubSiteSuffixes = List(s, "ClubSiteSuffixes");
        AllowedOriginDomains = List(s, "AllowedOriginDomains");
        SupportEmail = Value(s, "SupportEmail", "");
        SupportPhone = Value(s, "SupportPhone", "");
        NoReplyEmail = Value(s, "NoReplyEmail", "");
        CommunicationEmail = Value(s, "CommunicationEmail", "");
        InternalCc = Value(s, "InternalCc", "");
        ReportRecipients = List(s, "ReportRecipients");
        SuperAdminEmail = Value(s, "SuperAdminEmail", "");
        WhatsAppTemplatePrefix = Value(s, "WhatsAppTemplatePrefix", WhatsAppTemplatePrefix);
        LogoUrl = Value(s, "LogoUrl", "");
    }

    /// <summary>True when the host is the portal, a club-site domain or one of the allowed origins.</summary>
    public static bool IsOwnHost(string host)
    {
        host = host.ToLowerInvariant();
        foreach (var d in AllowedOriginDomains.Append(PortalDomain).Append(ClubSiteParentDomain).Concat(ClubSiteSuffixes))
        {
            var p = d.Trim('.').ToLowerInvariant();
            if (p.Length > 0 && (host == p || host.EndsWith("." + p))) return true;
        }
        return false;
    }

    /// <summary>Logo for email headers: Brand:LogoUrl, else the white ROW lockup served by the portal; empty when neither is set.</summary>
    public static string EmailLogoUrl =>
        LogoUrl.Length > 0 ? LogoUrl : PortalOrigin.Length > 0 ? PortalOrigin + "/images/rotary-white-live.png" : "";

    /// <summary>Club-site parent domains as ".suffix" values (parent domain first, then aliases).</summary>
    public static string[] ClubSiteDotSuffixes =>
        ClubSiteSuffixes.Prepend(ClubSiteParentDomain).Select(d => d.Trim('.')).Where(d => d.Length > 0)
            .Select(d => "." + d).Distinct().ToArray();

    /// <summary>Support contacts for email footers: the configured phone, email and portal, " | "-separated.</summary>
    public static string ContactHtml() =>
        string.Join(" &nbsp;|&nbsp; ", new[] { SupportPhone, SupportEmail, PortalDomain }.Where(v => v.Length > 0));

    /// <summary>Full WhatsApp template name for this instance, e.g. "row_otp".</summary>
    public static string Template(string name) => $"{WhatsAppTemplatePrefix}_{name}";

    private static string Value(IConfigurationSection s, string key, string fallback)
    {
        var v = s[key];
        return string.IsNullOrWhiteSpace(v) ? fallback : v.Trim();
    }

    private static string[] List(IConfigurationSection s, string key)
    {
        var children = s.GetSection(key).GetChildren().Select(c => c.Value?.Trim() ?? "").Where(v => v.Length > 0).ToArray();
        if (children.Length > 0) return children;
        var flat = s[key];
        return string.IsNullOrWhiteSpace(flat)
            ? Array.Empty<string>()
            : flat.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}

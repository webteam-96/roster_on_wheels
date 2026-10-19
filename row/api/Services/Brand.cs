using Microsoft.Extensions.Configuration;

namespace RotaryApi.Services;

/// <summary>
/// ROW instance brand (master plan WS1, Appendix A). Same shape, defaults and configuration keys as the
/// NestJS edition (row/api/src/brand/brand.ts), so one set of server settings serves either API:
/// <c>Brand:Domains:AdminOrigin</c>, <c>Brand:Support:Phones:0</c>, <c>Brand:Features:member.bloodGroup</c> ...
/// (environment: <c>Brand__Domains__AdminOrigin</c>). Bound once at start-up (Program.cs: Brand.Init); the
/// workers link this file and call Init too. Empty values mean "not configured".
/// </summary>
public static class Brand
{
    // ── Identity ─────────────────────────────────────────────────────────────────────────────
    public static string InstanceCode { get; private set; } = "ROW";
    public static string ProductName { get; private set; } = "Roster On Wheels";
    public static string ShortName { get; private set; } = "ROW";

    // ── Domains ──────────────────────────────────────────────────────────────────────────────
    /// <summary>Admin portal origin with scheme, e.g. "https://portal.example.org".</summary>
    public static string AdminOrigin { get; private set; } = "";
    /// <summary>Public API base, e.g. "https://portal.example.org/API".</summary>
    public static string ApiBase { get; private set; } = "";
    public static string ClubSiteParentDomain { get; private set; } = "";
    public static string[] ClubSiteSuffixes { get; private set; } = Array.Empty<string>();
    public static string[] AllowedOriginSuffixes { get; private set; } = Array.Empty<string>();

    // ── Support ──────────────────────────────────────────────────────────────────────────────
    public static string LegalName { get; private set; } = "";
    public static string Address { get; private set; } = "";
    public static string SupportEmail { get; private set; } = "";
    public static string[] SupportPhones { get; private set; } = Array.Empty<string>();
    public static string SupportHours { get; private set; } = "";
    public static string NoReplyEmail { get; private set; } = "";
    public static string[] InternalCcList { get; private set; } = Array.Empty<string>();
    public static string PrivacyEmail { get; private set; } = "";

    // ── Look ─────────────────────────────────────────────────────────────────────────────────
    public static string LogoUrl { get; private set; } = "";
    public static string LogoDarkUrl { get; private set; } = "";
    /// <summary>Optional file path of a PNG/JPEG logo for PDF reports; empty = the ROW logo built into the API.</summary>
    public static string PdfLogoPath { get; private set; } = "";
    public static string FaviconUrl { get; private set; } = "";
    public static string OpenGraphImageUrl { get; private set; } = "";

    // ── Locale ───────────────────────────────────────────────────────────────────────────────
    public static string DefaultLanguage { get; private set; } = "en";
    /// <summary>A language is listed only once its translation has been reviewed (master plan X8).</summary>
    public static string[] Languages { get; private set; } = { "en" };
    public static string NumberLocale { get; private set; } = "en-US";
    public static string DefaultCurrency { get; private set; } = "USD";
    public static string[] Currencies { get; private set; } = { "USD", "CAD", "EUR", "GBP", "BRL", "MXN", "JPY", "KRW", "AUD", "PHP", "ZAR", "NGN", "KES" };
    public static string DefaultTimeZone { get; private set; } = "UTC";
    public static string InstanceTimeZone { get; private set; } = "UTC";
    /// <summary>0 = no default country: forms ask.</summary>
    public static int DefaultCountryId { get; private set; }

    // ── Providers ────────────────────────────────────────────────────────────────────────────
    public static string[] PaymentProviders { get; private set; } = { "stripe", "paypal" };

    // ── Scope ────────────────────────────────────────────────────────────────────────────────
    public static string[] Zones { get; private set; } = Array.Empty<string>();
    public static string[] PulledZoneNames { get; private set; } = Array.Empty<string>();
    public static string[] Countries { get; private set; } = Array.Empty<string>();
    public static string[] ExemptDistricts { get; private set; } = Array.Empty<string>();
    public static int CogClubId { get; private set; }
    public static string TestDistrictNumber { get; private set; } = "";
    public static int DistrictReportSendHour { get; private set; } = 7;
    public static int[] DistrictReportDaysOfMonth { get; private set; } = { 1, 16 };

    // ── Legal and privacy ────────────────────────────────────────────────────────────────────
    public static string PrivacyUrl { get; private set; } = "/privacy-policy";
    public static string TermsUrl { get; private set; } = "/terms-and-conditions";
    public static string RefundsUrl { get; private set; } = "/refunds-and-cancellations";
    public static string CookiesUrl { get; private set; } = "/cookies";
    public static string PolicyVersion { get; private set; } = "";
    public static bool CookieNotice { get; private set; } = true;
    public static string[] ConsentRequiredFor { get; private set; } = { "greeting", "announcement", "event", "newsletter", "marketing" };
    public static IReadOnlyDictionary<string, int> RetentionDays { get; private set; } = new Dictionary<string, int>
    {
        ["email_log_body"] = 180, ["whatsapp_log"] = 365, ["push_log"] = 90, ["login_audit"] = 365,
        ["otp"] = 7, ["export_files"] = 7, ["assistant_turns"] = 365,
    };

    // ── Feature flags (master plan Appendix C), with ROW's values ────────────────────────────
    public static readonly IReadOnlyDictionary<string, bool> FeatureDefaults = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
    {
        ["member.bloodGroup"] = false,       // health data: not collected on ROW
        ["member.familyDetails"] = false,
        ["time.emitOffset"] = true,          // timestamps go out with their offset
        ["time.districtZone"] = true,
        ["payments.connect"] = true,         // districts and clubs connect their own Stripe / PayPal account
        ["payments.platformFeeLedger"] = true,
        ["privacy.enabled"] = true,
        ["masters.editable"] = false,        // master data comes from seed files
        ["documents.strictGlyphs"] = true,
        ["sync.conditionalProfiles"] = true,
        ["whatsapp.purposeCallback"] = true,
        ["modules.citation"] = false,        // zonal award programmes of the original platform: off until ROW decides (master plan Q9)
        ["modules.zonalAwards"] = false,
        ["modules.wallet"] = false,
        ["modules.websitePurchase"] = false,
        ["modules.assistant"] = false,
        ["modules.pphCamps"] = false,
        ["site.public"] = false,             // no public marketing site until ROW content exists
    };
    private static Dictionary<string, bool> _features = new(StringComparer.OrdinalIgnoreCase);

    // ── Instance-specific settings kept from the first rebrand ───────────────────────────────
    /// <summary>Sender for mass emails (a verified sender at the email provider); else the no-reply address.</summary>
    public static string CommunicationEmail { get; private set; } = "";
    /// <summary>Club-name patterns the district performance report never counts (DistrictPerformanceReport:ExcludedClubNames).</summary>
    public static string[] ExcludedClubNamePatterns { get; private set; } = Array.Empty<string>();

    /// <summary>Recipients of internal reports (daily statistics, test sends).</summary>
    public static string[] ReportRecipients { get; private set; } = Array.Empty<string>();
    /// <summary>Member who is made SuperAdmin at start-up if present (bootstrap); empty = none.</summary>
    public static string SuperAdminEmail { get; private set; } = "";

    // ── Derived values used across the code ──────────────────────────────────────────────────
    /// <summary>Host of the admin portal, e.g. "portal.example.org".</summary>
    public static string PortalDomain => Uri.TryCreate(AdminOrigin, UriKind.Absolute, out var u) ? u.Host.ToLowerInvariant() : "";
    public static string PortalOrigin => AdminOrigin.TrimEnd('/');
    /// <summary>Public API origin; the portal origin + "/API" when ApiBase is not set.</summary>
    public static string ApiOrigin => ApiBase.Length > 0 ? ApiBase.TrimEnd('/') : PortalOrigin.Length > 0 ? PortalOrigin + "/API" : "";
    public static string SupportPhone => SupportPhones.FirstOrDefault() ?? "";
    public static string InternalCc => string.Join(",", InternalCcList);
    public static string[] AllowedOriginDomains => AllowedOriginSuffixes;

    public static void Init(IConfiguration config)
    {
        string Str(string key, string current) => config[$"Brand:{key}"] is { } v ? v.Trim() : current;
        string[] Arr(string key, string[] current)
        {
            var section = config.GetSection($"Brand:{key}");
            var items = section.GetChildren().Select(c => c.Value?.Trim() ?? "").Where(v => v.Length > 0).ToArray();
            if (items.Length > 0) return items;
            // "Key": "" clears a list; "a,b" is accepted as a list too.
            if (section.Value is { } flat) return flat.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return current;
        }
        int Num(string key, int current) => int.TryParse(config[$"Brand:{key}"], out var n) ? n : current;
        bool Bool(string key, bool current) => bool.TryParse(config[$"Brand:{key}"], out var b) ? b : current;

        InstanceCode = Str("InstanceCode", InstanceCode);
        ProductName = Str("ProductName", ProductName);
        ShortName = Str("ShortName", ShortName);

        AdminOrigin = Str("Domains:AdminOrigin", AdminOrigin);
        ApiBase = Str("Domains:ApiBase", ApiBase);
        ClubSiteParentDomain = Str("Domains:ClubSiteParent", ClubSiteParentDomain).Trim('.').ToLowerInvariant();
        ClubSiteSuffixes = Arr("Domains:ClubSiteSuffixes", ClubSiteSuffixes);
        AllowedOriginSuffixes = Arr("Domains:AllowedOriginSuffixes", AllowedOriginSuffixes);

        LegalName = Str("Support:LegalName", LegalName);
        Address = Str("Support:Address", Address);
        SupportEmail = Str("Support:Email", SupportEmail);
        SupportPhones = Arr("Support:Phones", SupportPhones);
        SupportHours = Str("Support:Hours", SupportHours);
        NoReplyEmail = Str("Support:NoReplyEmail", NoReplyEmail);
        InternalCcList = Arr("Support:InternalCc", InternalCcList);
        PrivacyEmail = Str("Support:PrivacyEmail", PrivacyEmail);

        LogoUrl = Str("Look:LogoUrl", LogoUrl);
        LogoDarkUrl = Str("Look:LogoDarkUrl", LogoDarkUrl);
        PdfLogoPath = Str("Look:PdfLogoPath", PdfLogoPath);
        FaviconUrl = Str("Look:FaviconUrl", FaviconUrl);
        OpenGraphImageUrl = Str("Look:OpenGraphImageUrl", OpenGraphImageUrl);

        DefaultLanguage = Str("Locale:DefaultLanguage", DefaultLanguage);
        Languages = Arr("Locale:Languages", Languages);
        NumberLocale = Str("Locale:NumberLocale", NumberLocale);
        DefaultCurrency = Str("Locale:DefaultCurrency", DefaultCurrency);
        Currencies = Arr("Locale:Currencies", Currencies);
        DefaultTimeZone = Str("Locale:DefaultTimeZone", DefaultTimeZone);
        InstanceTimeZone = Str("Locale:InstanceTimeZone", InstanceTimeZone);
        DefaultCountryId = Num("Locale:DefaultCountryId", DefaultCountryId);

        PaymentProviders = Arr("Providers:Payments", PaymentProviders);

        Zones = Arr("Scope:Zones", Zones);
        PulledZoneNames = Arr("Scope:PulledZoneNames", PulledZoneNames);
        Countries = Arr("Scope:Countries", Countries);
        ExemptDistricts = Arr("Scope:ExemptDistricts", ExemptDistricts);
        CogClubId = Num("Scope:CogClubId", CogClubId);
        TestDistrictNumber = Str("Scope:TestDistrictNumber", TestDistrictNumber);
        DistrictReportSendHour = Num("Scope:DistrictReportSendHour", DistrictReportSendHour);
        var days = Arr("Scope:DistrictReportDaysOfMonth", Array.Empty<string>());
        if (days.Length > 0) DistrictReportDaysOfMonth = days.Select(d => int.TryParse(d, out var n) ? n : 0).Where(n => n > 0).ToArray();

        PrivacyUrl = Str("Legal:PrivacyUrl", PrivacyUrl);
        TermsUrl = Str("Legal:TermsUrl", TermsUrl);
        RefundsUrl = Str("Legal:RefundsUrl", RefundsUrl);
        CookiesUrl = Str("Legal:CookiesUrl", CookiesUrl);
        PolicyVersion = Str("Legal:PolicyVersion", PolicyVersion);
        CookieNotice = Bool("Legal:CookieNotice", CookieNotice);
        ConsentRequiredFor = Arr("Privacy:ConsentRequiredFor", ConsentRequiredFor);
        var retention = new Dictionary<string, int>(RetentionDays);
        foreach (var c in config.GetSection("Brand:Privacy:RetentionDays").GetChildren())
            if (int.TryParse(c.Value, out var n)) retention[c.Key] = n;
        RetentionDays = retention;

        // Feature keys contain dots ("member.bloodGroup"), which configuration keeps intact.
        var features = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in config.GetSection("Brand:Features").GetChildren())
            if (bool.TryParse(c.Value, out var on)) features[c.Key] = on;
        _features = features;

        CommunicationEmail = Str("CommunicationEmail", config["Brevo:MassEmailSenderEmail"] ?? CommunicationEmail);
        ReportRecipients = Arr("ReportRecipients", ReportRecipients);
        ExcludedClubNamePatterns = config.GetSection("DistrictPerformanceReport:ExcludedClubNames").GetChildren()
            .Select(c => c.Value?.Trim() ?? "").Where(v => v.Length > 0).ToArray();
        SuperAdminEmail = Str("SuperAdminEmail", SuperAdminEmail);
    }

    /// <summary>The configured flag, else the ROW default; an unknown flag is off.</summary>
    public static bool Feature(string key) =>
        _features.TryGetValue(key, out var on) ? on : FeatureDefaults.TryGetValue(key, out var d) && d;

    /// <summary>Every flag, resolved, for the public brand endpoint.</summary>
    public static Dictionary<string, bool> ResolvedFeatures()
    {
        var all = new Dictionary<string, bool>(FeatureDefaults, StringComparer.OrdinalIgnoreCase);
        foreach (var (k, v) in _features) all[k] = v;
        return all;
    }

    /// <summary>True when the host is the portal, a club-site domain or one of the allowed origins.</summary>
    public static bool IsOwnHost(string host)
    {
        host = host.ToLowerInvariant();
        foreach (var d in AllowedOriginSuffixes.Append(PortalDomain).Append(ClubSiteParentDomain).Concat(ClubSiteSuffixes))
        {
            var p = d.Trim('.').ToLowerInvariant();
            if (Uri.TryCreate(p, UriKind.Absolute, out var u)) p = u.Host;
            if (p.Length > 0 && (host == p || host.EndsWith("." + p))) return true;
        }
        return false;
    }

    /// <summary>Logo for email headers: Brand:Look:LogoUrl, else the white ROW lockup served by the portal; empty when neither is set.</summary>
    public static string EmailLogoUrl =>
        LogoUrl.Length > 0 ? AbsoluteFromPortal(LogoUrl) : PortalOrigin.Length > 0 ? PortalOrigin + "/brand/row-logo-badge.png" : "";

    private static string AbsoluteFromPortal(string url) =>
        url.StartsWith("http", StringComparison.OrdinalIgnoreCase) || PortalOrigin.Length == 0 ? url : PortalOrigin + "/" + url.TrimStart('/');

    /// <summary>Club-site parent domains as ".suffix" values (parent domain first, then aliases).</summary>
    public static string[] ClubSiteDotSuffixes =>
        ClubSiteSuffixes.Prepend(ClubSiteParentDomain).Select(d => d.Trim('.')).Where(d => d.Length > 0)
            .Select(d => "." + d).Distinct().ToArray();

    /// <summary>Support contacts for email footers: the configured phone, email and portal, " | "-separated.</summary>
    public static string ContactHtml() =>
        string.Join(" &nbsp;|&nbsp; ", new[] { SupportPhone, SupportEmail, PortalDomain }.Where(v => v.Length > 0));

    /// <summary>The brand's time zone (<c>Brand:Locale:DefaultTimeZone</c>, IANA or Windows id); UTC when unknown.</summary>
    public static TimeZoneInfo TimeZone
    {
        get
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(DefaultTimeZone); }
            catch { return TimeZoneInfo.Utc; }
        }
    }

    /// <summary>Wall-clock now in the brand's time zone (the original platform used the server's India clock).</summary>
    public static DateTime Now => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZone);

    /// <summary>The brand's currency code, letters only, safe to place in SQL text (fallback for a project without a currency).</summary>
    public static string SqlCurrency => new string(DefaultCurrency.Where(char.IsLetter).Take(5).ToArray()) is { Length: > 0 } c ? c : "USD";

    /// <summary>Short label for the brand's time zone in texts, e.g. "UTC" or "America/Chicago".</summary>
    public static string TimeZoneLabel => DefaultTimeZone;

    /// <summary>
    /// An amount as currency in the brand's number locale, e.g. "$1,234.00" (same as the NestJS edition's
    /// formatNumber(v, "C")). <paramref name="currency"/> defaults to the brand's currency.
    /// </summary>
    public static string Money(decimal value, string? currency = null, int decimals = 2)
    {
        var code = string.IsNullOrWhiteSpace(currency) ? DefaultCurrency : currency.Trim().ToUpperInvariant();
        System.Globalization.CultureInfo culture;
        try { culture = (System.Globalization.CultureInfo)System.Globalization.CultureInfo.GetCultureInfo(NumberLocale).Clone(); }
        catch { culture = (System.Globalization.CultureInfo)System.Globalization.CultureInfo.InvariantCulture.Clone(); }
        culture.NumberFormat.CurrencySymbol = CurrencySymbol(code);
        return value.ToString("C" + decimals, culture);
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _symbols = new();
    private static string CurrencySymbol(string code) => _symbols.GetOrAdd(code, c =>
    {
        foreach (var ci in System.Globalization.CultureInfo.GetCultures(System.Globalization.CultureTypes.SpecificCultures))
        {
            try
            {
                var region = new System.Globalization.RegionInfo(ci.Name);
                if (region.ISOCurrencySymbol == c) return region.CurrencySymbol;
            }
            catch { /* neutral or invalid culture */ }
        }
        return c + " ";
    });


    /// <summary>The non-secret brand for GET api/public/brand (same JSON as the NestJS edition).</summary>
    public static object PublicView() => new
    {
        instanceCode = InstanceCode,
        productName = ProductName,
        shortName = ShortName,
        logoUrl = LogoUrl,
        logoDarkUrl = LogoDarkUrl,
        faviconUrl = FaviconUrl,
        openGraphImageUrl = OpenGraphImageUrl,
        support = new { email = SupportEmail, phones = SupportPhones, hours = SupportHours, address = Address, legalName = LegalName, privacyEmail = PrivacyEmail },
        locale = new
        {
            defaultLanguage = DefaultLanguage, languages = Languages, defaultCurrency = DefaultCurrency, currencies = Currencies,
            defaultTimeZone = DefaultTimeZone, numberLocale = NumberLocale, defaultCountryId = DefaultCountryId,
        },
        features = ResolvedFeatures(),
        legal = new { privacyUrl = PrivacyUrl, termsUrl = TermsUrl, refundsUrl = RefundsUrl, cookiesUrl = CookiesUrl, policyVersion = PolicyVersion },
        domains = new { adminOrigin = AdminOrigin, clubSiteParent = ClubSiteParentDomain },
        paymentGateways = PaymentProviders,
    };
}

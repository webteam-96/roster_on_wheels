using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Routes OTP delivery for members OUTSIDE INDIA to WhatsApp (Interakt).
///
/// WHY: the SMS gateway is India-only (DLT-registered sender), so an international
/// member's OTP SMS never arrives. Meta approved an AUTHENTICATION template for us —
/// body <c>{{1}} is your verification code.</c> plus a one-tap "Copy Code" button —
/// which is now the delivery channel for every non-India OTP.
///
/// SAFETY RULE: India is the default. This helper returns "not outside India" whenever
/// the country cannot be established, so a missing/blank country can never divert a
/// domestic OTP away from the existing SMS path.
///
/// Used by:
///   - <see cref="MobileAuthService"/>                        (mobile app login)
///   - <c>PublicDirectoryController.SendOtp</c>               (district directory form)
///   - <see cref="EventPaymentLinkService"/>                  (public event payment)
///   - <see cref="MembershipDuesService"/>                    (public dues payment)
/// Deliberately NOT used by the SuperAdmin-approval OTP (fixed Indian approver number
/// from config, no member country to resolve) or the email-only OTP flows
/// (Razorpay Route onboarding, Cashfree KYC).
///
/// NOTE: <see cref="MobileAuthService"/> and <c>PublicDirectoryController.SendOtp</c> route
/// India = SMS-only / outside India = Email-only (business rule, 2026-08-24) — they call
/// this helper only for the outside-India dial-code resolution, never for an India send.
/// </summary>
public static class OtpWhatsAppHelper
{
    /// <summary>country_master seeds India first, so pk_country_id = 1. Same constant the
    /// existing OTP call-sites already use (INDIA_COUNTRY_ID).</summary>
    public const int IndiaCountryId = 1;

    private const string IndiaDialCode = "91";

    /// <summary>Interakt config key, following the <c>ClubWebsiteReminderTemplate</c> precedent.</summary>
    public const string TemplateConfigKey = "Interakt:OtpTemplateName";

    /// <summary>
    /// Meta-approved authentication template. Body: "{{1}} is your verification code."
    /// with a Copy Code button. Used when the config key is absent/blank — an OTP that
    /// silently isn't delivered locks the user out, so this never degrades to "skip".
    /// </summary>
    public const string DefaultTemplateName = "row_otp";

    public static string ResolveTemplateName(IConfiguration config)
    {
        var configured = config[TemplateConfigKey];
        return string.IsNullOrWhiteSpace(configured) ? DefaultTemplateName : configured.Trim();
    }

    private static string DigitsOnly(string? value) =>
        new((value ?? string.Empty).Where(char.IsDigit).ToArray());

    private static string MaskMobile(string? mobile)
    {
        var digits = DigitsOnly(mobile);
        return digits.Length <= 4 ? "****" : new string('*', digits.Length - 4) + digits[^4..];
    }

    /// <summary>
    /// Decides whether an OTP recipient is outside India and, if so, returns the dial code
    /// ("+44") that Interakt needs alongside the national number.
    /// Returns <c>null</c> for India AND for every "can't tell" case — the caller must then
    /// keep its existing delivery channel untouched.
    /// </summary>
    /// <param name="conn">MySQL connection (SELECT only).</param>
    /// <param name="countryId">member_master_profile.fk_primary_country_id, when known.</param>
    /// <param name="mobile">The number the OTP would go to; only used when countryId is null.</param>
    public static async Task<string?> ResolveOutsideIndiaDialCodeAsync(
        MySqlConnection conn, int? countryId, string? mobile)
    {
        // ── Signal 1 (preferred): the member's own country row. ──────────────────
        // Most reliable — it is the field the member/admin maintains, and it is what
        // country_master.PhoneCode is keyed on, so it yields the dial code directly.
        if (countryId.HasValue)
        {
            if (countryId.Value == IndiaCountryId) return null;

            var phoneCode = await conn.ExecuteScalarAsync<string?>(
                "SELECT PhoneCode FROM country_master WHERE pk_country_id = @Id AND isdeleted = 0",
                new { Id = countryId.Value });

            var codeDigits = DigitsOnly(phoneCode);
            // No dial code on file → we cannot address WhatsApp correctly → treat as India.
            if (codeDigits.Length == 0) return null;
            // Belt-and-braces: a non-1 row that is still India by dial code stays domestic.
            if (codeDigits == IndiaDialCode) return null;
            return "+" + codeDigits;
        }

        // ── Signal 2 (fallback): an explicitly international number. ─────────────
        // Only "+<cc>…" counts. A bare national number is ambiguous (an Indian mobile can
        // legitimately start with the digits of another country's dial code), so anything
        // without the leading "+" stays on the existing channel.
        var raw = (mobile ?? string.Empty).Trim();
        if (!raw.StartsWith('+')) return null;

        var mobileDigits = DigitsOnly(raw);
        if (mobileDigits.Length == 0 || mobileDigits.StartsWith(IndiaDialCode)) return null;

        // Longest dial-code prefix wins so "+1868" (Trinidad) isn't read as "+1" (USA).
        var matched = await conn.ExecuteScalarAsync<string?>(@"
            SELECT PhoneCode FROM country_master
            WHERE isdeleted = 0
              AND PhoneCode IS NOT NULL AND PhoneCode <> ''
              AND @Digits LIKE CONCAT(REPLACE(PhoneCode, '+', ''), '%')
            ORDER BY LENGTH(REPLACE(PhoneCode, '+', '')) DESC
            LIMIT 1",
            new { Digits = mobileDigits });

        var matchedDigits = DigitsOnly(matched);
        return matchedDigits.Length == 0 ? null : "+" + matchedDigits;
    }

    /// <summary>
    /// Sends the OTP over WhatsApp using the approved authentication template.
    /// Never throws — returns false when nothing was delivered so the caller can fall back
    /// to its other channel. Failures are logged loudly: an OTP that silently never arrives
    /// locks the member out.
    /// </summary>
    public static async Task<bool> TrySendAsync(
        IInteraktService interakt,
        IConfiguration config,
        ILogger logger,
        string mobile,
        string dialCode,
        string otp,
        string context)
    {
        var template = ResolveTemplateName(config);
        try
        {
            // bodyValues = [otp]  →  "{{1}} is your verification code."
            // buttonValues = [otp] →  the Copy Code button's parameter, which Meta requires
            //                         on every send of an authentication template.
            var sent = await interakt.SendWhatsAppWithBodyValuesAsync(
                mobile, template, new[] { otp }, dialCode, new[] { otp });

            if (!sent)
                logger.LogWarning(
                    "OTP WhatsApp NOT delivered ({Context}): Interakt rejected template {Template} for {DialCode} {Mobile}. Falling back to the other channel.",
                    context, template, dialCode, MaskMobile(mobile));

            return sent;
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "OTP WhatsApp NOT delivered ({Context}): send threw for template {Template} to {DialCode} {Mobile}. Falling back to the other channel.",
                context, template, dialCode, MaskMobile(mobile));
            return false;
        }
    }

    /// <summary>
    /// One-stop routing used by the OTP call-sites: resolves whether the recipient is outside
    /// India and, if so, delivers the OTP over WhatsApp.
    /// Returns false WITHOUT sending anything for India / unknown country, which is the signal
    /// for the caller to run its pre-existing channel exactly as before.
    /// </summary>
    public static async Task<bool> TrySendOutsideIndiaAsync(
        MySqlConnection conn,
        IInteraktService interakt,
        IConfiguration config,
        ILogger logger,
        string? mobile,
        int? countryId,
        string otp,
        string context)
    {
        if (string.IsNullOrWhiteSpace(mobile) || string.IsNullOrWhiteSpace(otp)) return false;

        // Cost kill-switch: WhatsApp OTP (Interakt) can be turned off entirely via config
        // (WhatsAppOtp:Enabled = false). When disabled, NO WhatsApp is sent for anyone; a non-India
        // member then relies on the email OTP that every call-site also sends. Defaults to true, so
        // omitting the key preserves the existing behaviour.
        if (!config.GetValue("WhatsAppOtp:Enabled", true))
        {
            logger.LogInformation(
                "WhatsApp OTP skipped ({Context}): disabled via WhatsAppOtp:Enabled=false. Recipient falls back to email.",
                context);
            return false;
        }

        var dialCode = await ResolveOutsideIndiaDialCodeAsync(conn, countryId, mobile);
        if (dialCode == null) return false; // India, or undeterminable → existing behaviour

        return await TrySendAsync(interakt, config, logger, mobile.Trim(), dialCode, otp, context);
    }
}

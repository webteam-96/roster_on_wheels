using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// One-time codes over WhatsApp (Meta authentication template: body <c>{{1}} is your verification code.</c> plus a
/// copy-code button) for the call sites that send a code alongside email or SMS: public event payment and public dues
/// payment. Sent only when <c>Brand:Providers:OtpPolicy</c> lists "whatsapp" for the member's country (the original
/// platform sent it to every member outside India). Mobile login uses <see cref="OtpChannelPolicy"/> directly.
/// </summary>
public static class OtpWhatsAppHelper
{
    /// <summary>Setting that overrides the template name.</summary>
    public const string TemplateConfigKey = "WhatsApp:OtpTemplateName";

    /// <summary>Default template, the same as the NestJS edition's.</summary>
    public const string DefaultTemplateName = "otp";

    public static string ResolveTemplateName(IConfiguration config)
    {
        var configured = config[TemplateConfigKey];
        return string.IsNullOrWhiteSpace(configured) ? DefaultTemplateName : configured.Trim();
    }

    private static string MaskMobile(string? mobile)
    {
        var digits = new string((mobile ?? "").Where(char.IsDigit).ToArray());
        return digits.Length <= 4 ? "****" : new string('*', digits.Length - 4) + digits[^4..];
    }

    /// <summary>
    /// Sends the code over WhatsApp when the policy allows it for the member's country. Never throws; false means
    /// nothing was sent and the caller uses its other channel.
    /// </summary>
    public static async Task<bool> TrySendAsync(
        MySqlConnection conn,
        IWhatsAppService whatsApp,
        IConfiguration config,
        ILogger logger,
        string? mobile,
        int? countryId,
        string otp,
        string context)
    {
        if (string.IsNullOrWhiteSpace(mobile) || string.IsNullOrWhiteSpace(otp)) return false;
        if (!config.GetValue("WhatsAppOtp:Enabled", true)) return false;   // cost switch: WhatsAppOtp:Enabled=false
        if (!(await OtpChannelPolicy.ChannelsForAsync(conn, countryId)).Contains("whatsapp")) return false;

        var template = ResolveTemplateName(config);
        try
        {
            var dialCode = await RowPhone.DialCodeAsync(conn, countryId);
            // bodyValues = [otp] → "{{1}} is your verification code."; buttonValues = [otp] → the copy-code button.
            var sent = await whatsApp.SendWhatsAppWithBodyValuesAsync(mobile.Trim(), template, new[] { otp }, dialCode, new[] { otp });
            if (!sent)
                logger.LogWarning("OTP WhatsApp not delivered ({Context}): template {Template} to {Mobile}. Falling back to the other channel.",
                    context, template, MaskMobile(mobile));
            return sent;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "OTP WhatsApp not delivered ({Context}): send threw for template {Template} to {Mobile}.",
                context, template, MaskMobile(mobile));
            return false;
        }
    }
}

using System.Net;

namespace RotaryApi.Services;

public class SmsService : ISmsService
{
    private readonly IConfiguration _config;
    private readonly HttpClient _httpClient;
    private readonly ILogger<SmsService> _logger;

    public SmsService(IConfiguration config, IHttpClientFactory httpClientFactory, ILogger<SmsService> logger)
    {
        _config = config;
        _httpClient = httpClientFactory.CreateClient();
        _logger = logger;
    }

    public async Task<bool> SendOtpSmsAsync(string mobileNumber, string otpCode)
    {
        try
        {
            var sms = _config.GetSection("SmsSettings");
            // DLT-registered template (do NOT change wording — must match TID 1207174279881062481 byte-for-byte).
            var message = $"your one time password(OTP){otpCode}.Please enter the OTP to proceed. Thank you, RI the zones.";
            var encodedMsg = WebUtility.UrlEncode(message);

            var url = $"{sms["Url"]}username={sms["Username"]}&apikey={sms["Password"]}" +
                      $"&senderid={sms["SenderId"]}&route=OTP&mobile={mobileNumber}" +
                      $"&text={encodedMsg}&TID={sms["TemplateId"]}&PEID={sms["PeId"]}";

            _logger.LogInformation("SMS URL: {Url}", url);
            var response = await _httpClient.GetAsync(url);
            var responseBody = await response.Content.ReadAsStringAsync();
            _logger.LogInformation("SMS OTP sent to {Mobile}, status: {Status}, response: {Body}", mobileNumber, response.StatusCode, responseBody);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send SMS OTP to {Mobile}", mobileNumber);
            return false;
        }
    }
}

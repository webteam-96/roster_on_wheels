namespace RotaryApi.Services;

public interface ISmsService
{
    Task<bool> SendOtpSmsAsync(string mobileNumber, string otpCode);
}

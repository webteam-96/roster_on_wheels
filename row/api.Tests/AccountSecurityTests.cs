using System.Text;
using Microsoft.Extensions.Configuration;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class AccountSecurityTests
{
    // RFC 6238 appendix B test secret "12345678901234567890" (SHA-1), 8-digit vectors truncated to 6 digits.
    private static readonly string RfcSecret = Totp.Base32Encode(Encoding.ASCII.GetBytes("12345678901234567890"));

    [Theory]
    [InlineData(59L, "287082")]
    [InlineData(1111111109L, "081804")]
    [InlineData(1234567890L, "005924")]
    [InlineData(2000000000L, "279037")]
    public void Totp_matches_rfc6238_vectors(long unixSeconds, string expected)
    {
        Assert.Equal(expected, Totp.Code(RfcSecret, unixSeconds / 30));
    }

    [Fact]
    public void Base32_round_trips()
    {
        var bytes = Enumerable.Range(0, 20).Select(i => (byte)(i * 13)).ToArray();
        Assert.Equal(bytes, Totp.Base32Decode(Totp.Base32Encode(bytes)));
        Assert.Equal("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", RfcSecret);
    }

    [Fact]
    public void Match_accepts_one_step_drift_and_refuses_replay()
    {
        var now = new DateTime(2026, 11, 19, 12, 0, 0, DateTimeKind.Utc);
        var step = Totp.StepAt(now);
        var secret = Totp.NewSecret();
        Assert.Equal(step, Totp.Match(secret, Totp.Code(secret, step), now, null));
        Assert.Equal(step - 1, Totp.Match(secret, Totp.Code(secret, step - 1), now, null));
        Assert.Null(Totp.Match(secret, Totp.Code(secret, step - 2), now, null));
        Assert.Null(Totp.Match(secret, Totp.Code(secret, step), now, lastUsedStep: step)); // replay
        Assert.Null(Totp.Match(secret, "12345", now, null));
        Assert.Null(Totp.Match(secret, "abcdef", now, null));
        Assert.Null(Totp.Match(secret, null, now, null));
    }

    [Fact]
    public void Short_codes_and_tokens_are_random_and_normalise()
    {
        var a = AccountSecurityService.NewShortCode();
        Assert.Matches("^[a-z2-7]{5}-[a-z2-7]{5}$", a);
        Assert.NotEqual(a, AccountSecurityService.NewShortCode());
        Assert.Equal(AccountSecurityService.NormaliseCode(a), AccountSecurityService.NormaliseCode(" " + a.ToUpperInvariant().Replace("-", " ") + " "));
        var t = AccountSecurityService.NewToken();
        Assert.True(t.Length >= 43);
        Assert.DoesNotContain('+', t);
        Assert.DoesNotContain('/', t);
        Assert.Equal(64, AccountSecurityService.Hash(t).Length);
        Assert.NotEqual(AccountSecurityService.Hash(t), AccountSecurityService.Hash(AccountSecurityService.NewToken()));
    }

    [Theory]
    [InlineData(null, false)]      // owner decision 2026-11-20: optional for SuperAdmins by default
    [InlineData("false", false)]
    [InlineData("true", true)]
    public void SuperAdmin_requirement_is_a_setting_defaulting_to_off(string? value, bool expected)
    {
        var settings = new Dictionary<string, string?>();
        if (value != null) settings["AccountSecurity:RequireMfaForSuperAdmins"] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        Assert.Equal(expected, AccountSecurityService.SuperAdminsMustUseMfa(config));
    }

    [Fact]
    public void OtpAuth_uri_has_issuer_and_secret()
    {
        var uri = Totp.OtpAuthUri("ROW", "a.b@example.org", "ABC234");
        Assert.StartsWith("otpauth://totp/ROW:a.b%40example.org?secret=ABC234&issuer=ROW", uri);
    }
}

using RotaryApi.Services;

namespace RotaryApi.Tests;

public class MobileExtrasTests
{
    private static readonly byte[] Key = MobileExtras.QrKey("test-secret");
    private static readonly DateTime Now = new(2026, 11, 20, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void QrToken_RoundTrips_AndCarriesNoPersonalData()
    {
        var token = MobileExtras.CreateQrToken(1068, Now, Key);
        Assert.StartsWith("cx1.1068.", token);
        Assert.Equal(1068, MobileExtras.ReadQrToken(token, Now.AddMinutes(4), Key));
    }

    [Fact]
    public void QrToken_Expires()
    {
        var token = MobileExtras.CreateQrToken(1068, Now, Key);
        Assert.Null(MobileExtras.ReadQrToken(token, Now.AddMinutes(6), Key));
    }

    [Fact]
    public void QrToken_RejectsTamperingAndForeignKeysAndJunk()
    {
        var token = MobileExtras.CreateQrToken(1068, Now, Key);
        Assert.Null(MobileExtras.ReadQrToken(token.Replace("cx1.1068.", "cx1.999."), Now, Key));
        Assert.Null(MobileExtras.ReadQrToken(token, Now, MobileExtras.QrKey("other-secret")));
        var parts = token.Split('.');
        Assert.Null(MobileExtras.ReadQrToken($"cx1.1068.{long.Parse(parts[2]) + 3600}.{parts[3]}", Now, Key));
        Assert.Null(MobileExtras.ReadQrToken("BEGIN:VCARD", Now, Key));
        Assert.Null(MobileExtras.ReadQrToken(null, Now, Key));
        Assert.Null(MobileExtras.ReadQrToken("", Now, Key));
    }

    [Theory]
    [InlineData(0, 0, true)]
    [InlineData(2, 19, true)]
    [InlineData(3, 0, false)]
    [InlineData(0, 20, false)]
    public void ResetRefusal_LimitsPerMemberAndPerSender(int toMember, int bySender, bool allowed)
        => Assert.Equal(allowed, MobileExtras.ResetRefusal(toMember, bySender) == null);

    [Theory]
    [InlineData("anna.perera@example.org", "an***@example.org")]
    [InlineData("a@x.lk", "a***@x.lk")]
    [InlineData("noatsign", "***")]
    public void MaskEmail_HidesMostOfTheAddress(string email, string masked)
        => Assert.Equal(masked, MobileExtras.MaskEmail(email));

    [Fact]
    public void VCard_LeavesOutHiddenFields_AndEscapes()
    {
        var card = MobileExtras.BuildVCard("Anna Maria Perera", null, "anna@example.org", "RC Colombo West; Sri Lanka");
        Assert.Contains("N:Perera;Anna Maria;;;", card);
        Assert.Contains("EMAIL:anna@example.org", card);
        Assert.Contains("ORG:RC Colombo West\\; Sri Lanka", card);
        Assert.DoesNotContain("TEL", card);
        Assert.Contains("+94771234567", MobileExtras.BuildVCard("Anna", "+94 771234567", null, null));
    }
}

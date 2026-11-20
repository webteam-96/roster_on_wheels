using System.Text;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class MassEmailComposeTests
{
    [Theory]
    [InlineData("Asha Rao", "Asha")]
    [InlineData("Rtn. Dr. Asha Rao", "Asha")]
    [InlineData("PDG Ravi Kumar", "Ravi")]
    [InlineData("  ", "")]
    [InlineData(null, "")]
    [InlineData("Dr.", "Dr.")]
    public void First_name_skips_titles(string? full, string expected)
        => Assert.Equal(expected, MassEmailComposeService.FirstNameOf(full));

    [Fact]
    public void Merge_fills_fields_per_recipient_and_encodes_html()
    {
        var extras = new MassEmailComposeService.SendExtras
        {
            OwnerClubName = "Colombo West",
            DistrictNumber = "3220",
            Dues = new() { [7] = 1250m },
            DefaultDues = 1000m,
        };
        var r = new CommsService.CampaignRecipient(1, 7, "Rtn. Asha <b>Rao</b>", "asha@example.org", null);
        var (s, h) = extras.Merge(r, "Hi {{first_name}}, {{club_name}}", "<p>{{member_name}} owes {{dues_amount}} in D{{district_number}} {{unknown}}</p>");
        Assert.Equal("Hi Asha, Colombo West", s);
        Assert.Equal("<p>Rtn. Asha &lt;b&gt;Rao&lt;/b&gt; owes 1,250.00 in D3220 {{unknown}}</p>", h);

        var other = new CommsService.CampaignRecipient(2, 8, "Ben", "ben@example.org", null);
        Assert.Equal("1,000.00", extras.ValuesFor(other)["dues_amount"]);
    }

    [Fact]
    public void District_send_uses_the_members_own_club()
    {
        var extras = new MassEmailComposeService.SendExtras { MemberClub = new() { [8] = "Kandy" } };
        var r = new CommsService.CampaignRecipient(2, 8, "Ben", "ben@example.org", null);
        Assert.Equal("Kandy", extras.ValuesFor(r)["club_name"]);
        Assert.Equal("", extras.ValuesFor(r)["dues_amount"]);
    }

    [Fact]
    public void Attachment_rules_accept_real_files()
    {
        Assert.Null(MassEmailComposeService.CheckAttachment("agenda.pdf", Encoding.ASCII.GetBytes("%PDF-1.7 ...")));
        Assert.Null(MassEmailComposeService.CheckAttachment("list.csv", Encoding.UTF8.GetBytes("name,email\nA,a@x.org")));
        Assert.Null(MassEmailComposeService.CheckAttachment("plan.docx", new byte[] { 0x50, 0x4B, 0x03, 0x04, 1, 2 }));
        Assert.Null(MassEmailComposeService.CheckAttachment("photo.JPG", new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }));
    }

    [Theory]
    [InlineData("setup.exe")]
    [InlineData("script.js")]
    [InlineData("page.html")]
    [InlineData("noext")]
    public void Attachment_rules_refuse_unsafe_types(string name)
        => Assert.NotNull(MassEmailComposeService.CheckAttachment(name, Encoding.ASCII.GetBytes("hello")));

    [Fact]
    public void Attachment_rules_refuse_renamed_and_oversized_files()
    {
        var exe = new byte[] { (byte)'M', (byte)'Z', 0, 0, 3 };
        Assert.NotNull(MassEmailComposeService.CheckAttachment("agenda.pdf", exe));
        Assert.NotNull(MassEmailComposeService.CheckAttachment("notes.txt", exe)); // NUL bytes: not text
        Assert.NotNull(MassEmailComposeService.CheckAttachment("empty.pdf", Array.Empty<byte>()));
        var big = new byte[MassEmailComposeService.MaxFileBytes + 1];
        "%PDF"u8.CopyTo(big);
        Assert.NotNull(MassEmailComposeService.CheckAttachment("big.pdf", big));
    }

    [Fact]
    public void Starters_only_use_known_merge_fields_and_no_em_dashes()
    {
        var known = MassEmailComposeService.MergeFields.Select(f => f.Token).ToHashSet();
        foreach (var t in MassEmailComposeService.Starters)
        {
            foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(t.Subject + t.BodyHtml, @"\{\{[a-z_]+\}\}"))
                Assert.Contains(m.Value, known);
            Assert.DoesNotContain("—", t.Subject + t.BodyHtml);
        }
    }
}

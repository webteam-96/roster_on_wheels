using RotaryApi.Privacy;

namespace RotaryApi.Tests;

public class PrivacyEraseTests
{
    [Theory]
    [InlineData("Asha Perera", "Asha Perera", true)]
    [InlineData("Asha Perera", "  asha   PERERA ", true)]
    [InlineData("Asha Perera", "Asha", false)]
    [InlineData("Asha Perera", "", false)]
    [InlineData("Asha Perera", null, false)]
    [InlineData("", "erase", true)]
    [InlineData("  ", "Asha", false)]
    public void Typed_confirmation_must_match_the_name(string name, string? typed, bool ok) =>
        Assert.Equal(ok, PersonalDataRegistry.ConfirmMatches(name, typed));

    [Theory]
    // superAdmin, self, memberActive, directClubAdmin, districtAdmin (member's district), anyDistrictAdmin -> mode
    [InlineData(true, false, true, false, false, false, PrivacyService.EraseMode.Immediate)]
    [InlineData(false, false, false, true, false, false, PrivacyService.EraseMode.Immediate)]       // club admin only, former member
    [InlineData(false, false, true, true, false, false, PrivacyService.EraseMode.Denied)]          // club admin, member still active
    [InlineData(false, false, false, false, true, true, PrivacyService.EraseMode.NeedsApproval)]   // District Admin (any scope)
    [InlineData(false, false, true, false, true, true, PrivacyService.EraseMode.NeedsApproval)]
    [InlineData(false, false, false, true, true, true, PrivacyService.EraseMode.NeedsApproval)]    // club admin AND DA of that district
    [InlineData(false, false, false, true, false, true, PrivacyService.EraseMode.NeedsApproval)]   // club admin AND DA of another district
    [InlineData(false, false, true, true, true, true, PrivacyService.EraseMode.NeedsApproval)]     // active member: club role gives no shortcut
    [InlineData(false, false, true, true, false, true, PrivacyService.EraseMode.Denied)]           // active member, DA elsewhere only
    [InlineData(false, true, false, true, false, false, PrivacyService.EraseMode.Denied)]          // never yourself
    [InlineData(false, false, false, false, false, true, PrivacyService.EraseMode.Denied)]         // DA of an unrelated district
    [InlineData(false, false, false, false, false, false, PrivacyService.EraseMode.Denied)]
    public void Only_SuperAdmin_or_a_club_admin_without_district_role_erases_in_one_step(
        bool sa, bool self, bool active, bool clubAdmin, bool da, bool anyDa, PrivacyService.EraseMode expected) =>
        Assert.Equal(expected, PrivacyService.DecideEraseMode(sa, self, active, clubAdmin, da, anyDa));

    [Fact]
    public void Change_log_is_cleared_after_every_update_that_feeds_it()
    {
        // trg_mcl_* triggers copy old profile, address and family values into member_change_log on update.
        var tables = PersonalDataRegistry.Tables.Select(t => t.Table).ToList();
        var log = tables.LastIndexOf("member_change_log");
        Assert.Equal(tables.Count - 1, log);
        Assert.Equal(EraseAction.DeleteRows, PersonalDataRegistry.Tables[log].OnErase);
        foreach (var fed in new[] { "member_master_profile", "member_address_details", "member_family_details" })
            Assert.True(tables.IndexOf(fed) < log, fed);
    }

    [Fact]
    public void Counts_and_totals_are_kept()
    {
        Keeps("club_attendance_members");
        Keeps("membership_dues_member_fees");
        Keeps("club_dues_members");
        var dues = PersonalDataRegistry.Tables.Single(t => t.Table == "membership_dues_payments");
        Assert.Equal(EraseAction.Anonymise, dues.OnErase);
        Assert.DoesNotContain("Amount", dues.Set!.Keys);
        Assert.Contains("Attachment", dues.Set!.Keys);
    }

    [Fact]
    public void Every_file_query_takes_the_member_id() =>
        Assert.All(PersonalDataRegistry.FileQueries, q => Assert.Contains("@Id", q));

    private static void Keeps(string table) =>
        Assert.Equal(EraseAction.Keep, PersonalDataRegistry.Tables.Single(t => t.Table == table).OnErase);
}

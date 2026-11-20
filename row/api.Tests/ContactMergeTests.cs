using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class ContactMergeTests
{
    private static ContactDto C(int id, string name, string? email = null, string? mobile = null, string? org = null, int day = 1)
        => new() { Id = id, Name = name, Email = email, Mobile = mobile, Organisation = org, ContactType = "guest", CreatedDate = new DateTime(2026, 1, day) };

    [Fact]
    public void Finds_groups_by_email_phone_and_name_transitively()
    {
        var list = new[]
        {
            C(1, "Anil Perera", "anil@x.org"),
            C(2, "A. Perera", "ANIL@x.org", "+94 77 123 4567"),
            C(3, "Someone Else", null, "077 123 4567"),
            C(4, "Nimal Silva"),
            C(5, "nimal  silva."),
            C(6, "Unrelated"),
        };
        var groups = ContactMergeRules.FindDuplicates(list);
        Assert.Equal(2, groups.Count);
        var first = groups.Single(g => g.Contacts.Any(c => c.Id == 1));
        Assert.Equal(new[] { 1, 2, 3 }, first.Contacts.Select(c => c.Id).OrderBy(i => i));
        Assert.Contains("Same email", first.Reasons);
        Assert.Contains("Same phone", first.Reasons);
        Assert.Equal(new[] { "Same name" }, groups.Single(g => g.Contacts.Any(c => c.Id == 4)).Reasons);
    }

    [Fact]
    public void Short_numbers_and_names_do_not_match()
    {
        Assert.Empty(ContactMergeRules.FindDuplicates(new[] { C(1, "Al", null, "123"), C(2, "Al", null, "123") }));
    }

    [Fact]
    public void Pick_takes_chosen_fields_then_survivor_then_oldest_non_blank()
    {
        var set = new[] { C(1, "Anil", "anil@x.org", null, null, 5), C(2, "Anil Perera", null, "0771234567", "Acme", 2), C(3, "A P", null, "0712222222", "Other", 1) };
        var m = ContactMergeRules.Pick(set, 1, new Dictionary<string, int> { ["name"] = 2 });
        Assert.Equal(1, m.Id);
        Assert.Equal("Anil Perera", m.Name);
        Assert.Equal("anil@x.org", m.Email);       // survivor's own value
        Assert.Equal("0712222222", m.Mobile);      // survivor blank: oldest other
        Assert.Equal("Other", m.Organisation);
    }

    [Fact]
    public void Pick_rejects_values_from_outside_the_set_and_unknown_fields()
    {
        var set = new[] { C(1, "A"), C(2, "B") };
        Assert.Throws<ArgumentException>(() => ContactMergeRules.Pick(set, 1, new Dictionary<string, int> { ["name"] = 9 }));
        Assert.Throws<ArgumentException>(() => ContactMergeRules.Pick(set, 1, new Dictionary<string, int> { ["password"] = 2 }));
        Assert.Throws<ArgumentException>(() => ContactMergeRules.Pick(set, 7, null));
    }

    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\"")]
    [InlineData("+94 77", "+94 77")]
    [InlineData("+cmd|x", "'+cmd|x")]
    [InlineData("@SUM(1)", "'@SUM(1)")]
    [InlineData(null, "")]
    public void Csv_cells_are_quoted_and_formula_safe(string? input, string expected)
        => Assert.Equal(expected, ContactMergeRules.CsvCell(input));

    [Fact]
    public void Friend_is_a_contact_type()
    {
        Assert.Equal("friend", ContactRules.ContactType(" Friend "));
        Assert.Equal("friend", ContactRules.ContactType("Friend of the club"));
    }
}

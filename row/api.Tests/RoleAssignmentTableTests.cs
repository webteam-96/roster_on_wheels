using RotaryApi.Services;
using Role = RotaryApi.Services.RoleAssignmentTable.Role;

namespace RotaryApi.Tests;

// OMS ROW-66: the Make Admin email left the Member row and the district number empty.
public class RoleAssignmentTableTests
{
    [Theory]
    [InlineData(1, "Rotary Club of Thane City View", "5656", "Member", "District 5656 - Rotary Club of Thane City View")]
    [InlineData(2, "Rotary Club of Thane City View", "5656", "Club Admin", "District 5656 - Rotary Club of Thane City View")]
    [InlineData(2, null, "5656", "District Admin", "District 5656")]
    [InlineData(6, null, "5656", "AG", "District 5656")]
    [InlineData(3, null, null, "Super Admin", "All Districts & Clubs")]
    [InlineData(2, "Lone Club", null, "Club Admin", "Lone Club")]
    public void Every_role_says_where_it_applies(int roleId, string? club, string? district, string name, string details)
    {
        var html = RoleAssignmentTable.Html([new Role(roleId, club, district)]);
        Assert.Contains($">{name}</td>", html);
        Assert.Contains($">{details}</td>", html);
    }

    [Fact]
    public void A_role_with_nothing_to_show_is_left_out() =>
        Assert.DoesNotContain("<td", RoleAssignmentTable.Html([new Role(1, null, null)]));

    [Fact]
    public void Club_names_are_html_encoded() =>
        Assert.Contains("A &lt;b&gt; &amp; C", RoleAssignmentTable.Html([new Role(1, "A <b> & C", "1")]));
}

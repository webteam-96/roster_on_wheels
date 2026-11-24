using System.Reflection;
using Microsoft.Extensions.Configuration;
using RotaryApi.Services;

namespace RotaryApi.Tests;

// OMS ROW-58: a project email showed an empty Direct Beneficiaries row, and its header logo pointed at the admin
// app's folder, which answers 404 once that app lives under /admin. Media is served by the API only.
public class EmailBrandingTests
{
    private const string Host = "https://row.example";

    public EmailBrandingTests() => Brand.Init(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Brand:Domains:AdminOrigin"] = Host + "/admin",
        ["Brand:Domains:ApiBase"] = Host,
    }).Build());

    private static string Call(Type type, string method, params object?[] args) =>
        (string)type.GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, args)!;

    private static string ProjectHtml(string? cost, string? beneficiaries, string? manHours) =>
        Call(typeof(EmailScheduledSendBackgroundService), "BuildProjectHtml",
            "Rotary Club", "Cyclathon", "24 Nov 2026", "Others", cost, beneficiaries, manHours, Host + "/admin/public/project/1");

    [Fact]
    public void A_project_email_leaves_out_the_fields_its_module_does_not_collect()
    {
        var html = ProjectHtml(null, null, null);
        Assert.DoesNotContain("Direct Beneficiaries", html);
        Assert.DoesNotContain("Project Cost", html);
        Assert.DoesNotContain("Man Hours", html);
    }

    [Fact]
    public void A_project_email_shows_the_fields_that_are_filled_in()
    {
        var html = ProjectHtml("5,000", "120", "0");
        Assert.Contains("Direct Beneficiaries", html);
        Assert.Contains(">120<", html);
        Assert.Contains(">0<", html);
    }

    [Fact]
    public void The_header_logo_of_a_project_email_is_served_by_the_api() =>
        Assert.Contains($"src='{Host}/api/public/brand/email-logo.png'", ProjectHtml(null, null, null));

    [Theory]
    [InlineData(null, Host + "/api/public/brand/email-logo.png")]
    [InlineData("/uploads/club/logo.png", Host + "/uploads/club/logo.png")]
    [InlineData("https://cdn.example/logo.png", "https://cdn.example/logo.png")]
    public void The_header_logo_of_a_dues_email_is_served_by_the_api(string? stored, string expected) =>
        Assert.Equal(expected, Call(typeof(MembershipDuesService), "ResolveEmailHeaderLogoUrl", stored));
}

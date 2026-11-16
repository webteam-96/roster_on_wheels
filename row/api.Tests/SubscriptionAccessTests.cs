using RotaryApi.Services;
using Xunit;

namespace RotaryApi.Tests;

/// <summary>Access rules from KIS/ROW/SUB/01 sections 2 and 4.5.</summary>
public class SubscriptionAccessTests
{
    private static readonly DateTime Today = new(2026, 11, 13);

    [Fact]
    public void StateOn_follows_term_then_grace_then_expired()
    {
        Assert.Equal(SubscriptionState.None, SubscriptionAccess.StateOn(null, Today, 30));
        Assert.Equal(SubscriptionState.Active, SubscriptionAccess.StateOn(Today, Today, 30));
        Assert.Equal(SubscriptionState.Grace, SubscriptionAccess.StateOn(Today.AddDays(-1), Today, 30));
        Assert.Equal(SubscriptionState.Grace, SubscriptionAccess.StateOn(Today.AddDays(-30), Today, 30));
        Assert.Equal(SubscriptionState.Expired, SubscriptionAccess.StateOn(Today.AddDays(-31), Today, 30));
    }

    [Theory]
    [InlineData(SubscriptionState.Active, SubscriptionState.None, ClubAccessLevel.Full)]      // club bought, district not
    [InlineData(SubscriptionState.Grace, SubscriptionState.Expired, ClubAccessLevel.Full)]    // grace keeps working
    [InlineData(SubscriptionState.None, SubscriptionState.Active, ClubAccessLevel.Reporting)]
    [InlineData(SubscriptionState.Expired, SubscriptionState.Grace, ClubAccessLevel.Reporting)] // club lapsed, district on
    [InlineData(SubscriptionState.Expired, SubscriptionState.Expired, ClubAccessLevel.None)]
    [InlineData(SubscriptionState.None, SubscriptionState.None, ClubAccessLevel.None)]
    public void LevelFor_matches_section_2(SubscriptionState club, SubscriptionState district, ClubAccessLevel expected) =>
        Assert.Equal(expected, SubscriptionAccess.LevelFor(club, district));

    [Fact]
    public void Reporting_covers_reporting_rows_only()
    {
        Assert.Equal(ClubAccessLevel.Reporting, SubscriptionAccess.RequiredLevel("community_service"));
        Assert.Equal(ClubAccessLevel.Reporting, SubscriptionAccess.RequiredLevel("club_dues"));
        Assert.Equal(ClubAccessLevel.Full, SubscriptionAccess.RequiredLevel("mass_email"));
        Assert.Equal(ClubAccessLevel.Full, SubscriptionAccess.RequiredLevel("website_data"));
        Assert.Equal(ClubAccessLevel.Full, SubscriptionAccess.RequiredLevel("membership_dues"));
    }

    [Fact]
    public void Renewal_adds_a_year_to_the_term_while_it_works_else_starts_today()
    {
        var end = new DateTime(2026, 12, 31);
        Assert.Equal((new DateTime(2027, 1, 1), new DateTime(2027, 12, 31)),
            SubscriptionBillingService.NextTerm(end, Today, 30));                      // active: no interruption
        Assert.Equal((new DateTime(2026, 11, 1), new DateTime(2027, 10, 31)),
            SubscriptionBillingService.NextTerm(new DateTime(2026, 10, 31), Today, 30)); // in grace: still from the old end
        Assert.Equal((Today, new DateTime(2027, 11, 12)),
            SubscriptionBillingService.NextTerm(new DateTime(2026, 1, 31), Today, 30));  // expired: a fresh year
        Assert.Equal((Today, new DateTime(2027, 11, 12)), SubscriptionBillingService.NextTerm(null, Today, 30));
    }

    [Fact]
    public void Executive_standing_follows_RI_terms()
    {
        DateTime Y(int y) => new(y, 7, 1);
        // this year's President and Secretary: current
        Assert.Equal(ExecutiveStanding.Current, SubscriptionOfficers.StandingOf("Club President", Y(2026), Y(2027).AddDays(-1), Today));
        Assert.Equal(ExecutiveStanding.Current, SubscriptionOfficers.StandingOf("Club Secretary", Y(2026), Y(2027).AddDays(-1), Today));
        // last year's President = Past President: current; last year's Secretary: none
        Assert.Equal(ExecutiveStanding.Current, SubscriptionOfficers.StandingOf("Club President", Y(2025), Y(2026).AddDays(-1), Today));
        Assert.Equal(ExecutiveStanding.None, SubscriptionOfficers.StandingOf("Club Secretary", Y(2025), Y(2026).AddDays(-1), Today));
        // next year's President = President-Elect, a current executive; next year's Secretary is incoming
        Assert.Equal(ExecutiveStanding.Current, SubscriptionOfficers.StandingOf("Club President", Y(2027), Y(2028).AddDays(-1), Today));
        Assert.Equal(ExecutiveStanding.Incoming, SubscriptionOfficers.StandingOf("Club Secretary", Y(2027), Y(2028).AddDays(-1), Today));
        // not an executive office
        Assert.Equal(ExecutiveStanding.None, SubscriptionOfficers.StandingOf("Club Membership Chair", Y(2026), Y(2027).AddDays(-1), Today));
        // 1 July: incoming becomes current by date alone
        Assert.Equal(ExecutiveStanding.Current, SubscriptionOfficers.StandingOf("Club President", Y(2027), Y(2028).AddDays(-1), Y(2027)));
    }
    // Sections 2, 3 and exception 6: what the gate refuses. Arguments: level, reporting feature, member-list write,
    // executive, reaches the club only as its member or admin.
    [Theory]
    [InlineData(ClubAccessLevel.Full, false, false, false, true, null)]                           // Full: everything
    [InlineData(ClubAccessLevel.None, true, false, true, true, "subscription_required")]          // None: nobody, not even executives
    [InlineData(ClubAccessLevel.Reporting, true, false, true, true, null)]                        // executive, reporting feature
    [InlineData(ClubAccessLevel.Reporting, true, false, false, true, "executives_only")]          // other club admin or member
    [InlineData(ClubAccessLevel.Reporting, true, false, false, false, null)]                      // AG or district officer reads the reports
    [InlineData(ClubAccessLevel.Reporting, false, false, true, true, "club_subscription_required")] // locked club feature
    [InlineData(ClubAccessLevel.Reporting, true, true, true, true, "club_subscription_required")]   // member list is view only
    public void Gate_follows_sections_2_and_3(ClubAccessLevel level, bool reporting, bool memberWrite, bool exec, bool clubSide, string? expected) =>
        Assert.Equal(expected, SubscriptionGateMiddleware.ClubDenial(level, reporting, memberWrite, exec, clubSide));

    // What a club at Reporting may use, from the path alone: the scope checks ask this for a club named in the body.
    [Theory]
    [InlineData("/api/clubs/7/projects", false, true)]
    [InlineData("/api/clubs/7/members", false, true)]
    [InlineData("/api/clubs/7/members", true, false)]          // member list is view only
    [InlineData("/api/clubs/7/newsletters", false, false)]
    [InlineData("/api/club-admin-dashboard/overview", false, true)]
    [InlineData("/api/club-admin-dashboard/communication", false, false)]
    [InlineData("/api/districts/3/clubs", false, true)]
    [InlineData("/api/goal-setting/clubs/1", true, true)]
    [InlineData("/api/members/12", false, true)]
    [InlineData("/api/members", true, false)]
    [InlineData("/api/event-payment-links/5", false, false)]
    [InlineData("/api/membership-dues", true, false)]
    [InlineData("/api/chat/conversations", false, false)]
    [InlineData("/api/wallet/create-order", true, false)]
    [InlineData("/api/email-log/summary", false, false)]
    [InlineData("/api/mobile/club-admin/club-report", false, true)]
    [InlineData("/api/mobile/calendar", false, false)]
    public void Path_open_under_reporting(string path, bool write, bool open) =>
        Assert.Equal(open, SubscriptionGateMiddleware.OpenUnderReporting(path, write));
}

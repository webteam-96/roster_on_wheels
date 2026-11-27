using RotaryApi.Services;
using static RotaryApi.Services.AttendanceCalculator;

namespace RotaryApi.Tests;

public class AttendanceCalculatorTests
{
    private static readonly DateOnly D1 = new(2026, 8, 3), D2 = new(2026, 8, 10), D3 = new(2026, 8, 17), D4 = new(2026, 8, 24);
    private static readonly List<Meeting> Meetings = new() { new(1, D1), new(2, D2), new(3, D3), new(4, D4) };
    private static readonly List<Member> One = new() { new(7, null, null) };

    private static MemberResult Run(HashSet<(int, int)>? present = null, List<Makeup>? makeups = null,
        List<Leave>? leaves = null, List<Exemption>? exemptions = null, List<Member>? members = null, int window = 14)
        => Compute(Meetings, members ?? One, present ?? new(), makeups ?? new(), leaves ?? new(), exemptions ?? new(), window).Members[0];

    [Fact]
    public void Present_meetings_over_held_meetings()
    {
        var r = Run(present: new() { (1, 7), (2, 7), (3, 7) });
        Assert.Equal((4, 3, 0), (r.Counted, r.Present, r.MadeUp));
        Assert.Equal(75m, r.Percent);
    }

    [Fact]
    public void Makeup_inside_the_window_credits_a_missed_meeting()
    {
        var r = Run(present: new() { (1, 7), (2, 7), (3, 7) }, makeups: new() { new(1, 7, D4.AddDays(10), null) });
        Assert.Equal(1, r.MadeUp);
        Assert.Equal(100m, r.Percent);
    }

    [Fact]
    public void Makeup_outside_the_window_does_not_count()
    {
        var r = Run(present: new() { (1, 7), (2, 7), (3, 7) }, makeups: new() { new(1, 7, D4.AddDays(15), null) });
        Assert.Equal(0, r.MadeUp);
        Assert.Equal(75m, r.Percent);
        // the club's window decides: 15 days fits a 21-day window
        Assert.Equal(100m, Run(present: new() { (1, 7), (2, 7), (3, 7) }, makeups: new() { new(1, 7, D4.AddDays(15), null) }, window: 21).Percent);
    }

    [Fact]
    public void Tied_makeup_covers_only_its_meeting_and_each_makeup_counts_once()
    {
        // missed 3 and 4; the makeup is tied to meeting 3, so meeting 4 stays missed
        var r = Run(present: new() { (1, 7), (2, 7) }, makeups: new() { new(1, 7, D4, 3) });
        Assert.Equal(1, r.MadeUp);
        Assert.Equal(75m, r.Percent);
        // one untied makeup covers one meeting, not both
        Assert.Equal(1, Run(present: new() { (1, 7), (2, 7) }, makeups: new() { new(2, 7, D4, null) }).MadeUp);
        // a makeup tied to a meeting the member attended credits nothing
        Assert.Equal(0, Run(present: new() { (1, 7), (2, 7), (3, 7) }, makeups: new() { new(3, 7, D4, 3) }).MadeUp);
    }

    [Fact]
    public void Leave_removes_its_meetings_from_the_count()
    {
        var r = Run(present: new() { (1, 7), (2, 7) }, leaves: new() { new(7, D3, D4.AddDays(3)) });
        Assert.Equal((2, 2), (r.Counted, r.Excused));
        Assert.Equal(100m, r.Percent);
    }

    [Fact]
    public void Exemption_leaves_the_member_out_of_the_denominator()
    {
        var members = new List<Member> { new(7, null, null), new(8, null, null) };
        var result = Compute(Meetings, members, new HashSet<(int, int)> { (1, 8), (2, 8) }, new List<Makeup>(),
            new List<Leave>(), new List<Exemption> { new(7, null) }, 14);
        var exempt = result.Members.Single(m => m.MemberId == 7);
        Assert.True(exempt.Exempt);
        Assert.Equal(0, exempt.Counted);
        Assert.Null(exempt.Percent);
        Assert.Equal(4, result.Counted);
        Assert.Equal(50m, result.Percent);
        // an exemption that ended counts the meetings after its end date
        Assert.Equal(2, Run(exemptions: new() { new(7, D2) }).Counted);
    }

    [Fact]
    public void Meetings_before_joining_or_after_leaving_do_not_count()
    {
        Assert.Equal(2, Run(members: new() { new(7, D3, null) }).Counted);
        Assert.Equal(2, Run(members: new() { new(7, null, D3) }).Counted);
    }

    [Fact]
    public void Rule_of_85_adds_full_years_of_age_and_membership()
    {
        var asOf = new DateOnly(2026, 11, 19);
        // 65 years old + 20 years a member = 85
        Assert.True(Rule85(new DateOnly(1961, 11, 19), new DateOnly(2006, 11, 19), asOf));
        // one day short of the 65th birthday: 64 + 20 = 84
        Assert.False(Rule85(new DateOnly(1961, 11, 20), new DateOnly(2006, 11, 19), asOf));
        // unknown birth or join date never qualifies
        Assert.False(Rule85(null, new DateOnly(1980, 1, 1), asOf));
        Assert.False(Rule85(new DateOnly(1930, 1, 1), null, asOf));
        // 1900 is the placeholder year of a birthday stored without one
        Assert.False(Rule85(new DateOnly(1900, 6, 15), new DateOnly(2024, 7, 1), asOf));
    }

    [Fact]
    public void Own_only_member_keeps_a_percentage_but_stays_out_of_the_club_total()
    {
        var members = new List<Member> { new(7, null, null), new(8, null, null, InClubTotal: false) };
        var r = Compute(Meetings, members, new HashSet<(int, int)> { (1, 7), (2, 7), (3, 7), (4, 7) }, new List<Makeup>(),
            new List<Leave>(), new List<Exemption>(), 14);
        Assert.Equal(0m, r.Members.Single(m => m.MemberId == 8).Percent);
        Assert.Equal(4, r.Counted);
        Assert.Equal(100m, r.Percent);
    }

    [Fact]
    public void Member_types_and_default_rules()
    {
        Assert.Equal("honorary", AttendanceStandingService.MemberTypeOf(true, "active"));
        Assert.Equal("active", AttendanceStandingService.MemberTypeOf(false, null));
        Assert.Equal("corporate", AttendanceStandingService.MemberTypeOf(false, " Corporate "));
        Assert.Equal("excluded", AttendanceStandingService.DefaultRule("honorary"));
        Assert.Equal("counted", AttendanceStandingService.DefaultRule("active"));
    }

    [Fact]
    public void Csv_fields_are_quoted_and_formulas_defused()
    {
        Assert.Equal("\"A \"\"B\"\" C\"", AttendancePrintBuilder.CsvField("A \"B\" C"));
        Assert.Equal("\"'=HYPERLINK(1)\"", AttendancePrintBuilder.CsvField("=HYPERLINK(1)"));
        var csv = AttendancePrintBuilder.Rule85Csv(new[] { new AttendanceStandingService.Rule85Row(1, "Ann", 70, 20, true) });
        Assert.Equal("Member,Age,Years a member,Total,Exempt\r\n\"Ann\",70,20,90,Yes\r\n", csv);
    }

    [Fact]
    public void Printables_render_pdf()
    {
        var sheet = AttendancePrintBuilder.SignInSheet("Club", "Weekly meeting", new DateTime(2026, 11, 3), new[] { "Ann", "Bo" });
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(sheet, 0, 4));
        var report = AttendancePrintBuilder.Rule85Pdf("Club", new List<AttendanceStandingService.Rule85Row>(), new DateOnly(2026, 11, 20));
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(report, 0, 4));
    }

    [Fact]
    public void No_meetings_means_no_percentage()
    {
        var r = Compute(new List<Meeting>(), One, new HashSet<(int, int)>(), new List<Makeup>(), new List<Leave>(), new List<Exemption>(), 14);
        Assert.Null(r.Percent);
        Assert.Null(r.Members[0].Percent);
    }
}

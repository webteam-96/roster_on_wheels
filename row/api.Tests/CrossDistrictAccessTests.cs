using RotaryApi.Services;

namespace RotaryApi.Tests;

public class CrossDistrictAccessTests
{
    private static readonly DateTime Now = new(2026, 11, 20, 12, 0, 0, DateTimeKind.Utc);

    private static DistrictAccessGrant Grant(bool write = false, int startDays = -1, int endDays = 10, DateTime? revoked = null) =>
        new(1, MemberId: 999, DistrictId: 20, CanWrite: write, Now.AddDays(startDays), Now.AddDays(endDays), revoked);

    [Fact]
    public void Live_grant_permits_read_for_its_member_and_district_only()
    {
        var g = Grant();
        Assert.True(CrossDistrictAccess.Permits(g, 999, 20, write: false, Now));
        Assert.False(CrossDistrictAccess.Permits(g, 1068, 20, false, Now));   // another member
        Assert.False(CrossDistrictAccess.Permits(g, 999, 21, false, Now));    // another district
        Assert.False(CrossDistrictAccess.Permits(null, 999, 20, false, Now));
        Assert.False(CrossDistrictAccess.Permits(g, 0, 20, false, Now));
    }

    [Fact]
    public void Read_grant_never_permits_write()
    {
        Assert.False(CrossDistrictAccess.Permits(Grant(write: false), 999, 20, write: true, Now));
        Assert.True(CrossDistrictAccess.Permits(Grant(write: true), 999, 20, write: true, Now));
        Assert.True(CrossDistrictAccess.Permits(Grant(write: true), 999, 20, write: false, Now));
    }

    [Fact]
    public void Expiry_is_exclusive_and_start_inclusive()
    {
        var g = Grant(startDays: 0, endDays: 1);
        Assert.True(CrossDistrictAccess.IsLive(g, Now));                       // at start
        Assert.True(CrossDistrictAccess.IsLive(g, Now.AddDays(1).AddSeconds(-1)));
        Assert.False(CrossDistrictAccess.IsLive(g, Now.AddDays(1)));          // at expiry
        Assert.False(CrossDistrictAccess.IsLive(g, Now.AddSeconds(-1)));      // before start
    }

    [Fact]
    public void Revoked_grant_is_dead_even_inside_its_window()
    {
        Assert.False(CrossDistrictAccess.IsLive(Grant(revoked: Now.AddHours(-1)), Now));
        Assert.False(CrossDistrictAccess.Permits(Grant(write: true, revoked: Now), 999, 20, true, Now));
    }

    [Theory]
    [InlineData("/api/districts/20/announcements", true)]
    [InlineData("/api/districts/20/weblinks/5", true)]
    [InlineData("/api/districts/20/committee/groups/3/members", true)]
    [InlineData("/api/districts/20/members/7/assign-admin", false)]
    [InlineData("/api/districts/20/members/7/remove-admin", false)]
    [InlineData("/api/districts/20/ag", false)]
    [InlineData("/api/districts/20/mass-emails/1/send", false)]
    [InlineData("/api/districts/20/website-data/banners", false)]
    [InlineData("/api/districts/20/grants", false)]
    [InlineData("/api/districts/20", false)]
    [InlineData("/api/clubs/341/announcements", false)]
    [InlineData("/api/district-modules/20/citation/categories", false)]
    [InlineData("/api/districts/20/announcementsX", false)]
    [InlineData(null, false)]
    public void Write_paths_are_allow_listed(string? path, bool expected) =>
        Assert.Equal(expected, CrossDistrictAccess.IsWritablePath(path));

    [Fact]
    public void Year_cover_needs_overlap_with_the_window()
    {
        var g = Grant(write: true, startDays: 0, endDays: 30);   // 20 Nov 2026 to 20 Dec 2026
        Assert.True(CrossDistrictAccess.CoversYear(g, new DateTime(2026, 7, 1), new DateTime(2027, 6, 30)));
        Assert.False(CrossDistrictAccess.CoversYear(g, new DateTime(2025, 7, 1), new DateTime(2026, 6, 30)));
        Assert.False(CrossDistrictAccess.CoversYear(g, new DateTime(2027, 7, 1), new DateTime(2028, 6, 30)));
    }

    [Fact]
    public void Validate_rejects_bad_input()
    {
        string? V(int m = 999, int d = 20, string? p = "PETS", string? n = null, int s = 0, int e = 30) =>
            CrossDistrictAccess.Validate(m, d, p, n, Now.AddDays(s), Now.AddDays(e), Now);
        Assert.Null(V());
        Assert.Null(V(p: "rli"));
        Assert.NotNull(V(m: 0));
        Assert.NotNull(V(d: 0));
        Assert.NotNull(V(p: "ADMIN"));
        Assert.NotNull(V(p: "OTHER"));                 // other needs a note
        Assert.Null(V(p: "OTHER", n: "Audit"));
        Assert.NotNull(V(e: 0));                       // expiry not after start
        Assert.NotNull(V(s: -10, e: -1));              // already expired
        Assert.NotNull(V(s: -5, e: 10));               // starts in the past
        Assert.NotNull(V(e: 400));                     // too long
        Assert.NotNull(V(n: new string('x', 501)));
    }
}

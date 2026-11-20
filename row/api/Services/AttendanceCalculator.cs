namespace RotaryApi.Services;

/// <summary>
/// Attendance percentage with makeups, leave of absence and exemptions (gap #5, 2026-11-19). Pure: the caller loads
/// the rows (AttendanceStandingService) and this decides what counts.
/// A meeting counts against a member when the member was on the roll that day (joined on or before it, not yet
/// terminated), was not on leave that day and was not exempt that day. It is credited when the member was present,
/// or when a makeup within <c>windowDays</c> of the meeting covers it. A makeup tied to a missed meeting covers only
/// that meeting; an untied makeup covers the nearest uncovered missed meeting in its window. Each makeup covers one
/// meeting.
/// </summary>
public static class AttendanceCalculator
{
    public sealed record Meeting(int Id, DateOnly Date);
    /// <summary>InClubTotal false: the member's own % is worked out but left out of the club's % (member-type rule own_only).</summary>
    public sealed record Member(int Id, DateOnly? Joined, DateOnly? Left, bool InClubTotal = true);
    public sealed record Makeup(int Id, int MemberId, DateOnly Date, int? MissedMeetingId);
    public sealed record Leave(int MemberId, DateOnly From, DateOnly To);
    public sealed record Exemption(int MemberId, DateOnly? EndDate);

    public sealed record MemberResult(int MemberId, int Counted, int Present, int MadeUp, int Excused, bool Exempt, bool InClubTotal = true)
    {
        public decimal? Percent => Counted > 0 ? Math.Round(100m * (Present + MadeUp) / Counted, 1) : null;
    }

    public sealed record Result(IReadOnlyList<MemberResult> Members)
    {
        public int Counted => Members.Where(m => m.InClubTotal).Sum(m => m.Counted);
        public int Credited => Members.Where(m => m.InClubTotal).Sum(m => m.Present + m.MadeUp);
        public decimal? Percent => Counted > 0 ? Math.Round(100m * Credited / Counted, 1) : null;
    }

    /// <summary>Rule of 85 (RI club constitution): age plus years of membership in one or more clubs is 85 or more.
    /// The board still grants the exemption on the member's written request; this only says who qualifies.</summary>
    public static bool Rule85(DateOnly? birth, DateOnly? firstJoined, DateOnly asOf)
        => birth is { } b && firstJoined is { } j && j <= asOf && FullYears(b, asOf) + FullYears(j, asOf) >= 85;

    public static int FullYears(DateOnly from, DateOnly to)
        => to.Year - from.Year - (to.Month < from.Month || (to.Month == from.Month && to.Day < from.Day) ? 1 : 0);

    public static bool WithinWindow(DateOnly meeting, DateOnly makeup, int windowDays)
        => Math.Abs(makeup.DayNumber - meeting.DayNumber) <= windowDays;

    public static Result Compute(
        IReadOnlyList<Meeting> meetings,
        IReadOnlyList<Member> members,
        IReadOnlySet<(int MeetingId, int MemberId)> present,
        IReadOnlyList<Makeup> makeups,
        IReadOnlyList<Leave> leaves,
        IReadOnlyList<Exemption> exemptions,
        int windowDays)
    {
        var ordered = meetings.OrderBy(m => m.Date).ThenBy(m => m.Id).ToList();
        var results = new List<MemberResult>(members.Count);

        foreach (var member in members)
        {
            var myLeaves = leaves.Where(l => l.MemberId == member.Id).ToList();
            var myExemptions = exemptions.Where(e => e.MemberId == member.Id).ToList();
            var myMakeups = makeups.Where(k => k.MemberId == member.Id).ToList();
            var used = new HashSet<int>();
            int counted = 0, presentCount = 0, excused = 0;
            var missed = new List<Meeting>();

            foreach (var meeting in ordered)
            {
                if (member.Joined is { } j && meeting.Date < j) continue;
                if (member.Left is { } left && meeting.Date >= left) continue;
                if (myExemptions.Any(e => e.EndDate == null || meeting.Date <= e.EndDate)
                    || myLeaves.Any(l => meeting.Date >= l.From && meeting.Date <= l.To))
                {
                    excused++;
                    continue;
                }
                counted++;
                if (present.Contains((meeting.Id, member.Id))) presentCount++;
                else missed.Add(meeting);
            }

            // Tied makeups first, so an untied one is not spent on a meeting that already has its own.
            var uncovered = new List<Meeting>();
            foreach (var meeting in missed)
            {
                var tied = myMakeups.FirstOrDefault(k => k.MissedMeetingId == meeting.Id && !used.Contains(k.Id)
                    && WithinWindow(meeting.Date, k.Date, windowDays));
                if (tied != null) used.Add(tied.Id);
                else uncovered.Add(meeting);
            }
            var madeUp = missed.Count - uncovered.Count;
            // A makeup tied to a meeting outside this period stays tied: it never covers another meeting.
            var untied = myMakeups.Where(k => k.MissedMeetingId == null).OrderBy(k => k.Date).ThenBy(k => k.Id).ToList();
            foreach (var meeting in uncovered)
            {
                var pick = untied.Where(k => !used.Contains(k.Id) && WithinWindow(meeting.Date, k.Date, windowDays))
                    .OrderBy(k => Math.Abs(k.Date.DayNumber - meeting.Date.DayNumber)).ThenBy(k => k.Date).FirstOrDefault();
                if (pick == null) continue;
                used.Add(pick.Id);
                madeUp++;
            }

            results.Add(new MemberResult(member.Id, counted, presentCount, madeUp, excused, myExemptions.Count > 0, member.InClubTotal));
        }
        return new Result(results);
    }
}

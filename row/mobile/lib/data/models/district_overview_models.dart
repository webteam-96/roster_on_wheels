/// Models for the District Overview dashboard.
///
/// Field shapes mirror the React reference at
/// `AG_module-master/src/modules/district/data/`. Kept as plain immutable
/// classes with derived getters; backend integration is a later phase.
library;

class ClubAnalytics {
  final String id;
  final String name;
  final String meetingDay;
  final String meetingTime;
  final int members;
  final int memberTarget;
  final int activeMembers;
  final int maleMembers;
  final int femaleMembers;
  final int honoraryMembers;
  final int newThisYear;
  final int terminated;
  final int trfRaised;
  final int trfGoal;
  final int annualFund;
  final int phfContributors;
  final int majorDonors;
  final int serviceProjects;
  final int beneficiaries;
  final int manHours;
  final int citationScore;
  final int citationMax;
  final int reportsSubmitted;
  final int reportsTotal;
  final int avgAttendance;
  final List<RosterMember> memberRoster;

  const ClubAnalytics({
    required this.id,
    required this.name,
    required this.meetingDay,
    required this.meetingTime,
    required this.members,
    required this.memberTarget,
    required this.activeMembers,
    required this.maleMembers,
    required this.femaleMembers,
    required this.honoraryMembers,
    required this.newThisYear,
    required this.terminated,
    required this.trfRaised,
    required this.trfGoal,
    required this.annualFund,
    required this.phfContributors,
    required this.majorDonors,
    required this.serviceProjects,
    required this.beneficiaries,
    required this.manHours,
    required this.citationScore,
    required this.citationMax,
    required this.reportsSubmitted,
    required this.reportsTotal,
    required this.avgAttendance,
    this.memberRoster = const [],
  });

  int get citationPct => ((citationScore / citationMax) * 100).round();
  int get compliancePct => ((reportsSubmitted / reportsTotal) * 100).round();
  int get memberPct => ((members / memberTarget) * 100).round();
  int get trfPct => ((trfRaised / trfGoal) * 100).round();

  /// Composite formula the React leaderboard sorts by:
  /// average of citation %, compliance %, and average attendance.
  int get composite =>
      ((citationPct + compliancePct + avgAttendance) / 3).round();
}

class DistrictProject {
  final int id;
  final String club;
  final String name;
  final String avenue;
  final String date;
  final int beneficiaries;
  final int funds;
  final int manHours;
  final String status;

  const DistrictProject({
    required this.id,
    required this.club,
    required this.name,
    required this.avenue,
    required this.date,
    required this.beneficiaries,
    required this.funds,
    required this.manHours,
    required this.status,
  });
}

class DistrictEvent {
  final int id;
  final String club;
  final String name;
  /// One of: 'District', 'TRF', 'New Gen', 'Service', 'Meeting'.
  final String type;
  /// ISO 'YYYY-MM-DD'.
  final String date;
  final String time;
  final String venue;
  /// One of: 'Completed', 'In Progress', 'Upcoming'.
  final String status;

  const DistrictEvent({
    required this.id,
    required this.club,
    required this.name,
    required this.type,
    required this.date,
    required this.time,
    required this.venue,
    required this.status,
  });
}

class CitationCriterion {
  final String criterion;
  final int points;
  const CitationCriterion({required this.criterion, required this.points});
}

class ClubCitation {
  final String id;
  final String name;
  final int total;
  final int max;

  /// Score per criterion, ordered to match the global `kCitationCriteria`.
  final List<int> criteria;

  const ClubCitation({
    required this.id,
    required this.name,
    required this.total,
    required this.max,
    required this.criteria,
  });
}

enum CritStatus { done, partial, none }

/// One row of a club's per-member roster. Port of the inline `memberRoster`
/// objects produced by `analyticsData.js#makeRoster`.
class RosterMember {
  final String name;
  final String designation;
  final String mobile;
  final String email;
  final int since;
  /// One of: 'Active', 'Inactive'.
  final String status;
  const RosterMember({
    required this.name,
    required this.designation,
    required this.mobile,
    required this.email,
    required this.since,
    required this.status,
  });
}

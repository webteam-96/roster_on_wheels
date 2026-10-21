/// Models for the Club Overview dashboard. Mirrors
/// `AG_module-master/src/modules/club/data/clubData.js` field shapes.
library;

class ClubInfo {
  final String id;
  final String name;
  final int district;
  final String rotaryYear;
  const ClubInfo({
    required this.id,
    required this.name,
    required this.district,
    required this.rotaryYear,
  });
}

class ClubStats {
  final int totalMembers;
  final int activeMembers;
  final int fullMembers;
  final int associateMembers;
  final int honoraryMembers;
  final int newMembersThisYear;
  final int terminatedThisYear;
  final double avgAttendance;
  final int trfRaised;
  final int trfGoal;
  final int trfAnnualFund;
  final int trfMajorDonors;
  final int phfContributors;
  final int trfPhsm;
  final int trfEPF;
  final int trfEndowment;
  final int serviceProjects;
  final int districtCitationScore;
  final int districtCitationMax;
  final int zonalAwards;
  final int reportsSubmitted;
  final int reportsTotal;
  const ClubStats({
    required this.totalMembers,
    required this.activeMembers,
    required this.fullMembers,
    required this.associateMembers,
    required this.honoraryMembers,
    required this.newMembersThisYear,
    required this.terminatedThisYear,
    required this.avgAttendance,
    required this.trfRaised,
    required this.trfGoal,
    required this.trfAnnualFund,
    required this.trfMajorDonors,
    required this.phfContributors,
    required this.trfPhsm,
    required this.trfEPF,
    required this.trfEndowment,
    required this.serviceProjects,
    required this.districtCitationScore,
    required this.districtCitationMax,
    required this.zonalAwards,
    required this.reportsSubmitted,
    required this.reportsTotal,
  });
}

class MemberGrowthPoint {
  final String month;
  final int members;
  final int male;
  final int female;
  final int honorary;
  const MemberGrowthPoint({
    required this.month,
    required this.members,
    required this.male,
    required this.female,
    required this.honorary,
  });
}

class AttendancePoint {
  final String date;
  final int present;
  final int total;
  final int pct;
  const AttendancePoint({
    required this.date,
    required this.present,
    required this.total,
    required this.pct,
  });
}

class AvenueDatum {
  final String name;
  final int completed;
  final int target;
  final int colorArgb;
  final int beneficiaries;
  const AvenueDatum({
    required this.name,
    required this.completed,
    required this.target,
    required this.colorArgb,
    required this.beneficiaries,
  });
}

class ClubProject {
  final int id;
  final String name;
  final String avenue;
  final String date;
  final int beneficiaries;
  final int funds;
  final String status; // 'Completed' | 'In Progress' | 'Upcoming'
  const ClubProject({
    required this.id,
    required this.name,
    required this.avenue,
    required this.date,
    required this.beneficiaries,
    required this.funds,
    required this.status,
  });
}

class ClubEvent {
  final int id;
  final String name;
  final String date; // ISO yyyy-MM-dd
  final String time;
  final String venue;
  final String type; // 'Meeting' | 'Service' | 'TRF' | 'New Gen' | 'District'
  const ClubEvent({
    required this.id,
    required this.name,
    required this.date,
    required this.time,
    required this.venue,
    required this.type,
  });
}

class ClubAnnouncement {
  final int id;
  final String text;
  final String date;
  final String priority; // 'urgent' | 'normal' | 'info' | 'action'
  const ClubAnnouncement({
    required this.id,
    required this.text,
    required this.date,
    required this.priority,
  });
}

class ClubDocument {
  final int id;
  final String name;
  final String type;
  final String size;
  final String date;
  const ClubDocument({
    required this.id,
    required this.name,
    required this.type,
    required this.size,
    required this.date,
  });
}

class MonthlyReportEntry {
  final String month;
  final String? submitted;
  final bool? onTime;
  final String status; // 'Pending' | 'Submitted' | 'Late'
  const MonthlyReportEntry({
    required this.month,
    required this.submitted,
    required this.onTime,
    required this.status,
  });
}

enum CitationStatus { done, partial, incomplete }

class CitationItem {
  final String criterion;
  final int points;
  final int earned;
  final String detail;
  final CitationStatus status;
  const CitationItem({
    required this.criterion,
    required this.points,
    required this.earned,
    required this.detail,
    required this.status,
  });
}

class ClubMember {
  final int id;
  final String name;
  final String designation;
  final String mobile;
  final String email;
  final String type; // 'Full' | 'Associate' | 'Honorary'
  final int since;
  final String status; // 'Active' | 'Inactive'
  final bool isAdmin;
  final bool isRIAdmin;
  const ClubMember({
    required this.id,
    required this.name,
    required this.designation,
    required this.mobile,
    required this.email,
    required this.type,
    required this.since,
    required this.status,
    required this.isAdmin,
    required this.isRIAdmin,
  });
}

class PastPresident {
  final String name;
  final String year;
  final String achievement;
  const PastPresident({
    required this.name,
    required this.year,
    required this.achievement,
  });
}

class BoardDirector {
  final int id;
  final String name;
  final String designation;
  final String mobile;
  final String email;
  final String initials;
  final int colorArgb;
  const BoardDirector({
    required this.id,
    required this.name,
    required this.designation,
    required this.mobile,
    required this.email,
    required this.initials,
    required this.colorArgb,
  });
}

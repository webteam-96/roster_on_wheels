// District Admin Dashboard models — mirror `RotaryApi/DTOs/DistrictAdminDashboardDtos.cs`.
// Wire JSON is camelCase. TRF *Inr = USD x 84 (foundation targets are stored USD,
// re-exposed *Inr in the panels). Percent fields are 0-100. Goal panels carry an
// `isPending` flag — when true the target/percent are null/0 and the UI must render
// an em-dash "—" / "Pending" placeholder, never the 0.

// ── json helpers ─────────────────────────────────────────────────────────────
int _i(dynamic v) =>
    v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0);
int? _inI(dynamic v) =>
    v == null ? null : (v is num ? v.toInt() : int.tryParse('$v'));
double _d(dynamic v) =>
    v is num ? v.toDouble() : double.tryParse('${v ?? ''}') ?? 0.0;
double? _dnD(dynamic v) =>
    v == null ? null : (v is num ? v.toDouble() : double.tryParse('$v'));
String _s(dynamic v) => v?.toString() ?? '';
String? _sn(dynamic v) {
  if (v == null) return null;
  final s = v.toString();
  return s.isEmpty ? null : s;
}

bool _b(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = '${v ?? ''}'.toLowerCase().trim();
  return s == 'true' || s == '1' || s == 'yes';
}

List<Map<String, dynamic>> _list(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
    : const <Map<String, dynamic>>[];

Map<String, dynamic> _obj(dynamic v) =>
    (v as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};

// ── shared ───────────────────────────────────────────────────────────────────

class DistrictAdminIdentity {
  final int memberId;
  final String name;
  final int districtId;
  final String districtNumber;
  final String yearLabel;
  final int totalClubs;
  const DistrictAdminIdentity({
    required this.memberId,
    required this.name,
    required this.districtId,
    required this.districtNumber,
    required this.yearLabel,
    required this.totalClubs,
  });
  factory DistrictAdminIdentity.fromJson(Map<String, dynamic> j) =>
      DistrictAdminIdentity(
        memberId: _i(j['memberId']),
        name: _s(j['name']),
        districtId: _i(j['districtId']),
        districtNumber: _s(j['districtNumber']),
        yearLabel: _s(j['yearLabel']),
        totalClubs: _i(j['totalClubs']),
      );
}

class DistrictClubStat {
  final int clubId;
  final String clubName;
  final int members;
  final int meetings;
  final int projects;
  final double trfInr;
  const DistrictClubStat({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.meetings,
    required this.projects,
    required this.trfInr,
  });
  factory DistrictClubStat.fromJson(Map<String, dynamic> j) => DistrictClubStat(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        meetings: _i(j['meetings']),
        projects: _i(j['projects']),
        trfInr: _d(j['trfInr']),
      );
}

// ── Overview panels ──────────────────────────────────────────────────────────

class DaMembershipGoalPanel {
  final int current;
  final int? target;
  final int delta;
  final bool isPending;
  final List<DistrictClubStat> topClubs;
  const DaMembershipGoalPanel({
    required this.current,
    required this.target,
    required this.delta,
    required this.isPending,
    required this.topClubs,
  });
  factory DaMembershipGoalPanel.fromJson(Map<String, dynamic> j) =>
      DaMembershipGoalPanel(
        current: _i(j['current']),
        target: _inI(j['target']),
        delta: _i(j['delta']),
        isPending: _b(j['isPending']),
        topClubs: _list(j['topClubs']).map(DistrictClubStat.fromJson).toList(),
      );
  static const empty = DaMembershipGoalPanel(
      current: 0, target: null, delta: 0, isPending: true, topClubs: []);
}

class DaTrfGoalPanel {
  final double? totalTargetInr;
  final double raisedInr;
  final double remainingInr;
  final double percentAchieved;
  final bool isPending;
  final double annualFundInr;
  final double polioFundInr;
  final double endowmentInr;
  final double othersInr;
  final double? annualTargetInr;
  final double? polioTargetInr;
  final double? endowmentTargetInr;
  final double? othersTargetInr;
  const DaTrfGoalPanel({
    required this.totalTargetInr,
    required this.raisedInr,
    required this.remainingInr,
    required this.percentAchieved,
    required this.isPending,
    required this.annualFundInr,
    required this.polioFundInr,
    required this.endowmentInr,
    required this.othersInr,
    required this.annualTargetInr,
    required this.polioTargetInr,
    required this.endowmentTargetInr,
    required this.othersTargetInr,
  });
  factory DaTrfGoalPanel.fromJson(Map<String, dynamic> j) => DaTrfGoalPanel(
        totalTargetInr: _dnD(j['totalTargetInr']),
        raisedInr: _d(j['raisedInr']),
        remainingInr: _d(j['remainingInr']),
        percentAchieved: _d(j['percentAchieved']),
        isPending: _b(j['isPending']),
        annualFundInr: _d(j['annualFundInr']),
        polioFundInr: _d(j['polioFundInr']),
        endowmentInr: _d(j['endowmentInr']),
        othersInr: _d(j['othersInr']),
        annualTargetInr: _dnD(j['annualTargetInr']),
        polioTargetInr: _dnD(j['polioTargetInr']),
        endowmentTargetInr: _dnD(j['endowmentTargetInr']),
        othersTargetInr: _dnD(j['othersTargetInr']),
      );
  static const empty = DaTrfGoalPanel(
      totalTargetInr: null,
      raisedInr: 0,
      remainingInr: 0,
      percentAchieved: 0,
      isPending: true,
      annualFundInr: 0,
      polioFundInr: 0,
      endowmentInr: 0,
      othersInr: 0,
      annualTargetInr: null,
      polioTargetInr: null,
      endowmentTargetInr: null,
      othersTargetInr: null);
}

class DaServiceAvenueRow {
  final String avenueKey;
  final String avenueName;
  final int completed;
  final int? target;
  final double percentAchieved;
  final bool isPending;
  const DaServiceAvenueRow({
    required this.avenueKey,
    required this.avenueName,
    required this.completed,
    required this.target,
    required this.percentAchieved,
    required this.isPending,
  });
  factory DaServiceAvenueRow.fromJson(Map<String, dynamic> j) =>
      DaServiceAvenueRow(
        avenueKey: _s(j['avenueKey']),
        avenueName: _s(j['avenueName']),
        completed: _i(j['completed']),
        target: _inI(j['target']),
        percentAchieved: _d(j['percentAchieved']),
        isPending: _b(j['isPending']),
      );
}

/// One `module_master` entry (id + key) — used to resolve an avenue's
/// `moduleKey` to its module id when saving per-avenue project targets
/// (`POST /project-targets` needs `fkModuleId`). From `GET /api/modules`.
class ModuleLite {
  final int id;
  final String moduleKey;
  final String moduleName;
  const ModuleLite({
    required this.id,
    required this.moduleKey,
    required this.moduleName,
  });
  factory ModuleLite.fromJson(Map<String, dynamic> j) => ModuleLite(
        id: _i(j['id']),
        moduleKey: _s(j['moduleKey']),
        moduleName: _s(j['moduleName']),
      );
}

class DaServiceProjectsPanel {
  final int totalProjects;
  final int? totalTarget;
  final bool isPending;
  final List<DaServiceAvenueRow> avenues;
  const DaServiceProjectsPanel({
    required this.totalProjects,
    required this.totalTarget,
    required this.isPending,
    required this.avenues,
  });
  factory DaServiceProjectsPanel.fromJson(Map<String, dynamic> j) =>
      DaServiceProjectsPanel(
        totalProjects: _i(j['totalProjects']),
        totalTarget: _inI(j['totalTarget']),
        isPending: _b(j['isPending']),
        avenues:
            _list(j['avenues']).map(DaServiceAvenueRow.fromJson).toList(),
      );
  static const empty = DaServiceProjectsPanel(
      totalProjects: 0, totalTarget: null, isPending: true, avenues: []);
}

class DaCitationCategoryRow {
  final int categoryId;
  final String categoryName;
  final double pointsEarned;
  final int qualifiedClubs;
  // Wave 13A4 — per-category club completion buckets + status chip.
  final double maxPoints;
  final int completeClubs;
  final int partialClubs;
  final int incompleteClubs;
  final String status; // complete | partial | incomplete
  const DaCitationCategoryRow({
    required this.categoryId,
    required this.categoryName,
    required this.pointsEarned,
    required this.qualifiedClubs,
    this.maxPoints = 0,
    this.completeClubs = 0,
    this.partialClubs = 0,
    this.incompleteClubs = 0,
    this.status = '',
  });
  factory DaCitationCategoryRow.fromJson(Map<String, dynamic> j) =>
      DaCitationCategoryRow(
        categoryId: _i(j['categoryId']),
        categoryName: _s(j['categoryName']),
        pointsEarned: _d(j['pointsEarned']),
        qualifiedClubs: _i(j['qualifiedClubs']),
        maxPoints: _d(j['maxPoints']),
        completeClubs: _i(j['completeClubs']),
        partialClubs: _i(j['partialClubs']),
        incompleteClubs: _i(j['incompleteClubs']),
        status: _s(j['status']),
      );
}

class DaCitationPanel {
  final double totalPoints;
  final int qualifiedClubs;
  final List<DaCitationCategoryRow> categories;
  const DaCitationPanel({
    required this.totalPoints,
    required this.qualifiedClubs,
    required this.categories,
  });
  factory DaCitationPanel.fromJson(Map<String, dynamic> j) => DaCitationPanel(
        totalPoints: _d(j['totalPoints']),
        qualifiedClubs: _i(j['qualifiedClubs']),
        categories:
            _list(j['categories']).map(DaCitationCategoryRow.fromJson).toList(),
      );
  static const empty =
      DaCitationPanel(totalPoints: 0, qualifiedClubs: 0, categories: []);
  bool get isPending => categories.isEmpty && totalPoints == 0;
}

class DaClubLeaderboardRow {
  final int rank;
  final int clubId;
  final String clubName;
  final int members;
  final double trfInr;
  final int projects;
  final double citationScore;
  final double score;
  // Wave 13A4 — percentile of Score within the district (0..100).
  final double percentile;
  const DaClubLeaderboardRow({
    required this.rank,
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.trfInr,
    required this.projects,
    required this.citationScore,
    required this.score,
    this.percentile = 0,
  });
  factory DaClubLeaderboardRow.fromJson(Map<String, dynamic> j) =>
      DaClubLeaderboardRow(
        rank: _i(j['rank']),
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        trfInr: _d(j['trfInr']),
        projects: _i(j['projects']),
        citationScore: _d(j['citationScore']),
        score: _d(j['score']),
        percentile: _d(j['percentile']),
      );
}

/// One fund-type total for the district TRF panel (Annual / Polio / Endowment /
/// Others + any admin-defined funds), aggregated across all clubs, in INR.
class DaFundBreakdownRow {
  final String fundName;
  final double amountInr;
  const DaFundBreakdownRow({required this.fundName, required this.amountInr});
  factory DaFundBreakdownRow.fromJson(Map<String, dynamic> j) =>
      DaFundBreakdownRow(
        fundName: _s(j['fundName']),
        amountInr: _d(j['amountInr']),
      );
}

// ── /overview ────────────────────────────────────────────────────────────────

class DistrictAdminOverview {
  final DistrictAdminIdentity district;
  final int totalClubs;
  final int activeClubs;
  final int totalMembers;
  final int newMembersThisYear;
  final int terminatedThisYear;
  final int totalProjects;
  final int totalMeetings;
  final double avgAttendance;
  final double trfTotalInr;
  final double districtCitationScore;
  final int announcements;
  final int newsletters;
  final int upcomingEvents;
  final List<DistrictClubStat> topClubsByMembers;
  final List<DistrictClubStat> topClubsByTrf;
  final List<DistrictClubStat> topClubsByProjects;
  final int qualifiedCitationClubs;
  // Wave 13A4 — membership breakdown + TRF donor counts + per-fund breakdown.
  final int maleMembers;
  final int femaleMembers;
  final int honoraryMembers;
  final int inactiveMembers;
  final int phfMembers;
  final int majorDonors;
  final List<DaFundBreakdownRow> fundTypeBreakdown;
  final DaMembershipGoalPanel membershipGoal;
  final DaTrfGoalPanel trfGoal;
  final DaServiceProjectsPanel serviceProjects;
  final DaCitationPanel citation;
  final List<DistrictClubStat> top20ClubsByMembers;
  final List<DaClubLeaderboardRow> clubLeaderboard;

  const DistrictAdminOverview({
    required this.district,
    required this.totalClubs,
    required this.activeClubs,
    required this.totalMembers,
    required this.newMembersThisYear,
    required this.terminatedThisYear,
    required this.totalProjects,
    required this.totalMeetings,
    required this.avgAttendance,
    required this.trfTotalInr,
    required this.districtCitationScore,
    required this.announcements,
    required this.newsletters,
    required this.upcomingEvents,
    required this.topClubsByMembers,
    required this.topClubsByTrf,
    required this.topClubsByProjects,
    required this.qualifiedCitationClubs,
    this.maleMembers = 0,
    this.femaleMembers = 0,
    this.honoraryMembers = 0,
    this.inactiveMembers = 0,
    this.phfMembers = 0,
    this.majorDonors = 0,
    this.fundTypeBreakdown = const [],
    required this.membershipGoal,
    required this.trfGoal,
    required this.serviceProjects,
    required this.citation,
    required this.top20ClubsByMembers,
    required this.clubLeaderboard,
  });

  factory DistrictAdminOverview.fromJson(Map<String, dynamic> j) =>
      DistrictAdminOverview(
        district: DistrictAdminIdentity.fromJson(_obj(j['district'])),
        totalClubs: _i(j['totalClubs']),
        activeClubs: _i(j['activeClubs']),
        totalMembers: _i(j['totalMembers']),
        newMembersThisYear: _i(j['newMembersThisYear']),
        terminatedThisYear: _i(j['terminatedThisYear']),
        totalProjects: _i(j['totalProjects']),
        totalMeetings: _i(j['totalMeetings']),
        avgAttendance: _d(j['avgAttendance']),
        trfTotalInr: _d(j['trfTotalInr']),
        districtCitationScore: _d(j['districtCitationScore']),
        announcements: _i(j['announcements']),
        newsletters: _i(j['newsletters']),
        upcomingEvents: _i(j['upcomingEvents']),
        topClubsByMembers:
            _list(j['topClubsByMembers']).map(DistrictClubStat.fromJson).toList(),
        topClubsByTrf:
            _list(j['topClubsByTrf']).map(DistrictClubStat.fromJson).toList(),
        topClubsByProjects: _list(j['topClubsByProjects'])
            .map(DistrictClubStat.fromJson)
            .toList(),
        qualifiedCitationClubs: _i(j['qualifiedCitationClubs']),
        maleMembers: _i(j['maleMembers']),
        femaleMembers: _i(j['femaleMembers']),
        honoraryMembers: _i(j['honoraryMembers']),
        inactiveMembers: _i(j['inactiveMembers']),
        phfMembers: _i(j['phfMembers']),
        majorDonors: _i(j['majorDonors']),
        fundTypeBreakdown: _list(j['fundTypeBreakdown'])
            .map(DaFundBreakdownRow.fromJson)
            .toList(),
        membershipGoal: j['membershipGoal'] == null
            ? DaMembershipGoalPanel.empty
            : DaMembershipGoalPanel.fromJson(_obj(j['membershipGoal'])),
        trfGoal: j['trfGoal'] == null
            ? DaTrfGoalPanel.empty
            : DaTrfGoalPanel.fromJson(_obj(j['trfGoal'])),
        serviceProjects: j['serviceProjects'] == null
            ? DaServiceProjectsPanel.empty
            : DaServiceProjectsPanel.fromJson(_obj(j['serviceProjects'])),
        citation: j['citation'] == null
            ? DaCitationPanel.empty
            : DaCitationPanel.fromJson(_obj(j['citation'])),
        top20ClubsByMembers: _list(j['top20ClubsByMembers'])
            .map(DistrictClubStat.fromJson)
            .toList(),
        clubLeaderboard: _list(j['clubLeaderboard'])
            .map(DaClubLeaderboardRow.fromJson)
            .toList(),
      );
}

// ── /membership ──────────────────────────────────────────────────────────────

/// One sub-tab row (Directors / District Committee / Assistant Governors /
/// Clubs). The backend currently ships an empty `tabCounts`
/// list for un-wired districts, so the UI treats an empty list as "Pending".
class DaMembershipTabCount {
  final String tabKey; // directors | district_committee | ag | clubs
  final String tabLabel;
  final int total;
  final int active;
  final double participationPercent;
  const DaMembershipTabCount({
    required this.tabKey,
    required this.tabLabel,
    required this.total,
    required this.active,
    required this.participationPercent,
  });
  factory DaMembershipTabCount.fromJson(Map<String, dynamic> j) =>
      DaMembershipTabCount(
        tabKey: _s(j['tabKey']),
        tabLabel: _s(j['tabLabel']),
        total: _i(j['total']),
        active: _i(j['active']),
        participationPercent: _d(j['participationPercent']),
      );
}

class DistrictAdminMembership {
  final DistrictAdminIdentity district;
  final int totalMembers;
  final int maleMembers;
  final int femaleMembers;
  final int honoraryMembers;
  final int newMembersThisYear;
  final int terminatedThisYear;
  final int activeMembers;
  final DaMembershipGoalPanel membershipGoal;
  final List<DaMembershipTabCount> tabCounts;
  const DistrictAdminMembership({
    required this.district,
    required this.totalMembers,
    required this.maleMembers,
    required this.femaleMembers,
    required this.honoraryMembers,
    required this.newMembersThisYear,
    required this.terminatedThisYear,
    required this.activeMembers,
    required this.membershipGoal,
    required this.tabCounts,
  });
  factory DistrictAdminMembership.fromJson(Map<String, dynamic> j) =>
      DistrictAdminMembership(
        district: DistrictAdminIdentity.fromJson(_obj(j['district'])),
        totalMembers: _i(j['totalMembers']),
        maleMembers: _i(j['maleMembers']),
        femaleMembers: _i(j['femaleMembers']),
        honoraryMembers: _i(j['honoraryMembers']),
        newMembersThisYear: _i(j['newMembersThisYear']),
        terminatedThisYear: _i(j['terminatedThisYear']),
        // ActiveMembers is a Wave-13A2 additive field; fall back to total when absent.
        activeMembers:
            j['activeMembers'] == null ? _i(j['totalMembers']) : _i(j['activeMembers']),
        membershipGoal: j['membershipGoal'] == null
            ? DaMembershipGoalPanel.empty
            : DaMembershipGoalPanel.fromJson(_obj(j['membershipGoal'])),
        tabCounts:
            _list(j['tabCounts']).map(DaMembershipTabCount.fromJson).toList(),
      );
}

// ── /members (paged directory) ─────────────────────────────────────────────────

class DaDirectoryMember {
  final int memberId;
  final String name;
  final String? photoPath;
  final String? mobile;
  final String? email;
  final String? rotaryId;
  final String? gender;
  final String? clubName;
  final int? clubId;
  final String role;
  final String status;
  final bool isHonorary;
  final String? joinedDate;
  const DaDirectoryMember({
    required this.memberId,
    required this.name,
    required this.photoPath,
    required this.mobile,
    required this.email,
    required this.rotaryId,
    required this.gender,
    required this.clubName,
    required this.clubId,
    required this.role,
    required this.status,
    required this.isHonorary,
    required this.joinedDate,
  });
  factory DaDirectoryMember.fromJson(Map<String, dynamic> j) => DaDirectoryMember(
        memberId: _i(j['memberId']),
        name: _s(j['name']),
        photoPath: _sn(j['photoPath']),
        mobile: _sn(j['mobile']),
        email: _sn(j['email']),
        rotaryId: _sn(j['rotaryId']),
        gender: _sn(j['gender']),
        clubName: _sn(j['clubName']),
        clubId: _inI(j['clubId']),
        role: _s(j['role']),
        status: _s(j['status']),
        isHonorary: _b(j['isHonorary']),
        joinedDate: _sn(j['joinedDate']),
      );
}

class DaDirectoryPage {
  final int page;
  final int pageSize;
  final int totalCount;
  final int totalPages;
  final List<DaDirectoryMember> items;
  const DaDirectoryPage({
    required this.page,
    required this.pageSize,
    required this.totalCount,
    required this.totalPages,
    required this.items,
  });
  factory DaDirectoryPage.fromJson(Map<String, dynamic> j) => DaDirectoryPage(
        page: _i(j['page']),
        pageSize: _i(j['pageSize']),
        totalCount: _i(j['totalCount']),
        totalPages: _i(j['totalPages']),
        items: _list(j['items']).map(DaDirectoryMember.fromJson).toList(),
      );
  static const empty =
      DaDirectoryPage(page: 1, pageSize: 20, totalCount: 0, totalPages: 1, items: []);
}

// ── membership-goal editor (GET/POST /membership-goal) ───────────────────────
// Mirrors RotaryApi DistrictMembershipGoalDto. POST requires fkYearId > 0
// (server returns 400 otherwise) — the editor supplies it from /api/rotary-years.

class DistrictMembershipGoal {
  final int pkId;
  final int fkDistrictId;
  final int fkYearId;
  final int targetTotal;
  final int targetNewMembers;
  final double targetRetentionPercent;
  const DistrictMembershipGoal({
    this.pkId = 0,
    required this.fkDistrictId,
    required this.fkYearId,
    required this.targetTotal,
    required this.targetNewMembers,
    required this.targetRetentionPercent,
  });
  factory DistrictMembershipGoal.fromJson(Map<String, dynamic> j) =>
      DistrictMembershipGoal(
        pkId: _i(j['pkId']),
        fkDistrictId: _i(j['fkDistrictId']),
        fkYearId: _i(j['fkYearId']),
        targetTotal: _i(j['targetTotal']),
        targetNewMembers: _i(j['targetNewMembers']),
        targetRetentionPercent: _d(j['targetRetentionPercent']),
      );
  Map<String, dynamic> toJson() => {
        'pkId': pkId,
        'fkDistrictId': fkDistrictId,
        'fkYearId': fkYearId,
        'targetTotal': targetTotal,
        'targetNewMembers': targetNewMembers,
        'targetRetentionPercent': targetRetentionPercent,
      };
}

/// Foundation collection goal (GET/POST /foundation-goal). The 4 targets are
/// stored/transferred as RAW USD (the dashboard panel re-exposes them ×84 as
/// INR for display only). POST requires fkYearId > 0.
class DistrictFoundationGoal {
  final int pkId;
  final int fkDistrictId;
  final int fkYearId;
  final double targetAnnualFundUsd;
  final double targetPolioFundUsd;
  final double targetEndowmentFundUsd;
  final double targetOtherFundUsd;
  const DistrictFoundationGoal({
    this.pkId = 0,
    required this.fkDistrictId,
    required this.fkYearId,
    required this.targetAnnualFundUsd,
    required this.targetPolioFundUsd,
    required this.targetEndowmentFundUsd,
    required this.targetOtherFundUsd,
  });
  factory DistrictFoundationGoal.fromJson(Map<String, dynamic> j) =>
      DistrictFoundationGoal(
        pkId: _i(j['pkId']),
        fkDistrictId: _i(j['fkDistrictId']),
        fkYearId: _i(j['fkYearId']),
        targetAnnualFundUsd: _d(j['targetAnnualFundUsd']),
        targetPolioFundUsd: _d(j['targetPolioFundUsd']),
        targetEndowmentFundUsd: _d(j['targetEndowmentFundUsd']),
        targetOtherFundUsd: _d(j['targetOtherFundUsd']),
      );
  Map<String, dynamic> toJson() => {
        'pkId': pkId,
        'fkDistrictId': fkDistrictId,
        'fkYearId': fkYearId,
        'targetAnnualFundUsd': targetAnnualFundUsd,
        'targetPolioFundUsd': targetPolioFundUsd,
        'targetEndowmentFundUsd': targetEndowmentFundUsd,
        'targetOtherFundUsd': targetOtherFundUsd,
      };
}

/// A rotary-year row from `/api/rotary-years` (RotaryYearDto). NOTE: that
/// endpoint exposes the label as `yearLabel` (the shared `RotaryYearModel`
/// mis-reads `yearName`), so we parse it directly here.
class RotaryYearLite {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const RotaryYearLite({
    required this.id,
    required this.yearLabel,
    required this.isCurrent,
  });
  factory RotaryYearLite.fromJson(Map<String, dynamic> j) => RotaryYearLite(
        id: _i(j['id']),
        yearLabel: _s(j['yearLabel']),
        isCurrent: _b(j['isCurrent']),
      );
}

// ── /foundation ──────────────────────────────────────────────────────────────
// NOTE: the web Foundation console is a deliberately STAGED "Coming Soon"
// layout — it fetches this response but reads only `district` for the header
// and renders every section below as "Coming Soon". The backend, however,
// returns real financials/projects (only FoundationGoal is forced isPending).
// Mobile mirrors the web (Coming Soon) for parity; these scalar fields are
// parsed so the tab can be flipped to real data later without a model change.

class DaFoundationGoalPanel {
  final double? totalTargetInr;
  final double? annualTargetInr;
  final double? polioTargetInr;
  final double? endowmentTargetInr;
  final double? othersTargetInr;
  final bool isPending;
  const DaFoundationGoalPanel({
    required this.totalTargetInr,
    required this.annualTargetInr,
    required this.polioTargetInr,
    required this.endowmentTargetInr,
    required this.othersTargetInr,
    required this.isPending,
  });
  factory DaFoundationGoalPanel.fromJson(Map<String, dynamic> j) =>
      DaFoundationGoalPanel(
        totalTargetInr: _dnD(j['totalTargetInr']),
        annualTargetInr: _dnD(j['annualTargetInr']),
        polioTargetInr: _dnD(j['polioTargetInr']),
        endowmentTargetInr: _dnD(j['endowmentTargetInr']),
        othersTargetInr: _dnD(j['othersTargetInr']),
        isPending: _b(j['isPending']),
      );
  static const empty = DaFoundationGoalPanel(
    totalTargetInr: null,
    annualTargetInr: null,
    polioTargetInr: null,
    endowmentTargetInr: null,
    othersTargetInr: null,
    isPending: true,
  );
}

class DistrictAdminFoundation {
  final DistrictAdminIdentity district;
  final double totalInr;
  final double annualFundInr;
  final double polioFundInr;
  final double endowmentInr;
  final double othersInr;
  final int majorDonors;
  final int phfContributors;
  final DaFoundationGoalPanel foundationGoal;
  const DistrictAdminFoundation({
    required this.district,
    required this.totalInr,
    required this.annualFundInr,
    required this.polioFundInr,
    required this.endowmentInr,
    required this.othersInr,
    required this.majorDonors,
    required this.phfContributors,
    required this.foundationGoal,
  });
  factory DistrictAdminFoundation.fromJson(Map<String, dynamic> j) =>
      DistrictAdminFoundation(
        district: DistrictAdminIdentity.fromJson(_obj(j['district'])),
        totalInr: _d(j['totalInr']),
        annualFundInr: _d(j['annualFundInr']),
        polioFundInr: _d(j['polioFundInr']),
        endowmentInr: _d(j['endowmentInr']),
        othersInr: _d(j['othersInr']),
        majorDonors: _i(j['majorDonors']),
        phfContributors: _i(j['phfContributors']),
        foundationGoal: j['foundationGoal'] == null
            ? DaFoundationGoalPanel.empty
            : DaFoundationGoalPanel.fromJson(_obj(j['foundationGoal'])),
      );
}

// ── /communication ───────────────────────────────────────────────────────────
// All counts + Events/Announcements/Greetings lists are REAL (Wave 13A2). Only
// the web's "Documents & Newsletters" panel is staged "Coming Soon".

class DaCommItem {
  final String kind; // announcement | newsletter | event
  final String title;
  final String clubName;
  final String? publishDate; // yyyy-MM-dd
  // announcements only. Server-RELATIVE media path (e.g. "/Documents/announcement/…")
  // or an absolute http URL — resolve to a full mobile URL via ApiConstants.mediaUrl
  // (which leaves http URLs untouched and prepends the API host to relative paths).
  final String? imagePath;
  const DaCommItem({
    required this.kind,
    required this.title,
    required this.clubName,
    required this.publishDate,
    required this.imagePath,
  });
  factory DaCommItem.fromJson(Map<String, dynamic> j) => DaCommItem(
        kind: _s(j['kind']),
        title: _s(j['title']),
        clubName: _s(j['clubName']),
        publishDate: _sn(j['publishDate']),
        imagePath: _sn(j['imagePath']),
      );
}

class DaDistrictEvent {
  final int id;
  final String title;
  final String? description;
  final String? eventDate; // yyyy-MM-dd
  final String? venue;
  final String status; // Upcoming | Past | Cancelled
  final String? clubName;
  const DaDistrictEvent({
    required this.id,
    required this.title,
    required this.description,
    required this.eventDate,
    required this.venue,
    required this.status,
    required this.clubName,
  });
  factory DaDistrictEvent.fromJson(Map<String, dynamic> j) => DaDistrictEvent(
        id: _i(j['id']),
        title: _s(j['title']),
        description: _sn(j['description']),
        eventDate: _sn(j['eventDate']),
        venue: _sn(j['venue']),
        status: _s(j['status']),
        clubName: _sn(j['clubName']),
      );
}

class DaGreeting {
  final int memberId;
  final String name;
  final String? photoPath;
  final String? clubName;
  final String kind; // birthday | anniversary
  final String date; // yyyy-MM-dd
  final String bucket; // today | this_week | next_week
  const DaGreeting({
    required this.memberId,
    required this.name,
    required this.photoPath,
    required this.clubName,
    required this.kind,
    required this.date,
    required this.bucket,
  });
  factory DaGreeting.fromJson(Map<String, dynamic> j) => DaGreeting(
        memberId: _i(j['memberId']),
        name: _s(j['name']),
        photoPath: _sn(j['photoPath']),
        clubName: _sn(j['clubName']),
        kind: _s(j['kind']),
        date: _s(j['date']),
        bucket: _s(j['bucket']),
      );
}

class DaCommDocument {
  final int id;
  final String title;
  final String clubName;
  final String? publishDate;
  final String? filePath;
  final String? originalFileName;
  final String accessType;
  const DaCommDocument({
    required this.id,
    required this.title,
    required this.clubName,
    required this.publishDate,
    required this.filePath,
    required this.originalFileName,
    required this.accessType,
  });
  factory DaCommDocument.fromJson(Map<String, dynamic> j) => DaCommDocument(
        id: _i(j['id']),
        title: _s(j['title']),
        clubName: _s(j['clubName']),
        publishDate: _sn(j['publishDate']),
        filePath: _sn(j['filePath']),
        originalFileName: _sn(j['originalFileName']),
        accessType: _s(j['accessType']),
      );
}

class DistrictAdminCommunication {
  final DistrictAdminIdentity district;
  final int announcementCount;
  final int newsletterCount;
  final int upcomingEventCount;
  final int documentCount;
  final int greetingsTodayCount;
  final List<DaCommItem> announcements;
  final List<DaCommItem> newsletters;
  final List<DaCommItem> upcomingEvents;
  final List<DaDistrictEvent> districtEvents;
  final List<DaGreeting> greetings;
  final List<DaCommDocument> documents;
  const DistrictAdminCommunication({
    required this.district,
    required this.announcementCount,
    required this.newsletterCount,
    required this.upcomingEventCount,
    required this.documentCount,
    required this.greetingsTodayCount,
    required this.announcements,
    required this.newsletters,
    required this.upcomingEvents,
    required this.districtEvents,
    required this.greetings,
    required this.documents,
  });
  factory DistrictAdminCommunication.fromJson(Map<String, dynamic> j) =>
      DistrictAdminCommunication(
        district: DistrictAdminIdentity.fromJson(_obj(j['district'])),
        announcementCount: _i(j['announcementCount']),
        newsletterCount: _i(j['newsletterCount']),
        upcomingEventCount: _i(j['upcomingEventCount']),
        documentCount: _i(j['documentCount']),
        greetingsTodayCount: _i(j['greetingsTodayCount']),
        announcements:
            _list(j['announcements']).map(DaCommItem.fromJson).toList(),
        newsletters: _list(j['newsletters']).map(DaCommItem.fromJson).toList(),
        upcomingEvents:
            _list(j['upcomingEvents']).map(DaCommItem.fromJson).toList(),
        districtEvents:
            _list(j['districtEvents']).map(DaDistrictEvent.fromJson).toList(),
        greetings: _list(j['greetings']).map(DaGreeting.fromJson).toList(),
        documents: _list(j['documents']).map(DaCommDocument.fromJson).toList(),
      );
}

// ── /egovernance ─────────────────────────────────────────────────────────────
// The main response's NEW Wave-13A2 fields (monthlyReportsCount,
// avgCitationScore, cmrTotalClubs, cmrOnTimePercent, cmrMonthBreakdown[],
// cmrPerClubGrid[], citationPerClub[], reports[]) are
// DEAD-CODE / unpopulated (always 0/empty). The LEGACY fields (totalCmrSubmitted,
// totalCmrPending) ARE real. The 12-month per-club grid comes from the dedicated
// /egovernance/per-club endpoint ([DistrictAdminCmrPerClubGrid]).

class DistrictAdminEGovernance {
  final DistrictAdminIdentity district;
  final int totalCmrSubmitted;
  final int totalCmrPending;
  final double avgAttendance;
  final int totalMeetings;
  final int monthlyReportsCount; // Wave-13A2: stub 0
  final double avgCitationScore; // Wave-13A2: stub 0 → render Pending
  final int cmrTotalClubs; // Wave-13A2: stub 0 → fall back to district.totalClubs
  final double cmrOnTimePercent; // Wave-13A2: stub 0 → compute from legacy totals
  const DistrictAdminEGovernance({
    required this.district,
    required this.totalCmrSubmitted,
    required this.totalCmrPending,
    required this.avgAttendance,
    required this.totalMeetings,
    required this.monthlyReportsCount,
    required this.avgCitationScore,
    required this.cmrTotalClubs,
    required this.cmrOnTimePercent,
  });
  factory DistrictAdminEGovernance.fromJson(Map<String, dynamic> j) =>
      DistrictAdminEGovernance(
        district: DistrictAdminIdentity.fromJson(_obj(j['district'])),
        totalCmrSubmitted: _i(j['totalCmrSubmitted']),
        totalCmrPending: _i(j['totalCmrPending']),
        avgAttendance: _d(j['avgAttendance']),
        totalMeetings: _i(j['totalMeetings']),
        monthlyReportsCount: _i(j['monthlyReportsCount']),
        avgCitationScore: _d(j['avgCitationScore']),
        cmrTotalClubs: _i(j['cmrTotalClubs']),
        cmrOnTimePercent: _d(j['cmrOnTimePercent']),
      );

  // ── derived (web-parity fallbacks) ──
  int get monthlyReports =>
      monthlyReportsCount != 0 ? monthlyReportsCount : totalCmrSubmitted;
  int get cmrClubs =>
      cmrTotalClubs != 0 ? cmrTotalClubs : district.totalClubs;
  int get onTimePercent {
    if (cmrOnTimePercent > 0) return cmrOnTimePercent.round();
    final denom = totalCmrSubmitted + totalCmrPending;
    return denom > 0 ? (totalCmrSubmitted / denom * 100).round() : 0;
  }

  bool get citationPending => avgCitationScore <= 0;
}

class DaCmrPerClubMonth {
  final int month; // 1=Jul .. 12=Jun (rotary year)
  final String status; // submitted | pending | not_started | late
  final String? submittedDate;
  const DaCmrPerClubMonth({
    required this.month,
    required this.status,
    required this.submittedDate,
  });
  factory DaCmrPerClubMonth.fromJson(Map<String, dynamic> j) =>
      DaCmrPerClubMonth(
        month: _i(j['month']),
        status: _s(j['status']),
        submittedDate: _sn(j['submittedDate']),
      );
}

class DaCmrPerClubRow {
  final int clubId;
  final String clubName;
  final int submitted;
  final int pending;
  final List<DaCmrPerClubMonth> months;
  const DaCmrPerClubRow({
    required this.clubId,
    required this.clubName,
    required this.submitted,
    required this.pending,
    required this.months,
  });
  factory DaCmrPerClubRow.fromJson(Map<String, dynamic> j) => DaCmrPerClubRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        submitted: _i(j['submitted']),
        pending: _i(j['pending']),
        months: _list(j['months']).map(DaCmrPerClubMonth.fromJson).toList()
          ..sort((a, b) => a.month.compareTo(b.month)),
      );
}

class DistrictAdminCmrPerClubGrid {
  final DistrictAdminIdentity district;
  final List<DaCmrPerClubRow> rows;
  const DistrictAdminCmrPerClubGrid({
    required this.district,
    required this.rows,
  });
  factory DistrictAdminCmrPerClubGrid.fromJson(Map<String, dynamic> j) =>
      DistrictAdminCmrPerClubGrid(
        district: DistrictAdminIdentity.fromJson(_obj(j['district'])),
        rows: _list(j['rows']).map(DaCmrPerClubRow.fromJson).toList(),
      );
}

// ── stable per-club colour palette ───────────────────────────────────────────
const kDaPalette = <int>[
  0xFF003DA5,
  0xFFF7A81B,
  0xFF10B981,
  0xFFEF4444,
  0xFF7C3AED,
  0xFF0EA5E9,
  0xFFF59E0B,
  0xFFEC4899,
];
int daClubColor(int i) => kDaPalette[i % kDaPalette.length];

// ── Rotary Network (district-admin) ──────────────────────────────────────────
// GET  /api/district-admin-dashboard/rotary-network
// GET  /api/district-admin-dashboard/rotary-network/live-terminated
// POST /api/district-admin-dashboard/rotary-network/refresh-terminated-cache/start
// GET  /api/district-admin-dashboard/rotary-network/refresh-terminated-cache/status
// (These live on the NON-mobile controller; same Admin-role JWT the app already
// carries.) Mirrors DistrictAdminRotaryNetworkRow / *Response / LiveTerminated /
// RefreshJobStatus DTOs.

class DaNetworkRow {
  final int id;
  final int clubId;
  final String clubName;
  final String memberId;
  final String memberType;
  final String firstName;
  final String middleName;
  final String lastName;
  final String? admissionDate;
  final String? terminationDate;
  final String? terminationReason;
  final String? status; // "Terminated" | "Potential"
  final String? mobile;
  final String? email;
  final String? notes; // potential members only
  const DaNetworkRow({
    required this.id,
    required this.clubId,
    required this.clubName,
    required this.memberId,
    required this.memberType,
    required this.firstName,
    required this.middleName,
    required this.lastName,
    required this.admissionDate,
    required this.terminationDate,
    required this.terminationReason,
    required this.status,
    required this.mobile,
    required this.email,
    required this.notes,
  });
  factory DaNetworkRow.fromJson(Map<String, dynamic> j) => DaNetworkRow(
        id: _i(j['id']),
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        memberId: _s(j['memberId']),
        memberType: _s(j['memberType']),
        firstName: _s(j['firstName']),
        middleName: _s(j['middleName']),
        lastName: _s(j['lastName']),
        admissionDate: _sn(j['admissionDate']),
        terminationDate: _sn(j['terminationDate']),
        terminationReason: _sn(j['terminationReason']),
        status: _sn(j['status']),
        mobile: _sn(j['mobile']),
        email: _sn(j['email']),
        notes: _sn(j['notes']),
      );

  String get fullName => [firstName, middleName, lastName]
      .where((s) => s.trim().isNotEmpty)
      .join(' ')
      .trim();
}

class DaNetworkClub {
  final int clubId;
  final String clubName;
  const DaNetworkClub({required this.clubId, required this.clubName});
  factory DaNetworkClub.fromJson(Map<String, dynamic> j) => DaNetworkClub(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
      );
}

class DaRotaryNetwork {
  final DistrictAdminIdentity district;
  final int totalTerminated;
  final int totalPotential;
  final List<DaNetworkRow> terminated;
  final List<DaNetworkRow> potential;
  final List<DaNetworkClub> clubs;
  const DaRotaryNetwork({
    required this.district,
    required this.totalTerminated,
    required this.totalPotential,
    required this.terminated,
    required this.potential,
    required this.clubs,
  });
  factory DaRotaryNetwork.fromJson(Map<String, dynamic> j) => DaRotaryNetwork(
        district: DistrictAdminIdentity.fromJson(
            (j['district'] as Map?)?.cast<String, dynamic>() ?? const {}),
        totalTerminated: _i(j['totalTerminated']),
        totalPotential: _i(j['totalPotential']),
        terminated:
            _list(j['terminatedMembers']).map(DaNetworkRow.fromJson).toList(),
        potential:
            _list(j['potentialMembers']).map(DaNetworkRow.fromJson).toList(),
        clubs: _list(j['clubs']).map(DaNetworkClub.fromJson).toList(),
      );
}

class DaLiveTerminated {
  final List<DaNetworkRow> members;
  final int clubsQueried;
  final int clubsSkippedNoRotaryId;
  final String? warning;
  const DaLiveTerminated({
    required this.members,
    required this.clubsQueried,
    required this.clubsSkippedNoRotaryId,
    required this.warning,
  });
  factory DaLiveTerminated.fromJson(Map<String, dynamic> j) => DaLiveTerminated(
        members: _list(j['members']).map(DaNetworkRow.fromJson).toList(),
        clubsQueried: _i(j['clubsQueried']),
        clubsSkippedNoRotaryId: _i(j['clubsSkippedNoRotaryId']),
        warning: _sn(j['warning']),
      );
}

class DaRefreshStatus {
  final int jobId;
  final int districtId;
  final String status; // Running | Done | Failed | NeverRun
  final int totalLinkedClubs;
  final int clubsDone;
  final String? warning;
  const DaRefreshStatus({
    required this.jobId,
    required this.districtId,
    required this.status,
    required this.totalLinkedClubs,
    required this.clubsDone,
    required this.warning,
  });
  factory DaRefreshStatus.fromJson(Map<String, dynamic> j) => DaRefreshStatus(
        jobId: _i(j['jobId']),
        districtId: _i(j['districtId']),
        status: _s(j['status']),
        totalLinkedClubs: _i(j['totalLinkedClubs']),
        clubsDone: _i(j['clubsDone']),
        warning: _sn(j['warning']),
      );
  bool get isRunning => status == 'Running';
}

// AG (Assistant Governor) Dashboard models — mirror `RotaryApi/DTOs/AgDashboardDtos.cs`.
// Wire JSON is camelCase. TRF *Inr = USD x 84. Percent fields are 0-100.
// Wave-12A fields carry `*IsPending` flags — when true the value is 0/null and
// the UI must render an em-dash "—" / "Pending" chip, never the 0.

// ── json helpers ─────────────────────────────────────────────────────────────
int _i(dynamic v) =>
    v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0);
int? _inI(dynamic v) =>
    v == null ? null : (v is num ? v.toInt() : int.tryParse('$v'));
double _d(dynamic v) =>
    v is num ? v.toDouble() : double.tryParse('${v ?? ''}') ?? 0.0;
String _s(dynamic v) => v?.toString() ?? '';
String? _sn(dynamic v) => v?.toString();
bool _b(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = '${v ?? ''}'.toLowerCase().trim();
  return s == 'true' || s == '1' || s == 'yes';
}

List<Map<String, dynamic>> _list(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
    : const <Map<String, dynamic>>[];

Map<String, int> _intMap(dynamic v) => v is Map
    ? v.map((k, val) => MapEntry(k.toString(), _i(val)))
    : <String, int>{};

Map<String, double> _doubleMap(dynamic v) => v is Map
    ? v.map((k, val) => MapEntry(k.toString(), _d(val)))
    : <String, double>{};

// ── shared ───────────────────────────────────────────────────────────────────

class AgIdentity {
  final int memberId;
  final String name;
  final String districtNumber;
  final String yearLabel;
  const AgIdentity({
    required this.memberId,
    required this.name,
    required this.districtNumber,
    required this.yearLabel,
  });
  factory AgIdentity.fromJson(Map<String, dynamic> j) => AgIdentity(
        memberId: _i(j['memberId']),
        name: _s(j['name']),
        districtNumber: _s(j['districtNumber']),
        yearLabel: _s(j['yearLabel']),
      );
  static AgIdentity of(Map<String, dynamic> j) =>
      AgIdentity.fromJson((j['ag'] as Map?)?.cast<String, dynamic>() ?? const {});
}

class AgTrfBreakdown {
  final double annualInr;
  final double polioInr;
  final double endowment;
  final double others;
  final double totalInr;
  final double totalUsd;
  const AgTrfBreakdown({
    required this.annualInr,
    required this.polioInr,
    required this.endowment,
    required this.others,
    required this.totalInr,
    required this.totalUsd,
  });
  factory AgTrfBreakdown.fromJson(Map<String, dynamic> j) => AgTrfBreakdown(
        annualInr: _d(j['annualInr']),
        polioInr: _d(j['polioInr']),
        endowment: _d(j['endowment']),
        others: _d(j['others']),
        totalInr: _d(j['totalInr']),
        totalUsd: _d(j['totalUsd']),
      );
  static const empty = AgTrfBreakdown(
      annualInr: 0, polioInr: 0, endowment: 0, others: 0, totalInr: 0, totalUsd: 0);
}

class AgClubSummary {
  final int clubId;
  final String clubName;
  final String districtNumber;
  final String presidentName;
  // Wave 2026-07-20: current-year Secretary + Rotary.org sync flag + club-website
  // state. `clubWebsiteSubdomain` is the RAW stored value (may hold junk like
  // "https//rc.../") — clean via WebsiteDomainHelper before display.
  final String secretaryName;
  final bool isSyncedFromRotaryOrg;
  final String clubWebsiteStatus; // 'active' | 'expired' | 'none'
  final String? clubWebsiteSubdomain;
  final int members;
  final int meetings;
  final int totalProjects;
  final int projectRank;
  final double trfTotalInr;
  final double trfTotalUsd;
  final int ocv;
  final int? nationalRank; // always null for now
  final bool nationalRankIsPending; // always true for now
  const AgClubSummary({
    required this.clubId,
    required this.clubName,
    required this.districtNumber,
    required this.presidentName,
    required this.secretaryName,
    required this.isSyncedFromRotaryOrg,
    required this.clubWebsiteStatus,
    required this.clubWebsiteSubdomain,
    required this.members,
    required this.meetings,
    required this.totalProjects,
    required this.projectRank,
    required this.trfTotalInr,
    required this.trfTotalUsd,
    required this.ocv,
    required this.nationalRank,
    required this.nationalRankIsPending,
  });
  factory AgClubSummary.fromJson(Map<String, dynamic> j) => AgClubSummary(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        districtNumber: _s(j['districtNumber']),
        presidentName: _s(j['presidentName']),
        secretaryName: _s(j['secretaryName']),
        isSyncedFromRotaryOrg: _b(j['isSyncedFromRotaryOrg']),
        clubWebsiteStatus: () {
          final v = _s(j['clubWebsiteStatus']);
          return v.isEmpty ? 'none' : v;
        }(),
        clubWebsiteSubdomain: _sn(j['clubWebsiteSubdomain']),
        members: _i(j['members']),
        meetings: _i(j['meetings']),
        totalProjects: _i(j['totalProjects']),
        projectRank: _i(j['projectRank']),
        trfTotalInr: _d(j['trfTotalInr']),
        trfTotalUsd: _d(j['trfTotalUsd']),
        ocv: _i(j['ocv']),
        nationalRank: _inI(j['nationalRank']),
        nationalRankIsPending: _b(j['nationalRankIsPending']),
      );

  /// Non-synced = explicitly `false` (a manually-managed club). Null → treated
  /// as synced (no star), mirroring [[project_clubfinder_nonsync_star]].
  bool get isNonSync => !isSyncedFromRotaryOrg;

  bool get hasWebsite => clubWebsiteStatus == 'active' || clubWebsiteStatus == 'expired';
}

class AgProjectRow {
  // Wave 2026-07-20: identity for the detail drill-down. `projectId` is only
  // unique WITHIN its year table, so `yearId` must travel with it to the detail
  // fetch. Older payloads omit both → 0 (row simply isn't tappable).
  final int projectId;
  final int yearId;
  final int clubId;
  final String clubName;
  final String title;
  // Service avenue = module name (Community / Vocational / International /
  // New Generations / Public Image / Club Service). Null on older payloads.
  final String? avenue;
  final String? areaOfFocus;
  final String? date; // "yyyy-MM-dd" or null
  final double cost;
  final String currency; // the project's own currency — the row shows cost in this
  final int beneficiaries;
  final int manHours;
  final String funding;
  final int rotarians;
  final bool manHoursIsPending;
  const AgProjectRow({
    required this.projectId,
    required this.yearId,
    required this.clubId,
    required this.clubName,
    required this.title,
    required this.avenue,
    required this.areaOfFocus,
    required this.date,
    required this.cost,
    required this.currency,
    required this.beneficiaries,
    required this.manHours,
    required this.funding,
    required this.rotarians,
    required this.manHoursIsPending,
  });
  factory AgProjectRow.fromJson(Map<String, dynamic> j) => AgProjectRow(
        projectId: _i(j['projectId']),
        yearId: _i(j['yearId']),
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        title: _s(j['title']),
        avenue: _sn(j['avenue']),
        areaOfFocus: _sn(j['areaOfFocus']),
        date: _sn(j['date']),
        cost: _d(j['cost']),
        currency: _s(j['currency']).isEmpty ? 'INR' : _s(j['currency']),
        beneficiaries: _i(j['beneficiaries']),
        manHours: _i(j['manHours']),
        funding: _s(j['funding']),
        rotarians: _i(j['rotarians']),
        manHoursIsPending: _b(j['manHoursIsPending']),
      );

  /// A detail drill-down is only possible when the server sent a stable id.
  bool get canOpenDetail => projectId > 0;
}

// ── /projects/{projectId} (detail popup) ─────────────────────────────────────

class AgProjectPhoto {
  final String url; // relative API path → resolve via ApiConstants.mediaUrl
  final String? description;
  final bool isPrimary;
  const AgProjectPhoto({
    required this.url,
    required this.description,
    required this.isPrimary,
  });
  factory AgProjectPhoto.fromJson(Map<String, dynamic> j) => AgProjectPhoto(
        url: _s(j['url']),
        description: _sn(j['description']),
        isPrimary: _b(j['isPrimary']),
      );
}

class AgProjectDetail {
  final int projectId;
  final int clubId;
  final String clubName;
  final int yearId;
  final String yearLabel;
  final String title;
  final String? description;
  final String? location;
  final String? avenue;
  final String? areaOfFocus;
  final String? date;
  final double cost;
  final String funding;
  final int beneficiaries;
  final int manHours;
  final bool manHoursIsPending;
  final int rotariansInvolved;
  final int rotaractorsInvolved;
  final String? projectType;
  final bool isJointProject;
  final String? coHostName;
  final String? clubRole;
  final List<AgProjectPhoto> photos;
  const AgProjectDetail({
    required this.projectId,
    required this.clubId,
    required this.clubName,
    required this.yearId,
    required this.yearLabel,
    required this.title,
    required this.description,
    required this.location,
    required this.avenue,
    required this.areaOfFocus,
    required this.date,
    required this.cost,
    required this.funding,
    required this.beneficiaries,
    required this.manHours,
    required this.manHoursIsPending,
    required this.rotariansInvolved,
    required this.rotaractorsInvolved,
    required this.projectType,
    required this.isJointProject,
    required this.coHostName,
    required this.clubRole,
    required this.photos,
  });
  factory AgProjectDetail.fromJson(Map<String, dynamic> j) => AgProjectDetail(
        projectId: _i(j['projectId']),
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        title: _s(j['title']),
        description: _sn(j['description']),
        location: _sn(j['location']),
        avenue: _sn(j['avenue']),
        areaOfFocus: _sn(j['areaOfFocus']),
        date: _sn(j['date']),
        cost: _d(j['cost']),
        funding: _s(j['funding']),
        beneficiaries: _i(j['beneficiaries']),
        manHours: _i(j['manHours']),
        manHoursIsPending: _b(j['manHoursIsPending']),
        rotariansInvolved: _i(j['rotariansInvolved']),
        rotaractorsInvolved: _i(j['rotaractorsInvolved']),
        projectType: _sn(j['projectType']),
        isJointProject: _b(j['isJointProject']),
        coHostName: _sn(j['coHostName']),
        clubRole: _sn(j['clubRole']),
        photos: _list(j['photos']).map(AgProjectPhoto.fromJson).toList(),
      );
}

// ── /available-years (topbar year picker) ────────────────────────────────────

class AgYearOption {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const AgYearOption({
    required this.id,
    required this.yearLabel,
    required this.isCurrent,
  });
  factory AgYearOption.fromJson(Map<String, dynamic> j) => AgYearOption(
        id: _i(j['id']),
        yearLabel: _s(j['yearLabel']),
        isCurrent: _b(j['isCurrent']),
      );
}

class AgAvailableYears {
  final int? currentYearId;
  final String currentYearLabel;
  final List<AgYearOption> years;
  const AgAvailableYears({
    required this.currentYearId,
    required this.currentYearLabel,
    required this.years,
  });
  factory AgAvailableYears.fromJson(Map<String, dynamic> j) => AgAvailableYears(
        currentYearId: _inI(j['currentYearId']),
        currentYearLabel: _s(j['currentYearLabel']),
        years: _list(j['years']).map(AgYearOption.fromJson).toList(),
      );
  static const empty =
      AgAvailableYears(currentYearId: null, currentYearLabel: '', years: []);
}

// ── /clubs ───────────────────────────────────────────────────────────────────

class AgClubsResponse {
  final AgIdentity ag;
  final List<AgClubSummary> clubs;
  final int totalMembers;
  final int totalMeetings;
  final int totalProjects;
  final double totalTrfInr;
  final int totalClubsInDistrict;
  const AgClubsResponse({
    required this.ag,
    required this.clubs,
    required this.totalMembers,
    required this.totalMeetings,
    required this.totalProjects,
    required this.totalTrfInr,
    required this.totalClubsInDistrict,
  });
  factory AgClubsResponse.fromJson(Map<String, dynamic> j) => AgClubsResponse(
        ag: AgIdentity.of(j),
        clubs: _list(j['clubs']).map(AgClubSummary.fromJson).toList(),
        totalMembers: _i(j['totalMembers']),
        totalMeetings: _i(j['totalMeetings']),
        totalProjects: _i(j['totalProjects']),
        totalTrfInr: _d(j['totalTrfInr']),
        totalClubsInDistrict: _i(j['totalClubsInDistrict']),
      );
}

// ── /clubs/{id} ──────────────────────────────────────────────────────────────

class AgMonthlyPoint {
  final String month; // "Jul 2025"
  final int meetings;
  final int projects;
  final double trfInr;
  const AgMonthlyPoint({
    required this.month,
    required this.meetings,
    required this.projects,
    required this.trfInr,
  });
  factory AgMonthlyPoint.fromJson(Map<String, dynamic> j) => AgMonthlyPoint(
        month: _s(j['month']),
        meetings: _i(j['meetings']),
        projects: _i(j['projects']),
        trfInr: _d(j['trfInr']),
      );
}

class AgClubDetail {
  final AgClubSummary summary;
  final List<AgMonthlyPoint> monthly;
  final AgTrfBreakdown trf;
  final List<AgProjectRow> recentProjects;
  const AgClubDetail({
    required this.summary,
    required this.monthly,
    required this.trf,
    required this.recentProjects,
  });
  factory AgClubDetail.fromJson(Map<String, dynamic> j) => AgClubDetail(
        summary: AgClubSummary.fromJson(
            (j['summary'] as Map?)?.cast<String, dynamic>() ?? const {}),
        monthly: _list(j['monthly']).map(AgMonthlyPoint.fromJson).toList(),
        trf: AgTrfBreakdown.fromJson(
            (j['trf'] as Map?)?.cast<String, dynamic>() ?? const {}),
        recentProjects:
            _list(j['recentProjects']).map(AgProjectRow.fromJson).toList(),
      );
}

// ── /trf ─────────────────────────────────────────────────────────────────────

class AgClubTrf {
  final int clubId;
  final String clubName;
  final int members;
  final AgTrfBreakdown trf;
  final double percentOfAgTotal;
  const AgClubTrf({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.trf,
    required this.percentOfAgTotal,
  });
  factory AgClubTrf.fromJson(Map<String, dynamic> j) => AgClubTrf(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        trf: AgTrfBreakdown.fromJson(
            (j['trf'] as Map?)?.cast<String, dynamic>() ?? const {}),
        percentOfAgTotal: _d(j['percentOfAgTotal']),
      );
}

class AgTrfResponse {
  final AgIdentity ag;
  final List<AgClubTrf> clubs;
  final AgTrfBreakdown totals;
  const AgTrfResponse(
      {required this.ag, required this.clubs, required this.totals});
  factory AgTrfResponse.fromJson(Map<String, dynamic> j) => AgTrfResponse(
        ag: AgIdentity.of(j),
        clubs: _list(j['clubs']).map(AgClubTrf.fromJson).toList(),
        totals: AgTrfBreakdown.fromJson(
            (j['totals'] as Map?)?.cast<String, dynamic>() ?? const {}),
      );
}

// ── /membership ──────────────────────────────────────────────────────────────

class AgMembershipClubRow {
  final int clubId;
  final String clubName;
  final int members;
  final int meetings;
  final int totalProjects;
  final int projectRank;
  final double trf; // INR
  final int ocv;
  final int beneficiaries;
  final int goalsCitations;
  const AgMembershipClubRow({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.meetings,
    required this.totalProjects,
    required this.projectRank,
    required this.trf,
    required this.ocv,
    required this.beneficiaries,
    required this.goalsCitations,
  });
  factory AgMembershipClubRow.fromJson(Map<String, dynamic> j) =>
      AgMembershipClubRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        meetings: _i(j['meetings']),
        totalProjects: _i(j['totalProjects']),
        projectRank: _i(j['projectRank']),
        trf: _d(j['trf']),
        ocv: _i(j['ocv']),
        beneficiaries: _i(j['beneficiaries']),
        goalsCitations: _i(j['goalsCitations']),
      );
}

class AgMembershipResponse {
  final AgIdentity ag;
  final List<AgMembershipClubRow> clubs;
  final int totalMembers;
  final int totalMeetings;
  final int totalProjects;
  final double totalTrfInr;
  final int totalOcv;
  final int totalClubsInDistrict;
  final int totalBeneficiaries;
  const AgMembershipResponse({
    required this.ag,
    required this.clubs,
    required this.totalMembers,
    required this.totalMeetings,
    required this.totalProjects,
    required this.totalTrfInr,
    required this.totalOcv,
    required this.totalClubsInDistrict,
    required this.totalBeneficiaries,
  });
  factory AgMembershipResponse.fromJson(Map<String, dynamic> j) =>
      AgMembershipResponse(
        ag: AgIdentity.of(j),
        clubs: _list(j['clubs']).map(AgMembershipClubRow.fromJson).toList(),
        totalMembers: _i(j['totalMembers']),
        totalMeetings: _i(j['totalMeetings']),
        totalProjects: _i(j['totalProjects']),
        totalTrfInr: _d(j['totalTrfInr']),
        totalOcv: _i(j['totalOcv']),
        totalClubsInDistrict: _i(j['totalClubsInDistrict']),
        totalBeneficiaries: _i(j['totalBeneficiaries']),
      );
}

// ── /youth ───────────────────────────────────────────────────────────────────

class AgYouthClubRow {
  final int clubId;
  final String clubName;
  final int newGenerationService;
  final int vocationalService;
  final int internationalService;
  final int totalProjects;
  final int members;
  final int meetings;
  const AgYouthClubRow({
    required this.clubId,
    required this.clubName,
    required this.newGenerationService,
    required this.vocationalService,
    required this.internationalService,
    required this.totalProjects,
    required this.members,
    required this.meetings,
  });
  factory AgYouthClubRow.fromJson(Map<String, dynamic> j) => AgYouthClubRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        newGenerationService: _i(j['newGenerationService']),
        vocationalService: _i(j['vocationalService']),
        internationalService: _i(j['internationalService']),
        totalProjects: _i(j['totalProjects']),
        members: _i(j['members']),
        meetings: _i(j['meetings']),
      );
}

class AgYouthResponse {
  final AgIdentity ag;
  final List<AgYouthClubRow> clubs;
  final int totalNewGeneration;
  final int totalVocational;
  final int totalInternational;
  final int totalProjects;
  const AgYouthResponse({
    required this.ag,
    required this.clubs,
    required this.totalNewGeneration,
    required this.totalVocational,
    required this.totalInternational,
    required this.totalProjects,
  });
  factory AgYouthResponse.fromJson(Map<String, dynamic> j) => AgYouthResponse(
        ag: AgIdentity.of(j),
        clubs: _list(j['clubs']).map(AgYouthClubRow.fromJson).toList(),
        totalNewGeneration: _i(j['totalNewGeneration']),
        totalVocational: _i(j['totalVocational']),
        totalInternational: _i(j['totalInternational']),
        totalProjects: _i(j['totalProjects']),
      );
}

// ── /projects ────────────────────────────────────────────────────────────────

class AgProjectsResponse {
  final AgIdentity ag;
  final List<AgProjectRow> projects;
  final Map<String, int> clubProjectCounts; // clubName -> count
  final Map<String, int> monthlyProjectCounts; // "Jul 2025" -> count
  final int totalProjects;
  final int totalBeneficiaries;
  final int totalManHours;
  final double totalCost;
  // Currency the totalCost KPI is expressed in (the district default). Per-
  // project rows keep their own currency.
  final String targetCurrency;
  const AgProjectsResponse({
    required this.ag,
    required this.projects,
    required this.clubProjectCounts,
    required this.monthlyProjectCounts,
    required this.totalProjects,
    required this.totalBeneficiaries,
    required this.totalManHours,
    required this.totalCost,
    required this.targetCurrency,
  });
  factory AgProjectsResponse.fromJson(Map<String, dynamic> j) =>
      AgProjectsResponse(
        ag: AgIdentity.of(j),
        projects: _list(j['projects']).map(AgProjectRow.fromJson).toList(),
        clubProjectCounts: _intMap(j['clubProjectCounts']),
        monthlyProjectCounts: _intMap(j['monthlyProjectCounts']),
        totalProjects: _i(j['totalProjects']),
        totalBeneficiaries: _i(j['totalBeneficiaries']),
        totalManHours: _i(j['totalManHours']),
        totalCost: _d(j['totalCost']),
        targetCurrency:
            _s(j['targetCurrency']).isEmpty ? 'INR' : _s(j['targetCurrency']),
      );

  /// FE-derived root pending: projects present and either every row pending or
  /// the total is 0 (no year table exposes man_hours yet).
  bool get manHoursPending =>
      projects.isNotEmpty &&
      (projects.every((p) => p.manHoursIsPending) || totalManHours == 0);
}

// ── /excellence ──────────────────────────────────────────────────────────────

class AgCitationClubRow {
  final int clubId;
  final String clubName;
  final int members;
  final double total;
  final double membership;
  final double trf;
  final double service;
  final double publicImage;
  final double youth;
  final double foundation;
  const AgCitationClubRow({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.total,
    required this.membership,
    required this.trf,
    required this.service,
    required this.publicImage,
    required this.youth,
    required this.foundation,
  });
  factory AgCitationClubRow.fromJson(Map<String, dynamic> j) =>
      AgCitationClubRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        total: _d(j['total']),
        membership: _d(j['membership']),
        trf: _d(j['trf']),
        service: _d(j['service']),
        publicImage: _d(j['publicImage']),
        youth: _d(j['youth']),
        foundation: _d(j['foundation']),
      );
}

class AgGoalsClubRow {
  final int clubId;
  final String clubName;
  final int members;
  final double membershipGrowth; // %
  final double trfPerCapita; // INR
  final int serviceProjects;
  final double meetingAttendance; // %
  final double myRotary; // %
  final int newMembers;
  final bool myRotaryIsPending;
  const AgGoalsClubRow({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.membershipGrowth,
    required this.trfPerCapita,
    required this.serviceProjects,
    required this.meetingAttendance,
    required this.myRotary,
    required this.newMembers,
    required this.myRotaryIsPending,
  });
  factory AgGoalsClubRow.fromJson(Map<String, dynamic> j) => AgGoalsClubRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        membershipGrowth: _d(j['membershipGrowth']),
        trfPerCapita: _d(j['trfPerCapita']),
        serviceProjects: _i(j['serviceProjects']),
        meetingAttendance: _d(j['meetingAttendance']),
        myRotary: _d(j['myRotary']),
        newMembers: _i(j['newMembers']),
        myRotaryIsPending: _b(j['myRotaryIsPending']),
      );
}

class AgAwardStatus {
  final int clubId;
  final String clubName;
  final bool onTrack;
  final bool achieved;
  final String presidentialCitation; // achieved|on-track|behind|pending
  final String districtCitation;
  final String membershipExcellence;
  final bool isPending;
  const AgAwardStatus({
    required this.clubId,
    required this.clubName,
    required this.onTrack,
    required this.achieved,
    required this.presidentialCitation,
    required this.districtCitation,
    required this.membershipExcellence,
    required this.isPending,
  });
  factory AgAwardStatus.fromJson(Map<String, dynamic> j) => AgAwardStatus(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        onTrack: _b(j['onTrack']),
        achieved: _b(j['achieved']),
        presidentialCitation: _s(j['presidentialCitation']),
        districtCitation: _s(j['districtCitation']),
        membershipExcellence: _s(j['membershipExcellence']),
        isPending: _b(j['isPending']),
      );
}

class AgMonthlyTrackingPoint {
  final String month;
  final Map<String, double> byClub; // clubName -> value
  const AgMonthlyTrackingPoint({required this.month, required this.byClub});
  factory AgMonthlyTrackingPoint.fromJson(Map<String, dynamic> j) =>
      AgMonthlyTrackingPoint(
        month: _s(j['month']),
        byClub: _doubleMap(j['byClub']),
      );
}

class AgExcellenceResponse {
  final AgIdentity ag;
  final List<AgCitationClubRow> citation;
  final List<AgGoalsClubRow> goals;
  final List<AgMonthlyTrackingPoint> monthlyProjects;
  final List<AgMonthlyTrackingPoint> monthlyMeetings;
  final List<AgMonthlyTrackingPoint> monthlyTrf;
  final double averageCitationScore;
  final AgCitationClubRow? topScoringClub;
  final List<AgAwardStatus> awardStatus;
  final bool awardStatusIsPending;
  const AgExcellenceResponse({
    required this.ag,
    required this.citation,
    required this.goals,
    required this.monthlyProjects,
    required this.monthlyMeetings,
    required this.monthlyTrf,
    required this.averageCitationScore,
    required this.topScoringClub,
    required this.awardStatus,
    required this.awardStatusIsPending,
  });
  factory AgExcellenceResponse.fromJson(Map<String, dynamic> j) {
    final top = j['topScoringClub'];
    return AgExcellenceResponse(
      ag: AgIdentity.of(j),
      citation: _list(j['citation']).map(AgCitationClubRow.fromJson).toList(),
      goals: _list(j['goals']).map(AgGoalsClubRow.fromJson).toList(),
      monthlyProjects: _list(j['monthlyProjects'])
          .map(AgMonthlyTrackingPoint.fromJson)
          .toList(),
      monthlyMeetings: _list(j['monthlyMeetings'])
          .map(AgMonthlyTrackingPoint.fromJson)
          .toList(),
      monthlyTrf:
          _list(j['monthlyTrf']).map(AgMonthlyTrackingPoint.fromJson).toList(),
      averageCitationScore: _d(j['averageCitationScore']),
      topScoringClub: top is Map
          ? AgCitationClubRow.fromJson(top.cast<String, dynamic>())
          : null,
      awardStatus: _list(j['awardStatus']).map(AgAwardStatus.fromJson).toList(),
      awardStatusIsPending: _b(j['awardStatusIsPending']),
    );
  }
}

// ── /district ────────────────────────────────────────────────────────────────

class AgDistrictClubRow {
  final int clubId;
  final String clubName;
  final int members;
  final int meetings;
  final int totalProjects;
  final double trfTotalInr;
  final int ocv;
  final int projectRank;
  final int vocationalService;
  final int internationalService;
  final int newGenerationService;
  const AgDistrictClubRow({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.meetings,
    required this.totalProjects,
    required this.trfTotalInr,
    required this.ocv,
    required this.projectRank,
    required this.vocationalService,
    required this.internationalService,
    required this.newGenerationService,
  });
  factory AgDistrictClubRow.fromJson(Map<String, dynamic> j) =>
      AgDistrictClubRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        meetings: _i(j['meetings']),
        totalProjects: _i(j['totalProjects']),
        trfTotalInr: _d(j['trfTotalInr']),
        ocv: _i(j['ocv']),
        projectRank: _i(j['projectRank']),
        vocationalService: _i(j['vocationalService']),
        internationalService: _i(j['internationalService']),
        newGenerationService: _i(j['newGenerationService']),
      );
}

class AgHeadToHeadRow {
  final int clubId;
  final String clubName;
  final int members;
  final int meetings;
  final int totalProjects;
  final double trfInr;
  final double dck; // citation total
  final int? nationalRank; // always null for now
  final bool nationalRankIsPending; // always true for now
  final int vocationalService;
  final int internationalService;
  final int newGenerationService;
  const AgHeadToHeadRow({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.meetings,
    required this.totalProjects,
    required this.trfInr,
    required this.dck,
    required this.nationalRank,
    required this.nationalRankIsPending,
    required this.vocationalService,
    required this.internationalService,
    required this.newGenerationService,
  });
  factory AgHeadToHeadRow.fromJson(Map<String, dynamic> j) => AgHeadToHeadRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        meetings: _i(j['meetings']),
        totalProjects: _i(j['totalProjects']),
        trfInr: _d(j['trfInr']),
        dck: _d(j['dck']),
        nationalRank: _inI(j['nationalRank']),
        nationalRankIsPending: _b(j['nationalRankIsPending']),
        vocationalService: _i(j['vocationalService']),
        internationalService: _i(j['internationalService']),
        newGenerationService: _i(j['newGenerationService']),
      );
}

class AgMetricBars {
  final Map<String, int> membersPerClub;
  final Map<String, int> projectsPerClub;
  final Map<String, double> trfPerClub;
  final Map<String, int> meetingsPerClub;
  const AgMetricBars({
    required this.membersPerClub,
    required this.projectsPerClub,
    required this.trfPerClub,
    required this.meetingsPerClub,
  });
  factory AgMetricBars.fromJson(Map<String, dynamic> j) => AgMetricBars(
        membersPerClub: _intMap(j['membersPerClub']),
        projectsPerClub: _intMap(j['projectsPerClub']),
        trfPerClub: _doubleMap(j['trfPerClub']),
        meetingsPerClub: _intMap(j['meetingsPerClub']),
      );
  static const empty = AgMetricBars(
      membersPerClub: {},
      projectsPerClub: {},
      trfPerClub: {},
      meetingsPerClub: {});
}

class AgRadarPoint {
  final int clubId;
  final String clubName;
  final int members;
  final int projects;
  final double trfInr;
  final double goalsScore;
  const AgRadarPoint({
    required this.clubId,
    required this.clubName,
    required this.members,
    required this.projects,
    required this.trfInr,
    required this.goalsScore,
  });
  factory AgRadarPoint.fromJson(Map<String, dynamic> j) => AgRadarPoint(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        members: _i(j['members']),
        projects: _i(j['projects']),
        trfInr: _d(j['trfInr']),
        goalsScore: _d(j['goalsScore']),
      );
}

class AgDistrictResponse {
  final AgIdentity ag;
  final List<AgDistrictClubRow> clubs;
  final int totalMembers;
  final int totalMeetings;
  final int totalProjects;
  final double totalTrfInr;
  final List<AgHeadToHeadRow> headToHeadTable;
  final AgMetricBars metricBars;
  final List<AgRadarPoint> radar;
  const AgDistrictResponse({
    required this.ag,
    required this.clubs,
    required this.totalMembers,
    required this.totalMeetings,
    required this.totalProjects,
    required this.totalTrfInr,
    required this.headToHeadTable,
    required this.metricBars,
    required this.radar,
  });
  factory AgDistrictResponse.fromJson(Map<String, dynamic> j) =>
      AgDistrictResponse(
        ag: AgIdentity.of(j),
        clubs: _list(j['clubs']).map(AgDistrictClubRow.fromJson).toList(),
        totalMembers: _i(j['totalMembers']),
        totalMeetings: _i(j['totalMeetings']),
        totalProjects: _i(j['totalProjects']),
        totalTrfInr: _d(j['totalTrfInr']),
        headToHeadTable:
            _list(j['headToHeadTable']).map(AgHeadToHeadRow.fromJson).toList(),
        metricBars: AgMetricBars.fromJson(
            (j['metricBars'] as Map?)?.cast<String, dynamic>() ?? const {}),
        radar: _list(j['radar']).map(AgRadarPoint.fromJson).toList(),
      );
}

// ── stable per-club colour palette (matches web CLUB_PALETTE) ─────────────────
const kAgPalette = <int>[
  0xFF003DA5,
  0xFFF7A81B,
  0xFF10B981,
  0xFFEF4444,
  0xFF7C3AED,
  0xFF0EA5E9,
  0xFFF59E0B,
  0xFFEC4899,
];
int agClubColor(int i) => kAgPalette[i % kAgPalette.length];

/// Models for the live Club Admin Dashboard API
/// (`api/mobile/club-admin-dashboard/*`, commit 5c505d3).
///
/// These map the camelCase JSON responses onto the EXISTING Club Overview
/// view models (`club_overview_models.dart`) so the dashboard tab widgets can
/// render real data with no change to their layout code.
///
/// Conventions confirmed against the backend DTOs:
///  • all JSON property names are camelCase;
///  • percent fields are 0–100;
///  • TRF / foundation amounts are USD (stored and served in USD, no conversion);
///  • date fields are `"yyyy-MM-dd"` strings (or null / "").
library;

import 'dart:math' as math;
import '../../core/brand/brand.dart';
import 'club_overview_models.dart';

// ── primitive parsers ──────────────────────────────────────────────────────

int _i(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse('${v ?? ''}') ?? 0;
}

double _d(dynamic v) {
  if (v is num) return v.toDouble();
  return double.tryParse('${v ?? ''}') ?? 0.0;
}

bool _b(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = '${v ?? ''}'.toLowerCase();
  return s == 'true' || s == '1';
}

String _s(dynamic v) => v?.toString() ?? '';
String? _sn(dynamic v) {
  final s = v?.toString();
  return (s == null || s.isEmpty) ? null : s;
}

List<Map<String, dynamic>> _list(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
    : const [];

String _initialsOf(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
  if (parts.isEmpty) return '';
  final letters = parts.map((p) => p[0]).join();
  return letters
      .substring(0, letters.length > 2 ? 2 : letters.length)
      .toUpperCase();
}

// Stable avatar palette (mirrors the mock palette used by the membership tab).
const List<int> _palette = [
  0xFF003DA5, 0xFF16A34A, 0xFFCA8A04, 0xFF9333EA, 0xFF0891B2,
  0xFFE11D48, 0xFFF59E0B, 0xFF64748B, 0xFFB45309, 0xFF0F172A, 0xFF7C3AED,
];

// Per-avenue colour + goal. The `/overview` avenue rows carry only
// `{ avenue, completed }`; colour and a display goal are assigned client-side
// (matching the prior mock) so the existing progress bars still render.
({int color, int target}) _avenueStyle(String name) {
  final n = name.toLowerCase();
  if (n.contains('club service')) return (color: 0xFF003DA5, target: 10);
  if (n.contains('community')) return (color: 0xFF16A34A, target: 10);
  if (n.contains('new generation')) return (color: 0xFFF59E0B, target: 10);
  if (n.contains('vocational')) return (color: 0xFF0891B2, target: 10);
  if (n.contains('public image')) return (color: 0xFFE11D48, target: 10);
  if (n.contains('international')) return (color: 0xFF9333EA, target: 10);
  return (color: 0xFF64748B, target: 10);
}

CitationStatus _citationStatus(double earned, double points) {
  if (points <= 0) return CitationStatus.partial;
  final r = earned / points;
  if (r >= 0.999) return CitationStatus.done;
  if (r >= 0.5) return CitationStatus.partial;
  return CitationStatus.incomplete;
}

// ── Overview ────────────────────────────────────────────────────────────────

/// Parsed `GET /overview` response, exposed as the existing view-model types
/// plus a few derived metrics the Overview tab needs.
class ClubAdminOverview {
  final String clubName;
  final String yearLabel;

  // identity status (from the embedded `club` object) — drives the Overview
  // status-alerts strip with real per-club values.
  final bool rotaryOrgSyncEnabled;
  final bool clubWebsiteActive;
  final DateTime? clubWebsiteExpiry;
  // available (unused, unexpired) communication credits — drive the Overview
  // credit chips. From the embedded `club` object.
  final int emailCreditBalance;

  // headline counts
  final int totalMembers;
  final int activeMembers;
  final int maleMembers;
  final int femaleMembers;
  final int honoraryMembers;
  final int newMembersThisYear;
  final int terminatedThisYear;
  final double avgAttendance; // %

  // TRF (USD)
  final double trfRaisedInr;
  final double trfGoalInr;
  final double trfAnnualFundInr;
  final double trfPolioFundInr;
  final double trfEndowmentInr;
  final int trfMajorDonors;
  final int phfContributors;

  // service / citation
  final int serviceProjects;
  final int serviceGoal;
  final double districtCitationScore;

  // lists (mapped to existing view-model types)
  final List<AvenueDatum> avenues;
  final List<CitationItem> citation;
  final List<MemberGrowthPoint> growth;
  final List<ClubEvent> events;

  const ClubAdminOverview({
    required this.clubName,
    required this.yearLabel,
    this.rotaryOrgSyncEnabled = false,
    this.clubWebsiteActive = false,
    this.clubWebsiteExpiry,
    this.emailCreditBalance = 0,
    required this.totalMembers,
    required this.activeMembers,
    required this.maleMembers,
    required this.femaleMembers,
    required this.honoraryMembers,
    required this.newMembersThisYear,
    required this.terminatedThisYear,
    required this.avgAttendance,
    required this.trfRaisedInr,
    required this.trfGoalInr,
    required this.trfAnnualFundInr,
    required this.trfPolioFundInr,
    required this.trfEndowmentInr,
    required this.trfMajorDonors,
    required this.phfContributors,
    required this.serviceProjects,
    required this.serviceGoal,
    required this.districtCitationScore,
    required this.avenues,
    required this.citation,
    required this.growth,
    required this.events,
  });

  factory ClubAdminOverview.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};

    final avenues = _list(j['avenues']).map((a) {
      final name = _s(a['avenue']);
      final style = _avenueStyle(name);
      return AvenueDatum(
        name: name,
        completed: _i(a['completed']),
        target: style.target,
        colorArgb: style.color,
        beneficiaries: 0,
      );
    }).toList();

    final citation = _list(j['citationChecklist']).map((c) {
      final earned = _d(c['earned']);
      final rawMax = _d(c['maxPoints']);
      // The server currently returns maxPoints = 0; fall back to a nominal 10
      // per criterion so the existing earned/points bars still render.
      final points = rawMax > 0 ? rawMax : 10.0;
      return CitationItem(
        criterion: _s(c['criterion']),
        points: points.round(),
        earned: earned.round(),
        detail: '',
        status: _citationStatus(earned, points),
      );
    }).toList();

    final growth = _list(j['memberGrowth']).map((g) {
      final male = _i(g['male']);
      final female = _i(g['female']);
      final honorary = _i(g['honorary']);
      return MemberGrowthPoint(
        month: _s(g['month']),
        members: male + female + honorary,
        male: male,
        female: female,
        honorary: honorary,
      );
    }).toList();

    final events = _list(j['upcomingEvents']).map((e) {
      return ClubEvent(
        id: 0,
        name: _s(e['title']),
        date: _s(e['date']), // "yyyy-MM-dd" or ""
        time: '',
        venue: _s(e['location']),
        type: _s(e['type']).isEmpty ? 'Event' : _s(e['type']),
      );
    }).toList();

    return ClubAdminOverview(
      clubName: _s(club['clubName']),
      yearLabel: _s(club['yearLabel']),
      rotaryOrgSyncEnabled: _b(club['rotaryOrgSyncEnabled']),
      clubWebsiteActive: _b(club['clubWebsiteActive']),
      clubWebsiteExpiry: DateTime.tryParse(_s(club['clubWebsiteExpiry'])),
      emailCreditBalance: _i(club['emailCreditBalance']),
      totalMembers: _i(j['totalMembers']),
      activeMembers: _i(j['activeMembers']),
      maleMembers: _i(j['maleMembers']),
      femaleMembers: _i(j['femaleMembers']),
      honoraryMembers: _i(j['honoraryMembers']),
      newMembersThisYear: _i(j['newMembersThisYear']),
      terminatedThisYear: _i(j['terminatedThisYear']),
      avgAttendance: _d(j['avgAttendance']),
      trfRaisedInr: _d(j['trfRaisedInr']),
      trfGoalInr: _d(j['trfGoalInr']),
      trfAnnualFundInr: _d(j['trfAnnualFund']),
      trfPolioFundInr: _d(j['trfPolioFund']),
      trfEndowmentInr: _d(j['trfEndowment']),
      trfMajorDonors: _i(j['trfMajorDonors']),
      phfContributors: _i(j['phfContributors']),
      serviceProjects: _i(j['serviceProjects']),
      serviceGoal: _i(j['serviceGoal']),
      districtCitationScore: _d(j['districtCitationScore']),
      avenues: avenues,
      citation: citation,
      growth: growth,
      events: events,
    );
  }

  // ── derived metrics (guard divide-by-zero) ─────────────────────────────

  /// TRF raised as a % of goal; 0 when the goal is unset (server sends 0).
  int get trfPct =>
      trfGoalInr > 0 ? ((trfRaisedInr / trfGoalInr) * 100).round() : 0;

  /// Remaining to TRF goal (never negative); 0 when no goal is set.
  int get trfRemaining =>
      trfGoalInr > 0 ? (trfGoalInr - trfRaisedInr).round().clamp(0, 1 << 31) : 0;

  bool get hasTrfGoal => trfGoalInr > 0;

  int get _citationEarned =>
      citation.fold(0, (s, c) => s + c.earned);
  int get _citationPoints =>
      citation.fold(0, (s, c) => s + c.points);

  /// Citation completion % across criteria (earned / points). 0 when empty.
  int get citationPct => _citationPoints > 0
      ? ((_citationEarned / _citationPoints) * 100).round()
      : 0;

  int get avenueTotalCompleted =>
      avenues.fold(0, (s, a) => s + a.completed);

  /// Builds the legacy [ClubStats] shape the Overview tab widgets read from.
  ClubStats get stats => ClubStats(
        totalMembers: totalMembers,
        activeMembers: activeMembers,
        fullMembers: totalMembers - honoraryMembers,
        associateMembers: 0,
        honoraryMembers: honoraryMembers,
        newMembersThisYear: newMembersThisYear,
        terminatedThisYear: terminatedThisYear,
        avgAttendance: avgAttendance,
        trfRaised: trfRaisedInr.round(),
        trfGoal: trfGoalInr.round(),
        trfAnnualFund: trfAnnualFundInr.round(),
        trfMajorDonors: trfMajorDonors,
        phfContributors: phfContributors,
        trfPhsm: 0,
        trfEPF: 0,
        trfEndowment: trfEndowmentInr.round(),
        serviceProjects: serviceProjects,
        districtCitationScore: districtCitationScore.round(),
        districtCitationMax: 0,
        reportsSubmitted: 0,
        reportsTotal: 0,
      );
}

// ── Directory ───────────────────────────────────────────────────────────────

/// Parsed `GET /dashboard-directory` response.
class ClubAdminDirectory {
  final String clubName;
  final int totalMembers;
  final int fullMembers;
  final int honoraryMembers;
  final int maleMembers;
  final int femaleMembers;
  final int clubAdminsCount;
  final List<ClubMember> members;

  const ClubAdminDirectory({
    required this.clubName,
    required this.totalMembers,
    required this.fullMembers,
    required this.honoraryMembers,
    this.maleMembers = 0,
    this.femaleMembers = 0,
    required this.clubAdminsCount,
    required this.members,
  });

  factory ClubAdminDirectory.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final members = _list(j['members']).map((m) {
      final isHonorary = m['isHonorary'] == true;
      return ClubMember(
        id: _i(m['memberId']),
        name: _s(m['name']),
        designation: _s(m['designation']),
        mobile: _s(m['mobile']),
        email: _s(m['email']),
        type: isHonorary ? 'Honorary' : 'Full',
        since: 0,
        status: 'Active',
        isAdmin: m['isClubAdmin'] == true,
        isRIAdmin: false,
      );
    }).toList();
    return ClubAdminDirectory(
      clubName: _s(club['clubName']),
      totalMembers: _i(j['totalMembers']),
      fullMembers: _i(j['fullMembers']),
      honoraryMembers: _i(j['honoraryMembers']),
      maleMembers: _i(j['maleMembers']),
      femaleMembers: _i(j['femaleMembers']),
      clubAdminsCount: _i(j['clubAdminsCount']),
      members: members,
    );
  }
}

// ── Board of Directors ───────────────────────────────────────────────────────

class ClubBodYear {
  final int id;
  final String label;
  final bool isCurrent;
  const ClubBodYear(
      {required this.id, required this.label, required this.isCurrent});
}

/// A board-director row from `/dashboard-bod` — a superset of the legacy
/// [BoardDirector] view-model carrying the ids the edit form needs
/// (`memberId`, `designationId`, `photoPath`).
class BodDirectorRow {
  final int id;
  final int sr;
  final String name;
  final String designation;
  final int? designationId;
  final String mobile;
  final String email;
  final String? photoPath;
  final int memberId;
  // A non-member entry (past-year only) has no member profile: memberId is 0
  // and name/mobile/email carry the free-text values. Drives the "Non-Member"
  // tag and how the edit form is pre-filled.
  final bool isMember;
  final String initials;
  final int colorArgb;
  const BodDirectorRow({
    required this.id,
    required this.sr,
    required this.name,
    required this.designation,
    required this.designationId,
    required this.mobile,
    required this.email,
    required this.photoPath,
    required this.memberId,
    required this.isMember,
    required this.initials,
    required this.colorArgb,
  });
}

/// Parsed `GET /dashboard-bod` response.
class ClubAdminBod {
  final String clubName;
  final int boardMembers;
  final int executiveRoles;
  final int serviceChairs;
  final int growthOutreach;
  final String selectedYearLabel;
  final int? selectedYearId;
  final List<ClubBodYear> availableYears;
  final List<BodDirectorRow> directors;

  const ClubAdminBod({
    required this.clubName,
    required this.boardMembers,
    required this.executiveRoles,
    required this.serviceChairs,
    required this.growthOutreach,
    required this.selectedYearLabel,
    required this.selectedYearId,
    required this.availableYears,
    required this.directors,
  });

  factory ClubAdminBod.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final years = _list(j['availableYears'])
        .map((y) => ClubBodYear(
              id: _i(y['id']),
              label: _s(y['yearLabel']),
              isCurrent: y['isCurrent'] == true,
            ))
        .toList();
    final rows = _list(j['directors']);
    final directors = <BodDirectorRow>[];
    for (var k = 0; k < rows.length; k++) {
      final d = rows[k];
      final name = _s(d['name']);
      directors.add(BodDirectorRow(
        id: _i(d['id']),
        sr: d['sr'] == null ? k + 1 : _i(d['sr']),
        name: name,
        designation: _s(d['designation']),
        designationId: d['designationId'] == null ? null : _i(d['designationId']),
        mobile: _sn(d['mobile']) ?? '',
        email: _sn(d['email']) ?? '',
        photoPath: _sn(d['photoPath']),
        memberId: _i(d['memberId']),
        isMember: d['isMember'] == true || d['isMember'] == 1,
        initials: _initialsOf(name),
        colorArgb: _palette[k % _palette.length],
      ));
    }
    return ClubAdminBod(
      clubName: _s(club['clubName']),
      boardMembers: _i(j['boardMembers']),
      executiveRoles: _i(j['executiveRoles']),
      serviceChairs: _i(j['serviceChairs']),
      growthOutreach: _i(j['growthOutreach']),
      selectedYearLabel: _s(j['selectedYearLabel']),
      selectedYearId: j['selectedYearId'] == null ? null : _i(j['selectedYearId']),
      availableYears: years,
      directors: directors,
    );
  }
}

// ── Membership (full page) ───────────────────────────────────────────────────

/// One member row from `/membership` (members[] and recentJoiners[]).
class MembershipMemberRow {
  final int memberId;
  final String name;
  final String? email;
  final String? mobile;
  final String? gender;
  final String? rotaryId;
  final String? joinedDate;
  const MembershipMemberRow({
    required this.memberId,
    required this.name,
    required this.email,
    required this.mobile,
    required this.gender,
    required this.rotaryId,
    required this.joinedDate,
  });

  factory MembershipMemberRow.fromJson(Map<String, dynamic> j) =>
      MembershipMemberRow(
        memberId: _i(j['memberId']),
        name: _s(j['name']),
        email: _sn(j['email']),
        mobile: _sn(j['mobile']),
        gender: _sn(j['gender']),
        rotaryId: _sn(j['rotaryId']),
        joinedDate: _sn(j['joinedDate']),
      );
}

/// Parsed `GET /membership` response — the full Membership page.
class ClubAdminMembership {
  final String clubName;
  final String yearLabel;
  final int totalMembers;
  final int maleMembers;
  final int femaleMembers;
  final int honoraryMembers;
  final int newMembersThisYear;
  final int terminatedThisYear;
  final List<MembershipMemberRow> members;
  final List<MembershipMemberRow> recentJoiners;
  final List<MemberGrowthPoint> monthlyTrend;

  const ClubAdminMembership({
    required this.clubName,
    required this.yearLabel,
    required this.totalMembers,
    required this.maleMembers,
    required this.femaleMembers,
    required this.honoraryMembers,
    required this.newMembersThisYear,
    required this.terminatedThisYear,
    required this.members,
    required this.recentJoiners,
    required this.monthlyTrend,
  });

  factory ClubAdminMembership.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final trend = _list(j['monthlyTrend']).map((g) {
      final male = _i(g['male']);
      final female = _i(g['female']);
      final honorary = _i(g['honorary']);
      return MemberGrowthPoint(
        month: _s(g['month']),
        members: male + female + honorary,
        male: male,
        female: female,
        honorary: honorary,
      );
    }).toList();
    return ClubAdminMembership(
      clubName: _s(club['clubName']),
      yearLabel: _s(club['yearLabel']),
      totalMembers: _i(j['totalMembers']),
      maleMembers: _i(j['maleMembers']),
      femaleMembers: _i(j['femaleMembers']),
      honoraryMembers: _i(j['honoraryMembers']),
      newMembersThisYear: _i(j['newMembersThisYear']),
      terminatedThisYear: _i(j['terminatedThisYear']),
      members:
          _list(j['members']).map(MembershipMemberRow.fromJson).toList(),
      recentJoiners:
          _list(j['recentJoiners']).map(MembershipMemberRow.fromJson).toList(),
      monthlyTrend: trend,
    );
  }
}

// ── Foundation (actuals) ─────────────────────────────────────────────────────

/// One per-fund total from the `metrics` array (`ClubAdminFundMetric`).
/// `value` is in the dashboard's display currency (USD; backend USD_INR = 1).
class ClubFundMetric {
  final String id;
  final String name;
  final double value;

  const ClubFundMetric({
    required this.id,
    required this.name,
    required this.value,
  });

  factory ClubFundMetric.fromJson(Map<String, dynamic> j) => ClubFundMetric(
        id: _s(j['id']),
        name: _s(j['name']),
        value: _d(j['value']),
      );
}

/// Parsed `GET /foundation` response — this club's actual fund collections
/// (USD). No national rank/average/benchmark data is provided by the API.
class ClubAdminFoundation {
  final String clubName;
  final String yearLabel;
  final double totalCollectedInr;
  final double annualFundInr;
  final double polioFundInr;
  final double endowmentInr;
  final double othersInr;
  final int majorDonors;

  /// Raw per-fund breakdown. Lets us split out buckets the top-level totals
  /// fold together (e.g. Global Grant is aggregated into `othersInr`).
  final List<ClubFundMetric> metrics;

  const ClubAdminFoundation({
    required this.clubName,
    required this.yearLabel,
    required this.totalCollectedInr,
    required this.annualFundInr,
    required this.polioFundInr,
    required this.endowmentInr,
    required this.othersInr,
    required this.majorDonors,
    this.metrics = const [],
  });

  factory ClubAdminFoundation.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ClubAdminFoundation(
      clubName: _s(club['clubName']),
      yearLabel: _s(club['yearLabel']),
      totalCollectedInr: _d(j['totalCollectedInr']),
      annualFundInr: _d(j['annualFundInr']),
      polioFundInr: _d(j['polioFundInr']),
      endowmentInr: _d(j['endowmentInr']),
      othersInr: _d(j['othersInr']),
      majorDonors: _i(j['majorDonors']),
      metrics: _list(j['metrics']).map(ClubFundMetric.fromJson).toList(),
    );
  }

  /// Global Grant total, split out of the `metrics` array. The backend folds
  /// Global Grant into `othersInr` (no keyword match), so it can only be
  /// recovered here — mirrors the web's per-fund card.
  double get globalGrantInr {
    var g = 0.0;
    for (final m in metrics) {
      final l = m.name.toLowerCase();
      if (l.contains('global') || l.contains('grant')) g += m.value;
    }
    return g;
  }

  /// Web-style leftover "Other funds" — everything that isn't Annual / Polio /
  /// Endowment / Global Grant. The top-level `othersInr` still includes Global
  /// Grant, so we recompute from `metrics` (falling back to `othersInr` when
  /// the array is absent).
  double get otherFundsInr {
    if (metrics.isEmpty) return othersInr;
    var o = 0.0;
    for (final m in metrics) {
      final l = m.name.toLowerCase();
      if (l.contains('annual') ||
          l.contains('polio') ||
          l.contains('endowment') ||
          l.contains('global') ||
          l.contains('grant')) {
        continue;
      }
      o += m.value;
    }
    return o;
  }
}

// ── Foundation Collection Goals (persisted) ──────────────────────────────────

/// One club's saved Foundation goal for a year (`FoundationGoalDto`).
class FoundationGoal {
  final int? goalId; // null when no goal saved yet
  final int yearId;
  final String yearLabel;
  final double apfGoal;
  final double polioPlusGoal;
  final double endowmentFundGoal;
  final double otherGoal;
  final String currency;
  final String? remarks;
  final bool isEditable; // false for past years
  final bool isCurrent;
  final String? updatedDate;
  final String? updatedBy;

  const FoundationGoal({
    required this.goalId,
    required this.yearId,
    required this.yearLabel,
    required this.apfGoal,
    required this.polioPlusGoal,
    required this.endowmentFundGoal,
    required this.otherGoal,
    required this.currency,
    required this.remarks,
    required this.isEditable,
    required this.isCurrent,
    required this.updatedDate,
    required this.updatedBy,
  });

  bool get hasGoal => goalId != null;
  double get totalGoal =>
      apfGoal + polioPlusGoal + endowmentFundGoal + otherGoal;

  factory FoundationGoal.fromJson(Map<String, dynamic> j) => FoundationGoal(
        goalId: j['goalId'] == null ? null : _i(j['goalId']),
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        apfGoal: _d(j['apfGoal']),
        polioPlusGoal: _d(j['polioPlusGoal']),
        endowmentFundGoal: _d(j['endowmentFundGoal']),
        otherGoal: _d(j['otherGoal']),
        currency: _s(j['currency']).isEmpty ? Brand.current.defaultCurrency : _s(j['currency']),
        remarks: _sn(j['remarks']),
        isEditable: j['isEditable'] == true,
        isCurrent: j['isCurrent'] == true,
        updatedDate: _sn(j['updatedDate']),
        updatedBy: _sn(j['updatedBy']),
      );
}

/// A year option in the goals year dropdown (`FoundationGoalYearRow`).
class FoundationGoalYear {
  final int yearId;
  final String yearLabel;
  final bool isCurrent;
  final bool isEditable;
  final bool hasGoal;
  final double totalGoal;
  const FoundationGoalYear({
    required this.yearId,
    required this.yearLabel,
    required this.isCurrent,
    required this.isEditable,
    required this.hasGoal,
    required this.totalGoal,
  });

  factory FoundationGoalYear.fromJson(Map<String, dynamic> j) =>
      FoundationGoalYear(
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        isCurrent: j['isCurrent'] == true,
        isEditable: j['isEditable'] == true,
        hasGoal: j['hasGoal'] == true,
        totalGoal: _d(j['totalGoal']),
      );
}

/// Parsed `GET /club-foundation-goals/list` response.
class FoundationGoalList {
  final String clubName;
  final FoundationGoal? currentSelection;
  final List<FoundationGoalYear> years;

  const FoundationGoalList({
    required this.clubName,
    required this.currentSelection,
    required this.years,
  });

  factory FoundationGoalList.fromJson(Map<String, dynamic> j) {
    final sel = (j['currentSelection'] as Map?)?.cast<String, dynamic>();
    return FoundationGoalList(
      clubName: _s(j['clubName']),
      currentSelection: sel == null ? null : FoundationGoal.fromJson(sel),
      years: _list(j['years']).map(FoundationGoalYear.fromJson).toList(),
    );
  }
}

// ── Service Projects (avenue of service) ─────────────────────────────────────

/// A generic rotary-year option ({id, yearLabel, isCurrent}).
class DashYear {
  final int id;
  final String label;
  final bool isCurrent;
  const DashYear({required this.id, required this.label, required this.isCurrent});

  factory DashYear.fromJson(Map<String, dynamic> j) => DashYear(
        id: _i(j['id']),
        label: _s(j['yearLabel']),
        isCurrent: j['isCurrent'] == true,
      );
}

/// Response of `GET …/club-admin-dashboard/available-years` — the data-bearing
/// rotary years for the global dashboard year selector.
class ClubAdminAvailableYears {
  final int clubId;
  final int? currentYearId;
  final String currentYearLabel;
  final List<DashYear> years;
  const ClubAdminAvailableYears({
    this.clubId = 0,
    this.currentYearId,
    this.currentYearLabel = '',
    this.years = const [],
  });

  factory ClubAdminAvailableYears.fromJson(Map<String, dynamic> j) =>
      ClubAdminAvailableYears(
        clubId: _i(j['clubId']),
        currentYearId:
            j['currentYearId'] == null ? null : _i(j['currentYearId']),
        currentYearLabel: _s(j['currentYearLabel']),
        years: _list(j['years']).map((e) => DashYear.fromJson(e)).toList(),
      );
}

/// One of the 7 avenue rows in the overview summary.
class SpAvenueSummary {
  final String avenueKey;
  final String avenueName;
  final int projects;
  final int beneficiaries;
  final double cost;
  final int manHours;
  const SpAvenueSummary({
    required this.avenueKey,
    required this.avenueName,
    required this.projects,
    required this.beneficiaries,
    required this.cost,
    required this.manHours,
  });

  factory SpAvenueSummary.fromJson(Map<String, dynamic> j) => SpAvenueSummary(
        avenueKey: _s(j['avenueKey']),
        avenueName: _s(j['avenueName']),
        projects: _i(j['projects']),
        beneficiaries: _i(j['beneficiaries']),
        cost: _d(j['cost']),
        manHours: _i(j['manHours']),
      );
}

/// Parsed `GET /service-projects-overview` response.
class ServiceProjectsOverview {
  final String selectedYearLabel;
  final int? selectedYearId;
  final List<DashYear> years;
  final int totalProjects;
  final int totalBeneficiaries;
  final double totalCost;
  final int totalManHours;
  final int meetingsHeld;
  // Currency the totalCost KPI and per-avenue Cost subtotals are expressed in
  // (the club's district default). Per-project rows keep their own currency.
  final String targetCurrency;
  final List<SpAvenueSummary> avenues;

  const ServiceProjectsOverview({
    required this.selectedYearLabel,
    required this.selectedYearId,
    required this.years,
    required this.totalProjects,
    required this.totalBeneficiaries,
    required this.totalCost,
    required this.totalManHours,
    required this.meetingsHeld,
    required this.targetCurrency,
    required this.avenues,
  });

  factory ServiceProjectsOverview.fromJson(Map<String, dynamic> j) {
    final kpis = (j['kpis'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ServiceProjectsOverview(
      selectedYearLabel: _s(j['selectedYearLabel']),
      selectedYearId:
          j['selectedYearId'] == null ? null : _i(j['selectedYearId']),
      years: _list(j['availableYears']).map(DashYear.fromJson).toList(),
      totalProjects: _i(kpis['totalProjects']),
      totalBeneficiaries: _i(kpis['totalBeneficiaries']),
      totalCost: _d(kpis['totalCost']),
      totalManHours: _i(kpis['totalManHours']),
      meetingsHeld: _i(kpis['meetingsHeld']),
      targetCurrency:
          _s(j['targetCurrency']).isEmpty ? Brand.current.defaultCurrency : _s(j['targetCurrency']),
      avenues: _list(j['avenues']).map(SpAvenueSummary.fromJson).toList(),
    );
  }
}

/// Per-avenue KPIs — fields populated depend on the avenue type (club service
/// vs the rest). All nullable.
class SpAvenueKpis {
  final int? projects;
  final int? beneficiaries;
  final double? amountSpent;
  final int? manHours;
  final int? meetingsHeld;
  final double? avgAttendancePercent;
  final double? avgAttendanceStayedPercent;
  final int? membersOnRoll;
  const SpAvenueKpis({
    required this.projects,
    required this.beneficiaries,
    required this.amountSpent,
    required this.manHours,
    required this.meetingsHeld,
    required this.avgAttendancePercent,
    required this.avgAttendanceStayedPercent,
    required this.membersOnRoll,
  });

  static double? _dn(dynamic v) => v == null ? null : _d(v);
  static int? _in(dynamic v) => v == null ? null : _i(v);

  factory SpAvenueKpis.fromJson(Map<String, dynamic> j) => SpAvenueKpis(
        projects: _in(j['projects']),
        beneficiaries: _in(j['beneficiaries']),
        amountSpent: _dn(j['amountSpent']),
        manHours: _in(j['manHours']),
        meetingsHeld: _in(j['meetingsHeld']),
        avgAttendancePercent: _dn(j['avgAttendancePercent']),
        avgAttendanceStayedPercent: _dn(j['avgAttendanceStayedPercent']),
        membersOnRoll: _in(j['membersOnRoll']),
      );
}

class SpMeeting {
  final int id;
  final int sr;
  final String date;
  final String meetingType;
  final String title;
  final int attendance;
  final int membersOnRoll;
  final double attendancePercent;
  const SpMeeting({
    required this.id,
    required this.sr,
    required this.date,
    required this.meetingType,
    required this.title,
    required this.attendance,
    required this.membersOnRoll,
    required this.attendancePercent,
  });

  factory SpMeeting.fromJson(Map<String, dynamic> j) => SpMeeting(
        id: _i(j['id']),
        sr: _i(j['sr']),
        date: _s(j['date']),
        meetingType: _s(j['meetingType']),
        title: _s(j['title']),
        attendance: _i(j['attendance']),
        membersOnRoll: _i(j['membersOnRoll']),
        attendancePercent: _d(j['attendancePercent']),
      );
}

class SpProject {
  final int id;
  final int sr;
  final String date;
  final String title;
  final String type; // One-time | Recurring | Annual | Ongoing
  final double cost;
  final String currency; // the project's own currency — the row shows cost in this
  final int beneficiaries;
  final int manHours;
  final bool isJoint;
  final String? coHostName;
  const SpProject({
    required this.id,
    required this.sr,
    required this.date,
    required this.title,
    required this.type,
    required this.cost,
    required this.currency,
    required this.beneficiaries,
    required this.manHours,
    required this.isJoint,
    required this.coHostName,
  });

  factory SpProject.fromJson(Map<String, dynamic> j) => SpProject(
        id: _i(j['id']),
        sr: _i(j['sr']),
        date: _s(j['date']),
        title: _s(j['title']),
        type: _s(j['type']),
        cost: _d(j['cost']),
        currency: _s(j['currency']).isEmpty ? Brand.current.defaultCurrency : _s(j['currency']),
        beneficiaries: _i(j['directBeneficiaries']),
        manHours: _i(j['manHours']),
        isJoint: j['isJointProject'] == true,
        coHostName: _sn(j['coHostName']),
      );
}

/// Parsed `GET /service-projects-avenue?avenueKey=` response.
class ServiceProjectsAvenueDetail {
  final String avenueKey;
  final String avenueName;
  final String selectedYearLabel;
  final int? selectedYearId;
  final List<DashYear> years;
  final SpAvenueKpis kpis;
  // Currency the AmountSpent KPI is expressed in (the club's district default).
  // Per-project rows keep their own currency.
  final String targetCurrency;
  final List<SpMeeting> meetings;
  final List<SpProject> oneTimeProjects;
  final List<SpProject> ongoingProjects;

  const ServiceProjectsAvenueDetail({
    required this.avenueKey,
    required this.avenueName,
    required this.selectedYearLabel,
    required this.selectedYearId,
    required this.years,
    required this.kpis,
    required this.targetCurrency,
    required this.meetings,
    required this.oneTimeProjects,
    required this.ongoingProjects,
  });

  bool get isClubService => avenueKey == 'club_service';

  factory ServiceProjectsAvenueDetail.fromJson(Map<String, dynamic> j) =>
      ServiceProjectsAvenueDetail(
        avenueKey: _s(j['avenueKey']),
        avenueName: _s(j['avenueName']),
        selectedYearLabel: _s(j['selectedYearLabel']),
        selectedYearId:
            j['selectedYearId'] == null ? null : _i(j['selectedYearId']),
        years: _list(j['availableYears']).map(DashYear.fromJson).toList(),
        targetCurrency:
            _s(j['targetCurrency']).isEmpty ? Brand.current.defaultCurrency : _s(j['targetCurrency']),
        kpis: SpAvenueKpis.fromJson(
            (j['kpis'] as Map?)?.cast<String, dynamic>() ?? const {}),
        meetings: _list(j['meetings']).map(SpMeeting.fromJson).toList(),
        oneTimeProjects:
            _list(j['oneTimeProjects']).map(SpProject.fromJson).toList(),
        ongoingProjects:
            _list(j['ongoingProjects']).map(SpProject.fromJson).toList(),
      );
}

// ── E-Governance ─────────────────────────────────────────────────────────────

/// One month's Club Monthly Report row (`ClubAdminCmrRow`). The API is
/// 2-state (submitted vs not) — there is no "in progress" / on-time signal.
class EgovCmrRow {
  final String month; // raw DB ReportMonth label
  final bool submitted;
  final String? submittedDate; // "yyyy-MM-dd" or null
  const EgovCmrRow({
    required this.month,
    required this.submitted,
    required this.submittedDate,
  });

  factory EgovCmrRow.fromJson(Map<String, dynamic> j) => EgovCmrRow(
        month: _s(j['reportMonth']),
        submitted: j['isSubmitted'] == true,
        submittedDate: _sn(j['submittedDate']),
      );
}

/// One attendance/meeting session row (`ClubAdminAttendanceRow`).
class EgovMeetingRow {
  final String topic; // "" if none — render a "Meeting" fallback
  final String date;
  final int present;
  final int total;
  final int pct; // 0-100
  const EgovMeetingRow({
    required this.topic,
    required this.date,
    required this.present,
    required this.total,
    required this.pct,
  });

  factory EgovMeetingRow.fromJson(Map<String, dynamic> j) => EgovMeetingRow(
        topic: _s(j['topic']),
        date: _s(j['date']),
        present: _i(j['present']),
        total: _i(j['total']),
        pct: _d(j['pct']).round(),
      );
}

/// Parsed `GET /egovernance` response. Backs the Monthly-Report and Attendance
/// sections only (TRF / citation / documents / reports are not on this
/// endpoint). Not year-scoped (no availableYears).
class ClubAdminEGovernance {
  final String clubName;
  final String yearLabel;
  final List<EgovCmrRow> reports;
  final List<EgovMeetingRow> meetings;
  final int cmrSubmitted;
  final int cmrPending;
  final double avgAttendance; // percent 0-100
  final int meetingsHeld;

  const ClubAdminEGovernance({
    required this.clubName,
    required this.yearLabel,
    required this.reports,
    required this.meetings,
    required this.cmrSubmitted,
    required this.cmrPending,
    required this.avgAttendance,
    required this.meetingsHeld,
  });

  int get cmrTotal => reports.length;
  int get cmrPct => cmrTotal > 0 ? ((cmrSubmitted / cmrTotal) * 100).round() : 0;

  factory ClubAdminEGovernance.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ClubAdminEGovernance(
      clubName: _s(club['clubName']),
      yearLabel: _s(club['yearLabel']),
      reports: _list(j['clubMonthlyReports']).map(EgovCmrRow.fromJson).toList(),
      meetings:
          _list(j['recentMeetings']).map(EgovMeetingRow.fromJson).toList(),
      cmrSubmitted: _i(j['cmrSubmitted']),
      cmrPending: _i(j['cmrPending']),
      avgAttendance: _d(j['avgAttendance']),
      meetingsHeld: _i(j['meetingsHeld']),
    );
  }
}

// ── Communication ────────────────────────────────────────────────────────────

/// Parsed `GET /communication` response. Backs counts + 3 item lists
/// (announcements / newsletters / upcoming events), mapped onto the existing
/// view-model types. No greetings or generic documents on this endpoint.
/// A communication list item (event / announcement / newsletter).
class CommItem {
  final String title;
  final String? date; // "yyyy-MM-dd" or null
  final String? description;
  final String? imagePath;
  const CommItem({
    required this.title,
    required this.date,
    required this.description,
    required this.imagePath,
  });

  factory CommItem.fromJson(Map<String, dynamic> j) => CommItem(
        title: _s(j['title']),
        date: _sn(j['publishDate']),
        description: _sn(j['description']),
        imagePath: _sn(j['imagePath']),
      );
}

/// A birthday / anniversary row for the Communication "Greetings" card
/// (`birthdaysThisMonth[]` / `anniversariesThisMonth[]`).
class CommGreetingRow {
  final String name;
  final String? mobile;
  final String? date; // "yyyy-MM-dd" or null
  final String kind; // "birthday" | "anniversary"
  final int day; // day-of-month

  const CommGreetingRow({
    required this.name,
    required this.mobile,
    required this.date,
    required this.kind,
    required this.day,
  });

  bool get isAnniversary => kind.toLowerCase() == 'anniversary';

  factory CommGreetingRow.fromJson(Map<String, dynamic> j) => CommGreetingRow(
        name: _s(j['name']),
        mobile: _sn(j['mobile']),
        date: _sn(j['date']),
        kind: _s(j['kind']),
        day: _i(j['day']),
      );
}

class ClubAdminCommunication {
  final String clubName;
  final String yearLabel;
  final int announcementCount;
  final int newsletterCount;
  final int upcomingEventCount;
  final int documentCount;
  final int greetingsTodayCount;
  final List<CommItem> events;
  final List<CommItem> announcements;
  final List<CommItem> newsletters;
  final List<CommItem> documents;
  final List<CommGreetingRow> birthdaysThisMonth;
  final List<CommGreetingRow> anniversariesThisMonth;

  const ClubAdminCommunication({
    required this.clubName,
    required this.yearLabel,
    required this.announcementCount,
    required this.newsletterCount,
    required this.upcomingEventCount,
    this.documentCount = 0,
    this.greetingsTodayCount = 0,
    required this.events,
    required this.announcements,
    required this.newsletters,
    this.documents = const [],
    this.birthdaysThisMonth = const [],
    this.anniversariesThisMonth = const [],
  });

  factory ClubAdminCommunication.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ClubAdminCommunication(
      clubName: _s(club['clubName']),
      yearLabel: _s(club['yearLabel']),
      announcementCount: _i(j['announcementCount']),
      newsletterCount: _i(j['newsletterCount']),
      upcomingEventCount: _i(j['upcomingEventCount']),
      documentCount: _i(j['documentCount']),
      greetingsTodayCount: _i(j['greetingsTodayCount']),
      events: _list(j['upcomingEvents']).map(CommItem.fromJson).toList(),
      announcements:
          _list(j['announcements']).map(CommItem.fromJson).toList(),
      newsletters: _list(j['newsletters']).map(CommItem.fromJson).toList(),
      documents: _list(j['documents']).map(CommItem.fromJson).toList(),
      birthdaysThisMonth: _list(j['birthdaysThisMonth'])
          .map(CommGreetingRow.fromJson)
          .toList(),
      anniversariesThisMonth: _list(j['anniversariesThisMonth'])
          .map(CommGreetingRow.fromJson)
          .toList(),
    );
  }
}

// ── Website ──────────────────────────────────────────────────────────────────

enum ClubWebsiteStatus { active, trial, trialExpired, expired, unknown }

ClubWebsiteStatus _websiteStatusFrom(String raw) {
  switch (raw.trim().toLowerCase()) {
    case 'active':
      return ClubWebsiteStatus.active;
    case 'trial':
      return ClubWebsiteStatus.trial;
    case 'trial_expired':
      return ClubWebsiteStatus.trialExpired;
    case 'expired':
      return ClubWebsiteStatus.expired;
    default:
      return ClubWebsiteStatus.unknown;
  }
}

/// Parsed `GET /website` response — a compact status/config snapshot. The
/// mock-only sections (ad slots, module editors, marketing hero, analytics) are
/// intentionally not modeled; they have no API source.
class ClubAdminWebsite {
  final String clubName;
  final String yearLabel;
  final bool configured;
  final String subdomain;
  final String? thirdPartyDomain;
  final String? visitUrl;
  final String statusRaw;
  final ClubWebsiteStatus status;
  final String? activatedDate;
  final String? expiryDate;
  final int menuCount;
  final int bannerCount;
  final int eventCount;
  final int announcementCount;
  final bool killSwitchOn;

  const ClubAdminWebsite({
    required this.clubName,
    required this.yearLabel,
    required this.configured,
    required this.subdomain,
    required this.thirdPartyDomain,
    required this.visitUrl,
    required this.statusRaw,
    required this.status,
    required this.activatedDate,
    required this.expiryDate,
    required this.menuCount,
    required this.bannerCount,
    required this.eventCount,
    required this.announcementCount,
    required this.killSwitchOn,
  });

  /// Public URL to open. The backend (2026-06-22) writes the FINAL sanitised
  /// URL into both `visitUrl` and `thirdPartyDomain` (full https://… or "" when
  /// no live site, parent domain resolved server-side), so we read those
  /// directly instead of composing `<subdomain>.<parent>` client-side. Empty
  /// when nothing is configured.
  String get publicUrl {
    final v = (visitUrl ?? '').trim();
    if (v.isNotEmpty) return v.startsWith('http') ? v : 'https://$v';
    final tpd = (thirdPartyDomain ?? '').trim();
    if (tpd.isEmpty) return '';
    return tpd.startsWith('http') ? tpd : 'https://$tpd';
  }

  bool get isLive => status == ClubWebsiteStatus.active && !killSwitchOn;
  bool get isExpired =>
      status == ClubWebsiteStatus.expired ||
      status == ClubWebsiteStatus.trialExpired;

  String get statusLabel {
    if (killSwitchOn) return 'Disabled';
    if (isLive) return 'Live';
    switch (status) {
      case ClubWebsiteStatus.trial:
        return 'Trial';
      case ClubWebsiteStatus.trialExpired:
      case ClubWebsiteStatus.expired:
        return 'Expired';
      case ClubWebsiteStatus.active:
        return 'Live';
      case ClubWebsiteStatus.unknown:
        return configured ? 'Active' : 'Not Set Up';
    }
  }

  /// 3-state status surfaced on the dashboard (matches the web my-club-website
  /// chip): `No` when the site isn't configured, `Expired` when past expiry,
  /// else `Yes`.
  String get yesNoStatus {
    if (!configured) return 'No';
    if (isExpired) return 'Expired';
    return 'Yes';
  }

  /// Treat year<=1 ("0001-01-01") or empty as no-date → null.
  static String? _date(dynamic v) {
    final s = _sn(v);
    if (s == null) return null;
    final year = int.tryParse(s.split('-').first) ?? 0;
    if (year <= 1) return null;
    return s;
  }

  factory ClubAdminWebsite.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final statusRaw = _s(j['status']);
    return ClubAdminWebsite(
      clubName: _s(club['clubName']),
      yearLabel: _s(club['yearLabel']),
      configured: j['configured'] == true,
      subdomain: _s(j['subdomain']),
      thirdPartyDomain: _sn(j['thirdPartyDomain']),
      visitUrl: _sn(j['visitUrl']),
      statusRaw: statusRaw,
      status: _websiteStatusFrom(statusRaw),
      activatedDate: _date(j['activatedDate']),
      expiryDate: _date(j['expiryDate']),
      menuCount: _i(j['menuCount']),
      bannerCount: _i(j['bannerCount']),
      eventCount: _i(j['eventCount']),
      announcementCount: _i(j['announcementCount']),
      killSwitchOn: j['killSwitchOn'] == true,
    );
  }
}

// ── Membership Dues / Payments ───────────────────────────────────────────────

enum PaymentStatus { paid, partial, unpaid, exempt }

PaymentStatus _paymentStatusFrom(String raw) {
  switch (raw.trim().toLowerCase()) {
    case 'paid':
      return PaymentStatus.paid;
    case 'partial':
      return PaymentStatus.partial;
    case 'no_dues':
    case 'nodues':
    case 'exempt':
      return PaymentStatus.exempt;
    default:
      return PaymentStatus.unpaid;
  }
}

/// One member's dues row (`ClubAdminDuesMemberRow`). Avatar initials/colour are
/// derived (the DTO carries neither). All amounts are raw INR.
class ClubAdminDuesMember {
  final int memberId;
  final String memberName;
  final String initials;
  final int colorArgb;
  final double amountDueInr;
  final double amountPaidInr;
  final PaymentStatus status;

  const ClubAdminDuesMember({
    required this.memberId,
    required this.memberName,
    required this.initials,
    required this.colorArgb,
    required this.amountDueInr,
    required this.amountPaidInr,
    required this.status,
  });

  factory ClubAdminDuesMember.fromJson(Map<String, dynamic> j, int index) {
    final name = _s(j['memberName']);
    return ClubAdminDuesMember(
      memberId: _i(j['memberId']),
      memberName: name,
      initials: _initialsOf(name),
      colorArgb: _palette[index % _palette.length],
      amountDueInr: _d(j['amountDue']),
      amountPaidInr: _d(j['amountPaid']),
      status: _paymentStatusFrom(_s(j['status'])),
    );
  }
}

/// Parsed `GET /payments` response. Per-current-year (no availableYears); no
/// due/paid dates, membership type, exempt state, or event-link data.
class ClubAdminPayments {
  final String clubName;
  final String yearLabel;
  final double totalDueInr;
  final double totalCollectedInr;
  final int paidCount;
  final int unpaidCount;
  final int partialCount;
  final List<ClubAdminDuesMember> members;

  const ClubAdminPayments({
    required this.clubName,
    required this.yearLabel,
    required this.totalDueInr,
    required this.totalCollectedInr,
    required this.paidCount,
    required this.unpaidCount,
    required this.partialCount,
    required this.members,
  });

  int get payableCount => paidCount + partialCount + unpaidCount;
  double get outstandingInr =>
      math.max(0.0, totalDueInr - totalCollectedInr);
  int get collectionPct =>
      payableCount > 0 ? ((paidCount / payableCount) * 100).round() : 0;

  factory ClubAdminPayments.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final rows = _list(j['members']);
    return ClubAdminPayments(
      clubName: _s(club['clubName']),
      yearLabel: _s(club['yearLabel']),
      totalDueInr: _d(j['totalDue']),
      totalCollectedInr: _d(j['totalCollected']),
      paidCount: _i(j['paidCount']),
      unpaidCount: _i(j['unpaidCount']),
      partialCount: _i(j['partialCount']),
      members: [
        for (var i = 0; i < rows.length; i++)
          ClubAdminDuesMember.fromJson(rows[i], i),
      ],
    );
  }
}

// ── Dashboard › Rotary Network ───────────────────────────────────────────────

/// A terminated or potential member row (`ClubAdminDashboardRotaryNetworkRow`).
/// Note `memberId` is a string (holds the RotaryId), not a numeric key.
class RotaryNetworkRow {
  final int id;
  final String memberId;
  final String memberType;
  final String firstName;
  final String middleName;
  final String lastName;
  final String? admissionDate;
  final String? terminationDate;
  final String? terminationReason;
  final String? status; // "Terminated" | "Potential"

  const RotaryNetworkRow({
    required this.id,
    required this.memberId,
    required this.memberType,
    required this.firstName,
    required this.middleName,
    required this.lastName,
    required this.admissionDate,
    required this.terminationDate,
    required this.terminationReason,
    required this.status,
  });

  String get fullName =>
      [firstName, middleName, lastName].where((p) => p.isNotEmpty).join(' ');

  factory RotaryNetworkRow.fromJson(Map<String, dynamic> j) => RotaryNetworkRow(
        id: _i(j['id']),
        memberId: _s(j['memberId']),
        memberType: _s(j['memberType']),
        firstName: _s(j['firstName']),
        middleName: _s(j['middleName']),
        lastName: _s(j['lastName']),
        admissionDate: _sn(j['admissionDate']),
        terminationDate: _sn(j['terminationDate']),
        terminationReason: _sn(j['terminationReason']),
        status: _sn(j['status']),
      );
}

/// Parsed `GET /dashboard-rotary-network` response.
class ClubAdminRotaryNetwork {
  final String clubName;
  final int totalTerminated;
  final int thisRotaryYear;
  final int nowMember;
  final int lackOfParticipation;
  final List<RotaryNetworkRow> terminated;
  final List<RotaryNetworkRow> potential;

  const ClubAdminRotaryNetwork({
    required this.clubName,
    required this.totalTerminated,
    required this.thisRotaryYear,
    required this.nowMember,
    required this.lackOfParticipation,
    required this.terminated,
    required this.potential,
  });

  factory ClubAdminRotaryNetwork.fromJson(Map<String, dynamic> j) {
    final club = (j['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ClubAdminRotaryNetwork(
      clubName: _s(club['clubName']),
      totalTerminated: _i(j['totalTerminated']),
      thisRotaryYear: _i(j['thisRotaryYear']),
      nowMember: _i(j['nowMember']),
      lackOfParticipation: _i(j['lackOfParticipation']),
      terminated:
          _list(j['terminatedMembers']).map(RotaryNetworkRow.fromJson).toList(),
      potential:
          _list(j['potentialMembers']).map(RotaryNetworkRow.fromJson).toList(),
    );
  }
}

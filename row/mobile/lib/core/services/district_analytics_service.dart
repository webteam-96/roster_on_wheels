import '../utils/money_format.dart';
import '../../data/mock/district_egovernance_mock.dart';
import '../../data/mock/district_overview_mock.dart';
import '../../data/models/district_overview_models.dart';

/// Aggregates and helpers for the District Overview dashboard.
///
/// Mirrors the calculations done at module load in `Overview.jsx`.
/// All getters operate on the global `kClubAnalytics` corpus from
/// `district_overview_mock.dart`.
class DistrictAnalyticsService {
  DistrictAnalyticsService._();

  /// Divisor used by `fmtUsd` to convert INR mock values into USD display
  /// strings — matches the React reference's `INR_TO_USD = 84`.
  static const int inrToUsd = 84;

  // ── District-wide member totals ────────────────────────────────────────

  static int get totalClubs => kClubAnalytics.length;

  static int get totalMembers =>
      kClubAnalytics.fold(0, (s, c) => s + c.members);

  static int get activeMembers =>
      kClubAnalytics.fold(0, (s, c) => s + c.activeMembers);

  static int get maleMembers =>
      kClubAnalytics.fold(0, (s, c) => s + c.maleMembers);

  static int get femaleMembers =>
      kClubAnalytics.fold(0, (s, c) => s + c.femaleMembers);

  static int get honoraryMembers =>
      kClubAnalytics.fold(0, (s, c) => s + c.honoraryMembers);

  static int get inactiveMembers => totalMembers - activeMembers;

  static int get newThisYear =>
      kClubAnalytics.fold(0, (s, c) => s + c.newThisYear);

  static int get terminated =>
      kClubAnalytics.fold(0, (s, c) => s + c.terminated);

  // ── TRF totals ─────────────────────────────────────────────────────────

  static int get trfRaised =>
      kClubAnalytics.fold(0, (s, c) => s + c.trfRaised);

  static int get trfGoal =>
      kClubAnalytics.fold(0, (s, c) => s + c.trfGoal);

  static int get annualFund =>
      kClubAnalytics.fold(0, (s, c) => s + c.annualFund);

  static int get phfContributors =>
      kClubAnalytics.fold(0, (s, c) => s + c.phfContributors);

  static int get majorDonors =>
      kClubAnalytics.fold(0, (s, c) => s + c.majorDonors);

  static int get trfPct => ((trfRaised / trfGoal) * 100).round();

  // ── Service Projects ───────────────────────────────────────────────────

  static int get serviceProjects =>
      kClubAnalytics.fold(0, (s, c) => s + c.serviceProjects);

  // ── Citation ───────────────────────────────────────────────────────────

  static int get citationAvg => (kClubAnalytics.fold<int>(
              0, (s, c) => s + c.citationScore) /
          kClubAnalytics.length)
      .round();

  static int get citationPct => ((citationAvg / 1000) * 100).round();

  static int get qualifiedClubs =>
      kClubAnalytics.where((c) => c.citationScore >= 800).length;

  // ── Leaderboard ────────────────────────────────────────────────────────

  /// Clubs sorted by composite score desc. Stable across rebuilds (mock
  /// data is fixed), so the React leaderboard's "rank by index" pattern
  /// translates one-to-one.
  static List<ClubAnalytics> ranked() {
    final list = [...kClubAnalytics];
    list.sort((a, b) => b.composite.compareTo(a.composite));
    return list;
  }

  // ── Avenue breakdown ───────────────────────────────────────────────────

  /// Project counts per service avenue, sorted desc. Drives the bars in
  /// the Service Projects analytical card.
  static List<({String name, int completed})> avenueBreakdown() {
    final m = <String, int>{};
    for (final p in kDistrictProjects) {
      m[p.avenue] = (m[p.avenue] ?? 0) + 1;
    }
    final entries = m.entries
        .map((e) => (name: e.key, completed: e.value))
        .toList();
    entries.sort((a, b) => b.completed.compareTo(a.completed));
    return entries;
  }

  // ── Top-20 helper (drives the dynamic bar chart) ───────────────────────

  /// Returns top-20 clubs by the given numeric extractor, with the first
  /// word of each club's name (matches React's `c.name.split(' ')[0]`
  /// X-axis label truncation).
  static List<({String name, num value})> top20({
    required num Function(ClubAnalytics) keyOf,
  }) {
    final sorted = [...kClubAnalytics]
      ..sort((a, b) => keyOf(b).compareTo(keyOf(a)));
    return sorted.take(20).map((c) => (
          name: c.name.split(' ').first,
          value: keyOf(c),
        )).toList();
  }

  // ── Per-criterion averages (for the Citation card) ─────────────────────

  static List<
      ({
        String criterion,
        int points,
        int earned,
        int pct,
        CritStatus status,
      })> criterionAverages() {
    return List.generate(kCitationCriteria.length, (i) {
      final crit = kCitationCriteria[i];
      final earned = (kClubCitations.fold<int>(0, (s, c) => s + c.criteria[i]) /
              kClubCitations.length)
          .round();
      final pct = ((earned / crit.points) * 100).round();
      final status = pct == 100
          ? CritStatus.done
          : pct >= 60
              ? CritStatus.partial
              : CritStatus.none;
      return (
        criterion: crit.criterion,
        points: crit.points,
        earned: earned,
        pct: pct,
        status: status,
      );
    });
  }

  // ── USD formatter (matches React fmtUSD) ───────────────────────────────

  static String fmtUsd(num v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.round()}';
  }

  /// Compact money in the brand currency (kept under its old name for existing callers).
  static String fmtInr(num v) => shortMoney(v, null);

  // ── Foundation: Projects ───────────────────────────────────────────────

  static int get totalProjects => kDistrictProjects.length;

  static int get completedProjects =>
      kDistrictProjects.where((p) => p.status == 'Completed').length;

  static int get totalBeneficiaries =>
      kDistrictProjects.fold(0, (s, p) => s + p.beneficiaries);

  static int get totalProjectFunds =>
      kDistrictProjects.fold(0, (s, p) => s + p.funds);

  /// Project name → number of clubs that have completed it. Drives the
  /// "Project Frequency" table on the Foundation → Projects sub-tab.
  static List<({String name, String avenue, int count})> projectFrequency() {
    final m = <String, ({String avenue, int count})>{};
    for (final p in kDistrictProjects) {
      final existing = m[p.name];
      m[p.name] = (
        avenue: existing?.avenue ?? p.avenue,
        count: (existing?.count ?? 0) + 1,
      );
    }
    final entries = m.entries
        .map((e) => (name: e.key, avenue: e.value.avenue, count: e.value.count))
        .toList();
    entries.sort((a, b) => b.count.compareTo(a.count));
    return entries;
  }

  // ── Foundation: Events ─────────────────────────────────────────────────

  static int get totalEvents => kDistrictEvents.length;

  static int get upcomingEvents =>
      kDistrictEvents.where((e) => e.status == 'Upcoming').length;

  static int get completedEvents =>
      kDistrictEvents.where((e) => e.status == 'Completed').length;

  static int get districtTypeEvents =>
      kDistrictEvents.where((e) => e.type == 'District').length;

  // ── E-Governance: Monthly Reports ──────────────────────────────────────

  static int get monthlyReportClubs => kClubMonthlyReports.length;

  static int get monthlyReportSubmittedSlots => kClubMonthlyReports.fold(
      0, (s, c) => s + c.months.where((m) => m == MonthlyStatus.submitted).length);

  static int get monthlyReportPendingSlots => kClubMonthlyReports.fold(
      0, (s, c) => s + c.months.where((m) => m == MonthlyStatus.pending).length);

  static int get monthlyReportLateSlots => kClubMonthlyReports.fold(
      0, (s, c) => s + c.months.where((m) => m == MonthlyStatus.late_).length);

  /// Compliance % = on-time slots out of (clubs × 9 reportable months so far)
  /// — matches React's formula.
  static int get monthlyReportCompliancePct {
    final denom = kClubMonthlyReports.length * 9;
    if (denom == 0) return 0;
    return ((monthlyReportSubmittedSlots / denom) * 100).round();
  }

  // ── E-Governance: PPH Camps ────────────────────────────────────────────

  static int get pphCampsCount => kPphCamps.length;
  static int get pphChildren =>
      kPphCamps.fold(0, (s, c) => s + c.children);
  static int get pphRotarians =>
      kPphCamps.fold(0, (s, c) => s + c.rotarians);
  static int get pphRotaractors =>
      kPphCamps.fold(0, (s, c) => s + c.rotaractors);
}

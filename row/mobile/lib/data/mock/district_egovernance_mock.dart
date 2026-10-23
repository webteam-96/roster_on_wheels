import 'district_overview_mock.dart' show kClubAnalytics;

/// Mock data for the E-Governance tab on the District Overview screen.
/// Ports `AG_module-master/src/modules/district/data/egovernanceData.js`
/// and `monthlyReportData.js`.

// ─────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────

/// Per-month status code returned by the CLUB_MONTHLY_REPORTS generator:
/// S = submitted on time, L = late, P = pending (current), N = not started.
enum MonthlyStatus { submitted, late_, pending, notStarted }

class ClubMonthlyReport {
  final String id;
  final String name;
  /// 12 entries, one per month. Index 0 = Jul, …, 11 = Jun.
  final List<MonthlyStatus> months;
  const ClubMonthlyReport({
    required this.id,
    required this.name,
    required this.months,
  });
}

class MonthLabel {
  final String id; // e.g. 'jul-2025'
  final String label; // e.g. 'July 2025'
  const MonthLabel({required this.id, required this.label});
}

class MonthlyStatusEntry {
  final int submitted;
  final int total;
  const MonthlyStatusEntry({required this.submitted, required this.total});
}

class ReportEntry {
  final String id;
  final String name;
  final String sub;
  /// Optional dropdown filter shown next to the report name.
  final List<String>? filterOptions;
  const ReportEntry({
    required this.id,
    required this.name,
    required this.sub,
    this.filterOptions,
  });
}

class ReportSection {
  final String id; // 'members' | 'district' | 'clubs'
  final String label;
  final int colorArgb;
  final int hoverBgArgb;
  final List<ReportEntry> reports;
  const ReportSection({
    required this.id,
    required this.label,
    required this.colorArgb,
    required this.hoverBgArgb,
    required this.reports,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Static data — labels, locations, names
// ─────────────────────────────────────────────────────────────────────────

const kCmrMonths = <String>[
  'Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025',
  'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026',
];

/// 10 reportable months (Jul → Apr). The Monthly Report District Summary
/// section uses this — May/Jun aren't reportable yet in RY 2025-26.
const kMonths = <MonthLabel>[
  MonthLabel(id: 'jul-2025', label: 'July 2025'),
  MonthLabel(id: 'aug-2025', label: 'August 2025'),
  MonthLabel(id: 'sep-2025', label: 'September 2025'),
  MonthLabel(id: 'oct-2025', label: 'October 2025'),
  MonthLabel(id: 'nov-2025', label: 'November 2025'),
  MonthLabel(id: 'dec-2025', label: 'December 2025'),
  MonthLabel(id: 'jan-2026', label: 'January 2026'),
  MonthLabel(id: 'feb-2026', label: 'February 2026'),
  MonthLabel(id: 'mar-2026', label: 'March 2026'),
  MonthLabel(id: 'apr-2026', label: 'April 2026'),
];

const kMonthlyStatus = <String, MonthlyStatusEntry>{
  'jul-2025': MonthlyStatusEntry(submitted: 6, total: 6),
  'aug-2025': MonthlyStatusEntry(submitted: 5, total: 6),
  'sep-2025': MonthlyStatusEntry(submitted: 6, total: 6),
  'oct-2025': MonthlyStatusEntry(submitted: 4, total: 6),
  'nov-2025': MonthlyStatusEntry(submitted: 6, total: 6),
  'dec-2025': MonthlyStatusEntry(submitted: 5, total: 6),
  'jan-2026': MonthlyStatusEntry(submitted: 3, total: 6),
  'feb-2026': MonthlyStatusEntry(submitted: 6, total: 6),
  'mar-2026': MonthlyStatusEntry(submitted: 2, total: 6),
  'apr-2026': MonthlyStatusEntry(submitted: 0, total: 6),
};

// ─────────────────────────────────────────────────────────────────────────
// Generators (port of egovernanceData.js)
// ─────────────────────────────────────────────────────────────────────────

List<MonthlyStatus> _makeMonths(int submitted, int seed) {
  return List<MonthlyStatus>.generate(12, (i) {
    if (i > 9) return MonthlyStatus.notStarted;
    if (i >= submitted) {
      return i == submitted
          ? MonthlyStatus.pending
          : MonthlyStatus.notStarted;
    }
    return (submitted == 0 || (seed + i) % 6 == 0)
        ? MonthlyStatus.late_
        : MonthlyStatus.submitted;
  });
}

final List<ClubMonthlyReport> kClubMonthlyReports = <ClubMonthlyReport>[
  for (var i = 0; i < kClubAnalytics.length; i++)
    ClubMonthlyReport(
      id: kClubAnalytics[i].id,
      name: kClubAnalytics[i].name,
      months: _makeMonths(kClubAnalytics[i].reportsSubmitted, i),
    ),
];

// ─────────────────────────────────────────────────────────────────────────
// Report sections (hardcoded)
// ─────────────────────────────────────────────────────────────────────────

const kReportSections = <ReportSection>[
  ReportSection(
    id: 'members',
    label: 'Membership Reports',
    colorArgb: 0xFF003DA5,
    hoverBgArgb: 0xFFEFF6FF,
    reports: [
      ReportEntry(id: 'm1', name: 'Member Roster (All Clubs)', sub: 'Current RY'),
      ReportEntry(id: 'm2', name: 'New Members Report',        sub: 'This RY'),
      ReportEntry(id: 'm3', name: 'Terminated Members Report', sub: 'This RY'),
      ReportEntry(id: 'm4', name: 'Attendance Summary',        sub: 'Monthly'),
    ],
  ),
  ReportSection(
    id: 'district',
    label: 'District Reports',
    colorArgb: 0xFF9333EA,
    hoverBgArgb: 0xFFFAF5FF,
    reports: [
      ReportEntry(id: 'd1', name: 'District Citation Report', sub: 'RY 2025–26'),
      ReportEntry(id: 'd2', name: 'DG Visit Summary',         sub: 'All clubs'),
      ReportEntry(id: 'd4', name: 'TRF District Report',      sub: 'RY 2025–26'),
    ],
  ),
  ReportSection(
    id: 'clubs',
    label: 'Club Reports',
    colorArgb: 0xFF16A34A,
    hoverBgArgb: 0xFFF0FDF4,
    reports: [
      ReportEntry(
        id: 'c1',
        name: 'Monthly Report Compliance',
        sub: 'All clubs',
        filterOptions: ['All Clubs', 'Submitted', 'Pending', 'Late'],
      ),
      ReportEntry(id: 'c2', name: 'Service Projects by Club',      sub: 'This RY'),
      ReportEntry(id: 'c3', name: 'Club Foundation Contributions', sub: 'This RY'),
      ReportEntry(
        id: 'c4',
        name: 'Club Attendance Report',
        sub: 'Monthly',
        filterOptions: [
          'All Months', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
          'Dec', 'Jan', 'Feb', 'Mar',
        ],
      ),
    ],
  ),
];

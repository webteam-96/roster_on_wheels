import 'package:flutter/material.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../widgets/detail/detail_widgets.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// E-Governance · Club Monthly Report sub-tab (EGOV-2).
///
/// Replaces the old flat 2-state list with the web's per-month STATUS TABLE
/// (Month · Submission Date · On-Time · 3-state status) over the
/// `/api/clubs/{clubId}/monthly-reports/*` endpoints, plus a read-only CMR
/// detail bottom-sheet fetched from `/preview/{yearId}/{month}` on tap.
///
/// Status / submission-date / on-time are derived client-side (the wire has no
/// such fields), mirroring the web club-admin e-governance page:
///   • isUploadedToDistrict → Submitted   • isCreated → In Progress   • else Not Started
///   • submission date = modifiedDate ?? createdDate
///   • on-time = "Yes" when uploaded, else "—" (acknowledged stub — no due date)

// ── coercers ─────────────────────────────────────────────────────────────────
int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

double _asDouble(dynamic v) {
  if (v is double) return v;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0.0;
  return 0.0;
}

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

String _asStr(dynamic v) => v?.toString() ?? '';

String? _asStrN(dynamic v) {
  final s = v?.toString();
  return (s == null || s.isEmpty) ? null : s;
}

List<dynamic> _asList(dynamic v) {
  if (v is List) return v;
  if (v is Map<String, dynamic>) {
    final items = v['items'];
    if (items is List) return items;
    final data = v['data'];
    if (data is List) return data;
  }
  return const [];
}

const _months3 = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _fmtDate(String? raw) {
  if (raw == null || raw.isEmpty) return '–';
  final d = DateTime.tryParse(raw);
  if (d == null) return raw;
  return '${d.day.toString().padLeft(2, '0')} ${_months3[d.month - 1]} ${d.year}';
}

String _usd(double v) {
  // Thousands-separated USD, no decimals.
  final s = v.round().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return '\$$b';
}

// ── service-project avenues (fixed key→label map) ────────────────────────────
const _avenueKeys = [
  'community_service',
  'vocational_service',
  'international_service',
  'new_generation_service',
  'public_image_initiative',
];
const _avenueLabels = {
  'community_service': 'Community Service',
  'vocational_service': 'Vocational Service',
  'international_service': 'International Service',
  'new_generation_service': 'New Generation Service',
  'public_image_initiative': 'Public Image Initiative',
};

// ── models ───────────────────────────────────────────────────────────────────
class _CmrYear {
  final int id;
  final String label;
  final bool isCurrent;
  const _CmrYear({required this.id, required this.label, required this.isCurrent});
  factory _CmrYear.fromJson(Map<String, dynamic> j) => _CmrYear(
        id: _asInt(j['id']),
        label: _asStr(j['yearLabel']),
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _CmrMonthRow {
  final int? reportId;
  final int month; // 1-12
  final String monthName; // "MMMM yyyy"
  final bool isCreated;
  final String? createdDate;
  final String? modifiedDate;
  final bool isUploadedToDistrict;
  const _CmrMonthRow({
    required this.reportId,
    required this.month,
    required this.monthName,
    required this.isCreated,
    required this.createdDate,
    required this.modifiedDate,
    required this.isUploadedToDistrict,
  });

  factory _CmrMonthRow.fromJson(Map<String, dynamic> j) => _CmrMonthRow(
        reportId: j['reportId'] == null ? null : _asInt(j['reportId']),
        month: _asInt(j['month']),
        monthName: _asStr(j['monthName']),
        isCreated: _asBool(j['isCreated']),
        createdDate: _asStrN(j['createdDate']),
        modifiedDate: _asStrN(j['modifiedDate']),
        isUploadedToDistrict: _asBool(j['isUploadedToDistrict']),
      );

  /// 3-state status (mirrors the web club-admin e-governance page).
  String get statusLabel => isUploadedToDistrict
      ? 'Submitted'
      : (isCreated ? 'In Progress' : 'Not Started');

  /// Submission date column = modified ?? created (— when both null).
  String get submissionDate => _fmtDate(modifiedDate ?? createdDate);

  /// On-time stub — "Yes" only when uploaded; otherwise "—" (no real due date).
  String get onTime {
    if (!isCreated || createdDate == null) return '–';
    return isUploadedToDistrict ? 'Yes' : '–';
  }
}

class _CmrMeeting {
  final String title;
  final String? meetingType;
  final String? projectDate;
  final int? attendance;
  final double? attendancePct;
  const _CmrMeeting({
    required this.title,
    required this.meetingType,
    required this.projectDate,
    required this.attendance,
    required this.attendancePct,
  });
  factory _CmrMeeting.fromJson(Map<String, dynamic> j) => _CmrMeeting(
        title: _asStr(j['title']),
        meetingType: _asStrN(j['meetingType']),
        projectDate: _asStrN(j['projectDate']),
        attendance: j['attendance'] == null ? null : _asInt(j['attendance']),
        attendancePct: j['attendancePercentage'] == null
            ? null
            : _asDouble(j['attendancePercentage']),
      );
}

class _CmrTrf {
  final String? trfDate;
  final String donorName;
  final double amountUsd;
  final String fundType;
  final String? otherFundName;
  const _CmrTrf({
    required this.trfDate,
    required this.donorName,
    required this.amountUsd,
    required this.fundType,
    required this.otherFundName,
  });
  factory _CmrTrf.fromJson(Map<String, dynamic> j) => _CmrTrf(
        trfDate: _asStrN(j['trfDate']),
        donorName: _asStr(j['donorName']),
        amountUsd: _asDouble(j['amountUSD']),
        fundType: _asStr(j['fundType']),
        otherFundName: _asStrN(j['otherFundName']),
      );
  String get fundLabel =>
      fundType == 'Others' ? (otherFundName ?? 'Others') : fundType;
}

class _CmrProject {
  final String title;
  final String? projectDate;
  final String? areaOfFocus;
  const _CmrProject({
    required this.title,
    required this.projectDate,
    required this.areaOfFocus,
  });
  factory _CmrProject.fromJson(Map<String, dynamic> j) => _CmrProject(
        title: _asStr(j['title']),
        projectDate: _asStrN(j['projectDate']),
        areaOfFocus: _asStrN(j['areaOfFocusName']),
      );
  String get areaLabel =>
      (areaOfFocus == null || areaOfFocus!.isEmpty) ? '–' : areaOfFocus!;
}

class _CmrPreview {
  final String clubName;
  final String? clubCode;
  final String yearLabel;
  final String monthName; // bare "MMMM"
  final String? reportDate;
  final String? preparedBy;
  final String? designation;
  final String? assistantGovernor;
  final bool isUploadedToDistrict;
  final String? uploadedToDistrictDate;
  final int totalMeetings;
  final double averageAttendance;
  final double trfCurrentMonth;
  final double trfThisYear;
  final int memberCountLastMonth;
  final int membersAdded;
  final int membersDeleted;
  final int currentMemberCount;
  final String? additionalRemarks;
  final List<_CmrMeeting> meetings;
  final List<_CmrTrf> trfEntries;
  final Map<String, List<_CmrProject>> projects;

  const _CmrPreview({
    required this.clubName,
    required this.clubCode,
    required this.yearLabel,
    required this.monthName,
    required this.reportDate,
    required this.preparedBy,
    required this.designation,
    required this.assistantGovernor,
    required this.isUploadedToDistrict,
    required this.uploadedToDistrictDate,
    required this.totalMeetings,
    required this.averageAttendance,
    required this.trfCurrentMonth,
    required this.trfThisYear,
    required this.memberCountLastMonth,
    required this.membersAdded,
    required this.membersDeleted,
    required this.currentMemberCount,
    required this.additionalRemarks,
    required this.meetings,
    required this.trfEntries,
    required this.projects,
  });

  factory _CmrPreview.fromJson(Map<String, dynamic> j) {
    final projRaw = (j['projects'] as Map?)?.cast<String, dynamic>() ?? const {};
    final projects = <String, List<_CmrProject>>{};
    for (final k in _avenueKeys) {
      projects[k] = _asList(projRaw[k])
          .map((e) => _CmrProject.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    return _CmrPreview(
      clubName: _asStr(j['clubName']),
      clubCode: _asStrN(j['clubCode']),
      yearLabel: _asStr(j['yearLabel']),
      monthName: _asStr(j['monthName']),
      reportDate: _asStrN(j['reportDate']),
      preparedBy: _asStrN(j['preparedBy']),
      designation: _asStrN(j['designation']),
      assistantGovernor: _asStrN(j['assistantGovernor']),
      isUploadedToDistrict: _asBool(j['isUploadedToDistrict']),
      uploadedToDistrictDate: _asStrN(j['uploadedToDistrictDate']),
      totalMeetings: _asInt(j['totalMeetings']),
      averageAttendance: _asDouble(j['averageAttendance']),
      trfCurrentMonth: _asDouble(j['trfCurrentMonth']),
      trfThisYear: _asDouble(j['trfThisYear']),
      memberCountLastMonth: _asInt(j['memberCountLastMonth']),
      membersAdded: _asInt(j['membersAdded']),
      membersDeleted: _asInt(j['membersDeleted']),
      currentMemberCount: _asInt(j['currentMemberCount']),
      additionalRemarks: _asStrN(j['additionalRemarks']),
      meetings: _asList(j['meetings'])
          .map((e) => _CmrMeeting.fromJson(e as Map<String, dynamic>))
          .toList(),
      trfEntries: _asList(j['trfEntries'])
          .map((e) => _CmrTrf.fromJson(e as Map<String, dynamic>))
          .toList(),
      projects: projects,
    );
  }
}

// ── status chip (3-state, colours web doesn't share with DetailStatusChip) ───
({Color bg, Color fg}) _statusColors(String label) {
  switch (label) {
    case 'Submitted':
      return (bg: AppColors.successTint, fg: AppColors.statusDone);
    case 'In Progress':
      return (bg: AppColors.background, fg: AppColors.warningDark);
    default: // Not Started
      return (bg: AppColors.errorTint, fg: AppColors.statusNone);
  }
}

class _StatusChip extends StatelessWidget {
  final String label;
  const _StatusChip({required this.label});
  @override
  Widget build(BuildContext context) {
    final c = _statusColors(label);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: AppFonts.body(
          fontSize: 10,
          fontWeight: FontWeight.w800,
          color: c.fg,
        ),
      ),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Sub-tab
// ═════════════════════════════════════════════════════════════════════════
class CmrMonthReportSubtab extends StatefulWidget {
  final int clubId;

  /// The globally-selected dashboard year (used to default the CMR year when
  /// it appears in this club's CMR year list).
  final int? yearId;
  const CmrMonthReportSubtab({super.key, required this.clubId, this.yearId});

  @override
  State<CmrMonthReportSubtab> createState() => _CmrMonthReportSubtabState();
}

class _CmrMonthReportSubtabState extends State<CmrMonthReportSubtab> {
  final ApiClient _api = ApiClient();

  bool _loading = true;
  String? _error;
  List<_CmrYear> _years = [];
  int? _yearId;
  List<_CmrMonthRow> _months = [];

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  String get _base => '/api/clubs/${widget.clubId}/monthly-reports';

  Future<void> _bootstrap() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (resp.data ?? const [])
          .map((e) => _CmrYear.fromJson(e as Map<String, dynamic>))
          .toList();
      if (years.isEmpty) {
        setState(() {
          _years = [];
          _months = [];
          _loading = false;
        });
        return;
      }
      // Prefer the global dashboard year if this club has CMR data for it,
      // else the current year, else the newest.
      final globalMatch =
          years.where((y) => y.id == widget.yearId).toList();
      final current = years.where((y) => y.isCurrent).toList();
      _yearId = globalMatch.isNotEmpty
          ? globalMatch.first.id
          : (current.isNotEmpty ? current.first.id : years.first.id);
      _years = years;
      await _loadMonths();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load monthly reports.';
        _loading = false;
      });
    }
  }

  Future<void> _loadMonths() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/months/$_yearId',
        fromJson: (j) => j as List<dynamic>,
      );
      final months = (resp.data ?? const [])
          .map((e) => _CmrMonthRow.fromJson(e as Map<String, dynamic>))
          .toList();
      if (!mounted) return;
      setState(() {
        _months = months;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load monthly reports.';
        _loading = false;
      });
    }
  }

  void _onYear(int? id) {
    if (id == null || id == _yearId) return;
    setState(() => _yearId = id);
    _loadMonths();
  }

  void _openDetail(_CmrMonthRow row) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CmrDetailSheet(
        clubId: widget.clubId,
        yearId: _yearId!,
        row: row,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return _InlineMessage(
        icon: Icons.error_outline_rounded,
        text: _error!,
        onRetry: _bootstrap,
      );
    }
    if (_years.isEmpty) {
      return const _InlineMessage(
        icon: Icons.event_busy_rounded,
        text: 'No monthly reports available for this club yet.',
      );
    }

    final total = _months.length;
    final submitted = _months.where((m) => m.isUploadedToDistrict).length;
    final inProgress =
        _months.where((m) => m.isCreated && !m.isUploadedToDistrict).length;
    final notStarted = total - submitted - inProgress;
    final pct = total > 0 ? ((submitted / total) * 100).round() : 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Club Monthly Report',
                    style: AppFonts.body(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  Text(
                    'Submission status by month',
                    style: AppFonts.body(
                      fontSize: 11,
                      color: AppColors.slate400,
                    ),
                  ),
                ],
              ),
            ),
            if (_years.length > 1) _yearDropdown(),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
                child: _KpiTile(
                    label: 'Total',
                    value: '$total',
                    bg: 0xFFEFF6FF,
                    color: AppColors.rotaryBlue)),
            const SizedBox(width: 8),
            Expanded(
                child: _KpiTile(
                    label: 'Submitted',
                    value: '$submitted',
                    bg: 0xFFF0FDF4,
                    color: AppColors.statusDone)),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
                child: _KpiTile(
                    label: 'In Progress',
                    value: '$inProgress',
                    bg: 0xFFFFFBEB,
                    color: AppColors.warningDark)),
            const SizedBox(width: 8),
            Expanded(
                child: _KpiTile(
                    label: 'Not Started',
                    value: '$notStarted',
                    bg: 0xFFFEF2F2,
                    color: AppColors.statusNone)),
          ],
        ),
        const SizedBox(height: 12),
        _progressBar(submitted, total, pct),
        const SizedBox(height: 12),
        if (_months.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'No months for this year',
              style: AppFonts.body(
                  fontSize: 12, color: AppColors.slate400),
            ),
          )
        else
          for (final m in _months) _MonthRow(row: m, onTap: () => _openDetail(m)),
      ],
    );
  }

  Widget _yearDropdown() {
    final sel = _years.where((y) => y.id == _yearId).toList();
    final selLabel = sel.isNotEmpty ? sel.first.label : '';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.slate200),
      ),
      child: DropdownButton<int>(
        value: _yearId,
        underline: const SizedBox.shrink(),
        isDense: true,
        icon: const Icon(Icons.arrow_drop_down_rounded,
            size: 18, color: AppColors.slate500),
        onChanged: _onYear,
        items: [
          for (final y in _years)
            DropdownMenuItem<int>(
              value: y.id,
              child: Text(
                '${y.label}${y.isCurrent ? ' (Current)' : ''}',
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: y.id == _yearId
                      ? FontWeight.w800
                      : FontWeight.w500,
                ),
              ),
            ),
        ],
        selectedItemBuilder: (_) => [
          for (final _ in _years)
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                selLabel,
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.slate700,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _progressBar(int submitted, int total, int pct) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Submission Progress',
                  style: AppFonts.body(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.slate700,
                  ),
                ),
              ),
              Text(
                '$submitted of $total ($pct%)',
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.statusDone,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: total > 0 ? submitted / total : 0,
              minHeight: 8,
              backgroundColor: Colors.white,
              valueColor:
                  const AlwaysStoppedAnimation<Color>(AppColors.statusDone),
            ),
          ),
        ],
      ),
    );
  }
}

class _KpiTile extends StatelessWidget {
  final String label;
  final String value;
  final int bg;
  final Color color;
  const _KpiTile({
    required this.label,
    required this.value,
    required this.bg,
    required this.color,
  });
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: Color(bg),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          Text(
            value,
            style: AppFonts.body(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: color,
              height: 1.05,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: AppFonts.body(
                fontSize: 10.5, color: AppColors.slate500),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _MonthRow extends StatelessWidget {
  final _CmrMonthRow row;
  final VoidCallback onTap;
  const _MonthRow({required this.row, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        row.monthName,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        'Submitted: ${row.submissionDate}  ·  On time: ${row.onTime}',
                        style: AppFonts.body(
                          fontSize: 10.5,
                          color: AppColors.slate400,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                _StatusChip(label: row.statusLabel),
                const Icon(Icons.chevron_right_rounded,
                    size: 18, color: AppColors.slate400),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InlineMessage extends StatelessWidget {
  final IconData icon;
  final String text;
  final VoidCallback? onRetry;
  const _InlineMessage({required this.icon, required this.text, this.onRetry});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 22),
      child: Column(
        children: [
          Icon(icon, size: 30, color: AppColors.slate400),
          const SizedBox(height: 8),
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppFonts.body(
                fontSize: 12, color: AppColors.slate500),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 8),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ],
      ),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Read-only CMR detail bottom-sheet
// ═════════════════════════════════════════════════════════════════════════
class _CmrDetailSheet extends StatefulWidget {
  final int clubId;
  final int yearId;
  final _CmrMonthRow row;
  const _CmrDetailSheet({
    required this.clubId,
    required this.yearId,
    required this.row,
  });

  @override
  State<_CmrDetailSheet> createState() => _CmrDetailSheetState();
}

class _CmrDetailSheetState extends State<_CmrDetailSheet> {
  final ApiClient _api = ApiClient();
  bool _loading = true;
  String? _error;
  _CmrPreview? _data;

  @override
  void initState() {
    super.initState();
    if (!widget.row.isCreated) {
      _loading = false; // empty-state, no fetch
    } else {
      _fetch();
    }
  }

  Future<void> _fetch() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/monthly-reports/preview/${widget.yearId}/${widget.row.month}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _data = _CmrPreview.fromJson(resp.data ?? const {});
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load report detail.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = _data != null
        ? 'CMR · ${_data!.monthName} ${_data!.yearLabel}'
        : 'CMR · ${widget.row.monthName}';
    return DraggableScrollableSheet(
      initialChildSize: 0.8,
      minChildSize: 0.45,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.slate200,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 8, 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: AppFonts.body(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(child: _body(scrollController)),
            ],
          ),
        );
      },
    );
  }

  Widget _body(ScrollController controller) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (!widget.row.isCreated) {
      return _InlineMessage(
        icon: Icons.note_add_outlined,
        text: 'No CMR has been created for ${widget.row.monthName} yet.',
      );
    }
    if (_error != null) {
      return _InlineMessage(
        icon: Icons.error_outline_rounded,
        text: _error!,
        onRetry: () {
          setState(() => _loading = true);
          _fetch();
        },
      );
    }
    final d = _data!;
    return ListView(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      children: [
        _reportInfo(d),
        const SizedBox(height: 14),
        _attendance(d),
        const SizedBox(height: 14),
        _foundation(d),
        const SizedBox(height: 14),
        _serviceProjects(d),
        const SizedBox(height: 14),
        _membership(d),
        if (d.additionalRemarks != null) ...[
          const SizedBox(height: 14),
          _remarks(d),
        ],
      ],
    );
  }

  Widget _reportInfo(_CmrPreview d) {
    final submitted = d.isUploadedToDistrict
        ? 'Yes${d.uploadedToDistrictDate != null ? ' · ${_fmtDate(d.uploadedToDistrictDate)}' : ''}'
        : 'No';
    return DetailSectionCard(
      icon: Icons.description_outlined,
      title: 'Report Info',
      number: 1,
      child: Column(
        children: [
          if (d.clubCode != null) DetailRow(label: 'Club Code', value: d.clubCode!),
          DetailRow(label: 'RY', value: d.yearLabel),
          DetailRow(label: 'Report Month', value: d.monthName),
          DetailRow(label: 'Report Date', value: _fmtDate(d.reportDate)),
          DetailRow(label: 'Prepared By', value: d.preparedBy ?? '–'),
          DetailRow(label: 'Designation', value: d.designation ?? '–'),
          DetailRow(label: 'Assistant Governor', value: d.assistantGovernor ?? 'N/A'),
          DetailRow(label: 'Submitted to District', value: submitted),
        ],
      ),
    );
  }

  Widget _attendance(_CmrPreview d) {
    return DetailSectionCard(
      icon: Icons.groups_outlined,
      title: 'Attendance & Meetings',
      number: 2,
      child: Column(
        children: [
          DetailRow(label: 'Total Meetings', value: '${d.totalMeetings}'),
          DetailRow(
              label: 'Avg Attendance',
              value: '${d.averageAttendance.toStringAsFixed(1)}%'),
          if (d.meetings.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final m in d.meetings)
              _MiniRow(
                title: m.title,
                line2: [
                  if (m.projectDate != null) _fmtDate(m.projectDate),
                  if (m.meetingType != null) m.meetingType!,
                ].join(' · '),
                trailing: m.attendance != null
                    ? '${m.attendance}'
                        '${m.attendancePct != null ? ' (${m.attendancePct!.toStringAsFixed(0)}%)' : ''}'
                    : null,
              ),
          ],
        ],
      ),
    );
  }

  Widget _foundation(_CmrPreview d) {
    return DetailSectionCard(
      icon: Icons.volunteer_activism_outlined,
      title: 'Foundation (TRF)',
      number: 3,
      child: Column(
        children: [
          DetailRow(label: 'This Month', value: '${_usd(d.trfCurrentMonth)} USD'),
          DetailRow(label: 'This Year', value: '${_usd(d.trfThisYear)} USD'),
          if (d.trfEntries.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final t in d.trfEntries)
              _MiniRow(
                title: t.donorName,
                line2: [
                  if (t.trfDate != null) _fmtDate(t.trfDate),
                  t.fundLabel,
                ].join(' · '),
                trailing: _usd(t.amountUsd),
              ),
          ],
        ],
      ),
    );
  }

  Widget _serviceProjects(_CmrPreview d) {
    final any = _avenueKeys.any((k) => (d.projects[k] ?? const []).isNotEmpty);
    return DetailSectionCard(
      icon: Icons.handshake_outlined,
      title: 'Service Projects',
      number: 4,
      child: !any
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('No projects recorded this month.'),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final k in _avenueKeys)
                  if ((d.projects[k] ?? const []).isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: 10, bottom: 2),
                      child: Text(
                        '${_avenueLabels[k]} (${d.projects[k]!.length})',
                        style: AppFonts.body(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                    for (final p in d.projects[k]!)
                      _MiniRow(
                        title: p.title,
                        line2: [
                          if (p.projectDate != null) _fmtDate(p.projectDate),
                          p.areaLabel,
                        ].where((s) => s != '–' && s.isNotEmpty).join(' · '),
                        trailing: null,
                      ),
                  ],
              ],
            ),
    );
  }

  Widget _membership(_CmrPreview d) {
    return DetailSectionCard(
      icon: Icons.person_add_alt_outlined,
      title: 'Membership Changes',
      number: 5,
      child: Column(
        children: [
          DetailRow(
              label: 'Members (last month)',
              value: '${d.memberCountLastMonth}'),
          DetailRow(label: 'Added', value: '${d.membersAdded}'),
          DetailRow(label: 'Deleted / Terminated', value: '${d.membersDeleted}'),
          DetailRow(label: 'Current Count', value: '${d.currentMemberCount}'),
        ],
      ),
    );
  }

  Widget _remarks(_CmrPreview d) {
    return DetailSectionCard(
      icon: Icons.notes_outlined,
      title: 'Additional Remarks',
      number: 6,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Text(
          d.additionalRemarks ?? '',
          style: AppFonts.body(
              fontSize: 12.5, color: AppColors.textPrimary, height: 1.4),
        ),
      ),
    );
  }
}

/// Compact list row used inside detail sections (title + subtitle + trailing).
class _MiniRow extends StatelessWidget {
  final String title;
  final String line2;
  final String? trailing;
  const _MiniRow({required this.title, required this.line2, this.trailing});
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: AppColors.border.withValues(alpha: 0.6)),
        ),
      ),
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title.isEmpty ? '–' : title,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (line2.isNotEmpty)
                  Text(
                    line2,
                    style: AppFonts.body(
                        fontSize: 10.5, color: AppColors.slate500),
                  ),
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: 8),
            Text(
              trailing!,
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

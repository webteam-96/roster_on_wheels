import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Cross-club PPH participation history for one mobile number.
///
/// A camp looking someone up by phone sees their COMPLETE health record — every
/// reading from every club, every year — not just a count. Medically that is the
/// point: the person in front of you may have been screened elsewhere.
///
/// ⚠️ The lookup spans EVERY club regardless of who is asking; the club/district
/// in the path is only a reachability guard on the server. So this is read-only
/// and informational — it never pre-fills the form, exactly as web has it.
class PphHistoryReading {
  final DateTime? readingDate;
  final int? bpSystolic;
  final int? bpDiastolic;
  final String? bpStatus;
  final String? bloodSugarType;
  final double? bloodSugarValue;
  final String? diabetesStatus;
  final double? bmi;
  final String? remarks;

  const PphHistoryReading({
    this.readingDate,
    this.bpSystolic,
    this.bpDiastolic,
    this.bpStatus,
    this.bloodSugarType,
    this.bloodSugarValue,
    this.diabetesStatus,
    this.bmi,
    this.remarks,
  });

  factory PphHistoryReading.fromJson(Map<String, dynamic> j) {
    DateTime? rd = DateTime.tryParse((j['readingDate'] ?? '').toString());
    if (rd != null && rd.year <= 1) rd = null; // `0001-01-01` ⇒ no value
    return PphHistoryReading(
      readingDate: rd,
      bpSystolic: _i(j['bpSystolic']),
      bpDiastolic: _i(j['bpDiastolic']),
      bpStatus: _sn(j['bpStatus']),
      bloodSugarType: _sn(j['bloodSugarType']),
      bloodSugarValue: _d(j['bloodSugarValue']),
      diabetesStatus: _sn(j['diabetesStatus']),
      bmi: _d(j['bmi']),
      remarks: _sn(j['remarks']),
    );
  }

  String get bpText => (bpSystolic == null && bpDiastolic == null)
      ? '–'
      : '${bpSystolic ?? '–'}/${bpDiastolic ?? '–'}';

  String get sugarText {
    if (bloodSugarValue == null) return '–';
    final v = _trimNum(bloodSugarValue!);
    return (bloodSugarType == null || bloodSugarType!.isEmpty)
        ? v
        : '$v ($bloodSugarType)';
  }

  String get bmiText => bmi == null ? '–' : _trimNum(bmi!);
}

/// One camp participation.
class PphHistoryEntry {
  final String campTitle;
  final DateTime? campDate;
  final String attendeeName;
  final String yearLabel;
  final int readingCount;
  final List<PphHistoryReading> readings;

  const PphHistoryEntry({
    required this.campTitle,
    this.campDate,
    this.attendeeName = '',
    this.yearLabel = '',
    this.readingCount = 0,
    this.readings = const [],
  });

  factory PphHistoryEntry.fromJson(Map<String, dynamic> j) {
    DateTime? cd = DateTime.tryParse((j['campDate'] ?? '').toString());
    if (cd != null && cd.year <= 1) cd = null;
    return PphHistoryEntry(
      campTitle: j['campTitle']?.toString() ?? '',
      campDate: cd,
      attendeeName: j['attendeeName']?.toString() ?? '',
      yearLabel: j['yearLabel']?.toString() ?? '',
      readingCount: _i(j['readingCount']) ?? 0,
      readings: (j['readings'] as List?)
              ?.whereType<Map>()
              .map((r) => PphHistoryReading.fromJson(r.cast<String, dynamic>()))
              .toList() ??
          const [],
    );
  }
}

/// All entries for one club — or "District N" for a district-scope camp.
class PphHistoryGroup {
  final String groupName;
  final bool isDistrict;
  final int entryCount;
  final List<PphHistoryEntry> entries;

  const PphHistoryGroup({
    required this.groupName,
    this.isDistrict = false,
    this.entryCount = 0,
    this.entries = const [],
  });

  factory PphHistoryGroup.fromJson(Map<String, dynamic> j) => PphHistoryGroup(
        groupName: j['groupName']?.toString() ?? '',
        isDistrict: j['isDistrict'] as bool? ?? false,
        entryCount: _i(j['entryCount']) ?? 0,
        entries: (j['entries'] as List?)
                ?.whereType<Map>()
                .map((e) => PphHistoryEntry.fromJson(e.cast<String, dynamic>()))
                .toList() ??
            const [],
      );
}

class PphMobileHistory {
  final String mobile;
  final int totalEntries;
  final int groupCount;
  final List<PphHistoryGroup> groups;

  const PphMobileHistory({
    this.mobile = '',
    this.totalEntries = 0,
    this.groupCount = 0,
    this.groups = const [],
  });

  bool get isEmpty => totalEntries == 0 || groups.isEmpty;

  factory PphMobileHistory.fromJson(Map<String, dynamic> j) => PphMobileHistory(
        mobile: j['mobile']?.toString() ?? '',
        totalEntries: _i(j['totalEntries']) ?? 0,
        groupCount: _i(j['groupCount']) ?? 0,
        groups: (j['groups'] as List?)
                ?.whereType<Map>()
                .map((g) => PphHistoryGroup.fromJson(g.cast<String, dynamic>()))
                .toList() ??
            const [],
      );

  /// The newest reading anywhere in the history, with where it was taken —
  /// the one line most worth showing before a nurse takes fresh readings.
  ({PphHistoryReading reading, String groupName, String campTitle})? get latestReading {
    ({PphHistoryReading reading, String groupName, String campTitle})? best;
    for (final g in groups) {
      for (final e in g.entries) {
        for (final r in e.readings) {
          if (r.readingDate == null) continue;
          if (best == null ||
              r.readingDate!.isAfter(best.reading.readingDate!)) {
            best = (
              reading: r,
              groupName: g.groupName,
              campTitle: e.campTitle,
            );
          }
        }
      }
    }
    return best;
  }
}

/// `…/pph-camps/{campId}` → `…/pph-camps/attendee-history`.
///
/// The history route hangs off the CAMPS collection, not one camp, so the camp
/// id is dropped. Returns null when the base isn't the expected shape rather
/// than building a nonsense URL.
String? pphHistoryPathFrom(String campBase) {
  final i = campBase.lastIndexOf('/');
  if (i <= 0) return null;
  return '${campBase.substring(0, i)}/attendee-history';
}

/// Looks the mobile up across every club. Returns null on any failure — this is
/// an informational extra and must never block adding an attendee.
Future<PphMobileHistory?> fetchPphMobileHistory(
  ApiClient api,
  String campBase,
  String mobile,
) async {
  final path = pphHistoryPathFrom(campBase);
  if (path == null) return null;
  try {
    final resp = await api.get<Map<String, dynamic>>(
      path,
      queryParams: {'mobile': mobile},
      fromJson: (j) => j as Map<String, dynamic>,
    );
    final data = resp.data;
    if (data == null) return null;
    return PphMobileHistory.fromJson(data);
  } catch (_) {
    return null;
  }
}

/// The inline "this mobile has attended before" card shown under the mobile
/// field. Informational only — the form is still filled in by hand.
class PphHistoryBanner extends StatelessWidget {
  final PphMobileHistory history;
  final VoidCallback onView;

  const PphHistoryBanner({
    super.key,
    required this.history,
    required this.onView,
  });

  @override
  Widget build(BuildContext context) {
    final last = history.latestReading;
    final entries = history.totalEntries;
    final clubs = history.groupCount;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.infoLight,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.info.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.history_rounded, size: 18, color: AppColors.info),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'This mobile has attended before: '
                  '$entries ${entries == 1 ? 'entry' : 'entries'} across '
                  '$clubs ${clubs == 1 ? 'club' : 'clubs'}.',
                  style: AppFonts.body(
                    fontSize: 12,
                    height: 1.35,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          if (last != null) ...[
            const SizedBox(height: 6),
            Text(
              'Last reading ${_fmtDate(last.reading.readingDate)} at '
              '${last.groupName}: BP ${last.reading.bpText}'
              '${_paren(last.reading.bpStatus)} · Sugar ${last.reading.sugarText}'
              '${_paren(last.reading.diabetesStatus)} · BMI ${last.reading.bmiText}',
              style: AppFonts.body(
                fontSize: 11.5,
                height: 1.35,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
          ],
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Informational only: please still fill in the details below.',
                  style: AppFonts.body(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMuted,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: onView,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text(
                  'View history',
                  style: AppFonts.body(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The full record: club-wise groups, each camp participation, each reading.
Future<void> showPphHistorySheet(
  BuildContext context,
  PphMobileHistory history,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => DraggableScrollableSheet(
      initialChildSize: 0.8,
      minChildSize: 0.45,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, controller) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Participation history',
                          style: AppFonts.body(
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${history.mobile} · ${history.totalEntries} '
                          '${history.totalEntries == 1 ? 'entry' : 'entries'} across '
                          '${history.groupCount} ${history.groupCount == 1 ? 'club' : 'clubs'}',
                          style: AppFonts.body(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    color: AppColors.textSecondary,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.slate100),
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                children: [
                  for (final g in history.groups) _groupCard(g),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

Widget _groupCard(PphHistoryGroup g) {
  return Container(
    margin: const EdgeInsets.only(bottom: 12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: const BoxDecoration(
            color: AppColors.slate50,
            borderRadius: BorderRadius.vertical(top: Radius.circular(11)),
          ),
          child: Row(
            children: [
              Icon(
                g.isDistrict
                    ? Icons.account_balance_outlined
                    : Icons.groups_2_outlined,
                size: 16,
                color: AppColors.textSecondary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  g.groupName.isEmpty ? '–' : g.groupName,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              Text(
                '${g.entryCount} ${g.entryCount == 1 ? 'visit' : 'visits'}',
                style: AppFonts.body(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
        for (final e in g.entries) _entryTile(e),
      ],
    ),
  );
}

Widget _entryTile(PphHistoryEntry e) {
  return Padding(
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                e.campTitle.isEmpty ? 'Camp' : e.campTitle,
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            Text(
              [
                _fmtDate(e.campDate),
                if (e.yearLabel.isNotEmpty) e.yearLabel,
              ].join(' · '),
              style: AppFonts.body(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
        if (e.readings.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'No readings recorded at this camp.',
              style: AppFonts.body(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textMuted,
              ),
            ),
          )
        else
          for (final r in e.readings)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    margin: const EdgeInsets.only(top: 5, right: 8),
                    decoration: BoxDecoration(
                      color: AppColors.slate400,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      '${_fmtDate(r.readingDate)}: BP ${r.bpText}'
                      '${_paren(r.bpStatus)} · Sugar ${r.sugarText}'
                      '${_paren(r.diabetesStatus)} · BMI ${r.bmiText}',
                      style: AppFonts.body(
                        fontSize: 11.5,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
      ],
    ),
  );
}

// ── small helpers ───────────────────────────────────────────────────────────

String _fmtDate(DateTime? d) {
  if (d == null || d.year <= 1) return '–';
  return DateFormat('dd MMM yyyy').format(d);
}

/// " (High BP)" — or nothing at all when the status is absent, so the line
/// never reads "BP 120/80 ()".
String _paren(String? s) =>
    (s == null || s.trim().isEmpty || s.trim() == 'None') ? '' : ' (${s.trim()})';

String _trimNum(double v) {
  final s = v.toStringAsFixed(1);
  return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
}

int? _i(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse(v.toString());
}

double? _d(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

String? _sn(dynamic v) {
  final s = v?.toString().trim();
  return (s == null || s.isEmpty) ? null : s;
}

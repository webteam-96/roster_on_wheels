import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/rotary_year_bar.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ── Models ────────────────────────────────────────────────────────────────────

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class _Year {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _Year({required this.id, required this.yearLabel, required this.isCurrent});
  factory _Year.fromJson(Map<String, dynamic> j) => _Year(
        id: (j['id'] as num?)?.toInt() ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _Month {
  final int month;
  final String monthName;
  final int submittedCount;
  final int notSubmittedCount;
  final int totalClubs;
  const _Month({
    required this.month,
    required this.monthName,
    required this.submittedCount,
    required this.notSubmittedCount,
    required this.totalClubs,
  });
  factory _Month.fromJson(Map<String, dynamic> j) {
    final submitted = j['submittedCount'] as int? ?? 0;
    final total = j['totalClubs'] as int? ?? 0;
    final notSubmitted = j['notSubmittedCount'] as int? ?? (total - submitted);
    return _Month(
      month: j['month'] as int? ?? 0,
      monthName: j['monthName'] as String? ?? '',
      submittedCount: submitted,
      notSubmittedCount: notSubmitted,
      totalClubs: total,
    );
  }
}

// ── Screen ────────────────────────────────────────────────────────────────────

class DistrictCmrScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictCmrScreen({super.key, required this.districtId, this.embedded = false});

  @override
  State<DistrictCmrScreen> createState() => _DistrictCmrScreenState();
}

class _DistrictCmrScreenState extends State<DistrictCmrScreen> {
  final ApiClient _api = ApiClient();

  List<_Year> _years = [];
  _Year? _selectedYear;
  List<_Month> _months = [];
  bool _loadingYears = true;
  bool _loadingMonths = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchYears();
  }

  Future<void> _fetchYears() async {
    setState(() {
      _loadingYears = true;
      _error = null;
    });
    try {
      final res = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/club-monthly-report/years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (res.data ?? [])
          .map((e) => _Year.fromJson(e as Map<String, dynamic>))
          .toList();
      _Year? current;
      if (years.isNotEmpty) {
        current = years.firstWhere(
          (y) => y.isCurrent,
          orElse: () => years.first,
        );
      }
      setState(() {
        _years = years;
        _selectedYear = current;
        _loadingYears = false;
      });
      if (current != null && current.id > 0) _fetchMonths(current);
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loadingYears = false;
      });
    }
  }

  Future<void> _fetchMonths(_Year year) async {
    setState(() {
      _loadingMonths = true;
      _months = [];
    });
    try {
      final res = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/club-monthly-report/months/${year.id}',
        fromJson: (j) => j as List<dynamic>,
      );
      setState(() {
        _months = (res.data ?? [])
            .map((e) => _Month.fromJson(e as Map<String, dynamic>))
            .toList();
        _loadingMonths = false;
      });
    } catch (_) {
      setState(() => _loadingMonths = false);
    }
  }

  void _onMonthTap(_Month month) {
    final year = _selectedYear;
    if (year == null) return;
    final encodedName = Uri.encodeComponent(month.monthName);
    context.push(
      '/districts/${widget.districtId}/club-monthly-report/${year.id}/${month.month}?name=$encodedName',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : const CustomAppBar(title: 'Club Monthly Report'),
      body: _loadingYears
          ? const LoadingWidget()
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetchYears)
              : _years.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.bar_chart_outlined,
                      title: 'No Reports',
                      subtitle: 'No report data available for this district.',
                    )
                  : Column(
                      children: [
                        _buildYearSelector(),
                        Expanded(child: _buildMonthList()),
                      ],
                    ),
    );
  }

  Widget _buildYearSelector() {
    return RotaryYearBar<int>(
      value: _selectedYear?.id,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      options: [
        for (final y in _years)
          RotaryYearOption(value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
      ],
      onChanged: (v) {
        if (v == null) return;
        final y = _years.firstWhere((e) => e.id == v);
        setState(() => _selectedYear = y);
        _fetchMonths(y);
      },
    );
  }

  Widget _buildMonthList() {
    if (_loadingMonths) return const LoadingWidget();
    if (_months.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.bar_chart_outlined,
        title: 'No months available',
        subtitle: 'No months available for this year.',
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () async {
        if (_selectedYear != null) await _fetchMonths(_selectedYear!);
      },
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: _months.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, i) => _MonthCard(
          month: _months[i],
          onTap: () => _onMonthTap(_months[i]),
        ),
      ),
    );
  }
}

// ── Month card ────────────────────────────────────────────────────────────────

class _MonthCard extends StatelessWidget {
  final _Month month;
  final VoidCallback onTap;
  const _MonthCard({required this.month, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final total = month.totalClubs;
    final submitted = month.submittedCount;
    final pending = month.notSubmittedCount;
    final pct = total > 0 ? submitted / total : 0.0;
    final pctInt = (pct * 100).round();

    final Color status = pctInt >= 100
        ? AppColors.success
        : (pctInt >= 50 ? AppColors.warningDark : AppColors.error);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            _ProgressRing(value: pct, label: '$pctInt%', color: status),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    month.monthName,
                    style: AppTextStyles.bodySemiBold,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: [
                      _StatPill(
                        icon: Icons.check_circle_rounded,
                        label: '$submitted Submitted',
                        color: AppColors.success,
                      ),
                      _StatPill(
                        icon: Icons.cancel_rounded,
                        label: '$pending Pending',
                        color: pending > 0 ? AppColors.error : AppColors.textMuted,
                      ),
                      _StatPill(
                        icon: Icons.groups_rounded,
                        label: '$total Clubs',
                        color: AppColors.textSecondary,
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right_rounded,
                color: AppColors.textMuted, size: 22),
          ],
        ),
      ),
    );
  }
}

/// Circular percentage ring used as the month card's leading indicator.
class _ProgressRing extends StatelessWidget {
  final double value;
  final String label;
  final Color color;
  const _ProgressRing(
      {required this.value, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 52,
      height: 52,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: 52,
            height: 52,
            child: CircularProgressIndicator(
              value: value.clamp(0.0, 1.0),
              strokeWidth: 5,
              backgroundColor: AppColors.muted,
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
          Text(
            label,
            style: AppTextStyles.caption.copyWith(
              color: color,
              fontWeight: FontWeight.w800,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

/// Small rounded stat pill (icon + label) for the submitted / pending / total
/// counts.
class _StatPill extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  const _StatPill(
      {required this.icon, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: AppTextStyles.caption.copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

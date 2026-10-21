import 'package:flutter/material.dart';

import '../../../../core/network/api_exceptions.dart';
import '../../../../core/services/goal_setting_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Month-wise Collection — District N" — mobile twin of web's
/// `DistrictMonthWiseReport`, opened by tapping a district row in the oversight
/// matrix. Read-only.
///
/// One table per category: metric rows × month columns, where each month shows
/// the CUMULATIVE achieved figure — the July 1st baseline plus every addition
/// up to that month — then the final Achieved and % Achievement. Same shape as
/// the Month-wise sheet of the District Goal Setting workbook.
Future<void> showGoalMonthWiseSheet(
  BuildContext context, {
  required int districtId,
  required String districtNumber,
  required int yearId,
  required List<GoalCategory> categories,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, controller) => _MonthWiseSheet(
        districtId: districtId,
        districtNumber: districtNumber,
        yearId: yearId,
        categories: categories,
        scrollController: controller,
      ),
    ),
  );
}

class _MonthWiseSheet extends StatefulWidget {
  final int districtId;
  final String districtNumber;
  final int yearId;
  final List<GoalCategory> categories;
  final ScrollController scrollController;

  const _MonthWiseSheet({
    required this.districtId,
    required this.districtNumber,
    required this.yearId,
    required this.categories,
    required this.scrollController,
  });

  @override
  State<_MonthWiseSheet> createState() => _MonthWiseSheetState();
}

class _MonthWiseSheetState extends State<_MonthWiseSheet> {
  final GoalSettingApi _api = GoalSettingApi();

  /// categoryId → its form, or null when that category has nothing month-wise.
  final Map<int, GoalMonthlyForm?> _forms = {};
  bool _loading = true;
  String? _error;

  static const double _metricW = 168;
  static const double _numW = 84;
  static const double _monthW = 62;
  static const double _headerH = 46;
  static const double _rowH = 40;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // All categories at once, as web does. A single category failing is
      // normal (it may collect nothing month-wise) and must not sink the rest,
      // so each is caught on its own.
      await Future.wait(widget.categories.map((c) async {
        try {
          _forms[c.id] = await _api.getScopedDistrictMonthly(
              c.id, widget.districtId, widget.yearId);
        } catch (e) {
          _forms[c.id] = null;
          // A 403 is the server's role gate and applies to every category —
          // surface it once rather than as four empty tables.
          if (e is ApiException && e.statusCode == 403) rethrow;
        }
      }));
      if (!mounted) return;
      setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = (e is ApiException && e.statusCode == 403)
            ? 'Month-wise collection is limited to Club/District Admins and '
                'Super Admins. Your goal-oversight role alone cannot open this.'
            : friendlyErrorMessage(e,
                fallback: 'Could not load month-wise collection.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      child: Column(
        children: [
          _header(),
          const Divider(height: 1, color: AppColors.slate100),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
      child: Row(
        children: [
          const Icon(Icons.calendar_month_rounded,
              size: 19, color: AppColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Month-wise Collection',
                  style: AppFonts.body(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'District ${widget.districtNumber} · read-only',
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
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.lock_outline_rounded,
                  size: 34, color: AppColors.error),
              const SizedBox(height: 10),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: AppFonts.body(
                  fontSize: 12.5,
                  height: 1.4,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return ListView(
      controller: widget.scrollController,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
      children: [
        for (final c in widget.categories) _categoryBlock(c),
      ],
    );
  }

  Widget _categoryBlock(GoalCategory c) {
    final form = _forms[c.id];
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: const BoxDecoration(
              color: AppColors.primaryDeep,
              borderRadius: BorderRadius.vertical(top: Radius.circular(10)),
            ),
            child: Text(
              c.name,
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
            ),
          ),
          if (form == null || form.fields.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.border),
                borderRadius:
                    const BorderRadius.vertical(bottom: Radius.circular(10)),
              ),
              child: Text(
                'No month-wise data for this category.',
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textMuted,
                ),
              ),
            )
          else
            _table(form),
        ],
      ),
    );
  }

  /// Frozen Metric column + horizontally scrolling figures. Row heights are
  /// fixed constants: the two sides are separate widget trees and must line up
  /// to the pixel.
  Widget _table(GoalMonthlyForm form) {
    final months = form.months;
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(10)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: _metricW,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _head('Metric', _metricW, align: TextAlign.left),
                for (var i = 0; i < form.fields.length; i++)
                  Container(
                    height: _rowH,
                    width: _metricW,
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(horizontal: 9),
                    decoration: BoxDecoration(
                      color: i.isEven ? Colors.white : AppColors.slate50,
                      border: const Border(
                          bottom: BorderSide(
                              color: AppColors.slate100, width: 1)),
                    ),
                    child: Text(
                      form.fields[i].fieldLabel,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                        fontSize: 11,
                        height: 1.15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Container(width: 1, color: AppColors.slate100),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _head('As on July 1st', _numW),
                      _head('Target', _numW),
                      for (final m in months)
                        _head(m.label, _monthW, dim: !m.isAvailable),
                      _head('Achieved', _numW),
                      _head('% Achievement', _numW),
                    ],
                  ),
                  for (var i = 0; i < form.fields.length; i++)
                    _row(form.fields[i], months, i),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(GoalMonthlyField f, List<GoalMonthPeriod> months, int index) {
    final bg = index.isEven ? Colors.white : AppColors.slate50;

    // An annual-only field is listed with its value but EMPTY month cells —
    // it is never collected month by month, so a running figure would be a lie.
    if (!f.monthlyTracked) {
      return Container(
        height: _rowH,
        decoration: BoxDecoration(
          color: bg,
          border: const Border(
              bottom: BorderSide(color: AppColors.slate100, width: 1)),
        ),
        child: Row(
          children: [
            _cell('–', _numW, muted: true),
            _cell(f.displayText ?? fmtGoalNumber(f.annualTarget), _numW),
            for (final _ in months) const SizedBox(width: _monthW),
            _cell('–', _numW, muted: true),
            _cell('–', _numW, muted: true),
          ],
        ),
      );
    }

    final cells = f.cumulative(months);
    final achieved = f.achieved(months);
    return Container(
      height: _rowH,
      decoration: BoxDecoration(
        color: bg,
        border: const Border(
            bottom: BorderSide(color: AppColors.slate100, width: 1)),
      ),
      child: Row(
        children: [
          _cell(fmtGoalNumber(f.baseline), _numW, muted: true),
          _cell(fmtGoalNumber(f.annualTarget), _numW),
          for (final v in cells) _cell(fmtGoalNumber(v), _monthW),
          _cell(fmtGoalNumber(achieved), _numW, bold: true),
          _cell(f.pctAchievedText(achieved), _numW,
              bold: true, color: AppColors.success),
        ],
      ),
    );
  }

  Widget _head(
    String text,
    double width, {
    TextAlign align = TextAlign.right,
    bool dim = false,
  }) {
    return Container(
      width: width,
      height: _headerH,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      alignment:
          align == TextAlign.left ? Alignment.centerLeft : Alignment.bottomRight,
      decoration: const BoxDecoration(
        color: AppColors.primaryPrime,
        border: Border(left: BorderSide(color: Colors.white24, width: 1)),
      ),
      child: Text(
        text,
        textAlign: align,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: AppFonts.body(
          fontSize: 9.5,
          height: 1.15,
          fontWeight: FontWeight.w700,
          color: dim ? Colors.white38 : Colors.white,
        ),
      ),
    );
  }

  Widget _cell(
    String text,
    double width, {
    bool bold = false,
    bool muted = false,
    Color? color,
  }) {
    return Container(
      width: width,
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: AppColors.slate100, width: 1)),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppFonts.body(
          fontSize: 11,
          fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
          color: color ??
              (muted || text == '–'
                  ? AppColors.textMuted
                  : AppColors.textPrimary),
        ),
      ),
    );
  }
}

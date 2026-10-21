import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Day-month-only picker for **birthdays & anniversaries**.
///
/// The Rotary backend stores these with a `1900` placeholder year and never
/// collects a year (it normalizes whatever year we send to 1900), so asking for
/// one is misleading. This sheet collects only month + day and returns a
/// [DateTime] carrying a fixed leap-safe reference year ([_refYear]) — callers
/// send the month/day; the server overwrites the year.
///
/// Returns `null` if the user dismisses without confirming (keep the existing
/// value). Clearing a value is handled by the caller's field, not here.
Future<DateTime?> showDayMonthPicker(
  BuildContext context, {
  DateTime? initial,
}) {
  return showModalBottomSheet<DateTime>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (_) => _DayMonthSheet(initial: initial),
  );
}

// Leap year so 29 Feb is selectable; the year is never shown or persisted.
const int _refYear = 2000;

const List<String> _monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

int _daysInMonth(int month) => DateTime(_refYear, month + 1, 0).day;

class _DayMonthSheet extends StatefulWidget {
  final DateTime? initial;
  const _DayMonthSheet({this.initial});

  @override
  State<_DayMonthSheet> createState() => _DayMonthSheetState();
}

class _DayMonthSheetState extends State<_DayMonthSheet> {
  late int _month; // 1-12
  late int _day; // 1-31

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    _month = (init != null && init.year > 1) ? init.month : DateTime.now().month;
    final initDay = (init != null && init.year > 1) ? init.day : DateTime.now().day;
    _day = initDay.clamp(1, _daysInMonth(_month));
  }

  void _onMonthChanged(int month) {
    setState(() {
      _month = month;
      // Clamp the day if the new month is shorter (e.g. 31 → Feb).
      _day = _day.clamp(1, _daysInMonth(month));
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.slate200,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Select day & month',
              style: AppFonts.body(
                fontSize: 15,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Year is not stored for birthdays & anniversaries.',
              style: AppFonts.body(
                fontSize: 11.5,
                color: AppColors.slate500,
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: DropdownButtonFormField<int>(
                    initialValue: _month,
                    isExpanded: true,
                    decoration: _decoration('Month'),
                    items: [
                      for (var m = 1; m <= 12; m++)
                        DropdownMenuItem(value: m, child: Text(_monthNames[m - 1])),
                    ],
                    onChanged: (m) => m == null ? null : _onMonthChanged(m),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: DropdownButtonFormField<int>(
                    initialValue: _day,
                    isExpanded: true,
                    decoration: _decoration('Day'),
                    items: [
                      for (var d = 1; d <= _daysInMonth(_month); d++)
                        DropdownMenuItem(value: d, child: Text('$d')),
                    ],
                    onChanged: (d) => setState(() => _day = d ?? _day),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            SizedBox(
              height: 46,
              child: ElevatedButton(
                onPressed: () =>
                    Navigator.of(context).pop(DateTime(_refYear, _month, _day)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                child: Text(
                  'Done',
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _decoration(String label) => InputDecoration(
        labelText: label,
        filled: true,
        fillColor: AppColors.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.border),
        ),
      );
}

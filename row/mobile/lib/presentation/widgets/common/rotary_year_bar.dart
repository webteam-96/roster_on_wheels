import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// A single selectable option inside a [RotaryYearBar].
///
/// [value] is what the dropdown reports on change (usually a year id `int`,
/// but any type works — Membership Dues keys by year label `String`).
/// [label] is the visible text; when [isCurrent] is true a " (Current)"
/// suffix is appended automatically so every screen reads the same.
class RotaryYearOption<T> {
  final T value;
  final String label;
  final bool isCurrent;

  const RotaryYearOption({
    required this.value,
    required this.label,
    this.isCurrent = false,
  });
}

/// Standardized "Rotary Year" selector bar used across every module.
///
/// Compact bordered surface: a calendar icon, the "Rotary Year" label, and a
/// trailing dropdown. This is the single source of truth for the year-picker
/// look — screens map their own year lists into [RotaryYearOption]s and pass
/// their selected value + change handler, so the visual stays identical
/// everywhere (dashboards, website-data, reports, payments, quick links).
class RotaryYearBar<T> extends StatelessWidget {
  final T? value;
  final List<RotaryYearOption<T>> options;

  /// Change handler. Pass `null` to disable the picker (it greys out, matching
  /// a plain [DropdownButton]) — e.g. while a save is in flight.
  final ValueChanged<T?>? onChanged;
  final String label;

  /// Outer padding. Defaults to the standard list-header inset; pass
  /// [EdgeInsets.zero] when the caller already provides its own padding.
  final EdgeInsetsGeometry margin;

  const RotaryYearBar({
    super.key,
    required this.value,
    required this.options,
    this.onChanged,
    this.label = 'Rotary Year',
    this.margin = const EdgeInsets.fromLTRB(16, 12, 16, 0),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            const Icon(Icons.calendar_today_rounded,
                size: 15, color: AppColors.textSecondary),
            const SizedBox(width: 8),
            Text(
              label,
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
            const Spacer(),
            DropdownButton<T>(
              value: value,
              underline: const SizedBox.shrink(),
              isDense: true,
              borderRadius: BorderRadius.circular(12),
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
              onChanged: onChanged,
              items: [
                for (final o in options)
                  DropdownMenuItem<T>(
                    value: o.value,
                    child: Text(
                      '${o.label}${o.isCurrent ? " (Current)" : ""}',
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

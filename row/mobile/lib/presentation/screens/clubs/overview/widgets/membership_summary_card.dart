import 'package:flutter/material.dart';

import '../../../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Plain, mobile-friendly membership summary used by both the Club Admin
/// Overview and Directory sub-tabs. Shows a hero Total with a clearly-labeled
/// 2×2 breakdown (Paid · Honorary · Male · Female) — no charts, every number
/// is plainly labeled.
class MembershipSummaryCard extends StatelessWidget {
  final int total;
  final int paid;
  final int male;
  final int female;
  final int honorary;

  /// New members this Rotary year. Renders a green pill when > 0; pass 0 to
  /// hide it (e.g. on surfaces that don't carry the figure).
  final int newThisYear;

  const MembershipSummaryCard({
    super.key,
    required this.total,
    required this.paid,
    required this.male,
    required this.female,
    required this.honorary,
    this.newThisYear = 0,
  });

  // Member-segment colors, kept in sync with the Membership chart legend.
  static const Color _cMale = AppColors.avenueInternational;
  static const Color _cFemale = AppColors.avenueClubService;
  static const Color _cHonorary = AppColors.avenueNewGen;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: section label + "new this year" pill.
          Row(
            children: [
              Expanded(
                child: Text(
                  'MEMBERSHIP',
                  style: AppFonts.body(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.slate500,
                    letterSpacing: 0.6,
                  ),
                ),
              ),
              if (newThisYear > 0)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.successLight,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '+$newThisYear this RY',
                    style: AppFonts.body(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.success,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          // Hero total.
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                '$total',
                style: AppFonts.body(
                  fontSize: 34,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  height: 1.0,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  'Total Members',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
            ],
          ),
          const Divider(height: 22, color: AppColors.slate100),
          // Plain labeled breakdown — two rows of two.
          Row(
            children: [
              Expanded(
                child: _BreakdownStat(
                    color: AppColors.rotaryBlue, label: 'Paid', value: paid),
              ),
              Expanded(
                child: _BreakdownStat(
                    color: _cHonorary, label: 'Honorary', value: honorary),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _BreakdownStat(color: _cMale, label: 'Male', value: male),
              ),
              Expanded(
                child: _BreakdownStat(
                    color: _cFemale, label: 'Female', value: female),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One labeled breakdown stat: colored dot + label, with the count beneath.
class _BreakdownStat extends StatelessWidget {
  final Color color;
  final String label;
  final int value;
  const _BreakdownStat({
    required this.color,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 7),
            Text(
              label,
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
        const SizedBox(height: 3),
        Padding(
          padding: const EdgeInsets.only(left: 16),
          child: Text(
            '$value',
            style: AppFonts.body(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              height: 1.0,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ],
    );
  }
}

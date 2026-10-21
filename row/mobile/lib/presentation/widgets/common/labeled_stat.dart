import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// A caption-over-value atom. Renders "—" (slate400) when [value] is empty.
class LabeledStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final TextAlign align;
  const LabeledStat({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
    this.align = TextAlign.start,
  });

  @override
  Widget build(BuildContext context) {
    final empty = value.trim().isEmpty;
    final cross = align == TextAlign.center
        ? CrossAxisAlignment.center
        : CrossAxisAlignment.start;
    return Column(
      crossAxisAlignment: cross,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          textAlign: align,
          style: AppFonts.body(
            fontSize: 9.5,
            fontWeight: FontWeight.w700,
            color: AppColors.slate500,
            letterSpacing: 0.3,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 3),
        Text(
          empty ? '–' : value,
          textAlign: align,
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: empty
                ? AppColors.slate400
                : (valueColor ?? AppColors.textPrimary),
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }
}

/// A row of [LabeledStat]s separated by thin vertical dividers. Replaces every
/// "· "-joined unlabeled string.
class StatGrid extends StatelessWidget {
  final List<LabeledStat> stats;
  const StatGrid({super.key, required this.stats});

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    for (var i = 0; i < stats.length; i++) {
      children.add(Expanded(child: stats[i]));
      if (i != stats.length - 1) {
        children.add(Container(
          width: 1,
          height: 30,
          margin: const EdgeInsets.symmetric(horizontal: 10),
          color: AppColors.slate100,
        ));
      }
    }
    return Row(crossAxisAlignment: CrossAxisAlignment.center, children: children);
  }
}

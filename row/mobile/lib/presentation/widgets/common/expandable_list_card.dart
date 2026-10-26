import 'package:flutter/material.dart' hide Text;

import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// A bordered list card that shows the first [collapsedCount] rows and, when
/// there are more, a tappable "Show all N more / Show less" toggle so every
/// row is reachable (replaces silent truncation / dead "...and N more" text).
class ExpandableListCard extends StatefulWidget {
  final List<Widget> rows;
  final int collapsedCount;

  const ExpandableListCard({
    super.key,
    required this.rows,
    this.collapsedCount = 50,
  });

  @override
  State<ExpandableListCard> createState() => _ExpandableListCardState();
}

class _ExpandableListCardState extends State<ExpandableListCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows;
    final visible =
        _expanded ? rows : rows.take(widget.collapsedCount).toList();
    final hidden = rows.length - visible.length;

    final children = <Widget>[];
    for (var i = 0; i < visible.length; i++) {
      children.add(visible[i]);
      if (i != visible.length - 1) {
        children.add(const Divider(height: 1, color: AppColors.border));
      }
    }

    if (rows.length > widget.collapsedCount) {
      children.add(const Divider(height: 1, color: AppColors.border));
      children.add(
        InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              children: [
                Icon(
                  _expanded
                      ? Icons.expand_less_rounded
                      : Icons.expand_more_rounded,
                  size: 18,
                  color: AppColors.primaryPrime,
                ),
                const SizedBox(width: 4),
                Text(
                  _expanded ? 'Show less' : 'Show all $hidden more',
                  style: AppFonts.body(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryPrime,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(children: children),
    );
  }
}

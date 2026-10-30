import 'package:flutter/material.dart';
import '../../../core/theme/row_tokens.dart';

/// Loading placeholder in the shape of a list (design.md 8.3: skeletons, never a lone spinner).
/// Static cream-2 bars; it respects reduced motion by not animating at all.
class RowSkeletonList extends StatelessWidget {
  const RowSkeletonList({super.key, this.rows = 6});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading',
      liveRegion: true,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        physics: const NeverScrollableScrollPhysics(),
        shrinkWrap: true,
        itemCount: rows,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, __) => Container(
          height: 64,
          decoration: BoxDecoration(
            color: RowTone.cream2.fill,
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }
}

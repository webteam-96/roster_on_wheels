import 'package:flutter/material.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';
import 'package:shimmer/shimmer.dart';

/// A soft light passing over placeholder shapes; still with reduced motion.
class RowShimmer extends StatelessWidget {
  const RowShimmer({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Shimmer.fromColors(
        baseColor: AppColors.skeleton,
        highlightColor: AppColors.shimmerHighlight,
        period: const Duration(milliseconds: 1600),
        enabled: !RowMotion.still(context),
        child: child,
      );
}

/// Loading placeholder in the shape of the list to come (design.md 8.3: skeletons, never a lone spinner):
/// a round picture, a title and a second line per row.
class RowSkeletonList extends StatelessWidget {
  const RowSkeletonList({super.key, this.rows = 6});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading',
      liveRegion: true,
      child: RowShimmer(
        child: ListView.separated(
          padding: const EdgeInsets.all(16),
          physics: const NeverScrollableScrollPhysics(),
          shrinkWrap: true,
          itemCount: rows,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (_, i) => SizedBox(
            height: 64,
            child: Row(
              children: [
                const _Bone(width: 44, height: 44),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      FractionallySizedBox(widthFactor: i.isEven ? .62 : .48, child: const _Bone(height: 14)),
                      const SizedBox(height: 10),
                      FractionallySizedBox(widthFactor: i.isEven ? .85 : .74, child: const _Bone(height: 10)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Bone extends StatelessWidget {
  const _Bone({this.width, required this.height});

  final double? width;
  final double height;

  @override
  Widget build(BuildContext context) => Container(
        width: width,
        height: height,
        decoration: BoxDecoration(color: AppColors.skeleton, borderRadius: BorderRadius.circular(RowRadii.pill)),
      );
}

import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

/// Loading, whatever the space: a whole page shows skeleton rows; a small box or a spot inside scrolling content
/// shows the pulsing dots.
class LoadingWidget extends StatelessWidget {
  const LoadingWidget({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      if (box.maxWidth < 240 || box.maxHeight < 320 || !box.hasBoundedHeight) {
        return const Center(child: RowLoader());
      }
      final rows = ((box.maxHeight - 32) / 76).floor().clamp(3, 10);
      return Align(alignment: Alignment.topCenter, child: RowSkeletonList(rows: rows));
    });
  }
}

class ShimmerList extends StatelessWidget {
  final int itemCount;
  final double itemHeight;
  final EdgeInsetsGeometry? padding;

  const ShimmerList({
    super.key, 
    this.itemCount = 6, 
    this.itemHeight = 84,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    return RowShimmer(
      child: ListView.separated(
        itemCount: itemCount,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        padding: padding ?? const EdgeInsets.all(AppSpacing.md),
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, __) => Container(
          height: itemHeight,
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(20),
          ),
        ),
      ),
    );
  }
}

class ShimmerCard extends StatelessWidget {
  final double height;
  final double? width;
  final double borderRadius;

  const ShimmerCard({
    super.key, 
    this.height = 120, 
    this.width,
    this.borderRadius = 20,
  });

  @override
  Widget build(BuildContext context) {
    return RowShimmer(
      child: Container(
        height: height,
        width: width ?? double.infinity,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(borderRadius),
        ),
      ),
    );
  }
}

class FullScreenLoader extends StatelessWidget {
  final String? message;
  const FullScreenLoader({super.key, this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const RowLoader(size: 48),
          if (message != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              message!, 
              style: AppFonts.body(
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

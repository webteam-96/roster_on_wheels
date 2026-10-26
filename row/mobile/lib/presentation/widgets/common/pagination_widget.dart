import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class PaginationWidget extends StatelessWidget {
  final int currentPage;
  final int totalPages;
  final int totalCount;
  final bool isLoading;
  final VoidCallback? onLoadMore;

  const PaginationWidget({
    super.key,
    required this.currentPage,
    required this.totalPages,
    required this.totalCount,
    this.isLoading = false,
    this.onLoadMore,
  });

  @override
  Widget build(BuildContext context) {
    if (totalPages <= 1 && currentPage >= totalPages) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        children: [
          Text(
            'Showing page $currentPage of $totalPages ($totalCount total)',
            style: AppTextStyles.caption,
          ),
          if (currentPage < totalPages) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: isLoading ? null : onLoadMore,
                child: isLoading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: const CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                      )
                    : const Text('Load More'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

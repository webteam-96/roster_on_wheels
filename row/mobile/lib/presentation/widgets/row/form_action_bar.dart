import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';

/// Pinned bottom bar for a form's primary action (design.md 8.6): always visible, full width, cream with a
/// hairline above, clear of the system gesture area.
class RowFormActionBar extends StatelessWidget {
  const RowFormActionBar({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.lightBg,
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: child,
        ),
      ),
    );
  }
}

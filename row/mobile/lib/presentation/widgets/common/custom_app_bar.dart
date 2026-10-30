import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// ROW app bar (design.md 8.4): cream surface, ink title in the display face, 44px back button,
/// no elevation, a hairline underneath. [useGradient] is kept so existing callers compile; the
/// blue bar it used to draw is gone.
class CustomAppBar extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final TextStyle? titleStyle;
  final List<Widget>? actions;
  final bool showBack;
  final VoidCallback? onBack;
  final Widget? leading;
  final Color? backgroundColor;
  final bool centerTitle;
  final bool useGradient;
  final PreferredSizeWidget? bottom;

  const CustomAppBar({
    super.key,
    required this.title,
    this.titleStyle,
    this.actions,
    this.showBack = true,
    this.onBack,
    this.leading,
    this.backgroundColor,
    this.centerTitle = false,
    this.useGradient = true,
    this.bottom,
  });

  @override
  Widget build(BuildContext context) {
    final back = onBack ?? (showBack && context.canPop() ? () => context.pop() : null);
    return AppBar(
      backgroundColor: backgroundColor ?? AppColors.lightBg,
      surfaceTintColor: AppColors.lightBg,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: centerTitle,
      shape: const Border(bottom: BorderSide(color: AppColors.line)),
      automaticallyImplyLeading: false,
      leading: leading ??
          (back == null
              ? null
              : IconButton(
                  icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: AppColors.textPrimary),
                  constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                  onPressed: back,
                )),
      title: Text(
        title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: (titleStyle ?? AppFonts.display(fontSize: 20, fontWeight: FontWeight.w600))
            .copyWith(color: AppColors.textPrimary),
      ),
      actions: actions,
      iconTheme: const IconThemeData(color: AppColors.textPrimary),
      actionsIconTheme: const IconThemeData(color: AppColors.textPrimary),
      bottom: bottom,
    );
  }

  @override
  Size get preferredSize => Size.fromHeight(
        kToolbarHeight + (bottom?.preferredSize.height ?? 0),
      );
}

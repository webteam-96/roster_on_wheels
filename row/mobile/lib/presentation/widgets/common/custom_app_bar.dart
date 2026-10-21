import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

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
    this.centerTitle = true,
    this.useGradient = true,
    this.bottom,
  });

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: useGradient ? Colors.transparent : (backgroundColor ?? AppColors.white),
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: centerTitle,
      flexibleSpace: useGradient
          ? Container(
              decoration: const BoxDecoration(
                gradient: AppGradients.royalSweep,
              ),
            )
          : null,
      automaticallyImplyLeading: false,
      leading: leading ??
          (onBack != null
              ? IconButton(
                  icon: Icon(Icons.arrow_back_ios_new_rounded, size: 20,
                      color: useGradient ? AppColors.white : AppColors.textPrimary),
                  onPressed: onBack,
                )
              : (showBack && context.canPop()
                  ? IconButton(
                      icon: Icon(Icons.arrow_back_ios_new_rounded, size: 20,
                          color: useGradient ? AppColors.white : AppColors.textPrimary),
                      onPressed: () {
                        if (context.canPop()) context.pop();
                      },
                    )
                  : null)),
      title: Text(
        title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: (titleStyle ?? AppFonts.body(fontSize: 20,
          fontWeight: FontWeight.w700,
        )).copyWith(
          color: titleStyle?.color ?? (useGradient ? AppColors.white : AppColors.textPrimary),
        ),
      ),
      actions: actions,
      iconTheme: IconThemeData(
        color: useGradient ? AppColors.white : AppColors.textPrimary,
      ),
      bottom: bottom,
    );
  }

  @override
  Size get preferredSize => Size.fromHeight(
        kToolbarHeight + (bottom?.preferredSize.height ?? 0),
      );
}

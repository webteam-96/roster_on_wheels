import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';

/// Pull-to-refresh wrapper for the club & district dashboard tabs.
///
/// Two shapes, matching the two ways the tabs are built:
///
///  * [DashboardRefresh] — **owns** the scroll view. Use when the tab body is a
///    plain `Column`/content. It builds the `SingleChildScrollView` for you with
///    [AlwaysScrollableScrollPhysics] so the pull gesture fires even when the
///    content is shorter than the viewport.
///
///  * [DashboardRefresh.around] — wraps an **existing** scrollable subtree (a
///    body widget that already contains its own `SingleChildScrollView`). That
///    inner scroll view must use [AlwaysScrollableScrollPhysics] for the gesture
///    to trigger on short content.
///
/// [onRefresh] should re-issue the tab's fetch and complete when it settles —
/// the spinner stays up until the returned future resolves.
class DashboardRefresh extends StatelessWidget {
  final Future<void> Function() onRefresh;
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final bool _ownScroll;

  const DashboardRefresh({
    super.key,
    required this.onRefresh,
    required this.child,
    this.padding,
  }) : _ownScroll = true;

  const DashboardRefresh.around({
    super.key,
    required this.onRefresh,
    required this.child,
  })  : padding = null,
        _ownScroll = false;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: AppColors.rotaryBlue,
      onRefresh: onRefresh,
      child: _ownScroll
          ? SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: padding,
              child: child,
            )
          : child,
    );
  }
}

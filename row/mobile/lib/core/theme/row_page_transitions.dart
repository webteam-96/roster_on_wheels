import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'row_tokens.dart';

/// Where the finger just lifted: the card the next page should grow out of (see `RowPressable.morph`).
class RowMorphOrigin {
  static Rect? _rect;
  static DateTime _at = DateTime(0);

  static void remember(Rect rect) {
    _rect = rect;
    _at = DateTime.now();
  }

  /// The card's rectangle, once, and only if it was pressed a moment ago: a page opened later by something else
  /// must not grow out of it.
  static Rect? take() {
    final rect = _rect;
    _rect = null;
    return DateTime.now().difference(_at) < const Duration(milliseconds: 600) ? rect : null;
  }
}

/// ROW page transitions for every route (GoRouter and MaterialPageRoute alike):
///  * a page opened from a morph card grows out of that card and shrinks back into it;
///  * the sign-in flow (splash, terms, login, welcome, home) fades through, because it has no "back";
///  * everything else slides in a little and fades.
/// With reduced motion all three are a plain fade.
class RowPageTransitionsBuilder extends PageTransitionsBuilder {
  const RowPageTransitionsBuilder();

  static final _origins = Expando<({Rect? rect})>();

  /// Root screens reached with `go`, which replace each other.
  static const _roots = {'/splash', '/login', '/welcome', '/home', '/app-lock'};

  @override
  Duration get transitionDuration => RowMotion.morph;

  @override
  Duration get reverseTransitionDuration => RowMotion.ui;

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final origin = (_origins[route] ??= (rect: RowMorphOrigin.take())).rect;
    final still = RowMotion.still(context);
    final root = _roots.contains(route.settings.name);
    // One tree shape for every style, so the page keeps its state when a transition ends.
    return AnimatedBuilder(
      animation: animation,
      child: RepaintBoundary(child: child),
      builder: (context, child) {
        final v = animation.value;
        if (still || root || origin == null) {
          final t = RowMotion.easeOut.transform(v);
          final offset = still
              ? Offset.zero
              : root
                  ? Offset(0, 12 * (1 - t))
                  : Offset(56 * (1 - t), 0);
          return _frame(
            opacity: (v / .55).clamp(0, 1),
            matrix: Matrix4.translationValues(offset.dx, offset.dy, 0),
            child: child!,
          );
        }
        final size = MediaQuery.sizeOf(context);
        final t = Curves.easeInOutCubicEmphasized.transform(v);
        final rect = Rect.lerp(origin, Offset.zero & size, t)!;
        final scale = rect.width / size.width;
        return _frame(
          clip: v < 1 ? rect : null,
          radius: RowRadii.tile * (1 - t),
          opacity: ((v - .08) / .3).clamp(0, 1),
          fill: v < 1 ? (v / .2).clamp(0.0, 1.0) : 0,
          matrix: Matrix4.identity()
            ..translateByDouble(rect.left, rect.top, 0, 1)
            ..scaleByDouble(scale, scale, 1, 1),
          child: child!,
        );
      },
    );
  }

  Widget _frame({
    Rect? clip,
    double radius = 0,
    required double opacity,
    double fill = 0,
    required Matrix4 matrix,
    required Widget child,
  }) =>
      ClipRRect(
        clipper: _CardClip(clip, radius),
        clipBehavior: clip == null ? Clip.none : Clip.antiAlias,
        child: ColoredBox(
          color: AppColors.lightBg.withValues(alpha: fill),
          child: Opacity(
            opacity: opacity,
            child: Transform(transform: matrix, child: child),
          ),
        ),
      );
}

class _CardClip extends CustomClipper<RRect> {
  const _CardClip(this.rect, this.radius);

  final Rect? rect;
  final double radius;

  @override
  RRect getClip(Size size) => RRect.fromRectAndRadius(rect ?? Offset.zero & size, Radius.circular(radius));

  @override
  bool shouldReclip(_CardClip old) => old.rect != rect || old.radius != radius;
}

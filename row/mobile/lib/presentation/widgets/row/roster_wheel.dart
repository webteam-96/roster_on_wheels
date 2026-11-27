import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';

/// Three brand dots (blue, blue, gold). [phase] 0..1 lights them one after another; no spinning
/// (owner 2026-11-27: no wheel loader anywhere).
class RowDots extends StatelessWidget {
  const RowDots(
      {super.key,
      required this.size,
      this.phase,
      this.color = AppColors.primaryPrime,
      this.accent = AppColors.goldPrime});

  /// Width of the row of dots.
  final double size;

  /// null: all dots half lit (still, e.g. reduced motion).
  final double? phase;
  final Color color;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final dot = size / 4.2;
    return SizedBox(
      width: size,
      height: dot * 1.4,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          for (var i = 0; i < 3; i++)
            Builder(builder: (_) {
              final p = phase;
              // Each dot peaks a third of a cycle after the one before it.
              final lit = p == null
                  ? .6
                  : .35 +
                      .65 *
                          math.max(
                              0.0, math.cos(((p - i / 3) % 1) * 2 * math.pi));
              return Transform.scale(
                scale: .75 + .25 * lit,
                child: Container(
                  width: dot,
                  height: dot,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: (i == 2 ? accent : color).withValues(alpha: lit),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

/// The busy mark: three dots pulse in turn. Still (but visible) with reduced motion.
class RowLoader extends StatefulWidget {
  const RowLoader(
      {super.key,
      this.size = 40,
      this.color = AppColors.primaryPrime,
      this.accent = AppColors.goldPrime});

  final double size;
  final Color color;
  final Color accent;

  @override
  State<RowLoader> createState() => _RowLoaderState();
}

class _RowLoaderState extends State<RowLoader>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 1100));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (RowMotion.still(context)) {
      _controller.stop();
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Loading',
        child: RepaintBoundary(
          child: AnimatedBuilder(
            animation: _controller,
            builder: (_, __) => RowDots(
              size: widget.size,
              phase: _controller.isAnimating ? _controller.value : null,
              color: widget.color,
              accent: widget.accent,
            ),
          ),
        ),
      );
}

/// Blocks the screen while a tap is being resolved; show it as a dialog.
class RowBusy extends StatelessWidget {
  const RowBusy({super.key});

  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          width: 88,
          height: 88,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
              color: AppColors.surface, shape: BoxShape.circle),
          child: const RowLoader(size: 48),
        ),
      );
}

/// Pull to refresh: a disc rolls down with the finger, its dots light up, and they pulse while the data loads. Drop-in for
/// [RefreshIndicator]; the colour arguments of existing callers are accepted and ignored (one brand look).
class RowRefresh extends StatefulWidget {
  const RowRefresh({
    super.key,
    required this.onRefresh,
    required this.child,
    Color? color,
    Color? backgroundColor,
    this.notificationPredicate = defaultScrollNotificationPredicate,
  });

  final RefreshCallback onRefresh;
  final Widget child;
  final ScrollNotificationPredicate notificationPredicate;

  @override
  State<RowRefresh> createState() => _RowRefreshState();
}

class _RowRefreshState extends State<RowRefresh>
    with SingleTickerProviderStateMixin {
  static const _disc = 48.0;
  static const _rest = 24.0; // gap above the disc while loading

  /// How far the disc is out, 0 to 1 (a little past 1 while pulling).
  late final _out =
      AnimationController(vsync: this, upperBound: 1.6, duration: RowMotion.ui);
  bool _loading = false;
  bool _pulling = false;

  @override
  void dispose() {
    _out.dispose();
    super.dispose();
  }

  bool _onScroll(ScrollNotification n) {
    if (!_pulling ||
        _loading ||
        !widget.notificationPredicate(n) ||
        n.metrics.axis != Axis.vertical) return false;
    // Clamping lists report overscroll, bouncing lists go negative.
    if (n is OverscrollNotification &&
        n.dragDetails != null &&
        n.overscroll < 0) {
      _out.value += -n.overscroll / 220;
    } else if (n is ScrollUpdateNotification && n.dragDetails != null) {
      _out.value = n.metrics.pixels < 0
          ? -n.metrics.pixels / 130
          : _out.value - (n.scrollDelta ?? 0).clamp(0, 400) / 220;
    }
    return false;
  }

  void _onStatus(RefreshIndicatorStatus? status) {
    switch (status) {
      case RefreshIndicatorStatus.drag || RefreshIndicatorStatus.armed:
        _pulling = true;
      case RefreshIndicatorStatus.snap || RefreshIndicatorStatus.refresh:
        _pulling = false;
        if (!_loading) setState(() => _loading = true);
        _out.animateTo(1, curve: RowMotion.easeOut);
      default:
        _pulling = false;
        _out
            .animateBack(0, curve: RowMotion.easeInOut)
            .whenCompleteOrCancel(() {
          if (mounted && _loading) setState(() => _loading = false);
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return RefreshIndicator.noSpinner(
      onRefresh: widget.onRefresh,
      onStatusChange: _onStatus,
      notificationPredicate: widget.notificationPredicate,
      child: NotificationListener<ScrollNotification>(
        onNotification: _onScroll,
        child: Stack(
          fit: StackFit
              .passthrough, // the page keeps its full height, so short pages can be pulled too
          children: [
            widget.child,
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: IgnorePointer(
                child: AnimatedBuilder(
                  animation: _out,
                  builder: (_, __) {
                    final v = _out.value;
                    if (v == 0) return const SizedBox.shrink();
                    return Opacity(
                      opacity: (v * 1.6).clamp(0, 1),
                      child: Transform.translate(
                        offset: Offset(0, -_disc + (top + _disc + _rest) * v),
                        child: Center(
                          child: Container(
                            width: _disc,
                            height: _disc,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              shape: BoxShape.circle,
                              border: Border.all(color: AppColors.line),
                            ),
                            child: _loading
                                ? const RowLoader(size: 28)
                                : RowDots(size: 28, phase: v * .75),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

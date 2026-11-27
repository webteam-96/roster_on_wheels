import 'package:flutter/gestures.dart' show kTouchSlop;
import 'package:flutter/material.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart' as i18n;
import 'package:rotary_flutter_app/core/theme/row_page_transitions.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';

// ROW motion kit (design.md 4 and 8.8). One widget per job, all silent when the phone asks for reduced motion.

/// Arrival: fades and rises into place once, staggered by [index]. Plays only for the first screenful; anything
/// met while scrolling is already in place.
class RowReveal extends StatefulWidget {
  const RowReveal({super.key, this.index = 0, this.delay = Duration.zero, this.axis = Axis.vertical, this.distance = 18, required this.child});

  final int index;

  /// Extra wait, for something that follows a longer moment.
  final Duration delay;

  /// Direction of travel: up for vertical content, sideways for horizontal rows.
  final Axis axis;
  final double distance;
  final Widget child;

  @override
  State<RowReveal> createState() => _RowRevealState();
}

class _RowRevealState extends State<RowReveal> with SingleTickerProviderStateMixin {
  AnimationController? _controller;
  late Animation<double> _in;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_controller != null) return;
    final scroll = context.findAncestorStateOfType<ScrollableState>()?.position;
    final scrolled = scroll != null && scroll.hasPixels && scroll.pixels.abs() > 1;
    final wait = widget.delay + RowMotion.stagger * widget.index;
    final total = wait + RowMotion.arrive;
    _controller = AnimationController(vsync: this, duration: total);
    _in = CurvedAnimation(
      parent: _controller!,
      curve: Interval(wait.inMicroseconds / total.inMicroseconds, 1, curve: RowMotion.easeOut),
    );
    if (scrolled || widget.index >= RowMotion.staggerMax || RowMotion.still(context)) {
      _controller!.value = 1;
    } else {
      _controller!.forward();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _in,
      alwaysIncludeSemantics: true,
      child: AnimatedBuilder(
        animation: _in,
        child: widget.child,
        builder: (_, child) {
          final d = widget.distance * (1 - _in.value);
          return Transform.translate(offset: widget.axis == Axis.vertical ? Offset(0, d) : Offset(d, 0), child: child);
        },
      ),
    );
  }
}

/// Reveals each child of a [Column] or [ListView] in order.
List<Widget> revealAll(List<Widget> children, {int from = 0, Axis axis = Axis.vertical}) =>
    [for (final (i, c) in children.indexed) RowReveal(key: _keyFor(c), index: from + i, axis: axis, child: c)];

// The child's own key moves up to the reveal, so reordering and Dismissible lists keep their identity.
Key? _keyFor(Widget child) => child.key is LocalKey ? ValueKey(child.key) : null;

NullableIndexedWidgetBuilder _revealing(NullableIndexedWidgetBuilder builder, Axis axis) => (context, i) {
      final child = builder(context, i);
      return child == null ? null : RowReveal(key: _keyFor(child), index: i, axis: axis, child: child);
    };

/// [ListView] whose rows arrive in a stagger. Same constructors and arguments.
class RowListView extends ListView {
  RowListView.builder({
    super.key,
    super.scrollDirection,
    super.reverse,
    super.controller,
    super.primary,
    super.physics,
    super.shrinkWrap,
    super.padding,
    super.itemExtent,
    super.itemCount,
    super.keyboardDismissBehavior,
    required NullableIndexedWidgetBuilder itemBuilder,
  }) : super.builder(itemBuilder: _revealing(itemBuilder, scrollDirection));

  RowListView.separated({
    super.key,
    super.scrollDirection,
    super.reverse,
    super.controller,
    super.primary,
    super.physics,
    super.shrinkWrap,
    super.padding,
    super.keyboardDismissBehavior,
    required super.itemCount,
    required super.separatorBuilder,
    required NullableIndexedWidgetBuilder itemBuilder,
  }) : super.separated(itemBuilder: _revealing(itemBuilder, scrollDirection));
}

/// [GridView] whose tiles arrive in a stagger. Same constructors and arguments.
class RowGridView extends GridView {
  RowGridView.builder({
    super.key,
    super.controller,
    super.physics,
    super.shrinkWrap,
    super.padding,
    super.itemCount,
    required super.gridDelegate,
    required NullableIndexedWidgetBuilder itemBuilder,
  }) : super.builder(itemBuilder: _revealing(itemBuilder, Axis.vertical));

  RowGridView.count({
    super.key,
    super.controller,
    super.physics,
    super.shrinkWrap,
    super.padding,
    required super.crossAxisCount,
    super.mainAxisSpacing,
    super.crossAxisSpacing,
    super.childAspectRatio,
    super.mainAxisExtent,
    required List<Widget> children,
  }) : super.count(children: revealAll(children));
}

/// Press feedback that never takes part in the gesture: it only watches the finger, so the child keeps its own
/// taps and scrolling. With [morph] the next page grows out of this card (see [RowPageTransitionsBuilder]).
class RowPressable extends StatefulWidget {
  const RowPressable({super.key, this.enabled = true, this.morph = false, this.scale = .97, required this.child});

  final bool enabled;
  final bool morph;
  final double scale;
  final Widget child;

  @override
  State<RowPressable> createState() => _RowPressableState();
}

class _RowPressableState extends State<RowPressable> {
  Offset? _down;

  void _release() {
    if (_down != null && mounted) setState(() => _down = null);
  }

  void _up(PointerUpEvent _) {
    if (_down != null && widget.morph) {
      final box = context.findRenderObject();
      if (box is RenderBox && box.attached) {
        RowMorphOrigin.remember(box.localToGlobal(Offset.zero) & box.size);
      }
    }
    _release();
  }

  @override
  Widget build(BuildContext context) {
    final pressed = _down != null && !RowMotion.still(context);
    return Listener(
      onPointerDown: widget.enabled ? (e) => setState(() => _down = e.position) : null,
      // A drag is a scroll, not a press.
      onPointerMove: (e) {
        if (_down != null && (e.position - _down!).distance > kTouchSlop) _release();
      },
      onPointerUp: _up,
      onPointerCancel: (_) => _release(),
      child: AnimatedScale(
        scale: pressed ? widget.scale : 1,
        duration: pressed ? const Duration(milliseconds: 90) : RowMotion.ui,
        curve: pressed ? RowMotion.easeOut : RowMotion.spring,
        child: widget.child,
      ),
    );
  }
}

/// Pop-in for dialogs, check badges and empty-state icons.
class RowPop extends StatelessWidget {
  const RowPop({super.key, this.from = .6, this.duration = RowMotion.arrive, required this.child});

  final double from;
  final Duration duration;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (RowMotion.still(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: duration,
      child: child,
      builder: (_, t, child) => Opacity(
        opacity: (t * 2.5).clamp(0, 1),
        child: Transform.scale(scale: from + (1 - from) * RowMotion.spring.transform(t), child: child),
      ),
    );
  }
}

/// A number that counts up when it first appears and rolls to its new value when it changes. Text that is not a
/// single number (dates, "3 / 10", "No data", "12 left") is shown as it is, translated like any other text.
class RowCountUp extends StatelessWidget {
  const RowCountUp(this.value, {super.key, this.style, this.maxLines, this.overflow, this.textAlign});

  final String value;
  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;
  final TextAlign? textAlign;

  static final _number = RegExp(r'^([^\d]*?)(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?([^\d]*)$');

  static final _word = RegExp(r'\p{L}{3,}', unicode: true);

  static RegExpMatch? _match(String value) => _word.hasMatch(value) ? null : _number.firstMatch(value);

  /// The text of [value] part-way ([t] 0 to 1) to its final number, in the same format; null when not a number.
  @visibleForTesting
  static String? at(String value, double t) {
    final m = _match(value);
    if (m == null) return null;
    final decimals = m[3]?.length ?? 0;
    final end = double.parse('${m[2]!.replaceAll(',', '')}.${m[3] ?? '0'}');
    final now = (end * t).toStringAsFixed(decimals);
    final grouped = m[2]!.contains(',');
    if (!grouped || t >= 1) return t >= 1 ? value : '${m[1]}$now${m[4]}';
    final whole = now.split('.').first;
    // Same grouping as the final text: Indian (2-digit) groups when it uses them, thousands otherwise.
    final indian = RegExp(r',\d{2},').hasMatch(m[2]!);
    final tail = whole.length > 3 ? whole.substring(whole.length - 3) : whole;
    final head = whole.length > 3 ? whole.substring(0, whole.length - 3) : '';
    final step = indian ? 2 : 3;
    final groupedHead = head.replaceAllMapped(RegExp('(\\d)(?=(\\d{$step})+\$)'), (g) => '${g[1]},');
    final text = head.isEmpty ? tail : '$groupedHead,$tail';
    return '${m[1]}$text${decimals > 0 ? '.${now.split('.').last}' : ''}${m[4]}';
  }

  @override
  Widget build(BuildContext context) {
    Widget text(String s) => Text(s, style: style, maxLines: maxLines, overflow: overflow, textAlign: textAlign);
    final m = _match(value);
    // One digit has nothing to count through.
    if (m == null || RowMotion.still(context) || m[2]!.length < 2) {
      return i18n.Text(value, style: style, maxLines: maxLines, overflow: overflow, textAlign: textAlign);
    }
    final end = double.parse('${m[2]!.replaceAll(',', '')}.${m[3] ?? '0'}');
    return Semantics(
      label: value,
      excludeSemantics: true,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: end),
        duration: RowMotion.count,
        curve: RowMotion.easeOut,
        builder: (_, v, __) => text(at(value, end == 0 ? 1 : v / end) ?? value),
      ),
    );
  }
}

/// A short shake that says "that did not work". Change [trigger] to play it.
class RowShake extends StatefulWidget {
  const RowShake({super.key, required this.trigger, required this.child});

  final int trigger;
  final Widget child;

  @override
  State<RowShake> createState() => _RowShakeState();
}

class _RowShakeState extends State<RowShake> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: RowMotion.ui);

  @override
  void didUpdateWidget(RowShake old) {
    super.didUpdateWidget(old);
    if (old.trigger != widget.trigger && !RowMotion.still(context)) _controller.forward(from: 0);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  // Three swings of 6 px, dying out.
  static final _path = TweenSequence<double>([
    TweenSequenceItem(tween: Tween(begin: 0, end: -6), weight: 1),
    TweenSequenceItem(tween: Tween(begin: -6, end: 5), weight: 2),
    TweenSequenceItem(tween: Tween(begin: 5, end: -3), weight: 2),
    TweenSequenceItem(tween: Tween(begin: -3, end: 0), weight: 1),
  ]);

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _controller,
        child: widget.child,
        builder: (_, child) => Transform.translate(offset: Offset(_path.evaluate(_controller), 0), child: child),
      );
}

/// Draws its child in from the left, like a pen stroke (charts).
class RowDrawIn extends StatelessWidget {
  const RowDrawIn({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (RowMotion.still(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: RowMotion.count,
      curve: RowMotion.easeInOut,
      child: child,
      builder: (_, t, child) => ClipRect(clipper: _LeftClip(t), clipBehavior: t < 1 ? Clip.hardEdge : Clip.none, child: child),
    );
  }
}

class _LeftClip extends CustomClipper<Rect> {
  const _LeftClip(this.t);
  final double t;
  @override
  Rect getClip(Size size) => Rect.fromLTRB(0, 0, size.width * t, size.height);
  @override
  bool shouldReclip(_LeftClip old) => old.t != t;
}

/// A progress bar that fills to its value (and moves to a new one) instead of appearing full.
class RowProgressBar extends StatelessWidget {
  const RowProgressBar({super.key, required this.value, this.minHeight, this.backgroundColor, this.color, this.valueColor, this.borderRadius});

  final double value;
  final double? minHeight;
  final Color? backgroundColor;
  final Color? color;
  final Animation<Color?>? valueColor;
  final BorderRadiusGeometry? borderRadius;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: RowMotion.still(context) ? value : 0, end: value),
        duration: RowMotion.still(context) ? Duration.zero : RowMotion.count,
        curve: RowMotion.easeOut,
        builder: (_, v, __) => LinearProgressIndicator(
          value: v,
          minHeight: minHeight,
          backgroundColor: backgroundColor,
          color: color,
          valueColor: valueColor,
          borderRadius: borderRadius,
        ),
      );
}

/// [showDialog] whose panel settles into place, and leaves the same way. Same arguments.
Future<T?> showRowDialog<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool barrierDismissible = true,
  Color? barrierColor,
}) =>
    showDialog<T>(
      context: context,
      barrierDismissible: barrierDismissible,
      barrierColor: barrierColor ?? AppColors.scrim,
      builder: (context) => _DialogSettle(child: Builder(builder: builder)),
    );

class _DialogSettle extends StatelessWidget {
  const _DialogSettle({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final animation = ModalRoute.of(context)?.animation;
    if (animation == null || RowMotion.still(context)) return child;
    return AnimatedBuilder(
      animation: animation,
      child: child,
      builder: (_, child) {
        final t = RowMotion.easeOut.transform(animation.value);
        return Transform.translate(
          offset: Offset(0, 16 * (1 - t)),
          child: Transform.scale(scale: .95 + .05 * t, child: child),
        );
      },
    );
  }
}

import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';

/// The ROW lockup as a shared element: it glides from screen to screen through the sign-in flow to home.
class RowLogo extends StatelessWidget {
  const RowLogo({super.key, this.width, this.height});

  final double? width;
  final double? height;

  static const asset = 'assets/images/row-logo.png';

  @override
  Widget build(BuildContext context) => Hero(
        tag: 'row-logo',
        child: Image.asset(asset, width: width, height: height, semanticLabel: Brand.current.productName),
      );
}

/// Cold start: the two hands of the logo reach in, meet, and the name rises beneath them. Ends as the plain logo.
class HandshakeLogo extends StatefulWidget {
  const HandshakeLogo({super.key, this.width = 220});

  final double width;

  @override
  State<HandshakeLogo> createState() => _HandshakeLogoState();
}

class _HandshakeLogoState extends State<HandshakeLogo> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (RowMotion.still(context)) {
      _controller.value = 1;
    } else if (_controller.value == 0) {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  // Hands travel in, press a little past the touch, and settle.
  static final _reach = TweenSequence<double>([
    TweenSequenceItem(tween: Tween(begin: 1.0, end: -.05).chain(CurveTween(curve: RowMotion.easeOut)), weight: 62),
    TweenSequenceItem(tween: Tween(begin: -.05, end: .015).chain(CurveTween(curve: Curves.easeInOut)), weight: 20),
    TweenSequenceItem(tween: Tween(begin: .015, end: 0.0).chain(CurveTween(curve: Curves.easeInOut)), weight: 18),
  ]);

  @override
  Widget build(BuildContext context) {
    final w = widget.width;
    Widget part(_LogoPart p) => ClipPath(clipper: _PartClip(p), child: Image.asset(RowLogo.asset, width: w, excludeFromSemantics: true));
    return Semantics(
      label: Brand.current.productName,
      image: true,
      child: Hero(
        tag: 'row-logo',
        child: AnimatedBuilder(
          animation: _controller,
          builder: (_, __) {
            final t = _controller.value;
            final gap = _reach.transform((t / .8).clamp(0, 1));
            final hands = (t / .25).clamp(0.0, 1.0);
            final name = RowMotion.easeOut.transform(((t - .5) / .5).clamp(0, 1));
            Widget hand(_LogoPart p, double side) => Opacity(
                  opacity: hands,
                  child: Transform.translate(
                    offset: Offset(side * gap * w * .42, gap.abs() * w * .05),
                    child: Transform.rotate(angle: -side * gap * math.pi / 14, child: part(p)),
                  ),
                );
            return SizedBox(
              width: w,
              height: w * 275 / 640,
              child: Stack(
                children: [
                  hand(_LogoPart.gold, -1),
                  hand(_LogoPart.blue, 1),
                  Opacity(
                    opacity: name,
                    child: Transform.translate(offset: Offset(0, 14 * (1 - name)), child: part(_LogoPart.name)),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

enum _LogoPart { gold, blue, name }

/// Cuts row-logo.png (640 x 275) into its two hands and the name. The cut between the fingers is measured on that
/// file: update it if the artwork changes.
class _PartClip extends CustomClipper<Path> {
  const _PartClip(this.part);

  final _LogoPart part;

  @override
  Path getClip(Size size) {
    final k = size.width / 640;
    Offset p(double x, double y) => Offset(x * k, y * k);
    return switch (part) {
      _LogoPart.name => Path()..addRect(Rect.fromLTRB(0, 211 * k, size.width, size.height)),
      _LogoPart.gold => Path()..addPolygon([p(0, 0), p(318, 0), p(318, 138), p(331, 168), p(331, 211), p(0, 211)], true),
      _LogoPart.blue => Path()..addPolygon([p(318, 0), p(640, 0), p(640, 211), p(331, 211), p(331, 168), p(318, 138)], true),
    };
  }

  @override
  bool shouldReclip(_PartClip old) => old.part != part;
}

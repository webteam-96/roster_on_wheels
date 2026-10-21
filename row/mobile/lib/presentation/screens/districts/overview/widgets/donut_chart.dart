import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Filled-arc donut chart. Reusable across cards that need a percentage ring
/// with a center label (TRF Goal, District Citation, etc.).
///
/// Mirrors the React reference's two-circle SVG layout:
///   - A full-circle "track" ring
///   - A filled arc starting at 12 o'clock, sweeping clockwise to the given
///     percentage, with a rounded end cap
class DonutChart extends StatelessWidget {
  final double size;
  final double percent; // 0-100, clamped internally
  final Color trackColor;
  final Color fillColor;
  final double strokeWidth;
  final Widget? center;

  /// Cap on the filled arc. Defaults to a flat (butt) cap so the ring reads as
  /// a clean donut matching the web pie reference. Use [StrokeCap.round] for a
  /// rounded leading edge.
  final StrokeCap strokeCap;

  const DonutChart({
    super.key,
    this.size = 110,
    required this.percent,
    required this.trackColor,
    required this.fillColor,
    this.strokeWidth = 10,
    this.center,
    this.strokeCap = StrokeCap.butt,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _DonutPainter(
          percent: percent.clamp(0.0, 100.0),
          trackColor: trackColor,
          fillColor: fillColor,
          strokeWidth: strokeWidth,
          strokeCap: strokeCap,
        ),
        child: center == null ? null : Center(child: center),
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  final double percent;
  final Color trackColor;
  final Color fillColor;
  final double strokeWidth;
  final StrokeCap strokeCap;

  _DonutPainter({
    required this.percent,
    required this.trackColor,
    required this.fillColor,
    required this.strokeWidth,
    required this.strokeCap,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final centerPoint = Offset(size.width / 2, size.height / 2);
    // Inset by half the stroke so the ring fits inside the box.
    final radius = (size.width / 2) - (strokeWidth / 2);

    // Track ring
    final trackPaint = Paint()
      ..color = trackColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    canvas.drawCircle(centerPoint, radius, trackPaint);

    if (percent <= 0) return;

    // Filled arc — sweep from 12 o'clock clockwise
    final fillPaint = Paint()
      ..color = fillColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = strokeCap;

    const startAngle = -math.pi / 2;
    final sweepAngle = 2 * math.pi * (percent / 100);

    canvas.drawArc(
      Rect.fromCircle(center: centerPoint, radius: radius),
      startAngle,
      sweepAngle,
      false,
      fillPaint,
    );
  }

  @override
  bool shouldRepaint(_DonutPainter old) =>
      old.percent != percent ||
      old.trackColor != trackColor ||
      old.fillColor != fillColor ||
      old.strokeWidth != strokeWidth ||
      old.strokeCap != strokeCap;
}

import 'dart:ui' show FontFeature, FontVariation;
import 'package:flutter/painting.dart';

/// Fellowship type (design.md §2), bundled in assets/fonts: Figtree for text,
/// Bricolage Grotesque for display. Both are variable fonts, so the weight is
/// also sent as a `wght` variation (Flutter does not map fontWeight onto the axis).
class AppFonts {
  static const String bodyFamily = 'Figtree';
  static const String displayFamily = 'BricolageGrotesque';

  static TextStyle body({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
    List<FontFeature>? fontFeatures,
    TextDecoration? decoration,
    Color? decorationColor,
    FontStyle? fontStyle,
    TextStyle? textStyle,
  }) =>
      _style(bodyFamily, FontWeight.w400, textStyle, fontSize, fontWeight, color, height, letterSpacing,
          fontFeatures, decoration, decorationColor, fontStyle);

  /// Display: semibold with tight tracking (-0.035em) unless the caller sets it.
  static TextStyle display({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
    List<FontFeature>? fontFeatures,
    TextDecoration? decoration,
    Color? decorationColor,
    FontStyle? fontStyle,
    TextStyle? textStyle,
  }) {
    final size = fontSize ?? textStyle?.fontSize;
    return _style(displayFamily, FontWeight.w600, textStyle, fontSize, fontWeight, color, height,
        letterSpacing ?? textStyle?.letterSpacing ?? (size == null ? null : size * -0.035),
        fontFeatures, decoration, decorationColor, fontStyle);
  }

  static TextStyle _style(
    String family,
    FontWeight defaultWeight,
    TextStyle? base,
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
    List<FontFeature>? fontFeatures,
    TextDecoration? decoration,
    Color? decorationColor,
    FontStyle? fontStyle,
  ) {
    final weight = fontWeight ?? base?.fontWeight ?? defaultWeight;
    return (base ?? const TextStyle()).copyWith(
      fontFamily: family,
      fontSize: fontSize,
      fontWeight: weight,
      fontVariations: [FontVariation('wght', weight.value.toDouble())],
      color: color,
      height: height,
      letterSpacing: letterSpacing,
      fontFeatures: fontFeatures,
      decoration: decoration,
      decorationColor: decorationColor,
      fontStyle: fontStyle,
    );
  }
}

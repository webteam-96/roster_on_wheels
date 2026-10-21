import 'package:flutter/animation.dart';
import 'package:flutter/painting.dart';

/// Fellowship tone system (design.md §1 `data-c`): each tone is a fill plus the
/// readable ink on it. Card grids cycle sky, lilac, marigold, mint, coral, cream2.
enum RowTone { marigold, coral, azure, mint, lilac, sky, ink, cream, cream2 }

extension RowToneColors on RowTone {
  Color get fill => switch (this) {
        RowTone.marigold => const Color(0xFFF7A81B),
        RowTone.coral => const Color(0xFFFFC65C),
        RowTone.azure => const Color(0xFF17458F),
        RowTone.mint => const Color(0xFF0067C8),
        RowTone.lilac => const Color(0xFFA9C6EA),
        RowTone.sky => const Color(0xFFCFE2F6),
        RowTone.ink => const Color(0xFF1B2C42),
        RowTone.cream => const Color(0xFFF7F9FC),
        RowTone.cream2 => const Color(0xFFEDF4FB),
      };

  Color get onFill => switch (this) {
        RowTone.azure || RowTone.mint || RowTone.ink => const Color(0xFFF7F9FC),
        _ => const Color(0xFF1B2C42),
      };
}

/// Radii (design.md §4): panels 24, tiles 16, pills fully round.
class RowRadii {
  static const double panel = 24;
  static const double tile = 16;
  static const double pill = 999;
}

/// Motion (design.md §6).
class RowMotion {
  static const Duration micro = Duration(milliseconds: 160);
  static const Duration ui = Duration(milliseconds: 320);
  static const Duration reveal = Duration(milliseconds: 700);
  static const Curve easeOut = Cubic(.22, 1, .36, 1);
  static const Curve easeInOut = Cubic(.65, 0, .35, 1);
  static const Curve spring = Cubic(.34, 1.56, .64, 1);
}

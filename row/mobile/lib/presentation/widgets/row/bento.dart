import 'dart:math' as math;
import 'package:flutter/material.dart' hide Text;
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';

/// One tile of a [RowBento]: its width in columns and height in rows.
class BentoItem {
  const BentoItem(this.width, this.height, this.child);

  final int width;
  final int height;
  final Widget child;
}

/// Bento grid: tiles of mixed sizes packed flush, top-left first. Four columns on a phone, eight on a tablet. Rows
/// grow with the text size, so labels keep their room.
class RowBento extends StatelessWidget {
  const RowBento({super.key, required this.items});

  final List<BentoItem> items;

  static const double gap = 10;
  static const double _row = 44;

  /// Where each (width, height) lands: (column, row), and the total number of rows.
  @visibleForTesting
  static (List<(int, int)>, int) pack(List<(int, int)> sizes, int columns) {
    final level = List.filled(columns, 0);
    final spots = <(int, int)>[];
    for (final (w, h) in sizes) {
      final span = math.min(w, columns);
      var bestX = 0, bestY = 1 << 30;
      for (var x = 0; x + span <= columns; x++) {
        final y = level.sublist(x, x + span).reduce(math.max);
        if (y < bestY) (bestX, bestY) = (x, y);
      }
      level.fillRange(bestX, bestX + span, bestY + h);
      spots.add((bestX, bestY));
    }
    return (spots, level.reduce(math.max));
  }

  /// A lively but always flush rhythm for [n] equal things: one tall tile beside two short ones, mirrored each time.
  static List<(int, int)> spans(int n) {
    if (n == 1) return const [(4, 2)];
    if (n == 2) return const [(2, 3), (2, 3)];
    final out = <(int, int)>[];
    var left = n;
    for (var mirrored = false; left >= 3; mirrored = !mirrored, left -= 3) {
      out.addAll(mirrored ? const [(2, 2), (2, 4), (2, 2)] : const [(2, 4), (2, 2), (2, 2)]);
    }
    if (left == 1) out.add((4, 2));
    if (left == 2) out.addAll(const [(2, 2), (2, 2)]);
    return out;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      final columns = box.maxWidth >= 600 ? 8 : 4;
      final column = (box.maxWidth - gap * (columns - 1)) / columns;
      // The app's text is set at 1.2; larger text gets taller rows.
      final row = _row * math.max(1, MediaQuery.textScalerOf(context).scale(10) / 12);
      final (spots, rows) = pack([for (final i in items) (i.width, i.height)], columns);
      double along(double unit, int count) => count * unit + (count - 1) * gap;
      return SizedBox(
        height: rows == 0 ? 0 : along(row, rows),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            for (final (i, item) in items.indexed)
              Positioned(
                left: spots[i].$1 * (column + gap),
                top: spots[i].$2 * (row + gap),
                width: along(column, math.min(item.width, columns)),
                height: along(row, item.height),
                child: RowReveal(index: i, child: item.child),
              ),
          ],
        ),
      );
    });
  }
}

/// A bento tile: icon and label on a tone. Icon on top, label at the bottom, in the display face on the tall
/// tiles. Opening it grows the page out of the tile.
class RowBentoTile extends StatelessWidget {
  const RowBentoTile({
    super.key,
    required this.label,
    required this.icon,
    required this.tone,
    this.onTap,
    this.badge,
  });

  final String label;
  final Widget icon;
  final RowTone tone;
  final VoidCallback? onTap;
  final Widget? badge;

  /// Tone rhythm for module grids: blues only, the tall tiles strongest.
  static RowTone toneFor(int index, (int, int) span) => span.$2 >= 4
      ? (index ~/ 3 % 2 == 0 ? RowTone.azure : RowTone.lilac)
      : (index % 3 == 0 ? RowTone.sky : RowTone.cream2);

  @override
  Widget build(BuildContext context) {
    final ink = tone.onFill;
    final light = tone == RowTone.cream || tone == RowTone.cream2;
    final text = Text(
      label.replaceAll('\n', ' '),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600, height: 1.2, color: ink),
    );
    return Semantics(
      button: onTap != null,
      child: RowPressable(
        morph: true,
        enabled: onTap != null,
        child: Material(
          color: tone.fill,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(RowRadii.tile),
            side: light ? const BorderSide(color: AppColors.line) : BorderSide.none,
          ),
          child: InkWell(
            onTap: onTap,
            child: LayoutBuilder(builder: (context, box) {
              // By rows, not pixels: rows grow with the text, and a short tile must not switch to the display face.
              final tall = box.maxHeight > 130 * math.max(1, MediaQuery.textScalerOf(context).scale(10) / 12);
              return Padding(
                padding: EdgeInsets.all(tall ? 14 : 12),
                child: IconTheme.merge(
                  data: IconThemeData(color: ink, size: tall ? 30 : 22),
                  child: tall
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            icon,
                            Expanded(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.end,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (badge != null) ...[_onSurface(badge!), const SizedBox(height: 8)],
                                  Flexible(
                                    child: Text(
                                      label,
                                      maxLines: 3,
                                      overflow: TextOverflow.ellipsis,
                                      style: AppFonts.display(
                                          fontSize: 19, fontWeight: FontWeight.w600, height: 1.12, color: ink),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [
                              icon,
                              const SizedBox(width: 8),
                              if (badge != null)
                                Expanded(child: Align(alignment: Alignment.centerRight, child: _onSurface(badge!))),
                            ]),
                            Expanded(child: Align(alignment: Alignment.bottomLeft, child: text)),
                          ],
                        ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  // Status chips are tinted for a light ground: give them one on the dark tiles too.
  Widget _onSurface(Widget chip) => DecoratedBox(
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(RowRadii.pill)),
        child: chip,
      );
}

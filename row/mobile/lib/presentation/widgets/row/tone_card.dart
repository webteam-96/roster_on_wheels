import 'package:flutter/material.dart';
import '../../../core/theme/row_tokens.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';

/// Fellowship tile (design.md §1 tone system): a flat fill with its readable ink,
/// tile radius, no shadow. Cream tones get a hairline so they read on the page.
class ToneCard extends StatelessWidget {
  const ToneCard({super.key, required this.tone, required this.child, this.padding = const EdgeInsets.all(20)});

  final RowTone tone;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final light = tone == RowTone.cream || tone == RowTone.cream2;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: tone.fill,
        borderRadius: BorderRadius.circular(RowRadii.tile),
        border: light ? Border.all(color: AppColors.line) : null,
      ),
      child: DefaultTextStyle.merge(
        style: TextStyle(color: tone.onFill),
        child: IconTheme.merge(
          data: IconThemeData(color: tone.onFill),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

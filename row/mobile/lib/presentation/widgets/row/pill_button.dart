import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/row_tokens.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

enum PillVariant { primary, gold, ghost, onPanel }

/// Fellowship pill button (design.md §5). Gold is for the arrow chip and small
/// highlights only; `onPanel` inverts to cream with azure text on blue panels.
class PillButton extends StatefulWidget {
  const PillButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = PillVariant.primary,
    this.arrow = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final PillVariant variant;
  final bool arrow;

  static const Key arrowKey = Key('pill-arrow');

  @override
  State<PillButton> createState() => _PillButtonState();
}

class _PillButtonState extends State<PillButton> {
  bool _hover = false;

  (Color, Color, BorderSide) get _colors => switch (widget.variant) {
        PillVariant.primary => (AppColors.primaryPrime, AppColors.primaryForeground, BorderSide.none),
        PillVariant.gold => (AppColors.goldPrime, AppColors.textPrimary, BorderSide.none),
        PillVariant.ghost => (AppColors.transparent, AppColors.primaryPrime, const BorderSide(color: AppColors.primaryPrime, width: 1.5)),
        PillVariant.onPanel => (AppColors.surface, AppColors.primaryPrime, BorderSide.none),
      };

  @override
  Widget build(BuildContext context) {
    final (bg, fg, side) = _colors;
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    return TextButton(
      onPressed: widget.onPressed,
      onHover: (h) => setState(() => _hover = h),
      onFocusChange: (f) => setState(() => _hover = f),
      style: TextButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: fg,
        disabledBackgroundColor: AppColors.muted,
        disabledForegroundColor: AppColors.textMuted,
        minimumSize: const Size(0, 52),
        padding: EdgeInsets.only(left: 24, right: widget.arrow ? 8 : 24),
        shape: StadiumBorder(side: side),
        textStyle: AppTextStyles.button,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis)),
          if (widget.arrow) ...[
            const SizedBox(width: 12),
            ExcludeSemantics(
              child: AnimatedSlide(
                key: PillButton.arrowKey,
                offset: _hover && !still ? const Offset(0.11, 0) : Offset.zero, // ~4px of a 36px chip
                duration: still ? Duration.zero : RowMotion.ui,
                curve: RowMotion.spring,
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: const BoxDecoration(color: AppColors.goldPrime, shape: BoxShape.circle),
                  child: const Icon(Icons.arrow_forward_rounded, size: 18, color: AppColors.textPrimary),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

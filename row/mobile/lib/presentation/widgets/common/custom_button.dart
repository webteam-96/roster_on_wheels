import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/row_tokens.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

enum ButtonVariant { primary, secondary, outline, danger, ghost }

class CustomButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;
  final ButtonVariant variant;
  final bool isLoading;
  final IconData? icon;
  final bool fullWidth;
  final double? height;
  final EdgeInsetsGeometry? padding;

  const CustomButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = ButtonVariant.primary,
    this.isLoading = false,
    this.icon,
    this.fullWidth = false,
    this.height,
    this.padding,
  });

  @override
  State<CustomButton> createState() => _CustomButtonState();
}

class _CustomButtonState extends State<CustomButton> {
  @override
  Widget build(BuildContext context) {
    final label = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.icon != null) ...[
          Icon(widget.icon, size: 18, color: _foregroundColor),
          const SizedBox(width: 8),
        ],
        // Flexible: a long label (translations, narrow phones) ends with "…" instead of overflowing.
        Flexible(
          child: Text(
            widget.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              color: _foregroundColor,
              fontWeight: FontWeight.w600,
              fontSize: 14,
            ),
          ),
        ),
      ],
    );

    // While working the button keeps its size and colour and the label swaps for the dots.
    final child = Stack(
      alignment: Alignment.center,
      children: [
        ExcludeSemantics(
          excluding: widget.isLoading,
          child: AnimatedOpacity(
            opacity: widget.isLoading ? 0 : 1,
            duration: RowMotion.micro,
            child: label,
          ),
        ),
        if (widget.isLoading)
          RowPop(child: RowLoader(size: 24, color: _foregroundColor)),
      ],
    );

    final effectivePadding = widget.padding ?? const EdgeInsets.symmetric(horizontal: 24, vertical: 12);
    // ROW buttons are full pills (design.md 5).
    final borderRadius = BorderRadius.circular(999);
    final style = _getButtonStyle(borderRadius, effectivePadding);
    final onPressed = widget.isLoading ? null : widget.onPressed;

    final button = widget.variant == ButtonVariant.outline || widget.variant == ButtonVariant.ghost
        ? OutlinedButton(onPressed: onPressed, style: style, child: child)
        : ElevatedButton(onPressed: onPressed, style: style, child: child);

    return RowPressable(
      enabled: onPressed != null,
      child: widget.fullWidth ? SizedBox(width: double.infinity, child: button) : button,
    );
  }

  ButtonStyle _getButtonStyle(BorderRadius borderRadius, EdgeInsetsGeometry padding) {
    if (widget.variant == ButtonVariant.outline || widget.variant == ButtonVariant.ghost) {
      return OutlinedButton.styleFrom(
        foregroundColor: _foregroundColor,
        backgroundColor: widget.variant == ButtonVariant.ghost ? Colors.transparent : null,
        side: widget.variant == ButtonVariant.ghost
            ? BorderSide.none
            : BorderSide(color: _borderColor, width: 1.5),
        padding: padding,
        minimumSize: Size(widget.fullWidth ? double.infinity : 0, widget.height ?? 48),
        shape: RoundedRectangleBorder(borderRadius: borderRadius),
      );
    }
    return ElevatedButton.styleFrom(
      backgroundColor: _backgroundColor,
      foregroundColor: _foregroundColor,
      disabledBackgroundColor: _backgroundColor, // loading keeps the colour; no handler is already muted
      padding: padding,
      minimumSize: Size(widget.fullWidth ? double.infinity : 0, widget.height ?? 48),
      shape: RoundedRectangleBorder(borderRadius: borderRadius),
      elevation: 0,
    );
  }

  Color get _backgroundColor {
    if (widget.onPressed == null) return AppColors.muted;
    switch (widget.variant) {
      case ButtonVariant.danger:
        return AppColors.error;
      case ButtonVariant.secondary:
        return AppColors.goldPrime;
      default:
        return AppColors.primaryPrime;
    }
  }

  Color get _foregroundColor {
    if (widget.onPressed == null) return AppColors.textMuted;
    switch (widget.variant) {
      case ButtonVariant.outline:
      case ButtonVariant.ghost:
        return AppColors.primaryPrime;
      case ButtonVariant.secondary:
        return AppColors.darkBg;
      case ButtonVariant.danger:
        return AppColors.white;
      default:
        return AppColors.white;
    }
  }

  Color get _borderColor {
    switch (widget.variant) {
      case ButtonVariant.danger:
        return AppColors.error;
      default:
        return AppColors.primaryPrime;
    }
  }
}

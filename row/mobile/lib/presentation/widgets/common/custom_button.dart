import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

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

class _CustomButtonState extends State<CustomButton> with SingleTickerProviderStateMixin {
  late AnimationController _shimmerController;

  @override
  void initState() {
    super.initState();
    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void dispose() {
    _shimmerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool isGradient = widget.variant == ButtonVariant.primary || widget.variant == ButtonVariant.secondary;
    
    final child = widget.isLoading
        ? _buildLoadingState(isGradient)
        : Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (widget.icon != null) ...[
                Icon(widget.icon, size: 18, color: _foregroundColor),
                const SizedBox(width: 8),
              ],
              Text(
                widget.label,
                style: AppFonts.body(
                  color: _foregroundColor,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            ],
          );

    final effectivePadding = widget.padding ?? const EdgeInsets.symmetric(horizontal: 24, vertical: 12);
    final borderRadius = BorderRadius.circular(12);

    Widget buttonBody;
    if (isGradient && widget.onPressed != null && !widget.isLoading) {
      buttonBody = Container(
        decoration: BoxDecoration(
          gradient: widget.variant == ButtonVariant.primary 
              ? AppGradients.royalSweep
              : AppGradients.goldenHour,
          borderRadius: borderRadius,
        ),
        child: ElevatedButton(
          onPressed: widget.onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            shadowColor: Colors.transparent,
            padding: effectivePadding,
            minimumSize: Size(widget.fullWidth ? double.infinity : 0, widget.height ?? 48),
            shape: RoundedRectangleBorder(borderRadius: borderRadius),
          ),
          child: child,
        ),
      );
    } else if (widget.variant == ButtonVariant.outline ||
        widget.variant == ButtonVariant.ghost) {
      buttonBody = OutlinedButton(
        onPressed: widget.isLoading ? null : widget.onPressed,
        style: _getButtonStyle(borderRadius, effectivePadding),
        child: child,
      );
    } else {
      buttonBody = ElevatedButton(
        onPressed: widget.isLoading ? null : widget.onPressed,
        style: _getButtonStyle(borderRadius, effectivePadding),
        child: child,
      );
    }

    if (widget.fullWidth) {
      return SizedBox(width: double.infinity, child: buttonBody);
    }
    return buttonBody;
  }

  Widget _buildLoadingState(bool isGradient) {
    if (!isGradient) {
      return SizedBox(
        width: 18,
        height: 18,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: _foregroundColor,
        ),
      );
    }

    return AnimatedBuilder(
      animation: _shimmerController,
      builder: (context, child) {
        return Container(
          width: 60,
          height: 4,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(2),
            color: AppColors.white.withOpacity(0.1),
          ),
        );
      },
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
      padding: padding,
      minimumSize: Size(widget.fullWidth ? double.infinity : 0, widget.height ?? 48),
      shape: RoundedRectangleBorder(borderRadius: borderRadius),
      elevation: widget.variant == ButtonVariant.ghost ? 0 : 2,
      shadowColor: _backgroundColor.withOpacity(0.3),
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

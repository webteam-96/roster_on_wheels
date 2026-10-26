import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class CustomTextField extends StatefulWidget {
  final String label;
  final String? hint;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final TextInputType keyboardType;
  final TextInputAction textInputAction;
  final bool obscureText;
  final IconData? prefixIcon;
  final Widget? suffixIcon;
  final bool readOnly;
  final VoidCallback? onTap;
  final void Function(String)? onChanged;
  final void Function(String)? onSubmitted;
  final int? maxLines;
  final int? maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final bool enabled;
  final FocusNode? focusNode;
  final String? initialValue;

  const CustomTextField({
    super.key,
    required this.label,
    this.hint,
    this.controller,
    this.validator,
    this.keyboardType = TextInputType.text,
    this.textInputAction = TextInputAction.next,
    this.obscureText = false,
    this.prefixIcon,
    this.suffixIcon,
    this.readOnly = false,
    this.onTap,
    this.onChanged,
    this.onSubmitted,
    this.maxLines = 1,
    this.maxLength,
    this.inputFormatters,
    this.enabled = true,
    this.focusNode,
    this.initialValue,
  });

  @override
  State<CustomTextField> createState() => _CustomTextFieldState();
}

class _CustomTextFieldState extends State<CustomTextField> {
  bool _obscure = true;
  late FocusNode _internalFocusNode;

  @override
  void initState() {
    super.initState();
    _obscure = widget.obscureText;
    _internalFocusNode = widget.focusNode ?? FocusNode();
    _internalFocusNode.addListener(_onFocusChange);
  }

  @override
  void dispose() {
    if (widget.focusNode == null) {
      _internalFocusNode.dispose();
    } else {
      _internalFocusNode.removeListener(_onFocusChange);
    }
    super.dispose();
  }

  void _onFocusChange() {
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final bool isFocused = _internalFocusNode.hasFocus;

    // Multi-line fields (e.g. Description) should let the user press Enter to
    // start a new line. Unless the caller overrode them, a multi-line field
    // gets the multiline keyboard (shows a return key) and the newline action
    // (Enter inserts a line break instead of jumping to the next field).
    final bool isMultiline =
        !widget.obscureText && (widget.maxLines == null || widget.maxLines! > 1);
    final TextInputType effectiveKeyboardType =
        (isMultiline && widget.keyboardType == TextInputType.text)
            ? TextInputType.multiline
            : widget.keyboardType;
    final TextInputAction effectiveTextInputAction =
        (isMultiline && widget.textInputAction == TextInputAction.next)
            ? TextInputAction.newline
            : widget.textInputAction;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            widget.label,
            style: AppFonts.body(color: isFocused ? AppColors.primaryPrime : AppColors.textPrimary,
              fontWeight: isFocused ? FontWeight.w700 : FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ),
        TextFormField(
          controller: widget.controller,
          initialValue: widget.controller == null ? widget.initialValue : null,
          validator: widget.validator,
          keyboardType: effectiveKeyboardType,
          textInputAction: effectiveTextInputAction,
          obscureText: widget.obscureText ? _obscure : false,
          readOnly: widget.readOnly,
          onTap: widget.onTap,
          onChanged: widget.onChanged,
          onFieldSubmitted: widget.onSubmitted,
          maxLines: widget.obscureText ? 1 : widget.maxLines,
          maxLength: widget.maxLength,
          inputFormatters: widget.inputFormatters,
          enabled: widget.enabled,
          focusNode: _internalFocusNode,
          style: AppFonts.body(fontWeight: FontWeight.w500,
            fontSize: 14,
            color: widget.enabled ? AppColors.textPrimary : AppColors.textMuted,
          ),
          decoration: InputDecoration(
            hintText: widget.hint,
            hintStyle: AppFonts.body(color: AppColors.textMuted, fontSize: 14),
            prefixIcon: widget.prefixIcon != null
                ? Icon(
                    widget.prefixIcon,
                    size: 20,
                    color: isFocused ? AppColors.primaryPrime : AppColors.textSecondary,
                  )
                : null,
            suffixIcon: widget.obscureText
                ? IconButton(
                    icon: Icon(
                      _obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                      size: 20,
                      color: isFocused ? AppColors.primaryPrime : AppColors.textSecondary,
                    ),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  )
                : widget.suffixIcon,
            counterText: '',
            // Allow validation messages to wrap instead of clipping to one
            // line with an ellipsis (e.g. the country-aware phone error).
            errorMaxLines: 2,
            filled: true,
            fillColor: AppColors.primaryPrime.withOpacity(0.04),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: AppColors.primaryPrime.withOpacity(0.5), width: 1),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.goldPrime, width: 2),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.error, width: 1.5),
            ),
            focusedErrorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.error, width: 2),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: AppColors.lightBorder.withOpacity(0.5), width: 1),
            ),
          ),
        ),
      ],
    );
  }
}

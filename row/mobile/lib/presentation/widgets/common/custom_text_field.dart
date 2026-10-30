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

    // Field style comes from the app theme (design.md 8.6): outlined, label on the border, ink focus ring.
    return TextFormField(
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
      style: AppFonts.body(
        fontSize: 16,
        color: widget.enabled ? AppColors.textPrimary : AppColors.textMuted,
      ),
      decoration: InputDecoration(
        label: Text(widget.label), // the i18n Text widget, so labels are translated
        hintText: widget.hint,
        prefixIcon: widget.prefixIcon != null
            ? Icon(
                widget.prefixIcon,
                size: 20,
                color: isFocused ? AppColors.textPrimary : AppColors.textSecondary,
              )
            : null,
        suffixIcon: widget.obscureText
            ? IconButton(
                icon: Icon(
                  _obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                  size: 20,
                  color: AppColors.textSecondary,
                ),
                onPressed: () => setState(() => _obscure = !_obscure),
              )
            : widget.suffixIcon,
        counterText: '',
        // Allow validation messages to wrap instead of clipping to one
        // line with an ellipsis (e.g. the country-aware phone error).
        errorMaxLines: 2,
        alignLabelWithHint: isMultiline,
      ),
    );
  }
}

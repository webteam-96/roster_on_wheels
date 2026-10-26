import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import 'custom_button.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class ConfirmationDialog extends StatelessWidget {
  final String title;
  final String message;
  final String confirmLabel;
  final String cancelLabel;
  final ButtonVariant confirmVariant;
  final VoidCallback onConfirm;

  const ConfirmationDialog({
    super.key,
    required this.title,
    required this.message,
    this.confirmLabel = 'Delete',
    this.cancelLabel = 'Cancel',
    this.confirmVariant = ButtonVariant.danger,
    required this.onConfirm,
  });

  static Future<bool> show(
    BuildContext context, {
    required String title,
    required String message,
    String confirmLabel = 'Delete',
    String cancelLabel = 'Cancel',
    ButtonVariant confirmVariant = ButtonVariant.danger,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => ConfirmationDialog(
        title: title,
        message: message,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        confirmVariant: confirmVariant,
        onConfirm: () => Navigator.of(ctx).pop(true),
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: const BoxDecoration(
              color: AppColors.errorLight,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.warning_amber_rounded, color: AppColors.error, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(title, style: AppTextStyles.h4)),
        ],
      ),
      content: Text(message, style: AppTextStyles.body),
      actions: [
        CustomButton(
          label: cancelLabel,
          variant: ButtonVariant.outline,
          onPressed: () => Navigator.of(context).pop(false),
        ),
        const SizedBox(width: 8),
        CustomButton(
          label: confirmLabel,
          variant: confirmVariant,
          onPressed: onConfirm,
        ),
      ],
      actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
    );
  }
}

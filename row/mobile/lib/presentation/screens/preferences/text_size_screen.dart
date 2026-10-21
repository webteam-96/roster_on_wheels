import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/preferences/font_scale_controller.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class TextSizeScreen extends StatelessWidget {
  const TextSizeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<FontScaleController>();
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: CustomAppBar(
        title: 'Text Size',
        onBack: () => context.canPop() ? context.pop() : context.go(RouteNames.home),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Make text bigger or smaller',
              style: AppFonts.display(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Choose how text is displayed throughout the app. Your choice is saved on this device.',
              style: AppTextStyles.body.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.xl),
            _OptionCard(
              label: 'Use system setting',
              description: 'Follow your device accessibility settings',
              sampleSize: 16,
              selected: controller.scale == FontScale.system,
              onTap: () => controller.setScale(FontScale.system),
            ),
            const SizedBox(height: 10),
            _OptionCard(
              label: 'Small',
              description: '90%',
              sampleSize: 13,
              selected: controller.scale == FontScale.small,
              onTap: () => controller.setScale(FontScale.small),
            ),
            const SizedBox(height: 10),
            _OptionCard(
              label: 'Default',
              description: '100%',
              sampleSize: 16,
              selected: controller.scale == FontScale.medium,
              onTap: () => controller.setScale(FontScale.medium),
            ),
            const SizedBox(height: 10),
            _OptionCard(
              label: 'Large',
              description: '120%',
              sampleSize: 20,
              selected: controller.scale == FontScale.large,
              onTap: () => controller.setScale(FontScale.large),
            ),
            const SizedBox(height: 10),
            _OptionCard(
              label: 'Extra Large',
              description: '140%',
              sampleSize: 24,
              selected: controller.scale == FontScale.extraLarge,
              onTap: () => controller.setScale(FontScale.extraLarge),
            ),
            const SizedBox(height: AppSpacing.xl),
            _PreviewCard(),
          ],
        ),
      ),
    );
  }
}

class _OptionCard extends StatelessWidget {
  final String label;
  final String description;
  final double sampleSize;
  final bool selected;
  final VoidCallback onTap;

  const _OptionCard({
    required this.label,
    required this.description,
    required this.sampleSize,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
              width: selected ? 1.6 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                color: selected ? AppColors.primary : AppColors.textMuted,
                size: 22,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: AppFonts.body(fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              MediaQuery(
                data: MediaQuery.of(context).copyWith(textScaler: TextScaler.noScaling),
                child: Text(
                  'Aa',
                  style: AppFonts.body(
                    fontSize: sampleSize,
                    fontWeight: FontWeight.w800,
                    color: selected ? AppColors.primary : AppColors.textSecondary,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PreviewCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Preview',
            style: AppTextStyles.caption.copyWith(
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Welcome to Rotary',
            style: AppFonts.display(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Service Above Self: connect with members, manage events, and stay updated with your club and district.',
            style: AppFonts.body(fontSize: 14,
              height: 1.5,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

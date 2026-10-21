import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/security/biometric_controller.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class SecuritySettingsScreen extends StatelessWidget {
  const SecuritySettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<BiometricController>();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Security',
        onBack: () {
          if (context.canPop()) {
            context.pop();
          } else {
            context.go(RouteNames.home);
          }
        },
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildHeader(),
          const SizedBox(height: 16),
          if (!controller.initialized)
            _statusCard(
              icon: Icons.hourglass_empty_rounded,
              title: 'Checking device…',
              subtitle: 'One moment.',
              tint: AppColors.primaryLight,
            )
          else if (!controller.supported)
            _statusCard(
              icon: Icons.no_encryption_rounded,
              title: 'Device authentication unavailable',
              subtitle:
                  'Set a phone passcode (and optionally Face ID / fingerprint) in your phone Settings to enable App Lock.',
              tint: AppColors.error.withValues(alpha: 0.08),
            )
          else
            _buildModeCard(context, controller),
          const SizedBox(height: 16),
          _buildHowItWorks(),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Row(children: [
      Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(Icons.shield_outlined,
            color: Colors.white, size: 26),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Security',
              style: AppFonts.display(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'Control how the app protects your account.',
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary),
            ),
          ],
        ),
      ),
    ]);
  }

  Widget _buildModeCard(
      BuildContext context, BiometricController controller) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'App Lock',
            style: AppTextStyles.bodyMedium
                .copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            'Choose how to unlock the app on a fresh start.',
            style: AppTextStyles.caption
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 12),
          _modeRow(
            context: context,
            controller: controller,
            mode: LockMode.off,
            icon: Icons.lock_open_rounded,
            title: 'Off',
            subtitle: 'No lock. The app opens directly.',
            disabled: false,
          ),
          _modeDivider(),
          _modeRow(
            context: context,
            controller: controller,
            mode: LockMode.biometric,
            icon: Icons.fingerprint_rounded,
            title: controller.biometricEnrolled
                ? controller.prettyLabel
                : 'Biometric',
            subtitle: controller.biometricEnrolled
                ? 'Use ${controller.prettyLabel}. Falls back to your phone passcode if biometric fails.'
                : 'No biometric is enrolled on this device. Add Face ID / fingerprint in phone Settings to use this option.',
            disabled: !controller.biometricEnrolled,
          ),
          _modeDivider(),
          _modeRow(
            context: context,
            controller: controller,
            mode: LockMode.passcode,
            icon: Icons.password_rounded,
            title: 'Device Passcode',
            subtitle:
                'Use the same passcode you use to unlock your phone. Skips biometric entirely.',
            disabled: false,
          ),
        ],
      ),
    );
  }

  Widget _modeDivider() => const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: const Divider(height: 1, color: AppColors.border),
      );

  Widget _modeRow({
    required BuildContext context,
    required BiometricController controller,
    required LockMode mode,
    required IconData icon,
    required String title,
    required String subtitle,
    required bool disabled,
  }) {
    final selected = controller.mode == mode;
    final fg = disabled ? AppColors.textMuted : AppColors.textPrimary;
    final accent = disabled ? AppColors.textMuted : AppColors.primary;

    return InkWell(
      onTap: disabled
          ? null
          : () async {
              if (selected) return;
              final ok = await controller.setMode(mode);
              if (!ok && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    backgroundColor: AppColors.error,
                    content: Text(
                      'Could not verify. App Lock not changed.',
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                );
              }
            },
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: (selected
                        ? AppColors.primary
                        : AppColors.primaryLight)
                    .withValues(alpha: selected ? 1 : 0.5),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                icon,
                color: selected ? Colors.white : accent,
                size: 22,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: AppTextStyles.bodyMedium.copyWith(
                      fontWeight: FontWeight.w700,
                      color: fg,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: AppTextStyles.caption.copyWith(
                      color: AppColors.textSecondary,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: selected ? AppColors.primary : AppColors.border,
                  width: 2,
                ),
                color: selected ? AppColors.primary : Colors.transparent,
              ),
              child: selected
                  ? const Icon(Icons.check_rounded,
                      color: Colors.white, size: 14)
                  : null,
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color tint,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.textPrimary),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTextStyles.bodyMedium),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHowItWorks() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('How App Lock works', style: AppTextStyles.bodyMedium),
          const SizedBox(height: 8),
          _bullet(
              'Asks for authentication only when the app starts fresh (after a force-quit or phone restart).'),
          _bullet(
              'Switching apps and coming back does not re-prompt: your session stays unlocked.'),
          _bullet(
              'In Biometric mode, your phone passcode is the automatic fallback if Face ID / fingerprint fails.'),
          _bullet(
              'If everything fails, sign in again with OTP. Logging out turns App Lock off.'),
        ],
      ),
    );
  }

  Widget _bullet(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 6, right: 8),
            child: Container(
              width: 4,
              height: 4,
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
            ),
          ),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }
}

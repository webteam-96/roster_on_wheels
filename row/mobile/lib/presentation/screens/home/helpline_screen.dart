import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../../core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Helpline" contact screen. Reachable from the drawer (Support section). The
/// contacts are the instance's support details from the brand (api/public/brand);
/// a contact the brand does not set is not shown.
class HelplineScreen extends StatelessWidget {
  const HelplineScreen({super.key});

  static BrandInfo get _brand => Brand.current;

  Future<void> _launch(BuildContext context, Uri uri) async {
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open ${uri.toString()}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Helpline',
        onBack: () => context.canPop() ? context.pop() : context.go(RouteNames.home),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
        children: [
          _buildHero(),
          const SizedBox(height: 24),
          _buildSectionLabel('Office hours'),
          const SizedBox(height: 12),
          _buildOfficeHoursCard(),
          const SizedBox(height: 24),
          _buildSectionLabel('Get in touch'),
          const SizedBox(height: 12),
          for (final phone in _brand.supportPhones) ...[
            _ContactCard(
              icon: Icons.phone_rounded,
              iconColor: AppColors.success,
              label: 'Call us',
              value: phone,
              onTap: () =>
                  _launch(context, Uri.parse('tel:${phone.replaceAll(' ', '')}')),
            ),
            const SizedBox(height: 10),
          ],
          if (_brand.supportEmail.isNotEmpty) ...[
            _ContactCard(
              icon: Icons.mail_rounded,
              iconColor: AppColors.error,
              label: 'Email',
              value: _brand.supportEmail,
              onTap: () => _launch(context, Uri(scheme: 'mailto', path: _brand.supportEmail)),
            ),
            const SizedBox(height: 10),
          ],
          if (_brand.adminOrigin.isNotEmpty)
            _ContactCard(
              icon: Icons.language_rounded,
              iconColor: AppColors.primary,
              label: 'Website',
              value: Uri.parse(_brand.adminOrigin).host,
              onTap: () => _launch(context, Uri.parse(_brand.adminOrigin)),
            ),
        ],
      ),
    );
  }

  Widget _buildHero() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 20),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.support_agent_rounded,
                color: Colors.white, size: 34),
          ),
          const SizedBox(height: 16),
          Text(
            'How can we help?',
            style: AppFonts.body(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Reach the ${_brand.productName} support team: '
            'we are here to assist you.',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 13,
              height: 1.4,
              fontWeight: FontWeight.w500,
              color: Colors.white.withValues(alpha: 0.85),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionLabel(String label) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Text(
        label.toUpperCase(),
        style: AppFonts.body(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.2,
          color: AppColors.textMuted,
        ),
      ),
    );
  }

  Widget _buildOfficeHoursCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.schedule_rounded, color: AppColors.primary, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _brand.supportHours.isEmpty ? '–' : _brand.supportHours,
                  style: AppFonts.body(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ContactCard extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;
  final VoidCallback onTap;

  const _ContactCard({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: iconColor, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      value,
                      style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right_rounded,
                  color: AppColors.textMuted, size: 22),
            ],
          ),
        ),
      ),
    );
  }
}

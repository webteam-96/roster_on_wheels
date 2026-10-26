import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../../../core/features/feature_controller.dart';
import '../../../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Quick Links" tab of the District Admin dashboard — mirrors the web landing:
/// a list of cards (Web Links / Sub Groups / Mass Email). Tapping a card opens
/// that module's full detail page.
class QuickLinksTab extends StatelessWidget {
  final int districtId;
  const QuickLinksTab({super.key, required this.districtId});

  @override
  Widget build(BuildContext context) {
    final items = <_QuickLink>[
      _QuickLink(
        icon: Icons.link_rounded,
        color: AppColors.accentBlue,
        title: 'Web Links',
        subtitle: 'Curated URLs, PDFs & pages for the district',
        route: '/districts/$districtId/weblinks',
      ),
      _QuickLink(
        icon: Icons.groups_outlined,
        color: AppColors.success,
        title: 'Sub Groups',
        subtitle: 'Custom member groupings for the current year',
        route: '/districts/$districtId/sub-groups',
      ),
      _QuickLink(
        icon: Icons.mail_outline_rounded,
        color: AppColors.warningDark,
        title: 'Mass Email',
        subtitle: 'Compose & send bulk emails to district recipients',
        route: '/districts/$districtId/mass-emails',
      ),
      _QuickLink(
        icon: Icons.forum_outlined,
        color: AppColors.accentBlue,
        title: 'Goal Messages',
        subtitle: 'Write to the zone about a goal category',
        route: '/districts/$districtId/goal-messages',
      ),
      if (context.watch<FeatureController>().isOn('target_dashboard'))
        _QuickLink(
          icon: Icons.flag_outlined,
          color: AppColors.success,
          title: 'Targets',
          subtitle: 'Live progress of every club against its goals',
          route: '/districts/$districtId/targets',
        ),
    ];

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (ctx, i) => _QuickLinkCard(
        item: items[i],
        onTap: () => ctx.push(items[i].route),
      ),
    );
  }
}

class _QuickLink {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final String route;
  const _QuickLink({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.route,
  });
}

class _QuickLinkCard extends StatelessWidget {
  final _QuickLink item;
  final VoidCallback onTap;
  const _QuickLinkCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: item.color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(item.icon, color: item.color, size: 23),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      item.title,
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      item.subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                        fontSize: 11.5,
                        color: AppColors.slate500,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right_rounded,
                  size: 22, color: AppColors.slate400),
            ],
          ),
        ),
      ),
    );
  }
}

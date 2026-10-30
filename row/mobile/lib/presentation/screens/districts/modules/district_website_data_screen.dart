import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class _ModuleTile {
  final String key;
  final String label;
  final IconData icon;
  final Color color;
  final String? routePath; // null = stub
  const _ModuleTile({
    required this.key,
    required this.label,
    required this.icon,
    required this.color,
    this.routePath,
  });
}

class DistrictWebsiteDataScreen extends StatelessWidget {
  final int districtId;
  final bool embedded;
  const DistrictWebsiteDataScreen({super.key, required this.districtId, this.embedded = false});

  List<_ModuleTile> _tiles() => [
        _ModuleTile(
          key: 'banners',
          label: 'Banner Photos',
          icon: Icons.image_outlined,
          color: AppColors.accentBlue,
          routePath: '/districts/$districtId/website-data/banners',
        ),
        _ModuleTile(
          key: 'advertisements',
          label: 'Advertisement Area',
          icon: Icons.campaign_outlined,
          color: AppColors.warningDark,
          routePath: '/districts/$districtId/website-data/advertisements',
        ),
        _ModuleTile(
          key: 'social_media_links',
          label: 'Social Media Links',
          icon: Icons.share_outlined,
          color: AppColors.accentBlue,
          routePath: '/districts/$districtId/website-data/social-media-links',
        ),
        _ModuleTile(
          key: 'contact_details',
          label: 'Contact Details',
          icon: Icons.contact_phone_outlined,
          color: AppColors.accentBlue,
          routePath: '/districts/$districtId/website-data/contact-details',
        ),
        _ModuleTile(
          key: 'menu_list',
          label: 'Menu List',
          icon: Icons.list_alt_outlined,
          color: AppColors.errorDark,
          routePath: '/districts/$districtId/website-data/menu-list',
        ),
        _ModuleTile(
          key: 'about',
          label: 'About',
          icon: Icons.info_outline,
          color: AppColors.success,
          routePath: '/districts/$districtId/website-data/about',
        ),
      ];

  void _onTap(BuildContext context, _ModuleTile tile) {
    if (tile.routePath != null) {
      context.push(tile.routePath!);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Coming soon: open the web admin to use this.'),
          duration: Duration(seconds: 3),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final tiles = _tiles();
    // Same design language as the club's "My Club Website" → Website Management
    // card: a white card with a title + subtitle, then a 2-col grid of slate50
    // tiles (40px circular icon chip + 2-line label, fixed 112px height).
    final content = SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.slate200),
        ),
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Website Management',
              style: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            Text(
              'Edit your public district website content',
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.slate500,
              ),
            ),
            const SizedBox(height: 12),
            GridView(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                mainAxisExtent: 124,
              ),
              children: [
                for (final t in tiles)
                  _HubTile(tile: t, onTap: () => _onTap(context, t)),
              ],
            ),
          ],
        ),
      ),
    );
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: embedded ? null : const CustomAppBar(title: 'Website Data'),
      body: content,
    );
  }
}

class _HubTile extends StatelessWidget {
  final _ModuleTile tile;
  final VoidCallback onTap;
  const _HubTile({required this.tile, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.slate50,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: tile.color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(tile.icon, color: tile.color, size: 20),
              ),
              const SizedBox(height: 8),
              Flexible(
                child: Text(
                  tile.label,
                  textAlign: TextAlign.center,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

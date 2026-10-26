import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/features/feature_controller.dart';
import '../../../core/security/biometric_controller.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/routing/route_names.dart';
import '../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class _DrawerItem {
  final String title;
  final IconData icon;
  final String route;
  final bool superAdminOnly;
  /// Open on top of the current screen so its app bar offers back (the member's own screens have no other way out).
  final bool push;

  const _DrawerItem(this.title, this.icon, this.route, {this.superAdminOnly = false, this.push = false});
}

// One entry-point to /settings — that screen now hosts Theme, Font, App Lock,
// Unified Tiles (and admin-only Configuration when applicable).
const _settingsItems = [
  _DrawerItem('Settings', Icons.settings_rounded, RouteNames.settings,
      superAdminOnly: false),
];

// The member's own items; each shows only while its module switch is on (FeatureController).
const _meItems = [
  (feature: 'planning_mode', item: _DrawerItem('Next year', Icons.event_repeat_outlined, RouteNames.nextYear, push: true)),
  (feature: 'chat', item: _DrawerItem('Chat', Icons.chat_bubble_outline, RouteNames.chat, push: true)),
  (feature: 'membership_fields', item: _DrawerItem('My Foundation designations', Icons.workspace_premium_outlined, RouteNames.myDesignations, push: true)),
  (feature: 'volunteers', item: _DrawerItem('Volunteering', Icons.volunteer_activism_outlined, RouteNames.volunteers, push: true)),
  (feature: 'volunteers', item: _DrawerItem('My meeting duties', Icons.assignment_ind_outlined, RouteNames.myDuties, push: true)),
  (feature: 'contacts_growth', item: _DrawerItem('Invite a guest', Icons.group_add_outlined, RouteNames.inviteGuest, push: true)),
];

const _supportItems = [
  _DrawerItem('Helpline', Icons.support_agent_rounded, RouteNames.helpline),
];

class CustomDrawer extends StatelessWidget {
  const CustomDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final features = context.watch<FeatureController>();
    final currentRoute = GoRouterState.of(context).uri.toString();

    return Drawer(
      backgroundColor: AppColors.white,
      surfaceTintColor: AppColors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topRight: Radius.circular(24),
          bottomRight: Radius.circular(24),
        ),
      ),
      child: Column(
        children: [
          // ── Profile Header ─────────────────────────────────────────────
          GestureDetector(
            onTap: () {
              Navigator.of(context).pop();
              context.push(RouteNames.profile);
            },
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 60, AppSpacing.lg, AppSpacing.lg),
              decoration: BoxDecoration(
                gradient: AppGradients.royalSweep,

              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      // Avatar circle
                      Container(
                        width: 68,
                        height: 68,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.white.withOpacity(0.5), width: 3),

                        ),
                        child: ClipOval(
                          child: _buildAvatarContent(auth),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              auth.memberName.isNotEmpty ? auth.memberName : 'Member',
                              style: AppTextStyles.h4.copyWith(
                                color: AppColors.white,
                                fontWeight: FontWeight.bold,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.goldPrime,
                                borderRadius: BorderRadius.circular(20),

                              ),
                              child: Text(
                                'VIEW PROFILE',
                                style: AppFonts.body(
                                  color: AppColors.darkBg,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  // Role badges (deduped, scope-aware)
                  if (auth.roleBadges.isNotEmpty)
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: auth.roleBadges
                          .map((label) => Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: AppColors.white.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                      color:
                                          AppColors.white.withOpacity(0.2)),
                                ),
                                child: Text(
                                  label.toUpperCase(),
                                  style: AppFonts.body(
                                    color: AppColors.white,
                                    fontSize: 9,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.3,
                                  ),
                                ),
                              ))
                          .toList(),
                    ),
                ],
              ),
            ),
          ),

          // ── Menu items ─────────────────────────────────────────────────
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(
                  vertical: AppSpacing.md, horizontal: AppSpacing.sm),
              children: [
                _buildSectionLabel('Preferences'),
                ..._settingsItems
                    .map((item) => _buildItem(context, item, currentRoute)),
                if (_meItems.any((m) => features.isOn(m.feature))) ...[
                  _buildSectionLabel('Me'),
                  for (final m in _meItems)
                    if (features.isOn(m.feature)) _buildItem(context, m.item, currentRoute),
                ],
                _buildSectionLabel('Support'),
                ..._supportItems
                    .map((item) => _buildItem(context, item, currentRoute)),
              ],
            ),
          ),

          // ── Logout ─────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: InkWell(
              onTap: () async {
                final confirmed = await _confirmLogout(context);
                if (!confirmed) return;
                if (!context.mounted) return;
                final biometric = context.read<BiometricController>();
                // Capture the router BEFORE popping the drawer — once the
                // drawer closes, this `context` is unmounted, so a post-pop
                // `context.go` would silently no-op. Using the captured router
                // makes the reset reliable: `go` clears the whole stack, so no
                // previous-session screen (e.g. a club overview) can linger.
                final router = GoRouter.of(context);
                Navigator.of(context).pop();
                await biometric.clear();
                await auth.logout();
                router.go(RouteNames.login);
              },
              borderRadius: BorderRadius.circular(16),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                decoration: BoxDecoration(
                  color: AppColors.error.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.error.withOpacity(0.1)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.logout_rounded, color: AppColors.error, size: 22),
                    const SizedBox(width: 12),
                    Text(
                      'Logout Account', 
                      style: AppTextStyles.bodySemiBold.copyWith(color: AppColors.error),
                    ),
                    const Spacer(),
                    Icon(Icons.chevron_right_rounded, color: AppColors.error.withOpacity(0.5), size: 20),
                  ],
                ),
              ),
            ),
          ),
          const _VersionFooter(),
          const SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }

  Future<bool> _confirmLogout(BuildContext context) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 8),
        contentPadding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        title: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.error.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.logout_rounded, color: AppColors.error, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Logout',
                style: AppFonts.display(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          ],
        ),
        content: Text(
          'Are you sure you want to log out of your account?',
          style: AppFonts.body(fontSize: 14,
            color: AppColors.textSecondary,
            height: 1.45,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.textSecondary,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
            ),
            child: Text(
              'Cancel',
              style: AppFonts.body(fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: AppColors.white,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: Text(
              'Logout',
              style: AppFonts.body(fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  String _initials(String name) {
    final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  Widget _buildAvatarContent(AuthProvider auth) {
    final fallback = Container(
      color: AppColors.white.withOpacity(0.2),
      child: Center(
        child: Text(
          _initials(auth.memberName),
          style: AppFonts.body(
            color: AppColors.white,
            fontSize: 24,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
    final url = ApiConstants.mediaUrl(auth.profilePhotoPath);
    if (url.isEmpty) return fallback;
    return CachedNetworkImage(
      imageUrl: url,
      fit: BoxFit.cover,
      width: 68,
      height: 68,
      placeholder: (_, __) => fallback,
      errorWidget: (_, __, ___) => fallback,
    );
  }

  Widget _buildSectionLabel(String label) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, AppSpacing.sm),
      child: Text(
        label.toUpperCase(),
        style: AppFonts.body(
          fontWeight: FontWeight.w800,
          letterSpacing: 1.5,
          fontSize: 10,
          color: AppColors.textMuted,
        ),
      ),
    );
  }

  Widget _buildItem(BuildContext context, _DrawerItem item, String currentRoute) {
    final isActive = currentRoute.startsWith(item.route);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
      child: ListTile(
        leading: Icon(
          item.icon, 
          size: 22,
          color: isActive ? AppColors.primaryPrime : AppColors.textSecondary,
        ),
        title: Text(
          item.title,
          style: AppTextStyles.bodySemiBold.copyWith(
            color: isActive ? AppColors.primaryPrime : AppColors.textPrimary,
            fontSize: 14,
          ),
        ),
        selected: isActive,
        selectedTileColor: AppColors.primaryPrime,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 0),
        horizontalTitleGap: 12,
        onTap: () {
          Navigator.of(context).pop();
          item.push ? context.push(item.route) : context.go(item.route);
        },
      ),
    );
  }
}

class _VersionFooter extends StatelessWidget {
  const _VersionFooter();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snapshot) {
        final label = switch (snapshot.connectionState) {
          ConnectionState.done when snapshot.hasData =>
            'Version ${snapshot.data!.version} (${snapshot.data!.buildNumber})',
          ConnectionState.done => 'Version unavailable',
          _ => 'Loading version…',
        };
        return Padding(
          key: const ValueKey('custom_drawer_version_footer'),
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: 4),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: AppFonts.body(fontSize: 11,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
              letterSpacing: 0.3,
            ),
          ),
        );
      },
    );
  }
}

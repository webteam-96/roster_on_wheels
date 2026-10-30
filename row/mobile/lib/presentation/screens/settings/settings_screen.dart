import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/preferences/home_layout_controller.dart';
import 'package:provider/provider.dart';
import '../../../core/features/feature_controller.dart';
import '../../../core/constants/feature_flags.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import '../../../core/i18n/live_translator.dart';
import 'language_screen.dart';

// ---------------------------------------------------------------------------
// Tile data model
// ---------------------------------------------------------------------------
class _SettingsTile {
  final IconData icon;
  final String title;
  final String subtitle;
  final String? route;
  final Color color;

  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.route,
    required this.color,
  });
}

final List<_SettingsTile> _tiles = <_SettingsTile>[
  const _SettingsTile(
    icon: Icons.calendar_today_rounded,
    title: 'Rotary Years',
    subtitle: 'Manage Rotary year periods',
    route: RouteNames.rotaryYears,
    color: AppColors.accentBlue,
  ),
  const _SettingsTile(
    icon: Icons.badge_rounded,
    title: 'Designations',
    subtitle: 'Manage member designations',
    route: RouteNames.designations,
    color: AppColors.accentBlue,
  ),
  const _SettingsTile(
    icon: Icons.track_changes_rounded,
    title: 'Area of Focus',
    subtitle: 'Rotary areas of focus',
    route: RouteNames.areaOfFocus,
    color: AppColors.warningDark,
  ),
  const _SettingsTile(
    icon: Icons.event_rounded,
    title: 'Event Masters',
    subtitle: 'Master list of event types',
    route: RouteNames.eventMasters,
    color: AppColors.error,
  ),
  _SettingsTile(
    icon: Icons.payment_rounded,
    title: 'Club Dues',
    subtitle: 'Configure membership fee structure',
    route: RouteNames.membershipDues(0), 
    color: AppColors.success,
  ),
  const _SettingsTile(
    icon: Icons.web_rounded,
    title: 'Website Data',
    subtitle: 'Configure website data sections',
    route: RouteNames.websiteDataModules,
    color: AppColors.textSecondary,
  ),
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // ROW module switches (FeatureController): no tile for a skipped or switched-off module
    final features = context.watch<FeatureController>();
    // Redraw when the UI language changes: the Language tile shows the current one.
    context.dependOnInheritedWidgetOfExactType<TranslationScope>();
    final tiles = _tiles.where((t) => t.route == null || !features.isPathOff(t.route!)).toList();
    // Unified Tiles is a member-only convenience (merges the district + club
    // tile on home). It's hidden for every elevated/admin role and shown only to
    // plain members. Still requires 1 or 2 accessible districts AND at least one
    // accessible club so there's actually something to unify.
    final districtCount = auth.assignedDistrictIds.length;
    final isElevatedRole = auth.isSuperAdmin ||
        auth.isAdmin ||
        auth.isAG;
    final isMember = auth.isDistrictMember || auth.isClubMember;
    // Members whose ONLY clubs are special (COG and/or IFRM) have nothing to
    // unify: those clubs are hidden from the My Clubs card (and COG's district
    // from My Connections), so the unified hero would only resurface what we
    // deliberately hide. Hide the toggle for them. (A COG/IFRM member who also
    // belongs to a real club keeps it.)
    final isSpecialClubOnly =
        (auth.isCogMember || auth.isIfrmMember) && auth.nonSpecialClubIds.isEmpty;
    final canSeeUnifiedToggle = isMember &&
        !isElevatedRole &&
        !isSpecialClubOnly &&
        (districtCount == 1 || districtCount == 2) &&
        auth.assignedClubIds.isNotEmpty;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: CustomAppBar(
        title: 'Settings',
        showBack: true,
        centerTitle: false,
        onBack: () => context.go(RouteNames.home),
        titleStyle:
            AppFonts.body(fontWeight: FontWeight.bold, fontSize: 22),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Preferences (always visible) ─────────────────────────────
            Text(
              'Preferences',
              style: AppFonts.display(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Customize how the app looks and behaves for you',
              style:
                  AppTextStyles.body.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.lg),
            _PreferenceTile(
              icon: Icons.lock_outline_rounded,
              color: AppColors.warningDark,
              title: 'App Lock',
              subtitle: 'Require Face ID / passcode on launch',
              onTap: () => context.push(RouteNames.securitySettings),
            ),
            // Contact-visibility settings. Live once backend read-gating shipped
            // (kPrivacySettingsEnabled). The Notifications half stays hidden until
            // push-suppression lands (kNotificationPrefsEnabled) — the label and
            // subtitle widen to include notifications automatically when it does.
            if (Brand.current.feature('privacy.enabled'))
              _PreferenceTile(
                icon: Icons.folder_shared_outlined,
                color: AppColors.primaryPrime,
                title: 'My data',
                subtitle: 'Download your data or withdraw consent',
                onTap: () => context.push(RouteNames.myData),
              ),
            _PreferenceTile(
              icon: Icons.translate_rounded,
              color: AppColors.primaryPrime,
              title: 'Language',
              subtitle: appLanguages.firstWhere((l) => l.$1 == LiveTranslator.instance.language,
                  orElse: () => appLanguages.first).$2,
              onTap: () => context.push(RouteNames.language),
            ),
            if (features.isOn('communication') || features.isOn('meetings'))
              _PreferenceTile(
                icon: Icons.mark_email_read_outlined,
                color: AppColors.primaryPrime,
                title: 'Communication',
                subtitle: 'Email and push consent, calendar feed',
                onTap: () => context.push(RouteNames.commsPreferences),
              ),
            if (kPrivacySettingsEnabled)
              _PreferenceTile(
                icon: Icons.shield_outlined,
                color: AppColors.accentBlue,
                title: kNotificationPrefsEnabled
                    ? 'Privacy & Notifications'
                    : 'Privacy',
                subtitle: kNotificationPrefsEnabled
                    ? 'Control who sees your contact + push alerts'
                    : 'Control who can see your phone & email',
                onTap: () => context.push(RouteNames.memberSettings),
              ),
            if (canSeeUnifiedToggle) const _UnifiedTilesPreferenceTile(),

            // ── Configuration (admin only) ───────────────────────────────
            if (auth.canAccessSettings) ...[
              const SizedBox(height: AppSpacing.xl),
              Text(
                'Configuration',
                style: AppFonts.display(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Manage system configuration and master data',
                style: AppTextStyles.body
                    .copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.lg),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  crossAxisSpacing: 16,
                  mainAxisSpacing: 16,
                  childAspectRatio: 0.9,
                ),
                itemCount: tiles.length,
                itemBuilder: (ctx, i) => _SettingsTileCard(tile: tiles[i]),
              ),
            ],
            const SizedBox(height: AppSpacing.xxl),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Preference Tile — list-row layout used in the Preferences section.
// Allows an optional trailing widget (e.g. Switch for Unified Tiles).
// ---------------------------------------------------------------------------
class _PreferenceTile extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final Widget? trailing;
  const _PreferenceTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    this.onTap,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.lightBorder, width: 1),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md, vertical: 14),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, size: 22, color: color),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: AppFonts.body(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: AppFonts.body(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                if (trailing != null) ...[
                  const SizedBox(width: 8),
                  trailing!,
                ] else
                  const Icon(Icons.chevron_right_rounded,
                      color: AppColors.textMuted, size: 22),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// Unified Tiles preference — inline Switch driven by HomeLayoutController.
class _UnifiedTilesPreferenceTile extends StatelessWidget {
  const _UnifiedTilesPreferenceTile();

  @override
  Widget build(BuildContext context) {
    final layout = context.watch<HomeLayoutController>();
    return _PreferenceTile(
      icon: Icons.dashboard_customize_rounded,
      color: AppColors.primaryPrime,
      title: 'Unified Tiles',
      subtitle: 'One tile for district + club on home',
      onTap: () => layout.setUnifiedHomeEnabled(!layout.unifiedHomeEnabled),
      trailing: Switch.adaptive(
        value: layout.unifiedHomeEnabled,
        onChanged: (v) => layout.setUnifiedHomeEnabled(v),
        activeColor: AppColors.primaryPrime,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Tile Card
// ---------------------------------------------------------------------------
class _SettingsTileCard extends StatelessWidget {
  final _SettingsTile tile;
  const _SettingsTileCard({required this.tile});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.lightBorder, width: 1),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(24),
          onTap: tile.route != null ? () => context.push(tile.route!) : null,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: tile.color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(tile.icon, size: 28, color: tile.color),
                ),
                const SizedBox(height: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tile.title,
                      style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        height: 1.2,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      tile.subtitle,
                      style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                        fontWeight: FontWeight.w500,
                        height: 1.3,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/features/feature_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/constants/feature_flags.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../data/models/wallet_models.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../widgets/weblinks/weblinks_section.dart';
import '../../../data/models/dashboard_module_model.dart';
import '../../../data/models/module_coming_soon_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/module_status_badge.dart';
import '../../widgets/common/coming_soon_badge.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'overview/widgets/district_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Selectable visual layouts for the District dashboard.
enum _DashboardVariant {
  list,     // Single-column grouped rows (most scannable)
  featured, // First module per group is a hero tile, rest in 3-col grid
}

const String _kVariantPrefKey = 'district_dashboard_variant';

class DistrictDashboardScreen extends StatefulWidget {
  final int districtId;
  const DistrictDashboardScreen({super.key, required this.districtId});

  @override
  State<DistrictDashboardScreen> createState() => _DistrictDashboardScreenState();
}

class _DistrictDashboardScreenState extends State<DistrictDashboardScreen>
    with SingleTickerProviderStateMixin {
  final ApiClient _api = ApiClient();
  String _districtTitle = '';
  List<DashboardModuleGroup> _groups = [];
  bool _loading = true;
  String? _error;
  int? _emailRemaining;
  _DashboardVariant _variant = _DashboardVariant.list;
  ComingSoonRegistry _comingSoon = ComingSoonRegistry.empty();

  late final AnimationController _adminFlashController;
  late final Animation<double> _adminFlashAnim;

  @override
  void initState() {
    super.initState();
    _adminFlashController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 850),
    )..repeat(reverse: true);
    _adminFlashAnim = Tween<double>(begin: 0.35, end: 1.0).animate(
      CurvedAnimation(parent: _adminFlashController, curve: Curves.easeInOut),
    );
    _fetchDashboard();
    _fetchCredits();
    _loadVariant();
    // Pull fresh role assignments so a role granted/revoked server-side
    // mid-session is reflected here — keeps the admin button honest and
    // avoids it deep-linking into a backend 403 on the overview dashboard.
    // The re-login prompt itself is app-wide (RoleChangeWatcher in app.dart).
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      await Provider.of<AuthProvider>(context, listen: false).refreshContext();
    });
  }

  @override
  void dispose() {
    _adminFlashController.dispose();
    super.dispose();
  }

  Future<void> _loadVariant() async {
    final prefs = await SharedPreferences.getInstance();
    final storedVariant = prefs.getString(_kVariantPrefKey);
    if (!mounted) return;
    setState(() {
      if (storedVariant != null) {
        _variant = _DashboardVariant.values.firstWhere(
          (v) => v.name == storedVariant,
          orElse: () => _DashboardVariant.list,
        );
      }
    });
  }

  Future<void> _setVariant(_DashboardVariant v) async {
    setState(() => _variant = v);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kVariantPrefKey, v.name);
  }

  Future<void> _fetchCredits() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
        '/api/credit-management/district/${widget.districtId}/balance',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = res.data;
      if (data != null && mounted) {
        setState(() {
          _emailRemaining = data['emailRemaining'] as int?;
        });
      }
    } catch (_) {
      // silently ignore; credit badge is optional
    }
  }

  Future<void> _fetchDashboard() async {
    final features = context.read<FeatureController>(); // read before any await
    setState(() { _loading = true; _error = null; });
    try {
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.districtDashboardModules(widget.districtId),
      );
      final data = res.data;
      if (data != null) {
        final districtNumber = data['districtNumber'] as String?;
        _districtTitle = districtNumber != null && districtNumber.isNotEmpty
            ? districtNumber
            : '${widget.districtId}';
        _groups = (data['moduleGroups'] as List<dynamic>? ?? [])
            .map((e) => DashboardModuleGroup.fromJson(e as Map<String, dynamic>))
            // Goal Setting hidden for release: drop its tile (see kGoalSettingEnabled).
            .map((g) => kGoalSettingEnabled
                ? g
                : DashboardModuleGroup(
                    categoryId: g.categoryId,
                    categoryName: g.categoryName,
                    sortOrder: g.sortOrder,
                    modules: g.modules.where((m) {
                      final k = m.moduleKey
                          .toLowerCase()
                          .replaceAll(' ', '')
                          .replaceAll('_', '')
                          .replaceAll('-', '');
                      return k != 'goalsetting';
                    }).toList(),
                  ))
            // ROW module switches (FeatureController): skipped or switched-off modules lose their tile
            .map((g) => DashboardModuleGroup(
                  categoryId: g.categoryId,
                  categoryName: g.categoryName,
                  sortOrder: g.sortOrder,
                  modules: g.modules.where((m) {
                    final route = _routeFor(m.moduleKey);
                    return route == null || !features.isPathOff(route);
                  }).toList(),
                ))
            .where((g) => g.modules.isNotEmpty)
            .toList();
      }
      final comingSoon = await ComingSoonRegistry.fetch(_api);
      if (mounted) {
        setState(() {
          _comingSoon = comingSoon;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String? _routeFor(String moduleKey) {
    final key = moduleKey.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '');
    final id = widget.districtId;
    switch (key) {
      case 'directory':           return RouteNames.districtMembers(id);
      // District goal ENTRY — set district-level targets by category, mirroring
      // the web District Admin page.
      // Disabled while Goal Setting is hidden for release.
      case 'goalsetting':
        return kGoalSettingEnabled ? RouteNames.districtGoalSetting(id) : null;
      case 'districtcalendar':    return RouteNames.districtCalendarFor(id);
      case 'calendar':
      case 'upcomingevents':      return RouteNames.districtUpcomingEvents(id);
      case 'announcements':       return RouteNames.districtAnnouncements(id);
      case 'districtevents':      return RouteNames.districtEvents(id);
      case 'districtprojects':    return RouteNames.districtProjects(id);
      case 'newsletter':
      case 'newsletters':         return RouteNames.districtNewsletters(id);
      case 'documents':           return RouteNames.districtDocuments(id);
      case 'districtcommittee':   return RouteNames.districtCommittee(id);
      case 'clubs':               return RouteNames.districtClubs(id);
      case 'clubmonthlyreport':
      case 'cmr':                 return RouteNames.districtCmr(id);
      case 'weblinks':            return RouteNames.districtWeblinks(id);
      case 'subgroups':           return RouteNames.districtSubGroups(id);
      case 'massemails':
      case 'massemail':           return RouteNames.districtMassEmails(id);
      case 'greetings':           return RouteNames.districtGreetings(id);
      case 'websitedata':         return RouteNames.districtWebsiteData(id);
      case 'districtcitation':    return RouteNames.districtCitation(id);
      case 'reports':             return RouteNames.districtReports(id);
      case 'onlineeventlink':     return RouteNames.districtOnlineEventLink(id);
      case 'clubdues':            return RouteNames.districtClubDues(id);
      case 'ag':
      case 'assistantgovernor':   return RouteNames.districtAg(id);
      case 'wallet':
        // Admins-only: top-up lives here and the screen already gates the buy
        // button. Non-admins get a non-tappable tile (route null) rather than a
        // read-only wallet, matching the requested admin-only scope.
        return Provider.of<AuthProvider>(context, listen: false)
                .isDistrictAdminOf(id)
            ? RouteNames.walletDistrictFor(id)
            : null;
      case 'email':
        return Provider.of<AuthProvider>(context, listen: false)
                .isDistrictAdminOf(id)
            ? RouteNames.walletDistrictFor(id,
                creditType: WalletCreditType.email)
            : null;
      default:                    return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAdminHere = context.watch<AuthProvider>().isDistrictAdminOf(widget.districtId);
    final showBadge = isAdminHere;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: Stack(
        children: [
          RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _fetchDashboard,
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
          SliverAppBar(
            pinned: true,
            backgroundColor: AppColors.primaryPrime,
            foregroundColor: Colors.white,
            elevation: 0,
            centerTitle: true,
            leading: IconButton(
              icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
              onPressed: () => context.pop(),
            ),
            title: Text(
              _districtTitle.isEmpty ? 'District Dashboard' : _districtTitle.toUpperCase(),
              style: AppFonts.body(
                fontWeight: FontWeight.w800,
                fontSize: 16,
                color: Colors.white,
                letterSpacing: 1,
              ),
            ),
            actions: [
              IconButton(
                tooltip: 'Choose a layout',
                icon: const Icon(Icons.dashboard_customize_rounded, color: Colors.white),
                onPressed: _showVariantPicker,
              ),
            ],
          ),
          SliverToBoxAdapter(
            child: _loading
                ? const Padding(
                    padding: EdgeInsets.only(top: 100),
                    child: LoadingWidget(),
                  )
                : _error != null
                    ? Padding(
                        padding: const EdgeInsets.only(top: 60),
                        child: DaError(error: _error!, onRetry: _fetchDashboard),
                      )
                    : _groups.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.only(top: 60),
                            child: EmptyStateWidget(
                              icon: Icons.dashboard_rounded,
                              title: 'No Modules',
                              subtitle: 'No modules configured for this district.',
                            ),
                          )
                        : _buildVariantBody(_groups),
          ),
              ],
            ),
          ),
          if (showBadge)
            Positioned(
              right: 16,
              bottom: 20,
              child: _buildAdminPill(
                onTap: () => context.push(RouteNames.districtOverview(widget.districtId)),
                elevated: true,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildAdminPill({required VoidCallback onTap, bool elevated = false}) {
    return FadeTransition(
      opacity: _adminFlashAnim,
      child: Material(
        color: elevated ? AppColors.primaryPrime : AppColors.primaryPrime.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(20),
        elevation: elevated ? 6 : 0,
        shadowColor: elevated ? Colors.black.withValues(alpha: 0.35) : Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 1),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.verified_user_rounded, size: 14, color: Colors.white),
                const SizedBox(width: 5),
                Text(
                  'Admin',
                  style: AppFonts.body(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Variant dispatch
  // ──────────────────────────────────────────────────────────────────────────

  Widget _buildVariantBody(List<DashboardModuleGroup> groups) {
    switch (_variant) {
      case _DashboardVariant.list:     return _buildBodyList(groups);
      case _DashboardVariant.featured: return _buildBodyFeatured(groups);
    }
  }

  void _showVariantPicker() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 16, 8, 8),
            child: SingleChildScrollView(
              child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: Row(
                    children: [
                      Text(
                        'Choose a layout',
                        style: AppFonts.body(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                _variantOption(sheetContext, _DashboardVariant.list,     'List View',     'Single-column rows, scannable'),
                _variantOption(sheetContext, _DashboardVariant.featured, 'Featured',      'First module per group stands out'),
                const SizedBox(height: 8),
              ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _variantOption(BuildContext sheetContext, _DashboardVariant value, String title, String subtitle) {
    final selected = _variant == value;
    return RadioListTile<_DashboardVariant>(
      value: value,
      groupValue: _variant,
      onChanged: (v) {
        if (v == null) return;
        Navigator.of(sheetContext).pop();
        _setVariant(v);
      },
      title: Text(title,
          style: AppFonts.body(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: selected ? AppColors.primaryPrime : AppColors.textPrimary,
          )),
      subtitle: Text(subtitle,
          style: AppFonts.body(fontSize: 12, color: AppColors.textMuted)),
      activeColor: AppColors.primaryPrime,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12),
      dense: true,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // List variant — single-column grouped rows
  // ──────────────────────────────────────────────────────────────────────────

  Widget _buildBodyList(List<DashboardModuleGroup> groups) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.xxl),
      child: Column(
        children: [
          ...groups.map(_buildListGroupSection),
          WebLinksSection(
              baseEndpoint: '/api/mobile/districts/${widget.districtId}/weblinks'),
        ],
      ),
    );
  }

  Widget _buildListGroupSection(DashboardModuleGroup group) {
    final categoryColor = _categoryColor(group.categoryName, group.categoryId);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _categoryCaption(group.categoryName, categoryColor, bottomGap: 8),
        Container(
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.divider),
          ),
          child: Column(
            children: [
              for (int i = 0; i < group.modules.length; i++) ...[
                if (i > 0)
                  const Divider(height: 1, indent: 56, color: AppColors.divider),
                _buildListRow(group.modules[i], categoryColor),
              ],
            ],
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  /// email credit-balance badge for the Payments tiles (district
  /// admins only). Other modules have no badge here.
  ModuleBadge? _badgeFor(String moduleKey) {
    if (!context.read<AuthProvider>().isDistrictAdminOf(widget.districtId)) {
      return null;
    }
    switch (_normKey(moduleKey)) {
      case 'email':
        return _emailRemaining == null
            ? null
            : ModuleBadge.credits(_emailRemaining!);
    }
    return null;
  }

  Widget _buildListRow(DashboardModuleModel m, Color accent) {
    final route = _routeFor(m.moduleKey);
    final cs = _comingSoon.isComingSoon(m.moduleKey);
    final badge = cs ? null : _badgeFor(m.moduleKey);
    final iconPath = m.iconPath;
    final hasImage = iconPath != null && iconPath.isNotEmpty;
    final imageUrl = hasImage ? '${ApiConstants.mediaBaseUrl}$iconPath' : null;
    final row = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: cs
            ? () => showComingSoonMessage(
                context, m.moduleName, _comingSoon.dateFor(m.moduleKey))
            : (route != null ? () => context.push(route) : null),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                padding: hasImage ? const EdgeInsets.all(6) : EdgeInsets.zero,
                decoration: BoxDecoration(
                  color: accent.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: hasImage
                    ? CachedNetworkImage(
                        imageUrl: imageUrl!,
                        fit: BoxFit.contain,
                        placeholder: (_, __) => Icon(_ModuleTile.fallbackIcon(m.moduleKey), color: accent, size: 18),
                        errorWidget: (_, __, ___) => Icon(_ModuleTile.fallbackIcon(m.moduleKey), color: accent, size: 18),
                      )
                    : Icon(_ModuleTile.fallbackIcon(m.moduleKey), color: accent, size: 18),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  m.moduleName,
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (badge != null) ...[
                ModuleBadgeChip(badge: badge),
                const SizedBox(width: 8),
              ],
              cs
                  ? const SizedBox(width: 4)
                  : const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted, size: 20),
            ],
          ),
        ),
      ),
    );
    if (!cs) return row;
    return Stack(
      children: [
        Opacity(opacity: 0.5, child: row),
        Positioned(
          right: 12,
          top: 0,
          bottom: 0,
          child: Center(
            child: ComingSoonBadge(date: _comingSoon.dateFor(m.moduleKey), dense: true),
          ),
        ),
      ],
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Featured variant — first module per group is a hero tile
  // ──────────────────────────────────────────────────────────────────────────

  Widget _buildBodyFeatured(List<DashboardModuleGroup> groups) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.xxl),
      child: Column(
        children: [
          ...groups.map(_buildFeaturedGroupSection),
          WebLinksSection(
              baseEndpoint: '/api/mobile/districts/${widget.districtId}/weblinks'),
        ],
      ),
    );
  }

  Widget _buildFeaturedGroupSection(DashboardModuleGroup group) {
    final categoryColor = _categoryColor(group.categoryName, group.categoryId);
    final modules = group.modules;
    if (modules.isEmpty) {
      return const SizedBox.shrink();
    }
    // Groups whose tiles carry a status badge (Payments) need slightly taller
    // grid cells so the inline badge under the name never overflows on narrow
    // phones. Plain groups keep the tighter ratio.
    final bool hasBadge = modules.any((m) => _badgeFor(m.moduleKey) != null);

    // Small groups (2–3 modules) look unbalanced as a full-width hero over a
    // partial row of small tiles ("one long + a couple small"). Render them as
    // a uniform card grid that fills the row instead: 2-up for two modules,
    // 3-up for three. A lone module (1) still gets the featured hero, and 4+
    // keep hero + a full 3-col row below (which is already balanced).
    if (modules.length == 2 || modules.length == 3) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _categoryCaption(group.categoryName, categoryColor, bottomGap: 12),
          GridView.builder(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: modules.length,
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: modules.length,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              // Fixed height so the 2-up and 3-up tiles stay a consistent
              // height (matches the ~0.85 aspect ratio of the 3-col grid, with
              // room for an inline status badge under the name).
              mainAxisExtent: 132,
            ),
            itemBuilder: (_, i) {
              final m = modules[i];
              final route = _routeFor(m.moduleKey);
              final cs = _comingSoon.isComingSoon(m.moduleKey);
              return comingSoonOverlay(
                isComingSoon: cs,
                date: _comingSoon.dateFor(m.moduleKey),
                child: _ModuleTile(
                  module: m,
                  accent: categoryColor,
                  badge: _badgeFor(m.moduleKey),
                  onTap: cs
                      ? () => showComingSoonMessage(
                          context, m.moduleName, _comingSoon.dateFor(m.moduleKey))
                      : (route != null ? () => context.push(route) : null),
                ),
              );
            },
          ),
          const SizedBox(height: 32),
        ],
      );
    }

    final featured = modules.first;
    final rest = modules.skip(1).toList();
    final featuredRoute = _routeFor(featured.moduleKey);
    final featuredCs = _comingSoon.isComingSoon(featured.moduleKey);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _categoryCaption(group.categoryName, categoryColor, bottomGap: 12),
        // First module: full-width tall tile
        SizedBox(
          height: 110,
          child: comingSoonOverlay(
            isComingSoon: featuredCs,
            date: _comingSoon.dateFor(featured.moduleKey),
            dense: false,
            child: _BentoFeaturedTile(
              module: featured,
              accent: categoryColor,
              badge: _badgeFor(featured.moduleKey),
              onTap: featuredCs
                  ? () => showComingSoonMessage(
                      context, featured.moduleName, _comingSoon.dateFor(featured.moduleKey))
                  : (featuredRoute != null ? () => context.push(featuredRoute) : null),
            ),
          ),
        ),
        if (rest.isNotEmpty) ...[
          const SizedBox(height: 12),
          GridView.builder(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: rest.length,
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: hasBadge ? 0.72 : 0.85,
            ),
            itemBuilder: (_, i) {
              final m = rest[i];
              final route = _routeFor(m.moduleKey);
              final cs = _comingSoon.isComingSoon(m.moduleKey);
              return comingSoonOverlay(
                isComingSoon: cs,
                date: _comingSoon.dateFor(m.moduleKey),
                child: _ModuleTile(
                  module: m,
                  accent: categoryColor,
                  badge: _badgeFor(m.moduleKey),
                  onTap: cs
                      ? () => showComingSoonMessage(
                          context, m.moduleName, _comingSoon.dateFor(m.moduleKey))
                      : (route != null ? () => context.push(route) : null),
                ),
              );
            },
          ),
        ],
        const SizedBox(height: 32),
      ],
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Shared helper — category caption (used by every variant)
  // ──────────────────────────────────────────────────────────────────────────

  Widget _categoryCaption(String categoryName, Color color, {required double bottomGap}) {
    return Padding(
      padding: EdgeInsets.only(left: 4, bottom: bottomGap, top: 8),
      child: Text(
        categoryName.toUpperCase(),
        style: AppFonts.body(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          color: color,
          letterSpacing: 1.5,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Category color mapping
// ---------------------------------------------------------------------------

const _kCategoryFallbackPalette = <Color>[
  AppColors.accentBlue, // blue
  AppColors.success, // green
  AppColors.accentBlue, // purple
  AppColors.accentBlue, // teal
  AppColors.warningDark, // amber
  AppColors.chart5, // cyan
];

/// Normalizes a moduleKey (lowercase, no spaces/underscores/dashes) for badge
/// lookups, matching [_routeFor]'s normalization.
String _normKey(String k) =>
    k.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '');

Color _categoryColor(String categoryName, int categoryId) {
  final key = categoryName.toLowerCase();
  if (key.contains('communication')) return AppColors.accentBlue;
  if (key.contains('event') || key.contains('activit')) return AppColors.success;
  if (key.contains('report') || key.contains('cmr')) return AppColors.accentBlue;
  if (key.contains('people') || key.contains('directory') || key.contains('member')) return AppColors.accentBlue;
  if (key.contains('foundation') || key.contains('trf')) return AppColors.warningDark;
  if (key.contains('master')) return AppColors.warningDark; // orange
  if (key.contains('setting')) return AppColors.textSecondary;
  if (key.contains('website') || key.contains('web')) return AppColors.chart5;
  // Deterministic fallback by categoryId so unknown groups get a stable color.
  return _kCategoryFallbackPalette[categoryId.abs() % _kCategoryFallbackPalette.length];
}

// ---------------------------------------------------------------------------
// Module tile
// ---------------------------------------------------------------------------

class _ModuleTile extends StatelessWidget {
  final DashboardModuleModel module;
  final Color accent;
  final VoidCallback? onTap;
  final ModuleBadge? badge;
  const _ModuleTile(
      {required this.module, required this.accent, this.onTap, this.badge});

  static IconData fallbackIcon(String moduleKey) => _fallbackIcon(moduleKey);

  static IconData _fallbackIcon(String moduleKey) {
    final key = moduleKey.toLowerCase().replaceAll(' ', '');
    if (key.contains('directory')) return Icons.people_rounded;
    if (key.contains('calendar')) return Icons.calendar_month_rounded;
    if (key.contains('event')) return Icons.event_rounded;
    if (key.contains('announcement')) return Icons.campaign_rounded;
    if (key.contains('newsletter')) return Icons.newspaper_rounded;
    if (key.contains('document')) return Icons.folder_rounded;
    if (key.contains('committee')) return Icons.groups_rounded;
    if (key.contains('club')) return Icons.business_rounded;
    if (key.contains('report') || key.contains('cmr')) return Icons.bar_chart_rounded;
    if (key.contains('weblink') || key.contains('link')) return Icons.link_rounded;
    if (key.contains('project')) return Icons.assignment_rounded;
    return Icons.grid_view_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final iconPath = module.iconPath;
    final hasImage = iconPath != null && iconPath.isNotEmpty;
    final imageUrl = hasImage ? '${ApiConstants.mediaBaseUrl}$iconPath' : null;

    final card = Container(
      decoration: BoxDecoration(
        color: accent.withOpacity(0.06),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: accent.withOpacity(0.15), width: 1),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 52,
                height: 52,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: accent.withOpacity(0.18),
                  shape: BoxShape.circle,
                ),
                child: hasImage
                    ? CachedNetworkImage(
                        imageUrl: imageUrl!,
                        fit: BoxFit.contain,
                        placeholder: (_, __) => Icon(_fallbackIcon(module.moduleKey), color: accent, size: 24),
                        errorWidget: (_, __, ___) => Icon(_fallbackIcon(module.moduleKey), color: accent, size: 24),
                      )
                    : Icon(_fallbackIcon(module.moduleKey), size: 26, color: accent),
              ),
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Text(
                  module.moduleName,
                  style: AppFonts.body(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    height: 1.2,
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // Status/value badge sits inline under the name so it reads as
              // part of the tile (a floating corner pill looked detached on the
              // faint tile and overflowed the top edge of tall grid cells).
              if (badge != null) ...[
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  child: ModuleBadgeChip(badge: badge!),
                ),
              ],
            ],
          ),
        ),
      ),
    );
    return card;
  }
}

// ---------------------------------------------------------------------------
// Featured tile — first module per group in the Featured layout
// ---------------------------------------------------------------------------

class _BentoFeaturedTile extends StatelessWidget {
  final DashboardModuleModel module;
  final Color accent;
  final VoidCallback? onTap;
  final ModuleBadge? badge;
  const _BentoFeaturedTile(
      {required this.module, required this.accent, this.onTap, this.badge});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: accent.withOpacity(0.10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: accent.withOpacity(0.18), width: 1),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: accent.withOpacity(0.22),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(_ModuleTile.fallbackIcon(module.moduleKey), color: accent, size: 32),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        module.moduleName,
                        style: AppFonts.body(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Featured',
                        style: AppFonts.body(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: accent,
                          letterSpacing: 0.4,
                        ),
                      ),
                    ],
                  ),
                ),
                if (badge != null) ...[
                  ModuleBadgeChip(badge: badge!),
                  const SizedBox(width: 10),
                ],
                Icon(Icons.arrow_forward_rounded, color: accent, size: 22),
              ],
            ),
          ),
        ),
      ),
    );
  }
}


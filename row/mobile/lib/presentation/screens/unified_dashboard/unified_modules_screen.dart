import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/dashboard_merger.dart';
import '../../../data/models/dashboard_module_model.dart';
import '../../../data/models/merged_dashboard_model.dart';
import '../../../data/models/module_coming_soon_model.dart';
import '../../widgets/common/module_status_badge.dart';
import '../../widgets/common/coming_soon_badge.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Selectable visual layouts — mirrors Club/District dashboard variants.
enum _DashboardVariant {
  list,     // Single-column grouped rows
  featured, // First module per group is a hero tile, rest in 3-col grid
}

const String _kVariantPrefKey = 'unified_dashboard_variant';

class UnifiedModulesScreen extends StatefulWidget {
  final int districtId;
  final int? clubId;

  const UnifiedModulesScreen({
    super.key,
    required this.districtId,
    this.clubId,
  });

  @override
  State<UnifiedModulesScreen> createState() => _UnifiedModulesScreenState();
}

class _UnifiedModulesScreenState extends State<UnifiedModulesScreen> {
  final _api = ApiClient();

  List<MergedModuleGroup> _groups = [];
  bool _loading = true;
  String? _error;
  // email credit balances for the Payments tiles. Fetched for the
  // club scope (if a club is attached and the user admins it) else the district
  // scope; null → no badge. Website/Dues badges are club-dashboard only.
  int? _emailRemaining;
  _DashboardVariant _variant = _DashboardVariant.list;
  ComingSoonRegistry _comingSoon = ComingSoonRegistry.empty();

  @override
  void initState() {
    super.initState();
    _load();
    _loadVariant();
    WidgetsBinding.instance.addPostFrameCallback((_) => _fetchCredits());
  }

  /// Wallet credit balances for the Payments email tiles (admin only).
  /// Prefers the attached club's balance; falls back to the district's.
  Future<void> _fetchCredits() async {
    if (!mounted) return;
    final auth = context.read<AuthProvider>();
    String? path;
    if (widget.clubId != null && auth.isClubAdminOf(widget.clubId!)) {
      path = '/api/credit-management/club/${widget.clubId}/balance';
    } else if (auth.isDistrictAdminOf(widget.districtId)) {
      path = '/api/credit-management/district/${widget.districtId}/balance';
    }
    if (path == null) return;
    try {
      final res = await _api.get<Map<String, dynamic>>(
        path,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = res.data;
      if (data != null && mounted) {
        setState(() {
          _emailRemaining = data['emailRemaining'] as int?;
        });
      }
    } catch (_) {/* badge stays hidden */}
  }

  /// email credit-balance badge for the Payments tiles (only shown
  /// once a balance has been fetched, i.e. for admins).
  ModuleBadge? _badgeFor(String moduleKey) {
    switch (_normKey(moduleKey)) {
      case 'email':
        return _emailRemaining == null
            ? null
            : ModuleBadge.credits(_emailRemaining!);
    }
    return null;
  }

  Future<void> _loadVariant() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_kVariantPrefKey);
    if (stored == null || !mounted) return;
    final match = _DashboardVariant.values.firstWhere(
      (v) => v.name == stored,
      orElse: () => _DashboardVariant.list,
    );
    setState(() => _variant = match);
  }

  Future<void> _setVariant(_DashboardVariant v) async {
    setState(() => _variant = v);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kVariantPrefKey, v.name);
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final comingSoonFuture = ComingSoonRegistry.fetch(_api);
      final futures = await Future.wait([
        _fetchDistrictGroups(),
        _fetchClubGroups(),
      ]);

      final districtGroups = futures[0];
      final clubGroups = futures[1];

      final merged = mergeDashboards(
        districtGroups: districtGroups,
        clubGroups: clubGroups,
      );

      final comingSoon = await comingSoonFuture;

      if (mounted) {
        setState(() {
          _groups = merged;
          _comingSoon = comingSoon;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<List<DashboardModuleGroup>> _fetchDistrictGroups() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/dashboard',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      return (resp.data?['moduleGroups'] as List<dynamic>? ?? [])
          .map((e) => DashboardModuleGroup.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<List<DashboardModuleGroup>> _fetchClubGroups() async {
    if (widget.clubId == null) return [];
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/dashboard',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      return (resp.data?['moduleGroups'] as List<dynamic>? ?? [])
          .map((e) => DashboardModuleGroup.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  void _onModuleTap(MergedModule module) {
    // Coming Soon (set by SuperAdmin on the web admin): block navigation and
    // tell the member when the module will be available. Mobile has no
    // SuperAdmin bypass, so this applies to every user.
    if (_comingSoon.isComingSoon(module.moduleKey)) {
      showComingSoonMessage(
          context, module.moduleName, _comingSoon.dateFor(module.moduleKey));
      return;
    }
    context.push(RouteNames.unifiedModuleDetail(
      moduleKey: module.moduleKey,
      moduleName: module.moduleName,
    ));
  }

  VoidCallback _onTapFor(MergedModule m) => () => _onModuleTap(m);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _load,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverAppBar(
              pinned: true,
              backgroundColor: AppColors.lightBg,
              foregroundColor: AppColors.textPrimary,
              elevation: 0,
              centerTitle: false,
              leading: IconButton(
                icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.textPrimary),
                onPressed: () => context.pop(),
              ),
              title: Text(
                'Modules',
                style: AppFonts.body(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: AppColors.textPrimary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              actions: [
                IconButton(
                  tooltip: 'Choose a layout',
                  icon: const Icon(Icons.dashboard_customize_rounded, color: AppColors.textPrimary),
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
                          child: ErrorStateWidget(message: _error!, onRetry: _load),
                        )
                      : _groups.isEmpty
                          ? const Padding(
                              padding: EdgeInsets.only(top: 60),
                              child: EmptyStateWidget(
                                icon: Icons.dashboard_outlined,
                                title: 'No Modules',
                                subtitle: 'No modules are available.',
                              ),
                            )
                          : _buildVariantBody(_groups),
            ),
          ],
        ),
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Variant dispatch
  // ──────────────────────────────────────────────────────────────────────────

  Widget _buildVariantBody(List<MergedModuleGroup> groups) {
    switch (_variant) {
      case _DashboardVariant.list:     return _buildBodyList(groups);
      case _DashboardVariant.featured: return _buildBodyFeatured(groups);
    }
  }

  void _showVariantPicker() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 16, 8, 8),
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
          style: AppFonts.body(fontSize: 13, color: AppColors.textMuted)),
      activeColor: AppColors.primaryPrime,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12),
      dense: true,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // List variant — single-column grouped rows
  // ──────────────────────────────────────────────────────────────────────────

  Widget _buildBodyList(List<MergedModuleGroup> groups) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.xxl),
      child: Column(
        children: groups.map(_buildListGroupSection).toList(),
      ),
    );
  }

  Widget _buildListGroupSection(MergedModuleGroup group) {
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

  Widget _buildListRow(MergedModule m, Color accent) {
    final cs = _comingSoon.isComingSoon(m.moduleKey);
    final badge = cs ? null : _badgeFor(m.moduleKey);
    final row = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _onTapFor(m),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(_ModuleTile.fallbackIcon(m.moduleKey), color: accent, size: 18),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      m.moduleName,
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (m.isShared)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          'District & Club',
                          style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: accent,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                  ],
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

  Widget _buildBodyFeatured(List<MergedModuleGroup> groups) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.xxl),
      child: Column(
        children: groups.map(_buildFeaturedGroupSection).toList(),
      ),
    );
  }

  Widget _buildFeaturedGroupSection(MergedModuleGroup group) {
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
              return comingSoonOverlay(
                isComingSoon: _comingSoon.isComingSoon(m.moduleKey),
                date: _comingSoon.dateFor(m.moduleKey),
                child: _ModuleTile(module: m, accent: categoryColor, onTap: _onTapFor(m), badge: _badgeFor(m.moduleKey)),
              );
            },
          ),
          const SizedBox(height: 32),
        ],
      );
    }

    final featured = modules.first;
    final rest = modules.skip(1).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _categoryCaption(group.categoryName, categoryColor, bottomGap: 12),
        SizedBox(
          height: 110,
          child: comingSoonOverlay(
            isComingSoon: _comingSoon.isComingSoon(featured.moduleKey),
            date: _comingSoon.dateFor(featured.moduleKey),
            dense: false,
            child: _BentoFeaturedTile(
              module: featured,
              accent: categoryColor,
              onTap: _onTapFor(featured),
              badge: _badgeFor(featured.moduleKey),
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
              return comingSoonOverlay(
                isComingSoon: _comingSoon.isComingSoon(m.moduleKey),
                date: _comingSoon.dateFor(m.moduleKey),
                child: _ModuleTile(module: m, accent: categoryColor, onTap: _onTapFor(m), badge: _badgeFor(m.moduleKey)),
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
        categoryName,
        style: AppFonts.display(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
      ),
    );
  }
}

/// Normalizes a moduleKey (lowercase, no spaces/underscores/dashes) for badge
/// lookups, matching the Club/District dashboards.
String _normKey(String k) =>
    k.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '');

// ---------------------------------------------------------------------------
// Category color mapping (mirrors Club/District dashboards)
// ---------------------------------------------------------------------------


// One brand colour for every module group (design.md 1: no rainbow colouring).
Color _categoryColor(String categoryName, int categoryId) => AppColors.primaryPrime;

// ---------------------------------------------------------------------------
// Module tile — 3-col tinted (used in Featured grid)
// ---------------------------------------------------------------------------

class _ModuleTile extends StatelessWidget {
  final MergedModule module;
  final Color accent;
  final VoidCallback? onTap;
  final ModuleBadge? badge;
  const _ModuleTile(
      {required this.module, required this.accent, this.onTap, this.badge});

  static IconData fallbackIcon(String moduleKey) => _fallbackIcon(moduleKey);

  static IconData _fallbackIcon(String moduleKey) {
    final key = moduleKey.toLowerCase().replaceAll(' ', '');
    if (key.contains('directory')) return Icons.people_outline;
    if (key.contains('bod') || key.contains('board')) return Icons.groups_2_outlined;
    if (key.contains('president')) return Icons.military_tech_outlined;
    if (key.contains('calendar')) return Icons.calendar_month_outlined;
    if (key.contains('event')) return Icons.event_outlined;
    if (key.contains('announcement')) return Icons.campaign_outlined;
    if (key.contains('market')) return Icons.storefront_outlined;
    if (key.contains('clubservice')) return Icons.handshake_outlined;
    if (key.contains('community')) return Icons.volunteer_activism_outlined;
    if (key.contains('vocational')) return Icons.work_outline;
    if (key.contains('generation')) return Icons.school_outlined;
    if (key.contains('international')) return Icons.public_outlined;
    if (key.contains('image')) return Icons.image_outlined;
    if (key.contains('newsletter')) return Icons.newspaper_outlined;
    if (key.contains('document')) return Icons.folder_outlined;
    if (key.contains('admin') || key.contains('website')) return Icons.admin_panel_settings_outlined;
    if (key.contains('attendance')) return Icons.fact_check_outlined;
    if (key.contains('weblink') || key.contains('link')) return Icons.link_outlined;
    if (key.contains('report') || key.contains('cmr')) return Icons.bar_chart_rounded;
    return Icons.grid_view_outlined;
  }

  @override
  Widget build(BuildContext context) {
    final iconPath = module.iconPath;
    final hasImage = iconPath != null && iconPath.isNotEmpty;
    final imageUrl = hasImage ? '${ApiConstants.mediaBaseUrl}$iconPath' : null;

    final shared = module.isShared;
    final card = Container(
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: accent.withValues(alpha: shared ? 0.65 : 0.15),
          width: shared ? 1.8 : 1,
        ),
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
                  color: accent.withValues(alpha: 0.18),
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
                    fontSize: 13,
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
  final MergedModule module;
  final Color accent;
  final VoidCallback? onTap;
  final ModuleBadge? badge;
  const _BentoFeaturedTile(
      {required this.module, required this.accent, this.onTap, this.badge});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: accent.withValues(alpha: 0.18), width: 1),
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
                    color: accent.withValues(alpha: 0.22),
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
                        module.isShared ? 'District & Club' : 'Featured',
                        style: AppFonts.body(
                          fontSize: 13,
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

import 'package:cached_network_image/cached_network_image.dart';
import 'package:rotary_flutter_app/presentation/widgets/view_only_notice.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/bento.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/module_icons.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/features/feature_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/constants/feature_flags.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../data/models/wallet_models.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../widgets/weblinks/weblinks_section.dart';
import '../../../data/models/dashboard_module_model.dart';
import '../../../data/models/module_coming_soon_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/module_status_badge.dart';
import '../../widgets/common/coming_soon_badge.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'overview/widgets/district_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Selectable visual layouts for the District dashboard.
enum _DashboardVariant {
  list,     // Single-column grouped rows (most scannable)
  featured, // Bento grid per module group (the stored name predates it)
}

const String _kVariantPrefKey = 'district_dashboard_variant';

class DistrictDashboardScreen extends StatefulWidget {
  final int districtId;
  const DistrictDashboardScreen({super.key, required this.districtId});

  @override
  State<DistrictDashboardScreen> createState() => _DistrictDashboardScreenState();
}

class _DistrictDashboardScreenState extends State<DistrictDashboardScreen> {
  final ApiClient _api = ApiClient();
  String _districtTitle = '';
  List<DashboardModuleGroup> _groups = [];
  bool _loading = true;
  String? _error;
  int? _emailRemaining;
  _DashboardVariant _variant = _DashboardVariant.featured;
  ComingSoonRegistry _comingSoon = ComingSoonRegistry.empty();

  @override
  void initState() {
    super.initState();
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

  Future<void> _loadVariant() async {
    final prefs = await SharedPreferences.getInstance();
    final storedVariant = prefs.getString(_kVariantPrefKey);
    if (!mounted) return;
    setState(() {
      if (storedVariant != null) {
        _variant = _DashboardVariant.values.firstWhere(
          (v) => v.name == storedVariant,
          orElse: () => _DashboardVariant.featured,
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
      if (mounted) setState(() { _error = friendlyErrorMessage(e); _loading = false; });
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
          RowRefresh(
            color: AppColors.primary,
            onRefresh: _fetchDashboard,
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
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.textPrimary),
              onPressed: () => context.pop(),
            ),
            title: Text(
              _districtTitle.isEmpty ? 'District Dashboard' : _districtTitle,
              style: AppFonts.body(
                fontWeight: FontWeight.w800,
                fontSize: 16,
                color: AppColors.textPrimary,
              ),
            ),
            actions: [
              // Admin access sits in the bar (design.md 8.6), not floating over the module list.
              if (showBadge)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Center(
                    child: _buildAdminPill(onTap: () => context.push(RouteNames.districtOverview(widget.districtId))),
                  ),
                ),
              IconButton(
                tooltip: 'Choose a layout',
                icon: const Icon(Icons.dashboard_customize_rounded, color: AppColors.textPrimary),
                onPressed: _showVariantPicker,
              ),
            ],
          ),
           if (isAdminHere && !context.watch<AuthProvider>().canEditDistrict(widget.districtId))
             const SliverToBoxAdapter(child: ViewOnlyNotice()),
          SliverToBoxAdapter(
            child: _loading
                ? const RowSkeletonList(rows: 9)
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
        ],
      ),
    );
  }

  Widget _buildAdminPill({required VoidCallback onTap, bool elevated = false}) {
    return RowPressable(
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
                    fontSize: 13,
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
                _variantOption(sheetContext, _DashboardVariant.featured, 'Grid', 'Tiles in mixed sizes'),
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
          style: AppFonts.body(fontSize: 13, color: AppColors.textMuted)),
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
          ...revealAll(groups.map(_buildListGroupSection).toList()),
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
    final row = RowPressable(morph: true, scale: .985, child: Material(
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
                        placeholder: (_, __) => Icon(moduleIcon(m.moduleKey), color: accent, size: 18),
                        errorWidget: (_, __, ___) => Icon(moduleIcon(m.moduleKey), color: accent, size: 18),
                      )
                    : Icon(moduleIcon(m.moduleKey), color: accent, size: 18),
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
    ));
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
          ...revealAll(groups.map(_buildFeaturedGroupSection).toList()),
          WebLinksSection(
              baseEndpoint: '/api/mobile/districts/${widget.districtId}/weblinks'),
        ],
      ),
    );
  }

  Widget _buildFeaturedGroupSection(DashboardModuleGroup group) {
    final modules = group.modules;
    if (modules.isEmpty) return const SizedBox.shrink();
    final spans = RowBento.spans(modules.length);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _categoryCaption(group.categoryName, _categoryColor(group.categoryName, group.categoryId), bottomGap: 12),
        RowBento(items: [
          for (final (i, m) in modules.indexed) BentoItem(spans[i].$1, spans[i].$2, _buildBentoTile(m, i, spans[i])),
        ]),
        const SizedBox(height: 28),
      ],
    );
  }

  Widget _buildBentoTile(DashboardModuleModel m, int index, (int, int) span) {
    final cs = _comingSoon.isComingSoon(m.moduleKey);
    final route = _routeFor(m.moduleKey);
    final onTap = cs
        ? () => showComingSoonMessage(context, m.moduleName, _comingSoon.dateFor(m.moduleKey))
        : (route != null ? () => context.push(route) : null);
    final hasImage = m.iconPath != null && m.iconPath!.isNotEmpty;
    final badge = cs ? null : _badgeFor(m.moduleKey);
    return comingSoonOverlay(
      isComingSoon: cs,
      date: _comingSoon.dateFor(m.moduleKey),
      child: RowBentoTile(
        label: m.moduleName,
        icon: hasImage
            // Uploaded icons bring their own colours: give them a light ground on every tone.
            ? Container(
                width: 40,
                height: 40,
                padding: const EdgeInsets.all(8),
                decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
                child: CachedNetworkImage(
                  imageUrl: '${ApiConstants.mediaBaseUrl}${m.iconPath}',
                  fit: BoxFit.contain,
                  placeholder: (_, __) => Icon(moduleIcon(m.moduleKey), color: AppColors.primaryPrime, size: 22),
                  errorWidget: (_, __, ___) => Icon(moduleIcon(m.moduleKey), color: AppColors.primaryPrime, size: 22),
                ),
              )
            : Icon(moduleIcon(m.moduleKey)),
        tone: RowBentoTile.toneFor(index, span),
        badge: badge == null ? null : ModuleBadgeChip(badge: badge),
        onTap: onTap,
      ),
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

// ---------------------------------------------------------------------------
// Category color mapping
// ---------------------------------------------------------------------------


/// Normalizes a moduleKey (lowercase, no spaces/underscores/dashes) for badge
/// lookups, matching [_routeFor]'s normalization.
String _normKey(String k) =>
    k.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '');

// One brand colour for every module group (design.md 1: no rainbow colouring).
Color _categoryColor(String categoryName, int categoryId) => AppColors.primaryPrime;

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
import '../../../core/services/club_admin_dashboard_api.dart';
import '../../../data/models/club_admin_dashboard_models.dart';
import '../../../data/models/wallet_models.dart';
import '../../widgets/common/module_status_badge.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../widgets/weblinks/weblinks_section.dart';
import '../../../data/models/dashboard_module_model.dart';
import '../../../data/models/module_coming_soon_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/coming_soon_badge.dart';
import '../../widgets/common/dues_subscription_dialog.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'overview/widgets/club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Selectable visual layouts for the Club dashboard.
enum _DashboardVariant {
  list,     // Single-column grouped rows (most scannable)
  featured, // Bento grid per module group (the stored name predates it)
}

const String _kVariantPrefKey = 'club_dashboard_variant';

class ClubDashboardScreen extends StatefulWidget {
  final int clubId;
  const ClubDashboardScreen({super.key, required this.clubId});

  @override
  State<ClubDashboardScreen> createState() => _ClubDashboardScreenState();
}

class _ClubDashboardScreenState extends State<ClubDashboardScreen> {
  final ApiClient _api = ApiClient();
  String _clubName = '';
  List<DashboardModuleGroup> _groups = [];
  bool _loading = true;
  String? _error;
  int? _emailRemaining;
  // Payments-tile status badges (admin only): Website Active/Expired/Not-set-up
  // and Membership Dues Active/Not-set-up. email use the credit counts
  // above. Null until fetched (or non-admin → never shown).
  ModuleBadge? _websiteBadge;
  ModuleBadge? _duesBadge;
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
      if (!mounted) return;
      // After the role is fresh, fetch the Payments status badges (admin only).
      _loadPaymentExtras();
    });
  }

  /// Fetches the Website subscription status + whether this club has any
  /// Membership Dues set up, for the Payments-tile badges. Admin-only and
  /// best-effort (badges stay hidden on any error). email balances are
  /// already fetched by [_fetchCredits].
  Future<void> _loadPaymentExtras() async {
    final auth = context.read<AuthProvider>();
    if (!auth.isClubAdminOf(widget.clubId)) return;
    try {
      final web = await ClubAdminDashboardApi().getWebsite(widget.clubId);
      if (mounted) setState(() => _websiteBadge = _websiteBadgeFor(web));
    } catch (_) {/* badge stays hidden */}
    try {
      final resp = await _api.get(
        '/api/membership-dues',
        queryParams: {'clubId': widget.clubId},
        fromJson: (j) => j,
      );
      final raw = resp.data;
      final list = raw is List
          ? raw
          : (raw is Map<String, dynamic>
              ? (raw['items'] as List<dynamic>? ?? const [])
              : const []);
      if (mounted) {
        setState(() => _duesBadge = list.isNotEmpty
            ? const ModuleBadge('Active', ModuleBadge.green)
            // No dues set up yet — blue "Subscribe" CTA, matching the Website
            // tile, instead of a neutral grey "Inactive".
            : const ModuleBadge('Subscribe', ModuleBadge.blue));
      }
    } catch (_) {/* badge stays hidden */}
  }

  /// Website pill, driven by the model's own [ClubAdminWebsite.statusLabel] so
  /// this badge can never disagree with the Website tab. The old hand-rolled
  /// `isExpired / isLive / else` chain covered only 3 of the backend's 5 states
  /// (`ClubAdminDashboardService` also emits `trial`, `inactive`, and raw
  /// passthrough), so a configured-but-unpaid site — live, just not purchased —
  /// fell into the `else` and wrongly read "Not set up".
  static ModuleBadge _websiteBadgeFor(ClubAdminWebsite web) {
    final label = web.statusLabel;
    switch (label) {
      case 'Live':
      case 'Active':
        return const ModuleBadge('Live', ModuleBadge.green);
      case 'Trial':
        // Amber: working, but unpaid — a real state of its own, not "Live".
        return const ModuleBadge('Trial', ModuleBadge.orange);
      case 'Expired':
      case 'Disabled':
        return ModuleBadge(label, ModuleBadge.red);
      default: // 'Not Set Up' — no site yet. Blue "Subscribe" CTA to sell it,
        // not a neutral grey status.
        return const ModuleBadge('Subscribe', ModuleBadge.blue);
    }
  }

  /// The status/value badge for a Payments module tile, or null (non-admin,
  /// not-yet-loaded, or a module with no badge). email show the credit
  /// balance; Website/Membership Dues show a status pill.
  ModuleBadge? _badgeFor(String moduleKey) {
    if (!context.read<AuthProvider>().isClubAdminOf(widget.clubId)) return null;
    switch (_normKey(moduleKey)) {
      case 'email':
        return _emailRemaining == null
            ? null
            : ModuleBadge.credits(_emailRemaining!);
      case 'website':
        return _websiteBadge;
      case 'membershipdues':
        return _duesBadge;
    }
    return null;
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
        '/api/credit-management/club/${widget.clubId}/balance',
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
    // Module visibility per role is owned by the BACKEND: `/api/clubs/{id}/dashboard`
    // returns only the modules this caller may see (a plain member gets the
    // IsDefaultForMember=1 set; an admin of this club gets the full list). So we
    // no longer client-filter admin-only tiles here — that stale rule keyed off
    // the GLOBAL `isAdmin` and could even hide a tile the backend now intends
    // members to see. We only drop the legacy Club-Report key (no mobile screen).
    try {
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.clubDashboardModules(widget.clubId),
      );
      final data = res.data;
      if (data != null) {
        _clubName = data['clubName'] as String? ?? 'Club Dashboard';
        // COG has no Membership Dues — drop that tile from its Payments group.
        final isCog = _clubName.trim().toLowerCase() == 'cog';
        _groups = (data['moduleGroups'] as List<dynamic>? ?? [])
            .map((e) => DashboardModuleGroup.fromJson(e as Map<String, dynamic>))
            .map((g) => DashboardModuleGroup(
                  categoryId: g.categoryId,
                  categoryName: g.categoryName,
                  sortOrder: g.sortOrder,
                  modules: g.modules.where((m) {
                    final k = m.moduleKey
                        .toLowerCase()
                        .replaceAll(' ', '')
                        .replaceAll('_', '')
                        .replaceAll('-', '');
                    if (k == 'clubreport' || k == 'clubreports') return false;
                    if (isCog && k == 'membershipdues') return false;
                    // Goal Setting hidden for release (see kGoalSettingEnabled).
                    if (!kGoalSettingEnabled && k == 'goalsetting') return false;
                    // ROW module switches (FeatureController): skipped or switched-off modules lose their tile
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
    final id = widget.clubId;
    switch (key) {
      case 'directory':           return RouteNames.clubMembers(id);
      // Club goal ENTRY — set the club's targets by category (Membership / TRF /
      // Youth Service / Public Image), mirroring the web Club Admin page.
      // Disabled while Goal Setting is hidden for release.
      case 'goalsetting':
        return kGoalSettingEnabled ? RouteNames.clubGoalSetting(id) : null;
      case 'bod':
      case 'boardofdirectors':   return RouteNames.boardOfDirectors(id);
      case 'pastpresidents':      return RouteNames.pastPresidents(id);
      case 'clubcalendar':        return RouteNames.clubCalendarFor(id);
      case 'calendar':
      case 'upcomingevents':      return RouteNames.clubUpcomingEvents(id);
      case 'announcements':       return RouteNames.clubAnnouncements(id);
      case 'clubservice':         return RouteNames.clubService(id);
      case 'communityservice':    return '/clubs/$id/projects?module=community_service';
      case 'vocationalservice':   return RouteNames.vocationalService(id);
      case 'newgenerationservice':return RouteNames.newGenerationService(id);
      case 'internationalservice':return RouteNames.internationalService(id);
      case 'publicimageinitiative':return RouteNames.publicImageInitiative(id);
      case 'newsletters':         return RouteNames.clubNewsletters(id);
      case 'documents':           return RouteNames.clubDocuments(id);
      case 'admin':
      case 'websitedata':         return RouteNames.clubWebsiteData(id);
      case 'rotarynetwork':       return RouteNames.rotaryNetwork(id);
      case 'attendance':          return RouteNames.clubAttendance(id);
      case 'weblinks':            return RouteNames.clubWeblinks(id);
      case 'subgroups':           return RouteNames.clubSubGroups(id);
      case 'massemail':
      case 'massemails':          return RouteNames.massEmails(id);
      case 'membershipdues':
        // Role-split: club admins of THIS club manage everyone's dues; plain
        // members open their own ("My Dues") — same tile, different screen.
        return Provider.of<AuthProvider>(context, listen: false)
                .isClubAdminOf(widget.clubId)
            ? RouteNames.membershipDues(id)
            // Scope My Dues to THIS club so another club's dashboard can't leak
            // this club's dues (the member endpoint is keyed by member).
            : RouteNames.myDuesFor(id, clubName: _clubName);
      case 'trf':
      case 'trfcontribution':     return RouteNames.trf(id);
      case 'ocvgov':              return RouteNames.ocvGov(id);
      case 'clubmonthlyreport':   return RouteNames.clubMonthlyReport(id);
      case 'onlineeventlink':
      case 'eventpaymentlinks':   return RouteNames.eventPaymentLinks(id);
      case 'greetings':           return RouteNames.clubGreetings(id);
      case 'citation':
      case 'districtcitation':    return RouteNames.clubCitation(id);
      case 'reports':
      case 'clubreport':
      case 'clubreports':         return RouteNames.clubReports(id);
      case 'wallet':
        // Admins-only: top-up lives here and the screen already gates the buy
        // button. Non-admins get a non-tappable tile (route null) rather than a
        // read-only wallet, matching the requested admin-only scope.
        return Provider.of<AuthProvider>(context, listen: false)
                .isClubAdminOf(id)
            ? RouteNames.walletClubFor(id, clubName: _clubName)
            : null;
      case 'email':
        return Provider.of<AuthProvider>(context, listen: false)
                .isClubAdminOf(id)
            ? RouteNames.walletClubFor(id,
                clubName: _clubName, creditType: WalletCreditType.email)
            : null;
      // Website: open the self-service Buy / Renew (Razorpay) purchase page.
      // Admin-only, same as Wallet — buying/renewing a website is an admin
      // action (non-admins get a non-tappable tile).
      case 'website':
        return Provider.of<AuthProvider>(context, listen: false)
                .isClubAdminOf(id)
            ? RouteNames.clubWebsiteManageFor(id, clubName: _clubName)
            : null;
      default:                    return null;
    }
  }

  // Resolves a tap handler for a module: native route first, else external URL
  // (a module's routeUrl). Returns null if neither is available.
  VoidCallback? _onTapFor(DashboardModuleModel m) {
    // Coming Soon (set by SuperAdmin on the web admin): keep the tile tappable
    // but, instead of navigating, tell the member when it becomes available.
    if (_comingSoon.isComingSoon(m.moduleKey)) {
      return () => showComingSoonMessage(
          context, m.moduleName, _comingSoon.dateFor(m.moduleKey));
    }
    // Membership Dues, plain member: check whether THIS club has dues set up
    // BEFORE navigating. None → show the "contact for subscription" popup right
    // here on tap (don't open an empty screen). Admins always get the editor.
    final key = m.moduleKey
        .toLowerCase()
        .replaceAll(' ', '')
        .replaceAll('_', '')
        .replaceAll('-', '');
    if (key == 'membershipdues' &&
        !context.read<AuthProvider>().isClubAdminOf(widget.clubId)) {
      return _openMemberDues;
    }
    final route = _routeFor(m.moduleKey);
    if (route != null) return () => context.push(route);
    if (m.routeUrl != null && m.routeUrl!.isNotEmpty) {
      return () {
        final auth = context.read<AuthProvider>();
        final url = m.routeUrl!.replaceAll('{memberId}', auth.memberId.toString());
        context.push(RouteNames.webView(m.moduleName, url));
      };
    }
    return null;
  }

  /// Plain-member tap on the Membership Dues tile: `/api/mobile/my-membership-dues`
  /// is the single source of truth (no backend subscription flag exists). If this
  /// club appears in the member's dues, open their scoped dues screen; otherwise
  /// the club has no dues set up → show the contact-for-subscription popup on tap.
  Future<void> _openMemberDues() async {
    showRowDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const RowBusy(),
    );
    var hasDues = false;
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/mobile/my-membership-dues',
        fromJson: (j) => j as List<dynamic>,
      );
      for (final e in (resp.data ?? const [])) {
        if (e is Map<String, dynamic>) {
          final cid = e['clubId'];
          final id = cid is int ? cid : int.tryParse('$cid') ?? 0;
          if (id == widget.clubId) {
            hasDues = true;
            break;
          }
        }
      }
    } catch (_) {}
    if (!mounted) return;
    Navigator.of(context, rootNavigator: true).pop(); // dismiss loader
    if (hasDues) {
      context.push(RouteNames.myDuesFor(widget.clubId, clubName: _clubName));
    } else {
      showDuesSubscriptionDialog(context, clubName: _clubName);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Plain members can view the dashboard; per-module screens self-gate
    // their Add/Edit/Delete affordances via auth.isClubAdminOf(widget.clubId).
    final isAdminHere = context.watch<AuthProvider>().isClubAdminOf(widget.clubId);
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
                _clubName.isEmpty ? 'Club Dashboard' : _clubName,
                style: AppFonts.body(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: AppColors.textPrimary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              actions: [
                // Admin access sits in the bar (design.md 8.6), not floating over the module list.
                if (showBadge)
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: Center(
                      child: _buildAdminPill(onTap: () => context.push(RouteNames.clubOverview(widget.clubId))),
                    ),
                  ),
                IconButton(
                  tooltip: 'Choose a layout',
                  icon: const Icon(Icons.dashboard_customize_rounded, color: AppColors.textPrimary),
                  onPressed: _showVariantPicker,
                ),
              ],
            ),
            if (isAdminHere && !context.watch<AuthProvider>().canEditClub(widget.clubId))
              const SliverToBoxAdapter(child: ViewOnlyNotice()),
            SliverToBoxAdapter(
              child: _loading
                  ? const RowSkeletonList(rows: 9)
                  : _error != null
                      ? Padding(
                          padding: const EdgeInsets.only(top: 60),
                          child: ClubDashboardError(error: _error!, onRetry: _fetchDashboard),
                        )
                      : _groups.isEmpty
                          ? const Padding(
                              padding: EdgeInsets.only(top: 60),
                              child: EmptyStateWidget(
                                icon: Icons.dashboard_outlined,
                                title: 'No Modules',
                                subtitle: 'No modules configured for this club.',
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
              baseEndpoint: '/api/mobile/clubs/${widget.clubId}/weblinks'),
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

  Widget _buildListRow(DashboardModuleModel m, Color accent) {
    final iconPath = m.iconPath;
    final hasImage = iconPath != null && iconPath.isNotEmpty;
    final imageUrl = hasImage ? '${ApiConstants.mediaBaseUrl}$iconPath' : null;
    final cs = _comingSoon.isComingSoon(m.moduleKey);
    final badge = cs ? null : _badgeFor(m.moduleKey);
    final row = RowPressable(morph: true, scale: .985, child: Material(
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
                padding: hasImage ? const EdgeInsets.all(6) : EdgeInsets.zero,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.15),
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
  // Featured variant — uniform 3-col card grid per category group
  // ──────────────────────────────────────────────────────────────────────────

  Widget _buildBodyFeatured(List<DashboardModuleGroup> groups) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.xxl),
      child: Column(
        children: [
          ...revealAll(groups.map(_buildFeaturedGroupSection).toList()),
          WebLinksSection(
              baseEndpoint: '/api/mobile/clubs/${widget.clubId}/weblinks'),
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
        onTap: _onTapFor(m),
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


/// Normalizes a moduleKey the same way [_routeFor] does (lowercase, no spaces/
/// underscores/dashes) so badge lookups match regardless of backend casing.
String _normKey(String k) =>
    k.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '');

// One brand colour for every module group (design.md 1: no rainbow colouring).
Color _categoryColor(String categoryName, int categoryId) => AppColors.primaryPrime;

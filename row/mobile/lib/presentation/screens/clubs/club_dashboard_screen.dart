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
import '../../../core/services/club_admin_dashboard_api.dart';
import '../../../data/models/club_admin_dashboard_models.dart';
import '../../../data/models/wallet_models.dart';
import '../../widgets/common/module_status_badge.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../widgets/weblinks/weblinks_section.dart';
import '../../../data/models/dashboard_module_model.dart';
import '../../../data/models/module_coming_soon_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/coming_soon_badge.dart';
import '../../widgets/common/dues_subscription_dialog.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'overview/widgets/club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Selectable visual layouts for the Club dashboard.
enum _DashboardVariant {
  list,     // Single-column grouped rows (most scannable)
  featured, // Uniform 3-col card grid, grouped by category
}

const String _kVariantPrefKey = 'club_dashboard_variant';

class ClubDashboardScreen extends StatefulWidget {
  final int clubId;
  const ClubDashboardScreen({super.key, required this.clubId});

  @override
  State<ClubDashboardScreen> createState() => _ClubDashboardScreenState();
}

class _ClubDashboardScreenState extends State<ClubDashboardScreen>
    with SingleTickerProviderStateMixin {
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
                    if (k == 'marketplace') return features.isOn('marketplace');
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
      // Market Place opens external URL — handled separately via routeUrl
      case 'marketplace':         return null;
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
      case 'pphcamp':
      case 'pphcamps':            return RouteNames.pphCamps(id);
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
  // (Market Place uses routeUrl). Returns null if neither is available.
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
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) =>
          const Center(child: const CircularProgressIndicator(color: AppColors.primary)),
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
                _clubName.isEmpty ? 'Club Dashboard' : _clubName.toUpperCase(),
                style: AppFonts.body(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: Colors.white,
                  letterSpacing: 1,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
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
          if (showBadge)
            Positioned(
              right: 16,
              bottom: 20,
              child: _buildAdminPill(
                onTap: () => context.push(RouteNames.clubOverview(widget.clubId)),
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
                _variantOption(sheetContext, _DashboardVariant.featured, 'Featured',      'Equal-size cards, 3 per row'),
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
                padding: hasImage ? const EdgeInsets.all(6) : EdgeInsets.zero,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.15),
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
  // Featured variant — uniform 3-col card grid per category group
  // ──────────────────────────────────────────────────────────────────────────

  Widget _buildBodyFeatured(List<DashboardModuleGroup> groups) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.xxl),
      child: Column(
        children: [
          ...groups.map(_buildFeaturedGroupSection),
          WebLinksSection(
              baseEndpoint: '/api/mobile/clubs/${widget.clubId}/weblinks'),
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

    // ONE uniform card width for every tile in every group: a fixed 3-column
    // grid regardless of group size. The previous bento put three different
    // widths on a single screen (full-width hero, 2-up for pairs, 3-up for
    // triples) — a fixed column count is the only way the widths stay identical
    // across groups, since any size-dependent count re-introduces the variance.
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
            crossAxisCount: 3,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: hasBadge ? 0.72 : 0.85,
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

/// Normalizes a moduleKey the same way [_routeFor] does (lowercase, no spaces/
/// underscores/dashes) so badge lookups match regardless of backend casing.
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
  return _kCategoryFallbackPalette[categoryId.abs() % _kCategoryFallbackPalette.length];
}

// ---------------------------------------------------------------------------
// Module tile (variant A & D — 3-col tinted)
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

    final card = Container(
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: accent.withValues(alpha: 0.15), width: 1),
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



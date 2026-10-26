import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/constants/feature_flags.dart';
import '../../../core/network/api_client.dart';
import '../../../core/notifications/deep_link_service.dart';
import '../../../core/notifications/notification_badge_service.dart';
import '../../../core/preferences/home_layout_controller.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../../data/models/club_model.dart';
import '../../../data/models/district_model.dart';
import '../../../data/models/zone_model.dart';
import '../../providers/auth_provider.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_drawer.dart';
import '../../widgets/common/dues_subscription_dialog.dart';
import '../clubs/overview/widgets/club_website_tab.dart';
import '../../widgets/login_announcement_popup.dart';
import '../calendar/my_calendars_screen.dart';
import '../club_dues_pay/club_dues_my_clubs_screen.dart';
import '../../../core/services/club_dues_pay_api.dart';
import '../my_clubs/my_clubs_list_screen.dart';
import '../share_contact/share_contact_sheet.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/brand/brand.dart';
import '../../widgets/consent_gate.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class _ConnectionItem {
  final int id;
  final String title;
  final String type; // 'zone' | 'unified'
  final int? districtId;
  final int? clubId;

  const _ConnectionItem(this.id, this.title, this.type,
      {this.districtId, this.clubId});

  void navigate(BuildContext context) {
    switch (type) {
      case 'zone':
        context.push(RouteNames.zoneDistricts(id, title));
        break;
      case 'unified':
        context.push(
            RouteNames.unifiedModules(districtId: districtId!, clubId: clubId));
        break;
    }
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ApiClient _api = ApiClient();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  // Lets pull-to-refresh re-run the role-based connections fetch (that widget
  // owns its own my-context fetch, otherwise only refreshed once on mount).
  final GlobalKey<_RoleBasedConnectionsState> _connectionsKey =
      GlobalKey<_RoleBasedConnectionsState>();
  final ScrollController _scrollController = ScrollController();
  List<_ConnectionItem> _connections = [];
  List<({int id, String name})> _myClubs = [];
  bool _loadingConnections = true;
  String? _connectionsError;
  bool _showLogoInAppBar = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    // Drain any push-notification deep-link that was queued before the app was
    // ready (cold-start tap, or a tap while logged out that routed via login).
    // Independent of the profile/role bootstrap below so it always runs.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      DeepLinkService.instance.consumePending();
    });
    // Refresh the bell's unread badge on every home mount.
    NotificationBadgeService.instance.refresh();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      _loadConnections();
      final auth = Provider.of<AuthProvider>(context, listen: false);
      auth.refreshProfilePhoto();
      // Privacy consent first (blocks until accepted), then the announcement.
      if (mounted) await checkAndShowConsent(context);
      if (mounted) checkAndShowLoginAnnouncement(context);
      // Pull fresh roles. The re-login prompt is app-wide now
      // (RoleChangeWatcher in app.dart), so this only refreshes the context —
      // the watcher reacts to the resulting notifyListeners.
      await auth.refreshContext();
      if (!mounted) return;
      // Nudge club admins about offline dues payments awaiting approval — on
      // mobile this lives on the home page (vs the per-club dashboard on web),
      // aggregated across every club the user administers.
      await _checkPendingOfflineApprovals();
    });
  }

  bool _approvalsNudgeShown = false;

  /// Mirrors the web `pending-offline-approvals` dashboard popup, surfaced on
  /// the home page. Fans out `GET /api/clubs/{id}/membership-dues/pending-offline-approvals`
  /// across every club the user is an admin of; if any has an offline payment
  /// still in `OfflineStatus='Pending'`, shows one combined nudge. Fires once
  /// per home mount; fails silently (it's only a nudge).
  Future<void> _checkPendingOfflineApprovals() async {
    // Hidden for launch while the offline-payment flow is finalised.
    if (!kOfflinePaymentsEnabled) return;
    if (_approvalsNudgeShown || !mounted) return;
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final adminClubIds = auth.clubAdminClubIds;
    if (adminClubIds.isEmpty) return;
    _approvalsNudgeShown = true;
    try {
      final perClub = await Future.wait(adminClubIds.map((cid) async {
        try {
          final resp = await _api.get(
            ApiConstants.clubPendingOfflineApprovals(cid),
            fromJson: (j) => j,
          );
          final rows = resp.data is List ? resp.data as List : const [];
          return rows
              .whereType<Map>()
              .map((r) => (
                    clubId: cid,
                    purpose: (r['purpose']?.toString() ?? '').trim(),
                    count: (r['pendingCount'] as num?)?.toInt() ?? 0,
                  ))
              .toList();
        } catch (_) {
          return <({int clubId, String purpose, int count})>[];
        }
      }));
      final records =
          perClub.expand((e) => e).where((r) => r.count > 0).toList();
      if (!mounted || records.isEmpty) return;

      final totalPending = records.fold<int>(0, (s, r) => s + r.count);
      final first = records.first;
      final payments =
          totalPending == 1 ? 'offline payment' : 'offline payments';
      final recordsWord =
          records.length == 1 ? 'dues record' : 'dues records';
      final openPart = first.purpose.isNotEmpty
          ? ' Open "${first.purpose}" now?'
          : ' Open the first one now?';
      final message =
          '$totalPending $payments waiting for your approval across '
          '${records.length} $recordsWord.$openPart';

      await showDialog<void>(
        context: context,
        barrierDismissible: false, // only Cancel / OK can dismiss, not a scrim tap
        builder: (ctx) => PopScope(
          canPop: false, // also block the Android back button/gesture
          child: AlertDialog(
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: const BoxDecoration(
                  color: AppColors.warningLight, // amber-100
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.fact_check_outlined,
                    color: AppColors.warningDark, size: 20), // amber-600
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text('Offline payment approvals pending',
                    style:
                        TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: AppColors.warningDark),
              onPressed: () {
                Navigator.of(ctx).pop();
                context.push(RouteNames.membershipDues(first.clubId));
              },
              child: const Text('OK, review now'),
            ),
          ],
          ),
        ),
      );
    } catch (_) {
      // Silent — nudge only.
    }
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.hasClients) {
      if (_scrollController.offset > 140 && !_showLogoInAppBar) {
        setState(() => _showLogoInAppBar = true);
      } else if (_scrollController.offset <= 140 && _showLogoInAppBar) {
        setState(() => _showLogoInAppBar = false);
      }
    }
  }

  Future<void> _loadConnections() async {
    if (!mounted) return;
    final auth = Provider.of<AuthProvider>(context, listen: false);
    setState(() {
      _loadingConnections = true;
      _connectionsError = null;
    });

    try {
      final zonesRes = await _api.get<Map<String, dynamic>>(
        ApiConstants.zones,
        queryParams: {'page': 1, 'pageSize': 100},
      );
      final allZones = (zonesRes.data?['items'] as List<dynamic>? ?? [])
          .map((e) => ZoneModel.fromJson(e as Map<String, dynamic>))
          .toList();

      Set<int>? allowedZoneIds;
      List<_ConnectionItem>? connections;

      if (auth.isSuperAdmin) {
        // Super admin sees all zones
        allowedZoneIds = null;
      } else if (auth.isDistrictAdmin || auth.isDistrictMember) {
        allowedZoneIds = {};
        final Map<int, int> zoneToDistrict = {};
        for (final distId in auth.assignedDistrictIds) {
          try {
            final res =
                await _api.get<Map<String, dynamic>>('/api/districts/$distId');
            if (res.data != null) {
              final dist = DistrictModel.fromJson(res.data!);
              if (dist.fkZoneId != null) {
                zoneToDistrict[dist.fkZoneId!] = distId;
                allowedZoneIds!.add(dist.fkZoneId!);
              }
            }
          } catch (_) {}
        }
        final districtClubId =
            auth.assignedClubIds.isNotEmpty ? auth.assignedClubIds.first : null;
        final visibleZones =
            allZones.where((z) => zoneToDistrict.containsKey(z.id)).toList();
        connections = visibleZones
            .map((z) => _ConnectionItem(
                  z.id,
                  z.zoneName,
                  'unified',
                  districtId: zoneToDistrict[z.id],
                  clubId: districtClubId,
                ))
            .toList();
      } else if (auth.isClubAdmin || auth.isClubMember) {
        allowedZoneIds = {};
        final isPlainMember = auth.isClubMember &&
            !auth.isClubAdmin &&
            !auth.isDistrictAdmin &&
            !auth.isAG;
        if (isPlainMember) {
          connections = [];
        } else if (auth.assignedDistrictIds.isNotEmpty) {
          final Map<int, int> zoneToDistrict = {};
          for (final distId in auth.assignedDistrictIds) {
            try {
              final res = await _api
                  .get<Map<String, dynamic>>('/api/districts/$distId');
              if (res.data != null) {
                final dist = DistrictModel.fromJson(res.data!);
                if (dist.fkZoneId != null) {
                  zoneToDistrict[dist.fkZoneId!] = distId;
                  allowedZoneIds!.add(dist.fkZoneId!);
                }
              }
            } catch (_) {}
          }
          final firstClubId = auth.assignedClubIds.isNotEmpty
              ? auth.assignedClubIds.first
              : null;
          final visibleZones =
              allZones.where((z) => zoneToDistrict.containsKey(z.id)).toList();
          connections = visibleZones
              .map((z) => _ConnectionItem(
                    z.id,
                    z.zoneName,
                    'unified',
                    districtId: zoneToDistrict[z.id],
                    clubId: firstClubId,
                  ))
              .toList();
        } else {
          final Map<int, ({int districtId, int clubId})> zoneToIds = {};
          for (final clubId in auth.assignedClubIds) {
            try {
              final clubRes =
                  await _api.get<Map<String, dynamic>>('/api/clubs/$clubId');
              if (clubRes.data != null) {
                final club = ClubModel.fromJson(clubRes.data!);
                if (club.fkDistrictId != null) {
                  final distRes = await _api.get<Map<String, dynamic>>(
                      '/api/districts/${club.fkDistrictId}');
                  if (distRes.data != null) {
                    final dist = DistrictModel.fromJson(distRes.data!);
                    if (dist.fkZoneId != null) {
                      zoneToIds[dist.fkZoneId!] =
                          (districtId: club.fkDistrictId!, clubId: clubId);
                      allowedZoneIds!.add(dist.fkZoneId!);
                    }
                  }
                }
              }
            } catch (_) {}
          }
          final visibleZones =
              allZones.where((z) => zoneToIds.containsKey(z.id)).toList();
          connections = visibleZones.map((z) {
            final ids = zoneToIds[z.id]!;
            return _ConnectionItem(z.id, z.zoneName, 'unified',
                districtId: ids.districtId, clubId: ids.clubId);
          }).toList();
        }
      }

      final visibleZones = allowedZoneIds == null
          ? allZones
          : allZones.where((z) => allowedZoneIds!.contains(z.id)).toList();

      connections ??= visibleZones
          .map((z) => _ConnectionItem(z.id, z.zoneName, 'zone'))
          .toList();

      // Fetch My Clubs shortcut for district/club member roles (non-admin).
      // Admin roles already see clubs via _RoleBasedConnections.
      final myClubs = <({int id, String name})>[];
      if (!auth.isAdmin &&
          !auth.isSuperAdmin &&
          !auth.isAG) {
        for (final clubId in auth.assignedClubIds) {
          // COG and IFRM are special clubs hidden from the "My Clubs" card
          // (their districts are already hidden elsewhere). Skip COG by id
          // pre-fetch; skip IFRM by name after fetch (it's named e.g.
          // "IFRM 3142 Main", so matched by substring like the calendar screen).
          if (clubId == auth.cogClubId) continue;
          try {
            final r =
                await _api.get<Map<String, dynamic>>('/api/clubs/$clubId');
            if (r.data != null) {
              final club = ClubModel.fromJson(r.data!);
              if (club.clubName.trim().toLowerCase().contains('ifrm')) continue;
              myClubs.add((id: club.id, name: club.clubName));
            }
          } catch (_) {}
        }
      }

      if (mounted)
        setState(() {
          _connections = connections ?? [];
          _myClubs = myClubs;
          _loadingConnections = false;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          _loadingConnections = false;
          _connectionsError = friendlyErrorMessage(e);
        });
    }

    // Also refresh the role-based connections widget (it owns its own
    // my-context fetch). Without this, pull-to-refresh leaves its club/district
    // cards stale (e.g. a club you were removed from still shows).
    await _connectionsKey.currentState?.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: AppColors.lightBg,
      drawer: const CustomDrawer(),
      body: RefreshIndicator(
        key: const Key('home_screen_root'),
        color: AppColors.primaryPrime,
        onRefresh: _loadConnections,
        child: CustomScrollView(
          controller: _scrollController,
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverAppBar(
              expandedHeight: 260,
              pinned: true,
              stretch: true,
              backgroundColor: AppColors.primaryDeep,
              elevation: 0,
              centerTitle: true,
              title: _showLogoInAppBar
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Image.asset('assets/images/row-mark.png', height: 28),
                        const SizedBox(width: 8),
                        Flexible(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(Brand.current.productName,
                                maxLines: 1,
                                style: AppFonts.body(color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15)),
                          ),
                        ),
                      ],
                    )
                  : null,
              leading: IconButton(
                onPressed: () => _scaffoldKey.currentState?.openDrawer(),
                icon: const Icon(Icons.menu_rounded,
                    color: Colors.white, size: 26),
              ),
              actions: [
                _NotificationBell(
                  onPressed: () async {
                    await context.push(RouteNames.notifications);
                    // The screen marks everything seen on open; re-sync the badge
                    // when we come back.
                    NotificationBadgeService.instance.refresh();
                  },
                ),
                const SizedBox(width: 4),
              ],
              flexibleSpace: FlexibleSpaceBar(
                background: Stack(
                  fit: StackFit.expand,
                  children: [
                    // Gradient background
                    Container(
                        decoration:
                            const BoxDecoration(gradient: AppGradients.royalSweep)),
                    // Header content
                    Positioned(
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: AnimatedOpacity(
                        opacity: _showLogoInAppBar ? 0.0 : 1.0,
                        duration: const Duration(milliseconds: 200),
                        child: _HeaderContent(
                            memberName: auth.memberName,
                            profilePhotoPath: auth.profilePhotoPath),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Transform.translate(
                offset: const Offset(0, -40),
                child: const Padding(
                  padding:
                      EdgeInsets.symmetric(horizontal: AppSpacing.md),
                  child: _ImportantLinksCard(),
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                0,
                AppSpacing.md,
                AppSpacing.md,
              ),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  const _SectionHeader(title: 'My Connections', centered: true),
                  const SizedBox(height: AppSpacing.md),
                  // A member whose context carries a SuperAdmin role (web-only
                  // portal) gets a hand-off card that opens the web console
                  // already signed in. Shown in every My Connections layout.
                  if (auth.hasSuperAdminRole) ...[
                    _SuperAdminConnectionCard(api: _api),
                    const SizedBox(height: AppSpacing.md),
                  ],
                  if (auth.isAdmin ||
                      auth.isAG ||
                      auth.isDistrictMember ||
                      auth.isClubMember)
                    _RoleBasedConnections(
                        key: _connectionsKey, api: _api, auth: auth)
                  else ...[
                    if (_myClubs.isNotEmpty) ...[
                      _MyClubsCard(clubs: _myClubs),
                      const SizedBox(height: AppSpacing.md),
                    ],
                    _ConnectionCards(
                      connections: _connections,
                      isLoading: _loadingConnections,
                      error: _connectionsError,
                      onRetry: _loadConnections,
                    ),
                  ],
                  const SizedBox(height: AppSpacing.md),
                  const _SectionHeader(title: 'My Rotary', centered: true, fontSize: 15),
                  const SizedBox(height: AppSpacing.md),
                  _MyRotaryGrid(auth: auth),
                  const SizedBox(height: AppSpacing.md),
                  const Divider(color: AppColors.border, thickness: 2),
                  const SizedBox(height: AppSpacing.lg),
                ]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// App-bar bell with an unread-count badge driven by
/// [NotificationBadgeService]. Rebuilds only the badge as the count changes.
class _NotificationBell extends StatelessWidget {
  final VoidCallback onPressed;
  const _NotificationBell({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: NotificationBadgeService.instance.count,
      builder: (context, count, _) {
        return Stack(
          clipBehavior: Clip.none,
          children: [
            IconButton(
              onPressed: onPressed,
              icon: const Icon(Icons.notifications_none_rounded,
                  color: Colors.white, size: 26),
            ),
            if (count > 0)
              Positioned(
                right: 6,
                top: 8,
                child: Container(
                  padding: EdgeInsets.symmetric(
                      horizontal: count > 9 ? 4 : 0, vertical: 0),
                  constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                  decoration: BoxDecoration(
                    color: AppColors.error,
                    borderRadius: BorderRadius.circular(9),
                    border: Border.all(color: Colors.white, width: 1.5),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    count > 9 ? '9+' : '$count',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      height: 1.1,
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _HeaderContent extends StatelessWidget {
  final String memberName;
  final String? profilePhotoPath;
  const _HeaderContent({required this.memberName, this.profilePhotoPath});

  String _initials(String name) {
    final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  Widget _initialsAvatar() {
    return Container(
      color: AppColors.goldPrime,
      alignment: Alignment.center,
      child: Text(
        _initials(memberName),
        style: AppFonts.body(
            color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 64, 20, 0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // ROW lockup (white, on the azure header)
          Image.asset(
            'assets/images/row-logo-inverse.png',
            height: 56,
            errorBuilder: (_, __, ___) => Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.rotate_right, color: AppColors.goldPrime, size: 28),
                const SizedBox(width: 8),
                Text(Brand.current.productName.toUpperCase(),
                    style: AppFonts.body(color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 2)),
              ],
            ),
          ),
          const SizedBox(height: 20),
          // Profile card
          GestureDetector(
            onTap: () => context.push(RouteNames.profile),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.13),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: Colors.white.withOpacity(0.18)),
              ),
              child: Row(
                children: [
                  // Profile avatar (photo or initials) with gold ring
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: AppColors.goldPrime,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    clipBehavior: Clip.antiAlias,
                    // ClipOval guarantees the photo is clipped to a circle.
                    // (A Container's own clipBehavior is unreliable when the
                    // decoration also has a border — the image can render as a
                    // square under the ring.)
                    child: ClipOval(
                      child: SizedBox(
                        width: 46,
                        height: 46,
                        child: profilePhotoPath != null &&
                                profilePhotoPath!.isNotEmpty
                            ? Image.network(
                                ApiConstants.mediaUrl(profilePhotoPath),
                                fit: BoxFit.cover,
                                width: 46,
                                height: 46,
                                errorBuilder: (_, __, ___) => _initialsAvatar(),
                              )
                            : _initialsAvatar(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Welcome,',
                            style: AppFonts.body(color: Colors.white.withOpacity(0.7),
                                fontSize: 11,
                                fontWeight: FontWeight.w500)),
                        Text(
                          memberName.isNotEmpty ? memberName : 'Rotarian',
                          style: AppFonts.body(color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w800),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 3),
                        // Explicit affordance: spells out that tapping the card
                        // opens the profile (a bare chevron wasn't understood).
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('View profile',
                                style: AppFonts.body(color: AppColors.goldPrime,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700)),
                            const SizedBox(width: 2),
                            const Icon(Icons.chevron_right_rounded,
                                color: AppColors.goldPrime, size: 16),
                          ],
                        ),
                      ],
                    ),
                  ),
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      showModalBottomSheet(
                        context: context,
                        backgroundColor: Colors.transparent,
                        isScrollControlled: true,
                        builder: (_) => const ShareContactSheet(),
                      );
                    },
                    child: Container(
                      width: 44,
                      height: 44,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.goldPrime.withOpacity(0.25),
                        shape: BoxShape.circle,
                        border: Border.all(
                            color: AppColors.goldPrime.withOpacity(0.7),
                            width: 1.5),
                      ),
                      child: const Icon(Icons.qr_code_rounded,
                          color: Colors.white, size: 24),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;

  /// When true the title is rendered small + centered with a divider on each
  /// side (── Title ──). Default is the left-aligned large heading.
  final bool centered;

  /// Font size for the [centered] variant (ignored otherwise).
  final double fontSize;

  const _SectionHeader({
    required this.title,
    this.centered = false,
    this.fontSize = 16,
  });

  @override
  Widget build(BuildContext context) {
    if (centered) {
      return Row(
        children: [
          const Expanded(child: const Divider(color: AppColors.border, thickness: 2)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              title,
              style: AppTextStyles.h2.copyWith(
                fontSize: fontSize,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                letterSpacing: 0.3,
                height: 1.0,
              ),
            ),
          ),
          const Expanded(child: const Divider(color: AppColors.border, thickness: 2)),
        ],
      );
    }
    return Text(
      title,
      style: AppTextStyles.h2.copyWith(
        color: AppColors.textPrimary,
        fontWeight: FontWeight.bold,
      ),
    );
  }
}

// Background of the Quick Access card.
const Color _kImportantLinksBg = AppColors.primaryDeep;

class _ImportantLinksCard extends StatefulWidget {
  const _ImportantLinksCard();

  @override
  State<_ImportantLinksCard> createState() => _ImportantLinksCardState();
}

class _ImportantLinksCardState extends State<_ImportantLinksCard> {
  // "Pay Club Dues" is an OFFICER surface (current-year Club President /
  // Secretary / Treasurer of a club with an active dues campaign). There is NO
  // officer-role signal in my-context / AuthProvider — only generic club-admin,
  // which is neither necessary (a President need not be a "Club Admin" role) nor
  // sufficient. So, exactly like the web club dashboard, resolve it from the
  // server once: the officer my-clubs list is non-empty iff the user may pay for
  // a club. Hidden until confirmed so non-officers never see it flash in.
  bool _isOfficer = false;

  @override
  void initState() {
    super.initState();
    _resolveOfficer();
  }

  Future<void> _resolveOfficer() async {
    final auth = context.read<AuthProvider>();
    // Only a member of some club can be its officer — skip the call otherwise.
    if (auth.memberClubIds.isEmpty && auth.clubAdminClubIds.isEmpty) return;
    try {
      final clubs = await ClubDuesPayApi().getMyClubs();
      if (mounted && clubs.isNotEmpty) setState(() => _isOfficer = true);
    } catch (_) {
      // Non-fatal: leave the tile hidden.
    }
  }

  @override
  Widget build(BuildContext context) {
    // Order: Membership Dues, (Pay Club Dues — officers only, server-resolved),
    // Calendar (one entry → unified COG/Club/District listing), My Club /
    // District websites.
    final links = <_LinkData>[
      _LinkData('Club\nDues', Icons.receipt_long_rounded,
          AppColors.accentBlue, AppColors.chart5,
          onTap: () => _openMembershipDues(context)),
      if (_isOfficer)
        _LinkData('Pay District\nDues', Icons.account_balance_wallet_rounded,
            AppColors.accentBlue, AppColors.chart5,
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const ClubDuesMyClubsScreen(),
                ))),
      _LinkData('Calendar', Icons.calendar_month_rounded,
          AppColors.accentBlue, AppColors.chart5,
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const MyCalendarsScreen(),
              ))),
      _LinkData('My Club\nWebsite', Icons.web_rounded, AppColors.accentBlue,
          AppColors.accentBlue,
          onTap: () => _openClubWebsites(context)),
      _LinkData('District\nWebsite', Icons.public_rounded,
          AppColors.chart5, AppColors.chart5,
          onTap: () => _openDistrictWebsites(context)),
    ];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _kImportantLinksBg,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.goldPrime.withOpacity(0.18),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.bolt_rounded,
                        color: AppColors.goldPrime, size: 13),
                    const SizedBox(width: 4),
                    Text('QUICK ACCESS',
                        style: AppFonts.body(color: AppColors.goldPrime,
                            fontWeight: FontWeight.w800,
                            fontSize: 9,
                            letterSpacing: 1)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // All four links fit without scrolling — lay them out evenly across
          // the card width.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final link in links)
                Expanded(child: _LinkChip(link: link)),
            ],
          ),
        ],
      ),
    );
  }
}

bool _membershipDuesResolving = false;

/// Quick-access "Membership Dues" entry. Role-split + multi-club aware: a user
/// can be a club admin of several clubs AND a plain member of another, so we
/// resolve the live club list and offer:
///   • each admin club → that club's admin dues editor (manage everyone)
///   • "My Dues" (their own dues) when they're a plain member somewhere / have
///     no admin club
/// One destination opens directly; several show a picker.
Future<void> _openMembershipDues(BuildContext context) async {
  if (_membershipDuesResolving) return;
  _membershipDuesResolving = true;

  final auth = context.read<AuthProvider>();
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const Center(child: const CircularProgressIndicator(color: AppColors.primary)),
  );

  // Freshen role assignments (a role change after login can otherwise leave the
  // admin/member split stale) then read the live club list. In parallel pull
  // the member's own dues — keyed by member, it tells us which member-only
  // clubs have actually set up dues (so we can grey out the ones that haven't).
  await auth.refreshContext();
  Map<String, dynamic>? data;
  try {
    final resp = await ApiClient().get<Map<String, dynamic>>(
      ApiConstants.myContext,
      fromJson: (j) => j as Map<String, dynamic>,
    );
    data = resp.data;
  } catch (_) {}

  // Best-effort: which member-only clubs actually have dues set up (so we can
  // grey out the ones that don't). A failure here must not break the picker.
  final subscribedMemberClubIds = <int>{};
  try {
    final resp = await ApiClient().get<List<dynamic>>(
      '/api/mobile/my-membership-dues',
      fromJson: (j) => j as List<dynamic>,
    );
    for (final e in (resp.data ?? const [])) {
      if (e is Map<String, dynamic>) {
        final cid = e['clubId'];
        final id = cid is int ? cid : int.tryParse('$cid') ?? 0;
        if (id > 0) subscribedMemberClubIds.add(id);
      }
    }
  } catch (_) {}

  final rawClubs = (data?['accessibleClubs'] as List<dynamic>? ?? const [])
      .whereType<Map<String, dynamic>>()
      .toList();

  // `/api/mobile/my-membership-dues` is the single source of truth: a club it
  // returns has payable dues; any member-only club it omits has no dues set up.
  // (The backend has no separate subscription flag — "not subscribed" and
  // "subscribed but no dues created" are the same DB state, so we treat any
  // omitted member-only club as "contact for subscription".)
  if (!context.mounted) {
    _membershipDuesResolving = false;
    return;
  }
  Navigator.of(context, rootNavigator: true).pop();
  _membershipDuesResolving = false;

  // One entry per club, no duplicates:
  //  • admin               → "Manage" (always enabled; covers own dues)
  //  • member + has dues    → "My Dues" → scoped view
  //  • member + no dues     → greyed, "contact for subscription" popup
  //    (club absent from /api/mobile/my-membership-dues → no dues set up)
  final destinations = <_DuesDestination>[];
  for (final c in rawClubs) {
    final id = c['id'] as int? ?? 0;
    if (id <= 0) continue;
    final name = (c['name']?.toString() ?? '').trim();
    // COG has no Membership Dues — never offer it for the COG club.
    if (id == auth.cogClubId || name.toLowerCase() == 'cog') continue;
    final club = name.isEmpty ? 'Club' : name;
    if (auth.isClubAdminOf(id)) {
      destinations.add(_DuesDestination(
        title: club,
        subtitle: 'Manage club dues',
        icon: Icons.manage_accounts_rounded,
        state: _DuesState.open,
        route: RouteNames.membershipDues(id),
      ));
    } else if (subscribedMemberClubIds.contains(id)) {
      destinations.add(_DuesDestination(
        title: club,
        subtitle: 'View & pay my dues',
        icon: Icons.receipt_long_rounded,
        state: _DuesState.open,
        route: RouteNames.myDuesFor(id, clubName: club),
      ));
    } else {
      destinations.add(_DuesDestination(
        title: club,
        subtitle: 'Activation required',
        icon: Icons.card_membership_rounded,
        state: _DuesState.notSubscribed,
        clubName: club,
      ));
    }
  }

  if (destinations.isEmpty) {
    // Defensive: no clubs resolved — fall back to the unscoped member view.
    context.push(RouteNames.myDues);
    return;
  }
  // A single club: act directly (navigate, or show the relevant popup).
  if (destinations.length == 1) {
    _activateDues(context, destinations.first);
    return;
  }
  _showDuesPicker(context, destinations);
}

/// Best-effort subscription probe: does this club have an ENABLED
/// `membershipdues` row in its raw module assignment? `/api/clubs/{id}/modules`
/// returns the unfiltered club_modules list (not the member-default-filtered
/// Act on a dues destination by its state: open the route, or surface the
/// "contact for subscription" popup.
void _activateDues(BuildContext context, _DuesDestination d) {
  switch (d.state) {
    case _DuesState.open:
      context.push(d.route);
      break;
    case _DuesState.notSubscribed:
      showDuesSubscriptionDialog(context, clubName: d.clubName);
      break;
  }
}

/// Resolved state of a club's membership-dues entry in the home picker.
///  • open          → navigate to [_DuesDestination.route]
///  • notSubscribed → no dues set up for this club (contact-for-subscription popup)
enum _DuesState { open, notSubscribed }

class _DuesDestination {
  final String title;
  final String subtitle;
  final IconData icon;
  final _DuesState state;

  /// Navigation target — used only when [state] is [_DuesState.open].
  final String route;

  /// Club name, used to personalise the disabled-state popups.
  final String clubName;

  const _DuesDestination({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.state,
    this.route = '',
    this.clubName = '',
  });

  bool get enabled => state == _DuesState.open;
}

void _showDuesPicker(BuildContext context, List<_DuesDestination> destinations) {
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (sheetCtx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 10),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.divider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Club Dues', style: AppTextStyles.h4),
            ),
          ),
          const SizedBox(height: 6),
          ...destinations.map(
            (d) => ListTile(
              // Kept tappable even when disabled so the tap can surface the
              // "not set up yet" popup (ListTile.enabled would swallow onTap).
              leading: CircleAvatar(
                backgroundColor: (d.enabled ? AppColors.primary : AppColors.textMuted)
                    .withOpacity(0.10),
                child: Icon(d.icon,
                    color: d.enabled ? AppColors.primary : AppColors.textMuted,
                    size: 20),
              ),
              title: Text(
                d.title,
                style: AppTextStyles.bodySemiBold.copyWith(
                  color: d.enabled ? null : AppColors.textMuted,
                ),
              ),
              subtitle: Text(d.subtitle, style: AppTextStyles.caption),
              trailing: d.enabled
                  ? null
                  : const Icon(Icons.lock_outline_rounded,
                      size: 18, color: AppColors.textMuted),
              onTap: () {
                Navigator.of(sheetCtx).pop();
                _activateDues(context, d);
              },
            ),
          ),
          const SizedBox(height: 10),
        ],
      ),
    ),
  );
}

bool _clubWebsitesResolving = false;

Future<void> _openClubWebsites(BuildContext context) async {
  if (_clubWebsitesResolving) return;

  // COG (by id) and IFRM (by name) are hidden from My Club Websites, mirroring
  // the "My Clubs" card. Captured before the await.
  final cogId = context.read<AuthProvider>().cogClubId;
  _clubWebsitesResolving = true;
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const Center(
      child: const CircularProgressIndicator(color: AppColors.primary),
    ),
  );

  Map<String, dynamic>? data;
  Object? error;
  try {
    final resp = await ApiClient().get<Map<String, dynamic>>(
      ApiConstants.myContext,
      fromJson: (j) => j as Map<String, dynamic>,
    );
    data = resp.data;
  } catch (e) {
    error = e;
  }

  if (!context.mounted) {
    _clubWebsitesResolving = false;
    return;
  }
  Navigator.of(context, rootNavigator: true).pop();
  _clubWebsitesResolving = false;

  if (error != null || data == null) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Could not load clubs')),
    );
    return;
  }

  final raw = (data['accessibleClubs'] as List<dynamic>? ?? const [])
      .whereType<Map<String, dynamic>>()
      .where((c) =>
          c['id'] != cogId &&
          !((c['name']?.toString() ?? '').trim().toLowerCase().contains('ifrm')))
      .toList();

  if (raw.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('No website configured')),
    );
    return;
  }

  if (raw.length == 1) {
    final club = raw.first;
    final clubId = (club['id'] as num?)?.toInt() ?? 0;
    final clubName = (club['name']?.toString() ?? '').trim();
    final url = (club['websiteUrl']?.toString() ?? '').trim();
    // Admins of this club MANAGE the site on the "My Club Website" page (status,
    // set up / renew, management grid, visit link) — they don't get dumped
    // straight into the public site. Plain members open the public URL directly.
    // Mirrors the per-club branch in MyClubWebsitesScreen so the single-club fast
    // path and the multi-club picker behave the same.
    final isAdmin = context.read<AuthProvider>().isClubAdminOf(clubId);
    if (isAdmin) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => Scaffold(
            backgroundColor: AppColors.background,
            appBar: const CustomAppBar(title: 'My Club Website'),
            body: ClubWebsiteTab(clubId: clubId),
          ),
        ),
      );
      return;
    }
    if (url.isEmpty) {
      // Plain member whose club has no website yet: the same "not set up" card
      // the admin sees, but with no set-up action.
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => Scaffold(
            backgroundColor: AppColors.background,
            appBar: const CustomAppBar(title: 'My Club Website'),
            body: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(12, 16, 12, 32),
              child: WebsiteNotConfiguredCard(
                clubId: clubId,
                clubName: clubName,
                showSetup: false,
              ),
            ),
          ),
        ),
      );
      return;
    }
    var u = url;
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://$u';
    final uri = Uri.tryParse(u);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open $u')),
      );
    }
    return;
  }

  context.push(RouteNames.myClubWebsites);
}

bool _districtWebsitesResolving = false;

/// Single-district fast path mirrors `_openClubWebsites`. `accessibleDistricts`
/// in my-context lacks a website URL, so we resolve via the first accessible
/// club in that district through `/api/mobile/club-finder/{clubId}` which
/// returns `districtWebsite { clientDomain, status }`. The backend writes the
/// FINAL sanitised URL into `clientDomain`, so we read it directly.
Future<void> _openDistrictWebsites(BuildContext context) async {
  if (_districtWebsitesResolving) return;
  _districtWebsitesResolving = true;
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const Center(
      child: const CircularProgressIndicator(color: AppColors.primary),
    ),
  );

  Map<String, dynamic>? data;
  Object? error;
  try {
    final resp = await ApiClient().get<Map<String, dynamic>>(
      ApiConstants.myContext,
      fromJson: (j) => j as Map<String, dynamic>,
    );
    data = resp.data;
  } catch (e) {
    error = e;
  }

  if (!context.mounted) {
    _districtWebsitesResolving = false;
    return;
  }
  Navigator.of(context, rootNavigator: true).pop();

  if (error != null || data == null) {
    _districtWebsitesResolving = false;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Could not load districts')),
    );
    return;
  }

  final clubs = (data['accessibleClubs'] as List<dynamic>? ?? const [])
      .whereType<Map<String, dynamic>>()
      .toList();
  // COG and IFRM ("IFRM India") districts are hidden — identified via their
  // special clubs' districtId, mirroring the district-websites list screen.
  final hiddenDistrictIds = <int>{
    for (final c in clubs)
      if (c['districtId'] is int &&
          (((c['name']?.toString() ?? '').trim().toLowerCase() == 'cog') ||
              ((c['name']?.toString() ?? '').trim().toLowerCase().contains('ifrm'))))
        c['districtId'] as int,
  };
  final districts = (data['accessibleDistricts'] as List<dynamic>? ?? const [])
      .whereType<Map<String, dynamic>>()
      .where((d) => !hiddenDistrictIds.contains(d['id']))
      .toList();

  if (districts.isEmpty) {
    _districtWebsitesResolving = false;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('You are not a member of any district yet.')),
    );
    return;
  }

  if (districts.length == 1) {
    final districtId = districts.first['id'] as int?;
    final clubInDistrict = districtId == null
        ? null
        : clubs.firstWhere(
            (c) => c['districtId'] == districtId,
            orElse: () => const <String, dynamic>{},
          );
    final clubId = clubInDistrict?['id'] as int?;
    if (clubId == null) {
      _districtWebsitesResolving = false;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No website configured')),
      );
      return;
    }
    Map<String, dynamic>? detail;
    try {
      final resp = await ApiClient().get<Map<String, dynamic>>(
        '/api/mobile/club-finder/$clubId',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      detail = resp.data;
    } catch (_) {/* fall through to snack */}
    _districtWebsitesResolving = false;
    if (!context.mounted) return;

    final dw = detail?['districtWebsite'];
    final url = _composeDistrictWebsiteUrl(dw);
    if (url == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No website configured')),
      );
      return;
    }
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open $url')),
      );
    }
    return;
  }

  _districtWebsitesResolving = false;
  context.push(RouteNames.myDistrictWebsites);
}

String? _composeDistrictWebsiteUrl(dynamic dw) {
  if (dw is! Map<String, dynamic>) return null;
  if ((dw['status']?.toString() ?? '').toLowerCase() != 'active') return null;
  // Backend (2026-06-22) writes the FINAL sanitised URL into `clientDomain`
  // (full https://… or "" when none), so read it directly — no more composing
  // from `subdomain` + a hard-coded parent domain.
  final url = (dw['clientDomain']?.toString() ?? '').trim();
  if (url.isEmpty) return null;
  return url.startsWith('http') ? url : 'https://$url';
}

class _LinkData {
  final String label;
  final IconData icon;
  final Color colorFrom;
  final Color colorTo;
  final VoidCallback? onTap;
  const _LinkData(this.label, this.icon, this.colorFrom, this.colorTo,
      {this.onTap});
}

class _LinkChip extends StatelessWidget {
  final _LinkData link;
  const _LinkChip({required this.link});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: link.onTap,
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: link.colorFrom,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(link.icon, color: Colors.white, size: 22),
          ),
          const SizedBox(height: 8),
          // Reserve a fixed two-line height and center the label so a one-line
          // entry ("Calendar") lines up with the two-line ones, not floating
          // above them.
          SizedBox(
            height: 26,
            child: Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  link.label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  style: AppFonts.body(color: Colors.white.withOpacity(0.9),
                    fontWeight: FontWeight.w600,
                    fontSize: 9.5,
                    height: 1.3,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MyClubsCard extends StatelessWidget {
  final List<({int id, String name})> clubs;
  const _MyClubsCard({required this.clubs});

  void _navigate(BuildContext context) {
    if (clubs.length == 1) {
      context.push(RouteNames.clubDashboard(clubs.first.id));
    } else {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => MyClubsListScreen(clubs: clubs),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final label =
        clubs.length == 1 ? clubs.first.name : 'My Clubs (${clubs.length})';
    return GestureDetector(
      onTap: () => _navigate(context),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          gradient: AppGradients.royalSweep,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.groups_rounded,
                  color: Colors.white, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'MY CLUB',
                    style: AppFonts.body(color: Colors.white.withValues(alpha: 0.75),
                      fontWeight: FontWeight.w700,
                      fontSize: 9,
                      letterSpacing: 1,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    label,
                    style: AppFonts.body(color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Icon(Icons.arrow_forward_ios_rounded,
                color: Colors.white.withValues(alpha: 0.7), size: 14),
          ],
        ),
      ),
    );
  }
}

class _ConnectionCards extends StatelessWidget {
  final List<_ConnectionItem> connections;
  final bool isLoading;
  final String? error;
  final VoidCallback onRetry;

  const _ConnectionCards({
    required this.connections,
    required this.isLoading,
    required this.error,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return Container(
        height: 120,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
        ),
        child: const Center(child: CircularProgressIndicator()),
      );
    }

    if (error != null) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(24)),
        child: _InlineErrorBody(message: error!, onRetry: onRetry),
      );
    }

    if (connections.isEmpty) {
      return const SizedBox.shrink();
    }

    // Single tile: full-width hero card.
    if (connections.length == 1) {
      final c = connections.first;
      return SizedBox(
        height: 116,
        child: _ConnectionCard(
          title: c.title,
          index: 0,
          onTap: () => c.navigate(context),
        ),
      );
    }

    // Odd count (3, 5, 7, …): first tile full-width, remainder in a 2-col grid.
    if (connections.length.isOdd) {
      final first = connections.first;
      final rest = connections.sublist(1);
      return Column(
        children: [
          SizedBox(
            height: 116,
            child: _ConnectionCard(
              title: first.title,
              index: 0,
              onTap: () => first.navigate(context),
            ),
          ),
          const SizedBox(height: 8),
          GridView.builder(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
              mainAxisExtent: 116,
            ),
            itemCount: rest.length,
            itemBuilder: (ctx, i) => _ConnectionCard(
              title: rest[i].title,
              index: i + 1, // keep gradient rotation continuous
              onTap: () => rest[i].navigate(ctx),
            ),
          ),
        ],
      );
    }

    // Even count (2, 4, 6, …): clean 2-col grid.
    return GridView.builder(
      shrinkWrap: true,
      padding: EdgeInsets.zero,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        mainAxisExtent: 116,
      ),
      itemCount: connections.length,
      itemBuilder: (ctx, i) => _ConnectionCard(
        title: connections[i].title,
        index: i,
        onTap: () => connections[i].navigate(ctx),
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  final String title;
  final int index;
  final VoidCallback? onTap;
  const _ConnectionCard({required this.title, required this.index, this.onTap});

  static const _gradients = [
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.accentBlue, AppColors.chart5],
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.primaryDeep, AppColors.primaryDeep],
    [AppColors.successDark, AppColors.success],
    [AppColors.warningInk, AppColors.warningDark],
  ];

  @override
  Widget build(BuildContext context) {
    final grad = _gradients[index % _gradients.length];
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.primaryPrime,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: const BoxDecoration(
                      color: AppColors.surface,
                      shape: BoxShape.circle),
                  child: Image.asset('assets/images/row-mark.png', width: 18, height: 18),
                ),
                Icon(Icons.arrow_outward_rounded,
                    color: Colors.white.withOpacity(0.7), size: 16),
              ],
            ),
            const SizedBox(height: 8),
            // Give the name all the remaining height and up to 3 lines, pinned
            // to the bottom — long club/district names were being ellipsized at
            // 2 lines in the narrow 2-column grid.
            Expanded(
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text(
                  title,
                  style: AppFonts.body(fontSize: 11,
                      fontWeight: FontWeight.w800,
                      height: 1.2,
                      color: Colors.white),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MyRotaryGrid extends StatelessWidget {
  final AuthProvider auth;
  const _MyRotaryGrid({required this.auth});

  @override
  Widget build(BuildContext context) {
    final items = [
      _RotaryItem('Club Finder', Icons.search_rounded, AppColors.accentBlue,
          () => context.push(RouteNames.clubFinder)),
      _RotaryItem('Find a Rotarian', Icons.person_search_rounded,
          AppColors.accentBlue, () => context.push(RouteNames.findRotarian)),
      // Pages of the instance's public web site (shown only when the brand has a web origin).
      for (final (label, icon, color, path) in const [
        ('Important Websites', Icons.language_rounded, AppColors.accentBlue, '/websites'),
        ('Our Leaders', Icons.account_balance_rounded, AppColors.primaryDeep, '/our-leaders'),
        ('District Governors', Icons.location_on_rounded, AppColors.primaryDeep, '/district-governors'),
        ('Regional Leaders', Icons.groups_rounded, AppColors.accentBlue, '/regional-leaders'),
      ])
        if (Brand.current.webUrl(path).isNotEmpty)
          _RotaryItem(label, icon, color,
              () => context.push(RouteNames.webView(label, Brand.current.webUrl(path)))),
      _RotaryItem(
          'Rotary News',
          Icons.description_rounded,
          AppColors.warningDark,
          () => context.push(RouteNames.webView(
              'Rotary News', 'https://www.rotary.org/en/news-features'))),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        // Pin each tile to a fixed height so it does NOT scale with screen
        // width. (childAspectRatio derives height from width, which made tiles
        // — and the centered whitespace around the icon — grow on larger
        // phones; on NARROW phones it made tiles too short, clipping the 2nd
        // line of the label.) mainAxisExtent overrides childAspectRatio and
        // gives a constant height across devices, sized to always fit the
        // icon (48) + gap (8) + two text lines + padding, with headroom for
        // larger system font scales.
        mainAxisExtent: 118,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
      ),
      itemCount: items.length,
      itemBuilder: (ctx, i) => _RotaryTile(item: items[i]),
    );
  }
}

class _RotaryItem {
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback? onTap;
  const _RotaryItem(this.label, this.icon, this.color, [this.onTap]);
}

class _RotaryTile extends StatelessWidget {
  final _RotaryItem item;
  const _RotaryTile({required this.item});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: item.onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.lightBorder, width: 1),
        ),
        // Top-align content so the icon sits near the card's top (less white
        // space below the "My Rotary" header) without shrinking the card.
        padding: const EdgeInsets.all(10),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: item.color.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(item.icon, color: item.color, size: 24),
            ),
            const SizedBox(height: 8),
            Flexible(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child: Text(
                  item.label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    height: 1.3,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleBasedConnections extends StatefulWidget {
  final ApiClient api;
  final AuthProvider auth;
  const _RoleBasedConnections({super.key, required this.api, required this.auth});

  @override
  State<_RoleBasedConnections> createState() => _RoleBasedConnectionsState();
}

class _RoleScopeRow {
  final String roleName;
  final String? scope;
  final int? districtId;
  final int? clubId;
  const _RoleScopeRow(
      {required this.roleName, this.scope, this.districtId, this.clubId});
}

class _DistrictScope {
  final int id;
  final String number;
  final int? totalClubs;
  final int? totalMembers;
  const _DistrictScope(
      {required this.id,
      required this.number,
      this.totalClubs,
      this.totalMembers});
}

class _ClubScope {
  final int id;
  final String name;
  final int? districtId;
  final int? totalMembers;
  const _ClubScope(
      {required this.id,
      required this.name,
      this.districtId,
      this.totalMembers});
}

class _RoleBasedConnectionsState extends State<_RoleBasedConnections> {
  bool _loading = true;
  String? _error;
  List<_RoleScopeRow> _roles = [];
  List<_DistrictScope> _districts = [];
  List<_ClubScope> _clubs = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _fetch());
  }

  /// Public entry point so the parent's pull-to-refresh can re-fetch this
  /// widget's clubs/districts (it owns its own my-context call).
  Future<void> refresh() => _fetch();

  Future<void> _fetch() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget.api.get<Map<String, dynamic>>(
        ApiConstants.myContext,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (!res.isSuccess || res.data == null) {
        setState(() {
          _loading = false;
          _error = res.error ?? 'Failed to load.';
        });
        return;
      }
      final j = res.data!;
      final roles = (j['roles'] as List<dynamic>? ?? []).map((e) {
        final m = e as Map<String, dynamic>;
        return _RoleScopeRow(
          roleName: m['roleName']?.toString() ?? '',
          scope: m['scope']?.toString(),
          districtId: m['districtId'] as int?,
          clubId: m['clubId'] as int?,
        );
      }).toList();
      final districts = (j['accessibleDistricts'] as List<dynamic>? ?? [])
          .map((e) {
            final m = e as Map<String, dynamic>;
            return _DistrictScope(
              id: (m['id'] as int?) ?? 0,
              number: m['number']?.toString() ?? '',
              totalClubs: m['totalClubs'] as int?,
              totalMembers: m['totalMembers'] as int?,
            );
          })
          .where((d) => d.id > 0)
          .toList();
      final clubs = (j['accessibleClubs'] as List<dynamic>? ?? [])
          .map((e) {
            final m = e as Map<String, dynamic>;
            return _ClubScope(
              id: (m['id'] as int?) ?? 0,
              name: m['name']?.toString() ?? '',
              districtId: m['districtId'] as int?,
              totalMembers: m['totalMembers'] as int?,
            );
          })
          .where((c) => c.id > 0)
          .toList();
      setState(() {
        _loading = false;
        _roles = roles;
        _districts = districts;
        _clubs = clubs;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = friendlyErrorMessage(e);
      });
    }
  }

  List<_DistrictScope> get _adminDistricts {
    final ids = <int>{};
    for (final r in _roles) {
      if ((r.roleName == 'Admin' || r.roleName == 'District Admin') &&
          r.scope == 'district' &&
          r.districtId != null) {
        ids.add(r.districtId!);
      }
    }
    return _districts.where((d) => ids.contains(d.id)).toList();
  }

  List<_ClubScope> get _adminClubs {
    final ids = <int>{};
    for (final r in _roles) {
      if ((r.roleName == 'Admin' || r.roleName == 'Club Admin') &&
          r.scope == 'club' &&
          r.clubId != null) {
        ids.add(r.clubId!);
      }
    }
    return _clubs.where((c) => ids.contains(c.id)).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Container(
        height: 120,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
        ),
        child: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(24)),
        child: _InlineErrorBody(message: _error!, onRetry: _fetch),
      );
    }

    final auth = widget.auth;
    final adminDistricts = _adminDistricts;
    final adminClubs = _adminClubs;
    final adminDistrictIds = adminDistricts.map((d) => d.id).toSet();
    final adminClubIds = adminClubs.map((c) => c.id).toSet();

    // COG is a special club whose district (e.g. 1280) must NOT appear as a
    // District card in My Connections. Resolve it by the COG club's name and
    // hide that one district from the district tiles (the COG club tile and
    // all other districts stay). Detected dynamically so ids can change.
    int? cogDistrictId;
    for (final c in _clubs) {
      if (c.name.trim().toLowerCase() == 'cog') {
        cogDistrictId = c.districtId;
        break;
      }
    }
    bool isCogDistrict(_DistrictScope d) =>
        cogDistrictId != null && d.id == cogDistrictId;

    // Per-level role gating: every accessible district/club gets a tile that
    // opens the standard dashboard route. The dashboard + modules respect
    // auth.isDistrictAdminOf / auth.isClubAdminOf for view-only behaviour.
    // Admins see "District Admin"/"Club Admin" badges and can edit;
    // plain members see "District Member"/"Club Member" badges (read-only).

    // Unified layout toggle. Eligibility: 1 or 2 accessible districts AND
    // at least 1 accessible club, regardless of admin/member role on either.
    // Per-scope role gating inside the unified modules screen still applies,
    // so non-admin contexts render their modules in view-only.
    final unifiedEnabled =
        context.watch<HomeLayoutController>().unifiedHomeEnabled;
    // Members whose only clubs are special (COG and/or IFRM) are never eligible
    // for the unified hero — it would resurface the COG/IFRM club/district
    // that's deliberately hidden elsewhere in My Connections. Guard here too so
    // a stale persisted preference (the toggle used to be visible to them)
    // can't re-enable it.
    final isSpecialClubOnly =
        (auth.isCogMember || auth.isIfrmMember) && auth.nonSpecialClubIds.isEmpty;
    final unifiedEligible = unifiedEnabled &&
        !isSpecialClubOnly &&
        (_districts.length == 1 || _districts.length == 2) &&
        _clubs.isNotEmpty;

    // Secondary items: role tiles + member/admin clubs
    final secondary =
        <({String title, String badge, String stats, VoidCallback onTap})>[];

    if (auth.isAG) {
      secondary.add((
        title: 'AG Dashboard',
        badge: 'AG',
        stats: 'Clubs · Goals · TRF',
        onTap: () => context.push(RouteNames.agDashboard)
      ));
    }

    // In unified mode every club is reachable from the "My Rotary" hero
    // (via its club-tab switcher), so per-club tiles are redundant and
    // skipped. In non-unified mode every accessible club renders as its
    // own tile, admin clubs first then member clubs.
    if (!unifiedEligible) {
      final orderedClubs = <_ClubScope>[
        ..._clubs.where((c) => adminClubIds.contains(c.id)),
        ..._clubs.where((c) => !adminClubIds.contains(c.id)),
      ];
      for (final c in orderedClubs) {
        final isAdmin = adminClubIds.contains(c.id);
        secondary.add((
          title: c.name,
          badge: isAdmin ? 'Club Admin' : 'Club Member',
          stats:
              '${c.totalMembers ?? 0} Member${(c.totalMembers ?? 0) != 1 ? "s" : ""}',
          onTap: () => context.push('/clubs/${c.id}/dashboard'),
        ));
      }
    }

    if (_districts.isEmpty && _clubs.isEmpty && secondary.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(24)),
        child: Center(
          child: Text(
            'No district or club assigned. Contact your administrator.',
            style: AppTextStyles.body,
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    // Assemble the final tile list. In unified mode the admin district+club
    // tiles collapse into a single "My Rotary" tile placed first; non-admin
    // district tiles still render after it.
    final allTiles =
        <({String title, String badge, String stats, VoidCallback onTap})>[];

    if (unifiedEligible) {
      // Pick the preferred district for the unified hero's default entry:
      //   1. First admin district
      //   2. First accessible district
      // In-module dropdowns let the user switch to any other accessible
      // district/club, so this default is just the initial landing context.
      final preferredDistrict = adminDistricts.isNotEmpty
          ? adminDistricts.first
          : _districts.first;
      final d = preferredDistrict;
      // Pick the preferred club:
      //   1. First admin club in the preferred district
      //   2. Any admin club
      //   3. First club in the preferred district
      //   4. First accessible club
      _ClubScope? preferredClub;
      for (final c in adminClubs) {
        if (c.districtId == d.id) {
          preferredClub = c;
          break;
        }
      }
      if (preferredClub == null && adminClubs.isNotEmpty) {
        preferredClub = adminClubs.first;
      }
      if (preferredClub == null) {
        for (final c in _clubs) {
          if (c.districtId == d.id) {
            preferredClub = c;
            break;
          }
        }
      }
      preferredClub ??= _clubs.first;
      final clubId = preferredClub.id;
      // Badge: when the user has more than one accessible district, label as
      // "Multi-District" so the hero doesn't misleadingly pin to one number.
      final multiDistrict = _districts.length > 1;
      final hasAdminClubInDistrict =
          adminClubs.any((c) => c.districtId == d.id);
      final String badge;
      if (multiDistrict) {
        badge = '${_districts.length} Districts';
      } else if (hasAdminClubInDistrict) {
        badge = '${d.number} · ${preferredClub.name}';
      } else {
        badge = d.number;
      }
      // Stats: in single-district mode, show that district's totals. In
      // multi-district mode, show the sum across all accessible districts.
      final clubCount = multiDistrict
          ? _districts.fold<int>(0, (s, x) => s + (x.totalClubs ?? 0))
          : (d.totalClubs ?? 0);
      final memberCount = multiDistrict
          ? _districts.fold<int>(0, (s, x) => s + (x.totalMembers ?? 0))
          : (d.totalMembers ?? 0);
      allTiles.add((
        title: 'My Rotary',
        badge: badge,
        stats:
            '$clubCount Club${clubCount != 1 ? "s" : ""} · $memberCount Member${memberCount != 1 ? "s" : ""}',
        onTap: () => context.push(RouteNames.unifiedModules(
              districtId: d.id,
              clubId: clubId,
            )),
      ));
    } else {
      // All accessible districts as primary tiles (minus the COG district).
      // Admins first.
      final tileDistricts =
          _districts.where((d) => !isCogDistrict(d)).toList();
      final orderedDistricts = <_DistrictScope>[
        ...tileDistricts.where((d) => adminDistrictIds.contains(d.id)),
        ...tileDistricts.where((d) => !adminDistrictIds.contains(d.id)),
      ];
      for (final d in orderedDistricts) {
        final isAdmin = adminDistrictIds.contains(d.id);
        allTiles.add((
          title: d.number,
          badge: isAdmin ? 'District Admin' : 'District Member',
          stats:
              '${d.totalClubs ?? 0} Club${(d.totalClubs ?? 0) != 1 ? "s" : ""} · ${d.totalMembers ?? 0} Member${(d.totalMembers ?? 0) != 1 ? "s" : ""}',
          onTap: () => context.push('/districts/${d.id}/dashboard'),
        ));
      }
    }
    allTiles.addAll(secondary);

    // Plain-member layout override: Club tile(s) get the hero treatment, then
    // District + My Clubs shortcut share the second row. Falls through to the
    // standard admin layout when the user has any elevated role.
    final isPlainMember = !auth.isAdmin && !auth.isAG;
    if (isPlainMember && !unifiedEligible) {
      allTiles.clear();
      // 1) Member clubs first (first tile becomes the full-width hero).
      for (final c in _clubs) {
        allTiles.add((
          title: c.name,
          badge: 'Club Member',
          stats:
              '${c.totalMembers ?? 0} Member${(c.totalMembers ?? 0) != 1 ? "s" : ""}',
          onTap: () => context.push('/clubs/${c.id}/dashboard'),
        ));
      }
      // 2) Member districts (minus the COG district).
      for (final d in _districts.where((d) => !isCogDistrict(d))) {
        allTiles.add((
          title: d.number,
          badge: 'District Member',
          stats:
              '${d.totalClubs ?? 0} Club${(d.totalClubs ?? 0) != 1 ? "s" : ""} · ${d.totalMembers ?? 0} Member${(d.totalMembers ?? 0) != 1 ? "s" : ""}',
          onTap: () => context.push('/districts/${d.id}/dashboard'),
        ));
      }
      // (The plain-member "My Clubs" shortcut tile was removed per request —
      //  members reach their clubs via the "Club Member" dashboard tiles above.)
    }

    return _SecondaryTilesGrid(tiles: allTiles, baseIndex: 0);
  }
}

/// Secondary tiles layout for _RoleBasedConnections.
/// Follows the same odd/even rule as _ConnectionCards so a lone tile
/// renders full-width instead of half-width next to empty space.
class _SecondaryTilesGrid extends StatelessWidget {
  final List<({String title, String badge, String stats, VoidCallback onTap})>
      tiles;
  final int baseIndex;
  const _SecondaryTilesGrid({required this.tiles, required this.baseIndex});

  @override
  Widget build(BuildContext context) {
    if (tiles.isEmpty) return const SizedBox.shrink();

    // Single tile → full-width hero card.
    if (tiles.length == 1) {
      final t = tiles.first;
      return SizedBox(
        height: 116,
        child: _RoleScopeCard(
          title: t.title,
          badge: t.badge,
          statsLine: t.stats,
          index: baseIndex,
          onTap: t.onTap,
        ),
      );
    }

    // Odd count (3, 5, …) → first tile full-width, rest in 2-col grid.
    if (tiles.length.isOdd) {
      final first = tiles.first;
      final rest = tiles.sublist(1);
      return Column(
        children: [
          SizedBox(
            height: 116,
            child: _RoleScopeCard(
              title: first.title,
              badge: first.badge,
              statsLine: first.stats,
              index: baseIndex,
              onTap: first.onTap,
            ),
          ),
          const SizedBox(height: 8),
          _buildGrid(rest, baseIndex + 1),
        ],
      );
    }

    // Even count (2, 4, …) → clean 2-col grid.
    return _buildGrid(tiles, baseIndex);
  }

  Widget _buildGrid(
    List<({String title, String badge, String stats, VoidCallback onTap})>
        items,
    int startIndex,
  ) {
    return GridView.builder(
      shrinkWrap: true,
      padding: EdgeInsets.zero,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        mainAxisExtent: 116,
      ),
      itemCount: items.length,
      itemBuilder: (ctx, i) => _RoleScopeCard(
        title: items[i].title,
        badge: items[i].badge,
        statsLine: items[i].stats,
        index: startIndex + i,
        onTap: items[i].onTap,
      ),
    );
  }
}

class _RoleScopeCard extends StatelessWidget {
  final String title;
  final String badge;
  final String statsLine;
  final int index;
  final VoidCallback onTap;

  const _RoleScopeCard({
    required this.title,
    required this.badge,
    required this.statsLine,
    required this.index,
    required this.onTap,
  });

  static const _gradients = [
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.accentBlue, AppColors.chart5],
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.primaryDeep, AppColors.primaryDeep],
    [AppColors.successDark, AppColors.success],
    [AppColors.warningInk, AppColors.warningDark],
  ];

  @override
  Widget build(BuildContext context) {
    final grad = _gradients[index % _gradients.length];
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.primaryPrime,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      badge,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.3,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Icon(Icons.arrow_outward_rounded,
                    color: Colors.white.withOpacity(0.7), size: 16),
              ],
            ),
            const SizedBox(height: 8),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      title,
                      style: AppFonts.body(fontSize: 14,
                        fontWeight: FontWeight.w800,
                        height: 1.2,
                        color: Colors.white,
                      ),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                   const SizedBox(height: 1),
                  Text(
                    statsLine,
                    style: AppFonts.body(fontSize: 10,
                      fontWeight: FontWeight.w500,
                      color: Colors.white.withOpacity(0.85),
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// My Connections hand-off card shown to members whose context carries a
/// SuperAdmin role (a web-only console). Tapping it asks the backend for a
/// short-lived link and opens the web portal in the browser. The backend
/// endpoint is scoped to the current member and returns an error for anyone
/// without web-admin access.
class _SuperAdminConnectionCard extends StatefulWidget {
  final ApiClient api;
  const _SuperAdminConnectionCard({required this.api});

  @override
  State<_SuperAdminConnectionCard> createState() =>
      _SuperAdminConnectionCardState();
}

class _SuperAdminConnectionCardState extends State<_SuperAdminConnectionCard> {
  bool _launching = false;

  Future<void> _openPortal() async {
    if (_launching) return;
    setState(() => _launching = true);
    try {
      final res = await widget.api.post<Map<String, dynamic>>(
        ApiConstants.webSsoToken,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = res.isSuccess ? res.data : null;
      final url = data == null ? null : data['url']?.toString();
      if (url == null || url.isEmpty) {
        SnackbarUtils.showError(
          context,
          res.error ?? 'Could not open the admin portal. Please try again.',
        );
        return;
      }
      final uri = Uri.tryParse(url);
      final opened = uri != null &&
          await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        SnackbarUtils.showError(context, 'Could not open the admin portal.');
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _launching ? null : _openPortal,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.darkBg,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.shield_moon_rounded,
                  color: AppColors.goldLight, size: 24),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.goldLight.withOpacity(0.18),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'SUPER ADMIN',
                      style: AppFonts.body(color: AppColors.goldLight,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Open the web admin portal',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Opens in your browser',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(color: Colors.white.withOpacity(0.7),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            _launching
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor:
                          AlwaysStoppedAnimation<Color>(AppColors.goldLight),
                    ),
                  )
                : Icon(Icons.arrow_outward_rounded,
                    color: Colors.white.withOpacity(0.75), size: 20),
          ],
        ),
      ),
    );
  }
}

/// Compact in-card error body used by the My Connections tiles. Offline gets
/// its own icon and headline so a dropped connection doesn't read like a
/// failure of the app.
class _InlineErrorBody extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;

  const _InlineErrorBody({required this.message, this.onRetry});

  @override
  Widget build(BuildContext context) {
    final offline = isOfflineMessage(message);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          offline ? Icons.wifi_off_rounded : Icons.error_outline,
          color: offline ? AppColors.textSecondary : AppColors.error,
          size: 32,
        ),
        const SizedBox(height: 8),
        Text(
          offline ? "You're offline" : 'Something went wrong',
          style: AppTextStyles.bodyMedium.copyWith(
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 4),
        Text(
          offline
              ? 'Check your internet connection and try again.'
              : message,
          style: AppTextStyles.caption,
          textAlign: TextAlign.center,
        ),
        if (onRetry != null)
          TextButton(onPressed: onRetry, child: const Text('Retry')),
      ],
    );
  }
}

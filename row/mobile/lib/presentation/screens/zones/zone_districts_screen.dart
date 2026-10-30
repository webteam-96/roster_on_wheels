import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../data/models/club_model.dart';
import '../../../data/models/district_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Zone detail screen: shows Districts and Clubs tabs.
/// For scoped roles (DistrictAdmin, ClubAdmin), only assigned entities are shown.
class ZoneDistrictsScreen extends StatefulWidget {
  final int zoneId;
  final String zoneName;
  const ZoneDistrictsScreen({super.key, required this.zoneId, required this.zoneName});

  @override
  State<ZoneDistrictsScreen> createState() => _ZoneDistrictsScreenState();
}

class _ZoneDistrictsScreenState extends State<ZoneDistrictsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final ApiClient _api = ApiClient();

  List<DistrictModel> _districts = [];
  List<ClubModel> _clubs = [];
  bool _loadingDistricts = true;
  bool _loadingClubs = true;
  String? _districtError;
  String? _clubError;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _fetchDistricts();
      _fetchClubs();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchDistricts() async {
    setState(() { _loadingDistricts = true; _districtError = null; });
    try {
      final auth = context.read<AuthProvider>();
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.districts,
        queryParams: {'page': 1, 'pageSize': 200, 'zoneId': widget.zoneId},
      );
      final data = res.data;
      if (data == null) {
        if (mounted) setState(() { _loadingDistricts = false; });
        return;
      }
      final rawItems = data['items'] as List<dynamic>? ?? [];
      final items = rawItems
          .map((e) => DistrictModel.fromJson(e as Map<String, dynamic>))
          .toList();
      // Filter by assigned districts only for DistrictAdmin/DistrictMember roles.
      // SuperAdmin sees all districts in the zone.
      List<DistrictModel> filtered = items;
      if (!auth.isSuperAdmin &&
          (auth.isDistrictAdmin || auth.isDistrictMember)) {
        final assigned = auth.assignedDistrictIds;
        if (assigned.isNotEmpty) {
          filtered = items.where((d) => assigned.contains(d.id)).toList();
        }
      }
      if (mounted) setState(() { _districts = filtered; _loadingDistricts = false; });
    } catch (e) {
      if (mounted) setState(() { _districtError = e.toString(); _loadingDistricts = false; });
    }
  }

  Future<void> _fetchClubs() async {
    setState(() { _loadingClubs = true; _clubError = null; });
    try {
      final auth = context.read<AuthProvider>();
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.clubs,
        queryParams: {'page': 1, 'pageSize': 200, 'zoneId': widget.zoneId},
      );
      final data = res.data;
      if (data == null) {
        if (mounted) setState(() { _loadingClubs = false; });
        return;
      }
      final rawItems = data['items'] as List<dynamic>? ?? [];
      final items = rawItems
          .map((e) => ClubModel.fromJson(e as Map<String, dynamic>))
          .toList();
      // Filter by assigned clubs only for ClubAdmin/ClubMember roles.
      // SuperAdmin and DistrictAdmin see all clubs in the zone.
      List<ClubModel> filtered = items;
      if (!auth.isSuperAdmin && !auth.isDistrictAdmin &&
          (auth.isClubAdmin || auth.isClubMember)) {
        final assigned = auth.assignedClubIds;
        if (assigned.isNotEmpty) {
          filtered = items.where((c) => assigned.contains(c.id)).toList();
        }
      }
      if (mounted) setState(() { _clubs = filtered; _loadingClubs = false; });
    } catch (e) {
      if (mounted) setState(() { _clubError = e.toString(); _loadingClubs = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        children: [
          _ZoneHeader(zoneName: widget.zoneName, onBack: () => context.pop()),
          // Tab bar
          Container(
            color: AppColors.primary,
            child: TabBar(
              controller: _tabController,
              labelStyle: AppTextStyles.bodySemiBold,
              tabs: const [
                Tab(text: 'Clubs'),
                Tab(text: 'Districts'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _ClubsTab(
                  clubs: _clubs,
                  loading: _loadingClubs,
                  error: _clubError,
                  onRetry: _fetchClubs,
                ),
                _DistrictsTab(
                  districts: _districts,
                  loading: _loadingDistricts,
                  error: _districtError,
                  onRetry: _fetchDistricts,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Zone header (dark blue, no AppBar — custom header)
// ---------------------------------------------------------------------------

class _ZoneHeader extends StatelessWidget {
  final String zoneName;
  final VoidCallback onBack;
  const _ZoneHeader({required this.zoneName, required this.onBack});

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.of(context).padding.top;
    return Container(
      color: AppColors.primary,
      padding: EdgeInsets.fromLTRB(4, top + 4, 16, 12),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: onBack,
          ),
          Expanded(
            child: Text(
              zoneName,
              style: AppTextStyles.h3.copyWith(color: Colors.white),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Districts tab
// ---------------------------------------------------------------------------

class _DistrictsTab extends StatelessWidget {
  final List<DistrictModel> districts;
  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  const _DistrictsTab({required this.districts, required this.loading, this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    if (loading) return const LoadingWidget();
    if (error != null) return ErrorStateWidget(message: error!, onRetry: onRetry);
    if (districts.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.location_city_outlined,
        title: 'No Districts',
        subtitle: 'No districts found in this zone.',
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () async => onRetry(),
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: districts.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (ctx, i) {
          final d = districts[i];
          return _DistrictCard(
            district: d,
            onTap: () => ctx.push(RouteNames.districtDashboard(d.id)),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Clubs tab
// ---------------------------------------------------------------------------

class _ClubsTab extends StatelessWidget {
  final List<ClubModel> clubs;
  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  const _ClubsTab({required this.clubs, required this.loading, this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    if (loading) return const LoadingWidget();
    if (error != null) return ErrorStateWidget(message: error!, onRetry: onRetry);
    if (clubs.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.business_outlined,
        title: 'No Clubs',
        subtitle: 'No clubs found in this zone.',
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () async => onRetry(),
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: clubs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (ctx, i) {
          final c = clubs[i];
          return _ClubCard(
            club: c,
            onTap: () => ctx.push(RouteNames.clubDashboard(c.id)),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// District card
// ---------------------------------------------------------------------------

class _DistrictCard extends StatelessWidget {
  final DistrictModel district;
  final VoidCallback onTap;
  const _DistrictCard({required this.district, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: const BoxDecoration(
                color: AppColors.primaryDeep,
                borderRadius: BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
              ),
              child: Row(
                children: [
                  Container(
                    width: 40, height: 40,
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.15), shape: BoxShape.circle),
                    child: const Icon(Icons.location_on_outlined, color: Colors.white, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      district.districtName,
                      style: AppTextStyles.bodySemiBold.copyWith(color: Colors.white),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Colors.white54, size: 20),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  _Stat(icon: Icons.business_outlined, label: '${district.totalClubs ?? 0} Clubs'),
                  const SizedBox(width: 16),
                  _Stat(icon: Icons.people_outline, label: '${district.totalMembers ?? 0} Members'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Club card
// ---------------------------------------------------------------------------

class _ClubCard extends StatelessWidget {
  final ClubModel club;
  final VoidCallback onTap;
  const _ClubCard({required this.club, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(10)),
              child: club.clubLogoPath != null && club.clubLogoPath!.isNotEmpty
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.network(ApiConstants.mediaUrl(club.clubLogoPath), fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(Icons.business, color: AppColors.primary, size: 24)),
                    )
                  : const Icon(Icons.business, color: AppColors.primary, size: 24),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(club.clubName, style: AppTextStyles.bodySemiBold, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (club.districtName != null)
                    Text(club.districtName!, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: AppColors.textMuted, size: 20),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final IconData icon;
  final String label;
  const _Stat({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.textMuted),
        const SizedBox(width: 4),
        Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
      ],
    );
  }
}

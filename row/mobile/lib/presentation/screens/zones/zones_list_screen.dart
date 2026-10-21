import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/zone_model.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_drawer.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/search_bar_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

enum _ZonesStatus { idle, loading, loadingMore, success, error }

class ZonesProvider extends ChangeNotifier {
  final ApiClient _api = ApiClient();

  _ZonesStatus _status = _ZonesStatus.idle;
  List<ZoneModel> _zones = [];
  String _error = '';
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  String _search = '';
  String? _isActiveFilter;

  _ZonesStatus get status => _status;
  List<ZoneModel> get zones => _zones;
  String get error => _error;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  String? get isActiveFilter => _isActiveFilter;
  bool get isLoadingMore => _status == _ZonesStatus.loadingMore;

  Future<void> fetchZones({bool refresh = false}) async {
    if (refresh) {
      _currentPage = 1;
      _zones = [];
    }
    _status = _zones.isEmpty ? _ZonesStatus.loading : _ZonesStatus.loadingMore;
    notifyListeners();

    try {
      final params = <String, dynamic>{
        'page': _currentPage,
        'pageSize': _pageSize,
        if (_search.isNotEmpty) 'search': _search,
        if (_isActiveFilter != null) 'isActive': _isActiveFilter,
      };

      final response = await _api.get<Map<String, dynamic>>(
        ApiConstants.zones,
        queryParams: params,
      );

      final data = response.data;
      if (data != null) {
        final List<dynamic> items = data['items'] as List<dynamic>? ?? [];
        final newZones = items
            .map((e) => ZoneModel.fromJson(e as Map<String, dynamic>))
            .toList();

        if (refresh || _currentPage == 1) {
          _zones = newZones;
        } else {
          _zones = [..._zones, ...newZones];
        }

        _totalPages = (data['totalPages'] as int?) ?? 1;
        _totalCount = (data['totalCount'] as int?) ?? _zones.length;
      }
      _status = _ZonesStatus.success;
    } catch (e) {
      _status = _ZonesStatus.error;
      _error = e.toString();
    }
    notifyListeners();
  }

  Future<void> loadMore() async {
    if (_currentPage >= _totalPages || isLoadingMore) return;
    _currentPage++;
    await fetchZones();
  }

  void setSearch(String value) {
    _search = value;
    _currentPage = 1;
    fetchZones(refresh: true);
  }

  void setActiveFilter(String? value) {
    _isActiveFilter = value;
    _currentPage = 1;
    fetchZones(refresh: true);
  }

  Future<bool> deleteZone(int id) async {
    try {
      await _api.delete(ApiConstants.zoneById(id));
      _zones.removeWhere((z) => z.id == id);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

class ZonesListScreen extends StatefulWidget {
  const ZonesListScreen({super.key});

  @override
  State<ZonesListScreen> createState() => _ZonesListScreenState();
}

class _ZonesListScreenState extends State<ZonesListScreen> {
  late final ZonesProvider _provider;

  @override
  void initState() {
    super.initState();
    _provider = ZonesProvider();
    WidgetsBinding.instance.addPostFrameCallback((_) => _provider.fetchZones());
  }

  @override
  void dispose() {
    _provider.dispose();
    super.dispose();
  }

  Future<void> _onRefresh() => _provider.fetchZones(refresh: true);

  Future<void> _confirmDelete(BuildContext ctx, ZoneModel zone) async {
    final confirmed = await ConfirmationDialog.show(
      ctx,
      title: 'Delete Zone',
      message: 'Are you sure you want to delete "${zone.zoneName}"? This action cannot be undone.',
    );
    if (!confirmed) return;
    if (!ctx.mounted) return;
    final success = await _provider.deleteZone(zone.id);
    if (!ctx.mounted) return;
    if (success) {
      SnackbarUtils.showSuccess(ctx, 'Zone deleted successfully.');
    } else {
      SnackbarUtils.showError(ctx, _provider.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSuperAdmin = context.read<AuthProvider>().isSuperAdmin;
    return ChangeNotifierProvider.value(
      value: _provider,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        drawer: const CustomDrawer(),
        appBar: CustomAppBar(
          title: 'Zones',
          titleStyle: AppFonts.body(fontWeight: FontWeight.bold, fontSize: 22),
        ),
        floatingActionButton: isSuperAdmin
            ? FloatingActionButton.extended(
                backgroundColor: AppColors.primaryPrime,
                foregroundColor: AppColors.white,
                onPressed: () async {
                  await context.push(RouteNames.zoneNew);
                  _provider.fetchZones(refresh: true);
                },
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add Zone'),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              )
            : null,
        body: Consumer<ZonesProvider>(
          builder: (context, provider, _) {
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                  child: SearchBarWidget(
                    hint: 'Search zones...',
                    onSearch: provider.setSearch,
                  ),
                ),
                _ActiveFilterChips(provider: provider),
                Expanded(
                  child: _buildBody(context, provider),
                ),
                if (provider.status == _ZonesStatus.success && provider.zones.isNotEmpty)
                  PaginationWidget(
                    currentPage: provider.currentPage,
                    totalPages: provider.totalPages,
                    totalCount: provider.totalCount,
                    isLoading: provider.isLoadingMore,
                    onLoadMore: provider.loadMore,
                  ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context, ZonesProvider provider) {
    switch (provider.status) {
      case _ZonesStatus.loading:
        return const _ZonesShimmer();
      case _ZonesStatus.error:
        return ErrorStateWidget(
          message: provider.error,
          onRetry: () => provider.fetchZones(refresh: true),
        );
      case _ZonesStatus.success:
      case _ZonesStatus.loadingMore:
        if (provider.zones.isEmpty) {
          return const EmptyStateWidget(
            icon: Icons.public_off_rounded,
            title: 'No Zones Found',
            subtitle: 'Add your first zone to begin.',
          );
        }
        return RefreshIndicator(
          onRefresh: _onRefresh,
          color: AppColors.primaryPrime,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 100),
            itemCount: provider.zones.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (ctx, index) {
              final zone = provider.zones[index];
              return _ZoneCard(
                zone: zone,
                canManage: ctx.read<AuthProvider>().isSuperAdmin,
                onEdit: () async {
                  await ctx.push(RouteNames.zoneEdit(zone.id));
                  provider.fetchZones(refresh: true);
                },
                onDelete: () => _confirmDelete(ctx, zone),
              );
            },
          ),
        );
      case _ZonesStatus.idle:
        return const SizedBox.shrink();
    }
  }
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

class _ActiveFilterChips extends StatelessWidget {
  final ZonesProvider provider;
  const _ActiveFilterChips({required this.provider});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      child: Row(
        children: [
          _FilterChip(
            label: 'All',
            selected: provider.isActiveFilter == null,
            onTap: () => provider.setActiveFilter(null),
          ),
          const SizedBox(width: 8),
          _FilterChip(
            label: 'Active',
            selected: provider.isActiveFilter == 'true',
            onTap: () => provider.setActiveFilter('true'),
          ),
          const SizedBox(width: 8),
          _FilterChip(
            label: 'Inactive',
            selected: provider.isActiveFilter == 'false',
            onTap: () => provider.setActiveFilter('false'),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryPrime : AppColors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? AppColors.primaryPrime : AppColors.lightBorder,
          ),
        ),
        child: Text(
          label,
          style: AppFonts.body(
            color: selected ? AppColors.white : AppColors.textSecondary,
            fontWeight: FontWeight.w700,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Zone Card
// ---------------------------------------------------------------------------

class _ZoneCard extends StatelessWidget {
  final ZoneModel zone;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final bool canManage;

  const _ZoneCard({
    required this.zone,
    required this.onEdit,
    required this.onDelete,
    required this.canManage,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lightBorder, width: 1),
      ),
      child: Material(
        color: AppColors.transparent,
        child: InkWell(
          onTap: () => context.push(RouteNames.zoneDistricts(zone.id, zone.zoneName)),
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: AppColors.primaryPrime.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Icon(Icons.public_rounded, color: AppColors.primaryPrime, size: 28),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        zone.zoneName,
                        style: AppFonts.body(
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.location_city_rounded, size: 14, color: AppColors.textSecondary),
                          const SizedBox(width: 4),
                          Text(
                            '${zone.totalDistricts ?? 0} Districts',
                            style: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(width: 12),
                          _StatusBadge(isActive: zone.isActive),
                        ],
                      ),
                    ],
                  ),
                ),
                if (canManage) ...[
                  const SizedBox(width: 8),
                  Column(
                    children: [
                      _ActionButton(
                        icon: Icons.edit_rounded,
                        color: AppColors.primaryPrime,
                        onTap: onEdit,
                      ),
                      const SizedBox(height: 8),
                      _ActionButton(
                        icon: Icons.delete_rounded,
                        color: AppColors.error,
                        onTap: onDelete,
                      ),
                    ],
                  ),
                ] else
                   const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({required this.icon, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, size: 18, color: color),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

class _StatusBadge extends StatelessWidget {
  final bool isActive;
  const _StatusBadge({required this.isActive});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: isActive ? AppColors.successLight : AppColors.errorLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        isActive ? 'Active' : 'Inactive',
        style: AppFonts.body(
          color: isActive ? AppColors.success : AppColors.error,
          fontWeight: FontWeight.w800,
          fontSize: 9,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shimmer placeholder
// ---------------------------------------------------------------------------

class _ZonesShimmer extends StatelessWidget {
  const _ZonesShimmer();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.md),
      itemCount: 8,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, __) => const _ShimmerCard(),
    );
  }
}

class _ShimmerCard extends StatelessWidget {
  const _ShimmerCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 84,
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lightBorder, width: 1),
      ),
      child: Row(
        children: [
          const SizedBox(width: 16),
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.shimmerBase,
              borderRadius: BorderRadius.circular(16),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(height: 16, width: 120, color: AppColors.shimmerBase),
                const SizedBox(height: 8),
                Container(height: 12, width: 80, color: AppColors.shimmerBase),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

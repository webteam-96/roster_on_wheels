import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/district_model.dart';
import '../../../data/models/zone_model.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_drawer.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/search_bar_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

enum _DistrictsStatus { idle, loading, loadingMore, success, error }

class DistrictsProvider extends ChangeNotifier {
  final ApiClient _api = ApiClient();

  _DistrictsStatus _status = _DistrictsStatus.idle;
  List<DistrictModel> _districts = [];
  List<ZoneModel> _zones = [];
  String _error = '';
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  String _search = '';
  String? _isActiveFilter;
  int? _zoneIdFilter;

  _DistrictsStatus get status => _status;
  List<DistrictModel> get districts => _districts;
  List<ZoneModel> get zones => _zones;
  String get error => _error;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  bool get isLoadingMore => _status == _DistrictsStatus.loadingMore;
  int? get zoneIdFilter => _zoneIdFilter;
  String? get isActiveFilter => _isActiveFilter;

  Future<void> init() async {
    await Future.wait([fetchZones(), fetchDistricts()]);
  }

  Future<void> fetchZones() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.zones,
        queryParams: {'page': 1, 'pageSize': 200},
      );
      final data = res.data;
      if (data != null) {
        final items = data['items'] as List<dynamic>? ?? [];
        _zones = items.map((e) => ZoneModel.fromJson(e as Map<String, dynamic>)).toList();
        notifyListeners();
      }
    } catch (e, st) {
      debugPrint('[Districts] fetchZones error: $e\n$st');
    }
  }

  Future<void> fetchDistricts({bool refresh = false}) async {
    if (refresh) {
      _currentPage = 1;
      _districts = [];
    }
    _status = _districts.isEmpty ? _DistrictsStatus.loading : _DistrictsStatus.loadingMore;
    notifyListeners();

    try {
      final params = <String, dynamic>{
        'page': _currentPage,
        'pageSize': _pageSize,
        if (_search.isNotEmpty) 'search': _search,
        if (_isActiveFilter != null) 'isActive': _isActiveFilter,
        if (_zoneIdFilter != null) 'fkZoneId': _zoneIdFilter,
      };

      final response = await _api.get<Map<String, dynamic>>('/districts', queryParams: params);
      final data = response.data;
      if (data != null) {
        final items = data['items'] as List<dynamic>? ?? [];
        final newItems = items
            .map((e) => DistrictModel.fromJson(e as Map<String, dynamic>))
            .toList();
        if (refresh || _currentPage == 1) {
          _districts = newItems;
        } else {
          _districts = [..._districts, ...newItems];
        }
        _totalPages = (data['totalPages'] as int?) ?? 1;
        _totalCount = (data['totalCount'] as int?) ?? _districts.length;
      }
      _status = _DistrictsStatus.success;
    } catch (e, st) {
      _status = _DistrictsStatus.error;
      _error = e.toString();
      debugPrint('[Districts] fetchDistricts error: $e\n$st');
    }
    notifyListeners();
  }

  Future<void> loadMore() async {
    if (_currentPage >= _totalPages || isLoadingMore) return;
    _currentPage++;
    await fetchDistricts();
  }

  void setSearch(String value) {
    _search = value;
    fetchDistricts(refresh: true);
  }

  void setActiveFilter(String? value) {
    _isActiveFilter = value;
    fetchDistricts(refresh: true);
  }

  void setZoneFilter(int? zoneId) {
    _zoneIdFilter = zoneId;
    fetchDistricts(refresh: true);
  }

  Future<bool> deleteDistrict(int id) async {
    try {
      await _api.delete(ApiConstants.districtById(id));
      _districts.removeWhere((d) => d.id == id);
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

class DistrictsListScreen extends StatefulWidget {
  const DistrictsListScreen({super.key});

  @override
  State<DistrictsListScreen> createState() => _DistrictsListScreenState();
}

class _DistrictsListScreenState extends State<DistrictsListScreen> {
  late final DistrictsProvider _provider;

  @override
  void initState() {
    super.initState();
    _provider = DistrictsProvider();
    WidgetsBinding.instance.addPostFrameCallback((_) => _provider.init());
  }

  @override
  void dispose() {
    _provider.dispose();
    super.dispose();
  }

  Future<void> _onRefresh() => _provider.fetchDistricts(refresh: true);

  Future<void> _confirmDelete(BuildContext ctx, DistrictModel district) async {
    final confirmed = await ConfirmationDialog.show(
      ctx,
      title: 'Delete District',
      message: 'Delete "${district.districtName}"? This cannot be undone.',
    );
    if (!confirmed) return;
    if (!ctx.mounted) return;
    final success = await _provider.deleteDistrict(district.id);
    if (!ctx.mounted) return;
    if (success) {
      SnackbarUtils.showSuccess(ctx, 'District deleted successfully.');
    } else {
      SnackbarUtils.showError(ctx, _provider.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManageDistricts = context.read<AuthProvider>().canManageDistricts;
    return ChangeNotifierProvider.value(
      value: _provider,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        drawer: const CustomDrawer(),
        appBar: CustomAppBar(
          title: 'Districts',
          titleStyle: AppFonts.body(fontWeight: FontWeight.bold, fontSize: 22),
        ),
        floatingActionButton: canManageDistricts
            ? FloatingActionButton.extended(
                backgroundColor: AppColors.primaryPrime,
                foregroundColor: AppColors.white,
                onPressed: () async {
                  await context.push(RouteNames.districtNew);
                  _provider.fetchDistricts(refresh: true);
                },
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add District'),
                shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(20))),
              )
            : null,
        body: Consumer<DistrictsProvider>(
          builder: (context, provider, _) {
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                  child: SearchBarWidget(
                    hint: 'Search districts...',
                    onSearch: provider.setSearch,
                  ),
                ),
                _FilterRow(provider: provider),
                Expanded(child: _buildBody(context, provider)),
                if (provider.status == _DistrictsStatus.success &&
                    provider.districts.isNotEmpty)
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

  Widget _buildBody(BuildContext context, DistrictsProvider provider) {
    switch (provider.status) {
      case _DistrictsStatus.loading:
        return const _DistrictsShimmer();
      case _DistrictsStatus.error:
        return ErrorStateWidget(
          message: provider.error,
          onRetry: () => provider.fetchDistricts(refresh: true),
        );
      case _DistrictsStatus.success:
      case _DistrictsStatus.loadingMore:
        if (provider.districts.isEmpty) {
          return const EmptyStateWidget(
            icon: Icons.location_city_rounded,
            title: 'No Districts Found',
            subtitle: 'Add your first district to begin.',
          );
        }
        return RefreshIndicator(
          onRefresh: _onRefresh,
          color: AppColors.primaryPrime,
          child: ListView.separated(
            padding: (const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 100)).add(const EdgeInsets.only(bottom: 88)),
            itemCount: provider.districts.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (ctx, index) {
              final district = provider.districts[index];
              return _DistrictCard(
                district: district,
                canManage: ctx.read<AuthProvider>().canManageDistricts,
                onTap: () => ctx.push(RouteNames.districtDashboard(district.id)),
                onEdit: () async {
                  await ctx.push(RouteNames.districtEdit(district.id));
                  provider.fetchDistricts(refresh: true);
                },
                onDelete: () => _confirmDelete(ctx, district),
              );
            },
          ),
        );
      case _DistrictsStatus.idle:
        return const SizedBox.shrink();
    }
  }
}

// ---------------------------------------------------------------------------
// Filter row
// ---------------------------------------------------------------------------

class _FilterRow extends StatelessWidget {
  final DistrictsProvider provider;
  const _FilterRow({required this.provider});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Align(alignment: Alignment.centerLeft, child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
          child: Row(
            children: [
              _Chip(
                label: 'All',
                selected: provider.isActiveFilter == null,
                onTap: () => provider.setActiveFilter(null),
              ),
              const SizedBox(width: 8),
              _Chip(
                label: 'Active',
                selected: provider.isActiveFilter == 'true',
                onTap: () => provider.setActiveFilter('true'),
              ),
              const SizedBox(width: 8),
              _Chip(
                label: 'Inactive',
                selected: provider.isActiveFilter == 'false',
                onTap: () => provider.setActiveFilter('false'),
              ),
            ],
          ),
        )),
        if (provider.zones.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
            child: _ZoneDropdown(provider: provider),
          ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _Chip({required this.label, required this.selected, required this.onTap});

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
          border: Border.all(color: selected ? AppColors.primaryPrime : AppColors.lightBorder),

        ),
        child: Text(
          label,
          style: AppFonts.body(
            color: selected ? AppColors.white : AppColors.textSecondary,
            fontWeight: FontWeight.w700,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

class _ZoneDropdown extends StatelessWidget {
  final DistrictsProvider provider;
  const _ZoneDropdown({required this.provider});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: provider.zoneIdFilter != null ? AppColors.primaryPrime : AppColors.lightBorder,
          width: provider.zoneIdFilter != null ? 1.5 : 1,
        ),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int?>(
          value: provider.zoneIdFilter,
          isExpanded: true,
          hint: Text('Select Zone Filter', style: AppFonts.body(fontSize: 13, color: AppColors.textSecondary)),
          style: AppFonts.body(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w600),
          items: [
            const DropdownMenuItem<int?>(value: null, child: Text('All Zones')),
            ...provider.zones.map(
              (z) => DropdownMenuItem<int?>(value: z.id, child: Text(z.zoneName)),
            ),
          ],
          onChanged: provider.setZoneFilter,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// District Card
// ---------------------------------------------------------------------------

class _DistrictCard extends StatelessWidget {
  final DistrictModel district;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final bool canManage;

  const _DistrictCard({
    required this.district,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
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
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        color: AppColors.primaryPrime.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Center(
                        child: Text(
                          '${district.districtNumber}',
                          style: AppFonts.body(
                            color: AppColors.primaryPrime,
                            fontWeight: FontWeight.w800,
                            fontSize: 18,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  district.districtName,
                                  style: AppFonts.body(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                    color: AppColors.textPrimary,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 8),
                              _StatusBadge(isActive: district.isActive),
                            ],
                          ),
                          if (district.zoneName != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              district.zoneName!,
                              style: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w600),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.primaryPrime.withOpacity(0.05),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.business_rounded, size: 14, color: AppColors.primaryPrime),
                          const SizedBox(width: 6),
                          Text(
                            '${district.totalClubs ?? 0} Clubs',
                            style: AppFonts.body(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.primaryPrime,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Spacer(),
                    if (canManage) ...[
                      _ActionButton(
                        icon: Icons.edit_rounded,
                        color: AppColors.primaryPrime,
                        onTap: onEdit,
                      ),
                      const SizedBox(width: 12),
                      _ActionButton(
                        icon: Icons.delete_rounded,
                        color: AppColors.error,
                        onTap: onDelete,
                      ),
                    ] else
                      const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
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
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, size: 18, color: color),
      ),
    );
  }
}

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
          fontSize: 13,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shimmer
// ---------------------------------------------------------------------------

class _DistrictsShimmer extends StatelessWidget {
  const _DistrictsShimmer();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: (const EdgeInsets.all(AppSpacing.md)).add(const EdgeInsets.only(bottom: 88)),
      itemCount: 7,
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
      height: 110,
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lightBorder, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Container(width: 52, height: 52, decoration: BoxDecoration(color: AppColors.shimmerBase, borderRadius: BorderRadius.circular(16))),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(height: 16, width: 150, color: AppColors.shimmerBase),
                      const SizedBox(height: 8),
                      Container(height: 12, width: 100, color: AppColors.shimmerBase),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
